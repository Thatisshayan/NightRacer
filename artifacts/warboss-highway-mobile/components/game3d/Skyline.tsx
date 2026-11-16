import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { Color, InstancedMesh, Object3D } from 'three';
import { getWindowTexture } from './textures';

export interface SkylineHandle {
  /** travel: world units the road surface has scrolled toward the camera. */
  update(travel: number): void;
}

const BUILDING_COUNT = 46;
const SIGN_EVERY = 3;
const SIGN_COUNT = Math.ceil(BUILDING_COUNT / SIGN_EVERY);
// Buildings recycle along this z-band: they fade in out of the fog at the far
// end and wrap once they are safely behind the camera (z = -15.5).
const Z_MIN = -34;
const Z_RANGE = 230;
// The road centreline wanders up to ~3.3 units and the road is 6.5 wide each
// side, so nothing may come closer than ~11 units to x = 0.
const MIN_DISTANCE = 12.5;

const SIGN_COLORS = ['#ff2bd6', '#19e6ff', '#ffb347', '#ff3355', '#8a5cff'];

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

// The city the reference art is built around: lit towers either side of the
// highway with neon signage. All of it is two InstancedMeshes (one draw call
// each), recycled along z so it streams past with the road — the previous
// native scene had no world at all, just the road floating in a void.
export function Skyline({ handleRef }: { handleRef: MutableRefObject<SkylineHandle | null> }) {
  const buildings = useMemo(() => createBuildings(), []);
  const towerMesh = useRef<InstancedMesh>(null);
  const signMesh = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const windowMap = useMemo(() => getWindowTexture(), []);

  useEffect(() => {
    const towers = towerMesh.current;
    const signs = signMesh.current;
    const color = new Color();
    if (towers) {
      buildings.forEach((_, i) => {
        const shade = 0.7 + hash(i, 6) * 0.6;
        towers.setColorAt(i, color.setRGB(0.055 * shade, 0.085 * shade, 0.15 * shade));
      });
      if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
    }
    if (signs) {
      for (let s = 0; s < SIGN_COUNT; s += 1) {
        signs.setColorAt(s, color.set(SIGN_COLORS[s % SIGN_COLORS.length]));
      }
      if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
    }
  }, [buildings]);

  handleRef.current = {
    update(travel) {
      const towers = towerMesh.current;
      const signs = signMesh.current;
      if (!towers || !signs) return;
      buildings.forEach((b, i) => {
        const wrapped = (((b.zBase - travel) % Z_RANGE) + Z_RANGE) % Z_RANGE;
        const z = Z_MIN + wrapped;
        dummy.position.set(b.x, b.height / 2, z);
        dummy.scale.set(b.width, b.height, b.depth);
        dummy.updateMatrix();
        towers.setMatrixAt(i, dummy.matrix);

        if (i % SIGN_EVERY === 0) {
          // A lit panel on the tower's camera-facing wall.
          const signHeight = Math.min(b.height * 0.22, 5.5);
          dummy.position.set(b.x, b.height * (0.42 + hash(i, 7) * 0.3), z - b.depth / 2 - 0.2);
          dummy.scale.set(b.width * 0.72, signHeight, 0.25);
          dummy.updateMatrix();
          signs.setMatrixAt(i / SIGN_EVERY, dummy.matrix);
        }
      });
      towers.instanceMatrix.needsUpdate = true;
      signs.instanceMatrix.needsUpdate = true;
    },
  };

  return (
    <>
      <instancedMesh ref={towerMesh} args={[undefined, undefined, BUILDING_COUNT]} frustumCulled={false}>
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
      <instancedMesh ref={signMesh} args={[undefined, undefined, SIGN_COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
    </>
  );
}
