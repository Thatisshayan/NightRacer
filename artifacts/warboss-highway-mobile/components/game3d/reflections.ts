import { Asset } from 'expo-asset';
import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
} from 'three';
import type { MeshStandardMaterial } from 'three';

// Reflections for a scene that has no environment map.
//
// A real environment map (cube or equirect, prefiltered by three's
// PMREMGenerator) needs half-float render targets, which is exactly the
// expo-gl path that produced garbage pixels and a crash on device (see
// PostFX.tsx and the removed cubemap Environment, PR #41). A "matcap" gets
// most of the look for none of the risk: the reflection of a whole
// environment is baked into one image of a mirrored sphere, and a surface
// looks up its colour by where its normal points on screen. One ordinary
// texture read, no render targets.
//
// Rather than swapping vehicles to MeshMatcapMaterial (which would discard
// scene lighting, emissive trim and fog behaviour), the lookup is added to
// MeshStandardMaterial's own shader as an extra reflective layer.

const SIZE = 256;

type Rgb = [number, number, number];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Colour of the imagined surroundings in direction (x, y, z), y up. */
function environment(x: number, y: number, z: number): Rgb {
  const azimuth = Math.atan2(x, z);
  // Neon band hugging the horizon: magenta and cyan signage with amber lamps.
  const neonMix = 0.5 + 0.5 * Math.sin(azimuth * 3 + 1);
  const amber = Math.max(0, Math.sin(azimuth * 7 + 0.5)) ** 8;
  const neon: Rgb = [
    mix(255, 40, neonMix) + 255 * amber,
    mix(60, 220, neonMix) + 170 * amber,
    mix(210, 255, neonMix) + 70 * amber,
  ];
  const band = Math.exp(-((y - 0.03) ** 2) / 0.0018);

  if (y >= 0) {
    // Night sky: navy at the horizon falling to near-black overhead, with one
    // broad cool key light (the moon / city glow) high and slightly ahead.
    const t = clamp01(y);
    const keyDot = Math.max(0, x * 0.2 + y * 0.84 + z * 0.5);
    const key = keyDot ** 28 * 0.95 + keyDot ** 3 * 0.16;
    return [
      mix(20, 4, t) + neon[0] * band * 1.1 + 190 * key,
      mix(34, 7, t) + neon[1] * band * 1.1 + 215 * key,
      mix(70, 16, t) + neon[2] * band * 1.1 + 255 * key,
    ];
  }
  // Wet street: dark, carrying a blurred mirror image of the neon band.
  const mirror = Math.exp(-((y + 0.12) ** 2) / 0.02) * 0.34;
  return [
    10 + neon[0] * (band * 1.1 + mirror),
    14 + neon[1] * (band * 1.1 + mirror),
    26 + neon[2] * (band * 1.1 + mirror),
  ];
}

function buildMatcap(): DataTexture {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py += 1) {
    for (let px = 0; px < SIZE; px += 1) {
      let nx = (px / (SIZE - 1)) * 2 - 1;
      let ny = (py / (SIZE - 1)) * 2 - 1;
      // Outside the sphere's disc, reuse its rim so filtering never pulls in
      // an unlit corner.
      const radius = Math.sqrt(nx * nx + ny * ny);
      if (radius > 0.999) {
        nx *= 0.999 / radius;
        ny *= 0.999 / radius;
      }
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      // Mirror the view direction (0, 0, 1) about the sphere normal.
      const [r, g, b] = environment(2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1);
      const i = (py * SIZE + px) * 4;
      data[i] = Math.min(255, Math.round(r));
      data[i + 1] = Math.min(255, Math.round(g));
      data[i + 2] = Math.min(255, Math.round(b));
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// One shared uniform: every reflective material samples the same image, and
// replacing `.value` re-skins all of them at once.
const reflectionUniform: { value: Texture | null } = { value: null };

// The authored reflection: a rendered chrome-ball view of a rainy neon city
// at night (generated artwork, cropped so the sphere fills the frame).
const MATCAP_MODULE = require('../../assets/3d/matcap_night.jpg');
let imageRequested = false;

// Swaps the code-generated matcap for the authored image once it is on disk.
// The same upload route @react-three/fiber/native uses for textures: expo-gl
// decodes a local file itself when handed `{ localUri }` in place of pixels
// (there is no DOM <img> to give it). If anything fails the generated matcap
// simply stays.
function requestReflectionImage(): void {
  if (imageRequested) return;
  imageRequested = true;
  Asset.fromModule(MATCAP_MODULE)
    .downloadAsync()
    .then((asset) => {
      const localUri = asset.localUri ?? asset.uri;
      if (!localUri.startsWith('file://')) return;
      const texture = new Texture();
      texture.image = { data: { localUri }, width: asset.width ?? 512, height: asset.height ?? 512 };
      // Image files are stored top row first; the lookup expects +Y up.
      texture.flipY = true;
      texture.wrapS = ClampToEdgeWrapping;
      texture.wrapT = ClampToEdgeWrapping;
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = SRGBColorSpace;
      // Routes the upload through three's raw-pixel path, which is the one
      // that forwards `image.data` to expo-gl untouched.
      (texture as unknown as { isDataTexture: boolean }).isDataTexture = true;
      texture.needsUpdate = true;
      reflectionUniform.value = texture;
    })
    .catch(() => {
      // keep the generated matcap
    });
}

function reflectionTexture(): { value: Texture | null } {
  if (!reflectionUniform.value) reflectionUniform.value = buildMatcap();
  requestReflectionImage();
  return reflectionUniform;
}

const REFLECTION_PARS = `
uniform sampler2D uReflection;
uniform float uReflectionStrength;
uniform float uReflectionBase;
`;

// Same lookup three's own MeshMatcapMaterial uses, weighted by a fresnel
// term so surfaces facing the camera keep their paint and surfaces turning
// away pick up the surroundings, like clear-coated bodywork.
const REFLECTION_LAYER = `
{
  vec3 reflN = normalize( normal );
  vec3 reflV = normalize( vViewPosition );
  vec3 reflX = normalize( vec3( reflV.z, 0.0, - reflV.x ) );
  vec3 reflY = cross( reflV, reflX );
  vec2 reflUv = vec2( dot( reflX, reflN ), dot( reflY, reflN ) ) * 0.495 + 0.5;
  float reflFresnel = pow( 1.0 - clamp( dot( reflN, reflV ), 0.0, 1.0 ), 2.5 );
  outgoingLight += texture2D( uReflection, reflUv ).rgb
    * ( uReflectionBase + ( 1.0 - uReflectionBase ) * reflFresnel ) * uReflectionStrength;
}
#include <opaque_fragment>
`;

/**
 * Adds the reflective layer to a standard material.
 * strength: overall amount. base: how much shows even face-on (0 = only at
 * grazing angles, 1 = uniform chrome).
 */
export function addReflection<T extends MeshStandardMaterial>(material: T, strength: number, base: number): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uReflection = reflectionTexture();
    shader.uniforms.uReflectionStrength = { value: strength };
    shader.uniforms.uReflectionBase = { value: base };
    shader.fragmentShader = REFLECTION_PARS + shader.fragmentShader.replace('#include <opaque_fragment>', REFLECTION_LAYER);
  };
  // Materials that share a program must agree on whether the layer exists.
  material.customProgramCacheKey = () => `reflection:${strength}:${base}`;
  return material;
}

const SHEEN_PARS = `
uniform vec3 uSheenColor;
`;

// A wet road is a poor mirror face-on and a good one at a glancing angle, so
// it brightens toward the horizon with whatever is beyond it. The surface is
// flat (one normal), which a matcap cannot shade, so this is a plain fresnel
// term tinted with the horizon glow.
const SHEEN_LAYER = `
{
  float sheen = pow( 1.0 - clamp( dot( normalize( normal ), normalize( vViewPosition ) ), 0.0, 1.0 ), 4.0 );
  outgoingLight += uSheenColor * sheen;
}
#include <opaque_fragment>
`;

/** Adds grazing-angle wet sheen to a flat standard material (the road). */
export function addWetSheen<T extends MeshStandardMaterial>(material: T, color: [number, number, number]): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSheenColor = { value: color };
    shader.fragmentShader = SHEEN_PARS + shader.fragmentShader.replace('#include <opaque_fragment>', SHEEN_LAYER);
  };
  material.customProgramCacheKey = () => 'wet-sheen';
  return material;
}
