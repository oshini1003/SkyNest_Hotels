// Stop the backend first: node Database/addBookingUpdate.js --backend-stopped
// Adds and verifies missing booking-edit/check-in guards. No existing object is
// dropped/replaced, and no booking, bill, service or payment row is changed.
const fs = require('node:fs');
const path = require('node:path');
const { projectStatements } = require('./setupIntegrationDb');

const TARGET_DATABASE = 'SkyNest_Integration_20261002';
const LOCK_NAME = `${TARGET_DATABASE}.booking-update`;
// Install the check-in guard before exposing the booking-edit procedure.
const OBJECTS = [
  { type: 'TRIGGER', name: 'trg_validate_check_in_dates' },
  { type: 'TRIGGER', name: 'trg_prevent_overlap_booking_update' },
  { type: 'PROCEDURE', name: 'sp_update_booked_room' },
];

// Ignore formatting/comments, but preserve literals and case-sensitive names.
// SHOW CREATE quotes names and can lowercase Windows table names.
const KEYWORDS = new Set(`CREATE PROCEDURE TRIGGER BEFORE AFTER UPDATE INSERT ON FOR EACH ROW
BEGIN END DECLARE INT DATETIME VARCHAR DEFAULT NULL IF THEN ELSE ELSEIF SELECT COUNT SUM
INTO FROM JOIN WHERE AND OR NOT IN IS AS SET SIGNAL SQLSTATE MESSAGE_TEXT START TRANSACTION
COMMIT ROLLBACK RESIGNAL EXIT HANDLER SQLEXCEPTION LIMIT ORDER BY SHARE OF DATE CURDATE
IFNULL COALESCE NEW OLD`.split(/\s+/));
const TABLE_NAMES = new Set(['BOOKING', 'BOOKED_ROOMS', 'ROOM', 'ROOM_TYPE']);

function canonicalSql(sql, foldTableNames = false) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('A database object definition is not visible. Nothing was replaced.');
  const tokens = [];
  const pattern = /\s+|--(?=\s)[^\r\n]*|'(?:''|\\.|[^'\\])*'|`(?:``|[^`])*`|[A-Za-z_][A-Za-z_0-9]*|\d+|[(),;:=<>!+*.\/-]/gy;
  let index = 0;
  while (index < sql.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(sql);
    if (!match) throw new Error('Unrecognized SQL in a database object definition. Nothing was replaced.');
    const token = match[0];
    index = pattern.lastIndex;
    if (/^\s|^--/.test(token)) continue;
    if (token.startsWith("'")) { tokens.push(token); continue; }
    const identifier = token.startsWith('`') ? token.slice(1, -1).replace(/``/g, '`') : token;
    const upper = identifier.toUpperCase();
    if (foldTableNames && TABLE_NAMES.has(upper)) tokens.push(upper);
    else tokens.push(!token.startsWith('`') && KEYWORDS.has(upper) ? upper : identifier);
  }
  return tokens.join(' ');
}

function schemaObjects() {
  const statements = projectStatements(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return OBJECTS.map(object => {
    const definition = new RegExp(`^CREATE ${object.type} ${object.name}\\b`);
    const matches = statements.filter(sql => definition.test(sql));
    if (matches.length !== 1) throw new Error(`schema.sql must contain exactly one ${object.name} definition. Nothing was changed.`);
    return { ...object, sql: matches[0] };
  });
}

async function readObject(connection, object) {
  const [rows] = object.type === 'TRIGGER'
    ? await connection.execute('SELECT 1 FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?', [object.name])
    : await connection.execute("SELECT 1 FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_NAME = ?", [object.name]);
  if (!rows.length) return null;
  if (rows.length !== 1) throw new Error(`Could not identify ${object.name} uniquely. Nothing was replaced.`);
  const [definitions] = await connection.query(`SHOW CREATE ${object.type} \`${TARGET_DATABASE}\`.\`${object.name}\``);
  const sql = definitions[0]?.[object.type === 'TRIGGER' ? 'SQL Original Statement' : 'Create Procedure'];
  if (definitions.length !== 1 || typeof sql !== 'string') throw new Error(`Cannot read the definition of ${object.name}. Nothing was replaced.`);
  return sql;
}

function verifyObject(liveSql, object, foldTableNames) {
  // The server adds DEFINER. Compare everything after it, including parameter
  // types, security characteristics, and trigger timing/table.
  const header = /^CREATE\s+DEFINER\s*=\s*`(?:``|[^`])+`@`(?:``|[^`])+`\s+/i;
  if (!header.test(liveSql || '')) throw new Error(`Cannot verify ${object.name}. Nothing was replaced.`);
  const portable = liveSql.replace(header, 'CREATE ');
  if (canonicalSql(portable, foldTableNames) !== canonicalSql(object.sql, foldTableNames)) {
    throw new Error(`${object.name} differs from schema.sql. Keep the backend stopped and inspect it; nothing was replaced.`);
  }
}

async function installBookingUpdate({ connection, database, backendStopped, log = console.log }) {
  if (database !== TARGET_DATABASE) throw new Error(`DB_NAME must be exactly ${TARGET_DATABASE}. Nothing was changed.`);
  if (backendStopped !== true) throw new Error('Stop the backend, then pass --backend-stopped. Nothing was changed.');
  const objects = schemaObjects();
  const [[identity]] = await connection.query('SELECT DATABASE() AS databaseName, @@lower_case_table_names AS lowerCaseTableNames');
  if (![0, 1, 2].includes(identity?.lowerCaseTableNames)) throw new Error('Cannot verify database identifier rules. Nothing was changed.');
  const foldTableNames = identity.lowerCaseTableNames !== 0;
  const selected = identity.databaseName;
  const matches = typeof selected === 'string' && (foldTableNames
    ? selected.toLowerCase() === TARGET_DATABASE.toLowerCase() : selected === TARGET_DATABASE);
  if (!matches) throw new Error('The selected database is not the permitted integration database. Nothing was changed.');

  const [[lock]] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
  if (Number(lock?.acquired) !== 1) throw new Error('Another booking-object installer is running. Nothing was changed.');
  const added = [];
  try {
    // Check every existing object before creating any missing one. An existing
    // name alone does not prove its definition is compatible.
    const existing = new Set();
    for (const object of objects) {
      const live = await readObject(connection, object);
      if (live !== null) { verifyObject(live, object, foldTableNames); existing.add(object.name); }
    }
    for (const object of objects) {
      if (existing.has(object.name)) { log(`${object.name}: already installed and verified.`); continue; }
      await connection.query(object.sql);
      verifyObject(await readObject(connection, object), object, foldTableNames);
      added.push(object.name);
      log(`${object.name}: installed and verified.`);
    }
    return { added, verified: objects.map(object => object.name) };
  } finally {
    try { await connection.execute('SELECT RELEASE_LOCK(?) AS released', [LOCK_NAME]); } catch { /* Connection closure also releases the lock. */ }
  }
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  if (process.env.DB_NAME !== TARGET_DATABASE) throw new Error(`DB_NAME must be exactly ${TARGET_DATABASE}. Nothing was changed.`);
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--backend-stopped') throw new Error('Stop the backend, then run: node Database/addBookingUpdate.js --backend-stopped');
  const connection = await require('mysql2/promise').createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: TARGET_DATABASE, multipleStatements: false,
  });
  try {
    await installBookingUpdate({ connection, database: process.env.DB_NAME, backendStopped: true });
    console.log('Booking-update objects verified. No booking, bill, service or payment rows were changed. The backend may be restarted.');
  } finally {
    await connection.end();
  }
}

if (require.main === module) main().catch(error => {
  console.error(error.code ? `Update failed (${error.code}). Keep the backend stopped and inspect the database; no automatic retry was attempted.` : error.message);
  process.exitCode = 1;
});

module.exports = { TARGET_DATABASE, OBJECTS, canonicalSql, schemaObjects, verifyObject, installBookingUpdate };
