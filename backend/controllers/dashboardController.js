const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/dashboard/admin
// Query param: ?branchId= (optional)
const getAdminDashboardSummary = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');

  let branchId = null;
  if (req.query.branchId !== undefined) {
    const parsed = parseInt(req.query.branchId, 10);
    if (isNaN(parsed) || parsed <= 0) {
      return res.status(400).json({ error: 'branchId must be a positive integer.' });
    }
    branchId = parsed;
  }

  const branchClause = branchId ? 'AND r.BranchID = ?' : '';
  const branchParams = branchId ? [branchId] : [];

  // 1. Room Status & Current Occupancy
  const [roomRows] = await pool.query(
    `SELECT 
       COUNT(r.RoomID) AS totalRooms,
       COALESCE(SUM(r.RoomStatus = 'Occupied'), 0) AS occupiedRooms,
       COALESCE(SUM(r.RoomStatus = 'Available'), 0) AS availableRooms,
       COALESCE(SUM(r.RoomStatus = 'Maintenance'), 0) AS maintenanceRooms
     FROM ROOM r
     ${branchId ? 'WHERE r.BranchID = ?' : ''}`,
    branchParams
  );

  const totalRooms = Number(roomRows[0].totalRooms) || 0;
  const occupiedRooms = Number(roomRows[0].occupiedRooms) || 0;
  const availableRooms = Number(roomRows[0].availableRooms) || 0;
  const maintenanceRooms = Number(roomRows[0].maintenanceRooms) || 0;
  const occupancyPercentage = totalRooms > 0
    ? Number(((occupiedRooms / totalRooms) * 100).toFixed(2))
    : 0;

  // 2. Today's Check-ins
  const [checkInRows] = await pool.query(
    `SELECT 
       COUNT(DISTINCT br.BookingID) AS scheduledToday,
       COUNT(DISTINCT CASE WHEN b.BookingStatus = 'Checked-In' THEN br.BookingID END) AS completedToday
     FROM BOOKED_ROOMS br
     JOIN BOOKING b ON b.BookingID = br.BookingID
     JOIN ROOM r ON r.RoomID = br.RoomID
     WHERE DATE(br.CheckInDateTime) = CURDATE()
       AND b.BookingStatus != 'Cancelled'
       ${branchClause}`,
    branchParams
  );

  // 3. Today's Check-outs
  const [checkOutRows] = await pool.query(
    `SELECT 
       COUNT(DISTINCT br.BookingID) AS scheduledToday,
       COUNT(DISTINCT CASE WHEN b.BookingStatus = 'Checked-Out' THEN br.BookingID END) AS completedToday
     FROM BOOKED_ROOMS br
     JOIN BOOKING b ON b.BookingID = br.BookingID
     JOIN ROOM r ON r.RoomID = br.RoomID
     WHERE DATE(br.CheckOutDateTime) = CURDATE()
       AND b.BookingStatus != 'Cancelled'
       ${branchClause}`,
    branchParams
  );

  // 4. Today's Revenue (Payments recorded today)
  const paymentQuery = branchId
    ? `SELECT 
         COALESCE(SUM(p.Amount), 0.00) AS todayRevenue,
         COUNT(p.PaymentID) AS todayPaymentsCount
       FROM PAYMENT p
       JOIN BOOKED_ROOMS br ON br.BookingID = p.BookingID
       JOIN ROOM r ON r.RoomID = br.RoomID
       WHERE DATE(p.PaymentDate) = CURDATE() AND r.BranchID = ?`
    : `SELECT 
         COALESCE(SUM(p.Amount), 0.00) AS todayRevenue,
         COUNT(p.PaymentID) AS todayPaymentsCount
       FROM PAYMENT p
       WHERE DATE(p.PaymentDate) = CURDATE()`;

  const [paymentRows] = await pool.query(paymentQuery, branchParams);

  // 5. Total Active Bookings (Booked or Checked-In)
  const [activeRows] = await pool.query(
    `SELECT COUNT(DISTINCT b.BookingID) AS activeBookings
     FROM BOOKING b
     LEFT JOIN BOOKED_ROOMS br ON br.BookingID = b.BookingID
     LEFT JOIN ROOM r ON r.RoomID = br.RoomID
     WHERE b.BookingStatus IN ('Booked', 'Checked-In')
     ${branchClause}`,
    branchParams
  );

  // 6. Optional Per-Branch Summary (when viewing chain-wide)
  let branchBreakdown = undefined;
  if (!branchId) {
    const [branchRows] = await pool.query(
      `SELECT 
         b.BranchID,
         b.Name AS BranchName,
         COUNT(r.RoomID) AS totalRooms,
         COALESCE(SUM(r.RoomStatus = 'Occupied'), 0) AS occupiedRooms,
         COALESCE(SUM(r.RoomStatus = 'Available'), 0) AS availableRooms,
         COALESCE(SUM(r.RoomStatus = 'Maintenance'), 0) AS maintenanceRooms
       FROM BRANCH b
       LEFT JOIN ROOM r ON r.BranchID = b.BranchID
       GROUP BY b.BranchID, b.Name
       ORDER BY b.BranchID`
    );

    branchBreakdown = branchRows.map(row => {
      const bTotal = Number(row.totalRooms) || 0;
      const bOccupied = Number(row.occupiedRooms) || 0;
      return {
        branchId: row.BranchID,
        branchName: row.BranchName,
        totalRooms: bTotal,
        occupiedRooms: bOccupied,
        availableRooms: Number(row.availableRooms) || 0,
        maintenanceRooms: Number(row.maintenanceRooms) || 0,
        occupancyPercentage: bTotal > 0 ? Number(((bOccupied / bTotal) * 100).toFixed(2)) : 0,
      };
    });
  }

  res.json({
    date: new Date().toISOString().split('T')[0],
    branchId: branchId || 'all',
    summary: {
      todayCheckIns: Number(checkInRows[0].scheduledToday) || 0,
      todayCompletedCheckIns: Number(checkInRows[0].completedToday) || 0,
      todayCheckOuts: Number(checkOutRows[0].scheduledToday) || 0,
      todayCompletedCheckOuts: Number(checkOutRows[0].completedToday) || 0,
      todayRevenue: Number(paymentRows[0].todayRevenue) || 0,
      todayPaymentsCount: Number(paymentRows[0].todayPaymentsCount) || 0,
      currentOccupancyPercentage: occupancyPercentage,
      totalRooms,
      occupiedRooms,
      availableRooms,
      maintenanceRooms,
      activeBookings: Number(activeRows[0].activeBookings) || 0,
    },
    branchBreakdown,
  });
});

module.exports = {
  getAdminDashboardSummary,
};

