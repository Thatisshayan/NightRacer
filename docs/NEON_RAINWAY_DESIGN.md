# Neon Rainway Design and Implementation

## Purpose

The Neon Rainway overhaul turns Warboss Highway’s existing top-down survival loop into a **premium neon-noir arcade drive** without changing its core product constraints. The game remains a single-player, portrait-first, endless dodge game with a shared TypeScript simulation, web Pixi renderer, and native Skia renderer.

The work intentionally avoids an engine migration. The existing architecture already separates platform-neutral logic from rendering, so the upgrade adds shared gameplay state only where a new mechanic must behave consistently across platforms.

## Visual system

The functional palette uses midnight and indigo materials for the world; cyan for route/player energy and focus; magenta for reward/high-speed moments; amber for warnings and direction division; red for same-direction traffic; and white for oncoming headlights. These roles are defined in [`ASSETS.md`](../ASSETS.md).

| Layer | Web implementation | Native implementation | Purpose |
| --- | --- | --- | --- |
| Wet road | Stable Pixi `Graphics` sheen and edge-light pulses | Existing Skia road grid with cyan/amber lane treatment | Gives the road material, direction, and speed readability. |
| Weather | Stable Pixi rain graphics, reduced at low quality | Static Skia streak geometry translated via shared values | Adds motion and depth without scene-graph churn. |
| Traffic recognition | Direction-specific Pixi headlight/taillight cues | Existing directional sprite rotation; preserved alongside high-contrast lane treatment | Makes immediate traffic direction perceptible in the limited screen space. |
| Player feedback | Lateral bank, near-miss ring, Rush aura/trails | Shared-value player bank and Rush ring | Makes steering, risk, and high-speed reward legible in both builds. |
| Menus and HUD | Neon Rainway title field, mission framing, cyan/magenta/amber HUD roles | Matching HUD roles and a mobile Rush control | Makes the interface feel like a driving instrument, not generic card chrome. |

## Driving and Rush system

The shared `GameEngine` now maintains lateral velocity and `driveTilt`. Keyboard and joystick steering approach the requested lateral speed through a deterministic response curve, preserving quick dodge input while giving movement visible inertia. Direct touch drag remains immediate and clears carry-over velocity, retaining the original accessible mobile control behavior.

Near misses grant 25% Rush charge. At full charge, the player can activate a 2.4-second Rush: **Space** on web requests it from the shared engine, and both web and native HUDs expose a large touch target. Rush improves current speed by 24%, creates a distinct cyan/magenta feedback treatment, and is cleared on a crash. It is earned during play, not purchasable or tied to backend progression.

| State | Shared field | Renderer behavior |
| --- | --- | --- |
| Steering bank | `player.vx`, `driveTilt` | Car banks subtly with lateral movement; collision bounds do not change. |
| Near miss | `nearMissPulse`, `rushCharge` | Magenta/cyan ring and HUD charge progress distinguish a skill event from a pickup. |
| Rush ready | `rushCharge === 100` | HUD control becomes high-contrast and interactive. |
| Rush active | `rushTimer`, `rushPulse` | Higher speed, cyan/magenta aura, extra weather energy, and speed feedback. |

## Performance and accessibility

Both renderer implementations maintain their platform-appropriate low-allocation design. Pixi updates stable graphics layers in place and retains sprite pooling. Skia keeps weather geometry static, then changes only shared-value transforms and opacity during simulation sync. The web renderer’s low-quality mode, used by default when reduced motion is preferred, limits rain density and keeps the existing glow/particle quality gates intact.

The upgrade retains existing reduced-motion handling for screen shake and does not make color the only traffic signal: oncoming traffic faces the player with bright headlights, same-direction traffic faces away with taillights, and directional placement remains tied to the road divide. Rush activation is available through keyboard and touch rather than a gesture-only command.

## Verification responsibilities

The final release check must run the full repository verification path and visually inspect a normal-speed, high-speed, near-miss/Rush, pause, game-over, and portrait title state. The baseline audit and captures are in [`audits/2026-08-14_Manus_NeonArcadeBaseline_Audit.md`](../audits/2026-08-14_Manus_NeonArcadeBaseline_Audit.md).

## Quality-gate maintenance

The final review branch keeps the high-frequency render path explicit while separating its responsibilities into small helpers. The web HUD frame loop delegates to focused state-to-DOM synchronizers; the Pixi renderer delegates world transform, crash flash, road scroll, player effects, entity pools, and individual Neon Rainway draw layers. This preserves the existing low-allocation behavior while making each visual concern independently reviewable.

The repository verification script uses explicit `if` statements for build and test outcomes. This avoids shell `A && B || C` control flow, which static analysis correctly flags as error-prone when a successful first command can still lead to an unintended fallback. The root release build continues to typecheck the native app while omitting its deployment-domain-bound static Expo export from environment-independent CI builds.

| Verification surface | Final evidence |
| --- | --- |
| Shared simulation | `pnpm --filter @workspace/game-core run test` passes 18 tests. |
| Cross-platform typing | `pnpm run typecheck` covers web, native, API, libraries, and scripts. |
| Release gate | `bash scripts/verify.sh` passes secret scan, documentation freshness, build, tests, deployment dry-run policy, and directive lint. |
| External analysis | Codacy ShellCheck finding repaired; CodeFactor refactor re-evaluation is tracked in PR #19. |
| Visual QA | Portrait captures validate the Canvas fallback; real-WebGL and physical-device review remains the intentional final release check. |

## Pseudo-3D camera and traffic rhythm (2026-08-14)

Playtest feedback on the Neon Rainway build was that traffic "has no rhythm — you don't know if they're coming to you or you to them, and they're all in a box". Two distinct causes, both addressed in the web renderer and shared engine.

### 1. The camera was orthographic

The Pixi renderer drew a flat viewport-filling road with parallel lane dashes and every vehicle at its literal hitbox size. A pure top-down view carries **no approach cue**: a car at the top of the screen is drawn identically to one about to hit you, only higher up.

`src/lib/game/perspective.ts` adds a ground-plane projection with a horizon at 17% of screen height. Apparent size follows `1/z`, normalised so scale is exactly `1.0` at the player's row — the player car and its hitbox render unchanged, everything beyond it recedes. Traffic now enters small at the vanishing point and **grows as it closes**; that growth is the approach signal.

The projection is **render-only**. `GameState` stays in flat world coordinates, so collision, lane math and the native Skia renderer are untouched. Nothing in the projection may be used for hit testing.

Consequences for the road layers: nothing can be built once and scrolled any more, because in perspective every transverse feature has a different width and spacing per frame. The road surface, depth shading, asphalt seams, converging lane dashes, shoulders, guardrail edge lights, horizon haze and street lamps are all rebuilt in place each frame in `drawWorld()`. The tiled asphalt sprite and the static lane/guardrail/lamp scene objects it replaced are gone from the web renderer.

The skyline layers finally have a home: they are the parallax city band above the horizon, offset by distance travelled and by the player's lateral position, instead of menu-only DOM images.

### 2. Traffic had no shape and never moved the other way

Spawning was a bounded random cooldown, so every encounter was the same event — one car, wait, one car — and difficulty could only be raised by shortening the wait.

`TRAFFIC_PATTERNS` in `lib/game-core/src/engine.ts` replaces this with short authored patterns: a sequence of beats, each naming which lanes spawn, followed by an enforced rest so the player always gets a readable breath between encounters. Difficulty ramps by **pattern tier**, not spawn frequency. Patterns are mirrored at random to double the vocabulary, and lane placement keeps a ±22% jitter so traffic doesn't look mechanically pinned to lane centres.

**Invariant: no beat may occupy all four lanes.** Every authored pattern is threadable. This is enforced by a test.

Separately, the vehicle update loop applied a `1.2px/frame` floor to same-direction traffic, which meant *every* vehicle in the game moved down-screen and only the rate differed. With nothing ever moving the other way there was no relative motion to read. Same-direction traffic faster than the player now genuinely recedes up-screen; such vehicles enter from *behind* the player (`spawnsFromBehind`), overtake, and pull away. Covered by a test that fails if no vehicle ever moves up-screen.

### Not covered

The native Skia renderer (`artifacts/warboss-highway-mobile`) is still orthographic. Both renderers read the same `GameState`, so the traffic-rhythm and relative-motion changes apply there already, but the camera does not. Tracked in `docs/governance/DEFERRED_WORK.md`.
