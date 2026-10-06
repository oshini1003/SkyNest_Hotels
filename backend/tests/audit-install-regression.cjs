const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TARGET_DATABASE, canonicalSql, definitions, verifyTable, checkTree,
  backupObjects, installAuditLog } = require('../Database/addAuditLog');
const { projectStatements } = require('../Database/setupIntegrationDb');

// Mocked DDL/recovery and SQL-contract checks; no live MySQL or hotel rows.
const context = { sql_mode: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION',
  character_set_client: 'utf8mb4', collation_connection: 'utf8mb4_unicode_ci',
  'Database Collation': 'utf8mb4_unicode_ci' };
const reviewed = definitions();
const objects = [...reviewed.triggers, ...reviewed.procedures];
const expectedCheck = "((`ActorType` = _utf8mb4'staff') AND (`StaffID` IS NOT NULL) AND (`GuestID` IS NULL)) OR ((`ActorType` = _utf8mb4'guest') AND (`GuestID` IS NOT NULL) AND (`StaffID` IS NULL))";
// Actual INFORMATION_SCHEMA output supplied from Windows MySQL 9.7.1.
// Contains schema metadata only; no credentials, actor identities or hotel rows.
const windows97Table = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/audit-table-mysql97-windows.json'), 'utf8'));
windows97Table.showCreate = { Table: 'audit_log', 'Create Table': reviewed.table };
function tableFixture(fold = false) {
  const columns = [
    ['AuditID', 'bigint unsigned', 'NO', null, 'auto_increment'],
    ['OperationID', 'char(36)', 'NO', null, ''], ['ActorType', "enum('staff','guest')", 'NO', null, ''],
    ['StaffID', 'int', 'YES', null, ''], ['GuestID', 'int', 'YES', null, ''],
    ['BookingID', 'int', 'NO', null, ''], ['Action', 'varchar(64)', 'NO', null, ''],
    ['TableAffected', 'varchar(32)', 'NO', null, ''], ['RecordID', 'int', 'NO', null, ''],
    ['OldValues', 'json', 'YES', null, ''], ['NewValues', 'json', 'NO', null, ''],
    ['Details', 'varchar(255)', 'NO', null, ''], ['CreatedAt', 'datetime(6)', 'NO', 'CURRENT_TIMESTAMP(6)', 'DEFAULT_GENERATED'],
  ].map(([COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA]) => ({
    COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, GENERATION_EXPRESSION: '',
    COLLATION_NAME: /^(char|varchar|enum)/.test(COLUMN_TYPE) ? 'utf8mb4_unicode_ci' : null,
  }));
  const indexes = Object.entries({ PRIMARY: ['AuditID'], idx_audit_booking_created: ['BookingID', 'CreatedAt', 'AuditID'],
    idx_audit_staff_created: ['StaffID', 'CreatedAt'], idx_audit_operation: ['OperationID'], GuestID: ['GuestID'],
  }).flatMap(([INDEX_NAME, fields]) => fields.map((COLUMN_NAME, i) => ({ INDEX_NAME, COLUMN_NAME,
    NON_UNIQUE: INDEX_NAME === 'PRIMARY' ? 0 : 1, SEQ_IN_INDEX: i + 1, SUB_PART: null,
    COLLATION: 'A', INDEX_TYPE: 'BTREE', IS_VISIBLE: 'YES', EXPRESSION: null,
  })));
  const table = { TABLE_NAME: fold ? 'audit_log' : 'AUDIT_LOG', TABLE_TYPE: 'BASE TABLE', ENGINE: 'InnoDB',
    TABLE_COLLATION: 'utf8mb4_unicode_ci', columns, indexes,
    foreignKeys: [['BookingID', 'BOOKING'], ['GuestID', 'GUEST'], ['StaffID', 'STAFF']].map(([COLUMN_NAME, target]) => ({
      COLUMN_NAME, REFERENCED_TABLE_SCHEMA: fold ? TARGET_DATABASE.toLowerCase() : TARGET_DATABASE,
      REFERENCED_TABLE_NAME: fold ? target.toLowerCase() : target, REFERENCED_COLUMN_NAME: COLUMN_NAME,
      UPDATE_RULE: 'NO ACTION', DELETE_RULE: 'NO ACTION',
    })), checks: [{ CONSTRAINT_NAME: 'chk_audit_actor', ENFORCED: 'YES', CHECK_CLAUSE: expectedCheck }], triggers: [],
    showCreate: { Table: 'AUDIT_LOG', 'Create Table': reviewed.table },
  };
  return table;
}
function objectRow(object, current = false) {
  const sql = (current ? object.sql : object.before || object.sql).replace(/^CREATE /, 'CREATE DEFINER=`root`@`localhost` ');
  return { [object.type === 'PROCEDURE' ? 'Create Procedure' : 'SQL Original Statement']: sql, ...context };
}
const dbError = code => Object.assign(new Error('private driver text must not leak'), { code });
function fixture(options = {}) {
  const events = [];
  const state = new Map(reviewed.procedures.map(object => [object.name, objectRow(object)]));
  let table = options.table ? structuredClone(options.table) : null;
  let identity = { databaseName: TARGET_DATABASE, currentUser: 'root@localhost',
    databaseCollation: 'utf8mb4_unicode_ci', lowerCaseTableNames: 0, ...context, ...options.identity };
  if (options.current || options.mixed) {
    table = tableFixture(identity.lowerCaseTableNames !== 0);
    for (const object of reviewed.triggers) state.set(object.name, objectRow(object, true));
    for (const [index, object] of reviewed.procedures.entries()) {
      if (options.current || index < 2) state.set(object.name, objectRow(object, true));
    }
  }
  if (options.editState) options.editState(state);
  let failureTriggered = false;
  const target = options.failureTarget || 'sp_process_payment';
  const connection = { query: run, execute: run };
  async function run(sql, values) {
    events.push({ sql, values });
    assert.doesNotMatch(sql, /^(INSERT|UPDATE|DELETE|TRUNCATE|CALL|START TRANSACTION|COMMIT|ROLLBACK|ALTER)\b/i, 'Installer must not write or backfill business data.');
    assert.doesNotMatch(sql, /^DROP\s+(TABLE|DATABASE|SCHEMA|TRIGGER)\b/i, 'Never delete audit history or an existing trigger.');
    if (sql.startsWith('SELECT DATABASE()')) return [[identity]];
    if (sql.startsWith('SELECT GET_LOCK')) return [[{ acquired: options.lock ?? 1 }]];
    if (sql.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }]];
    if (sql.startsWith('SELECT TABLE_NAME')) return [table ? [table] : []];
    if (sql.startsWith('SELECT COLUMN_NAME')) return [table.columns];
    if (sql.startsWith('SELECT INDEX_NAME')) return [table.indexes];
    if (sql.startsWith('SELECT k.COLUMN_NAME')) return [table.foreignKeys];
    if (sql.startsWith('SELECT t.CONSTRAINT_NAME')) return [table.checks];
    if (sql.startsWith('SELECT TRIGGER_NAME')) return [[...state.keys()].filter(name => name.startsWith('trg_')).map(TRIGGER_NAME => ({ TRIGGER_NAME }))];
    if (sql.startsWith('SHOW CREATE TABLE')) return [[table.showCreate]];
    if (sql.startsWith('SHOW CREATE')) {
      const name = sql.match(/`([^`]+)`$/)[1];
      if (options.unreadable && failureTriggered && name === target) throw dbError('PROTOCOL_CONNECTION_LOST');
      if (!state.has(name)) throw dbError(sql.includes('PROCEDURE') ? 'ER_SP_DOES_NOT_EXIST' : 'ER_TRG_DOES_NOT_EXIST');
      return [[structuredClone(state.get(name))]];
    }
    if (sql.includes('FROM mysql.procs_priv')) {
      assert.ok(sql.includes(identity.lowerCaseTableNames ? 'WHERE LOWER(Db)' : 'WHERE Db'));
      assert.equal(values[0], identity.lowerCaseTableNames ? TARGET_DATABASE.toLowerCase() : TARGET_DATABASE);
      assert.equal(values[2], 'PROCEDURE');
      if (options.grantsError) throw dbError('ER_TABLEACCESS_DENIED_ERROR');
      return [values[1] === (options.grantTarget || 'sp_log_service_usage') && options.grants ? [{ User: 'app', Host: 'localhost', Proc_priv: 'Execute' }] : []];
    }
    if (sql.startsWith('SET SESSION')) {
      assert.deepEqual(values, [context.sql_mode, context.character_set_client, context.collation_connection]);
      if (options.contextError) throw dbError('ER_WRONG_VALUE_FOR_VAR');
      return [[]];
    }
    if (sql.startsWith('CREATE TABLE')) {
      assert.equal(sql, reviewed.table);
      assert.equal(table, null);
      if (!options.tableCreateError || options.tableAppliedButFailed) table = options.createdTable
        ? structuredClone(options.createdTable) : tableFixture(identity.lowerCaseTableNames !== 0);
      if (options.tableCreateError || options.tableAppliedButFailed) throw dbError('ER_PARSE_ERROR');
      return [[]];
    }
    if (sql.startsWith('CREATE TRIGGER')) {
      const object = reviewed.triggers.find(o => sql === o.sql);
      assert.ok(object);
      assert.equal(state.has(object.name), false);
      if (options.triggerError && object.name === 'trg_audit_log_no_delete') throw dbError('ER_TRG_ALREADY_EXISTS');
      state.set(object.name, objectRow(object, true));
      return [[]];
    }
    if (sql.startsWith('DROP PROCEDURE')) {
      const name = sql.match(/`([^`]+)`$/)[1];
      assert.ok(state.has(name));
      if (options.dropError && name === target) throw dbError('ER_PROCACCESS_DENIED_ERROR');
      state.delete(name);
      return [[]];
    }
    if (sql.startsWith('CREATE DEFINER')) {
      const name = sql.match(/PROCEDURE\s+`?([a-z_]+)`?/)[1];
      const object = reviewed.procedures.find(o => o.name === name);
      assert.ok(object);
      const current = canonicalSql(sql.replace(/^CREATE DEFINER=`root`@`localhost` /, 'CREATE ')) === canonicalSql(object.sql);
      assert.equal(state.has(name), false, 'Recovery must not overwrite any observed routine.');
      if (current && name === target && !failureTriggered && (options.createError || options.appliedButFailed || options.unreadable)) {
        failureTriggered = true;
        if (options.appliedButFailed) state.set(name, objectRow(object, true));
        throw dbError('ER_PARSE_ERROR');
      }
      if (!current && options.restoreError) throw dbError('ER_PROCACCESS_DENIED_ERROR');
      state.set(name, objectRow(object, current));
      return [[]];
    }
    throw new Error('Unexpected SQL: ' + sql);
  }
  const backupPath = path.join(os.tmpdir(), 'mock-audit-backup', 'original-objects.json');
  const writeBackup = snapshot => { events.push({ backup: structuredClone(snapshot) }); if (options.backupError) throw new Error('Backup failed.'); return backupPath; };
  return { events, connection, state, table: () => table, backupPath,
    migrate: overrides => installAuditLog({ connection, database: TARGET_DATABASE, backendStopped: true, writeBackup, log: () => {}, ...overrides }) };
}
const ddl = fixture => fixture.events.filter(event => /^(CREATE|DROP)/.test(event.sql || ''));
const release = fixture => fixture.events.at(-1)?.sql?.startsWith('SELECT RELEASE_LOCK');

(async () => {
  // Independent expected signatures and fresh-schema/migration equivalence.
  const signatures = ['sp_check_in(IN p_booking_id INT, IN p_staff_id INT)', 'sp_check_out(IN p_booking_id INT, IN p_staff_id INT)',
    'sp_process_payment(IN p_booking_id INT, IN p_amount DECIMAL(10,2), IN p_method VARCHAR(20), IN p_staff_id INT)',
    'sp_log_service_usage(IN p_booking_id INT, IN p_service_id INT, IN p_quantity INT, IN p_staff_id INT, IN p_guest_id INT)'];
  for (const [index, object] of reviewed.procedures.entries()) {
    assert.ok(canonicalSql(object.sql).startsWith(canonicalSql('CREATE PROCEDURE ' + signatures[index])));
    assert.match(object.sql, /INSERT INTO AUDIT_LOG/);
    assert.notEqual(canonicalSql(object.before), canonicalSql(object.sql));
  }
  const migration = projectStatements(fs.readFileSync(path.join(__dirname, '../Database/migrations/002_add_audit_log.sql'), 'utf8'));
  assert.deepEqual(migration.map(sql => canonicalSql(sql)), [reviewed.table, ...objects.map(object => object.sql)].map(sql => canonicalSql(sql)));
  assert.equal(migration.length, 7);
  assert.doesNotMatch(migration.join('\n'), /^DROP|^UPDATE|^DELETE|^INSERT/m);
  assert.notEqual(canonicalSql("SELECT 'A  B'"), canonicalSql("SELECT 'A B'"));
  assert.notEqual(canonicalSql('UPDATE BILL'), canonicalSql('UPDATE bill'));
  assert.equal(canonicalSql('UPDATE BILL', true), canonicalSql('UPDATE bill', true));
  assert.notEqual(canonicalSql('SELECT /* hidden */ 1'), canonicalSql('SELECT 1'));
  assert.throws(() => canonicalSql('SELECT @actor'), /Unrecognized/);
  assert.notEqual(checkTree("ActorType = 'staff' AND StaffID IS NOT NULL OR GuestID IS NULL"), checkTree("ActorType = 'staff' AND (StaffID IS NOT NULL OR GuestID IS NULL)"));

  verifyTable(tableFixture(), false);
  verifyTable(tableFixture(true), true);
  verifyTable(windows97Table, true);
  const escapedCheck = windows97Table.checks[0].CHECK_CLAUSE;
  assert.equal(checkTree(escapedCheck), checkTree(expectedCheck));
  for (const invalid of [
    escapedCheck.replace("staff", "admin"),
    escapedCheck.replace("staff", "STAFF"),
    escapedCheck.replace(/_utf8mb4/g, '_latin1'),
    escapedCheck.replace(/_utf8mb4/g, ''),
    escapedCheck.replace(/\\'/g, "\\\\'"),
    escapedCheck.replace("staff\\'", "staff'"),
    escapedCheck.replace("staff\\'", "staff\\\\'"),
    escapedCheck.replace('`StaffID` is not null', '`StaffID` is null'),
    escapedCheck.replace(' and ', ' or '),
    escapedCheck + ' OR 1 = 1',
    escapedCheck + '; SELECT 1',
  ]) {
    const table = structuredClone(windows97Table);
    table.checks[0].CHECK_CLAUSE = invalid;
    assert.throws(() => verifyTable(table, true), /actor CHECK expression/);
  }
  for (const mutate of [
    t => { t.ENGINE = 'MyISAM'; }, t => { t.columns[4].IS_NULLABLE = 'NO'; },
    t => { t.columns[12].COLUMN_DEFAULT = null; }, t => { t.columns[0].EXTRA = ''; },
    t => { t.foreignKeys[0].DELETE_RULE = 'CASCADE'; }, t => { t.foreignKeys[1].REFERENCED_TABLE_NAME = 'STAFF'; },
    t => { t.foreignKeys[0].REFERENCED_TABLE_SCHEMA = 'SkyNest_Hotels'; },
    t => { t.checks[0].ENFORCED = 'NO'; }, t => { t.checks[0].CHECK_CLAUSE = "ActorType = 'staff'"; },
    t => { t.triggers.push({ TRIGGER_NAME: 'foreign_trigger' }); }, t => { t.indexes[0].NON_UNIQUE = 1; },
    t => { t.indexes.pop(); }, t => { t.indexes[1].SUB_PART = 4; },
  ]) { const table = tableFixture(); mutate(table); assert.throws(() => verifyTable(table, false), /structure differs/); }

  for (const database of [undefined, '', 'SkyNest_Hotels', TARGET_DATABASE.toLowerCase(), TARGET_DATABASE + ' ']) {
    const test = fixture(); await assert.rejects(test.migrate({ database }), /exactly/); assert.equal(test.events.length, 0);
  }
  let test = fixture(); await assert.rejects(test.migrate({ backendStopped: false }), /Stop the backend/); assert.equal(test.events.length, 0);
  for (const identity of [{ databaseName: 'SkyNest_Hotels' }, { databaseName: TARGET_DATABASE.toLowerCase() },
    { lowerCaseTableNames: '1' }, { databaseCollation: 'utf8mb4_0900_ai_ci' }, { currentUser: null }]) {
    test = fixture({ identity }); await assert.rejects(test.migrate()); assert.equal(ddl(test).length, 0);
  }
  for (const lowerCaseTableNames of [1, 2]) {
    test = fixture({ identity: { databaseName: TARGET_DATABASE.toLowerCase(), lowerCaseTableNames } });
    assert.equal((await test.migrate()).status, 'updated');
    assert.equal((await test.migrate()).status, 'unchanged');
  }
  test = fixture({ identity: { databaseName: TARGET_DATABASE.toLowerCase(), lowerCaseTableNames: 1 },
    editState: state => {
      for (const row of state.values()) row['Create Procedure'] = row['Create Procedure'].replace(
        /\b(FROM|UPDATE|INTO|JOIN|ON)\s+(BOOKING|BOOKED_ROOMS|ROOM|ROOM_TYPE|BILL|PAYMENT|SERVICE_CATALOGUE|SERVICE_USAGE|STAFF|GUEST)\b/g,
        (_, keyword, table) => `${keyword} \`${table.toLowerCase()}\``);
    } });
  assert.equal((await test.migrate()).status, 'updated', 'Windows procedure bodies can fold and quote every referenced table.');
  test = fixture({ identity: { databaseName: TARGET_DATABASE.toLowerCase(), lowerCaseTableNames: 1 }, grants: true });
  await assert.rejects(test.migrate(), /Routine-specific grants/); assert.equal(ddl(test).length, 0);
  test = fixture({ lock: 0 }); await assert.rejects(test.migrate(), /migration lock/); assert.equal(ddl(test).length, 0);
  for (const [options, message] of [
    [{ grants: true }, /Routine-specific grants/], [{ grantsError: true }, /private driver/],
    [{ backupError: true }, /Backup failed/], [{ contextError: true }, /installation stopped/],
    [{ editState: s => s.delete('sp_log_service_usage') }, /missing/],
    [{ editState: s => { s.get('sp_log_service_usage')['Create Procedure'] += ' invalid'; } }, /differs/],
    [{ editState: s => { s.get('sp_check_in').sql_mode = null; } }, /creation context/],
    [{ identity: { currentUser: 'app@localhost' } }, /existing.*definer/],
    [{ editState: s => { s.get('sp_check_out')['Database Collation'] = 'utf8mb4_0900_ai_ci'; } }, /collation/],
    [{ table: { ...tableFixture(), ENGINE: 'MyISAM' } }, /structure differs/],
  ]) {
    test = fixture(options); await assert.rejects(test.migrate(), message); assert.equal(ddl(test).length, 0); assert.ok(release(test));
  }
  test = fixture();
  const result = await test.migrate();
  assert.equal(result.status, 'updated'); assert.equal(ddl(test).length, 11);
  const firstDdl = test.events.findIndex(event => /^(CREATE|DROP)/.test(event.sql || ''));
  assert.ok(test.events.findIndex(event => event.backup) < firstDdl);
  assert.ok(test.events.findIndex(event => event.sql?.includes('SHOW CREATE PROCEDURE') && event.sql.includes('sp_log_service_usage')) < firstDdl);
  assert.ok(test.events.findIndex(event => event.sql?.startsWith('CREATE TRIGGER trg_audit_log_no_delete')) < test.events.findIndex(event => event.sql?.startsWith('DROP PROCEDURE')));
  assert.equal(test.events.find(event => event.backup).backup.objects.sp_process_payment['Create Procedure'], objectRow(reviewed.procedures[2])['Create Procedure']);
  assert.equal((await test.migrate()).status, 'unchanged'); assert.equal(ddl(test).length, 11); assert.ok(release(test));
  test = fixture({ current: true }); assert.equal((await test.migrate()).status, 'unchanged'); assert.equal(ddl(test).length, 0); assert.ok(!test.events.some(e => e.backup));
  test = fixture({ mixed: true }); assert.equal((await test.migrate()).status, 'updated'); assert.equal(ddl(test).length, 4);
  test = fixture({ table: tableFixture() }); assert.equal((await test.migrate()).status, 'updated'); assert.equal(ddl(test).length, 10);

  // Resume the exact reported partial installation: table exists, no guards,
  // and all four procedures still have their previous definitions.
  const windowsIdentity = { databaseName: TARGET_DATABASE.toLowerCase(), lowerCaseTableNames: 1 };
  test = fixture({ table: windows97Table, identity: windowsIdentity });
  assert.equal((await test.migrate()).status, 'updated');
  assert.equal(ddl(test).length, 10);
  assert.ok(!ddl(test).some(event => event.sql.startsWith('CREATE TABLE')));
  const resumedDdlCount = ddl(test).length;
  assert.equal((await test.migrate()).status, 'unchanged');
  assert.equal(ddl(test).length, resumedDdlCount);
  test = fixture({ createdTable: windows97Table, identity: windowsIdentity });
  assert.equal((await test.migrate()).status, 'updated');
  assert.equal(ddl(test).length, 11, 'Fresh installation must also verify escaped CHECK metadata.');

  // Preserve a useful, controlled reason after backup/DDL without exposing
  // arbitrary driver messages or unexpected metadata values.
  const invalidCreatedTable = structuredClone(windows97Table);
  invalidCreatedTable.checks[0].CHECK_CLAUSE = 'private unexpected metadata';
  test = fixture({ createdTable: invalidCreatedTable, identity: windowsIdentity });
  await assert.rejects(test.migrate(), error =>
    /actor CHECK expression/.test(error.message) && error.message.includes(test.backupPath) &&
    !error.message.includes('private unexpected metadata'));
  assert.equal(ddl(test).length, 1, 'Stop before installing guards or changing procedures.');

  test = fixture({ createError: true });
  await assert.rejects(test.migrate(), error => /original was restored and verified/.test(error.message) && error.message.includes(test.backupPath) && !error.message.includes('private driver'));
  assert.equal(test.state.get('sp_process_payment')['Create Procedure'], objectRow(reviewed.procedures[2])['Create Procedure']);
  assert.ok(test.table(), 'A partial failure must preserve the audit table.');
  assert.equal((await test.migrate()).status, 'updated', 'Recognized old/current mixed state resumes safely.');
  test = fixture({ createError: true, restoreError: true }); await assert.rejects(test.migrate(), /restoration could not be confirmed/); assert.equal(test.state.has('sp_process_payment'), false);
  test = fixture({ appliedButFailed: true }); assert.equal((await test.migrate()).status, 'updated'); assert.equal(ddl(test).length, 11, 'Acknowledged installed replacement needs no second create.');
  test = fixture({ unreadable: true }); await assert.rejects(test.migrate(), /outcome could not be inspected/); assert.equal(ddl(test).filter(e => e.sql.includes('sp_process_payment')).length, 2);
  test = fixture({ dropError: true }); await assert.rejects(test.migrate(), /original remains installed/); assert.equal(ddl(test).filter(e => e.sql.includes('sp_process_payment')).length, 1);
  test = fixture({ tableCreateError: true }); await assert.rejects(test.migrate(), /table creation could not be confirmed/); assert.equal(ddl(test).length, 1);
  test = fixture({ tableAppliedButFailed: true }); assert.equal((await test.migrate()).status, 'updated'); assert.equal(ddl(test).length, 11);
  test = fixture({ triggerError: true }); await assert.rejects(test.migrate(), /creation could not be confirmed/); assert.equal(ddl(test).length, 3); assert.ok(!ddl(test).some(e => e.sql.startsWith('DROP')));

  const snapshot = { objects: { sp_check_in: objectRow(reviewed.procedures[0]) }, table: null };
  const file = backupObjects(snapshot);
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.database, TARGET_DATABASE); assert.deepEqual(saved.objects, snapshot.objects);
    assert.ok(path.relative(path.resolve(__dirname, '../..'), file).startsWith('..'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally { fs.unlinkSync(file); fs.rmdirSync(path.dirname(file)); }
  console.log('PASS: recorded MySQL 9.7 Windows CHECK metadata; strict actor rules; fresh/resumed installation and idempotence; target/definition/definer/grant gates; backup, controlled diagnostics and uncertain DDL recovery (mocked, no live MySQL).');
})().catch(error => { console.error(error); process.exitCode = 1; });
