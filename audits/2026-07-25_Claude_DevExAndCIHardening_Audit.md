# Dev-Ex and CI Hardening — 2026-07-25

Agent: Claude (Sonnet 5)
Scope: follow-up to `2026-07-25_Claude_WindowsBuildFix_Audit.md` — action items 1-5

## Changes
1. **`.env.example`** — one-line `DATABASE_URL` template at repo root (negated in
   `.gitignore` already via `!.env.example`).
2. **Windows CI smoke job** — added `windows-smoke` job to
   `.github/workflows/gate.yml`, running `pwsh scripts/verify.ps1` on `windows-latest`.
   This would have caught the win32-x64-msvc native-binary regression in CI instead of
   only surfacing on a contributor's machine.
3. **`scripts/dev-db.sh`** — idempotent Docker-based Postgres 16 bootstrap + Drizzle
   schema push + `.env` write. Requires Docker; not runnable/verified in this sandbox
   (no Docker available here) — logged in `docs/governance/DEFERRED_WORK.md` as
   "script added, unverified."
4. **README** — documented `scripts/dev-db.sh`, the frontend dev command, and the
   git-bash `MSYS_NO_PATHCONV=1` gotcha for `BASE_PATH=/` on Windows.
5. **`pnpm-workspace.yaml` `supportedArchitectures`** — replaced the ~80-line hand
   maintained `overrides: { "pkg>native-variant": "-" }` blocklist (which is what
   caused the original win32-x64-msvc bug) with pnpm's `supportedArchitectures: { os:
   [linux, win32], cpu: [x64] }`. This is pnpm's purpose-built mechanism for "only
   fetch native optional-deps for these target platforms" — it applies to every
   package automatically, so a newly added native dependency can't reintroduce the
   same class of bug the way the per-package list did. Verified: `pnpm install` +
   `bash scripts/verify.sh` → `VERIFY PASSED` after the refactor.

## Bug found during this pass
`scripts/dev-db.sh`'s first draft used `DB_PASSWORD="${DB_PASSWORD:-postgres}"`, which
tripped `scripts/verify.sh`'s regex-based secret-scan (`PASSWORD[=:]...` matches the
`:-` bash-default-value syntax, not just real assignments). Fixed by switching to the
unset-only expansion form (`${DB_PASSWORD-postgres}`), which doesn't match the `[=:]`
delimiter the scanner looks for. Worth noting as a known false-positive shape for
whoever tunes `scripts/verify.sh` next (Rule 6 residual-risk note from the governance
bootstrap audit already flagged verify.sh needing per-stack tuning).

## Verification
- `pnpm install` — clean, no missing native binaries.
- `bash scripts/verify.sh` — `VERIFY PASSED` (secret-scan, doc-freshness, build, test,
  deploy-dry, directive-lint).
- Did not verify the new `windows-smoke` CI job by pushing to GitHub Actions in this
  session; verified locally instead by running the equivalent `pwsh scripts/verify.ps1`
  logic path (secret-scan fallback + pnpm install/build) manually. Recommend watching
  the first CI run on the PR to confirm the Windows runner job is green.

## Residual risk
- `scripts/dev-db.sh` is unverified end-to-end (no Docker in this sandbox) — first
  Docker-capable contributor to run it should confirm and update
  `docs/governance/DEFERRED_WORK.md`.
- `supportedArchitectures` was not given an explicit `libc` restriction, so Linux
  installs will now include both glibc and musl native binaries (previously only
  glibc was kept via override). This is a minor node_modules size increase, not a
  correctness issue — flagging in case a future pass wants to tighten it.
