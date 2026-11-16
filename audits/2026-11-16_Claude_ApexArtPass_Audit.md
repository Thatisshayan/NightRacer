# Apex art pass and road items - audit

- **Date:** 2026-11-16
- **Agent:** Claude
- **Scope:** native 3D scene (`artifacts/warboss-highway-mobile/components/game3d`), shared frame builder (`lib/render-frame`)
- **PRs:** #59 (art pass), #60 (road items, reflections)
- **Continues:** `audits/2026-11-15_Claude_NativeVisualQA_Audit.md` (findings 1-26)

## Owner verdict

After PR #60 the owner rated the visuals as roughly 10% better than before and still far from expectation. The work below is real but has not closed the gap to the reference image. Read "Where the gap is" before planning more of the same.

## Art direction (decided by the owner)

- The target is the owner's reference image: a red hypercar on an elevated wet neon highway in a storm, towers and giant advert screens on both sides. It lives in the Higgsfield project `Apex-Storm-User-Main-One`.
- The red car is the default player car. The other four selectable cars are to be restyled to match, but that is on hold: the owner wants to keep one car and save Higgsfield credits (about 61 left; one textured 3D generation costs 30).
- Art is generated, not bought. 2D images come from headless Codex (`codex exec`, `-i` attaches the reference); 3D from Higgsfield `generate_3d`.

## Findings and changes

| # | Finding | Change |
| --- | --- | --- |
| 27 | The city was procedural boxes with a window grid. | Codex-generated facades, billboards, storm sky and far skyline, packed into `assets/3d/city_pack.glb` by `scripts/build_texture_pack.py` and loaded by `texturePack.ts`. Shipped inside a GLB because expo-gl does not decode loose image files (finding 26). Falls back to the procedural look if the pack fails. |
| 28 | The player car was a generic model. | Red hero car generated in Higgsfield from the reference, cleaned by `scripts/clean_vehicle_glb.py` (floaters removed, nose to +Z, texture 2.9 MB to 252 KB), mapped to `WAR_RUNNER`. |
| 29 | The camera looked down so steeply that the city was a thin strip behind the HUD. | `LOOK_Y` -3.3 to 0.4, `CAMERA_Y` 6.4 to 6.0. The city now fills the top third. |
| 30 | The road was flat lavender. | Near-black asphalt texture; roughness 0.9 and metalness 0 so the magenta rim light no longer makes a broad purple wash. |
| 31 | Billboards faded to dull blue beyond the nearest block. | Billboard art is unfogged; scene fog 0.012 to 0.0095; more and larger billboards (every third tower). |
| 32 | **Power-ups, oil slicks and debris were never drawn.** The simulation spawned and collided with them, but `ApexStormFrame` carried vehicles only. Players lost lives to invisible debris and spun out on invisible oil. | The frame now has `items`; `RoadItems.tsx` draws a gem with beam and light pool per power-up type, an iridescent oil patch, and hazard-coloured debris. |
| 33 | `laneRatio` clamped to the outer lane centres, but the player can sit about 20 px beyond them, so at the road edge the car was drawn inside its real hitbox position. | Clamp widened to +-1.13. |
| 34 | The wet road had no coloured reflections. | Each billboard's glow is smeared down the road toward the camera (`placeReflection` in `Skyline.tsx`). |
| 35 | With the lower camera, overhead gantry signs swept through the view and hid traffic. | `GANTRY_HEIGHT` 8.4 to 13. |

## Verification

| Check | Result |
| --- | --- |
| Red car, facades, billboards, skyline load and render (simulator) | Pass |
| Unfogged billboards, darker road, neon reflections (simulator) | Pass |
| Power-up visible from the far end of the road (simulator) | Pass |
| CI `gate`, `windows-smoke`, full iOS simulator build, Codacy on #59 and #60 | Pass |

## Not verified

- **Oil and debris on screen.** They only spawn after `state.distance > 10000`; the scripted test driver dies before that. Code path is the same as power-ups, but the two looks have not been seen.
- **Raised gantries (35).** Merged after the last recording.
- **Physical device.** Simulator only, as before.
- **Web Apex renderer.** It consumes the same frame; the `laneRatio` change (33) affects it and it was not run. It does not draw `items` either.

## Where the gap is

Honest comparison of the last recordings against the reference:

1. **Everything is low-poly geometry with flat textures.** The reference is a painted, fully lit image. Tuning numbers in this renderer will not reach it.
2. **Traffic cars** are plain old-style models next to the hero car.
3. **No post-processing.** Bloom is what makes neon read as light; it is disabled because expo-gl's half-float render targets crashed (see `PostFX.tsx`, PR #41). An LDR bloom on 8-bit targets has not been tried.
4. **Road** has no real reflection of tail lights or signs, only additive glow quads.
5. **Lighting** is one hemisphere and two directional lights; towers are emissive textures, not lit.
6. **Gameplay feel** was raised by the owner as needing work, with no specifics yet. The scripted driver cannot judge difficulty.

Options worth putting to the owner rather than more incremental tuning: an LDR bloom pass behind a flag; replacing traffic models in the hero style; a painted backdrop approach (large authored panorama layers instead of box towers); or reconsidering the renderer.

## Tooling notes for whoever resumes

- Fast loop: `gh workflow run ios-simulator-build.yml --ref <branch> -f mode=bundle`, swap the JS bundle into the simulator `.app`, install on a Limrun simulator, record, extract frames with ffmpeg. The bundle build does not typecheck; CI `gate` does.
- Limrun bills while a simulator exists. Delete it after every recording.
- Codacy's 50-line function check (Lizard) miscounts TSX: components with inline destructured prop types or long JSX get merged with the functions after them. Use named prop interfaces and data-driven JSX.
