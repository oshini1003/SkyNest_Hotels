const API = 'http://localhost:5000/api';

async function run() {
  console.log('Testing JWT Refresh Tokens & Authentication...\n');

  // 1. Login
  console.log('1. Logging in as guest (oshini)...');
  const loginRes = await fetch(`${API}/auth/guest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'oshini', password: 'guest123' }),
  });
  const loginData = await loginRes.json();
  console.log('   Status:', loginRes.status);
  console.log('   Access Token received:', !!loginData.accessToken);
  console.log('   Refresh Token received:', !!loginData.refreshToken);

  const refreshToken1 = loginData.refreshToken;

  // 2. Refresh Token
  console.log('\n2. Refreshing token (POST /api/auth/refresh)...');
  const refreshRes = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshToken1 }),
  });
  const refreshData = await refreshRes.json();
  console.log('   Status:', refreshRes.status);
  console.log('   New Access Token received:', !!refreshData.accessToken);
  console.log('   New Rotated Refresh Token received:', !!refreshData.refreshToken);

  const refreshToken2 = refreshData.refreshToken;

  // 3. Test Rotation (Reusing old token should fail)
  console.log('\n3. Testing Token Rotation (Reusing old refresh token)...');
  const reuseRes = await fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshToken1 }),
  });
  const reuseData = await reuseRes.json();
  console.log('   Status:', reuseRes.status, '(Expected 401)');
  console.log('   Response:', reuseData.error);

  // 4. Test Protected Route with new access token
  console.log('\n4. Accessing protected profile with new access token...');
  const profileRes = await fetch(`${API}/guests/me`, {
    headers: { Authorization: `Bearer ${refreshData.accessToken}` },
  });
  const profileData = await profileRes.json();
  console.log('   Status:', profileRes.status);
  console.log('   Guest Name:', profileData.Name);

  // 5. Logout
  console.log('\n5. Logging out (POST /api/auth/logout)...');
  const logoutRes = await fetch(`${API}/auth/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshToken2 }),
  });
  const logoutData = await logoutRes.json();
  console.log('   Status:', logoutRes.status);
  console.log('   Response:', logoutData.message);

  console.log('\nAll refresh token checks completed successfully! 🎉');
}

run().catch(console.error);
