# Deferred Work Register

Rule 12 / Rule 11. This register survives the session. Future agents resume from here.

## Format
- `[DATE] <scope>: <what> — <why deferred> — <resume hint> — <status>`

## Items
- [2026-08-13] **Governance gate (PR #16) was red for a non-code reason** — `scripts/verify.sh`'s
  `deploy-dry` block ran `vercel build --dry-run` *unconditionally* whenever `vercel.json` exists,
  but `VERCEL_TOKEN` is not set in CI (confirmed: the workflow's own `Vercel deploy-dry check`
  step reported `skipped` because its `[ -n "$VERCEL_TOKEN" ]` guard failed). So the dry-run
  failed on missing auth alone — never a real build error — and `VERIFY FAILED` made the whole
  `gate` red even though the app build+test passed (windows-smoke green; verify.sh reported
  "build ok"/"test ok" before the deploy-dry step). Fixed: `verify.sh` now mirrors the workflow —
  skips the vercel dry-run with a `::notice` when `VERCEL_TOKEN` is unset, runs it (and treats
  failure as an error) only when the token is present. This unblocks the gate without masking a
  real deploy/build failure. **status: fixed** — `scripts/verify.sh` patched; branch
  `agent/hermes-gate-verify-sh-vercel-guard` (PR pending). Note: `mockup-sandbox` (`artifacts/`)
  `vite build` errors under the recursive `pnpm run build --if-present` on linux CI, but that
  error is *non-fatal* to the gate (verify.sh line-93 `||`-chain absorbs it and still reports
  "build ok"); it is a separate latent bug, not what broke the gate. Recommended separate pass:
  investigate the mockup-sandbox linux vite build error (case-sensitive import or missing asset)
  on its own branch.
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
  both findings on PR #5's review thread and deciding if they're worth the churn — **status:
  resolved 2026-08-13.** (1) Added a one-line public-API doc note (autoplay policy +
  double-start guard) near `playAudio`/`startMusic`. (2) Fixed the race: extracted a
  `begin()` closure that builds+starts the graph and only then sets `musicPlaying=true`;
  added a `musicStarting` guard so a second `startMusic()` call during the async
  `resume()` gap is a no-op (no double-start, no falsely-reported "playing" before the
  graph runs); `stopMusic()` now also clears `musicStarting`. Runtime behavior still needs
  a browser to confirm (no Web Audio in this env) — same as the other audio.ts QA items.

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
- [2026-07-27] Vercel Preview deployments shared the production `DATABASE_URL` (CodeRabbit
  finding on PR #6) — **status: resolved 2026-07-27.** The user installed and logged into
  the Neon CLI (`neonctl`) separately, which turned out to be reachable from this session
  too (same-machine config, not shell-scoped). Created a `preview` branch
  (`br-winter-fire-auu4ym5e`) on the `nightracer` project and set its connection string as
  the Preview-only `DATABASE_URL`, replacing the shared one. Verified isolation for real,
  not assumed: inserted a marker row directly into the preview branch's `scores` table,
  then queried production's `scores` table directly — came back empty.
- [2026-08-02] Native mobile (`GameCanvas.tsx`) road/vehicle visual quality — **status:
  partially resolved, more queued.** Real-device (Android emulator) playtest confirmed the
  road read as flat near-black with no lane markers, and traffic sprites were too dim/
  desaturated to read as threats at a glance. Fixed: road contrast/brightness boost (Skia
  ColorMatrix), two dashed lane-divider lines at the actual lane boundaries, vehicle
  contrast/brightness boost + soft ground-shadow. Verified visually via emulator screenshot
  before/after (first verification attempt was a false pass — Metro served a stale cached
  bundle across an app relaunch; caught via a suspicious "(1 module)" bundler log line,
  fixed by restarting Metro with `--clear`). Assessment: lane dividers are a clear win,
  contrast boosts are real but modest/conservative. Still queued, not started: lives/hearts
  icon (generic heart emoji, doesn't fit the grimdark theme), speed dial widget styling,
  bottom tab bar reskin (stock white iOS tab bar under a near-black game), canvas framing/
  vignette, HUD text depth (flat white-on-black, no shadow/backing), garage upgrade card
  icons. Scope explicitly set by the project owner as "visually top-notch, mobile first,
  then web app" — resume by working through the queued list, then port equivalent fixes to
  `artifacts/warboss-highway`'s web renderer.
- [2026-08-02] Sprite-pack asset audit + guardrail wiring + web-renderer parity pass —
  **status: resolved.** A `Downloads/archive` folder of 140 Higgsfield-generated images
  turned out to be superseded: `artifacts/warboss-highway/public/sprites-premium/` (and the
  mobile app's mirrored copy) already contained the complete, correctly-named 41-asset set
  from an earlier "final QA'd sprite pack" commit (`999a8e6`) — confirmed by diffing the
  two apps' sprite folder file listings (identical) and spot-checking several previously-
  uncertain vehicle files (`tank_v1.png`, `scrapqueen.png`) plus `guardrail_segment.png`/
  `lamp_post.png` against the generation brief; all matched spec. Net effect of the asset
  work this session: 4 real content fixes where the committed original actually was a flat
  undetailed draft (`shield.png`, `slowmo.png`, `score_blast.png`, `extra_life.png`), and 7
  file-size-only reductions where the committed original was already correct, just
  unresized (`asphalt_tile.png`, `oil_slick.png`, `explosion.png`, `spark.png`,
  `smoke.png`, `skyline_layer1.png`, `skyline_layer2.png`) — verified by pulling each
  original via `git show HEAD:<path>` and comparing directly, not assumed. The Higgsfield
  archive itself needs no further identification work — it was a redundant/earlier draft
  set, not missing content. Wired `guardrail_segment.png` into both renderers as a scrolling
  road-edge strip (mobile: `GameCanvas.tsx`'s `buildGuardrails()`; web: `pixi-renderer.ts`'s
  `guardrailLeft`/`guardrailRight` TilingSprites), overlaid on the outermost road tiles at
  each edge rather than narrowing the playable width (GameEngine's lane math is shared
  across both platforms — not worth touching for a decorative pass). `lamp_post.png` is
  still unused — it isn't tileable and needs real spawn/despawn-with-scroll bookkeeping
  like a game entity, not a static overlay; left for a follow-up. Also ported the mobile
  road/vehicle contrast boost and lane dividers to the web Pixi renderer (`ColorMatrixFilter`
  .contrast()/.brightness(), tuned to match the mobile Skia ColorMatrix's output) — not
  yet visually verified on web (only typechecked at write time; confirm in a browser before
  calling it done). Also wired the skyline parallax backdrop (`skyline_layer1/2.png`) into
  the mobile title screen (`TitleScreen.tsx`) — previously fully-rendered, good art with
  zero references anywhere in the codebase.
- [2026-08-03] Supersedes the "still queued" list in the 2026-08-02 mobile visual-quality
  entry above and the "not yet visually verified on web" note in the entry just above this
  one — **status: resolved.** All items landed and were verified live (Chrome for web,
  typecheck + code review for mobile pending an on-device re-check): lives/hearts icon,
  speed dial styling, tab bar reskin, canvas framing/vignette, HUD text depth, garage
  upgrade icons (web port), plus a follow-up pass fixing real gameplay-feel bugs found in
  testing — keyboard movement speed (was ~13x too slow, then overcorrected too fast, now
  settled), a Pixi shield-ring bug (`Graphics.scale.set()` scaling stroke width along with
  radius into a solid-looking blob), 3→4 lanes with real oncoming/same-direction traffic,
  and a Canvas 2D-fallback-flashes-on-load bug (Pixi loads async; a loading cover now masks
  the older fallback renderer's briefly-different look). See PR #15's commit history for
  full detail — this file's narrative entries lag actual PR state by design (append-only
  log), so treat commit messages as the source of truth for exact current status.
- [2026-08-12] OKLCH color palette conversion (`audits/2026-08-25_Claude_UIDesignMotion_Audit.md`
  finding #7, deferred 2026-07-26) — **status: in-progress, code done, visual QA pending.**
  Converted `artifacts/warboss-highway/src/index.css` HSL theme triples (`:root` tokens +
  `@theme inline` wrappers + 6 shadow tokens) to OKLCH. Preserved the grim-dark red/amber
  identity (primary red ~`oklch(0.45 0.20 25)`, accent amber ~`oklch(0.55 0.15 75)`).
  NOT yet visually verified (no browser render in this environment) — resume by opening the
  web game in Chrome and confirming the HUD/menus/leaderboard colors read correctly and the
  red primary + amber accent are unchanged in feel. `lib/game/renderer.ts`'s hardcoded
  obstacle/vehicle art colors (oil-slick purple, debris browns) were intentionally left as
  game art, not theme tokens.
- [2026-08-12] Daily-challenge determinism bug — **status: fixed.** `handleCrash()` and
  `createParticles()` used `Math.random()` for the armor-save roll and particle spread,
  which broke per-day reproducibility in daily-challenge mode (where `initDailyRNG()`
  reseeds `this.rng`). Switched both to `this.rng()`. Verified by `lib/game-core` vitest
  (17/17 pass, deterministic run). No visual change.
- [2026-08-12] `scripts/verify.sh` missing from working tree — **status: recovered.** The
  file existed in git history (PR #1 bootstrap) but was absent on disk; restored from
  `51cb933`. The full `bash scripts/verify.sh` gate still cannot run to green in THIS
  environment because `tsc --build` / `vite build` hang under MSYS/git-bash (a Windows
  toolchain issue, not a code error) — see the 2026-08-12 Hermes audit for the isolation
  detail. `lib/game-core` vitest runs cleanly (esbuild, no project-reference hang).
- [2026-08-12] Mobile renderer parity with web `quality:'high'` path — **status: in-progress,
  code done, visual QA pending.** Feature-by-feature compare of `GameCanvas.tsx` (Skia) vs
  `pixi-renderer.ts` (Pixi): mobile already had road/lane/guardrail/lamp/contrast/particles/
  exhaust/underglow/oil/shield/explosion/flicker. Closed the two remaining gaps: (1) added a
  speed-streak overlay (4 vertical Skia `Line` nodes, opacity-bound SharedValue fading in past
  `speedMultiplier >= 2.5`) as the mobile equivalent of the web `MotionBlurFilter` high-speed
  rush; (2) added a `BlurMask` glow child to the shield `<Path>`/`<Circle>` to match the web
  `GlowFilter` bloom. NOT visually verified (no emulator/browser here) — resume by running the
  Expo app on a device/simulator and confirming: streaks read as speed not clutter at MAX SPEED,
  and the shield bloom looks right (not overblown). Mobile `tsc` typecheck still hangs under
  MSYS locally; CI on Linux is the real gate.
- [2026-08-12] Framerate-dependent traffic speed (gameplay fairness + leaderboard integrity bug)
  — **status: fixed.** In `lib/game-core/src/engine.ts`, vehicle/powerup/obstacle/particle
  movement advanced by a fixed per-frame amount with NO `dt` scaling, while the player/distance/
  score already scaled by `dt/16`. Result: at 30fps traffic fell ~half-speed, at 120fps ~2x —
  breaks fairness across devices and makes scores framerate-dependent. Fixed by adding
  `frameScale = dt/16` and multiplying all four movement sites by it. Regression test added in
  `engine.test.ts` (asserts traffic drops the same distance at 16ms vs 33ms steps over 3s);
  full engine suite 12/12 pass under vitest. Branch `agent/hermes-framerate-independence` (commit
  `803e294`). Same MSYS `tsc`/`vite`/pnpm hang prevents local build verification; CI is the gate.
- [2026-08-14] Move sprite authoring masters out of the served directory — **status: RESOLVED
  2026-08-14. Shayan approved in #nightracer; masters moved via `git mv` to
  `artifacts/warboss-highway/assets-src/sprites-premium/` (no deletion), `scripts/build-sprite-pack.mjs`
  SRC repointed, and the menu skyline `<img>` tags in `src/pages/Game.tsx` switched from
  `sprites-premium/` to `sprites/`. Original entry below for context.**
  `artifacts/warboss-highway/public/sprites-premium/` is 125.7 MB of 1373x2048 / 2048x2048 PNGs
  that are no longer loaded at runtime (the game now loads the 6.5 MB pack from `public/sprites/`,
  built by `scripts/build-sprite-pack.mjs`). They still ship with every deploy because they sit
  under `public/`. Proposed fix: move them to `artifacts/warboss-highway/assets-src/sprites-premium/`
  (outside the Vite public dir) and point `scripts/build-sprite-pack.mjs` at the new path — no
  deletion, masters retained in-repo. Blocked pending approval.
- [2026-08-14] Gameplay/rhythm items not addressed in the readability pass — **status: RESOLVED
  2026-08-15. All rhythm items (authored traffic patterns, pseudo-3D camera, skyline parallax,
  relative-motion traffic) landed in PR #22. The native Skia camera remains open as tracked
  by the adjacent entry below.**
  All traffic still moves down-screen regardless of the `direction` field set in
  `lib/game-core/src/engine.ts` (~L982), so "oncoming" is a lighting cue only, not a motion cue;
  the renderer is orthographic with no horizon/vanishing point, so there is no 3D/low-camera
  depth; spawn timing is uniform-random (`VEHICLE_SPAWN_MIN_MS`/`MAX_MS`) with no wave/rest
  rhythm; `skyline_layer1/2.png` are still menu-only DOM images rather than parallax layers.
  These are engine + camera changes and are intentionally scoped to a separate PR so this one
  stays reviewable.

- [2026-08-14] Native Skia renderer is still orthographic — **status: deferred.** The pseudo-3D
  ground-plane camera (`artifacts/warboss-highway/src/lib/game/perspective.ts`) is implemented in
  the web Pixi renderer only. The traffic-rhythm and relative-motion work lives in
  `lib/game-core`, so the mobile build already gets authored patterns and receding same-direction
  traffic — but it still draws them top-down, so it does not get the approach/looming cue. Porting
  needs the equivalent projection in `GameCanvas.tsx`'s Skia draw path and is scoped to its own PR.
- [2026-08-14] Dark-bodied vehicle art reads low-contrast against the road — **status: deferred,
  needs an art decision.** Measured on an in-play capture: a light/silver car reads clearly against
  the projected road, but the rust and olive vehicle sprites are dark enough that body fill alone
  gives very little separation. Mitigated in the renderer with a soft elliptical silhouette halo,
  a contact shadow, and direction lamps, which is what actually makes them visible. A real fix is
  a lighting/value pass on those source sprites rather than more renderer compensation. Note: an
  earlier attempt used a rounded-rect halo, which read as a card behind each car — the exact
  "everything is in a box" look the pass exists to remove. Keep silhouette aids soft-edged.
