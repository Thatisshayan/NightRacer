import type { GameState, Vehicle } from '@workspace/game-core';

export const REBUILD_VIEWPORT = { width: 420, height: 800 } as const;
const HORIZON_Y = 142;
const PLAYER_DEPTH = 0.87;
const SPAWN_ROW = -160;
const ROAD_END_ROW = 800;

export type RebuildVehicleKind = 'player' | 'traffic-rear' | 'traffic-front';

export interface GroundPose {
  x: number;
  contactY: number;
  width: number;
  height: number;
  depth: number;
  alpha: number;
}

export interface RebuildVehiclePose extends GroundPose {
  id: string;
  kind: RebuildVehicleKind;
  direction: 'SAME' | 'OPPOSITE';
  lightColor: string;
}

export interface RebuildFrame {
  roadOffset: number;
  player: RebuildVehiclePose;
  vehicles: RebuildVehiclePose[];
}

interface VehicleLike {
  x: number;
  y: number;
  width: number;
  height: number;
  direction: 'SAME' | 'OPPOSITE';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function depthForRow(worldY: number): number {
  return clamp((worldY - SPAWN_ROW) / (ROAD_END_ROW - SPAWN_ROW), 0, 1);
}

export function roadHalfWidth(depth: number): number {
  return 24 + 184 * Math.pow(depth, 1.08);
}

export function groundY(depth: number): number {
  return HORIZON_Y + (REBUILD_VIEWPORT.height - HORIZON_Y) * Math.pow(depth, 1.42);
}

function groundX(worldX: number, depth: number): number {
  const laneRelativeX = (worldX - REBUILD_VIEWPORT.width / 2) / (REBUILD_VIEWPORT.width / 2);
  return REBUILD_VIEWPORT.width / 2 + laneRelativeX * roadHalfWidth(depth) * 0.94;
}

function spriteAspect(kind: RebuildVehicleKind): number {
  if (kind === 'player') return 301 / 640;
  if (kind === 'traffic-rear') return 263 / 512;
  return 224 / 512;
}

function vehiclePose(id: string, vehicle: VehicleLike, kind: RebuildVehicleKind, player = false): RebuildVehiclePose {
  const contactRow = vehicle.y + vehicle.height / 2;
  const depth = depthForRow(contactRow);
  const visualDepth = player ? PLAYER_DEPTH : depth;
  const trafficWidth = clamp(14 + 70 * Math.pow(depth, 1.32) * (vehicle.width / 48), 14, 92);
  // A player wider than two near-field lanes read as a foreground poster rather
  // than a vehicle. This range keeps each selected car close to one visual lane
  // while still preserving the width distinction authored in CAR_STATS.
  const width = player ? clamp(94 + vehicle.width * 0.65, 118, 142) : trafficWidth;
  const height = width * spriteAspect(kind);
  const alpha = player ? 1 : clamp((depth - 0.03) / 0.18, 0, 1);
  const direction = vehicle.direction;

  return {
    id,
    kind,
    direction,
    x: groundX(vehicle.x, visualDepth),
    // Player contact must be generated from exactly the same ground-depth
    // mapping as traffic; a fixed screen Y was the remaining scale mismatch.
    contactY: groundY(visualDepth),
    width,
    height,
    depth: visualDepth,
    alpha,
    lightColor: direction === 'OPPOSITE' ? '#eaf7ff' : '#ff3d67',
  };
}

function vehicleKind(vehicle: VehicleLike): RebuildVehicleKind {
  return vehicle.direction === 'OPPOSITE' ? 'traffic-front' : 'traffic-rear';
}

function createGroundingFormation(state: GameState): RebuildVehiclePose[] {
  const width = 48;
  const height = 80;
  const formation: VehicleLike[] = [
    { x: state.lanes[0], y: 0, width, height, direction: 'OPPOSITE' },
    { x: state.lanes[3], y: 145, width, height, direction: 'SAME' },
    { x: state.lanes[1], y: 285, width, height, direction: 'OPPOSITE' },
    { x: state.lanes[2], y: 425, width, height, direction: 'SAME' },
  ];

  return formation
    .map((vehicle, index) => vehiclePose(`demo-${index}`, vehicle, vehicleKind(vehicle)))
    .sort((a, b) => a.depth - b.depth);
}

export function buildRebuildFrame(state: GameState, demoGrounding = false): RebuildFrame {
  const player = vehiclePose('player', { ...state.player, direction: 'SAME' }, 'player', true);
  const vehicles = demoGrounding
    ? createGroundingFormation(state)
    : state.vehicles
      .map((vehicle: Vehicle) => vehiclePose(`vehicle-${vehicle.lane}-${vehicle.y}-${vehicle.variant}`, vehicle, vehicleKind(vehicle)))
      .filter((vehicle) => vehicle.alpha > 0.01)
      .sort((a, b) => a.depth - b.depth);

  return { roadOffset: state.roadOffset, player, vehicles };
}
