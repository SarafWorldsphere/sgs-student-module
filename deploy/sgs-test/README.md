# Student API wiring for the shared test server

This is a deployment configuration fix for the **student SaaS branch**. The test
frontend was built with `/api/v1`, which Nginx sends to the faculty backend. The
student `/students/current` request therefore returns 404. No separate student
backend was running when inspected. Rebuilding alone cannot fix the missing API.

Use `/home/ubuntu/demo/sgs-student-module` on the test server. The prepared layout:

| Component | PM2 process | Local port | Public path |
| --- | --- | --- | --- |
| Student Next.js | `demo-student` | 4102 | `/student` |
| Student FastAPI | `demo-student-api` | 4109 | `/api/student/` |

Ports must be checked for availability before deployment. Only Nginx's existing
HTTPS port is public. Keep existing login routes, faculty `/api/v1`, other
modules and their `.env` files intact. No OTP code or database migration is part
of this change. Do not run the legacy `backend/migrations` against the SaaS DB.

## Prepare before activation

1. Back up the current student source/commit, `.next`, student environment files,
   PM2 definitions and the active Nginx site file. Keep secrets in private
   server-side backups; never copy them into Git.
2. Use the student `saas` source including its pinned tenant-kit dependency.
   Use Python 3.11 (verified on this server) for `backend/.venv`; Python 3.14
   cannot install the pinned psycopg-binary 3.2.7 wheel on this ARM server.
   Install `backend/requirements.txt`; use Node 20 for the frontend. Do not
   upgrade tenant-kit independently of the platform schema: newer kit main
   expects `platform.tenant_features`, which this deployment does not have.
3. Preserve the existing student environment. Merge the values from
   `frontend.env.example`, replacing the incorrect `/api/v1`. Check higher-priority
   `.env.local`/production files for overrides. Leave the login URL empty so the
   browser uses the current origin; do not set it to `/` (which forms `//api/...`).
4. Configure **backend/.env**, not just the root frontend file, using the correct
   existing shared SaaS database and `NOSUPERUSER NOBYPASSRLS` application account.
   See `backend.env.example` for names. Preserve real AI/storage settings if used.
   Confirm the resolver can read the platform domains for both public test hosts.
   Python/libpq accepts `sslmode=require`; the existing Node-style `no-verify`
   URL setting is not accepted by psycopg. Preserve all connection credentials
   and explicitly configure the Python backend with a compatible SSL setting.
   Each host must map to its own active school. No browser tenant header should
   substitute for resolving the request host.
5. Build in a separate release directory with the intended frontend environment:
   `npm ci` then `npm run build`. Do not rebuild `.next` under the running service.
   Publish the build together with matching source and dependencies after checks.

## Activate the student components only

Run from the student repository root once the prepared release is installed:

```bash
ss -ltnp 'sport = :4109'
pm2 start deploy/sgs-test/ecosystem.config.cjs --only demo-student-api
curl --fail -H 'Host: sgs-test.swais.in' http://127.0.0.1:4109/health
curl --fail -H 'Host: sgs-test.swais.in' http://127.0.0.1:4109/health/db
```

If `demo-student-api` already exists, inspect its cwd/args before updating it;
do not start a second copy. Both curls must succeed before changing public routing.
Insert `nginx-student-api.conf` inside the existing HTTPS server block, then run:

```bash
sudo nginx -t
sudo systemctl reload nginx
pm2 startOrRestart deploy/sgs-test/ecosystem.config.cjs --only demo-student
python3 deploy/sgs-test/verify_student_api.py --origin https://sgs-test.swais.in
python3 deploy/sgs-test/verify_student_api.py --origin https://sss-test.swais.in
```

Use `--identity` with a known student of each school for an additional profile
read. Do not use one school's student to validate another. Then verify actual
browser login and that name/class/assignments load. The CLI checks API wiring,
not browser authentication. If login-session resolution fails, the UI can still
show placeholders even when the data API works; coordinate that separately with
the login developers without bypassing authentication.

Save the approved PM2 process list only after all checks pass. For failures,
restore the previous Nginx site, student source/build and student environment
from the backup and restart only the affected student processes. Stop the new
student API if reverting to the previous deployment. Never restart all modules.

## Verified server result

On SGS test, the public Student pages/assets, `/api/student/health`,
`/api/student/health/db` and a known student's profile returned HTTP 200 after
deployment. The operator confirmed data loading and phone OTP login in the
browser. OTP application code was not changed by this fix. Actual `.env`
credentials and account records are deliberately excluded from Git.
