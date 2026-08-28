# Renderer Rebuild Asset Manifest

**Owner:** Shayan  
**Author:** Manus AI  
**Status:** Active for the recalibrated web renderer and real-motion review slice
**Date:** 2026-08-27

## Purpose

This manifest records the visual target and the small runtime asset set for the renderer rebuild. It exists to prevent the replacement scene from drifting back to a top-down, sticker-like vehicle presentation. The shared simulation remains asset-agnostic; this document governs only the renderer-owned visual layer.

## Master visual target

The approved build direction is a shallow **rear-chase** view over a wet elevated night highway. The decisive visual cue is the tire/contact baseline: every vehicle must visibly sit on the road plane, with a compact contact shadow and short wet-road reflection drawn from the same renderer-owned contact coordinate. The player is large in the lower frame; traffic shrinks toward a single vanishing point without losing its direction lights.

The generated master reference remains private source art under the ignored `rebuild-assets/` workspace directory. It is not a runtime texture and is deliberately not committed.

## Versioned runtime textures

| Runtime path | Subject | Intended use | Camera and contact rule |
| --- | --- | --- | --- |
| `artifacts/warboss-highway/public/sprites/rebuild/player-rear.png` | Dark navy player coupe with cyan trim and red taillights | Player vehicle | Shallow three-quarter rear; lower bumper/tire baseline anchors to the visual-frame contact row. |
| `artifacts/warboss-highway/public/sprites/rebuild/traffic-rear.png` | Dark maroon same-direction traffic coupe | Same-direction traffic | Shallow three-quarter rear; red lamps lead the direction cue. |
| `artifacts/warboss-highway/public/sprites/rebuild/traffic-front.png` | Silver oncoming traffic coupe | Oncoming traffic | Shallow three-quarter front; white headlights lead the direction cue. |

The committed textures are reduced to final-use web dimensions and have verified RGBA pixel formats. The source art is generated over chroma green and deterministically keyed to alpha before runtime use. No image contains a baked road, reflection, drop shadow, rain, text, or atmospheric overlay; those elements are rendered in the scene from the one contact pose.

## First-slice constraints

The active web slice uses only the three textures above, fixed recyclable road geometry, a stable camera specification, a deterministic demo traffic formation, and normal live `GameEngine` state. Lightning, billboards, broad rain layers, boss art, obstacles, and power-up art remain excluded until high-speed/dense-traffic motion is validated.

## Asset verification checklist

| Check | Required result |
| --- | --- |
| Transparency | Runtime textures report RGBA pixels; no checkerboard or chroma backdrop is visible. |
| Baseline | The bottom of the rendered tire/body silhouette meets the shadow/reflection contact row. |
| Perspective | All vehicle assets use the same shallow chase camera pitch. |
| Legibility | Red rear lamps and white front lamps remain visible over the night road. |
| Runtime scope | High-resolution source art stays ignored; only compact runtime textures are committed. |
