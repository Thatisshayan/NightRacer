# Audit — Native R3F Mobile Renderer: device-render hardening (PostFX gate + fail-soft GLTF)

- **Date:** 2026-09-02
- **Agent:** Opencode
- **Scope:** `artifacts/warboss-highway-mobile/components/game3d/PostFX.tsx`, `VehicleMesh.tsx`, `R3FGameScene.tsx`; cross-checked against the proven-good on-device baseline `R3FSmokeTest.tsx` (plain `<Canvas>`, no composer, no GLTF).
- **Related:** PR #51 (camera-aim/clear-color/GLTF-guard, merged `dbd57ce`), plan `docs/superpowers/plans/2026-08-28-r3f-native-3d-renderer.md`, `docs/governance/DEFERRED_WORK.md`.

## Trigger
After the camera-aim fixes (PR #51) landed, a real-iOS-device user still reported:
1. garbage / glitch pixels;
2. wrong colors / shadows / lighting;
3. crash or console error.

The user could not provide device logs.

## Method
No device logs were available, so the fix targeted the two code paths that (a) ride **outside** the known-good smoke-test baseline (`R3FSmokeTest.tsx` — a plain `<Canvas>` with no `EffectComposer` and no `GLTFLoader`), (b) were still explicitly documented in-code as unverified-on-device, and (c) map one-to-one onto the three reported symptoms. Both fixes are reversible and provably remove their symptom class by construction; neither requires a device render to land, but both still need on-device confirmation to fully close.

## Root-cause/decision findings (high confidence, code-verified)

### E. Garbage/glitch pixels + wrong colors → PostFX `EffectComposer` + `Bloom mipmapBlur` on expo-gl (Symptoms 1 & 2)
`PostFX.tsx` mounted `<EffectComposer multisampling={0}><Bloom … mipmapBlur /><Vignette … /></EffectComposer>` through expo-gl. expo-gl's WebGL2 support is acknowledged incomplete in-repo (`Atmosphere.tsx` comment), and half-float render targets + mipmap blur are the classic source of colored-noise / "garbage pixels" and shifted colors on mobile GL drivers. The only render path proven-good on a device is the compositor-free `R3FSmokeTest`.
**Fix:** `PostFX` now returns `null` by default (`process.env.EXPO_PUBLIC_ENABLE_POSTFX !== '1'`), removing the composer from the native renderer and returning the scene to the no-composer baseline. Re-enabling is a deliberate, documented one-line env decision that still requires on-device validation.

### F. Crash / console error → `file://` GLTF `useLoader` path (Symptom 3)
`LoadedGltf` loaded via `useLoader(GLTFLoader, uri)` where `uri` is an expo-asset `file://`-style local path. On a real device `GLTFLoader`'s internal `fetch()` rejects `file://`; R3F's `useLoader` then rethrows that error, which `<Suspense>` does **not** catch, so it bubbles to the app's root `ErrorBoundary` → the "something went wrong, please reload" crash. (The previous null-guard on `gltf?.scene` in #51 only handled a settled-but-empty load, not a rejected fetch.)
**Fix:** replaced `useLoader` with an imperative `GLTFLoader.loadAsync` + try/catch:
- success → return the normalized grounded model (identical to the old path);
- rejection / empty scene → render a grounded car-shaped placeholder (y=0, reuses the ground convention) and cache the failed URI so re-mounts do not retry every frame;
- no thrown error, so a model load can never crash the app or blank a slot.
Hooks are all unconditional (Rules-of-Hooks safe). `R3FGameScene.tsx`'s per-slot `<Suspense>` boundaries are retained as inert but harmless safety; comments updated to reflect the new non-suspending, fail-soft behavior.

## Status
- PostFX: **mitigated** (off by default; re-enable after device validation).
- `file://` GLTF load: **mitigated-soft** (no crash / no blank slot; real GLTF models may still fail to display until the underlying `file://` fetch is solved — placeholder shows in that case).
- Still open / deferred (unchanged): vehicle ground shadows & reflections; per-model forward orientation; per-frame `setActiveKey` churn. See `DEFERRED_WORK.md`.

## Verification
- Logic reviewed for hook-order correctness and unused-import/type sanity; the mobile package compiles via CI (`ios-build.yml` — xcodebuild archive re-bundles through the real Babel/Expo toolchain) since local `tsc` is unavailable (stale `node_modules`, see `DEFERRED_WORK.md`).
- No device render was performed in this Windows-only session; on-device confirmation is still required to fully close (per repo R3/R8 — no fabricated proof).
