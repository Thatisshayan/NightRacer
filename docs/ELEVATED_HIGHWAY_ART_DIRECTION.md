# Elevated Highway Art Direction

**Author:** Manus AI  
**Status:** Active direction; elevated-deck, grounded-vehicle, and atmosphere pass implemented 2026-08-27
**Reference:** User-supplied 9:16 neon-rain elevated-highway image

## Design intent

NightRacer should feel as if the player is accelerating through a **rain-soaked elevated megacity artery**, viewed from a low, rear chase camera. The reference is not a flat top-down road; its power comes from a tightly controlled depth stack: a tiny horizon, an immense road that widens toward the player, vertical city voids on both sides, hard cyan lane edges, white oncoming headlights, red outbound taillights, and a player car that is visually anchored by a bright boost plume.

The correct target is **cinematic 2.5D**, not a photorealistic full-3D conversion. NightRacer can deliver the reference’s mood and spatial drama using projected geometry, parallax silhouettes, directional vehicle lighting, reflection decals, and carefully budgeted post-effects. This preserves the existing deterministic 2D simulation and makes the look achievable in Pixi, Canvas fallback, and native Skia.

> The player must read the road, traffic direction, and collision space in under a second. Realism is subordinate to arcade clarity.

## What the reference contributes

| Reference signal | Player-facing feeling | Real-time translation |
| --- | --- | --- |
| Road rises into a near-top horizon | Speed, scale, danger | Narrow the road to a 10–14% screen-height vanishing band; use a low chase-camera projection rather than an orthographic road. |
| Elevated deck over a city abyss | A world beyond the playfield | Build wide trapezoid shoulders, segmented guardrails, support columns, and three parallax industrial skyline bands outside the drivable surface. |
| Black wet asphalt with red/white/cyan pools | Premium nocturnal material | Use 6–10 projected reflection strips, additive light pools beneath lamps and cars, and low-frequency road sheen; do not use a full-screen blur as the default effect. |
| White oncoming lights and red rear lights | Instantly legible opposing traffic | Pair every traffic sprite with a direction-specific glow, cone, and short ground reflection. Oncoming traffic is cool white; same-direction traffic is red/magenta. |
| Cyan edge LEDs and amber centre divider | Lane hierarchy and high-tech identity | Keep cyan side-edge rails as the brightest static guide; retain a double amber centre divider; use sparse cyan dashed internal lane lines. |
| Player car low in frame with blue exhaust | Ownership and acceleration fantasy | Anchor the player at 80–84% of the frame height; add a stable underglow, two-stage exhaust, and a Rush-only elongated reflection/ion trail. |
| Rain streaks and fog | Weather, distance, atmosphere | Use two cheap rain layers: slow small streaks in the distance and faster screen-space streaks near the player. Add horizon fog that selectively obscures far traffic. |

## Scene composition

The gameplay camera should reserve the top 12% of the screen for the dark sky and distant skyline, with the vanishing point centered slightly above the road apex. The playable deck should occupy the remaining frame as a continuously widening trapezoid. The player remains visually low and large, while traffic arrives as tiny horizon silhouettes, then increases in scale nonlinearly as it approaches. This matches the reference’s drama while keeping lane geometry predictable.

| Layer order | WebGL high-quality implementation | Canvas 2D / Pixi Canvas / low-mobile equivalent |
| --- | --- | --- |
| 1. Atmosphere | Blue-black vertical gradient, horizon mist, light pollution | Gradient and a single translucent fog band |
| 2. City depth | Parallax silhouettes, sparse deck-side billboard panels, and restrained lightning | Static industrial silhouettes, fixed billboard geometry, and low-frequency path lightning |
| 3. Elevated deck | Projected asphalt, segmented shoulders, rails, lamps, support-column cut-outs | Projected asphalt, shoulders, sparse rails and lamps |
| 4. Wet material | Depth-projected sheen, lamp pools, car and billboard reflection strips | Reusable projected reflection strips and alpha-blended light pools |
| 5. Traffic | Wheel-contact-projected vehicle sprites, direction lights, headlight cones, tight contact shadows | Wheel-contact-projected pooled sprites with compact ellipse contact shadows |
| 6. Player | Wheel-contact projection, underglow, exhaust, Rush ring/ion wake, selective motion blur | Wheel-contact projection, underglow, two exhaust lines, no blur filter |
| 7. Weather and feedback | Two rain layers, distance-driven lightning, screen shake, limited post-filters | Fixed rain/lightning geometry and SharedValue opacity updates, no expensive filters |
| 8. HUD | Transparent low-profile instruments outside the player silhouette | Identical layout, reduced animation cadence on native |

## Current foundation and required visual upgrades

The active web and native renderers now share the correct foundational direction: a non-linear projected deck, grounded entity sprites, cyan/amber lane language, directional vehicle lights, wet-road sheen, and Rush feedback. The current refinement target is visual tuning under hardware WebGL and physical-device profiling, not another change to shared driving simulation.

| Area | Current foundation | Required upgrade for the reference |
| --- | --- | --- |
| Road camera | 13.5% horizon with a non-linear deck projection. | Tune only after hardware visual review; preserve the shared flat simulation. |
| Road edges | Converging shoulders, rails, lamps, supports, and city void. | Maintain cyan rail hierarchy above decorative billboard light. |
| City | Skyline depth, three roadside panels, and sparse lightning paths. | Add no new large city textures before a mobile residency trace. |
| Wetness | Road sheen, lamp pools, vehicle contact cues, puddle strips, and billboard reflection strips. | Keep reflection opacity below traffic/headlight contrast thresholds. |
| Traffic | Vehicle sprites derive visual center from a projected wheel-contact row; red/white direction cues and tight shadows share that row. | Hardware visual check at dense-traffic/Rush stress. |
| Player | Unit-size sprite uses a projected wheel-contact row, with aligned underglow, exhaust, shield, Rush, and crash effects. | Preserve bottom-frame control readability. |
| Weather | Capped rain plus distance-driven lightning flashes. | Keep flash cadence sparse and avoid full-screen filters. |
| Native parity | Fixed Skia geometry plus SharedValue transforms/opacities; all entity pools now receive projected ground placement. | Physical-device FPS, UI/JS thread, GPU, and memory trace remain required. |

## Asset plan and hard performance budget

The reference should be decomposed into reusable assets; it must not become a 9:16 photographic background behind gameplay. Large source PNGs already create unacceptable mobile texture-residency risk when eagerly loaded. All runtime assets should therefore be authored at final screen-use scale and staged by gameplay likelihood.

| Asset family | Runtime form | Suggested maximum | Loading policy |
| --- | --- | ---:| --- |
| Sky and distant city | 2–3 horizontal tiling strips | 1024×256 each | Core load; compressed/transcoded where platform supports it |
| Near superstructure and deck supports | 1 horizontal strip plus 2–4 reusable sprites | 1024×384 strip; 512×512 sprites | Core strip; supports pooled/lazy |
| Wet reflection decals | 8–12 small alpha sprites or procedural Graphics | 256×512 each maximum | Core, reused across lights |
| Player cars | 512–768 px tall source, trim transparent margins | 5 selected assets | Load selected car immediately; preload one default only |
| Common traffic | 512–768 px tall atlased variants | 6–8 common variants | Core load; choose variants by deterministic seed |
| Boss and rare traffic | 1024 px maximum | 1–3 assets | Lazy load before eligible spawn |
| Effects | Small atlased sprites or procedural lines | 256 px maximum | Core load; pool and cap bursts |

The performance gate is visual hierarchy rather than maximum effect count. High-quality WebGL may use one modest bloom/motion treatment and 40–60 visible rain streaks. Canvas fallback and low-tier mobile must use alpha-blended lights and fewer than 20 rain streaks, with no GPU-only filter assumed. Native HUD state should update at an intentionally limited cadence or through animation values rather than forcing an entire React Native hierarchy to rerender every display frame.

## Gameplay presentation changes

The driving mechanics can stay as a lane-aware dodge racer, but the presentation should exploit the new spatial scene. The road should breathe: the outside city slides slowly with steering; lamp pools accelerate beneath the player; distant headlights resolve into threats; near misses briefly flare the player’s underglow and produce a subtle rain-spray kick. Rush should change the scene, not simply increase a number—cyan edge rails brighten, rear exhaust turns blue-white, and a narrow reflection ribbon extends behind the player.

Traffic should be choreographed in small readable groups. Never fill every lane at the horizon. A safe launch window, a closing pair, and an occasional cross-lane tension moment produce a better visual rhythm than uniform random traffic. Boss encounters should temporarily reduce skyline contrast and add an unmistakable red/orange warning reflection before the boss enters the deck.

## Implementation order

| Milestone | Deliverable | Exit criterion |
| --- | --- | --- |
| 1. Camera and deck | Lower horizon, stronger road taper, elevated shoulders/rails, structural void | A still gameplay frame unmistakably reads as a high bridge, not a flat road. |
| 2. Lighting language | Directional car lights, projected reflection streaks, lamp pools, player ion wake | Players identify traffic direction before vehicle body detail is visible. |
| 3. World depth | Three skyline depth bands, fog, rain-depth separation, support silhouettes | The road feels suspended in a living industrial city without obscuring hazards. |
| 4. Cross-platform tiering | WebGL high / Pixi Canvas / Canvas2D / Skia equivalence map | Web Pixi and native Skia share deck, grounded-contact, rain, lightning, and billboard-reflection hierarchy; Canvas fallback parity remains a backend-specific follow-up. |
| 5. Asset compression and staging | Final-use texture sizes, loading priorities, lazy rare assets | Native memory and first-play latency are measured against a device profile budget. |
| 6. Visual playtest | Deterministic high-speed run, Rush, rain, traffic, boss, game-over | Screenshots and device traces confirm readability at normal and peak stress. |

## Implemented milestone

The web Pixi renderer and native Skia canvas now implement the elevated-highway presentation pass: a 13.5%-height horizon, projected elevated-deck rails, depth-scaled uprights and braces, city void, neon rain, puddle reflections, sparse distance-driven lightning, and flashing roadside billboard reflections. Vehicle and player sprites now derive their visual center from projected wheel-contact points, while vehicle shadows use the same contact row. The shared simulation, collision behavior, and input coordinates remain unchanged. Both renderers are type-checked and repository-gate verified; a physical-device frame/memory trace and hardware-WebGL review remain required release-quality follow-ups.

## Non-negotiable fallback policy

The implementation must report which backend is active. In particular, **Pixi CanvasRenderer is not WebGL**: it can draw the Pixi scene but skips WebGL-only filters. Treat it as a named mid-tier renderer with deliberate light/reflection substitutions; do not silently call it the high-fidelity mode. The explicit procedural Canvas 2D path should remain as the no-Pixi escape hatch and should carry the same basic cyan edge, amber center, direction-light, wet-road, and player-boost language.

## Acceptance criteria

A successful build will produce a portrait gameplay frame that clearly communicates the reference’s elevated highway, vanishing point, rain, wet material, opposing traffic, and blue player boost **without** relying on a static photographic background. At normal play speed, the player must distinguish oncoming white lights from outbound red lights, retain a clear collision path, and read Rush state from the vehicle itself. On lower-capability devices, quality may be reduced, but the scene’s composition and colour hierarchy must remain intact.
