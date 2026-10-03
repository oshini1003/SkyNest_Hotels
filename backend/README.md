# HRGSMS Backend

Node.js + Express REST API for SkyNest Hotels, backed by MySQL.

## Setup

Run these commands from the `backend` folder. Install dependencies with `npm ci`.
Copy `.env.example` to `.env` and set your local database credentials. Generate
two different random values for `JWT_SECRET` and `JWT_REFRESH_SECRET`, each at
least 32 characters. Keep the real `.env` private; it is ignored by Git.

For a **new, separate local integration database**, keep a name such as
`SkyNest_Integration_20261002`, then run:

```bash
node Database/setupIntegrationDb.js
npm run dev
```

The setup command refuses to touch an existing database. It loads `schema.sql`
and `seed.sql` into the configured integration database, ignoring their default
`SkyNest_Hotels` selection. It verifies 16 tables, 4 functions, 6 procedures and
4 triggers. An import failure leaves the new database intact for inspection;
do not rerun the seed on an existing database.

The sample booking starts tomorrow, avoiding expired fixed dates. Seed accounts
are for local coursework tests only; their credentials are documented in `seed.sql`.

`GET /api/health` checks the HTTP server. `GET /api/branches` also checks database
access and should return three seeded branches. The default CORS allowlist covers
frontend development on ports 5173/5174 and build preview on port 4173. Add your
exact frontend origin to `CORS_ORIGIN` if you use another port.

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
reservations are connected to the live API; staff workflows, services and billing
frontend integration remain later project stages.

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
token, never from a submitted `guestId`. Guests can list, view and cancel only
their own reservations. Foreign or missing booking details/cancellations return
404. Staff creation/cancellation is limited to Receptionist, Manager and Admin.

| Endpoint | Description |
|---|---|
| `GET /api/bookings` | List/search bookings (`?guestName=&idNumber=&status=&branchId=`). Guests only ever see their own. |
| `GET /api/bookings/:id` | Full booking detail incl. rooms |
| `POST /api/bookings` | Make a booking — `{ roomId, checkin, checkout, guestCount, paymentMethod }` |
| `PATCH /api/bookings/:id/cancel` | Cancel a Booked reservation |
| `POST /api/bookings/:id/check-in` | Front desk only |
| `POST /api/bookings/:id/check-out` | Front desk only |

Creation requires one room, positive integer guest count, valid date-only
`checkin`/`checkout`, and a payment preference of `Cash`, `Card` or `Bank Transfer`.
The existing `sp_make_booking` procedure locks the room and checks capacity and
overlap inside its own transaction. HTTP 201 returns `{ bookingId, status }`;
validation failures return 400 and unavailable/conflicting stays return 409.
Cancellation locks and checks the booking before changing a `Booked` reservation
to `Cancelled`. It preserves the record and releases those dates for room search.

List/detail responses include a `rooms` array. Each room includes date-only
`CheckInDate` and `CheckOutDate` strings for display without a browser timezone
shift, together with room, branch, room type and guest-count fields. Lists are
limited to the latest 200 matching reservations.

The frontend `/guest/bookings` page loads the signed-in guest's reservations.
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

## Services

| Endpoint | Method | Access |
|---|---|---|
| `GET /api/services` | Public | List active services |
| `POST /api/services` | Admin/Manager | Add a service |
| `PUT /api/services/:id` | Admin/Manager | Update/retire a service |
| `POST /api/service-usage` | Authenticated | Log usage — `{ bookingId, serviceId, quantity }` |
| `GET /api/service-usage/:bookingId` | Authenticated | List usage for a booking |

## Billing & payments

| Endpoint | Method | Access |
|---|---|---|
| `GET /api/bookings/:bookingId/bill` | Authenticated | Itemised live bill, payments, service usage |
| `POST /api/payments` | Front desk | Record a payment — `{ bookingId, amount, paymentMethod }` |

## Reports (Manager/Admin only)

| Endpoint | Description |
|---|---|
| `GET /api/reports/occupancy` | Occupied vs available rooms per branch |
| `GET /api/reports/billing-summary` | Itemised bills, `?outstandingOnly=true` to filter |
| `GET /api/reports/service-usage` | Quantity + revenue per service |
| `GET /api/reports/revenue` | Monthly revenue per branch (Checked-Out bookings) |
| `GET /api/reports/top-services` | Most-used services |

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
