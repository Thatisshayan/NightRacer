# Replit decoupling, sub-project 1: Database

Part of the larger Replit-decoupling effort (database → web hosting → mobile build
pipeline → CI check). This is the first and lowest-risk piece.

## Decision

Move Postgres off Replit onto [Neon](https://neon.tech), and use the same Neon project
for local dev, staging, and prod alike — no local/Docker Postgres. `lib/db/src/index.ts`
already reads a plain `DATABASE_URL` through `pg` + Drizzle, so this is a provisioning
change only, zero app-code changes needed for the DB client itself.

The existing Replit Postgres instance had no data worth preserving, so this was a fresh
provision + schema push, not a data migration.

## What was done

- Created Neon project `nightracer` (id `royal-scene-81383627`) via the Neon API, default
  branch `main`, database `neondb`, role `neondb_owner`.
- Wrote the pooled connection string to a local, gitignored `.env` (`DATABASE_URL=...`).
- Pushed the Drizzle schema (`pnpm --filter @workspace/db run push`) — created the
  `scores` table.
- Fixed a pre-existing, unrelated Windows bug this surfaced: `lib/db/drizzle.config.ts`
  built its `schema` path via `path.join(__dirname, ...)`, which produces backslashes on
  Windows that drizzle-kit's internal glob resolution doesn't match ("No schema files
  found"). Normalized to forward slashes.
- Verified end-to-end: built and booted `api-server` against the new `DATABASE_URL`,
  hit `GET /api/scores` — got a real `200 []` round-trip through Neon.
- Retired `scripts/dev-db.sh` (spun up a local Postgres 16 Docker container) since Neon
  now serves that purpose too — deleted, and README's "Run & Operate" section updated to
  point at Neon instead.
- Updated `.env.example` to describe a Neon connection string instead of a local one.
- Marked the `[2026-07-25] api-server local dev` entry in
  `docs/governance/DEFERRED_WORK.md` resolved.

## Not in scope here

- Web hosting (frontend/API deploy target), mobile build pipeline, and the CI
  Replit-env-var check are separate sub-projects, not started.
- No staging/prod environment separation was set up — this is a single Neon project/branch
  used for everything for now. Branch-per-environment (Neon supports instant branching) is
  a natural future step if/when staging and prod need to diverge, not done here.
- The Neon API key used to provision this was pasted directly into chat by the user. It
  was used only in local, non-logged shell commands and not written to any committed file;
  the connection string it produced lives only in the gitignored `.env`. Rotating that API
  key (since it passed through chat) is the user's call, not done here.

## Verification

- `pnpm --filter @workspace/db run push` — schema applied cleanly.
- `pnpm --filter @workspace/api-server run build` — clean build.
- Booted `api-server` locally against the Neon `DATABASE_URL`; `GET /api/scores` returned
  `200 []` (empty leaderboard, as expected for a fresh database).
- Did not verify: the game frontend actually submitting/reading real scores end-to-end
  through the new DB (only the API layer was smoke-tested directly).
