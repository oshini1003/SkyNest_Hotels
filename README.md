# SkyNest Hotels — Hotel Reservation & Guest Services Management System (HRGSMS)

CS3043 Database Systems — Group 36

A hotel reservation and guest services system for **SkyNest Hotels**, a
three-branch chain in Colombo, Kandy, and Galle. Built as three independent
projects, matching the team's approved ER Diagram (`docs/ERD.png`):

```
HRGSMS/
├── database/    MySQL/MariaDB schema, triggers, procedures, functions, seed data
├── backend/     Node.js + Express REST API
├── frontend/    Node.js + Express web client (HTML/CSS/vanilla JS)
└── docs/        SRS and the ER diagram
```

Each folder is self-contained with its own `package.json` / SQL scripts, so
they can be run, deployed, or graded independently.

---

## 1. Database setup

Requires MySQL 8.0+ or MariaDB 10.6+.

```bash
cd database
mysql -u root -p < schema.sql   # creates the hrgsms database, tables, triggers, procedures, functions
mysql -u root -p hrgsms < seed.sql   # optional sample data (branches, rooms, demo accounts)
```

Create a dedicated application user (recommended over using root):

```sql
CREATE USER 'hrgsms_app'@'localhost' IDENTIFIED BY 'choose_a_password';
GRANT ALL PRIVILEGES ON hrgsms.* TO 'hrgsms_app'@'localhost';
FLUSH PRIVILEGES;
```

See `database/README.md` for the full schema notes, including the business
logic implemented as triggers/procedures/functions.

## 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env     # then fill in DB_USER / DB_PASSWORD / JWT_SECRET
npm start                 # http://localhost:5000
```

See `backend/README.md` for the full API reference.

## 3. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
# Edit public/js/config.js if your backend isn't at http://localhost:5000/api
npm start                 # http://localhost:3000
```

## Demo accounts (from seed.sql)

| Role | Username | Password |
|---|---|---|
| Guest | `oshini` | `guest123` |
| Guest | `kasun` | `guest123` |
| Admin | `admin` | `staff123` |
| Manager (Colombo) | `nimal` | `staff123` |
| Receptionist (Colombo) | `amali` | `staff123` |
| Service Staff (Colombo) | `sunil` | `staff123` |

**Change these before deploying anywhere public.**

---

## Architecture

- **Database** — MySQL/MariaDB. Business rules (overlap prevention, room
  status sync, billing, outstanding-balance checks) are enforced at the
  database level via triggers, stored procedures and functions — not just in
  application code — so the data stays consistent even if the API is
  bypassed.
- **Backend** — Express REST API. Stateless JWT authentication (no
  server-side session store), so multiple front-desk terminals and guest
  devices can be signed in concurrently without conflicts. Role-based access
  control for Admin / Manager / Receptionist / ServiceStaff / Guest.
- **Frontend** — Plain HTML/CSS/JS served by a small Express static server.
  No build step required. Talks to the backend purely over its REST API.

## A note on the ER diagram vs. this implementation

One deliberate deviation from the diagram: `GUEST_ACCOUNT.Password` and
`STAFF_ACCOUNT.Password` are implemented as `PasswordHash`, storing a bcrypt
hash rather than plaintext. Storing real passwords in plaintext is never
acceptable, even though the diagram itself labels the column "Password".

## License

Academic project for CS3043 Database Systems — SkyNest Hotels is a fictional
client created for this coursework.
