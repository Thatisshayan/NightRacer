import { useEffect, useState } from 'react';
import { Asset } from 'expo-asset';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Mesh, MeshStandardMaterial, Object3D, Texture } from 'three';

// Authored 2D art for the city (billboards, building facades, sky), shipped
// as textures inside one GLB.
//
// Why a GLB: there is no DOM <img> on expo-gl, and handing it a loose image
// file to decode silently failed (see reflections.ts). Textures embedded in a
// GLB go through GLTFLoader and @react-three/fiber's native texture loader,
// the same route the vehicle models' paint takes, which is proven on device.
// The pack is built by scripts/build_texture_pack.py: one throwaway triangle
// per image, with the image as that triangle's material base-colour texture
// and the material name as the lookup key.
const PACK_MODULE = require('../../assets/3d/city_pack.glb');

export type TexturePack = ReadonlyMap<string, Texture>;

let pending: Promise<TexturePack> | null = null;

function collect(scene: Object3D): TexturePack {
  const pack = new Map<string, Texture>();
  scene.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as MeshStandardMaterial;
    const texture = material.map;
    if (!texture) return;
    // glTF puts the UV origin at the top-left; three's own box and plane
    // geometries put it at the bottom-left. Flipping V here lets the textures
    // be used on ordinary three geometry the right way up.
    texture.repeat.set(1, -1);
    texture.offset.set(0, 1);
    pack.set(material.name, texture);
  });
  return pack;
}

/** Loads the pack once. Resolves to an empty pack if it cannot be loaded, so
 * callers fall back to their untextured look instead of failing. */
export function loadTexturePack(): Promise<TexturePack> {
  if (!pending) {
    pending = Asset.fromModule(PACK_MODULE)
      .downloadAsync()
      .then((asset) => new GLTFLoader().loadAsync(asset.localUri ?? asset.uri))
      .then((gltf) => collect(gltf.scene))
      .catch(() => new Map<string, Texture>());
  }
  return pending;
}

/** The pack once it has loaded, or null until then. */
export function useTexturePack(): TexturePack | null {
  const [pack, setPack] = useState<TexturePack | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadTexturePack().then((loaded) => {
      if (!cancelled) setPack(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return pack;
}
