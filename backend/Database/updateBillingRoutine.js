// Stop the backend before running: node Database/updateBillingRoutine.js --backend-stopped
// MySQL routine DDL is not transactional. This replaces one recognized procedure
// in one integration database; it never creates/resets databases or writes data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TARGET_DATABASE = 'SkyNest_Integration_20261002';
const ROUTINE_NAME = 'sp_recalculate_bill';
const LOCK_NAME = `${TARGET_DATABASE}.${ROUTINE_NAME}`;
const QUALIFIED_ROUTINE = `\`${TARGET_DATABASE}\`.\`${ROUTINE_NAME}\``;
const OLD_ROUTINE = `CREATE PROCEDURE sp_recalculate_bill(IN p_booking_id INT)
proc_body: BEGIN
    DECLARE v_room_charges DECIMAL(10,2);
    DECLARE v_service_charges DECIMAL(10,2);
    DECLARE v_total DECIMAL(10,2);
    DECLARE v_balance DECIMAL(10,2);

    SET v_room_charges    = fn_calculate_room_charges(p_booking_id);
    SET v_service_charges = fn_calculate_service_charges(p_booking_id);
    SET v_total = v_room_charges + v_service_charges;
    SET v_balance = v_total - (SELECT IFNULL(SUM(Amount),0) FROM PAYMENT WHERE BookingID = p_booking_id);

    UPDATE BILL
    SET RoomCharges = v_room_charges,
        ServiceCharges = v_service_charges,
        TotalAmount = v_total,
        BillStatus = CASE WHEN v_balance <= 0 THEN 'Paid'
                          WHEN v_balance < v_total THEN 'Partially Paid'
                          ELSE 'Unpaid' END
    WHERE BookingID = p_booking_id;
END`;
const SNAPSHOT_READ = `SELECT RoomCharges INTO v_room_charges
    FROM BILL WHERE BookingID = p_booking_id FOR UPDATE;
    IF v_room_charges IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No bill exists yet for this booking.';
    END IF;`;
const NEW_ROUTINE = OLD_ROUTINE
  .replace('SET v_room_charges    = fn_calculate_room_charges(p_booking_id);', SNAPSHOT_READ)
  .replace('SET RoomCharges = v_room_charges,\n        ServiceCharges', 'SET ServiceCharges');

function targetDatabase(value) {
  if (value !== TARGET_DATABASE) throw new Error(`DB_NAME must be exactly ${TARGET_DATABASE}. Nothing was changed.`);
  return value;
}

// Tokenize rather than globally lowercasing/collapsing whitespace: string values
// and quoted identifiers must retain their meaning when rejecting routine drift.
function canonicalSql(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('The routine definition is not visible. Nothing was changed.');
  const tokens = [];
  const keywords = new Set('CREATE PROCEDURE IN INT BEGIN DECLARE DECIMAL SET SELECT INTO FROM WHERE FOR UPDATE IF IS NULL THEN SIGNAL SQLSTATE END CASE WHEN ELSE'.split(' '));
  const pattern = /\s+|--(?=\s)[^\r\n]*|'(?:''|[^'])*'|`(?:``|[^`])*`|[A-Za-z_][A-Za-z_0-9]*|\d+|[(),;:=<>+*.\/-]/gy;
  let index = 0;
  while (index < sql.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(sql);
    if (!match) throw new Error('Unrecognized SQL in the routine definition. Nothing was changed.');
    const token = match[0];
    index = pattern.lastIndex;
    if (/^\s|^--/.test(token)) continue;
    if (token.startsWith("'")) tokens.push(token);
    else if (token.startsWith('`')) tokens.push(token.slice(1, -1).replace(/``/g, '`'));
    else tokens.push(keywords.has(token.toUpperCase()) ? token.toUpperCase() : token);
  }
  return tokens.join(' ');
}

function visibleDefinition(row) {
  const sql = row?.['Create Procedure'];
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('SHOW CREATE did not return a visible routine definition. Nothing was changed.');
  const header = /^CREATE\s+DEFINER\s*=\s*`((?:``|[^`])+)`@`((?:``|[^`])+)`\s+(?=PROCEDURE\b)/i.exec(sql);
  if (!header) throw new Error('Unrecognized routine definer. Nothing was changed.');
  const portable = `CREATE ${sql.slice(header[0].length)}`;
  return { sql, portable, header: header[0], definer: `${header[1].replace(/``/g, '`')}@${header[2].replace(/``/g, '`')}` };
}

function currentSchemaRoutine() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const matches = [...schema.matchAll(/^CREATE PROCEDURE sp_recalculate_bill\(IN p_booking_id INT\)\r?\n[\s\S]*?^END \/\//gm)];
  if (matches.length !== 1) throw new Error('schema.sql must contain exactly one expected billing routine. Nothing was changed.');
  const routine = matches[0][0].replace(/\s+\/\/$/, '');
  if (canonicalSql(routine) !== canonicalSql(NEW_ROUTINE)) throw new Error('schema.sql does not match the reviewed billing routine. Nothing was changed.');
  return routine;
}

function safeCode(error) {
  return /^[A-Z0-9_]+$/.test(error?.code || '') ? ` (${error.code})` : '';
}

function backupRoutine(row) {
  // os.tmpdir() also supports the Windows development setup. The private backup
  // is outside this project; it contains SQL/context, never connection secrets.
  const tempRoot = fs.realpathSync(os.tmpdir());
  const projectRoot = fs.realpathSync(path.join(__dirname, '..', '..'));
  const relative = path.relative(projectRoot, tempRoot);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('The system temporary directory must be outside this project. Nothing was changed.');
  }
  const directory = fs.mkdtempSync(path.join(tempRoot, 'skynest-billing-routine-'));
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, 'original-routine.json');
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ database: TARGET_DATABASE, routine: ROUTINE_NAME,
      backedUpAt: new Date().toISOString(), showCreate: row }, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

async function readRoutine(connection) {
  try {
    const [rows] = await connection.query(`SHOW CREATE PROCEDURE ${QUALIFIED_ROUTINE}`);
    if (rows.length !== 1) throw new Error('SHOW CREATE did not return exactly one routine.');
    return rows[0];
  } catch (error) {
    if (error.code === 'ER_SP_DOES_NOT_EXIST' || error.errno === 1305) return null;
    throw error;
  }
}

function contextValues(row) {
  const values = [row.sql_mode, row.character_set_client, row.collation_connection];
  if (typeof values[0] !== 'string' || !/^[A-Z0-9_,]*$/i.test(values[0]) ||
      !values.slice(1).every(value => typeof value === 'string' && /^[A-Z0-9_]+$/i.test(value))) {
    throw new Error('Unrecognized routine creation context. Nothing was changed.');
  }
  return values;
}

async function migrateBillingRoutine({ connection, database, backendStopped, writeBackup = backupRoutine }) {
  targetDatabase(database);
  if (backendStopped !== true) throw new Error('Stop the backend, then pass --backend-stopped. MySQL DROP/CREATE routine DDL is not atomic. Nothing was changed.');
  const desired = currentSchemaRoutine();
  const [[identity]] = await connection.query('SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser, @@collation_database AS databaseCollation, @@lower_case_table_names AS lowerCaseTableNames');
  if (![0, 1, 2].includes(identity?.lowerCaseTableNames)) {
    throw new Error('The server database-name comparison setting could not be verified. Nothing was changed.');
  }
  // Windows commonly returns the selected database in lowercase. Follow the
  // server's identifier rules, while retaining exact matching on case-sensitive
  // hosts and the exact configured target checked above. Never change the server
  // setting or accept another integration database to get past this check.
  const caseInsensitiveNames = identity.lowerCaseTableNames !== 0;
  const selectedDatabase = identity.databaseName;
  const matchesTarget = typeof selectedDatabase === 'string' && /^[A-Za-z0-9_]+$/.test(selectedDatabase) && (caseInsensitiveNames
    ? selectedDatabase.toLowerCase() === TARGET_DATABASE.toLowerCase()
    : selectedDatabase === TARGET_DATABASE);
  if (!matchesTarget) {
    throw new Error(`The selected database does not match the permitted integration database (selected: ${JSON.stringify(selectedDatabase ?? null)}, lower_case_table_names: ${identity.lowerCaseTableNames}). Nothing was changed.`);
  }
  const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
  if (Number(lock?.acquired) !== 1) throw new Error('Another billing routine update holds the migration lock. Nothing was changed.');
  let backupPath;
  try {
    const original = await readRoutine(connection);
    if (!original) throw new Error('The existing billing routine is missing. Nothing was changed.');
    const live = visibleDefinition(original);
    const liveCanonical = canonicalSql(live.portable);
    if (liveCanonical === canonicalSql(NEW_ROUTINE)) return { status: 'unchanged' };
    if (liveCanonical !== canonicalSql(OLD_ROUTINE)) throw new Error('The live billing routine differs from the recognized original. Nothing was changed.');
    if (live.definer !== identity.currentUser) throw new Error('Run this update as the existing routine definer; changing its security identity is not permitted. Nothing was changed.');
    if (/[^\x00-\x7f]/.test(live.sql)) throw new Error('A non-ASCII routine definition requires a separately reviewed character-set update. Nothing was changed.');
    if (original['Database Collation'] !== identity.databaseCollation) throw new Error('The database collation differs from the routine creation context. Nothing was changed.');
    const context = contextValues(original);
    // DROP PROCEDURE removes routine-specific grants. Do not silently discard
    // them; deployments using those grants require a separately reviewed update.
    // Grant-table database names can also be lowercase. Apply case folding only
    // when the server treats those names as the same database, so an existing
    // routine grant cannot be missed before DROP removes it.
    const [grants] = await connection.execute(
      caseInsensitiveNames
        ? 'SELECT User, Host, Proc_priv FROM mysql.procs_priv WHERE LOWER(Db) = ? AND Routine_name = ? AND Routine_type = ?'
        : 'SELECT User, Host, Proc_priv FROM mysql.procs_priv WHERE Db = ? AND Routine_name = ? AND Routine_type = ?',
      [caseInsensitiveNames ? TARGET_DATABASE.toLowerCase() : TARGET_DATABASE, ROUTINE_NAME, 'PROCEDURE']);
    if (grants.length) throw new Error('Routine-specific grants exist. Refusing to replace them automatically. Nothing was changed.');
    backupPath = await writeBackup(original);
    if (typeof backupPath !== 'string' || !path.isAbsolute(backupPath)) throw new Error('A complete external routine backup is required. Nothing was changed.');
    // All context validation/setting happens before DROP, and the original
    // DEFINER prefix is preserved byte for byte in the replacement.
    await connection.query('SET SESSION sql_mode = ?, character_set_client = ?, collation_connection = ?', context);
    const replacement = live.header + desired.slice('CREATE '.length);
    try {
      await connection.query(`DROP PROCEDURE ${QUALIFIED_ROUTINE}`);
      await connection.query(replacement);
      const installed = await readRoutine(connection);
      const verified = visibleDefinition(installed);
      if (canonicalSql(verified.portable) !== canonicalSql(NEW_ROUTINE) || verified.definer !== live.definer) {
        throw new Error('The replacement routine could not be verified.');
      }
      return { status: 'updated', backupPath };
    } catch (failure) {
      // A connection error can lose the CREATE acknowledgement after success.
      // Inspect before restoring; never DROP a possibly successful replacement.
      let observed;
      try { observed = await readRoutine(connection); }
      catch (_) {
        throw new Error(`Routine update outcome could not be inspected${safeCode(failure)}. Keep the backend stopped and inspect/recover using ${backupPath}.`);
      }
      if (observed) {
        let observedDefinition;
        let observedCanonical;
        try {
          observedDefinition = visibleDefinition(observed);
          observedCanonical = canonicalSql(observedDefinition.portable);
        }
        catch (_) { /* An unexpected definition must not be overwritten. */ }
        if (observedDefinition?.definer === live.definer) {
          if (observedCanonical === canonicalSql(NEW_ROUTINE)) return { status: 'updated', backupPath, reconciled: true };
          if (observedCanonical === canonicalSql(OLD_ROUTINE)) throw new Error(`Update failed${safeCode(failure)}; the original routine remains installed. Backup: ${backupPath}.`);
        }
        throw new Error(`An unexpected routine remains after the failed update. Keep the backend stopped; nothing further was overwritten. Backup: ${backupPath}.`);
      }
      try {
        await connection.query(original['Create Procedure']);
        const restored = visibleDefinition(await readRoutine(connection));
        if (restored.definer !== live.definer || canonicalSql(restored.portable) !== canonicalSql(OLD_ROUTINE)) {
          throw new Error('Restoration could not be verified.');
        }
      } catch (restoreError) {
        throw new Error(`Update failed and original routine restoration could not be confirmed${safeCode(restoreError)}. Keep the backend stopped and recover from ${backupPath}.`);
      }
      throw new Error(`Update failed${safeCode(failure)}; the original routine was restored and verified. Backup: ${backupPath}.`);
    }
  } finally {
    // Connection closure also releases this lock. Do not hide a recovery result
    // if a broken connection cannot explicitly release it.
    try { await connection.execute('SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); } catch (_) { /* Closed below. */ }
  }
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const database = targetDatabase(process.env.DB_NAME);
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--backend-stopped') {
    throw new Error('Stop the backend, then run: node Database/updateBillingRoutine.js --backend-stopped');
  }
  if (process.env.DB_PASSWORD === 'replace-with-your-local-mysql-password') throw new Error('Set the local MySQL password in backend/.env first.');
  let connection;
  try {
    connection = await require('mysql2/promise').createConnection({
      host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
      database, multipleStatements: false,
    });
    const result = await migrateBillingRoutine({ connection, database, backendStopped: true });
    console.log(result.status === 'unchanged' ? 'Billing routine is already current. Nothing was changed.' : 'Billing routine updated and verified. Existing bills keep their recorded room charges.');
    if (result.backupPath) console.log(`Original routine backup: ${result.backupPath}`);
    console.log('The backend may now be restarted. No booking, bill, service or payment rows were changed.');
  } finally {
    if (connection) await connection.end();
  }
}

if (require.main === module) main().catch(error => {
  // Driver error messages can include connection details. Only our reviewed
  // messages or a driver code are printed, never credentials or raw SQL errors.
  console.error(error.code ? `Billing routine update failed${safeCode(error)}. No automatic retry was attempted; keep the backend stopped until the routine is inspected.` : error.message);
  process.exitCode = 1;
});

module.exports = { TARGET_DATABASE, OLD_ROUTINE, NEW_ROUTINE, canonicalSql, currentSchemaRoutine,
  targetDatabase, visibleDefinition, backupRoutine, migrateBillingRoutine };
