import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { AdditiveBlending, Color, DoubleSide, InstancedMesh, Object3D } from 'three';
import { APEX_STORM_ROAD, sampleApexRoad } from '@workspace/render-frame';
import { getGlowTexture } from './textures';

export interface RoadsideHandle {
  update(roadPhase: number, travel: number): void;
}

const HALF_WIDTH = APEX_STORM_ROAD.halfWidth;

// --- Street lamps ----------------------------------------------------------
const LAMPS_PER_SIDE = 14;
const LAMP_COUNT = LAMPS_PER_SIDE * 2;
const LAMP_SPACING = 18;
const LAMP_Z_MIN = -22;
const LAMP_Z_RANGE = LAMPS_PER_SIDE * LAMP_SPACING;
const POST_HEIGHT = 5.2;
const POST_OFFSET = HALF_WIDTH + 1.1;
const POOL_OFFSET = HALF_WIDTH - 1.7;

// --- Reflector studs on the barriers ---------------------------------------
const STUDS_PER_SIDE = 36;
const STUD_COUNT = STUDS_PER_SIDE * 2;
const STUD_SPACING = 6;
const STUD_Z_MIN = -22;
const STUD_Z_RANGE = STUDS_PER_SIDE * STUD_SPACING;

// --- Overhead sign gantries -------------------------------------------------
const GANTRY_COUNT = 2;
const GANTRY_SPACING = 170;
const GANTRY_Z_MIN = -30;
const GANTRY_Z_RANGE = GANTRY_COUNT * GANTRY_SPACING;
const GANTRY_HEIGHT = 8.4;
const GANTRY_SIGN_COLORS = ['#0f8a63', '#1560b8'];

const wrap = (value: number, range: number) => ((value % range) + range) % range;
// X is negated: frame coordinates are left-handed, three.js is right-handed.
// See toSceneX in R3FGameScene.tsx.
const centreAt = (z: number, roadPhase: number) => -sampleApexRoad(z, roadPhase).x;

type MeshRef = RefObject<InstancedMesh | null>;

interface LampRefs {
  posts: MeshRef;
  heads: MeshRef;
  halos: MeshRef;
  pools: MeshRef;
  streaks: MeshRef;
}

function place(mesh: InstancedMesh | null, index: number, dummy: Object3D): void {
  dummy.updateMatrix();
  mesh?.setMatrixAt(index, dummy.matrix);
}

function flush(mesh: InstancedMesh | null): void {
  if (mesh) mesh.instanceMatrix.needsUpdate = true;
}

// Street lamps along both verges. Each throws a pool of light onto the wet
// road and a long reflection streak toward the camera, with a soft halo
// around the head standing in for bloom (expo-gl cannot run a real bloom
// pass; see PostFX.tsx).
function placeLamps(refs: LampRefs, dummy: Object3D, roadPhase: number, travel: number): void {
  for (let i = 0; i < LAMP_COUNT; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    // Stagger the two sides by half a spacing so lamps alternate.
    const base = Math.floor(i / 2) * LAMP_SPACING + (side === 1 ? 0 : LAMP_SPACING / 2);
    const z = LAMP_Z_MIN + wrap(base - travel, LAMP_Z_RANGE);
    const centre = centreAt(z, roadPhase);
    const postX = centre + side * POST_OFFSET;
    const headX = postX - side * 0.9;

    dummy.rotation.set(0, 0, 0);
    dummy.position.set(postX, POST_HEIGHT / 2, z);
    dummy.scale.set(0.16, POST_HEIGHT, 0.16);
    place(refs.posts.current, i, dummy);

    // Lamp head on an arm reaching out over the carriageway.
    dummy.position.set(headX, POST_HEIGHT, z);
    dummy.scale.set(1.8, 0.14, 0.36);
    place(refs.heads.current, i, dummy);

    dummy.position.set(headX, POST_HEIGHT - 0.1, z - 0.3);
    dummy.scale.set(4.2, 4.2, 1);
    place(refs.halos.current, i, dummy);

    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.position.set(centre + side * POOL_OFFSET, 0.02, z);
    dummy.scale.set(7, 8, 1);
    place(refs.pools.current, i, dummy);

    dummy.position.set(centre + side * POOL_OFFSET, 0.025, z - 7);
    dummy.scale.set(2.2, 20, 1);
    place(refs.streaks.current, i, dummy);
  }
  flush(refs.posts.current);
  flush(refs.heads.current);
  flush(refs.halos.current);
  flush(refs.pools.current);
  flush(refs.streaks.current);
}

// Amber reflectors along the top of both barriers. At speed they are the
// densest moving reference in the frame.
function placeStuds(mesh: InstancedMesh | null, dummy: Object3D, roadPhase: number, travel: number): void {
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(0.2, 0.2, 0.55);
  for (let i = 0; i < STUD_COUNT; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const z = STUD_Z_MIN + wrap(Math.floor(i / 2) * STUD_SPACING - travel, STUD_Z_RANGE);
    dummy.position.set(centreAt(z, roadPhase) + side * (HALF_WIDTH + 0.12), 0.74, z);
    place(mesh, i, dummy);
  }
  flush(mesh);
}

// Overhead sign gantries spanning the carriageway. Driving under one is the
// clearest sense-of-scale and sense-of-speed beat on a highway.
function placeGantries(
  frames: InstancedMesh | null,
  signs: InstancedMesh | null,
  dummy: Object3D,
  roadPhase: number,
  travel: number,
): void {
  dummy.rotation.set(0, 0, 0);
  for (let g = 0; g < GANTRY_COUNT; g += 1) {
    const z = GANTRY_Z_MIN + wrap(g * GANTRY_SPACING - travel, GANTRY_Z_RANGE);
    const centre = centreAt(z, roadPhase);
    const legX = HALF_WIDTH + 1.6;
    for (const side of [-1, 1]) {
      dummy.position.set(centre + side * legX, GANTRY_HEIGHT / 2, z);
      dummy.scale.set(0.5, GANTRY_HEIGHT, 0.5);
      place(frames, g * 3 + (side === -1 ? 0 : 1), dummy);
      // One sign panel over each carriageway half.
      dummy.position.set(centre + side * 3.4, GANTRY_HEIGHT + 1.5, z - 0.3);
      dummy.scale.set(5.2, 2.3, 0.2);
      place(signs, g * 2 + (side === -1 ? 0 : 1), dummy);
    }
    dummy.position.set(centre, GANTRY_HEIGHT, z);
    dummy.scale.set(legX * 2 + 0.5, 0.6, 0.6);
    place(frames, g * 3 + 2, dummy);
  }
  flush(frames);
  flush(signs);
}

function GlowInstances({ meshRef, count, color, opacity }: { meshRef: MeshRef; count: number; color: string; opacity: number }) {
  const map = useMemo(() => getGlowTexture(), []);
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        color={color}
        map={map}
        transparent
        opacity={opacity}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
        side={DoubleSide}
      />
    </instancedMesh>
  );
}

function BoxInstances({ meshRef, count, color, lit }: { meshRef: MeshRef; count: number; color: string; lit?: boolean }) {
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={color} toneMapped={!lit} />
    </instancedMesh>
  );
}

// Everything that lines the road and streams past with `travel`. Without it
// the only thing that visibly moved was the lane paint.
export function Roadside({ handleRef }: { handleRef: MutableRefObject<RoadsideHandle | null> }) {
  // Each useRef is its own statement on purpose. This app builds with the
  // React Compiler, which wraps an object literal in a cache check; hooks
  // called inside one only ran on the first render (React error #311).
  const posts = useRef<InstancedMesh>(null);
  const heads = useRef<InstancedMesh>(null);
  const halos = useRef<InstancedMesh>(null);
  const pools = useRef<InstancedMesh>(null);
  const streaks = useRef<InstancedMesh>(null);
  const lamps: LampRefs = { posts, heads, halos, pools, streaks };
  const studs = useRef<InstancedMesh>(null);
  const gantryFrames = useRef<InstancedMesh>(null);
  const gantrySigns = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);

  useEffect(() => {
    const signs = gantrySigns.current;
    if (!signs) return;
    const color = new Color();
    for (let i = 0; i < GANTRY_COUNT * 2; i += 1) {
      signs.setColorAt(i, color.set(GANTRY_SIGN_COLORS[i % GANTRY_SIGN_COLORS.length]));
    }
    if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
  }, []);

  handleRef.current = {
    update(roadPhase, travel) {
      placeLamps(lamps, dummy, roadPhase, travel);
      placeStuds(studs.current, dummy, roadPhase, travel);
      placeGantries(gantryFrames.current, gantrySigns.current, dummy, roadPhase, travel);
    },
  };

  return (
    <>
      <BoxInstances meshRef={lamps.posts} count={LAMP_COUNT} color="#46587a" />
      <BoxInstances meshRef={lamps.heads} count={LAMP_COUNT} color="#ffe2b0" lit />
      <GlowInstances meshRef={lamps.halos} count={LAMP_COUNT} color="#ffd29a" opacity={0.42} />
      <GlowInstances meshRef={lamps.pools} count={LAMP_COUNT} color="#ffc98a" opacity={0.3} />
      <GlowInstances meshRef={lamps.streaks} count={LAMP_COUNT} color="#ffc98a" opacity={0.2} />
      <BoxInstances meshRef={studs} count={STUD_COUNT} color="#ffb347" lit />
      <BoxInstances meshRef={gantryFrames} count={GANTRY_COUNT * 3} color="#3a4866" />
      <BoxInstances meshRef={gantrySigns} count={GANTRY_COUNT * 2} color="#ffffff" lit />
    </>
  );
}
