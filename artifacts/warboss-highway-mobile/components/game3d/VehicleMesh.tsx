import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Asset } from 'expo-asset';
import { Box3, Group, MeshStandardMaterial, Vector3 } from 'three';
import type { ApexVehicleModelType, ApexVehiclePose } from '@workspace/render-frame';
import type { CarType } from '@workspace/game-core';

export interface VehicleMeshHandle {
  update(pose: ApexVehiclePose | undefined, selectedCar: CarType): void;
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
  const box = new Box3().setFromObject(object);
  const size = new Vector3();
  box.getSize(size);
  const center = new Vector3();
  box.getCenter(center);
  const horizontalExtent = Math.max(size.x, size.z) || 1;
  const scale = 1 / horizontalExtent;

  const wrapper = new Group();
  wrapper.add(object);
  object.position.set(-center.x, -box.min.y, -center.z);
  wrapper.scale.setScalar(scale);
  return wrapper;
}

// Failed GLTF loads are cached so we don't retry a known-bad asset on every
// re-mount (a slot's model swaps as traffic spawns/despawns, which would
// otherwise hammer the loader with already-failing fetches every frame).
const failedUris = new Set<string>();

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
    const loader = new GLTFLoader();
    loader
      .loadAsync(uri)
      .then((gltf) => {
        if (!cancelled) {
          // A load resolving to a GLTF without a scene is treated as a
          // failure so we never dereference an undefined scene.
          setState(gltf?.scene ? { status: 'ok', gltf: gltf as { scene: Group } } : { status: 'failed' });
        }
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
// URL (see LoadedGltf), so re-mounting a previously-seen key is cheap, and
// preloadVehicleModels() below still warms every model's local URI in the
// background. Loads are non-suspending and fail-soft (a rejected file:// URI
// renders a grounded placeholder instead of throwing into the root
// ErrorBoundary).
export const VehicleMesh = forwardRef<VehicleMeshHandle, { index: number }>(function VehicleMesh(_props, ref) {
  const group = useRef<Group>(null);
  const [activeKey, setActiveKey] = useState<ModelKey | null>(null);

  useImperativeHandle(ref, () => ({
    update(pose, selectedCar) {
      const g = group.current;
      if (!g) return;
      if (!pose || pose.alpha <= 0) {
        g.visible = false;
        return;
      }
      g.visible = true;
      // y is deliberately 0, not pose.y: pose.y is a chassis-lift offset
      // calibrated for the old placeholder box's pivot-at-vertical-center
      // geometry. normalizeGroundedModel() already grounds every real model
      // so its lowest point sits at local y=0 — reapplying pose.y here would
      // lift an already-grounded model back up into the air. Uniform scale
      // by pose.length only: each normalized model keeps its own real
      // width/length aspect ratio, so scaling width and length independently
      // would stretch a bus into a sedan's proportions instead of just
      // resizing it.
      g.position.set(pose.x, 0, pose.z);
      g.rotation.y = pose.heading;
      g.scale.setScalar(pose.length);
      setActiveKey(pose.vehicleType === 'PLAYER' ? selectedCar : pose.vehicleType);
    },
  }));

  return (
    <group ref={group} visible={false}>
      {activeKey && <VehicleModel key={activeKey} modelKey={activeKey} />}
    </group>
  );
});

// Best-effort: warms expo-asset's cache for every model up front so the
// first vehicle of each type to appear doesn't pop in empty for a frame.
// Not yet verified to actually help on-device — flagged as an assumption in
// the implementation plan alongside the rest of this file's unverified GLTF
// loading path.
export function preloadVehicleModels(): void {
  MODEL_KEYS.forEach((key) => {
    Asset.fromModule(MODEL_MODULES[key]).downloadAsync().catch(() => {});
  });
}
