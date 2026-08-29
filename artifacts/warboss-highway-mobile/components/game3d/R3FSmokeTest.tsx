import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';

function SpinningCube() {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta;
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#27d9ff" />
    </mesh>
  );
}

// Standalone proof that expo-gl + @react-three/fiber renders at all on a
// given device before any real scene code depends on it. Kept in the repo
// (not deleted after first use) as a fast re-check if these dependency
// versions ever change and something in the GL pipeline breaks.
export function R3FSmokeTest() {
  return (
    <Canvas camera={{ position: [0, 0, 3] }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 2, 2]} intensity={1.2} />
      <SpinningCube />
    </Canvas>
  );
}
