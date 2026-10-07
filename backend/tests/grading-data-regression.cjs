'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { collect, evaluate, configuration, run, formatFailure } = require('../check-grading-data');

const counts = { branches: '3', rooms: '10', usedRoomTypes: '2', services: '6', guests: '5',
  bookings: '8', partialPayments: '3', bookedRooms: '1', serviceUsage: '1', distinctBookedGuests: '5' };
const config = { host: 'localhost', user: 'skynest_app', database: 'SkyNest_Integration_20261002' };
const envText = 'DB_HOST=localhost\nDB_PORT=3306\nDB_USER=skynest_app\nDB_PASSWORD=test-private-value\nDB_NAME=SkyNest_Integration_20261002\n';
// Independent SQL fixtures: unknown statements fail, including row-level reads,
// locks, business CALLs, DML/DDL, and execution-bearing EXPLAIN variants.
const countSql = [
  ['SELECT CAST(COUNT(*) AS CHAR) AS total FROM BRANCH', 'branches'],
  ['SELECT CAST(COUNT(*) AS CHAR) AS total FROM ROOM', 'rooms'],
  ['SELECT CAST(COUNT(DISTINCT RoomTypeID) AS CHAR) AS total FROM ROOM', 'usedRoomTypes'],
  ['SELECT CAST(COUNT(*) AS CHAR) AS total FROM SERVICE_CATALOGUE', 'services'],
  ['SELECT CAST(COUNT(*) AS CHAR) AS total FROM GUEST', 'guests'],
  ['SELECT CAST(COUNT(*) AS CHAR) AS total FROM BOOKING', 'bookings'],
  ["SELECT CAST(COUNT(*) AS CHAR) AS total FROM PAYMENT WHERE PaymentType = 'Partial'", 'partialPayments'],
  ['SELECT CAST(COUNT(*) AS CHAR) AS total FROM BOOKED_ROOMS', 'bookedRooms'],
  ['SELECT CAST(COUNT(*) AS CHAR) AS total FROM SERVICE_USAGE', 'serviceUsage'],
  ['SELECT CAST(COUNT(DISTINCT GuestID) AS CHAR) AS total FROM BOOKING', 'distinctBookedGuests'],
];
const identitySql = 'SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser, CURRENT_ROLE() AS activeRoles, @@lower_case_table_names AS lowerCaseTableNames, @@GLOBAL.mandatory_roles AS mandatoryRoles';
const normalize = sql => sql.replace(/\s+/g, ' ').trim();

function mock(options = {}) {
  const events = [];
  const sqlCounts = new Map(countSql);
  return {
    events,
    async query(sql) {
      const text = normalize(sql);
      events.push(text);
      if (text === options.failAt) throw options.failure || new Error('simulated failure');
      if (text === 'ROLLBACK' && options.rollbackFails) throw new Error('rollback failed');
      if (['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY', 'ROLLBACK'].includes(text)) return [[]];
      if (text === identitySql) return [[{ databaseName: config.database, currentUser: 'skynest_app@localhost',
        activeRoles: 'NONE', lowerCaseTableNames: 0, mandatoryRoles: '', ...options.identity }]];
      assert.ok(sqlCounts.has(text), `Unexpected SQL: ${text}`);
      if (options.rowsAt === text) return [options.rows];
      return [[{ total: (options.counts || counts)[sqlCounts.get(text)] }]];
    },
    async end() {
      events.push('END');
      if (options.endFails) throw new Error('end failed');
    },
  };
}

function harness(connection, overrides = {}) {
  const emitted = [];
  const options = { shellEnv: {}, readFile(file, encoding) {
    assert.equal(file, path.resolve(__dirname, '../.env'));
    assert.equal(encoding, 'utf8');
    return envText;
  }, async createConnection(settings) {
    assert.equal(settings.user, 'skynest_app');
    assert.equal(settings.multipleStatements, false);
    return connection;
  }, output: { log(value) { assert.equal(connection.events.at(-1), 'END'); emitted.push(value); },
    table(value) { assert.equal(connection.events.at(-1), 'END'); emitted.push(value); } }, ...overrides };
  return { emitted, options };
}

(async () => {
  assert.equal(evaluate(counts).exitCode, 0);
  for (const key of Object.keys(counts).filter(key => key !== 'distinctBookedGuests')) {
    const value = (BigInt(counts[key]) - 1n).toString();
    const result = evaluate({ ...counts, [key]: value });
    assert.equal(result.exitCode, 2, key);
    assert.equal(result.checks.filter(check => check.status === 'REVIEW').length, 1, key);
  }
  assert.equal(evaluate({ ...counts, distinctBookedGuests: '1' }).exitCode, 0, 'booked guests are informational');
  const huge = '900719925474099312345678901234567890';
  const hugeResult = evaluate(Object.fromEntries(Object.keys(counts).map(key => [key, huge])));
  assert.equal(hugeResult.exitCode, 0);
  assert.ok(hugeResult.checks.every(check => check.count === huge));
  assert.equal(hugeResult.distinctBookedGuests, huge);
  for (const value of [0, 10, 9007199254740992, 3n, '', '03', '-1', '1.0', '1e9', '+1', ' 1', '1\n', null, undefined]) {
    assert.throws(() => evaluate({ ...counts, rooms: value }), /exact nonnegative integer/);
  }

  const success = mock();
  const successful = harness(success);
  assert.equal((await run(successful.options)).exitCode, 0);
  assert.deepEqual(success.events, ['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY', identitySql,
    ...countSql.map(([sql]) => sql), 'ROLLBACK', 'END']);
  assert.ok(!JSON.stringify(successful.emitted).includes('test-private-value'));
  assert.ok(!JSON.stringify(successful.emitted).includes('skynest_app'));
  const gaps = harness(mock({ counts: { ...counts, partialPayments: '2' } }));
  assert.equal((await run(gaps.options)).exitCode, 2);
  const hugeDb = harness(mock({ counts: { ...counts, rooms: huge } }));
  assert.equal((await run(hugeDb.options)).checks.find(check => check.item === 'Rooms').count, huge);

  for (const identity of [{ currentUser: 'root@localhost' }, { activeRoles: 'some_role' },
    { mandatoryRoles: 'some_role' }, { databaseName: 'OtherDatabase' }, { lowerCaseTableNames: 7 }]) {
    const connection = mock({ identity });
    const test = harness(connection);
    await assert.rejects(run(test.options));
    assert.deepEqual(connection.events.slice(-2), ['ROLLBACK', 'END']);
    assert.ok(!connection.events.some(sql => new Map(countSql).has(sql)));
    assert.deepEqual(test.emitted, []);
  }
  const windows = mock({ identity: { databaseName: config.database.toLowerCase(), lowerCaseTableNames: 1 } });
  assert.deepEqual(await collect(windows, config), counts);
  assert.equal(windows.events.at(-1), 'ROLLBACK');

  // mysql2 can decode integer system metadata as strings when bigNumberStrings
  // is enabled. Test all supported forms, including case-sensitive string zero.
  for (const lowerCaseTableNames of [0, 1, 2, '0', '1', '2']) {
    const databaseName = lowerCaseTableNames === 0 || lowerCaseTableNames === '0'
      ? config.database : config.database.toLowerCase();
    const connection = mock({ identity: { databaseName, lowerCaseTableNames } });
    assert.equal((await run(harness(connection).options)).exitCode, 0);
  }
  for (const lowerCaseTableNames of [0, '0']) {
    const connection = mock({ identity: { databaseName: config.database.toLowerCase(), lowerCaseTableNames } });
    await assert.rejects(run(harness(connection).options), error => {
      assert.match(formatFailure(error), /IDENTITY_TARGET \(DATABASE_TARGET_MISMATCH\)/);
      return true;
    });
    assert.ok(!connection.events.some(sql => new Map(countSql).has(sql)));
  }
  for (const lowerCaseTableNames of ['01', ' 1', '1\n', '1.0', '-1', '3', '', null, undefined, false, true, -1, 3, NaN]) {
    const connection = mock({ identity: { lowerCaseTableNames } });
    const test = harness(connection);
    await assert.rejects(run(test.options), error => {
      assert.match(formatFailure(error), /IDENTITY_TARGET \(IDENTIFIER_RULES_INVALID\)/);
      return true;
    });
    assert.deepEqual(test.emitted, []);
    assert.deepEqual(connection.events.slice(-2), ['ROLLBACK', 'END']);
  }

  for (const options of [
    { failAt: 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ' },
    { failAt: 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY' },
    { failAt: identitySql },
    { failAt: countSql.at(-1)[0] },
    { rowsAt: countSql[0][0], rows: [] },
    { rowsAt: countSql[0][0], rows: [{ total: '3' }, { total: '4' }] },
    { rowsAt: countSql[0][0], rows: [{ total: '3', Name: 'must never print' }] },
    { counts: { ...counts, serviceUsage: 1 } },
    { rollbackFails: true },
    { endFails: true },
    { failAt: countSql[2][0], rollbackFails: true, endFails: true },
  ]) {
    const connection = mock(options);
    const test = harness(connection);
    await assert.rejects(run(test.options));
    assert.equal(connection.events.at(-1), 'END');
    if (options.failAt !== 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') assert.ok(connection.events.includes('ROLLBACK'));
    assert.deepEqual(test.emitted, []);
  }
  const original = new Error('original count failure');
  const originalTest = harness(mock({ failAt: countSql[0][0], failure: original, rollbackFails: true, endFails: true }));
  await assert.rejects(run(originalTest.options), error => error === original);
  assert.match(formatFailure(original), /COUNTS_READ \(CHECK_FAILED\)/);

  let reads = 0;
  const read = () => { reads++; return envText; };
  assert.equal(configuration([], {}, read).database, config.database);
  assert.equal(reads, 1);
  for (const key of ['DB_USER', 'DB_PASSWORD', 'DB_ANYTHING', 'db_name']) {
    assert.throws(() => configuration([], { [key]: 'override' }, () => { throw new Error('must not read'); }), /shell DB_/);
  }
  for (const [from, to] of [['skynest_app', 'root'], ['localhost', 'remote.example'],
    ['SkyNest_Integration_20261002', 'SkyNest_Hotels'], ['test-private-value', ''], ['3306', '65536'], ['3306', '3e3']]) {
    assert.throws(() => configuration([], {}, () => envText.replace(from, to)), /explicit local integration/);
  }
  assert.throws(() => configuration(['--candidate'], {}, read), /Usage/);
  const help = [];
  assert.equal((await run({ argv: ['--help'], shellEnv: { DB_USER: 'root' },
    readFile() { throw new Error('help must not read .env'); },
    createConnection() { throw new Error('help must not connect'); },
    output: { log(value) { help.push(value); } } })).exitCode, 0);
  assert.match(help[0], /saved PaymentType classification/);
  const connectFailure = [];
  await assert.rejects(run({ shellEnv: {}, readFile: () => envText,
    createConnection() { throw new Error('connection failed'); }, output: { log(value) { connectFailure.push(value); } } }));
  assert.deepEqual(connectFailure, []);

  const sensitive = 'do-not-emit-password-token-sql-or-path';
  for (const [options, stage, code] of [
    [{ failAt: identitySql, failure: Object.assign(new Error(sensitive), { code: 'ER_PARSE_ERROR', sql: sensitive }) }, 'IDENTITY_READ', 'ER_PARSE_ERROR'],
    [{ failAt: countSql[0][0], failure: Object.assign(new Error(sensitive), { code: sensitive }) }, 'COUNTS_READ', 'CHECK_FAILED'],
    [{ failAt: 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY' }, 'SNAPSHOT_START', 'CHECK_FAILED'],
    [{ rollbackFails: true }, 'SNAPSHOT_ROLLBACK', 'CHECK_FAILED'],
    [{ endFails: true }, 'CONNECTION_CLOSE', 'CHECK_FAILED'],
  ]) {
    const test = harness(mock(options));
    await assert.rejects(run(test.options), error => {
      const message = formatFailure(error);
      assert.ok(message.includes(`${stage} (${code})`));
      assert.ok(!message.includes(sensitive));
      assert.deepEqual(test.emitted, []);
      return true;
    });
  }
  for (const [options, stage, code] of [
    [{ shellEnv: { DB_USER: sensitive } }, 'CONFIGURATION', 'SHELL_DB_OVERRIDES'],
    [{ readFile() { throw Object.assign(new Error(sensitive), { code: 'ENOENT', path: sensitive }); } }, 'CONFIGURATION', 'ENOENT'],
    [{ createConnection() { throw Object.assign(new Error(sensitive), { code: 'ECONNREFUSED' }); } }, 'CONNECTION', 'ECONNREFUSED'],
  ]) {
    const test = harness(mock(), options);
    await assert.rejects(run(test.options), error => {
      const message = formatFailure(error);
      assert.ok(message.includes(`${stage} (${code})`));
      assert.ok(!message.includes(sensitive));
      assert.deepEqual(test.emitted, []);
      return true;
    });
  }
  assert.ok(!formatFailure(Object.assign(new Error(sensitive), { code: sensitive })).includes(sensitive));
  console.log('PASS: grading-data counts and read-only contracts; numeric/string MySQL metadata, strict case rules, safe stage/code diagnostics and cleanup. No live database used.');
})().catch(error => { console.error(error); process.exitCode = 1; });
