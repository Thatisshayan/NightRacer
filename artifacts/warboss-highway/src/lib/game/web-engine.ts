import {
  GameEngine,
  CAR_STATS,
  type GameState,
  type CarType,
  type DailyModifier,
} from '@workspace/game-core';
import { playAudio, stopAudio } from './audio';
import { drawVehicle, drawObstacle } from './renderer';

// Mirrors pixi-renderer.ts's VISUAL_SCALE — see its comment for the full
// reasoning. Kept here too so the two renderers stay visually consistent
// during the brief window before Pixi's sprite pack finishes loading.
const VISUAL_SCALE = 1.25;

// Web-specific subclass: wires real DOM input (keyboard/touch) into the
// platform-agnostic GameEngine's public pointer/key API, supplies the
// Web Audio-backed AudioAdapter and navigator.vibrate haptics, and restores
// the original Canvas 2D draw path as the `renderFallback()` used whenever
// no renderer (Pixi, or none) is attached — see the "native mobile rebuild"
// plan's Phase 1 for why this split exists: the exact same simulation now
// also runs standalone on native behind a Skia renderer instead.
export class WebGameEngine extends GameEngine {
  private canvasEl: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private grainPattern: CanvasPattern | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onGameOver: (state: GameState) => void,
    options?: {
      isDailyChallenge?: boolean;
      selectedCar?: CarType;
      joystickEnabled?: boolean;
      onPauseChange?: (paused: boolean) => void;
      upgrades?: { speed: number; armor: number; handling: number };
      dailyModifier?: DailyModifier;
    }
  ) {
    const reducedMotion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

    super(
      { width: canvas.width, height: canvas.height },
      onGameOver,
      {
        ...options,
        audio: { play: playAudio, stop: stopAudio },
        haptics: (pattern) => {
          if ('vibrate' in navigator) navigator.vibrate(pattern);
        },
        reducedMotion,
      }
    );

    this.canvasEl = canvas;
    this.ctx = canvas.getContext('2d')!;

    window.addEventListener('keydown', this.handleKeyDownDom);
    window.addEventListener('keyup', this.handleKeyUpDom);
    canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', this.handleTouchEnd, { passive: false });
  }

  public cleanup() {
    window.removeEventListener('keydown', this.handleKeyDownDom);
    window.removeEventListener('keyup', this.handleKeyUpDom);
    this.canvasEl.removeEventListener('touchstart', this.handleTouchStart);
    this.canvasEl.removeEventListener('touchmove', this.handleTouchMove);
    this.canvasEl.removeEventListener('touchend', this.handleTouchEnd);
    this.canvasEl.removeEventListener('touchcancel', this.handleTouchEnd);
    super.cleanup();
  }

  private handleKeyDownDom = (e: KeyboardEvent) => this.handleKeyDown(e.code);
  private handleKeyUpDom = (e: KeyboardEvent) => this.handleKeyUp(e.code);

  private toCanvasCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvasEl.getBoundingClientRect();
    const scaleX = this.width / rect.width;
    const scaleY = this.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  private handleTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const { x, y } = this.toCanvasCoords(touch.clientX, touch.clientY);
      this.pointerDown(x, y);
    }
  };

  private handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const { x, y } = this.toCanvasCoords(touch.clientX, touch.clientY);
      this.pointerMove(x, y);
    }
  };

  private handleTouchEnd = (e: TouchEvent) => {
    e.preventDefault();
    this.pointerUp();
  };

  // Pixi's canvas is transparent and layered above this one; once it's
  // driving the frame, nothing else clears this canvas's last Canvas 2D
  // frame (HUD included), so it would otherwise show through forever.
  protected onRendererAttached(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  protected renderFallback(): void {
    this.draw();
  }

  private draw() {
    const ctx = this.ctx;
    const state = this.getState();
    ctx.save();

    // Screen shake
    if (state.screenShake > 0) {
      const i = (state.screenShake / 300) * 9;
      ctx.translate((Math.random() - 0.5) * i, (Math.random() - 0.5) * i);
    }

    // Camera follow — car drifts within the frame for a bigger sense of speed
    ctx.save();
    ctx.translate(0, -this.cameraY);

    this.drawRoad(ctx);

    // Obstacles — VISUAL_SCALE ported from the Pixi renderer's own fix
    // (see pixi-renderer.ts's constant comment); this Canvas 2D path is
    // only ever visible transiently while Pixi's sprite pack is still
    // loading, but should still match once it is.
    state.obstacles.forEach(o => {
      ctx.save();
      ctx.translate(o.x, o.y);
      drawObstacle(ctx, o.type, o.width * VISUAL_SCALE, o.height * VISUAL_SCALE);
      ctx.restore();
    });

    // Vehicles
    state.vehicles.forEach(v => {
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(Math.PI);
      drawVehicle(ctx, v.type, v.width * VISUAL_SCALE, v.height * VISUAL_SCALE, v.color);
      ctx.restore();
    });

    // Powerups
    state.powerups.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      let color = '#fff';
      let emoji = '';
      if (p.type === 'SHIELD')      { color = '#00ffff'; emoji = '🛡'; }
      if (p.type === 'SLOWMO')      { color = '#ffff00'; emoji = '⏱'; }
      if (p.type === 'SCORE_BLAST') { color = '#ffaa00'; emoji = '★'; }
      if (p.type === 'EXTRA_LIFE')  { color = '#ff4444'; emoji = '♥'; }

      const pulse = 0.7 + 0.3 * Math.sin(performance.now() * 0.005);
      ctx.shadowColor = color;
      ctx.shadowBlur = 14 * pulse;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, p.width / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Was a solid white stroke — read as a bright white halo/background
      // behind the icon against the dark road (this is the Canvas 2D
      // fallback path only, used while the Pixi renderer's real sprite
      // pack is still loading; matches the sprite art's own subtler rim
      // better than pure white).
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, 0, 1);
      ctx.restore();
    });

    // Exhaust / speed lines
    this.drawExhaust(ctx, state);

    // Player car underglow
    {
      const { x: ux, y: uy, width: uw, height: uh } = state.player;
      const carColor = CAR_STATS[this.selectedCar].color;
      const glowR = ctx.createRadialGradient(ux, uy + uh * 0.35, 0, ux, uy + uh * 0.35, uw * 1.4);
      glowR.addColorStop(0, carColor + '55');
      glowR.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowR;
      ctx.fillRect(ux - uw * 1.5, uy - uh * 0.1, uw * 3, uh * 1.1);
    }

    // Player car
    const flickerVisible = !state.player.isInvulnerable || Math.floor(performance.now() / 80) % 2 === 0;
    if (flickerVisible) {
      ctx.save();
      ctx.translate(state.player.x, state.player.y);

      if (state.player.oilSlicked) {
        ctx.shadowColor = '#8888ff';
        ctx.shadowBlur = 22;
      }

      if (state.activePowerUp === 'SHIELD') {
        const t = performance.now() * 0.0012;
        // Was a fixed 38/28 regardless of car size — looked fine for a
        // mid-size car but wildly oversized on the narrow ones (PHANTOM's
        // 16px-wide body inside a 76px hexagon). Scaled to the player's
        // own dimensions, matching the ratio the Pixi renderer already
        // used correctly (maxDim * 0.75).
        const shieldR = Math.max(state.player.width, state.player.height);
        const hexR = shieldR * 0.62;
        // Outer rotating hexagon
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + t;
          const px = Math.cos(a) * hexR, py = Math.sin(a) * hexR;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        // Inner pulsing ring
        const pulse = 0.5 + 0.5 * Math.sin(t * 4);
        ctx.strokeStyle = `rgba(0,255,255,${0.3 + pulse * 0.4})`;
        ctx.lineWidth = 1;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, 0, shieldR * 0.45 + pulse * (shieldR * 0.065), 0, Math.PI * 2);
        ctx.stroke();
        // Fill
        ctx.fillStyle = 'rgba(0,255,255,0.08)';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + t;
          const px = Math.cos(a) * hexR, py = Math.sin(a) * hexR;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Invulnerability colour-shift tint
      if (state.player.isInvulnerable) {
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(performance.now() * 0.03);
      }

      drawVehicle(ctx, this.selectedCar, state.player.width * VISUAL_SCALE, state.player.height * VISUAL_SCALE, CAR_STATS[this.selectedCar].color);
      ctx.restore();
    }

    // Particles — glowing circles instead of flat rects
    state.particles.forEach(p => {
      const life = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = life;
      const r = p.size * 0.6;
      const gr = ctx.createRadialGradient(p.x + r, p.y + r, 0, p.x + r, p.y + r, r * 2.2);
      gr.addColorStop(0, p.color);
      gr.addColorStop(0.5, p.color + '99');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6 * life;
      ctx.beginPath();
      ctx.arc(p.x + r, p.y + r, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    ctx.restore(); // end camera follow

    // HUD, level-up flash, boss warning, and near-miss combo text all live
    // in a DOM overlay (game-hud-overlay.tsx). It reads GameEngine.getState()
    // directly and renders independently of which renderer (this Canvas 2D
    // path or Pixi) is driving the game-world visuals underneath it.

    ctx.restore();

    // Virtual joystick
    this.drawJoystick(ctx);
  }

  private drawRoad(ctx: CanvasRenderingContext2D) {
    const state = this.getState();
    const W = this.width;
    const H = this.height;
    const laneWidth = W / 3;
    const speedMult = state.speedMultiplier;

    // === GUTTERS — textured shoulders ===
    ctx.fillStyle = '#0c0c0e';
    ctx.fillRect(0, 0, W, H);

    // Gutter gravel texture
    ctx.globalAlpha = 0.035;
    ctx.fillStyle = '#777';
    for (let i = 0; i < 60; i++) {
      const gx = (i * 83) % 10;
      const gy = ((i * 131 + state.roadOffset * 2) % H);
      ctx.fillRect(gx, gy, 2, 1);
      ctx.fillRect(W - 10 + gx, gy, 2, 1);
    }
    ctx.globalAlpha = 1;

    // === ROAD SURFACE — gradient darkens toward horizon ===
    const roadGrad = ctx.createLinearGradient(0, 0, 0, H);
    roadGrad.addColorStop(0,   '#1c1e26');
    roadGrad.addColorStop(0.3, '#23252e');
    roadGrad.addColorStop(1,   '#2c2f3c');
    ctx.fillStyle = roadGrad;
    ctx.fillRect(12, 0, W - 24, H);

    // Fine asphalt grain — deterministic dots, baked into a tiled pattern once
    // instead of ~6k fillRect calls/frame.
    const gs = 7;
    if (!this.grainPattern) {
      const tileSize = gs * 16;
      const tile = document.createElement('canvas');
      tile.width = tileSize;
      tile.height = tileSize;
      const tctx = tile.getContext('2d')!;
      tctx.fillStyle = '#fff';
      for (let y = 0; y < tileSize; y += gs) {
        for (let x = 0; x < tileSize; x += gs) {
          if (((x * 7 + y * 13) & 3) === 0) {
            tctx.fillRect(x, y, 1, 1);
          }
        }
      }
      this.grainPattern = ctx.createPattern(tile, 'repeat');
    }
    if (this.grainPattern) {
      ctx.globalAlpha = 0.022;
      ctx.save();
      ctx.translate(0, Math.floor(state.roadOffset * 1.5) % gs);
      ctx.fillStyle = this.grainPattern;
      ctx.fillRect(16, -gs, W - 32, H + gs * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // === SPEED STREAKS — gradient fade, scale with speed ===
    if (speedMult > 1.05) {
      const streakLen = 14 + speedMult * 55;
      const streakAlpha = Math.min(0.6, 0.04 + (speedMult - 1) * 0.18);
      const streakXs = [28, 62, 98, 138, 178, 218, 258, 298, 338, 374];
      streakXs.forEach((sx, i) => {
        if (sx < 14 || sx > W - 14) return;
        const yBase = ((i * 141 + state.roadOffset * (3.5 + speedMult)) % H);
        const g = ctx.createLinearGradient(sx, yBase, sx, yBase + streakLen);
        g.addColorStop(0, `rgba(190,205,255,${streakAlpha})`);
        g.addColorStop(1, 'rgba(190,205,255,0)');
        ctx.strokeStyle = g as unknown as string;
        ctx.lineWidth = speedMult > 2.5 ? 1.8 : 1;
        ctx.beginPath();
        ctx.moveTo(sx, yBase);
        ctx.lineTo(sx, yBase + streakLen);
        ctx.stroke();
      });
    }

    // Chromatic aberration strips at extreme speed
    if (speedMult >= 2.8) {
      const caA = Math.min(0.14, (speedMult - 2.8) * 0.22);
      ctx.globalAlpha = caA;
      ctx.fillStyle = '#ff0040'; ctx.fillRect(12, 0, 5, H);
      ctx.fillStyle = '#00ffff'; ctx.fillRect(W - 17, 0, 5, H);
      ctx.globalAlpha = 1;
    }

    // === SCROLLING LAMP POSTS ===
    const lampSpacing = 180;
    const lampOff = state.roadOffset % lampSpacing;
    for (let y = -lampSpacing + lampOff; y < H + lampSpacing; y += lampSpacing) {
      // Pole
      ctx.strokeStyle = '#252525';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(9, y + 36); ctx.lineTo(9, y); ctx.lineTo(17, y); ctx.stroke();
      // Light cone
      ctx.fillStyle = 'rgba(255,220,100,0.07)';
      ctx.beginPath(); ctx.moveTo(17, y); ctx.lineTo(55, y + 70); ctx.lineTo(28, y + 70); ctx.closePath(); ctx.fill();
      // Bulb
      ctx.fillStyle = '#ffeebb';
      ctx.shadowColor = '#ffdd44'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(17, y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Right side (mirror)
      ctx.strokeStyle = '#252525'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(W - 9, y + 36); ctx.lineTo(W - 9, y); ctx.lineTo(W - 17, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,100,0.07)';
      ctx.beginPath(); ctx.moveTo(W - 17, y); ctx.lineTo(W - 55, y + 70); ctx.lineTo(W - 28, y + 70); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffeebb';
      ctx.shadowColor = '#ffdd44'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(W - 17, y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // === GUARDRAILS — warning chevron stripes ===
    const stripeH = 36;
    const stripeOff = state.roadOffset * 2.5;
    for (let y = -stripeH + (stripeOff % (stripeH * 2)); y < H + stripeH; y += stripeH * 2) {
      ctx.fillStyle = '#cc9900'; ctx.fillRect(0, y, 12, stripeH);
      ctx.fillStyle = '#181818'; ctx.fillRect(0, y + stripeH, 12, stripeH);
      ctx.fillRect(W - 12, y, 12, stripeH);
      ctx.fillStyle = '#cc9900'; ctx.fillRect(W - 12, y + stripeH, 12, stripeH);
    }
    // Steel rail cap
    ctx.fillStyle = '#444'; ctx.fillRect(0, 0, 4, H);
    ctx.fillRect(W - 4, 0, 4, H);

    // === LANE DIVIDERS — brighter, wider dashes ===
    ctx.strokeStyle = 'rgba(255,255,200,0.25)';
    ctx.lineWidth = 3;
    ctx.setLineDash([34, 26]);
    ctx.lineDashOffset = -(state.roadOffset * 2.8);
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(laneWidth * i, 0);
      ctx.lineTo(laneWidth * i, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // === HORIZON FOG ===
    const fogGrad = ctx.createLinearGradient(0, 0, 0, H * 0.2);
    fogGrad.addColorStop(0, 'rgba(8,8,16,0.88)');
    fogGrad.addColorStop(1, 'rgba(8,8,16,0)');
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, W, H * 0.2);
  }

  private drawExhaust(ctx: CanvasRenderingContext2D, state: GameState) {
    const spd = state.speedMultiplier;
    if (spd < 1.1) return;

    const px  = state.player.x;
    const py  = state.player.y + state.player.height / 2;
    const hw  = state.player.width * 0.30;
    const len = spd * 22;
    const carColor = CAR_STATS[this.selectedCar].color;

    // Main exhaust plumes — gradient fade
    const drawPlume = (ox: number, width: number, hot: boolean) => {
      const g = ctx.createLinearGradient(0, py, 0, py + len);
      if (hot && spd >= 2.2) {
        g.addColorStop(0,   `rgba(255,120,20,${Math.min(0.9, (spd-1)*0.35)})`);
        g.addColorStop(0.4, `rgba(255,60,0,${Math.min(0.5,(spd-1)*0.2)})`);
        g.addColorStop(1,   'rgba(80,0,0,0)');
      } else {
        g.addColorStop(0,   `rgba(180,190,200,${Math.min(0.7,(spd-1)*0.3)})`);
        g.addColorStop(1,   'rgba(180,190,200,0)');
      }
      ctx.strokeStyle = g as unknown as string;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px + ox, py);
      ctx.lineTo(px + ox, py + len);
      ctx.stroke();
    };

    drawPlume(-hw, 2.5, true);
    drawPlume( hw, 2.5, true);

    // Center boost trail at speed ≥ 2
    if (spd >= 2.0) {
      drawPlume(0, 1.5, true);
    }

    // Car-colored underglow trail at very high speed
    if (spd >= 2.5) {
      const glowAlpha = Math.min(0.45, (spd - 2.5) * 0.3);
      const g = ctx.createLinearGradient(0, py, 0, py + len * 0.8);
      g.addColorStop(0, carColor + Math.round(glowAlpha * 255).toString(16).padStart(2,'0'));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.strokeStyle = g as unknown as string;
      ctx.lineWidth = state.player.width * 0.7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + len * 0.8);
      ctx.stroke();
    }
  }

  private drawJoystick(ctx: CanvasRenderingContext2D) {
    if (!this.joystickEnabled || this.getState().isGameOver) return;
    const { cx, cy, nx, ny } = this.joystick;
    ctx.save();
    ctx.globalAlpha = 0.55;

    // Base
    ctx.beginPath();
    ctx.arc(cx, cy, 50, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Knob
    ctx.beginPath();
    ctx.arc(nx, ny, 18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }
}
