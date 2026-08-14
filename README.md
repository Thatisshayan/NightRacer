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

## Supported platforms
Local dev + CI currently target **`linux-x64`** (Replit deploy) and **`win32-x64`**
(Windows contributors) only — see `pnpm-workspace.yaml`'s `supportedArchitectures` and
the `gate`/`windows-smoke` jobs in `.github/workflows/gate.yml`. macOS (darwin) and arm64
are **not** in the supported install matrix: `pnpm install` will not fetch native
optional-dependency binaries (rollup, lightningcss, @tailwindcss/oxide, esbuild, etc.)
for those platforms and builds will fail. If macOS/arm64 support is needed, add the
platform to `supportedArchitectures` and add a matching CI smoke job first.

## Run & Operate
- Database: Postgres is hosted on [Neon](https://console.neon.tech) (project `nightracer`) — used for local dev,
  staging, and prod alike. No local/Docker Postgres needed. Copy `.env.example` to `.env` and fill in
  `DATABASE_URL` with your Neon connection string (dashboard → project → Connection Details → pooled connection).
- `pnpm --filter @workspace/api-server run dev` — API server (port 5000)
- `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/warboss-highway run dev` — game frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — repository release build: typechecks every package and builds all environment-independent packages. The native Expo static-export command is intentionally excluded because it requires a deployment-domain environment variable; native correctness remains covered by its typecheck and dedicated iOS build workflow.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` (Neon Postgres connection string). Copy `.env.example` to `.env` and fill it in.
- **Windows (git-bash) gotcha:** MSYS auto-converts a bare `/` in an env value into a Windows path,
  which breaks `BASE_PATH=/`. Prefix the frontend dev/build command with `MSYS_NO_PATHCONV=1` on Windows, e.g.
  `MSYS_NO_PATHCONV=1 PORT=5173 BASE_PATH=/ pnpm --filter @workspace/warboss-highway run dev`.

## Where things live
- `artifacts/warboss-highway/` — React + Vite frontend game (canvas + HUD)
- `artifacts/api-server/` — Express backend (`src/routes/health.ts`, `scores.ts`)
- `lib/api-spec/openapi.yaml` — SOURCE OF TRUTH for all API contracts
- `lib/api-client-react/` — generated React Query hooks (**do not hand-edit**)
- `lib/api-zod/` — generated Zod validation schemas (**do not hand-edit**)
- `lib/db/src/schema/scores.ts` — Drizzle schema for the `scores` table

## Design and repository governance
- [`docs/NEON_RAINWAY_DESIGN.md`](docs/NEON_RAINWAY_DESIGN.md) — the current visual-system, Rush-mechanic, performance, and cross-platform implementation guide.
- [`ASSETS.md`](ASSETS.md) — functional palette, visual target, and asset usage rules for the Neon Rainway overhaul.
- This repo is governed by `REPO_RULES.md` (branch-only, main protected, no secret commits) and `REPO_DIRECTIVE.md` (goal layer). CI gate: `bash scripts/verify.sh`. Never push to `main`; open a PR from a feature/agent branch and require Shayan approval.

## Gotchas
- Do NOT disable pnpm `minimumReleaseAge` (supply-chain guard in `pnpm-workspace.yaml`).
- API client + zod packages are codegen outputs — edit `openapi.yaml`, not the generated files.
- `DATABASE_URL` must come from `.env` (gitignored), never committed.
