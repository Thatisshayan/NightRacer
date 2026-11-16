import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
} from 'three';
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
function RainField({ frameRef }: { frameRef: MutableRefObject<ApexStormFrame | null> }) {
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
    // Driving into rain: the faster the car, the more the streaks rake back
    // toward the camera instead of falling straight down.
    const rake = 0.3 + Math.min(2.4, (frameRef.current?.speed ?? 1) * 0.7);
    for (let i = 0; i < RAIN_COUNT; i += 1) {
      let top = attr.getY(i * 2) - fall;
      if (top < 0) top += RAIN_TOP;
      attr.setY(i * 2, top);
      attr.setY(i * 2 + 1, top - RAIN_STREAK);
      attr.setZ(i * 2 + 1, attr.getZ(i * 2) - rake);
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

const FAR_TOWER_COUNT = 30;

// A wall of distant towers on the horizon. They sit past the point where fog
// is total, so they render as flat haze-coloured silhouettes against the sky
// glow. Without them the sky between the nearer buildings showed as one bare
// purple rectangle that read as a blank billboard, not a sky.
function FarSkyline() {
  const mesh = useRef<InstancedMesh>(null);
  useEffect(() => {
    const towers = mesh.current;
    if (!towers) return;
    const dummy = new Object3D();
    for (let i = 0; i < FAR_TOWER_COUNT; i += 1) {
      const jitter = Math.sin(i * 12.9898) * 4;
      const height = 26 + (Math.sin(i * 78.233) * 0.5 + 0.5) * 58;
      const width = 8 + (Math.sin(i * 39.425) * 0.5 + 0.5) * 8;
      dummy.position.set((i - FAR_TOWER_COUNT / 2) * 12.5 + jitter, height / 2, 215 + (i % 3) * 9);
      dummy.scale.set(width, height, 8);
      dummy.updateMatrix();
      towers.setMatrixAt(i, dummy.matrix);
    }
    towers.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, FAR_TOWER_COUNT]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#0c1830" />
    </instancedMesh>
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
        <FarSkyline />
      </group>
      <group ref={follow}>
        <RainField frameRef={frameRef} />
      </group>
    </>
  );
}
