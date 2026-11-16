import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Asset } from 'expo-asset';
import {
  AdditiveBlending,
  Box3,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Vector3,
} from 'three';
import type { Material, Texture } from 'three';
import type { ApexVehicleModelType, ApexVehiclePose } from '@workspace/render-frame';
import type { CarType } from '@workspace/game-core';
import { getGlowTexture } from './textures';

export interface VehicleMeshHandle {
  /** fade: 0..1 extra opacity multiplier (traffic that has passed the player
   * is faded out so it cannot sit between the chase camera and the car). */
  update(pose: ApexVehiclePose | undefined, selectedCar: CarType, fade: number, motion?: VehicleMotion): void;
  /** True once this slot's model (or its placeholder) is mounted. */
  isLoaded(): boolean;
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

/** Per-frame motion inputs the scene supplies alongside a pose. */
export interface VehicleMotion {
  /** Lateral position in scene units relative to the road centreline. */
  lateral: number;
  /** Seconds since the previous frame. */
  dt: number;
  /** Current speed multiplier (1 = base speed). */
  speed: number;
}

interface MotionState {
  id: string | null;
  /** Where the body is drawn; trails `lateral` by a few frames. */
  visual: number;
  velocity: number;
  yaw: number;
  z: number;
  zVelocity: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// The simulation moves a car sideways as a rigid box: with touch steering the
// hitbox simply teleports under the finger, nose locked to the road. Drawn
// that way a car slides like a fridge magnet. This derives the missing body
// language from the lateral motion itself: the body trails the hitbox by a
// few frames (weight), the nose turns into the direction of travel (slip
// angle), and the caller rolls the body outward from that yaw.
function stepMotion(state: MotionState, pose: ApexVehiclePose, motion: VehicleMotion): void {
  if (state.id !== pose.id) {
    state.id = pose.id;
    state.visual = motion.lateral;
    state.velocity = 0;
    state.yaw = 0;
    state.z = pose.z;
    state.zVelocity = 0;
    return;
  }
  const dt = clamp(motion.dt, 1 / 240, 0.05);
  const previous = state.visual;
  state.visual += (motion.lateral - state.visual) * Math.min(1, dt * 16);
  state.velocity += ((state.visual - previous) / dt - state.velocity) * Math.min(1, dt * 12);
  // ~atan(lateral speed / forward speed) at base speed, capped at ~14 degrees.
  state.yaw += (clamp(state.velocity * 0.03, -0.24, 0.24) - state.yaw) * Math.min(1, dt * 10);
  state.zVelocity += ((pose.z - state.z) / dt - state.zVelocity) * Math.min(1, dt * 8);
  state.z = pose.z;
}

function applyOpacity(material: Material, opacity: number): void {
  const transparent = opacity < 1;
  if (material.transparent !== transparent) {
    material.transparent = transparent;
    material.needsUpdate = true;
  }
  material.opacity = opacity;
}

function glowMaterial(map: Texture, color: string, additive: boolean): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    map,
    transparent: true,
    blending: additive ? AdditiveBlending : NormalBlending,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  });
}

// Per-slot materials (not shared) so each vehicle carries its own colour and
// fade.
function useVehicleMaterials() {
  return useMemo(() => {
    const map = getGlowTexture();
    return {
      lamp: new MeshBasicMaterial({ color: TAIL_LIGHT_COLOR, toneMapped: false }),
      // Soft bloom around the lamps: expo-gl cannot run a real bloom pass
      // (see PostFX.tsx), so the glow is drawn as a sprite instead.
      halo: glowMaterial(map, TAIL_LIGHT_COLOR, true),
      // The lamps' reflection smeared down the wet road toward the camera.
      streak: glowMaterial(map, TAIL_LIGHT_COLOR, true),
      beam: glowMaterial(map, HEAD_LIGHT_COLOR, true),
      // Tyre spray hanging behind the car in the rain.
      spray: glowMaterial(map, '#b9cfe6', true),
      shadow: glowMaterial(map, '#000000', false),
    };
  }, []);
}

type VehicleMaterials = ReturnType<typeof useVehicleMaterials>;

interface ExtraRefs {
  root: RefObject<Group | null>;
  lamps: RefObject<Group | null>;
  streak: RefObject<Mesh | null>;
  beam: RefObject<Mesh | null>;
  spray: RefObject<Mesh | null>;
}

// Everything below is laid out in the model's normalized unit-length space
// (the slot's group scale resizes it with the car), for a car facing +Z with
// its tail toward the chase camera. update() flips the lamp end for oncoming
// traffic.
function VehicleExtras({ refs, materials }: { refs: ExtraRefs; materials: VehicleMaterials }) {
  return (
    <group ref={refs.root} visible={false}>
      {/* Contact shadow: grounds the car on the road. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} material={materials.shadow}>
        <planeGeometry args={[0.8, 1.32]} />
      </mesh>
      <mesh ref={refs.streak} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, -1.7]} material={materials.streak}>
        <planeGeometry args={[0.62, 2.6]} />
      </mesh>
      <mesh ref={refs.beam} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 2.3]} material={materials.beam} visible={false}>
        <planeGeometry args={[1.5, 4.2]} />
      </mesh>
      <mesh ref={refs.spray} position={[0, 0.16, -0.66]} material={materials.spray}>
        <planeGeometry args={[1.0, 0.42]} />
      </mesh>
      <group ref={refs.lamps} position={[0, 0.2, -0.505]}>
        <mesh position={[-0.15, 0, 0]} material={materials.lamp}>
          <boxGeometry args={[0.1, 0.045, 0.02]} />
        </mesh>
        <mesh position={[0.15, 0, 0]} material={materials.lamp}>
          <boxGeometry args={[0.1, 0.045, 0.02]} />
        </mesh>
        <mesh material={materials.halo}>
          <planeGeometry args={[0.72, 0.3]} />
        </mesh>
      </group>
    </group>
  );
}

function useExtraRefs(): ExtraRefs {
  return {
    root: useRef<Group>(null),
    lamps: useRef<Group>(null),
    streak: useRef<Mesh>(null),
    beam: useRef<Mesh>(null),
    spray: useRef<Mesh>(null),
  };
}

// Lamps sit on whichever end faces the chase camera: tail lights (red) for
// the player and same-direction traffic, headlights (white) for oncoming.
function applyLighting(
  pose: ApexVehiclePose,
  refs: ExtraRefs,
  materials: VehicleMaterials,
  opacity: number,
  speed: number,
): void {
  const facesCamera = pose.lights.facesCamera;
  const cameraEnd = facesCamera ? 1 : -1;
  const color = facesCamera ? HEAD_LIGHT_COLOR : TAIL_LIGHT_COLOR;
  materials.lamp.color.set(color);
  materials.halo.color.set(color);
  materials.streak.color.set(color);
  if (refs.lamps.current) refs.lamps.current.position.z = cameraEnd * 0.505;
  if (refs.streak.current) refs.streak.current.position.z = cameraEnd * 1.7;
  // Only the player throws a headlight beam up the road ahead; spray trails
  // behind, so it is only visible on vehicles seen from the rear.
  if (refs.beam.current) refs.beam.current.visible = pose.kind === 'player';
  if (refs.spray.current) refs.spray.current.visible = !facesCamera;

  applyOpacity(materials.lamp, opacity);
  materials.halo.opacity = opacity * 0.6;
  materials.streak.opacity = opacity * (facesCamera ? 0.5 : 0.42) * pose.lights.intensity;
  materials.beam.opacity = opacity * 0.34;
  materials.spray.opacity = opacity * Math.min(0.2, 0.08 * speed);
  materials.shadow.opacity = opacity * 0.62;
}

function applyModelOpacity(model: Group | null, opacity: number): void {
  model?.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => applyOpacity(m, opacity));
    else applyOpacity(mesh.material, opacity);
  });
}

// Body roll (outward from the turn), a touch of pitch under acceleration for
// the player, and a small road-surface bob so a car never sits perfectly
// still on screen.
function applyBodyMotion(model: Group, pose: ApexVehiclePose, state: MotionState, speed: number, seed: number): void {
  const side = pose.lights.facesCamera ? -1 : 1;
  model.rotation.z = state.yaw * 0.5 * side;
  model.rotation.x = pose.kind === 'player' ? clamp(-state.zVelocity * 0.006, -0.05, 0.05) : 0;
  const t = performance.now() * 0.001;
  model.position.y = (Math.sin(t * 31 + seed) + Math.sin(t * 47 + seed * 1.7)) * 0.0022 * speed;
}

export const VehicleMesh = forwardRef<VehicleMeshHandle, { index: number }>(function VehicleMesh({ index }, ref) {
  const group = useRef<Group>(null);
  const model = useRef<Group>(null);
  const extras = useExtraRefs();
  const materials = useVehicleMaterials();
  const [activeKey, setActiveKey] = useState<ModelKey | null>(null);
  const motionState = useRef<MotionState>({ id: null, visual: 0, velocity: 0, yaw: 0, z: 0, zVelocity: 0 });

  useImperativeHandle(ref, () => ({
    isLoaded() {
      return (model.current?.children.length ?? 0) > 0;
    },
    update(pose, selectedCar, fade, motion) {
      const g = group.current;
      if (!g) return;
      const opacity = pose ? clamp(pose.alpha * fade, 0, 1) : 0;
      if (!pose || opacity <= 0.01) {
        g.visible = false;
        motionState.current.id = null;
        return;
      }
      g.visible = true;
      const state = motionState.current;
      if (motion) stepMotion(state, pose, motion);
      const lag = motion ? state.visual - motion.lateral : 0;
      // y is deliberately 0, not pose.y: normalizeGroundedModel() already
      // grounds every model so its lowest point sits at local y=0. X and yaw
      // are negated because frame coordinates are left-handed (Babylon) and
      // three.js is right-handed; see toSceneX in R3FGameScene.tsx.
      g.position.set(-pose.x + lag, 0, pose.z);
      g.rotation.y = -pose.heading + state.yaw;
      // Uniform scale chosen so the model's WIDTH equals pose.width (the
      // hitbox width): each model keeps its own proportions, so a bus comes
      // out long and a car short at the same lane fit.
      const loaded = model.current?.children[0];
      const widthRatio = (loaded?.userData.widthRatio as number | undefined) ?? DEFAULT_WIDTH_RATIO;
      g.scale.setScalar(pose.width / widthRatio);
      if (extras.root.current) {
        // Laid out for a typical car's proportions; narrowed for long
        // vehicles, and hidden until there is a body for them to belong to.
        extras.root.current.scale.x = widthRatio / DEFAULT_WIDTH_RATIO;
        extras.root.current.visible = loaded !== undefined;
      }
      setActiveKey(pose.vehicleType === 'PLAYER' ? selectedCar : pose.vehicleType);

      const speed = motion?.speed ?? 1;
      applyLighting(pose, extras, materials, opacity, speed);
      applyModelOpacity(model.current, opacity);
      if (model.current) applyBodyMotion(model.current, pose, state, speed, index * 2.4);
    },
  }));

  return (
    <group ref={group} visible={false}>
      <group ref={model}>{activeKey && <VehicleModel key={activeKey} modelKey={activeKey} />}</group>
      <VehicleExtras refs={extras} materials={materials} />
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
