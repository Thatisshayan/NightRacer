# Warboss Highway — UI/UX, Visual & Gameplay-Feel Audit

- **Date:** 2026-08-14
- **Agent:** Viktor
- **Scope:** UI/UX, visual direction, gameplay readability and traffic logic
- **Method:** Repo built from `main` (`30effc0`), dev server run locally, played to death in headless Chromium at a 420×800 mobile viewport. Screenshots and pixel measurements taken from that live build, not from mockups.
- **Captures:** [`2026-08-14_Viktor_UIUXVisual/`](./2026-08-14_Viktor_UIUXVisual/)
- **Verdict:** **6.2 / 10.** Feature scope and menu art direction are strong. The playfield itself is the weak link: it is too dark to read, has no depth, and its traffic is arrhythmic and directionally ambiguous.

---

## 1. Scores

| Area | Score | Note |
| --- | --- | --- |
| First 10 seconds | 5/10 | Tutorial modal fires before the player ever sees the game |
| Visual readability | 4/10 | Measured 2.5–3.2:1 obstacle contrast; mean scene luminance 0.008 |
| HUD / layout | 4/10 | Score overlaps pause button; ~10px lives icons; 8–11px RUSH label |
| Depth / camera | 3/10 | Flat orthographic box, no horizon, no perspective, no parallax in play |
| Traffic logic & rhythm | 4/10 | Purely random spawn cooldown; on-screen direction is not communicated |
| Asset utilisation | 3/10 | 1373×2048 source art rendered at ~48×80 px |
| Game feel / juice | 6/10 | Shake and combo exist; no speed lines, near-miss pop, or hit-stop |
| Retry loop | 5/10 | Retry is a secondary button behind a leaderboard form |
| Meta / progression | 7/10 | Scrap, per-car upgrades, dailies, achievements — real depth |
| Accessibility | 3/10 | No colorblind mode, no sensitivity slider, low-contrast text |

---

## 2. Visual: the playfield is too dark and has no depth

### 2.1 Measured contrast (from `gameplay.png`)

| Pair | Measured | Target |
| --- | --- | --- |
| Enemy vehicle vs. road surface | **3.25 : 1** | ≥ 4.5:1, ideally 7:1 for hit-critical objects |
| Light-coloured vehicle vs. road | **2.48 : 1** | ≥ 4.5:1 |
| `DIST` HUD text vs. background | **1.02 : 1** | ≥ 4.5:1 |
| Mean playfield luminance | **0.008** | ~0.04–0.08 for a legible night scene |

The road samples at `#080808`. `ASSETS.md` specifies asphalt indigo **`#11192A`**. The shipped build is roughly three times darker than its own approved spec, which is the root cause of "deaths feel cheap".

### 2.2 The playfield has no depth ("all in a box")

- The renderer is orthographic: world `(x, y)` maps 1:1 to screen, and every sprite draws at a constant scale regardless of distance. There is no vanishing point, no horizon line, no road convergence.
- `skyline_layer1/2.png` are rendered as DOM `<img>` elements **on the menu screen only** (`Game.tsx` ~L460). During gameplay there is no background layer at all — the road runs to a hard black edge at the top of the screen.
- The lane field is a fixed-width rectangle with hard walls and no camera motion (no lateral lag, no speed-based FOV/zoom, no bank on steering).

Net effect: the player is looking down at a moving rectangle rather than driving into a world.

### 2.3 Palette drifts across three screens

Menu is cyan/magenta neon; gameplay is rust/brown on black; game-over is blood red (`WASTED` + a red primary CTA). `ASSETS.md` reserves red exclusively for hostile traffic signals and explicitly warns against "the previous all-purpose red interface treatment" — the game-over screen still uses it.

---

## 3. Why the high-quality assets "don't seem to work"

This is a straightforward pipeline problem, not an art problem.

| Fact | Value |
| --- | --- |
| Source vehicle sprite dimensions | **1373 × 2048 px**, ~4–5 MB each |
| Total `sprites-premium` payload | **~135 MB** across 42 PNGs |
| On-screen render size (`engine.ts` L970–974) | 48 × 80 px (sedan) up to 80 × 128 px (tank) |
| Effective downscale | **~1 : 26** |

Three consequences:

1. **Detail is destroyed.** Pixi's default sampling is bilinear with no mipmaps. Minifying by 26× with bilinear sampling samples a tiny fraction of the source texels, so fine panel lines, rust detail, and edge highlights alias into muddy noise. The art you generated is genuinely high quality — the renderer is throwing ~99.9% of it away and keeping the noise.
2. **Cost is enormous for zero benefit.** ~135 MB of textures loaded and held in GPU memory to draw thumbnails. This will be a hard blocker on mobile.
3. **The art is authored flat top-down.** `ASSETS.md` requires oncoming headlights vs. same-direction taillights "distinguishable without relying only on color". The current sprites carry no direction lighting, so the requirement cannot be met by the renderer alone.

**Fix:** generate a downscaled runtime pack at ~2× display size (e.g. 128 × 256 for cars, 192 × 384 for buses/trucks) using a proper Lanczos/area filter, keep the 2048px originals as source-of-truth outside the shipped bundle, and enable mipmaps on the texture sources. Expect the payload to drop from ~135 MB to under 3 MB **and** the cars to look sharper, not worse.

---

## 4. Gameplay logic: rhythm and direction

### 4.1 Traffic has no rhythm because it is pure noise

`engine.ts` L754–767 schedules traffic on a random cooldown between **550 ms and 1350 ms**, choosing a random type and a random safe lane each time. There is no wave authoring, no pattern pool, no guaranteed rest beat, and no telegraph.

Endless dodgers that feel good do not spawn randomly. They draw from a pool of hand-authored **patterns** (e.g. "left wall, right gap", "zipper", "slow bus + fast overtake", "double squeeze") and interleave them with deliberate breathing room. Randomness is applied to *which pattern* and *when*, not to each individual car. That is what produces perceived rhythm — tension, release, tension.

**Recommendation:** introduce a pattern table in `game-core`. Each pattern declares its lane occupancy over time and its required entry speed; the scheduler picks a pattern, plays it out, then enforces a rest beat of 400–900 ms scaled by speed. Difficulty ramps by pattern *tier*, not by raw spawn frequency.

### 4.2 On-screen, all traffic moves the same way

`Vehicle.direction` is assigned by lane index (lanes 0–1 = `OPPOSITE`, 2–3 = `SAME`, L982–984), but in the update loop **both branches increase `v.y`**:

```ts
if (v.direction === 'SAME')  v.y += Math.max(1.2, currentSpeed - v.speed * 0.7) * frameScale;
else                          v.y += (currentSpeed + v.speed * 0.5) * frameScale;
```

Every vehicle therefore travels down the screen; only the *rate* differs.

**Correction (2026-08-14, after re-reading `pixi-renderer.ts`):** an earlier draft of this section claimed there was *no* direction cue rendered at all. That was wrong, and I'm flagging it rather than quietly editing it out. The renderer already had both `sprite.rotation = vehicle.direction === 'OPPOSITE' ? Math.PI : 0` and a `drawVehicleLights()` pass using `NEON.headlight` for oncoming and `NEON.trafficRed` for same-direction traffic. The real defect is **legibility, not absence**: the lamps were ~5 px radius at alpha 0.5 and the headlight beam at alpha 0.045, drawn on a `#080808` playfield with mean luminance 0.008 — present in code, invisible in play.

The finding that **all traffic moves down-screen** stands as measured, and `ASSETS.md`'s "traffic direction" acceptance check still fails on the motion clause.

**Recommendation, in order of effort:**
1. Strengthen the existing direction lighting rather than adding it: larger lamp radii, real headlight cones for `OPPOSITE`, a red taillight bar plus wash for `SAME`, and a lift of the playfield base so any of it is visible.
2. Keep the 180° `OPPOSITE` sprite rotation as the non-colour cue (accessibility clause) — it exists, it just has nothing to read against.
3. Differentiate relative velocity more aggressively — same-direction traffic should sometimes genuinely pull away, so overtaking reads as overtaking.
4. Telegraph: spawn a faint approach glow / light bloom ~300 ms before a fast vehicle enters the frame.

### 4.3 Camera

The request for a lower, more 3D camera is the right instinct and is achievable **without** a 3D engine or touching `game-core`.

Keep the simulation exactly as-is in flat road space `(x, y)`. Add a projection step in `pixi-renderer.ts` that maps road space to screen:

```
z      = (y - cameraY)              // depth ahead of camera
scale  = cameraDepth / z            // perspective foreshortening
screenX = centerX + (x - cameraX) * scale
screenY = horizonY + (cameraHeight * scale)
```

Then:
- Draw the road as a strip of trapezoidal segments converging on a horizon at ~35–40% screen height, with lane lines that narrow with distance.
- Scale every vehicle sprite by its `scale` value — this alone creates the sense of cars rushing toward you.
- Put the existing `skyline_layer1/2.png` above the horizon as parallax layers, scrolling with lateral camera position.
- Add mild camera lag and bank on lateral input.

This is the classic pseudo-3D road technique (Out Run / Hang-On lineage). It is a renderer-only change, keeps the deterministic engine and existing tests intact, and would fix "camera too high", "no depth", and "it's a box" in one pass. It also finally justifies the 2048px source art: sprites near the camera can render large enough to show their detail.

---

## 5. UI/UX defects observed

| # | Issue | Evidence |
| --- | --- | --- |
| 1 | `SCORE` text overlaps the pause button in the top-left | `gameplay.png` |
| 2 | Lives icons render at ~10 px and collide with the sound button | `gameplay.png` |
| 3 | `RUSH` meter — the signature mechanic — sits in the bottom-centre dead zone, in 8–11 px grey type, behind oncoming traffic | `gameplay.png` |
| 4 | `DIST`/`SPD` readouts are effectively invisible (1.02:1 contrast) | measured |
| 5 | Tutorial modal covers the title screen on first load, before any gameplay is seen | `tutorial.png` |
| 6 | Player car is dark-on-dark at the screen edge; no rim light or ground shadow. `ASSETS.md`'s "player anchor within 250 ms" check fails | `gameplay.png` |
| 7 | Game-over promotes `SUBMIT TO KILL-BOARD` (large, red) over `PLAY AGAIN` (small, secondary) — retry is not the primary action | `gameover.png` |
| 8 | No rewarded revive anywhere in the codebase (`revive`/`rewarded`: 0 hits) | grep |
| 9 | No colorblind mode, no control-sensitivity setting | grep |
| 10 | Share card still uses the retired red/Arial treatment (`#8b0000`, `#cc2222`) | `share` code path |

---

## 6. Gap vs. top-downloaded dodging games

| They ship | Warboss Highway | Impact |
| --- | --- | --- |
| Authored spawn patterns with rest beats | ❌ random cooldown | Perceived fairness and rhythm |
| Clear depth / perspective camera | ❌ flat ortho | Perceived production value |
| Direction-legible traffic | ❌ all moves down | Deaths feel unfair |
| Rewarded revive at death | ❌ none | Session length and revenue |
| Retry ≤ 2 taps / ≤ 2 s | ⚠️ behind a form | D1 retention |
| Daily missions with progress bars | ⚠️ daily *modifier* only | Return reason |
| Loud reward moments (bursts, "CLOSE!", hit-stop) | ⚠️ minimal | Perceived quality |
| High-contrast playfield | ❌ 2.5:1 | Fairness |
| Skins with visual variety and preview | ⚠️ 5 cars, stat-differentiated | Monetisation surface |
| Consistent art direction across screens | ⚠️ three palettes | Store conversion |

---

## 7. Recommended order of work

**Phase 1 — Readability (days, high visible return)**
Raise the road to the spec `#11192A`; add an edge light and ground shadow to every vehicle; give the player car a permanent underglow; fix the HUD overlap and raise all HUD type to ≥14 px; move the RUSH meter out of the dead zone; unify the game-over screen to the neon palette.

**Phase 2 — Assets pipeline (days)**
Generate the downscaled 2× runtime pack, enable mipmaps, drop the shipped payload below 3 MB, add direction lighting and 180° rotation for oncoming traffic.

**Phase 3 — Perspective camera (the big one, 1–2 weeks)**
Renderer-only pseudo-3D projection, converging road segments, depth-scaled sprites, skyline parallax above the horizon, camera lag and bank.

**Phase 4 — Rhythm and loop**
Authored pattern table with rest beats and difficulty tiers; instant retry as the primary action; rewarded revive; near-miss "CLOSE!" popup, hit-stop, and speed lines.

**Phase 5 — Retention and accessibility**
Daily missions with progress bars; visually distinct car skins; colorblind and sensitivity settings.

---

## 8. Notes

- No source files were modified by this audit. Captures and this document only.
- Findings in §2.1, §3 and §4.2 are measured or read directly from `main`; §7 estimates are judgement calls.
