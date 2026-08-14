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
