# Apex Storm Motion Proof Audit

**Date:** 2026-08-28
**Author:** Manus AI
**Branch:** `feat/apex-storm-renderer`
**Scope:** Software-WebGL demo routes (`demo=motion`, `demo=rush`) that drive the **Apex Storm** renderer with a scripted autopilot, exercised as an internal engineering check ahead of visual review. Per the PR summary and `docs/governance/DEFERRED_WORK.md`, this PR does **not** claim real gameplay-motion, high-speed, or hardware/device validation — that remains explicitly deferred until Shayan's visual acceptance.

## Audit basis

This audit records what the scripted autopilot demo routes exercised against `docs/APEX_STORM_VISUAL_CONTRACT.md`, and is a supplement to the static composition proof, not a substitute for it. The authoritative simulation in `lib/game-core` remains unchanged.

| Motion criterion | Evidence | Status |
| --- | --- | --- |
| Stable camera follow | Camera follows the curved highway spline and player lateral movement in the autopilot capture. | **Exercised in software WebGL; unvalidated on target hardware/devices.** |
| Road recycling | 22 road segments recycle as distance increases; texture offsets animate. | **Exercised in software WebGL; unvalidated on target hardware/devices.** |
| Grounded lane changes | Vehicles stay planted on the `y=0` plane during scripted lateral movement. | **Exercised in software WebGL; unvalidated on target hardware/devices.** |
| High-speed FOV | Camera field-of-view widens at high speeds (Rush mode) in the capture. | **Exercised in software WebGL; unvalidated on target hardware/devices.** |
| Collision response | Screen shake and a white flash overlay trigger during collisions. | **Exercised in software WebGL; unvalidated on target hardware/devices.** |

## Verification evidence

| Check | Command or route | Result |
| --- | --- | --- |
| Normal motion demo | `?renderer=apex&demo=motion&autostart=1` | Autopilot sine-wave movement captured across 1s, 3s, and 5s software-WebGL frames. |
| Rush mode demo | `?renderer=apex&demo=rush&autostart=1` | Dynamic FOV widening captured at 3.5x speed multiplier in software WebGL. |
| Deterministic frame invariants | `pnpm --filter @workspace/scripts test:apex-frame` | **Passed.** |
| Type safety | `pnpm run typecheck` | **Passed.** |

## Visual captures

- **Normal Motion (3s):** `audits/.draft/motion/apex-motion-3s.png`
- **Rush Mode (2s):** `audits/.draft/motion/apex-rush-2s.png`

## Residual risk and deferred work

These captures used software WebGL (SwiftShader/Chromium). Real-device performance, touch latency, hardware-specific rendering artifacts, and actual gameplay-motion feel remain unvalidated, consistent with the PR's explicit scope.

Per the plan, work stops here for owner approval of the static composition proof. Real gameplay-motion validation, **Phase 4 (Atmosphere & Effects)** (rain, lightning, neon billboard reflections), and all other items in `docs/governance/DEFERRED_WORK.md` remain deferred pending that review.

**Conclusion:** The scripted autopilot demo routes exercised camera follow, road recycling, grounded lane changes, dynamic FOV, and collision response in software WebGL. This is supporting evidence only — it does not constitute gameplay-motion validation, which stays deferred until owner acceptance.
