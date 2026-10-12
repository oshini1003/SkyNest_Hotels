# SkyNest Hotels — Hotel Reservation & Guest Services Management System

> **CS3043 Database Systems — Group 36**  
> A full-stack, enterprise-grade hotel reservation and guest services management platform designed for **SkyNest Hotels**, a three-branch luxury hotel chain located in Colombo, Kandy, and Galle, Sri Lanka.

[![Live Frontend](https://img.shields.io/badge/Live_Frontend-Vercel-black?style=for-the-badge&logo=vercel)](https://sky-nest-hotels.vercel.app/)
[![Backend API](https://img.shields.io/badge/Backend_API-Render-46E3B7?style=for-the-badge&logo=render)](https://skynest-backend.onrender.com/api/health)
[![Database](https://img.shields.io/badge/Database-Aiven_MySQL-FF3E00?style=for-the-badge&logo=mysql)](https://aiven.io)

* **🌐 Live Web Application:** [https://sky-nest-hotels.vercel.app/](https://sky-nest-hotels.vercel.app/)  
* **⚙️ Live Backend API:** [https://skynest-backend.onrender.com](https://skynest-backend.onrender.com)  
* **🩺 API Health Check:** [https://skynest-backend.onrender.com/api/health](https://skynest-backend.onrender.com/api/health)

---

## 📌 Table of Contents
- [Executive Overview](#-executive-overview)
- [System Architecture & Tech Stack](#-system-architecture--tech-stack)
- [Core Features & Functional Modules](#-core-features--functional-modules)
- [Team Member Contributions](#-team-member-contributions)
- [Quick Start / Local Setup Guide](#-quick-start--local-setup-guide)
- [Demo Credentials](#-demo-credentials)
- [Verification & Automated Testing](#-verification--automated-testing)
- [Cloud Deployment Architecture](#-cloud-deployment-architecture)

---

## 🏨 Executive Overview

The **SkyNest Hotel Reservation & Guest Services Management System (HRGSMS)** coordinates multi-branch operations, real-time room bookings, personalized guest services, audited billing, and executive business analytics.

The system ensures end-to-end data integrity through ACID-compliant MySQL stored procedures, database triggers, and functions, preventing double-bookings, ensuring financial consistency, and maintaining an immutable audit log.

### Key Highlights
* **Multi-Branch Operations:** Centralized management across Colombo, Kandy, and Galle branches.
* **Role-Based Access Control (RBAC):** Strict boundaries separating Guests, Receptionists, Service Staff, Managers, and System Admins.
* **Double-Booking Prevention:** Atomic locking read mechanisms (`FOR UPDATE`) and database triggers.
* **Live Financial Reconciliation:** Automated bill recalculation (`RoomCharges + ServiceCharges - Payments = OutstandingBalance`).
* **Executive Decision Support:** 5 comprehensive management reports and an interactive operational dashboard.

---

## 🛠 System Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────┐
│                   Frontend Client                      │
│            React 19 • Vite • React Router              │
└───────────────────────────┬────────────────────────────┘
                            │ REST API (JSON / Bearer JWT)
┌───────────────────────────▼────────────────────────────┐
│                  Backend Application                   │
│        Node.js • Express • JWT • Bcryptjs              │
└───────────────────────────┬────────────────────────────┘
                            │ Parameterized SQL Connection Pool
┌───────────────────────────▼────────────────────────────┐
│                    MySQL Database                      │
│  Tables • Stored Procedures • Triggers • Functions     │
└────────────────────────────────────────────────────────┘
```

| Layer | Technology | Key Capabilities |
|---|---|---|
| **Frontend** | React 19, Vite, Modern CSS | Responsive UI, token-based session management, client-side data validation |
| **Backend** | Node.js, Express.js | RESTful APIs, strict query parameter validation, JWT authentication, RBAC middleware |
| **Security** | Bcrypt (10 rounds), JWT, SHA-256 | Dual-token authentication (Access + Rotating Refresh Tokens), password hashing |
| **Database** | MySQL 8.0+ | ACID transactions, pessimistic locking (`FOR UPDATE`), custom functions & triggers |

---

## 🌟 Core Features & Functional Modules

### 1. Guest Portal
* **Account Management:** Self-service registration, secure login, profile view/edit, and password updates.
* **Availability Search:** Filter rooms by branch, dates, guest capacity, and room type with real-time availability checks.
* **Reservation Lifecycle:** Real-time booking creation, confirmation, reservation history, and self-service cancellations.
* **Guest Billing:** Real-time itemized bill inspection, breakdown of room charges, recorded service consumption, and payment history.

### 2. Front-Desk & Staff Operations
* **Staff Authentication:** Dedicated staff login with role-aware routing and branch scoping.
* **Check-In & Check-Out:** Validated check-in workflows preventing check-ins before scheduled arrival, and strict checkout prevention if outstanding dues remain.
* **Booking Management:** Live search by booking reference, guest ID/name, date-range modifications, and room reassignments.
* **Multi-Room Bookings:** Atomic reservations of multiple rooms under a single master booking reference.
* **Walk-In Reservations:** Front-desk booking creation for walk-in guests with instant customer profile generation.

### 3. Guest Services & Catalog Management
* **Service Catalogue:** Dynamic directory of amenities and guest services (meals, spa, transport, laundry).
* **Service Usage Logging:** Staff logging of amenities against active checked-in bookings with immediate price-locking at time of usage.
* **Catalogue Administration:** Manager/Admin creation, pricing updates, activation, and retirement of catalogue items.

### 4. Billing, Invoicing & Payments
* **Automated Bill Recalculation:** Trigger and procedure-driven bill adjustments whenever rooms or services are logged.
* **Payment Processing:** Multi-method payments (Cash, Card, Bank Transfer) with receipt logging and balance settlement.
* **Zero-Balance Checkout Guard:** Database procedure verification ensuring bills are fully settled prior to checkout.

### 5. Management Reports & Business Intelligence
1. **Room Occupancy Report:** Real-time status snapshots or interval occupancy calculations across date ranges (`startDate` & `endDate`).
2. **Guest Billing Summary:** Comprehensive accounts receivable overview with an `outstandingOnly` filter for unpaid balances.
3. **Service Usage Breakdown:** Itemized consumption analysis per room number and service type.
4. **Monthly Revenue per Branch:** Financial breakdown segregating room revenue and service revenue for finalized bookings.
5. **Top-Used Services & Preference Trends:** Service popularity rankings, customer preference percentage shares, and month-over-month demand trends.

### 6. Executive Operations Dashboard
* Real-time metrics: Today's scheduled arrivals/departures, live occupancy rate, current room statuses, active bookings, and today's cash collections.

---

## 👥 Team Member Contributions

The system was designed, developed, and tested through coordinated teamwork among the group members:

---

### 1. Sharaf M.F.M. — `240619V`(Sharaf0713)
* **Backend Architecture — Booking, Billing & Payments:**
  * Implemented backend business logic for reservation handling, room charging, and payment processing.
  * Integrated payment gateways and receipt generation workflows.
* **Database Design & Routines:**
  * Designed and indexed core relational tables: `BOOKING`, `BILL`, and `PAYMENT`.
  * Authored core financial stored procedures:
    * `sp_recalculate_bill` — Dynamic recalculation of gross bills upon service or room changes.
    * `sp_log_service_usage` — Atomic logging of guest services and price snapshots.
    * `sp_process_payment` — Secure payment execution, balance reconciliation, and status updates.

---

### 2. Lakshan G.D.T. — `240378E`(lakshangamage15)
* **Frontend User Interfaces:**
  * **Guest Authentication & Account:** Developed `GuestLogin.jsx`, `GuestRegister.jsx`, and `GuestProfile.jsx`.
  * **Room Booking Interface:** Built `makebooking.jsx` with real-time date selection, room type filtering, and procedure integration.
  * **Staff Operations:** Developed `staffBillDetails.jsx` and `staffPayment.jsx` for front-desk operations.
  * **Management UI:** Designed initial layout for manager report screens (`ManagerReports.jsx`).
* **Database Design & Procedures:**
  * Designed structural tables: `ROOM_TYPE`, `AMENITY`, `ROOM_TYPE_AMENITY`, `ROOM`, `GUEST`, `GUEST_ACCOUNT`, and `BOOKED_ROOMS`.
  * Authored reservation procedures:
    * `sp_make_booking` — Core reservation procedure with availability locks.
    * `sp_update_booked_rooms` — Reservation date and room modification routines.

---

### 3. Rathnayaka K.A.A.T. — `240561J`(Anushka-Rathnayaka)
* **Frontend Development & User Experience:**
  * Developed and enhanced guest authentication, room search, booking flow, bill history, and service ordering.
  * Improved staff interfaces: booking lists, detailed guest cards, service usage entry, and checkout screens.
  * Implemented manager administrative interfaces for branches, room types, rooms, amenities, and Admin staff creation.
  * Connected manager dashboard and report interfaces to backend APIs with responsive data tables.
  * Integrated multi-room and receptionist booking workflows into the shared UI.
  * Implemented code-splitting, bundle optimization, responsive navigation, loading states, and error recovery.
* **Backend & Database Support:**
  * Built service-catalogue management APIs (create, edit, retire, reactivate) with conflicting-edit guards.
  * Implemented strict branch scoping across staff booking, service logging, and billing endpoints.
  * Added receptionist search and walk-in guest creation endpoints.
  * Optimized dashboard metric queries and payment history queries.
  * Configured MySQL runtime privilege restrictions and maintenance security policies.
  * Integrated audit trail logging and resolved multi-room service duplicate charge queries.
* **Testing, Integration & Project Coordination:**
  * Authored regression test suites, conducted production build validations, resolved merge conflicts, and maintained documentation.

---

### 4. Kavindi P.V.O. — `240343T`(oshini1003)
* **Backend — Authentication & Access Control:**
  * Implemented enterprise-grade JWT authentication with **Refresh Token Rotation** (`/api/auth/refresh`).
  * Implemented Bcrypt password hashing and secure credential validation for both guests and staff.
  * Built Role-Based Access Control (RBAC) middleware supporting `Admin`, `Manager`, `Receptionist`, and `ServiceStaff`.
  * Developed secure password change endpoints (`/api/auth/guest/password`, `/api/auth/staff/password`) with active token revocation.
* **Backend — Management Reports & Analytics Engine:**
  * Built all 5 Core Management Report APIs:
    1. **Room Occupancy Report** (`/api/reports/occupancy`) — Real-time snapshots and custom date/period overlap calculations.
    2. **Guest Billing Summary** (`/api/reports/billing-summary`) — Accounts receivable breakdown with `outstandingOnly` filtering.
    3. **Service Usage Breakdown** (`/api/reports/service-usage`) — Per-room and per-service usage analytics with room/service filters.
    4. **Monthly Revenue Report** (`/api/reports/revenue`) — Branch revenue segregation by room and service charges.
    5. **Top-Used Services & Trends** (`/api/reports/top-services`) — Popularity rankings, preference share percentage, and month-over-month trend analytics.
  * Developed the Executive Operations Dashboard backend (`/api/dashboard/admin`).
* **Database & Security:**
  * Designed and implemented database user-defined functions (`fn_calculate_outstanding_balance`).
  * Implemented `REFRESH_TOKEN` table with SHA-256 token digest storage and audit trail tables (`AUDIT_LOG`).
* **Cloud Infrastructure & Testing:**
  * Configured cloud MySQL database deployment on **Aiven.io** (with SSL/TLS connection pool configuration).
  * Maintained API documentation and conducted Postman and Thunder Client testing across all endpoints.

---

### 5. Nanayakkara T.S. — `240451X`(semaleenanayakkara)
* **Backend — Reservation & Stay Lifecycle:**
  * Developed complete booking lifecycle endpoints: create reservation, cancel reservation, check-in, and check-out.
  * Built booking search and detail endpoints with stay status resolution.
  * Implemented booking modification APIs allowing guests and staff to change rooms or stay dates prior to check-in.
  * Extended backend endpoints to support **multi-room bookings** in a single transaction via `BOOKED_ROOMS`.
* **Backend — Service Consumption Management:**
  * Built service catalogue read and search endpoints.
  * Implemented service usage recording endpoints (`/api/services/usage`) connecting stays with the service catalogue.
  * Built itemized service consumption history endpoints per booking.

---

## 🚀 Quick Start / Local Setup Guide

### Prerequisites
* **Node.js** (v18.x or v20.x recommended)
* **MySQL Server** (v8.0 or later running locally on port `3306`)
* **Git**

---

### Step 1: Clone the Repository
```powershell
git clone https://github.com/oshini1003/SkyNest_Hotels.git
cd SkyNest_Hotels
```

---

### Step 2: Set Up the Database
1. Open MySQL Workbench, DBeaver, or the MySQL CLI.
2. Execute the database files located in `backend/Database/` in this exact order:
   ```text
   1. backend/Database/schema.sql
   2. backend/Database/functions.sql
   3. backend/Database/procedures.sql
   4. backend/Database/triggers.sql
   5. backend/Database/seeds.sql
   ```

---

### Step 3: Configure Environment Variables
In the `backend/` directory, create a `.env` file:

```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=SkyNest_Hotels
JWT_SECRET=your_super_secret_jwt_access_key
JWT_REFRESH_SECRET=your_super_secret_jwt_refresh_key
CORS_ORIGIN=http://localhost:5173,http://localhost:5174,http://localhost:4173
```

---

### Step 4: Run the Application

Open two separate terminals:

#### Terminal 1 — Backend API:
```powershell
cd backend
npm install
npm run dev
```
*API will run at:* `http://localhost:5000/api`

#### Terminal 2 — Frontend Application:
```powershell
cd frontend
npm install
npm run dev
```
*Frontend will run at:* `http://localhost:5173`

---

## 🔑 Demo Credentials

Seeded test accounts available in `backend/Database/seeds.sql`:

| Role | Username | Password | Branch Scope | Permissions |
|---|---|---|---|---|
| **Guest** | `oshini` | `guest123` | All | Room booking, personal profile, bill view |
| **Guest** | `kasun` | `guest123` | All | Room booking, personal profile, bill view |
| **Admin** | `admin` | `staff123` | Global | System administration, staff onboarding, all reports & dashboard |
| **Manager** | `nimal` | `staff123` | Colombo | Management reports, branch operations, service catalogue |
| **Receptionist** | `amali` | `staff123` | Colombo | Guest check-in, checkout, walk-in bookings, payment recording |
| **Service Staff** | `sunil` | `staff123` | Colombo | Logging room service, laundry, spa orders |

> ⚠️ *Note: Always update default credentials before deploying to a public production environment.*

---

## 🧪 Verification & Automated Testing

### 1. Database-Free Unit & Regression Checks
From the project root:
```powershell
node backend/tests/booking-regression.cjs
node backend/tests/service-usage-regression.cjs
node backend/tests/payment-regression.cjs
node backend/tests/checkout-regression.cjs
node backend/tests/report-regression.cjs
```

### 2. Frontend Production Build Check
```powershell
cd frontend
npm run build
```
*(Confirms TypeScript/JSX integrity, CSS bundle compilation, and zero build errors).*

---

## ☁️ Cloud Deployment Architecture

SkyNest Hotels is production-deployed across a modular, 3-tier cloud architecture:

* **Frontend Client (React 19 / Vite):** Hosted on **Vercel** with global CDN distribution and SPA rewrite routing (`vercel.json`).
  * Live URL: [https://sky-nest-hotels.vercel.app/](https://sky-nest-hotels.vercel.app/)
* **Backend API (Node.js / Express):** Hosted on **Render.com** as an auto-scaling web service.
  * Live URL: [https://skynest-backend.onrender.com](https://skynest-backend.onrender.com)
  * Health Endpoint: [https://skynest-backend.onrender.com/api/health](https://skynest-backend.onrender.com/api/health)
* **Database (MySQL 8):** Managed cloud cluster hosted on **Aiven.io** with TLS/SSL encryption (`DB_SSL=true`), automated failover, and strict transactional integrity.