'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { TARGET_DATABASE, PROCEDURES, definitions, grantsOf, maintenanceConfiguration,
  backupObjects, installStaffBranchAccess, formatFailure } = require('../Database/installStaffBranchAccess');
const { command } = require('../Database/runMaintenance');
const { canonicalSql } = require('../Database/addAuditLog');
const reviewed = definitions();
const config = { host: 'localhost', port: 3306, user: 'root', password: 'private-maintenance-test', database: TARGET_DATABASE };
const context = { sql_mode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION', character_set_client: 'utf8mb4', collation_connection: 'utf8mb4_unicode_ci', 'Database Collation': 'utf8mb4_unicode_ci' };
const sampleGrants = [
  { User: 'skynest_app', Host: 'localhost', Proc_priv: 'Execute' },
  { User: 'report_reader', Host: '127.0.0.1', Proc_priv: 'Execute' },
];
const error = code => Object.assign(new Error('PRIVATE DRIVER SQL AND CREDENTIALS'), { code });
function row(object, current) {
  return { ...context, 'Create Procedure': (current ? object.sql : object.before).replace(/^CREATE /, 'CREATE DEFINER=`root`@`localhost` ') };
}
function fixture(options = {}) {
  const events = [];
  const identity = { ...context, databaseName: TARGET_DATABASE, currentUser: 'root@localhost', activeRoles: 'NONE', mandatoryRoles: '', databaseCollation: 'utf8mb4_unicode_ci', lowerCaseTableNames: 0, ...options.identity };
  const states = new Map(reviewed.map((o, i) => [o.name, row(o, options.current || options.mixed && i < 2)]));
  const grants = new Map(reviewed.map(o => [o.name, structuredClone(options.grants || sampleGrants)]));
  if (options.edit) options.edit(states, grants);
  let failed = false;
  let lastContext = [context.sql_mode, context.character_set_client, context.collation_connection];
  const target = options.target || 'sp_check_in';
  async function run(sql, values) {
    events.push({ sql, values });
    assert.doesNotMatch(sql, /^(INSERT|UPDATE|DELETE|TRUNCATE|CALL|CREATE USER|ALTER USER|START TRANSACTION|COMMIT|ROLLBACK)\b/i);
    assert.doesNotMatch(sql, /^DROP (?!PROCEDURE)/i);
    if (sql.startsWith('SELECT DATABASE()')) return [[identity]];
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: options.lock ?? 1 }]];
    if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: options.release ?? 1 }]];
    if (sql.startsWith('SET SESSION')) { if (options.contextFail) throw error('ER_WRONG_VALUE_FOR_VAR'); lastContext = values; return [{}]; }
    if (sql.startsWith('SHOW CREATE')) {
      const name = sql.match(/`([^`]+)`$/)[1];
      if (failed && options.unreadable && name === target) throw error('PROTOCOL_CONNECTION_LOST');
      const found = states.get(name);
      if (!found) throw error('ER_SP_DOES_NOT_EXIST');
      return [[structuredClone(found)]];
    }
    if (sql.includes('mysql.procs_priv')) {
      assert.equal(values[0], Number(identity.lowerCaseTableNames) ? TARGET_DATABASE.toLowerCase() : TARGET_DATABASE);
      assert.equal(values[2], 'PROCEDURE');
      assert.ok(sql.includes(Number(identity.lowerCaseTableNames) ? 'LOWER(Db)' : 'WHERE Db'));
      if (options.grantReadFail) throw error('ER_TABLEACCESS_DENIED_ERROR');
      return [structuredClone(grants.get(values[1]) || [])];
    }
    if (sql.startsWith('DROP PROCEDURE')) {
      const name = sql.match(/`([^`]+)`$/)[1];
      if (name === target && options.dropFail && !failed) {
        failed = true;
        if (options.dropApplied) { states.delete(name); grants.delete(name); }
        throw error(options.dropApplied ? 'PROTOCOL_CONNECTION_LOST' : 'ER_PROCACCESS_DENIED_ERROR');
      }
      assert.ok(states.has(name));
      states.delete(name); grants.delete(name); return [{}];
    }
    if (sql.startsWith('CREATE DEFINER')) {
      const name = sql.match(/PROCEDURE\s+([a-z_]+)/)[1];
      const object = reviewed.find(o => o.name === name);
      assert.ok(object);
      assert.equal(states.has(name), false, 'Never overwrite an observed procedure');
      const current = canonicalSql(sql.replace(/^CREATE DEFINER=`root`@`localhost` /, 'CREATE ')) === canonicalSql(object.sql);
      const appliedRow = { ...row(object, current), sql_mode: lastContext[0], character_set_client: lastContext[1], collation_connection: lastContext[2] };
      if (current && name === target && options.createFail && !failed) {
        failed = true;
        if (options.createApplied) { states.set(name, appliedRow); grants.set(name, structuredClone(options.autoRoot ? [{ User: 'root', Host: 'localhost', Proc_priv: 'Execute,Alter Routine' }] : [])); }
        if (options.createWithGrants) grants.set(name, structuredClone(sampleGrants));
        if (options.unexpectedDefinition) { appliedRow['Create Procedure'] += '\nSELECT 999'; states.set(name, appliedRow); }
        throw error(options.createApplied ? 'PROTOCOL_CONNECTION_LOST' : 'ER_PARSE_ERROR');
      }
      if (!current && options.restoreFail && name === target) throw error('ER_PROCACCESS_DENIED_ERROR');
      states.set(name, appliedRow);
      grants.set(name, structuredClone(options.autoRoot ? [{ User: 'root', Host: 'localhost', Proc_priv: 'Execute,Alter Routine' }] : []));
      return [{}];
    }
    if (sql.startsWith('GRANT ') || sql.startsWith('REVOKE ')) {
      const match = /^(GRANT|REVOKE) (EXECUTE|ALTER ROUTINE|ALTER ROUTINE, EXECUTE|EXECUTE, ALTER ROUTINE) ON PROCEDURE `SkyNest_Integration_20261002`\.`([a-z_]+)` (TO|FROM) `([^`]+)`@`([^`]+)`$/.exec(sql);
      assert.ok(match, 'Only exact routine grants are allowed: ' + sql);
      const [, op, priv, name, , user, host] = match;
      const existing = grants.get(name) || [];
      const found = existing.find(r => r.User === user && r.Host === host);
      const now = new Set(found ? found.Proc_priv.toUpperCase().split(',').map(p => p.trim()) : []);
      if (name === target && options.grantAlwaysFails && op === 'GRANT') throw error('ER_SPECIFIC_ACCESS_DENIED_ERROR');
      if (name === target && options.grantFail && !failed && op === 'GRANT') {
        failed = true;
        if (options.grantApplied) { for (const p of priv.split(', ')) now.add(p); }
        else throw error('ER_SPECIFIC_ACCESS_DENIED_ERROR');
      } else for (const p of priv.split(', ')) { if (op === 'GRANT') now.add(p); else now.delete(p); }
      const kept = existing.filter(r => r !== found);
      if (now.size) kept.push({ User: user, Host: host, Proc_priv: [...now].join(',') });
      grants.set(name, kept);
      if (name === target && options.grantApplied && failed && !options.grantErrorEmitted) { options.grantErrorEmitted = true; throw error('PROTOCOL_CONNECTION_LOST'); }
      return [{}];
    }
    throw new Error('Unexpected test SQL: ' + sql);
  }
  const connection = { query: run, execute: run };
  let saved;
  const optionsForRun = { connection, config: { ...config, ...options.config }, backendStopped: options.backendStopped ?? true, log: () => {}, writeBackup: async data => {
    events.push({ sql: 'BACKUP' });
    saved = structuredClone(data);
    if (options.backupFail) throw new Error('private fs message');
    return options.backupPath ?? path.join(os.tmpdir(), 'test-staff-branch-backup.json');
  } };
  return { events, states, grants, run: () => installStaffBranchAccess(optionsForRun), saved: () => saved };
}
const writes = f => f.events.filter(e => /^(DROP|CREATE|GRANT|REVOKE)\b/.test(e.sql));
const normalized = rows => grantsOf(rows);
async function rejected(options, match) { const f = fixture(options); await assert.rejects(f.run, match); return f; }
(async () => {
  assert.equal(reviewed.length, 6);
  const maintenance = 'DB_HOST=localhost\nDB_PORT=3306\nDB_USER=root\nDB_PASSWORD=test-only\nDB_NAME=SkyNest_Integration_20261002\n';
  assert.equal(maintenanceConfiguration(maintenance).user, 'root');
  assert.throws(() => maintenanceConfiguration(maintenance.replace('DB_USER=root', 'DB_USER=skynest_app')));
  const task = command(['installStaffBranchAccess.js', '--backend-stopped'], maintenance, { DB_USER: 'skynest_app', Path: 'unchanged' });
  assert.equal(task.env.DB_USER, 'root'); assert.equal(task.env.Path, 'unchanged');
  assert.equal(task.script, path.resolve(__dirname, '../Database/installStaffBranchAccess.js'));
  assert.throws(() => command(['installStaffBranchAccess.js', '--unsafe'], maintenance));
  const source = fs.readFileSync(path.join(__dirname, '../Database/installStaffBranchAccess.js'), 'utf8');
  assert.match(source, /\.env\.maintenance/);
  assert.doesNotMatch(source, /dotenv\.config|process\.env\.DB_/);
  assert.deepEqual(grantsOf([{ User: 'root', Host: 'localhost', Proc_priv: 'Alter Routine,Execute' }, ...sampleGrants]),
    grantsOf([...sampleGrants].reverse().concat({ User: 'root', Host: 'localhost', Proc_priv: 'Execute,Alter Routine' })));
  for (const value of ['Grant,Execute', 'SELECT', 'Execute,Execute', '', 'Create Routine', 'Alter Routine']) {
    assert.throws(() => grantsOf([{ User: 'skynest_app', Host: 'localhost', Proc_priv: value }]));
  }
  assert.throws(() => grantsOf([...sampleGrants, sampleGrants[0]]));
  assert.throws(() => grantsOf([{ User: 'bad`name', Host: 'localhost', Proc_priv: 'Execute' }]));
  for (const options of [
    { backendStopped: false }, { config: { database: 'SkyNest_Hotels' } }, { config: { host: 'example.com' } },
    { config: { user: 'skynest_app' } }, { identity: { currentUser: 'root@otherhost' } }, { identity: { activeRoles: '`manager`@`%`' } },
    { identity: { mandatoryRoles: 'anything' } }, { identity: { lowerCaseTableNames: '01' } }, { identity: { databaseName: TARGET_DATABASE.toLowerCase(), lowerCaseTableNames: '0' } },
    { identity: { databaseCollation: 'utf8mb4_general_ci' } }, { lock: 0 }, { lock: true },
    { edit: states => states.delete(PROCEDURES[5]) }, { grants: [] }, { grantReadFail: true },
    { edit: states => states.get(PROCEDURES[5])['Create Procedure'] += '\nSELECT 123' },
    { edit: states => states.get(PROCEDURES[5])['Create Procedure'] = states.get(PROCEDURES[5])['Create Procedure'].replace('`root`', '`other`') },
    { grants: [{ User: 'skynest_app', Host: 'localhost', Proc_priv: 'Execute,Grant' }] },
  ]) { const f = await rejected(options); assert.equal(writes(f).length, 0); assert.equal(f.saved(), undefined); }
  for (const options of [{ backupFail: true }, { backupPath: 'inside.json' }, { contextFail: true }]) {
    const f = await rejected(options); assert.equal(writes(f).length, 0);
  }
  for (const options of [{}, { autoRoot: true }, { grants: [...sampleGrants, { User: 'root', Host: 'localhost', Proc_priv: 'Execute' }], autoRoot: true },
    { identity: { lowerCaseTableNames: '1', databaseName: TARGET_DATABASE.toLowerCase() }, lock: '1' },
    { identity: { lowerCaseTableNames: 2, databaseName: TARGET_DATABASE.toLowerCase() } }]) {
    const f = fixture(options); const result = await f.run();
    assert.equal(result.status, 'updated'); assert.deepEqual(result.updated, PROCEDURES);
    assert.ok(f.events.findIndex(e => e.sql === 'BACKUP') < f.events.findIndex(e => e.sql.startsWith('DROP PROCEDURE')));
    const firstDDL = f.events.findIndex(e => e.sql.startsWith('DROP PROCEDURE'));
    for (const name of PROCEDURES) {
      assert.ok(f.events.slice(0, firstDDL).some(e => e.sql.includes('SHOW CREATE') && e.sql.endsWith('`' + name + '`')));
      assert.ok(f.events.slice(0, firstDDL).some(e => e.sql.includes('mysql.procs_priv') && e.values[1] === name));
      assert.deepEqual(normalized(f.grants.get(name)), normalized(options.grants || sampleGrants));
      assert.match(f.states.get(name)['Create Procedure'], /DEFINER=`root`@`localhost`/);
    }
    assert.deepEqual(f.saved().objects[PROCEDURES[0]].grants, normalized(options.grants || sampleGrants));
  }
  const current = fixture({ current: true }); assert.equal((await current.run()).status, 'unchanged'); assert.equal(writes(current).length, 0); assert.equal(current.saved(), undefined);
  // Independent SHOW CREATE formatting variant: bare keyword case can vary,
  // Windows table names can fold, but quoted message literals must stay exact.
  const serverFormatted = fixture({ current: true, identity: {
    lowerCaseTableNames: '1', databaseName: TARGET_DATABASE.toLowerCase(),
  }, edit: states => {
    const target = states.get('sp_check_in');
    target['Create Procedure'] = target['Create Procedure']
      .replace('LEFT JOIN ROOM r', 'left join `room` r')
      .replace('SELECT br.BookedRoomID', 'select br.BookedRoomID')
      .replace('FROM BOOKED_ROOMS br', 'from `booked_rooms` br');
  } });
  assert.equal((await serverFormatted.run()).status, 'unchanged');
  assert.equal(writes(serverFormatted).length, 0);
  const changedLiteral = await rejected({ current: true, edit: states => {
    const target = states.get('sp_check_in');
    target['Create Procedure'] = target['Create Procedure'].replace("'Booking not found.'", "'booking not found.'");
  } }, /differs from the reviewed definitions/);
  assert.equal(writes(changedLiteral).length, 0);
  assert.notEqual(canonicalSql("SELECT 'LEFT'"), canonicalSql("SELECT 'left'"));
  assert.notEqual(canonicalSql('SELECT `LEFT`'), canonicalSql('SELECT `left`'));

  const mixed = fixture({ mixed: true }); assert.equal((await mixed.run()).updated.length, 4);
  const drop = await rejected({ dropFail: true }, /original definition and grants remain/);
  assert.deepEqual(normalized(drop.grants.get('sp_check_in')), normalized(sampleGrants));
  for (const options of [{ createFail: true }, { dropFail: true, dropApplied: true }, { grantFail: true }, { createFail: true, createApplied: true }]) {
    const f = await rejected(options, /original definition and exact grants were restored/);
    assert.equal(f.states.get('sp_check_in')['Create Procedure'], row(reviewed[1], false)['Create Procedure']);
    assert.deepEqual(normalized(f.grants.get('sp_check_in')), normalized(sampleGrants));
  }
  const grantAck = fixture({ grants: [sampleGrants[0]], grantFail: true, grantApplied: true });
  assert.equal((await grantAck.run()).status, 'updated');
  await rejected({ grantAlwaysFails: true }, /restoration could not be confirmed/);
  const differentContext = fixture({ edit: states => { states.get('sp_check_out').sql_mode = 'NO_ENGINE_SUBSTITUTION'; } });
  await differentContext.run();
  assert.equal(differentContext.states.get('sp_check_out').sql_mode, 'NO_ENGINE_SUBSTITUTION');
  const acknowledged = fixture({ createFail: true, createApplied: true, createWithGrants: true });
  assert.equal((await acknowledged.run()).status, 'updated');
  const unknown = await rejected({ createFail: true, unreadable: true }, /outcome could not be verified/);
  assert.equal(unknown.events.filter(e => e.sql.startsWith('CREATE DEFINER') && e.sql.includes('PROCEDURE sp_check_in')).length, 1);
  await rejected({ createFail: true, unexpectedDefinition: true }, /outcome could not be verified/);
  await rejected({ createFail: true, restoreFail: true }, /restoration could not be confirmed/);
  await rejected({ release: 0 }, /Cleanup could not be confirmed/);
  assert.doesNotMatch(formatFailure(error('ER_PARSE_ERROR')), /PRIVATE/);
  assert.doesNotMatch(formatFailure(new Error('PRIVATE')), /PRIVATE/);
  assert.doesNotMatch(formatFailure(error('secret!credential')), /secret|credential/);
  const backup = backupObjects({ identity: { currentUser: 'root@localhost' }, objects: {} });
  assert.ok(path.isAbsolute(backup));
  assert.equal(JSON.parse(fs.readFileSync(backup, 'utf8')).database, TARGET_DATABASE);
  if (process.platform !== 'win32') { assert.equal(fs.statSync(backup).mode & 0o777, 0o600); assert.equal(fs.statSync(path.dirname(backup)).mode & 0o777, 0o700); }
  fs.rmSync(path.dirname(backup), { recursive: true });
  console.log('PASS: six-procedure old/current preflight, Windows target/maintenance gates, private backup, exact routine grant preservation, automatic creator privileges, idempotence/resume and inspected DDL/grant failure recovery (mock MySQL; no live database).');
})().catch(error => { console.error(error); process.exitCode = 1; });
