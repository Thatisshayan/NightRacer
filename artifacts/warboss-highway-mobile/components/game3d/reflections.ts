import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import type { MeshStandardMaterial, Texture } from 'three';

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

// The matcap image: a rendered chrome-ball view of a rainy neon city at night
// (generated artwork, cropped so the sphere fills the frame). It ships as raw
// RGB pixels in JSON, not as an image file: handing expo-gl a JPEG to decode
// itself was tried first and silently never arrived (verified with a probe
// build), whereas raw pixels take the same typed-array upload as every other
// texture in this scene and cannot fail to decode. Rows are stored bottom
// first, the order a GL data texture expects.
const MATCAP = require('../../assets/3d/matcap_night.json') as { size: number; rgb: string };

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decodes base64 RGB triples straight into an RGBA byte array. */
// Return type is inferred on purpose: `new Uint8Array(n)` is backed by a plain
// ArrayBuffer, which DataTexture requires; annotating it as `Uint8Array`
// widens that to ArrayBufferLike and fails the typecheck.
function decodeRgbToRgba(text: string, pixelCount: number) {
  const lookup = new Uint8Array(128);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) lookup[BASE64_ALPHABET.charCodeAt(i)] = i;
  const out = new Uint8Array(pixelCount * 4);
  // Four base64 characters carry exactly one RGB pixel (3 bytes).
  for (let p = 0; p < pixelCount; p += 1) {
    const c = p * 4;
    const a = lookup[text.charCodeAt(c)];
    const b = lookup[text.charCodeAt(c + 1)];
    const d = lookup[text.charCodeAt(c + 2)];
    const e = lookup[text.charCodeAt(c + 3)];
    out[c] = (a << 2) | (b >> 4);
    out[c + 1] = ((b & 15) << 4) | (d >> 2);
    out[c + 2] = ((d & 3) << 6) | e;
    out[c + 3] = 255;
  }
  return out;
}

function buildMatcap(): DataTexture {
  const size = MATCAP.size;
  const texture = new DataTexture(decodeRgbToRgba(MATCAP.rgb, size * size), size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// One shared uniform: every reflective material samples the same image.
const reflectionUniform: { value: Texture | null } = { value: null };

function reflectionTexture(): { value: Texture | null } {
  if (!reflectionUniform.value) reflectionUniform.value = buildMatcap();
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
