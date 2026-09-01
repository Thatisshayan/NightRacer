import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import type { CarType } from '@workspace/game-core';
import { VehicleModel, type ModelKey } from './VehicleMesh';

// Slow continuous turntable, same idea as a dealership showroom spin — gives
// the title screen's car card real motion instead of a flat printed panel,
// using the actual GLB (same asset the in-game renderer draws) rather than a
// second, separate piece of 2D art that could visually drift from it.
function Spinner({ modelKey }: { modelKey: ModelKey }) {
  const group = useRef<Group>(null);
  // Resets the visible spin to the same starting angle on every car change,
  // without needing to remount the whole <Canvas> (see CarPreview3D below).
  useEffect(() => {
    if (group.current) group.current.rotation.y = 0;
  }, [modelKey]);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.5;
  });
  return (
    <group ref={group} rotation={[0.1, 0, 0]}>
      <VehicleModel modelKey={modelKey} />
    </group>
  );
}

// carType doubles as a ModelKey: VehicleMesh's MODEL_MODULES map is keyed by
// every CarType plus the traffic/BOSS types, so the 5 selectable player cars
// are a subset that resolves directly with no lookup table needed.
export function CarPreview3D({ carType, size }: { carType: CarType; size: number }) {
  return (
    <Canvas
      style={{ width: size, height: size }}
      camera={{ position: [1.6, 0.85, 1.9], fov: 32 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ camera }) => {
        // Default three.js camera looks down -Z, but the grounded model sits
        // at the origin (z=0) which is behind that view — the spinning car
        // card rendered empty. Aim at the normalized model's center instead.
        camera.lookAt(0, 0.5, 0);
      }}
    >
      <Suspense fallback={null}>
        <hemisphereLight args={['#5779a9', '#0b1728', 1.1]} />
        <directionalLight position={[-2, 3, 2]} intensity={1.5} color="#ffe9c7" />
        <directionalLight position={[2, 1.5, -2]} intensity={0.4} color="#4fb9ff" />
        <Spinner modelKey={carType} />
      </Suspense>
    </Canvas>
  );
}
