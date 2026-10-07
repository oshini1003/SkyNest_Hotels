'use strict';
const { TARGET_DATABASE, APP_USER, APP_HOST, verifyGrants } = require('./runtimeUserPolicy');

function verifyTarget(config, identity) {
  if (config.database !== TARGET_DATABASE || !['localhost', '127.0.0.1', '::1'].includes(config.host)) {
    throw new Error('Use the local SkyNest_Integration_20261002 database only.');
  }
  if (![0, 1, 2].includes(identity.lowerCaseTableNames)) throw new Error('Cannot verify database identifier rules.');
  const expected = identity.lowerCaseTableNames ? TARGET_DATABASE.toLowerCase() : TARGET_DATABASE;
  const selected = identity.lowerCaseTableNames ? identity.databaseName?.toLowerCase() : identity.databaseName;
  if (selected !== expected || !/^[A-Za-z0-9_]+$/.test(identity.databaseName)) throw new Error('Unexpected selected database.');
  if (identity.mandatoryRoles !== '') throw new Error('Mandatory server roles need a separate privilege review.');
  return identity.databaseName;
}

async function identityOf(connection) {
  const [[identity]] = await connection.query(`SELECT DATABASE() AS databaseName, CURRENT_USER() AS currentUser,
    CURRENT_ROLE() AS activeRoles, @@lower_case_table_names AS lowerCaseTableNames,
    @@GLOBAL.mandatory_roles AS mandatoryRoles`);
  return identity;
}

const TABLES = ['BRANCH', 'ROOM_TYPE', 'AMENITY', 'ROOM_TYPE_AMENITY', 'ROOM', 'GUEST', 'GUEST_ACCOUNT',
  'STAFF', 'STAFF_ACCOUNT', 'BOOKING', 'BOOKED_ROOMS', 'SERVICE_CATALOGUE', 'SERVICE_USAGE',
  'BILL', 'PAYMENT', 'REFRESH_TOKEN', 'AUDIT_LOG'];
const ROUTINES = {
  sp_make_booking: 'PROCEDURE', sp_check_in: 'PROCEDURE', sp_check_out: 'PROCEDURE',
  sp_log_service_usage: 'PROCEDURE', sp_process_payment: 'PROCEDURE', sp_update_booked_room: 'PROCEDURE',
  fn_calculate_room_charges: 'FUNCTION', fn_calculate_service_charges: 'FUNCTION',
  fn_calculate_outstanding_balance: 'FUNCTION',
};

async function verifyObjects(connection, database, requiredDefiner) {
  for (const table of TABLES) await connection.query(`SELECT * FROM \`${table}\` LIMIT 0`);
  const [routines] = await connection.execute(`SELECT ROUTINE_NAME, ROUTINE_TYPE, SECURITY_TYPE, DEFINER
    FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ?`, [database]);
  for (const [name, type] of Object.entries(ROUTINES)) {
    const routine = routines.find(row => row.ROUTINE_NAME === name && row.ROUTINE_TYPE === type);
    if (!routine || routine.SECURITY_TYPE !== 'DEFINER' || routine.DEFINER !== requiredDefiner) {
      throw new Error(`Review the existing definer/security of ${name} before changing the runtime account.`);
    }
  }
}

// These checks never CALL a business routine and never issue DDL. Negative DML
// uses constant false predicates, so an unexpectedly broad grant still changes no rows.
async function checkRuntimeAccess(connection, config) {
  const identity = await identityOf(connection);
  const database = verifyTarget(config, identity);
  if (identity.currentUser !== `${APP_USER}@${APP_HOST}` || identity.activeRoles !== 'NONE') {
    throw new Error('Expected skynest_app@localhost without active roles.');
  }
  const [grants] = await connection.query('SHOW GRANTS');
  verifyGrants(grants, database);
  await verifyObjects(connection, database, 'root@localhost');
  await connection.beginTransaction();
  try {
    // Actual lock shapes used by login, refresh and multi-room booking, with no matching rows.
    await connection.query(`SELECT ga.GuestID, ga.Username, ga.PasswordHash, g.Name FROM GUEST_ACCOUNT ga
      JOIN GUEST g ON g.GuestID = ga.GuestID WHERE ga.GuestID = 0 FOR UPDATE OF ga`);
    await connection.query(`SELECT sa.StaffID, sa.Username, sa.PasswordHash, s.Name, s.Role, s.BranchID FROM STAFF_ACCOUNT sa
      JOIN STAFF s ON s.StaffID = sa.StaffID WHERE sa.StaffID = 0 FOR UPDATE OF sa`);
    await connection.query('SELECT TokenID, UserType, UserID FROM REFRESH_TOKEN WHERE TokenID = 0 FOR UPDATE');
    await connection.query(`SELECT r.RoomStatus, rt.Capacity FROM ROOM r JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
      WHERE r.RoomID = 0 FOR UPDATE OF r`);
    await connection.query(`SELECT br.BookedRoomID FROM BOOKED_ROOMS br JOIN BOOKING b ON b.BookingID = br.BookingID
      WHERE br.RoomID = 0 AND b.BookingStatus IN ('Booked','Checked-In') LIMIT 1 FOR SHARE`);
    const denied = [
      'SELECT User FROM mysql.user LIMIT 0',
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
      if (!blocked) throw new Error('A permission-denial check unexpectedly succeeded. Do not activate this account.');
    }
  } finally { await connection.rollback(); }
  return { database, currentUser: identity.currentUser, grants: grants.length };
}
module.exports = { verifyTarget, identityOf, verifyObjects, checkRuntimeAccess, TABLES, ROUTINES };
