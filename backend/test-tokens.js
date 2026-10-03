// Run against the local test database after starting the backend.
// Set TEST_GUEST_USERNAME and TEST_GUEST_PASSWORD in your shell first.
const assert = require('node:assert/strict');
const API = process.env.TEST_API_URL || 'http://localhost:5000/api';

async function request(path, options = {}) {
  return fetch(`${API}${path}`, { ...options, signal: AbortSignal.timeout(10000) });
}
const post = (path, body) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

async function run() {
  const username = process.env.TEST_GUEST_USERNAME;
  const password = process.env.TEST_GUEST_PASSWORD;
  if (!username || !password) throw new Error('Set TEST_GUEST_USERNAME and TEST_GUEST_PASSWORD for a test guest account.');
  let currentRefresh;
  try {
    const login = await post('/auth/guest/login', { username, password });
    assert.equal(login.status, 200, 'Guest login failed');
    const first = await login.json();
    assert.equal(typeof first.accessToken, 'string', 'Access token missing');
    assert.equal(typeof first.refreshToken, 'string', 'Refresh token missing');
    currentRefresh = first.refreshToken;

    const wrongPurpose = await request('/guests/me', { headers: { Authorization: `Bearer ${first.refreshToken}` } });
    assert.equal(wrongPurpose.status, 401, 'Refresh token must not authorize a protected route');
    const accessAsRefresh = await post('/auth/refresh', { refreshToken: first.accessToken });
    assert.equal(accessAsRefresh.status, 401, 'Access token must not be accepted as a refresh token');

    const refresh = await post('/auth/refresh', { refreshToken: first.refreshToken });
    assert.equal(refresh.status, 200, 'Token refresh failed');
    const second = await refresh.json();
    assert.equal(typeof second.accessToken, 'string', 'New access token missing');
    assert.equal(typeof second.refreshToken, 'string', 'New refresh token missing');
    assert.ok(second.refreshToken !== first.refreshToken, 'Refresh token did not rotate');
    currentRefresh = second.refreshToken;

    const reuse = await post('/auth/refresh', { refreshToken: first.refreshToken });
    assert.equal(reuse.status, 401, 'Used refresh token was accepted again');
    const profile = await request('/guests/me', { headers: { Authorization: `Bearer ${second.accessToken}` } });
    assert.equal(profile.status, 200, 'Access token could not fetch the guest profile');
    const logout = await post('/auth/logout', { refreshToken: second.refreshToken });
    assert.equal(logout.status, 200, 'Logout failed');
    const revoked = await post('/auth/refresh', { refreshToken: second.refreshToken });
    assert.equal(revoked.status, 401, 'Logged-out refresh token was accepted');
    currentRefresh = null;
    console.log('PASS: login, token-purpose checks, rotation, replay rejection, profile access and logout.');
  } finally {
    if (currentRefresh) await post('/auth/logout', { refreshToken: currentRefresh }).catch(() => {});
  }
}

run().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
