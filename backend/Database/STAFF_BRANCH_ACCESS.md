# Staff branch access

Prepared against the team's `main` commit `bb41f35` on 7 October 2026.
This change implements the branch-local front-desk rule in SRS section 3.3.7.
Installation and live verification on the Windows integration database are still
required; local tests use mocked MySQL connections and static SQL checks.

## Access policy

| Account | Booking, bill and service history | Supported operational actions |
| --- | --- | --- |
| Guest | Own bookings only | Existing self-service booking, edit, cancellation and service-request permissions |
| Receptionist | Reservations whose rooms all belong to the assigned branch | Existing booking, check-in, services, payment, checkout and room-status permissions within that branch |
| ServiceStaff | Reservations whose rooms all belong to the assigned branch | Service recording; no new check-in, payment or cancellation permission |
| Manager / Admin | Existing access across branches | Existing operational permissions across branches; dashboard and reports remain manager/admin only |

ServiceStaff follows the same branch boundary as Receptionist. Manager/Admin
operational access is preserved from the existing application. This is the
project's operational policy; it does not grant new staff-management features.

Branch membership comes from `STAFF.BranchID` and each booked room's physical
`ROOM.BranchID`. It does not come from `BOOKING.StaffID`, a request body, a browser
profile or a selected filter. A restricted staff member can access a reservation
only if it has at least one room and **every** room belongs to their branch.
Mixed-branch, empty or orphaned reservations require Manager/Admin access.

## API and page behavior

`GET /api/staff/scope` returns the authenticated staff account's current scope:

```json
{ "staffId": 3, "role": "Receptionist", "branchId": 1, "branchName": "SkyNest Colombo" }
```

Protected booking, billing and service routes validate the current staff account,
role and assignment against the access token. Missing accounts or changed claims
return 401 and require sign-in again. Restricted accounts without a valid branch
return 403. Dashboard/report routes also verify current staff identity before
reading report data. This is not a claim that every unrelated authentication or
administration endpoint has gained immediate token revocation.

Foreign and missing booking detail, bill and service-history requests return the
same `404 { "error": "Booking not found." }`. Lists contain authorized bookings
only. Asking for another branch does not broaden access. Direct foreign room-status
changes return a generic room-not-found response.

The staff booking search resolves scope before loading results. Receptionist and
ServiceStaff see a fixed assigned-branch field. Clearing filters retains this
boundary. Manager/Admin retain the branch selector. Existing layouts, colors and
guest booking ownership remain in place.

## Transaction boundaries

Staff multi-query booking and service-history reads use a read-only repeatable-read
snapshot, as bill reads already did. A concurrent room edit cannot make an
authorization check and its response refer to different committed room assignments.

Six existing entry procedures recheck permitted staff roles and branch membership
under locks before writes. Existing transactions, audit pairs and saved monetary
history are retained. `sp_update_booked_room` now has a seventh, final
`p_staff_id` argument; the API sends the authenticated staff ID or null for an
already ownership-checked guest. Other procedure signatures do not change.

Multi-room creation validates current staff assignment and locks/authorizes every
selected room before inserting the booking. Staff cancellation locks and authorizes
the booking in a transaction, then performs a conditional status update. The update
itself must not read `ROOM`: its room-state trigger writes that table. Guest
cancellation retains its conditional ownership/status update. Room-status changes
also recheck access under locks.

SQL scope denials use `45003` (generic not found) and `45004` (forbidden).
Known committed payment/checkout acknowledgements remain successful even if a
later response read fails. The API does not retry those monetary actions.

These checks assume room branch assignments are changed only through stopped
maintenance: the runtime account has no `UPDATE ROOM.BranchID` privilege. Existing
booking edits serialize through the booking lock. No new privilege or hotel table
is introduced. Direct privileged SQL remains an administrative capability, not a
replacement for authenticated API authorization.

## Install on the existing integration database

1. Stop every backend using this database with Ctrl+C. Keep schema/privilege edits
   stopped too. Apply the matching patch and run its regression checks.
2. From the repository root run:

   ```powershell
   node .\backend\Database\runMaintenance.js installStaffBranchAccess.js --backend-stopped
   if ($LASTEXITCODE -ne 0) { throw "Keep the backend stopped and send the installer output." }
   node .\backend\check-runtime-user.js
   if ($LASTEXITCODE -ne 0) { throw "Keep the backend stopped and send the runtime check output." }
   ```

3. Only after both succeed, restart the matching backend:

   ```powershell
   npm --prefix backend run dev
   ```

The runtime check includes nine empty locking reads, covering the new staff,
booking, room and booked-room query shapes. These verify SQL permissions without
changing hotel rows; they do not prove the live mutation or concurrency workflows.

The installer reads ignored `backend/.env.maintenance` explicitly. It does not
copy administrative credentials into runtime `.env`. It accepts only the reviewed
local integration database and maintenance identity. It checks all six old/current
definitions, creation contexts, definers and routine grants before replacement,
and writes an external backup named `original-procedures-and-grants.json`.

Routine replacement is not one rollbackable transaction. The installer restores
and verifies the exact prior routine grants, including `skynest_app` EXECUTE access,
and handles only known old/current definitions. Its output gives the backup path.
No hotel records, audit records or stored totals are added, reset or backfilled.

If installation fails or is interrupted, keep the backend stopped and retain the
output and backup. Some procedures may already be current. A recognized old/current
mix can be resumed after inspection; missing/unknown definitions or unexplained
grants need recovery using the backup. Do not blindly retry DDL or delete routines.
The flag is an operator assertion; the script does not prove all backends are stopped.

Use this migration for the existing database, not `setupIntegrationDb.js` or the
older audit/booking installers. Audit migration 002 is pinned to its historical SQL
and rejects later branch definitions. Do not restart older backend code against
the changed booking-edit signature. Fresh installations use the updated schema.

MySQL references: [locking reads](https://dev.mysql.com/doc/refman/9.7/en/innodb-locking-reads.html),
[routine privileges](https://dev.mysql.com/doc/refman/9.7/en/stored-routines-privileges.html),
[DROP PROCEDURE](https://dev.mysql.com/doc/refman/9.7/en/drop-procedure.html) and
[stored program restrictions](https://dev.mysql.com/doc/refman/9.7/en/stored-program-restrictions.html).

## Live read-only hotel checks

The supplied history identifies booking 8 in Colombo and booking 12 in Kandy.
Keep those existing reservations unchanged during the check. With backend/MySQL
running, use a separate PowerShell terminal from the repository root:

```powershell
& {
    try {
        $env:TEST_API_URL = "http://localhost:5000/api"
        $env:TEST_STAFF_USERNAME = "amali"
        $env:TEST_STAFF_PASSWORD = "staff123"
        $env:TEST_MANAGER_USERNAME = "nimal"
        $env:TEST_MANAGER_PASSWORD = "staff123"
        $env:TEST_STAFF_OWN_BOOKING_ID = "8"
        $env:TEST_STAFF_OTHER_BOOKING_ID = "12"
        node .\backend\test-staff-branch-access.js
        if ($LASTEXITCODE -ne 0) { throw "Branch access check failed. Send the output." }
    }
    finally {
        Remove-Item Env:TEST_API_URL, Env:TEST_STAFF_USERNAME, Env:TEST_STAFF_PASSWORD, `
            Env:TEST_MANAGER_USERNAME, Env:TEST_MANAGER_PASSWORD, `
            Env:TEST_STAFF_OWN_BOOKING_ID, Env:TEST_STAFF_OTHER_BOOKING_ID `
            -ErrorAction SilentlyContinue
    }
}
```

Use current test passwords if the seeded ones were changed. The checker performs
GETs for hotel data: own/foreign list, filters, detail, bill, services, manager access
and unchanged saved responses. It creates/revokes its own login sessions and prints
no guest details or tokens. It does **not** exercise live mutations or concurrent
races, and cannot establish those guarantees by itself.

In the browser, sign in as Amali: booking search should show Colombo as fixed,
booking 8 should open, and booking 12 should be unavailable. As Nimal, the branch
selector and both bookings remain available. Keep booking 8's partial payment and
active stay for the next guest bill interface stage.

New mocked/static coverage: `staff-scope-regression.cjs`,
`staff-branch-install-regression.cjs`, `staff-branch-smoke-regression.cjs`, and
frontend `staff-branch-api-regression.mjs`. Existing workflow suites retain their
ownership, transaction, decimal, history and uncertain-result checks. Record live
installer, permission and API outputs separately; a mocked PASS is not live MySQL
proof of locking or rollback behavior.
