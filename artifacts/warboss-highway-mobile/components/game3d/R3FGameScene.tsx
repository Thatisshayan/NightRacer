import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { sampleApexRoad, type ApexStormFrame, type ApexVehiclePose } from '@workspace/render-frame';
import type { CarType } from '@workspace/game-core';
import type { NativeGameEngine } from '../game/native-engine';
import { useApexNativeRenderer } from './r3f-renderer';
import { RoadSegments, type RoadMeshHandle } from './RoadMesh';
import { Skyline, type SkylineHandle } from './Skyline';
import { Roadside, type RoadsideHandle } from './Roadside';
import { VehicleMesh, preloadVehicleModels, type VehicleMeshHandle, type VehicleMotion } from './VehicleMesh';
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
// The aim is only slightly below the horizon: the art-direction target puts
// the horizon about a third of the way down the screen with the city towering
// over the road. Aimed lower (LOOK_Y = -3.3), the city was a thin strip
// hidden behind the HUD.
const CAMERA_Y = 6.0;
const CAMERA_Z = -12.2;
const CAMERA_FOV = 52;
const LOOK_Y = 0.4;
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

// Traffic drawn on top of the player (it keeps driving through after a crash,
// during the grace period) is ghosted to this opacity so the player's car is
// never swallowed by a truck body.
const OVERLAP_OPACITY = 0.28;
// Longest the run will wait for the player's model before starting anyway.
const READY_TIMEOUT_MS = 1500;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

// @workspace/render-frame's coordinates come from the Babylon web renderer,
// which is LEFT-handed: looking down +Z, +X is screen-right. three.js is
// right-handed: looking down +Z, +X is screen-LEFT. Every frame X (and every
// heading) is therefore negated on its way into this scene — here, in
// RoadMesh and in VehicleMesh. Without this the whole scene is mirrored and
// dragging right steers the car left on screen.
const toSceneX = (frameX: number) => -frameX;

function overlapsPlayer(pose: ApexVehiclePose, player: ApexVehiclePose | undefined): boolean {
  if (!player) return false;
  const lateral = Math.abs(pose.x - player.x) < (pose.width + player.width) / 2;
  // Visual length is roughly 2-4x the width depending on the model.
  const along = Math.abs(pose.z - player.z) < pose.width * 1.9 + player.width;
  return lateral && along;
}

/** Motion inputs for one vehicle: where it sits across the road, and timing. */
function motionFor(pose: ApexVehiclePose, frame: ApexStormFrame, dt: number): VehicleMotion {
  const centre = sampleApexRoad(pose.z, frame.roadPhase).x;
  return { lateral: toSceneX(pose.x - centre), dt, speed: frame.speed };
}

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

type VehicleHandles = MutableRefObject<(VehicleMeshHandle | null)[]>;

// frame.vehicles is sorted by depth (farthest first) for draw order, not by
// identity — indexing vehicleHandles[i] = frame.vehicles[i] directly (the
// prior approach) meant a pool slot's occupant silently changed whenever two
// entities crossed z-order (a different GLTF reloading into the same slot),
// and once total tracked entities exceeded MAX_VEHICLE_SLOTS, the *nearest*
// entities — often including the player itself — were the ones sorted past
// the cutoff and simply never rendered. Traffic gets a stable slot by id, and
// overflow drops the farthest traffic instead of whatever the sort excluded.
function useTrafficPool(handles: VehicleHandles) {
  const slotById = useRef<Map<string, number>>(new Map());
  const freeSlots = useRef<number[]>(Array.from({ length: MAX_TRAFFIC_SLOTS }, (_, i) => MAX_TRAFFIC_SLOTS - i));

  return (frame: ApexStormFrame, player: ApexVehiclePose | undefined, selectedCar: CarType, dt: number) => {
    const traffic = frame.vehicles.filter((v) => v.kind !== 'player');
    // Nearest-first: if traffic count exceeds the pool, the farthest
    // vehicles are the ones left unassigned below, not an arbitrary subset.
    traffic.sort((a, b) => b.depth - a.depth);

    const fadeStartZ = (player?.z ?? 0) - PASS_FADE_START;
    const present = new Set<string>();
    for (const pose of traffic) {
      present.add(pose.id);
      let slot = slotById.current.get(pose.id);
      if (slot === undefined) {
        slot = freeSlots.current.pop();
        if (slot === undefined) continue; // pool exhausted this frame — farthest traffic skipped
        slotById.current.set(pose.id, slot);
      }
      const passFade = 1 - clamp((fadeStartZ - pose.z) / PASS_FADE_LENGTH, 0, 1);
      const fade = overlapsPlayer(pose, player) ? Math.min(passFade, OVERLAP_OPACITY) : passFade;
      handles.current[slot]?.update(pose, selectedCar, fade, motionFor(pose, frame, dt));
    }
    for (const [id, slot] of slotById.current) {
      if (!present.has(id)) {
        slotById.current.delete(id);
        handles.current[slot]?.update(undefined, selectedCar, 0);
        freeSlots.current.push(slot);
      }
    }
  };
}

// Tells the screen the scene is drawable, once: after a frame has been
// rendered and the player's car is present (or a short timeout). The
// simulation is not started until then, so the first second of a run no
// longer plays out behind a black, still-initialising GL view.
function useReadySignal(handles: VehicleHandles, onReady: (() => void) | undefined) {
  const firstFrameAt = useRef<number | null>(null);
  const fired = useRef(false);
  return () => {
    if (fired.current) return;
    const now = performance.now();
    if (firstFrameAt.current === null) firstFrameAt.current = now;
    const playerLoaded = handles.current[0]?.isLoaded() ?? false;
    if (playerLoaded || now - firstFrameAt.current > READY_TIMEOUT_MS) {
      fired.current = true;
      onReady?.();
    }
  };
}

// The chase camera. Beyond following the player it carries the motion cues a
// fixed rig lacks: it banks slightly into lateral movement, and as speed
// builds it widens its field of view and drops back, so going faster actually
// looks faster instead of only scrolling the road quicker.
function useChaseCamera(cameraX: MutableRefObject<number | null>) {
  // The Canvas's own default camera (set via the `camera` prop below) — read
  // through useThree rather than defined as JSX so it lives entirely outside
  // <Suspense>. A camera defined as Suspense's child gets unmounted along
  // with everything else whenever a child suspends, which once left the scene
  // with no active camera at all: a fully black frame.
  const { camera } = useThree();
  const roll = useRef(0);
  const fov = useRef(CAMERA_FOV);

  // A PerspectiveCamera built from the `camera` prop looks down -Z, but the
  // road sits in +Z from this seat — without an explicit aim the whole scene
  // lands behind the camera and renders black. This covers the frames before
  // the first update below.
  useEffect(() => {
    camera.lookAt(0, LOOK_Y, LOOK_Z);
  }, [camera]);

  const update = (
    frame: ApexStormFrame,
    player: ApexVehiclePose | undefined,
    shake: { x: number; y: number },
    delta: number,
  ) => {
    const previous = cameraX.current;
    if (player) cameraX.current = followCameraX(previous, player, frame, delta);
    const camX = cameraX.current ?? 0;
    const velocity = previous === null || delta <= 0 ? 0 : (camX - previous) / delta;
    roll.current += (clamp(-velocity * 0.012, -0.06, 0.06) - roll.current) * Math.min(1, delta * 6);

    const boost = Math.max(0, frame.speed - 1);
    const pullBack = Math.min(2.2, boost * 1.1);
    const aheadX = toSceneX(sampleApexRoad(LOOK_Z, frame.roadPhase).x);
    camera.position.set(camX + shake.x, CAMERA_Y + shake.y + pullBack * 0.25, CAMERA_Z - pullBack);
    camera.lookAt(camX + (aheadX - camX) * CAMERA_CURVE_LEAN, LOOK_Y, LOOK_Z);
    camera.rotateZ(roll.current);

    const targetFov = CAMERA_FOV + Math.min(9, boost * 4.5) + (frame.rush ? 5 : 0);
    fov.current += (targetFov - fov.current) * Math.min(1, delta * 3);
    const perspective = camera as PerspectiveCamera;
    if (Math.abs(perspective.fov - fov.current) > 0.02) {
      perspective.fov = fov.current;
      perspective.updateProjectionMatrix();
    }
  };
  return { camera, update };
}

// Crash flash: a screen-filling quad reparented onto the camera so it rides
// along without being declared as the camera's JSX child. Lives outside
// <Suspense> — transparent by default, never touches any async asset. Sits
// just beyond the near plane (1).
function CrashFlash({ materialRef }: { materialRef: RefObject<MeshBasicMaterial | null> }) {
  const { camera } = useThree();
  const mesh = useRef<Mesh>(null);
  useEffect(() => {
    const quad = mesh.current;
    if (!quad) return;
    camera.add(quad);
    return () => {
      camera.remove(quad);
    };
  }, [camera]);
  return (
    <mesh ref={mesh} position={[0, 0, -1.2]}>
      <planeGeometry args={[6, 6]} />
      <meshBasicMaterial ref={materialRef} color="#ff1a1a" transparent opacity={0} depthTest={false} depthWrite={false} />
    </mesh>
  );
}

function SceneLights({ skyLight }: { skyLight: RefObject<HemisphereLight | null> }) {
  return (
    <>
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
    </>
  );
}

function SceneContent({ engine, onReady }: { engine: NativeGameEngine; onReady?: () => void }) {
  const { latestFrame, latestScreenShake } = useApexNativeRenderer(engine);
  const roadHandle = useRef<RoadMeshHandle | null>(null);
  const skylineHandle = useRef<SkylineHandle | null>(null);
  const roadsideHandle = useRef<RoadsideHandle | null>(null);
  const vehicleHandles = useRef<(VehicleMeshHandle | null)[]>([]);
  const flashMaterial = useRef<MeshBasicMaterial | null>(null);
  const skyLight = useRef<HemisphereLight>(null);
  // Smoothed camera X; null until the first frame so the camera snaps to the
  // player instead of sweeping in from x=0. Shared with Atmosphere so the
  // rain volume and sky backdrop ride along.
  const cameraX = useRef<number | null>(null);
  const chase = useChaseCamera(cameraX);
  const syncTraffic = useTrafficPool(vehicleHandles);
  const signalReady = useReadySignal(vehicleHandles, onReady);

  useEffect(() => {
    preloadVehicleModels();
  }, []);

  useFrame((_, delta) => {
    const frame = latestFrame.current;
    if (!frame) return;
    roadHandle.current?.update(frame.roadPhase, frame.travel);
    skylineHandle.current?.update(frame.travel);
    roadsideHandle.current?.update(frame.roadPhase, frame.travel);

    const selectedCar = engine.getState().selectedCar;
    const player = frame.vehicles.find((v) => v.kind === 'player');
    // Blink the player during the post-crash grace period: the standard
    // "you were hit, you are briefly safe" signal.
    const blink = frame.playerInvulnerable && Math.sin(performance.now() * 0.03) > 0 ? 0.35 : 1;
    vehicleHandles.current[0]?.update(player, selectedCar, blink, player && motionFor(player, frame, delta));
    signalReady();
    syncTraffic(frame, player, selectedCar, delta);

    const shake = shakeFor(latestScreenShake.current);
    if (flashMaterial.current) flashMaterial.current.opacity = shake.flash;
    chase.update(frame, player, shake, delta);

    // Lightning: a brief lift of the sky fill (the backdrop brightens itself,
    // see Atmosphere).
    if (skyLight.current) skyLight.current.intensity = SKY_LIGHT_INTENSITY + frame.lightningIntensity * 5;
  });

  return (
    <>
      <CrashFlash materialRef={flashMaterial} />
      <SceneLights skyLight={skyLight} />
      {/* Road, skyline, roadside and atmosphere load no async asset
          (procedural geometry and textures), so none needs a Suspense
          boundary. */}
      <RoadSegments handleRef={roadHandle} />
      <Skyline handleRef={skylineHandle} />
      <Roadside handleRef={roadsideHandle} />
      {/* Vehicle model loading is fail-soft and non-suspending: LoadedGltf
          loads imperatively and renders a grounded placeholder on failure, so
          it never throws into the app's root ErrorBoundary. Each slot still
          gets its OWN Suspense boundary so any future suspending child only
          blanks that one slot. The camera must NOT be a descendant of any of
          these: see useChaseCamera for why that once caused a black frame. */}
      {Array.from({ length: MAX_VEHICLE_SLOTS }, (_, i) => (
        <Suspense key={i} fallback={null}>
          <VehicleMesh index={i} ref={(h) => { vehicleHandles.current[i] = h; }} />
        </Suspense>
      ))}
      <Atmosphere frameRef={latestFrame} cameraXRef={cameraX} />
    </>
  );
}

export function R3FGameScene({ engine, onReady }: { engine: NativeGameEngine; onReady?: () => void }) {
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
      <SceneContent engine={engine} onReady={onReady} />
      <PostFX />
    </Canvas>
  );
}
