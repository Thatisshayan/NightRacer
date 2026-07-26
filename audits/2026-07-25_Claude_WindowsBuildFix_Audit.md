# Windows Build Fix + Codebase Audit — 2026-07-25

Agent: Claude (Sonnet 5)
Scope: codebase-memory indexing, `using-superpowers` repo audit, local run verification
Status: completed

## Setup performed
- Indexed the repo into the codebase-memory knowledge graph (project
  `D-AgentDevWork-repos-NightRacer`, 1659 nodes / 3388 edges). MCP server was already
  connected; `index_repository` was run in `full` mode.

## Bug found and fixed (blocking `scripts/verify.sh`)
**Symptom:** `bash scripts/verify.sh` failed at the `build / test` stage —
`artifacts/mockup-sandbox` (`vite build`) crashed with
`Cannot find module '@rollup/rollup-win32-x64-msvc'` (`MODULE_NOT_FOUND`).

**Root cause:** `pnpm-workspace.yaml` `overrides` intentionally strips non-Linux native
optional-dependency binaries to keep Replit's Linux-only deploy lean (comment: "replit
uses linux-x64 only, we can exclude all other platforms"). The exclusion list was too
broad and also stripped the **`win32-x64-msvc`** variants for `rollup`, `lightningcss`,
and `@tailwindcss/oxide` — the exact binaries Node needs on a native Windows dev machine
(this box: `win32 x64`). Every `vite build`/`vite dev` that touches Tailwind v4 (oxide
engine) or Rollup's native binary would fail the same way on any Windows contributor's
machine, not just this one.

**Fix:** removed the three `win32-x64-msvc` override entries from `pnpm-workspace.yaml`
(kept `win32-arm64-msvc` / `win32-ia32-msvc` / rollup's `win32-x64-gnu` excluded — those
aren't needed for a standard x64 Windows Node install). Re-ran `pnpm install`, confirmed
the native binaries now resolve, and `bash scripts/verify.sh` now reports `VERIFY PASSED`
(secret-scan, doc-freshness, build, test, deploy-dry, directive-lint all green).

**Files changed:** `pnpm-workspace.yaml` (3 lines removed).

## Run verification (local, for manual testing)
- `artifacts/warboss-highway` (the game) started successfully via
  `PORT=5173 BASE_PATH=/ pnpm run dev` — confirmed HTTP 200 and correct HTML/JS served
  at `http://localhost:5173/`.
  - Git Bash gotcha hit during startup: passing `BASE_PATH=/` through MSYS bash rewrites
    the bare `/` into a Windows path (`/Program Files/Git/`) before Node ever sees it.
    Fixed by prefixing with `MSYS_NO_PATHCONV=1`. Not a repo bug — a Windows/git-bash
    environment quirk worth documenting for other Windows contributors.
- `artifacts/api-server` was **not** started: `lib/db/src/index.ts` throws immediately
  if `DATABASE_URL` is unset, and there is no local Postgres, Docker, or `.env` in this
  environment (`.replit` provisions `postgresql-16` on Replit, which isn't present here).
  The game client is fully playable standalone; only the `/api/scores` leaderboard
  GET/POST calls will fail with a network error/500 until a DB is provisioned.

## Residual risk / follow-ups
- No `.env.example` exists anywhere in the repo, so a new contributor has no template for
  `DATABASE_URL`. Recommend adding one (see suggestions below).
- The `win32-x64-msvc` overrides fix is scoped to this dev box's arch; if the team ever
  supports Windows ARM64 or 32-bit contributors, revisit the remaining exclusions.
- Did not attempt to provision a local Postgres in this run (no Docker available); left as
  deferred work below rather than reaching for a workaround DB backend.
