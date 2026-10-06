// Read-only evidence: compare the former day filter with the production query.
const assert = require('node:assert/strict');
const path = require('node:path');
const { dashboardPaymentQuery } = require('./utils/dashboardPaymentQuery');

const databaseName = 'SkyNest_Integration_20261002';
const usage = 'Usage: node backend/check-dashboard-payment-query.js [--date YYYY-MM-DD]\n'
  + 'Defaults to the database-local current date. Reads backend/.env. No hotel rows or sessions are changed.';

function validDate(value) {
  assert.ok(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Date must use YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  assert.ok(year >= 1000 && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    && value < '9999-12-31', 'Date must be a real MySQL calendar date with a representable following day.');
  return value;
}

function configuration(argv, env) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return null;
  assert.ok(argv.length === 0 || (argv.length === 2 && argv[0] === '--date'), usage);
  const date = argv.length ? validDate(argv[1]) : undefined;
  assert.equal(env.DB_NAME, databaseName, `DB_NAME must be ${databaseName}.`);
  return { date, connection: {
    host: env.DB_HOST || 'localhost', port: env.DB_PORT || 3306,
    user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: env.DB_NAME,
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true,
    connectTimeout: 10000, multipleStatements: false,
  } };
}

// Retained independently as the previous production SQL, including its branch
// attribution. Do not derive this baseline by rewriting the candidate predicate.
function legacyPaymentQuery(date, branchId) {
  return {
    sql: `SELECT CAST(COALESCE(SUM(p.Amount), 0.00) AS CHAR) AS todayRevenue,
                 COUNT(p.PaymentID) AS todayPaymentsCount
          FROM PAYMENT p
          ${branchId === undefined ? '' : `JOIN (
            SELECT br.BookingID, MIN(r.BranchID) AS BranchID
            FROM BOOKED_ROOMS br
            JOIN ROOM r ON r.RoomID = br.RoomID
            GROUP BY br.BookingID
            HAVING COUNT(DISTINCT r.BranchID) = 1
          ) scope ON scope.BookingID = p.BookingID`}
          WHERE DATE(p.PaymentDate) = ?
          ${branchId === undefined ? '' : 'AND scope.BranchID = ?'}`,
    params: branchId === undefined ? [date] : [date, branchId],
  };
}

function totals(rows) {
  assert.ok(Array.isArray(rows) && rows.length === 1, 'Expected one payment aggregate.');
  const { todayRevenue, todayPaymentsCount } = rows[0];
  assert.ok(typeof todayRevenue === 'string' && /^(0|[1-9]\d*)\.\d{2}$/.test(todayRevenue),
    'Payment money must remain an exact decimal string.');
  assert.ok((typeof todayPaymentsCount === 'string' && /^(0|[1-9]\d*)$/.test(todayPaymentsCount))
    || (Number.isSafeInteger(todayPaymentsCount) && todayPaymentsCount >= 0), 'Invalid payment count.');
  return { todayRevenue, todayPaymentsCount: String(todayPaymentsCount) };
}

async function boundaryChecks(connection) {
  const days = [
    ['2024-02-27', '2024-02-28', '2024-02-29'], ['2024-02-28', '2024-02-29', '2024-03-01'],
    ['2026-12-30', '2026-12-31', '2027-01-01'],
  ];
  let checked = 0;
  for (const [previous, day, next] of days) {
    for (const [timestamp, expectedCount] of [
      [`${previous} 23:59:59.999999`, '0'], [`${day} 00:00:00.000000`, '1'], [`${day} 23:59:59.999999`, '1'],
      [`${next} 00:00:00.000000`, '0'], [null, '0'],
    ]) {
      const values = [];
      for (const build of [legacyPaymentQuery, dashboardPaymentQuery]) {
        const query = build(day);
        assert.ok(query.sql.includes('FROM PAYMENT p'), 'Payment query source changed; update the boundary fixture adapter.');
        const sql = query.sql.replace('FROM PAYMENT p', `FROM (
          SELECT CAST(? AS DATETIME(6)) AS PaymentDate,
                 CAST('1.00' AS DECIMAL(5,2)) AS Amount, 1 AS PaymentID
        ) p`);
        const [rows] = await connection.query(sql, [timestamp, ...query.params]);
        values.push(totals(rows));
      }
      assert.deepEqual(values[1], values[0], 'SQL boundary predicates returned different totals.');
      assert.equal(values[1].todayPaymentsCount, expectedCount, 'Unexpected SQL boundary inclusion.');
      assert.equal(values[1].todayRevenue, expectedCount === '1' ? '1.00' : '0.00', 'Unexpected SQL boundary amount.');
      checked += 1;
    }
  }
  return checked;
}

async function runEvidence({ argv = [], env = process.env, createConnection, output = console } = {}) {
  const config = configuration(argv, env);
  if (!config) { output.log(usage); return; }
  const connect = createConnection || require('mysql2/promise').createConnection;
  const connection = await connect(config.connection);
  let started = false, failure;
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    started = true;
    const [[info]] = await connection.query(`SELECT DATABASE() AS databaseName,
      DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS databaseToday, VERSION() AS mysqlVersion`);
    assert.equal(info?.databaseName?.toLowerCase(), databaseName.toLowerCase(), 'Unexpected selected database.');
    const date = config.date || validDate(info.databaseToday);
    output.table([{ database: info.databaseName, mysqlVersion: info.mysqlVersion, date }]);
    const [branches] = await connection.query('SELECT BranchID FROM BRANCH ORDER BY BranchID');
    const branchIds = branches.map(row => {
      const id = Number(row.BranchID);
      assert.ok(/^[1-9]\d*$/.test(String(row.BranchID)) && Number.isSafeInteger(id) && id <= 2147483647,
        'Invalid saved branch reference.');
      return id;
    });
    assert.equal(new Set(branchIds).size, branchIds.length, 'Duplicate saved branch references.');
    const scopes = [];
    for (const branchId of [undefined, ...branchIds]) {
      output.log(`Scope: ${branchId === undefined ? 'all branches' : `branch #${branchId}`}`);
      const values = [];
      for (const [label, build] of [['Before: DATE filter', legacyPaymentQuery], ['After: production range filter', dashboardPaymentQuery]]) {
        const query = build(date, branchId);
        const [plan] = await connection.query(`EXPLAIN FORMAT=TRADITIONAL ${query.sql}`, query.params);
        output.log(label);
        output.table(plan.map(row => Object.fromEntries(
          ['id', 'select_type', 'table', 'type', 'possible_keys', 'key', 'rows', 'Extra'].map(key => [key, row[key]])
        )));
        const [rows] = await connection.query(query.sql, query.params);
        const value = totals(rows);
        values.push(value);
        output.table([value]);
      }
      assert.deepEqual(values[1], values[0], 'Before/after payment totals or counts differ.');
      scopes.push({ branchId: branchId ?? 'all', ...values[1] });
    }
    const boundaries = await boundaryChecks(connection);
    await connection.query('ROLLBACK');
    started = false;
    output.log(`PASS: identical totals/counts for ${scopes.length} scopes and ${boundaries} SQL date boundary fixtures.`);
    output.log('READ ONLY: no hotel rows or login sessions were changed. EXPLAIN estimates are not measured execution times; index selection may vary with data.');
    return { date, scopes, boundaries };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (started) {
      try { await connection.query('ROLLBACK'); } catch { /* Closing the dedicated connection also ends the snapshot. */ }
    }
    try { await connection.end(); } catch (error) { if (!failure) throw error; }
  }
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  runEvidence({ argv: process.argv.slice(2) }).catch(error => {
    console.error(`FAIL: ${error.code && error.code !== 'ERR_ASSERTION' ? error.code : error.message}`);
    process.exitCode = 1;
  });
}
module.exports = { configuration, validDate, legacyPaymentQuery, totals, boundaryChecks, runEvidence };
