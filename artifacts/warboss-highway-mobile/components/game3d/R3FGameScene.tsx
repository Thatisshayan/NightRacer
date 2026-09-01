import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useRef } from 'react';
import type { Mesh, MeshBasicMaterial } from 'three';
import type { NativeGameEngine } from '../game/native-engine';
import { useApexNativeRenderer } from './r3f-renderer';
import { RoadSegments, type RoadMeshHandle } from './RoadMesh';
import { VehicleMesh, preloadVehicleModels, type VehicleMeshHandle } from './VehicleMesh';
import { Atmosphere } from './Atmosphere';
import { PostFX } from './PostFX';

// Base chase-cam position — see the module doc comment below for why this
// must exactly match apex-storm-renderer.ts's FreeCamera seat.
const BASE_CAMERA_X = 0;
const BASE_CAMERA_Y = 2.55;
const BASE_CAMERA_Z = -14.5;

// Matches apex-storm-renderer.ts's MAX_VEHICLE_SLOTS — a fixed pool of
// reusable meshes, hidden/shown per frame rather than created/destroyed.
const MAX_VEHICLE_SLOTS = 10;
// Slot 0 is reserved for the player; the rest are assigned to traffic below.
const MAX_TRAFFIC_SLOTS = MAX_VEHICLE_SLOTS - 1;

function SceneContent({ engine }: { engine: NativeGameEngine }) {
  const { latestFrame, latestScreenShake } = useApexNativeRenderer(engine);
  const roadHandle = useRef<RoadMeshHandle | null>(null);
  const vehicleHandles = useRef<(VehicleMeshHandle | null)[]>([]);
  // The Canvas's own default camera (set via the `camera` prop below) — read
  // through useThree rather than defined as JSX so it lives entirely outside
  // <Suspense>. A camera defined as Suspense's child gets unmounted along
  // with everything else whenever a not-yet-seen vehicle model suspends
  // mid-game (routine — a new traffic type's first appearance always
  // suspends once), which briefly left the scene with no active camera at
  // all: a fully black frame, sometimes for the rest of the run. That
  // regression (and the repeated full-tree unmount/remount thrashing it
  // caused) is the likely cause of a crash seen right after this feature
  // shipped.
  const { camera } = useThree();
  const flashMesh = useRef<Mesh>(null);
  const flashMaterial = useRef<MeshBasicMaterial | null>(null);

  // A three.js PerspectiveCamera constructed from the `camera` prop keeps its
  // default identity orientation and looks down -Z, but the road
  // (z ∈ [nearZ=-12, farZ=70]) sits in +Z from this seat — without an
  // explicit aim the whole scene lands behind the camera and renders black.
  // Mirror apex-storm-renderer.ts's FreeCamera.setTarget(3.45, 5.80, 24) so
  // this camera actually faces the road. Position-only screen-shake below
  // never re-orients the camera, so a single one-time lookAt is sufficient.
  useEffect(() => {
    camera.lookAt(3.45, 5.8, 24);
  }, [camera]);

  // Rides along with the camera without needing to declare the camera
  // itself as JSX: reparenting an already-mounted Object3D onto the camera
  // is a one-time imperative operation, so this plane only needs to exist
  // outside Suspense once — it never needs to re-run when Suspense flickers.
  useEffect(() => {
    const mesh = flashMesh.current;
    if (!mesh) return;
    camera.add(mesh);
    return () => {
      camera.remove(mesh);
    };
  }, [camera]);
  // frame.vehicles is sorted by depth (farthest first) for draw order, not by
  // identity — indexing vehicleHandles[i] = frame.vehicles[i] directly (the
  // prior approach) meant a pool slot's occupant silently changed whenever
  // two entities crossed z-order (a different GLTF reloading into the same
  // slot), and once total tracked entities exceeded MAX_VEHICLE_SLOTS, the
  // *nearest* entities — often including the player itself — were the ones
  // sorted past the cutoff and simply never rendered. Traffic now gets a
  // stable slot by id, and overflow drops the farthest traffic instead of
  // whatever the sort order happened to exclude.
  const trafficSlotById = useRef<Map<string, number>>(new Map());
  const freeTrafficSlots = useRef<number[]>(
    Array.from({ length: MAX_TRAFFIC_SLOTS }, (_, i) => MAX_TRAFFIC_SLOTS - i),
  );

  useEffect(() => {
    preloadVehicleModels();
  }, []);

  useFrame(() => {
    const frame = latestFrame.current;
    if (!frame) return;
    roadHandle.current?.update(frame.road, frame.biome);

    const selectedCar = engine.getState().selectedCar;

    const player = frame.vehicles.find((v) => v.kind === 'player');
    vehicleHandles.current[0]?.update(player, selectedCar);

    const traffic = frame.vehicles.filter((v) => v.kind !== 'player');
    // Nearest-first: if traffic count exceeds the pool, the farthest
    // vehicles are the ones left unassigned below, not an arbitrary subset.
    traffic.sort((a, b) => b.depth - a.depth);

    const assigned = trafficSlotById.current;
    const free = freeTrafficSlots.current;
    const present = new Set<string>();
    for (const pose of traffic) {
      present.add(pose.id);
      let slot = assigned.get(pose.id);
      if (slot === undefined) {
        slot = free.pop();
        if (slot === undefined) continue; // pool exhausted this frame — farthest traffic skipped
        assigned.set(pose.id, slot);
      }
      vehicleHandles.current[slot]?.update(pose, selectedCar);
    }
    for (const [id, slot] of assigned) {
      if (!present.has(id)) {
        assigned.delete(id);
        vehicleHandles.current[slot]?.update(undefined, selectedCar);
        free.push(slot);
      }
    }

    // Camera shake + crash flash on collision — engine.ts sets screenShake
    // to 300 on a hit and decays it over time (see handleCrash()). The web
    // renderers (apex-storm-renderer.ts, pixi-renderer.ts) both surface this
    // as camera jitter + a flash; this renderer computed latestScreenShake
    // every sync() but never read it back, so hits on the native 3D
    // renderer had zero screen feedback. Formula matches
    // apex-storm-renderer.ts's sync() exactly, same deterministic
    // high-frequency noise (not Math.random) so the two renderers shake in
    // lockstep for the same input.
    const screenShake = latestScreenShake.current;
    if (screenShake > 0) {
      const shake = screenShake * 0.05;
      const now = performance.now();
      camera.position.x = BASE_CAMERA_X + Math.sin(now * 0.083) * shake * 0.5;
      camera.position.y = BASE_CAMERA_Y + Math.sin(now * 0.071 + 1.7) * shake * 0.5;
      if (flashMaterial.current) flashMaterial.current.opacity = Math.min(0.8, screenShake * 0.15);
    } else {
      camera.position.x = BASE_CAMERA_X;
      camera.position.y = BASE_CAMERA_Y;
      if (flashMaterial.current) flashMaterial.current.opacity = 0;
    }
  });

  return (
    <>
      {/* Crash flash: a screen-filling quad reparented onto the camera above
          (see the useEffect above) so it rides along without needing to be
          declared as the camera's JSX child. Lives outside <Suspense> —
          transparent/opacity-0 by default, never touches any async asset,
          so it never needs to survive a Suspense fallback the way the
          camera itself does. */}
      <mesh ref={flashMesh} position={[0, 0, -0.2]}>
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial
          ref={flashMaterial}
          color="#ff1a1a"
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <hemisphereLight args={['#5779a9', '#0b1728', 0.95]} />
      <directionalLight position={[-3.5, 10, 3.5]} intensity={1.35} color="#b8dcff" castShadow />
      <fog attach="fog" args={['#112941', 20, 140]} />
      {/* RoadSegments loads no async asset (plain box geometry/materials),
          so it never needs to sit inside a Suspense boundary at all. */}
      <RoadSegments handleRef={roadHandle} />
      {/* useLoader (used by VehicleMesh's GLTF loading) throws its loading
          promise for the nearest Suspense boundary to catch — that's how
          R3F's suspense-based loaders work. Without one here, the thrown
          promise bubbles up as an uncaught error, which the app's root
          ErrorBoundary then shows as "something went wrong, please reload"
          the instant a vehicle model starts loading. fallback={null} means
          nothing renders for the (very brief, local-asset) load instead of
          a spinner. Each slot gets its OWN Suspense boundary (not one
          shared boundary around the whole pool): a slot's model loading for
          the first time — routine mid-game, whenever a not-yet-seen
          vehicle type first appears — should only blank that one slot, not
          every other already-loaded vehicle on screen. The camera itself
          must NOT be a descendant of any of these: see the useThree comment
          above for why that previously caused a fully black frame. */}
      {Array.from({ length: MAX_VEHICLE_SLOTS }, (_, i) => (
        <Suspense key={i} fallback={null}>
          <VehicleMesh index={i} ref={(h) => { vehicleHandles.current[i] = h; }} />
        </Suspense>
      ))}
      <Atmosphere frameRef={latestFrame} />
    </>
  );
}

export function R3FGameScene({ engine }: { engine: NativeGameEngine }) {
  return (
    <Canvas
      camera={{ position: [BASE_CAMERA_X, BASE_CAMERA_Y, BASE_CAMERA_Z], fov: 47 }}
      gl={{ antialias: true }}
      shadows
      onCreated={({ gl }) => {
        // three.js clears to opaque black by default, but the scene fog (and
        // the web renderer this mirrors: createScene()'s clearColor
        // Color4(0.018,0.045,0.088)) renders the dusk sky a dark blue. Black
        // shows through as a hard seam where fogged geometry ends and the
        // empty void begins, reading as wrong-color/garbage at the horizon.
        // Match the reference renderer's clear color so sky == clear.
        gl.setClearColor('#040B16');
      }}
    >
      <SceneContent engine={engine} />
      <PostFX />
    </Canvas>
  );
}
