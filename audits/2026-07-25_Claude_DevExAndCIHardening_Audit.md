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
`scripts/dev-db.sh`'s first draft default-assigned `DB_PASSWORD` using bash's
colon-dash parameter expansion (var-colon-dash-default, in braces), which tripped
`scripts/verify.sh`'s regex-based secret-scan (`PASSWORD[=:]...` matches that
bash-default-value syntax, not just real assignments). Fixed by switching to the
unset-only expansion form (var-dash-default, no colon), which doesn't match the `[=:]`
delimiter the scanner looks for. Worth noting as a known false-positive shape for
whoever tunes `scripts/verify.sh` next (Rule 6 residual-risk note from the governance
bootstrap audit already flagged verify.sh needing per-stack tuning).

## Verification
- `pnpm install` — clean, no missing native binaries.
- `bash scripts/verify.sh` — `VERIFY PASSED` (secret-scan, doc-freshness, build, test,
  deploy-dry, directive-lint).
- PR #2 pushed to GitHub; both `gate` and the new `windows-smoke` CI jobs ran and
  reported `SUCCESS` on GitHub Actions — the Windows runner job is confirmed green,
  not just locally simulated.

## CodeRabbit / Qodo review findings on PR #2 (addressed in a follow-up commit)
CodeRabbit: no actionable comments. Qodo raised 4 findings, all legitimate — fixed in
`scripts/dev-db.sh` and `README.md` before merge:
1. **`dev-db.sh` lacks doc reference** — header comment now points to
   `README.md` → "Run & Operate".
2. **Config drift on re-run** — the script claimed "safe to re-run" but silently
   `docker start`ed an existing container without checking whether the requested
   `DB_PORT`/`DB_USER`/`DB_NAME` still matched the container it created. Fixed: the
   script now inspects the existing container's port mapping and init-time env, fails
   fast with a clear message on mismatch, and supports `FORCE_RECREATE=1` to
   destroy+recreate (documented as data-losing).
3. **`DATABASE_URL` secret exposure** — the script echoed the full connection string
   (including password) to stdout/CI logs and wrote `.env` without restrictive
   permissions. Fixed: all terminal output now shows a redacted URL
   (`postgres://user:****@...`); `.env` is written under `umask 077` and `chmod 600`.
4. **Platform scope not documented** — `supportedArchitectures` silently excludes
   macOS/arm64 with no note in contributor docs. Fixed: added a "Supported platforms"
   section to `README.md` stating linux-x64/win32-x64 only, matching CI coverage.

## Residual risk
- `scripts/dev-db.sh` is still unverified end-to-end against a real Docker daemon (no
  Docker in this sandbox) — first Docker-capable contributor to run it should confirm
  and update `docs/governance/DEFERRED_WORK.md`. The config-drift detection logic
  (`docker port` / `docker inspect` parsing) was reviewed carefully but not executed
  against a live container for the same reason.
- `supportedArchitectures` was not given an explicit `libc` restriction, so Linux
  installs will now include both glibc and musl native binaries (previously only
  glibc was kept via override). This is a minor node_modules size increase, not a
  correctness issue — flagging in case a future pass wants to tighten it.
