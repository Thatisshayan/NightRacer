import {
  GameEngine,
  CAR_STATS,
  type GameState,
  type CarType,
  type DailyModifier,
} from '@workspace/game-core';
import { playAudio, stopAudio } from './audio';
import { drawVehicle, drawObstacle } from './renderer';

// Web-specific subclass: wires real DOM input (keyboard/touch) into the
// platform-agnostic GameEngine's public pointer/key API, supplies the
// Web Audio-backed AudioAdapter and navigator.vibrate haptics, and restores
// the original Canvas 2D draw path as the `renderFallback()` used whenever
// no renderer (Pixi, or none) is attached — see the "native mobile rebuild"
// plan's Phase 1 for why this split exists: the exact same simulation now
// also runs standalone on native behind a Skia renderer instead.
export class WebGameEngine extends GameEngine {
  // Rendering constants
  /** Width of the guardrail in pixels. */
  private static readonly GUARDRAIL_WIDTH = 12;
  /** Width of the gutter (road edge) in pixels. */
  private static readonly GUTTER_WIDTH = 10;
  /** Scroll speed multiplier for gutter texture. */
  private static readonly GUTTER_SCROLL_SPEED = 2;
  /** Scroll speed for asphalt grain texture. */
  private static readonly ASPHALT_GRAIN_SCROLL_SPEED = 1.5;
  /** Vertical offset for asphalt grain texture. */
  private static readonly ASPHALT_GRAIN_OFFSET = 16;
  /** Base tile size for asphalt grain. */
  private static readonly ASPHALT_GRAIN_TILE_SIZE = 7;
  /** Width of the steel rail cap in pixels. */
  private static readonly STEEL_RAIL_CAP_WIDTH = 4;
  /** Multiplier for grain tile size. */
  private static readonly GRAIN_TILE_MULTIPLIER = 16;
  
  // Speed streaks constants
  private static readonly SPEED_STREAK_BASE_LENGTH = 14;
  private static readonly SPEED_STREAK_LENGTH_MULTIPLIER = 55;
  private static readonly SPEED_STREAK_BASE_ALPHA = 0.04;
  private static readonly SPEED_STREAK_ALPHA_MULTIPLIER = 0.18;
  private static readonly SPEED_STREAK_MAX_ALPHA = 0.6;
  private static readonly SPEED_STREAK_COLOR = '190,205,255';
  private static readonly SPEED_STREAK_LINE_WIDTH_THRESHOLD = 2.5;
  private static readonly SPEED_STREAK_LINE_WIDTH = 1.8;
  private static readonly SPEED_STREAK_DEFAULT_LINE_WIDTH = 1;
  
  // Chromatic aberration constants
  private static readonly CHROMATIC_ABERRATION_SPEED_THRESHOLD = 2.8;
  private static readonly CHROMATIC_ABERRATION_ALPHA_MULTIPLIER = 0.22;
  private static readonly CHROMATIC_ABERRATION_MAX_ALPHA = 0.14;
  private static readonly CHROMATIC_ABERRATION_STRIP_WIDTH = 5;
  
  // Lamp post constants
  private static readonly LAMP_SPACING = 180;
  private static readonly LAMP_POLE_HEIGHT = 36;
  private static readonly LAMP_POLE_COLOR = '#252525';
  private static readonly LAMP_POLE_LINE_WIDTH = 3;
  private static readonly LAMP_POLE_LEFT_X = 9;
  private static readonly LAMP_POLE_RIGHT_X = 17;
  private static readonly LAMP_LIGHT_CONE_COLOR = 'rgba(255,220,100,0.07)';
  private static readonly LAMP_LIGHT_CONE_WIDTH = 55;
  private static readonly LAMP_LIGHT_CONE_HEIGHT = 70;
  private static readonly LAMP_BULB_COLOR = '#ffeebb';
  private static readonly LAMP_BULB_SHADOW_COLOR = '#ffdd44';
  private static readonly LAMP_BULB_SHADOW_BLUR = 8;
  private static readonly LAMP_BULB_RADIUS = 3.5;
  
  // Horizon fog constants
  private static readonly HORIZON_FOG_HEIGHT_MULTIPLIER = 0.2;
  private static readonly HORIZON_FOG_COLOR = '8,8,16';
  private static readonly HORIZON_FOG_START_ALPHA = 0.88;
  
  // Exhaust constants
  private static readonly EXHAUST_MIN_SPEED = 1.1;
  private static readonly EXHAUST_WIDTH_MULTIPLIER = 0.30;
  private static readonly EXHAUST_LENGTH_MULTIPLIER = 22;
  private static readonly EXHAUST_HOT_SPEED_THRESHOLD = 2.2;
  private static readonly EXHAUST_HOT_COLOR_START = '255,120,20';
  private static readonly EXHAUST_HOT_COLOR_MID = '255,60,0';
  private static readonly EXHAUST_HOT_COLOR_END = '80,0,0';
  private static readonly EXHAUST_COOL_COLOR_START = '180,190,200';
  private static readonly EXHAUST_COOL_COLOR_END = '180,190,200';
  private static readonly EXHAUST_PLUME_WIDTH = 2.5;
  private static readonly EXHAUST_CENTER_BOOST_SPEED_THRESHOLD = 2.0;
  private static readonly EXHAUST_CENTER_BOOST_WIDTH = 1.5;
  private static readonly EXHAUST_UNDERGLOW_SPEED_THRESHOLD = 2.5;
  private static readonly EXHAUST_UNDERGLOW_ALPHA_MULTIPLIER = 0.3;
  private static readonly EXHAUST_UNDERGLOW_MAX_ALPHA = 0.45;
  private static readonly EXHAUST_UNDERGLOW_LENGTH_MULTIPLIER = 0.8;
  private static readonly EXHAUST_UNDERGLOW_WIDTH_MULTIPLIER = 0.7;
  
  // Joystick constants
  private static readonly JOYSTICK_BASE_RADIUS = 50;
  private static readonly JOYSTICK_BASE_FILL_ALPHA = 0.08;
  private static readonly JOYSTICK_BASE_STROKE_ALPHA = 0.25;
  private static readonly JOYSTICK_BASE_LINE_WIDTH = 2;
  private static readonly JOYSTICK_KNOB_RADIUS = 18;
  private static readonly JOYSTICK_KNOB_FILL_ALPHA = 0.35;
  private static readonly JOYSTICK_KNOB_STROKE_ALPHA = 0.6;
  
  // Guardrail stripe constants
  private static readonly GUARDRAIL_STRIPE_HEIGHT = 36;
  private static readonly GUARDRAIL_STRIPE_SCROLL_SPEED = 2.5;
  
  // Lane divider constants
  private static readonly LANE_DIVIDER_COLOR = '255,255,200';
  private static readonly LANE_DIVIDER_ALPHA = 0.25;
  private static readonly LANE_DIVIDER_LINE_WIDTH = 3;
  private static readonly LANE_DIVIDER_DASH_PATTERN = [34, 26];
  private static readonly LANE_DIVIDER_SCROLL_SPEED = 2.8;
  
  // Center line constants
  private static readonly CENTER_LINE_COLOR = '255,205,60';
  private static readonly CENTER_LINE_ALPHA = 0.55;
  private static readonly CENTER_LINE_WIDTH = 2.5;
  private static readonly CENTER_LINE_OFFSET = 2.5;

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
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get 2D rendering context from canvas');
    }
    this.ctx = context;

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

  // Destructor-like method to ensure cleanup is called
  public disconnect() {
    this.cleanup();
  }

  private handleKeyDownDom = (e: KeyboardEvent) => {
    // Prevent scrolling for game-related keys
    const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'];
    if (gameKeys.includes(e.code)) {
      e.preventDefault();
    }
    this.handleKeyDown(e.code);
  };
  private handleKeyUpDom = (e: KeyboardEvent) => {
    // Prevent scrolling for game-related keys
    const gameKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'];
    if (gameKeys.includes(e.code)) {
      e.preventDefault();
    }
    this.handleKeyUp(e.code);
  };

  private toCanvasCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvasEl.getBoundingClientRect();
    // Guard against division by zero if canvas has no dimensions
    if (rect.width === 0 || rect.height === 0) {
      return { x: 0, y: 0 };
    }
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

    state.obstacles.forEach(o => {
      ctx.save();
      ctx.translate(o.x, o.y);
      drawObstacle(ctx, o.type, o.width, o.height);
      ctx.restore();
    });

    // Vehicles — oncoming traffic (lanes 0-1) faces the player, same-
    // direction traffic (lanes 2-3) faces away. See Vehicle.direction.
    state.vehicles.forEach(v => {
      ctx.save();
      ctx.translate(v.x, v.y);
      if (v.direction === 'OPPOSITE') ctx.rotate(Math.PI);
      drawVehicle(ctx, v.type, v.width, v.height, v.color);
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

      drawVehicle(ctx, this.selectedCar, state.player.width, state.player.height, CAR_STATS[this.selectedCar].color);
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
    const laneWidth = W / 4;
    const speedMult = state.speedMultiplier;

    // === GUTTERS — textured shoulders ===
    ctx.fillStyle = '#0c0c0e';
    ctx.fillRect(0, 0, W, H);

    // Gutter gravel texture
    ctx.globalAlpha = 0.035;
    ctx.fillStyle = '#777';
    for (let i = 0; i < 60; i++) {
      const gx = (i * 83) % WebGameEngine.GUTTER_WIDTH;
      const gy = ((i * 131 + state.roadOffset * WebGameEngine.GUTTER_SCROLL_SPEED) % H);
      ctx.fillRect(gx, gy, 2, 1);
      ctx.fillRect(W - WebGameEngine.GUTTER_WIDTH + gx, gy, 2, 1);
    }
    ctx.globalAlpha = 1;

    // === ROAD SURFACE — gradient darkens toward horizon ===
    const roadGrad = ctx.createLinearGradient(0, 0, 0, H);
    roadGrad.addColorStop(0,   '#1c1e26');
    roadGrad.addColorStop(0.3, '#23252e');
    roadGrad.addColorStop(1,   '#2c2f3c');
    ctx.fillStyle = roadGrad;
    ctx.fillRect(WebGameEngine.GUARDRAIL_WIDTH, 0, W - WebGameEngine.GUARDRAIL_WIDTH * 2, H);

    // Fine asphalt grain — deterministic dots, baked into a tiled pattern once
    // instead of ~6k fillRect calls/frame.
    const gs = WebGameEngine.ASPHALT_GRAIN_TILE_SIZE;
    if (!this.grainPattern) {
      const tileSize = gs * WebGameEngine.GRAIN_TILE_MULTIPLIER;
        const tile = document.createElement('canvas');
        tile.width = tileSize;
        tile.height = tileSize;
        const tctx = tile.getContext('2d');
        if (!tctx) throw new Error('Canvas 2D not supported');
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
      ctx.translate(0, Math.floor(state.roadOffset * WebGameEngine.ASPHALT_GRAIN_SCROLL_SPEED) % gs);
      ctx.fillStyle = this.grainPattern;
      ctx.fillRect(WebGameEngine.ASPHALT_GRAIN_OFFSET, -gs, W - WebGameEngine.ASPHALT_GRAIN_OFFSET * 2, H + gs * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // === SPEED STREAKS — gradient fade, scale with speed ===
    if (speedMult > 1.05) {
      const streakLen = WebGameEngine.SPEED_STREAK_BASE_LENGTH + speedMult * WebGameEngine.SPEED_STREAK_LENGTH_MULTIPLIER;
      const streakAlpha = Math.min(WebGameEngine.SPEED_STREAK_MAX_ALPHA, WebGameEngine.SPEED_STREAK_BASE_ALPHA + (speedMult - 1) * WebGameEngine.SPEED_STREAK_ALPHA_MULTIPLIER);
      const streakXs = [28, 62, 98, 138, 178, 218, 258, 298, 338, 374];
      streakXs.forEach((sx, i) => {
        if (sx < WebGameEngine.GUARDRAIL_WIDTH || sx > W - WebGameEngine.GUARDRAIL_WIDTH) return;
        const yBase = ((i * 141 + state.roadOffset * (3.5 + speedMult)) % H);
        const g = ctx.createLinearGradient(sx, yBase, sx, yBase + streakLen);
        g.addColorStop(0, `rgba(${WebGameEngine.SPEED_STREAK_COLOR},${streakAlpha})`);
        g.addColorStop(1, `rgba(${WebGameEngine.SPEED_STREAK_COLOR},0)`);
          ctx.strokeStyle = g;
        ctx.lineWidth = speedMult > WebGameEngine.SPEED_STREAK_LINE_WIDTH_THRESHOLD ? WebGameEngine.SPEED_STREAK_LINE_WIDTH : WebGameEngine.SPEED_STREAK_DEFAULT_LINE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(sx, yBase);
        ctx.lineTo(sx, yBase + streakLen);
        ctx.stroke();
      });
    }

    // Chromatic aberration strips at extreme speed
    if (speedMult >= WebGameEngine.CHROMATIC_ABERRATION_SPEED_THRESHOLD) {
      const caA = Math.min(WebGameEngine.CHROMATIC_ABERRATION_MAX_ALPHA, (speedMult - WebGameEngine.CHROMATIC_ABERRATION_SPEED_THRESHOLD) * WebGameEngine.CHROMATIC_ABERRATION_ALPHA_MULTIPLIER);
      ctx.globalAlpha = caA;
      ctx.fillStyle = '#ff0040'; ctx.fillRect(WebGameEngine.GUARDRAIL_WIDTH, 0, WebGameEngine.CHROMATIC_ABERRATION_STRIP_WIDTH, H);
      ctx.fillStyle = '#00ffff'; ctx.fillRect(W - WebGameEngine.GUARDRAIL_WIDTH - WebGameEngine.CHROMATIC_ABERRATION_STRIP_WIDTH, 0, WebGameEngine.CHROMATIC_ABERRATION_STRIP_WIDTH, H);
      ctx.globalAlpha = 1;
    }

    // === SCROLLING LAMP POSTS ===
    const lampSpacing = WebGameEngine.LAMP_SPACING;
    const lampOff = state.roadOffset % lampSpacing;
    for (let y = -lampSpacing + lampOff; y < H + lampSpacing; y += lampSpacing) {
      // Pole
      ctx.strokeStyle = WebGameEngine.LAMP_POLE_COLOR;
      ctx.lineWidth = WebGameEngine.LAMP_POLE_LINE_WIDTH;
      ctx.beginPath(); ctx.moveTo(WebGameEngine.LAMP_POLE_LEFT_X, y + WebGameEngine.LAMP_POLE_HEIGHT); ctx.lineTo(WebGameEngine.LAMP_POLE_LEFT_X, y); ctx.lineTo(WebGameEngine.LAMP_POLE_RIGHT_X, y); ctx.stroke();
      // Light cone
      ctx.fillStyle = WebGameEngine.LAMP_LIGHT_CONE_COLOR;
      ctx.beginPath(); ctx.moveTo(WebGameEngine.LAMP_POLE_RIGHT_X, y); ctx.lineTo(WebGameEngine.LAMP_POLE_RIGHT_X + WebGameEngine.LAMP_LIGHT_CONE_WIDTH, y + WebGameEngine.LAMP_LIGHT_CONE_HEIGHT); ctx.lineTo(WebGameEngine.LAMP_POLE_LEFT_X + (WebGameEngine.LAMP_LIGHT_CONE_WIDTH - (WebGameEngine.LAMP_POLE_RIGHT_X - WebGameEngine.LAMP_POLE_LEFT_X)), y + WebGameEngine.LAMP_LIGHT_CONE_HEIGHT); ctx.closePath(); ctx.fill();
      // Bulb
      ctx.fillStyle = WebGameEngine.LAMP_BULB_COLOR;
      ctx.shadowColor = WebGameEngine.LAMP_BULB_SHADOW_COLOR; ctx.shadowBlur = WebGameEngine.LAMP_BULB_SHADOW_BLUR;
      ctx.beginPath(); ctx.arc(WebGameEngine.LAMP_POLE_RIGHT_X, y, WebGameEngine.LAMP_BULB_RADIUS, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Right side (mirror)
      ctx.strokeStyle = WebGameEngine.LAMP_POLE_COLOR; ctx.lineWidth = WebGameEngine.LAMP_POLE_LINE_WIDTH;
      ctx.beginPath(); ctx.moveTo(W - WebGameEngine.LAMP_POLE_LEFT_X, y + WebGameEngine.LAMP_POLE_HEIGHT); ctx.lineTo(W - WebGameEngine.LAMP_POLE_LEFT_X, y); ctx.lineTo(W - WebGameEngine.LAMP_POLE_RIGHT_X, y); ctx.stroke();
      ctx.fillStyle = WebGameEngine.LAMP_LIGHT_CONE_COLOR;
      ctx.beginPath(); ctx.moveTo(W - WebGameEngine.LAMP_POLE_RIGHT_X, y); ctx.lineTo(W - WebGameEngine.LAMP_POLE_RIGHT_X - WebGameEngine.LAMP_LIGHT_CONE_WIDTH, y + WebGameEngine.LAMP_LIGHT_CONE_HEIGHT); ctx.lineTo(W - WebGameEngine.LAMP_POLE_LEFT_X - (WebGameEngine.LAMP_LIGHT_CONE_WIDTH - (WebGameEngine.LAMP_POLE_RIGHT_X - WebGameEngine.LAMP_POLE_LEFT_X)), y + WebGameEngine.LAMP_LIGHT_CONE_HEIGHT); ctx.closePath(); ctx.fill();
      ctx.fillStyle = WebGameEngine.LAMP_BULB_COLOR;
      ctx.shadowColor = WebGameEngine.LAMP_BULB_SHADOW_COLOR; ctx.shadowBlur = WebGameEngine.LAMP_BULB_SHADOW_BLUR;
      ctx.beginPath(); ctx.arc(W - WebGameEngine.LAMP_POLE_RIGHT_X, y, WebGameEngine.LAMP_BULB_RADIUS, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // === GUARDRAILS — warning chevron stripes ===
    const stripeH = WebGameEngine.GUARDRAIL_STRIPE_HEIGHT;
    const stripeOff = state.roadOffset * WebGameEngine.GUARDRAIL_STRIPE_SCROLL_SPEED;
    for (let y = -stripeH + (stripeOff % (stripeH * 2)); y < H + stripeH; y += stripeH * 2) {
      ctx.fillStyle = '#cc9900'; ctx.fillRect(0, y, WebGameEngine.GUARDRAIL_WIDTH, stripeH);
      ctx.fillStyle = '#181818'; ctx.fillRect(0, y + stripeH, WebGameEngine.GUARDRAIL_WIDTH, stripeH);
      ctx.fillRect(W - WebGameEngine.GUARDRAIL_WIDTH, y, WebGameEngine.GUARDRAIL_WIDTH, stripeH);
      ctx.fillStyle = '#cc9900'; ctx.fillRect(W - WebGameEngine.GUARDRAIL_WIDTH, y + stripeH, WebGameEngine.GUARDRAIL_WIDTH, stripeH);
    }
    // Steel rail cap
    ctx.fillStyle = '#444'; ctx.fillRect(0, 0, WebGameEngine.STEEL_RAIL_CAP_WIDTH, H);
    ctx.fillRect(W - WebGameEngine.STEEL_RAIL_CAP_WIDTH, 0, WebGameEngine.STEEL_RAIL_CAP_WIDTH, H);

    // === LANE DIVIDERS — brighter, wider dashes ===
    ctx.strokeStyle = `rgba(${WebGameEngine.LANE_DIVIDER_COLOR},${WebGameEngine.LANE_DIVIDER_ALPHA})`;
    ctx.lineWidth = WebGameEngine.LANE_DIVIDER_LINE_WIDTH;
    ctx.setLineDash(WebGameEngine.LANE_DIVIDER_DASH_PATTERN);
    ctx.lineDashOffset = -(state.roadOffset * WebGameEngine.LANE_DIVIDER_SCROLL_SPEED);
    for (const i of [1, 3]) {
      ctx.beginPath();
      ctx.moveTo(laneWidth * i, 0);
      ctx.lineTo(laneWidth * i, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Direction divide (between lanes 1 and 2) — solid double-yellow
    // center line, like a real two-way road, instead of another dash.
    ctx.strokeStyle = `rgba(${WebGameEngine.CENTER_LINE_COLOR},${WebGameEngine.CENTER_LINE_ALPHA})`;
    ctx.lineWidth = WebGameEngine.CENTER_LINE_WIDTH;
    const centerX = laneWidth * 2;
    for (const offset of [-WebGameEngine.CENTER_LINE_OFFSET, WebGameEngine.CENTER_LINE_OFFSET]) {
      ctx.beginPath();
      ctx.moveTo(centerX + offset, 0);
      ctx.lineTo(centerX + offset, H);
      ctx.stroke();
    }

    // === HORIZON FOG ===
    const fogGrad = ctx.createLinearGradient(0, 0, 0, H * WebGameEngine.HORIZON_FOG_HEIGHT_MULTIPLIER);
    fogGrad.addColorStop(0, `rgba(${WebGameEngine.HORIZON_FOG_COLOR},${WebGameEngine.HORIZON_FOG_START_ALPHA})`);
    fogGrad.addColorStop(1, `rgba(${WebGameEngine.HORIZON_FOG_COLOR},0)`);
    ctx.fillStyle = fogGrad;
    ctx.fillRect(0, 0, W, H * WebGameEngine.HORIZON_FOG_HEIGHT_MULTIPLIER);
  }

  private drawExhaust(ctx: CanvasRenderingContext2D, state: GameState) {
    const spd = state.speedMultiplier;
    if (spd < WebGameEngine.EXHAUST_MIN_SPEED) return;

    const px  = state.player.x;
    const py  = state.player.y + state.player.height / 2;
    const hw  = state.player.width * WebGameEngine.EXHAUST_WIDTH_MULTIPLIER;
    const len = spd * WebGameEngine.EXHAUST_LENGTH_MULTIPLIER;
    const carColor = CAR_STATS[this.selectedCar].color;

    // Main exhaust plumes — gradient fade
    const drawPlume = (ox: number, width: number, hot: boolean) => {
      const g = ctx.createLinearGradient(0, py, 0, py + len);
      if (hot && spd >= WebGameEngine.EXHAUST_HOT_SPEED_THRESHOLD) {
        g.addColorStop(0,   `rgba(${WebGameEngine.EXHAUST_HOT_COLOR_START},${Math.min(0.9, (spd-1)*0.35)})`);
        g.addColorStop(0.4, `rgba(${WebGameEngine.EXHAUST_HOT_COLOR_MID},${Math.min(0.5,(spd-1)*0.2)})`);
        g.addColorStop(1,   `rgba(${WebGameEngine.EXHAUST_HOT_COLOR_END},0)`);
      } else {
        g.addColorStop(0,   `rgba(${WebGameEngine.EXHAUST_COOL_COLOR_START},${Math.min(0.7,(spd-1)*0.3)})`);
        g.addColorStop(1,   `rgba(${WebGameEngine.EXHAUST_COOL_COLOR_END},0)`);
        }
        ctx.strokeStyle = g;
        ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px + ox, py);
      ctx.lineTo(px + ox, py + len);
      ctx.stroke();
    };

    drawPlume(-hw, WebGameEngine.EXHAUST_PLUME_WIDTH, true);
    drawPlume( hw, WebGameEngine.EXHAUST_PLUME_WIDTH, true);

    // Center boost trail at speed ≥ 2
    if (spd >= WebGameEngine.EXHAUST_CENTER_BOOST_SPEED_THRESHOLD) {
      drawPlume(0, WebGameEngine.EXHAUST_CENTER_BOOST_WIDTH, true);
    }

    // Car-colored underglow trail at very high speed
    if (spd >= WebGameEngine.EXHAUST_UNDERGLOW_SPEED_THRESHOLD) {
      const glowAlpha = Math.min(WebGameEngine.EXHAUST_UNDERGLOW_MAX_ALPHA, (spd - WebGameEngine.EXHAUST_UNDERGLOW_SPEED_THRESHOLD) * WebGameEngine.EXHAUST_UNDERGLOW_ALPHA_MULTIPLIER);
      const g = ctx.createLinearGradient(0, py, 0, py + len * WebGameEngine.EXHAUST_UNDERGLOW_LENGTH_MULTIPLIER);
      g.addColorStop(0, carColor + Math.round(glowAlpha * 255).toString(16).padStart(2,'0'));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = state.player.width * WebGameEngine.EXHAUST_UNDERGLOW_WIDTH_MULTIPLIER;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + len * WebGameEngine.EXHAUST_UNDERGLOW_LENGTH_MULTIPLIER);
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
    ctx.arc(cx, cy, WebGameEngine.JOYSTICK_BASE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${WebGameEngine.JOYSTICK_BASE_FILL_ALPHA})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 255, 255, ${WebGameEngine.JOYSTICK_BASE_STROKE_ALPHA})`;
    ctx.lineWidth = WebGameEngine.JOYSTICK_BASE_LINE_WIDTH;
    ctx.stroke();

    // Knob
    ctx.beginPath();
    ctx.arc(nx, ny, WebGameEngine.JOYSTICK_KNOB_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${WebGameEngine.JOYSTICK_KNOB_FILL_ALPHA})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 255, 255, ${WebGameEngine.JOYSTICK_KNOB_STROKE_ALPHA})`;
    ctx.lineWidth = WebGameEngine.JOYSTICK_BASE_LINE_WIDTH;
    ctx.stroke();

    ctx.restore();
  }
}
