import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { APEX_STORM_ROAD } from '@workspace/render-frame';

// Every texture in the native 3D scene is generated here from code instead of
// loaded from an image file. expo-gl has no DOM <img>, so three's stock
// TextureLoader path is the fragile part of this renderer (see VehicleMesh's
// fail-soft GLTF loading) — typed-array DataTextures upload through plain
// texImage2D and cannot fail to load. Everything is deterministic (hash, not
// Math.random) so captures are reproducible.

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

type Rgba = [number, number, number, number];

function buildTexture(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba,
  options: { repeat: boolean; srgb: boolean; mipmaps: boolean },
): DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.wrapS = options.repeat ? RepeatWrapping : ClampToEdgeWrapping;
  texture.wrapT = options.repeat ? RepeatWrapping : ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = options.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.generateMipmaps = options.mipmaps;
  if (options.srgb) texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// ---------------------------------------------------------------------------
// Road surface
// ---------------------------------------------------------------------------

/** World units of road covered by one vertical repeat of the road textures. */
export const ROAD_TEXTURE_LENGTH = 12;

const ROAD_TEX_W = 256;
const ROAD_TEX_H = 256;
const ROAD_WIDTH = APEX_STORM_ROAD.halfWidth * 2;

interface RoadLine {
  /** Lateral position in world units from the road centre. */
  x: number;
  halfWidth: number;
  dashed: boolean;
  color: [number, number, number];
}

// Lane centres sit at +-1.75 and +-5.25 (see render-frame's laneRatio: the
// outer lanes map to +-(halfWidth - 1.25)), so dividers fall at 0 and +-3.5.
const ROAD_LINES: RoadLine[] = [
  { x: -6.15, halfWidth: 0.11, dashed: false, color: [120, 225, 255] },
  { x: -3.5, halfWidth: 0.08, dashed: true, color: [226, 236, 246] },
  { x: 0, halfWidth: 0.1, dashed: true, color: [255, 190, 70] },
  { x: 3.5, halfWidth: 0.08, dashed: true, color: [226, 236, 246] },
  { x: 6.15, halfWidth: 0.11, dashed: false, color: [120, 225, 255] },
];
const DASH_FRACTION = 0.42;

/** 0..1 coverage of lane paint at this texel, plus the paint colour. */
function roadPaint(x: number, y: number): { coverage: number; color: [number, number, number] } {
  const worldX = (x / ROAD_TEX_W - 0.5) * ROAD_WIDTH;
  const texelWorld = ROAD_WIDTH / ROAD_TEX_W;
  const v = y / ROAD_TEX_H;
  let coverage = 0;
  let color: [number, number, number] = [0, 0, 0];
  for (const line of ROAD_LINES) {
    if (line.dashed && v > DASH_FRACTION) continue;
    const edge = clamp01((line.halfWidth - Math.abs(worldX - line.x)) / texelWorld + 0.5);
    // Soften the two ends of each dash so mipmapped dashes don't shimmer.
    const endFade = line.dashed ? clamp01(Math.min(v, DASH_FRACTION - v) * ROAD_TEX_H * 0.5) : 1;
    const c = edge * endFade;
    if (c > coverage) {
      coverage = c;
      color = line.color;
    }
  }
  return { coverage, color };
}

let roadColorTexture: DataTexture | null = null;
let roadEmissiveTexture: DataTexture | null = null;

/** Wet asphalt with painted lane lines. U spans the road width, V repeats
 * along its length every ROAD_TEXTURE_LENGTH units. */
export function getRoadColorTexture(): DataTexture {
  if (!roadColorTexture) {
    roadColorTexture = buildTexture(
      ROAD_TEX_W,
      ROAD_TEX_H,
      (x, y) => {
        const grain = 0.8 + hash(x, y) * 0.32;
        const blotch = 0.9 + hash(Math.floor(x / 9), Math.floor(y / 9) + 31) * 0.2;
        const shade = grain * blotch;
        const paint = roadPaint(x, y);
        const k = paint.coverage;
        return [
          Math.round(34 * shade * (1 - k) + paint.color[0] * k),
          Math.round(46 * shade * (1 - k) + paint.color[1] * k),
          Math.round(66 * shade * (1 - k) + paint.color[2] * k),
          255,
        ];
      },
      { repeat: true, srgb: true, mipmaps: true },
    );
    roadColorTexture.anisotropy = 4;
  }
  return roadColorTexture;
}

/** Lane paint only, on black — makes the markings glow through fog/darkness
 * the way retro-reflective paint does under headlights. */
export function getRoadEmissiveTexture(): DataTexture {
  if (!roadEmissiveTexture) {
    roadEmissiveTexture = buildTexture(
      ROAD_TEX_W,
      ROAD_TEX_H,
      (x, y) => {
        const paint = roadPaint(x, y);
        const k = paint.coverage * 0.62;
        return [Math.round(paint.color[0] * k), Math.round(paint.color[1] * k), Math.round(paint.color[2] * k), 255];
      },
      { repeat: true, srgb: true, mipmaps: true },
    );
    roadEmissiveTexture.anisotropy = 4;
  }
  return roadEmissiveTexture;
}

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

const WINDOW_COLS = 8;
const WINDOW_ROWS = 16;
const WINDOW_CELL = 8;

let windowTexture: DataTexture | null = null;

/** Emissive map for building faces: a grid of windows, roughly a third lit. */
export function getWindowTexture(): DataTexture {
  if (!windowTexture) {
    windowTexture = buildTexture(
      WINDOW_COLS * WINDOW_CELL,
      WINDOW_ROWS * WINDOW_CELL,
      (x, y) => {
        const cellX = Math.floor(x / WINDOW_CELL);
        const cellY = Math.floor(y / WINDOW_CELL);
        const inX = x % WINDOW_CELL;
        const inY = y % WINDOW_CELL;
        const isGlass = inX >= 2 && inX <= 5 && inY >= 2 && inY <= 5;
        if (!isGlass) return [0, 0, 0, 255];
        const roll = hash(cellX + 3, cellY + 7);
        if (roll > 0.36) return [6, 10, 18, 255];
        const tint = hash(cellX + 11, cellY + 5);
        const level = 0.55 + hash(cellX + 1, cellY + 19) * 0.45;
        const base: [number, number, number] =
          tint < 0.6 ? [110, 185, 255] : tint < 0.85 ? [255, 196, 120] : [255, 96, 210];
        return [Math.round(base[0] * level), Math.round(base[1] * level), Math.round(base[2] * level), 255];
      },
      { repeat: false, srgb: true, mipmaps: true },
    );
  }
  return windowTexture;
}

/** Fog / horizon haze colour. The WebGL clear colour, the scene fog and the
 * bottom of the sky gradient all use this so distant geometry dissolves into
 * the sky with no visible seam. */
export const HAZE_COLOR = '#101f3a';
const HAZE_RGB: [number, number, number] = [16, 31, 58];

/** Fraction of the sky plane's height that lies below eye level. */
export const SKY_HORIZON_V = 0.11;

let skyTexture: DataTexture | null = null;

/** Vertical gradient: haze at/below the horizon, a magenta-violet city glow
 * just above it, falling off to near-black overhead. */
export function getSkyTexture(): DataTexture {
  if (!skyTexture) {
    const top: [number, number, number] = [3, 6, 14];
    const height = 128;
    skyTexture = buildTexture(
      2,
      height,
      (_x, y) => {
        const v = y / (height - 1);
        if (v <= SKY_HORIZON_V) return [HAZE_RGB[0], HAZE_RGB[1], HAZE_RGB[2], 255];
        const t = clamp01((v - SKY_HORIZON_V) / 0.5);
        const ease = t * t * (3 - 2 * t);
        const glow = (1 - clamp01((v - SKY_HORIZON_V) / 0.22)) ** 2;
        return [
          Math.round(HAZE_RGB[0] + (top[0] - HAZE_RGB[0]) * ease + 58 * glow),
          Math.round(HAZE_RGB[1] + (top[1] - HAZE_RGB[1]) * ease + 14 * glow),
          Math.round(HAZE_RGB[2] + (top[2] - HAZE_RGB[2]) * ease + 62 * glow),
          255,
        ];
      },
      { repeat: false, srgb: true, mipmaps: false },
    );
  }
  return skyTexture;
}

let glowTexture: DataTexture | null = null;

/** Soft radial falloff in the alpha channel — light pools on the wet road,
 * headlight throw, and contact shadows all reuse it. */
export function getGlowTexture(): DataTexture {
  if (!glowTexture) {
    const size = 64;
    glowTexture = buildTexture(
      size,
      size,
      (x, y) => {
        const dx = (x + 0.5) / size - 0.5;
        const dy = (y + 0.5) / size - 0.5;
        const falloff = clamp01(1 - Math.sqrt(dx * dx + dy * dy) * 2);
        return [255, 255, 255, Math.round(falloff * falloff * 255)];
      },
      { repeat: false, srgb: false, mipmaps: false },
    );
  }
  return glowTexture;
}
