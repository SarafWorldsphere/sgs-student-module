# Student backend SaaS setup

The `saas` branch starts at main commit `320dec0`. The existing local `main` branch is unchanged. This implements the five backend setup steps; it does not deploy or migrate production data.

## References

- `sgs-parent-module`, branch `saas`, reviewed at `ba94e299ebf9dfd9372cedb3c69c5b6769102383`.
- `sgs-frontend`, branch `saas`, `docs/saas/`, reviewed at `93c57af59a3f92ea9548a2bf758268cab26f546b`.
- `saraswati-tenant-kit`, main, tested at `e6a1321415d12c98698c393ffa48aa23b4866713`.

The required dependency in `backend/requirements.txt` follows kit main, as requested. The commit above records the version verified here.

## Install the shared kit

Use the backend virtual environment and install `backend/requirements.txt`. Git access to the private kit repository is required:

```text
saraswati-tenant @ git+https://github.com/SarafWorldsphere/saraswati-tenant-kit.git@main#subdirectory=python
```

Local verification used the reference checkout installed as a package into `.venv-saas`; kit source was not copied into the application.

## Create the sample database

Run the kit's own schema script from its checkout, using a local administrative connection:

```bash
createdb saraswati_sample
DATABASE_URL=postgresql://localhost/saraswati_sample ./scripts/apply.sh
```

The database must be disposable and separate from existing SGS/SSS databases. The script creates platform tables, the canonical school tables, tenant-stamping triggers, forced RLS policies, and the `saraswati_app` group role. Do not run the legacy `backend/migrations` scripts against this schema.

Create a separate LOGIN role with `NOSUPERUSER NOBYPASSRLS`, assign a private password, and grant it `saraswati_app`. Do not run the backend with the schema administrator. Copy `backend/.env.example` to an ignored `backend/.env`, replacing placeholder credentials. `DATABASE_URL` and `SARASWATI_DATABASE_URL` must identify this same sample database. The optional control URL must also point to its platform tables.

For this Windows verification, an isolated PostgreSQL 15 cluster used `127.0.0.1:55439` and database `saraswati_sample`. Git Bash ran the original `scripts/apply.sh`; a shell wrapper moved the database URL after the options for native Windows `psql.exe` compatibility. The application role is `saraswati_student_app`; its generated password remains only in ignored local configuration.

## Request and transaction behavior

- `main.py` installs the kit's `SchoolMiddleware`. Hostnames resolve through kit platform records; unknown hosts return 404 and suspended schools return 403. Browser tenant-ID headers do not select a school.
- `GET /public/tenant-config` returns the resolved school's public configuration through the kit.
- Every pooled checkout calls the kit's `apply_rls()` before yielding the connection. `tenant_session.py` bridges its synchronous API to the existing async psycopg connection; tenant SQL and host resolution stay in the kit.
- Explicit commits and rollbacks rebind the school before further statements. A missing school context, a superuser/bypass role, or unsupported dedicated-database isolation fails closed.
- SQL uses the kit's canonical unprefixed tables. Notification/profile conflict targets include `tenant_id`; assessment metrics use canonical assessment tables and preserve actual percentages.
- S3 material keys must pass the kit's tenant-prefix validator before presigning. Existing legacy keys need migration before use with this branch.

Shared RLS isolation is supported. Frontend tenant branding, login/JWT integration, feature-port work from the broader runbooks, dedicated database isolation, and production data/object migration remain separate rollout work.

## Verify locally

The integration suite seeds disposable SGS and SSS platform records (`sgs.localhost`, `sss.localhost`) and a suspended school. It deliberately gives both active schools the same student email to verify host isolation.

From the repository root, run the tests with the virtual environment where requirements are installed:

```bash
SAAS_TEST_ADMIN_URL=postgresql://LOCAL_ADMIN@127.0.0.1:55439/saraswati_sample \
python -B -m unittest discover -s backend/tests -v
```

`backend/.env` must contain the non-bypass app URL for that same local database. `SAAS_TEST_ADMIN_URL` permits fixture creation only on local `saraswati_sample`. Set optional `POOL_TEST_DATABASE_URL` to the app URL to include the existing real pool lifecycle test. Never use production credentials for these tests.

Coverage includes simultaneous school requests, reused connections, missing context, transaction rebinding, blocked cross-school inserts/updates, 13 read endpoints, assignment insert/update, repeated notification/profile writes, canonical percentages, and pool lifecycle/error handling.

After registering host records, start the backend from `backend` using its virtual environment, for example `python -m uvicorn main:app --port 8005`. Verify with a known Host header:

```bash
curl -H 'Host: sgs.localhost' http://127.0.0.1:8005/health/db
```

Plain `localhost` is intentionally rejected unless registered as a tenant domain. Successful DB health confirms connectivity; the isolation tests verify tenant separation.
