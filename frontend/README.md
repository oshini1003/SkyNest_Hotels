# SkyNest Hotels — Frontend Client

> **React 19 & Vite Single Page Application (SPA)**  
> Modern, responsive guest reservation portal and staff management client for **SkyNest Hotels**, communicating with the Node.js/Express backend REST API.

---

## 📌 Table of Contents
- [Overview & Architecture](#-overview--architecture)
- [Key Features & Workflows](#-key-features--workflows)
- [Project Structure](#-project-structure)
- [Quick Start / Local Setup](#-quick-start--local-setup)
- [Environment Configuration](#-environment-configuration)
- [Application Routes & Access Control](#-application-routes--access-control)
- [Session Management & Security](#-session-management--security)
- [Production Build & Cloud Deployment](#-production-build--cloud-deployment)

---

## 🌐 Overview & Architecture

The SkyNest Hotels frontend is built as a fast, accessible, client-side rendered Single Page Application. It provides two distinct, fully decoupled experiences within a unified theme:
1. **Public Guest Portal:** Room availability search, multi-room bookings, guest profiles, stay history, and itemized billing.
2. **Staff Operations Workspace:** Front-desk booking administration, guest check-in/checkout, amenity usage logging, payment collection, executive dashboard, and management reports.

```
┌────────────────────────────────────────────────────────┐
│                   Vite / React 19 SPA                  │
│       React Router • Scoped CSS • Defensive API Layer  │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP / JSON (Bearer JWT)
┌───────────────────────────▼────────────────────────────┐
│               SkyNest Hotels Backend API               │
│                   http://localhost:5000/api            │
└────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features & Workflows

### 1. Guest Experience
* **Room Availability Search:** Dynamic search filtering by branch, stay dates, guest capacity, and room categories with live availability pre-checks.
* **Multi-Room Booking:** Allows selecting up to 10 rooms with individual guest counts in one atomic reservation submission.
* **Booking Management & Modifications:** View upcoming reservations, change stay dates or rooms before check-in, or cancel bookings.
* **Guest Billing:** Real-time inspection of itemized invoices, room charges, consumed amenities at price-at-usage, and payment receipts.
* **Profile & Security:** View/edit contact details and change password with instant token revocation.

### 2. Staff Operations
* **Role-Aware Workspaces:** Automatic UI adaptation for `Receptionist`, `ServiceStaff`, `Manager`, and `Admin`.
* **Branch Scoping:** Receptionists and Service Staff are strictly locked to their assigned branch, while Managers and Admins can view all branches or filter by branch.
* **Front-Desk Check-In & Checkout:** Validates stay arrival dates before check-in; strictly enforces zero-balance payment settlement before checkout.
* **Walk-In Guests:** Front-desk creation of walk-in guest records and instant booking creation.
* **Service Logging:** Front-desk and service staff can log room service, laundry, and amenities against active bookings.
* **Payment Processing:** Record guest payments via Cash, Card, or Bank Transfer with instant balance updates.

### 3. Business Intelligence & Reports (Manager / Admin)
* **Interactive Management Reports:**
  1. *Room Occupancy:* Live snapshot or interval period calculations (`startDate` & `endDate`).
  2. *Billing Summary:* Accounts receivable breakdown with `Only bills with outstanding balances` filter.
  3. *Service Usage Breakdown:* Itemized consumption grouped by room number and service type.
  4. *Monthly Revenue:* Segregates room revenue and service revenue grouped by bill-opened month.
  5. *Top-Used Services & Trends:* Popularity rankings, preference share percentage, and month-over-month demand trends.
* **Executive Dashboard:** Live KPI cards for today's scheduled arrivals/departures, room occupancy rate, and today's cash collections.

---

## 📁 Project Structure

```
frontend/
├── public/                 # Static brand assets and favicons
├── src/
│   ├── assets/             # Bundled hotel imagery and icons
│   ├── components/         # Shared UI components (Navigation, Layout, Modal, Header)
│   ├── pages/              # View pages
│   │   ├── GuestLogin.jsx / GuestRegister.jsx / GuestProfile.jsx
│   │   ├── RoomSearch.jsx / MakeBooking.jsx / MyBookings.jsx / GuestBill.jsx
│   │   ├── StaffLogin.jsx / StaffHome.jsx / StaffBookingList.jsx / StaffBilling.jsx
│   │   ├── ManagerDashboard.jsx / ManagerReports.jsx / ManagerServices.jsx
│   │   └── Branches.jsx / ServiceCatalogue.jsx
│   ├── services/           # API integration clients with client-side validation
│   │   ├── session.js      # Session storage & JWT expiry listeners
│   │   ├── guestApi.js / staffAuth.js
│   │   ├── bookingApi.js / staffBookingApi.js
│   │   ├── billingApi.js / guestBillingApi.js
│   │   ├── serviceCatalogueApi.js
│   │   └── reportApi.js    # Strict validation & row integrity checks
│   ├── App.jsx             # Route definitions & top-level session providers
│   ├── App.css             # Design tokens, color palette, responsive typography
│   └── main.jsx            # Application entrypoint
├── index.html              # HTML shell
├── vite.config.js          # Vite build configuration & code-splitting
├── package.json
└── vercel.json             # SPA routing rewrite rule for cloud hosting
```

---

## 🚀 Quick Start / Local Setup

### 1. Install Dependencies
```powershell
cd frontend
npm install
```

### 2. Configure Environment
Create a `.env` file in the `frontend/` directory (optional for local development):
```env
VITE_API_URL=http://localhost:5000/api
```
*(Defaults to `http://localhost:5000/api` if omitted).*

### 3. Run Development Server
```powershell
npm run dev
```
Open the local URL in your browser: `http://localhost:5173`

---

## 🗺 Application Routes & Access Control

| Route | View Component | Access Role | Description |
|---|---|---|---|
| `/` | `Home.jsx` | Public | Hotel landing page and stay search form |
| `/branches` | `Branches.jsx` | Public | Directory of hotel branches |
| `/rooms` | `RoomSearch.jsx` | Public | Real-time room availability search |
| `/services` | `ServiceCatalogue.jsx` | Public | Hotel amenities and service catalogue |
| `/guest/login` | `GuestLogin.jsx` | Public | Guest sign-in |
| `/guest/register` | `GuestRegister.jsx` | Public | Guest registration |
| `/guest/profile` | `GuestProfile.jsx` | **Guest** | Personal account & password change |
| `/guest/bookings` | `MyBookings.jsx` | **Guest** | Active and past reservations |
| `/guest/bookings/:id/bill` | `GuestBill.jsx` | **Guest** | Itemized invoice & payment history |
| `/staff/login` | `StaffLogin.jsx` | Public | Staff portal sign-in |
| `/staff` | `StaffHome.jsx` | **Staff** | Staff home & quick operational shortcuts |
| `/staff/bookings` | `StaffBookingList.jsx` | **Staff** | Booking lookup, search, check-in, checkout |
| `/staff/bookings/:id/bill` | `StaffBilling.jsx` | **Staff** | Live billing, service usage, payment collection |
| `/staff/dashboard` | `ManagerDashboard.jsx` | **Manager / Admin** | Executive operations KPI monitor |
| `/staff/reports` | `ManagerReports.jsx` | **Manager / Admin** | Complete management reports and analytics |
| `/staff/services` | `ManagerServices.jsx` | **Manager / Admin** | Hotel service catalogue administration |

---

## 🔒 Session Management & Security

* **Independent Dual Sessions:** Guest sessions (`skynest_guest_session`) and Staff sessions (`skynest_staff_session`) are stored independently in `sessionStorage`. Logging into a staff account does not override an active guest session.
* **Token Expiry Awareness:** The frontend decodes the JWT `exp` payload on load and invalidates sessions cleanly upon expiration.
* **Defensive API Validation:** Services like `reportApi.js` strictly inspect all backend responses (e.g. verifying that $Occupied + Available + Maintenance = TotalRooms$) before passing data to UI components.

---

## 📦 Production Build & Cloud Deployment

### 1. Build for Production
```powershell
npm run build
```
Build output is optimized and written to `dist/` with chunk-splitting.

### 2. Preview Production Build Locally
```powershell
npm run preview
```

### 3. Deploy to Vercel (Cloud Hosting)
1. Push your code to GitHub.
2. In [Vercel](https://vercel.com), import the `SkyNest_Hotels` repository.
3. Set **Root Directory** to `frontend`.
4. Add Environment Variable:
   * `VITE_API_URL` = `https://your-backend-api.onrender.com/api`
5. Single Page Application (SPA) page refreshes are handled by [`vercel.json`](file:///c:/Users/USER/OneDrive/Desktop/projects/SkyNest_Hotels/frontend/vercel.json):
   ```json
   {
     "rewrites": [
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```
