# Property management: branches and room types

Prepared against main `f9ff7d2` on 9 October 2026. This is the first of the four
remaining frontend batches. No backend or database files are changed.

## Included

Managers and administrators can open **Property** in the staff navigation, or
**Hotel branches** / **Room types** from their account workspace.

| Page | Existing API | Available actions |
| --- | --- | --- |
| `/staff/branches` | `GET /api/branches`, `POST /api/branches` | Search, view and add branches |
| `/staff/room-types` | `GET /api/room-types`, `POST /api/room-types` | Search, view and add types with existing amenities |
| Amenity choices | `GET /api/amenities` | Read existing choices only |

The pages use the approved cream, deep-green and gold design. Each form has a
review step before its single create request. Existing entries cannot be edited
or deleted here: those branch/type endpoints do not exist. Individual rooms and
amenity creation belong to Part 2; staff management belongs to Part 3.

New branch fields use the existing column lengths: name 100, location 150 and
contact number 20 characters. The contact form accepts 7-15 digits, optional
leading +, spaces, parentheses and hyphens. This format is a frontend rule;
existing contact text is preserved when displaying the list.

New room types accept names up to 100 characters and LKR rates from 0.00 to
99999999.99 with at most two decimal places. Money is normalized as decimal
strings. The creation form allows 1-100 guests to keep the existing booking
guest-count selectors usable. This is an application limit, not the database INT
limit; existing valid larger capacities remain readable. Selected amenities are
checked against a fresh amenity list before submitting.

## Save handling and limits

- A verified catalogue is required before reviewing a create. The client checks
  the current `/api/staff/scope` response before reading or writing, and rejects
  expired, changed or non-management sessions.
- Requests are not automatically retried or redirected. A per-staff, per-kind
  record in sessionStorage prevents another create in the same tab while an
  earlier result needs checking, including after reload.
- A matching HTTP 201 response confirms creation. If the subsequent list refresh
  or storage update fails, the interface keeps the confirmation and asks for a
  new read. Normal saves clear their action record only when a fresh GET matches
  the returned reference and submitted details, including selected amenities.
  Room-type acknowledgements contain no amenity list; displayed rows always
  come from the catalogue GET. A mismatch keeps the inspection step open.
- Timeouts, network failures, malformed success responses and server errors may
  happen after a save. Check the list before explicitly clearing the action.
  A missing row immediately after interruption is not proof that a pending save
  failed. Do not submit the same item in another tab to bypass the check.
- This is browser recovery, not server idempotency or a cross-tab lock. Branch
  and room-type names have no unique constraint, so matching names alone cannot
  prove which request created a row.

The existing POST endpoints authorize the role in the access token, have only
minimal server-side input validation and do not add booking-workflow audit
events. A client scope check does not repair direct-API access or a role-change
race. These backend limitations are recorded for a separately approved review;
this frontend delivery does not claim to fix them. Existing runtime grants
already permit the required inserts, so no schema or grant changes are needed.

## Checks

From the repository root:

```powershell
node .\frontend\tests\property-management-api-regression.mjs
node .\frontend\tests\staff-branch-api-regression.mjs
node .\frontend\tests\service-management-api-regression.mjs
node .\frontend\tests\page-loading-regression.mjs
npm --prefix frontend run build
```

Client tests use the actual Vite-loaded modules with mocked HTTP and storage.
The page-loading check creates a real temporary production build and checks
deferred page modules/styles; the final build updates `frontend/dist`. These
checks do not establish live MySQL creation, browser appearance or every race.

## Local browser review

1. Sign in as a manager. Open Property and switch between Branches and Room
   types. Compare the records with the public Branches and Rooms pages; the
   manager lists should show existing saved catalogue values, not sample data.
2. Search by displayed details, clear the search, and try a search with no
   results. Check the two pages at desktop width and about 390px phone width.
   Use keyboard Tab to reach the navigation, search, refresh and form controls.
3. Enter an incomplete form and an invalid rate/capacity/contact value. No create
   should be sent. Fill valid values and review them, then return to editing
   without saving. Switching forms must not submit anything.
4. If you need a real new catalogue entry for the project, create it once and
   record the returned reference. Refresh; confirm all details, rate and amenity
   labels. Do not add disposable records merely for screenshots: this page has
   no delete action. A new room type alone does not create any rooms.
5. If a save is interrupted, wait for processing to settle, use Refresh and
   inspect the list before clearing the saved action. Do not deliberately cut
   the connection during a live save simply to demonstrate this state.
6. Ordinary staff opening either management URL must see access denied. A
   signed-out user should be sent to staff sign-in and returned to the intended
   property page after a valid manager sign-in.
7. Confirm existing booking, billing, services and manager dashboard links still
   open normally. Report any visual or live API error before moving to Part 2.

Keep all four batches on one working branch. Applying this delivery does not
commit, push, merge or delete branches. Those actions wait for the agreed review.
