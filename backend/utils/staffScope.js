const pool = require('../config/db');

const staffRoles = new Set(['Admin', 'Manager', 'Receptionist', 'ServiceStaff']);
const restrictedRoles = new Set(['Receptionist', 'ServiceStaff']);
const canonicalId = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const forbidden = res => res.status(403).json({ error: 'You do not have permission to perform this action.' });
const expired = res => res.status(401).json({ error: 'Your staff access has changed. Please sign in again.' });

function validScope(req) {
  const scope = req.staffScope;
  return !!scope && req.user?.type === 'staff' && canonicalId(scope.staffId)
    && scope.staffId === req.user.id && staffRoles.has(scope.role) && scope.role === req.user.role
    && (scope.branchId === null || canonicalId(scope.branchId))
    && (!restrictedRoles.has(scope.role) || canonicalId(scope.branchId));
}
function canRead(req) {
  return req.user?.type === 'guest' ? canonicalId(req.user.id) : validScope(req);
}
function canAct(req, roles, guests = false) {
  return req.user?.type === 'guest' ? guests && canonicalId(req.user.id)
    : validScope(req) && roles.includes(req.staffScope.role);
}
function currentStaff(scope) {
  return {
    sql: `EXISTS (SELECT 1 FROM STAFF scope_staff
      JOIN STAFF_ACCOUNT scope_account ON scope_account.StaffID = scope_staff.StaffID
      WHERE scope_staff.StaffID = ? AND scope_staff.Role = ? AND scope_staff.BranchID <=> ?)`,
    params: [scope.staffId, scope.role, scope.branchId],
  };
}
// A booking belongs to a restricted branch only if every booked room does.
// Empty bookings and orphaned room references cannot pass this predicate.
function bookingAccess(req, bookingAlias = 'BOOKING') {
  if (req.user.type === 'guest') return { sql: ` AND ${bookingAlias}.GuestID = ?`, params: [req.user.id] };
  if (!validScope(req)) throw new Error('Resolved staff scope is required.');
  const current = currentStaff(req.staffScope);
  let sql = ` AND ${current.sql}`;
  const params = [...current.params];
  if (restrictedRoles.has(req.staffScope.role)) {
    sql += ` AND EXISTS (SELECT 1 FROM BOOKED_ROOMS scope_nonempty WHERE scope_nonempty.BookingID = ${bookingAlias}.BookingID)
      AND NOT EXISTS (SELECT 1 FROM BOOKED_ROOMS scope_br
        LEFT JOIN ROOM scope_room ON scope_room.RoomID = scope_br.RoomID
        WHERE scope_br.BookingID = ${bookingAlias}.BookingID
          AND (scope_room.RoomID IS NULL OR scope_room.BranchID <> ?))`;
    params.push(req.staffScope.branchId);
  }
  return { sql, params };
}
function roomAccess(req, roomAlias = 'r') {
  if (!validScope(req)) throw new Error('Resolved staff scope is required.');
  const current = currentStaff(req.staffScope);
  return { sql: ` AND ${current.sql}${restrictedRoles.has(req.staffScope.role) ? ` AND ${roomAlias}.BranchID = ?` : ''}`,
    params: [...current.params, ...(restrictedRoles.has(req.staffScope.role) ? [req.staffScope.branchId] : [])] };
}
// Guest reads retain ownership predicates. Staff multi-query reads use one
// snapshot so a simultaneous guest room edit cannot expose a different branch.
async function bookingRead(req, callback) {
  if (req.user.type !== 'staff') return callback(pool);
  const connection = await pool.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch (_) { /* Preserve read failure. */ }
    throw error;
  } finally { connection.release(); }
}
function scopeConflict(error, res) {
  if (error.sqlState === '45003') {
    res.status(404).json({ error: 'Booking not found.' }); return true;
  }
  if (error.sqlState === '45004') { forbidden(res); return true; }
  return false;
}
module.exports = { staffRoles, restrictedRoles, canonicalId, forbidden, expired, validScope, canRead, canAct,
  currentStaff, bookingAccess, roomAccess, bookingRead, scopeConflict };
