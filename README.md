# SkyNest Hotels — Hotel Reservation & Guest Services Management System (HRGSMS)

CS3043 Database Systems — Group 36

A hotel reservation and guest services system for **SkyNest Hotels**, a fictional
three-branch chain in Colombo, Kandy, and Galle.

| Directory | Contents |
| --- | --- |
| `backend/` | Node.js and Express REST API |
| `backend/Database/` | MySQL schema, triggers, procedures, functions, seed data and maintenance tools |
| `frontend/` | React application built with Vite |
| `docs/` | Grading readiness and evidence notes |

Start with [Grading readiness](docs/GRADING_READINESS.md) for the implemented
workflows, remaining gaps and demonstration evidence.

## Run the existing local project on Windows

Keep MySQL running and preserve the existing integration database and local
`backend/.env`. **Do not run setup, import `schema.sql`, seed or reset an existing
database.** The backend uses its configured restricted runtime account; keep
maintenance credentials separate.

Open two PowerShell terminals at the repository root.

Backend terminal:

```powershell
cd .\backend
npm ci
npm run dev
```

Frontend terminal:

```powershell
cd .\frontend
npm ci
npm run dev
```

The API normally runs at `http://localhost:5000/api`. Open the **Local** URL
printed by Vite, normally `http://localhost:5173`. The frontend defaults to this
API address. For a different address, set `VITE_API_URL` in a local frontend
environment file and restart Vite; the backend must allow the frontend origin.
Database credentials and JWT signing secrets belong only in the backend.

To check the production frontend, run `npm run build` then `npm run preview`
from `frontend`. Build output is written to `frontend/dist`; preview serves the
last build and does not start the API. Fictional development preview pages are
excluded from production routes.

For a **new, separate database**, follow the [backend setup guide](backend/README.md#setup)
and [restricted database account policy](backend/Database/DATABASE_SECURITY.md).
The project targets MySQL; the reported local environment is MySQL Community
9.7.1 on Windows. MariaDB compatibility is not established. Do not substitute a
fresh-database installation for an update to the existing integration database.

See the [backend API documentation](backend/README.md) and
[frontend documentation](frontend/README.md) for configuration and checks.

## Demo accounts from `backend/Database/seed.sql`

These fictional seed accounts are for local coursework demonstrations. Existing
database passwords may have been changed; do not reseed to restore them.

| Role | Username | Password |
| --- | --- | --- |
| Guest | `oshini` | `guest123` |
| Guest | `kasun` | `guest123` |
| Admin | `admin` | `staff123` |
| Manager (Colombo) | `nimal` | `staff123` |
| Receptionist (Colombo) | `amali` | `staff123` |
| Service Staff (Colombo) | `sunil` | `staff123` |

Change demo credentials before public deployment.

## Architecture

- **Database** — MySQL triggers, stored procedures and functions enforce booking
  overlap checks, room status changes, billing, payment limits and audited hotel
  workflows. The runtime account has reviewed table, column and routine grants;
  maintenance uses separate credentials.
- **Backend** — Express REST API with access JWTs, rotating refresh-token digests
  stored in MySQL, guest ownership checks and role-based access for Admin,
  Manager, Receptionist and ServiceStaff. Receptionist/ServiceStaff booking,
  billing and service access is limited to their assigned branch; room-status
  changes are also scoped. Existing databases need the matching
  [staff branch migration](backend/Database/STAFF_BRANCH_ACCESS.md) before restart.
- **Frontend** — React, JavaScript and CSS with Vite development and production
  builds. It communicates with the backend through the REST API.

`GUEST_ACCOUNT.PasswordHash` and `STAFF_ACCOUNT.PasswordHash` store bcrypt hashes.
The implementation does not store guest or staff passwords as plaintext.

## License

Academic project for CS3043 Database Systems — SkyNest Hotels is a fictional
client created for this coursework.
