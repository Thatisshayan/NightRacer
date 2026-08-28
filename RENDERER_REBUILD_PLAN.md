# NightRacer Renderer Rebuild Plan

**Status:** In progress — scale recalibrated and enabled for real web gameplay motion; atmosphere and native adapter deferred
**Author:** Manus AI  
**Date:** 2026-08-27  
**Decision:** Stop extending the present 2.5D Pixi/Skia scene. Preserve the authoritative game simulation and replace the visual presentation through a clean, proof-first renderer migration.

## Executive decision

The present visual stack should be treated as a failed composition, not as a collection of isolated defects. The vehicle “flying” symptom is the most visible consequence of a deeper architectural mismatch: flat simulation coordinates, road projection, sprite scaling, shadows, reflections, city layers, and motion effects have accumulated as separately tuned systems. Even where their calculations are internally valid, they do not form one coherent camera model. Adding more contact-shadow, lightning, or billboard adjustments would continue to mask the problem rather than restore a convincing chase view.

The recommended approach is **not** to rebuild the entire game. The shared `GameEngine` remains authoritative for lanes, movement, collisions, scoring, Rush, power-ups, input, and game state. The rebuild replaces the renderer boundary only, beginning with a web visual slice that is approved from real 9:16 screenshots before mobile parity begins. The existing renderers stay available as a reversible legacy path until the new renderer is approved and verified. No files are deleted in the proposal or migration without direct approval.

> **Non-negotiable success criterion:** A player must be able to look at one 9:16 gameplay frame and immediately understand that cars are physically on a rain-wet highway, moving toward or away from the camera—not sliding or hovering above a background.

## Why the current direction fails visually

| Failure mode | Root cause | Why another patch is the wrong response |
| --- | --- | --- |
| Vehicles read as flying | Sprite center, contact shadow, light cone, and road detail are derived through different presentation rules. | Adjusting one offset cannot create a single credible contact plane. |
| Road reads as a graphic trapezoid | Road surface, rails, supports, puddles, and entities do not share one spatial scene model. | More overlay geometry increases density without adding depth coherence. |
| Cyberpunk effects look decorative | Rain, lightning, and billboard glow are visually additive rather than producing believable spatial light. | More effects will worsen legibility if the underlying camera is unconvinced. |
| Web/mobile parity is expensive and fragile | Pixi and Skia contain independent, long imperative/declarative render logic. | Feature-by-feature parity repeats bugs and slows visual iteration. |
| Prior visual checks gave false confidence | Source and console checks passed without a user-approved production frame. | Code correctness cannot substitute for image review in an art-led renderer. |

## Target visual direction

The new target is a **stylized rear-chase highway**, not a top-down road that has been perspective-warped. The player car occupies the lower 20% of the portrait frame, viewed from a stable shallow three-quarter rear camera. It has a visible tire/contact silhouette, a compact shadow directly underneath, and a short reflected neon pool immediately behind it. Traffic occupies a consistent roadway corridor, gets larger only as it approaches, and uses body rotation and light signatures to establish direction before the viewer needs to parse a sprite.

The road is a finite visual strip that continuously recycles away from the camera. It should have actual depth segments, cross-road seams, rail posts, and a dark city void beyond the barriers. Billboards and lightning belong in the world behind or beside traffic, with light responses constrained to the road and never competing with hazard signals. The visual language remains midnight/indigo, cyan navigation, amber road logic, red same-direction traffic, and white oncoming traffic.

| Frame component | Target design | Explicitly avoid |
| --- | --- | --- |
| Camera | Fixed low rear-chase camera with one vanishing point and one near-ground plane. | Separately projected background and sprite math. |
| Player | Large, centered low in the frame; wheels/contact stable; short exhaust/reflection. | Overscaled top-down sprite with detached underglow. |
| Traffic | Depth-sorted, perspective-scaled cars with a physical contact position and direction-specific lamps. | Sprite center anchoring, halo cards, or independently drifting shadows. |
| Road | Segmented visual roadway with depth lines, wet reflectance, rail posts, and a visible outside void. | A flat trapezoid plus screen-space effects. |
| Rain and lightning | Sparse foreground streaks plus thin sky/rail pulses that illuminate only authored surfaces. | Full-screen flash, blur, or opaque precipitation. |
| Billboards | Few large off-road emissive panels that cast tapered road reflections. | Small UI-like cards or text that competes with gameplay. |

## Clean rendering architecture

### 1. Preserve the simulation boundary

`lib/game-core` remains unchanged. It exposes ordinary game entities in logical lane/world coordinates. The renderer converts those entities into a renderer-owned `VisualFrame` only. The game engine must never know whether the active renderer is legacy Canvas2D, legacy Pixi/Skia, or the replacement scene.

```text
GameEngine state
    │  flat, authoritative: player / traffic / road offset / Rush / weather state
    ▼
VisualFrameBuilder
    │  pure, deterministic: world position → camera-space placement/contact/layer
    ▼
Scene contract
    │  road segments / vehicle poses / light sources / atmosphere state
    ├── WebSceneRenderer (first implementation)
    └── NativeSceneRenderer (same scene contract, platform drawing adapter)
```

The key distinction is that `VisualFrameBuilder` is the **only** place that is allowed to calculate camera-space position, scale, baseline, visibility, alpha, and depth ordering. A vehicle pose must include one `contact` coordinate. Shadows, tire spray, body mesh/sprite, taillights/headlights, and the nearest wet reflection must derive from that one pose.

| Module | Responsibility | Must not do |
| --- | --- | --- |
| `GameEngine` | Simulation, collisions, spawning, input, score. | Store screen coordinates or camera effects. |
| `VisualFrameBuilder` | Pure deterministic scene layout and depth sorting. | Allocate graphics objects or mutate the game state. |
| `WebSceneRenderer` | Own WebGL/Canvas drawing resources and reuse them frame to frame. | Recalculate game geometry or update React state at display rate. |
| `NativeSceneRenderer` | Draw the same `VisualFrame` through fixed Skia nodes and shared values. | Reimplement projection formulas independently. |
| HUD | Read gameplay state at a bounded cadence. | Cause scene graph rebuilds at every animation frame. |

### 2. Choose a single visual primitive model

The rebuild should not use existing top-down car art as the principal player-facing object. Generate or commission a small, matched set of **rear-chase vehicle sprites** at the exact camera pitch: player rear, same-direction traffic rear, oncoming traffic front, and a boss vehicle. Each needs correct transparent bounds, a visually low tire/contact area, and no baked ambient glow that fights world lighting.

The web renderer should use a lightweight depth-sorted scene with pooled textured quads or simple procedural meshes. The road should be composed of a fixed number of recycled trapezoidal segments, not a large per-frame `Graphics` reconstruction. A segment owns its asphalt, center-line fragment, rail fragments, and optional reflection mask. This gives traffic a real render layer to sit upon and makes road motion inherently coherent.

The native adapter should not port Pixi operations line by line. It consumes the same `VisualFrame` and updates a fixed Skia scene with shared values. Native ships only after screenshots from the web reference slice are approved.

## Visual acceptance frames

The replacement renderer is not “done” because the code compiles. It moves forward only when each proof frame is captured at 420×800, reviewed, and explicitly accepted.

| Gate | Required frame | Pass conditions | Rejection conditions |
| --- | --- | --- | --- |
| A. Contact frame | Player car at rest and three traffic depths. | Every vehicle visibly touches the road; contact shadow is under, not below, the car; road scale matches vehicle growth. | Any free space between tires/body baseline and road cue; sprites read as stickers. |
| B. Motion frame | Normal-speed traffic approach. | Near traffic grows smoothly; rail posts and seams move coherently; player remains stable. | Road and entities move at unrelated rates or crossing traffic jumps layers. |
| C. Rain/night frame | Rain, wet road, headlights, billboards. | Reflections stay on the road and never obscure direction lights. | Full-screen effects wash out white traffic or cyan lane edges. |
| D. Rush frame | Maximum speed/Rush state. | Player energy is concentrated behind/under the car; road remains readable. | Excess bloom, blur, streaks, or HUD movement hides obstacles. |
| E. Mobile parity frame | Same seed/state rendered by native adapter. | Composition, depth, colors, and grounding match accepted web frame. | A separate mobile interpretation or flat coordinate fallback. |

## Phased migration plan

### Phase 0 — Freeze visual scope and retain rollback

Retain the prior Pixi scene at `renderer=pixi` and the original Canvas fallback at `renderer=canvas2d`. Promote the accepted rebuild path to the branch default only after the grounding proof is reviewed. Do not delete Pixi, Skia, sprite, or Canvas fallback code. Add a development-only deterministic scene seed so the same player/traffic formation can be captured repeatedly. Record a matched legacy baseline and the rebuilt target image.

**Exit condition:** The legacy experience remains playable and the replacement scene can be selected without changing simulation behavior.

### Phase 1 — Visual target and asset reset

Create one master 9:16 visual target image and a compact art sheet that fixes camera pitch, road width, car silhouette, rain density, and light hierarchy. Generate only the assets needed for the first proof frame: road material, rail/post accent, player rear, oncoming traffic front, same-direction traffic rear, and one billboard panel. Assets must be authored at final onscreen use scale; no large source art is committed into the repository.

**Exit condition:** The art sheet makes it impossible to mistake the intended camera for top-down play.

### Phase 2 — Build the shared `VisualFrameBuilder`

Introduce a pure TypeScript layout module with no Pixi, Skia, React, browser, or native dependency. It receives game state and a fixed camera specification, then returns depth-ordered poses. Each vehicle pose has `x`, `bodyY`, `contactY`, `width`, `height`, `depth`, `alpha`, `direction`, `shadow`, `light`, and `reflection` fields calculated from one ground-plane mapping. Add focused tests for contact rows, horizon fade, scale progression, ordering, and deterministic scene output.

**Exit condition:** A static JSON visual-frame fixture produces expected player and traffic contact positions at far, middle, and near road depths.

### Phase 3 — Web replacement scene: contact and motion proof

Build only the replacement web scene. Use fixed reusable road segments and pooled vehicle visual nodes. First render asphalt, rails, player, and six traffic vehicles. Do not introduce rain, screenshake, lightning, HUD animation, filters, or billboards until the contact and normal-motion proof frames pass. Enable a deterministic `?demo=grounding` scenario that can be captured at the exact same moment after every visual change.

**Exit condition:** Gates A and B pass in real production-like 9:16 captures approved by the project owner.

### Phase 4 — Add controlled wet atmosphere

Add rain, light pools, reflections, billboards, and lightning only after grounding passes. Effects are world-attached and recycle with road segments. Lightning drives a short exposure variable on sky, road segments, and sign emissives; it must not be implemented as a full-screen white overlay. Billboard reflections are drawn as tapered road-segment light decals, not independent floating graphics.

**Exit condition:** Gates C and D pass without reducing traffic-direction readability.

### Phase 5 — Native adapter

Implement the native renderer from the shared `VisualFrame`. Use fixed Skia nodes, stable asset residency, and shared values for poses. Native cannot modify projection constants, calculated scene layout, or traffic layering; it is a drawing adapter only. Perform real-device release-build profiling at normal and Rush states before claiming parity or performance readiness.

**Exit condition:** Gate E passes, then the iOS archive and artifact build pass.

### Phase 6 — Review, rollout, and retirement decision

Run the replacement as the web default on its review branch while retaining `renderer=pixi` and `renderer=canvas2d` rollback routes. Compare accepted screenshots and a short gameplay clip against legacy. Only after the owner approves the replacement may a separate, explicit deletion request be opened to retire legacy renderer code.

**Exit condition:** Owner accepts the live visual direction and authorizes legacy retirement separately.

## Performance and safety budgets

| Area | Hard constraint | Reason |
| --- | --- | --- |
| Visible vehicles | Reuse a fixed pool; cull before horizon and past viewport. | Avoid allocation churn and preserve layer ordering. |
| Road geometry | Fixed recycled segment count, e.g. 18–28 depending on device tier. | A scene component must move as one road, not rebuild every frame. |
| Effects | At most one sky exposure pulse, three billboard emissives, and capped rain layers. | Keep hazard hierarchy readable and prevent full-screen overdraw. |
| Textures | Final-use assets only; load player/default traffic first and defer rare/boss assets. | Avoid the known native texture-residency risk. |
| React | No `setState()` on rendering cadence. | Prevent the existing HUD/scene reconciliation risk. |
| Fallback | Keep a deliberately simple, explicit fallback scene. | Do not silently label Canvas rendering as high-fidelity WebGL. |

## What will not be done

The rebuild will not alter driving logic, tune collision difficulty, add new monetization, add paid infrastructure, delete existing renderer files, or submit another TestFlight build until the web visual gates are accepted. It will not declare parity, polish, or playability from source review alone.

## Approved scope and current milestone

The owner approved the renderer-replacement direction and asked for a corrected car scale, a matched side-by-side comparison, and real web gameplay motion. The branch now contains all three: a `?renderer=rebuild&demo=grounding` static proof, a legacy-versus-rebuild capture, and a short default-route motion capture driven by real `GameEngine` state.

The next work remains intentionally bounded: validate high-speed and dense-traffic behavior before adding wet atmosphere, then implement native Skia as a drawing adapter over the same visual-frame layout. The former Pixi and Canvas scenes stay available as rollback paths; no deletion or TestFlight submission is authorized by this milestone.
