// Pseudo-3D ground-plane projection for the Pixi gameplay renderer.
//
// Why this exists
// ---------------
// The renderer was orthographic: the road filled the viewport as a flat
// rectangle, lane dashes were parallel, and every vehicle was drawn at its
// literal hitbox size no matter where it sat on screen. Playtest feedback was
// that traffic "has no rhythm — you can't tell if they're coming at you or you
// at them, and it's all in a box". A flat top-down view genuinely carries no
// approach cue: a car at the top of the screen looks exactly like a car about
// to hit you, only higher up.
//
// This module adds a camera that sits low and behind the player, so the road
// recedes to a vanishing point and traffic *looms* — it enters small at the
// horizon and grows as it closes. That growth is the approach signal.
//
// Contract with game-core
// -----------------------
// This is a **render-only** transform. `GameState` stays in flat world
// coordinates and `GameEngine` is untouched, so collision, lane math and the
// mobile Skia renderer keep working off the same numbers. Nothing here may be
// used for hit testing.
//
// The math
// --------
// World Y runs 0 (far) .. H (near, bottom of screen). Let `t = worldY / H`.
// For a pinhole camera looking at a ground plane, apparent size is
// proportional to 1/z, and depth falls off linearly with t, so:
//
//   raw(t) = 1 / (1 + DEPTH_K * (1 - t))
//
// `raw` is normalised twice, for two different jobs:
//
//   scale(t)  = raw(t) / raw(PLAYER_T)
//       Sprite scale, pinned to 1.0 at the player's row. Without this the
//       player car would shrink along with everything else and the whole
//       playfield would just get smaller.
//
//   screenY(t) = HORIZON + (H - HORIZON) * (raw(t) - raw(0)) / (1 - raw(0))
//       Vertical placement, normalised so worldY 0 lands exactly on the
//       horizon and worldY H lands exactly on the bottom edge. Strict pinhole
//       would leave a band of unreachable road between the horizon and the
//       first spawnable row; this keeps traffic using the full visible road
//       while preserving the non-linear compression that reads as depth.
//
// X converges on the road centre by the same scale factor, which is what
// turns the rectangle into a trapezoid and the parallel lane dashes into
// converging ones.
export const HORIZON_FRACTION = 0.17;
// Larger = more aggressive foreshortening. 2.8 puts the horizon-line scale at
// ~0.41x and the bottom-edge scale at ~1.56x relative to the player, which
// reads as a low chase camera without distorting vehicle silhouettes into
// unrecognisable slivers.
export const DEPTH_K = 2.8;
// Where the player sits as a fraction of world height. Mirrors GameEngine's
// player Y placement; scale is pinned to exactly 1.0 here so the player car
// and its hitbox stay visually identical to the pre-perspective build.
export const PLAYER_T = 0.8;

export interface ProjectedPoint {
  x: number;
  y: number;
  scale: number;
}

export class Projection {
  readonly width: number;
  readonly height: number;
  readonly horizonY: number;
  readonly centerX: number;
  private readonly raw0: number;
  private readonly rawPlayer: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.horizonY = height * HORIZON_FRACTION;
    this.centerX = width / 2;
    this.raw0 = Projection.raw(0);
    this.rawPlayer = Projection.raw(PLAYER_T);
  }

  private static raw(t: number): number {
    return 1 / (1 + DEPTH_K * (1 - t));
  }

  /** Sprite scale at world Y. 1.0 at the player's row, <1 beyond it. */
  scaleAt(worldY: number): number {
    return Projection.raw(worldY / this.height) / this.rawPlayer;
  }

  /** Screen Y for a world Y. Monotonic; worldY 0 -> horizon, H -> bottom. */
  screenY(worldY: number): number {
    const r = Projection.raw(worldY / this.height);
    return this.horizonY + (this.height - this.horizonY) * ((r - this.raw0) / (1 - this.raw0));
  }

  /** Full projection of a world-space point on the ground plane. */
  project(worldX: number, worldY: number): ProjectedPoint {
    const scale = this.scaleAt(worldY);
    return {
      x: this.centerX + (worldX - this.centerX) * scale,
      y: this.screenY(worldY),
      scale,
    };
  }

  /** Half-width of the road at a given world Y, in screen pixels. */
  halfWidthAt(worldY: number): number {
    return (this.width / 2) * this.scaleAt(worldY);
  }

  /**
   * Entities spawn above the playfield (world Y as low as -160) and would
   * otherwise project past the horizon and pop into view. Anything beyond
   * this depth is clamped to the horizon row and faded, so traffic resolves
   * out of the distance instead of appearing instantly.
   */
  fadeInAlpha(worldY: number): number {
    if (worldY >= 0) return 1;
    return Math.max(0, 1 + worldY / 160);
  }

  /** Clamp world Y so off-playfield entities still land on visible road. */
  clampWorldY(worldY: number): number {
    return Math.max(0, worldY);
  }
}
