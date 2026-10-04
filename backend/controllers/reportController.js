const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { canReadReports, validateReportQuery } = require('../utils/reportValidation');

// One row per booking, regardless of its room count. Historical multi-branch
// bookings cannot be allocated from a single stored bill, so keep them separate.
// Starting with BOOKING also retains bills/usage with no assigned rooms.
const bookingBranches = `
  SELECT mapped_booking.BookingID,
         CASE WHEN COUNT(DISTINCT mapped_room.BranchID) = 1
              THEN MIN(mapped_room.BranchID) ELSE NULL END AS BranchID,
         CASE WHEN COUNT(DISTINCT mapped_room.BranchID) = 0 THEN 'unassigned'
              WHEN COUNT(DISTINCT mapped_room.BranchID) = 1 THEN 'single'
              ELSE 'multiple' END AS BranchScope
  FROM BOOKING mapped_booking
  LEFT JOIN BOOKED_ROOMS mapped_stay ON mapped_stay.BookingID = mapped_booking.BookingID
  LEFT JOIN ROOM mapped_room ON mapped_room.RoomID = mapped_stay.RoomID
  GROUP BY mapped_booking.BookingID`;

const branchName = `CASE WHEN scope.BranchScope = 'single' THEN br.Name
                        WHEN scope.BranchScope = 'multiple' THEN 'Multiple branches'
                        ELSE 'Unassigned branch' END`;

function reportFilters(req, res, report) {
  res.set('Cache-Control', 'no-store');
  if (!canReadReports(req.user)) {
    res.status(403).json({ error: 'Manager or administrator access is required.' });
    return null;
  }
  const parsed = validateReportQuery(report, req.query);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return null;
  }
  return parsed.value;
}

function sendReport(res, rows, countFields = []) {
  const result = rows.map(row => {
    const record = { ...row };
    for (const field of countFields) {
      const raw = row[field];
      const count = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw;
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('A report count exceeds the supported numeric range.');
      }
      record[field] = count;
    }
    return record;
  });
  res.json(result);
}

// GET /api/reports/occupancy?branchId=
const occupancyReport = asyncHandler(async (req, res) => {
  const filters = reportFilters(req, res, 'occupancy');
  if (!filters) return;
  const params = [];
  const branchFilter = filters.branchId === undefined ? '' : 'WHERE br.BranchID = ?';
  if (filters.branchId !== undefined) params.push(filters.branchId);
  const [rows] = await pool.query(
    `SELECT br.BranchID, br.Name AS BranchName,
            COALESCE(SUM(r.RoomStatus = 'Occupied'), 0) AS Occupied,
            COALESCE(SUM(r.RoomStatus = 'Available'), 0) AS Available,
            COALESCE(SUM(r.RoomStatus = 'Maintenance'), 0) AS Maintenance,
            COUNT(r.RoomID) AS TotalRooms
     FROM BRANCH br LEFT JOIN ROOM r ON r.BranchID = br.BranchID
     ${branchFilter}
     GROUP BY br.BranchID, br.Name
     ORDER BY br.Name, br.BranchID`,
    params
  );
  sendReport(res, rows, ['Occupied', 'Available', 'Maintenance', 'TotalRooms']);
});

// GET /api/reports/billing-summary?branchId=&outstandingOnly=true
const billingSummary = asyncHandler(async (req, res) => {
  const filters = reportFilters(req, res, 'billing');
  if (!filters) return;
  const params = [];
  const conditions = [];
  if (filters.branchId !== undefined) {
    conditions.push("scope.BranchScope = 'single' AND scope.BranchID = ?");
    params.push(filters.branchId);
  }
  if (filters.outstandingOnly) conditions.push('bl.TotalAmount - COALESCE(paid.PaidAmount, 0.00) > 0');
  const [rows] = await pool.query(
    `SELECT b.BookingID, bl.BillID, g.Name AS GuestName,
            b.BookingStatus, bl.BillStatus,
            DATE_FORMAT(bl.GeneratedDate, '%Y-%m-%d %H:%i:%s') AS GeneratedDateDisplay,
            scope.BranchID, ${branchName} AS BranchName, scope.BranchScope,
            CAST(bl.RoomCharges AS CHAR) AS RoomCharges,
            CAST(bl.ServiceCharges AS CHAR) AS ServiceCharges,
            CAST(bl.TotalAmount AS CHAR) AS TotalAmount,
            CAST(COALESCE(paid.PaidAmount, 0.00) AS CHAR) AS PaidAmount,
            CAST(bl.TotalAmount - COALESCE(paid.PaidAmount, 0.00) AS CHAR) AS OutstandingBalance
     FROM BILL bl
     JOIN BOOKING b ON b.BookingID = bl.BookingID
     JOIN GUEST g ON g.GuestID = b.GuestID
     JOIN (${bookingBranches}) scope ON scope.BookingID = b.BookingID
     LEFT JOIN BRANCH br ON br.BranchID = scope.BranchID
     LEFT JOIN (
       SELECT BookingID, SUM(Amount) AS PaidAmount FROM PAYMENT GROUP BY BookingID
     ) paid ON paid.BookingID = b.BookingID
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY b.BookingID DESC, bl.BillID DESC`,
    params
  );
  sendReport(res, rows);
});

function serviceQuery(filters, top) {
  const params = [];
  const branchFilter = filters.branchId === undefined
    ? '' : "WHERE scope.BranchScope = 'single' AND scope.BranchID = ?";
  if (filters.branchId !== undefined) params.push(filters.branchId);
  if (top) params.push(filters.limit);
  return {
    sql: `SELECT sc.ServiceID, sc.ServiceName, COUNT(*) AS TimesUsed,
                 SUM(su.Quantity) AS TotalQuantity,
                 CAST(SUM(su.Quantity * su.PriceAtUsage) AS CHAR) AS TotalRevenue
          FROM SERVICE_USAGE su
          JOIN SERVICE_CATALOGUE sc ON sc.ServiceID = su.ServiceID
          JOIN (${bookingBranches}) scope ON scope.BookingID = su.BookingID
          ${branchFilter}
          GROUP BY sc.ServiceID, sc.ServiceName
          ${top
    ? 'ORDER BY TimesUsed DESC, TotalQuantity DESC, sc.ServiceID ASC LIMIT ?'
    : 'ORDER BY SUM(su.Quantity * su.PriceAtUsage) DESC, sc.ServiceID ASC'}`,
    params,
  };
}

// GET /api/reports/service-usage?branchId=
const serviceUsageBreakdown = asyncHandler(async (req, res) => {
  const filters = reportFilters(req, res, 'services');
  if (!filters) return;
  const { sql, params } = serviceQuery(filters, false);
  const [rows] = await pool.query(sql, params);
  sendReport(res, rows, ['TimesUsed', 'TotalQuantity']);
});

// GET /api/reports/revenue?branchId=&year=&month=
const monthlyRevenueByBranch = asyncHandler(async (req, res) => {
  const filters = reportFilters(req, res, 'revenue');
  if (!filters) return;
  const params = [];
  const conditions = ["bk.BookingStatus = 'Checked-Out'"];
  if (filters.branchId !== undefined) {
    conditions.push("scope.BranchScope = 'single' AND scope.BranchID = ?");
    params.push(filters.branchId);
  }
  // GeneratedDate is when the bill opened; the schema has no actual checkout
  // timestamp. These periods describe finalized bills by their opening month,
  // not cash receipts or the month in which the guest checked out.
  if (filters.year !== undefined) {
    conditions.push('YEAR(bl.GeneratedDate) = ?');
    params.push(filters.year);
  }
  if (filters.month !== undefined) {
    conditions.push('MONTH(bl.GeneratedDate) = ?');
    params.push(filters.month);
  }
  const [rows] = await pool.query(
    `SELECT scope.BranchID, ${branchName} AS BranchName, scope.BranchScope,
            DATE_FORMAT(bl.GeneratedDate, '%Y-%m') AS Month,
            COUNT(bl.BillID) AS BillCount,
            CAST(SUM(bl.RoomCharges) AS CHAR) AS RoomRevenue,
            CAST(SUM(bl.ServiceCharges) AS CHAR) AS ServiceRevenue,
            CAST(SUM(bl.TotalAmount) AS CHAR) AS TotalRevenue
     FROM BILL bl
     JOIN BOOKING bk ON bk.BookingID = bl.BookingID
     JOIN (${bookingBranches}) scope ON scope.BookingID = bk.BookingID
     LEFT JOIN BRANCH br ON br.BranchID = scope.BranchID
     WHERE ${conditions.join(' AND ')}
     GROUP BY scope.BranchID, scope.BranchScope, br.Name, DATE_FORMAT(bl.GeneratedDate, '%Y-%m')
     ORDER BY Month DESC, BranchName, scope.BranchScope, scope.BranchID`,
    params
  );
  sendReport(res, rows, ['BillCount']);
});

// GET /api/reports/top-services?branchId=&limit=5
const topServices = asyncHandler(async (req, res) => {
  const filters = reportFilters(req, res, 'top');
  if (!filters) return;
  const { sql, params } = serviceQuery(filters, true);
  // mysql2.query safely binds the numeric LIMIT; no user text is interpolated.
  const [rows] = await pool.query(sql, params);
  sendReport(res, rows, ['TimesUsed', 'TotalQuantity']);
});

module.exports = {
  occupancyReport,
  billingSummary,
  serviceUsageBreakdown,
  monthlyRevenueByBranch,
  topServices,
};
