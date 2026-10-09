const assert = require('node:assert/strict');
const http = require('node:http');

// Real Express routes and scope middleware, independent catalogue fixtures, fake
// token verification and database. SQL assertions do not execute live MySQL.
const staff = [
  { StaffID: 1, Role: 'Admin', BranchID: null, BranchName: null },
  { StaffID: 2, Role: 'Manager', BranchID: 1, BranchName: 'Colombo' },
  { StaffID: 3, Role: 'Receptionist', BranchID: 1, BranchName: 'Colombo' },
  { StaffID: 4, Role: 'ServiceStaff', BranchID: 1, BranchName: 'Colombo' },
];
const tokens = Object.fromEntries(staff.map(row => [row.Role.toLowerCase(),
  { type: 'staff', id: row.StaffID, role: row.Role, branchId: row.BranchID }]));
tokens.guest = { type: 'guest', id: 1 };
tokens.malformed = { ...tokens.manager, id: '2' };
const fixtures = [
  { ServiceID: 1, ServiceName: 'Laundry', Description: 'Per item', UnitPrice: '12.30', IsActive: 1 },
  { ServiceID: 2, ServiceName: 'Transfer', Description: null, UnitPrice: '1500.00', IsActive: 0 },
];
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = row => ({ ...row, IsActive: Boolean(row.IsActive) });
const expected = row => { const { ServiceID, ...snapshot } = canonical(row); return snapshot; };
const update = (changes = {}) => ({ serviceName: 'Laundry', description: 'Per item',
  unitPrice: '12.30', isActive: true, expected: expected(fixtures[0]), ...changes });
const creation = { serviceName: 'Breakfast', description: null, unitPrice: '150.20' };
let options, saved, pending, events, sqlCalls, forwarded;
function reset(next = {}) {
  options = next; saved = clone(fixtures); pending = null; events = []; sqlCalls = []; forwarded = [];
}
const primaryFailure = Object.assign(new Error('Private database SQL and credentials'), { code: 'ER_TEST_FAILURE' });
function record(sql, params = [], source = 'connection') {
  sqlCalls.push({ sql, params, source });
  assert.equal((sql.match(/\?/g) || []).length, params.length, 'All dynamic values must use placeholders.');
  if (options.failSql && sql.includes(options.failSql)) throw options.error || primaryFailure;
}
function currentStaff(params, locked) {
  if (locked ? options.missingLockedStaff : options.missingStaff) return [];
  const row = staff.find(item => item.StaffID === params[0]);
  return row ? [{ ...row, ...(locked ? options.lockedStaff : options.scopeStaff) }] : [];
}
async function execute(sql, params = []) {
  record(sql, params);
  if (/FROM STAFF s\s+JOIN STAFF_ACCOUNT/.test(sql)) {
    events.push('STAFF');
    if (events.includes('BEGIN')) assert.match(sql, /FOR SHARE/);
    else assert.doesNotMatch(sql, /FOR SHARE|FOR UPDATE/);
    return [currentStaff(params, true)];
  }
  if (/^\s*SELECT\b/.test(sql) && /FROM SERVICE_CATALOGUE/.test(sql)) {
    events.push('READ');
    assert.match(sql, /CAST\(UnitPrice AS CHAR\)/);
    let rows = pending || saved;
    if (/WHERE ServiceID = \?/.test(sql)) { assert.match(sql, /FOR UPDATE/); rows = rows.filter(row => row.ServiceID === params[0]); }
    else { assert.match(sql, /ORDER BY ServiceName\s*,\s*ServiceID/); assert.doesNotMatch(sql, /WHERE IsActive/); }
    return [clone(options.rows || rows)];
  }
  if (/^\s*INSERT/.test(sql)) {
    events.push('INSERT'); assert.ok(pending); assert.match(sql,
      /INSERT INTO SERVICE_CATALOGUE\s*\(ServiceName, Description, UnitPrice\)\s*VALUES\s*\(\?, \?, \?\)/);
    assert.equal(typeof params[2], 'string');
    pending.push({ ServiceID: 22, ServiceName: params[0], Description: params[1], UnitPrice: params[2], IsActive: 1 });
    return [options.writeResult || { affectedRows: 1, insertId: 22 }];
  }
  if (/^\s*UPDATE/.test(sql)) {
    events.push('UPDATE'); assert.ok(pending); assert.match(sql,
      /UPDATE SERVICE_CATALOGUE\s+SET ServiceName = \?, Description = \?, UnitPrice = \?, IsActive = \?\s+WHERE ServiceID = \?/);
    assert.equal(typeof params[2], 'string');
    const row = pending.find(item => item.ServiceID === params[4]); assert.ok(row);
    Object.assign(row, { ServiceName: params[0], Description: params[1], UnitPrice: params[2], IsActive: Number(params[3]) });
    return [options.writeResult || { affectedRows: 1 }];
  }
  throw new Error(`Unexpected SQL in management route: ${sql}`);
}
const connection = {
  execute,
  async query(sql, params = []) {
    if (/^SET TRANSACTION/.test(sql)) {
      record(sql, params); assert.equal(sql, 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); events.push('ISOLATION'); return [[]];
    }
    if (/^START TRANSACTION/.test(sql)) {
      record(sql, params); assert.equal(sql, 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      events.push('READONLY'); pending = clone(saved); return [[]];
    }
    return execute(sql, params);
  },
  async beginTransaction() { events.push('BEGIN'); if (options.failBegin) throw primaryFailure; pending = clone(saved); },
  async commit() {
    events.push('COMMIT'); if (options.failCommit) throw options.error || primaryFailure;
    saved = pending; pending = null;
  },
  async rollback() { events.push('ROLLBACK'); pending = null; if (options.failRollback) throw new Error('Cleanup failed'); },
  release() { events.push('RELEASE'); if (options.failRelease) throw new Error('Release failed'); },
  destroy() { events.push('DESTROY'); },
};
const pool = {
  async execute(sql, params = []) {
    record(sql, params, 'pool');
    if (/FROM STAFF s JOIN STAFF_ACCOUNT/.test(sql)) { events.push('SCOPE'); return [currentStaff(params, false)]; }
    assert.equal(sql, 'SELECT * FROM SERVICE_CATALOGUE WHERE IsActive = TRUE ORDER BY ServiceName');
    events.push('PUBLIC'); return [clone(saved.filter(row => row.IsActive))];
  },
  async getConnection() { events.push('CONNECT'); if (options.failConnect) throw options.error || primaryFailure; return connection; },
};
require.cache[require.resolve('../config/db')] = { exports: pool };
require.cache[require.resolve('../config/auth')] = { exports: { verifyAccessToken(token) {
  if (!Object.hasOwn(tokens, token)) throw new Error('Invalid test token'); return tokens[token];
} } };
const express = require('express'); const app = express();
app.use('/api', require('../routes/serviceRoutes'));
app.use((error, req, res, next) => {
  void req; void next; forwarded.push(error); res.status(500).json({ error: 'Internal server error.' });
});
function request(method = 'GET', url = '/api/management/services', body, token = 'manager') {
  return new Promise((resolve, reject) => {
    const req = new http.IncomingMessage(null); req.method = method; req.url = url; req.body = body;
    req.headers = token ? { authorization: `Bearer ${token}` } : {};
    const res = new http.ServerResponse(req);
    res.end = function(chunk) {
      try { resolve({ status: this.statusCode, body: JSON.parse(String(chunk)), headers: this.getHeaders() }); }
      catch (error) { reject(error); }
      return this;
    };
    app.handle(req, res);
  });
}
function noWrite() {
  assert.deepEqual(saved, fixtures);
  assert.ok(!events.includes('INSERT') && !events.includes('UPDATE'));
}
async function run() {
  const { validate } = require('../test-service-catalogue');
  assert.deepEqual(validate([fixtures[0]], false), [canonical(fixtures[0])]);
  assert.deepEqual(validate([{ ...fixtures[0], UnitPrice: 12.3 }], false), [canonical(fixtures[0])]);
  assert.deepEqual(validate([...fixtures].reverse().map(canonical), true), fixtures.map(canonical));
  assert.deepEqual(validate([], true), []);
  assert.throws(() => validate([fixtures[1]], false), /inactive/);
  for (const rows of [null, [null], [fixtures[0], fixtures[0]], [{ ...fixtures[0], ServiceID: '1' }],
    [{ ...fixtures[0], UnitPrice: '1e2' }], [{ ...fixtures[0], Description: 5 }]]) assert.throws(() => validate(rows, false));
  for (const broken of [{ UnitPrice: 12.3 }, { UnitPrice: '12.3' }, { IsActive: 1 }]) {
    assert.throws(() => validate([{ ...canonical(fixtures[0]), ...broken }], true));
  }
  for (const [method, url, body] of [['GET', '/api/management/services'], ['POST', '/api/services', creation], ['PUT', '/api/services/1', update()]]) {
    for (const [token, code] of [[null, 401], ['invalid', 401], ['guest', 403], ['receptionist', 403], ['servicestaff', 403], ['malformed', 401]]) {
      reset(); assert.equal((await request(method, url, body, token)).status, code); noWrite(); assert.ok(!events.includes('CONNECT'));
    }
    for (const changed of [{ missingStaff: true }, { scopeStaff: { Role: 'Receptionist' } }, { scopeStaff: { BranchID: 2 } }]) {
      reset(changed); assert.equal((await request(method, url, body)).status, 401); assert.deepEqual(events, ['SCOPE']);
    }
  }
  reset(); assert.deepEqual((await request('GET', '/api/services', undefined, null)).body, [fixtures[0]]);
  assert.deepEqual(events, ['PUBLIC']);
  for (const token of ['manager', 'admin']) {
    reset(); const response = await request('GET', '/api/management/services', undefined, token);
    assert.equal(response.status, 200); assert.deepEqual(response.body, fixtures.map(canonical));
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(events, ['SCOPE', 'CONNECT', 'ISOLATION', 'READONLY', 'STAFF', 'READ', 'COMMIT', 'RELEASE']); noWrite();
  }
  reset(); assert.equal((await request('GET', '/api/management/services?active=true')).status, 400); noWrite();
  for (const body of [undefined, null, [], {}, { ...creation, isActive: false }, { ...creation, actorId: 1 },
    { ...creation, serviceName: '' }, { ...creation, serviceName: 'a'.repeat(101) }, { ...creation, serviceName: 'A\nB' },
    { ...creation, description: 4 }, { ...creation, description: 'a'.repeat(256) }, { ...creation, description: 'bad\u0000text' }]) {
    reset(); assert.equal((await request('POST', '/api/services', body)).status, 400); assert.deepEqual(events, ['SCOPE']);
  }
  for (const price of [12.30, null, true, '', '-1.00', '01.00', '1e2', '1,000', '1.001', '100000000.00', 'Infinity']) {
    reset(); assert.equal((await request('POST', '/api/services', { ...creation, unitPrice: price })).status, 400); assert.deepEqual(events, ['SCOPE']);
  }
  for (const id of ['0', '-1', '01', '1.0', '2147483648', 'abc']) {
    reset(); assert.equal((await request('PUT', `/api/services/${id}`, update())).status, 400); assert.deepEqual(events, ['SCOPE']);
  }
  for (const body of [update({ isActive: 1 }), update({ isActive: 'false' }), update({ expected: null }),
    update({ expected: { ...expected(fixtures[0]), UnitPrice: '12.3' } }), update({ unknown: 1 }),
    update({ expected: { ...expected(fixtures[0]), extra: 1 } })]) {
    reset(); assert.equal((await request('PUT', '/api/services/1', body)).status, 400); assert.deepEqual(events, ['SCOPE']);
  }
  for (const [price, normalized] of [['0', '0.00'], ['0.01', '0.01'], ['12.3', '12.30'], ['99999999.99', '99999999.99']]) {
    reset(); const result = await request('POST', '/api/services', { ...creation, serviceName: "  Chef's special ?  ", description: '  ', unitPrice: price });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, { saved: true, service: { ServiceID: 22, ServiceName: "Chef's special ?", Description: null, UnitPrice: normalized, IsActive: true } });
    assert.deepEqual(events, ['SCOPE', 'CONNECT', 'BEGIN', 'STAFF', 'INSERT', 'COMMIT', 'RELEASE']);
    const write = sqlCalls.find(item => /^\s*INSERT/.test(item.sql)); assert.deepEqual(write.params, ["Chef's special ?", null, normalized]);
    assert.doesNotMatch(write.sql, /Chef|99999999/);
  }
  reset(); let result = await request('PUT', '/api/services/1', update({ unitPrice: '99.01', description: null, isActive: false }));
  assert.equal(result.status, 200); assert.deepEqual(result.body, { saved: true, service: { ServiceID: 1, ServiceName: 'Laundry', Description: null, UnitPrice: '99.01', IsActive: false } });
  assert.deepEqual(events, ['SCOPE', 'CONNECT', 'BEGIN', 'STAFF', 'READ', 'UPDATE', 'COMMIT', 'RELEASE']);
  reset(); result = await request('PUT', '/api/services/2', update({ serviceName: 'Transfer', description: null, unitPrice: '1500', expected: expected(fixtures[1]) }));
  assert.equal(result.status, 200); assert.equal(result.body.service.IsActive, true);
  for (const changed of [{ ServiceName: 'Different' }, { Description: null }, { UnitPrice: '1.00' }, { IsActive: false }]) {
    reset(); assert.equal((await request('PUT', '/api/services/1', update({ expected: { ...expected(fixtures[0]), ...changed } }))).status, 409);
    noWrite(); assert.ok(events.includes('ROLLBACK'));
  }
  reset(); assert.equal((await request('PUT', '/api/services/99', update())).status, 404); noWrite();
  for (const changed of [{ missingLockedStaff: true }, { lockedStaff: { Role: 'Receptionist' } }, { lockedStaff: { BranchID: 2 } }]) {
    reset(changed); assert.equal((await request('POST', '/api/services', creation)).status, 401); noWrite(); assert.ok(events.includes('ROLLBACK'));
    reset(changed); assert.equal((await request()).status, 401); assert.ok(!events.includes('READ')); noWrite();
  }
  for (const fault of [{ failConnect: true }, { failBegin: true }, { failSql: 'INSERT' },
    { failSql: 'INSERT', failRollback: true, failRelease: true }, { failCommit: true }]) {
    reset(fault); result = await request('POST', '/api/services', creation);
    assert.equal(result.status, 500); assert.deepEqual(result.body, { error: 'Internal server error.' });
    assert.equal(forwarded.length, 1); assert.ok(!JSON.stringify(result.body).includes('Private'));
    assert.equal(forwarded[0].message, 'The service catalogue request could not be completed.');
    let cause = forwarded[0]; while (cause.cause) cause = cause.cause;
    assert.equal(cause, primaryFailure, 'Cleanup must retain the primary failure privately.');
    assert.ok(events.filter(event => event === 'INSERT').length <= 1, 'Never retry a failed or uncertain save.');
    if (fault.failCommit) { assert.ok(events.includes('DESTROY')); assert.ok(!events.includes('RELEASE')); }
  }
  reset({ failRelease: true }); result = await request('POST', '/api/services', creation);
  assert.equal(result.status, 201, 'A confirmed commit must remain acknowledged even if release fails.');
  assert.equal(result.body.saved, true); assert.equal(forwarded.length, 0);
  for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']) {
    reset({ failSql: 'INSERT', error: Object.assign(new Error('Private SQL'), { code }) });
    assert.equal((await request('POST', '/api/services', creation)).status, 409); noWrite();
  }
  for (const stage of ['failConnect', 'failCommit']) {
    for (const details of [{ code: 'ER_DUP_ENTRY' }, { sqlState: '45000', sqlMessage: 'Private SQL' }]) {
      reset({ [stage]: true, error: Object.assign(new Error('Private SQL'), details) });
      assert.equal((await request('POST', '/api/services', creation)).status, 500);
      assert.equal(forwarded[0].code, undefined); assert.equal(forwarded[0].sqlState, undefined);
    }
  }
  reset({ failRollback: true }); assert.equal((await request('PUT', '/api/services/99', update())).status, 404);
  assert.ok(events.includes('DESTROY')); noWrite();
  for (const broken of [{ UnitPrice: 12.3 }, { IsActive: 2 }, { ServiceID: '1' }, { UnitPrice: '12.3' }]) {
    reset({ rows: [{ ...fixtures[0], ...broken }] }); assert.equal((await request()).status, 500); noWrite();
  }
  reset({ writeResult: { affectedRows: 1, insertId: '22' } });
  assert.equal((await request('POST', '/api/services', creation)).status, 500); assert.deepEqual(saved, fixtures);
  reset({ writeResult: { affectedRows: 0 } });
  assert.equal((await request('PUT', '/api/services/1', update())).status, 200, 'An unchanged edit may report zero changed rows.');
  reset({ writeResult: { affectedRows: 0 } });
  assert.equal((await request('PUT', '/api/services/1', update({ unitPrice: '30' }))).status, 500); assert.deepEqual(saved, fixtures);
  console.log('PASS: real management/public service routes; live staff roles, strict input and exact decimal values; active/retired reads; locked stale-edit protection; create/edit/retire/reactivate, safe committed acknowledgements, uncertain-save handling and read-only verifier fixtures (mock tokens/database, no live MySQL).');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
