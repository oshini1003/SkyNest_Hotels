// GET-only hotel checks. Login/logout create and close only this test's sessions.
const assert = require('node:assert/strict');

function price(value) {
  const match = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/.exec(String(value));
  assert.ok(match, 'A catalogue price is invalid.');
  return `${match[1]}.${(match[2] || '').padEnd(2, '0')}`;
}

function validate(rows, management) {
  assert.ok(Array.isArray(rows), 'Expected a catalogue list.');
  const ids = new Set();
  return rows.map(row => {
    assert.ok(row && Number.isInteger(row.ServiceID) && row.ServiceID > 0
      && row.ServiceID <= 2147483647 && !ids.has(row.ServiceID), 'Invalid or duplicate service ID.');
    ids.add(row.ServiceID);
    assert.ok(typeof row.ServiceName === 'string' && row.ServiceName.trim(), 'Service name is missing.');
    assert.ok(row.Description === null || typeof row.Description === 'string', 'Invalid description.');
    if (management) {
      assert.equal(typeof row.IsActive, 'boolean', 'Management status must be a boolean.');
      assert.equal(typeof row.UnitPrice, 'string', 'Management prices must preserve decimals as strings.');
      assert.equal(price(row.UnitPrice), row.UnitPrice, 'Management price must have two decimal places.');
    } else {
      assert.ok(row.IsActive === true || row.IsActive === 1, 'Public catalogue exposed an inactive service.');
    }
    return { ServiceID: row.ServiceID, ServiceName: row.ServiceName, Description: row.Description,
      UnitPrice: price(row.UnitPrice), IsActive: Boolean(row.IsActive) };
  }).sort((a, b) => a.ServiceID - b.ServiceID);
}

async function run() {
  const url = new URL(process.env.TEST_API_URL || 'http://localhost:5000/api');
  assert.ok(['http:', 'https:'].includes(url.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash, 'Use a local TEST_API_URL.');
  const api = url.toString().replace(/\/$/, '');
  const accounts = [
    { username: process.env.TEST_MANAGER_USERNAME, password: process.env.TEST_MANAGER_PASSWORD },
    { username: process.env.TEST_STAFF_USERNAME, password: process.env.TEST_STAFF_PASSWORD },
  ];
  assert.ok(accounts.every(account => account.username && account.password),
    'Set TEST_MANAGER_USERNAME/PASSWORD and TEST_STAFF_USERNAME/PASSWORD (Receptionist or ServiceStaff).');
  const refreshTokens = [];
  async function request(path, token, body) {
    const response = await fetch(`${api}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, data: await response.json() };
  }
  let total;
  let active;
  let primaryError;
  try {
    const sessions = [];
    for (const account of accounts) {
      const result = await request('/auth/staff/login', null, account);
      assert.equal(result.status, 200, 'Test account login failed.');
      if (result.data.refreshToken) refreshTokens.push(result.data.refreshToken);
      assert.ok(result.data.refreshToken && (result.data.token || result.data.accessToken), 'Login tokens missing.');
      sessions.push(result.data);
    }
    assert.ok(['Admin', 'Manager'].includes(sessions[0].staff?.role), 'First account must be Manager/Admin.');
    assert.ok(['Receptionist', 'ServiceStaff'].includes(sessions[1].staff?.role), 'Second account must be ordinary staff.');
    const manager = sessions[0].token || sessions[0].accessToken;
    const staff = sessions[1].token || sessions[1].accessToken;
    assert.equal((await request('/management/services')).status, 401, 'Anonymous management access was accepted.');
    assert.equal((await request('/management/services', staff)).status, 403, 'Ordinary staff management access was accepted.');
    const first = await request('/management/services', manager);
    assert.equal(first.status, 200, 'Management catalogue GET failed.');
    const all = validate(first.data, true);
    const publicResult = await request('/services');
    assert.equal(publicResult.status, 200, 'Public catalogue GET failed.');
    assert.deepEqual(validate(publicResult.data, false), all.filter(row => row.IsActive),
      'Public active services differ from management catalogue. Keep the catalogue unchanged during this test.');
    const second = await request('/management/services', manager);
    assert.equal(second.status, 200, 'Management catalogue reread failed.');
    assert.deepEqual(validate(second.data, true), all, 'Catalogue changed during the read-only check.');
    total = all.length;
    active = all.filter(row => row.IsActive).length;
  } catch (error) {
    primaryError = error;
  } finally {
    for (const refreshToken of refreshTokens) {
      try {
        const result = await request('/auth/logout', null, { refreshToken });
        assert.equal(result.status, 200, 'A test session could not be closed.');
      } catch (error) { primaryError ||= error; }
    }
  }
  if (primaryError) throw primaryError;
  console.log(`PASS: manager catalogue ${total} services (${active} active); public active list agrees; anonymous/ordinary staff blocked; reread unchanged.`);
  console.log('GET-only hotel checks; test login sessions closed. Create, edit, retire/reactivate and concurrent edits require separate checks.');
}

if (require.main === module) run().catch(error => {
  console.error(`FAIL: ${error instanceof assert.AssertionError ? error.message : 'Catalogue smoke check could not complete.'}`);
  process.exitCode = 1;
});

module.exports = { validate };
