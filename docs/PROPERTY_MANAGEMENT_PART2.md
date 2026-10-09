# Property management, Part 2: rooms and amenities

Prepared on 9 October 2026 against the Part 1 tree committed by the user as
`50225a5`. Continue on `frontend/final-management-ui`. This delivery changes
frontend code and documentation only. It does not install database objects,
change runtime grants, commit, push or merge anything on the user's computer.

## Included

Managers and administrators can open **Property**, then **Rooms** or **Amenities**.
Both pages also have cards in the staff account workspace.

| Page | Existing endpoints | Available actions |
| --- | --- | --- |
| `/staff/rooms` | `GET /api/rooms`, `/api/branches`, `/api/room-types`; `POST /api/rooms` | Read listed rooms, search/filter, review and add a room |
| `/staff/amenities` | `GET /api/amenities`, `/api/room-types`; `POST /api/amenities` | Search amenities, see room-type associations by name, review and add an amenity |

Each read/save first verifies the current manager/admin scope using
`GET /api/staff/scope`. New room forms accept only a current branch, a current
room type and a room number of 1-10 characters. The create body contains only
`branchId`, `roomTypeId` and `roomNumber`. Status is assigned by the existing
backend. Amenity names are trimmed, single-line text of 1-100 characters;
their create body contains only `name`.

The four property pages share the cream, deep-green and gold theme and navigation.
New pages are loaded on demand. Forms have a review step, clear labels, loading,
empty/error states and narrow-screen layouts.

## Room list and amenity limits

The current `GET /rooms` endpoint **always excludes maintenance rooms**, even
when filtering by a room reference. The new page therefore says **Listed rooms**
and explicitly explains the exclusion. An empty result is not proof that a
branch has no rooms. Without stay dates, this catalogue is not an availability
check. `Available`/`Occupied` describe saved room status; they do not guarantee
that the room can be booked for a chosen date range. Rates shown are current
room-type catalogue prices, not saved historical booking charges.

No room-status controls are included. There is no existing complete room-list
endpoint to retrieve maintenance rooms reliably. The existing status PATCH also
does not protect all manual status transitions against active stays or stale
edits. A complete maintenance/status workflow needs a separately approved backend
review; this frontend-only batch does not claim to complete that workflow.

Room and amenity edit/delete endpoints do not exist. Adding an amenity does not
attach it to existing room types: select it when creating a new room type on the
Part 1 page. Existing room-type amenity links cannot be edited through these APIs.
The room-type GET supplies amenity names, not association IDs; the UI does not
invent an ID-based link from an ambiguous name.

## Save recovery

The property client retains one pending/saved action per staff member and kind
in sessionStorage. Double clicks are blocked in the same tab, including during
scope verification. POSTs are never automatically retried or redirected.

A matching HTTP 201 receipt confirms creation. The page keeps that confirmation
if the following refresh or browser-storage update fails. It clears the saved
action automatically only after a fresh catalogue contains the confirmed ID and
matching submitted details. Displayed rows always come from GET responses.

Timeouts, malformed success responses and server/network errors can occur after
a save. The form stays blocked until the outcome is inspected. The room list's
maintenance exclusion makes absence especially inconclusive: another action may
have moved a saved room into maintenance. Wait for outstanding requests and ask
the administrator to resolve an uncertain result before submitting again.

Duplicate conflicts reported by the existing room/amenity insert endpoints are
definite rejections. Database uniqueness remains the final check for room number
within a branch and for amenity name. Frontend checks are not server idempotency,
cross-tab locking or a replacement for backend authorization/validation. The
existing creation endpoints use token roles and do not write booking-workflow
audit events. No backend changes are included here.

## Automated checks

Run from the repository root:

```powershell
node .\frontend\tests\property-inventory-api-regression.mjs
node .\frontend\tests\property-management-api-regression.mjs
node .\frontend\tests\page-loading-regression.mjs
npm --prefix frontend run build
```

The API checks exercise the actual Vite-loaded client with mocked HTTP/storage.
The page-loading check builds production assets and verifies page exports and
deferred styles. These checks do not execute live MySQL writes or verify browser
rendering. Run the following browser checks on the user's local application.

## Local browser checks

1. Sign in as a manager. Open **Property > Rooms**. Confirm the saved room numbers,
   branch/type names and rates. Try search and branch, type and status filters;
   clear them. Check that the maintenance exclusion is visible.
2. Open **Amenities**. Search an existing name and inspect its room-type labels.
   Navigate through all four property tabs, then use browser back/forward.
3. If the project needs a new amenity, enter its real intended name, review and
   confirm once. Verify the success reference and fresh list entry. On **Room
   types**, refresh and check it appears as a selectable amenity. Do not create
   unnecessary duplicate demo records just to test the page.
4. If a new room is needed, choose the intended branch/type, enter its unique room
   number, review the displayed choices, then confirm once. Refresh and verify
   the new reference, number, branch and type. The public room search may show
   it only when its normal search criteria are satisfied.
5. Required fields and overlong values must block review. A rejected duplicate
   room/amenity must not produce a success message. If a save is uncertain, do
   not retry it or use another tab: follow the recovery notice first.
6. Open the two routes while signed out: sign-in should return to the intended
   page. An ordinary receptionist/service staff account must not gain these
   manager creation controls.
7. Check a real narrow viewport (for example 375px), keyboard focus and readable
   review details. Browser zoom alone is not a mobile-width test.

Record live results separately. Push only after the user's approval; merge after
the final four-part review as agreed. Preserve the unrelated local
`tsauth-regression.cjs` file.
