'use strict';

// One-shot initialization for the isolated Docker database. Never resets,
// migrates, re-seeds, or changes passwords in an existing installation.
const crypto = require('node:crypto');
const { integrationDatabaseName, projectScripts } = require('../Database/setupIntegrationDb');
const originalPolicy = require('../Database/runtimeUserPolicy');

const DATABASE = 'SkyNest_Integration_Docker';
const META_DATABASE = 'skynest_docker_meta';
const APP_USER = 'skynest_app';
const ACCOUNT = "'skynest_app'@'%'";
const DEFINER = 'root@%';
const LOCK_NAME = 'skynest_docker_initialization_v1';
const MARKER_TABLE = '`skynest_docker_meta`.`initialization`';

function configuration(env = process.env) {
  if (env.DB_HOST !== 'db' || String(env.DB_PORT || '3306') !== '3306' ||
      env.DB_NAME !== DATABASE || env.DB_USER !== APP_USER) {
    throw new Error('Docker initialization requires db:3306, SkyNest_Integration_Docker and skynest_app.');
  }
  integrationDatabaseName(env.DB_NAME);
  if (!env.DB_ROOT_PASSWORD || !/^[a-f0-9]{64}$/.test(env.DB_PASSWORD || '')) {
    throw new Error('Run the Docker environment setup first; root and application credentials are required.');
  }
  return { host: 'db', port: 3306, database: DATABASE, user: APP_USER,
    password: env.DB_PASSWORD, rootPassword: env.DB_ROOT_PASSWORD };
}

function runtimeGrants() {
  // Adapt only the known schema and account tokens. The existing Windows
  // provisioning policy and its localhost-only checks remain unchanged.
  const originalSchema = '`' + originalPolicy.TARGET_DATABASE + '`.';
  const originalRecipient = '`' + originalPolicy.APP_USER + '`@`' + originalPolicy.APP_HOST + '`';
  const grants = originalPolicy.grantStatements(originalPolicy.TARGET_DATABASE).map(sql => {
    if (!sql.includes(originalSchema) || !sql.endsWith(originalRecipient)) {
      throw new Error('The source runtime policy has changed; review Docker provisioning.');
    }
    return sql.replace(originalSchema, '`' + DATABASE + '`.')
      .replace(originalRecipient, '`skynest_app`@`%`');
  });
  // Property CRUD was merged after the original restricted-account policy.
  const propertyRights = {
    BRANCH: 'UPDATE (`Name`, `Location`, `ContactNumber`), DELETE',
    ROOM_TYPE: 'UPDATE (`Name`, `Capacity`, `DailyRate`), DELETE',
    AMENITY: 'UPDATE (`AmenityName`), DELETE',
    ROOM_TYPE_AMENITY: 'DELETE',
    ROOM: 'UPDATE (`RoomNumber`, `RoomTypeID`), DELETE',
  };
  for (const [table, rights] of Object.entries(propertyRights)) {
    grants.push(`GRANT ${rights} ON \`${DATABASE}\`.\`${table}\` TO \`skynest_app\`@\`%\``);
  }
  return grants;
}

function grantRights(sql) {
  // A narrow SHOW GRANTS grammar: reject roles, proxies, global/schema rights,
  // unexpected recipients, GRANT OPTION, and unknown privilege syntax.
  if (typeof sql !== 'string') throw new Error('Invalid runtime grants.');
  const text = sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
  const match = /^GRANT (.+) ON (?:(PROCEDURE|FUNCTION) )?(`?[A-Za-z_][A-Za-z_0-9]*`?|\*)\.(`?[A-Za-z_][A-Za-z_0-9]*`?|\*) TO (?:`skynest_app`|'skynest_app'|skynest_app)@(?:`%`|'%')$/i.exec(text);
  if (!match) throw new Error('Unexpected runtime grants.');
  const [, rights, kind = 'TABLE', rawSchema, rawObject] = match;
  const schema = rawSchema.replaceAll('`', '');
  const object = rawObject.replaceAll('`', '');
  if (schema === '*' && object === '*' && rights.toUpperCase() === 'USAGE' && kind === 'TABLE') return [];
  if (schema !== DATABASE || object === '*') throw new Error('Unexpected runtime grant scope.');
  let rest = rights;
  const result = [];
  while (rest) {
    const privilege = /^(SELECT|INSERT|UPDATE|DELETE|EXECUTE)(?:\s*\(([^)]+)\))?(?:,\s*|$)/i.exec(rest);
    if (!privilege) throw new Error('Unexpected runtime privilege.');
    const name = privilege[1].toUpperCase();
    const columns = privilege[2] ? privilege[2].split(',').map(value => {
      const column = /^`?([A-Za-z_][A-Za-z_0-9]*)`?$/.exec(value.trim());
      if (!column) throw new Error('Unexpected runtime column privilege.');
      return column[1].toLowerCase();
    }) : [];
    if (new Set(columns).size !== columns.length) throw new Error('Duplicate runtime column privilege.');
    if (kind.toUpperCase() !== 'TABLE') {
      if (name !== 'EXECUTE' || columns.length) throw new Error('Unexpected routine privilege.');
      result.push(`${kind.toUpperCase()}:${object}:${name}`);
    } else if (columns.length) {
      if (!['INSERT', 'UPDATE'].includes(name)) throw new Error('Unexpected column privilege.');
      result.push(...columns.map(column => `TABLE:${object}:${name}:${column}`));
    } else result.push(`TABLE:${object}:${name}`);
    rest = rest.slice(privilege[0].length);
  }
  return result;
}

function verifyGrantRows(rows) {
  const expected = new Set(runtimeGrants().flatMap(grantRights));
  if (!Array.isArray(rows) || !rows.length) throw new Error('Missing runtime grants.');
  const actual = new Set(rows.flatMap(row => {
    if (typeof row === 'string') return grantRights(row);
    if (!row || Array.isArray(row) || Object.keys(row).length !== 1) throw new Error('Invalid runtime grant row.');
    return grantRights(Object.values(row)[0]);
  }));
  if (actual.size !== expected.size || [...actual].some(right => !expected.has(right))) {
    throw new Error('Runtime grants differ from the reviewed Docker policy.');
  }
}

function revisionFor(scripts) {
  return crypto.createHash('sha256').update(JSON.stringify({
    format: 1, database: DATABASE, scripts, grants: runtimeGrants(),
  })).digest('hex');
}

async function verifyObjects(connection, scripts) {
  const definitions = scripts.slice(0, -1).flatMap(script => script.statements);
  const names = type => definitions.map(sql => new RegExp(`^CREATE ${type} (\\w+)`).exec(sql)?.[1]).filter(Boolean).sort();
  const same = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify(expected);
  const [tables] = await connection.execute(
    'SELECT TABLE_NAME, TABLE_TYPE, ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?', [DATABASE]);
  if (!same(tables.map(row => row.TABLE_NAME), names('TABLE')) ||
      tables.some(row => row.TABLE_TYPE !== 'BASE TABLE' || row.ENGINE !== 'InnoDB')) {
    throw new Error('Docker database table inventory does not match.');
  }
  const [routines] = await connection.execute(
    'SELECT ROUTINE_NAME, ROUTINE_TYPE, SECURITY_TYPE, DEFINER FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ?', [DATABASE]);
  for (const kind of ['FUNCTION', 'PROCEDURE']) {
    if (!same(routines.filter(row => row.ROUTINE_TYPE === kind).map(row => row.ROUTINE_NAME), names(kind))) {
      throw new Error('Docker database routine inventory does not match.');
    }
  }
  if (routines.some(row => row.SECURITY_TYPE !== 'DEFINER' || row.DEFINER !== DEFINER)) {
    throw new Error('Unexpected Docker routine security or definer.');
  }
  const [triggers] = await connection.execute(
    'SELECT TRIGGER_NAME, DEFINER FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = ?', [DATABASE]);
  if (!same(triggers.map(row => row.TRIGGER_NAME), names('TRIGGER')) || triggers.some(row => row.DEFINER !== DEFINER)) {
    throw new Error('Docker database trigger inventory does not match.');
  }
  const [indexes] = await connection.execute(
    'SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ?', [DATABASE]);
  const found = new Set(indexes.map(row => `${row.TABLE_NAME}:${row.INDEX_NAME}`));
  for (const sql of definitions) {
    const index = /^CREATE INDEX (\w+)\s+ON (\w+)/.exec(sql);
    if (index && !found.has(`${index[2]}:${index[1]}`)) throw new Error('A required Docker database index is missing.');
  }
}

async function verifySeedAccounts(connection) {
  const bcrypt = require('bcryptjs');
  const [guests] = await connection.query('SELECT Username, PasswordHash FROM GUEST_ACCOUNT ORDER BY Username');
  const [staff] = await connection.query('SELECT Username, PasswordHash FROM STAFF_ACCOUNT ORDER BY Username');
  for (const [rows, usernames, password] of [
    [guests, ['kasun', 'oshini'], 'guest123'],
    [staff, ['admin', 'amali', 'nimal', 'sunil'], 'staff123'],
  ]) {
    if (JSON.stringify(rows.map(row => row.Username)) !== JSON.stringify(usernames)) throw new Error('Unexpected Docker seed account inventory.');
    for (const row of rows) {
      if (!await bcrypt.compare(password, row.PasswordHash)) throw new Error('A documented Docker demo password does not match its seeded hash.');
    }
  }
}

async function verifyRuntime(connectRuntime, config, scripts) {
  const connection = await connectRuntime({ host: config.host, port: config.port,
    user: config.user, password: config.password, database: config.database });
  try {
    const [[identity]] = await connection.query('SELECT CURRENT_USER() AS account, CURRENT_ROLE() AS roles, DATABASE() AS databaseName');
    if (identity.account !== 'skynest_app@%' || identity.roles !== 'NONE' || identity.databaseName !== DATABASE) {
      throw new Error('Unexpected Docker runtime identity.');
    }
    const [grants] = await connection.query('SHOW GRANTS');
    verifyGrantRows(grants);
    for (const sql of scripts[0].statements) {
      const table = /^CREATE TABLE (\w+)/.exec(sql)?.[1];
      if (table) await connection.query(`SELECT * FROM \`${table}\` LIMIT 0`);
    }
    await connection.beginTransaction();
    try {
      await connection.query('SELECT ga.GuestID FROM GUEST_ACCOUNT ga JOIN GUEST g ON g.GuestID = ga.GuestID WHERE ga.GuestID = 0 FOR UPDATE OF ga');
      await connection.query('SELECT sa.StaffID FROM STAFF_ACCOUNT sa JOIN STAFF s ON s.StaffID = sa.StaffID WHERE sa.StaffID = 0 FOR UPDATE OF sa');
      await connection.query('SELECT TokenID FROM REFRESH_TOKEN WHERE TokenID = 0 FOR UPDATE');
      await connection.query('SELECT r.RoomID FROM ROOM r JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID WHERE r.RoomID = 0 FOR UPDATE OF r');
      await connection.query('SELECT BookedRoomID FROM BOOKED_ROOMS WHERE BookingID = 0 FOR SHARE');
      for (const table of ['BRANCH', 'ROOM_TYPE', 'AMENITY', 'ROOM_TYPE_AMENITY', 'ROOM']) {
        await connection.query(`DELETE FROM \`${table}\` WHERE 1 = 0`);
      }
      const denied = [
        'SELECT User FROM mysql.user LIMIT 0',
        `SELECT * FROM ${MARKER_TABLE} LIMIT 0`,
        'UPDATE AUDIT_LOG SET Details = Details WHERE 1 = 0',
        'DELETE FROM AUDIT_LOG WHERE 1 = 0',
        'UPDATE BILL SET TotalAmount = TotalAmount WHERE 1 = 0',
        'UPDATE PAYMENT SET Amount = Amount WHERE 1 = 0',
        'UPDATE SERVICE_USAGE SET Quantity = Quantity WHERE 1 = 0',
        'UPDATE STAFF SET Role = Role WHERE 1 = 0',
      ];
      for (const sql of denied) {
        let blocked = false;
        try { await connection.query(sql); }
        catch (error) {
          if (!['ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(error.code)) throw error;
          blocked = true;
        }
        if (!blocked) throw new Error('A Docker runtime permission-denial check unexpectedly succeeded.');
      }
    } finally { await connection.rollback(); }
  } finally { await connection.end(); }
}

async function initialize({ admin, config, connectRuntime, scripts = projectScripts(),
  checks = { verifyObjects, verifyRuntime, verifySeedAccounts } }) {
  const revision = revisionFor(scripts);
  let stage = 'checking initializer identity';
  let locked = false;
  let accountCreated = false;
  let completed = false;
  try {
    const [[identity]] = await admin.query('SELECT CURRENT_USER() AS account, @@lower_case_table_names AS lowerCaseTableNames');
    if (identity.account !== DEFINER || Number(identity.lowerCaseTableNames) !== 0) {
      throw new Error('Expected the isolated Linux MySQL Docker maintenance account.');
    }
    stage = 'acquiring initialization lock';
    const [[lock]] = await admin.execute('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
    if (Number(lock.acquired) !== 1) throw new Error('Another Docker database initializer is already running.');
    locked = true;

    stage = 'checking existing Docker database';
    const [schemas] = await admin.execute(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME IN (?, ?)', [DATABASE, META_DATABASE]);
    if (schemas.length) {
      if (schemas.length !== 2 || ![DATABASE, META_DATABASE].every(name => schemas.some(row => row.SCHEMA_NAME === name))) {
        throw new Error('Incomplete Docker database initialization. Existing data was left untouched.');
      }
      const [markers] = await admin.query(`SELECT Id, DatabaseName, Revision FROM ${MARKER_TABLE}`);
      if (markers.length !== 1 || Number(markers[0].Id) !== 1 || markers[0].DatabaseName !== DATABASE || markers[0].Revision !== revision) {
        throw new Error('Docker initialization marker is incomplete or differs from this source revision. Existing data was left untouched.');
      }
      stage = 'verifying existing Docker schema';
      await checks.verifyObjects(admin, scripts);
      stage = 'verifying existing Docker runtime credentials and permissions';
      await checks.verifyRuntime(connectRuntime, config, scripts);
      return { status: 'reused', revision };
    }

    stage = 'checking for an existing runtime account';
    const [accounts] = await admin.execute('SELECT User, Host FROM mysql.user WHERE User = ?', [APP_USER]);
    if (accounts.length) throw new Error('A Docker runtime account already exists without its completed database. Nothing was changed.');

    stage = 'creating isolated Docker schemas';
    await admin.query(`CREATE DATABASE \`${META_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`CREATE TABLE ${MARKER_TABLE} (Id TINYINT UNSIGNED NOT NULL PRIMARY KEY, DatabaseName VARCHAR(64) NOT NULL, Revision CHAR(64) NOT NULL, CompletedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CHECK (Id = 1)) ENGINE=InnoDB`);
    await admin.query(`CREATE DATABASE \`${DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.query(`USE \`${DATABASE}\``);
    for (const script of scripts) {
      for (let index = 0; index < script.statements.length; index++) {
        stage = `importing ${script.file} statement ${index + 1}`;
        await admin.query(script.statements[index]);
      }
    }
    stage = 'verifying new Docker schema';
    await checks.verifyObjects(admin, scripts);
    stage = 'verifying seeded demo account passwords';
    await checks.verifySeedAccounts(admin);

    stage = 'creating restricted Docker runtime account';
    // The app password's exact 64-hex alphabet was validated before this point.
    // CREATE USER is intentionally not IF NOT EXISTS; never change another account.
    await admin.query(`CREATE USER ${ACCOUNT} IDENTIFIED BY '${config.password}' ACCOUNT LOCK`);
    accountCreated = true;
    stage = 'granting Docker runtime permissions';
    for (const sql of runtimeGrants()) await admin.query(sql);
    const [grants] = await admin.query(`SHOW GRANTS FOR ${ACCOUNT}`);
    verifyGrantRows(grants);
    await admin.query(`ALTER USER ${ACCOUNT} ACCOUNT UNLOCK`);
    stage = 'verifying new Docker runtime connection and permissions';
    await checks.verifyRuntime(connectRuntime, config, scripts);

    stage = 'recording successful Docker initialization';
    await admin.execute(`INSERT INTO ${MARKER_TABLE} (Id, DatabaseName, Revision) VALUES (1, ?, ?)`, [DATABASE, revision]);
    completed = true;
    return { status: 'created', revision };
  } catch (error) {
    if (accountCreated && !completed) {
      try { await admin.query(`ALTER USER ${ACCOUNT} ACCOUNT LOCK`); }
      catch { /* Preserve the original failure; no account is ever deleted. */ }
    }
    // Driver messages may include SQL/passwords. Only emit a fixed stage plus
    // a constrained error code, never error.sql, error.message, or a stack.
    const code = /^[A-Z0-9_]+$/.test(error.code || '') ? ` (${error.code})` : '';
    throw new Error(`Docker database initialization stopped while ${stage}${code}. Existing data was preserved; inspect the Docker database before retrying.`, { cause: undefined });
  } finally {
    if (locked) {
      // A closed connection also releases the advisory lock.
      try { await admin.execute('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); }
      catch { /* main always closes this connection below. */ }
    }
  }
}

async function main() {
  const config = configuration();
  const mysql = require('mysql2/promise');
  const scripts = projectScripts();
  let admin;
  try {
    admin = await mysql.createConnection({ host: config.host, port: config.port,
      user: 'root', password: config.rootPassword, multipleStatements: false });
    const result = await initialize({ admin, config, scripts, connectRuntime: options => mysql.createConnection(options) });
    console.log(result.status === 'created'
      ? 'Docker database initialized: 17 application tables, demo accounts and restricted runtime permissions verified.'
      : 'Existing Docker database verified; saved data and account passwords were preserved.');
  } finally { if (admin) await admin.end(); }
}

if (require.main === module) {
  main().catch(error => {
    const safe = error.code ? `Cannot connect to the Docker database (${String(error.code).replace(/[^A-Z0-9_]/g, '') || 'DATABASE_ERROR'}).`
      : (error.message.startsWith('Docker database initialization stopped') ||
         error.message.startsWith('Docker initialization requires') ||
         error.message.startsWith('Run the Docker environment setup'))
        ? error.message : 'Docker database initialization stopped. Check the packaged source files and Docker environment.';
    console.error(safe);
    process.exitCode = 1;
  });
}

module.exports = { DATABASE, META_DATABASE, configuration, runtimeGrants, grantRights,
  verifyGrantRows, revisionFor, verifyObjects, verifySeedAccounts, verifyRuntime, initialize };
