import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { CAR_STATS } from '@workspace/game-core';
import type { NativeGameEngine } from '../game/native-engine';
import { useApexNativeRenderer } from './r3f-renderer';
import { RoadSegments, type RoadMeshHandle } from './RoadMesh';
import { VehicleMesh, type VehicleMeshHandle } from './VehicleMesh';
import { Atmosphere } from './Atmosphere';
import { PostFX } from './PostFX';

// Matches apex-storm-renderer.ts's MAX_VEHICLE_SLOTS — a fixed pool of
// reusable meshes, hidden/shown per frame rather than created/destroyed.
const MAX_VEHICLE_SLOTS = 10;

function SceneContent({ engine }: { engine: NativeGameEngine }) {
  const { latestFrame } = useApexNativeRenderer(engine);
  const roadHandle = useRef<RoadMeshHandle | null>(null);
  const vehicleHandles = useRef<(VehicleMeshHandle | null)[]>([]);

  useFrame(() => {
    const frame = latestFrame.current;
    if (!frame) return;
    roadHandle.current?.update(frame.road, frame.biome);

    const selectedColor = CAR_STATS[engine.getState().selectedCar].color;
    vehicleHandles.current.forEach((handle, index) => {
      handle?.update(frame.vehicles[index], selectedColor);
    });
  });

  return (
    <>
      <hemisphereLight args={['#5779a9', '#0b1728', 0.95]} />
      <directionalLight position={[-3.5, 10, 3.5]} intensity={1.35} color="#b8dcff" castShadow />
      <fog attach="fog" args={['#112941', 20, 140]} />
      <RoadSegments handleRef={roadHandle} />
      {Array.from({ length: MAX_VEHICLE_SLOTS }, (_, i) => (
        <VehicleMesh key={i} index={i} ref={(h) => { vehicleHandles.current[i] = h; }} />
      ))}
      <Atmosphere frameRef={latestFrame} />
    </>
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
