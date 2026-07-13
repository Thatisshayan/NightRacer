# Warboss Highway — Project Handoff Document

## What Is This?

**Warboss Highway** is a mobile-first, browser-based top-down endless car dodge game. The player steers a battle-scarred vehicle through relentless oncoming traffic drawn in a GTA 2 / Warhammer 40k pixel-art aesthetic. It features a global high score leaderboard, four power-ups, AI-generated background music, sound effects, and a full-stack backend for persistent scoring.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite (TypeScript) |
| Game Engine | HTML5 Canvas + requestAnimationFrame |
| Styling | Tailwind CSS v4, custom CSS variables |
| Routing | Wouter |
| State / Data | TanStack React Query + Orval-generated hooks |
| Backend | Express 5 (Node.js) |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod (api-zod generated schemas) |
| API Contract | OpenAPI 3.1 spec → Orval codegen |
| Audio | HTML5 Audio API + AI-generated tracks |
| Monorepo | pnpm workspaces |

---

## Project Structure

```
workspace/
├── artifacts/
│   ├── warboss-highway/          ← Frontend game (React + Vite)
│   │   └── src/
│   │       ├── App.tsx           ← Routes: / and /leaderboard
│   │       ├── index.css         ← Grim-dark theme variables
│   │       ├── pages/
│   │       │   ├── game.tsx      ← Main game page (canvas + HUD)
│   │       │   └── leaderboard.tsx ← Kill-board scores + stats
│   │       └── lib/game/
│   │           ├── engine.ts     ← Core game loop, physics, spawning
│   │           ├── vehicles.ts   ← All vehicle drawing functions (canvas primitives)
│   │           ├── powerups.ts   ← Power-up logic and rendering
│   │           └── audio.ts      ← Audio management (play/stop/mute)
│   └── api-server/               ← Express backend
│       └── src/routes/
│           ├── health.ts         ← GET /api/healthz
│           └── scores.ts         ← GET/POST /api/scores, GET /api/scores/stats
├── lib/
│   ├── api-spec/openapi.yaml     ← SOURCE OF TRUTH for all API contracts
│   ├── api-client-react/         ← Generated React Query hooks (do not hand-edit)
│   ├── api-zod/                  ← Generated Zod validation schemas (do not hand-edit)
│   └── db/src/schema/
│       └── scores.ts             ← Drizzle schema for the scores table
└── attached_assets/
    └── generated_audio/
        ├── gameplay_track.mp3    ← Main gameplay loop music
        ├── menu_track.mp3        ← Title/menu screen music
        ├── sfx_crash.mp3         ← Collision sound effect
        ├── sfx_powerup.mp3       ← Power-up collect sound
        ├── sfx_shield.mp3        ← Shield activation sound
        └── sfx_gameover.mp3      ← Game over sound
```

---

## Database Schema

**Table: `scores`**

| Column | Type | Notes |
|---|---|---|
| id | serial (PK) | Auto-increment |
| player_name | text | Max 20 chars (enforced by API) |
| score | integer | Final game score |
| powerups_used | integer | Count of power-ups collected |
| distance_traveled | integer | In arbitrary game units |
| created_at | timestamp | Auto-set on insert |

---

## API Endpoints

All routes are prefixed `/api`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/healthz` | Server health check |
| GET | `/api/scores?limit=20` | Top scores leaderboard (max 100) |
| POST | `/api/scores` | Submit a new score |
| GET | `/api/scores/stats` | Global aggregate stats |

### POST /api/scores — Request Body
```json
{
  "playerName": "WARBOSS",
  "score": 12450,
  "powerupsUsed": 7,
  "distanceTraveled": 3820
}
```

### GET /api/scores/stats — Response
```json
{
  "totalGamesPlayed": 142,
  "highestScore": 48200,
  "averageScore": 5340,
  "totalPowerupsUsed": 891
}
```

---

## Game Mechanics

### Core Loop
- Player car starts centered in lane 2 of 3 lanes
- Oncoming vehicles spawn from the top, travel downward at increasing speed
- Player moves left/right to avoid collisions
- Score increases continuously with distance survived
- Speed multiplier increases every 15 seconds (max 3x)
- 3 lives on start; game over at 0 lives

### Controls
| Input | Action |
|---|---|
| Touch drag | Move car left/right (primary — mobile) |
| Arrow Left / A | Move car left |
| Arrow Right / D | Move car right |

### Vehicle Types (all canvas-drawn, no sprites)
| Vehicle | Lanes | Rarity | Notes |
|---|---|---|---|
| Sedan | Any | Common | Medium hitbox |
| Sports Car | Any | Common | Moves faster |
| Pickup Truck | Any | Common | Slightly wider |
| Cop Car | Any | Uncommon | Flashing roof light |
| Box Truck | 1–2 center | Uncommon | Large hitbox |
| Bus | Center | Rare | 1.5 lane wide |
| Tank | Center | Ultra-rare (1%) | Massive hitbox, +500 dodge bonus |

### Power-ups
| Name | Icon | Duration | Effect |
|---|---|---|---|
| SHIELD | Blue hexagon | 5 sec | Full invincibility + visual forcefield |
| SLOW-MO | Yellow clock | 4 sec | All traffic at 40% speed |
| SCORE BLAST | Orange star | 6 sec | 3x score multiplier |
| EXTRA LIFE | Red heart | Instant | +1 life (max 5) |

### Collision
- Flash red + 2 sec invincibility window
- Screen shake via canvas transform
- Particle sparks emitted at impact point
- Crash sound plays

### Game Over Flow
1. Lives reach 0 → "WASTED" overlay on canvas
2. Display: final score, distance, power-ups used
3. Player enters their callsign (name, max 20 chars)
4. Submit → POST /api/scores → redirect to /leaderboard

---

## Pages

### `/` — Main Game
- Title card shown before first game (with "PLAY" button)
- Full-screen canvas with HUD overlay:
  - Top-left: SCORE (live counter)
  - Top-right: LIVES (heart icons)
  - Bottom-left: Active power-up name + countdown
- Mute toggle button (speaker icon, top corner)
- Music: gameplay_track.mp3 (looped)

### `/leaderboard` — Kill-Board
- Global stats banner (total games, highest score, avg score, total power-ups)
- Table: rank, callsign, score, distance, power-ups, date
- "PLAY AGAIN" button back to /
- Music: menu_track.mp3 (looped)

---

## Audio System

Audio files live in `attached_assets/generated_audio/` and are imported via Vite's `@assets` alias. The audio module (`src/lib/game/audio.ts`) exposes:

- `playAudio(type, loop?)` — plays a named track
- `stopAudio(type)` — stops and resets a track
- `toggleMute()` — global mute toggle
- `getMuted()` — current mute state

All audio is loaded lazily on first interaction (bypasses browser autoplay restrictions).

> **Note on music:** The background tracks are AI-generated instrumentals with a gritty urban/synthwave feel inspired by the GTA series. They are original and royalty-free. Actual GTA music is copyrighted and could not be included.

---

## How to Run Locally

The app runs via Replit's managed workflows. No manual startup needed.

```bash
# Regenerate API types after spec changes
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes (dev only)
pnpm --filter @workspace/db run push

# Typecheck everything
pnpm run typecheck

# Typecheck just the frontend
pnpm --filter @workspace/warboss-highway run typecheck

# Typecheck just the API server
pnpm --filter @workspace/api-server run typecheck
```

---

## How to Customize

### Change the game name
- Update the title card text in `src/pages/game.tsx`
- Update `<title>` in `artifacts/warboss-highway/index.html`

### Add a new vehicle type
1. Open `src/lib/game/vehicles.ts`
2. Add a new draw function following the existing pattern (canvas primitives only)
3. Register it in the vehicle spawner in `src/lib/game/engine.ts` with desired spawn weight/rarity

### Add a new power-up
1. Add the type to the power-up union in `src/lib/game/powerups.ts`
2. Implement the effect in the game engine's power-up activation handler
3. Add the icon draw function

### Change difficulty curve
- In `src/lib/game/engine.ts`, find the speed multiplier ramp — adjust the interval (currently 15 sec) and the cap (currently 3x)

### Change the color scheme
- All colors are CSS custom properties in `artifacts/warboss-highway/src/index.css`
- The `--primary`, `--accent`, `--destructive` variables drive the grim-dark palette

### Add a new API endpoint
1. Add the endpoint to `lib/api-spec/openapi.yaml`
2. Run `pnpm --filter @workspace/api-spec run codegen`
3. Implement the route in `artifacts/api-server/src/routes/`
4. Register the router in `artifacts/api-server/src/routes/index.ts`
5. Use the newly generated hook from `@workspace/api-client-react` in the frontend

---

## Deployment

Click the **Publish** button in Replit. The platform will:
- Diff the dev database schema against production
- Ask you to confirm any renames
- Apply schema changes automatically
- Deploy both the frontend (static) and API server

> **Important:** Do not write manual migration scripts. Replit's publish flow handles all schema migration safely.

---

## Known Limitations / Future Ideas

- **No user accounts** — scores are identified by callsign text only; the same name can be used by anyone
- **No anti-cheat** — scores are submitted client-side; a server-side score validator could be added
- **Single track per state** — music is one track per screen; a playlist/shuffle system could be added
- **No levels or checkpoints** — pure endless mode; a checkpoint/stage system could be a next feature
- **Power-up stacking** — currently only one power-up active at a time; stacking could be explored
- **Leaderboard is global only** — no daily/weekly filters; could be added as query params

---

## Key Files Reference

| Task | File |
|---|---|
| Game engine / loop | `artifacts/warboss-highway/src/lib/game/engine.ts` |
| Vehicle drawing | `artifacts/warboss-highway/src/lib/game/vehicles.ts` |
| Power-up logic | `artifacts/warboss-highway/src/lib/game/powerups.ts` |
| Audio management | `artifacts/warboss-highway/src/lib/game/audio.ts` |
| Main game page | `artifacts/warboss-highway/src/pages/game.tsx` |
| Leaderboard page | `artifacts/warboss-highway/src/pages/leaderboard.tsx` |
| API routes (scores) | `artifacts/api-server/src/routes/scores.ts` |
| Database schema | `lib/db/src/schema/scores.ts` |
| OpenAPI spec | `lib/api-spec/openapi.yaml` |
| Theme / colors | `artifacts/warboss-highway/src/index.css` |
| Audio assets | `attached_assets/generated_audio/` |
