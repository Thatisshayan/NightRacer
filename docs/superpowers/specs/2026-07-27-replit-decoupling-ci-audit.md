# Replit decoupling, sub-project 4: CI Replit-env-var audit

Part of the larger Replit-decoupling effort (database → web hosting → iOS build pipeline →
**CI check**). Sub-projects 1–3 are done and merged.

## Finding: already clean, no code changes needed

Audited every reference to Replit-specific env vars (`REPL_ID`, `REPLIT_DEV_DOMAIN`,
`REPLIT_INTERNAL_APP_DOMAIN`, `REPLIT_EXPO_DEV_DOMAIN`, `REPLIT_DOMAINS`) across the repo:

- **`.github/workflows/*.yml`** (`gate.yml`, `ios-build.yml`) — zero references. CI has never
  depended on any Replit-injected environment variable.
- **`artifacts/warboss-highway/vite.config.ts`** and **`artifacts/mockup-sandbox/vite.config.ts`**
  — both gate their Replit-specific dev-tooling plugins (`@replit/vite-plugin-cartographer`,
  `@replit/vite-plugin-dev-banner`) behind `process.env.NODE_ENV !== "production" &&
  process.env.REPL_ID !== undefined`. Outside Replit (including every CI run), this
  condition is false and the plugins are simply never imported — a clean no-op, not a
  failure mode.
- **`artifacts/warboss-highway-mobile/scripts/build.js`**'s `getDeploymentDomain()` — the
  only place that looked concerning at first (checks `REPLIT_INTERNAL_APP_DOMAIN` and
  `REPLIT_DEV_DOMAIN` before erroring) already has an explicit `if (process.env.CI)`
  fallback that returns a placeholder domain instead of exiting non-zero. GitHub Actions
  sets `CI=true` by default on every runner, so this path was already correctly handled —
  confirmed by re-reading the full function (not just grepping for matches), after an
  initial local repro attempt gave a false alarm (see below).
- **`artifacts/warboss-highway-mobile/package.json`**'s `dev` script — genuinely
  Replit-specific (`EXPO_PACKAGER_PROXY_URL=https://$REPLIT_EXPO_DEV_DOMAIN ...`), but it's
  a local-dev-only script. No CI workflow invokes `pnpm run dev` anywhere.

## A false alarm along the way, worth recording

Locally running `pnpm --filter @workspace/warboss-highway-mobile run build` failed with
exactly the Replit-domain error this audit was looking for — but that's because my local
shell doesn't have `CI` set, not because the CI-facing code path is broken. Cross-checked
against real passing `governance-gate` CI logs (multiple runs across this session) to
confirm the root `pnpm run --if-present build` step reports `build ok` for real, not
skipped or masked. Don't trust a local repro over actual CI logs when the two disagree —
the local shell isn't running under the same env-var conditions CI's own logic branches on.

## Not in scope / not done here

- `artifacts/warboss-highway-mobile/package.json`'s `dev` script is still Replit-specific —
  intentionally out of scope, same reasoning as the earlier sub-projects: this audit is
  about the CI/production path, not the local Replit dev experience.
- `replit.md` and any `.replit-artifact/` directories are Replit's own project metadata —
  harmless, untouched by CI, left in place.
