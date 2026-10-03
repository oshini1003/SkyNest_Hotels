const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
// Isolated controller tests: real JWT/bcrypt, mocked database transactions.
const root = path.resolve(__dirname, '..');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.JWT_REFRESH_SECRET = crypto.randomBytes(48).toString('hex');
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
const config = require(path.join(root, 'config/auth'));
const validation = require(path.join(root, 'utils/guestValidation'));
const { authenticate } = require(path.join(root, 'middleware/auth'));

let activeConnection;
let outsideQueries = [];
const pool = {
  getConnection: async () => activeConnection,
  execute: async (sql, params) => { outsideQueries.push({ sql, params }); return [[], []]; },
};
require.cache[require.resolve(path.join(root, 'config/db'))] = { exports: pool };
const auth = require(path.join(root, 'controllers/authController'));
const guestController = require(path.join(root, 'controllers/guestController'));

function invoke(handler, body, extra = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); return this; } };
    try { handler({ body, headers: {}, ...extra }, res, reject); } catch (err) { reject(err); }
  });
}
function connection(answer) {
  const events = [];
  const conn = { events,
    beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
    execute: async (sql, values) => { events.push({ sql, values }); return answer(sql, values); },
  };
  activeConnection = conn;
  return conn;
}

(async () => {
  const payload = { type: 'guest', id: 1, username: 'guest' };
  const access = config.signAccessToken(payload);
  const refresh = config.signRefreshToken('guest', 1);
  assert.equal(config.verifyAccessToken(access).id, 1);
  assert.equal(config.verifyRefreshToken(refresh).id, 1);
  assert.throws(() => config.verifyAccessToken(refresh));
  assert.throws(() => config.verifyRefreshToken(access));
  const signedWrongPurpose = jwt.sign({ ...payload, tokenUse: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '15m' });
  assert.throws(() => config.verifyAccessToken(signedWrongPurpose));
  const legacy = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '15m' });
  assert.throws(() => config.verifyAccessToken(legacy));
  const wrongAlgorithm = jwt.sign({ ...payload, tokenUse: 'access' }, process.env.JWT_SECRET, { algorithm: 'HS384', expiresIn: '15m' });
  assert.throws(() => config.verifyAccessToken(wrongAlgorithm));
  const oldRefreshSecret = process.env.JWT_REFRESH_SECRET;
  process.env.JWT_REFRESH_SECRET = process.env.JWT_SECRET;
  assert.throws(config.validateAuthConfig);
  process.env.JWT_REFRESH_SECRET = oldRefreshSecret;
  assert.equal((await invoke(authenticate, {}, { headers: { authorization: `Bearer ${refresh}` } })).status, 401);

  const registration = { name: ' Anushka ', contactNumber: '+94 71-234-5678', email: '', idNumber: 'passport', address: '', username: ' anushka ', password: 'secret123' };
  assert.equal(validation.validateGuestRegistration(registration).value.contactNumber, '+94712345678');
  assert.equal(validation.validateGuestRegistration(registration).value.name, 'Anushka');
  for (const bad of ['abcd', '123456', '+1234567890123456', ['0712345678'], 712345678, null]) {
    assert.ok(validation.validateGuestRegistration({ ...registration, contactNumber: bad }).error);
    assert.ok(validation.validateGuestProfile({ contactNumber: bad }).error);
  }
  assert.ok(validation.validateGuestProfile({ name: ' ' }).error);
  assert.ok(validation.validateGuestProfile({ email: 'bad@example' }).error);
  assert.ok(validation.validateGuestProfile({ name: 'x'.repeat(101) }).error);
  assert.ok(validation.validateGuestRegistration({ ...registration, password: '🙂'.repeat(19) }).error);
  assert.ok(validation.validateCredentials({ username: 'x', password: {} }).error);
  assert.ok(validation.validateGuestProfile([]).error);

  let conn = connection(async (sql) => {
    if (sql.startsWith('INSERT INTO GUEST (')) return [{ insertId: 7 }];
    if (sql.startsWith('INSERT INTO REFRESH_TOKEN')) throw Object.assign(new Error('missing table'), { code: 'ER_NO_SUCH_TABLE' });
    return [{ affectedRows: 1 }];
  });
  await assert.rejects(invoke(auth.registerGuest, registration), /missing table/);
  assert.deepEqual(conn.events.filter(x => typeof x === 'string'), ['begin', 'rollback', 'release']);
  assert.equal(outsideQueries.length, 0);

  conn = connection(async (sql) => sql.startsWith('INSERT INTO GUEST (') ? [{ insertId: 7 }] : [{ affectedRows: 1 }]);
  const registered = await invoke(auth.registerGuest, registration);
  assert.equal(registered.status, 201);
  assert.equal(registered.data.guest.name, 'Anushka');
  assert.equal(registered.data.token, registered.data.accessToken);
  const insert = conn.events.find(x => x.sql?.startsWith('INSERT INTO REFRESH_TOKEN'));
  assert.equal(insert.values[2], crypto.createHash('sha256').update(registered.data.refreshToken).digest('hex'));
  assert.equal(insert.values[2].length, 64);
  assert.deepEqual(conn.events.filter(x => typeof x === 'string'), ['begin', 'commit', 'release']);

  const account = { GuestID: 7, Username: 'anushka', Name: 'Anushka', PasswordHash: await bcrypt.hash('secret123', 4) };
  conn = connection(async (sql) => sql.startsWith('SELECT ga.') ? [[account]] : [{ affectedRows: 1 }]);
  assert.equal((await invoke(auth.loginGuest, { username: 'anushka', password: 'bad' })).status, 401);
  assert.ok(!conn.events.some(x => x.sql?.startsWith('INSERT INTO REFRESH_TOKEN')));
  conn = connection(async (sql) => sql.startsWith('SELECT ga.') ? [[account]] : [{ affectedRows: 1 }]);
  assert.equal((await invoke(auth.loginGuest, { username: 'anushka', password: 'secret123' })).status, 200);

  let recordActive = true;
  conn = connection(async (sql) => {
    if (sql.startsWith('SELECT ga.')) { assert.match(sql, /FOR UPDATE/); return [[account]]; }
    if (sql.startsWith('SELECT TokenID')) { assert.match(sql, /FOR UPDATE/); return [recordActive ? [{ TokenID: 1, UserType: 'guest', UserID: 7 }] : []]; }
    if (sql.startsWith('UPDATE REFRESH_TOKEN')) recordActive = false;
    return [{ affectedRows: 1 }];
  });
  const rotated = await invoke(auth.refreshToken, { refreshToken: registered.data.refreshToken });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.data.refreshToken, registered.data.refreshToken);
  assert.equal((await invoke(auth.refreshToken, { refreshToken: registered.data.refreshToken })).status, 401);
  assert.ok(conn.events.findIndex(x => x.sql?.startsWith('SELECT ga.')) < conn.events.findIndex(x => x.sql?.startsWith('SELECT TokenID')));

  conn = connection(async (sql) => {
    if (sql.startsWith('SELECT ga.')) return [[account]];
    if (sql.startsWith('SELECT TokenID')) return [[{ TokenID: 1, UserType: 'guest', UserID: 7 }]];
    if (sql.startsWith('INSERT INTO REFRESH_TOKEN')) throw new Error('insertion failed');
    return [{ affectedRows: 1 }];
  });
  await assert.rejects(invoke(auth.refreshToken, { refreshToken: registered.data.refreshToken }), /insertion failed/);
  assert.deepEqual(conn.events.filter(x => typeof x === 'string'), ['begin', 'rollback', 'release']);

  conn = connection(async (sql) => sql.startsWith('SELECT ga.') ? [[account]] : [{ affectedRows: 1 }]);
  assert.equal((await invoke(auth.changeGuestPassword, { currentPassword: 'bad', newPassword: 'newsecret' }, { user: { id: 7 } })).status, 400);
  assert.ok(!conn.events.some(x => x.sql?.startsWith('UPDATE')));
  conn = connection(async (sql) => {
    if (sql.startsWith('SELECT ga.')) return [[account]];
    if (sql.startsWith('UPDATE REFRESH_TOKEN')) throw new Error('revoke failed');
    return [{ affectedRows: 1 }];
  });
  await assert.rejects(invoke(auth.changeGuestPassword, { currentPassword: 'secret123', newPassword: 'newsecret' }, { user: { id: 7 } }), /revoke failed/);
  assert.deepEqual(conn.events.filter(x => typeof x === 'string'), ['begin', 'rollback', 'release']);

  const beforeInvalid = outsideQueries.length;
  assert.equal((await invoke(guestController.updateProfile, { contactNumber: 'abcd' }, { user: { id: 7 } })).status, 400);
  assert.equal(outsideQueries.length, beforeInvalid);
  console.log('PASS: real JWT purpose/algorithm/secret checks; guest validation; registration rollback/digest; login contracts; refresh lock/replay/rollback; password rollback; invalid profile rejected before SQL.');
})().catch(error => { console.error(error); process.exitCode = 1; });
