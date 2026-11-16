import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Asset } from 'expo-asset';
import { AdditiveBlending, Box3, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import type { Material } from 'three';
import type { ApexVehicleModelType, ApexVehiclePose } from '@workspace/render-frame';
import type { CarType } from '@workspace/game-core';
import { getGlowTexture } from './textures';

export interface VehicleMeshHandle {
  /** fade: 0..1 extra opacity multiplier (traffic that has passed the player
   * is faded out so it cannot sit between the chase camera and the car). */
  update(pose: ApexVehiclePose | undefined, selectedCar: CarType, fade: number): void;
}

// Every generated model, keyed by the identifier that actually selects it at
// render time: the 5 CarType keys for the player car, the 7 VehicleType
// traffic keys, and BOSS. require() needs static literal paths for Metro's
// bundler, so this map can't be built dynamically.
const MODEL_MODULES = {
  RATTLETRAP: require('../../assets/3d/apex/rattletrap.glb'),
  WAR_RUNNER: require('../../assets/3d/apex/war_runner.glb'),
  DEATHSLED: require('../../assets/3d/apex/deathsled.glb'),
  SCRAPQUEEN: require('../../assets/3d/apex/scrapqueen.glb'),
  PHANTOM: require('../../assets/3d/apex/phantom.glb'),
  SEDAN: require('../../assets/3d/apex/sedan.glb'),
  PICKUP: require('../../assets/3d/apex/pickup.glb'),
  COP: require('../../assets/3d/apex/cop.glb'),
  BOXTRUCK: require('../../assets/3d/apex/boxtruck.glb'),
  BUS: require('../../assets/3d/apex/bus.glb'),
  SPORTS: require('../../assets/3d/apex/sports.glb'),
  TANK: require('../../assets/3d/apex/tank.glb'),
  BOSS: require('../../assets/3d/apex/boss.glb'),
} as const satisfies Record<CarType | Exclude<ApexVehicleModelType, 'PLAYER'>, unknown>;

export type ModelKey = keyof typeof MODEL_MODULES;
const MODEL_KEYS = Object.keys(MODEL_MODULES) as ModelKey[];

// expo-gl's GL context can't fetch() a Metro `require()` id directly the way
// browser Three.js expects a URL string — expo-asset resolves the bundled
// module to a real, loadable local URI first. GLTFLoader's fetch() can still
// reject that file:// URI on React Native; that rejection is handled
// fail-soft in LoadedGltf (renders a grounded placeholder, never a crash).
function useLocalGltfUri(moduleId: number): string | null {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Asset.fromModule(moduleId)
      .downloadAsync()
      .then((asset) => {
        if (!cancelled) setUri(asset.localUri ?? asset.uri);
      });
    return () => {
      cancelled = true;
    };
  }, [moduleId]);
  return uri;
}

// Exported for standalone previews (e.g. the title screen's spinning car
// card) that want a loaded, grounded/normalized model without the pose-pool
// machinery below — just "load and show this one vehicle".
export function VehicleModel({ modelKey }: { modelKey: ModelKey }) {
  const uri = useLocalGltfUri(MODEL_MODULES[modelKey]);
  if (!uri) return null;
  return <LoadedGltf uri={uri} />;
}

// Single-image-to-3D reconstruction (SAM 3 / Meshy) has no guaranteed scale
// or ground-contact convention — the raw mesh could be any size, centered
// anywhere, with its lowest point well above or below its own origin.
// Without this, vehicles would render at arbitrary sizes and could float
// above or sink into the road depending on what each source photo implied
// about depth. This centers the model on X/Z, drops its lowest point to
// local y=0 (so "wheels on the ground" is true by construction, not by
// luck), and uniform-scales it so its longest horizontal axis is 1 unit —
// preserving each model's real width/length proportions rather than
// stretching them to force-fit a generic box's dimensions.
function normalizeGroundedModel(object: Group): Group {
  // Every model must end up with its length along Z and its nose at +Z, the
  // convention VehicleMesh.update's heading assumes. Most of this asset set
  // already is; the box truck and bus (from a different generator) lie along
  // X with the cab at -X, and were being drawn broadside across the lanes.
  // A quarter turn about Y maps -X onto +Z.
  const rawSize = new Vector3();
  new Box3().setFromObject(object).getSize(rawSize);
  if (rawSize.x > rawSize.z) {
    object.rotation.y = Math.PI / 2;
    object.updateMatrixWorld(true);
  }

  const box = new Box3().setFromObject(object);
  const size = new Vector3();
  box.getSize(size);
  const center = new Vector3();
  box.getCenter(center);
  const horizontalExtent = Math.max(size.x, size.z) || 1;
  const scale = 1 / horizontalExtent;

  // Object3D.clone() shares materials between clones. Every pool slot fades
  // its own vehicle independently (see VehicleMesh.update), so each instance
  // needs its own material; the texture and geometry stay shared.
  object.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => toPaintMaterial(m.clone()))
      : toPaintMaterial(mesh.material.clone());
  });

  const wrapper = new Group();
  wrapper.add(object);
  object.position.set(-center.x, -box.min.y, -center.z);
  wrapper.scale.setScalar(scale);
  // Width as a fraction of length, read by VehicleMesh.update to size the
  // vehicle from its hitbox width (a bus is 4x as long as it is wide, a car
  // about 2x: one fixed length-per-width factor cannot fit both).
  wrapper.userData.widthRatio = Math.min(size.x, size.z) / horizontalExtent;
  return wrapper;
}

// Most of these GLBs omit metallicFactor, and glTF's default for a missing
// value is 1.0 — fully metallic. A metal has no diffuse term at all: it only
// shows reflections, and this scene has no environment map to reflect, so the
// textured paint rendered almost pure black (and plain white while the
// textures were failing to load). The textures are photo-derived albedo with
// lighting baked in, so treat every vehicle as painted, non-metallic bodywork.
function toPaintMaterial<T extends Material>(material: T): T {
  const standard = material as unknown as MeshStandardMaterial;
  if (standard.isMeshStandardMaterial) {
    standard.metalness = 0;
    standard.roughness = 0.62;
    // The paint textures are dark bodywork with neon trim. Feeding the same
    // texture back in as a weak emissive map keeps that trim (and the body
    // colour) readable at night instead of sinking into the dark road.
    if (standard.map) {
      standard.emissiveMap = standard.map;
      standard.emissive.set('#ffffff');
      standard.emissiveIntensity = 0.5;
    }
  }
  return material;
}

// Failed GLTF loads are cached so we don't retry a known-bad asset on every
// re-mount (a slot's model swaps as traffic spawns/despawns, which would
// otherwise hammer the loader with already-failing fetches every frame).
const failedUris = new Set<string>();

// Successful loads are cached per URI too. Without this every pool slot
// re-read and re-parsed the same ~1.5MB GLB (and re-uploaded its ~1MB
// texture) each time a vehicle of that type appeared: a hitch per spawn and
// unbounded duplicate GPU memory over a long run.
const gltfCache = new Map<string, Promise<{ scene: Group } | null>>();

function loadGltf(uri: string): Promise<{ scene: Group } | null> {
  let pending = gltfCache.get(uri);
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(uri)
      // A load resolving to a GLTF without a scene is treated as a failure so
      // we never dereference an undefined scene.
      .then((gltf) => (gltf?.scene ? (gltf as { scene: Group }) : null));
    gltfCache.set(uri, pending);
    pending.catch(() => gltfCache.delete(uri));
  }
  return pending;
}

// One grounded, non-throwing placeholder for a load that fails on the device
// (GLTFLoader's internal fetch() rejects file:// URIs on React Native, which
// is exactly what a deployed device hits via the expo-asset path). Rendering
// a simple car-shaped box instead of throwing keeps the game running and the
// slot visually occupied, so the "everything invisible / blank / app crash"
// failure mode (the root ErrorBoundary's "something went wrong" screen) never
// fires from a model load. It is normalized the SAME way a real model is:
// longest horizontal axis = 1, x/z centered, lowest point at y=0 — the outer
// pool group then applies the identical ×pose.length scale, so it sits on the
// road at the same size/pose a real GLTF would occupy.
function PlaceholderVehicle() {
  const material = useMemo(() => new MeshStandardMaterial({ color: '#2b3a52', roughness: 0.9 }), []);
  return (
    <group>
      <mesh material={material} position={[0, 0.14, 0]}>
        <boxGeometry args={[0.44, 0.28, 1.0]} />
      </mesh>
      <mesh material={material} position={[0, 0.36, -0.05]}>
        <boxGeometry args={[0.4, 0.16, 0.55]} />
      </mesh>
    </group>
  );
}

type LoadedState =
  | { status: 'loading' }
  | { status: 'ok'; gltf: { scene: Group } }
  | { status: 'failed' };

function LoadedGltf({ uri }: { uri: string }) {
  const [state, setState] = useState<LoadedState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (failedUris.has(uri)) {
      setState({ status: 'failed' });
      return;
    }
    loadGltf(uri)
      .then((gltf) => {
        if (!cancelled) setState(gltf ? { status: 'ok', gltf } : { status: 'failed' });
      })
      .catch(() => {
        failedUris.add(uri);
        if (!cancelled) setState({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  // All hooks run unconditionally (Rules of Hooks) — the normalized object is
  // only meaningful in the ok state, guarded by the render branch below.
  const normalized = useMemo(
    () =>
      state.status === 'ok' ? normalizeGroundedModel(state.gltf.scene.clone()) : null,
    [state],
  );

  if (state.status === 'loading') return null;
  if (state.status === 'failed') return <PlaceholderVehicle />;
  return normalized ? <primitive object={normalized} /> : <PlaceholderVehicle />;
}

// One pool slot mounts only the single model matching the vehicle currently
// occupying it — the pool itself is reused frame to frame (see
// R3FGameScene.tsx), but *which* vehicle occupies a given slot changes as
// traffic spawns/despawns, so the mounted model swaps when that changes.
// Mounting all 13 candidates per slot (as siblings, toggling visibility) was
// tried first and caused 130 concurrent model loads the instant the scene
// mounted, which crashed real devices. Each loaded GLTF result is cached per
// URL (see loadGltf), so re-mounting a previously-seen key is cheap, and
// preloadVehicleModels() below still warms every model's local URI in the
// background. Loads are non-suspending and fail-soft (a rejected file:// URI
// renders a grounded placeholder instead of throwing into the root
// ErrorBoundary).
// Width / length of a typical car model in this set; used until a model has
// loaded and by the placeholder.
const DEFAULT_WIDTH_RATIO = 0.5;
const TAIL_LIGHT_COLOR = '#ff2a3d';
const HEAD_LIGHT_COLOR = '#eaf6ff';

function applyOpacity(material: Material, opacity: number): void {
  const transparent = opacity < 1;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
  material.opacity = opacity;
}

export const VehicleMesh = forwardRef<VehicleMeshHandle, { index: number }>(function VehicleMesh(_props, ref) {
  const group = useRef<Group>(null);
  const model = useRef<Group>(null);
  const extras = useRef<Group>(null);
  const lamps = useRef<Group>(null);
  const pool = useRef<Mesh>(null);
  const beam = useRef<Mesh>(null);
  const [activeKey, setActiveKey] = useState<ModelKey | null>(null);
  const glowMap = useMemo(() => getGlowTexture(), []);
  // Per-slot materials (not shared) so each vehicle can carry its own colour
  // and fade.
  const lampMaterial = useMemo(() => new MeshBasicMaterial({ color: TAIL_LIGHT_COLOR, toneMapped: false }), []);
  const poolMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: TAIL_LIGHT_COLOR,
        map: glowMap,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [glowMap],
  );
  const beamMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        color: HEAD_LIGHT_COLOR,
        map: glowMap,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [glowMap],
  );
  const shadowMaterial = useMemo(
    () => new MeshBasicMaterial({ color: '#000000', map: glowMap, transparent: true, depthWrite: false }),
    [glowMap],
  );

  useImperativeHandle(ref, () => ({
    update(pose, selectedCar, fade) {
      const g = group.current;
      if (!g) return;
      const opacity = pose ? Math.max(0, Math.min(1, pose.alpha * fade)) : 0;
      if (!pose || opacity <= 0.01) {
        g.visible = false;
        return;
      }
      g.visible = true;
      // y is deliberately 0, not pose.y: pose.y is a chassis-lift offset
      // calibrated for the old placeholder box's pivot-at-vertical-center
      // geometry. normalizeGroundedModel() already grounds every real model
      // so its lowest point sits at local y=0 — reapplying pose.y here would
      // lift an already-grounded model back up into the air. Uniform scale,
      // chosen so the model's WIDTH equals pose.width (the hitbox width):
      // each normalized model keeps its own real width/length aspect ratio,
      // so a bus comes out long and a car short at the same lane fit.
      // X and yaw are negated: frame coordinates are left-handed (Babylon),
      // three.js is right-handed. See toSceneX in R3FGameScene.tsx.
      g.position.set(-pose.x, 0, pose.z);
      g.rotation.y = -pose.heading;
      const loaded = model.current?.children[0];
      const widthRatio = (loaded?.userData.widthRatio as number | undefined) ?? DEFAULT_WIDTH_RATIO;
      g.scale.setScalar(pose.width / widthRatio);
      if (extras.current) {
        // Lamps, shadow and light pools are laid out for a typical car's
        // proportions; narrow them for long vehicles, and keep them hidden
        // until there is a body for them to belong to (they used to appear
        // as a pair of floating red boxes before the model had loaded).
        extras.current.scale.x = widthRatio / DEFAULT_WIDTH_RATIO;
        extras.current.visible = loaded !== undefined;
      }
      setActiveKey(pose.vehicleType === 'PLAYER' ? selectedCar : pose.vehicleType);

      // Lamps sit on whichever end faces the chase camera: tail lights (red)
      // for the player and same-direction traffic, headlights (white) for
      // oncoming traffic. Everything below is in the model's normalized
      // unit-length space (the group scale above resizes it with the car).
      const cameraEnd = pose.lights.facesCamera ? 1 : -1;
      const lampColor = pose.lights.facesCamera ? HEAD_LIGHT_COLOR : TAIL_LIGHT_COLOR;
      lampMaterial.color.set(lampColor);
      poolMaterial.color.set(lampColor);
      if (lamps.current) lamps.current.position.z = cameraEnd * 0.505;
      if (pool.current) pool.current.position.z = cameraEnd * 0.95;
      // Only the player throws a headlight beam up the road ahead.
      if (beam.current) beam.current.visible = pose.kind === 'player';

      applyOpacity(lampMaterial, opacity);
      poolMaterial.opacity = opacity * (pose.lights.facesCamera ? 0.5 : 0.42) * pose.lights.intensity;
      beamMaterial.opacity = opacity * 0.3;
      shadowMaterial.opacity = opacity * 0.62;
      model.current?.traverse((child) => {
        const mesh = child as Mesh;
        if (!mesh.isMesh) return;
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => applyOpacity(m, opacity));
        else applyOpacity(mesh.material, opacity);
      });
    },
  }));

  return (
    <group ref={group} visible={false}>
      <group ref={model}>{activeKey && <VehicleModel key={activeKey} modelKey={activeKey} />}</group>
      <group ref={extras} visible={false}>
      {/* Contact shadow: grounds the car on the road. The 3D models carry no
          shadow of their own and floated visually without it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} material={shadowMaterial}>
        <planeGeometry args={[0.78, 1.3]} />
      </mesh>
      {/* Lamp light pooling on the wet road behind/in front of the car. */}
      <mesh ref={pool} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, -0.95]} material={poolMaterial}>
        <planeGeometry args={[0.95, 1.25]} />
      </mesh>
      <mesh ref={beam} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 1.75]} material={beamMaterial} visible={false}>
        <planeGeometry args={[1.35, 3.1]} />
      </mesh>
      <group ref={lamps} position={[0, 0.2, -0.505]}>
        <mesh position={[-0.15, 0, 0]} material={lampMaterial}>
          <boxGeometry args={[0.1, 0.045, 0.02]} />
        </mesh>
        <mesh position={[0.15, 0, 0]} material={lampMaterial}>
          <boxGeometry args={[0.1, 0.045, 0.02]} />
        </mesh>
      </group>
      </group>
    </group>
  );
});

// Called from the title screen and again when a run starts (a no-op once
// everything is cached).
export function preloadVehicleModels(): void {
  // One at a time: resolves each bundled file and parses it into gltfCache,
  // so a vehicle's first appearance in a run mounts an already-parsed model
  // instead of popping in a second late. Sequential to avoid thirteen
  // simultaneous parses (the burst that crashed real devices before).
  MODEL_KEYS.reduce<Promise<void>>(
    (chain, key) =>
      chain
        .then(() => Asset.fromModule(MODEL_MODULES[key]).downloadAsync())
        .then((asset) => loadGltf(asset.localUri ?? asset.uri))
        .then(
          () => undefined,
          () => undefined,
        ),
    Promise.resolve(),
  );
}
