# SkyNest Docker demo

Docker support for the tested project source at commit `476d3b3`.
The source code, existing SQL definitions and ordinary local development setup
remain the same. This adds container build files and a Docker-only initializer.

## Start on Windows

Prerequisites: Docker Desktop running in Linux-container mode with WSL 2, Git,
and the Node.js installation already used for SkyNest. Run the following from
the project root, `C:\Users\ASUS TUF\SkyNest_Hotels`, after applying the patch:

```powershell
node docker/setup.cjs
docker compose config --quiet
docker compose up --build -d
docker compose ps -a
```

Run each command only after the previous one succeeds. `setup.cjs` runs once:
it creates a project-root `.env` with four independent random secrets. It never
overwrites an existing file. The existing `.gitignore` already excludes `.env`.
Keep this private file for future starts; do not commit it. `backend/.env` is not
read by the containers and is not changed.

The first build needs internet access to download Docker base images and npm
dependencies. Open **http://localhost:8080** when frontend, backend and db are
healthy. `db-init` finishing with **Exited (0)** is expected.

The web port is bound to this laptop only. If port 8080 is busy, change
`WEB_PORT` in the root `.env` to `8081`, run `docker compose up -d` again and use
http://localhost:8081. The internal API port remains 5000 and MySQL remains 3306.
Neither API nor MySQL is published directly on the host, so the existing local
MySQL service can keep running.

## Demo logins

These are the project's existing seeded accounts in the **new Docker database**.
They are separate from accounts you created in your ordinary Windows database.
The seed password hashes were checked against these passwords.

| Login page | Username | Password | Role |
| --- | --- | --- | --- |
| Guest | `oshini` | `guest123` | Guest |
| Guest | `kasun` | `guest123` | Guest |
| Staff | `admin` | `staff123` | Admin |
| Staff | `nimal` | `staff123` | Manager |
| Staff | `amali` | `staff123` | Receptionist |
| Staff | `sunil` | `staff123` | ServiceStaff |

This is a local grading/demo configuration with known demo logins, not a public
hosting configuration. Production builds correctly hide development-only
preview pages. Real connected pages remain available.

## What runs

| Service | Purpose | Persistence |
| --- | --- | --- |
| `frontend` | Node 24 builds React/Vite; nonroot Nginx serves it and proxies `/api` | Static image |
| `backend` | Node 24/Express with production npm dependencies; nonroot user | Database only |
| `db` | Official MySQL 8.4 LTS image | Named volume `skynest-docker_mysql_data` |
| `db-init` | One-shot setup, then exits successfully | Marker in the same MySQL volume |

Three services stay running. Compose first waits for MySQL to accept TCP
connections, then for initialization to complete, then for the API and database
health check to pass. Nginx resolves the backend through Docker's internal DNS.
The browser only needs the frontend address. Both frontend and backend use
read-only root filesystems with temporary space in `/tmp`.

The Docker demo targets MySQL **8.4 LTS**; your Windows MySQL installation is
9.7.1. The Docker database is a fresh instance, not an in-place downgrade or a
copy of that database. Live SQL and application compatibility must be verified
by the container checks below before marking this work complete.

## Database initialization and restart behavior

The application schema is `SkyNest_Integration_Docker`. The initializer reuses
the existing parser and imports only:

1. `backend/Database/tables.sql`
2. `backend/Database/functions.sql`
3. `backend/Database/schema.sql`
4. `backend/Database/seed.sql`

Other SQL fragments repeat definitions and must not also be imported.
The expected application schema has 17 tables, 4 functions, 7 procedures and
8 triggers. Seed data includes 3 branches, 7 rooms, 4 services and a sample
future booking. SQL and Node timezones are aligned to Sri Lanka.

Initialization uses the database root account only inside `db-init`. The API
receives a separate `skynest_app` account with explicit table/column/routine
privileges, including current property management operations. It has no schema
DDL or user-management privileges. Writes to bills, payments, service usage and
audit records go through the project's routines/triggers.

A separate `skynest_docker_meta` schema records successful initialization.
Later starts validate and reuse the existing database; they do not reseed or
reset passwords. An interrupted or mismatched setup stops for inspection.
There is no automatic drop or reset. Keep the generated `.env` together with
the existing Docker volume: changing credentials in `.env` does not change
existing MySQL account passwords.

## Verify before claiming the containerization bonus

After all three long-running services are healthy:

```powershell
node docker/smoke.cjs
```

For a changed web port:

```powershell
node docker/smoke.cjs http://localhost:8081
```

This checks actual HTTP responses through Nginx, static files/SPA routing, public
database-backed pages and the seeded guest/staff logins. It creates and revokes
temporary authentication sessions; it does not create bookings or payments.

Also demonstrate a real workflow in the browser using this Docker database:

1. Guest login, room search, create a future booking, view its bill.
2. Staff login, open the booking, record an allowed service and verify its charge.
3. Complete the appropriate payment/check-in/check-out flow for eligible demo dates.
4. Check manager dashboard/reports and role restrictions.
5. Note the booking ID or another record you created. Stop/recreate containers
   with the commands below, sign in again and confirm that record still exists.

Use new demonstration records in the Docker database. The first-boot sample
booking is in the future; check-in must follow the application's date rules.

```powershell
docker compose down
docker compose up -d
docker compose ps -a
```

`down` without `--volumes` retains data. **Do not add `-v` or `--volumes`** if
you want to keep the Docker database. Likewise do not remove this project's
volume in Docker Desktop. Stopping Docker or closing a terminal is not a reset.

For grading, show the Compose file, Docker Desktop's running containers, a
working browser flow and persistence after recreation. Containerization is
one listed bonus feature; the evaluator determines the final mark.

## Troubleshooting

```powershell
docker compose ps -a
docker compose logs --tail=80 db-init backend frontend
docker compose logs --tail=80 db
```

Send the relevant error, not `.env` contents or a full `docker compose config`
dump (which includes interpolated secrets).

- `db-init` Exited (0): normal; its job is complete.
- `db-init` nonzero: read its logs. Do not repeatedly import SQL or delete volumes.
- Image download/network error: restore access to Docker Hub/npm, then rerun `up`.
- Credentials changed with an existing volume: restore the original private
  `.env`; do not expect the initializer to replace account passwords.
- Frontend health succeeds but API fails: inspect backend and db-init logs.
- No old Windows data: expected; Docker has its own seeded database.
- Updating application code: run `docker compose up --build -d`. Database schema
  changes require a reviewed migration; the initializer is not a migration tool.

## Local checks and verification limits

The delivery environment has Node.js but no Docker daemon or MySQL server.
Checks completed there are listed in `docker/VERIFICATION.md`. A successful
frontend build and mock initialization tests do not replace the live Docker
startup, login, write-workflow and persistence checks above.

After those checks pass, review and commit the added files on the Docker working
branch. Keep the root `.env` and `tsauth-regression.cjs` out of that commit.
Do not mark the container demo as complete merely because the files exist.

## References

- [Docker Compose startup order](https://docs.docker.com/compose/how-tos/startup-order/)
- [Docker Compose volumes](https://docs.docker.com/reference/compose-file/volumes/)
- [Official MySQL image](https://hub.docker.com/_/mysql)
- [Official Node image](https://hub.docker.com/_/node)
