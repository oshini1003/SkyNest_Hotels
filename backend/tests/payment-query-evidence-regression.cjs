const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { configuration, validDate, totals, runEvidence } = require('../check-dashboard-payment-query');
const { dashboardPaymentQuery } = require('../utils/dashboardPaymentQuery');
const env = { DB_NAME: 'SkyNest_Integration_20261002', DB_PASSWORD: 'mock-secret-not-for-output' };

function fakeDatabase(options = {}) {
  const calls = [], printed = [];
  let ended = false, connectionOptions;
  const connection = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      // The mock supplies independent responses. It does not evaluate SQL or
      // establish real MySQL optimizer/boundary behavior; the live runner does.
      if (options.failAt?.(sql, params)) throw Object.assign(new Error('mock driver detail'), { code: 'MOCK_FAILURE' });
      if (/^(SET TRANSACTION|START TRANSACTION|ROLLBACK)/.test(sql)) return [[]];
      if (/SELECT DATABASE\(\)/.test(sql)) return [[{
        databaseName: options.database || 'skynest_integration_20261002',
        databaseToday: options.today || '2026-10-06', mysqlVersion: 'mock',
      }]];
      if (/^SELECT BranchID/.test(sql)) return [[{ BranchID: 2 }, { BranchID: '9' }]];
      if (/^EXPLAIN /.test(sql)) return [[{ table: 'p', type: 'ALL', key: null, rows: 4 }]];
      if (sql.includes('CAST(? AS DATETIME(6))')) {
        const timestamp = params[0], day = params[1];
        const fixture = new Map([
          [`${day} 00:00:00.000000`, ['1.00', '1']],
          [`${day} 23:59:59.999999`, ['1.00', '1']],
        ]).get(timestamp) || ['0.00', '0'];
        return [[{ todayRevenue: fixture[0], todayPaymentsCount: options.badBoundary ? '2' : fixture[1] }]];
      }
      if (/FROM PAYMENT p/.test(sql)) {
        return [[{ todayRevenue: options.mismatch && /p.PaymentDate >=/.test(sql) ? '1.00' : '9007199254740993.75',
          todayPaymentsCount: '9007199254740993' }]];
      }
      throw new Error(`Unexpected mock query: ${sql}`);
    },
    async end() { ended = true; if (options.failClose) throw new Error('mock close failure'); },
  };
  return {
    calls, printed,
    get ended() { return ended; },
    get connectionOptions() { return connectionOptions; },
    createConnection: async options => { connectionOptions = options; return connection; },
    output: { log: value => printed.push(value), table: value => printed.push(value) },
  };
}

async function main() {
  for (const date of ['2024-02-29', '2026-12-31', '1000-01-01', '9999-12-30']) assert.equal(validDate(date), date);
  for (const date of ['2026-02-29', '2024-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '0000-01-01',
    '0999-01-01', '9999-12-31', '2026-1-01', ' 2026-10-06', "2026-10-06' OR 1=1", null]) {
    assert.throws(() => validDate(date));
  }
  for (const argv of [['--date'], ['--date=2026-10-06'], ['2026-10-06'], ['--date', '2026-10-06', '--extra']]) {
    assert.throws(() => configuration(argv, env));
  }
  assert.throws(() => configuration([], { DB_NAME: 'SkyNest_Hotels' }), /DB_NAME/);
  assert.throws(() => configuration([], { DB_NAME: 'skynest_integration_20261002' }), /DB_NAME/);
  let connected = false;
  await assert.rejects(runEvidence({ argv: ['--date', '2026-02-29'], env, createConnection: async () => { connected = true; } }));
  assert.equal(connected, false);
  const help = fakeDatabase();
  await runEvidence({ argv: ['--help'], ...help, env: {} });
  assert.equal(help.connectionOptions, undefined);

  assert.deepEqual(totals([{ todayRevenue: '999999999999999999.99', todayPaymentsCount: '9007199254740993' }]),
    { todayRevenue: '999999999999999999.99', todayPaymentsCount: '9007199254740993' });
  for (const row of [{ todayRevenue: 1, todayPaymentsCount: 2 }, { todayRevenue: '1.00', todayPaymentsCount: 9007199254740992 },
    { todayRevenue: '1.00', todayPaymentsCount: '1e2' }]) assert.throws(() => totals([row]));

  const db = fakeDatabase();
  const result = await runEvidence({ env, createConnection: db.createConnection, output: db.output });
  assert.equal(result.date, '2026-10-06');
  assert.deepEqual(result.scopes.map(row => row.branchId), ['all', 2, 9]);
  assert.equal(result.boundaries, 15);
  assert.equal(db.ended, true);
  assert.equal(db.calls.filter(call => /START TRANSACTION/.test(call.sql)).length, 1);
  assert.equal(db.calls.filter(call => /CURDATE\(\)/.test(call.sql)).length, 1);
  assert.match(db.calls[0].sql, /REPEATABLE READ/);
  assert.match(db.calls[1].sql, /CONSISTENT SNAPSHOT, READ ONLY/);
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(db.connectionOptions.decimalNumbers, false);
  assert.equal(db.connectionOptions.bigNumberStrings, true);
  assert.equal(db.connectionOptions.multipleStatements, false);
  for (const call of db.calls) assert.match(call.sql, /^(?:SELECT|EXPLAIN FORMAT=TRADITIONAL SELECT|SET TRANSACTION|START TRANSACTION|ROLLBACK)/);
  assert.ok(!JSON.stringify(db.printed).includes(env.DB_PASSWORD));
  assert.ok(!db.calls.some(call => /FORCE INDEX|INSERT |UPDATE |DELETE |CREATE |GRANT |COMMIT/.test(call.sql)));
  // Production helper's SQL and parameters must be sent unchanged for every
  // live candidate and its EXPLAIN, including scoped booking attribution.
  for (const branchId of [undefined, 2, 9]) {
    const expected = dashboardPaymentQuery('2026-10-06', branchId);
    assert.ok(db.calls.some(call => call.sql === expected.sql && JSON.stringify(call.params) === JSON.stringify(expected.params)));
    assert.ok(db.calls.some(call => call.sql === `EXPLAIN FORMAT=TRADITIONAL ${expected.sql}`
      && JSON.stringify(call.params) === JSON.stringify(expected.params)));
  }
  assert.equal(db.calls.filter(call => call.sql.includes('FROM PAYMENT p') && !call.sql.startsWith('EXPLAIN')).length, 6);

  const historical = fakeDatabase();
  const historicalResult = await runEvidence({ argv: ['--date', '2024-02-29'], env,
    createConnection: historical.createConnection, output: historical.output });
  assert.equal(historicalResult.date, '2024-02-29');
  for (const query of historical.calls.filter(call => call.sql.includes('FROM PAYMENT p'))) assert.equal(query.params[0], '2024-02-29');

  for (const [options, message] of [
    [{ database: 'production' }, /selected database/],
    [{ today: '2026-02-29' }, /calendar date/],
    [{ mismatch: true }, /totals or counts differ/],
    [{ badBoundary: true }, /boundary inclusion/],
    [{ failAt: sql => sql.startsWith('EXPLAIN') }, /mock driver detail/],
    [{ failAt: sql => sql.startsWith('EXPLAIN'), failClose: true }, /mock driver detail/],
  ]) {
    const failure = fakeDatabase(options);
    await assert.rejects(runEvidence({ env, createConnection: failure.createConnection, output: failure.output }), message);
    assert.equal(failure.ended, true);
    assert.equal(failure.calls.at(-1).sql, 'ROLLBACK');
    assert.ok(!failure.printed.some(value => typeof value === 'string' && value.startsWith('PASS:')));
    if (options.database) assert.ok(!failure.calls.some(call => /FROM (?:BRANCH|PAYMENT)/.test(call.sql)));
  }
  const startFailure = fakeDatabase({ failAt: sql => sql.startsWith('START TRANSACTION') });
  await assert.rejects(runEvidence({ env, createConnection: startFailure.createConnection, output: startFailure.output }));
  assert.equal(startFailure.ended, true);
  const source = fs.readFileSync(path.join(__dirname, '../check-dashboard-payment-query.js'), 'utf8');
  assert.match(source, /path\.join\(__dirname, '\.env'\)/);
  console.log('PASS: payment evidence CLI/calendar/target gates, exact amounts and counts, actual production-query reuse, branch scopes, read-only snapshot and cleanup, mismatch propagation and boundary-check failures (mock MySQL; no live optimizer or SQL evaluation).');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
