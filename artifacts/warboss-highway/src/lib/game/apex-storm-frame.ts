import type { GameState, Player, Vehicle } from '@workspace/game-core';

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

export interface ApexVehiclePose {
  id: string;
  kind: ApexVehicleKind;
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

export interface ApexSteamVent {
  x: number;
  z: number;
  intensity: number;
}

export interface ApexStormFrame {
  roadPhase: number;
  road: readonly ApexRoadSegment[];
  vehicles: readonly ApexVehiclePose[];
  lightningIntensity: number;
  billboards: readonly ApexBillboardPose[];
  biome: ApexBiome;
  steamVents: readonly ApexSteamVent[];
}

type RoadEntity = Pick<Player, 'x' | 'y' | 'width' | 'height'> & {
  id: string;
  kind: ApexVehicleKind;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * The curve is intentionally a low-frequency centreline rather than a screen
 * skew. Its derivative also provides the only legal vehicle orientation.
 */
export function sampleApexRoad(z: number, roadPhase: number): ApexRoadSample {
  const primary = z * 0.082 + roadPhase;
  const secondary = z * 0.035 + roadPhase * 0.43;
  const x = Math.sin(primary) * 2.35 + Math.sin(secondary) * 0.9;
  const derivative = Math.cos(primary) * 2.35 * 0.082 + Math.cos(secondary) * 0.9 * 0.035;

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
  return clamp(((x - left) / Math.max(1, right - left)) * 2 - 1, -1, 1);
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
  const road = sampleApexRoad(z, state.roadOffset * 0.011);
  const lateral = laneRatio(state, entity.x) * (road.halfWidth - 1.25);
  const x = road.x + lateral;
  const width = clamp(1.25 + entity.width / 42, 1.55, 3.05);
  const length = width * (entity.kind === 'player' ? 2.05 : 1.85);
  const facesCamera = entity.kind === 'oncoming';

  return {
    id: entity.id,
    kind: entity.kind,
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

function toRoadEntity(vehicle: Vehicle): RoadEntity {
  return {
    id: `vehicle-${vehicle.lane}-${vehicle.variant}-${vehicle.x.toFixed(1)}-${vehicle.y.toFixed(1)}`,
    x: vehicle.x,
    y: vehicle.y,
    width: vehicle.width,
    height: vehicle.height,
    kind: vehicle.direction === 'OPPOSITE' ? 'oncoming' : 'same-direction',
  };
}

function demoFormation(state: GameState): RoadEntity[] {
  const [lane0 = 52.5, lane1 = 157.5, lane2 = 262.5, lane3 = 367.5] = state.lanes;
  return [
    { id: 'demo-far-oncoming', x: lane0, y: -65, width: 48, height: 80, kind: 'oncoming' },
    { id: 'demo-mid-same', x: lane3, y: 120, width: 48, height: 80, kind: 'same-direction' },
    { id: 'demo-near-oncoming', x: lane1, y: 315, width: 48, height: 80, kind: 'oncoming' },
    { id: 'demo-near-same', x: lane2, y: 455, width: 48, height: 80, kind: 'same-direction' },
  ];
}

export function buildApexStormFrame(state: GameState, options?: { demo?: boolean }): ApexStormFrame {
  const roadPhase = state.roadOffset * 0.011;
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
  const player: RoadEntity = { id: 'player', ...state.player, kind: 'player' };
  const vehicles = [player, ...traffic]
    .map((entity) => vehiclePose(state, entity))
    .sort((a, b) => b.z - a.z);

  // Deterministic lightning based on roadOffset
  const lightningPhase = (state.roadOffset * 0.0007) % 1;
  const lightningIntensity = lightningPhase < 0.02 ? Math.sin((lightningPhase / 0.02) * Math.PI) : 0;

  // Fixed billboard anchors
  const billboards: ApexBillboardPose[] = [
    { id: 'billboard-1', x: -12, z: 35, side: -1, width: 8, height: 4, color: '#ff00ff' },
    { id: 'billboard-2', x: 12, z: 55, side: 1, width: 6, height: 9, color: '#00ffff' },
  ];

  // District biome logic (alternates every 500m)
  const biome: ApexBiome = (state.roadOffset % 1000) < 500 ? 'highway' : 'tunnel';

  // Steam vents only in tunnel biome
  const steamVents: ApexSteamVent[] = biome === 'tunnel' ? [
    { x: -5, z: 20, intensity: 0.8 },
    { x: 5, z: 45, intensity: 0.6 },
  ] : [];

  return { roadPhase, road, vehicles, lightningIntensity, billboards, biome, steamVents };
}
