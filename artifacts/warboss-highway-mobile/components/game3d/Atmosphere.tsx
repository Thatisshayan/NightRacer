import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { AdditiveBlending, BufferAttribute, Points, PointLight } from 'three';
import type { ApexStormFrame } from '@workspace/render-frame';

const RAIN_COUNT = 800;

// A single, never-recreated point cloud, recycled top-to-bottom like a
// particle emitter — mirrors apex-storm-renderer.ts's ParticleSystem, just
// hand-rolled since expo-gl's WebGL2 support doesn't cover every Three.js
// GPU-particle extension a desktop browser gets.
function RainField({ frameRef }: { frameRef: MutableRefObject<ApexStormFrame | null> }) {
  const points = useRef<Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(RAIN_COUNT * 3);
    for (let i = 0; i < RAIN_COUNT; i += 1) {
      arr[i * 3] = (Math.random() - 0.5) * 30;
      arr[i * 3 + 1] = Math.random() * 15 + 2;
      arr[i * 3 + 2] = Math.random() * 60 - 10;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    const frame = frameRef.current;
    const geometry = points.current?.geometry;
    if (!geometry || !frame) return;
    const isRaining = frame.biome !== 'tunnel';
    if (points.current) points.current.visible = isRaining;
    if (!isRaining) return;
    const attr = geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < RAIN_COUNT; i += 1) {
      let y = attr.getY(i) - delta * 28;
      if (y < 0) y = 15;
      attr.setY(i, y);
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#a8d8ff" size={0.08} transparent opacity={0.55} blending={AdditiveBlending} />
    </points>
  );
}

function LightningFlash({ frameRef }: { frameRef: MutableRefObject<ApexStormFrame | null> }) {
  const light = useRef<PointLight>(null);
  useFrame(() => {
    const frame = frameRef.current;
    if (!light.current || !frame) return;
    light.current.intensity = frame.lightningIntensity * 12;
  });
  return <pointLight ref={light} position={[0, 10, 30]} color="#d7f5ff" intensity={0} />;
}

// Neon billboards and the concrete tunnel biome (ribs, steam vents) are
// intentionally deferred here — see Task 6 of the implementation plan
// (docs/superpowers/plans/2026-08-28-r3f-native-3d-renderer.md): their
// placement should be tuned against a real on-device screenshot with this
// camera's actual FOV, not guessed from the web renderer's different
// Babylon camera framing.
export function Atmosphere({ frameRef }: { frameRef: MutableRefObject<ApexStormFrame | null> }) {
  return (
    <>
      <RainField frameRef={frameRef} />
      <LightningFlash frameRef={frameRef} />
    </>
  );
}
