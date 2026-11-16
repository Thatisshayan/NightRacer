import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useRef } from 'react';
import type { HemisphereLight, Mesh, MeshBasicMaterial } from 'three';
import { sampleApexRoad, type ApexStormFrame, type ApexVehiclePose } from '@workspace/render-frame';
import type { CarType } from '@workspace/game-core';
import type { NativeGameEngine } from '../game/native-engine';
import { useApexNativeRenderer } from './r3f-renderer';
import { RoadSegments, type RoadMeshHandle } from './RoadMesh';
import { Skyline, type SkylineHandle } from './Skyline';
import { Roadside, type RoadsideHandle } from './Roadside';
import { VehicleMesh, preloadVehicleModels, type VehicleMeshHandle } from './VehicleMesh';
import { Atmosphere } from './Atmosphere';
import { PostFX } from './PostFX';
import { HAZE_COLOR } from './textures';

// Chase-cam seat, tuned against real simulator captures of THIS renderer —
// deliberately not a copy of apex-storm-renderer.ts's Babylon FreeCamera.
// That seat (y=2.55, aimed slightly up at a skyline) left ~60% of a phone
// screen as empty sky here, squeezed all oncoming traffic into a ~10%-tall
// band, let passing trucks fill the entire view, and — being fixed in X with
// only an ~11 degree horizontal half-FOV in portrait — let the player car
// slide completely off screen whenever the road curved.
// This seat sits higher, looks down the road and follows the player.
const CAMERA_Y = 7.4;
const CAMERA_Z = -13.8;
const CAMERA_FOV = 52;
const LOOK_Y = -2.7;
const LOOK_Z = 24;
// 0 = camera rides the road centreline, 1 = camera locked to the player.
const CAMERA_FOLLOW = 0.6;
// How much the aim point leans into the curve ahead (0 = no yaw).
const CAMERA_CURVE_LEAN = 0.3;

// Traffic the player has already passed is faded out over this band behind
// the player (world units). Left solid, a tall vehicle between the camera and
// the car hides the player and the road ahead.
const PASS_FADE_START = 2.5;
const PASS_FADE_LENGTH = 3.5;

const SKY_LIGHT_INTENSITY = 2.4;

// @workspace/render-frame's coordinates come from the Babylon web renderer,
// which is LEFT-handed: looking down +Z, +X is screen-right. three.js is
// right-handed: looking down +Z, +X is screen-LEFT. Every frame X (and every
// heading) is therefore negated on its way into this scene — here, in
// RoadMesh and in VehicleMesh. Without this the whole scene is mirrored and
// dragging right steers the car left on screen.
const toSceneX = (frameX: number) => -frameX;

// Camera shake + crash flash on collision — engine.ts sets screenShake to 300
// on a hit and decays it over time (see handleCrash()). The web renderers
// (apex-storm-renderer.ts, pixi-renderer.ts) both surface this as camera
// jitter + a flash. Formula matches apex-storm-renderer.ts's sync():
// deterministic high-frequency noise (not Math.random) so the two renderers
// shake in lockstep for the same input.
function shakeFor(screenShake: number): { x: number; y: number; flash: number } {
  if (screenShake <= 0) return { x: 0, y: 0, flash: 0 };
  const shake = screenShake * 0.05;
  const now = performance.now();
  return {
    x: Math.sin(now * 0.083) * shake * 0.5,
    y: Math.sin(now * 0.071 + 1.7) * shake * 0.5,
    flash: Math.min(0.8, screenShake * 0.15),
  };
}

// Follow the player laterally. The road centreline wanders by several units
// as it curves and the player can sit up to ~5 units either side of it, far
// more than a portrait frustum shows at the player's depth — a fixed camera
// loses the car entirely. Blend between the centreline and the player so the
// car stays on screen while still visibly moving across it when steering.
function followCameraX(
  current: number | null,
  player: ApexVehiclePose,
  frame: ApexStormFrame,
  delta: number,
): number {
  const centreX = toSceneX(sampleApexRoad(player.z, frame.roadPhase).x);
  const followX = centreX + (toSceneX(player.x) - centreX) * CAMERA_FOLLOW;
  return current === null ? followX : current + (followX - current) * Math.min(1, delta * 5);
}

// Matches apex-storm-renderer.ts's MAX_VEHICLE_SLOTS — a fixed pool of
// reusable meshes, hidden/shown per frame rather than created/destroyed.
const MAX_VEHICLE_SLOTS = 10;
// Slot 0 is reserved for the player; the rest are assigned to traffic below.
const MAX_TRAFFIC_SLOTS = MAX_VEHICLE_SLOTS - 1;

function SceneContent({ engine }: { engine: NativeGameEngine }) {
  const { latestFrame, latestScreenShake } = useApexNativeRenderer(engine);
  const roadHandle = useRef<RoadMeshHandle | null>(null);
  const skylineHandle = useRef<SkylineHandle | null>(null);
  const roadsideHandle = useRef<RoadsideHandle | null>(null);
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
  const skyLight = useRef<HemisphereLight>(null);
  // Smoothed camera X; null until the first frame so the camera snaps to the
  // player instead of sweeping in from x=0. Shared with Atmosphere so the
  // rain volume and sky backdrop ride along.
  const cameraX = useRef<number | null>(null);

  // A three.js PerspectiveCamera constructed from the `camera` prop keeps its
  // default identity orientation and looks down -Z, but the road sits in +Z
  // from this seat — without an explicit aim the whole scene lands behind the
  // camera and renders black. The follow logic in useFrame re-aims every
  // frame; this initial aim only covers the frames before the engine has
  // produced its first frame.
  useEffect(() => {
    camera.lookAt(0, LOOK_Y, LOOK_Z);
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

  // Assigns every traffic vehicle a stable pool slot and updates it.
  const syncTraffic = (frame: ApexStormFrame, player: ApexVehiclePose | undefined, selectedCar: CarType) => {
    const traffic = frame.vehicles.filter((v) => v.kind !== 'player');
    // Nearest-first: if traffic count exceeds the pool, the farthest
    // vehicles are the ones left unassigned below, not an arbitrary subset.
    traffic.sort((a, b) => b.depth - a.depth);

    const fadeStartZ = (player?.z ?? 0) - PASS_FADE_START;
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
      const fade = 1 - Math.max(0, Math.min(1, (fadeStartZ - pose.z) / PASS_FADE_LENGTH));
      vehicleHandles.current[slot]?.update(pose, selectedCar, fade);
    }
    for (const [id, slot] of assigned) {
      if (!present.has(id)) {
        assigned.delete(id);
        vehicleHandles.current[slot]?.update(undefined, selectedCar, 0);
        free.push(slot);
      }
    }
  };

  useFrame((_, delta) => {
    const frame = latestFrame.current;
    if (!frame) return;
    roadHandle.current?.update(frame.roadPhase, frame.travel);
    skylineHandle.current?.update(frame.travel);
    roadsideHandle.current?.update(frame.roadPhase, frame.travel);

    const selectedCar = engine.getState().selectedCar;

    const player = frame.vehicles.find((v) => v.kind === 'player');
    vehicleHandles.current[0]?.update(player, selectedCar, 1);

    syncTraffic(frame, player, selectedCar);

    const shake = shakeFor(latestScreenShake.current);
    if (flashMaterial.current) flashMaterial.current.opacity = shake.flash;

    if (player) cameraX.current = followCameraX(cameraX.current, player, frame, delta);
    const camX = cameraX.current ?? 0;
    const aheadX = toSceneX(sampleApexRoad(LOOK_Z, frame.roadPhase).x);
    camera.position.set(camX + shake.x, CAMERA_Y + shake.y, CAMERA_Z);
    camera.lookAt(camX + (aheadX - camX) * CAMERA_CURVE_LEAN, LOOK_Y, LOOK_Z);

    // Lightning: a brief lift of the sky fill (the backdrop brightens itself,
    // see Atmosphere). The old point light 30 units up the road fell off with
    // distance squared and lit nothing.
    if (skyLight.current) {
      skyLight.current.intensity = SKY_LIGHT_INTENSITY + frame.lightningIntensity * 5;
    }
  });

  return (
    <>
      {/* Crash flash: a screen-filling quad reparented onto the camera above
          (see the useEffect above) so it rides along without needing to be
          declared as the camera's JSX child. Lives outside <Suspense> —
          transparent/opacity-0 by default, never touches any async asset,
          so it never needs to survive a Suspense fallback the way the
          camera itself does. Sits just beyond the near plane (1). */}
      <mesh ref={flashMesh} position={[0, 0, -1.2]}>
        <planeGeometry args={[6, 6]} />
        <meshBasicMaterial
          ref={flashMaterial}
          color="#ff1a1a"
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {/* Light values are NOT the web renderer's numbers copied 1:1. Babylon's
          StandardMaterial has no 1/PI in its diffuse term; three.js's
          physically-based lights do, so the same intensities render ~3x
          darker here (every vehicle read as a black silhouette). The key
          light also has to come from BEHIND the camera (z < 0), like the web
          renderer's direction (-0.35,-1,0.35): it used to sit ahead of the
          cars and lit only the faces a chase camera never sees. */}
      <hemisphereLight ref={skyLight} args={['#86a8d8', '#1b2a45', SKY_LIGHT_INTENSITY]} />
      <directionalLight position={[-4, 12, -10]} intensity={3.4} color="#d6e6ff" />
      {/* Faint neon rim from up the road, in the magenta of the city glow.
          Kept weak: it faces the camera, so anything stronger turns the wet
          road into a blown-out pink specular sheet. */}
      <directionalLight position={[7, 9, 30]} intensity={0.3} color="#ff7ad9" />
      {/* Fog colour == clear colour == sky horizon (HAZE_COLOR) so the far
          end of the road and the distant towers dissolve into the sky. */}
      <fogExp2 attach="fog" args={[HAZE_COLOR, 0.012]} />
      {/* Road, skyline and atmosphere load no async asset (procedural
          geometry and textures), so none of them needs a Suspense boundary. */}
      <RoadSegments handleRef={roadHandle} />
      <Skyline handleRef={skylineHandle} />
      <Roadside handleRef={roadsideHandle} />
      {/* Vehicle model loading is fail-soft and non-suspending now: LoadedGltf
          loads imperatively (GLTFLoader.loadAsync + try/catch) and renders a
          grounded placeholder if the file:// URI is rejected on device, so it
          never throws into the app's root ErrorBoundary ("something went
          wrong, please reload"). Each slot still gets its OWN Suspense
          boundary so any future suspending child (or one slot re-mounting its
          model as traffic swaps) only blanks that one slot, never every
          already-loaded vehicle on screen. The camera itself must NOT be a
          descendant of any of these: see the useThree comment above for why
          that previously caused a fully black frame. */}
      {Array.from({ length: MAX_VEHICLE_SLOTS }, (_, i) => (
        <Suspense key={i} fallback={null}>
          <VehicleMesh index={i} ref={(h) => { vehicleHandles.current[i] = h; }} />
        </Suspense>
      ))}
      <Atmosphere frameRef={latestFrame} cameraXRef={cameraX} />
    </>
  );
}

export function R3FGameScene({ engine }: { engine: NativeGameEngine }) {
  return (
    <Canvas
      camera={{ position: [0, CAMERA_Y, CAMERA_Z], fov: CAMERA_FOV, near: 1, far: 420 }}
      gl={{ antialias: true }}
      onCreated={({ gl }) => {
        // three.js clears to opaque black by default. Black shows through as
        // a hard seam where fogged geometry ends and the empty void begins.
        // Clear to exactly the fog colour so nothing can show a seam.
        gl.setClearColor(HAZE_COLOR);
      }}
    >
      <SceneContent engine={engine} />
      <PostFX />
    </Canvas>
  );
}
