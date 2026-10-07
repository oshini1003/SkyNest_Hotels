# HRGSMS Backend

Node.js + Express REST API for SkyNest Hotels, backed by MySQL.

## Setup

Run these commands from the `backend` folder. Install dependencies with `npm ci`.
Copy `.env.example` to `.env` and set your local database credentials explicitly.
The application pool no longer defaults to root when `DB_USER` is missing. Generate
two different random values for `JWT_SECRET` and `JWT_REFRESH_SECRET`, each at
least 32 characters. Keep the real `.env` private; it is ignored by Git.

For a **new, separate local integration database**, use your maintenance/root
credentials temporarily for installation (the example names the eventual runtime
account), keep a name such as
`SkyNest_Integration_20261002`, then run:

```bash
node Database/setupIntegrationDb.js
npm run dev
```

The setup command refuses to touch an existing database. It loads `schema.sql`
and `seed.sql` into the configured integration database, ignoring their default
`SkyNest_Hotels` selection. It verifies 17 tables, 4 functions, 7 procedures and
8 triggers. An import failure leaves the new database intact for inspection.
`schema.sql` and `setupIntegrationDb.js` are for new databases only. Do not rerun
setup or seeds on an existing database; use the specific update command below.

The sample booking starts tomorrow, avoiding expired fixed dates. Seed accounts
are for local coursework tests only; their credentials are documented in `seed.sql`.

`GET /api/health` checks the HTTP server. `GET /api/branches` also checks database
access and should return three seeded branches. The default CORS allowlist covers
frontend development on ports 5173/5174 and build preview on port 4173. Add your
exact frontend origin to `CORS_ORIGIN` if you use another port.

## Restricted application database account

The one-time local setup and evidence commands are documented in
[`Database/DATABASE_SECURITY.md`](Database/DATABASE_SECURITY.md).
`setupRuntimeUser.js --backend-stopped` creates `skynest_app@localhost` with exact
per-table, column and routine privileges, prepares ignored `.env.runtime` and
`.env.maintenance` files, and verifies the candidate without replacing `.env`.
Existing root credentials, stored definitions and hotel rows are preserved.

After activation, use the separate maintenance wrapper for future reviewed
installations; do not change the running application's `.env` back to root.
Existing routine installers deliberately refuse unsafe replacement when grants
would be lost. New migrations must explicitly preserve the runtime EXECUTE grants.
Do not rerun database setup, seed data or earlier migrations merely to switch users.

Local checks: `node tests/runtime-policy-regression.cjs` and
`node tests/runtime-setup-regression.cjs`. They use mocks; run
`node check-runtime-user.js --candidate` for actual MySQL privilege verification
before activating the candidate. Guest/staff login, token rotation and business
workflow smoke checks remain separate from grant verification.

## Grading data and demonstration evidence

See [the project grading checklist](../docs/GRADING_READINESS.md) for the
rubric mapping, verified evidence, database design notes and remaining SRS gaps.
From the repository root, run:

```powershell
node .\backend\tests\grading-data-regression.cjs
node .\backend\check-grading-data.js
```

The first command uses mock responses. The second requires local MySQL and the
activated runtime configuration in `backend/.env`; it reads aggregate counts in
one read-only snapshot. Exit 0 means the checked data thresholds are met, exit 2
means the inspection succeeded but data coverage needs attention, and exit 1
means the inspection failed. It does not install objects or create sample data.
Keep the existing database; do not rerun its setup/seed scripts to fill gaps.

For the confirmed catalogue shortfall, see
[demonstration data completion](../docs/DEMO_DATA_COMPLETION.md).
`node backend/add-grading-catalogue.js` from the repository root shows a read-only
plan; `--apply` inserts only missing matching demo rooms/services in a transaction.
It uses the restricted runtime account, skips existing matches and stops on
conflicts. Guest registration, bookings, service usage and payments remain UI
steps so their actual validation and audit workflows are exercised.

## Authentication

Access JWTs authorize requests; rotating refresh tokens are recorded as SHA-256
digests in `REFRESH_TOKEN`. Access and refresh tokens have separate secrets and
purposes. Send the **access token** as:

```
Authorization: Bearer <token>
```

The frontend currently asks users to sign in again when their access token
expires. Automatic refresh is not implemented. Sign-out revokes its refresh token
when the backend is reachable and clears the browser session immediately. Password
changes revoke all refresh tokens for that account. Already issued access tokens
remain valid until their short expiry.

For local regression checks without MySQL, run `node tests/auth-regression.cjs`.
After starting the backend against the integration database, set
`TEST_GUEST_USERNAME` and `TEST_GUEST_PASSWORD` in your terminal and run
`node test-tokens.js` to test login, token-purpose checks, rotation, replay rejection
and logout. The test exits unsuccessfully if any assertion fails and prints no tokens.

Lakshan's billing/payment/report layouts are labelled development previews under
`/preview/staff/...`. Payment simulation does not save or collect money. Guest
reservations and staff booking search/details/check-in are connected to the live
API. The public service catalogue and staff service recording/history/bill totals
also use the live API. Staff bill history, payment recording and checkout are
connected at `/staff/bookings/:id/bill`. Manager/Admin reports are live at
`/staff/reports`. The development preview pages remain separate.

| Endpoint | Method | Access | Description |
|---|---|---|---|
| `/api/auth/guest/register` | POST | Public | Create a guest account, returns access + refresh token |
| `/api/auth/guest/login` | POST | Public | Guest login, returns access + refresh token |
| `/api/auth/staff/login` | POST | Public | Staff login, returns access + refresh token |
| `/api/auth/staff/register` | POST | Admin only | Create a new staff account |
| `/api/auth/guest/password` | PUT | Guest | Change guest password |
| `/api/auth/staff/password` | PUT | Staff | Change staff password |
| `/api/auth/refresh` | POST | Public | Exchange refresh token for new access + rotated refresh token |
| `/api/auth/logout` | POST | Public | Revoke refresh token |

## Branches / room types / amenities / rooms

| Endpoint | Method | Access | Description |
|---|---|---|---|
| `/api/branches` | GET | Public | List branches |
| `/api/branches` | POST | Admin/Manager | Create a branch |
| `/api/room-types` | GET | Public | List room types (with amenities) |
| `/api/room-types` | POST | Admin/Manager | Create a room type |
| `/api/amenities` | GET | Public | List amenities |
| `/api/amenities` | POST | Admin/Manager | Create an amenity |
| `/api/rooms` | GET | Public | Search rooms by optional `roomId`, `branchId`, `roomTypeId`, `guestCount`, `checkin` and `checkout` |
| `/api/rooms` | POST | Admin/Manager | Create a room |
| `/api/rooms/:id/status` | PATCH | Admin/Manager/Receptionist | Update room status |

For an availability search, supply both dates in `YYYY-MM-DD` format. Check-in
must be today or later in the backend server's local time; check-out must be
later than check-in. IDs and guest count must be positive whole numbers. Omit
unused filters instead of sending empty values. Invalid filters return HTTP 400.

```text
GET /api/rooms?branchId=1&guestCount=2&checkin=2026-10-04&checkout=2026-10-06
```

Use future dates when running the example later. Results exclude maintenance
rooms, rooms below the requested capacity, and rooms with overlapping `Booked`
or `Checked-In` reservations. One stay can begin at another stay's checkout.
A currently occupied room can appear for a non-overlapping future stay. Without
dates, this endpoint lists matching rooms but does not establish availability.

The frontend `/rooms` page reads live options and availability from these public
endpoints. `/make-booking` rechecks the selected room and price, asks the guest to
sign in, and creates a reservation only after confirmation. Changing a search
filter clears previous results and the selected stay. API failures show an error
and retry action rather than sample rooms.

Run `node tests/room-search-regression.cjs` from `backend` for validation and
controller contract checks with a mocked database pool. Then check the running
frontend against MySQL: capacity and branch filters, an overlapping seeded stay,
an adjacent stay, selection clearing, preview navigation and API outage/retry.
These changes need no schema import or seed rerun on an existing database.

## Bookings

All require authentication. A guest's identity comes from the verified access
token, never from a submitted `guestId`. Guests can list, view, edit and cancel
only their own reservations. Foreign or missing booking lookups return 404.
Staff creation, editing and cancellation are limited to Receptionist, Manager
and Admin.

| Endpoint | Description |
|---|---|
| `GET /api/bookings` | List/search bookings (`?bookingId=&guestName=&idNumber=&status=&branchId=`). Guests only ever see their own. |
| `GET /api/bookings/:id` | Full booking detail incl. rooms |
| `POST /api/bookings` | Make a booking — `{ roomId, checkin, checkout, guestCount, paymentMethod }` or several rooms at once with `{ rooms: [{ roomId, guestCount }], checkin, checkout, paymentMethod }` |
| `PATCH /api/bookings/:id/cancel` | Cancel a Booked reservation |
| `POST /api/bookings/:id/check-in` | Front desk only |
| `POST /api/bookings/:id/check-out` | Front desk only |
| `PATCH /api/bookings/:id` | Change room, dates or guest count of one room entry on a Booked reservation - `{ bookedRoomId?, roomId?, checkin?, checkout?, guestCount? }` | 

Single-room creation requires one room, positive integer guest count, valid date-only
`checkin`/`checkout`, and a payment preference of `Cash`, `Card` or `Bank Transfer`.
The existing `sp_make_booking` procedure locks the room and checks capacity and
overlap inside its own transaction. HTTP 201 returns `{ bookingId, status }`;
validation failures return 400 and unavailable/conflicting stays return 409.

The API also accepts 1–10 distinct rooms in one booking, with a positive guest
count for each room and shared arrival/departure dates. Room locks are acquired
in RoomID order; all room entries are committed together or rolled back together.
A preferred payment method does not create a payment.

Booking edits affect one room entry on a `Booked` reservation. Supply
`bookedRoomId` when the booking has several rooms. Omitted fields remain unchanged:
for a partial date edit, the procedure combines the supplied date with the current
stored date after acquiring the booking lock, then rechecks the resulting stay.
This prevents an omitted date from overwriting a concurrent edit. Checked-In,
Checked-Out and Cancelled reservations cannot be edited through this endpoint.

Cancellation locks and checks the booking before changing a `Booked` reservation
to `Cancelled`. It preserves the record and releases those dates for room search.

List/detail responses include a `rooms` array. Each room includes date-only
`CheckInDate` and `CheckOutDate` strings for display without a browser timezone
shift, together with room, branch, room type and guest-count fields. Lists are
limited to the latest 200 matching reservations.

The current frontend still creates one room per booking and remains compatible
with this API. Multi-room selection and booking-edit forms are not implemented
in the frontend yet; these are currently backend capabilities. The
`/guest/bookings` page loads the signed-in guest's reservations and displays every
room in a saved multi-room booking.

Sign-in or registration preserves the selected stay for review; it never submits
a booking automatically. The booking account supplies the guest identity. The
confirmation page records a payment preference only: no card details are taken,
and no bill or payment is created before the later staff workflow. Lost creation
responses must be checked in My bookings before another attempt. Sample booking
pages remain separate under `/preview/...` during development.

### Booking checks

From `backend`, run these database-free regression checks:

```bash
node tests/booking-regression.cjs
node tests/booking-change-regression.cjs
node tests/service-ownership-regression.cjs
```

With the local backend running against the integration database, set
`TEST_GUEST_USERNAME`, `TEST_GUEST_PASSWORD`, `TEST_OTHER_GUEST_USERNAME` and
`TEST_OTHER_GUEST_PASSWORD` to two different test guests. Then run:

```bash
node test-guest-bookings.js
```

This live API test chooses a room for a future stay, submits concurrent booking
attempts, verifies overlap rejection, ownership, dates, lists, service access,
absence of payment, cancellation and restored availability. It cancels only
reservations created by that run, leaving their history as `Cancelled`. If a
creation response is lost or cleanup cannot be confirmed, inspect My bookings
before repeating the test. Test sessions are signed out afterwards. No schema
import, database reset or seed rerun is required for this update.

### Staff search and check-in

Sign in through `/staff/login`, then open `/staff/bookings` from the staff home.
The list searches the live API by exact booking reference, guest name, identity
number, branch and status. Open `/staff/bookings/:id` for the guest and room
details. Staff return destinations after login are restricted to these local
routes. Sample staff pages remain separate under `/preview/staff/...`.

Receptionist, Manager and Admin accounts can confirm check-in. ServiceStaff can
view these booking pages but cannot check in a guest. The backend enforces the
role independently of the page controls. Booking detail responses include
`GuestIDNumber`, `GuestEmail`, each room's `RoomStatus`, and
`checkInEligibility: { allowed, reason, today }`.

Eligibility uses MySQL's current date: the booking must be `Booked`, have at least
one room, and every room's stay must include today (arrival inclusive, departure
exclusive). Every room must currently be `Available`. The check-in endpoint
rechecks these conditions before calling `sp_check_in`. The procedure locks the
booking, and `trg_validate_check_in_dates` rechecks all room dates using current
locking reads before its status changes. This also protects against an edit
between the API precheck and check-in. The existing room-status trigger checks
room availability. Status changes and the new `Unpaid` bill commit together;
no payment is recorded. Existing databases must install the date guard using
`addBookingUpdate.js` before enabling booking edits.

If the browser loses a check-in response, reload the booking status before
attempting another action. Do not automatically repeat the POST.

Run `node tests/staff-booking-regression.cjs` for database-free controller checks.
For the local MySQL check, first create a new guest reservation starting today
and ending tomorrow, then check it in through the staff page. Set
`TEST_STAFF_USERNAME`, `TEST_STAFF_PASSWORD`, and `TEST_STAFF_BOOKING_ID` (the new
reference, digits only), then run:

```bash
node test-staff-checkin.js
```

This signs in a test staff session and reads the booking, room status and bill.
It checks `Checked-In`, `Occupied`, correct room charges, an `Unpaid` bill and no
service charges/payments. It does not create, cancel, pay or check out the stay.
Keep this reservation checked in for the services and billing stage. As with
other checks, remove the temporary test credentials from your shell afterwards.

## Services

| Endpoint | Access | Description |
|---|---|---|
| `GET /api/services` | Public | List active services |
| `POST /api/services` | Admin/Manager | Add a service |
| `PUT /api/services/:id` | Admin/Manager | Update/retire a service |
| `POST /api/service-usage` | Authenticated | Log usage — `{ bookingId, serviceId, quantity }` |
| `GET /api/service-usage/:bookingId` | Authenticated | List usage for a booking |

### Live catalogue and staff service entry

The public `/services` page lists active database services with a name/description
search. It displays no sample fallback when the API is unavailable. The database
has no service category or separate unit field; the description supplies any
relevant unit information (for example, Laundry is per load).

Open a staff booking and follow its services link to
`/staff/bookings/:id/services`. Admin, Manager, Receptionist and ServiceStaff
accounts can record services against a `Checked-In` reservation. Other booking
statuses have history access only. Entries belong to the whole booking; a room
selection would not be persisted by the existing schema, so the form shows room
context without assigning the charge to a particular room.

Choose an active service and a positive whole-number quantity, review the entry,
then explicitly confirm saving it. The API validates booking/service IDs and
quantity as positive signed SQL INT values before querying. Existing guest API
access remains limited to that guest's own booking; missing and foreign booking
lookups return the same 404 response. The procedure checks the current booking
status and active service, captures `PriceAtUsage`, inserts the entry and
recalculates the bill in one transaction. Its booking lock serializes this with
payment and checkout operations. The controller does not wrap the procedure in
another transaction. Quantities whose charges exceed the database's monetary
capacity are rejected and the transaction is rolled back.

The review uses the currently displayed catalogue price; the saved history uses
the price captured when the database records the entry. History includes
`LineTotal` and a `UsageDateDisplay` string in the database server's local time.
The bill endpoint reads booking access, bill, payments and service rows on one
read-only consistent snapshot, so the page's history and totals describe the
same committed state.

The form blocks repeated clicks while saving and never automatically retries a
POST. If the response is lost or uncertain, refresh the history and bill and
reconcile the attempted service before deliberately recording another entry.
An immediate empty history does not prove a still-running request failed. There
is no server idempotency key in this schema, so submitting the same service again
is a separate charge. Do not blindly repeat it after a timeout.

Run these database-free checks from the repository root:

```bash
node backend/tests/service-usage-regression.cjs
node backend/tests/service-ownership-regression.cjs
node backend/tests/bill-read-regression.cjs
```

For the live integration scenario, keep the one-night Colombo Double reservation
checked in with its LKR 12,000 room charge and no payments. Using a staff account
(for example the seeded ServiceStaff account `sunil` / `staff123`), record exactly
one Laundry entry with quantity 2 at LKR 800, then one Room Service entry with
quantity 1 at LKR 1,500. Expect LKR 3,100 service charges and LKR 15,100 unpaid.

Set `TEST_API_URL`, `TEST_STAFF_USERNAME`, `TEST_STAFF_PASSWORD`, and
`TEST_STAFF_BOOKING_ID`, then run `node backend/test-service-usage.js` from the
repository root. This test only reads the booking, usage history and bill apart
from its own login/logout. It checks both saved entries, their captured prices,
stored bill totals, unpaid balance and occupied room status. Re-running this
verification does not add charges. Keep the stay checked in for the payment and
checkout stage and remove temporary credential environment variables afterwards.
No database migration, reset or seed rerun is needed for this update.

## Billing & payments

| Endpoint | Access | Description |
|---|---|---|
| `GET /api/bookings/:bookingId/bill` | Authenticated | Itemised live bill, payments, service usage |
| `POST /api/payments` | Front desk | Record a payment — `{ bookingId, amount, paymentMethod }` |

### Live staff bill, payments and checkout

Open a live staff booking and choose its bill link. All staff roles can read the
itemised bill, saved service prices and payment history. Only Receptionist,
Manager and Admin accounts can record payments or check out a guest. Both the
page and backend enforce this role restriction. A guest's existing bill API
access remains restricted to that guest's own bookings.

Payment recording is a hotel ledger operation for money already received; it
does not charge a card or connect to a payment gateway. Enter a positive decimal
amount with at most two decimal places, choose Cash, Card or Bank Transfer,
review it and confirm. The API passes an exact two-decimal string to MySQL and
rejects invalid IDs, amounts, methods and identities before executing a payment.
The procedure locks the booking and bill, requires `Checked-In`, prevents an
overpayment and inserts the payment together with its bill-status update.
The database assigns `Partial` or `Full` according to the balance at that time;
the final instalment is `Full` even if earlier partial payments exist.

The bill response includes `bookingStatus`, `paidAmount` and payment timestamps
as `PaymentDateDisplay` strings in the database server's local time. Booking
status, charges, payments and service history come from one consistent read-only
snapshot. The page refreshes this snapshot and room details after each action.

Checkout requires a checked-in stay with an open, fully settled bill. The page
asks for confirmation; `sp_check_out` and the booking trigger enforce the rule
again under a transaction. A successful checkout records the staff identity,
sets the stay to `Checked-Out` and releases its occupied rooms. Existing payment
and service rows remain available. The reserved stay dates and number of nights
charged are unchanged by checkout.

Payment and checkout do not automatically retry. If the procedure reports
success but a subsequent response read fails, the API still acknowledges the
committed action with `refreshRequired: true` and a nullable balance/bill. The
page blocks further actions until fresh data is loaded. A timeout, lost response
or unknown server failure instead requires refreshing and reconciling the
attempt with hotel records before deliberately continuing. An immediate empty
history does not prove that an in-flight payment failed. This schema has no
payment idempotency key; repeating a POST could record a second payment. A
pending-action marker survives navigation and reload in the same browser tab,
scoped to the staff account and booking. It contains no password or access token.
It is cleared only after a known result or deliberate reconciliation.

### Update an existing integration database

An opened bill preserves the room charge calculated at check-in. Later service
entries and checkout recalculate saved service charges and payment status without
repricing the room from the current room-type catalogue. This prevents a later
rate change from altering a bill that has already been paid.

For the existing `SkyNest_Integration_20261002` database, stop the backend dev
server, then run this command from the repository root:

```bash
node backend/Database/updateBillingRoutine.js --backend-stopped
```

This replaces only `sp_recalculate_bill`; it does not reset the database, rerun
seeds, or change existing table rows. It validates the database/routine before
changing anything, backs up the previous routine to a temporary file, and
attempts to restore it if replacement fails. Keep the printed backup location
until the update is verified. Run it while no other application uses this local
database because routine replacement uses DDL, not a rollbackable transaction.
The command is safe to rerun after a successful update. Fresh databases receive
the same definition from `schema.sql` automatically. Restart the backend after
the command succeeds.

### Add booking-update objects to an existing integration database

For an existing database, do **not** rerun `setupIntegrationDb.js`, `schema.sql`
or the seed. The booking update installer targets only
`SkyNest_Integration_20261002`, which must be the exact configured `DB_NAME`.
Stop the backend and any other application using this database, then run from
the repository root:

```bash
node backend/Database/addBookingUpdate.js --backend-stopped
```

The flag acknowledges that the backend is stopped; it does not stop it for you.
The installer verifies existing definitions before creating missing objects in
this order:

1. `trg_validate_check_in_dates` — prevents check-in outside any room's stay dates.
2. `trg_prevent_overlap_booking_update` — checks overlap on a room/date edit.
3. `sp_update_booked_room` — edits one room entry on a Booked reservation.

It verifies every created definition, accepts Windows database-name casing under
the server's identifier rules, and uses an advisory lock to prevent concurrent
installer runs. It never drops or replaces existing objects, resets the database,
reruns seeds, or changes booking, bill, service or payment rows. Existing recorded
room charges and payments are preserved. A different existing definition causes
it to stop; keep the backend stopped and inspect the output after any failure.
Restart the backend only after all three objects are verified. Fresh databases
receive the same definitions through the normal new-database setup.

From the repository root, check the installer and SQL structure without MySQL:

```bash
node backend/tests/booking-update-install-regression.cjs
```

This test uses mocked database responses and static SQL checks. It does not prove
that the objects have been installed or exercised on a live MySQL server.

### Payment and checkout checks

Run the focused checks from the repository root:

```bash
node backend/tests/payment-regression.cjs
node backend/tests/checkout-regression.cjs
node backend/tests/bill-read-regression.cjs
node backend/tests/billing-routine-regression.cjs
npm --prefix frontend run build
```

These regressions mock MySQL; the following local scenario verifies real saved
data. Continue the existing checked-in Colombo Double stay with LKR 12,000 room
charges, Laundry quantity 2 at LKR 800, Room Service quantity 1 at LKR 1,500, and
no payments. Use the front-desk test account `amali` / `staff123`. Set
`TEST_API_URL`, `TEST_STAFF_USERNAME`, `TEST_STAFF_PASSWORD` and
`TEST_STAFF_BOOKING_ID`, then run each phase at its corresponding stage:

```bash
node backend/test-payment-checkout.js unpaid --check-unpaid-guard
# Through the live page, record LKR 5000.00 Cash once.
node backend/test-payment-checkout.js partial --check-unpaid-guard
# Through the live page, record the remaining LKR 10100.00 Cash once.
node backend/test-payment-checkout.js paid
# Through the live page, confirm checkout once.
node backend/test-payment-checkout.js complete
```

The phase checks only read reservation/bill/history data apart from their own
login/logout. The explicit `--check-unpaid-guard` option also attempts checkout,
expects rejection with HTTP 409, and verifies the reservation and bill remain
unchanged. It never records a payment. Stop if any assertion fails; inspect the
current history before repeating any action. The completed scenario has two
payment entries totalling LKR 15,100, a `Paid` bill with zero outstanding, two
unchanged service entries, a `Checked-Out` stay and an `Available` room. Remove
temporary test credentials from the shell afterwards.

## Reports (Manager/Admin only)

Open **Staff account → Manager reports** after signing in as Manager or Admin.
The five existing report endpoints now supply the live frontend at `/staff/reports`.
Receptionist, ServiceStaff and guest accounts cannot access these reports. The
fictional report layout remains at `/preview/staff/manager-reports` in development.

| Endpoint | Meaning | Optional filters |
|---|---|---|
| `GET /api/reports/occupancy` | Current room status counts, including branches with no rooms | `branchId` |
| `GET /api/reports/billing-summary` | One row per saved bill with total, paid and outstanding amounts | `branchId`, `outstandingOnly=true` or `false` |
| `GET /api/reports/service-usage` | Saved service entry counts, quantity and charges at recorded prices | `branchId` |
| `GET /api/reports/revenue` | Finalized bills grouped by branch and **bill-opened month** | `branchId`, `year`, `month` |
| `GET /api/reports/top-services` | Services ranked by number of usage entries | `branchId`, `limit` (default 5, maximum 50) |

All endpoints return arrays, including an empty array when no records match.
Unknown or malformed filters return 400 before SQL. Numeric query filters are
canonical positive decimal integers (no spaces, fractions, leading zeros or
arrays). `branchId` is at most 2147483647; `year` is 1000–9999; `month` is 1–12
and requires `year`. `limit` is 1–50. Query values are bound parameters.

Report definitions matter when demonstrating the database:

- Occupancy is the current `ROOM.RoomStatus`, not future reservation availability
  or historical occupancy. The displayed rate is occupied / total rooms, including
  maintenance rooms in the denominator. A zero-room branch has no occupancy rate.
- Billing includes saved bills only; a reservation without a bill is not an
  unpaid bill. Outstanding means saved total minus saved payments, greater than
  zero. The report does not calculate charges again from today's room prices.
- Service charges use `SERVICE_USAGE.Quantity * PriceAtUsage`, including services
  that are no longer active in the current catalogue. These are recorded charges,
  not cash collected. Top services ranks by usage entries, then quantity, then
  ServiceID to resolve ties consistently.
- `/revenue` retains its existing URL but is labelled **Finalized bill totals**.
  It includes only `Checked-Out` bookings and uses stored bill amounts.
  `BILL.GeneratedDate` is when the bill was opened at check-in. It is not an actual
  checkout timestamp or a payment date; those meanings must not be inferred.
- Each booking is mapped to its branch once before aggregation. Several booked
  rooms in one branch do not multiply bill or service amounts. The schema allows
  bookings across branches but does not store an allocation of their bill charges.
  Such bills are counted once under **Multiple branches** in all-branch reports;
  bookings without rooms use **Unassigned branch**. Selecting a specific branch
  excludes both groups. No arbitrary allocation or current-price weighting is used.
- Money is aggregated as database decimals and returned as decimal strings to
  avoid losing precision through automatic conversion of large SQL sums.
  Occupancy/count fields remain numbers. The frontend rejects invalid/inconsistent
  report responses and shows an error rather than invented zero totals.

Billing rows include `BillID`, `BookingID`, `GuestName`, `BookingStatus`,
`BillStatus`, `GeneratedDateDisplay`, `RoomCharges`, `ServiceCharges`,
`TotalAmount`, `PaidAmount`, `OutstandingBalance`, and branch attribution fields.
Billing/revenue attribution fields are `BranchID` (null when unallocated),
`BranchName`, and `BranchScope` (`single`, `multiple`, or `unassigned`). Revenue
rows add `Month` (`YYYY-MM`), `BillCount`, `RoomRevenue`, `ServiceRevenue` and
`TotalRevenue`. Service/top-service rows include `ServiceID`, `ServiceName`,
`TimesUsed`, `TotalQuantity` and `TotalRevenue`.

Reports are read-only. Each GET reads the current database; separate reports are
not one shared transaction snapshot. Keep data unchanged during cross-report
verification. Changing a frontend filter clears the previous result and cancels
pending loads. Loading failures never fall back to sample data. The only month/year
filters appear on the finalized-bill report. These coursework endpoints return
all matching groups/bills; pagination would be needed for a larger production dataset.

### Verification

No schema migration, routine update, reset or reseeding is needed for this stage.
From the repository root, run:

```powershell
node .\backend\tests\report-regression.cjs
npm --prefix frontend run build
```

The regression script uses a mock database and checks report access, strict
filters, bound SQL parameters and aggregation contracts. It does not verify a
running MySQL installation. With the backend running against the existing local
integration database, set `TEST_API_URL`, `TEST_STAFF_USERNAME` and
`TEST_STAFF_PASSWORD` to a Manager/Admin test account (for example seeded `nimal`)
and `TEST_STAFF_BOOKING_ID` to the completed guided booking (`4`), then run:

```powershell
node .\backend\test-manager-reports.js
```

This checks all five real report queries, authentication, branch/month/outstanding
filters, ranking, and report totals against the saved billing rows. The guided
booking should still show LKR 12000 room charges + 3100 services = 15100 total,
15100 paid, zero outstanding, two services and two payments. Other bookings are
allowed; hotel-wide totals need not equal this one bill. The script only reads
hotel records and creates/revokes its own login session. It never adds another
payment, checks out a stay, or changes hotel rows. Remove the temporary test
credentials from your shell afterwards.

## Dashboard (Admin/Manager only)

| Endpoint | Method | Access | Description | Optional filters |
|---|---|---|---|---|
| `/api/dashboard/admin` (or `/dashboard/admin`) | GET | Admin/Manager | Current room status, scheduled arrival/departure cohorts, cash received today and active bookings | `?branchId=` |

Both aliases require an authenticated Manager or Admin. The only accepted query
key is `branchId`: a canonical positive decimal integer no greater than
2147483647. Arrays, leading zeros, spaces, fractions, extra characters and unknown
query keys return 400 before database access. A valid but nonexistent branch ID
returns an empty summary (zero counts and payments, null occupancy rate).

The response is an **object**, not a report array: `date`, `branchId`, `summary`,
and, for an all-branch request, `branchBreakdown`. `branchId` is `"all"` or the
selected numeric ID. Counts are nonnegative safe integers. Invalid database
counts or amounts cause an error; they are not silently converted to zero.

Dashboard definitions:

- `date` is the database's current date, captured once and bound to every dated
  query. It is not the JavaScript server's UTC date. The whole response reads one
  read-only repeatable-read snapshot, so its parts describe the same saved state.
- `todayCheckIns` and `todayCheckOuts` count distinct non-cancelled reservations
  with a room scheduled to arrive or depart on that database date. The completed
  fields describe the current status of those same scheduled cohorts: arrivals
  are completed for `Checked-In` **or** `Checked-Out` reservations; departures
  are completed for `Checked-Out` reservations. They are not counts of actual
  events performed today: the schema has no actual check-in/checkout timestamp.
  A multi-branch reservation can belong to more than one branch's stay cohort;
  all-branch counts still count that reservation only once.
- `todayRevenue` retains its API field name but means **cash received today**,
  from saved `PAYMENT.Amount` values and `PaymentDate`. It is an exact decimal
  string, such as `"15100.00"`; `todayPaymentsCount` counts saved payment entries.
  This differs from the existing finalized-bill revenue report. Each payment is
  counted once regardless of room count. Specific-branch cash totals include only
  bookings wholly assigned to that branch. Mixed-branch and unassigned bookings
  remain included once in chain-wide cash totals, without inventing an allocation.
  Payments use an inclusive start-of-day and exclusive next-day bound on
  `PaymentDate`, allowing the existing `idx_payment_date` index to be considered.
  Both bounds use the same captured database date, including at midnight.
- Occupancy is current occupied rooms divided by all rooms, including maintenance
  rooms. `currentOccupancyPercentage` (and each breakdown `occupancyPercentage`)
  is null when there are no rooms. Room counts come from current `ROOM` statuses;
  they do not describe availability for a future stay. The chain-wide breakdown
  includes zero-room branches and is ordered by BranchID.
- `activeBookings` counts distinct reservations currently `Booked` or
  `Checked-In`. A selected branch includes reservations with any room assigned
  there; the chain-wide count includes each reservation once.

No dashboard request creates or changes reservations, bills, service entries,
payments or room statuses. No database schema installation is needed for this
endpoint. The frontend manager dashboard consumes this endpoint.

From the repository root:

```bash
node backend/tests/dashboard-regression.cjs
```

The regression uses mock connections and independent fixtures/static query checks;
it does not verify live MySQL execution. With the backend running, the optional
`node backend/test-dashboard.js` check uses `TEST_API_URL`,
`TEST_STAFF_USERNAME` and `TEST_STAFF_PASSWORD` for a Manager or Admin. It checks
the live API contract and room/occupancy consistency, including branch filters.
Authentication creates/revokes only its own test session; it does not change hotel
booking, billing or payment rows. This smoke check is not an independent audit of
cash totals or proof of database concurrency behavior.

### Payment query performance evidence

From the repository root, after configuring `backend/.env` for the integration
DB, run the regression and read-only comparison:

```bash
node backend/tests/dashboard-regression.cjs
node backend/tests/payment-query-evidence-regression.cjs
node backend/check-dashboard-payment-query.js --date 2026-10-06
```

Omit `--date` to inspect the current database day. The checker runs directly
against MySQL; the API need not be running. It compares legacy and production
query results and prints both `EXPLAIN` plans for all branches and each branch,
using one read-only snapshot. Calendar-boundary fixtures execute as `SELECT`
expressions without inserting sample data. It reads `backend/.env` explicitly,
so it can run from the root or backend directory. No migration, index creation,
authentication session, or hotel-data write is performed.

See [Database/PERFORMANCE.md](Database/PERFORMANCE.md) for recorded preliminary
measurements, interpretation, index choices and presentation evidence. An index
plan is not a measured timing improvement; the optimizer may choose another plan
as the dataset changes. This patch makes no database permission changes.

## Project layout

```
backend/
├── config/db.js         MySQL connection pool
├── middleware/auth.js   JWT verification + role guards
├── controllers/         Route handlers (one per resource)
├── routes/              Express routers
├── utils/asyncHandler.js
└── server.js            App entry point
```


## Audit trail (migration 002)

Successful check-in, service recording, payments and checkout now write paired actor-attributed audit records and bill snapshots in the same transaction. See [Database/AUDIT_TRAIL.md](Database/AUDIT_TRAIL.md) for the ERD relationships, event coverage, installation and limitations. Past rows are not backfilled.

API request/response shapes remain unchanged. The server passes the authenticated actor to SQL:

- `sp_check_in(bookingId, staffId)`
- `sp_check_out(bookingId, staffId)`
- `sp_process_payment(bookingId, exactAmount, paymentMethod, staffId)`
- `sp_log_service_usage(bookingId, serviceId, quantity, staffIdOrNull, guestIdOrNull)`

Use the new controllers and database procedures together. The internal `sp_recalculate_bill(bookingId)` helper retains its signature and saved-room-charge behavior.

From the repository root, run:

```powershell
node .\backend\tests\audit-regression.cjs
node .\backend\tests\audit-install-regression.cjs
node .\backend\tests\staff-booking-regression.cjs
node .\backend\tests\service-usage-regression.cjs
node .\backend\tests\payment-regression.cjs
node .\backend\tests\checkout-regression.cjs
node .\backend\tests\bill-read-regression.cjs
npm --prefix frontend run build
```

Stop the backend before updating the existing local integration database:

```powershell
node .\backend\Database\addAuditLog.js --backend-stopped
```

Keep the backend stopped if installation fails, and retain the external backup path printed by the installer. Do not reset the database or manually run the original forwarded `002_add_audit_log.sql`.

After installation succeeds, start the backend and use a new booking to verify each workflow stage through the existing pages. The following command inspects the saved result only:

```powershell
$env:TEST_AUDIT_BOOKING_ID = Read-Host "Enter the new audited booking reference"
node .\backend\test-audit-log.js checkin
```

Run `service`, `payment` and `checkout` in place of `checkin` after completing those actions. The optional `TEST_AUDIT_EXPECTED_ACTOR_TYPE` (`staff` or `guest`) and `TEST_AUDIT_EXPECTED_ACTOR_ID` check the actor of the latest operation for that stage. No API test password is required; the verifier reads the existing backend MySQL configuration and prints no credentials.
