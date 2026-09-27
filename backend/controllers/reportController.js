const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/reports/occupancy?branchId=
const occupancyReport = asyncHandler(async (req, res) => {
  const { branchId } = req.query;
  const params = [];
  let where = '';
  if (branchId) {
    where = 'WHERE r.BranchID = ?';
    params.push(branchId);
  }
  const [rows] = await pool.query(
    `SELECT br.BranchID, br.Name AS BranchName,
            SUM(r.RoomStatus = 'Occupied') AS Occupied,
            SUM(r.RoomStatus = 'Available') AS Available,
            SUM(r.RoomStatus = 'Maintenance') AS Maintenance,
            COUNT(*) AS TotalRooms
     FROM ROOM r JOIN BRANCH br ON br.BranchID = r.BranchID
     ${where}
     GROUP BY br.BranchID, br.Name`,
    params
  );
  res.json(rows);
});

// GET /api/reports/billing-summary?outstandingOnly=true
const billingSummary = asyncHandler(async (req, res) => {
  const { outstandingOnly } = req.query;
  const [rows] = await pool.query(
    `SELECT b.BookingID, g.Name AS GuestName, bl.TotalAmount, bl.BillStatus,
            fn_calculate_outstanding_balance(b.BookingID) AS OutstandingBalance
     FROM BOOKING b
     JOIN GUEST g ON g.GuestID = b.GuestID
     LEFT JOIN BILL bl ON bl.BookingID = b.BookingID
     WHERE bl.BillID IS NOT NULL
     ${outstandingOnly === 'true' ? 'AND bl.BillStatus != "Paid"' : ''}
     ORDER BY b.BookingID DESC`
  );
  res.json(rows);
});

// GET /api/reports/service-usage?branchId=
const serviceUsageBreakdown = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT sc.ServiceID, sc.ServiceName,
            SUM(su.Quantity) AS TotalQuantity,
            SUM(su.Quantity * su.PriceAtUsage) AS TotalRevenue
     FROM SERVICE_USAGE su JOIN SERVICE_CATALOGUE sc ON sc.ServiceID = su.ServiceID
     GROUP BY sc.ServiceID, sc.ServiceName
     ORDER BY TotalRevenue DESC`
  );
  res.json(rows);
});

// GET /api/reports/revenue?branchId=&year=&month=
const monthlyRevenueByBranch = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT br.BranchID, br.Name AS BranchName,
            DATE_FORMAT(bl.GeneratedDate, '%Y-%m') AS Month,
            SUM(bl.RoomCharges) AS RoomRevenue,
            SUM(bl.ServiceCharges) AS ServiceRevenue,
            SUM(bl.TotalAmount) AS TotalRevenue
     FROM BILL bl
     JOIN BOOKING bk ON bk.BookingID = bl.BookingID
     JOIN BOOKED_ROOMS bro ON bro.BookingID = bk.BookingID
     JOIN ROOM r ON r.RoomID = bro.RoomID
     JOIN BRANCH br ON br.BranchID = r.BranchID
     WHERE bk.BookingStatus = 'Checked-Out'
     GROUP BY br.BranchID, br.Name, Month
     ORDER BY Month DESC, br.Name`
  );
  res.json(rows);
});

// GET /api/reports/top-services?limit=5
const topServices = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 5, 50);
  const [rows] = await pool.query(
    `SELECT sc.ServiceID, sc.ServiceName, COUNT(*) AS TimesUsed, SUM(su.Quantity) AS TotalQuantity
     FROM SERVICE_USAGE su JOIN SERVICE_CATALOGUE sc ON sc.ServiceID = su.ServiceID
     GROUP BY sc.ServiceID, sc.ServiceName
     ORDER BY TimesUsed DESC
     LIMIT ${limit}`
  );
  res.json(rows);
});

module.exports = {
  occupancyReport,
  billingSummary,
  serviceUsageBreakdown,
  monthlyRevenueByBranch,
  topServices,
};
