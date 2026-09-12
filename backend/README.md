# HRGSMS Backend

Node.js + Express REST API for SkyNest Hotels, backed by MySQL/MariaDB.

## Setup

```bash
npm install
cp .env.example .env   # fill in DB_USER, DB_PASSWORD, JWT_SECRET
npm start               # or: npm run dev  (nodemon)
```

Requires the database to already be set up — see `../database/README.md`.

## Authentication

JWT, stateless (no server-side session store). Send the token as:

```
Authorization: Bearer <token>
```

| Endpoint | Method | Access | Description |
|---|---|---|---|
| `/api/auth/guest/register` | POST | Public | Create a guest account, returns a token |
| `/api/auth/guest/login` | POST | Public | Guest login |
| `/api/auth/staff/login` | POST | Public | Staff login |
| `/api/auth/staff/register` | POST | Admin only | Create a new staff account |

## Branches / room types / amenities / rooms

| Endpoint | Method | Access | Description |
|---|---|---|---|
| `/api/branches` | GET | Public | List branches |
| `/api/branches` | POST | Admin/Manager | Create a branch |
| `/api/room-types` | GET | Public | List room types (with amenities) |
| `/api/room-types` | POST | Admin/Manager | Create a room type |
| `/api/amenities` | GET | Public | List amenities |
| `/api/amenities` | POST | Admin/Manager | Create an amenity |
| `/api/rooms` | GET | Public | Search rooms — `?branchId=&roomTypeId=&checkin=&checkout=` |
| `/api/rooms` | POST | Admin/Manager | Create a room |
| `/api/rooms/:id/status` | PATCH | Admin/Manager/Receptionist | Update room status |

## Bookings

All require authentication (guest or staff).

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/bookings` | List/search bookings (`?guestName=&idNumber=&status=&branchId=`). Guests only ever see their own. |
| `GET /api/bookings/:id` | Full booking detail incl. rooms |
| `POST /api/bookings` | Make a booking — `{ roomId, checkin, checkout, guestCount, paymentMethod }` |
| `PATCH /api/bookings/:id/cancel` | Cancel a Booked reservation |
| `POST /api/bookings/:id/check-in` | Front desk only |
| `POST /api/bookings/:id/check-out` | Front desk only |

## Services

| Endpoint | Method | Access |
|---|---|---|
| `GET /api/services` | Public | List active services |
| `POST /api/services` | Admin/Manager | Add a service |
| `PUT /api/services/:id` | Admin/Manager | Update/retire a service |
| `POST /api/service-usage` | Authenticated | Log usage — `{ bookingId, serviceId, quantity }` |
| `GET /api/service-usage/:bookingId` | Authenticated | List usage for a booking |

## Billing & payments

| Endpoint | Method | Access |
|---|---|---|
| `GET /api/bookings/:bookingId/bill` | Authenticated | Itemised live bill, payments, service usage |
| `POST /api/payments` | Front desk | Record a payment — `{ bookingId, amount, paymentMethod }` |

## Reports (Manager/Admin only)

| Endpoint | Description |
|---|---|
| `GET /api/reports/occupancy` | Occupied vs available rooms per branch |
| `GET /api/reports/billing-summary` | Itemised bills, `?outstandingOnly=true` to filter |
| `GET /api/reports/service-usage` | Quantity + revenue per service |
| `GET /api/reports/revenue` | Monthly revenue per branch (Checked-Out bookings) |
| `GET /api/reports/top-services` | Most-used services |

## Project layout

```
src/
├── config/db.js         MySQL connection pool
├── middleware/auth.js   JWT verification + role guards
├── controllers/         Route handlers (one per resource)
├── routes/              Express routers
├── utils/asyncHandler.js
└── server.js            App entry point
```
