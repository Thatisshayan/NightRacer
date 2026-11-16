import type { GameObject, GameState, ObstacleType, Player, PowerUpType, Vehicle, VehicleType } from '@workspace/game-core';

/**
 * A renderer-independent road layout for Apex Storm.
 *
 * This module deliberately owns no browser, React, Pixi, Babylon, or Skia
 * state. It converts the authoritative flat game state into a repeatable
 * road-relative scene. Renderer adapters may draw it, but may never create a
 * competing vehicle/shadow/reflection projection.
 */
export const APEX_STORM_VIEWPORT = { width: 420, height: 800 } as const;
export const APEX_STORM_ROAD = {
  nearZ: -12,
  farZ: 70,
  halfWidth: 6.5,
  segmentCount: 22,
} as const;

export type ApexVehicleKind = 'player' | 'same-direction' | 'oncoming';

export interface ApexRoadSample {
  x: number;
  z: number;
  heading: number;
  halfWidth: number;
}

export interface ApexWheelContact {
  x: number;
  y: 0;
  z: number;
}

/** Which concrete model a renderer should pick for this pose — 'PLAYER' maps
 * to the selected CarType elsewhere (GameState.selectedCar), since the pose
 * itself only tracks lane/kind, not which of the 5 player cars is active. */
export type ApexVehicleModelType = VehicleType | 'PLAYER';

export interface ApexVehiclePose {
  id: string;
  kind: ApexVehicleKind;
  vehicleType: ApexVehicleModelType;
  /** Centre of the chassis. The chassis rises from the shared road plane. */
  x: number;
  y: number;
  z: number;
  heading: number;
  width: number;
  length: number;
  depth: number;
  alpha: number;
  wheelContacts: readonly ApexWheelContact[];
  shadow: {
    x: number;
    z: number;
    radiusX: number;
    radiusZ: number;
    alpha: number;
  };
  reflection: {
    x: number;
    z: number;
    length: number;
    alpha: number;
  };
  lights: {
    color: string;
    intensity: number;
    facesCamera: boolean;
  };
}

export interface ApexRoadSegment {
  index: number;
  start: ApexRoadSample;
  end: ApexRoadSample;
  wetness: number;
}

export type ApexBiome = 'highway' | 'tunnel';

export interface ApexBillboardPose {
  id: string;
  x: number;
  z: number;
  side: -1 | 1;
  width: number;
  height: number;
  color: string;
}

/** A power-up to collect or a hazard to avoid, lying on the road. */
export interface ApexItemPose {
  type: PowerUpType | ObstacleType;
  x: number;
  z: number;
  /** Footprint across and along the road, from the simulation hitbox. */
  width: number;
  length: number;
  alpha: number;
}

export interface ApexSteamVent {
  x: number;
  z: number;
  intensity: number;
}

export interface ApexStormFrame {
  roadPhase: number;
  /** Monotonic distance the road surface has scrolled toward the camera, in
   * world units. Renderers scroll road textures / roadside scenery with it. */
  travel: number;
  /** True during the post-crash grace period, while traffic passes through
   * the player without registering a hit. Renderers should show it. */
  playerInvulnerable: boolean;
  /** Current speed multiplier (1 = base speed), for speed-dependent camera
   * and weather effects. */
  speed: number;
  /** True while a Rush burst is active. */
  rush: boolean;
  road: readonly ApexRoadSegment[];
  vehicles: readonly ApexVehiclePose[];
  /** Power-ups and obstacles. The simulation collides with these, so a
   * renderer that skips them leaves the player hitting invisible hazards. */
  items: readonly ApexItemPose[];
  lightningIntensity: number;
  billboards: readonly ApexBillboardPose[];
  biome: ApexBiome;
  steamVents: readonly ApexSteamVent[];
}

type RoadEntity = Pick<Player, 'x' | 'y' | 'width' | 'height'> & {
  id: string;
  kind: ApexVehicleKind;
  vehicleType: ApexVehicleModelType;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const ROAD_PRIMARY_FREQUENCY = 0.03;
const ROAD_SECONDARY_FREQUENCY = 0.013;

/** World units per simulation pixel along the road (the 960px depth band maps
 * onto nearZ..farZ in depthToZ below). */
const UNITS_PER_PIXEL = (APEX_STORM_ROAD.farZ - APEX_STORM_ROAD.nearZ) / 960;

/**
 * Monotonic road travel in scroll pixels.
 *
 * This must NOT be derived from `state.roadOffset`: the engine wraps that
 * value at 80px because it only exists to scroll a repeating 2D road tile.
 * Driving the curve phase from it made the whole 3D road (and every vehicle
 * on it) snap back to its starting shape several times a second, and made
 * the lightning/biome logic below fire on that same sub-second sawtooth.
 * `state.distance` never wraps; x1.5 matches the engine's road-scroll rate.
 */
function roadTravelPixels(state: Pick<GameState, 'distance'>): number {
  return state.distance * 1.5;
}

/** Curve phase per scroll pixel, chosen so the bends travel toward the camera
 * at exactly the speed the road surface scrolls: the curve is then fixed to
 * the tarmac (and to the roadside scenery) instead of sliding along it. */
const CURVE_PHASE_PER_PIXEL = UNITS_PER_PIXEL * ROAD_PRIMARY_FREQUENCY;

function roadPhaseFor(state: Pick<GameState, 'distance'>): number {
  return roadTravelPixels(state) * CURVE_PHASE_PER_PIXEL;
}
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * The curve is intentionally a low-frequency centreline rather than a screen
 * skew. Its derivative also provides the only legal vehicle orientation.
 */
export function sampleApexRoad(z: number, roadPhase: number): ApexRoadSample {
  // Spatial frequencies are deliberately low: one bend spans roughly the
  // whole visible road. At the previous 0.082 / 0.035 the ~200 units a chase
  // camera can see held two and a half full S-bends, so the highway read as
  // a wriggling ribbon rather than a road.
  const primary = z * ROAD_PRIMARY_FREQUENCY + roadPhase;
  const secondary = z * ROAD_SECONDARY_FREQUENCY + roadPhase * 0.43;
  const x = Math.sin(primary) * 2.35 + Math.sin(secondary) * 0.9;
  const derivative =
    Math.cos(primary) * 2.35 * ROAD_PRIMARY_FREQUENCY + Math.cos(secondary) * 0.9 * ROAD_SECONDARY_FREQUENCY;

  return {
    x,
    z,
    heading: Math.atan2(derivative, 1),
    halfWidth: APEX_STORM_ROAD.halfWidth,
  };
}

function playerDepth(player: Pick<Player, 'y'>): number {
  // Player Y remains controllable in the shared simulation. Its allowed range
  // maps to a stable near-field band, never to a separate screen-space anchor.
  return clamp(0.79 + (player.y - 720) / 900, 0.7, 0.9);
}

function entityDepth(entity: Pick<RoadEntity, 'y' | 'height'>): number {
  const contactRow = entity.y + entity.height / 2;
  return clamp((contactRow + 160) / 960, 0.02, 0.98);
}

function depthToZ(depth: number): number {
  return lerp(APEX_STORM_ROAD.farZ, APEX_STORM_ROAD.nearZ, depth);
}

function laneRatio(state: GameState, x: number): number {
  const left = state.lanes[0] ?? 52.5;
  const right = state.lanes[state.lanes.length - 1] ?? 367.5;
  // Not clamped to the outer lane centres: the player (and obstacles) can
  // sit up to ~20px beyond them. Clamping drew the car inside its real
  // position at the road edge, so its hitbox was offset from what was shown.
  return clamp(((x - left) / Math.max(1, right - left)) * 2 - 1, -1.13, 1.13);
}

function wheelContacts(x: number, z: number, heading: number, width: number, length: number): ApexWheelContact[] {
  const forwardX = Math.sin(heading);
  const forwardZ = Math.cos(heading);
  const sideX = Math.cos(heading);
  const sideZ = -Math.sin(heading);
  const wheelX = width * 0.36;
  const wheelZ = length * 0.34;
  const contact = (side: -1 | 1, fore: -1 | 1): ApexWheelContact => ({
    x: x + sideX * wheelX * side + forwardX * wheelZ * fore,
    y: 0,
    z: z + sideZ * wheelX * side + forwardZ * wheelZ * fore,
  });
  return [contact(-1, -1), contact(1, -1), contact(-1, 1), contact(1, 1)];
}

function vehiclePose(state: GameState, entity: RoadEntity): ApexVehiclePose {
  const depth = entity.kind === 'player' ? playerDepth(entity) : entityDepth(entity);
  const z = depthToZ(depth);
  const road = sampleApexRoad(z, roadPhaseFor(state));
  const lateral = laneRatio(state, entity.x) * (road.halfWidth - 1.25);
  const x = road.x + lateral;
  // Visual width tracks the simulation hitbox. The lane positions map
  // (laneRatio above) onto +-(halfWidth - 1.25) world units, which fixes the
  // lateral world-units-per-pixel scale; sizing vehicles from an unrelated
  // formula made them ~50% wider than what the engine collides with, so cars
  // visibly overlapped while passing without registering a hit. The small
  // margin keeps bodywork from looking thinner than its hitbox.
  const laneSpanPixels = Math.max(1, (state.lanes[state.lanes.length - 1] ?? 367.5) - (state.lanes[0] ?? 52.5));
  const unitsPerPixel = ((road.halfWidth - 1.25) * 2) / laneSpanPixels;
  const width = clamp(entity.width * unitsPerPixel * 1.1, 0.9, 3.4);
  const length = width * (entity.kind === 'player' ? 2.05 : 1.85);
  const facesCamera = entity.kind === 'oncoming';

  return {
    id: entity.id,
    kind: entity.kind,
    vehicleType: entity.vehicleType,
    x,
    // The chassis lift is a physical height above exactly the wheel-contact plane.
    y: width * 0.18,
    z,
    heading: road.heading + (facesCamera ? Math.PI : 0),
    width,
    length,
    depth,
    alpha: entity.kind === 'player' ? 1 : clamp((depth - 0.015) / 0.13, 0, 1),
    wheelContacts: wheelContacts(x, z, road.heading, width, length),
    shadow: { x, z: z + 0.1, radiusX: width * 0.58, radiusZ: length * 0.42, alpha: entity.kind === 'player' ? 0.3 : 0.22 },
    reflection: { x, z: z - length * 0.48, length: length * 0.9, alpha: entity.kind === 'player' ? 0.28 : 0.16 },
    lights: { color: facesCamera ? '#d7f5ff' : '#ff3f53', intensity: entity.kind === 'player' ? 1 : 0.72, facesCamera },
  };
}

function itemPose(state: GameState, item: GameObject & { type: PowerUpType | ObstacleType }): ApexItemPose {
  const depth = entityDepth(item);
  const z = depthToZ(depth);
  const road = sampleApexRoad(z, roadPhaseFor(state));
  const laneSpanPixels = Math.max(1, (state.lanes[state.lanes.length - 1] ?? 367.5) - (state.lanes[0] ?? 52.5));
  const unitsPerPixel = ((road.halfWidth - 1.25) * 2) / laneSpanPixels;
  return {
    type: item.type,
    x: road.x + laneRatio(state, item.x) * (road.halfWidth - 1.25),
    z,
    width: item.width * unitsPerPixel,
    length: item.height * UNITS_PER_PIXEL,
    alpha: clamp((depth - 0.015) / 0.13, 0, 1),
  };
}

function toRoadEntity(vehicle: Vehicle): RoadEntity {
  return {
    // Must be the vehicle's own stable spawn id, not derived from its
    // position — R3FGameScene.tsx assigns each id a pool slot for the whole
    // time it's on screen, so a position-derived id (which changes every
    // frame as the vehicle moves) made every vehicle look "new" each tick,
    // thrashing pool slots and forcing constant GLTF remounts.
    id: vehicle.id,
    x: vehicle.x,
    y: vehicle.y,
    width: vehicle.width,
    height: vehicle.height,
    kind: vehicle.direction === 'OPPOSITE' ? 'oncoming' : 'same-direction',
    vehicleType: vehicle.type,
  };
}

function demoFormation(state: GameState): RoadEntity[] {
  const [lane0 = 52.5, lane1 = 157.5, lane2 = 262.5, lane3 = 367.5] = state.lanes;
  return [
    { id: 'demo-far-oncoming', x: lane0, y: -65, width: 48, height: 80, kind: 'oncoming', vehicleType: 'SEDAN' },
    { id: 'demo-mid-same', x: lane3, y: 120, width: 48, height: 80, kind: 'same-direction', vehicleType: 'BUS' },
    { id: 'demo-near-oncoming', x: lane1, y: 315, width: 48, height: 80, kind: 'oncoming', vehicleType: 'SPORTS' },
    { id: 'demo-near-same', x: lane2, y: 455, width: 48, height: 80, kind: 'same-direction', vehicleType: 'PICKUP' },
  ];
}

export function buildApexStormFrame(state: GameState, options?: { demo?: boolean }): ApexStormFrame {
  const travelPixels = roadTravelPixels(state);
  const roadPhase = roadPhaseFor(state);
  const spacing = (APEX_STORM_ROAD.farZ - APEX_STORM_ROAD.nearZ) / APEX_STORM_ROAD.segmentCount;
  const road = Array.from({ length: APEX_STORM_ROAD.segmentCount }, (_, index) => {
    const startZ = APEX_STORM_ROAD.nearZ + spacing * index;
    const endZ = startZ + spacing;
    return {
      index,
      start: sampleApexRoad(startZ, roadPhase),
      end: sampleApexRoad(endZ, roadPhase),
      wetness: 0.62 + ((index * 17) % 5) * 0.055,
    };
  });
  const traffic = options?.demo ? demoFormation(state) : state.vehicles.map(toRoadEntity);
  const player: RoadEntity = { id: 'player', ...state.player, kind: 'player', vehicleType: 'PLAYER' };
  const vehicles = [player, ...traffic]
    .map((entity) => vehiclePose(state, entity))
    .sort((a, b) => b.z - a.z);

  // Deterministic lightning: one short flash roughly every 4000 scroll px
  // (~9s at base speed), derived from monotonic travel (see roadTravelPixels).
  const lightningPhase = (travelPixels * 0.00025) % 1;
  const lightningIntensity = lightningPhase < 0.012 ? Math.sin((lightningPhase / 0.012) * Math.PI) : 0;

  // Fixed billboard anchors
  const billboards: ApexBillboardPose[] = [
    { id: 'billboard-1', x: -12, z: 35, side: -1, width: 8, height: 4, color: '#ff00ff' },
    { id: 'billboard-2', x: 12, z: 55, side: 1, width: 6, height: 9, color: '#00ffff' },
  ];

  // District biome logic: 6000m of open highway, then a 2000m tunnel.
  const biome: ApexBiome = (state.distance % 8000) < 6000 ? 'highway' : 'tunnel';

  // Steam vents only in tunnel biome
  const steamVents: ApexSteamVent[] = biome === 'tunnel' ? [
    { x: -5, z: 20, intensity: 0.8 },
    { x: 5, z: 45, intensity: 0.6 },
  ] : [];

  return {
    roadPhase,
    travel: travelPixels * UNITS_PER_PIXEL,
    playerInvulnerable: state.player.isInvulnerable,
    speed: state.speedMultiplier,
    rush: state.rushTimer > 0,
    road,
    vehicles,
    items: [...state.powerups, ...state.obstacles].map((item) => itemPose(state, item)),
    lightningIntensity,
    billboards,
    biome,
    steamVents,
  };
}
