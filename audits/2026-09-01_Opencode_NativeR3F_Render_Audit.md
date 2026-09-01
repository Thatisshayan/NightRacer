# Audit — Native R3F Mobile Renderer: rendering defects, root cause and fixes

- **Date:** 2026-09-01
- **Agent:** Opencode
- **Scope:** `artifacts/warboss-highway-mobile/components/game3d/*` (R3F native 3D renderer), cross-checked against the web `apex-storm-renderer.ts` and shared `@workspace/render-frame` math.
- **Related:** previously merged CI-repair #50 (`cca9597`), mobile fixes #39–#48, plan `docs/superpowers/plans/2026-08-28-r3f-native-3d-renderer.md`.

## Trigger
On-device feedback reported four rendering symptom categories on the mobile R3F game:
1. artifacts / glitches / garbage pixels;
2. missing or invisible elements;
3. wrong colors / shadows / lighting;
4. crash or console error during render.

## Method
Read every `components/game3d/*.tsx` / `*.ts` file in full; read `native-engine.ts`, `useGameEngine.ts`; read the shared `lib/render-frame/src/index.ts` the renderer consumes; read the web `apex-storm-renderer.ts` this renderer is contractually supposed to mirror; read the implementation plan's progress notes and the git history of the emergency fixes.

## Root-cause findings (high confidence, code-verified)

### A. Camera is never aimed at the road → whole scene invisible/black (Symptom 2)
`R3FGameScene.tsx` created the camera via `<Canvas camera={{ position: [0,2.55,-14.5], fov: 47 }}>` and only ever mutated `camera.position` for screen-shake. A three.js PerspectiveCamera built this way keeps identity rotation and looks down **-Z**, but the road is at `APEX_STORM_ROAD.nearZ=-12 … farZ=70`, i.e. in **+Z** from that seat — the entire scene (road, 10 vehicle slots, rain, fog, lights) is behind the camera. The web renderer it mirrors explicitly orients the camera: `FreeCamera.setTarget(new Vector3(3.45,5.80,24))` (`apex-storm-renderer.ts:139`). The R3F scene never ported the aim.
**Fix:** one-time `camera.lookAt(3.45, 5.8, 24)` in `SceneContent` (`useEffect`); position-only shake preserves orientation. This is very likely the reason the game reads as a black/empty scene, and the reason prior "black-screen" fixes (#47/#48) never fully resolved it — they kept the camera alive but never aimed it.

### B. CarPreview3D camera looks away from the model (Symptom 2)
`CarPreview3D.tsx` camera `[1.6,0.85,1.9]` also never aimed; the grounded model at the origin sits behind the default -Z view, so the title-screen car card rendered empty.
**Fix:** `camera.lookAt(0, 0.5, 0)` in `onCreated`.

### C. No clear color / scene background → black horizon seam, wrong color (Symptoms 1 & 3)
No `onCreated`/`gl.setClearColor`/`scene.background` anywhere; three.js default clear is opaque black while the scene fog is `#112941` (and the web renderer clears `Color4(0.018,0.045,0.088)`). Black shows through where fogged geometry ends and the void begins — a hard, wrong-color horizon that can read as background-bleed/garbage.
**Fix:** `gl.setClearColor('#040B16')` (matches the web renderer's dark dusk clear) in the game Canvas `onCreated`.

### D. GLTF load path crash hazard (Symptom 4)
`VehicleMesh.tsx` `LoadedGltf` dereferenced `gltf.scene.clone()` with no null guard, on a `file://` asset path that is explicitly documented as never verified on-device. A failed/oddly-settled loader resolve could throw a render crash.
**Fix:** guard `gltf?.scene`; return null if missing so the slot falls through its Suspense boundary quietly.

## Not fixed in this pass — recorded as deferred (need on-device verification)
See `docs/governance/DEFERRED_WORK.md`:
1. Vehicles draw no ground shadows/reflections — `<primitive>` GLTF children lack `castShadow`/`receiveShadow`; `VehicleMesh.update` ignores `pose.shadow`/`pose.reflection` (matches "wrong shadows/lighting"). Needs a real render to place/frame correctly.
2. PostFX `Bloom mipmapBlur` on expo-gl's limited WebGL2 — likely artifact/garbage-pixel source, never device-validated; also a phone-GPU perf risk if left on.
3. Unconfirmed per-model forward orientation vs the +Z the code assumes.
4. Per-frame `setActiveKey` churn in `VehicleMesh.update` (perf/cleanliness, not correctness).

## Verification status
- **Code-verified:** all four fixes confirmed against the actual mounted code and the reference web renderer's camera/clear conventions.
- **Type/build:** bare `tsc -p tsconfig.json` in this Windows-only environment reports 484 errors, all environment/module-resolution/`--jsx` noise (every third-party + workspace module fails to resolve in this invocation; the same errors appear on untouched files). This is NOT the repo's verification surface. The genuine mobile compile check is `.github/workflows/ios-build.yml` (`expo prebuild` + `xcodebuild ... archive` on macOS CI), which re-bundles the app's TS with the real Babel/Expo loader — to be run on the PR.
- **Runtime (on-device/CI render):** not yet executed — deferred to CI / a device, per the plan's own "no fabricated proof screenshot" rule.

## Residual risk
- The camera-aim fix is deterministic and low-risk (single `lookAt`), but its visual outcome (road / vehicles / rain now visible) can only be confirmed by a real render.
- The unverified GLTF path remains unverified on-device (fix D only prevents the crash, it cannot prove the models load).
