# Native 3D Asset Manifest

Companion to `docs/superpowers/plans/2026-08-28-r3f-native-3d-renderer.md`. Every item below is a real gap the placeholder box-car/box-road geometry in that plan is standing in for. Generate via Higgsfield (`generate_image` → `generate_3d` for models; `generate_image` alone for flat textures) or source elsewhere — the renderer code doesn't care where a `.glb`/texture came from, only that it lands at the path listed.

**Format targets (mobile GPU budget):**
- Vehicles: glTF/GLB, **under 15k triangles** each, single 2048×2048 (or smaller) PBR texture set (basecolor/metalness-roughness/normal), baked-in wheels — no separate rig/animation needed since wheels don't need to spin for this camera angle.
- Environment textures: 1024×1024 or 2048×2048, tileable where noted, PNG (alpha) or JPG (opaque).
- Keep every vehicle's *silhouette* readable at the small on-screen size a chase-cam view actually renders it at — don't over-invest in detail nothing will resolve.

---

## 1. Player vehicles (5 — one per `CarType`)

Generate as a 3-quarter front view on a plain neutral background (best photogrammetry/3D-reconstruction results), matching each car's existing identity:

| Car | Visual brief | Reference color |
| --- | --- | --- |
| **RATTLETRAP** | Wide, sturdy junkyard beater — bolted-on armor plates, patchwork paint, exposed roll cage. Reads as slow-but-tough. | `#a86b32` (rust/tan) |
| **WAR-RUNNER** | Balanced muscle-car silhouette, mid-size, aggressive but not overbuilt — the "classic choice." | `#5e7a45` (olive) |
| **DEATHSLED** | Narrow, low, fast — stripped-down speedster look, minimal armor, sleek and dangerous. | `#3d6db8` (steel blue) |
| **SCRAPQUEEN** | Armoured behemoth — the widest/heaviest silhouette, visibly tank-like, welded scrap plating. | `#7a4a8a` (purple) |
| **PHANTOM** | Ghost-thin, narrowest car in the roster — sleek, low-profile, almost blade-like. | `#00ffcc` (cyan) |

Suggested Higgsfield prompt pattern per car:
> "A [visual brief] post-apocalyptic highway combat car, 3/4 front view, [color] primary paint, dramatic studio lighting, plain dark background, video game vehicle asset, clean silhouette, no background clutter"

## 2. Traffic vehicles (7 variants + 1 boss)

Matches `ENEMY_VARIANT_TYPES`/`VehicleType` in `game-core`. These populate the road as obstacles/traffic — need to read clearly at speed and be visually distinct from each other and from the player cars:

- **SEDAN** — generic civilian sedan, muted color
- **PICKUP** — pickup truck, slightly taller silhouette
- **COP** — police cruiser, black-and-white, light bar on roof (reads instantly as "avoid")
- **BOXTRUCK** — tall box truck/delivery van, biggest civilian silhouette
- **BUS** — long bus, widest same-direction traffic hazard
- **SPORTS** — low, fast civilian sports car, bright color
- **TANK** — armored military-style tank/APC (mid-boss-tier hazard, not the final BOSS)
- **BOSS** — one dedicated, unique large hostile vehicle (single sprite/model today per the existing code comment — most important single asset for "top notch" impact, since it's the game's climactic visual)

Same prompt pattern as above, dropping the player-car color mapping and instead keeping each visually distinct at a glance (silhouette + color, not just color).

## 3. Environment textures

| Asset | Notes |
| --- | --- |
| Wet asphalt road tile | Tileable, dark asphalt with visible wet-sheen/reflection streaks — already exists for the web Apex Storm renderer at `artifacts/warboss-highway/public/apex/wet-asphalt-tile.jpg`; reuse directly, no regeneration needed. |
| Concrete tunnel wall tile | Tileable, industrial concrete with grime/stains — already exists at `artifacts/warboss-highway/public/apex/concrete-tunnel-tile.jpg`; reuse directly. |
| Neon billboard art (2-3 variants) | Flat image, cyberpunk advertisement style, bright neon colors on dark background — `neon-billboard.png` already exists for web reuse; generate 1-2 additional variants for visual variety if billboards repeat noticeably. |
| Guardrail material | Metallic, worn cyan-lit barrier — can stay a procedural material (as scaffolded in `RoadMesh.tsx`) rather than a texture; only generate if flat color reads too cheap on-device. |

## 4. Skybox / environment lighting

- **HDRI environment map** (`.hdr`, equirectangular) — dark stormy night sky with a hint of city glow on the horizon, matching Apex Storm's mood (`#0a1520` ambient, `#112941` fog). Used for realistic PBR reflections on vehicle paint/glass — this is the single highest-leverage asset for making the scene look "top notch" rather than flat-lit, since PBR materials without an environment map look plastic.
- If Higgsfield doesn't produce `.hdr` directly, a flat wide night-sky image can be converted to equirectangular/HDR via a free tool (e.g. Poly Haven's format, or `hdrihaven`-style conversion) as a fallback — flag this back to me if it becomes a blocker.

## 5. Particle/effect textures

- Rain streak sprite — already exists at `artifacts/warboss-highway/public/apex/rain-streak.png` (web); the native plan currently draws rain as plain colored points (`Atmosphere.tsx`), so this only matters if points read too cheap on-device and textured sprites are wanted instead.
- Steam/smoke puff sprite — already exists at `artifacts/warboss-highway/public/apex/steam-puff.png`; same as above, only needed if/when tunnel-biome steam vents are added to the native scene (currently deferred).

---

## Priority order if generating incrementally

1. **The BOSS vehicle** — single highest-impact model for "feels top notch."
2. **The 5 player cars** — players stare at their own car's silhouette (from behind) the entire run.
3. **HDRI skybox** — biggest single lift for overall material/lighting quality.
4. **The 7 traffic variants** — high volume on-screen, but each one is seen far more briefly than the player's own car.
5. Everything in section 3-5 — reuse the existing web Apex Storm textures where listed; only generate net-new pieces.
