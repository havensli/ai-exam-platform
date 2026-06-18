# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Main System (Next.js)
```bash
npm run dev          # start dev server on :3000
npm run build        # production build (validates TypeScript)
npm run lint         # ESLint
npm test             # vitest unit tests (src/**/*.test.ts)
npx drizzle-kit push # apply schema to database
```

### Python Worker
```bash
cd worker
pip install -r requirements-dev.txt   # requirements.txt + pytest
python main_worker.py                 # start full grading worker
python -m pytest                      # unit tests (tests/)
python -m py_compile grading/agent.py grading/grader.py  # syntax check
```

### Cross-language crypto tests
`src/lib/crypto.ts` and `worker/grading/crypto.py` are independent Fernet-compatible
implementations that must decrypt each other's tokens (git tokens are encrypted on
one side and may be decrypted on the other). `src/lib/crypto.test.ts` and
`worker/tests/test_crypto.py` each shell out to the other language at test time
(via `node_modules/.bin/tsx scripts/crypto_cli.ts` / `worker/tests/helpers/crypto_cli.py`)
to verify interop continuously — both suites must keep passing if either
implementation changes.

### Docker sandbox image (build once, reused by worker)
```bash
cd worker
docker compose --profile build up sandbox-builder  # builds exam-sandbox-python:latest
docker compose up worker                           # run worker in Docker
```

## Architecture

Two independent services:

### Main system — `src/`
**Next.js 16 App Router + Drizzle ORM + Neon Postgres, deployed on Vercel.**

Route groups:
- `(employee)/` — employee-facing pages at `/exams`, `/results/[id]`
- `(admin)/admin/` — admin pages at `/admin/exams`, `/admin/review`

Proxy (auth middleware) is in `src/proxy.ts` — Next.js 16 renamed `middleware.ts` → `proxy.ts`.

API routes under `src/app/api/` all return `{ data, error }`.

DB schema is in `src/db/schema.ts` — all 17 tables with Drizzle pg-core types.

Cron jobs (`/api/cron/*`) are protected by `Authorization: Bearer $CRON_SECRET` header. Configured in `vercel.ts`.

### Python Worker — `worker/`
**Polls `grading_tasks` table every `$POLL_INTERVAL` seconds. Entry point: `worker/main_worker.py`.**

Pipeline per submission:
1. **Sandbox** (`sandbox/executor.py`) — Phase 1: clone repo on host (with network). Phase 2: install deps in Docker (with network). Phase 3: run tests in Docker (network isolated, read-only FS, seccomp profile).
2. **First layer** (`grading/first_layer.py`) — URL accessibility, git behavior analysis, deploy IP fingerprint dedup.
3. **LLM grading** (`grading/agent.py`) — pydantic-ai Agent with tool access to repo (reads files on demand, never dumps whole repo into context). Outputs `GradingReport` (structured via `grading/models.py`). Evidence refs are validated against actual repo files post-run.

Task queue: `grading_tasks` table with `SELECT FOR UPDATE SKIP LOCKED` — safe for multiple concurrent workers.

Status flow: `pending → processing → sandbox_done → ai_graded → completed`

## Environment Variables

See `.env.example` for full list. Critical ones:
- `DATABASE_URL` — Postgres (Neon)
- `DINGTALK_APP_KEY / APP_SECRET / AGENT_ID` — DingTalk OAuth + notifications
- `NEXTAUTH_SECRET` — JWT signing key
- `ANTHROPIC_API_KEY` — LLM grading model
- `CRON_SECRET` — protects cron routes
- `TOKEN_ENCRYPTION_KEY` — Fernet key (or passphrase) for `submissions.git_token_encrypted`; must be identical on both Next.js and worker sides

## Key Design Decisions

- `hidden_notes` on rubric items are only returned to `reviewer`/`exam_creator` roles — enforced in API, not just frontend
- Prompts are versioned (`prompt_versions` table) and frozen on exam publish — rubric changes after publish create a new version
- Evidence references from LLM grading are validated (file path + line numbers must exist in the cloned repo) before saving
- Second reviewer on appeals cannot be the same person as the original reviewer — enforced at `PUT /api/appeals/[id]`
- Docker sandbox: `--network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 128`
- Per-submission git tokens (`submissions.git_token_encrypted`) are encrypted at rest with Fernet (AES-128-CBC + HMAC-SHA256), decrypted only at clone time in the worker — see `src/lib/crypto.ts` / `worker/grading/crypto.py`
