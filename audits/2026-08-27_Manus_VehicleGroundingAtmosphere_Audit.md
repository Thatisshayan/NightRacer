# Vehicle Grounding and Atmosphere Audit

**Date:** 2026-08-27  
**Author:** Manus AI  
**Scope:** Correct the elevated-deck vehicle floating defect and add performance-safe lightning and neon-billboard reflection atmosphere on web Pixi and native React Native Skia.

## Audit basis

This audit reviews the active implementation against the elevated-highway direction record and the two earlier 2026-08-27 elevated-highway audits. It is based on direct source inspection of the shared simulation, web Pixi renderer, and native Skia renderer; repository type/build/test verification; and a local 420×800 isolated-browser gameplay run. No shared game-core physics, collision, lane, scoring, or input behavior was modified.

| Prior record | Finding at time of review | Current status |
| --- | --- | --- |
| `2026-08-27_Manus_ElevatedHighway_Audit.md` | Web traffic was projected at its simulation center while its shadow was separately placed below it. | **Fixed.** Web vehicle/player visual centers now derive from a projected lower-edge wheel-contact point. |
| `2026-08-27_Manus_NativeElevatedHighway_Audit.md` | Native deck geometry used a pseudo-3D projection, but entity pools still rendered in flat screen coordinates. | **Fixed.** Native traffic, obstacles, power-ups, particles, player, and player effects now receive renderer-only ground projection. |
| `docs/ELEVATED_HIGHWAY_ART_DIRECTION.md` | Native elevated-deck parity was described without identifying its flat entity-placement gap. | **Corrected.** The active direction now explicitly states the wheel-contact contract and remaining device/hardware review work. |

## Findings and remediation

The visible “flying” issue was a presentation mismatch, not a gameplay issue. The shared `GameEngine` defines each entity by a flat-world center and collision dimensions. The elevated deck is drawn through non-linear perspective projection. In the web renderer, sprites were positioned at the projected simulation center even though their road contact belongs at the projected lower edge. In the native renderer, the mismatch was larger: the deck was projected but traffic and other entities retained unprojected screen-space placement.

The correction introduces explicit renderer-local placement helpers. `PixiRenderer.groundedPlacement()` and `groundedNativePlacement()` project each entity’s wheel/contact row first, then calculate the visual center directly above it. Web vehicle lights and contact shadows use the same result, while the player’s shadow, underglow, exhaust, shield, Rush response, near-miss feedback, and crash flash stay aligned to its contact row. Native pooled vehicle slots accept an optional contact row and render a tight `Oval` shadow there; generic obstacle and power-up slots do not pay for shadow work.

| Area | Web Pixi implementation | Native React Native Skia implementation | Performance control |
| --- | --- | --- | --- |
| Vehicle grounding | Projects lower-edge contact, derives sprite center above it, and shares that result with lights/shadow. | Projects lower-edge contact for traffic pools and passes it to the dedicated vehicle-shadow child. | Existing identity-based pools are retained; no new sprite allocation path. |
| Other ground entities | Existing projected placement remains for obstacles and power-ups. | Obstacles, power-ups, and particles now use projected ground coordinates and scale. | Shared values mutate draw properties without per-frame React reconciliation. |
| Player grounding | Unit-scale player is placed above its projected contact row; visual-only effects share that anchor. | Unit-scale player and all related effect anchors receive the matching placement result. | No shared-engine coordinates or hitboxes are changed. |
| Lightning | One stable `Graphics` layer renders sparse distance-driven sky/road luminance and two fixed zig-zag paths. | One fixed Skia path set is controlled by one `SharedValue` opacity. | No full-screen filter, blur, render target, random particle system, or timer-owned React state. |
| Billboard reflections | Three projected panels pulse independently and draw two small wet-road reflection strips each. | Three fixed projected panel/reflection groups use three opacity shared values. | Fixed geometry and bounded scalar updates only. |

## Atmosphere behavior

Lightning is deterministic and driven from `state.distance`, with a short primary flash and a smaller echo over a 3,200-distance cadence. It raises only a restrained portion of sky and road luminance and renders fixed strike paths. This is intentionally below the contrast hierarchy of oncoming white headlights, cyan guidance rails, and the player silhouette.

Three deck-side billboard panels use magenta, cyan, and amber functional palette colors. Their independent pulses and bounded occasional flicker are also distance-driven. Each panel has two short depth-projected road-reflection strips, providing the requested wet neon response without text textures, full-screen bloom, or additional render passes.

> **Renderer contract:** The shared engine stays flat and authoritative. Perspective, wheel contact, shadow placement, lightning cadence, panel illumination, and reflection geometry are presentation-only renderer decisions.

## Verification evidence

| Check | Command or route | Result |
| --- | --- | --- |
| Native focused type safety | `pnpm --filter @workspace/warboss-highway-mobile run typecheck` | Passed. |
| Web focused type safety | `pnpm --filter @workspace/warboss-highway run typecheck` | Passed. |
| Repository type safety | `pnpm run typecheck` | Passed across all workspace projects. |
| Required repository gate | `bash scripts/verify.sh` | Passed: secret scan, documentation freshness, build/test, deploy-dry handling, and directive lint. The deploy dry-run was intentionally skipped because no `VERCEL_TOKEN` was available. |
| Portrait gameplay smoke | Local web preview at `http://localhost:5173/`, 420×800 isolated-browser viewport | Started gameplay and captured a post-change viewport frame. Browser console reported **0 errors** and 9 warnings. |
| Hardware/device profiling | Physical Android/iOS device, hardware WebGL, GPU profiler | **Not performed.** No connected device or hardware profiling environment was available. |

## Residual risk and deferred validation

The isolated browser capture is useful for startup, active gameplay, and JavaScript-console regression detection, but it must not be treated as a physical-device trace or hardware-WebGL fidelity/performance certification. The previous finding remains: the native HUD has a separate request-animation-frame state-update path, and texture residency requires a release-build device measurement. Additionally, explicit Pixi CanvasRenderer behavior remains a separate fallback-policy follow-up; it can render basic graphics but does not validate GPU-only filter behavior.

A release-readiness pass should collect a device trace during dense traffic, Rush, rain, lightning, and billboard flicker. It should measure FPS, JS/UI/render-thread time, GPU/frame time where available, memory/texture residency, and visual readability of white oncoming headlights against lightning. These items are recorded in the deferred-work register.

## Changed files

| File | Change |
| --- | --- |
| `artifacts/warboss-highway/src/lib/game/pixi-renderer.ts` | Added projected wheel-contact placement, aligned vehicle/player effects, and a stable deterministic atmosphere graphics layer. |
| `artifacts/warboss-highway-mobile/components/game/GameCanvas.tsx` | Converted native entity/player placement to projected ground geometry, made vehicle shadows contact-row ellipses, and added fixed lightning/billboard-reflection components controlled by shared values. |
| `docs/ELEVATED_HIGHWAY_ART_DIRECTION.md` | Corrected active parity status and documented the grounding and atmosphere contract. |
| `audits/2026-08-27_Manus_VehicleGroundingAtmosphere_Audit.md` | This evidence, remediation, and limitation record. |

**Conclusion:** The floating-car defect has been addressed at the correct renderer boundary on both platforms, and the requested cyberpunk atmosphere has been added without changing the shared simulation or introducing unbounded visual work. Hardware WebGL and physical-device performance certification remain intentionally unclaimed.
