'use strict';
// Reviewed local migration only. MySQL routine DDL is not transactional.
// The backend and other schema/privilege editors must remain stopped throughout.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');
const { projectStatements } = require('./setupIntegrationDb');
const { canonicalSql, contextValues, visibleDefinition } = require('./addAuditLog');
const { configuration } = require('./setupRuntimeUser');
const TARGET_DATABASE = 'SkyNest_Integration_20261002';
const PROCEDURES = ['sp_make_booking', 'sp_check_in', 'sp_check_out', 'sp_log_service_usage', 'sp_process_payment', 'sp_update_booked_room'];
const LOCK_NAME = 'skynest.integration.staff-branch-access.v1';
const ROOT = 'root@localhost';
const qual = name => `\`${TARGET_DATABASE}\`.\`${name}\``;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
class InstallError extends Error {}
function failure(message) { throw new InstallError(message); }
function safeCode(error) { return /^(ER_[A-Z0-9_]+|PROTOCOL_[A-Z0-9_]+|E[A-Z0-9_]+)$/.test(error?.code || '') ? ` (${error.code})` : ''; }
function formatFailure(error) {
  return error instanceof InstallError ? error.message : `Staff branch installation failed${safeCode(error)}. Keep the backend stopped and inspect before retrying.`;
}
function definitions() {
  const read = file => projectStatements(fs.readFileSync(path.join(__dirname, file), 'utf8'));
  const before = read('migrations/003_staff_branch_before.sql');
  const after = read('migrations/003_staff_branch_access.sql');
  const schema = read('schema.sql');
  const find = (list, name) => {
    const matches = list.filter(sql => new RegExp(`^CREATE PROCEDURE ${name}\\b`).test(sql));
    if (matches.length !== 1) failure('The reviewed procedure definitions are incomplete. Nothing was changed.');
    return matches[0];
  };
  if (before.length !== PROCEDURES.length || after.length !== PROCEDURES.length) failure('Unexpected migration statements. Nothing was changed.');
  return PROCEDURES.map(name => {
    const object = { name, before: find(before, name), sql: find(after, name) };
    if (canonicalSql(object.sql) !== canonicalSql(find(schema, name))) failure('Migration and schema definitions differ. Nothing was changed.');
    return object;
  });
}
function grantsOf(rows) {
  if (!Array.isArray(rows)) failure('Routine grants are not readable.');
  const grants = rows.map(row => {
    if (typeof row.User !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/.test(row.User) ||
        typeof row.Host !== 'string' || !/^[A-Za-z0-9_.:%-]{1,255}$/.test(row.Host) || typeof row.Proc_priv !== 'string') {
      failure('An unsupported routine grant identity requires manual review.');
    }
    const privileges = row.Proc_priv.split(',').map(p => p.trim().toUpperCase()).sort();
    if (!privileges.length || new Set(privileges).size !== privileges.length ||
        privileges.some(p => p !== 'EXECUTE' && !(row.User === 'root' && row.Host === 'localhost' && p === 'ALTER ROUTINE'))) {
      failure('Unexpected routine privileges or grant option require manual review.');
    }
    return { user: row.User, host: row.Host, privileges };
  }).sort((a, b) => `${a.user}@${a.host}`.localeCompare(`${b.user}@${b.host}`, 'en'));
  if (new Set(grants.map(row => `${row.user}@${row.host}`)).size !== grants.length) failure('Duplicate routine grants require manual review.');
  return grants;
}
async function readGrants(connection, name, foldNames) {
  const [rows] = await connection.execute(foldNames
    ? 'SELECT User, Host, Proc_priv FROM mysql.procs_priv WHERE LOWER(Db) = ? AND Routine_name = ? AND Routine_type = ?'
    : 'SELECT User, Host, Proc_priv FROM mysql.procs_priv WHERE Db = ? AND Routine_name = ? AND Routine_type = ?',
  [foldNames ? TARGET_DATABASE.toLowerCase() : TARGET_DATABASE, name, 'PROCEDURE']);
  return grantsOf(rows);
}
async function readObject(connection, name) {
  try {
    const [rows] = await connection.query(`SHOW CREATE PROCEDURE ${qual(name)}`);
    if (rows.length !== 1) failure('Procedure definition is not uniquely readable.');
    return rows[0];
  } catch (error) { if (error.code === 'ER_SP_DOES_NOT_EXIST') return null; throw error; }
}
function stateOf(row, object, foldNames) {
  if (!row) return 'missing';
  const value = canonicalSql(visibleDefinition(row, 'PROCEDURE').portable, foldNames);
  if (value === canonicalSql(object.sql, foldNames)) return 'current';
  if (value === canonicalSql(object.before, foldNames)) return 'before';
  failure(`${object.name} differs from the reviewed definitions. Nothing further was overwritten.`);
}
function sameContext(row, original) {
  return !!row && visibleDefinition(row, 'PROCEDURE').definer === ROOT &&
    same(contextValues(row), contextValues(original)) && row['Database Collation'] === original['Database Collation'];
}
async function restoreGrants(connection, name, desired, foldNames) {
  const current = await readGrants(connection, name, foldNames);
  // CREATE may automatically add EXECUTE/ALTER ROUTINE to its creator. Only
  // that exact maintenance account's extra routine privileges may be removed.
  for (const grant of current) {
    const wanted = desired.find(row => row.user === grant.user && row.host === grant.host);
    const extra = grant.privileges.filter(p => !wanted?.privileges.includes(p));
    if (!extra.length) continue;
    if (`${grant.user}@${grant.host}` !== ROOT) failure('Unexpected routine grants appeared; nothing was revoked.');
    await connection.query(`REVOKE ${extra.join(', ')} ON PROCEDURE ${qual(name)} FROM \`root\`@\`localhost\``);
  }
  for (const grant of desired) {
    const found = current.find(row => row.user === grant.user && row.host === grant.host);
    const missing = grant.privileges.filter(p => !found?.privileges.includes(p));
    if (missing.length) await connection.query(`GRANT ${missing.join(', ')} ON PROCEDURE ${qual(name)} TO \`${grant.user}\`@\`${grant.host}\``);
  }
  if (!same(await readGrants(connection, name, foldNames), desired)) failure('Exact routine grants could not be verified.');
}
function backupObjects(snapshot) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const projectRoot = fs.realpathSync(path.join(__dirname, '..', '..'));
  const relative = path.relative(projectRoot, tempRoot);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) failure('Backup directory must be outside the project. Nothing was changed.');
  const directory = fs.mkdtempSync(path.join(tempRoot, 'skynest-staff-branch-'));
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, 'original-procedures-and-grants.json');
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ database: TARGET_DATABASE, backedUpAt: new Date().toISOString(), ...snapshot }, null, 2) + '\n');
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  return file;
}
async function replace(connection, object, saved, foldNames, backupPath) {
  const context = contextValues(saved.row);
  await connection.query('SET SESSION sql_mode = ?, character_set_client = ?, collation_connection = ?', context);
  const live = await readObject(connection, object.name);
  if (!sameContext(live, saved.row) || stateOf(live, object, foldNames) !== 'before' ||
      !same(await readGrants(connection, object.name, foldNames), saved.grants)) failure('A procedure or its grants changed after preflight. Nothing further was overwritten.');
  try {
    await connection.query(`DROP PROCEDURE ${qual(object.name)}`);
    await connection.query(visibleDefinition(saved.row, 'PROCEDURE').header + object.sql.slice('CREATE '.length));
    const installed = await readObject(connection, object.name);
    if (!sameContext(installed, saved.row) || stateOf(installed, object, foldNames) !== 'current') failure('Replacement definition/context verification failed.');
    await restoreGrants(connection, object.name, saved.grants, foldNames);
  } catch (error) {
    // Inspect before any recovery DDL. A lost acknowledgement is not proof that
    // DROP, CREATE, GRANT or REVOKE failed. Unknown objects are never dropped.
    let observed; let observedState; let grants;
    try {
      observed = await readObject(connection, object.name);
      observedState = stateOf(observed, object, foldNames);
      if (observed && !sameContext(observed, saved.row)) failure('Context changed.');
      grants = await readGrants(connection, object.name, foldNames);
    } catch {
      failure(`${object.name} outcome could not be verified${safeCode(error)}. Keep the backend stopped; recover using ${backupPath}.`);
    }
    if (observedState === 'current' && same(grants, saved.grants)) return;
    if (observedState === 'before') {
      if (!same(grants, saved.grants)) failure(`${object.name} original remains, but grants changed. Keep the backend stopped; inspect ${backupPath}.`);
      failure(`${object.name} update failed${safeCode(error)}; its original definition and grants remain. Other procedures may already be updated. Keep the backend stopped. Backup: ${backupPath}.`);
    }
    // Recreate exactly the backed-up original only after observing our new
    // definition (or its absence). Refuse unexpected externally added grants.
    const safeGrantState = grants.every(g => {
      const wanted = saved.grants.find(d => d.user === g.user && d.host === g.host);
      return `${g.user}@${g.host}` === ROOT || wanted && g.privileges.every(p => wanted.privileges.includes(p));
    });
    if (!safeGrantState) failure(`${object.name} has unexpected grants. Keep the backend stopped; inspect ${backupPath}.`);
    try {
      if (observedState === 'current') await connection.query(`DROP PROCEDURE ${qual(object.name)}`);
      await connection.query(saved.row['Create Procedure']);
      const restored = await readObject(connection, object.name);
      if (!sameContext(restored, saved.row) || stateOf(restored, object, foldNames) !== 'before') failure('Restoration verification failed.');
      await restoreGrants(connection, object.name, saved.grants, foldNames);
    } catch (restoreError) {
      failure(`${object.name} restoration could not be confirmed${safeCode(restoreError)}. Keep the backend stopped; recover using ${backupPath}.`);
    }
    failure(`${object.name} update failed${safeCode(error)}; its original definition and exact grants were restored. Other procedures may already be updated. Keep the backend stopped. Backup: ${backupPath}.`);
  }
}
async function installStaffBranchAccess({ connection, config, backendStopped, writeBackup = backupObjects, log = console.log }) {
  configuration({ DB_HOST: config?.host, DB_PORT: String(config?.port ?? ''), DB_USER: config?.user, DB_PASSWORD: config?.password, DB_NAME: config?.database });
  if (backendStopped !== true) failure('Stop every backend using this database, then pass --backend-stopped. Nothing was changed.');
  const objects = definitions();
  const [[identity]] = await connection.query(`SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser,
    CURRENT_ROLE() AS activeRoles, @@GLOBAL.mandatory_roles AS mandatoryRoles,
    @@collation_database AS databaseCollation, @@lower_case_table_names AS lowerCaseTableNames,
    @@sql_mode AS sql_mode, @@character_set_client AS character_set_client, @@collation_connection AS collation_connection`);
  const rule = typeof identity?.lowerCaseTableNames === 'string' && /^[012]$/.test(identity.lowerCaseTableNames) ? Number(identity.lowerCaseTableNames) : identity?.lowerCaseTableNames;
  if (![0, 1, 2].includes(rule)) failure('Cannot verify server database identifier rules. Nothing was changed.');
  const foldNames = rule !== 0;
  if (typeof identity.databaseName !== 'string' || (foldNames ? identity.databaseName.toLowerCase() !== TARGET_DATABASE.toLowerCase() : identity.databaseName !== TARGET_DATABASE) ||
      identity.currentUser !== ROOT || identity.activeRoles !== 'NONE' || identity.mandatoryRoles !== '' || identity.databaseCollation !== 'utf8mb4_unicode_ci') failure('Unexpected target, maintenance identity, roles or database collation. Nothing was changed.');
  const context = contextValues(identity);
  const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
  if (![1, '1'].includes(lock?.acquired)) failure('Migration lock was not acquired. Nothing was changed.');
  let backupPath; let failed = false;
  try {
    const originals = {};
    for (const object of objects) {
      const row = await readObject(connection, object.name);
      const state = stateOf(row, object, foldNames);
      if (state === 'missing') failure(`${object.name} is missing. Keep the backend stopped and recover from its previous backup before retrying.`);
      // Preserve each routine's own recorded mode/charset, which can differ
      // from this connection's initial context.
      contextValues(row);
      if (visibleDefinition(row, 'PROCEDURE').definer !== ROOT || row['Database Collation'] !== identity.databaseCollation) failure('Procedure definer or database collation does not match maintenance identity. Nothing was changed.');
      if (/[^\x00-\x7f]/.test(row['Create Procedure'])) failure('Non-ASCII definitions require separate charset review. Nothing was changed.');
      const grants = await readGrants(connection, object.name, foldNames);
      if (!grants.some(g => g.user === 'skynest_app' && g.host === 'localhost' && same(g.privileges, ['EXECUTE']))) failure(`Required runtime EXECUTE grant is missing on ${object.name}. Nothing was changed.`);
      originals[object.name] = { row, state, grants };
    }
    if (Object.values(originals).every(o => o.state === 'current')) return { status: 'unchanged', updated: [] };
    backupPath = await writeBackup({ identity, objects: originals });
    if (typeof backupPath !== 'string' || !path.isAbsolute(backupPath)) failure('A complete private external backup is required. Nothing was changed.');
    // Verify all recorded SQL contexts can be selected before any DROP.
    for (const saved of Object.values(originals)) await connection.query('SET SESSION sql_mode = ?, character_set_client = ?, collation_connection = ?', contextValues(saved.row));
    const updated = [];
    for (const object of objects) {
      if (originals[object.name].state === 'current') continue;
      await replace(connection, object, originals[object.name], foldNames, backupPath);
      updated.push(object.name);
      log(`${object.name}: definition and exact routine grants verified.`);
    }
    for (const object of objects) {
      const row = await readObject(connection, object.name);
      if (stateOf(row, object, foldNames) !== 'current' || !sameContext(row, originals[object.name].row) ||
          !same(await readGrants(connection, object.name, foldNames), originals[object.name].grants)) failure('Final procedure/grant verification failed.');
    }
    return { status: 'updated', updated, backupPath };
  } catch (error) {
    failed = true;
    if (backupPath && !(error instanceof InstallError && error.message.includes(backupPath))) failure(`Installation stopped${safeCode(error)}. Some procedures may already be updated. Keep the backend stopped; inspect ${backupPath}.`);
    throw error;
  } finally {
    let cleanupFailed = false;
    try { await connection.query('SET SESSION sql_mode = ?, character_set_client = ?, collation_connection = ?', context); } catch { cleanupFailed = true; }
    try { const [[released]] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); if (![1, '1'].includes(released?.released)) cleanupFailed = true; } catch { cleanupFailed = true; }
    if (cleanupFailed && !failed) failure(`Cleanup could not be confirmed. Keep the backend stopped and inspect before retrying.${backupPath ? ` Backup: ${backupPath}.` : ''}`);
  }
}
function maintenanceConfiguration(contents) {
  return configuration(dotenv.parse(contents));
}
async function main() {
  if (process.argv.slice(2).join(' ') !== '--backend-stopped') failure('Usage: node backend/Database/runMaintenance.js installStaffBranchAccess.js --backend-stopped');
  // Always read the explicit private maintenance file. Never load runtime .env,
  // use inherited DB_* values or copy administrative credentials into it.
  const config = maintenanceConfiguration(fs.readFileSync(path.join(__dirname, '..', '.env.maintenance'), 'utf8'));
  const connection = await require('mysql2/promise').createConnection({ ...config, multipleStatements: false });
  let failed = false;
  try {
    const result = await installStaffBranchAccess({ connection, config, backendStopped: true });
    console.log(result.status === 'unchanged' ? 'Staff branch procedures and runtime grants are already verified.' : 'Staff branch procedures updated; exact routine grants preserved.');
    if (result.backupPath) console.log(`Original definitions and grants backup: ${result.backupPath}`);
    console.log('No hotel rows were changed. Verify the runtime account, then restart the matching backend.');
  } catch (error) { failed = true; throw error; }
  finally { try { await connection.end(); } catch { if (!failed) failure('Connection closure could not be confirmed. Keep the backend stopped and inspect.'); } }
}
if (require.main === module) main().catch(error => { console.error(formatFailure(error)); process.exitCode = 1; });
module.exports = { TARGET_DATABASE, PROCEDURES, LOCK_NAME, definitions, grantsOf, maintenanceConfiguration,
  backupObjects, installStaffBranchAccess, formatFailure };
