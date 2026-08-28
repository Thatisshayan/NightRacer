# Apex Storm Visual Contract

**Status:** Approved target for the web-first renderer rebuild
**Selected by:** Shayan
**Author:** Manus AI
**Date:** 2026-08-27

## Purpose

This contract defines the non-negotiable visual target for NightRacer’s new renderer. It replaces the rejected diagrammatic elevated-deck composition with a cinematic, shallow rear-chase highway view. It is intentionally separate from the shared game simulation: lanes, collisions, input, score, Rush, power-ups, and progression remain authoritative in `lib/game-core`.

The approved direction is **Apex Storm**. **Neon Tunnel Run** may later become an environment district using the same camera and vehicle-contact rules. **Skyline Siege** is reserved for occasional event or boss presentation and must not redefine the baseline driving view.

## Frame composition

| Element | Required design | Must not happen |
| --- | --- | --- |
| Camera | Fixed, shallow, three-quarter rear-chase camera with one road-relative vanishing path. | A top-down camera, a flat road trapezoid, or independent background/sprite camera math. |
| Player | Lower 18–24% of usable portrait play space. Rear body, wheel locations, and a visible planted stance. | A foreground poster car, a centered sprite that floats above its lane, or a vehicle wider than its near-field road context supports. |
| Road | Broad rain-wet elevated expressway with a gentle curve, asphalt seams, structured barriers, reflectors, and city void beneath/alongside it. | Straight lane-grid presentation, a pure black void, or effects used in place of road material. |
| Traffic | Sparse and depth-banded; red taillights for same-direction traffic and cool white headlights for oncoming traffic. | Dense undifferentiated light noise, parallel motion without scale change, or ambiguous traffic direction. |
| Contact | Wheel contacts, chassis transform, shadow, thin water reflection, and light response all derive from one road-relative pose. | Separately placed ellipse shadows, sprite-centre anchors, screen-space reflection strips, or light effects that drift from cars. |
| City | Low-frequency vertical skyline and practical billboard sources outside the driving corridor. | A wall of sharp high-contrast signs that competes with hazards or HUD. |
| Weather | Sparse rain and storm-cloud depth after the base road is accepted. | Full-screen fog, flashes, blur, or precipitation that obscures the road/hazards. |

## Camera and contact rule

Every vehicle’s visual position is determined by the same sequence:

```text
shared logical lane + road progress
  → curved road centre/tangent
  → wheel-contact points on the road plane
  → vehicle chassis transform and depth
  → shadow, reflection, headlight/taillight positions
```

The renderer may not move any vehicle body, shadow, reflection, or light source independently after this pose is established. The shared game engine never receives screen coordinates or camera transforms.

## Lighting hierarchy

| Priority | Source | Color and behavior |
| ---: | --- | --- |
| 1 | Traffic direction and hazards | Red rear lights and cool-white headlights remain readable at all times. |
| 2 | Player identity | Restrained red tail lamps, blue body highlights, compact wet-surface reflection. |
| 3 | Road navigation | Cyan edge reflectors and amber lane/road markings establish depth, never dominate traffic. |
| 4 | Environment | Magenta signs, storm exposure, and distant city lighting are rare, practical, and lower contrast than hazards. |

## Implementation boundary

The Apex Storm renderer begins behind `?renderer=apex` on `feat/apex-storm-renderer`. The current shipped renderer remains the default on `main`; the previous Pixi and Canvas paths are rollback references until the new renderer passes visual gates and receives separate merge approval. PR #34 is historical rejected-proof work and will not be used as an implementation base.

The first code milestone is intentionally narrow: a deterministic 420×800 composition containing the curved wet road, player, four traffic vehicles, barriers, a sparse skyline, and contact-light treatment. HUD redesign, rain, lightning, billboard animations, tunnel art, event art, native parity, default routing, merging, and TestFlight work are excluded until the visual frame itself is approved.

## Acceptance checklist

The first Apex Storm capture passes only if all of the following are visible in a 420×800 frame:

1. The player’s tires and every visible traffic vehicle read as planted to the same wet road surface.
2. The road is broad, gently curved, materially wet, and visibly elevated rather than a flat lane diagram.
3. Traffic forms clear near, middle, and far depth bands with unambiguous direction lights.
4. The player is important but does not overwhelm the frame or the width of the road.
5. Barriers, reflectors, city scale, and light reflections reinforce the same camera rather than competing with it.
6. No full-screen effect, artificial halo, or HUD element is needed to sell depth.

Any failure on this checklist returns the work to the composition proof stage; it does not trigger more atmosphere or a default-route change.
