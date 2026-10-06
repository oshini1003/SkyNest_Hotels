const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TARGET_DATABASE, schemaObjects, verifyObject, installBookingUpdate,
} = require('../Database/addBookingUpdate');

// No server, credentials or row writes: fake connection exercises installation
// gates/failures. SQL assertions below check source contracts, not live locking.
const objects = schemaObjects();
const names = objects.map(object => object.name);
assert.deepEqual(names, ['trg_validate_check_in_dates', 'trg_prevent_overlap_booking_update', 'sp_update_booked_room']);
const definer = 'CREATE DEFINER=`local_admin`@`localhost` ';
const serverSql = sql => sql.replace(/^CREATE /, definer);

function fakeConnection(options = {}) {
  const state = new Map(options.existing || []);
  const calls = [];
  const created = [];
  const connection = {
    state, calls, created,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT DATABASE()')) return [[{
        databaseName: options.databaseName ?? TARGET_DATABASE,
        lowerCaseTableNames: options.lowerCaseTableNames ?? 0,
      }]];
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: options.lock ?? 1 }]];
      if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
      if (sql.includes('FROM INFORMATION_SCHEMA.')) return [state.has(params[0]) ? [{ present: 1 }] : []];
      if (sql.startsWith('SHOW CREATE')) {
        const name = sql.match(/\.\`([^`]+)\`$/)?.[1];
        assert.ok(state.has(name), 'SHOW CREATE must target an existing, fixed-name object.');
        const key = sql.startsWith('SHOW CREATE TRIGGER') ? 'SQL Original Statement' : 'Create Procedure';
        return [[options.hidden === name ? {} : { [key]: state.get(name) }]];
      }
      const object = objects.find(candidate => candidate.sql === sql);
      assert.ok(object, `Unexpected SQL (no DML, DROP, reset or arbitrary DDL allowed): ${sql}`);
      assert.equal(state.has(object.name), false, 'Never overwrite an existing object.');
      if (options.failCreate === object.name) throw Object.assign(new Error('simulated DDL failure'), { code: 'ER_TEST' });
      state.set(object.name, options.createdSql?.(object) ?? serverSql(sql));
      created.push(object.name);
      return [{}];
    },
    async execute(sql, params) { return this.query(sql, params); },
  };
  return connection;
}
const run = (connection, overrides = {}) => installBookingUpdate({
  connection, database: TARGET_DATABASE, backendStopped: true, log() {}, ...overrides,
});
const allExisting = () => objects.map(object => [object.name, serverSql(object.sql)]);
const wasReleased = connection => connection.calls.some(call => call.sql.startsWith('SELECT RELEASE_LOCK'));

(async () => {
  // Wrong configured target and missing stopped-backend acknowledgement do not
  // query MySQL. Server identity is checked independently before any DDL.
  for (const override of [{ database: 'SkyNest_Hotels' }, { database: TARGET_DATABASE.toLowerCase() },
    { backendStopped: false }, { backendStopped: undefined }]) {
    const connection = fakeConnection();
    await assert.rejects(run(connection, override));
    assert.equal(connection.calls.length, 0);
  }
  for (const options of [{ databaseName: 'other_database' },
    { databaseName: TARGET_DATABASE.toLowerCase(), lowerCaseTableNames: 0 },
    { lowerCaseTableNames: 9 }, { lock: 0 }, { lock: null }]) {
    const connection = fakeConnection(options);
    // null models failed lock acquisition rather than the fixture's default.
    if (options.lock === null) {
      const query = connection.query.bind(connection);
      connection.query = async (sql, params) => sql.startsWith('SELECT GET_LOCK')
        ? [[{ acquired: null }]] : query(sql, params);
    }
    await assert.rejects(run(connection));
    assert.equal(connection.created.length, 0);
  }

  const fresh = fakeConnection();
  assert.deepEqual(await run(fresh), { added: names, verified: names });
  assert.deepEqual(fresh.created, names, 'Install the check-in guard before the edit procedure.');
  assert.ok(wasReleased(fresh));
  const before = fresh.calls.length;
  assert.deepEqual(await run(fresh), { added: [], verified: names });
  assert.equal(fresh.created.length, 3);
  assert.ok(fresh.calls.slice(before).some(call => call.sql.startsWith('SHOW CREATE')));

  const oldInstall = fakeConnection({ existing: allExisting().slice(1) });
  assert.deepEqual((await run(oldInstall)).added, [names[0]], 'An earlier installation needs only the new guard.');

  // Real SHOW CREATE uses a definer and quoted object names. MySQL on Windows
  // also folds table names; do not fold message literals or Linux table names.
  for (const lowerCaseTableNames of [1, 2]) {
    const windows = fakeConnection({
      databaseName: TARGET_DATABASE.toLowerCase(), lowerCaseTableNames,
      existing: objects.map(object => [object.name, serverSql(object.sql)
        .replace(` ${object.type} ${object.name}`, ` ${object.type.toLowerCase()} \`${object.name}\``)
        .replace(/\b(BOOKING|BOOKED_ROOMS|ROOM_TYPE|ROOM)\b/g, table => `\`${table.toLowerCase()}\``)
        .replace(/\bINT\b/g, 'int')]),
    });
    assert.deepEqual((await run(windows)).added, []);
  }
  for (const object of objects) {
    verifyObject(serverSql(object.sql).replace(/\n/g, '\r\n'), object, false);
  }
  const checkin = objects[0];
  assert.throws(() => verifyObject(serverSql(checkin.sql).replace("'Booked'", "'booked'"), checkin, true), /differs/);
  assert.throws(() => verifyObject(serverSql(checkin.sql).replace('BEFORE UPDATE', 'AFTER UPDATE'), checkin, false), /differs/);
  assert.throws(() => verifyObject(serverSql(checkin.sql).replace('ON BOOKING', 'ON ROOM'), checkin, false), /differs/);
  assert.throws(() => verifyObject(serverSql(checkin.sql).replace('ON BOOKING', 'ON booking'), checkin, false), /differs/);
  assert.throws(() => verifyObject(checkin.sql, checkin, false), /Cannot verify/);
  assert.throws(() => verifyObject(serverSql(objects[2].sql).replace('p_new_guest_count INT', 'p_new_guest_count VARCHAR(10)'), objects[2], false), /differs/);

  // Preflight even the last object before creating the missing first guard.
  const incompatible = fakeConnection({ existing: [[names[2], serverSql(objects[2].sql).replace("'Booked'", "'Cancelled'")]] });
  await assert.rejects(run(incompatible), /differs/);
  assert.equal(incompatible.created.length, 0);
  assert.ok(wasReleased(incompatible));
  const hidden = fakeConnection({ existing: allExisting().slice(1), hidden: names[2] });
  await assert.rejects(run(hidden), /Cannot read/);
  assert.equal(hidden.created.length, 0);
  assert.ok(wasReleased(hidden));

  // MySQL DDL can commit individually. A failure leaves created objects intact,
  // stops immediately and releases the installer lock. A later matching rerun
  // verifies the partial installation and adds only missing objects.
  const partial = fakeConnection({ failCreate: names[1] });
  await assert.rejects(run(partial), /simulated DDL failure/);
  assert.deepEqual(partial.created, [names[0]]);
  assert.ok(wasReleased(partial));
  const resumed = fakeConnection({ existing: partial.state });
  assert.deepEqual((await run(resumed)).added, names.slice(1));
  const badReadback = fakeConnection({ createdSql: object => serverSql(object.sql).replace('BEFORE UPDATE', 'AFTER UPDATE') });
  await assert.rejects(run(badReadback), /differs/);
  assert.deepEqual(badReadback.created, [names[0]]);
  assert.ok(wasReleased(badReadback));

  // Static SQL contract: state transition guarded before changes, current date
  // reads under the parent booking lock. This does not simulate a MySQL race.
  assert.match(checkin.sql, /BEFORE UPDATE ON BOOKING/);
  assert.match(checkin.sql, /NEW\.BookingStatus = 'Checked-In' AND OLD\.BookingStatus <> 'Checked-In'/);
  assert.match(checkin.sql, /OLD\.BookingStatus <> 'Booked'/);
  assert.match(checkin.sql, /IF v_room_id IS NULL THEN/);
  assert.match(checkin.sql, /DATE\(CheckInDateTime\) > CURDATE\(\)/);
  assert.match(checkin.sql, /DATE\(CheckOutDateTime\) <= CURDATE\(\)/);
  assert.equal((checkin.sql.match(/LIMIT 1 FOR SHARE/g) || []).length, 2);
  const setup = fs.readFileSync(path.join(__dirname, '../Database/setupIntegrationDb.js'), 'utf8');
  assert.match(setup, /Number\(counts\.triggers_count\) !== 8/);

  console.log('PASS: exact database/stopped-backend gates, Windows identifier rules, definition preflight, guard-first install, no overwrite or row writes, idempotence, partial-failure recovery and check-in SQL contracts (mock connection/static SQL; no live MySQL).');
})().catch(error => { console.error(error); process.exitCode = 1; });
