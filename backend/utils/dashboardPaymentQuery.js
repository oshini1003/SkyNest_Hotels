// Internal query builder: callers supply a captured database date and a validated
// optional branch ID. Shared with the read-only query-plan evidence checker.
function dashboardPaymentQuery(date, branchId) {
  return {
    sql: `SELECT CAST(COALESCE(SUM(p.Amount), 0.00) AS CHAR) AS todayRevenue,
                 COUNT(p.PaymentID) AS todayPaymentsCount
          FROM PAYMENT p
          ${branchId === undefined ? '' : `JOIN (
            SELECT br.BookingID, MIN(r.BranchID) AS BranchID
            FROM BOOKED_ROOMS br
            JOIN ROOM r ON r.RoomID = br.RoomID
            GROUP BY br.BookingID
            HAVING COUNT(DISTINCT r.BranchID) = 1
          ) scope ON scope.BookingID = p.BookingID`}
          WHERE p.PaymentDate >= ? AND p.PaymentDate < DATE_ADD(?, INTERVAL 1 DAY)
          ${branchId === undefined ? '' : 'AND scope.BranchID = ?'}`,
    // Apply date arithmetic to the bound constant, leaving PaymentDate available
    // for index range access. Reusing date prevents a second CURDATE() at midnight.
    params: [date, date, ...(branchId === undefined ? [] : [branchId])],
  };
}

module.exports = { dashboardPaymentQuery };
