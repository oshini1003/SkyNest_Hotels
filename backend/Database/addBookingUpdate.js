// Stop the backend first: node Database/addBookingUpdate.js --backend-stopped
// Adds sp_update_booked_room and trg_prevent_overlap_booking_update to the existing
// integration database. Both objects are new: nothing is dropped, replaced or written.
const fs = require('node:fs');
const path = require('node:path');
const { projectStatements } = require('./setupIntegrationDb');

const TARGET_DATABASE = 'SkyNest_Integration_20261002';
const OBJECTS = [
  { type: 'TRIGGER', name: 'trg_prevent_overlap_booking_update', definition: /^CREATE TRIGGER trg_prevent_overlap_booking_update\b/ },
  { type: 'PROCEDURE', name: 'sp_update_booked_room', definition: /^CREATE PROCEDURE sp_update_booked_room\b/ },
];

async function installed(connection, { type, name }) {
  const [rows] = type === 'TRIGGER'
    ? await connection.execute(
        'SELECT 1 FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?', [name])
    : await connection.execute(
        "SELECT 1 FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_NAME = ?", [name]);
  return rows.length === 1;
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  if (process.env.DB_NAME !== TARGET_DATABASE) {
    throw new Error(`DB_NAME must be exactly ${TARGET_DATABASE}. Nothing was changed.`);
  }
  if (process.argv.slice(2).join(' ') !== '--backend-stopped') {
    throw new Error('Stop the backend, then run: node Database/addBookingUpdate.js --backend-stopped');
  }
  const statements = projectStatements(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const pending = OBJECTS.map(object => {
    const matches = statements.filter(sql => object.definition.test(sql));
    if (matches.length !== 1) throw new Error(`schema.sql must contain exactly one ${object.name} definition. Nothing was changed.`);
    return { ...object, sql: matches[0] };
  });

  const connection = await require('mysql2/promise').createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: TARGET_DATABASE, multipleStatements: false,
  });
  try {
    for (const object of pending) {            // trigger first, then the procedure; reruns only add what is missing
      if (await installed(connection, object)) { console.log(`${object.name}: already installed.`); continue; }
      await connection.query(object.sql);
      console.log(`${object.name}: installed.`);
    }
    console.log('Done. No booking, bill, service or payment rows were changed. The backend may be restarted.');
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error.code ? `Update failed (${error.code}). Keep the backend stopped and inspect the database.` : error.message);
  process.exitCode = 1;
});