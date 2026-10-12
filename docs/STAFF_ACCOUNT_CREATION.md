# Staff account creation — Part 3 frontend

Prepared on 10 October 2026 against the Part 4 tree committed as `15ce55f`.
Continue on `frontend/final-management-ui`. This change contains frontend code,
frontend tests and documentation only. Samalee's receptionist booking-creation
work remains separate.

## Available now

An administrator can open **Staff accounts** in the navigation, or **Create a
staff account** from the staff workspace. The page at `/staff/accounts` has:

- Staff name, optional email, role and branch assignment.
- Username, a new password and password confirmation.
- A review screen before the explicit **Create staff account** action.
- A saved receipt containing the new staff ID, name, role and username.
- Loading, unavailable, access-denied and interrupted-save states.

The existing backend permits **Admin** accounts to register staff. Managers,
including the usual `nimal` demo account, cannot use this action. The frontend
requires a branch for Receptionist and ServiceStaff because their operational
access is limited to an assigned branch. An Admin or Manager may be unassigned;
selecting a branch does not restrict their role to that branch.

The new page uses these existing endpoints:

| Purpose | Endpoint |
| --- | --- |
| Verify the current administrator | `GET /api/staff/scope` |
| Load and recheck branch choices | `GET /api/branches` |
| Create the staff profile and sign-in | `POST /api/auth/staff/register` |

Registration sends only `branchId`, `name`, `role`, `email`, `username` and
`password`. The backend creates the staff profile and login in one transaction.
The frontend keeps the administrator's session; it does not log in as the new
staff member. Branch and email are submitted values, not fields independently
reread in the registration receipt.

## Save handling

A per-administrator marker in this tab's sessionStorage blocks repeated
submissions, including reloads. It contains a username and, after a confirmed
save, the returned receipt. Passwords, password confirmation, tokens and email
are never copied into this marker. Passwords remain only in the form's memory
and the intended registration request; they are cleared after the save attempt.

A matching HTTP 201 receipt confirms creation. If recording that receipt in
browser storage fails, the page still shows the known success and retains it in
memory. Clearing a saved action must also verify that the browser record was
removed before another creation can begin.

Timeouts, interrupted responses, malformed success responses and server failures
can leave the result unknown. The page does not automatically resubmit. Since
there is no staff-directory endpoint, ask the system administrator to verify
whether that username was created and wait for the original request to finish.
Only a verified **not created** result permits clearing an unknown action.
Do not bypass the notice in another tab. The marker is a same-tab UI guard, not
server idempotency or a cross-tab lock.

## What this does not add

The inspected backend has no staff-list, staff-edit or staff-delete endpoint.
This page is account creation, not a complete staff directory. Those functions
need endpoints from the backend owner before their frontend can be implemented.

No backend, database schema, grants or credentials are changed. The registration
route enforces the Admin token role. Checking live scope before submission helps
normal UI use but cannot replace server authorization or eliminate a role-change
race at the endpoint. No booking audit events are claimed for staff creation.

## Checks

Run from the project root:

```powershell
node .\frontend\tests\staff-account-api-regression.mjs
node .\frontend\tests\page-loading-regression.mjs
```

The API regression uses actual Vite-loaded modules with mocked HTTP and storage.
The page-loading regression builds the production frontend and checks deferred
page assets. Neither creates live staff accounts or proves browser rendering.

A separate DOM-emulation check exercised the real React page and shared navigation
with mocked HTTP: Admin-only discoverability, receipt privacy until live scope
verification, review/back draft retention, rapid double clicks, saved reload,
password cleanup and interrupted-save recovery passed. This did not render CSS
or contact the live database; the local browser review below remains necessary.

For the local browser review:

1. Sign in using an existing **Admin** account. Open **Staff accounts**. Check
   that the branch choices match the local database.
2. Enter intended staff details, choose Review, then Back to details. Confirm
   the draft remains and the password is never printed on the review screen.
3. Try mismatched passwords and Receptionist/ServiceStaff without a branch.
   Review must remain blocked. No record is created by these checks.
4. If a new staff account is actually needed, review and confirm once. Keep its
   returned staff ID and username; the current Admin must remain signed in.
   Then sign out and use the new account to verify its role and branch access.
5. Sign in as a Manager or ordinary staff member. The creation link must be
   absent, and a direct visit to `/staff/accounts` must show access denied.
6. Visit the route while signed out; sign-in should return to it. Check keyboard
   navigation and a real 360–390px viewport, including long names and errors.

An uncertain result must be resolved before any further create attempt. Record
live results separately. Do not commit, push or merge until requested. Preserve
`tsauth-regression.cjs` and the current work branch.
