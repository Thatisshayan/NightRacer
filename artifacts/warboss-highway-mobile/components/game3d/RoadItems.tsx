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

type Vec3 = [number, number, number];

// Unfogged: a pickup has to be readable from the far end of the road, which
// is exactly where fog would otherwise swallow it.
const GLOW = { transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, fog: false, side: DoubleSide };
const FLAT: Vec3 = [-Math.PI / 2, 0, 0];
const GEM_HEIGHT = 1.35;

type Apply = (pose: ApexItemPose | undefined) => void;

interface VisualProps {
  groupRef: MutableRefObject<Group | null>;
  glow: Texture;
}

interface PowerUpProps extends VisualProps {
  gemRef: MutableRefObject<Mesh | null>;
  tint: Tint;
}

interface SlotProps {
  register: (apply: Apply) => void;
  glow: Texture;
}

type Tint = (material: MeshBasicMaterial | null) => void;

interface GlowSpec {
  position: Vec3;
  size: [number, number];
  opacity: number;
  /** Fixed colour; omitted = tinted with the power-up's colour. */
  color?: string;
  flat?: boolean;
}

// White-hot core, wide halo, tall beam and a pool of light on the road.
const POWERUP_GLOWS: GlowSpec[] = [
  { position: [0, GEM_HEIGHT, 0.15], size: [2.2, 2.2], opacity: 0.9, color: '#ffffff' },
  { position: [0, GEM_HEIGHT, 0.2], size: [6, 6], opacity: 1 },
  { position: [0, 5.5, 0.25], size: [1.3, 11], opacity: 0.8 },
  { position: [0, 0.05, 0], size: [5.5, 5.5], opacity: 0.9, flat: true },
];
// The iridescent film is what makes oil readable; black on night asphalt is
// invisible.
const OIL_GLOWS: GlowSpec[] = [
  { position: [-0.08, 0.04, 0.05], size: [1.1, 1.1], opacity: 0.75, color: '#3cffb0', flat: true },
  { position: [0.12, 0.045, -0.06], size: [0.9, 0.9], opacity: 0.85, color: '#c24bff', flat: true },
];
const DEBRIS_GLOWS: GlowSpec[] = [{ position: [0, 0.05, 0], size: [5, 5], opacity: 0.95, color: '#ff8a2a', flat: true }];
// Wreckage in hazard colours: position, rotation, size, colour.
const DEBRIS_BOXES: [Vec3, Vec3, Vec3, string][] = [
  [[-0.22, 0.2, 0], [0.2, 0.5, 0.3], [0.5, 0.36, 0.42], '#ff7a1a'],
  [[0.24, 0.16, 0.12], [0.4, -0.7, 0.1], [0.4, 0.28, 0.5], '#ffd21a'],
  [[0.02, 0.34, -0.16], [0.7, 0.2, 0.6], [0.3, 0.3, 0.3], '#aeb4c4'],
];

interface GlowsProps {
  specs: GlowSpec[];
  glow: Texture;
  tint?: Tint;
}

const UPRIGHT: Vec3 = [0, 0, 0];

function Glows({ specs, glow, tint }: GlowsProps) {
  return (
    <>
      {specs.map((spec, i) => (
        <mesh key={i} position={spec.position} rotation={spec.flat ? FLAT : UPRIGHT} renderOrder={i + 2}>
          <planeGeometry args={spec.size} />
          <meshBasicMaterial ref={spec.color ? undefined : tint} color={spec.color ?? '#ffffff'} map={glow} opacity={spec.opacity} {...GLOW} />
        </mesh>
      ))}
    </>
  );
}

/** A floating gem in the power-up's colour. */
function PowerUpVisual({ groupRef, gemRef, tint, glow }: PowerUpProps) {
  return (
    <group ref={groupRef}>
      <mesh ref={gemRef} position={[0, GEM_HEIGHT, 0]}>
        <octahedronGeometry args={[0.72, 0]} />
        <meshBasicMaterial ref={tint} toneMapped={false} fog={false} />
      </mesh>
      <Glows specs={POWERUP_GLOWS} glow={glow} tint={tint} />
    </group>
  );
}

/** Oil: a black patch under an iridescent film. Unit-sized, scaled per pose. */
function OilVisual({ groupRef, glow }: VisualProps) {
  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.03, 0]} rotation={FLAT} renderOrder={1}>
        <circleGeometry args={[0.5, 20]} />
        <meshBasicMaterial color="#020204" transparent opacity={0.92} depthWrite={false} />
      </mesh>
      <Glows specs={OIL_GLOWS} glow={glow} />
    </group>
  );
}

/** Debris: wreckage over an amber warning glow. */
function DebrisVisual({ groupRef, glow }: VisualProps) {
  return (
    <group ref={groupRef}>
      {DEBRIS_BOXES.map(([position, rotation, size, color]) => (
        <mesh key={color} position={position} rotation={rotation}>
          <boxGeometry args={size} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
      <Glows specs={DEBRIS_GLOWS} glow={glow} />
    </group>
  );
}

/** One reusable slot holding all three looks; a pose picks which is shown. */
function ItemSlot({ register, glow }: SlotProps) {
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
      debris.current.scale.setScalar(pose.width * 1.5);
    }
    if (color === undefined) return;
    tinted.current.forEach((material) => material.color.set(color));
    const now = performance.now();
    if (gem.current) {
      gem.current.rotation.y = now * 0.004;
      gem.current.position.y = GEM_HEIGHT + Math.sin(now * 0.005) * 0.16;
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
      slots.current.forEach((apply, i) => apply(items[i]));
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
