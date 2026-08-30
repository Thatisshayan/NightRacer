import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect, useRef } from 'react';
import type { NativeGameEngine } from '../game/native-engine';
import { useApexNativeRenderer } from './r3f-renderer';
import { RoadSegments, type RoadMeshHandle } from './RoadMesh';
import { VehicleMesh, preloadVehicleModels, type VehicleMeshHandle } from './VehicleMesh';
import { Atmosphere } from './Atmosphere';
import { PostFX } from './PostFX';

// Matches apex-storm-renderer.ts's MAX_VEHICLE_SLOTS — a fixed pool of
// reusable meshes, hidden/shown per frame rather than created/destroyed.
const MAX_VEHICLE_SLOTS = 10;
// Slot 0 is reserved for the player; the rest are assigned to traffic below.
const MAX_TRAFFIC_SLOTS = MAX_VEHICLE_SLOTS - 1;

function SceneContent({ engine }: { engine: NativeGameEngine }) {
  const { latestFrame } = useApexNativeRenderer(engine);
  const roadHandle = useRef<RoadMeshHandle | null>(null);
  const vehicleHandles = useRef<(VehicleMeshHandle | null)[]>([]);
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

// Deliberately shallow rear chase — mirrors apex-storm-renderer.ts's
// FreeCamera position/target exactly, so the two renderers read as the same
// world from the same seat, not two different games.
export function R3FGameScene({ engine }: { engine: NativeGameEngine }) {
  return (
    <Canvas
      camera={{ position: [0, 2.55, -14.5], fov: 47 }}
      gl={{ antialias: true }}
      shadows
    >
      <SceneContent engine={engine} />
      <PostFX />
    </Canvas>
  );
}
