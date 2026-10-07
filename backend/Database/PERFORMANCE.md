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
with `DATE_ADD` on the captured date. The figures above therefore describe the
preliminary probe, not the exact production helper. The user subsequently
reported a successful live production-query checker run, before the runtime
account security stage. Retain that run's output and its tested source version
as the production-query evidence. This documentation review did
not independently rerun it or establish new plan figures or elapsed timings.
Index choice is cost-based and may differ by branch,
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

## Restricted runtime account implemented after the preliminary inspection

The preliminary inspection identified `root@localhost` as the backend database
account. The later security stage implemented a restricted `skynest_app@localhost`
runtime account, separate maintenance credentials and grant/read/denial/locking
checks. The user reported live activation and successful checks at commit
`96c39cc`; those local results were not independently rerun in this documentation
review. Keep the local output with the tested commit.

The current [database security policy](DATABASE_SECURITY.md) documents the exact
grants, verification commands and maintenance process. Do not rerun provisioning
on an already activated installation or change the runtime configuration back
to root. Database grants remain separate from application role, guest ownership
and branch authorization; this stage does not establish branch-scoped staff
access. See [grading readiness](../../docs/GRADING_READINESS.md) for the evidence
status and remaining gaps.

## References

- [MySQL 9.7 range optimization](https://dev.mysql.com/doc/refman/9.7/en/range-optimization.html)
- [MySQL 9.7 EXPLAIN output](https://dev.mysql.com/doc/refman/9.7/en/explain-output.html)
- [MySQL 9.7 date and time functions](https://dev.mysql.com/doc/refman/9.7/en/date-and-time-functions.html)
