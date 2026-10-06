# Audit trail: migration 002

The hotel workflow records successful check-in, service usage, payment and checkout actions with their authenticated actor and relevant before/after values. This implements the audit work discussed in SRS 3.3.7 and the project task list. The SQL file originally forwarded by Oshini was used as a starting requirement; this implementation preserves the current booking locks, date checks, billing snapshots and payment validation.

## Data model and ERD update

Add `AUDIT_LOG` to the project ERD with these relationships:

| Parent | Foreign key in AUDIT_LOG | Relationship |
| --- | --- | --- |
| BOOKING | BookingID | Each audit row belongs to one booking; a booking has zero or many audit rows. |
| STAFF | StaffID | A staff member has zero or many audit rows; a row has at most one staff actor. |
| GUEST | GuestID | A guest has zero or many audit rows; a row has at most one guest actor. |

`ActorType` and a CHECK constraint require exactly one actor: either StaffID or GuestID. Both IDs cannot be supplied together and neither can be omitted. These foreign keys retain actor and booking references; they do not cascade-delete audit history.

`AuditID` is the primary key. `OperationID` groups the two records produced by one successful workflow action. `Action`, `TableAffected` and `RecordID` identify the event and affected row. `OldValues` and `NewValues` store JSON snapshots. Insertion events have SQL NULL for OldValues. Monetary snapshot values are decimal strings, preserving exact cents when JSON is read by JavaScript. `CreatedAt` is a database-generated timestamp with microsecond precision in the database session timezone, not a user-supplied timestamp or a claim about UTC.

`TableAffected`/`RecordID` are a polymorphic reference, not a foreign key to multiple tables. Procedures select or create the referenced row inside the same transaction. The concrete BookingID foreign key supports the booking history relationship. Indexes support booking/time history, staff/time review, and operation grouping.

## Events covered

| Workflow | Primary event | Paired bill event |
| --- | --- | --- |
| Check-in | Check-In: BOOKING status changes | BillOpened: initial recorded room/service charges and total |
| Service usage | ServiceUsageRecorded: SERVICE_USAGE with saved quantity and price | BillRecalculated: bill before and after the charge |
| Payment | PaymentProcessed: PAYMENT with saved amount, method and bill | BillPaymentApplied: bill before and after payment status changes |
| Checkout | Check-Out: BOOKING status changes | BillFinalized: bill values and finalizing staff |

Each pair has one OperationID and the same actor. Check-in, payment and checkout require an existing Admin, Manager or Receptionist. Service recording also accepts ServiceStaff; self-service requests record the actual guest and recheck booking ownership under the booking lock. Browser-supplied actor IDs do not determine attribution: the controller passes the authenticated token identity. Database users allowed to CALL these procedures remain trusted to supply that identity; database privileges are a separate security boundary.

The four procedures own their transactions. Audit inserts occur before COMMIT; an audit insert error rolls back the corresponding booking, bill, service or payment action. Failed operations do not leave a success audit row. Payment CALLs are never automatically retried after an uncertain connection failure; refresh/reconcile the saved bill first. These are business audit records, not a failed-login or failed-request security log.

Bill recalculation remains an internal helper with the same signature. Its callers capture and audit the old/new bill snapshots while holding the booking/bill locks. Standalone administrative calls to this helper are outside audited application workflows.

## History protection and limits

`trg_audit_log_no_update` and `trg_audit_log_no_delete` reject ordinary UPDATE and DELETE of audit rows. The original six booking/billing triggers remain. These guards are not tamper-proof protection against a database administrator: privileged users can alter/drop objects or bypass row triggers using DDL such as TRUNCATE. Use a reviewed least-privilege application account in the later security stage.

This stage does not automatically audit arbitrary direct SQL changes, booking creation/cancellation/date edits, catalogue edits, authentication events, or transactions that happened before installation. It does not add a public audit endpoint. Do not invent staff names, event times or historical snapshots for old transactions. Old completed booking #4 is retained as existing history, not rewritten as a new audited stay. No passwords, tokens, identity-document numbers, contact details or card numbers belong in audit snapshots.

## Installation on the existing local database

1. Apply the complete patch to the reviewed main source. The controllers and procedure signatures change together.
2. Stop all backend processes using this database (Ctrl+C in the backend terminal). Keep them stopped until the installer reports success.
3. Run the regression checks and frontend build described in `../README.md`.
4. Run `node backend/Database/addAuditLog.js --backend-stopped` from the repository root.
5. Restart the backend only after successful verification.

The installer targets only `SkyNest_Integration_20261002`, respects Windows database-name case rules, verifies existing object definitions and creates an external backup before replacing procedures. It does not reset/reseed the database, change past hotel rows or create historical audit entries. Routine DDL is not one rollback-able transaction, so an interrupted installation requires inspecting the output and keeping the backend stopped. Never run the old forwarded migration directly, and do not rerun `setupIntegrationDb.js` on this existing database.

The numbered SQL files are installer inputs/review snapshots. Use the installer for the existing database rather than executing the files manually. Fresh databases use the updated `schema.sql`: 17 tables, 4 functions, 7 procedures and 8 triggers.

### Resuming after the Windows MySQL CHECK metadata mismatch

MySQL 9.7.1 on the tested Windows installation returned the actor CHECK literals as `_utf8mb4\'staff\'` and `_utf8mb4\'guest\'` in `INFORMATION_SCHEMA.CHECK_CONSTRAINTS`. The initial installer rejected that representation after creating the audit table, before creating its guards or replacing any procedures. The corrected comparison accepts only those two escaped, introduced literals and still verifies the complete actor-rule expression, table structure and existing object definitions.

After applying the metadata fix, keep the backend stopped and rerun the installer. It verifies and reuses the existing table, installs missing guards, and replaces only recognized previous procedure definitions. It does not drop/recreate the table or write hotel/audit rows. Preserve the original backup. If verification still stops, keep the backend stopped and inspect the reported reason; do not bypass its checks. The regression fixture `tests/fixtures/audit-table-mysql97-windows.json` records the actual table metadata and exercises this partial-install state using a mock connection.

## Demonstration and evidence

Use a new post-install reservation with valid dates for the database's current date. Note the booking reference and the staff accounts used. Through the existing pages, check in, record a service, make payments and check out only when the bill is settled. Record an action once, then inspect it; the verifier does not create or repeat actions.

Set `TEST_AUDIT_BOOKING_ID` and run `node backend/test-audit-log.js checkin`, then `service`, `payment`, and `checkout` at the corresponding stages. The verifier uses a read-only database snapshot. It checks operation pairs, actors, reference IDs and historical snapshots against the saved workflow data. The optional expected actor variables can confirm the latest selected action was performed by a particular staff member or guest.

Show the assessor an operation's actor/time, primary event and paired bill snapshot. Explain the foreign keys/CHECK constraint, why money is stored exactly, why audit and business updates commit together, and the limits of protection against privileged administrators. Mock/static regression checks and read-only live verification do not independently prove database rollback under injected failures; retain that distinction in the report.

## MySQL reference

- [Statements that cause an implicit commit](https://dev.mysql.com/doc/refman/9.7/en/implicit-commit.html)
- [Trigger syntax and error behavior](https://dev.mysql.com/doc/refman/9.7/en/trigger-syntax.html)
- [JSON data type](https://dev.mysql.com/doc/refman/9.7/en/json.html)
