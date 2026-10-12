const assert = require('node:assert/strict');
const http = require('node:http');

// Exercise the real routes, authentication and live staff-scope middleware.
// Tokens and SQL results are independent fixtures; no server port or MySQL is used.
const staff = [
  { StaffID: 1, Role: 'Admin', BranchID: null, BranchName: null },
  { StaffID: 2, Role: 'Manager', BranchID: 1, BranchName: 'Colombo' },
  { StaffID: 3, Role: 'Receptionist', BranchID: 1, BranchName: 'Colombo' },
  { StaffID: 4, Role: 'ServiceStaff', BranchID: 1, BranchName: 'Colombo' },
  { StaffID: 5, Role: 'Receptionist', BranchID: null, BranchName: null },
];
const tokens = Object.fromEntries(staff.slice(0, 4).map(row => [row.Role.toLowerCase(),
  { type: 'staff', id: row.StaffID, role: row.Role, branchId: row.BranchID }]));
tokens.unassigned = { type: 'staff', id: 5, role: 'Receptionist', branchId: null };
tokens.guest = { type: 'guest', id: 42 };
tokens.malformed = { ...tokens.receptionist, id: '3' };
tokens.missingBranch = { type: 'staff', id: 3, role: 'Receptionist' };

const guests = [
  { GuestID: 17, Name: 'Same Name', ContactNumber: '+94771234567', Email: 'one@example.test', IDNumber: 'NIC-17' },
  { GuestID: 21, Name: 'Same Name', ContactNumber: '+94779876543', Email: null, IDNumber: 'NIC-21' },
];
const profileFixture = { GuestID: 42, Name: 'Profile Guest', ContactNumber: '0771234567',
  Email: 'guest@example.test', IDNumber: 'NIC-42', Address: 'Kandy', Username: 'profile.guest' };
const creation = { name: 'New Guest', contactNumber: '+94 77-1234567',
  email: 'new@example.test', idNumber: 'NIC-NEW-17', address: 'Colombo' };
const clone = value => JSON.parse(JSON.stringify(value));
const privateFailure = Object.assign(new Error('PRIVATE: SQL, guest details and database credentials'),
  { code: 'ER_TEST_FAILURE' });
let options, calls, events, forwarded, profile;
function reset(next = {}) {
  options = next; calls = []; events = []; forwarded = []; profile = clone(profileFixture);
}
function compact(sql) { return sql.replace(/\s+/g, ' ').trim(); }
const pool = {
  async execute(sql, params = []) {
    const normalized = compact(sql);
    calls.push({ sql: normalized, params: [...params] });
    assert.equal((sql.match(/\?/g) || []).length, params.length, 'Values must use SQL placeholders.');
    if (/FROM STAFF s JOIN STAFF_ACCOUNT/.test(normalized)) {
      events.push('SCOPE');
      assert.doesNotMatch(normalized, /FOR UPDATE|FOR SHARE/);
      if (options.missingStaff) return [[]];
      const row = staff.find(item => item.StaffID === params[0]);
      return [row ? [{ ...row, ...options.scopeStaff }] : []];
    }
    if (/^SELECT g\.GuestID/.test(normalized) && /JOIN GUEST_ACCOUNT/.test(normalized)) {
      events.push('PROFILE');
      assert.match(normalized, /WHERE g\.GuestID = \?$/);
      assert.deepEqual(params, [42], 'Profile identity comes from the authenticated guest.');
      return [options.missingProfile ? [] : [clone(profile)]];
    }
    if (/^UPDATE GUEST SET/.test(normalized)) {
      events.push('PROFILE_UPDATE');
      assert.match(normalized, /WHERE GuestID = \?$/);
      assert.equal(params.at(-1), 42, 'The submitted body cannot change the profile owner.');
      const assignments = normalized.match(/^UPDATE GUEST SET (.*) WHERE GuestID = \?$/)[1].split(', ');
      assignments.forEach((assignment, index) => {
        assert.match(assignment, /^(Name|ContactNumber|Email|Address) = \?$/);
        profile[assignment.split(' ')[0]] = params[index];
      });
      return [{ affectedRows: 1 }];
    }
    if (/^SELECT /.test(normalized) && /FROM GUEST\b/.test(normalized)) {
      events.push('SEARCH');
      assert.equal(normalized.match(/^SELECT (.+?) FROM GUEST\b/)[1],
        'GuestID, Name, ContactNumber, Email, IDNumber', 'Search returns only the booking guest summary.');
      assert.match(normalized, /WHERE .*Name LIKE \?.*ContactNumber LIKE \?.*Email LIKE \?.*IDNumber LIKE \?/);
      assert.equal((normalized.match(/LIKE \? ESCAPE '!'/g) || []).length, 4);
      assert.match(normalized, /ORDER BY Name, GuestID LIMIT 20$/);
      assert.doesNotMatch(normalized, /JOIN|FOR UPDATE|FOR SHARE|Password|Address|Username/i);
      assert.equal(params.length, 4);
      assert.ok(params.every(value => value === params[0]), 'All four searches use the same escaped pattern.');
      if (options.searchError) throw options.searchError;
      return [clone(options.searchRows || guests)];
    }
    if (/^INSERT /.test(normalized)) {
      events.push('INSERT');
      assert.equal(normalized,
        'INSERT INTO GUEST (Name, ContactNumber, Email, IDNumber, Address) VALUES (?, ?, ?, ?, ?)');
      assert.equal(events[0], 'SCOPE');
      if (options.insertError) throw options.insertError;
      return [Object.hasOwn(options, 'writeResult') ? options.writeResult : { affectedRows: 1, insertId: 31 }];
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  },
};
require.cache[require.resolve('../config/db')] = { exports: pool };
require.cache[require.resolve('../config/auth')] = { exports: { verifyAccessToken(token) {
  if (!Object.hasOwn(tokens, token)) throw new Error('Invalid test token');
  return { ...tokens[token] };
} } };
const express = require('express');
const app = express();
app.use('/api/guests', require('../routes/guestRoutes'));
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
// Match the production error mapper, including its special SQLSTATE handling.
// A controller must wrap unexpected driver errors before they reach this mapper.
app.use((error, req, res, next) => {
  void req; void next; forwarded.push(error);
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That record already exists.' });
  if (error.sqlState === '45000') return res.status(400).json({ error: error.sqlMessage || 'The operation was rejected.' });
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});
function request(method = 'GET', url = '/api/guests?q=Same', body, token = 'receptionist') {
  return new Promise((resolve, reject) => {
    const req = new http.IncomingMessage(null);
    req.method = method; req.url = url; req.body = body;
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
function noGuestOperation() {
  assert.ok(!events.some(event => ['SEARCH', 'INSERT', 'PROFILE', 'PROFILE_UPDATE'].includes(event)));
}
function assertSafeFailure(response) {
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'An unexpected server error occurred.' });
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].code, undefined);
  assert.equal(forwarded[0].sqlState, undefined);
  assert.ok(!JSON.stringify(response.body).includes('PRIVATE'));
}

async function run() {
  for (const [method, url, body] of [['GET', '/api/guests?q=Same'], ['POST', '/api/guests', creation]]) {
    for (const [token, status] of [[null, 401], ['invalid', 401], ['guest', 403],
      ['servicestaff', 403], ['malformed', 401], ['missingBranch', 401], ['unassigned', 403]]) {
      reset(); assert.equal((await request(method, url, body, token)).status, status); noGuestOperation();
    }
    for (const changed of [{ missingStaff: true }, { scopeStaff: { StaffID: 99 } },
      { scopeStaff: { Role: 'Manager' } }, { scopeStaff: { BranchID: 2 } }]) {
      reset(changed); assert.equal((await request(method, url, body)).status, 401);
      assert.deepEqual(events, ['SCOPE']);
    }
    reset({ scopeStaff: { BranchName: '' } });
    assert.equal((await request(method, url, body)).status, 403); noGuestOperation();
  }

  for (const token of ['receptionist', 'manager', 'admin']) {
    reset(); const response = await request('GET', '/api/guests?q=Same', undefined, token);
    assert.equal(response.status, 200); assert.deepEqual(response.body, guests);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(events, ['SCOPE', 'SEARCH']);
    reset(); const created = await request('POST', '/api/guests', creation, token);
    assert.equal(created.status, 201);
    assert.deepEqual(created.body, { guest: { GuestID: 31, Name: 'New Guest',
      ContactNumber: '+94771234567', Email: 'new@example.test', IDNumber: 'NIC-NEW-17' } });
    assert.deepEqual(events, ['SCOPE', 'INSERT'], 'Walk-in creation must not create an online account or retry.');
  }
  for (const query of ['', '?q=', '?q=a', '?q=%20%20', `?q=${'a'.repeat(101)}`,
    '?q=aa&q=bb', '?q[]=aa', '?q[name]=aa', '?q=one%00two', '?q=one%0Atwo']) {
    reset(); assert.equal((await request('GET', `/api/guests${query}`)).status, 400, query);
    assert.deepEqual(events, ['SCOPE']);
  }
  for (const term of ['ab', 'a'.repeat(100), '😀'.repeat(50)]) {
    reset(); assert.equal((await request('GET', `/api/guests?q=${encodeURIComponent(term)}`)).status, 200);
  }
  reset(); const searchTerm = "  O'Neil%_!\\  ";
  assert.equal((await request('GET', `/api/guests?q=${encodeURIComponent(searchTerm)}`)).status, 200);
  const read = calls.find(call => call.sql.startsWith('SELECT GuestID'));
  assert.deepEqual(read.params, Array(4).fill("%O'Neil!%!_!!\\%"));
  assert.ok(!read.sql.includes("O'Neil"), 'Search text is never interpolated into SQL.');
  reset({ searchRows: [] }); assert.deepEqual((await request()).body, []);

  const invalidDrafts = [undefined, null, [], 'guest', 7, {},
    { ...creation, guestId: 1 }, { ...creation, branchId: 2 }, { ...creation, username: 'account' },
    { ...creation, password: 'secret123' }, { ...creation, unknown: true }];
  for (const field of ['name', 'contactNumber', 'idNumber']) {
    const missing = { ...creation }; delete missing[field]; invalidDrafts.push(missing);
    for (const value of [null, '', '   ', 5, false, [], {}]) invalidDrafts.push({ ...creation, [field]: value });
  }
  for (const field of Object.keys(creation)) {
    for (const control of ['\u0000', '\n', '\t', '\u007f', '\u0085']) {
      invalidDrafts.push({ ...creation, [field]: `A${control}B` });
    }
  }
  invalidDrafts.push(
    { ...creation, name: 'a'.repeat(101) }, { ...creation, name: '😀'.repeat(101) },
    { ...creation, idNumber: 'A'.repeat(31) }, { ...creation, idNumber: '😀'.repeat(31) },
    { ...creation, email: 'not-an-email' }, { ...creation, email: `a@${'b'.repeat(145)}.test` },
    { ...creation, address: 'a'.repeat(256) }, { ...creation, contactNumber: '123456' },
    { ...creation, contactNumber: '1'.repeat(16) }, { ...creation, contactNumber: '07abc12345' },
    { ...creation, contactNumber: '++94771234567' }, { ...creation, contactNumber: '1'.repeat(101) },
    { ...creation, email: true }, { ...creation, address: 5 }
  );
  for (const body of invalidDrafts) {
    reset(); const response = await request('POST', '/api/guests', body);
    assert.equal(response.status, 400, `Invalid draft was accepted: ${JSON.stringify(body)}`);
    assert.deepEqual(events, ['SCOPE']);
  }
  for (const optional of [{}, { email: null, address: null }, { email: '', address: '   ' }]) {
    reset(); const response = await request('POST', '/api/guests',
      { name: "  O'Neil  ", contactNumber: ' +94 77-1234567 ', idNumber: ' P1234567 ', ...optional });
    assert.equal(response.status, 201);
    assert.deepEqual(calls.at(-1).params, ["O'Neil", '+94771234567', null, 'P1234567', null]);
    assert.equal(response.body.guest.Email, null);
    assert.ok(!calls.at(-1).sql.includes("O'Neil"));
  }
  reset(); const boundary = await request('POST', '/api/guests', {
    name: '😀'.repeat(100), contactNumber: '1234567', idNumber: ` ${'😀'.repeat(30)} `,
    email: `a@${'b'.repeat(143)}.test`, address: '😀'.repeat(255),
  });
  assert.equal(boundary.status, 201, 'Database limits count Unicode codepoints, not UTF-16 units.');
  assert.equal([...calls.at(-1).params[3]].length, 30);
  reset({ writeResult: { affectedRows: 1, insertId: 2147483647 } });
  assert.equal((await request('POST', '/api/guests', creation)).body.guest.GuestID, 2147483647);

  reset({ insertError: Object.assign(new Error('PRIVATE duplicate NIC SQL'), { code: 'ER_DUP_ENTRY' }) });
  let response = await request('POST', '/api/guests', creation);
  assert.equal(response.status, 409); assert.ok(!JSON.stringify(response.body).includes('PRIVATE'));
  assert.deepEqual(events, ['SCOPE', 'INSERT']);
  for (const error of [privateFailure,
    Object.assign(new Error('PRIVATE signal'), { sqlState: '45000', sqlMessage: 'PRIVATE guest SQL' }),
    Object.assign(new Error('PRIVATE lost connection'), { code: 'PROTOCOL_CONNECTION_LOST' })]) {
    reset({ insertError: error }); response = await request('POST', '/api/guests', creation);
    assertSafeFailure(response); assert.equal(forwarded[0].cause, error);
    assert.deepEqual(events, ['SCOPE', 'INSERT'], 'Never repeat a write after an uncertain result.');
    reset({ searchError: error }); response = await request();
    assertSafeFailure(response); assert.equal(forwarded[0].cause, error);
    assert.deepEqual(events, ['SCOPE', 'SEARCH']);
  }
  for (const writeResult of [undefined, null, {}, { affectedRows: 0, insertId: 31 },
    { affectedRows: 2, insertId: 31 }, { affectedRows: '1', insertId: 31 },
    ...[undefined, null, 0, -1, 1.5, '31', 2147483648].map(insertId => ({ affectedRows: 1, insertId }))]) {
    reset({ writeResult }); response = await request('POST', '/api/guests', creation);
    assertSafeFailure(response); assert.deepEqual(events, ['SCOPE', 'INSERT']);
  }

  for (const method of ['GET', 'PUT']) {
    for (const token of ['receptionist', 'manager', 'admin', 'servicestaff']) {
      reset(); assert.equal((await request(method, '/api/guests/me', { name: 'Changed' }, token)).status, 403);
      assert.deepEqual(events, []);
    }
    reset(); assert.equal((await request(method, '/api/guests/me', { name: 'Changed' }, null)).status, 401);
    assert.deepEqual(events, []);
  }
  reset(); response = await request('GET', '/api/guests/me?guestId=17', undefined, 'guest');
  assert.equal(response.status, 200); assert.deepEqual(response.body, profileFixture);
  assert.deepEqual(events, ['PROFILE']);
  reset(); response = await request('PUT', '/api/guests/me',
    { name: ' Changed Guest ', contactNumber: '+94 77-1234567', email: null, address: ' Galle ', guestId: 17 }, 'guest');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.guest, { ...profileFixture, Name: 'Changed Guest', ContactNumber: '+94771234567', Email: null, Address: 'Galle' });
  assert.deepEqual(events, ['PROFILE_UPDATE', 'PROFILE']);
  reset(); assert.equal((await request('PUT', '/api/guests/me', { contactNumber: 'invalid' }, 'guest')).status, 400);
  assert.deepEqual(events, []);
  reset({ missingProfile: true }); assert.equal((await request('GET', '/api/guests/me', undefined, 'guest')).status, 404);
  console.log('PASS: real guest routes and live staff scope; receptionist/manager/admin access, private parameterized guest search, strict walk-in identity/profile limits and single inserts, safe duplicate/uncertain failures, and preserved guest-owned profile routes (mock tokens/database, no live MySQL).');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
