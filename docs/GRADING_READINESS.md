# SkyNest Hotels: grading readiness and evidence

Reviewed on 7 October 2026 against the source snapshot for the user-reported
`main` commit `96c39cc`. This is a working checklist, not a claim of awarded marks
or complete SRS compliance. Live results below are the developer's supplied
terminal output from their Windows/MySQL installation. Local regression tests
with mocks are identified separately.

## 1. What the assessment asks for

Sources supplied by the team:

- **Grade breakdown**, image dated 6 October 2026, 19:20:34.
- **Project 5 - Hotel Reservation and Guest Services Management System_3.pdf**,
  pages 1–2: core hotel workflows, five reports and minimum demonstration data.
- **HRGSMS_SRS - Group 36_3.pdf**, especially sections 3.2 and 3.3.
- **HRGSMS_Project_Task_List.pdf**: an earlier planning list. Its DONE labels
  and object counts are historical; the current implementation must be checked.

| Rubric area | Maximum | Current evidence | Still to prepare or verify |
| --- | ---: | --- | --- |
| Demonstration, plan and communication | 5 | A working booking-to-checkout sequence has been exercised | Rehearse the short sequence below; agree who explains each part |
| Required functionality and database/UI use | 8 | Guest booking/cancellation; staff check-in, services, payments and checkout; five report endpoints and manager dashboard | Minimum data counts; guest bill/service pages; management forms; reporting coverage and branch authorization gaps below |
| Database design, normalization, triggers and methods | 8 | 17 tables, 4 functions, 7 procedures and 8 triggers in source; PK/FK/CHECK/UNIQUE constraints | Updated ERD, functional dependencies and explanation of stored summaries; do not claim blanket 3NF |
| Performance tuning / advanced features | 4 | Index-friendly payment query and restricted database runtime account | Present why both are appropriate, the actual comparison/grant outputs, and their limits |
| Bonus features | 5 | Custom React layouts and UX improvements are available for demonstration | Examiner judges UI/UX; CI/CD, public cloud hosting and notifications have not been demonstrated |

The performance row calls for at least two appropriate applications for its top
band. Query/index optimization and restricted SQL permissions are two grounded
examples; adding arbitrary indexes or unrelated triggers is unnecessary.

## 2. First action: check the saved demonstration data

The project brief asks for 3 branches, at least 10 rooms with different types,
6 services, 5 guests with 8 total bookings, availability/service records, and at
least 3 partial payments. The checker treats numeric quantities as lower bounds;
keep Colombo, Kandy and Galle represented. It treats "different types" as at
least two types actually assigned to rooms.

The original `backend/Database/seed.sql` contains **3 branches, 7 rooms,
4 services, 2 guests and 1 sample booking**, with no service-usage or payment
rows. Later manual tests added records. Neither the seed counts nor the largest
booking ID establish the current live row counts.

From the repository root, with MySQL running:

```powershell
node .\backend\tests\grading-data-regression.cjs
node .\backend\check-grading-data.js
```

The second command reads `backend/.env` and uses the already activated
`skynest_app` account on the local integration database. It uses one read-only
snapshot and prints aggregate counts, without guest details or credentials.
The frontend and backend may stay running. It creates no bookings, payments,
audit entries or login sessions.

| Exit code | Meaning | Next action |
| ---: | --- | --- |
| 0 | All checked data-count thresholds met | Review scenario coverage and remaining features; this is not a full project PASS |
| 2 | Inspection completed; one or more data thresholds need attention | Share the printed counts so only missing demonstration data can be added |
| 1 | Configuration/query/response failure | Share the safe error output; no result is claimed for the incomplete inspection |

`PAYMENT.PaymentType = 'Partial'` is the count used. A final payment that settles
the outstanding balance is stored as `Full`, even when an earlier partial payment
exists. Counting all payments is therefore insufficient. This count does not
independently prove historical payment correctness; the audit verifier serves
that separate purpose.

The number of distinct guests represented in bookings is also printed. For a
clear demonstration, spread the eight-or-more reservations across at least five
guests rather than merely creating five unused profiles. Review the mix of Booked,
Checked-In, Checked-Out and Cancelled reservations as scenario coverage.

Availability is represented by `ROOM.RoomStatus` plus booked-room date intervals
and booking status. There is no separate availability table. A booked-room count
does not prove overlap prevention; demonstrate the supported booking workflow.

Do not run `seed.sql`, recreate the database, or fabricate past audit events to
meet these counts. Add the missing catalogue entries with the reviewed local
helper, then use the existing API/UI workflows for guests, bookings and payments,
preserving existing history. See [demonstration data completion](DEMO_DATA_COMPLETION.md).

The developer's live inspection on 7 October 2026 returned 3 branches, 7 rooms,
3 used room types, 4 services, 3 guests, 7 bookings, 2 Partial payments,
7 booked-room rows and 4 service-usage rows. Two distinct guests had bookings.
This is a successful inspection with data gaps, not a database failure.

## 3. Evidence already supplied

| Capability | Evidence supplied | What it establishes / limit |
| --- | --- | --- |
| Guest authentication | `test-tokens.js` PASS after runtime-account activation | Login, token-purpose separation, rotation, replay rejection, profile access and logout; this test changes login-session records |
| Availability and booking | Earlier `test-guest-bookings.js` PASS | Live creation, concurrent overlap rejection, guest ownership, cancellation and restored date availability for that test |
| Payments and checkout | Booking #4: paid and complete checks PASS | Two saved payments totaling LKR 15,100, retained services, completed stay; historical evidence predates audit installation |
| Audited workflow | Booking #6: checkout PASS | Five paired operations, ten events, one service entry and two payments reconcile |
| Restricted runtime permissions | `check-runtime-user.js` PASS | `skynest_app@localhost`; exact grants, 17 empty reads, 5 empty locking reads, 7 permission denials |
| Workflow after account activation | Booking #7: audit checkout PASS | Four paired operations, eight events, one service entry and one payment reconcile under the reported runtime setup; no total amount was supplied |
| Manager dashboard | `test-dashboard.js` PASS after activation | Live response formats, totals of room counts, branch filters, authentication and invalid filters; not independent proof of payment history |
| Manager reports | `test-manager-reports.js` PASS for booking #4 | Five live reports, saved finalized totals counted once, tested filters and unchanged history for that dataset |
| Payment query | Read-only legacy/production comparison previously supplied | Result agreement and date-boundary checks; small-data plan observations are not a throughput benchmark |

The audit verifier checks saved workflow history. It does **not** query physical
room availability, inject a database failure, or prove rollback under a forced
audit-insert failure. Capture the room state separately in a live demonstration.
Retain raw outputs with their date and Git commit when available; this table is a
summary, not a replacement for those outputs.

## 4. Database design explanation

The schema contains these tables:

`BRANCH`, `ROOM_TYPE`, `AMENITY`, `ROOM_TYPE_AMENITY`, `ROOM`, `GUEST`,
`GUEST_ACCOUNT`, `STAFF`, `STAFF_ACCOUNT`, `SERVICE_CATALOGUE`, `BOOKING`,
`BOOKED_ROOMS`, `SERVICE_USAGE`, `BILL`, `PAYMENT`, `AUDIT_LOG`, `REFRESH_TOKEN`.

Useful examples to explain with the updated ERD:

| Design choice | Dependency / reason | Evidence |
| --- | --- | --- |
| Room types separate from physical rooms | `RoomTypeID` determines type name, capacity and current daily rate | `ROOM_TYPE`; rooms reference one type |
| Room numbers unique within a branch | `(BranchID, RoomNumber)` identifies a physical room | `uq_room_branch_number` |
| Amenities as a relation | A room type can have many amenities and an amenity can belong to many types | Composite PK of `ROOM_TYPE_AMENITY` |
| Booking header and room stays separate | Each booked-room row holds its room, dates and headcount | `BOOKED_ROOMS`, allowing multi-room API bookings |
| Service price snapshot | `PriceAtUsage` is the price of a historical usage event, not the current catalogue price | `SERVICE_USAGE` and service procedure |
| One bill per booking | `BookingID` identifies at most one bill | UNIQUE on `BILL.BookingID` |
| Exactly one audit actor | Staff or guest identity, matching actor type | Audit CHECK plus concrete booking/actor FKs |

Explain the intentional stored values and remaining design caveats:

- `BILL` keeps room/service totals and payment status. Room charges are captured
  at check-in and preserved during later recalculation; this is not a guaranteed
  per-room booking-time price snapshot. Controlled routines maintain the totals.
- `PAYMENT` contains both `BillID` and `BookingID`, even though the bill identifies
  its booking. The payment procedure keeps them consistent; the two independent
  foreign keys do not by themselves enforce that the pair matches. Document or
  review this redundancy before asserting full 3NF.
- Audit `TableAffected/RecordID` and refresh-token `UserType/UserID` are polymorphic
  references. They are not foreign keys to every possible referenced table.
- The schema contains 20 explicit foreign-key declarations and 8 CHECK clauses.
  These counts describe source definitions, not an independently inspected live
  metadata inventory or proof that every business rule is declarative.

Update the ERD to show the account extensions, multi-room bridge, refresh tokens
and audit relationships. Prepare functional dependencies and candidate keys for
each relation before presenting a formal normalization argument.

## 5. Methods and triggers to show

| Type | Objects | Demonstration purpose |
| --- | --- | --- |
| Calculation functions (4) | `fn_calculate_room_charges`, `fn_calculate_service_charges`, `fn_calculate_bill_total`, `fn_calculate_outstanding_balance` | Reusable calculations; distinguish live estimates from preserved bill totals |
| Procedures (7) | `sp_make_booking`, `sp_check_in`, `sp_recalculate_bill`, `sp_check_out`, `sp_log_service_usage`, `sp_process_payment`, `sp_update_booked_room` | Group related changes; entry procedures validate and own transactions; recalculation is an internal helper |
| Overlap triggers (2) | `trg_prevent_overlap_booking`, `trg_prevent_overlap_booking_update` | Reject overlapping active room reservations on insert/update; supported paths also acquire room locks |
| Workflow triggers (4) | `trg_room_status_sync`, `trg_prevent_checkout_with_due`, `trg_update_bill_status_after_payment`, `trg_validate_check_in_dates` | Room state, unpaid checkout guard, bill payment status and check-in date rules |
| Audit guards (2) | `trg_audit_log_no_update`, `trg_audit_log_no_delete` | Reject ordinary audit-row changes/deletion |

Audit pairs share `OperationID`, actor and transaction. Four workflows are covered:
check-in, service recording, payment and checkout. They are not a log of all SQL,
booking edits, catalogue changes or failed requests. A database administrator can
alter/drop objects; append-only triggers do not make history tamper-proof.

Detailed explanations and existing checks:
[audit trail](../backend/Database/AUDIT_TRAIL.md),
[query performance](../backend/Database/PERFORMANCE.md),
[database security](../backend/Database/DATABASE_SECURITY.md).

## 6. Remaining work in priority order

| Priority | Work | Current finding |
| --- | --- | --- |
| Next inspection | Demonstration data coverage | Run the new checker; fill only confirmed gaps |
| High: authorization | Branch-local front-desk access (SRS 3.3.7) | Staff tokens include `branchId`, but booking/billing/service access currently uses roles and optional filters, not enforced branch ownership. Restricted SQL grants do not solve this application policy gap |
| Required guest UI | Own itemized bill and in-stay service request (SRS 3.2.4–3.2.5) | APIs have ownership checks; live React routes currently expose these workflows to staff, not guests. Guest My Bookings offers cancellation only |
| Required management UI/API | Manage branches, rooms, types and services (SRS 3.2.9–3.2.10) | Creation/status and service-update APIs exist; management forms and general room/type/branch editing are incomplete |
| Reports | Complete report semantics from the brief | Occupancy is current room status, without selected historical date/period. Service usage groups by service with branch filtering, not per-room usage attribution. Multi-room service attribution needs an explicit design decision |
| Reports | Explain monthly accounting period | Current finalized-bill revenue is grouped by bill opening month, not checkout month or payment receipt month; dashboard cash receipts use payment dates |
| Team task list | Multi-room selection and booking editing | APIs exist; corresponding guest/staff forms are absent |
| Team task list | Staff management | Admin creation API exists; list/update/deactivate workflow and UI remain to be completed |
| Submission evidence | ERD, normalization, assumptions, demo outputs | Reconcile the documents with the implemented schema and observed results |

The earlier task list's labels such as "guest portal complete" and "manager
console complete" must not be used as proof of these missing current screens.

The SRS also mentions a 10% tax/service charge, late-checkout fees, refund/no-show
policies, payment-gateway authorization, notifications and deployment networking.
Those are not established by the supplied workflow results. Resolve them explicitly
in the final SRS/scope statement with the team/supervisor; do not silently claim
them implemented or rewrite existing bill history to fit an assumption. The current
payment UI records payments; it does not charge a card through a gateway.

## 7. Short demonstration rehearsal

Use a new fictional reservation with valid dates. Agree the presentation duration
with the team; the sequence below can be adapted to the allocated slot.

1. **Design:** Show the ERD and follow one booking through booked rooms, usage,
   bill and payments. Explain PK/FK relationships and historical service prices.
2. **Booking:** Search a branch, book an available room, show the reference and
   ownership boundary. Explain the previously verified overlap rejection; do not
   claim a new concurrency experiment unless one is actually performed.
3. **Stay:** As reception, check in; show both Checked-In booking and Occupied room.
   Log one service and show the saved price/quantity and increased bill.
4. **Payment:** Record a partial payment. Show the outstanding balance and one
   rejected checkout. Record the remaining amount, then check out; show Paid,
   zero outstanding and the room becoming Available.
5. **Audit:** Run the existing verifier for that completed reference. Explain the
   paired actor/time/before-after events and the boundary of what the test proves.
6. **Reports:** Show branch filters, finalized bill totals and service ranking.
   Explain current occupancy and the monthly-revenue period precisely.
7. **Advanced features:** Show the old/new payment date predicates, matching
   results and query plans, then exact runtime grants and permission denials.

For any new recorded payment, refresh and inspect the saved bill before repeating
an action after a timeout. Reuse existing evidence instead of repeating completed
financial actions merely to obtain another screenshot.

## 8. Evidence to retain for submission

- Current Git commit and dated data-count output.
- ERD and normalization/design notes, with deviations explained.
- Screenshots of booking, service, partial balance, paid checkout and room state.
- Audit reconciliation output for the demonstrated post-install booking.
- Exact production/legacy query comparison output with EXPLAIN; no unsupported
  speedup claims from a tiny sample.
- Runtime grant verification and relevant live workflow output.
- A list of mock/static tests versus actual MySQL/browser demonstrations.
- Remaining limitations and any agreed SRS amendments.

Do not include `.env` variants, raw tokens, password hashes, real guest identity
documents or personal contact details in the evidence bundle.
