'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dotenv = require('dotenv');
const { configuration, runtimeText, provision } = require('../Database/setupRuntimeUser');
const { verifyTarget, checkRuntimeAccess } = require('../Database/runtimeUserAccess');
const { grantStatements } = require('../Database/runtimeUserPolicy');
const { command } = require('../Database/runMaintenance');

const database = 'skynest_integration_20261002';
const config = { host: 'localhost', port: 3306, database: 'SkyNest_Integration_20261002', user: 'root', password: 'test-maintenance-only' };
const password = 'Aa1!' + 'ab'.repeat(32);
const original = '# keep these comments\r\nDB_HOST=localhost\r\nDB_PORT=3306\r\nDB_NAME=SkyNest_Integration_20261002\r\n' +
  'DB_USER=root\r\nDB_PASSWORD="test-maintenance-only"\r\nJWT_SECRET="keep-access-value"\r\n' +
  'JWT_REFRESH_SECRET="keep-refresh-value"\r\nPORT=5000\r\nCUSTOM_SETTING="retain # this"\r\n';
const identity = { databaseName: database, currentUser: 'root@localhost', activeRoles: 'NONE', lowerCaseTableNames: 1, mandatoryRoles: '' };
const routines = [
  ...['sp_make_booking', 'sp_check_in', 'sp_check_out', 'sp_log_service_usage', 'sp_process_payment', 'sp_update_booked_room'].map(ROUTINE_NAME => ({ ROUTINE_NAME, ROUTINE_TYPE: 'PROCEDURE' })),
  ...['fn_calculate_room_charges', 'fn_calculate_service_charges', 'fn_calculate_outstanding_balance'].map(ROUTINE_NAME => ({ ROUTINE_NAME, ROUTINE_TYPE: 'FUNCTION' })),
].map(row => ({ ...row, SECURITY_TYPE: 'DEFINER', DEFINER: 'root@localhost' }));
// Permission fixtures are deliberately separate from production's probe list.
const denialSql = [
  'SELECT User FROM mysql.user LIMIT 0',
  'UPDATE AUDIT_LOG SET Details = Details WHERE 1 = 0',
  'DELETE FROM AUDIT_LOG WHERE 1 = 0',
  'UPDATE BILL SET TotalAmount = TotalAmount WHERE 1 = 0',
  'UPDATE PAYMENT SET Amount = Amount WHERE 1 = 0',
  'UPDATE SERVICE_USAGE SET Quantity = Quantity WHERE 1 = 0',
  'UPDATE STAFF SET Role = Role WHERE 1 = 0',
];
const deniedCodes = ['ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'];
// Independent fixtures: exact new runtime lock syntax and selected columns.
const branchLockSql = [
  'SELECT BookingStatus FROM BOOKING WHERE BookingID = 0 FOR UPDATE',
  'SELECT s.StaffID, s.Role, s.BranchID FROM STAFF s JOIN STAFF_ACCOUNT a ON a.StaffID = s.StaffID WHERE s.StaffID = 0 FOR SHARE',
  'SELECT RoomID, BranchID FROM ROOM WHERE RoomID = 0 FOR UPDATE',
  'SELECT br.BookedRoomID, r.BranchID FROM BOOKED_ROOMS br LEFT JOIN ROOM r ON r.RoomID = br.RoomID WHERE br.BookingID = 0 ORDER BY br.BookedRoomID FOR SHARE OF br',
];
const compactSql = sql => sql.replace(/\s+/g, ' ').trim();

const sqlError = code => Object.assign(new Error('private driver detail must not be printed'), { code });

function mock(options = {}) {
  const events = [];
  let locked;
  const event = (who, sql, params) => events.push({ who, sql, params });
  const goodGrants = grantStatements(database);
  const admin = {
    async query(sql) {
      event('admin', sql);
      if (sql.startsWith('SELECT DATABASE()')) return [[{ ...identity, ...options.adminIdentity }]];
      if (/^SELECT \* FROM `\w+` LIMIT 0$/.test(sql)) {
        if (options.missingTable && sql.includes('`AUDIT_LOG`')) throw sqlError('ER_NO_SUCH_TABLE');
        return [[]];
      }
      if (sql.startsWith('CREATE USER')) {
        assert.match(sql, / ACCOUNT LOCK$/);
        if (options.createFailure) {
          // The server may have committed CREATE, or an unrelated administrator
          // may have won the race after preflight. Neither is acknowledged here.
          if (options.createOutcome === 'created') locked = true;
          if (options.createOutcome === 'raced') locked = false;
          throw sqlError(options.createFailure);
        }
        locked = true;
        return [{}];
      }
      if (sql.startsWith('GRANT ')) {
        assert.equal(locked, true, 'Do not grant privileges to an unlocked account.');
        if (options.grantFailure) throw sqlError('ER_SPECIFIC_ACCESS_DENIED_ERROR');
        return [{}];
      }
      if (sql.startsWith('SHOW GRANTS FOR')) return [options.adminGrants || goodGrants];
      if (sql.endsWith('ACCOUNT UNLOCK')) {
        locked = false;
        if (options.unlockFailure) throw sqlError('PROTOCOL_CONNECTION_LOST');
        return [{}];
      }
      if (sql.endsWith('ACCOUNT LOCK')) {
        if (options.relockFailure) throw sqlError('PROTOCOL_CONNECTION_LOST');
        locked = true;
        return [{}];
      }
      throw new Error('Unexpected admin query: ' + sql);
    },
    async execute(sql, params) {
      event('admin', sql, params);
      if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: options.lockBusy ? 0 : 1 }]];
      if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
      if (sql.startsWith('SELECT User, Host')) return [options.existing ? [{ User: 'skynest_app', Host: '%' }] : []];
      if (sql.includes('INFORMATION_SCHEMA.ROUTINES')) return [options.routines || routines];
      throw new Error('Unexpected admin execute: ' + sql);
    },
    async end() { event('admin', 'END'); },
  };
  const runtime = {
    async query(sql) {
      event('runtime', sql);
      if (sql.startsWith('SELECT DATABASE()')) return [[{ ...identity, currentUser: 'skynest_app@localhost', ...options.runtimeIdentity }]];
      if (sql === 'SHOW GRANTS') return [options.runtimeGrants || goodGrants];
      if (/^SELECT \* FROM `\w+` LIMIT 0$/.test(sql)) return [[]];
      if (/ FOR (UPDATE|SHARE)(?: OF \w+)?$/.test(sql)) {
        if (options.lockFailure || options.branchLockFailure === compactSql(sql)) throw sqlError('ER_TABLEACCESS_DENIED_ERROR');
        return [[]];
      }
      if (denialSql.includes(sql)) {
        if (options.allowedProbe === sql) return [[]];
        throw sqlError(options.denialError || deniedCodes[denialSql.indexOf(sql) % 3]);
      }
      throw new Error('Unexpected runtime query: ' + sql);
    },
    async execute(sql, params) {
      event('runtime', sql, params);
      if (sql.includes('INFORMATION_SCHEMA.ROUTINES')) return [options.runtimeRoutines || routines];
      throw new Error('Unexpected runtime execute: ' + sql);
    },
    async beginTransaction() { event('runtime', 'BEGIN'); },
    async rollback() { event('runtime', 'ROLLBACK'); },
    async end() {
      event('runtime', 'END');
      if (options.endFailure) throw sqlError('PROTOCOL_CONNECTION_LOST');
    },
  };
  const parameters = {
    admin, config, password, backendStopped: true,
    async saveCredentials() {
      event('file', 'SAVE_CREDENTIALS');
      if (options.fileFailure) throw Object.assign(new Error('private files unavailable'), { code: 'EACCES' });
    },
    async connectRuntime(received) {
      event('runtime', 'CONNECT', received);
      assert.equal(locked, false);
      assert.equal(received.user, 'skynest_app');
      assert.equal(received.password, password);
      if (options.connectFailure) throw sqlError('ER_ACCESS_DENIED_ERROR');
      return runtime;
    },
  };
  return { events, admin, runtime, parameters, get locked() { return locked; } };
}
const ddl = events => events.filter(e => /^(CREATE|GRANT|ALTER|DROP|TRUNCATE)\b/.test(e.sql));
const index = (events, match) => events.findIndex(e => match(e.sql, e));
const wasReleased = fixture => assert.ok(fixture.events.some(e => e.sql.startsWith('SELECT RELEASE_LOCK')));

// Load the real CLI body with in-memory fs/MySQL. Only expose its private main
// in this test VM; no files, accounts, processes or DB connections are created.
function setupCli(options = {}) {
  const fixture = mock();
  const writes = [];
  const output = [];
  const processStub = { argv: ['node', 'setupRuntimeUser.js', '--backend-stopped'], env: {}, ...options.process };
  const moduleStub = { exports: {} };
  const injectedRequire = name => {
    if (name === 'node:fs') return {
      existsSync: file => (options.existingFile || '').endsWith(path.basename(file)),
      readFileSync: () => original,
      writeFileSync(file, contents, opts) {
        fixture.events.push({ who: 'file', sql: 'WRITE:' + path.basename(file) });
        writes.push({ file, contents, opts });
        if (options.failWrite === writes.length) throw Object.assign(new Error('file unavailable'), { code: 'EACCES' });
      },
    };
    if (name === 'node:crypto') return { randomBytes: () => Buffer.from('ab'.repeat(32), 'hex') };
    if (name === 'mysql2/promise') return { createConnection: async received => received.user === 'root' ? fixture.admin : fixture.parameters.connectRuntime(received) };
    if (name.startsWith('./')) return require(path.join(__dirname, '../Database', name));
    return require(name);
  };
  injectedRequire.main = {};
  const source = fs.readFileSync(path.join(__dirname, '../Database/setupRuntimeUser.js'), 'utf8');
  vm.runInNewContext(source + '\nmodule.exports.testMain = main;', {
    require: injectedRequire, module: moduleStub, __dirname: path.join(__dirname, '../Database'), process: processStub,
    console: { log: message => output.push(message), error: message => output.push(message) },
  });
  return { ...fixture, writes, output, run: moduleStub.exports.testMain };
}

(async () => {
  assert.deepEqual(configuration(dotenv.parse(original)), config);
  for (const host of ['localhost', '127.0.0.1', '::1']) assert.equal(configuration({ ...dotenv.parse(original), DB_HOST: host }).host, host);
  for (const change of [{ DB_NAME: database }, { DB_NAME: 'mysql' }, { DB_USER: 'skynest_app' }, { DB_PASSWORD: '' },
    { DB_HOST: 'remote.example' }, { DB_HOST: 'LOCALHOST' }, { DB_PORT: '0' }, { DB_PORT: '65536' }, { DB_PORT: '3306;foo' }]) {
    assert.throws(() => configuration({ ...dotenv.parse(original), ...change }));
  }
  const revised = runtimeText(original + 'export DB_USER=duplicate\n  DB_PASSWORD=duplicate\n', password);
  const expected = { ...dotenv.parse(original), DB_USER: 'skynest_app', DB_PASSWORD: password };
  assert.deepEqual(dotenv.parse(revised), expected, 'Only the database username/password values may change.');
  assert.ok(revised.includes('# keep these comments'));
  assert.equal(revised.match(/^DB_USER=/gm).length, 1);
  assert.equal(revised.match(/^DB_PASSWORD=/gm).length, 1);
  for (const unsafe of ['', 'a'.repeat(64), password + "'", password + '\\', password + '\n', password.replace('ab', 'AB'), 'Aa1!' + 'g'.repeat(64)]) {
    assert.throws(() => runtimeText(original, unsafe), /credential/);
  }

  assert.equal(verifyTarget(config, identity), database);
  assert.equal(verifyTarget(config, { ...identity, lowerCaseTableNames: 2, databaseName: 'SkyNest_Integration_20261002' }), config.database);
  assert.equal(verifyTarget(config, { ...identity, lowerCaseTableNames: 0, databaseName: config.database }), config.database);
  for (const changed of [{ lowerCaseTableNames: 0 }, { lowerCaseTableNames: 3 }, { lowerCaseTableNames: '1' },
    { databaseName: 'SkyNest_Hotels' }, { databaseName: database + '`' }, { mandatoryRoles: 'extra_role' }]) {
    assert.throws(() => verifyTarget(config, { ...identity, ...changed }));
  }
  for (const changed of [{ database: database }, { host: 'example.com' }]) assert.throws(() => verifyTarget({ ...config, ...changed }, identity));

  // Rejected setup inputs/accounts/definitions must never create an account or write credentials.
  for (const options of [{ adminIdentity: { currentUser: 'root@%' } }, { adminIdentity: { activeRoles: '`admin`@`%`' } },
    { adminIdentity: { mandatoryRoles: 'admin' } }, { adminIdentity: { databaseName: 'SkyNest_Hotels' } },
    { lockBusy: true }, { existing: true }, { missingTable: true },
    { routines: routines.slice(1) }, { routines: routines.map(r => ({ ...r, SECURITY_TYPE: 'INVOKER' })) },
    { routines: routines.map(r => ({ ...r, DEFINER: 'someone@localhost' })) }]) {
    const fixture = mock(options);
    await assert.rejects(provision(fixture.parameters));
    assert.equal(ddl(fixture.events).length, 0);
    assert.equal(fixture.events.some(e => e.who === 'file'), false);
    if (fixture.events.some(e => e.sql.startsWith('SELECT User, Host'))) wasReleased(fixture);
  }
  for (const changed of [{ backendStopped: false }, { password: "bad'password" }, { config: { ...config, user: 'app' } }]) {
    const fixture = mock();
    await assert.rejects(provision({ ...fixture.parameters, ...changed }));
    assert.equal(fixture.events.length, 0);
  }

  const success = mock();
  const result = await provision(success.parameters);
  assert.equal(result.currentUser, 'skynest_app@localhost');
  assert.equal(success.locked, false);
  const createdAt = index(success.events, sql => sql.startsWith('CREATE USER'));
  assert.ok(index(success.events, sql => sql === 'SAVE_CREDENTIALS') < createdAt);
  const grantEvents = success.events.filter(e => e.sql.startsWith('GRANT '));
  assert.deepEqual(grantEvents.map(e => e.sql), grantStatements(database));
  const unlockAt = index(success.events, sql => sql.endsWith('ACCOUNT UNLOCK'));
  assert.ok(success.events.lastIndexOf(grantEvents.at(-1)) < index(success.events, sql => sql.startsWith('SHOW GRANTS FOR')));
  assert.ok(index(success.events, sql => sql.startsWith('SHOW GRANTS FOR')) < unlockAt);
  assert.ok(unlockAt < index(success.events, sql => sql === 'CONNECT'));
  assert.deepEqual(success.events.filter(e => e.who === 'runtime' && /^(BEGIN|ROLLBACK|END)$/.test(e.sql)).map(e => e.sql), ['BEGIN', 'ROLLBACK', 'END']);
  wasReleased(success);
  const actualProbes = success.events.filter(e => e.who === 'runtime' && denialSql.includes(e.sql)).map(e => e.sql);
  assert.deepEqual(actualProbes, denialSql);
  assert.ok(actualProbes.filter(sql => /^(UPDATE|DELETE)/.test(sql)).every(sql => / WHERE 1 = 0$/.test(sql)));
  const locks = success.events.filter(e => e.who === 'runtime' && / FOR (UPDATE|SHARE)/.test(e.sql)).map(e => e.sql);
  assert.equal(locks.length, 9);
  assert.equal(result.lockingReads, 9);
  assert.deepEqual(locks.slice(5).map(compactSql), branchLockSql);
  assert.ok(locks.every(sql => /(?:GuestID|StaffID|TokenID|RoomID|BookingID) = 0/.test(sql)));
  assert.match(locks[0], /FOR UPDATE OF ga$/);
  assert.match(locks[1], /FOR UPDATE OF sa$/);
  assert.match(locks[2], /FOR UPDATE$/);
  assert.match(locks[3], /FOR UPDATE OF r$/);
  assert.match(locks[4], /FOR SHARE$/);
  assert.equal(success.events.some(e => e.who === 'runtime' && /^(CALL|CREATE|ALTER|DROP|TRUNCATE|INSERT)\b/.test(e.sql)), false);

  const extras = [...grantStatements(database), `GRANT SELECT ON *.* TO 'skynest_app'@'localhost'`];
  const missing = grantStatements(database).slice(1);
  for (const options of [{ grantFailure: true }, { adminGrants: extras }, { adminGrants: missing },
    { unlockFailure: true }, { connectFailure: true }, { lockFailure: true }, { runtimeGrants: extras }, { runtimeGrants: missing },
    { runtimeIdentity: { currentUser: 'root@localhost' } }, { runtimeIdentity: { activeRoles: 'extra_role' } },
    { runtimeRoutines: routines.slice(1) }, { allowedProbe: denialSql[0] }, { allowedProbe: denialSql[1] },
    { denialError: 'ER_BAD_FIELD_ERROR' }]) {
    const fixture = mock(options);
    await assert.rejects(provision(fixture.parameters), /locked|stopped/i);
    assert.equal(fixture.locked, true, 'Any failure after acknowledged CREATE must lock the candidate account.');
    assert.ok(fixture.events.some(e => e.sql.endsWith('ACCOUNT LOCK')));
    assert.equal(fixture.events.some(e => /^DROP\b/.test(e.sql)), false);
    wasReleased(fixture);
    if (fixture.events.some(e => e.who === 'runtime' && e.sql.startsWith('SELECT DATABASE()'))) {
      assert.ok(fixture.events.some(e => e.who === 'runtime' && e.sql === 'END'));
    }
    if (fixture.events.some(e => e.sql === 'BEGIN')) assert.ok(fixture.events.some(e => e.sql === 'ROLLBACK'));
  }
  // Without CREATE acknowledgement, never ALTER a possibly pre-existing account.
  // Our CREATE itself requests ACCOUNT LOCK, so a lost successful response is safe.
  for (const options of [
    { createFailure: 'PROTOCOL_CONNECTION_LOST' },
    { createFailure: 'PROTOCOL_CONNECTION_LOST', createOutcome: 'created' },
    { createFailure: 'ER_CANNOT_USER', createOutcome: 'raced' },
  ]) {
    const fixture = mock(options);
    await assert.rejects(provision(fixture.parameters), /creation could not be confirmed/i);
    assert.equal(ddl(fixture.events).length, 1, 'Only CREATE may be attempted when its ownership is unconfirmed.');
    assert.match(ddl(fixture.events)[0].sql, /^CREATE USER .* ACCOUNT LOCK$/);
    assert.equal(fixture.locked, options.createOutcome === 'created' ? true : options.createOutcome === 'raced' ? false : undefined);
    assert.equal(fixture.events.some(e => e.sql === 'CONNECT'), false);
    wasReleased(fixture);
  }
  const relockFailure = mock({ unlockFailure: true, relockFailure: true });
  await assert.rejects(provision(relockFailure.parameters), /lock state could not be confirmed/i);
  wasReleased(relockFailure);
  const saveFailure = mock({ fileFailure: true });
  await assert.rejects(provision(saveFailure.parameters));
  assert.equal(ddl(saveFailure.events).length, 0);
  wasReleased(saveFailure);

  for (const options of [{ runtimeIdentity: { databaseName: 'mysql' } }, { runtimeIdentity: { lowerCaseTableNames: 0 } },
    { runtimeIdentity: { mandatoryRoles: 'admin' } }, { runtimeIdentity: { currentUser: 'skynest_app@%' } }]) {
    const fixture = mock(options);
    await assert.rejects(checkRuntimeAccess(fixture.runtime, { ...config, user: 'skynest_app' }));
    assert.equal(fixture.events.some(e => e.sql === 'BEGIN'), false);
  }
  for (const sql of branchLockSql) {
    const fixture = mock({ branchLockFailure: sql });
    await assert.rejects(checkRuntimeAccess(fixture.runtime, { ...config, user: 'skynest_app' }), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
    assert.equal(fixture.events.filter(e => e.sql === 'BEGIN').length, 1);
    assert.equal(fixture.events.filter(e => e.sql === 'ROLLBACK').length, 1);
    assert.equal(fixture.events.some(e => denialSql.includes(e.sql)), false);
    assert.equal(fixture.events.some(e => /^(CALL|CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE)\b/.test(e.sql)), false);
  }
  const cleanupFailure = mock({ endFailure: true });
  await assert.rejects(provision(cleanupFailure.parameters));
  wasReleased(cleanupFailure);

  const cli = setupCli();
  await cli.run();
  assert.deepEqual(cli.writes.map(write => path.basename(write.file)), ['.env.maintenance', '.env.runtime']);
  assert.equal(cli.writes[0].contents, original);
  assert.deepEqual(dotenv.parse(cli.writes[1].contents), expected);
  assert.ok(cli.writes.every(write => write.opts.flag === 'wx' && write.opts.mode === 0o600));
  assert.ok(index(cli.events, sql => sql === 'WRITE:.env.runtime') < index(cli.events, sql => sql.startsWith('CREATE USER')));
  assert.equal(cli.output.join('\n').includes(password), false);
  assert.equal(cli.output.join('\n').includes(config.password), false);
  assert.ok(cli.events.some(e => e.who === 'admin' && e.sql === 'END'));
  for (const file of ['.env.maintenance', '.env.runtime']) {
    const exists = setupCli({ existingFile: file });
    await assert.rejects(exists.run(), /already exist/);
    assert.equal(exists.writes.length + exists.events.length, 0);
  }
  for (const failWrite of [1, 2]) {
    const failed = setupCli({ failWrite });
    await assert.rejects(failed.run());
    assert.equal(ddl(failed.events).length, 0);
    assert.ok(failed.events.some(e => e.who === 'admin' && e.sql === 'END'));
  }
  for (const process of [{ argv: ['node', 'setup', '--force'] }, { argv: ['node', 'setup'] }, { env: { db_PASSWORD: 'override' } }]) {
    const bad = setupCli({ process });
    await assert.rejects(bad.run());
    assert.equal(bad.events.length + bad.writes.length, 0);
  }

  const shellEnvironment = { PATH: 'test-path', DB_USER: 'unsafe', db_password: 'unsafe', JWT_SECRET: 'runtime-access', OTHER: 'retained' };
  for (const script of ['setupIntegrationDb.js', 'addBookingUpdate.js', 'addAuditLog.js', 'updateBillingRoutine.js']) {
    const task = command([script, '--backend-stopped'], original, shellEnvironment);
    assert.equal(task.script, path.join(__dirname, '../Database', script));
    assert.deepEqual(task.args, ['--backend-stopped']);
    assert.equal(task.env.DB_USER, 'root');
    assert.equal(task.env.DB_PASSWORD, config.password);
    assert.equal(task.env.DB_NAME, config.database);
    assert.equal(task.env.db_password, undefined);
    assert.equal(task.env.JWT_SECRET, 'runtime-access');
    assert.equal(task.env.OTHER, 'retained');
    assert.deepEqual(shellEnvironment, { PATH: 'test-path', DB_USER: 'unsafe', db_password: 'unsafe', JWT_SECRET: 'runtime-access', OTHER: 'retained' });
  }
  for (const args of [[], ['server.js'], ['../server.js'], ['addAuditLog.js;whoami'], ['addAuditLog.js', '--force'], ['addAuditLog.js', '--backend-stopped', '--backend-stopped']]) {
    assert.throws(() => command(args, original));
  }
  assert.throws(() => command(['addAuditLog.js'], revised), /root/);
  const spawned = [];
  const maintenanceModule = { exports: {} };
  const maintenanceProcess = { argv: ['node', 'runMaintenance', 'addAuditLog.js', '--backend-stopped'], env: shellEnvironment, execPath: '/test/node' };
  const maintenanceRequire = name => {
    if (name === 'node:fs') return { readFileSync: () => original };
    if (name === 'node:child_process') return { spawnSync: (...args) => { spawned.push(args); return { status: 0 }; } };
    if (name.startsWith('./')) return require(path.join(__dirname, '../Database', name));
    return require(name);
  };
  maintenanceRequire.main = maintenanceModule;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../Database/runMaintenance.js'), 'utf8'), {
    require: maintenanceRequire, module: maintenanceModule, __dirname: path.join(__dirname, '../Database'), process: maintenanceProcess,
    console: { error: () => {} },
  });
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0][0], '/test/node');
  assert.equal(spawned[0][1][0], path.join(__dirname, '../Database/addAuditLog.js'));
  assert.equal(spawned[0][2].shell, false);
  assert.equal(spawned[0][2].cwd, path.join(__dirname, '..'));
  assert.equal(spawned[0][2].env.DB_USER, 'root');
  assert.equal(maintenanceProcess.exitCode, 0);

  // The runtime pool always requests backend/.env, regardless of terminal cwd,
  // and must not silently regain root privileges when DB_USER is missing.
  for (const user of [undefined, '', 'skynest_app']) {
    const requestedPaths = [];
    const pools = [];
    const runtimeEnvironment = { DB_HOST: 'localhost', DB_NAME: config.database, DB_PASSWORD: password };
    if (user !== undefined) runtimeEnvironment.DB_USER = user;
    const evaluatePool = () => vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../config/db.js'), 'utf8'), {
      __dirname: path.join(__dirname, '../config'), module: { exports: {} }, process: { env: runtimeEnvironment },
      require: name => {
        if (name === 'mysql2/promise') return { createPool: settings => { pools.push(settings); return {}; } };
        if (name === 'dotenv') return { config: settings => { requestedPaths.push(settings.path); return {}; } };
        return require(name);
      },
    });
    if (user) evaluatePool();
    else assert.throws(evaluatePool, /Set DB_USER explicitly/);
    assert.deepEqual(requestedPaths, [path.join(__dirname, '../.env')]);
    assert.equal(pools.length, user ? 1 : 0);
    if (user) {
      assert.equal(pools[0].user, 'skynest_app');
      assert.equal(pools[0].password, password);
    }
  }

  console.log('PASS: runtime setup target/identity/role/definition gates; exclusive credential files before locked creation; exact grants before unlock; unconfirmed CREATE/raced-account protection, failure locking and cleanup; real empty locking and denied-DML probe shapes; configuration preservation, explicit runtime env/no root fallback and maintenance whitelist/child credentials (mock MySQL/fs/process; no live server).');
})().catch(error => { console.error(error); process.exitCode = 1; });
