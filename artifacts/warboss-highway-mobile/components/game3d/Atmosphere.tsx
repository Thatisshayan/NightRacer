import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Group, MeshBasicMaterial } from 'three';
import type { ApexStormFrame } from '@workspace/render-frame';
import { getSkyTexture } from './textures';

const RAIN_COUNT = 320;
const RAIN_TOP = 26;
const RAIN_FALL_SPEED = 42;
const RAIN_STREAK = 1.25;

// Rain as short slanted line streaks. The previous version drew gl.POINTS,
// which expo-gl rasterises as fat screen-space squares — it read as a field
// of blocky "stars" hanging in the sky, not weather. One never-recreated
// LineSegments buffer, recycled top-to-bottom.
function RainField() {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    const positions = new Float32Array(RAIN_COUNT * 2 * 3);
    // Deterministic (not Math.random) spread across the rain volume — this
    // is cosmetic placement, but a fixed hash-based spread keeps repeated
    // captures reproducible and satisfies the weak-RNG lint rule.
    for (let i = 0; i < RAIN_COUNT; i += 1) {
      const x = Math.sin(i * 12.9898) * 17;
      const y = (Math.sin(i * 78.233) * 0.5 + 0.5) * RAIN_TOP;
      const z = (Math.sin(i * 39.425) * 0.5 + 0.5) * 60 - 12;
      positions.set([x, y, z, x - 0.14, y - RAIN_STREAK, z - 0.3], i * 6);
    }
    const attribute = new BufferAttribute(positions, 3);
    attribute.setUsage(DynamicDrawUsage);
    g.setAttribute('position', attribute);
    return g;
  }, []);

  useFrame((_, delta) => {
    const attr = geometry.getAttribute('position') as BufferAttribute;
    // Clamp the step so a long frame (app resumed from background) can't
    // teleport every streak below the ground at once.
    const fall = Math.min(delta, 0.05) * RAIN_FALL_SPEED;
    for (let i = 0; i < RAIN_COUNT; i += 1) {
      let top = attr.getY(i * 2) - fall;
      if (top < 0) top += RAIN_TOP;
      attr.setY(i * 2, top);
      attr.setY(i * 2 + 1, top - RAIN_STREAK);
    }
    attr.needsUpdate = true;
  });

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#a9c9ff" transparent opacity={0.34} depthWrite={false} />
    </lineSegments>
  );
}

// Sky backdrop: a vertical gradient (horizon haze -> city glow -> night) on a
// plane far behind everything. Its bottom band is exactly the fog colour, so
// fogged-out road and towers melt into it with no seam. Not fogged itself.
function SkyBackdrop({ frameRef }: { frameRef: MutableRefObject<ApexStormFrame | null> }) {
  const material = useRef<MeshBasicMaterial>(null);
  const map = useMemo(() => getSkyTexture(), []);
  useFrame(() => {
    // Lightning lifts the whole sky for the length of the flash.
    const flash = frameRef.current?.lightningIntensity ?? 0;
    material.current?.color.setScalar(1 + flash * 1.6);
  });
  return (
    <mesh position={[0, 110, 262]}>
      <planeGeometry args={[760, 260]} />
      <meshBasicMaterial ref={material} map={map} fog={false} side={DoubleSide} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// The tunnel biome (ribs, steam vents) is intentionally not rendered here —
// see Task 6 of the implementation plan
// (docs/superpowers/plans/2026-08-28-r3f-native-3d-renderer.md). Rain
// therefore stays on for the whole run rather than cutting out over a road
// that still looks like open highway.
export function Atmosphere({
  frameRef,
  cameraXRef,
}: {
  frameRef: MutableRefObject<ApexStormFrame | null>;
  cameraXRef: MutableRefObject<number | null>;
}) {
  const follow = useRef<Group>(null);
  const sky = useRef<Group>(null);
  // The rain volume and backdrop ride with the camera's lateral follow so the
  // player never drives out from under the rain or past the edge of the sky.
  useFrame(() => {
    const x = cameraXRef.current ?? 0;
    if (follow.current) follow.current.position.x = x;
    if (sky.current) sky.current.position.x = x;
  });
  return (
    <>
      <group ref={sky}>
        <SkyBackdrop frameRef={frameRef} />
      </group>
      <group ref={follow}>
        <RainField />
      </group>
    </>
  );
}
