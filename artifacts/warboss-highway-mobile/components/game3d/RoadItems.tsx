import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { AdditiveBlending, DoubleSide } from 'three';
import type { Group, Mesh, MeshBasicMaterial, Texture } from 'three';
import type { ApexItemPose } from '@workspace/render-frame';
import { getGlowTexture } from './textures';

export interface RoadItemsHandle {
  update(items: readonly ApexItemPose[]): void;
}

// The engine keeps only a handful of power-ups and obstacles alive at once.
const MAX_ITEMS = 8;

const POWERUP_COLORS: Record<string, string> = {
  SHIELD: '#27d9ff',
  SLOWMO: '#b06bff',
  SCORE_BLAST: '#ffd21a',
  EXTRA_LIFE: '#ff3b6b',
};

const GLOW = { transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide };
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0];

type Apply = (pose: ApexItemPose | undefined) => void;

/** A floating gem in the power-up's colour, with a halo, a pool of light on
 * the road and a beam so it can be read from far up the road. */
function PowerUpVisual({ groupRef, gemRef, tint, glow }: {
  groupRef: MutableRefObject<Group | null>;
  gemRef: MutableRefObject<Mesh | null>;
  tint: (material: MeshBasicMaterial | null) => void;
  glow: Texture;
}) {
  return (
    <group ref={groupRef}>
      <mesh ref={gemRef} position={[0, 1.1, 0]}>
        <octahedronGeometry args={[0.5, 0]} />
        <meshBasicMaterial ref={tint} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.1, 0.2]}>
        <planeGeometry args={[2.8, 2.8]} />
        <meshBasicMaterial ref={tint} map={glow} opacity={0.75} {...GLOW} />
      </mesh>
      <mesh position={[0, 3.4, 0.25]}>
        <planeGeometry args={[0.5, 6.4]} />
        <meshBasicMaterial ref={tint} map={glow} opacity={0.4} {...GLOW} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={FLAT}>
        <planeGeometry args={[3.4, 3.4]} />
        <meshBasicMaterial ref={tint} map={glow} opacity={0.55} {...GLOW} />
      </mesh>
    </group>
  );
}

/** Oil: a black patch with an iridescent film. The film is what makes it
 * readable; black on night asphalt is invisible. Unit-sized, scaled per pose. */
function OilVisual({ groupRef, glow }: { groupRef: MutableRefObject<Group | null>; glow: Texture }) {
  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.03, 0]} rotation={FLAT} renderOrder={1}>
        <circleGeometry args={[0.5, 20]} />
        <meshBasicMaterial color="#020204" transparent opacity={0.92} depthWrite={false} />
      </mesh>
      <mesh position={[-0.08, 0.04, 0.05]} rotation={FLAT} renderOrder={2}>
        <planeGeometry args={[1.1, 1.1]} />
        <meshBasicMaterial color="#3cffb0" map={glow} opacity={0.42} {...GLOW} />
      </mesh>
      <mesh position={[0.12, 0.045, -0.06]} rotation={FLAT} renderOrder={3}>
        <planeGeometry args={[0.9, 0.9]} />
        <meshBasicMaterial color="#c24bff" map={glow} opacity={0.5} {...GLOW} />
      </mesh>
    </group>
  );
}

/** Debris: wreckage in hazard colours over an amber warning glow. */
function DebrisVisual({ groupRef, glow }: { groupRef: MutableRefObject<Group | null>; glow: Texture }) {
  return (
    <group ref={groupRef}>
      <mesh position={[-0.22, 0.2, 0]} rotation={[0.2, 0.5, 0.3]}>
        <boxGeometry args={[0.5, 0.36, 0.42]} />
        <meshBasicMaterial color="#ff7a1a" toneMapped={false} />
      </mesh>
      <mesh position={[0.24, 0.16, 0.12]} rotation={[0.4, -0.7, 0.1]}>
        <boxGeometry args={[0.4, 0.28, 0.5]} />
        <meshBasicMaterial color="#ffd21a" toneMapped={false} />
      </mesh>
      <mesh position={[0.02, 0.34, -0.16]} rotation={[0.7, 0.2, 0.6]}>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshBasicMaterial color="#aeb4c4" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={FLAT}>
        <planeGeometry args={[3, 3]} />
        <meshBasicMaterial color="#ff8a2a" map={glow} opacity={0.6} {...GLOW} />
      </mesh>
    </group>
  );
}

/** One reusable slot holding all three looks; a pose picks which is shown. */
function ItemSlot({ register, glow }: { register: (apply: Apply) => void; glow: Texture }) {
  const root = useRef<Group | null>(null);
  const powerUp = useRef<Group | null>(null);
  const gem = useRef<Mesh | null>(null);
  const oil = useRef<Group | null>(null);
  const debris = useRef<Group | null>(null);
  const tinted = useRef<Set<MeshBasicMaterial>>(new Set());
  const tint = (material: MeshBasicMaterial | null) => {
    if (material) tinted.current.add(material);
  };

  register((pose) => {
    if (!root.current) return;
    root.current.visible = pose !== undefined && pose.alpha > 0.02;
    if (!pose) return;
    // X is negated: frame coordinates are left-handed. See toSceneX in
    // R3FGameScene.tsx.
    root.current.position.set(-pose.x, 0, pose.z);
    const color = POWERUP_COLORS[pose.type];
    if (powerUp.current) powerUp.current.visible = color !== undefined;
    if (oil.current) {
      oil.current.visible = pose.type === 'OIL_SLICK';
      oil.current.scale.set(pose.width, 1, Math.max(pose.length, pose.width * 0.8));
    }
    if (debris.current) {
      debris.current.visible = pose.type === 'DEBRIS';
      debris.current.scale.setScalar(pose.width);
    }
    if (color === undefined) return;
    tinted.current.forEach((material) => material.color.set(color));
    const now = performance.now();
    if (gem.current) {
      gem.current.rotation.y = now * 0.004;
      gem.current.position.y = 1.1 + Math.sin(now * 0.005) * 0.14;
    }
  });

  return (
    <group ref={root} visible={false}>
      <PowerUpVisual groupRef={powerUp} gemRef={gem} tint={tint} glow={glow} />
      <OilVisual groupRef={oil} glow={glow} />
      <DebrisVisual groupRef={debris} glow={glow} />
    </group>
  );
}

// Power-ups and obstacles. Until this existed the 3D scene drew vehicles
// only, while the simulation went on spawning and colliding with oil, debris
// and power-ups: players lost lives to hazards that were never on screen.
export function RoadItems({ handleRef }: { handleRef: MutableRefObject<RoadItemsHandle | null> }) {
  const glow = useMemo(() => getGlowTexture(), []);
  const slots = useRef<Apply[]>([]);

  handleRef.current = {
    update(items) {
      for (let i = 0; i < MAX_ITEMS; i += 1) slots.current[i]?.(items[i]);
    },
  };

  return (
    <>
      {Array.from({ length: MAX_ITEMS }, (_, i) => (
        <ItemSlot key={i} register={(apply) => { slots.current[i] = apply; }} glow={glow} />
      ))}
    </>
  );
}
