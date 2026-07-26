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
  it was never run/verified end-to-end in this environment (no Docker here) — resume by
  running `bash scripts/dev-db.sh` on a Docker-capable machine and confirming
  `pnpm --filter @workspace/api-server run dev` boots — status: script added, unverified.
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
