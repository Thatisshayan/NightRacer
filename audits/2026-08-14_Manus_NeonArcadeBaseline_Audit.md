# NightRacer / Warboss Highway — Neon Arcade Baseline Audit

**Date:** 2026-08-14  
**Author:** Manus AI  
**Scope:** Visual, gameplay, architecture, and verification baseline for the approved neon-arcade overhaul.

## Evidence reviewed

This audit examined the current project guidance, the shared simulation, the active web Pixi renderer, the main web game screen, the native Skia renderer, and a live local web build. The visual baseline was captured in `audits/baseline-title.png` and `audits/baseline-title-portrait.png`. The portrait capture is the relevant baseline because the game intentionally blocks landscape play.

| Evidence | Finding |
| --- | --- |
| `README.md`, `REPO_DIRECTIVE.md`, `WARBOSS_HIGHWAY_HANDOFF.md` | The product is a mobile-first, single-player, top-down endless dodge game. Its current supported platforms are a React/Vite/Pixi web app and Expo/Skia mobile app, sharing one platform-neutral TypeScript simulation. |
| `lib/game-core/src/engine.ts` | Input, spawning, collisions, score, near-miss combos, power-ups, lives, daily modifiers, achievements, and boss timing already live behind platform-independent interfaces. This is a sound basis for an incremental upgrade rather than an engine replacement. |
| `pixi-renderer.ts` and `GameCanvas.tsx` | Both platforms already use pooled entities and higher-level rendering effects. The work should preserve their shared visual semantics and avoid adding per-frame framework state updates. |
| Live title-screen capture | The forced portrait flow works, but the first visible experience has weak hierarchy, low scene presence, generic tutorial iconography, and a largely black/red presentation that conceals content instead of establishing a distinctive world. |

## Baseline diagnosis

The current game has **strong structural foundations but does not yet present a coherent premium fantasy**. In the captured portrait build, the tutorial overlay blocks the menu with a nearly opaque black field, while the underlying title screen remains visually unreadable. The visible UI is functional but feels like a web control layer placed over a dark canvas rather than an integrated cockpit/arcade presentation. The single red accent dominates nearly every interactive signal, so danger, primary action, and brand treatment compete for the same attention.

The renderer has already attempted to solve road and traffic contrast through brightness and contrast filters. That is a necessary corrective, but it cannot by itself create the intended sensation of velocity or a memorable destination. The scene needs a clearer visual hierarchy, a broader controlled palette, in-world motion layers, compositional depth, and an interface that reads as a driving instrument rather than a menu stack.

| Area | Present strength | Present issue | Overhaul response |
| --- | --- | --- | --- |
| Technical architecture | Shared simulation separates game logic from renderers cleanly. | Web and native parity is maintained through duplicated visual treatment rather than a defined visual token system. | Retain the architecture; add shared visual-event/state semantics and parallel renderer implementations. |
| Player controls | Keyboard, touch drag, and joystick input are already supported. | Keyboard movement is direct positional movement, and touch drag can feel discontinuous from the game’s speed language. | Add velocity smoothing, lateral banking, and a readable recovery/boost rhythm while retaining accessible controls. |
| World composition | Road, lane dividers, rails, lamps, traffic, particles, exhaust, and speed effects exist. | The background reads as a flat road strip with sparse decoration; it has little scale, weather, or speed-layer depth. | Build a multi-layer night highway: wet asphalt, directional light pools, rain/spray, skyline bands, signage, bridge/tunnel events, and density escalation. |
| Vehicle presentation | Collision dimensions match render dimensions and traffic direction is represented. | Existing art plus contrast boosting still offers an inconsistent silhouette and threat-language system. | Use consistent emissive tail/head lights, underglow, hazard color roles, lane shadows, and high-contrast silhouette validation. |
| HUD and menus | The project has title, tutorial, pause, game-over, upgrades, daily mode, and accessibility hooks. | The title/tutorial state is visually dense and obscures the game identity; UI relies on generic cards, emoji-like icons, and all-purpose red. | Replace with a compact mission-brief/cockpit UI, a staged tutorial, and a tokenized functional palette. |
| Progression and score | Near-miss combo, power-ups, daily modifiers, local progression, leaderboard, and car selection exist. | Many systems are present but their moment-to-moment stakes are not expressed strongly enough in the renderer. | Surface combo, danger, power-up, boost, and recovery events through environmental, UI, audio, and camera feedback. |

## Technical-track decision

**Decision: incremental modernization in the existing Pixi + Skia renderers.** A Babylon.js migration is not justified. The current shared simulation is mature and has platform-native renderer hooks; the main gap is the game’s visual direction and moment-to-moment feedback, not the ability to draw the proposed experience. A migration would create significant parity and regression risk across the web and native products without solving the actual product issue.

The implementation will therefore modify the shared gameplay state only where a new, renderer-relevant mechanic requires it, and will extend both renderer paths consistently. Any divergence will be explicitly documented and limited to platform-specific performance settings.

## Priority risks and controls

| Risk | Why it matters | Control |
| --- | --- | --- |
| Visual effects reduce mobile frame rate | Native playback has a history of performance sensitivity. | Preserve pooling; quality-gate rain, glow, and distant layers; use stable nodes/shared values on native. |
| Web/native visual drift | Two rendering systems produce the same game. | Share named palette/effect constants and validate corresponding scenarios on both implementations. |
| New handling feels less accessible | The game relies on immediate mobile input. | Keep direct controls available; use smoothing that preserves low-latency steering and validate with a deterministic input scenario. |
| Scene beauty reduces hazard readability | A dodge game must remain instantly legible. | Enforce a visual hierarchy: player, immediate threats, route cues, ambience. Test dense rain and max-speed screenshots. |
| Scope expands into backend work | The primary request is a visual and gameplay overhaul. | Keep API contracts and generated packages unchanged unless an explicit scoring/stat need emerges. |

## Implementation decisions now fixed

The visual theme is **Neon Rainway**: a stylized midnight war-highway with charcoal/indigo road surfaces, controlled cyan navigation light, magenta speed energy, amber warning light, and white impact highlights. The player vehicle remains the strongest object; immediate oncoming traffic uses warm/white headlights, same-direction traffic uses red tail lights, pickups use distinct animated color-and-shape cues, and hazards use amber/orange warning treatment. This replaces undifferentiated red/black contrast with functional color roles.

Gameplay will stay top-down and endless. The upgrade will preserve the current free lateral movement, power-up set, near-miss scoring, daily challenge, boss rhythm, local progression, leaderboard, and platform split. It will add a lightweight arcade drive-feel layer—smoothed lateral velocity, visual bank/tilt, speed-energy feedback, and a chargeable burst mechanic earned through close passes—without changing the backend or adding monetization, multiplayer, or a new engine.

## Verification baseline

The repository dependencies were installed with `pnpm install --frozen-lockfile`. The web app was launched locally with `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/warboss-highway run dev`, opened in an isolated browser test session, and captured in both landscape and supported portrait viewports. The initial browser capture also confirmed no console errors, though warnings were present. Full build/test verification is still pending and will be performed after the implementation change surface is complete.

**Status:** Audit completed. The visual target and reusable art reference are the next required deliverables before source implementation begins.

## Pre-existing verification failure

`pnpm --filter @workspace/game-core run test` was executed on the untouched baseline. Seventeen tests passed and one failed: `GameEngine framerate independence > advances traffic the same distance regardless of frame rate (small vs large dt)`. The assertion measured a 93px difference against an allowed 69.3px difference between 16ms and 33ms stepping. This is **pre-existing**, not introduced by the overhaul. It is relevant to the proposed driving-feel work and will be fixed in the shared simulation before final verification.

The regression scenario begins tracking whichever vehicle is first present after a random spawn timing. The implementation must make the test deterministic as well as retain frame-normalized movement, so the verification proves simulation behavior rather than random spawn selection.

## Visual comparison checkpoint

The updated portrait capture, `audits/neon-rainway-title-portrait.png`, confirms the new title composition now establishes a clear cyan/magenta Neon Rainway identity, a stronger information hierarchy, and a more purposeful frame than `audits/baseline-title-portrait.png`. The logo, mission cue, vehicle selection, and primary action are all immediately visible. A review also identified one layering defect: the lower foreground skyline asset overlaps the start action in the first updated capture. The next focused correction will move all interactive title content to a higher stacking layer while leaving the atmospheric skyline behind it.

## Final visual QA observations

The corrected title capture, `audits/neon-rainway-title-final.png`, resolves the lower-skyline overlap: the start control, garage readout, vehicle selector, and toggle controls now sit above the atmospheric scene and remain readable. The live gameplay capture, `audits/neon-rainway-gameplay.png`, confirms a coherent in-game frame: wet/structured asphalt, cyan internal lane lines, an amber center divide, edge lighting, active rain, vehicle direction lighting, player banking, and the Rush charge instrument are visible in the supported portrait layout.

The gameplay frame preserves hazard readability because the cyan lane cues and amber center divide remain low-density, while traffic stays a larger textured silhouette with directional light points. The visual reference is not duplicated literally; its central functional principles—rain, road depth, neon route language, differentiated traffic, and player energy—are recreated through pooled sprites and stable procedural layers suitable for the existing renderers.
