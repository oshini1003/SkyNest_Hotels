# Dashboard payment query: index use and evidence

## Problem and change

The dashboard sums saved payments for one database calendar day. Its previous
filter was `DATE(p.PaymentDate) = ?`. Applying a function to every stored date
prevented the existing `idx_payment_date(PaymentDate)` index from being used in
the observed query plan.

The production query now uses:

```sql
WHERE p.PaymentDate >= ?
  AND p.PaymentDate < DATE_ADD(?, INTERVAL 1 DAY)
```

Both parameters contain the same database date. The lower boundary includes
midnight and the upper boundary excludes midnight of the following day, including
month/year/leap-day changes. Date arithmetic operates on the bound constant,
leaving the indexed column available for range access. No JavaScript timezone
conversion is used. The controller captures `CURDATE()` once within its existing
read-only repeatable-read transaction.

The query is shared in `backend/utils/dashboardPaymentQuery.js` by the controller
and evidence checker. Authentication, role validation, branch filters, API fields
and monetary precision are unchanged. Every payment is counted once, including
equal-amount payments and bookings with multiple rooms. A branch total still
includes only bookings assigned wholly to that branch; mixed-branch/unassigned
bookings remain in the chain total. No new index or schema installation is needed.

## Preliminary live observation supplied on 6 October 2026

Environment: MySQL Community 9.7.1 on Windows, database
`skynest_integration_20261002`, selected date `2026-10-06`, four saved payments.
These values are transcribed from the developer's read-only local inspection.

| Filter tested | Access type | Selected index | Estimated rows | Payments | Total (LKR) |
| --- | --- | --- | ---: | ---: | ---: |
| `DATE(PaymentDate) = day` | `ALL` | none | 4 | 2 | 8800.00 |
| `PaymentDate >= day AND PaymentDate < nextDay` | `range` | `idx_payment_date` | 2 | 2 | 8800.00 |

Both aggregates came from the same consistent snapshot and were equal. This
supports index use for a selective date range. `EXPLAIN.rows` is an estimate,
not elapsed time or an exact count of examined rows. Four payment rows are too
few to claim a representative speedup. Do not present this as "twice as fast".

The preliminary probe bound `nextDay` directly. The production query computes it
with `DATE_ADD` on the captured date. Use the checker below to record the exact
production query's plan; do not label this preliminary result as a test of the
newly shipped helper. Index choice is cost-based and may differ by branch,
date, statistics or data size. No `FORCE INDEX` is used.

## Reproduce without changing hotel data

Keep the existing integration database. Configure `backend/.env` with
`DB_NAME=SkyNest_Integration_20261002` and the correct local connection details.
From the repository root:

```powershell
node .\backend\tests\dashboard-regression.cjs
node .\backend\tests\payment-query-evidence-regression.cjs
node .\backend\check-dashboard-payment-query.js --date 2026-10-06
```

The first two commands use mock databases and check query contracts and lifecycle
behavior. The third requires your local MySQL server. It reads the captured day,
checks all-branch and per-branch legacy/production aggregate equality, prints
`EXPLAIN FORMAT=TRADITIONAL` plans, and exercises SQL date-boundary fixtures.
Omit `--date` for the database's current day. The application API need not run.
The checker prints aggregate data and plans, not passwords, tokens or guest data.

Save the final live output with the tested Git commit for your presentation.
Show the old/new predicates, identical totals, selected indexes and estimated
rows. A successful comparison proves result agreement for the saved data and
fixture checks; it does not establish production-scale throughput. A full scan
on a small or nonselective dataset is not automatically a regression. No test
requires a particular index choice.

## Existing indexes relevant to the project

| Index | Purpose and limit |
| --- | --- |
| `idx_payment_date(PaymentDate)` | Supports date ranges for received payments; this patch changes the query to make this use possible. |
| `idx_bookedrooms_room_dates(RoomID, CheckInDateTime, CheckOutDateTime)` | Supports availability checks starting with a specific room. It is not a general leading index for date-only searches. |
| `idx_room_branch_type_status(BranchID, RoomTypeID, RoomStatus)` | Supports searches starting with branch and room type. Column order matters. |
| `idx_audit_booking_created(BookingID, CreatedAt, AuditID)` | Supports booking-specific chronological audit history. |
| unique `BILL(BookingID)` | Enforces one bill per booking and supports bill lookup. |

Adding overlapping indexes has storage/write costs. The live inspection also
showed a unique `REFRESH_TOKEN(Token)` index and nonunique `idx_refresh_token`
on the same column. Their cleanup is separate work; this patch does not remove
indexes or change authentication storage.

## Security follow-up

The same inspection identified `root@localhost` as the backend database account
with broad privileges. A dedicated restricted runtime account and separate
maintenance credentials remain to be implemented and tested. Do not claim
least-privilege database access is already complete. Database-level security is
separate from the existing application role and ownership checks.

## References

- [MySQL 9.7 range optimization](https://dev.mysql.com/doc/refman/9.7/en/range-optimization.html)
- [MySQL 9.7 EXPLAIN output](https://dev.mysql.com/doc/refman/9.7/en/explain-output.html)
- [MySQL 9.7 date and time functions](https://dev.mysql.com/doc/refman/9.7/en/date-and-time-functions.html)
