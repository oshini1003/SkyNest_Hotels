# Docker delivery verification

Prepared on 12 October 2026 for the uploaded source at commit `476d3b3`.

## Completed in the preparation environment

- Installed frontend and backend dependencies from the supplied lockfiles.
- Built the production frontend successfully with `VITE_API_URL=/api` under
  Node 24.19.0. The existing app's pages and service photographs are included.
- Passed `backend/tests/integration-setup-files-regression.cjs`: canonical SQL
  inventory/order, duplicate-fragment consistency, balance logic and guarded
  fresh setup. This uses static SQL and a mock connection, not live MySQL.
- Passed `backend/tests/auth-regression.cjs`: real JWT/validation checks and
  mocked database transaction/auth behavior.
- Passed all 9 `backend/docker/initialize.test.cjs` tests: fresh import order,
  repeat-start preservation, incomplete/mismatched database refusal, competing
  initializer/account refusal, failed-import handling, failed runtime/marker
  handling, restricted grants, configuration checks and the real seeded hashes.
- Parsed Compose YAML and checked service dependencies, internal database
  networking, loopback-only web publication and separation of root credentials
  from the API environment. Docker Compose CLI validation is still pending.
- Checked secret generation for four distinct 64-character random hex values,
  refusal to overwrite an existing root `.env`, and preservation of
  `backend/.env` in a temporary directory.
- Syntax-checked the added Node scripts. Exercised the HTTP smoke script against
  a temporary fake server, including cleanup when Admin login fails and rejection
  of external origins. This validates the test script, not the real application.
- Checked that the delivered patch applies to an untouched extraction of the
  uploaded archive and adds files without modifying any existing source file.

## Still required on the Windows laptop

The preparation environment has no Docker daemon, Nginx executable or MySQL
server. None of these is claimed as complete:

- Docker image builds and `docker compose config --quiet`.
- Fresh MySQL 8.4 startup, SQL import and real permission verification.
- Three healthy long-running containers and successful one-shot `db-init`.
- `node docker/smoke.cjs` against the actual containers.
- Browser booking/service/payment workflow and role checks.
- Data persistence after `docker compose down` and `docker compose up -d`.

Use `DOCKER.md` for these steps. Once they pass, record the results in the
project before presenting containerization as a completed bonus feature.
