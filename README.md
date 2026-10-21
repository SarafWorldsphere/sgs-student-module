# SGS Project

Student dashboard with a FastAPI backend and PostgreSQL content storage.

On branch `saas`, start with [the tenant-kit setup](docs/SAAS_SETUP.md). This branch uses the canonical tenant-kit sample schema and host-based school context.

Database pooling setup, tests and rollout verification: [docs/CONNECTION_POOLING.md](docs/CONNECTION_POOLING.md).

For AWS EC2, Nginx, and RDS deployment, see [docs/EC2_DEPLOYMENT.md](docs/EC2_DEPLOYMENT.md).

## Frontend Setup

```bash
npm install
npm run dev
```

The Next.js app runs at `http://localhost:3000` by default.
Use another port when needed:

```bash
npm run dev -- --hostname 0.0.0.0 --port 3004
```

## Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The FastAPI backend runs at `http://localhost:8000`.
Use another port when needed:

```bash
uvicorn main:app --host 0.0.0.0 --port 8004
```

## Environment Variables

Create `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/sgs_db
```

Optional frontend variable:

```env
NEXT_PUBLIC_API_BASE_URL=/api
```

`NEXT_PUBLIC_API_BASE_URL=/api` works best when Nginx proxies `/api/` to FastAPI, regardless of whether Nginx runs on port `80`, `84`, or another public port. For direct local development without Nginx, set it to the backend URL instead, for example `http://localhost:8000` or `http://localhost:8004`.

Optional backend CORS variable for direct frontend-to-backend calls:

```env
CORS_ALLOW_ORIGINS=http://localhost:3000,http://localhost:3004,http://18.60.153.66:84
```

Gemini AI provider variables:

```env
GEMINI_API_KEY=your_gemini_key
AI_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
```

For DeepSeek testing:

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Restart the FastAPI backend after changing `.env`.

## AI Learning Path

The Student Dashboard now includes `Study A: Core Material > AI Learning Path`.

It tracks:

- Reading time
- Quiz score
- Retry count
- Comprehension score

The backend classifies students as `Fast Reader`, `Average Reader`, or `Slow Reader`, then generates a personalized path through `backend/ai_learning_path_service.py`. If `GEMINI_API_KEY` is present, Gemini is used by default. Set `AI_PROVIDER=mock` only when you explicitly want deterministic local fallback output, or set `AI_PROVIDER=deepseek` with `DEEPSEEK_API_KEY` to test DeepSeek generation.

## Database Migration

Do not run migrations automatically. Apply the AI Learning Path migration manually:

```bash
psql "$DATABASE_URL" -f backend/migrations/001_ai_learning_path.sql
```

The migration creates `sgs_student_learning_profiles` and includes sample rows for students `23`, `24`, and `25`.

## Learning Profile APIs

- `POST /learning-path/generate` generates an AI learning path without saving.
- `POST /student-learning-profile` saves or updates a student/chapter learning profile.
- `GET /student-learning-profile?student_id=23&chapter_id=1` fetches a saved profile.

Sample payload:

```json
{
  "student_id": 23,
  "chapter_id": 1,
  "chapter_title": "Democratic India",
  "reading_time_minutes": 28,
  "quiz_score": 76,
  "retry_count": 1,
  "comprehension_score": 72
}
```
