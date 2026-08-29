import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import type { NativeGameEngine } from '../game/native-engine';
import { useApexNativeRenderer } from './r3f-renderer';
import { RoadSegments, type RoadMeshHandle } from './RoadMesh';
import { VehicleMesh, preloadVehicleModels, type VehicleMeshHandle } from './VehicleMesh';
import { Atmosphere } from './Atmosphere';
import { PostFX } from './PostFX';

// Matches apex-storm-renderer.ts's MAX_VEHICLE_SLOTS — a fixed pool of
// reusable meshes, hidden/shown per frame rather than created/destroyed.
const MAX_VEHICLE_SLOTS = 10;

function SceneContent({ engine }: { engine: NativeGameEngine }) {
  const { latestFrame } = useApexNativeRenderer(engine);
  const roadHandle = useRef<RoadMeshHandle | null>(null);
  const vehicleHandles = useRef<(VehicleMeshHandle | null)[]>([]);
  const roomEnvironment = useMemo(() => new RoomEnvironment(), []);

  useEffect(() => {
    preloadVehicleModels();
  }, []);

  useFrame(() => {
    const frame = latestFrame.current;
    if (!frame) return;
    roadHandle.current?.update(frame.road, frame.biome);

    const selectedCar = engine.getState().selectedCar;
    vehicleHandles.current.forEach((handle, index) => {
      handle?.update(frame.vehicles[index], selectedCar);
    });
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
      {/* Neutral studio reflection environment for PBR vehicle materials.
          Built entirely from three.js's bundled RoomEnvironment via drei's
          PMREM pipeline — no network fetch, no external HDRI file needed.
          A real Apex Storm-matched HDRI skybox was scoped but skipped: no
          model in the current catalog produces a genuinely seamless
          equirectangular panorama, so it would look worse than this,
          not better, for the credits it'd cost. */}
      <Environment resolution={256}>
        <primitive object={roomEnvironment} />
      </Environment>
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
