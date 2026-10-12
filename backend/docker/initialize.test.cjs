'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { projectScripts } = require('../Database/setupIntegrationDb');
const { DATABASE, META_DATABASE, configuration, runtimeGrants, grantRights,
  verifyGrantRows, revisionFor, initialize, verifySeedAccounts } = require('./initialize.cjs');

const scripts = projectScripts();
const env = { DB_HOST: 'db', DB_PORT: '3306', DB_NAME: DATABASE, DB_USER: 'skynest_app',
  DB_PASSWORD: 'a'.repeat(64), DB_ROOT_PASSWORD: 'b'.repeat(64) };
const config = configuration(env);
const revision = revisionFor(scripts);
const completedMarker = { Id: 1, DatabaseName: DATABASE, Revision: revision };

function scenario(options = {}) {
  const events = [];
  const state = { schemas: options.schemas || [], marker: options.marker || [],
    accounts: options.accounts || [], accountLocked: false };
  const fail = message => { throw Object.assign(new Error(message), { code: 'ER_TEST_FAILURE' }); };
  async function query(sql, values = []) {
    events.push({ sql, values });
    if (options.failSQL?.(sql)) fail('driver may include password: ' + config.password);
    if (sql.startsWith('SELECT CURRENT_USER')) return [[{ account: 'root@%', lowerCaseTableNames: 0 }]];
    if (sql.includes('GET_LOCK')) return [[{ acquired: options.locked ? 0 : 1 }]];
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.includes('INFORMATION_SCHEMA.SCHEMATA')) return [state.schemas.map(SCHEMA_NAME => ({ SCHEMA_NAME }))];
    if (sql.startsWith('SELECT Id, DatabaseName')) return [state.marker];
    if (sql.startsWith('SELECT User, Host')) return [state.accounts];
    if (sql.startsWith('CREATE DATABASE')) state.schemas.push(/`([^`]+)`/.exec(sql)[1]);
    if (sql.startsWith('CREATE USER')) { state.accounts.push({ User: 'skynest_app', Host: '%' }); state.accountLocked = true; }
    if (sql.includes('ACCOUNT UNLOCK')) state.accountLocked = false;
    else if (sql.startsWith('ALTER USER') && sql.includes('ACCOUNT LOCK')) state.accountLocked = true;
    if (sql.startsWith('SHOW GRANTS')) return [runtimeGrants().map(value => ({ Grants: value }))];
    if (sql.startsWith('INSERT INTO `skynest_docker_meta`')) state.marker.push({ Id: 1, DatabaseName: values[0], Revision: values[1] });
    return [[]];
  }
  const checks = {
    async verifyObjects() {
      events.push({ sql: 'CHECK_OBJECTS' });
      if (options.objectFailure) fail('schema mismatch');
    },
    async verifySeedAccounts() { events.push({ sql: 'CHECK_SEED_PASSWORDS' }); },
    async verifyRuntime() {
      events.push({ sql: 'CHECK_RUNTIME' });
      if (options.runtimeFailure) fail('wrong password ' + config.password);
    },
  };
  return { events, state, run: () => initialize({ admin: { query, execute: query },
    config, scripts, connectRuntime: () => assert.fail('stubbed runtime check expected'), checks }) };
}
const mutations = events => events.filter(({ sql }) => /^(CREATE|ALTER|GRANT|INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/.test(sql));

test('fresh initialization imports canonical SQL once and marks completion after runtime verification', async () => {
  const check = scenario();
  assert.equal((await check.run()).status, 'created');
  assert.deepEqual(check.state.schemas, [META_DATABASE, DATABASE]);
  assert.deepEqual(check.state.marker, [completedMarker]);
  assert.equal(check.state.accountLocked, false);
  const sql = check.events.map(event => event.sql);
  assert.equal(sql.filter(value => value.startsWith('CREATE TABLE ') && !value.includes('`initialization`')).length, 17);
  assert.equal(sql.filter(value => value.startsWith('CREATE FUNCTION ')).length, 4);
  assert.equal(sql.filter(value => value.startsWith('CREATE PROCEDURE ')).length, 7);
  assert.equal(sql.filter(value => value.startsWith('CREATE TRIGGER ')).length, 8);
  assert.ok(sql.indexOf('CHECK_RUNTIME') < sql.findIndex(value => value.startsWith('INSERT INTO `skynest_docker_meta`')));
  assert.equal(sql.filter(value => value === 'CHECK_SEED_PASSWORDS').length, 1);
  assert.ok(!sql.some(value => /^(DROP|TRUNCATE|CREATE USER IF NOT EXISTS|ALTER USER.*IDENTIFIED)/.test(value)));
});

test('repeat startup only verifies completed installation; it never reimports seed rows or changes credentials', async () => {
  const check = scenario({ schemas: [DATABASE, META_DATABASE], marker: [completedMarker] });
  assert.equal((await check.run()).status, 'reused');
  assert.deepEqual(mutations(check.events), []);
  assert.equal(check.events.filter(event => event.sql === 'CHECK_RUNTIME').length, 1);
  assert.ok(!check.events.some(event => event.sql === 'CHECK_SEED_PASSWORDS'));
});

test('existing partial, missing-marker and changed-revision installations fail closed', async () => {
  for (const options of [
    { schemas: [DATABASE] },
    { schemas: [META_DATABASE] },
    { schemas: [DATABASE, META_DATABASE], marker: [] },
    { schemas: [DATABASE, META_DATABASE], marker: [{ ...completedMarker, Revision: '0'.repeat(64) }] },
    { schemas: [DATABASE, META_DATABASE], marker: [completedMarker, completedMarker] },
    { schemas: [DATABASE, META_DATABASE], marker: [completedMarker], objectFailure: true },
    { schemas: [DATABASE, META_DATABASE], marker: [completedMarker], runtimeFailure: true },
  ]) {
    const check = scenario(options);
    await assert.rejects(check.run(), /Docker database initialization stopped/);
    assert.deepEqual(mutations(check.events), []);
  }
});

test('a conflicting runtime account or active initializer prevents all database mutation', async () => {
  for (const options of [{ accounts: [{ User: 'skynest_app', Host: 'localhost' }] }, { locked: true }]) {
    const check = scenario(options);
    await assert.rejects(check.run(), /Docker database initialization stopped/);
    assert.deepEqual(mutations(check.events), []);
  }
});

test('interrupted import preserves partial data and does not write a completion marker', async () => {
  const check = scenario({ failSQL: sql => sql.startsWith('CREATE FUNCTION ') });
  await assert.rejects(check.run(), error => {
    assert.match(error.message, /functions.sql statement 1.*ER_TEST_FAILURE/);
    assert.ok(!error.message.includes(config.password));
    return true;
  });
  assert.deepEqual(check.state.schemas, [META_DATABASE, DATABASE]);
  assert.equal(check.state.marker.length, 0);
  assert.equal(check.state.accounts.length, 0);
  assert.ok(!check.events.some(event => /^(DROP|TRUNCATE)/.test(event.sql)));
  assert.ok(check.events.some(event => event.sql.includes('RELEASE_LOCK')));
});

test('runtime verification or marker-write failure locks the newly created account and preserves data', async () => {
  for (const options of [
    { runtimeFailure: true },
    { failSQL: sql => sql.startsWith('INSERT INTO `skynest_docker_meta`') },
  ]) {
    const check = scenario(options);
    await assert.rejects(check.run(), /Docker database initialization stopped/);
    assert.equal(check.state.accountLocked, true);
    assert.equal(check.state.marker.length, 0);
    assert.ok(!check.events.some(event => /^(DROP|TRUNCATE)/.test(event.sql)));
  }
});

test('Docker grant policy includes merged property CRUD while protecting billing, service and audit writes', () => {
  const grants = runtimeGrants();
  verifyGrantRows([...grants].reverse().map(Grants => ({ Grants })));
  verifyGrantRows(["GRANT USAGE ON *.* TO 'skynest_app'@'%'", ...grants]);
  const rights = new Set(grants.flatMap(grantRights));
  for (const table of ['BRANCH', 'ROOM_TYPE', 'AMENITY', 'ROOM_TYPE_AMENITY', 'ROOM']) {
    assert.ok(rights.has(`TABLE:${table}:DELETE`));
  }
  for (const table of ['BILL', 'PAYMENT', 'SERVICE_USAGE', 'AUDIT_LOG']) {
    assert.deepEqual([...rights].filter(right => right.startsWith(`TABLE:${table}:`)), [`TABLE:${table}:SELECT`]);
  }
  assert.ok(rights.has('TABLE:ROOM:UPDATE:roomtypeid'));
  assert.ok(rights.has('TABLE:BRANCH:UPDATE:contactnumber'));
  const unsafe = [
    `GRANT ALL PRIVILEGES ON \`${DATABASE}\`.* TO 'skynest_app'@'%'`,
    `GRANT SELECT ON *.* TO 'skynest_app'@'%'`,
    `GRANT UPDATE ON \`${DATABASE}\`.BILL TO 'skynest_app'@'%'`,
    `GRANT DELETE ON \`${DATABASE}\`.AUDIT_LOG TO 'skynest_app'@'%'`,
    `GRANT SELECT ON \`${DATABASE}\`.BILL TO 'skynest_app'@'%' WITH GRANT OPTION`,
    "GRANT 'extra_role'@'%' TO 'skynest_app'@'%'",
    "GRANT PROXY ON 'root'@'%' TO 'skynest_app'@'%'",
  ];
  for (const extra of unsafe) assert.throws(() => verifyGrantRows([...grants, extra]));
  assert.throws(() => verifyGrantRows(grants.slice(1)), /differ/);
});

test('Docker configuration refuses local-host credentials and unsafe password interpolation', () => {
  for (const changed of [{ DB_HOST: 'localhost' }, { DB_NAME: 'SkyNest_Integration_20261002' },
    { DB_USER: 'root' }, { DB_PASSWORD: "password'" }, { DB_PORT: '3307' }, { DB_ROOT_PASSWORD: '' }]) {
    assert.throws(() => configuration({ ...env, ...changed }));
  }
});

test('the actual shipped seed hashes match documented guest and staff passwords', async () => {
  const seed = scripts.find(script => script.file === 'seed.sql').statements;
  const rowsFor = table => [...seed.find(sql => sql.startsWith(`INSERT INTO ${table} `))
    .matchAll(/\(\d+,\s*'([^']+)',\s*'([^']+)'\)/g)]
    .map(match => ({ Username: match[1], PasswordHash: match[2] }))
    .sort((a, b) => a.Username.localeCompare(b.Username));
  await verifySeedAccounts({ query: async sql => [rowsFor(sql.includes('GUEST_ACCOUNT') ? 'GUEST_ACCOUNT' : 'STAFF_ACCOUNT')] });
});
