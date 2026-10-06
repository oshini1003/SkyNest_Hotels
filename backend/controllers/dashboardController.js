const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { canReadReports, validateReportQuery } = require('../utils/reportValidation');
const { dashboardPaymentQuery } = require('../utils/dashboardPaymentQuery');

function count(value) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('An invalid dashboard count was returned by the database.');
  }
  return parsed;
}

function roomSummary(row) {
  const totalRooms = count(row.totalRooms);
  const occupiedRooms = count(row.occupiedRooms);
  const availableRooms = count(row.availableRooms);
  const maintenanceRooms = count(row.maintenanceRooms);
  if (occupiedRooms + availableRooms + maintenanceRooms !== totalRooms) {
    throw new Error('Inconsistent dashboard room counts were returned by the database.');
  }
  return {
    totalRooms,
    occupiedRooms,
    availableRooms,
    maintenanceRooms,
    occupancyPercentage: totalRooms > 0
      ? Number(((occupiedRooms / totalRooms) * 100).toFixed(2)) : null,
  };
}

// GET /api/dashboard/admin?branchId=
const getAdminDashboardSummary = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!canReadReports(req.user)) {
    return res.status(403).json({ error: 'Manager or administrator access is required.' });
  }
  const parsed = validateReportQuery('occupancy', req.query);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { branchId } = parsed.value;
  const branchClause = branchId === undefined ? '' : 'AND r.BranchID = ?';
  const branchParams = branchId === undefined ? [] : [branchId];

  const connection = await pool.getConnection();
  let result;
  try {
    // A dashboard response represents one committed state even while staff
    // process check-ins, services and payments in other transactions.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [[day]] = await connection.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS ServerToday");
    if (!day || typeof day.ServerToday !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.ServerToday)) {
      throw new Error('An invalid dashboard date was returned by the database.');
    }
    const date = day.ServerToday;
    const datedParams = [date, ...branchParams];

    const [[roomRow]] = await connection.query(
      `SELECT COUNT(r.RoomID) AS totalRooms,
              COALESCE(SUM(r.RoomStatus = 'Occupied'), 0) AS occupiedRooms,
              COALESCE(SUM(r.RoomStatus = 'Available'), 0) AS availableRooms,
              COALESCE(SUM(r.RoomStatus = 'Maintenance'), 0) AS maintenanceRooms
       FROM ROOM r
       ${branchId === undefined ? '' : 'WHERE r.BranchID = ?'}`,
      branchParams
    );
    const rooms = roomSummary(roomRow);

    // These are scheduled-date cohorts and their current statuses. There are
    // no actual check-in/check-out event timestamps in the current schema.
    const [[checkInRow]] = await connection.query(
      `SELECT COUNT(DISTINCT br.BookingID) AS scheduledToday,
              COUNT(DISTINCT CASE WHEN b.BookingStatus IN ('Checked-In', 'Checked-Out')
                THEN br.BookingID END) AS completedToday
       FROM BOOKED_ROOMS br
       JOIN BOOKING b ON b.BookingID = br.BookingID
       JOIN ROOM r ON r.RoomID = br.RoomID
       WHERE DATE(br.CheckInDateTime) = ?
         AND b.BookingStatus != 'Cancelled'
         ${branchClause}`,
      datedParams
    );
    const [[checkOutRow]] = await connection.query(
      `SELECT COUNT(DISTINCT br.BookingID) AS scheduledToday,
              COUNT(DISTINCT CASE WHEN b.BookingStatus = 'Checked-Out'
                THEN br.BookingID END) AS completedToday
       FROM BOOKED_ROOMS br
       JOIN BOOKING b ON b.BookingID = br.BookingID
       JOIN ROOM r ON r.RoomID = br.RoomID
       WHERE DATE(br.CheckOutDateTime) = ?
         AND b.BookingStatus != 'Cancelled'
         ${branchClause}`,
      datedParams
    );
    const todayCheckIns = count(checkInRow.scheduledToday);
    const todayCompletedCheckIns = count(checkInRow.completedToday);
    const todayCheckOuts = count(checkOutRow.scheduledToday);
    const todayCompletedCheckOuts = count(checkOutRow.completedToday);
    if (todayCompletedCheckIns > todayCheckIns || todayCompletedCheckOuts > todayCheckOuts) {
      throw new Error('Inconsistent dashboard stay counts were returned by the database.');
    }

    // Each payment contributes once. As in the existing reports, a booking
    // spanning several branches has no defensible per-branch cash allocation.
    const paymentQuery = dashboardPaymentQuery(date, branchId);
    const [[paymentRow]] = await connection.query(paymentQuery.sql, paymentQuery.params);
    if (typeof paymentRow.todayRevenue !== 'string' || !/^\d+\.\d{2}$/.test(paymentRow.todayRevenue)) {
      throw new Error('An invalid dashboard payment amount was returned by the database.');
    }
    const todayPaymentsCount = count(paymentRow.todayPaymentsCount);

    const [[activeRow]] = await connection.query(
      `SELECT COUNT(DISTINCT b.BookingID) AS activeBookings
       FROM BOOKING b
       LEFT JOIN BOOKED_ROOMS br ON br.BookingID = b.BookingID
       LEFT JOIN ROOM r ON r.RoomID = br.RoomID
       WHERE b.BookingStatus IN ('Booked', 'Checked-In')
       ${branchClause}`,
      branchParams
    );

    let branchBreakdown;
    if (branchId === undefined) {
      const [branchRows] = await connection.query(
        `SELECT b.BranchID, b.Name AS BranchName,
                COUNT(r.RoomID) AS totalRooms,
                COALESCE(SUM(r.RoomStatus = 'Occupied'), 0) AS occupiedRooms,
                COALESCE(SUM(r.RoomStatus = 'Available'), 0) AS availableRooms,
                COALESCE(SUM(r.RoomStatus = 'Maintenance'), 0) AS maintenanceRooms
         FROM BRANCH b LEFT JOIN ROOM r ON r.BranchID = b.BranchID
         GROUP BY b.BranchID, b.Name ORDER BY b.BranchID`
      );
      branchBreakdown = branchRows.map(row => {
        const id = count(row.BranchID);
        if (id < 1 || id > 2147483647 || typeof row.BranchName !== 'string') {
          throw new Error('An invalid dashboard branch was returned by the database.');
        }
        return { branchId: id, branchName: row.BranchName, ...roomSummary(row) };
      });
    }

    result = {
      date,
      branchId: branchId === undefined ? 'all' : branchId,
      summary: {
        todayCheckIns,
        todayCompletedCheckIns,
        todayCheckOuts,
        todayCompletedCheckOuts,
        todayRevenue: paymentRow.todayRevenue,
        todayPaymentsCount,
        currentOccupancyPercentage: rooms.occupancyPercentage,
        totalRooms: rooms.totalRooms,
        occupiedRooms: rooms.occupiedRooms,
        availableRooms: rooms.availableRooms,
        maintenanceRooms: rooms.maintenanceRooms,
        activeBookings: count(activeRow.activeBookings),
      },
      branchBreakdown,
    };
    await connection.commit();
  } catch (error) {
    try { await connection.rollback(); } catch (_) { /* Preserve the original read error. */ }
    throw error;
  } finally {
    connection.release();
  }
  res.json(result);
});

module.exports = { getAdminDashboardSummary };
