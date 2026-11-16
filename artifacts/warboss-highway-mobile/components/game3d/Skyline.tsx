import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { AdditiveBlending, Color, DoubleSide, InstancedMesh, MeshBasicMaterial, Object3D } from 'three';
import type { Group, Texture } from 'three';
import { getGlowTexture, getWindowTexture } from './textures';
import { useTexturePack } from './texturePack';

export interface SkylineHandle {
  /** travel: world units the road surface has scrolled toward the camera. */
  update(travel: number): void;
}

const BUILDING_COUNT = 48;
// Towers are split across this many facade textures (one InstancedMesh each,
// because instancing cannot vary a texture per instance).
const FACADE_COUNT = 3;
const PER_FACADE = BUILDING_COUNT / FACADE_COUNT;
const STRIP_EVERY = 2;
const STRIP_COUNT = Math.ceil(BUILDING_COUNT / STRIP_EVERY);
const BILLBOARD_EVERY = 3;
const BILLBOARD_COUNT = Math.ceil(BUILDING_COUNT / BILLBOARD_EVERY);
const BILLBOARD_ART = 6;
// Buildings recycle along this z-band: they fade in out of the fog at the far
// end and wrap once they are safely behind the camera.
const Z_MIN = -34;
const Z_RANGE = 230;
// The road centreline wanders up to ~3.3 units and the road is 6.5 wide each
// side, so nothing may come closer than ~10.5 units to x = 0. The city is
// pressed right up to that limit: the art-direction target is a canyon of
// towers over the highway, not a skyline in the distance.
const MIN_DISTANCE = 10.8;

const NEON_COLORS = ['#ff2bd6', '#19e6ff', '#ffb347', '#ff3355', '#8a5cff'];
// Glow tint behind each billboard, matched to that artwork's dominant colour.
const BILLBOARD_GLOW = ['#ff3bd8', '#ff4fb0', '#ff3bd8', '#ff8a2a', '#27d9ff', '#9a5cff'];

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
    const distance = MIN_DISTANCE + hash(i, 1) * 22;
    const width = 7 + hash(i, 2) * 8;
    const depth = 7 + hash(i, 3) * 9;
    // Farther rows are taller, so the skyline steps up away from the road
    // instead of the nearest block hiding everything behind it.
    const height = 28 + hash(i, 4) * 34 + (distance - MIN_DISTANCE) * 1.5;
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

function place(mesh: InstancedMesh | null, index: number, dummy: Object3D): void {
  dummy.updateMatrix();
  mesh?.setMatrixAt(index, dummy.matrix);
}

function flush(mesh: InstancedMesh | null): void {
  if (mesh) mesh.instanceMatrix.needsUpdate = true;
}

function tintTowers(towers: (InstancedMesh | null)[], strips: InstancedMesh | null): void {
  const color = new Color();
  towers.forEach((mesh, facade) => {
    if (!mesh) return;
    for (let n = 0; n < PER_FACADE; n += 1) {
      // Grey tint only: the facade art carries its own colour.
      const shade = 0.7 + hash(n * FACADE_COUNT + facade, 6) * 0.3;
      mesh.setColorAt(n, color.setRGB(shade, shade, shade));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  for (let s = 0; strips && s < STRIP_COUNT; s += 1) {
    strips.setColorAt(s, color.set(NEON_COLORS[(s * 2 + 1) % NEON_COLORS.length]));
  }
  if (strips?.instanceColor) strips.instanceColor.needsUpdate = true;
}

/** One tower set sharing a facade texture. Falls back to the code-generated
 * window grid until the art pack has loaded (or if it cannot be). */
function Towers({ meshRef, facade, fallback }: { meshRef: (mesh: InstancedMesh | null) => void; facade: Texture | undefined; fallback: Texture }) {
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PER_FACADE]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      {/* key: swapping `map` from nothing to a texture needs a fresh material
          (the shader has to be rebuilt with texturing enabled). */}
      <meshStandardMaterial
        key={facade ? 'art' : 'fallback'}
        color="#ffffff"
        map={facade ?? null}
        emissive="#ffffff"
        emissiveMap={facade ?? fallback}
        emissiveIntensity={facade ? 1.5 : 1.15}
        roughness={0.85}
        metalness={0}
      />
    </instancedMesh>
  );
}

/** A giant advert screen with a soft glow behind it. */
function Billboard({ groupRef, art, glow, glowColor }: { groupRef: (group: Group | null) => void; art: Texture | undefined; glow: Texture; glowColor: string }) {
  if (!art) return null;
  return (
    <group ref={groupRef}>
      {/* Local -Z is behind the screen once the group is turned to face the
          camera. */}
      <mesh position={[0, 0, -0.3]}>
        <planeGeometry args={[1.9, 1.5]} />
        <meshBasicMaterial
          color={glowColor}
          map={glow}
          transparent
          opacity={0.5}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
        />
      </mesh>
      <mesh>
        <planeGeometry args={[1, 1]} />
        {/* Unfogged: a lit screen cuts through haze. Fogged, every advert
            beyond the nearest block faded to the same dull blue. */}
        <meshBasicMaterial map={art} toneMapped={false} fog={false} side={DoubleSide} />
      </mesh>
    </group>
  );
}

function placeBuilding(
  towers: (InstancedMesh | null)[],
  strips: InstancedMesh | null,
  beacons: InstancedMesh | null,
  dummy: Object3D,
  b: Building,
  i: number,
  z: number,
): void {
  dummy.rotation.set(0, 0, 0);
  dummy.position.set(b.x, b.height / 2, z);
  dummy.scale.set(b.width, b.height, b.depth);
  place(towers[i % FACADE_COUNT], Math.floor(i / FACADE_COUNT), dummy);

  // Aircraft-warning beacon on the roof.
  dummy.position.set(b.x, b.height + 0.4, z);
  dummy.scale.set(0.7, 0.7, 0.7);
  place(beacons, i, dummy);

  if (i % STRIP_EVERY === 0) {
    // A vertical neon tube running up the road-side corner.
    dummy.position.set(b.x - b.side * (b.width / 2 + 0.15), b.height * 0.48, z - b.depth / 2 - 0.2);
    dummy.scale.set(0.32, b.height * 0.9, 0.32);
    place(strips, i / STRIP_EVERY, dummy);
  }
}

// Billboards hang off the road-side corner of their tower, turned to face
// down the road at the oncoming camera, like the screens in the reference.
function placeBillboard(group: Group | null, b: Building, z: number): void {
  if (!group) return;
  const height = Math.min(b.height * 0.55, 22);
  group.position.set(b.x - b.side * (b.width / 2 + 0.5), Math.max(height / 2 + 5, b.height * 0.52), z - b.depth / 2 - 0.4);
  // Planes face +Z by default; turn them to face the camera (-Z), angled in
  // toward the carriageway.
  group.rotation.y = Math.PI + b.side * 0.45;
  group.scale.set(height * 0.5625, height, 1);
}

// The city the reference art is built around: a canyon of lit towers over the
// highway carrying giant advert screens. A handful of InstancedMeshes (one
// draw call each) plus a few billboard quads, recycled along z so the city
// streams past with the road.
export function Skyline({ handleRef }: { handleRef: MutableRefObject<SkylineHandle | null> }) {
  const buildings = useMemo(() => createBuildings(), []);
  const pack = useTexturePack();
  // Each useRef is its own statement on purpose. This app builds with the
  // React Compiler, which wraps an object literal in a cache check; hooks
  // called inside one only ran on the first render (React error #311).
  const towers = useRef<(InstancedMesh | null)[]>([]);
  const billboards = useRef<(Group | null)[]>([]);
  const strips = useRef<InstancedMesh>(null);
  const beacons = useRef<InstancedMesh>(null);
  const beaconMaterial = useRef<MeshBasicMaterial>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const windowMap = useMemo(() => getWindowTexture(), []);
  const glowMap = useMemo(() => getGlowTexture(), []);

  // Re-applied when the pack arrives: the towers remount with new materials.
  useEffect(() => {
    tintTowers(towers.current, strips.current);
  }, [pack]);

  handleRef.current = {
    update(travel) {
      buildings.forEach((b, i) => {
        const z = Z_MIN + ((((b.zBase - travel) % Z_RANGE) + Z_RANGE) % Z_RANGE);
        placeBuilding(towers.current, strips.current, beacons.current, dummy, b, i, z);
        if (i % BILLBOARD_EVERY === 0) placeBillboard(billboards.current[i / BILLBOARD_EVERY] ?? null, b, z);
      });
      towers.current.forEach(flush);
      flush(strips.current);
      flush(beacons.current);
      // Slow pulse, like real obstruction lights.
      const pulse = 0.3 + 0.7 * Math.max(0, Math.sin(performance.now() * 0.0032));
      beaconMaterial.current?.color.setRGB(pulse, pulse * 0.1, pulse * 0.1);
    },
  };

  return (
    <>
      {Array.from({ length: FACADE_COUNT }, (_, f) => (
        <Towers
          key={f}
          meshRef={(mesh) => { towers.current[f] = mesh; }}
          facade={pack?.get(`facade_${f + 1}`)}
          fallback={windowMap}
        />
      ))}
      {Array.from({ length: BILLBOARD_COUNT }, (_, n) => (
        <Billboard
          key={n}
          groupRef={(group) => { billboards.current[n] = group; }}
          art={pack?.get(`billboard_${(n % BILLBOARD_ART) + 1}`)}
          glow={glowMap}
          glowColor={BILLBOARD_GLOW[n % BILLBOARD_ART]}
        />
      ))}
      <instancedMesh ref={strips} args={[undefined, undefined, STRIP_COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={beacons} args={[undefined, undefined, BUILDING_COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial ref={beaconMaterial} color="#ff2a2a" toneMapped={false} />
      </instancedMesh>
    </>
  );
}
