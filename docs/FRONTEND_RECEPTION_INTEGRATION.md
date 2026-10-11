# Receptionist booking frontend integration

## Scope and starting point

Frontend integration prepared against `frontend/final-management-ui` at
`f094ec5` (staff account creation). It combines the management frontend with
Samalee's guest selection, room selection and staff booking review from the
uploaded main snapshot `c7230d3`.

No backend, SQL, database setup, grants or stored routines are changed. This
patch does not commit, push or merge anything. It does not include the separate
service-photo patch, which can be applied independently.

## Pages and navigation

| Address | Purpose |
| --- | --- |
| `/staff/rooms` | Existing manager room inventory |
| `/staff/bookings/new` | Find an existing guest or register a walk-in guest |
| `/staff/bookings/rooms` | Select rooms and dates for that guest |
| `/staff/make-booking` | Review and confirm the staff-created booking |
| `/rooms` | Existing public guest room search |

Receptionists, managers and administrators can start from **Create a booking**
on the staff home or reservations page. Service staff cannot open the creation
flow. A fresh server scope is checked before guest searches, creation, room
searches and booking confirmation. The server remains responsible for final
identity, role, branch and booking validation.

Receptionists see their assigned branch. Clearing filters retains that branch,
and a new search checks the current assignment again. Managers and administrators
can choose branches. Public `/rooms` ignores staff guest details inserted into
navigation state. Signing in again restarts guest selection without carrying a
guest's personal details through the sign-in return state.

## Guest creation and recovery

The new-guest form requires name, contact number and NIC/passport. NIC/passport
is limited to 30 characters, matching the inspected table. Email and address
are optional. A walk-in guest record does not create an online login account.

Before a POST, the client records a pending attempt for that staff account in
session storage. The UI and API each prevent overlapping submissions. After a
confirmed save, a receipt offers **Continue booking**; returning to the page
restores it after access is verified. Recovery records contain only pending
status or the saved guest ID, name and contact number. NIC, email, address and
unsaved drafts are not persisted by this feature.

A timeout, lost connection or uncertain response keeps the attempt pending.
Search for the guest before starting a new request. Clear a pending attempt only
after the original request has finished and an operator confirms no guest was
created. The browser cannot prove a server-side rollback. No automatic write
retry is made. A known save remains acknowledged even if storing its receipt
fails; a reload may then show the more cautious pending state.

Room availability and current staff scope are checked again before booking
submission. A definite conflict offers **Choose rooms again**. An uncertain
booking result leads to the reservations list for reconciliation. A history
marker blocks repeat submission from the same review page after reload/back;
it is not server-side idempotency or a cross-device duplicate guarantee.

## Backend prerequisite for live checks

The inspected `f094ec5` backend does not contain Samalee's staff guest search and
creation endpoints. The uploaded newer main snapshot does contain them:

- `GET /api/guests?q=...`
- `POST /api/guests`

It also supplies the existing staff-scope, room and booking endpoints used by
this flow. Applying this frontend patch alone does not install or update these
backend routes. Build and mocked tests can pass while the old live backend
returns 404. Complete the separately approved backend integration with its owner
before the live walkthrough. Do not run database setup or replace SQL files to
solve a missing API route. Backend changes require separate review/approval.

## Automated verification

From the repository root:

```powershell
node .\frontend\tests\staff-guest-booking-api-regression.mjs
node .\frontend\tests\multi-room-booking-regression.mjs
node .\frontend\tests\staff-branch-api-regression.mjs
node .\frontend\tests\page-loading-regression.mjs
```

The last command performs a production build and page-module checks. The others
exercise actual Vite-loaded clients with mocked HTTP/storage. They do not contact
MySQL, create guests or make bookings.

## Live walkthrough after backend integration

1. Sign in as a receptionist. Open Create a booking, find an existing guest,
   and confirm the room search is limited to the assigned branch.
2. Clear filters, search again, select rooms and review the dates, guest counts,
   price estimate and payment preference. Confirm once and inspect the resulting
   reservation. No payment should be recorded by booking creation itself.
3. Register a deliberately chosen demo walk-in guest. Verify the required
   NIC/passport and 30-character limit; continue from the saved receipt without
   creating the guest again. This step intentionally writes demo data.
4. As manager/admin, confirm all permitted branches are available. Check that
   Property > Rooms still opens inventory and staff account creation still works.
5. As service staff or while signed out, verify the booking-creation route is
   blocked. Verify public guest single/multi-room booking still follows the guest
   sign-in and review flow.
6. Check phone/desktop layouts, back/refresh, loading/error states and session
   expiry. Use a controlled test environment for connection-loss checks; never
   repeat an uncertain save without checking the stored result.

Build success and DOM emulation are not evidence of real browser layout, live
write permissions, successful payments or database race/rollback behavior.
