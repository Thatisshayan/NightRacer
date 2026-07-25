# NightRacer — "Warboss Highway"

> ⚠️ Naming note: this repo folder is `NightRacer`, but the product is **Warboss Highway**.
> Keep both names mapped in docs and issues.

A mobile-first, browser-based **top-down endless car-dodge game** with a grim-dark Warhammer
40k / GTA-2 pixel aesthetic. Steer a battle-scarred vehicle through relentless oncoming
traffic, collect four power-ups, hear AI-generated music + SFX, and compete on a global
high-score leaderboard backed by a persistent full-stack backend.

## Stack
- **Monorepo**: pnpm workspaces, Node.js 24, TypeScript 5.9
- **Frontend**: React + Vite (TypeScript), HTML5 Canvas game engine, Wouter routing, Tailwind v4
- **State/Data**: TanStack React Query + Orval-generated hooks
- **Backend**: Express 5 (Node.js)
- **DB**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`) via `drizzle-zod`
- **API contract**: OpenAPI 3.1 (`lib/api-spec/openapi.yaml`) → Orval codegen
- **Audio**: HTML5 Audio API + AI-generated tracks

## Run & Operate
- `pnpm --filter @workspace/api-server run dev` — API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` (Postgres connection string)

## Where things live
- `artifacts/warboss-highway/` — React + Vite frontend game (canvas + HUD)
- `artifacts/api-server/` — Express backend (`src/routes/health.ts`, `scores.ts`)
- `lib/api-spec/openapi.yaml` — SOURCE OF TRUTH for all API contracts
- `lib/api-client-react/` — generated React Query hooks (**do not hand-edit**)
- `lib/api-zod/` — generated Zod validation schemas (**do not hand-edit**)
- `lib/db/src/schema/scores.ts` — Drizzle schema for the `scores` table

## Repository governance
This repo is governed by `REPO_RULES.md` (branch-only, main protected, no secret commits)
and `REPO_DIRECTIVE.md` (goal layer). CI gate: `bash scripts/verify.sh`. Never push to `main`;
open a PR from a feature/agent branch and require Shayan approval.

## Gotchas
- Do NOT disable pnpm `minimumReleaseAge` (supply-chain guard in `pnpm-workspace.yaml`).
- API client + zod packages are codegen outputs — edit `openapi.yaml`, not the generated files.
- `DATABASE_URL` must come from `.env` (gitignored), never committed.
