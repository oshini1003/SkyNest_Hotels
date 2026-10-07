'use strict';
const fs = require('node:fs');
const { configuration, collect } = require('./check-grading-data');

const rooms = [
  ['SkyNest Colombo', '202', 'Double'],
  ['SkyNest Kandy', '201', 'Suite'],
  ['SkyNest Galle', '102', 'Single'],
];
const services = [
  ['Breakfast Buffet', 'Per guest, per breakfast', 1500],
  ['Airport Transfer', 'Per vehicle, one-way transfer', 4500],
];
const lockName = 'skynest.integration.grading-catalogue.v1';
const usage = `Usage: node backend/add-grading-catalogue.js [--apply | --help]
Default: read-only plan. --apply inserts only the missing three planned rooms and two services.
Uses backend/.env and the existing local integration runtime account; no maintenance credentials.
Pause other catalogue edits while applying. The named lock serializes this helper only.
Matching rows are skipped; conflicting or retired services stop the entire preflight.
Existing room status is preserved. No accounts, bookings, payments or other rows are written.
After an uncertain result, inspect saved rows with the default plan before applying again.`;

const failures = new WeakMap();
const publicCodes = new Set(['CATALOGUE_CONFLICT', 'CATALOGUE_BUSY', 'LOCK_RESULT_INVALID',
  'ARGUMENTS_INVALID', 'INSERT_RESULT_INVALID', 'ENOENT', 'EACCES', 'ECONNREFUSED',
  'ETIMEDOUT', 'ENOTFOUND', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR',
  'ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR',
  'ER_NO_SUCH_TABLE', 'ER_PARSE_ERROR', 'ER_OPTION_PREVENTS_STATEMENT', 'ER_DUP_ENTRY',
  'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT']);
function reject(code) { throw Object.assign(new Error(code), { code }); }
function formatFailure(error) {
  const { stage = 'CHECK', outcome = 'No catalogue writes were requested.' } = failures.get(error) || {};
  const code = publicCodes.has(error?.code) ? error.code : 'CHECK_FAILED';
  return `ERROR: catalogue helper failed at ${stage} (${code}). ${outcome}`;
}
function id(value) {
  if (!((typeof value === 'number' && Number.isSafeInteger(value))
      || (typeof value === 'string' && /^[1-9]\d*$/.test(value)))
      || Number(value) < 1 || Number(value) > 2147483647) reject('CATALOGUE_CONFLICT');
  return Number(value);
}
function one(rows, name, column) {
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].Name !== name) reject('CATALOGUE_CONFLICT');
  return id(rows[0][column]);
}

async function preflight(connection) {
  const plan = [];
  for (const [branch, number, type] of rooms) {
    const [branches] = await connection.execute('SELECT BranchID, Name FROM BRANCH WHERE Name = ?', [branch]);
    const [types] = await connection.execute('SELECT RoomTypeID, Name FROM ROOM_TYPE WHERE Name = ?', [type]);
    const branchId = one(branches, branch, 'BranchID');
    const typeId = one(types, type, 'RoomTypeID');
    const [existing] = await connection.execute(
      'SELECT RoomID, RoomTypeID, RoomNumber, RoomStatus FROM ROOM WHERE BranchID = ? AND RoomNumber = ?', [branchId, number]);
    if (!Array.isArray(existing) || existing.length > 1) reject('CATALOGUE_CONFLICT');
    const row = existing[0];
    if (row && (row.RoomNumber !== number || id(row.RoomTypeID) !== typeId
        || !['Available', 'Occupied', 'Maintenance'].includes(row.RoomStatus))) reject('CATALOGUE_CONFLICT');
    plan.push({ item: `${branch} / ${number} / ${type}`, kind: 'room',
      params: [branchId, typeId, number], id: row ? id(row.RoomID) : null, action: row ? 'SKIP' : 'ADD' });
  }
  for (const [name, description, price] of services) {
    const [existing] = await connection.execute(
      'SELECT ServiceID, ServiceName, Description, UnitPrice, IsActive FROM SERVICE_CATALOGUE WHERE ServiceName = ?', [name]);
    if (!Array.isArray(existing) || existing.length > 1) reject('CATALOGUE_CONFLICT');
    const row = existing[0];
    if (row && (row.ServiceName !== name || row.Description !== description
        || ![1, '1'].includes(row.IsActive)
        || !(row.UnitPrice === price || (typeof row.UnitPrice === 'string'
          && /^\d+\.\d{2}$/.test(row.UnitPrice) && Number(row.UnitPrice) === price)))) reject('CATALOGUE_CONFLICT');
    plan.push({ item: name, kind: 'service', params: [name, description, price],
      id: row ? id(row.ServiceID) : null, action: row ? 'SKIP' : 'ADD' });
  }
  return plan;
}

async function run({ argv = [], shellEnv = process.env, readFile = fs.readFileSync,
  createConnection, output = console } = {}) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    output.log(usage); return { exitCode: 0 };
  }
  const apply = argv.length === 1 && argv[0] === '--apply';
  let stage = 'ARGUMENTS', connection, failure, plan;
  let lockRequested = false, lockHeld = false, transactionRequested = false;
  let writesRequested = false, commitRequested = false, committed = false, rolledBack = false;
  const remember = error => {
    if (!failure) {
      failure = error && typeof error === 'object' ? error : new Error('CHECK_FAILED');
      failures.set(failure, { stage });
    }
  };
  try {
    if (argv.length && !apply) reject('ARGUMENTS_INVALID');
    stage = 'CONFIGURATION';
    const config = configuration([], shellEnv, readFile);
    stage = 'CONNECTION';
    connection = await (createConnection || require('mysql2/promise').createConnection)(config);
    stage = 'TARGET_VERIFICATION';
    // Reuse the checked read-only snapshot, including Windows identifier rules.
    // collect rolls its transaction back before any catalogue operation starts.
    await collect(connection, config);
    if (apply) {
      stage = 'CATALOGUE_LOCK';
      lockRequested = true;
      const [rows] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
      if (!Array.isArray(rows) || rows.length !== 1) reject('LOCK_RESULT_INVALID');
      if ([0, '0'].includes(rows[0].acquired)) reject('CATALOGUE_BUSY');
      if (![1, '1'].includes(rows[0].acquired)) reject('LOCK_RESULT_INVALID');
      lockHeld = true;
    }
    stage = 'CATALOGUE_ISOLATION';
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    stage = 'CATALOGUE_START';
    transactionRequested = true;
    await connection.query(apply ? 'START TRANSACTION' : 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    stage = 'CATALOGUE_PREFLIGHT';
    plan = await preflight(connection);
    if (apply) {
      stage = 'CATALOGUE_INSERT';
      for (const item of plan.filter(item => item.action === 'ADD')) {
        writesRequested = true;
        const sql = item.kind === 'room'
          ? 'INSERT INTO ROOM (BranchID, RoomTypeID, RoomNumber) VALUES (?, ?, ?)'
          : 'INSERT INTO SERVICE_CATALOGUE (ServiceName, Description, UnitPrice) VALUES (?, ?, ?)';
        const [result] = await connection.execute(sql, item.params);
        if (result.affectedRows !== 1) reject('INSERT_RESULT_INVALID');
        item.id = id(result.insertId);
      }
      stage = 'CATALOGUE_COMMIT';
      commitRequested = true;
      await connection.query('COMMIT');
      committed = true;
    }
  } catch (error) { remember(error); }
  finally {
    if (connection && transactionRequested && !committed) {
      stage = 'CATALOGUE_ROLLBACK';
      try { await connection.query('ROLLBACK'); rolledBack = true; }
      catch (error) { remember(error); }
    }
    if (connection && lockRequested) {
      stage = 'CATALOGUE_UNLOCK';
      try {
        const [rows] = await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]);
        if (lockHeld && (!Array.isArray(rows) || rows.length !== 1 || ![1, '1'].includes(rows[0].released))) reject('LOCK_RESULT_INVALID');
      } catch (error) { remember(error); }
    }
    if (connection) {
      stage = 'CONNECTION_CLOSE';
      try { await connection.end(); }
      catch (error) { remember(error); }
    }
  }
  if (failure) {
    const outcome = committed ? 'Catalogue commit was acknowledged; inspect saved rows before applying again.'
      : commitRequested ? 'Commit outcome is unknown; inspect saved rows with the default plan before applying again.'
        : !writesRequested ? 'No catalogue writes were requested.'
          : rolledBack ? 'Transaction rolled back; no catalogue rows were added.'
            : 'Rollback was not confirmed; inspect saved rows before applying again.';
    failures.get(failure).outcome = outcome;
    throw failure;
  }
  const summary = plan.map(({ item, action, id: savedId }) => ({ item, action: apply && action === 'ADD' ? 'ADDED' : action, id: savedId }));
  output.log(apply ? 'PASS: catalogue transaction committed.' : 'PLAN: read-only catalogue review; no rows were changed.');
  output.table(summary);
  return { exitCode: 0, applied: apply, plan: summary };
}

if (require.main === module) {
  run({ argv: process.argv.slice(2) }).then(result => { process.exitCode = result.exitCode; }).catch(error => {
    console.error(formatFailure(error)); process.exitCode = 1;
  });
}
module.exports = { run, formatFailure };
