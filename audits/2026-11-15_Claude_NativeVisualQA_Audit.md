# Native 3D Renderer — Visual QA and Rebuild Audit

**Date:** 2026-11-15
**Author:** Claude (Claude Code)
**Branch:** `fix/mobile-visual-rebuild`
**Scope:** Visual QA of the native iOS app (`artifacts/warboss-highway-mobile`, React Three Fiber on expo-gl) on a remote iOS Simulator, and the fixes that followed. Covers the shared frame builder (`lib/render-frame`) where a defect originated there.

## How it was tested

- App: unsigned Release simulator build from `.github/workflows/ios-simulator-build.yml` (JS bundle embedded, no Metro).
- Device: Limrun cloud iPhone simulator, iOS 26.4, 402x874 pt.
- Iteration: the workflow's `bundle` mode rebuilds only the JS bundle, which was swapped into the existing `.app` and reinstalled.
- Flow exercised on the final build: launch, tutorial, title / car select, start, gameplay, pause, quit to menu, game over, play again, Kill-Board tab.

Captures: [`before`](2026-11-15_Claude_NativeVisualQA_Before.png), [`after`](2026-11-15_Claude_NativeVisualQA_After.png).

## Findings and fixes

| # | Finding (before) | Cause | Fix |
| --- | --- | --- | --- |
| 1 | The curved road and every vehicle on it snapped back to the starting shape several times a second. | `buildApexStormFrame` drove the curve phase, lightning and biome from `state.roadOffset`, which the engine wraps at 80px (it is a 2D tile-scroll value). | Frame builder now uses monotonic travel derived from `state.distance`; adds `travel` to the frame. |
| 2 | Steering was mirrored: dragging right moved the car left. | Frame coordinates are left-handed (Babylon); three.js is right-handed. The port never flipped X. | X and heading negated at the three.js boundary (road, vehicles, camera). |
| 3 | Player car left the screen on curves; ~60% of the screen was empty sky; passing trucks filled the whole view. | Camera copied the web seat: fixed in X, low, aimed up, with an ~11 degree horizontal half-FOV in portrait. | Higher chase seat that looks down the road and follows the player laterally; passed traffic fades out. |
| 4 | Vehicles rendered as black silhouettes. | Light intensities copied from Babylon (three.js physical units are ~3x dimmer for the same number) and the key light sat ahead of the cars. | Intensities rescaled; key light moved behind the camera. Same correction applied to the title-screen car preview. |
| 5 | Vehicle textures never loaded (cars untextured). | The bundle contained two copies of three.js (`import` and `require` builds). `@react-three/fiber/native` patched `TextureLoader` on one copy; `GLTFLoader` used the other. | `metro.config.js` pins every `three` request to one file. |
| 6 | With textures loading, vehicles were still near-black. | Most GLBs omit `metallicFactor`; glTF defaults it to 1.0 (pure metal, no diffuse) and the scene has no environment map. | Vehicle materials forced to non-metallic paint with a weak emissive of their own texture. |
| 7 | No world: road floated in a void, no lane markings, nothing conveyed speed. | Road was 22 flat-coloured boxes with one static dash each; skyline/billboards had been deferred. | Road is one textured ribbon with scrolling lane paint; added a recycled instanced skyline with lit windows and neon signs, a sky gradient, lamps, light pools and contact shadows. All textures are generated in code. |
| 8 | Rain rendered as blocky square "stars". | `gl.POINTS` on expo-gl. | Rain drawn as line streaks. |
| 9 | The system tab bar covered the Rush button and speed gauge during play. | Gameplay rendered inside the tab screen; `NativeTabs` cannot hide the bar. | Gameplay presented in a full-screen `Modal`, padded to the safe area. |
| 10 | Title ("WARBOSS") and "WASTED" rendered under the status bar. | No safe-area inset on those screens. | Insets applied; car preview enlarged; skyline fade repositioned. |
| 11 | A failed score submission took the app to the root error screen. | `GameOverScreen` re-threw the mutation error during render, outside the boundary it returns. | Throw removed; the existing inline error message is shown. |
| 12 | Each vehicle spawn re-parsed its GLB and re-uploaded its texture. | No cache around `GLTFLoader.loadAsync`. | Loads cached per URI; materials cloned per instance. |

## TestFlight crash (build 32, iPhone 15 Pro Max, iOS 27.0.1)

Reported during this work: `EXC_BAD_ACCESS (SIGSEGV)` 16 seconds after launch, crashed thread inside `HadesGC` under `convertNSExceptionToJSError` <- `ObjCTurboModule::performVoidMethodInvocation`.

- **What it is.** In a release build React Native reports a fatal JS error to the native `ExceptionsManager`, which raises an `NSException` on purpose. On the New Architecture that is caught on a background queue and converted into a JS error against the Hermes runtime from the wrong thread (facebook/react-native#54859). The crash is the consequence of an uncaught JS error, not its cause.
- **Confirmed by reproduction.** A build that throws from a timer died on the simulator with `ExceptionsManager.reportException raised an exception: Unhandled JS Exception` under `performVoidMethodInvocation`.
- **Fix.** `lib/fatal-errors.ts` installs a global handler: a fatal JS error now shows the existing error screen (message and stack available from its details button) and is persisted, instead of taking the native path. Verified with the same probe: the app stays alive on the error screen.
- **Not known.** Which JS error fired on the device. The crash report carries no message, and that build (commit `18d576c`, the pre-rebuild scene) did not fail on the simulator. If it recurs on the new build the error screen will show it.

## Verification

| Check | Result |
| --- | --- |
| Final build launches and plays on the simulator | Pass (captures above) |
| Player starts right of the centreline (lane 2), matching the web layout | Pass |
| Pause, resume, quit to menu, game over, play again | Pass |
| Kill-Board tab loads live data | Pass (checked on the pre-fix build; unchanged code) |
| CI `gate`, `windows-smoke` (typecheck + build) | See PR checks |

## Not verified

- **Physical device.** Everything above is the iOS Simulator. Frame rate, memory and GPU behaviour on real hardware are unmeasured.
- **Steering direction by gesture.** Confirmed by the coordinate math and by the start lane landing on the correct side. The simulator tool's scroll gesture does not state which way the finger moves, so the drag test alone is not conclusive.
- **Web Apex renderer (`?renderer=apex`).** It consumes the same frame builder, so finding 1 changes its road motion too. It was not run.
- **Tunnel biome and boss encounter** were not reached in the short runs captured.

## Follow-ups

Recorded in `docs/governance/DEFERRED_WORK.md`.
