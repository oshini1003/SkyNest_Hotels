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
  bookings and their account. Manager/Admin accounts also see Reports. Backend
  authorization continues to enforce access; hiding a navigation link is not an
  authorization control.
- Staff sign-in has its own header context. Staff access remains in the public
  footer, and staff can return to the hotel website from the workspace.
- On narrow screens, **Menu** opens navigation. Choosing a destination or changing
  sessions closes it; Escape closes it and returns focus to the toggle. A skip
  link moves keyboard users to the main content.
- Fictional previews are grouped under **Development previews** in the footer
  during development. Preview routes and links are absent in production builds.
- `src/pages/StaffHome.jsx` and its stylesheet provide booking/report shortcuts,
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
3. Sign in as Manager: both booking and report shortcuts should appear. Visit
   reports and a booking detail/bill page; the existing controls and scrollable
   tables should remain usable.
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
