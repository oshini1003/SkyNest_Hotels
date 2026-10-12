# SkyNest Hotels — Backend REST API

> **Node.js & Express REST API for SkyNest Hotels (HRGSMS)**
> Backed by MySQL 8.0 with transactional stored procedures, database triggers, and Role-Based Access Control (RBAC).

---

## 🚀 Quick Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Configure `.env`:**
   ```env
   PORT=5000
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=SkyNest_Hotels
   DB_SSL=false
   JWT_SECRET=your_jwt_access_secret_min_32_chars
   JWT_REFRESH_SECRET=your_jwt_refresh_secret_min_32_chars
   CORS_ORIGIN=http://localhost:5173
   ```
3. **Start the API:**
   ```bash
   npm run dev      # Development with nodemon
   npm start        # Production
   ```
*Health check:* `GET http://localhost:5000/api/health` $\to$ `{"status":"ok"}`

---

## 🔐 Authentication & Security

All protected endpoints require a Bearer token in the request header:
```http
Authorization: Bearer <accessToken>
```
* **Passwords:** Hashed with `bcryptjs` (10 rounds).
* **Tokens:** Short-lived JWT Access Tokens paired with rotating Refresh Tokens stored as SHA-256 digests in MySQL (`REFRESH_TOKEN`).
* **Roles:** `Guest`, `Receptionist`, `ServiceStaff`, `Manager`, `Admin`.

---

## 📋 REST API Reference

### 1. Authentication (`/api/auth`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/guest/register` | Public | Register a new guest account |
| `POST` | `/api/auth/guest/login` | Public | Guest login (returns access + refresh tokens) |
| `POST` | `/api/auth/staff/login` | Public | Staff login (returns access + refresh tokens) |
| `POST` | `/api/auth/staff/register` | **Admin** | Create new employee/staff account |
| `PUT` | `/api/auth/guest/password` | Guest | Change password & revoke existing refresh tokens |
| `PUT` | `/api/auth/staff/password` | Staff | Change password & revoke existing refresh tokens |
| `POST` | `/api/auth/refresh` | Public | Rotate refresh token for a new token pair |
| `POST` | `/api/auth/logout` | Public | Revoke active refresh token |

---

### 2. Hotel Structure (`/api`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/branches` | Public | List all branches (Colombo, Kandy, Galle) |
| `POST`, `PUT`, `DELETE` | `/api/branches/:id?` | Admin / Manager | Manage branch details |
| `GET` | `/api/room-types` | Public | List room types with rates and amenities |
| `POST`, `PUT`, `DELETE` | `/api/room-types/:id?` | Admin / Manager | Manage room categories |
| `GET` | `/api/amenities` | Public | List all hotel amenities |
| `POST`, `PUT`, `DELETE` | `/api/amenities/:id?` | Admin / Manager | Manage amenities |
| `GET` | `/api/rooms` | Public | Search room availability (`?branchId=&checkin=&checkout=&guestCount=`) |
| `POST`, `PUT`, `DELETE` | `/api/rooms/:id?` | Admin / Manager | Manage physical hotel rooms |
| `PATCH` | `/api/rooms/:id/status` | Staff (Scoped) | Update room status (`Available`, `Occupied`, `Maintenance`) |

---

### 3. Guests & Staff (`/api/guests`, `/api/staff`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET`, `PUT` | `/api/guests/me` | Guest | View or edit personal profile |
| `GET` | `/api/guests` | Front Desk | Search guests by NIC/Passport/Phone (`?search=`) |
| `POST` | `/api/guests` | Front Desk | Create guest record for walk-in arrivals |
| `GET` | `/api/staff/scope` | Staff | Get assigned branch and authorized permissions |

---

### 4. Bookings & Stay Lifecycle (`/api/bookings`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/bookings` | Authenticated | List bookings (guest sees own; staff sees branch/all) |
| `GET` | `/api/bookings/:id` | Authenticated | Full booking details, stay dates, and assigned rooms |
| `POST` | `/api/bookings` | Guest / Staff | Create reservation (supports single & multi-room) |
| `PATCH` | `/api/bookings/:id` | Guest / Staff | Modify stay dates or room before check-in |
| `PATCH` | `/api/bookings/:id/cancel` | Guest / Staff | Cancel an upcoming reservation |
| `POST` | `/api/bookings/:id/check-in` | Front Desk | Check-in guest, lock rooms to `Occupied`, open bill |
| `POST` | `/api/bookings/:id/check-out` | Front Desk | Enforce zero balance, check out guest, free rooms |

---

### 5. Guest Services (`/api`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/services` | Public | List active catalogue services and prices |
| `GET` | `/api/management/services` | Admin / Manager | List all services (including retired/inactive) |
| `POST`, `PUT` | `/api/services/:id?` | Admin / Manager | Create or update service catalogue entries |
| `POST` | `/api/service-usage` | Staff / Guest | Log service usage for checked-in booking (locks price) |
| `GET` | `/api/service-usage/:bookingId`| Authenticated | Get itemized service history for a booking |

---

### 6. Billing & Payments (`/api`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/bookings/:id/bill` | Authenticated | Live itemized bill (room charges, services, balance) |
| `POST` | `/api/payments` | Front Desk | Record payment (`Cash`, `Card`, `Bank Transfer`) |

---

### 7. Management Reports (`/api/reports`)

*Restricted to **Manager** and **Admin** roles.*

| Endpoint | Optional Query Filters | Description |
|---|---|---|
| `GET /api/reports/occupancy` | `branchId`, `startDate`, `endDate`, `date` | Room occupancy counts & rates (live snapshot or date range) |
| `GET /api/reports/billing-summary` | `branchId`, `outstandingOnly=true` | Billing summary with unpaid balances and payments |
| `GET /api/reports/service-usage` | `branchId`, `roomId`, `serviceId` | Service usage breakdown per room and service type |
| `GET /api/reports/revenue` | `branchId`, `year`, `month` | Monthly revenue per branch (room vs service charges) |
| `GET /api/reports/top-services` | `branchId`, `limit` (1–50) | Top-used services, preference share %, and demand trends |

---

### 8. Executive Dashboard (`/api/dashboard`)

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `GET` | `/api/dashboard/admin` | Admin / Manager | Real-time KPIs: arrivals, departures, revenue, occupancy |

---

## 🧪 Testing & Verification

```powershell
# Run database-free regression tests:
node tests/auth-regression.cjs
node tests/booking-regression.cjs
node tests/service-usage-regression.cjs
node tests/payment-regression.cjs
node tests/checkout-regression.cjs
node tests/report-regression.cjs

# Run live integration smoke tests (with DB running):
node test-tokens.js
node test-manager-reports.js
node test-dashboard.js
```
