# Guest bill and service-history verification

## Scope

Read-only guest interface for the existing bill API. No migrations, new grants,
reseeding, checkout or payment actions are needed. Preserve the active partial
payment scenario on booking #8. The staff branch access stage is already merged
at `4dbd256`; this page builds on that code.

## Browser checks

Keep the current backend running on port 5000. Start the frontend from the
repository root with `npm --prefix frontend run dev`; use its printed URL.

1. Sign in as the guest who owns booking #8. The earlier demo instructions used
   `demo.guest4`; use the actual saved account if you chose another username.
   Open **My bookings → View bill & services** on booking #8.
2. If the scenario has not changed, confirm recorded room charges **LKR 12,000.00**,
   Breakfast Buffet **LKR 1,500.00**, total **LKR 13,500.00**, one saved Cash payment
   of **LKR 6,750.00**, and **LKR 6,750.00** outstanding. The bill is Partially Paid
   and the stay remains Checked-In. Inspect only; do not make another payment.
3. Refresh the page. The old amounts disappear while loading and the saved
   history returns. Check both desktop and phone widths, table scrolling and
   keyboard focus on links and buttons.
4. Sign out. Visit `/guest/bookings/8/bill` directly, then sign in again as its
   owner: the same bill route should reopen. If using a different guest, the
   page must show a generic unavailable-booking message with no bill data.
5. Sign in as Kasun and open booking #12 from My bookings (if it remains Booked).
   With no saved bill yet, the page must show an estimate, no recorded payments
   and no invoice/bill number. Do not check in just to test this page.
6. Using an existing completed reservation and its owning guest, check Paid,
   zero outstanding, historical services and payments. Using an existing
   Cancelled reservation without a bill, confirm no estimated amount is shown
   as payable. Do not change reservation status to manufacture these cases.
7. Temporarily stop the backend and refresh. A retry message should replace
   the bill. Restart it and retry. Do not reset the database.

## Live ownership and history check

Use the owner of an existing saved bill with at least one service and payment,
plus any **different** guest account. The second guest does not need a booking
of their own. Run from `C:\Users\ASUS TUF\SkyNest_Hotels` in a separate PowerShell
terminal while the backend is running. Enter passwords locally; do not include
private passwords in screenshots or shared terminal output.

```powershell
& {
    try {
        $env:TEST_API_URL = "http://localhost:5000/api"
        $env:TEST_GUEST_BOOKING_ID = (Read-Host "Saved bill booking reference (for example 8)").Trim()
        $env:TEST_GUEST_USERNAME = (Read-Host "Owning guest username").Trim()
        $billOwnerPassword = Read-Host "Owning guest password" -AsSecureString
        $env:TEST_GUEST_PASSWORD = [System.Net.NetworkCredential]::new("", $billOwnerPassword).Password
        $env:TEST_OTHER_GUEST_USERNAME = (Read-Host "Different guest username (for example kasun)").Trim()
        $billOtherPassword = Read-Host "Different guest password" -AsSecureString
        $env:TEST_OTHER_GUEST_PASSWORD = [System.Net.NetworkCredential]::new("", $billOtherPassword).Password

        node .\backend\test-guest-bill.js
        if ($LASTEXITCODE -ne 0) { throw "Guest bill verification failed. Send the output." }
    }
    finally {
        Remove-Item Env:TEST_API_URL, Env:TEST_GUEST_BOOKING_ID, Env:TEST_GUEST_USERNAME, `
            Env:TEST_GUEST_PASSWORD, Env:TEST_OTHER_GUEST_USERNAME, Env:TEST_OTHER_GUEST_PASSWORD `
            -ErrorAction SilentlyContinue
        Remove-Variable billOwnerPassword, billOtherPassword -ErrorAction SilentlyContinue
    }
}
```

The verifier uses only GET requests for hotel records; login/logout creates and
closes its test sessions. Keep the selected reservation unchanged while it runs.
A PASS verifies the selected responses and saved totals, not every reservation,
concurrent writes, audit rollback, browser appearance or grading completion.
No live result is claimed by the included mock tests or production build.
