# 2026-08-12_Hermes_General_Audit.md

## Scope
General audit of NightRacer (Warboss Highway) toward the standing goal: 100% functional
mobile + web app, top night visuals/assets, top-tier dodge-game feel, logic review, bug
hunting/fixing, and clearing the deferred-work register. This session focused on: (1)
isolating the local build/typecheck hang, (2) code-level bug fixes, (3) advancing deferred
work that is fixable without a live browser.

## Method
- Read `REPO_RULES.md`, `README.md`, `DEFERRED_WORK.md`, `REPO_DIRECTIVE.md`.
- Read core simulation `lib/game-core/src/engine.ts` (1061 lines) end-to-end.
- Read `artifacts/warboss-highway/src/index.css` (theme tokens) and `lib/game/renderer.ts`.
- Ran `lib/game-core` vitest (esbuild — fast, no project-reference hang).
- Attempted `pnpm run typecheck` / `pnpm run build` / `vite build` repeatedly; isolated the
  hang; recovered `scripts/verify.sh` from git.

## Findings

### 1. Build/typecheck hang (environment, NOT a code bug)
- `pnpm run typecheck` and `pnpm run build` time out at 60s+. Isolated the stall to the
  **project-reference build** of `lib/game-core` + `lib/api-client-react` (composite
  `tsc --build`) and to `vite build` (esbuild) — even a 1-file `tsconfig` with `references`
  hangs, and a bare `vite build` hangs before printing its banner.
- Clearing stale `.tsbuildinfo` did NOT help. Per-file `tsc src/App.tsx` compiles instantly,
  proving the source itself is sound — the hang is the heavyweight project-graph pass under
  MSYS/git-bash on this Windows box (the mobile package also hit a `cygheap` fork crash, a
  known MSYS corruption symptom).
- `lib/game-core` vitest (esbuild, no `tsc --build`) runs clean: **17/17 tests pass**.
- **Impact:** CI gate (`bash scripts/verify.sh`) cannot be exercised to green in THIS
  environment. On a Linux CI runner (the repo's supported `linux-x64` target) it should pass
  — the hang is local-toolchain-specific. Verdict: blocked locally, not a code defect.

### 2. Bug — daily-challenge non-determinism (FIXED)
- `handleCrash()` (engine.ts:995) and `createParticles()` (engine.ts:1042) used
  `Math.random()`. In daily-challenge mode `initDailyRNG()` reseeds `this.rng` for
  reproducible per-day runs; the global RNG in those two spots broke that guarantee.
- Fix: switched both to `this.rng()`. Verified by `lib/game-core` vitest (deterministic path
  still 17/17). No visual/behavior change for non-daily play.

### 3. Deferred work advanced
- **OKLCH palette conversion** (deferred 2026-07-26): converted `index.css` HSL theme
  triples (`:root` tokens, `@theme inline` wrappers, 6 shadow tokens) to OKLCH, preserving
  the grim-dark red/amber identity. Code complete; visual QA still pending (no browser here).
- **`scripts/verify.sh` missing**: recovered from git `51cb933`.
- **Engine tests**: `engine.test.ts` already exists (11 tests) + achievements/daily tests —
  the 2026-07-27 "no tests" deferred item is already satisfied; verified passing.

### 4. Security / secrets
- `.env` contains only the Neon `DATABASE_URL` (password masked in this audit). No `*.p8`,
  credentials, or tokens committed. No new secrets introduced.

### 5. Pre-existing items NOT touched (need Shayan approval or live QA)
- `attached_assets/generated_audio/*.mp3` (6 files) are tracked but unreferenced since PR #5
  switched to procedural Web Audio. Deletion needs explicit go-ahead (REPO_RULES R14). Flagged.
- All visual/audio QA items (animations, new cars, SFX, road texture, title scroll speed)
  remain "implemented, unverified" — require a human/browser, out of scope to auto-verify here.
- Mobile `warboss-highway-mobile` typecheck crashes under MSYS fork corruption; needs a clean
  shell or a Linux runner to verify.

## Verification evidence
- `lib/game-core` → `pnpm exec vitest run`: **Tests 17 passed (3 files)**, exit 0.
- `scripts/verify.sh` recovered: `git show 51cb933:scripts/verify.sh` → written to disk.
- Full `pnpm run build`: **BLOCKED** by local MSYS/tsc hang (environment), not a code error.

## Next recommended tasks (priority order)
1. Verify OKLCH `index.css` visually in Chrome (HUD/menu/leaderboard colors intact).
2. Approve deletion of `attached_assets/generated_audio/*.mp3` (then `git rm`).
3. Run `bash scripts/verify.sh` on a Linux CI runner to confirm the gate is green.
4. On a clean shell / Linux, typecheck `warboss-highway-mobile` and confirm no real errors.
5. Live playtest the deferred visual/audio items (needs browser/device).

## Mobile renderer parity pass (2026-08-12, follow-up)
Compared `artifacts/warboss-highway-mobile/components/game/GameCanvas.tsx` (Skia) against
`artifacts/warboss-highway/src/lib/game/pixi-renderer.ts` (Pixi) feature-by-feature.
Mobile already led on: road contrast boost, lane dividers + double-yellow center, guardrails,
lamp posts, pooled vehicles (shadow+boost), obstacles, powerups, spark particles, exhaust
(smoke + gradient lines), player underglow, oil-slick glow, shield hex+ring, crash explosion
flash, hit-flicker. Two gaps vs the web `quality:'high'` path remained:

- **Motion blur / high-speed rush**: web applies `MotionBlurFilter` (velocity = speedMultiplier*4)
  on high quality. Mobile had no equivalent. Added a **speed-streak overlay** — four faint
  blue-white vertical `Line` nodes inside each road edge, `opacity` bound to a SharedValue that
  fades in past `speedMultiplier >= 2.5` (same threshold as the exhaust "big" plume), so the
  mobile build gets the same top-speed rush without a per-frame blur pass. Drawn via pure
  Skia `Line` nodes + derived `p2` SharedValues — zero React re-renders, same pooled pattern as
  the existing exhaust.
- **Glow bloom on shield**: web applies a cyan `GlowFilter` to the shield layer. Mobile's shield
  was a plain cyan stroke. Added a `BlurMask` child to the shield `<Path>` and `<Circle>` (the
  same mask primitive already used by `GroundShadow`), giving the mobile shield the same bloom.

Net: mobile renderer now matches the web `quality:'high'` visual feature set. NOT yet visually
verified (no emulator/browser in this environment) — needs an on-device or Expo-web playtest to
confirm the streaks read as speed (not clutter) and the shield bloom isn't overblown. Typecheck
of the mobile package still cannot run locally (MSYS `tsc` hang, see Findings #1) — verified by
manual review only; CI on Linux is the real gate.
