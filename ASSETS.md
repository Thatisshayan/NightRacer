# Warboss Highway — Neon Rainway Asset Direction

## Visual target

The approved visual target is [`artifacts/warboss-highway/public/art/neon-rainway-visual-target.png`](artifacts/warboss-highway/public/art/neon-rainway-visual-target.png). It is an **in-game composition reference**, not a literal exported screen or a UI design. It establishes the contrast hierarchy, road depth, weather density, color responsibilities, and traffic readability required for the overhaul.

> The game must feel like a dangerous midnight drive through a rain-lashed elevated city: fast, technical, and cinematic, while remaining legible at a glance on a phone.

## Functional palette

| Role | Token | Intended use |
| --- | --- | --- |
| Midnight base | `#050816` | App frame, distant sky, vignette, void space |
| Asphalt indigo | `#11192A` | Road surface and cool material shadows |
| Navigation cyan | `#27D9FF` | Lane guidance, player energy, interactive focus, route effects |
| Speed magenta | `#DF4BFF` | High-speed boost accents, player underglow, premium reward moments |
| Warning amber | `#FFB347` | Direction divider, construction, hazards, boss anticipation |
| Traffic red | `#FF3D67` | Same-direction taillights and hostile pursuit language |
| Headlight white | `#EAF7FF` | Oncoming threats, high-contrast highlights, impact flash |
| Steel text | `#D4E6F1` | Primary HUD text and instrument labels |
| Muted steel | `#8295AA` | Secondary HUD text and low-priority indicators |

A functional color role must not be reused casually. In particular, red is reserved for hostile/traffic signals and magenta for speed reward states, avoiding the previous all-purpose red interface treatment.

## Visual hierarchy

1. The **player car** is the clearest large silhouette in the lower third of the playfield.
2. **Immediate traffic and hazards** use direction-specific lights, contrasting silhouettes, and road shadows.
3. **Route cues and pickups** are readable without hiding nearby vehicles.
4. **Atmosphere**—rain, skyline, signs, smoke, and light pools—supports speed and depth but never makes collisions ambiguous.

## Existing assets and planned roles

The existing `sprites-premium` set will remain the baseline content library. The redesign should make it feel intentional through material treatment, glow, light cues, layered backgrounds, and renderer effects rather than replacing every vehicle with large unoptimized artwork.

### Runtime sprite pack (added 2026-08-14)

`public/sprites-premium/` holds the **authoring masters** (vehicles at 1373x2048, boss at
2048x2048; 125.7 MB across 41 PNGs). The game renders vehicles at 48-80 px wide, so shipping
the masters meant a ~1:26 minification with no mipmaps: soft, aliased, low-contrast sprites and
a huge first-load payload. That is why the high-quality art "did not look like anything" in play.

`scripts/build-sprite-pack.mjs` (Lanczos3 via `sharp`) downsamples the masters into
`public/sprites/` at render-appropriate sizes (vehicle 256w, boss 512w, prop/debris 256w, road
512w; skyline and anything <=512w passes through) and writes a `manifest.json`. Result:
**125.7 MB -> 6.5 MB (-94.8%)**, same 41 files.

- Runtime loads from `/sprites` (`RUNTIME_SPRITE_BASE` in `src/lib/game/sprites.ts`).
- Textures enable `autoGenerateMipmaps` + linear filtering after load.
- Regenerate after changing any master: `node scripts/build-sprite-pack.mjs`
- `SPRITE_PACK_VERSION` must be bumped when the pack output changes (cache-busting).
- The masters stay in `public/` for now, so they are still deployed. Moving them out of the
  served directory is the remaining payload win and is recorded in
  `docs/governance/DEFERRED_WORK.md` (needs Shayan's approval per REPO_RULES R14).

### Measured readability (2026-08-14, 420x800 viewport, in-play capture)

| Metric | Before | After |
| --- | --- | --- |
| Road surface sample | `#080808` | mean `#242323` over the asphalt-indigo base |
| Oncoming vehicle vs road | 3.25:1 | 9.57:1 |
| Dark/red vehicle vs road | 2.48:1 | 4.41:1 |
| `DIST`/`SPD` HUD text | 1.02:1 | 15.63:1 |


| Group | Current source | New treatment |
| --- | --- | --- |
| Player and traffic cars | Existing player, traffic, tank, and boss sprites | Apply coherent direction lights, road shadow, controlled underglow, lateral bank, and speed-tier emissive response. |
| Road / guardrails / lamp posts | `asphalt_tile.png`, `guardrail_segment.png`, `lamp_post.png` | Add wet road material layers, animated light pools, rain streaks, edge-light accents, and themed set-piece tinting. |
| Skyline | `skyline_layer1.png`, `skyline_layer2.png` | Move into distant scroll/parallax layers with fog, subtle tint shift, and no collision relevance. |
| Pickups / obstacles | Existing shield, slowmo, score blast, extra life, oil, debris | Add distinctive pulse/ring treatment, functional palette colors, and a visual event on approach/collection. |
| Particles / effects | Existing smoke, spark, explosion | Add rain, road spray, wake lights, boost ion trail, danger/near-miss flashes, and collision bursts through pooled procedural layers. |
| User interface | Existing DOM/React and native overlays | Replace general card styling with a compact mission instrument system: translucent dark glass, precision dividers, cyan/magenta active states, and functional danger indicators. |

## Rendering rules

Every frame must preserve pooling and render through existing platform-native mechanisms. Web effects belong in Pixi containers/filters or inexpensive `Graphics` primitives. Native effects belong in stable Skia nodes driven through existing shared-value patterns. Heavy post-processing, non-pooled per-frame object allocation, or generated full-screen art used directly as a runtime background are prohibited.

The target image can inform small desktop/mobile-safe texture and color decisions. Its full-resolution composition will not be rendered whole in the game; instead, the game recreates its look through reusable road, skyline, rain, light, and vehicle layers.

## Acceptance checks

A visual change is accepted only when the following conditions hold in a regular and high-speed gameplay capture:

| Check | Required result |
| --- | --- |
| Player anchor | The player is clear within 250ms of first viewing the screen. |
| Traffic direction | Oncoming headlights and same-direction taillights are distinguishable without relying only on color. |
| Road legibility | Lane edges, center divide, and safe drive area remain visible in rain and at high speed. |
| Reward state | A near-miss, power-up, and boost each have a recognizably different event treatment. |
| Performance | Additional ambience does not produce unbounded containers/nodes or per-frame framework reconciliation. |
| Accessibility | Reduced motion suppresses shake and strong streaks without removing readable danger feedback. |
