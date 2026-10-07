# Guest service requests: verification

This page records a service and its charge immediately through the existing
`POST /api/service-usage` endpoint. There is no pending request/approval queue.
The database chooses and saves the active catalogue price, checks ownership and
Checked-In status, and saves usage, bill changes and paired audit events together.
No migration, reseeding, new grants, payment or checkout is needed for this stage.

## One browser submission

Keep the current backend running. From the repository root, start the frontend
with `npm --prefix frontend run dev` and use the printed local URL.

1. Sign in as `demo.guest4`, the confirmed owner of booking **8**. Open its service
   page through My bookings, or visit `/guest/bookings/8/services` directly.
2. Before submitting, open its bill and note the saved history. If unchanged from
   the previous stage: room charges **LKR 12,000.00**, services **LKR 1,500.00**,
   total **LKR 13,500.00**, paid **LKR 6,750.00**, outstanding **LKR 6,750.00**;
   one Breakfast Buffet entry and one payment. The stay must still be Checked-In.
3. Choose one active service, for example **Airport Transfer**, quantity **1**.
   Read the current catalogue price and charge notice. Do not assume a fixed
   price from these instructions; the server saves the price when recording it.
4. Submit **once**. After success, refresh the history and bill. Expect one new
   service entry, its saved unit price and quantity, and the corresponding increase
   in service charges, total and outstanding. Room charges, the previous service,
   payment amount/count and booking status must remain unchanged.
5. If the request times out, the connection drops or its result is uncertain,
   **do not submit again**. Refresh history and ask staff to reconcile it first.
   The API has no duplicate-request key; a second submission can add another charge.

## Read-only database checks for booking 8

Booking 8 already has a payment. Use the new `guest-service` stage: it reconciles
the complete saved history, allows earlier payments, and requires the latest
operation to be a service recorded by the actual booking owner while Checked-In.
It resolves the guest actor from the booking; do not guess a GuestID or reuse a staff ID.
Run it immediately after the guest submission, before another service or payment
is recorded and before checkout. This command only reads the database.

```powershell
cd "C:\Users\ASUS TUF\SkyNest_Hotels"
& {
    try {
        $env:TEST_AUDIT_BOOKING_ID = "8"
        Remove-Item Env:TEST_AUDIT_EXPECTED_ACTOR_TYPE, Env:TEST_AUDIT_EXPECTED_ACTOR_ID -ErrorAction SilentlyContinue
        node .\backend\test-audit-log.js guest-service
        if ($LASTEXITCODE -ne 0) { throw "Audit history check failed. Send the output." }
    }
    finally {
        Remove-Item Env:TEST_AUDIT_BOOKING_ID, Env:TEST_AUDIT_EXPECTED_ACTOR_TYPE, Env:TEST_AUDIT_EXPECTED_ACTOR_ID -ErrorAction SilentlyContinue
    }
}
```

## Remaining browser checks and evidence limits

- Reload, use phone width and keyboard navigation; check history and charge text.
- Sign out, open the service URL and sign in: return to that same booking route.
- As another guest, open booking 8's URL: no booking, service or bill data may leak.
- For your own existing Booked, Cancelled or Checked-Out booking, submission must
  be unavailable. Do not change a reservation's status merely to test this page.
- Reject zero, negative, decimal and non-numeric quantities before submission.
- Local mocked regressions and the build are not a live database or browser PASS.
  The read checks above reconcile saved results; they do not force an audit failure,
  test rollback under that failure, or prove concurrent-write/idempotency behavior.
