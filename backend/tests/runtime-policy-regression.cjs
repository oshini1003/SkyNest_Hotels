const assert = require('node:assert/strict');
const { TARGET_DATABASE, APP_USER, APP_HOST, grantStatements, verifyGrants } = require('../Database/runtimeUserPolicy');

const database = 'skynest_integration_20261002';
const account = "'skynest_app'@'localhost'";
// Independent SHOW GRANTS fixtures: select and column permissions can be
// returned separately, with a different ordering than the provisioning SQL.
const selects = [
  'audit_log', 'refresh_token', 'payment', 'bill', 'service_usage',
  'booked_rooms', 'booking', 'service_catalogue', 'staff_account', 'staff',
  'guest_account', 'guest', 'room', 'room_type_amenity', 'amenity', 'room_type', 'branch',
];
const writes = [
  ['branch', 'INSERT (`ContactNumber`, `Location`, `Name`)'],
  ['room_type', 'INSERT (`DailyRate`, `Capacity`, `Name`)'],
  ['amenity', 'INSERT (`AmenityName`)'],
  ['room_type_amenity', 'INSERT (`AmenityID`, `RoomTypeID`)'],
  ['room', 'UPDATE (`RoomStatus`), INSERT (`RoomNumber`, `RoomTypeID`, `BranchID`)'],
  ['guest', 'UPDATE (`Address`, `Email`, `ContactNumber`, `Name`), INSERT (`Address`, `IDNumber`, `Email`, `ContactNumber`, `Name`)'],
  ['guest_account', 'UPDATE (`PasswordHash`), INSERT (`PasswordHash`, `Username`, `GuestID`)'],
  ['staff', 'INSERT (`Email`, `Role`, `Name`, `BranchID`)'],
  ['staff_account', 'UPDATE (`PasswordHash`), INSERT (`PasswordHash`, `Username`, `StaffID`)'],
  ['service_catalogue', 'UPDATE (`IsActive`, `UnitPrice`, `Description`, `ServiceName`), INSERT (`UnitPrice`, `Description`, `ServiceName`)'],
  ['booking', 'UPDATE (`BookingStatus`), INSERT (`PreferredPaymentMethod`, `StaffID`, `GuestID`)'],
  ['booked_rooms', 'INSERT (`GuestCount`, `CheckOutDateTime`, `CheckInDateTime`, `RoomID`, `BookingID`)'],
  ['refresh_token', 'UPDATE (`RevokedAt`), INSERT (`ExpiresAt`, `Token`, `UserID`, `UserType`)'],
];
const procedures = ['sp_update_booked_room', 'sp_process_payment', 'sp_log_service_usage', 'sp_check_out', 'sp_check_in', 'sp_make_booking'];
const functions = ['fn_calculate_outstanding_balance', 'fn_calculate_service_charges', 'fn_calculate_room_charges'];
const tableGrant = (table, rights) => `GRANT ${rights} ON \`${database}\`.\`${table}\` TO ${account}`;
const good = [
  `GRANT USAGE ON *.* TO ${account}`,
  ...selects.map(table => tableGrant(table, 'SELECT')),
  ...writes.map(([table, rights]) => tableGrant(table, rights)),
  ...procedures.map(name => `GRANT EXECUTE ON PROCEDURE \`${database}\`.\`${name}\` TO ${account}`),
  ...functions.map(name => `GRANT EXECUTE ON FUNCTION \`${database}\`.\`${name}\` TO ${account}`),
];

assert.equal(TARGET_DATABASE, 'SkyNest_Integration_20261002');
assert.equal(APP_USER, 'skynest_app');
assert.equal(APP_HOST, 'localhost');
assert.equal(verifyGrants(good, database), true);
assert.equal(verifyGrants(good.slice(1), database), true); // USAGE is implicit.
assert.equal(verifyGrants(good.map(sql => ({ 'Grants for skynest_app@localhost': sql })), database), true);
assert.equal(verifyGrants([...good].reverse().map(sql => sql.replace(/`([^`]+)`/g, (token, name) => name === database ? token : '`' + name.toUpperCase() + '`').replaceAll(account, '`skynest_app`@`localhost`') + ';'), database), true);
assert.equal(verifyGrants(good.map(sql => sql.replaceAll('GRANT ', 'grant\n').replaceAll(' ON ', ' on\t').replaceAll(' TO ', ' to ')), database), true);
assert.equal(verifyGrants(good.map(sql => sql.replaceAll('`', '')), database), true);

const generated = grantStatements(database);
assert.equal(generated.length, 26);
assert.equal(verifyGrants(generated, database), true);
assert.equal(verifyGrants(grantStatements(TARGET_DATABASE), TARGET_DATABASE), true);
assert.ok(generated.every(sql => !/\b(ALL|DELETE|CREATE|DROP|ALTER|TRIGGER|LOCK|GRANT OPTION)\b/.test(sql.slice(6))));
assert.equal(generated.filter(sql => / ON PROCEDURE /.test(sql)).length, 6);
assert.equal(generated.filter(sql => / ON FUNCTION /.test(sql)).length, 3);
assert.equal(generated.find(sql => sql.includes('.`AUDIT_LOG`')), `GRANT SELECT ON \`${database}\`.\`AUDIT_LOG\` TO \`skynest_app\`@\`localhost\``);

const rejectExtra = sql => assert.throws(() => verifyGrants([...good, sql], database), /unexpected|unsupported|missing/);
for (const rights of ['ALL PRIVILEGES', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'INDEX', 'TRIGGER', 'REFERENCES', 'LOCK TABLES', 'CREATE TEMPORARY TABLES']) {
  rejectExtra(tableGrant('audit_log', rights));
}
rejectExtra(tableGrant('guest', 'UPDATE (`IDNumber`)'));
rejectExtra(tableGrant('staff', 'UPDATE (`Role`)'));
rejectExtra(tableGrant('booking', 'INSERT (`BookingStatus`)'));
rejectExtra(tableGrant('booked_rooms', 'UPDATE (`CheckOutDateTime`)'));
rejectExtra(tableGrant('guest_account', 'UPDATE (`Username`)'));
rejectExtra(tableGrant('payment', 'INSERT (`Amount`)'));
rejectExtra(tableGrant('new_table', 'SELECT'));
rejectExtra(`GRANT SELECT ON \`${database}\`.* TO ${account}`);
rejectExtra(`GRANT EXECUTE ON \`${database}\`.* TO ${account}`);
rejectExtra(`GRANT SELECT ON *.* TO ${account}`);
rejectExtra(`GRANT PROXY ON 'root'@'localhost' TO ${account}`);
rejectExtra(`GRANT 'extra_role'@'localhost' TO ${account}`);
rejectExtra(`GRANT EXECUTE ON PROCEDURE \`${database}\`.sp_recalculate_bill TO ${account}`);
rejectExtra(`GRANT EXECUTE ON FUNCTION \`${database}\`.fn_calculate_bill_total TO ${account}`);
rejectExtra(`GRANT EXECUTE ON FUNCTION \`${database}\`.sp_check_in TO ${account}`);
rejectExtra(tableGrant('branch', 'SELECT') + ' WITH GRANT OPTION');
rejectExtra(tableGrant('branch', 'SELECT') + ' WITH MAX_QUERIES_PER_HOUR 1');
rejectExtra(tableGrant('branch', 'SELECT').replace(database, 'another_database'));
rejectExtra(tableGrant('branch', 'SELECT').replace(database, 'SkyNest_Integration_20261002'));
rejectExtra(tableGrant('branch', 'SELECT').replace(account, "'skynest_app'@'%'"));
rejectExtra(tableGrant('branch', 'SELECT').replace(account, "'SkyNest_app'@'localhost'"));
rejectExtra(tableGrant('branch', 'SELECT').replace(account, "'skynest_app'@'LOCALHOST'"));
rejectExtra(tableGrant('branch', 'SELECT').replace(account, "'skynest_app'@'localhost', 'root'@'localhost'"));
rejectExtra(tableGrant('branch', 'SELECT') + '; GRANT ALL ON *.* TO ' + account);
rejectExtra(tableGrant('branch', 'SELECT') + ' /* ignored? */');
rejectExtra(tableGrant('branch', 'SELECT') + ' -- ignored?');
rejectExtra(tableGrant('branch', 'SELECT (Name)'));
rejectExtra(tableGrant('branch', 'INSERT ()'));
rejectExtra(tableGrant('branch', 'INSERT (Name, Name)'));
rejectExtra(`GRANT USAGE ON \`${database}\`.branch TO ${account}`);
rejectExtra(`GRANT USAGE, SELECT ON *.* TO ${account}`);
rejectExtra(`GRANT USAGE ON FUNCTION *.* TO ${account}`);
rejectExtra(`GRANT SELECT ON '${database}'.branch TO ${account}`);
rejectExtra(tableGrant('branch', 'SELECT').slice(0, -1));

for (const rows of [[], null, {}, [null], [123], [{ one: good[0], two: good[1] }], [['GRANT USAGE ON *.*']]]) {
  assert.throws(() => verifyGrants(rows, database));
}
assert.throws(() => verifyGrants(good.filter(sql => !sql.includes('fn_calculate_service_charges')), database), /missing/);
assert.throws(() => verifyGrants(good.filter(sql => sql !== tableGrant('audit_log', 'SELECT')), database), /missing/);
assert.throws(() => verifyGrants(good.map(sql => sql.replace('UPDATE (`RevokedAt`), ', '')), database), /missing/);
for (const name of ['SkyNest_Hotels', 'mysql', 'skynest_integration_20261002`.*', '', null]) {
  assert.throws(() => grantStatements(name));
  assert.throws(() => verifyGrants(good, name));
}

console.log('PASS: exact runtime table/column/routine inventory; independent SHOW GRANTS formats and ordering; missing privileges and unexpected global/schema/role/proxy/object/column/account/grant-option rejection (no live MySQL).');
