# Manager service catalogue

Prepared against main `e371a69` (8 October 2026).

## Scope

Managers and administrators can list active and retired services, add a service,
edit its name/description/current unit price, retire it and reactivate it.
The catalogue is shared by all branches. The page is `/staff/services`; the
ordinary public page remains `/services`.

The frontend uses the approved cream, deep-green and gold styling. The form
requires a review before saving. Saved prices use exact decimal strings.

No schema, trigger, stored-procedure, database-user or grant change is required.
The existing restricted runtime account already has the necessary catalogue
SELECT, INSERT and UPDATE privileges. Do not run a database setup/reset for this
feature.

## Backend changes

- `controllers/serviceCatalogueController.js` owns strict catalogue validation,
  current staff authorization and the read/write transactions.
- `controllers/serviceController.js` imports its three catalogue handlers;
  existing public catalogue and booking service-usage handlers are retained.
- `routes/serviceRoutes.js` adds the manager-only all-services GET route.
- `tests/service-catalogue-regression.cjs` checks real Express routing with mocked
  tokens and database fixtures.
- `test-service-catalogue.js` performs local live read checks and closes its test
  login sessions. It does not create, update or retire services.

| Endpoint | Access | Result |
| --- | --- | --- |
| `GET /api/services` | Public | Existing active-only list |
| `GET /api/management/services` | Manager/Admin | Active and retired service list |
| `POST /api/services` | Manager/Admin | Create active service, HTTP 201 |
| `PUT /api/services/:id` | Manager/Admin | Replace reviewed details/status, HTTP 200 |

POST requires exactly `serviceName`, `description` (string or null), and
`unitPrice` (a decimal string, 0.00 to 99999999.99). PUT requires those fields plus
`isActive` (boolean) and `expected` (the original `ServiceName`, `Description`,
`UnitPrice` and `IsActive` returned by the management GET). Names are 1-100
characters; descriptions are at most 255 characters; both are single-line text.
Successful writes return `{ saved: true, service: { ... } }`. This replaces the
older loose partial-update contract; the new frontend sends the complete body.

Writes recheck the staff role/branch/account under shared locks, then lock the
catalogue row and compare its original values before updating. A stale original
snapshot returns 409 and requires a new read. Parameters are bound; no user input
is inserted into SQL text. Each transaction commits before acknowledging success.
Unknown commit outcomes are not automatically retried. A connection cleanup
failure cannot replace an already-confirmed save acknowledgement.

## History and limits

- Existing SERVICE_USAGE prices and saved charges are not rewritten.
- Existing service names are joined from the current catalogue; renaming also
  changes the label shown beside historical usage. Create a new entry for a
  different offering instead of repurposing a used service.
- Retirement hides the service from active public lists. A usage request already
  being processed may finish using the values it read earlier.
- Catalogue edits are not added to the existing booking-workflow audit trail.
- Pending-action protection uses sessionStorage and is per tab. It is not a
  server idempotency key or a service-name uniqueness constraint. Do not assume
  that a timeout proves a save failed. Allow pending work to finish, reload and
  inspect before deciding whether a new submission is appropriate.

## Local verification

Run the backend and frontend normally. Sign in as a manager (for example nimal).
Open Catalogue from the staff navigation. Check a desktop-width and phone-width
window, keyboard focus, the search field and active/retired filters.

Use a new demonstration entry for mutation checks, not an existing billed service:

1. Add `Catalogue review demo`, description `Demonstration entry`, price `250.00`.
   Review the values and save once. Record its generated service reference.
2. Edit that entry to `275.00`, review and save. Reload and confirm the value.
3. Untick availability, review and confirm retirement. Reload the public services
   page and confirm the entry is absent; the manager retired filter still shows it.
4. Reactivate the same entry and confirm it returns to the public catalogue.
5. Retire the demonstration entry again when finished. Do not record it against
   a guest booking merely to test catalogue management.
6. Sign in as ordinary staff and open `/staff/services` directly. Management must
   be denied. Guest and anonymous access must also remain restricted.

For a live stale-edit check, open that demonstration service in two manager tabs.
Open both edit forms before saving. Save a change in the first tab. Saving the
older form in the second must produce a conflict and require a reload. This tests
one stale-edit scenario, not every possible concurrent database race.

For the read-only smoke check, configure TEST_API_URL, TEST_MANAGER_USERNAME,
TEST_MANAGER_PASSWORD, TEST_STAFF_USERNAME and TEST_STAFF_PASSWORD. The ordinary
staff account must be Receptionist or ServiceStaff. Run:

```powershell
node .\backend\test-service-catalogue.js
```

The smoke check compares public active services with the manager list, verifies
anonymous/ordinary-staff rejection and checks that rereading leaves the catalogue
unchanged. Keep the catalogue unchanged while it runs. It logs in and out only
its own sessions. It does not verify live mutations or browser appearance.

Automated regressions and the production-bundle check passed in the preparation
environment. Live MySQL and browser verification must be completed locally before
claiming those checks passed or merging this feature.
