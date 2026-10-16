# Student backend database pooling

The shared `backend/pool_psycopg.py` is reused without rewriting its sizing,
fallback, health check or application-name tagging. Each worker owns one
`AsyncConnectionPool`; routes, student analysis and AI usage logging use it.
Database SQL and API paths remain unchanged. Database operations are awaited;
blocking AI HTTP/S3 operations used by converted routes run in worker threads.

## Settings

Read through `backend/settings.py` (pydantic-settings), not os.getenv:

```env
DB_SERVICE_SLOTS=12
DB_POOL_RESERVE=0.2
```

Use `DB_SERVICE_SLOTS=40` on staging. Slots count the workers/services sharing
the database; this value is not the number of connections in each pool. Restart
after changing configuration. Settings load backend/.env and process environment.
The existing main.py dotenv loading uses override=True, so backend/.env wins for
duplicate values at application import; keep service and file settings consistent.

The shared helper uses `max(2, floor(max_connections * (1-reserve) / slots))`.
`min_size` is always 1. With max_connections=80, reserve=0.2, ceilings are 5 for
12 slots and 2 for 40 slots. These are ceilings, not idle floors. The helper's
minimum ceiling of 2 means sizing is not an absolute guarantee against exhausting
the database when many services/workers are configured; validate the full budget.

At startup a short, synchronous SHOW max_connections probe computes the size;
it runs off the event loop and closes immediately. The helper falls back to 80
if the probe fails. Persistent pooled connections open lazily on the first DB
request. /health does not open them; /health/db does. Shutdown closes the pool.
Pool acquisition timeout returns HTTP 503 for normal routes. Logging failures
remain best-effort and do not fail an otherwise successful AI response.

## Verification before deployment

```bash
cd backend
python -m pip install -r requirements.txt
python -m pip install httpx
python -m unittest discover -s tests -v
```

The default tests use fake database connections. They verify settings, sizing/fallback,
lazy lifecycle, concurrent first requests, route behavior and usage logging.
For a disposable local PostgreSQL instance, opt into the additional real integration
test by setting `POOL_TEST_DATABASE_URL` before the test command. It verifies
actual session reuse, application-name tagging, commit/rollback, lazy opening,
pool ceiling/timeout and shutdown. It is restricted to localhost and creates
only a session-local temporary table. Do not point tests at production.

Verification completed on 17 October 2026: offline tests and the real PostgreSQL
integration test passed against an isolated PostgreSQL 15 instance. Neither running
EC2 backend nor production RDS was changed or tested by this local verification.

## Deploy after review

1. Review the branch diff and ensure the target server checkout is clean apart
   from known local environment/runtime files. Do not overwrite credentials.
2. Back up the current commit ID and configuration. Merge/deploy the reviewed
   branch using your team's normal deployment process. This change does not
   automatically alter either running server.
3. Install backend/requirements.txt with the exact Python environment used by
   the existing service (some servers use .venv, others venv).
4. Set slots for the correct environment. Restart only the student backend
   service on port 8004; confirm its service name before doing so.
5. Check logs for `DB pool for sgs-student-api: idle 1, burst to ... (slots=...)`.
6. Query the DB before a DB-backed request, then after a page load:

```sql
SELECT application_name, state, count(*)
FROM pg_stat_activity
WHERE application_name = 'sgs-student-api'
GROUP BY application_name, state;
```

With one worker and no DB-backed health probes or traffic: no tagged persistent
connections immediately after restart; after a sequential DB request, one idle
connection. Real traffic/concurrency can grow the pool above one up to its ceiling;
extra idle connections shrink after max_idle=300 seconds. Multiple workers each
have their own pool. Five idle connections are not by themselves proof of a wrong
slots setting: also check traffic, worker count, and the startup sizing log.

Exercise student dashboard/progress, analysis, quiz save, assignment submission and
AI logging against a staging database before production release. Confirm commits
and rollbacks, repeat requests, and acquisition timeout behavior. If verification
fails, redeploy the previous commit and restart the same backend service.
