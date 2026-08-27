import type { GameRenderer, GameState } from '@workspace/game-core';
import {
  buildRebuildFrame,
  groundY,
  roadHalfWidth,
  type RebuildFrame,
  type RebuildVehiclePose,
} from './rebuild-frame';

const SKY_TOP = '#030613';
const SKY_HORIZON = '#12233e';
const ROAD_DARK = '#09101f';
const ROAD_LIGHT = '#172844';
const ROAD_SEAM = 'rgba(113, 173, 225, 0.15)';
const RAIL = '#27d9ff';
const AMBER = '#ffb347';

interface RebuildTextures {
  player: HTMLImageElement;
  trafficRear: HTMLImageElement;
  trafficFront: HTMLImageElement;
}

function baseAssetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}sprites/rebuild/${file}`;
}

function loadImage(file: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load rebuild texture: ${file}`));
    image.src = baseAssetUrl(file);
  });
}

function rgba(hex: string, alpha: number): string {
  const raw = hex.slice(1);
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class RebuildRenderer implements GameRenderer {
  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly textures: RebuildTextures,
    private readonly demoGrounding: boolean,
  ) {}

  static async create(host: HTMLElement, width: number, height: number, demoGrounding = false): Promise<RebuildRenderer> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.className = 'block h-full w-full object-cover';
    canvas.style.pointerEvents = 'none';
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable for the rebuild renderer');

    const [player, trafficRear, trafficFront] = await Promise.all([
      loadImage('player-rear.png'),
      loadImage('traffic-rear.png'),
      loadImage('traffic-front.png'),
    ]);
    return new RebuildRenderer(canvas, ctx, { player, trafficRear, trafficFront }, demoGrounding);
  }

  sync(state: GameState): void {
    const frame = buildRebuildFrame(state, this.demoGrounding);
    this.drawFrame(frame);
  }

  private drawFrame(frame: RebuildFrame): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawSky();
    this.drawCity();
    this.drawRoad(frame.roadOffset);
    for (const vehicle of frame.vehicles) this.drawVehicle(vehicle);
    this.drawVehicle(frame.player);
  }

  private drawSky(): void {
    const { ctx, canvas } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.3);
    gradient.addColorStop(0, SKY_TOP);
    gradient.addColorStop(0.78, '#0a1428');
    gradient.addColorStop(1, SKY_HORIZON);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const glow = ctx.createRadialGradient(canvas.width * 0.5, 138, 0, canvas.width * 0.5, 138, 180);
    glow.addColorStop(0, 'rgba(39, 217, 255, 0.15)');
    glow.addColorStop(1, 'rgba(39, 217, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, 290);
  }

  private drawCity(): void {
    const { ctx, canvas } = this;
    const buildings = [
      [4, 92, 22, 64], [31, 114, 16, 42], [54, 70, 28, 86], [88, 103, 19, 53],
      [118, 87, 34, 69], [156, 119, 18, 37], [247, 105, 21, 51], [273, 72, 28, 84],
      [306, 97, 16, 59], [328, 64, 35, 92], [368, 111, 20, 45], [392, 82, 24, 74],
    ];
    ctx.fillStyle = '#060b18';
    for (const [x, y, w, h] of buildings) ctx.fillRect(x, y, w, h);

    ctx.fillStyle = 'rgba(86, 213, 255, 0.34)';
    for (let index = 0; index < buildings.length; index += 2) {
      const [x, y, w, h] = buildings[index];
      ctx.fillRect(x + w * 0.28, y + h * 0.28, Math.max(2, w * 0.18), 2);
    }
    ctx.fillStyle = 'rgba(5, 8, 22, 0.74)';
    ctx.fillRect(0, 150, canvas.width, 26);
  }

  private drawRoad(roadOffset: number): void {
    const { ctx, canvas } = this;
    const center = canvas.width / 2;
    const segmentCount = 24;
    const phase = (roadOffset % 120) / 120;

    ctx.fillStyle = '#01030a';
    ctx.fillRect(0, 150, canvas.width, canvas.height - 150);

    for (let index = 0; index < segmentCount; index++) {
      const depth0 = Math.min(1, (index + phase) / segmentCount);
      const depth1 = Math.min(1, (index + 1 + phase) / segmentCount);
      const y0 = groundY(depth0);
      const y1 = groundY(depth1);
      const half0 = roadHalfWidth(depth0);
      const half1 = roadHalfWidth(depth1);
      const shade = index % 2 === 0 ? ROAD_LIGHT : ROAD_DARK;
      ctx.fillStyle = shade;
      this.fillQuad(center - half0, y0, center + half0, y0, center + half1, y1, center - half1, y1);

      ctx.strokeStyle = ROAD_SEAM;
      ctx.lineWidth = Math.max(0.7, depth1 * 2.1);
      ctx.beginPath();
      ctx.moveTo(center - half1, y1);
      ctx.lineTo(center + half1, y1);
      ctx.stroke();
    }

    this.drawLaneGuides(phase);
    this.drawRails(phase);
  }

  private drawLaneGuides(phase: number): void {
    const { ctx, canvas } = this;
    const center = canvas.width / 2;
    const lanes = [-0.48, 0, 0.48];
    for (const lane of lanes) {
      for (let index = 0; index < 15; index++) {
        const depth0 = (index + phase) / 15;
        const depth1 = Math.min(1, depth0 + 0.035);
        if (depth0 > 1) continue;
        const y0 = groundY(depth0);
        const y1 = groundY(depth1);
        const x0 = center + lane * roadHalfWidth(depth0);
        const x1 = center + lane * roadHalfWidth(depth1);
        ctx.strokeStyle = lane === 0 ? rgba(AMBER, 0.86) : 'rgba(39, 217, 255, 0.35)';
        ctx.lineWidth = lane === 0 ? 2.1 : 1.25;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
  }

  private drawRails(phase: number): void {
    const { ctx, canvas } = this;
    const center = canvas.width / 2;
    for (const side of [-1, 1]) {
      ctx.strokeStyle = 'rgba(10, 26, 46, 0.98)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(center + side * (roadHalfWidth(0) + 7), groundY(0));
      ctx.lineTo(center + side * (roadHalfWidth(1) + 7), groundY(1));
      ctx.stroke();
      ctx.strokeStyle = rgba(RAIL, 0.8);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(center + side * roadHalfWidth(0), groundY(0));
      ctx.lineTo(center + side * roadHalfWidth(1), groundY(1));
      ctx.stroke();

      for (let index = 1; index <= 7; index++) {
        const depth = (index + phase) / 7;
        if (depth > 1) continue;
        const x = center + side * (roadHalfWidth(depth) + 6);
        const y = groundY(depth);
        const postHeight = 7 + depth * 34;
        ctx.strokeStyle = 'rgba(35, 72, 111, 0.95)';
        ctx.lineWidth = 1 + depth * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - postHeight);
        ctx.stroke();
        ctx.fillStyle = rgba(RAIL, 0.42 + depth * 0.42);
        ctx.fillRect(x - 1.5, y - postHeight, 3, 3);
      }
    }
  }

  private drawVehicle(pose: RebuildVehiclePose): void {
    const { ctx } = this;
    const shadowY = pose.contactY + Math.max(1.5, pose.height * 0.035);
    const reflectionLength = pose.kind === 'player' ? pose.height * 0.95 : pose.height * 0.45;
    const reflectionAlpha = pose.kind === 'player' ? 0.25 : 0.14;

    ctx.save();
    ctx.globalAlpha = pose.alpha;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    ctx.beginPath();
    ctx.ellipse(pose.x, shadowY, pose.width * 0.34, Math.max(2, pose.height * 0.07), 0, 0, Math.PI * 2);
    ctx.fill();

    const reflection = ctx.createLinearGradient(pose.x, pose.contactY, pose.x, pose.contactY + reflectionLength);
    reflection.addColorStop(0, rgba(pose.lightColor, reflectionAlpha));
    reflection.addColorStop(1, rgba(pose.lightColor, 0));
    ctx.fillStyle = reflection;
    ctx.beginPath();
    ctx.ellipse(pose.x, pose.contactY + reflectionLength * 0.38, pose.width * 0.22, reflectionLength * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();

    const image = this.textureFor(pose);
    ctx.drawImage(image, pose.x - pose.width / 2, pose.contactY - pose.height, pose.width, pose.height);
    // The player art carries deliberately authored rear lamps; adding generic
    // traffic light cores over it creates two detached dots below the body.
    if (pose.kind !== 'player') this.drawDirectionLights(pose);
    ctx.restore();
  }

  private drawDirectionLights(pose: RebuildVehiclePose): void {
    const { ctx } = this;
    const y = pose.contactY - pose.height * 0.47;
    const spread = pose.width * 0.25;
    const radius = Math.max(1, pose.width * 0.045);
    ctx.fillStyle = rgba(pose.lightColor, 0.8);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(pose.x + side * spread, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private textureFor(pose: RebuildVehiclePose): HTMLImageElement {
    if (pose.kind === 'player') return this.textures.player;
    return pose.kind === 'traffic-front' ? this.textures.trafficFront : this.textures.trafficRear;
  }

  private fillQuad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  }

  destroy(): void {
    this.canvas.remove();
  }
}
