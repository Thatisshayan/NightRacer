import { Canvas, useFrame } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { Suspense, useEffect, useRef } from 'react';
import type { MeshBasicMaterial, PerspectiveCamera as ThreePerspectiveCamera } from 'three';
import type { NativeGameEngine } from '../game/native-engine';
import { useApexNativeRenderer } from './r3f-renderer';
import { RoadSegments, type RoadMeshHandle } from './RoadMesh';
import { VehicleMesh, preloadVehicleModels, type VehicleMeshHandle } from './VehicleMesh';
import { Atmosphere } from './Atmosphere';
import { PostFX } from './PostFX';

// Base chase-cam position — see the module doc comment below for why this
// must exactly match apex-storm-renderer.ts's FreeCamera seat.
const BASE_CAMERA_X = 0;
const BASE_CAMERA_Y = 2.55;
const BASE_CAMERA_Z = -14.5;

// Matches apex-storm-renderer.ts's MAX_VEHICLE_SLOTS — a fixed pool of
// reusable meshes, hidden/shown per frame rather than created/destroyed.
const MAX_VEHICLE_SLOTS = 10;
// Slot 0 is reserved for the player; the rest are assigned to traffic below.
const MAX_TRAFFIC_SLOTS = MAX_VEHICLE_SLOTS - 1;

function SceneContent({ engine }: { engine: NativeGameEngine }) {
  const { latestFrame, latestScreenShake } = useApexNativeRenderer(engine);
  const roadHandle = useRef<RoadMeshHandle | null>(null);
  const vehicleHandles = useRef<(VehicleMeshHandle | null)[]>([]);
  const cameraHandle = useRef<ThreePerspectiveCamera | null>(null);
  const flashMaterial = useRef<MeshBasicMaterial | null>(null);
  // frame.vehicles is sorted by depth (farthest first) for draw order, not by
  // identity — indexing vehicleHandles[i] = frame.vehicles[i] directly (the
  // prior approach) meant a pool slot's occupant silently changed whenever
  // two entities crossed z-order (a different GLTF reloading into the same
  // slot), and once total tracked entities exceeded MAX_VEHICLE_SLOTS, the
  // *nearest* entities — often including the player itself — were the ones
  // sorted past the cutoff and simply never rendered. Traffic now gets a
  // stable slot by id, and overflow drops the farthest traffic instead of
  // whatever the sort order happened to exclude.
  const trafficSlotById = useRef<Map<string, number>>(new Map());
  const freeTrafficSlots = useRef<number[]>(
    Array.from({ length: MAX_TRAFFIC_SLOTS }, (_, i) => MAX_TRAFFIC_SLOTS - i),
  );

  useEffect(() => {
    preloadVehicleModels();
  }, []);

  useFrame(() => {
    const frame = latestFrame.current;
    if (!frame) return;
    roadHandle.current?.update(frame.road, frame.biome);

    const selectedCar = engine.getState().selectedCar;

    const player = frame.vehicles.find((v) => v.kind === 'player');
    vehicleHandles.current[0]?.update(player, selectedCar);

    const traffic = frame.vehicles.filter((v) => v.kind !== 'player');
    // Nearest-first: if traffic count exceeds the pool, the farthest
    // vehicles are the ones left unassigned below, not an arbitrary subset.
    traffic.sort((a, b) => b.depth - a.depth);

    const assigned = trafficSlotById.current;
    const free = freeTrafficSlots.current;
    const present = new Set<string>();
    for (const pose of traffic) {
      present.add(pose.id);
      let slot = assigned.get(pose.id);
      if (slot === undefined) {
        slot = free.pop();
        if (slot === undefined) continue; // pool exhausted this frame — farthest traffic skipped
        assigned.set(pose.id, slot);
      }
      vehicleHandles.current[slot]?.update(pose, selectedCar);
    }
    for (const [id, slot] of assigned) {
      if (!present.has(id)) {
        assigned.delete(id);
        vehicleHandles.current[slot]?.update(undefined, selectedCar);
        free.push(slot);
      }
    }

    // Camera shake + crash flash on collision — engine.ts sets screenShake
    // to 300 on a hit and decays it over time (see handleCrash()). The web
    // renderers (apex-storm-renderer.ts, pixi-renderer.ts) both surface this
    // as camera jitter + a flash; this renderer computed latestScreenShake
    // every sync() but never read it back, so hits on the native 3D
    // renderer had zero screen feedback. Formula matches
    // apex-storm-renderer.ts's sync() exactly, same deterministic
    // high-frequency noise (not Math.random) so the two renderers shake in
    // lockstep for the same input.
    const screenShake = latestScreenShake.current;
    const camera = cameraHandle.current;
    if (camera) {
      if (screenShake > 0) {
        const shake = screenShake * 0.05;
        const now = performance.now();
        camera.position.x = BASE_CAMERA_X + Math.sin(now * 0.083) * shake * 0.5;
        camera.position.y = BASE_CAMERA_Y + Math.sin(now * 0.071 + 1.7) * shake * 0.5;
        if (flashMaterial.current) flashMaterial.current.opacity = Math.min(0.8, screenShake * 0.15);
      } else {
        camera.position.x = BASE_CAMERA_X;
        camera.position.y = BASE_CAMERA_Y;
        if (flashMaterial.current) flashMaterial.current.opacity = 0;
      }
    }
  });

  return (
    // useLoader (used by VehicleMesh's GLTF loading) throws its loading
    // promise for the nearest Suspense boundary to catch — that's how R3F's
    // suspense-based loaders work. Without one here, the thrown promise
    // bubbles up as an uncaught error, which the app's root ErrorBoundary
    // then shows as "something went wrong, please reload" the instant a
    // vehicle model starts loading. fallback={null} means nothing renders
    // for the (very brief, local-asset) load instead of a spinner — road
    // and lighting are already visible from outside this boundary.
    <Suspense fallback={null}>
      {/* Deliberately shallow rear chase — mirrors apex-storm-renderer.ts's
          FreeCamera position/target exactly, so the two renderers read as
          the same world from the same seat, not two different games.
          Defined here (not via <Canvas camera={...}>) so the shake logic
          above can drive its position, and so the crash-flash plane below
          can ride along as its child instead of needing separate
          screen-space plumbing. */}
      <PerspectiveCamera
        makeDefault
        ref={cameraHandle}
        position={[BASE_CAMERA_X, BASE_CAMERA_Y, BASE_CAMERA_Z]}
        fov={47}
      >
        {/* Crash flash: a screen-filling quad pinned just past the near
            clip plane, moving with the camera. Opacity is driven from
            screenShake above (0 outside a hit); depthTest/depthWrite off
            so it always reads as an overlay, never gets occluded or
            occludes the scene behind it. */}
        <mesh position={[0, 0, -0.2]}>
          <planeGeometry args={[2, 2]} />
          <meshBasicMaterial
            ref={flashMaterial}
            color="#ff1a1a"
            transparent
            opacity={0}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      </PerspectiveCamera>
      <hemisphereLight args={['#5779a9', '#0b1728', 0.95]} />
      <directionalLight position={[-3.5, 10, 3.5]} intensity={1.35} color="#b8dcff" castShadow />
      <fog attach="fog" args={['#112941', 20, 140]} />
      <RoadSegments handleRef={roadHandle} />
      {Array.from({ length: MAX_VEHICLE_SLOTS }, (_, i) => (
        <VehicleMesh key={i} index={i} ref={(h) => { vehicleHandles.current[i] = h; }} />
      ))}
      <Atmosphere frameRef={latestFrame} />
    </Suspense>
  );
}

export function R3FGameScene({ engine }: { engine: NativeGameEngine }) {
  return (
    <Canvas gl={{ antialias: true }} shadows>
      <SceneContent engine={engine} />
      <PostFX />
    </Canvas>
  );
}
