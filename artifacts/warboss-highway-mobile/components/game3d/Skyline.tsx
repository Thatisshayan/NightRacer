import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { Color, InstancedMesh, MeshBasicMaterial, Object3D } from 'three';
import { getWindowTexture } from './textures';

export interface SkylineHandle {
  /** travel: world units the road surface has scrolled toward the camera. */
  update(travel: number): void;
}

const BUILDING_COUNT = 46;
const SIGN_EVERY = 3;
const SIGN_COUNT = Math.ceil(BUILDING_COUNT / SIGN_EVERY);
const STRIP_EVERY = 2;
const STRIP_COUNT = Math.ceil(BUILDING_COUNT / STRIP_EVERY);
// Buildings recycle along this z-band: they fade in out of the fog at the far
// end and wrap once they are safely behind the camera.
const Z_MIN = -34;
const Z_RANGE = 230;
// The road centreline wanders up to ~3.3 units and the road is 6.5 wide each
// side, so nothing may come closer than ~11 units to x = 0.
const MIN_DISTANCE = 12.5;

const NEON_COLORS = ['#ff2bd6', '#19e6ff', '#ffb347', '#ff3355', '#8a5cff'];

function hash(i: number, salt: number): number {
  const s = Math.sin(i * 91.7 + salt * 47.3) * 43758.5453;
  return s - Math.floor(s);
}

interface Building {
  side: 1 | -1;
  x: number;
  width: number;
  depth: number;
  height: number;
  zBase: number;
}

function createBuildings(): Building[] {
  return Array.from({ length: BUILDING_COUNT }, (_, i) => {
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const distance = MIN_DISTANCE + hash(i, 1) * 26;
    const width = 6 + hash(i, 2) * 8;
    const depth = 6 + hash(i, 3) * 9;
    // Farther rows are taller, so the skyline steps up away from the road
    // instead of the nearest block hiding everything behind it.
    const height = 11 + hash(i, 4) * 20 + (distance - MIN_DISTANCE) * 1.1;
    return {
      side,
      x: side * (distance + width / 2),
      width,
      depth,
      height,
      zBase: (i / BUILDING_COUNT) * Z_RANGE + hash(i, 5) * 4,
    };
  });
}

type MeshRef = RefObject<InstancedMesh | null>;

interface SkylineRefs {
  towers: MeshRef;
  signs: MeshRef;
  strips: MeshRef;
  beacons: MeshRef;
}

function place(mesh: InstancedMesh | null, index: number, dummy: Object3D): void {
  dummy.updateMatrix();
  mesh?.setMatrixAt(index, dummy.matrix);
}

function flush(mesh: InstancedMesh | null): void {
  if (mesh) mesh.instanceMatrix.needsUpdate = true;
}

function placeBuilding(refs: SkylineRefs, dummy: Object3D, b: Building, i: number, z: number): void {
  const frontZ = z - b.depth / 2 - 0.2;
  dummy.position.set(b.x, b.height / 2, z);
  dummy.scale.set(b.width, b.height, b.depth);
  place(refs.towers.current, i, dummy);

  // Aircraft-warning beacon on the roof.
  dummy.position.set(b.x, b.height + 0.4, z);
  dummy.scale.set(0.7, 0.7, 0.7);
  place(refs.beacons.current, i, dummy);

  if (i % SIGN_EVERY === 0) {
    // A lit panel on the tower's camera-facing wall. Kept small: a sign that
    // spans the wall reads as a blank coloured rectangle, not signage.
    dummy.position.set(b.x - b.side * b.width * 0.18, b.height * (0.3 + hash(i, 7) * 0.4), frontZ);
    dummy.scale.set(b.width * (0.3 + hash(i, 8) * 0.2), 1.2 + hash(i, 9) * 2.2, 0.25);
    place(refs.signs.current, i / SIGN_EVERY, dummy);
  }
  if (i % STRIP_EVERY === 0) {
    // A vertical neon tube running up the road-side corner: the cheapest
    // way to make a plain box read as a lit city tower.
    dummy.position.set(b.x - b.side * (b.width / 2 + 0.15), b.height * 0.48, frontZ);
    dummy.scale.set(0.32, b.height * 0.9, 0.32);
    place(refs.strips.current, i / STRIP_EVERY, dummy);
  }
}

function tintInstances(refs: SkylineRefs): void {
  const color = new Color();
  const towers = refs.towers.current;
  for (let i = 0; towers && i < BUILDING_COUNT; i += 1) {
    const shade = 0.7 + hash(i, 6) * 0.6;
    towers.setColorAt(i, color.setRGB(0.055 * shade, 0.085 * shade, 0.15 * shade));
  }
  const signs = refs.signs.current;
  for (let s = 0; signs && s < SIGN_COUNT; s += 1) signs.setColorAt(s, color.set(NEON_COLORS[s % NEON_COLORS.length]));
  const strips = refs.strips.current;
  for (let s = 0; strips && s < STRIP_COUNT; s += 1) {
    strips.setColorAt(s, color.set(NEON_COLORS[(s * 2 + 1) % NEON_COLORS.length]));
  }
  for (const mesh of [towers, signs, strips]) {
    if (mesh?.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

function NeonInstances({ meshRef, count }: { meshRef: MeshRef; count: number }) {
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </instancedMesh>
  );
}

// The city the reference art is built around: lit towers either side of the
// highway with neon signage. A handful of InstancedMeshes (one draw call
// each), recycled along z so the city streams past with the road.
export function Skyline({ handleRef }: { handleRef: MutableRefObject<SkylineHandle | null> }) {
  const buildings = useMemo(() => createBuildings(), []);
  const refs: SkylineRefs = {
    towers: useRef<InstancedMesh>(null),
    signs: useRef<InstancedMesh>(null),
    strips: useRef<InstancedMesh>(null),
    beacons: useRef<InstancedMesh>(null),
  };
  const beaconMaterial = useRef<MeshBasicMaterial>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const windowMap = useMemo(() => getWindowTexture(), []);

  useEffect(() => {
    tintInstances(refs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  handleRef.current = {
    update(travel) {
      buildings.forEach((b, i) => {
        const z = Z_MIN + ((((b.zBase - travel) % Z_RANGE) + Z_RANGE) % Z_RANGE);
        placeBuilding(refs, dummy, b, i, z);
      });
      flush(refs.towers.current);
      flush(refs.signs.current);
      flush(refs.strips.current);
      flush(refs.beacons.current);
      // Slow pulse, like real obstruction lights.
      const pulse = 0.3 + 0.7 * Math.max(0, Math.sin(performance.now() * 0.0032));
      beaconMaterial.current?.color.setRGB(pulse, pulse * 0.1, pulse * 0.1);
    },
  };

  return (
    <>
      <instancedMesh ref={refs.towers} args={[undefined, undefined, BUILDING_COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveMap={windowMap}
          emissiveIntensity={1.15}
          roughness={0.85}
          metalness={0}
        />
      </instancedMesh>
      <NeonInstances meshRef={refs.signs} count={SIGN_COUNT} />
      <NeonInstances meshRef={refs.strips} count={STRIP_COUNT} />
      <instancedMesh ref={refs.beacons} args={[undefined, undefined, BUILDING_COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={beaconMaterial} color="#ff2a2a" toneMapped={false} />
      </instancedMesh>
    </>
  );
}
