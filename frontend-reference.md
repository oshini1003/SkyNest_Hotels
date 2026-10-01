# HRGSMS Frontend

Plain HTML/CSS/JS web client for SkyNest Hotels, served by a small Express
static server (no build step / framework required).

## Setup

```bash
npm install
cp .env.example .env
npm start        # http://localhost:3000
```

If your backend isn't running at `http://localhost:5000/api`, edit
`public/js/config.js`:

```js
const HRGSMS_API_BASE = 'http://localhost:5000/api';
```

## Pages

| Page | Who it's for |
|---|---|
| `index.html` | Landing page — choose guest or staff |
| `guest-login.html` / `guest-register.html` | Guest authentication |
| `guest-portal.html` | Search & book rooms, view bookings, request services, view bill |
| `staff-login.html` | Staff authentication |
| `staff-dashboard.html` | Front desk: find booking, check-in/out, log services, record payments |
| `manager-dashboard.html` | Manager/Admin: reports, manage rooms/room types/services |

## Structure

```
public/
├── css/style.css     Shared design system
├── js/config.js      Backend API base URL
├── js/api.js         Fetch wrapper + auth/session helpers (localStorage-based)
└── *.html            One file per page - no build step
server.js             Express static file server
```
