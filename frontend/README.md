# SkyNest Hotels frontend

React, JavaScript and CSS, built with Vite. This client uses the Express API;
MySQL credentials and database connections belong in the backend only.

## Run locally

From this `frontend` directory:

```powershell
npm ci
npm run dev
```

Open the **Local** URL printed by Vite. It normally uses port 5173, but may choose
another port if that port is already in use. Run the backend in a separate terminal
using the instructions in `../backend/README.md`.

The API defaults to `http://localhost:5000/api`. For another API address, set
`VITE_API_URL` in a local frontend environment file, then restart Vite. Every
`VITE_` value is exposed to the browser; never put database passwords or JWT
signing secrets there. The backend must allow the frontend origin in its CORS
configuration.

## Build and preview

```powershell
npm run build
npm run preview
```

`dev` serves source code and updates the browser during editing. `build` produces
`dist`. `preview` serves that last build locally; rebuild before previewing new
changes. Neither command starts MySQL or the backend.

## Navigation and layout

- `src/components/SiteLayout.jsx` and its stylesheet own the shared header,
  navigation, footer and responsive menu. `App.jsx` keeps the existing routes and
  session handlers.
- Public pages show guest navigation. Guest and staff sessions remain independent,
  including when both are signed in in the same browser tab.
- `/staff` pages use the staff workspace header. Signed-in staff can navigate to
  bookings and their account. Manager/Admin accounts also see Dashboard and Reports. Backend
  authorization continues to enforce access; hiding a navigation link is not an
  authorization control.
- Staff sign-in has its own header context. Staff access remains in the public
  footer, and staff can return to the hotel website from the workspace.
- On narrow screens, **Menu** opens navigation. Choosing a destination or changing
  sessions closes it; Escape closes it and returns focus to the toggle. A skip
  link moves keyboard users to the main content.
- Fictional previews are grouped under **Development previews** in the footer
  during development. Preview routes and links are absent in production builds.
- `src/pages/StaffHome.jsx` and its stylesheet provide booking, dashboard and report shortcuts,
  the current staff identity, sign-out and the existing password-change form.
  They display no invented occupancy, revenue or booking counts.

The shared layout and staff account update changes frontend presentation only.
It adds no dependencies and requires no database migration or reset. Page-specific
forms, report filters, payment confirmations and API calls keep their existing
behaviour. Wide data tables remain horizontally scrollable inside their pages.

## Visual smoke check

After building successfully, inspect the site at desktop width and at roughly
375 px width (browser developer tools can simulate a phone):

1. Public Home, Rooms, guest sign-in and registration: header links, mobile menu,
   visible keyboard focus and footer staff access.
2. Staff sign-in and account: sign in as a receptionist, inspect the booking
   shortcut, expand/cancel the password form, then sign out.
3. Sign in as Manager: booking, dashboard and report shortcuts should appear. Visit
   the dashboard, reports and a booking detail/bill page; the existing controls and
   scrollable tables should remain usable.
4. Use keyboard Tab, Enter and Escape with the navigation. The closed mobile
   menu must not leave hidden links in the tab order.
5. Check `npm run preview` after building: development preview links should be
   absent. Use `npm run dev` again to continue editing.

Do not create another payment or check out a completed stay merely to inspect
its presentation. Use saved booking and bill details for the visual checks.

## Public hotel pages

Home, Branches, Rooms and Services use page-scoped styles and bundled illustrative
photographs. Image source paths and design references are documented in
`DESIGN_SOURCES.md`. No new packages or database migration are needed.

- Home loads real branch options. Its stay form validates dates/guest count and
  carries the selection to Rooms; it does not perform a reservation or an
  availability search automatically.
- Branches reads live names, locations and contact numbers from `/branches`.
  A branch's Find a room link preselects its real ID in the room-search form.
- Room search keeps existing live availability, selection/review and booking
  behaviour; Services keeps its live catalogue, prices and search.
- Guest login, registration and profile page files are reserved for Lakshan's
  separate UI work. This update does not alter those files.

Check Home → Rooms form prefilling, branch → Rooms prefilling, date validation,
search results, changing a filter, clearing a selection, and continuing to booking
review. Also check branch/catalogue loading, empty and error/retry states.

## Guest reservation pages

`src/pages/MakeBooking.jsx` and `MakeBooking.css` present the selected stay,
signed-in guest details, estimated room charge and preferred payment method.
The form creates a reservation only when Confirm booking is selected; it does
not charge a card or record a payment. Missing selections, availability errors,
unavailable rooms, saved reservations and uncertain results have their own views.

`src/pages/MyBookings.jsx` and `MyBookings.css` display saved reservations with
status, room details and dates. Search, status filters, clear and refresh controls
remain available. Each booking can display multiple rooms. Cancellation still
requires confirmation and is offered only for Booked reservations. If an outcome
cannot be confirmed, use Check current status before attempting another action.

Both stylesheets are scoped to their page root classes. They use the shared
green, cream and gold palette and responsive layouts. Guest account pages,
API services, session handling and database code are unchanged by this update.

Visual check with the backend running:

1. Sign in as a guest, search for a room, select it and continue to Booking Review.
   Check the selected branch, room, dates, guest count and estimated room charge.
2. Visit My bookings and inspect existing records; try search, status and clear.
3. On an existing Booked reservation, open Cancel booking, then choose Keep booking.
   Opening or dismissing the confirmation does not cancel the reservation.
4. Check both pages at desktop and phone widths. Review can be inspected without
   confirming a new booking, and existing records can be viewed without cancelling.

No database migration, dependency installation or additional payment is needed.

## Live management dashboard

`/staff/dashboard` presents the live hotel overview from `GET /api/dashboard/admin`.
Manager and Admin accounts see its Dashboard header link and Hotel overview card
on the staff account page. Receptionist and ServiceStaff accounts do not see those
links and cannot load the dashboard by entering its address. The backend also
enforces these roles. Signed-out visitors are sent to staff sign-in and return to
the dashboard after signing in with an authorized account.

The page starts with All branches. Select a branch in Viewing, or choose a branch
name in the room table, to load that branch's overview. Refresh overview reads a
new snapshot. Changing the selection hides the previous totals immediately;
superseded requests cannot replace the current selection or another account's
data. Loading, unavailable, access-restricted and retry states are shown explicitly.
When a selection has no rooms, occupancy is Not applicable rather than 0%; the API
represents that rate with `null`. A hotel without branches has an explicit empty
branch table state.

Read the figures as follows:

- The snapshot date comes from the database response, not the browser's local date.
- Payments received is the sum of recorded payments on that date, counted once
  per payment. It is not finalized bill revenue. All branches includes payments
  for mixed-branch and unassigned bookings; a branch selection includes only
  bookings assigned entirely to that branch. Those amounts are not split among
  branches.
- Scheduled arrivals and departures count reservations with those scheduled
  dates and show their current completion status. They are not counts of staff
  actions performed that day. Cancelled reservations are excluded.
- Active reservations includes Booked and Checked-In stays across all dates.
- Current occupancy uses saved room status: occupied rooms divided by all rooms,
  including maintenance rooms. It does not predict availability for future dates.

This frontend stage adds no dependencies and requires no backend changes,
database migration, setup or seed rerun. It uses the reviewed dashboard endpoint
already in the backend. Guest account pages and their authentication forms are
unchanged.

From the repository root, run the focused client checks and build:

```powershell
node .\frontend\tests\dashboard-api-regression.mjs
npm --prefix frontend run build
```

The regression script uses mocked requests and sessions. It checks response
validation, amount/date formatting, role and session handling, branch filters,
timeouts and stale responses; it does not verify live MySQL totals or browser
layout.

Manual checks with the backend and frontend running:

1. Sign in as Manager or Admin. Open Dashboard from the staff header or Hotel
   overview from the staff account page. Confirm the date, payment count and room
   totals load.
2. Switch branches using the selector and table links, then return to All
   branches. Refresh the overview. Old totals should disappear while loading.
3. Open Manager reports and Booking workspace from the dashboard shortcuts.
   Inspect saved records without creating payments or changing booking status.
4. Sign out and open `/staff/dashboard`; sign-in should be required. Sign in as
   Receptionist or ServiceStaff and confirm a direct visit shows restricted access.
5. Stop the backend temporarily and refresh the dashboard. Check the error and
   retry controls, then restart the backend and retry. Do not reset the database.
6. Inspect desktop and phone widths, keyboard focus, branch selection, horizontal
   table scrolling and the mobile navigation menu. If an existing branch has no
   rooms, confirm occupancy shows Not applicable; do not delete rooms to test it.

## Guest account integration review (6 October 2026)

The themed guest login, registration and profile pages use the existing live
account services. Sign-in accepts the backend **username**, calls
`/auth/guest/login`, and saves only the returned session through App's callback.
Registration sends full name, contact number, NIC/passport, username and password;
email and address remain optional. Letters are rejected for contact numbers and
submission validates 7–15 digits after removing spaces/hyphens, with optional +.
No account is created by a success alert alone.

The account page reads `/guests/me` and saves editable name, contact number,
email and address using PUT. It displays the saved username and identity number
without offering unsupported edits. Backend errors are displayed, pending actions
are disabled, and success is shown only after a successful server response.
Password changes use `/auth/guest/password`; success clears the matching guest
session and asks the user to sign in with the new password. A late response from
an older password request must not clear a newer sign-in.

`/guest` remains the protected account page; `/guest/profile` is an alias through
that route. Login and registration each have one route. Existing selected-stay
state is preserved when switching between the two forms and after successful
sign-in or registration. Staff and guest sessions remain independent.

### Local checks

```powershell
node .\frontend\tests\account-session-regression.mjs
npm --prefix frontend run build
```

The service regression uses the actual Vite-loaded password/session modules with
mocked network responses. It does not connect to MySQL or prove persistence in
your local database. Confirm the UI and saved results using the steps below.

With the backend and frontend running, verify against your integration database:

1. Open `/guest/profile` while signed out: it should lead to sign-in. Sign in with
   an existing guest's **username**, not a demonstration email/password pair.
2. Check that the account shows that guest's saved details. Change an ordinary
   profile field, save, then reload to confirm persistence. Restore it if desired.
3. On registration, letters in the phone field must be rejected. Check password
   confirmation and required username/NIC fields. Creating an account is a real
   database write; use a new test username/identity if testing successful signup.
4. Select a room, continue to sign-in, switch to registration and back: the selected
   stay should remain available when sign-in completes. Do not create a booking
   merely to test this navigation.
5. If testing password changes, use a test account whose credentials you control.
   A mismatched confirmation must be rejected before a request. A wrong current
   password must show the server error. A successful change requires signing in
   again with the new password; never post real passwords in screenshots or logs.

No database installation, reseeding or reset is part of this interface repair.

## Staff branch access update

The staff booking list resolves `/api/staff/scope` before every search.
Receptionist/ServiceStaff see their assigned branch as a fixed field; clearing
filters cannot expand access. Manager/Admin retain the branch selector. The server
independently enforces the policy on booking, bill, service and room-status actions.
Guest ownership and the established visual theme remain unchanged.

Apply the matching backend migration before using this frontend with the updated
server: [staff branch installation and checks](../backend/Database/STAFF_BRANCH_ACCESS.md).
The frontend client regression is
`node frontend/tests/staff-branch-api-regression.mjs` from the repository root.
It loads the actual module through Vite with mocked fetch; it is not a browser or
live MySQL test.

## Guest bill and service history

Each card in **My bookings** links to `/guest/bookings/:id/bill`. Guests can
review a saved bill's room-charge total, itemized services at their recorded
prices, saved payments and remaining balance. Payment classifications describe
individual saved entries; the bill status describes the current whole bill.
Hotel date/time strings are displayed without conversion to the browser's zone.

The page makes one authenticated GET to `/api/bookings/:id/bill` per load or
refresh. That endpoint already reads a consistent database snapshot and checks
guest ownership. The page does not create services, payments, bookings or
checkout actions. It does not invent historical room-by-room prices from the
current catalogue. A reservation without a saved bill is labelled **estimate**;
a cancelled reservation without a bill does not show an estimated balance due.

Loading or refreshing clears the preceding view. Switching booking references or
guest sessions remounts the view, and stale responses cannot display another
session's data or clear a newer sign-in. Direct bill links return to their own
canonical local route after sign-in, including a switch between login and
registration. Malformed/external return destinations are not accepted.

Local checks from the repository root:

```powershell
node .\frontend\tests\guest-billing-api-regression.mjs
node .\backend\tests\guest-bill-smoke-regression.cjs
npm --prefix frontend run build
```

The client suite loads actual modules through Vite with mocked HTTP. The smoke
checker regression uses independent fixtures; neither connects to live MySQL.
See [guest bill verification](../docs/GUEST_BILL_VERIFICATION.md) for the browser
and live ownership checks. No database migration or new privileges are required.
