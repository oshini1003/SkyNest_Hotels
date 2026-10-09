# Multi-room booking and guest booking edits

Reviewed against main `054aede8b83fba217b402963b6bacefca09acd49` and the
`feature/multi-room-booking-ui` archive at
`acaed47ba03f301f1cdf0697b9455a28cbc59918` (9 October 2026).

## What is integrated

Samalee's room selection, multi-room review, booking confirmation and per-room
edit interface are retained. One selection accepts up to ten distinct rooms,
with shared arrival/departure dates and a guest count for each room. Review
checks every selected room before enabling confirmation. One POST creates the
whole booking; the backend owns the transaction, prices and guest identity.
Single-room links still work and retain the existing one-room request body.

My bookings offers edits only for a Booked reservation. An edit identifies its
booked-room row and sends only fields the guest changed. Other room entries and
omitted dates are preserved by the existing backend. Alternative-room searches
stay within that room's branch. The original room remains an option even though
public availability excludes its already-reserved dates; the backend checks its
availability again during the edit.

The review fixes stale search results after input changes, preserves a selected
larger room when changing its guest count, and prevents overlapping edit/cancel
actions. A save acknowledgement must identify the requested booking and booked
room. An unresolved change remains blocked across editor closure and reload in
the same browser tab. The guest must reread the current details and explicitly
review the result before enabling another change; the application never retries
an edit or cancellation automatically. If the result remains unclear, staff
should check it before another change is submitted.

The browser marker is a local safeguard, not server idempotency or a cross-tab
lock. The existing database locking and ownership checks remain authoritative.
The current API does not provide a version-based conflict check for two people
changing the same field: accepted changes are serialized, and a later edit to
the same field can replace an earlier edit. Estimated room prices are current
catalogue estimates, not historical per-room charge snapshots.

Manager service management, guest bills/services, staff branch access, lazy page
loading and the cream/green/gold theme are retained. No backend, database,
dependency or runtime-grant change is required by this integration.

## Automated checks

From the repository root:

```powershell
node .\frontend\tests\multi-room-booking-regression.mjs
node .\frontend\tests\guest-billing-api-regression.mjs
node .\frontend\tests\guest-service-api-regression.mjs
node .\frontend\tests\service-management-api-regression.mjs
node .\frontend\tests\account-session-regression.mjs
node .\backend\tests\booking-change-regression.cjs
node .\frontend\tests\page-loading-regression.mjs
npm --prefix frontend run build
```

The API tests use actual Vite-loaded client modules with mocked HTTP and browser
storage. The backend regression uses mocked database calls. The page-loading
test builds in a temporary folder; the final build command updates `frontend/dist`
for preview. These checks do not establish real browser rendering, live booking
writes or live concurrent database behavior.

## Local browser check before pushing the integration

Use a test guest and future available dates in the development database. This
workflow deliberately creates a reservation and changes that new reservation.
Use a new test booking; keep existing paid/completed stays for read-only checks.

1. Open Rooms, select a branch with two available rooms, enter future dates and
   search. The search guest count is a minimum capacity for each room, not the
   total party size. Add two rooms, set their guest counts, remove/re-add one,
   and inspect the combined estimated charge. Editing a search filter should
   clear the prior results and selection.
2. Continue to review. If signed out, sign in and verify both rooms and their
   guest counts survive. Review the dates, branch/room labels and charge total.
   Confirm once. Expect one booking reference with both room entries and no
   payment taken. Record that reference.
3. In My bookings, change a date or guest count on one room. Save once and reread
   both entries: the selected entry changes and the other entry remains intact.
   Confirm the View bill & services link still opens the owner's bill/estimate.
4. If a larger alternative room is available in the same branch, select it and
   increase the guest count within its capacity. The chosen alternative must
   remain selected. Inspect the proposed details before saving once.
5. With browser network throttling, start an alternative-room search and change
   the dates before it completes. Old results must not reappear. While an edit
   is saving, changing another room, cancellation and list refresh/filter
   controls must not start a competing action. Do not intentionally interrupt
   writes against existing hotel stays.
6. For a naturally interrupted save, reload My bookings and inspect the current
   details. The reconciliation notice must remain; do not repeat a request just
   because it timed out. If unsure whether it committed, ask staff to inspect
   before acknowledging the result and allowing another change.
7. Inspect the room selection, review, booking cards and editor at desktop and
   roughly 375 px widths. Check readable labels, keyboard focus, wrapping and
   usable buttons. Open the manager service catalogue once to confirm that
   integration retained it.
8. When finished, cancel only this new test reservation through its normal
   confirmation flow if it is no longer needed. Cancellation applies to the
   whole reservation, including all of its rooms.

Existing branch access rules still apply. A booking containing rooms from
different branches is unavailable to branch-restricted staff and requires a
Manager/Admin. Separate room dates can also make whole-booking check-in
ineligible until all rooms meet the existing check-in rules. Those policies are
not changed by this frontend feature.
