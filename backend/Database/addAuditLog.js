// Existing integration database only. Stop every backend using it before this
// installer; MySQL table/trigger/routine DDL cannot be rolled back as one unit.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projectStatements } = require('./setupIntegrationDb');

const TARGET_DATABASE = 'SkyNest_Integration_20261002';
const LOCK_NAME = `${TARGET_DATABASE}.audit-log`;
const PROCEDURES = ['sp_check_in', 'sp_check_out', 'sp_process_payment', 'sp_log_service_usage'];
const TRIGGERS = ['trg_audit_log_no_update', 'trg_audit_log_no_delete'];
const TABLE_NAMES = new Set(['AUDIT_LOG', 'BOOKING', 'BOOKED_ROOMS', 'ROOM', 'ROOM_TYPE',
  'BILL', 'PAYMENT', 'SERVICE_CATALOGUE', 'SERVICE_USAGE', 'STAFF', 'GUEST']);
const KEYWORDS = new Set(`CREATE PROCEDURE TRIGGER BEFORE AFTER UPDATE INSERT DELETE ON FOR EACH ROW
BEGIN END DECLARE INT BIGINT DATETIME VARCHAR DEFAULT NULL IF THEN ELSE ELSEIF SELECT COUNT SUM
INTO FROM JOIN WHERE AND OR NOT IN IS AS SET SIGNAL SQLSTATE MESSAGE_TEXT START TRANSACTION
COMMIT ROLLBACK RESIGNAL EXIT HANDLER SQLEXCEPTION LIMIT ORDER BY SHARE OF DATE CURDATE
IFNULL COALESCE NEW OLD DECIMAL CASE WHEN VALUES JSON_OBJECT JSON CHAR CAST EXISTS UNSIGNED
CURRENT_TIMESTAMP LAST_INSERT_ID SQL SECURITY DEFINER READS MODIFIES DATA DETERMINISTIC`.split(/\s+/));
const qualified = name => `\`${TARGET_DATABASE}\`.\`${name}\``;

function canonicalSql(sql, foldNames = false) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('A database object definition is not visible.');
  const tokens = [];
  const pattern = /\s+|--(?=\s)[^\r\n]*|'(?:''|\\.|[^'\\])*'|`(?:``|[^`])*`|[A-Za-z_][A-Za-z_0-9]*|\d+|[(),;:=<>!+*.\/-]/gy;
  let index = 0;
  while (index < sql.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(sql);
    if (!match) throw new Error('Unrecognized SQL in a database object definition.');
    const token = match[0];
    index = pattern.lastIndex;
    if (/^\s|^--/.test(token)) continue;
    if (token.startsWith("'")) { tokens.push(token); continue; }
    const identifier = token.startsWith('`') ? token.slice(1, -1).replace(/``/g, '`') : token;
    const upper = identifier.toUpperCase();
    tokens.push(foldNames && TABLE_NAMES.has(upper) ? upper :
      (!token.startsWith('`') && KEYWORDS.has(upper) ? upper : identifier));
  }
  return tokens.join(' ');
}

function definitions() {
  const current = projectStatements(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const before = projectStatements(fs.readFileSync(path.join(__dirname, 'migrations', '002_audit_before.sql'), 'utf8'));
  function exactly(statements, type, name) {
    const matches = statements.filter(sql => new RegExp(`^CREATE ${type} ${name}\\b`).test(sql));
    if (matches.length !== 1) throw new Error(`Expected exactly one reviewed ${name} definition. Nothing was changed.`);
    return matches[0];
  }
  return {
    table: exactly(current, 'TABLE', 'AUDIT_LOG'),
    triggers: TRIGGERS.map(name => ({ type: 'TRIGGER', name, sql: exactly(current, 'TRIGGER', name) })),
    procedures: PROCEDURES.map(name => ({ type: 'PROCEDURE', name,
      sql: exactly(current, 'PROCEDURE', name), before: exactly(before, 'PROCEDURE', name) })),
  };
}

function contextValues(row) {
  const values = [row.sql_mode, row.character_set_client, row.collation_connection];
  if (typeof values[0] !== 'string' || !/^[A-Z0-9_,]*$/i.test(values[0]) ||
      !values.slice(1).every(value => typeof value === 'string' && /^[A-Z0-9_]+$/i.test(value))) {
    throw new Error('Unrecognized SQL creation context. Nothing was changed.');
  }
  return values;
}

function visibleDefinition(row, type) {
  const sql = row?.[type === 'TRIGGER' ? 'SQL Original Statement' : 'Create Procedure'];
  const header = /^CREATE\s+DEFINER\s*=\s*`((?:``|[^`])+)`@`((?:``|[^`])+)`\s+/i.exec(sql || '');
  if (!header || !new RegExp(`^${type}\\b`, 'i').test(sql.slice(header[0].length))) {
    throw new Error('Cannot verify an object definition and its definer. Nothing was changed.');
  }
  return { sql, header: header[0], portable: 'CREATE ' + sql.slice(header[0].length),
    definer: `${header[1].replace(/``/g, '`')}@${header[2].replace(/``/g, '`')}` };
}

async function readObject(connection, object) {
  try {
    const [rows] = await connection.query(`SHOW CREATE ${object.type} ${qualified(object.name)}`);
    if (rows.length !== 1) throw new Error(`Cannot read ${object.name} uniquely.`);
    return rows[0];
  } catch (error) {
    if ((object.type === 'PROCEDURE' && error.code === 'ER_SP_DOES_NOT_EXIST') ||
        (object.type === 'TRIGGER' && error.code === 'ER_TRG_DOES_NOT_EXIST')) return null;
    throw error;
  }
}

function objectState(row, object, foldNames) {
  if (!row) return 'missing';
  const live = canonicalSql(visibleDefinition(row, object.type).portable, foldNames);
  if (live === canonicalSql(object.sql, foldNames)) return 'current';
  if (object.before && live === canonicalSql(object.before, foldNames)) return 'before';
  throw new Error(`${object.name} differs from the reviewed definitions. Nothing further was changed.`);
}

function backupObjects(snapshot) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const projectRoot = fs.realpathSync(path.join(__dirname, '..', '..'));
  const relative = path.relative(projectRoot, tempRoot);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('The system temporary directory must be outside this project. Nothing was changed.');
  }
  const directory = fs.mkdtempSync(path.join(tempRoot, 'skynest-audit-migration-'));
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, 'original-objects.json');
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify({ database: TARGET_DATABASE,
      backedUpAt: new Date().toISOString(), ...snapshot }, null, 2) + '\n');
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  return file;
}

function safeCode(error) {
  return /^[A-Z0-9_]+$/.test(error?.code || '') ? ` (${error.code})` : '';
}

async function replaceProcedure(connection, object, original, foldNames, backupPath) {
  const live = visibleDefinition(original, 'PROCEDURE');
  const context = contextValues(original);
  await connection.query('SET SESSION sql_mode = ?, character_set_client = ?, collation_connection = ?', context);
  try {
    await connection.query(`DROP PROCEDURE ${qualified(object.name)}`);
    await connection.query(live.header + object.sql.slice('CREATE '.length));
    const installed = await readObject(connection, object);
    if (objectState(installed, object, foldNames) !== 'current' ||
        visibleDefinition(installed, 'PROCEDURE').definer !== live.definer ||
        JSON.stringify(contextValues(installed)) !== JSON.stringify(context) ||
        installed['Database Collation'] !== original['Database Collation']) {
      throw new Error('Replacement verification failed.');
    }
  } catch (failure) {
    // A transport failure may lose an acknowledgement after CREATE succeeded.
    // Inspect once before any restoration; never blindly drop an observed object.
    let observed;
    try { observed = await readObject(connection, object); }
    catch { throw new Error(`${object.name} update outcome could not be inspected${safeCode(failure)}. Keep the backend stopped; recover using ${backupPath}.`); }
    if (observed) {
      let state;
      try {
        if (visibleDefinition(observed, 'PROCEDURE').definer === live.definer &&
            JSON.stringify(contextValues(observed)) === JSON.stringify(context) &&
            observed['Database Collation'] === original['Database Collation']) state = objectState(observed, object, foldNames);
      } catch { /* Unknown objects must not be overwritten. */ }
      if (state === 'current') return;
      if (state === 'before') throw new Error(`${object.name} update failed${safeCode(failure)}; its original remains installed. Other objects may already be updated. Keep the backend stopped. Backup: ${backupPath}.`);
      throw new Error(`Unexpected ${object.name} after failed replacement; nothing further was overwritten. Keep the backend stopped. Backup: ${backupPath}.`);
    }
    // The connection is responding and the procedure is confirmed absent.
    // Restore exactly the backed-up original, never synthesize a new definition.
    try {
      await connection.query(original['Create Procedure']);
      const restored = await readObject(connection, object);
      if (objectState(restored, object, foldNames) !== 'before' ||
          visibleDefinition(restored, 'PROCEDURE').definer !== live.definer ||
          JSON.stringify(contextValues(restored)) !== JSON.stringify(context) ||
          restored['Database Collation'] !== original['Database Collation']) throw new Error('Restoration verification failed.');
    } catch (restoreError) {
      throw new Error(`${object.name} restoration could not be confirmed${safeCode(restoreError)}. Keep the backend stopped and recover from ${backupPath}.`);
    }
    throw new Error(`${object.name} update failed${safeCode(failure)}; its original was restored and verified. Other objects may already be updated. Keep the backend stopped. Backup: ${backupPath}.`);
  }
}

// Table structure checks are deliberately independent of SHOW CREATE whitespace,
// identifier quoting, and the Windows table-name case representation.
// The contract is kept explicit so an unrelated AUDIT_LOG is never adopted.
const EXPECTED_COLUMNS = [
  ['AuditID', 'bigint unsigned', 'NO', null, 'auto_increment'],
  ['OperationID', 'char(36)', 'NO', null, ''],
  ['ActorType', "enum('staff','guest')", 'NO', null, ''],
  ['StaffID', 'int', 'YES', null, ''],
  ['GuestID', 'int', 'YES', null, ''],
  ['BookingID', 'int', 'NO', null, ''],
  ['Action', 'varchar(64)', 'NO', null, ''],
  ['TableAffected', 'varchar(32)', 'NO', null, ''],
  ['RecordID', 'int', 'NO', null, ''],
  ['OldValues', 'json', 'YES', null, ''],
  ['NewValues', 'json', 'NO', null, ''],
  ['Details', 'varchar(255)', 'NO', null, ''],
  ['CreatedAt', 'datetime(6)', 'NO', 'current_timestamp(6)', 'default_generated'],
];
const EXPECTED_INDEXES = {
  PRIMARY: ['AuditID'], idx_audit_booking_created: ['BookingID', 'CreatedAt', 'AuditID'],
  idx_audit_staff_created: ['StaffID', 'CreatedAt'], idx_audit_operation: ['OperationID'],
};
const EXPECTED_CHECK = "(ActorType = 'staff' AND StaffID IS NOT NULL AND GuestID IS NULL) OR (ActorType = 'guest' AND GuestID IS NOT NULL AND StaffID IS NULL)";

// Parse the small permitted CHECK expression instead of erasing parentheses.
// MySQL SHOW/metadata may add parentheses, quotes and literal charset introducers.
function checkTree(expression) {
  // INFORMATION_SCHEMA.CHECK_CONSTRAINTS can escape the literal delimiters.
  // Accept only the two reviewed, introduced actor literals in that form;
  // never unescape arbitrary SQL or change the general definition comparator.
  const source = expression
    .replace(/\b_utf8mb4\\'(staff|guest)\\'/gi, "'$1'")
    .replace(/_utf8mb4(?=')/gi, '');
  const tokens = canonicalSql(source).split(' ');
  let offset = 0;
  const peek = word => tokens[offset]?.toUpperCase() === word;
  const take = word => { if (!peek(word)) throw new Error('Unrecognized audit CHECK constraint.'); offset++; };
  function term() {
    if (peek('(')) { offset++; const tree = or(); take(')'); return tree; }
    const field = tokens[offset++];
    if (!['ActorType', 'StaffID', 'GuestID'].includes(field)) throw new Error('Unrecognized audit CHECK field.');
    if (peek('=')) { offset++; const value = tokens[offset++]; if (!["'staff'", "'guest'"].includes(value)) throw new Error('Unrecognized audit CHECK value.'); return ['=', field, value]; }
    take('IS'); const negated = peek('NOT'); if (negated) offset++; take('NULL');
    return [negated ? 'IS NOT NULL' : 'IS NULL', field];
  }
  function and() { let tree = term(); while (peek('AND')) { offset++; tree = ['AND', tree, term()]; } return tree; }
  function or() { let tree = and(); while (peek('OR')) { offset++; tree = ['OR', tree, and()]; } return tree; }
  const result = or();
  if (offset !== tokens.length) throw new Error('Unrecognized audit CHECK suffix.');
  return JSON.stringify(result);
}

async function readTable(connection) {
  const [tables] = await connection.query("SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'audit_log'");
  if (!tables.length) return null;
  if (tables.length !== 1) throw new Error('AUDIT_LOG cannot be identified uniquely. Nothing was changed.');
  const [columns] = await connection.query("SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, GENERATION_EXPRESSION, COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'audit_log' ORDER BY ORDINAL_POSITION");
  const [indexes] = await connection.query("SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, COLLATION, INDEX_TYPE, IS_VISIBLE, EXPRESSION FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = 'audit_log' ORDER BY INDEX_NAME, SEQ_IN_INDEX");
  const [foreignKeys] = await connection.query(`SELECT k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME,
    k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
    JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
      AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.TABLE_SCHEMA = DATABASE() AND LOWER(k.TABLE_NAME) = 'audit_log' AND k.REFERENCED_TABLE_NAME IS NOT NULL
    ORDER BY k.COLUMN_NAME`);
  const [checks] = await connection.query(`SELECT t.CONSTRAINT_NAME, t.ENFORCED, c.CHECK_CLAUSE
    FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS t JOIN INFORMATION_SCHEMA.CHECK_CONSTRAINTS c
      ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME
    WHERE t.TABLE_SCHEMA = DATABASE() AND LOWER(t.TABLE_NAME) = 'audit_log' AND t.CONSTRAINT_TYPE = 'CHECK'`);
  const [triggers] = await connection.query("SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND LOWER(EVENT_OBJECT_TABLE) = 'audit_log'");
  const [rows] = await connection.query(`SHOW CREATE TABLE ${qualified('AUDIT_LOG')}`);
  if (rows.length !== 1 || typeof rows[0]['Create Table'] !== 'string') throw new Error('The audit table definition is not visible.');
  return { ...tables[0], columns, indexes, foreignKeys, checks, triggers, showCreate: rows[0] };
}

class AuditTableStructureError extends Error {
  constructor(section) {
    super(`Existing AUDIT_LOG structure differs from the reviewed audit table (${section}). Nothing was overwritten.`);
  }
}

function verifyTable(table, foldNames) {
  const fail = section => { throw new AuditTableStructureError(section); };
  const sameName = (a, b) => typeof a === 'string' && (foldNames ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!table || !sameName(table.TABLE_NAME, 'AUDIT_LOG') || table.TABLE_TYPE !== 'BASE TABLE' ||
      table.ENGINE !== 'InnoDB' || table.TABLE_COLLATION !== 'utf8mb4_unicode_ci' ||
      table.columns.length !== EXPECTED_COLUMNS.length) fail('table properties or column count');
  table.columns.forEach((column, index) => {
    const [name, type, nullable, defaultValue, extra] = EXPECTED_COLUMNS[index];
    const actualType = column.COLUMN_TYPE?.replace(/^int\(11\)$/, 'int').replace(/^bigint\(20\) unsigned$/, 'bigint unsigned');
    if (column.COLUMN_NAME !== name || actualType !== type || column.IS_NULLABLE !== nullable ||
        (typeof column.COLUMN_DEFAULT === 'string' ? column.COLUMN_DEFAULT.toLowerCase() : column.COLUMN_DEFAULT) !== defaultValue ||
        column.EXTRA?.toLowerCase() !== extra || column.GENERATION_EXPRESSION !== '' ||
        column.COLLATION_NAME !== (/^(char|varchar|enum)/.test(type) ? 'utf8mb4_unicode_ci' : null)) fail('column definition');
  });
  const indexes = new Map();
  for (const index of table.indexes) {
    if (!indexes.has(index.INDEX_NAME)) indexes.set(index.INDEX_NAME, []);
    const entries = indexes.get(index.INDEX_NAME);
    if (Number(index.SEQ_IN_INDEX) !== entries.length + 1 || index.SUB_PART !== null || index.COLLATION !== 'A' ||
        index.INDEX_TYPE !== 'BTREE' || index.IS_VISIBLE !== 'YES' || index.EXPRESSION !== null ||
        Number(index.NON_UNIQUE) !== (index.INDEX_NAME === 'PRIMARY' ? 0 : 1)) fail('index properties');
    entries.push(index.COLUMN_NAME);
  }
  for (const [name, columns] of Object.entries(EXPECTED_INDEXES)) {
    if (JSON.stringify(indexes.get(name)) !== JSON.stringify(columns)) fail('required index columns');
    indexes.delete(name);
  }
  // InnoDB creates one additional index for the GuestID foreign key.
  if (indexes.size !== 1 || JSON.stringify([...indexes.values()][0]) !== JSON.stringify(['GuestID'])) fail('foreign-key support index');
  if (table.foreignKeys.length !== 3) fail('foreign-key count');
  for (const [column, target] of [['BookingID', 'BOOKING'], ['GuestID', 'GUEST'], ['StaffID', 'STAFF']]) {
    const keys = table.foreignKeys.filter(key => key.COLUMN_NAME === column);
    if (keys.length !== 1) fail('foreign-key column');
    const key = keys[0];
    if (!sameName(key.REFERENCED_TABLE_SCHEMA, TARGET_DATABASE) || !sameName(key.REFERENCED_TABLE_NAME, target) ||
        key.REFERENCED_COLUMN_NAME !== column || !['RESTRICT', 'NO ACTION'].includes(key.UPDATE_RULE) ||
        !['RESTRICT', 'NO ACTION'].includes(key.DELETE_RULE)) fail('foreign-key target or action');
  }
  if (table.checks.length !== 1 || table.checks[0].CONSTRAINT_NAME !== 'chk_audit_actor' || table.checks[0].ENFORCED !== 'YES') fail('CHECK name or enforcement');
  try { if (checkTree(table.checks[0].CHECK_CLAUSE) !== checkTree(EXPECTED_CHECK)) fail('actor CHECK expression'); } catch { fail('actor CHECK expression'); }
  if (table.triggers.some(trigger => !TRIGGERS.includes(trigger.TRIGGER_NAME))) fail('unexpected audit trigger');
}


async function installAuditLog({ connection, database, backendStopped, writeBackup = backupObjects, log = console.log }) {
  if (database !== TARGET_DATABASE) throw new Error(`DB_NAME must be exactly ${TARGET_DATABASE}. Nothing was changed.`);
  if (backendStopped !== true) throw new Error('Stop the backend, then pass --backend-stopped. Nothing was changed.');
  const reviewed = definitions();
  const [[identity]] = await connection.query(`SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser,
    @@collation_database AS databaseCollation, @@lower_case_table_names AS lowerCaseTableNames,
    @@sql_mode AS sql_mode, @@character_set_client AS character_set_client, @@collation_connection AS collation_connection`);
  if (![0, 1, 2].includes(identity?.lowerCaseTableNames)) throw new Error('Cannot verify server database identifier rules. Nothing was changed.');
  const foldNames = identity.lowerCaseTableNames !== 0;
  const selected = identity.databaseName;
  if (typeof selected !== 'string' || !/^[A-Za-z0-9_]+$/.test(selected) ||
      (foldNames ? selected.toLowerCase() !== TARGET_DATABASE.toLowerCase() : selected !== TARGET_DATABASE)) {
    throw new Error('The selected database is not the permitted integration database. Nothing was changed.');
  }
  if (typeof identity.currentUser !== 'string' || !identity.currentUser.includes('@')) throw new Error('Cannot verify the connected database identity. Nothing was changed.');
  if (identity.databaseCollation !== 'utf8mb4_unicode_ci') throw new Error('The database collation must match the reviewed utf8mb4_unicode_ci schema. Nothing was changed.');
  const newContext = contextValues(identity);
  const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
  if (Number(lock?.acquired) !== 1) throw new Error('Another audit installer holds the migration lock. Nothing was changed.');
  let backupPath;
  try {
    const table = await readTable(connection);
    if (table) verifyTable(table, foldNames);
    const states = new Map();
    const originals = {};
    // Read/validate ALL objects before any DDL, including the last procedure.
    for (const object of [...reviewed.triggers, ...reviewed.procedures]) {
      const original = await readObject(connection, object);
      const state = objectState(original, object, foldNames);
      if (object.type === 'PROCEDURE' && state === 'missing') throw new Error(`${object.name} is missing. Keep the backend stopped and recover its original definition before installing.`);
      if (original) {
        const live = visibleDefinition(original, object.type);
        contextValues(original);
        if (live.definer !== identity.currentUser) throw new Error(`Run this installer as the existing ${object.name} definer. Nothing was changed.`);
        if (/[^\x00-\x7f]/.test(live.sql)) throw new Error('A non-ASCII definition requires a separately reviewed character-set migration. Nothing was changed.');
        if (original['Database Collation'] !== identity.databaseCollation) throw new Error(`The database collation differs from ${object.name} creation context. Nothing was changed.`);
      }
      originals[object.name] = original;
      states.set(object.name, state);
    }
    if (!table && [...states.values()].some(state => state === 'current')) {
      throw new Error('Audit objects exist without the audit table. Inspect this inconsistent database before installing.');
    }
    for (const object of reviewed.procedures) {
      if (states.get(object.name) !== 'before') continue;
      const [grants] = await connection.execute(foldNames
        ? 'SELECT User, Host, Proc_priv FROM mysql.procs_priv WHERE LOWER(Db) = ? AND Routine_name = ? AND Routine_type = ?'
        : 'SELECT User, Host, Proc_priv FROM mysql.procs_priv WHERE Db = ? AND Routine_name = ? AND Routine_type = ?',
      [foldNames ? TARGET_DATABASE.toLowerCase() : TARGET_DATABASE, object.name, 'PROCEDURE']);
      if (grants.length) throw new Error(`Routine-specific grants exist on ${object.name}. Refusing to discard them. Nothing was changed.`);
    }
    const current = table && [...states.values()].every(state => state === 'current');
    if (current) return { status: 'unchanged', updated: [] };
    backupPath = await writeBackup({ identity, table, objects: originals });
    if (typeof backupPath !== 'string' || !path.isAbsolute(backupPath)) throw new Error('A complete external backup is required. Nothing was changed.');
    // Ensure all SQL contexts can be selected before the first DDL operation.
    for (const object of reviewed.procedures) {
      if (states.get(object.name) === 'before') await connection.query('SET SESSION sql_mode = ?, character_set_client = ?, collation_connection = ?', contextValues(originals[object.name]));
    }
    await connection.query('SET SESSION sql_mode = ?, character_set_client = ?, collation_connection = ?', newContext);
    const updated = [];
    if (!table) {
      try { await connection.query(reviewed.table); }
      catch (failure) {
        try { const observed = await readTable(connection); if (!observed) throw new Error('Absent'); verifyTable(observed, foldNames); }
        catch { throw new Error(`Audit table creation could not be confirmed${safeCode(failure)}. Nothing was dropped. Keep the backend stopped. Backup: ${backupPath}.`); }
      }
      verifyTable(await readTable(connection), foldNames);
      updated.push('AUDIT_LOG');
    }
    // Guards are installed before the application can write any audit entries.
    for (const object of reviewed.triggers) {
      if (states.get(object.name) === 'current') continue;
      try { await connection.query(object.sql); }
      catch (failure) {
        try { if (objectState(await readObject(connection, object), object, foldNames) !== 'current') throw new Error('Absent'); }
        catch { throw new Error(`${object.name} creation could not be confirmed${safeCode(failure)}. Keep the backend stopped. Backup: ${backupPath}.`); }
      }
      const installed = await readObject(connection, object);
      if (objectState(installed, object, foldNames) !== 'current' || visibleDefinition(installed, 'TRIGGER').definer !== identity.currentUser ||
          JSON.stringify(contextValues(installed)) !== JSON.stringify(newContext) || installed['Database Collation'] !== identity.databaseCollation) throw new Error(`Cannot verify ${object.name}. Keep the backend stopped. Backup: ${backupPath}.`);
      updated.push(object.name);
    }
    for (const object of reviewed.procedures) {
      if (states.get(object.name) === 'current') continue;
      await replaceProcedure(connection, object, originals[object.name], foldNames, backupPath);
      updated.push(object.name);
      log(`${object.name}: updated and verified.`);
    }
    verifyTable(await readTable(connection), foldNames);
    for (const object of [...reviewed.triggers, ...reviewed.procedures]) {
      if (objectState(await readObject(connection, object), object, foldNames) !== 'current') throw new Error(`Final verification failed for ${object.name}. Keep the backend stopped. Backup: ${backupPath}.`);
    }
    return { status: 'updated', updated, backupPath };
  } catch (error) {
    if (backupPath && !error.message.includes(backupPath)) {
      const detail = error instanceof AuditTableStructureError ? ` ${error.message}` : '';
      throw new Error(`Audit installation stopped${safeCode(error)}.${detail} Some objects may already be installed. Keep the backend stopped and inspect before retrying. Backup: ${backupPath}.`);
    }
    throw error;
  } finally {
    try { await connection.execute('SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); } catch { /* Connection closure releases it. */ }
  }
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  if (process.env.DB_NAME !== TARGET_DATABASE) throw new Error(`DB_NAME must be exactly ${TARGET_DATABASE}. Nothing was changed.`);
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--backend-stopped') throw new Error('Stop the backend, then run: node Database/addAuditLog.js --backend-stopped');
  const connection = await require('mysql2/promise').createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: TARGET_DATABASE, multipleStatements: false,
  });
  try {
    const result = await installAuditLog({ connection, database: process.env.DB_NAME, backendStopped: true });
    console.log(result.status === 'unchanged' ? 'Audit objects are already installed and verified.' : 'Audit objects installed and verified.');
    if (result.backupPath) console.log(`Original definitions backup: ${result.backupPath}`);
    console.log('No booking, bill, service, payment or existing audit rows were changed. Restart the backend using the matching audit code.');
  } finally { await connection.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(error.code ? `Audit installation failed${safeCode(error)}. Keep the backend stopped; inspect the database before retrying.` : error.message);
  process.exitCode = 1;
});
module.exports = { TARGET_DATABASE, PROCEDURES, TRIGGERS, canonicalSql, definitions, visibleDefinition,
  contextValues, readTable, verifyTable, checkTree, EXPECTED_COLUMNS, EXPECTED_INDEXES, EXPECTED_CHECK, backupObjects, installAuditLog };
