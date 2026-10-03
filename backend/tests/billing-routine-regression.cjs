const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { TARGET_DATABASE, OLD_ROUTINE, NEW_ROUTINE, canonicalSql, currentSchemaRoutine,
  targetDatabase, backupRoutine, migrateBillingRoutine } = require('../Database/updateBillingRoutine');

// These are SQL-contract and mocked migration recovery checks, not a live MySQL
// execution test. A real integration server must still verify checkout behavior.
const creationContext = { sql_mode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION',
  character_set_client: 'utf8mb4', collation_connection: 'utf8mb4_unicode_ci',
  'Database Collation': 'utf8mb4_unicode_ci' };
const withDefiner = sql => sql.replace(/^CREATE /, 'CREATE DEFINER=`root`@`localhost` ')
  .replace('PROCEDURE sp_recalculate_bill(', 'PROCEDURE `sp_recalculate_bill`(');
const row = (sql = OLD_ROUTINE) => ({ Procedure: 'sp_recalculate_bill',
  'Create Procedure': withDefiner(sql), ...creationContext });
const databaseError = code => Object.assign(new Error('private driver details must not appear'), { code });

function fixture(options = {}) {
  const events = [];
  const selectedDatabase = Object.hasOwn(options, 'selectedDatabase') ? options.selectedDatabase : TARGET_DATABASE;
  const lowerCaseTableNames = Object.hasOwn(options, 'lowerCaseTableNames') ? options.lowerCaseTableNames : 0;
  let installed = options.initial === undefined ? row() : options.initial;
  let attemptedReplacement = false;
  const connection = {
    query: run,
    execute: run,
  };
  async function run(sql, values) {
    events.push({ sql, values });
    // No data writes, table/database DDL, or application CALL are permitted.
    assert.doesNotMatch(sql, /^(?:INSERT|UPDATE|DELETE|TRUNCATE|CALL|START TRANSACTION|COMMIT|ROLLBACK)\b/i);
    assert.doesNotMatch(sql, /^(?:DROP|CREATE|ALTER)\s+(?:TABLE|DATABASE|SCHEMA)\b/i);
    if (sql.startsWith('SELECT DATABASE()')) {
      assert.ok(sql.includes('@@lower_case_table_names AS lowerCaseTableNames'), 'Read the actual server setting; never infer it from the client OS.');
      return [[{ databaseName: selectedDatabase, lowerCaseTableNames, currentUser: options.currentUser || 'root@localhost', databaseCollation: options.databaseCollation || 'utf8mb4_unicode_ci' }]];
    }
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: Object.hasOwn(options, 'lock') ? options.lock : 1 }]];
    if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.startsWith('SHOW CREATE')) {
      if (attemptedReplacement && options.unreadableAfterCreate) throw databaseError('PROTOCOL_CONNECTION_LOST');
      if (installed === null) throw databaseError('ER_SP_DOES_NOT_EXIST');
      return [[structuredClone(installed)]];
    }
    if (sql.includes('FROM mysql.procs_priv')) {
      const insensitive = [1, 2].includes(lowerCaseTableNames);
      assert.ok(sql.includes(insensitive ? 'WHERE LOWER(Db) = ?' : 'WHERE Db = ?'), 'Do not miss folded grant names or conflate distinct case-sensitive databases.');
      assert.deepEqual(values, [insensitive ? TARGET_DATABASE.toLowerCase() : TARGET_DATABASE, 'sp_recalculate_bill', 'PROCEDURE']);
      if (options.grantsError) throw databaseError('ER_TABLEACCESS_DENIED_ERROR');
      return [(options.grants || []).filter(grant => grant.Db === undefined ||
        (insensitive ? grant.Db.toLowerCase() : grant.Db) === values[0])];
    }
    if (sql.startsWith('SET SESSION')) {
      assert.deepEqual(values, Object.values(creationContext).slice(0, 3));
      if (options.contextError) throw databaseError('ER_WRONG_VALUE_FOR_VAR');
      return [[]];
    }
    if (sql.startsWith('DROP PROCEDURE')) {
      assert.equal(sql, `DROP PROCEDURE \`${TARGET_DATABASE}\`.\`sp_recalculate_bill\``);
      if (options.dropError) throw databaseError('ER_PROCACCESS_DENIED_ERROR');
      installed = null;
      return [[]];
    }
    if (sql.startsWith('CREATE DEFINER')) {
      const isReplacement = sql.includes('SELECT RoomCharges INTO v_room_charges');
      if (isReplacement) {
        attemptedReplacement = true;
        if (options.createAppliedButFailed) installed = { ...row(), 'Create Procedure': sql };
        if (options.createError || options.createAppliedButFailed || options.unreadableAfterCreate) throw databaseError('ER_PARSE_ERROR');
      } else if (options.restoreError) throw databaseError('ER_PROCACCESS_DENIED_ERROR');
      assert.equal(installed, null, 'Never overwrite/drop a routine during recovery.');
      installed = { ...row(), 'Create Procedure': sql };
      return [[]];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
  const backupPath = path.join(os.tmpdir(), 'mock-skynest-backup', 'original-routine.json');
  const writeBackup = original => {
    events.push({ backup: structuredClone(original) });
    if (options.backupError) throw new Error('Backup failed.');
    return backupPath;
  };
  return { events, connection, writeBackup, backupPath, installed: () => installed,
    migrate: overrides => migrateBillingRoutine({ connection, database: TARGET_DATABASE,
      backendStopped: true, writeBackup, ...overrides }) };
}
const ddl = test => test.events.filter(event => /^(DROP|CREATE)/.test(event.sql || ''));
const released = test => test.events.at(-1)?.sql?.startsWith('SELECT RELEASE_LOCK');

(async () => {
  const sql = currentSchemaRoutine();
  assert.equal(canonicalSql(sql), canonicalSql(NEW_ROUTINE), 'Fresh schema and the targeted updater must install the same procedure.');
  assert.match(sql, /SELECT RoomCharges INTO v_room_charges\s+FROM BILL WHERE BookingID = p_booking_id FOR UPDATE/);
  assert.match(sql, /IF v_room_charges IS NULL THEN\s+SIGNAL SQLSTATE '45000'/);
  assert.doesNotMatch(sql, /fn_calculate_room_charges|SET RoomCharges\s*=|START TRANSACTION|COMMIT|ROLLBACK/);
  assert.match(sql, /SET v_service_charges = fn_calculate_service_charges\(p_booking_id\)/);
  assert.match(sql, /SELECT IFNULL\(SUM\(Amount\),0\) FROM PAYMENT WHERE BookingID = p_booking_id/);
  assert.match(sql, /CASE WHEN v_balance <= 0 THEN 'Paid'\s+WHEN v_balance < v_total THEN 'Partially Paid'\s+ELSE 'Unpaid' END/);
  assert.notEqual(canonicalSql(OLD_ROUTINE.replace("'Partially Paid'", "'Partially  Paid'")), canonicalSql(OLD_ROUTINE));
  assert.notEqual(canonicalSql(OLD_ROUTINE.replace('UPDATE BILL', 'UPDATE bill')), canonicalSql(OLD_ROUTINE), 'Table case changes must not be silently accepted on case-sensitive MySQL hosts.');
  assert.throws(() => canonicalSql(OLD_ROUTINE.replace('WHERE BookingID = p_booking_id;', 'WHERE BookingID = p_booking_id--@offset\n;')), /Unrecognized SQL/);

  for (const value of [undefined, '', 'SkyNest_Hotels', TARGET_DATABASE.toLowerCase(), `${TARGET_DATABASE} `, 'SkyNest_Integration_20261003']) {
    assert.throws(() => targetDatabase(value), /exactly/);
    const test = fixture();
    await assert.rejects(test.migrate({ database: value }), /exactly/);
    assert.equal(test.events.length, 0);
  }
  let test = fixture();
  await assert.rejects(test.migrate({ backendStopped: false }), /Stop the backend/);
  assert.equal(test.events.length, 0);

  test = fixture({ selectedDatabase: 'SkyNest_Hotels' });
  await assert.rejects(test.migrate(), /selected database/);
  assert.equal(ddl(test).length, 0);

  // Windows stores the schema name in lowercase by default; case-insensitive
  // hosts must accept the same target without weakening checks on other hosts.
  for (const lowerCaseTableNames of [1, 2]) {
    for (const selectedDatabase of [TARGET_DATABASE, TARGET_DATABASE.toLowerCase(), TARGET_DATABASE.toUpperCase()]) {
      test = fixture({ selectedDatabase, lowerCaseTableNames });
      assert.deepEqual(await test.migrate(), { status: 'updated', backupPath: test.backupPath });
      assert.equal(ddl(test).length, 2);
      assert.deepEqual(await test.migrate(), { status: 'unchanged' });
      assert.equal(ddl(test).length, 2, 'Case-aware retries remain a no-op after installation.');
    }
    test = fixture({ selectedDatabase: TARGET_DATABASE.toLowerCase(), lowerCaseTableNames,
      grants: [{ Db: TARGET_DATABASE.toLowerCase(), User: 'app', Host: 'localhost', Proc_priv: 'Execute' }] });
    await assert.rejects(test.migrate(), /Routine-specific grants/);
    assert.equal(ddl(test).length, 0, 'Lowercase grant rows must still block replacement.');
    assert.ok(!test.events.some(event => event.backup), 'Refuse existing grants before backup or replacement.');
  }
  for (const selectedDatabase of [TARGET_DATABASE.toLowerCase(), TARGET_DATABASE.toUpperCase()]) {
    test = fixture({ selectedDatabase, lowerCaseTableNames: 0 });
    await assert.rejects(test.migrate(), /selected database/);
    assert.equal(test.events.length, 1, 'Case-sensitive mismatches stop before locking, backup or DDL.');
  }
  for (const lowerCaseTableNames of [0, 1, 2]) {
    for (const selectedDatabase of [null, '', 'SkyNest_Hotels', 'SkyNest_Integration_20261003',
      `${TARGET_DATABASE} `, `${TARGET_DATABASE}_copy`, TARGET_DATABASE.replace('k', '\u212a')]) {
      test = fixture({ selectedDatabase, lowerCaseTableNames });
      await assert.rejects(test.migrate(), /selected database/);
      assert.equal(test.events.length, 1, 'Only the exact target under the server case rules is permitted.');
    }
  }
  for (const lowerCaseTableNames of [undefined, null, false, true, -1, 3, '1', '', NaN, {}, []]) {
    test = fixture({ lowerCaseTableNames });
    await assert.rejects(test.migrate(), /comparison setting/);
    assert.equal(test.events.length, 1, 'Unknown settings must fail before any migration operations.');
  }
  test = fixture({ lowerCaseTableNames: 0,
    grants: [{ Db: TARGET_DATABASE.toLowerCase(), User: 'app', Host: 'localhost', Proc_priv: 'Execute' }] });
  assert.equal((await test.migrate()).status, 'updated', 'Mode 0 does not confuse grants on a different case-sensitive database.');

  for (const lock of [0, null]) {
    test = fixture({ lock });
    await assert.rejects(test.migrate(), /migration lock/);
    assert.equal(ddl(test).length, 0);
  }
  for (const initial of [null, { ...row(), 'Create Procedure': null },
    row(OLD_ROUTINE.replace("'Paid'", "'Unexpected'"))]) {
    test = fixture({ initial });
    await assert.rejects(test.migrate(), /missing|visible|differs/);
    assert.equal(ddl(test).length, 0);
    assert.ok(released(test));
  }
  test = fixture({ initial: row(NEW_ROUTINE) });
  assert.deepEqual(await test.migrate(), { status: 'unchanged' });
  assert.equal(ddl(test).length, 0);
  assert.equal(test.events.filter(event => event.backup).length, 0);

  for (const [options, message] of [
    [{ currentUser: 'other@localhost' }, /existing routine definer/],
    [{ databaseCollation: 'utf8mb4_0900_ai_ci' }, /database collation/],
    [{ grants: [{ User: 'app', Host: 'localhost', Proc_priv: 'Execute' }] }, /Routine-specific grants/],
    [{ grantsError: true }, /private driver/],
    [{ backupError: true }, /Backup failed/],
    [{ contextError: true }, /private driver/],
    [{ initial: { ...row(), sql_mode: null } }, /creation context/],
  ]) {
    test = fixture(options);
    await assert.rejects(test.migrate(), message);
    assert.equal(ddl(test).length, 0);
    assert.ok(released(test));
  }

  test = fixture();
  assert.deepEqual(await test.migrate(), { status: 'updated', backupPath: test.backupPath });
  assert.equal(ddl(test).length, 2);
  assert.ok(test.events.findIndex(event => event.backup) < test.events.findIndex(event => event.sql?.startsWith('DROP')));
  assert.ok(test.events.findIndex(event => event.sql?.startsWith('SET SESSION')) < test.events.findIndex(event => event.sql?.startsWith('DROP')));
  assert.ok(test.installed()['Create Procedure'].startsWith('CREATE DEFINER=`root`@`localhost` PROCEDURE'));
  assert.ok(released(test));
  assert.deepEqual(await test.migrate(), { status: 'unchanged' }, 'A repeated migration must be a no-op.');

  test = fixture({ createError: true });
  await assert.rejects(test.migrate(), error => /original routine was restored and verified/.test(error.message)
    && error.message.includes(test.backupPath) && !/private driver/.test(error.message));
  assert.equal(test.installed()['Create Procedure'], row()['Create Procedure']);
  assert.equal(ddl(test).length, 3);
  assert.ok(released(test));

  test = fixture({ createError: true, restoreError: true });
  await assert.rejects(test.migrate(), error => /restoration could not be confirmed/.test(error.message) && error.message.includes(test.backupPath));
  assert.equal(test.installed(), null);
  assert.equal(ddl(test).length, 3);

  test = fixture({ createAppliedButFailed: true });
  assert.deepEqual(await test.migrate(), { status: 'updated', backupPath: test.backupPath, reconciled: true });
  assert.equal(ddl(test).length, 2, 'An acknowledged read of the new routine must not trigger restoration.');

  test = fixture({ unreadableAfterCreate: true });
  await assert.rejects(test.migrate(), /outcome could not be inspected/);
  assert.equal(ddl(test).length, 2, 'An unknown CREATE outcome must not trigger blind DROP/CREATE recovery.');

  test = fixture({ dropError: true });
  await assert.rejects(test.migrate(), /original routine remains installed/);
  assert.equal(ddl(test).length, 1);

  // Verify the real backup helper saves the exact SHOW CREATE/context outside
  // the project; remove this test-only file after reading it.
  const backup = backupRoutine(row());
  try {
    const saved = JSON.parse(fs.readFileSync(backup, 'utf8'));
    assert.equal(saved.database, TARGET_DATABASE);
    assert.deepEqual(saved.showCreate, row());
    assert.ok(path.relative(path.resolve(__dirname, '..'), backup).startsWith('..'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  } finally {
    fs.unlinkSync(backup);
    fs.rmdirSync(path.dirname(backup));
  }
  console.log('PASS: Windows/server-aware database-name matching; strict configured target and case-sensitive host checks; folded grant protection; preserved room charges; stopped-backend/definer gates; backup, idempotence, replacement and recovery (mocked, no live MySQL).');
})().catch(error => { console.error(error); process.exitCode = 1; });
