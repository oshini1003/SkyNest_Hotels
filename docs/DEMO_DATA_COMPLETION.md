# Complete the local demonstration dataset

The read-only inspection supplied on 7 October 2026 found:

| Measure | Saved | Required minimum | Remaining |
| --- | ---: | ---: | ---: |
| Branches | 3 | 3 | 0 |
| Rooms | 7 | 10 | 3 |
| Room types actually used | 3 | 2 | 0 |
| Services | 4 | 6 | 2 |
| Guests | 3 | 5 | 2 |
| Bookings | 7 | 8 | 1 |
| Payments classified Partial | 2 | 3 | 1 |
| Booked-room rows | 7 | 1 | 0 |
| Service-usage rows | 4 | 1 | 0 |

Only two distinct guests have reservations. Create one reservation for each of
the two new guests and one for the existing guest who has no bookings. That produces ten
bookings across five guests, satisfying the brief's guest/booking relationship
more clearly than eight bookings concentrated among two guests. Do not infer
current counts or a future reference from auto-increment IDs.

## 1. Add the five missing catalogue entries

`backend/add-grading-catalogue.js` uses the existing local runtime configuration
and its already granted catalogue INSERT permissions. It never uses maintenance
credentials or changes grants/schema. It adds only the following records:

| Branch | New room number | Room type |
| --- | --- | --- |
| SkyNest Colombo | 202 | Double |
| SkyNest Kandy | 201 | Suite |
| SkyNest Galle | 102 | Single |

| Service | Description | Demo price (LKR) |
| --- | --- | ---: |
| Breakfast Buffet | Per guest, per breakfast | 1500.00 |
| Airport Transfer | Per vehicle, one-way transfer | 4500.00 |

These are fictional coursework prices. Room prices remain those of the existing
room types. Branch/type IDs are resolved from their names, not assumed to be 1–3.

From the repository root:

```powershell
node .\backend\tests\grading-catalogue-regression.cjs
node .\backend\add-grading-catalogue.js
node .\backend\add-grading-catalogue.js --apply
node .\backend\check-grading-data.js
```

Without `--apply`, the helper only shows its plan. With `--apply`, it validates
all five entries before inserting any, then commits the missing catalogue rows
together. Exact existing matches are skipped. Conflicting or ambiguous entries
stop the operation. Existing room statuses are preserved; a retired service is
not reactivated. It reads inactive/maintenance entries as well as public ones.

Pause catalogue edits from other clients while running it. A named connection
lock serializes this helper's apply runs; unrelated API callers do not take that
lock, and service names do not have a database UNIQUE constraint. The script
does not claim protection against concurrent uncoordinated catalogue edits.

After a lost commit acknowledgement, the result is uncertain. Do not repeat
`--apply` blindly: run the read-only plan and inspect the records first. The
helper never automatically retries writes. A successful rerun skips matching
entries rather than duplicating or overwriting them.

After successful application, the room/service counts should be at least 10/6.
The checker will still return REVIEW for the guest/booking/payment gaps until
the following UI steps are completed. Do not rerun the original seed or setup.

## 2. Register two fictional guests through the UI

Start the backend and frontend in separate terminals if they are not running:

```powershell
# Repository root, backend terminal
npm --prefix backend run dev
```

```powershell
# Repository root, frontend terminal
npm --prefix frontend run dev
```

Open the Local URL printed by Vite. Sign out of the current guest account before
each registration. Use these clearly labelled demo profiles; optional email and
address can remain empty:

| Field | Guest four | Guest five |
| --- | --- | --- |
| Full name | Demo Guest Four | Demo Guest Five |
| Contact number | 0700000004 | 0700000005 |
| NIC / passport field | DEMO-GRADING-004 | DEMO-GRADING-005 |
| Username | demo.guest4 | demo.guest5 |
| Password and confirmation | SkyNestDemo4! | SkyNestDemo5! |

These are local test credentials and placeholder profile values, not real
guest identity documents. If an account already exists, sign in to it and check
its saved bookings; do not create duplicate profiles to satisfy a count.

## 3. Make three real test reservations

Choose one guest per reservation. Use one guest in each room, preferred payment
Cash, and record the actual booking reference displayed after confirmation.

| Guest | Branch / room | Dates | Purpose |
| --- | --- | --- | --- |
| demo.guest4 | Colombo / 202 | Today to tomorrow | Active stay and partial-payment demonstration |
| demo.guest5 | Kandy / 201 | A future one-night stay | Another guest represented in booking history |
| Existing guest without a booking | Galle / 102 | A future one-night stay | Fifth distinct guest represented in bookings |

For work performed on 7 October 2026, today/tomorrow is 7–8 October. If working
later, use the current dates shown by the application. Confirm that search
returns the room for the chosen dates; do not force a booking if it is unavailable.

The aggregate counts do not identify which existing guest lacks a reservation;
do not assume it is GuestID 3 or your own account. Check My Bookings for the
existing accounts you control. If the account cannot be identified or accessed,
pause that one reservation and inspect the account rather than creating a sixth
guest as a substitute. The other two registrations/reservations can proceed.

Do not guess that the new booking will be #8: insert IDs may contain gaps. If a
confirmation response is uncertain, inspect My Bookings before submitting again.

## 4. Record one additional partial payment

1. Sign in as `amali` using the existing local staff password (`staff123` only if
   unchanged). Open the new Colombo reservation for `demo.guest4`.
2. Check in through the staff page once its date is eligible. Confirm Checked-In
   and that room 202 is Occupied.
3. Record **Breakfast Buffet, quantity 1** through the service-usage page. This
   exercises the new catalogue entry and records an audited service charge.
4. Open Bill and payments. Read the current outstanding balance. Record one Cash
   payment greater than zero and strictly smaller than that balance, such as half
   of it. Use the displayed balance, not an assumed room total.
5. Confirm the saved payment history and Partially Paid status. Leave this new
   stay Checked-In with a positive balance so the next guest-bill UI work has an
   active, unpaid example. Existing completed stays already demonstrate checkout.

Do not insert or relabel PAYMENT rows in SQL. The payment procedure calculates
Full/Partial from the outstanding balance and writes the paired audit history.
If the response is uncertain, refresh bill history before attempting another
payment. Do not run the older booking-#4 fixture test against this new scenario;
its exact amounts/service counts describe a different booking.

## 5. Verify and retain the result

Run `node .\backend\check-grading-data.js` again. Expected lower bounds after all
steps: 10 rooms, 6 services, 5 guests, 10 bookings, 3 Partial payment rows, at least
5 service-usage rows, and 5 distinct guests with bookings. Other legitimate work
may increase those counts. A count PASS does not certify every feature.

For the new Colombo booking, after check-in, breakfast and the partial payment:

```powershell
& {
    try {
        $env:TEST_AUDIT_BOOKING_ID = (
            Read-Host "Enter the new Colombo booking reference"
        ).Trim()
        $env:TEST_AUDIT_EXPECTED_ACTOR_TYPE = "staff"
        $env:TEST_AUDIT_EXPECTED_ACTOR_ID = "3"

        node .\backend\test-audit-log.js payment
        if ($LASTEXITCODE -ne 0) { throw "Audit check failed. Send the output." }
    }
    finally {
        Remove-Item Env:TEST_AUDIT_BOOKING_ID, `
            Env:TEST_AUDIT_EXPECTED_ACTOR_TYPE, `
            Env:TEST_AUDIT_EXPECTED_ACTOR_ID -ErrorAction SilentlyContinue
    }
}
```

StaffID 3 is the existing seeded Amali account verified in earlier workflows;
use the actual actor if a different staff account recorded the payment. The audit
command only reads the completed actions. With exactly the three specified
actions, expect three paired operations/six events, one service entry and one
payment. Do not repeat an action just to match a predicted count.

Keep the count and audit output with the booking reference and Git commit. The
broader remaining work is tracked in [GRADING_READINESS.md](GRADING_READINESS.md).
