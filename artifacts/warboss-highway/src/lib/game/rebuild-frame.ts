import type { GameState, Vehicle } from '@workspace/game-core';

export const REBUILD_VIEWPORT = { width: 420, height: 800 } as const;
const HORIZON_Y = 142;
const PLAYER_CONTACT_Y = 690;
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
  const visualDepth = player ? 0.9 : depth;
  const trafficWidth = clamp(14 + 70 * Math.pow(depth, 1.32) * (vehicle.width / 48), 14, 92);
  const width = player ? clamp(190 + vehicle.width * 0.85, 210, 258) : trafficWidth;
  const height = width * spriteAspect(kind);
  const alpha = player ? 1 : clamp((depth - 0.03) / 0.18, 0, 1);
  const direction = vehicle.direction;

  return {
    id,
    kind,
    direction,
    x: groundX(vehicle.x, visualDepth),
    contactY: player ? PLAYER_CONTACT_Y : groundY(depth),
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
    { x: state.lanes[0], y: 40, width, height, direction: 'OPPOSITE' },
    { x: state.lanes[3], y: 250, width, height, direction: 'SAME' },
    { x: state.lanes[1], y: 470, width, height, direction: 'OPPOSITE' },
    { x: state.lanes[2], y: 590, width, height, direction: 'SAME' },
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
