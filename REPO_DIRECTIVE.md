# NightRacer (Warboss Highway) Directive

## Vision
A mobile-first, browser-based top-down endless car-dodge game with a grim-dark Warhammer
40k / GTA-2 pixel aesthetic. The player steers a battle-scarred vehicle through relentless
oncoming traffic, collects four power-ups, hears AI-generated music and SFX, and competes on
a global high-score leaderboard backed by a persistent full-stack backend. (NOTE: repo folder
is `NightRacer` but the product is **Warboss Highway** — keep both names mapped in docs.)

## Non-Goals
- We will NOT turn this into a multiplayer real-time / networked game (no live opponent sync).
- We will NOT add a level editor or user-generated track system in v1.
- We will NOT introduce a paid monetization, ads, or IAP layer.
- We will NOT hand-edit the generated `lib/api-client-react` or `lib/api-zod` packages —
  those are Orval codegen outputs from `lib/api-spec/openapi.yaml`.
- We will NOT bypass the pnpm `minimumReleaseAge` supply-chain guard (Rule 34 / workspace policy).

## Phases
### P1 — Playable core loop
  exit criteria: canvas game loop, vehicle control, traffic spawning, collision + game-over,
  score persists to Postgres via /api/scores.
### P2 — Meta & persistence
  exit criteria: global leaderboard + stats endpoint live; AI-generated audio (music + SFX)
  plays and is mutable; power-ups (4) functional and counted.
### P3 — Productionization
  exit criteria: reproducible pnpm build/typecheck green in CI; deploy-dry target defined;
  README + this directive keep main green (zero red workflows).

## Sprints
### S1 — Core gameplay
  maps to: P1
### S2 — Backend & leaderboard
  maps to: P2
### S3 — Audio, polish & CI
  maps to: P2, P3

## Epics / Chapters
### E1 — Game engine (canvas, physics, spawning)
  maps to: P1
### E2 — Backend (Express 5 + Drizzle + Postgres)
  maps to: P1, P2
### E3 — Audio & UX polish
  maps to: P2, P3

## Tasks
- [ ] T1 — Verify /api/healthz + /api/scores GET/POST + /api/scores/stats against local Postgres | traces-to: P1/S2/E2 | acceptance: curl returns 200 and a score insert persists + is returned by GET
- [ ] T2 — Add reproducible `pnpm install --frozen-lockfile` + `pnpm run build` to CI gate | traces-to: P3/S3/E2 | acceptance: gate.yml build stage green on a clean clone
- [ ] T3 — Author README.md with stack map, run commands, and Warboss Highway naming note | traces-to: P3/S3/E3 | acceptance: README.md present and doc-freshness check passes
- [ ] T4 — Confirm Orval codegen regenerates api-client-react/api-zod from openapi.yaml | traces-to: P2/S2/E2 | acceptance: `pnpm --filter @workspace/api-spec run codegen` produces no diff vs committed generate
- [ ] T5 — Add `.env` / `.env.*` coverage to .gitignore and verify DATABASE_URL is never committed | traces-to: P3/S3/E2 | acceptance: secret-scan passes with a local .env present
- [ ] T6 — Validate power-up logic + count (`powerups_used`) flows end-to-end into the scores table | traces-to: P2/S2/E3 | acceptance: POST /api/scores with powerups_used=4 reflected in GET /api/scores/stats
- [ ] T7 — Add a deploy-dry target (vercel/railway/eas) or record "none" in DEFERRED_WORK | traces-to: P3/S3/E3 | acceptance: deploy-dry stage is either green or explicitly deferred with reason

## Sentinel Constraints
- auto-label: lint/docs/governance-only changes on a branch may skip the internal Sentinel review step, but this never authorizes merging — Shayan's PR approval is still required for every merge (never main).
- review-required: any change to `lib/api-spec/openapi.yaml`, `lib/db/src/schema`, game physics, or auth.
- locked: `main` branch — no direct push (Rule 26). Seeded secrets/credentials never committed (Rule 19).
