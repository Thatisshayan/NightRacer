# Warboss Highway — Project Handoff Document

> Rewritten 2026-08-01. The previous version of this doc described the pre-refactor,
> web-only architecture (engine living under `artifacts/warboss-highway/src/lib/game/`,
> no mobile app, Replit-managed run/deploy). All of that changed in the "native mobile
> rebuild" PR (#11, merged 2026-07-28). This version reflects current `main`.

## What Is This?

**Warboss Highway** is a top-down endless car-dodge game with a grim-dark Warhammer 40k /
GTA-2 pixel aesthetic. Steer a battle-scarred vehicle through oncoming traffic, collect
power-ups, survive boss encounters, and compete on a global high-score leaderboard.

It now ships on **two platforms from one shared simulation**:
- A **web app** (`artifacts/warboss-highway`) — React + Vite + Pixi.js, playable in a browser.
- A **native iOS/Android app** (`artifacts/warboss-highway-mobile`) — Expo + React Native +
  react-native-skia, the app actually distributed via TestFlight/App Store.

Both consume the same platform-agnostic game simulation from `lib/game-core` — there is one
source of truth for spawning, collisions, scoring, and power-up logic, not two parallel
implementations.

**Current state (as of 2026-08-01): the mobile app was rated 0.25/10 on a real device.** It
loads and plays, but is not good yet. See "Known Issues" below before doing anything else
with it — a specific, diagnosed perf bug (forced full-React-reconciliation every frame) is
the leading suspect, and most of the polish/QA items were never verified on real hardware
before merge.

---

## Tech Stack

| Layer | Web (`warboss-highway`) | Native (`warboss-highway-mobile`) |
|---|---|---|
| Framework | React + Vite | Expo (React Native, expo-router) |
| Rendering | Pixi.js (`pixi-renderer.ts`) | react-native-skia (`GameCanvas.tsx`) |
| Input | Pointer/touch → `web-engine.ts` | `react-native-gesture-handler` pan gesture |
| Audio | Live Web Audio synthesis (`audio.ts`) | Pre-rendered SFX/music via `expo-audio` (`native-audio.ts`) |
| Settings | `localStorage` (`settings.ts`) | `AsyncStorage` (`lib/settings.ts`) |
| Styling | Tailwind CSS v4 | React Native `StyleSheet` + `constants/colors.ts` |
| Routing | Wouter | expo-router (`app/` file-based routes, tab layout) |

Shared across both:

| Layer | Technology |
|---|---|
| Game simulation | `lib/game-core` — plain TypeScript, no DOM/RN imports, vitest-tested |
| State / Data | TanStack React Query + Orval-generated hooks (`lib/api-client-react`) |
| Backend | Express 5 (Node.js), `artifacts/api-server` |
| Database | PostgreSQL (hosted on Neon) + Drizzle ORM (`lib/db`) |
| Validation | Zod, generated into `lib/api-zod` from the OpenAPI spec |
| API Contract | OpenAPI 3.1 (`lib/api-spec/openapi.yaml`) → Orval codegen |
| Monorepo | pnpm workspaces |

---

## Project Structure

```
NightRacer/
├── lib/
│   ├── game-core/                    ← SHARED simulation, used by both apps
│   │   └── src/
│   │       ├── engine.ts             ← GameEngine: spawn/physics/collision/scoring/bosses
│   │       ├── achievements.ts       ← Achievement definitions + unlock logic
│   │       ├── daily.ts              ← Daily-modifier rotation (7-day cycle)
│   │       └── *.test.ts             ← vitest unit tests (engine/achievements/daily)
│   ├── api-spec/openapi.yaml         ← SOURCE OF TRUTH for all API contracts
│   ├── api-client-react/             ← Generated React Query hooks (do not hand-edit)
│   ├── api-zod/                      ← Generated Zod validation schemas (do not hand-edit)
│   └── db/src/schema/                ← Drizzle schema (scores table)
├── artifacts/
│   ├── warboss-highway/              ← Web frontend (React + Vite + Pixi.js)
│   │   └── src/
│   │       ├── pages/Game.tsx        ← Main game page (canvas + HUD)
│   │       ├── pages/Leaderboard.tsx ← Kill-board scores + stats
│   │       └── lib/game/
│   │           ├── web-engine.ts     ← WebGameEngine: game-core subclass for browser
│   │           ├── pixi-renderer.ts  ← Pixi.js scene renderer
│   │           ├── audio.ts          ← Live Web Audio synthesis (SFX/music)
│   │           ├── sprites.ts        ← Sprite loading/atlas
│   │           └── settings.ts       ← localStorage-backed settings
│   ├── warboss-highway-mobile/       ← Native app (Expo / React Native)
│   │   ├── app/                      ← expo-router routes
│   │   │   ├── _layout.tsx           ← Root layout
│   │   │   └── (tabs)/               ← index.tsx (game tab), leaderboard.tsx
│   │   ├── components/game/
│   │   │   ├── native-engine.ts      ← NativeGameEngine: game-core subclass for RN
│   │   │   ├── GameCanvas.tsx        ← react-native-skia renderer (see Known Issues)
│   │   │   ├── HudOverlay.tsx        ← Score/lives/power-up HUD
│   │   │   ├── TitleScreen.tsx / GameOverScreen.tsx / PauseOverlay.tsx / TutorialOverlay.tsx
│   │   │   ├── useGameEngine.ts      ← Engine lifecycle hook (owns the engine instance)
│   │   │   └── sprites.ts            ← Sprite/image loading for Skia
│   │   ├── lib/
│   │   │   ├── native-audio.ts       ← expo-audio pre-rendered SFX/music playback
│   │   │   └── settings.ts           ← AsyncStorage-backed settings
│   │   └── scripts/generate-sfx.mjs  ← Generates the pre-rendered audio assets
│   ├── api-server/                   ← Express backend
│   │   └── src/
│   │       ├── app.ts / index.ts
│   │       └── routes/{health,scores,index}.ts
│   └── mockup-sandbox/               ← Unrelated design/mockup preview tool, not part of the game
└── .github/workflows/
    ├── gate.yml                      ← governance-gate CI (typecheck/build/test/doc-freshness/secret-scan)
    └── ios-build.yml                 ← Builds + signs the iOS app for TestFlight
```

---

## Shared Game Simulation (`lib/game-core`)

`GameEngine` (in `engine.ts`) owns all simulation state and is platform-agnostic — no DOM,
no React Native, no rendering calls. Each platform:
1. Subclasses it (`WebGameEngine` / `NativeGameEngine`) to wire in real input coordinates.
2. Implements a small `GameRenderer` interface (`sync(state, cameraY, screenShake)`) and a
   `AudioAdapter` interface (`play(cue, loop?)` / `stop(cue)`), and hands those in — the
   engine calls them, never a concrete audio/render API directly.

Key types (`engine.ts`):
- `CarType`: `RATTLETRAP | WAR_RUNNER | DEATHSLED | SCRAPQUEEN | PHANTOM` — player-selectable cars, each with its own `CAR_STATS` (size/speed/color).
- `VehicleType`: `SEDAN | PICKUP | COP | BOXTRUCK | BUS | SPORTS | TANK | BOSS` — oncoming traffic, `TANK` is rare/high-hitbox, `BOSS` spawns every `BOSS_INTERVAL_MS` (60s).
- `PowerUpType`: `SHIELD | SLOWMO | SCORE_BLAST | EXTRA_LIFE`, durations centralized in `POWERUP_DURATION_MS`.
- `achievements.ts` / `daily.ts`: unlockable achievements and a 7-day rotating daily-modifier cycle — both covered by vitest tests, unlike the rest of the game.

Run the shared package's tests: `pnpm --filter @workspace/game-core run test`.

---

## Backend / API

Routes live in `artifacts/api-server/src/routes/scores.ts`, prefixed `/api`:

| Method | Path | Description |
|---|---|---|
| GET | `/api/healthz` | Health check |
| GET | `/api/scores?limit=20&period=all\|daily\|weekly` | Leaderboard, max `limit` 100 |
| POST | `/api/scores` | Submit a score (server-side plausibility check against distance traveled) |
| GET | `/api/scores/stats` | Global aggregate stats |

The `scores` table (Drizzle, `lib/db/src/schema`) additionally tracks `car` and
`dailyMode` per submission — not just the four original fields. `POST /api/scores` rejects
implausible scores using a distance-scaled ceiling (`MAX_SCORE_PER_DISTANCE = 1.5`, absolute
ceiling `200_000`) rather than trusting the client outright.

Editing the contract: change `lib/api-spec/openapi.yaml` → run
`pnpm --filter @workspace/api-spec run codegen` → implement in `api-server/src/routes/` →
consume the newly generated hook from `@workspace/api-client-react`. Never hand-edit
`lib/api-client-react` or `lib/api-zod` — they're generated.

---

## Infra / Deployment

- **Database**: Neon Postgres (project `nightracer`), used for dev/staging/prod. Preview
  deployments get their own isolated Neon branch (`preview`), not the shared prod DB.
- **Web app**: Vercel (`vercel.json` — builds `api-server` + `warboss-highway`, serves
  `artifacts/warboss-highway/dist/public`, rewrites `/api/*`).
- **Native app**: Built and signed via `.github/workflows/ios-build.yml` (no EAS) → TestFlight.
- **CI**: `.github/workflows/gate.yml` — `governance-gate` (secret-scan, doc-freshness,
  typecheck/build/test, Vercel deploy-dry) + `windows-smoke` (pnpm install/build on Windows).
- Replit is fully decoupled — nothing in the current pipeline depends on it.

## How to Run Locally

```bash
# API server (port 5000) — needs DATABASE_URL, see .env.example
pnpm --filter @workspace/api-server run dev

# Web game (port 5173)
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/warboss-highway run dev

# Native app — from artifacts/warboss-highway-mobile
pnpm exec expo start

# Full-repo typecheck
pnpm run typecheck

# Shared engine tests
pnpm --filter @workspace/game-core run test
```

Windows/git-bash: prefix the web dev/build command with `MSYS_NO_PATHCONV=1` (MSYS mangles
the bare `/` in `BASE_PATH=/`). See `README.md` for the full gotcha list.

---

## Known Issues (read before touching the mobile app)

- **Per-frame full React re-render — fixed 2026-08-02, unverified on-device.**
  `GameCanvas.tsx` used to hold `const [, setTick] = useState(0)` bumped on every engine
  frame to force React to rebuild the entire Skia scene graph (road tiles + every entity) at
  ~60fps. Flagged in PR #11 review (Qodo: "Per-frame react rendering overhead") and left
  unfixed through two follow-up commits. Phase 1 (road tile grid) landed first; this pass
  finishes it: obstacles/vehicles/powerups/particles now render through fixed-size pools of
  stable Skia nodes (`SpriteSlot`/`ParticleSlot`) whose position/size/opacity are driven by
  Reanimated `SharedValue`s mutated directly in the engine's `sync()` callback — react-native-
  skia accepts a `SharedValue` anywhere a prop is normally a plain value and updates the
  native draw command without going through React's reconciler at all. Pool slots are
  assigned by entity object identity (a `Map`), not array index, which is safe because
  engine.ts mutates entities in place and only ever removes them via `splice()` — never
  clones/replaces a live entity — so identity survives a mid-array removal of a sibling. The
  component itself now renders exactly once per mount; every subsequent frame is pure
  SharedValue mutation. This has **not** been played on a real device or emulator — this dev
  environment can't run one (see below) — so it fixes the diagnosed root cause but the actual
  on-device feel is still unconfirmed. Verify by playtesting and re-rating before calling this
  done.
- **This dev environment cannot run/preview the mobile app.** `expo start --web` starts the
  Metro bundler but the first web bundle (react-native-skia + expo-router) hangs indefinitely
  here (3+ min, near-idle CPU, no bundler progress output) — confirmed 2026-08-02. Don't
  burn time trying to get a browser preview working on this machine; verification needs a
  real device/simulator via the existing `ios-build.yml` → TestFlight pipeline, or an Android
  emulator on a machine that can actually run one.
- **Real-device playtesting rated the app 0.25/10** (2026-08-01). It loads and plays but
  feels bad. Most of the PR's own test-plan checklist (traffic/collision feel, HUD
  correctness, audio playback, carousel selection) was never checked off — it was merged on
  typecheck + CI green + code reading alone, not gameplay verification. The perf fix above is
  the leading-suspect fix for the bad feel, but the 0.25/10 rating itself won't be updated
  until someone actually replays it.
- See `docs/governance/DEFERRED_WORK.md` for the full list of implemented-but-unverified
  items on both platforms (audio pause/resume correctness, road texture tiling, title-scroll
  speed, OKLCH color conversion, unused legacy audio assets still tracked in git, etc).
- `artifacts/warboss-highway` (web) has zero automated tests; only `lib/game-core` does.

---

## Known Limitations / Future Ideas

- No user accounts — leaderboard entries are identified by free-text callsign only.
- No levels/checkpoints — pure endless mode.
- Only one power-up active at a time — no stacking.
- Leaderboard `period` filter exists (`daily`/`weekly`/`all`) but no UI control for it yet
  on either platform — verify before assuming it's exposed.

---

## Key Files Reference

| Task | File |
|---|---|
| Shared game engine / loop | `lib/game-core/src/engine.ts` |
| Achievements / daily modifiers | `lib/game-core/src/achievements.ts`, `daily.ts` |
| Web renderer | `artifacts/warboss-highway/src/lib/game/pixi-renderer.ts` |
| Web engine subclass | `artifacts/warboss-highway/src/lib/game/web-engine.ts` |
| Web audio | `artifacts/warboss-highway/src/lib/game/audio.ts` |
| Native renderer (Skia) | `artifacts/warboss-highway-mobile/components/game/GameCanvas.tsx` |
| Native engine subclass | `artifacts/warboss-highway-mobile/components/game/native-engine.ts` |
| Native audio | `artifacts/warboss-highway-mobile/lib/native-audio.ts` |
| API routes (scores) | `artifacts/api-server/src/routes/scores.ts` |
| Database schema | `lib/db/src/schema/scores.ts` |
| OpenAPI spec | `lib/api-spec/openapi.yaml` |
| Deferred/unverified work log | `docs/governance/DEFERRED_WORK.md` |
