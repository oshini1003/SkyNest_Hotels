'use strict';

// Run on the host with Node.js: node docker/smoke.cjs [http://localhost:8080]
// Login creates demo authentication sessions; finally blocks revoke them.
// This script never creates bookings, payments, profiles, or staff accounts.

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function localOrigin(args) {
  check(args.length <= 1, 'Usage: node docker/smoke.cjs [http://localhost:8080]');
  let url;
  try { url = new URL(args[0] || 'http://localhost:8080'); }
  catch { throw new Error('Provide a valid localhost or 127.0.0.1 origin.'); }
  check(['http:', 'https:'].includes(url.protocol)
    && ['localhost', '127.0.0.1'].includes(url.hostname)
    && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
  'Use only a localhost or 127.0.0.1 HTTP(S) origin without credentials or a path.');
  return url.origin;
}

async function main() {
  const origin = localOrigin(process.argv.slice(2));
  check(typeof fetch === 'function', 'Use Node.js 22.22 or newer to run this check.');
  console.log(`Checking SkyNest at ${origin}`);
  console.log('Demo logins create and revoke sessions; hotel records are read only.');

  async function request(path, label, options = {}, expectedStatus = 200) {
    let response;
    try {
      response = await fetch(`${origin}${path}`, {
        ...options,
        redirect: 'error', // Never follow redirects with credentials or tokens.
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(`${label}: request failed or timed out. Check the containers and URL.`);
    }
    check(response.status === expectedStatus,
      `${label}: expected HTTP ${expectedStatus}, received ${response.status}.`);
    return response;
  }

  async function json(path, label, options = {}) {
    const response = await request(path, label, options);
    check((response.headers.get('content-type') || '').includes('application/json'),
      `${label}: expected JSON. Check the /api proxy.`);
    try { return await response.json(); }
    catch { throw new Error(`${label}: response was not valid JSON.`); }
  }

  const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const authenticated = token => ({ headers: { Authorization: `Bearer ${token}` } });
  const passed = label => console.log(`PASS: ${label}`);

  for (const [path, label] of [['/', 'Homepage'], ['/guest/bookings', 'SPA deep-link refresh']]) {
    const response = await request(path, label);
    check((response.headers.get('content-type') || '').includes('text/html'), `${label}: expected HTML.`);
    check(/id=["']root["']/.test(await response.text()), `${label}: React page shell was missing.`);
    passed(label);
  }
  await request('/assets/skynest-smoke-missing.js', 'Missing asset', {}, 404);
  passed('Missing asset returns 404');

  const health = await json('/api/health', 'API health');
  check(health?.status === 'ok', 'API health: service did not report ready.');
  passed('API proxy and health');

  for (const path of ['/branches', '/room-types', '/amenities', '/services']) {
    const rows = await json(`/api${path}`, `Catalogue ${path}`);
    check(Array.isArray(rows) && rows.length > 0, `Catalogue ${path}: expected seeded records.`);
  }
  passed('Branches, room types, amenities, and services');

  const futureDate = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const query = new URLSearchParams({ checkin: futureDate(7), checkout: futureDate(8), guestCount: '1' });
  const rooms = await json(`/api/rooms?${query}`, 'Future room search');
  check(Array.isArray(rooms), 'Future room search: expected a room list.');
  passed('Future room availability search');

  const sessions = [];
  let failed = false;
  try {
    const guest = await json('/api/auth/guest/login', 'Guest demo login', post({ username: 'oshini', password: 'guest123' }));
    if (typeof guest?.refreshToken === 'string') sessions.push(guest.refreshToken);
    check(typeof guest?.token === 'string' && typeof guest?.refreshToken === 'string'
      && Number.isInteger(guest?.guest?.guestId), 'Guest demo login: expected tokens and identity.');
    const profile = await json('/api/guests/me', 'Guest profile', authenticated(guest.token));
    check(profile?.GuestID === guest.guest.guestId, 'Guest profile: identity mismatch.');
    const bookings = await json('/api/bookings', 'Guest bookings', authenticated(guest.token));
    check(Array.isArray(bookings), 'Guest bookings: expected a booking list.');
    passed('Guest demo login, profile, and booking reads');

    const staff = await json('/api/auth/staff/login', 'Admin demo login', post({ username: 'admin', password: 'staff123' }));
    if (typeof staff?.refreshToken === 'string') sessions.push(staff.refreshToken);
    check(typeof staff?.token === 'string' && typeof staff?.refreshToken === 'string'
      && staff?.staff?.role === 'Admin', 'Admin demo login: expected tokens and Admin identity.');
    const scope = await json('/api/staff/scope', 'Admin scope', authenticated(staff.token));
    check(scope?.role === 'Admin' && scope?.staffId === staff.staff.staffId,
      'Admin scope: identity mismatch.');
    passed('Admin demo login and current staff access');
  } catch (error) {
    failed = true;
    console.error(`FAIL: ${error.message}`);
  } finally {
    for (const refreshToken of sessions) {
      try { await json('/api/auth/logout', 'Demo logout', post({ refreshToken })); }
      catch {
        failed = true;
        console.error('FAIL: A demo session could not be logged out. Check backend connectivity.');
      }
    }
  }
  if (failed) {
    process.exitCode = 1;
  } else {
    passed('Demo sessions logged out');
    console.log('Docker smoke checks passed. Continue with the browser demonstration.');
  }
}

main().catch(error => {
  // Errors above are locally generated; response bodies and credentials are not printed.
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
