'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { identityOf, verifyTarget } = require('./Database/runtimeUserAccess');
const { TARGET_DATABASE, APP_USER, APP_HOST } = require('./Database/runtimeUserPolicy');

const failureStages = new WeakMap();
function atStage(error, stage) {
  const failure = error && typeof error === 'object' ? error : new Error('Unknown check failure.');
  if (!failureStages.has(failure)) failureStages.set(failure, stage);
  return failure;
}

// Map only controlled local messages and known driver codes to public labels.
// Never print a driver message, SQL, configuration, stack, or returned row.
const localCodes = new Map([
  ['Remove shell DB_* overrides before checking the file configuration.', 'SHELL_DB_OVERRIDES'],
  ['Expected explicit local integration settings and the runtime account in backend/.env.', 'RUNTIME_CONFIG_INVALID'],
  ['Use the local SkyNest_Integration_20261002 database only.', 'LOCAL_TARGET_REQUIRED'],
  ['Cannot verify database identifier rules.', 'IDENTIFIER_RULES_INVALID'],
  ['Unexpected selected database.', 'DATABASE_TARGET_MISMATCH'],
  ['Mandatory server roles need a separate privilege review.', 'MANDATORY_ROLES_PRESENT'],
  ['Expected skynest_app@localhost without active roles.', 'RUNTIME_IDENTITY_MISMATCH'],
  ['Expected one count aggregate.', 'COUNT_RESPONSE_INVALID'],
  ['Expected an exact nonnegative integer count string.', 'COUNT_VALUE_INVALID'],
]);
const driverCodes = new Set(['ENOENT', 'EACCES', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
  'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR',
  'ER_COLUMNACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_PARSE_ERROR',
  'ER_OPTION_PREVENTS_STATEMENT', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT']);
function formatFailure(error) {
  const stage = failureStages.get(error) || 'CHECK';
  const code = localCodes.get(error?.message)
    || (driverCodes.has(error?.code) ? error.code : 'CHECK_FAILED');
  return `ERROR: grading data check failed at ${stage} (${code}). No readiness result was issued; no hotel rows were changed.`;
}

const usage = `Usage: node backend/check-grading-data.js [--help]
Reads backend/.env explicitly and requires the local integration database and skynest_app runtime account.
Checks saved counts in one read-only snapshot; prints no guest, staff, payment, or credential details.
Minimums: 3 branches, 10 rooms using 2 room types, 6 services, 5 guests, 8 bookings,
3 payments saved as Partial, 1 booked-room row, and 1 service-usage row.
Distinct booked guests are informational; review the brief's guest/booking relationship manually.
Partial counts use the saved PaymentType classification and do not prove the payment/audit workflow.
Room availability is derived from rooms, bookings and stay dates; it is not a separate table.
This does not seed/reset data or replace check-runtime-user.js or a workflow demonstration.
Exit codes: 0 = count minimums met; 2 = REVIEW data gaps; 1 = verification error.`;

// Static aggregate statements only. Cast before crossing the driver boundary so
// large COUNT values never pass through an imprecise JavaScript Number.
const measures = Object.freeze([
  { key: 'branches', label: 'Branches', minimum: '3', sql: 'SELECT CAST(COUNT(*) AS CHAR) AS total FROM BRANCH' },
  { key: 'rooms', label: 'Rooms', minimum: '10', sql: 'SELECT CAST(COUNT(*) AS CHAR) AS total FROM ROOM' },
  { key: 'usedRoomTypes', label: 'Room types used by rooms', minimum: '2', sql: 'SELECT CAST(COUNT(DISTINCT RoomTypeID) AS CHAR) AS total FROM ROOM' },
  { key: 'services', label: 'Catalogue services', minimum: '6', sql: 'SELECT CAST(COUNT(*) AS CHAR) AS total FROM SERVICE_CATALOGUE' },
  { key: 'guests', label: 'Guests', minimum: '5', sql: 'SELECT CAST(COUNT(*) AS CHAR) AS total FROM GUEST' },
  { key: 'bookings', label: 'Bookings', minimum: '8', sql: 'SELECT CAST(COUNT(*) AS CHAR) AS total FROM BOOKING' },
  { key: 'partialPayments', label: 'Payments saved as Partial', minimum: '3', sql: "SELECT CAST(COUNT(*) AS CHAR) AS total FROM PAYMENT WHERE PaymentType = 'Partial'" },
  { key: 'bookedRooms', label: 'Booked-room rows', minimum: '1', sql: 'SELECT CAST(COUNT(*) AS CHAR) AS total FROM BOOKED_ROOMS' },
  { key: 'serviceUsage', label: 'Service-usage rows', minimum: '1', sql: 'SELECT CAST(COUNT(*) AS CHAR) AS total FROM SERVICE_USAGE' },
  { key: 'distinctBookedGuests', label: 'Distinct guests with bookings', sql: 'SELECT CAST(COUNT(DISTINCT GuestID) AS CHAR) AS total FROM BOOKING' },
]);

function exactCount(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Expected an exact nonnegative integer count string.');
  }
  return value;
}

function evaluate(counts) {
  if (!counts || typeof counts !== 'object') throw new Error('Missing saved counts.');
  const checks = measures.filter(measure => measure.minimum !== undefined).map(measure => {
    const count = exactCount(counts[measure.key]);
    return { item: measure.label, count, minimum: measure.minimum,
      status: BigInt(count) >= BigInt(measure.minimum) ? 'PASS' : 'REVIEW' };
  });
  const distinctBookedGuests = exactCount(counts.distinctBookedGuests);
  return { exitCode: checks.every(check => check.status === 'PASS') ? 0 : 2,
    checks, distinctBookedGuests };
}

async function collect(connection, config) {
  let transactionRequested = false;
  let failure;
  let stage = 'SNAPSHOT_ISOLATION';
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    // Roll back even if START succeeds at the server but its acknowledgement is lost.
    transactionRequested = true;
    stage = 'SNAPSHOT_START';
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    stage = 'IDENTITY_READ';
    const rawIdentity = await identityOf(connection);
    // mysql2 bigNumberStrings can return LONGLONG system variables as strings.
    // Normalize only the three valid representations. In particular, string "0"
    // must not make a case-sensitive server pass a case-insensitive target check.
    const identity = { ...rawIdentity, lowerCaseTableNames:
      ['0', '1', '2'].includes(rawIdentity?.lowerCaseTableNames)
        ? Number(rawIdentity.lowerCaseTableNames) : rawIdentity?.lowerCaseTableNames };
    stage = 'IDENTITY_TARGET';
    verifyTarget(config, identity);
    stage = 'IDENTITY_ACCOUNT';
    if (config.user !== APP_USER || identity.currentUser !== `${APP_USER}@${APP_HOST}`
        || identity.activeRoles !== 'NONE') {
      throw new Error('Expected skynest_app@localhost without active roles.');
    }
    const counts = {};
    stage = 'COUNTS_READ';
    for (const measure of measures) {
      const [rows] = await connection.query(measure.sql);
      if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]
          || Object.keys(rows[0]).length !== 1 || !Object.hasOwn(rows[0], 'total')) {
        throw new Error('Expected one count aggregate.');
      }
      counts[measure.key] = exactCount(rows[0].total);
    }
    return counts;
  } catch (error) {
    failure = atStage(error, stage);
    throw failure;
  } finally {
    if (transactionRequested) {
      try { await connection.query('ROLLBACK'); }
      catch (error) { if (!failure) throw atStage(error, 'SNAPSHOT_ROLLBACK'); }
    }
  }
}

function configuration(argv, shellEnv, readFile) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return null;
  if (argv.length) throw new Error(usage);
  if (Object.keys(shellEnv).some(key => /^DB_/i.test(key))) {
    throw new Error('Remove shell DB_* overrides before checking the file configuration.');
  }
  // Do not load dotenv into process.env or consult maintenance/candidate files.
  const values = require('dotenv').parse(readFile(path.join(__dirname, '.env'), 'utf8'));
  const port = values.DB_PORT || '3306';
  if (values.DB_NAME !== TARGET_DATABASE || !['localhost', '127.0.0.1', '::1'].includes(values.DB_HOST)
      || values.DB_USER !== APP_USER || !values.DB_PASSWORD
      || !/^[1-9]\d*$/.test(port) || BigInt(port) > 65535n) {
    throw new Error('Expected explicit local integration settings and the runtime account in backend/.env.');
  }
  return { host: values.DB_HOST, port: Number(port), user: values.DB_USER,
    password: values.DB_PASSWORD, database: values.DB_NAME, multipleStatements: false,
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, connectTimeout: 10000 };
}

async function run({ argv = [], shellEnv = process.env, readFile = fs.readFileSync,
  createConnection, output = console } = {}) {
  let config;
  try { config = configuration(argv, shellEnv, readFile); }
  catch (error) { throw atStage(error, 'CONFIGURATION'); }
  if (!config) { output.log(usage); return { exitCode: 0 }; }
  let connection;
  try { connection = await (createConnection || require('mysql2/promise').createConnection)(config); }
  catch (error) { throw atStage(error, 'CONNECTION'); }
  let counts;
  let failure;
  try { counts = await collect(connection, config); }
  catch (error) { failure = error; }
  finally {
    try { await connection.end(); }
    catch (error) { if (!failure) failure = atStage(error, 'CONNECTION_CLOSE'); }
  }
  if (failure) throw failure;
  let result;
  try { result = evaluate(counts); }
  catch (error) { throw atStage(error, 'COUNTS_EVALUATE'); }
  // No readiness output is emitted until all counts and cleanup have completed.
  output.log(result.exitCode === 0 ? 'PASS: saved counts meet the listed minimums.'
    : 'REVIEW: one or more saved counts are below the listed minimums.');
  output.table(result.checks);
  output.log(`INFO: distinct guests with bookings = ${result.distinctBookedGuests}; review the required guest/booking relationship manually.`);
  output.log('Partial is the saved payment classification, not audit/workflow proof. Room availability is derived, not a separate table.');
  output.log('Read-only counts only; no data was seeded or reset. Runtime grants and live workflows need their separate checks.');
  return result;
}

if (require.main === module) {
  run({ argv: process.argv.slice(2) }).then(result => { process.exitCode = result.exitCode; }).catch(error => {
    console.error(formatFailure(error));
    process.exitCode = 1;
  });
}

module.exports = { collect, evaluate, configuration, run, formatFailure };
