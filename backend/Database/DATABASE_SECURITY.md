# Restricted local MySQL runtime account

This stage replaces the application's root login with `skynest_app@localhost`
for **SkyNest_Integration_20261002**. It is a restricted shared application
account, not a separate database account for every hotel guest or staff member.
The setup targets the existing local integration database only, including its
lowercase name on Windows. It does not import SQL, seed data, replace routines,
change root credentials, or modify hotel rows.

## Permission inventory

`runtimeUserPolicy.js` is the executable grant list. Every table below has SELECT;
INSERT and UPDATE are limited to the listed columns. There are no DELETE grants.

| Table | INSERT columns | UPDATE columns |
|---|---|---|
| BRANCH | Name, Location, ContactNumber | — |
| ROOM_TYPE | Name, Capacity, DailyRate | — |
| AMENITY | AmenityName | — |
| ROOM_TYPE_AMENITY | RoomTypeID, AmenityID | — |
| ROOM | BranchID, RoomTypeID, RoomNumber | RoomStatus |
| GUEST | Name, ContactNumber, Email, IDNumber, Address | Name, ContactNumber, Email, Address |
| GUEST_ACCOUNT | GuestID, Username, PasswordHash | PasswordHash |
| STAFF | BranchID, Name, Role, Email | — |
| STAFF_ACCOUNT | StaffID, Username, PasswordHash | PasswordHash |
| SERVICE_CATALOGUE | ServiceName, Description, UnitPrice | ServiceName, Description, UnitPrice, IsActive |
| BOOKING | GuestID, StaffID, PreferredPaymentMethod | BookingStatus |
| BOOKED_ROOMS | BookingID, RoomID, CheckInDateTime, CheckOutDateTime, GuestCount | — |
| REFRESH_TOKEN | UserType, UserID, Token, ExpiresAt | RevokedAt |
| BILL, PAYMENT, SERVICE_USAGE, AUDIT_LOG | — | — |

AUDIT_LOG SELECT supports the existing read-only audit verifier. The web API has
no audit-history route. Auto IDs, timestamps and default status columns are not
explicitly insertable except where the current controller supplies a foreign key.

EXECUTE is granted on six entry procedures: `sp_make_booking`, `sp_check_in`,
`sp_check_out`, `sp_log_service_usage`, `sp_process_payment`, and
`sp_update_booked_room`; and three read functions: `fn_calculate_room_charges`,
`fn_calculate_service_charges`, and `fn_calculate_outstanding_balance`.
`sp_recalculate_bill` and `fn_calculate_bill_total` remain internal helpers.
Existing routines/triggers retain their maintenance definer. MySQL executes
DEFINER routines with that account's privileges; the app needs EXECUTE, not
permission to write financial or audit rows directly.

No global/database-wide privileges, roles, GRANT OPTION, CREATE USER, DDL,
TRIGGER, FILE, temporary-table creation, or LOCK TABLES are granted. In
particular, DROP is absent, which also excludes TRUNCATE. SHOW GRANTS is checked
against the complete expected policy, rejecting extra as well as missing rights.
Mandatory server roles or unexpected definers stop the setup for review.

## Install and verify

1. Stop the backend (Ctrl+C in its terminal). Keep MySQL running. Apply this
   patch and run the policy, setup, auth and booking-change regression scripts.
2. Keep the existing root configuration in `backend/.env` for this one-time
   setup. Confirm `DB_NAME=SkyNest_Integration_20261002`. Do not print or upload
   that file. Remove any shell DB_* overrides before setup.
3. From the repository root run:

   ```powershell
   node .\backend\Database\setupRuntimeUser.js --backend-stopped
   ```

The script verifies the selected database, `root@localhost`, no mandatory/active
roles, required tables and routine definers. It refuses an existing `skynest_app`
account at any host. It writes two new files with exclusive creation:

- `backend/.env.maintenance`: exact original configuration for maintenance.
- `backend/.env.runtime`: same application settings/JWT secrets, new DB username
  and generated password. Never prints the generated password.

Both files are ignored by Git. File creation requests mode 0600 on systems that
support it; Windows uses the containing folder's NTFS permissions. Keep these
files local/private, just like `.env`. Do not attach them to review ZIPs or chat.

The new account starts locked. Only after granting and verifying the exact
policy is it unlocked for a temporary connection. That connection performs:
17 empty table reads, routine metadata checks, five empty locking reads matching
login/refresh/booking query shapes, and seven expected permission denials. The
negative UPDATE/DELETE probes use `WHERE 1 = 0`; even unexpectedly broad
permissions cannot change a hotel row. No business procedure or DDL is called
by the verifier.

MySQL FOR UPDATE has additional privilege requirements. Auth now locks just the
credential table (`OF ga` / `OF sa`); the multi-room overlap read uses FOR SHARE
after the existing exclusive room lock. Single-room creation and booking edits
also lock that room. The live candidate checks verify column-grant compatibility
on the installed MySQL server before activation. Do not broaden grants to bypass
a failing check without reviewing its cause.

4. Only after setup prints PASS, activate and verify the candidate:

   ```powershell
   Copy-Item .\backend\.env.runtime .\backend\.env -Force
   node .\backend\check-runtime-user.js
   ```

   Stop if the check fails. `.env.maintenance` preserves the previous configuration.
   To inspect before activation, `node backend/check-runtime-user.js --candidate`
   uses the candidate file explicitly. No installer is automatically retried.
5. Restart the backend from `backend` with `npm run dev`. Check public room/service
   reads, guest and staff login, profile reads, manager dashboard and reports.
   The existing `test-tokens.js` verifies guest login/refresh/logout (it changes
   test login-session rows); `test-dashboard.js` verifies live manager reads.
   `test-audit-log.js checkout` can reread completed booking #6 without changing
   hotel rows. These do not replace an end-to-end smoke test of a **new** booking,
   check-in, service, payment and checkout under the new runtime account.
   Do not replay payments against completed stays.

## Failure and maintenance

After acknowledged account creation, a grant/verification failure attempts to
lock only the new account and leaves `.env` unchanged. If CREATE itself fails or
its acknowledgement is lost, setup does not ALTER the account: its own CREATE
requests ACCOUNT LOCK, and a concurrent administrator might own a conflicting
account. Inspect before retrying. If the connection is lost, account state may
need inspection; no account is dropped or automatically overwritten.
Keep both private files. If it reports an existing account or existing credential
files, inspect first rather than deleting either or rerunning with broader grants.
Account locking prevents new logins; it does not terminate already-open sessions.
The setup closes its own temporary connection, and the backend must be stopped.

Normal server startup never reads `.env.maintenance`. `config/db.js` requires an
explicit DB_USER and loads `backend/.env` independently of the working directory;
it does not silently fall back to root.

For a future **reviewed** migration, stop the backend and run the maintenance
wrapper, for example:

```powershell
node .\backend\Database\runMaintenance.js addAuditLog.js --backend-stopped
```

This selects only the DB_* settings from the private maintenance file for a
whitelisted child process. It does not overwrite `.env`, change grants, or bypass
installer checks. Do not rerun earlier installers just to change the runtime user.
Routine-specific EXECUTE grants can be lost when a routine is dropped; existing
migration grant-loss checks deliberately stop such replacements. A future
replacement migration must explicitly preserve/reapply and verify the exact
runtime grants. Do not grant schema-wide EXECUTE as a workaround.

## Evidence and limits

- `runtime-policy-regression.cjs`: independent grant fixtures and strict rejection
  of extra/missing rights, roles, broad grants and unexpected recipients/objects.
- `runtime-setup-regression.cjs`: mocked provisioning order, target checks,
  failure locking/cleanup, nonmutating probes, private config and maintenance paths.
- Auth/booking regressions check lock scopes, ordering and transaction behavior.
- `check-runtime-user.js`: actual MySQL identity/grant/read/denial/lock evidence.
  It has **not** run here against the student's MySQL server; retain its local output.
- Business routine execution and full workflow testing remain separate live checks.

Express still enforces guest ownership, staff roles and actor identities.
The runtime account can read all application rows and hashes, can create staff
accounts for the admin endpoint, and has BookingStatus UPDATE for cancellation.
A stolen runtime credential is therefore still serious; grants alone do not
provide per-user/branch authorization. The database administrator can still
modify/drop objects. This is not a claim of tamper-proof auditing or production
security certification. Definer minimization, credentials rotation and deployment
configuration are separate work.

Primary MySQL 9.7 references:
- https://dev.mysql.com/doc/refman/9.7/en/grant.html
- https://dev.mysql.com/doc/refman/9.7/en/stored-objects-security.html
- https://dev.mysql.com/doc/refman/9.7/en/innodb-locking-reads.html
- https://dev.mysql.com/doc/refman/9.7/en/account-locking.html
- https://dev.mysql.com/doc/refman/9.7/en/roles.html
