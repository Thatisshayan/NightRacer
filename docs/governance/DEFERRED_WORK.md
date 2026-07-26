# Deferred Work Register

Rule 12 / Rule 11. This register survives the session. Future agents resume from here.

## Format
- `[DATE] <scope>: <what> — <why deferred> — <resume hint> — <status>`

## Items
- [2026-07-25] api-server local dev: no local Postgres/Docker available in this
  environment to satisfy `DATABASE_URL` (required, throws in `lib/db/src/index.ts`) —
  deferred because provisioning a DB is an infra/credentials decision, not a code fix —
  `scripts/dev-db.sh` was added to automate provisioning (Postgres 16 container +
  `pnpm --filter @workspace/db run push` + `.env` write) on any machine with Docker, but
  it was never run/verified end-to-end in this environment (no Docker here) — resume by
  running `bash scripts/dev-db.sh` on a Docker-capable machine and confirming
  `pnpm --filter @workspace/api-server run dev` boots — status: script added, unverified.
- [2026-07-25] No `.env.example` in repo despite `DATABASE_URL` being a required env var
  — resolved: added `.env.example` with `DATABASE_URL=` documented — status: done.
