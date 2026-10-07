'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { run, formatFailure } = require('../add-grading-catalogue');

const envText = 'DB_HOST=localhost\nDB_PORT=3306\nDB_USER=skynest_app\nDB_PASSWORD=private-test-value\nDB_NAME=SkyNest_Integration_20261002\n';
const identitySql = 'SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser, CURRENT_ROLE() AS activeRoles, @@lower_case_table_names AS lowerCaseTableNames, @@GLOBAL.mandatory_roles AS mandatoryRoles';
const countSql = new Set([
  'SELECT CAST(COUNT(*) AS CHAR) AS total FROM BRANCH',
  'SELECT CAST(COUNT(*) AS CHAR) AS total FROM ROOM',
  'SELECT CAST(COUNT(DISTINCT RoomTypeID) AS CHAR) AS total FROM ROOM',
  'SELECT CAST(COUNT(*) AS CHAR) AS total FROM SERVICE_CATALOGUE',
  'SELECT CAST(COUNT(*) AS CHAR) AS total FROM GUEST',
  'SELECT CAST(COUNT(*) AS CHAR) AS total FROM BOOKING',
  "SELECT CAST(COUNT(*) AS CHAR) AS total FROM PAYMENT WHERE PaymentType = 'Partial'",
  'SELECT CAST(COUNT(*) AS CHAR) AS total FROM BOOKED_ROOMS',
  'SELECT CAST(COUNT(*) AS CHAR) AS total FROM SERVICE_USAGE',
  'SELECT CAST(COUNT(DISTINCT GuestID) AS CHAR) AS total FROM BOOKING',
]);
const sql = {
  branch: 'SELECT BranchID, Name FROM BRANCH WHERE Name = ?',
  type: 'SELECT RoomTypeID, Name FROM ROOM_TYPE WHERE Name = ?',
  room: 'SELECT RoomID, RoomTypeID, RoomNumber, RoomStatus FROM ROOM WHERE BranchID = ? AND RoomNumber = ?',
  service: 'SELECT ServiceID, ServiceName, Description, UnitPrice, IsActive FROM SERVICE_CATALOGUE WHERE ServiceName = ?',
  insertRoom: 'INSERT INTO ROOM (BranchID, RoomTypeID, RoomNumber) VALUES (?, ?, ?)',
  insertService: 'INSERT INTO SERVICE_CATALOGUE (ServiceName, Description, UnitPrice) VALUES (?, ?, ?)',
  lock: 'SELECT GET_LOCK(?, 0) AS acquired',
  unlock: 'SELECT RELEASE_LOCK(?) AS released',
};
const lockName = 'skynest.integration.grading-catalogue.v1';
const normalize = statement => statement.replace(/\s+/g, ' ').trim();
const clone = value => structuredClone(value);
function freshData() {
  return {
    branches: [{ BranchID: 21, Name: 'SkyNest Colombo' }, { BranchID: 29, Name: 'SkyNest Kandy' }, { BranchID: 35, Name: 'SkyNest Galle' }],
    types: [{ RoomTypeID: 14, Name: 'Single' }, { RoomTypeID: 18, Name: 'Double' }, { RoomTypeID: 26, Name: 'Suite' }],
    rooms: [], services: [],
  };
}
function mock(options = {}, data = freshData()) {
  const events = [];
  let snapshot, readOnly = false, inserts = 0;
  const failure = options.failure || new Error('private-test-value SQL path');
  return {
    events, data, failure,
    async query(statement) {
      const text = normalize(statement);
      events.push({ sql: text });
      if (text === options.failAt) throw failure;
      if (text === identitySql) return [[{ databaseName: 'skynest_integration_20261002', currentUser: 'skynest_app@localhost',
        activeRoles: 'NONE', lowerCaseTableNames: '1', mandatoryRoles: '', ...options.identity }]];
      if (countSql.has(text)) return [[{ total: '3' }]];
      if (text === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') return [[]];
      if (['START TRANSACTION', 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'].includes(text)) {
        assert.equal(snapshot, undefined, 'transactions must not nest');
        snapshot = clone(data);
        readOnly = text.includes('READ ONLY');
        return [[]];
      }
      if (text === 'ROLLBACK') {
        if (options.rollbackFails && events.some(event => event.sql.startsWith('INSERT '))) throw new Error('rollback private-test-value');
        if (snapshot) Object.assign(data, snapshot);
        snapshot = undefined;
        return [[]];
      }
      if (text === 'COMMIT') {
        assert.ok(snapshot);
        assert.equal(readOnly, false);
        if (!options.commitFailsBeforeSaving) snapshot = undefined;
        if (options.commitFails || options.commitFailsBeforeSaving) throw failure;
        return [[]];
      }
      assert.fail(`Unexpected SQL: ${text}`);
    },
    async execute(statement, params) {
      const text = normalize(statement);
      events.push({ sql: text, params: clone(params) });
      if (text === options.failAt) throw failure;
      if ([sql.lock, sql.unlock].includes(text)) {
        assert.deepEqual(params, [lockName]);
        if (text === sql.lock) return [[{ acquired: Object.hasOwn(options, 'lockResult') ? options.lockResult : 1 }]];
        return [[{ released: Object.hasOwn(options, 'releaseResult') ? options.releaseResult : 1 }]];
      }
      assert.ok(snapshot, 'catalogue access requires transaction');
      const collates = (left, right) => left.toLowerCase().trimEnd() === right.toLowerCase().trimEnd();
      if (text === sql.branch) return [clone(data.branches.filter(row => collates(row.Name, params[0])))];
      if (text === sql.type) return [clone(data.types.filter(row => collates(row.Name, params[0])))];
      if (text === sql.room) return [clone(data.rooms.filter(row => row.BranchID === params[0] && collates(row.RoomNumber, params[1])))];
      if (text === sql.service) return [clone(data.services.filter(row => collates(row.ServiceName, params[0])))];
      assert.ok([sql.insertRoom, sql.insertService].includes(text), `Unexpected SQL: ${text}`);
      assert.equal(readOnly, false, 'dry run must never write');
      inserts++;
      if (inserts === options.failInsert) throw failure;
      const insertId = 100 + inserts;
      if (text === sql.insertRoom) {
        assert.equal(params.length, 3);
        data.rooms.push({ RoomID: insertId, BranchID: params[0], RoomTypeID: params[1], RoomNumber: params[2], RoomStatus: 'Available' });
      } else {
        assert.equal(params.length, 3);
        data.services.push({ ServiceID: insertId, ServiceName: params[0], Description: params[1], UnitPrice: params[2].toFixed(2), IsActive: 1 });
      }
      return [{ affectedRows: 1, insertId }];
    },
    async end() { events.push({ sql: 'END' }); if (options.endFails) throw new Error('end private-test-value'); },
  };
}
function harness(connection, overrides = {}) {
  const emitted = [];
  const emit = value => { assert.equal(connection.events.at(-1)?.sql, 'END'); emitted.push(value); };
  return { emitted, options: {
    argv: [], shellEnv: {},
    readFile(file, encoding) { assert.equal(file, path.resolve(__dirname, '../.env')); assert.equal(encoding, 'utf8'); return envText; },
    createConnection(settings) { assert.equal(settings.user, 'skynest_app'); assert.equal(settings.multipleStatements, false); return connection; },
    output: { log: emit, table: emit }, ...overrides,
  } };
}
const mutations = connection => connection.events.filter(event => event.sql.startsWith('INSERT '));
async function fails(connection, pattern, overrides = {}) {
  const test = harness(connection, { argv: ['--apply'], ...overrides });
  let error;
  await assert.rejects(run(test.options), caught => {
    error = caught;
    assert.match(formatFailure(caught), pattern);
    assert.ok(!formatFailure(caught).includes('private-test-value'));
    return true;
  });
  assert.equal(connection.events.at(-1)?.sql, 'END');
  assert.deepEqual(test.emitted, []);
  return error;
}

(async () => {
  const dry = mock();
  const dryResult = await run(harness(dry).options);
  assert.equal(dryResult.applied, false);
  assert.deepEqual(dryResult.plan.map(item => item.action), Array(5).fill('ADD'));
  assert.equal(mutations(dry).length, 0);
  assert.ok(!dry.events.some(event => [sql.lock, sql.unlock, 'COMMIT', 'START TRANSACTION'].includes(event.sql)));
  assert.equal(dry.events.filter(event => event.sql === 'ROLLBACK').length, 2);

  const first = mock({ lockResult: '1', releaseResult: '1' });
  const firstResult = await run(harness(first, { argv: ['--apply'] }).options);
  assert.deepEqual(firstResult.plan.map(item => item.action), Array(5).fill('ADDED'));
  assert.deepEqual(mutations(first).map(event => [event.sql, event.params]), [
    [sql.insertRoom, [21, 18, '202']], [sql.insertRoom, [29, 26, '201']], [sql.insertRoom, [35, 14, '102']],
    [sql.insertService, ['Breakfast Buffet', 'Per guest, per breakfast', 1500]],
    [sql.insertService, ['Airport Transfer', 'Per vehicle, one-way transfer', 4500]],
  ]);
  const statements = first.events.map(event => event.sql);
  assert.ok(statements.indexOf(sql.lock) > statements.indexOf('ROLLBACK'), 'verification finishes before named lock');
  assert.ok(statements.indexOf(sql.lock) < statements.indexOf('START TRANSACTION'));
  assert.ok(statements.lastIndexOf(sql.service) < statements.indexOf(sql.insertRoom), 'all five records preflight before first write');
  assert.deepEqual(statements.slice(-3), ['COMMIT', sql.unlock, 'END']);
  const saved = clone(first.data);
  for (const RoomStatus of ['Available', 'Occupied', 'Maintenance']) {
    const data = clone(saved); data.rooms[0].RoomStatus = RoomStatus;
    const repeat = mock({}, data);
    const result = await run(harness(repeat, { argv: ['--apply'] }).options);
    assert.deepEqual(result.plan.map(item => item.action), Array(5).fill('SKIP'));
    assert.equal(mutations(repeat).length, 0);
    assert.equal(data.rooms[0].RoomStatus, RoomStatus);
  }
  const partial = clone(saved); partial.rooms.splice(1, 1); partial.services.splice(0, 1);
  const resume = mock({}, partial);
  assert.deepEqual((await run(harness(resume, { argv: ['--apply'] }).options)).plan.map(item => item.action), ['SKIP', 'ADDED', 'SKIP', 'ADDED', 'SKIP']);
  assert.equal(mutations(resume).length, 2);

  for (const change of [
    data => { data.services[1].IsActive = 0; },
    data => { data.services[1].Description = 'Existing custom description'; },
    data => { data.services[1].UnitPrice = '4499.00'; },
    data => { data.services[1].ServiceName = 'airport transfer'; },
    data => { data.services.push(clone(data.services[1])); },
    data => { data.rooms[0].RoomTypeID = 14; },
    data => { data.rooms[0].RoomStatus = 'Unexpected'; },
    data => { data.rooms.push(clone(data.rooms[0])); },
    data => { data.branches.splice(0, 1); },
    data => { data.branches[0].Name = 'skynest colombo'; },
    data => { data.branches.push(clone(data.branches[0])); },
    data => { data.types.splice(1, 1); },
    data => { data.types.push(clone(data.types[1])); },
  ]) {
    const data = clone(saved); change(data);
    const before = clone(data);
    const conflict = mock({}, data);
    await fails(conflict, /CATALOGUE_PREFLIGHT \(CATALOGUE_CONFLICT\)/);
    assert.equal(mutations(conflict).length, 0);
    assert.deepEqual(data, before);
  }
  // A late conflict must also prevent the earlier missing rooms from being inserted.
  const late = freshData(); late.services.push({ ...saved.services[1], IsActive: 0 });
  const lateConflict = mock({}, late);
  await fails(lateConflict, /CATALOGUE_PREFLIGHT/);
  assert.equal(mutations(lateConflict).length, 0);

  for (const lockResult of [0, '0', null, undefined, true, false, '01', ' 1', '1.0', 2]) {
    const denied = mock({ lockResult });
    await fails(denied, /CATALOGUE_LOCK \((CATALOGUE_BUSY|LOCK_RESULT_INVALID)\)/);
    assert.equal(mutations(denied).length, 0);
    assert.ok(!denied.events.some(event => event.sql === 'START TRANSACTION'));
    assert.deepEqual(denied.events.slice(-2).map(event => event.sql), [sql.unlock, 'END']);
  }
  const lostLock = mock({ failAt: sql.lock });
  await fails(lostLock, /CATALOGUE_LOCK/);
  assert.deepEqual(lostLock.events.slice(-2).map(event => event.sql), [sql.unlock, 'END']);

  const midInsert = mock({ failInsert: 2 });
  assert.equal(await fails(midInsert, /Transaction rolled back; no catalogue rows were added/), midInsert.failure);
  assert.deepEqual(midInsert.data, freshData());
  assert.deepEqual(midInsert.events.slice(-3).map(event => event.sql), ['ROLLBACK', sql.unlock, 'END']);
  const cleanupFailures = mock({ failInsert: 2, rollbackFails: true, endFails: true });
  assert.equal(await fails(cleanupFailures, /CATALOGUE_INSERT.*Rollback was not confirmed/), cleanupFailures.failure);

  for (const option of ['commitFails', 'commitFailsBeforeSaving']) {
    const unknown = mock({ [option]: true });
    assert.equal(await fails(unknown, /CATALOGUE_COMMIT.*Commit outcome is unknown/), unknown.failure);
    assert.equal(mutations(unknown).length, 5, 'no mutation is automatically retried');
    assert.deepEqual(unknown.events.slice(-3).map(event => event.sql), ['ROLLBACK', sql.unlock, 'END']);
    assert.equal(unknown.data.rooms.length, option === 'commitFails' ? 3 : 0);
    const inspect = mock({}, unknown.data);
    const result = await run(harness(inspect).options);
    assert.deepEqual(result.plan.map(item => item.action), Array(5).fill(option === 'commitFails' ? 'SKIP' : 'ADD'));
    assert.equal(mutations(inspect).length, 0);
  }
  for (const options of [{ endFails: true }, { failAt: sql.unlock }, { releaseResult: 0 }]) {
    const afterCommit = mock(options);
    await fails(afterCommit, /Catalogue commit was acknowledged/);
    assert.equal(afterCommit.data.rooms.length, 3);
    assert.equal(afterCommit.data.services.length, 2);
  }
  for (const identity of [{ currentUser: 'root@localhost' }, { databaseName: 'OtherDatabase' },
    { lowerCaseTableNames: '0' }, { activeRoles: 'some_role' }, { mandatoryRoles: 'some_role' }]) {
    const wrongTarget = mock({ identity });
    await fails(wrongTarget, /TARGET_VERIFICATION/);
    assert.ok(!wrongTarget.events.some(event => event.sql === sql.lock));
    assert.equal(mutations(wrongTarget).length, 0);
  }
  const nativeError = Object.assign(new Error('private-test-value'), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
  await fails(mock({ failAt: sql.branch, failure: nativeError }), /CATALOGUE_PREFLIGHT \(ER_TABLEACCESS_DENIED_ERROR\)/);
  assert.ok(!formatFailure(Object.assign(new Error('private-test-value'), { code: 'private-test-value' })).includes('private-test-value'));

  for (const argv of [['--help'], ['-h']]) {
    const help = [];
    assert.equal((await run({ argv, shellEnv: { DB_USER: 'root' }, readFile() { assert.fail('help must not read files'); },
      createConnection() { assert.fail('help must not connect'); }, output: { log(value) { help.push(value); } } })).exitCode, 0);
    assert.match(help[0], /Default: read-only/);
  }
  for (const argv of [['--reset'], ['--apply', '--apply'], ['--apply', '--help']]) {
    await assert.rejects(run({ argv, readFile() { assert.fail('invalid args must not read files'); } }), error => /ARGUMENTS_INVALID/.test(formatFailure(error)));
  }
  for (const overrides of [
    { shellEnv: { DB_USER: 'root' }, readFile() { assert.fail('overrides must be rejected before file read'); } },
    { readFile: () => envText.replace('skynest_app', 'root') },
    { readFile: () => envText.replace('localhost', 'remote.example') },
    { readFile: () => envText.replace('SkyNest_Integration_20261002', 'SkyNest_Hotels') },
  ]) {
    await assert.rejects(run({ shellEnv: {}, ...overrides, createConnection() { assert.fail('invalid config must not connect'); } }), error => /CONFIGURATION/.test(formatFailure(error)));
  }
  await assert.rejects(run({ shellEnv: {}, readFile: () => envText,
    createConnection() { throw Object.assign(new Error('private-test-value'), { code: 'ECONNREFUSED' }); } }),
  error => /CONNECTION \(ECONNREFUSED\)/.test(formatFailure(error)));
  console.log('PASS: catalogue dry-run, exact insert columns, target checks, named locking, conflict preflight, rerun skips, rollback, uncertain commits and cleanup. No live database used.');
})().catch(error => { console.error(error); process.exitCode = 1; });
