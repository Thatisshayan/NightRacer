# Replit decoupling, sub-project 2: Web hosting

Part of the larger Replit-decoupling effort (database → **web hosting** → mobile build
pipeline → CI check). Sub-project 1 (database → Neon) is done; see
`2026-07-27-replit-decoupling-database-design.md`.

**Approval:** repo owner (Shayan) directed this effort directly in conversation on
2026-07-27, explicitly naming Vercel as the frontend host and choosing "single Vercel
project for both frontend + API" over the alternative when asked — not a unilateral
tooling choice.

## Decision

Single Vercel project (`nightracer`) serving both the frontend and API:
- Frontend: `artifacts/warboss-highway` (Vite SPA) built to static output.
- API: `artifacts/api-server` (Express) as a Vercel serverless function.
- Same origin, so the frontend's existing relative-path `fetch('/api/...')` calls
  (`lib/api-client-react/src/custom-fetch.ts`, no base URL configured) work with zero
  frontend code changes — no CORS, no client wiring needed.

## What was done

- `artifacts/api-server/build.mjs`: added `src/app.ts` as a second esbuild entry point
  alongside the existing `src/index.ts`, producing `dist/app.mjs` — the Express app
  itself, without the `app.listen(...)` call that `index.mjs`'s entry (`src/index.ts`) has.
  Reuses the exact same esbuild config (plugins, externals) as the proven `index.mjs` build.
- `api/index.mjs` (repo root, Vercel's serverless function convention): re-exports
  `dist/app.mjs`'s default export. Vercel's Node runtime accepts an Express app's request
  handler as a function's default export directly.
- `vercel.json` (repo root):
  - `buildCommand` builds both `api-server` and `warboss-highway`.
  - `outputDirectory: artifacts/warboss-highway/dist/public`.
  - `rewrites`: `/api/(.*)` → `/api`, so all `/api/*` paths reach the one function
    (Express's own `app.use("/api", router)` handles sub-routing from there).
- Created the Vercel project (`nightracer`, team `shayans-projects-d00acc44`) via
  `vercel link`, which also auto-connected the GitHub repo
  (`https://github.com/Thatisshayan/NightRacer`) since the Vercel GitHub App was already
  authorized for this account — every push to `main` (and every PR) now auto-deploys.
  No manual dashboard step was needed.
- Set `DATABASE_URL` (the Neon connection string from sub-project 1) as a Vercel
  environment variable for both Production and Preview via `vercel env add`.
- Deployed to production via `vercel deploy --prod`. Live at `nightracer.vercel.app`.

## A risk investigated and ruled out

Pino's `pino-pretty` transport spawns a worker thread by dynamically resolving a file
path at runtime — not a static `import`, so Vercel's function bundler (which traces static
imports from `api/index.mjs`) might not include that sibling file in the deployed function,
risking a crash. Checked `artifacts/api-server/src/lib/logger.ts`: the `pino-pretty`
transport is only configured when `NODE_ENV !== 'production'`. Vercel sets
`NODE_ENV=production` for both build and runtime by default, so the transport (and the
dynamic worker-thread loading) is never invoked in this deployment. Not a real risk here.

## Verified (not just "deployed")

- `pnpm --filter @workspace/api-server run build` produces both `dist/index.mjs` and
  `dist/app.mjs`.
- Locally imported `dist/app.mjs`, wrapped it in a plain `http.createServer`, and hit
  `GET /api/scores` — got a real `200 []` through the Neon DB (proves the bundle is a
  working Express app before ever touching Vercel).
- Live production deploy (`https://nightracer.vercel.app`): `GET /` → `200`;
  `GET /api/scores` → `200 []` — a real round-trip through the same Neon database from
  sub-project 1, on the actual deployed serverless function.
- `get_runtime_errors` on the live project: one benign warning only (`pg` deprecation
  notice about `sslmode=require` being aliased to `verify-full` in a future major version —
  pre-existing, not introduced by this change, not worth acting on now).

## Not in scope / not done here

- Did not test a POST (score submission) against the live deployment, to avoid writing
  test junk into the fresh production leaderboard — the local `dist/app.mjs` smoke test
  and sub-project 1's local API-server test already both proved write paths work against
  this same Neon DB.
- The `warboss-highway.repl.co` domain string still appears in the share-card canvas text
  (`game-over-overlay.tsx`) and a code comment — cosmetic, not a functional dependency on
  Replit, not fixed here. A custom domain was explicitly not requested (using
  `nightracer.vercel.app` for now) — worth revisiting together.
- `artifacts/warboss-highway/vite.config.ts` unconditionally includes
  `@replit/vite-plugin-runtime-error-modal` (the other two Replit vite plugins,
  `cartographer` and `dev-banner`, are already gated behind `REPL_ID !== undefined` and are
  no-ops off Replit). This one isn't gated — it's a dev-only error overlay, harmless in a
  production build, but still a live Replit-specific dependency. Not removed here.
- **Preview deploys share the production database.** `DATABASE_URL` was set identically for
  both Production and Preview (same Neon connection string) — flagged by CodeRabbit as a
  real issue: a PR preview deploy can write test data into (or query) the real production
  leaderboard through any write route. The correct fix is a separate Neon branch (Neon
  supports instant branching for exactly this) with its own connection string set as the
  Preview-only `DATABASE_URL`. Not done in this PR because it needs the Neon API key again
  (not retained after sub-project 1, by design — see that spec's note on secret handling),
  and creating it wasn't worth blocking this merge on. Resume by creating a `preview`
  branch on the `nightracer` Neon project and running
  `vercel env rm DATABASE_URL preview && vercel env add DATABASE_URL preview` with that
  branch's connection string.
- No staging environment/branch distinct from Preview deploys was set up.
- Frontend `dist/public/assets/index-*.js` is ~546 kB minified (Vite's build warned about
  chunk size) — pre-existing, not introduced by this change, not addressed here.
