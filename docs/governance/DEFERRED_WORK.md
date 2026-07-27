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
  it was never run/verified end-to-end in this environment (no Docker here) —
  **status: resolved 2026-07-27** — replaced with a hosted Neon Postgres project
  (`nightracer`, part of the Replit-decoupling effort) used for dev/staging/prod alike,
  no Docker needed; `scripts/dev-db.sh` deleted. Verified end-to-end: schema pushed via
  `pnpm --filter @workspace/db run push`, `api-server` built and booted against it, and
  `GET /api/scores` round-tripped a real query (`200 []`) — see
  `docs/superpowers/specs/2026-07-27-replit-decoupling-database-design.md`.
- [2026-07-25] No `.env.example` in repo despite `DATABASE_URL` being a required env var
  — resolved: added `.env.example` with `DATABASE_URL=` documented — status: done.
- [2026-07-26] UI motion audit follow-up (`audits/2026-07-25_Claude_UIDesignMotion_Audit.md`,
  PR #3): all 10 findings implemented (screen transitions, HUD score/combo pop, button
  press feedback, title stagger, car-select feedback, skeleton loading states,
  leaderboard row highlight, fluid type scale, prefers-reduced-motion guard,
  framer-motion now used), verified by `pnpm run typecheck`/`build` and
  `bash scripts/verify.sh` only — no interactive browser was available in that session
  (Claude-in-Chrome extension not connected) so none of the animations were watched
  actually rendering/playing — deferred because visual/gameplay QA needs a human or a
  connected browser tool, not because the work is unstarted — resume by playing the game
  in a browser and confirming: title stagger, screen cross-fade on death, HUD score/combo
  pop on a tank kill or near-miss, car-preview idle bob, and the leaderboard row highlight
  scroll-into-view all look and feel correct (not jittery/mistimed) — status: implemented,
  unverified visually.
- [2026-07-26] OKLCH color palette conversion (`audits/2026-07-25_Claude_UIDesignMotion_Audit.md`
  finding #7) — explicitly not attempted in the PR #3 follow-up; flat HSL palette in
  `index.css` and hardcoded hex colors in `lib/game/renderer.ts` left as-is — deferred
  because it's a full design-system repaint with real visual-identity risk that needs
  dedicated visual QA, not a mechanical refactor — resume by converting `index.css`'s HSL
  triples to OKLCH (see ultimate-frontend-design skill's color-science guidance) and
  auditing `renderer.ts`'s hardcoded vehicle/obstacle colors for consistency — status:
  open, not started.
- [2026-07-27] PR #5 (sprint-2 cars/audio + visual polish, merged to `main`): none of it
  was ever run in a browser — the 2 new cars, the vehicle carousel, the procedural
  Web Audio SFX/music actually producing sound, the title-screen road animation, and the
  particle/underglow/road visual polish were all integrated by static code reading only
  (no Claude-in-Chrome / interactive browser available) — deferred because visual/audio
  QA needs a human or connected browser tool — resume by playing the game and confirming:
  SCRAPQUEEN/PHANTOM render and handle distinctly, the carousel arrows/dots select
  correctly, music and all SFX (crash/powerup/shield/gameover/scrap/upgrade/uiClick)
  actually play, the title road scrolls smoothly, and the new road/particle/exhaust visuals
  don't look broken — status: implemented, unverified visually/audibly.
- [2026-07-27] `artifacts/warboss-highway/src/lib/game/audio.ts` pause/resume rewrite
  (PR #5, addressing a Qodo finding): `pauseAudio`/`resumeAudio` were changed from fading
  a music `GainNode` to calling `AudioContext.suspend()`/`.resume()` on the whole graph —
  reasoned correct from Web Audio API semantics but never confirmed at runtime across the
  actual pause → resume → mute-toggle interaction paths in `Game.tsx` — resume by pausing
  mid-game, unpausing, and toggling mute while paused, confirming audio state matches UI
  state in all cases — status: implemented, unverified.
- [2026-07-27] `engine.ts` road asphalt-grain texture (PR #5, addressing a Qodo perf
  finding): replaced ~6k `fillRect` calls/frame with a tiled `CanvasPattern` built once —
  never visually confirmed the tile repeats seamlessly or looks equivalent to the original
  per-pixel dot pattern — resume by comparing before/after screenshots of the road surface
  at a few `roadOffset` values — status: implemented, unverified.
- [2026-07-27] `Game.tsx` title-screen road scroll speed (PR #5, addressing a Qodo
  frame-rate-independence finding): changed from a fixed `3px`/frame to `180px/sec`
  (backed out assuming the original was tuned for ~60fps), never confirmed the felt speed
  still matches original intent — resume by comparing the animation's perceived speed
  before/after on a real 60Hz display — status: implemented, unverified.
- [2026-07-27] `attached_assets/generated_audio/*.mp3` (6 files: gameplay_track,
  menu_track, sfx_crash, sfx_powerup, sfx_shield, sfx_gameover) are tracked in git but no
  longer imported by anything after PR #5 switched `audio.ts` to procedural Web Audio SFX
  — left in place rather than deleted because removing tracked assets felt like it needed
  an explicit go-ahead — resume by confirming nothing else references them, then
  `git rm` — status: open, not started.
- [2026-07-27] Two Qodo review findings on PR #5 were skipped by unilateral judgment call,
  not independently verified as low-value: (1) a doc-comment nitpick asking for an
  in-repo doc reference near `audio.ts`'s changed public API shape, and (2) a race in
  `startMusic()` where `AudioContext.resume()` is fire-and-forget so `musicPlaying` can be
  set true before the context has actually resumed (only matters on rapid
  title/gameplay music switches on an autoplay-blocked context) — resume by re-reading
  both findings on PR #5's review thread and deciding if they're worth the churn — status:
  open, deliberately not started.
- [2026-07-27] `artifacts/warboss-highway` has no test files and no `test` script — the
  `gate` CI check's test step no-ops via `--if-present` — so "CI green" on PR #5 means
  typecheck + build succeeded only, not that gameplay behavior was verified by anything
  automated — resume by adding at least smoke tests around `GameEngine` (spawn/collision/
  scoring logic) and the `audio.ts` public API shape — status: open, not started.
- [2026-07-27] `scripts/verify.sh`/`verify.ps1` deploy-dry check for `vercel.json` —
  **status: resolved 2026-07-27.** The user provided a `VERCEL_TOKEN` (this session
  couldn't mint one itself — `vercel tokens add` returned 403 under its app-scoped OAuth);
  set as a GitHub Actions repo secret along with `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`.
  Along the way, CodeRabbit review on PR #6 caught that the original fix used
  `vercel build --dry-run`, which isn't a real flag (verified independently: `vercel build
  --help` lists no such option) — replaced with `vercel build --yes`, and switched from a
  bare `vercel` invocation to `npx --yes vercel@latest` since the CLI is only installed
  globally on this dev machine, not a repo dependency — CI would have had no `vercel`
  binary on PATH at all. Both fixes verified locally end-to-end before pushing (real
  `vercel build --yes` success against the linked project). Also moved the Vercel secrets
  out of the main "Run governance verification" step into their own dedicated step
  (CodeRabbit: least-privilege — the secrets shouldn't be in scope for the preceding
  install/build/test commands) in `.github/workflows/gate.yml`.
- [2026-07-27] Vercel Preview deployments share the production `DATABASE_URL` (same Neon
  connection string set for both Production and Preview environments) — a PR preview can
  write test data into, or query, the real production leaderboard. Neon supports instant
  branching for exactly this; the fix is a separate `preview` branch with its own
  connection string set as the Preview-only `DATABASE_URL` on Vercel. Not done because it
  needs the Neon API key again, which wasn't retained after sub-project 1 (by design) —
  see `docs/superpowers/specs/2026-07-27-replit-decoupling-web-hosting-design.md` for the
  exact resume steps — status: open, flagged by CodeRabbit on PR #6, not blocking merge.
