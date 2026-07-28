import { playAudio, stopAudio } from './audio';
import { drawVehicle, drawObstacle } from './renderer';
import { Settings } from './settings';
import { DailyModifier } from './daily';

export type PowerUpType = 'SHIELD' | 'SLOWMO' | 'SCORE_BLAST' | 'EXTRA_LIFE';
export type CarType = 'RATTLETRAP' | 'WAR_RUNNER' | 'DEATHSLED' | 'SCRAPQUEEN' | 'PHANTOM';
export type VehicleType = 'SEDAN' | 'PICKUP' | 'COP' | 'BOXTRUCK' | 'BUS' | 'SPORTS' | 'TANK' | 'BOSS';
export type ObstacleType = 'OIL_SLICK' | 'DEBRIS';

// Single source of truth for timed power-up durations, shared with the HUD
// overlay (game-hud-overlay.tsx) so its progress-bar fill can't drift out of
// sync with the actual timer set in collectPowerUp() below.
export const POWERUP_DURATION_MS: Record<Exclude<PowerUpType, 'EXTRA_LIFE'>, number> = {
  SHIELD: 5000,
  SLOWMO: 4000,
  SCORE_BLAST: 6000,
};

// Structural interface only — kept free of any pixi.js import so engine.ts
// never pulls the Pixi bundle in statically (Game.tsx loads it via a lazy
// `import('pixi.js')` and hands the engine an instance through
// `attachRenderer`, see docs plan "Warboss Highway Pixi rewrite" Phase A).
export interface GameRenderer {
  sync(state: GameState, cameraY: number, screenShake: number): void;
  destroy(): void;
}

export interface CarStats {
  width: number;
  height: number;
  speedMod: number;
  color: string;
  label: string;
  desc: string;
  stats: string;
}

export const CAR_STATS: Record<CarType, CarStats> = {
  RATTLETRAP: {
    width: 40,
    height: 62,
    speedMod: 0.85,
    color: '#a86b32',
    label: 'RATTLETRAP',
    desc: 'Wide & sturdy. Slower to react.',
    stats: 'SPD ██░░░  ARM █████',
  },
  WAR_RUNNER: {
    width: 30,
    height: 50,
    speedMod: 1.0,
    color: '#5e7a45',
    label: 'WAR-RUNNER',
    desc: 'Balanced. The classic choice.',
    stats: 'SPD ███░░  ARM ███░░',
  },
  DEATHSLED: {
    // Was 22 — narrow enough that it could thread every gap in traffic
    // without ever overlapping an enemy's hitbox, making the car
    // effectively uncrashable. Widened while keeping it the 2nd-narrowest.
    width: 30,
    height: 46,
    speedMod: 1.15,
    color: '#3d6db8',
    label: 'DEATHSLED',
    desc: 'Narrow & fast. High risk.',
    stats: 'SPD █████  ARM █░░░░',
  },
  SCRAPQUEEN: {
    width: 46,
    height: 70,
    speedMod: 0.72,
    color: '#7a4a8a',
    label: 'SCRAPQUEEN',
    desc: 'Armoured behemoth. Slow but built like a tank.',
    stats: 'SPD █░░░░  ARM █████',
  },
  PHANTOM: {
    // Was 16 — same "practically unhittable" issue as DEATHSLED, worse.
    // Kept as the narrowest car for its "ghost-thin" identity, just no
    // longer thin enough to dodge everything by default.
    width: 24,
    height: 42,
    speedMod: 1.35,
    color: '#00ffcc',
    label: 'PHANTOM',
    desc: 'Ghost-thin. Blink and you miss it.',
    stats: 'SPD █████  ARM ░░░░░',
  },
};

export interface GameObject {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Player extends GameObject {
  isInvulnerable: boolean;
  invulnTimer: number;
  oilSlicked: boolean;
  oilTimer: number;
}

export interface Vehicle extends GameObject {
  type: VehicleType;
  color: string;
  speed: number;
  lane: number;
  passed: boolean;
  // 1-3, picked at spawn — selects which of the sprite pack's 3 hand-drawn
  // variants (e.g. sedan_v1/v2/v3) this instance renders as. Unused by BOSS,
  // which has a single dedicated sprite.
  variant: number;
}

export interface PowerUpItem extends GameObject {
  type: PowerUpType;
}

export interface Obstacle extends GameObject {
  type: ObstacleType;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface GameState {
  player: Player;
  vehicles: Vehicle[];
  powerups: PowerUpItem[];
  obstacles: Obstacle[];
  particles: Particle[];
  score: number;
  lives: number;
  distance: number;
  isGameOver: boolean;
  activePowerUp: PowerUpType | null;
  powerUpTimer: number;
  powerUpsUsed: number;
  screenShake: number;
  roadOffset: number;
  baseSpeed: number;
  lanes: number[];
  // Combo / near-miss
  combo: number;
  comboTimer: number;
  maxCombo: number;
  // HUD juice: counts down from POP_DURATION_MS on a trigger; renderer scales
  // the score/combo text based on how far through the decay it is.
  scorePop: number;
  comboPop: number;
  // Level-up flash
  levelUpFlash: number;
  levelUpText: string;
  lastSpeedLevel: number;
  // Boss
  bossTimer: number;
  bossActive: boolean;
  bossWarning: number;
  // Achievement tracking
  wasHit: boolean;
  tanksSlayed: number;
  achievementsEarned: string[];
  speedMultiplier: number;
  // Identity
  selectedCar: CarType;
  isDailyChallenge: boolean;
}

const REGULAR_TYPES = ['SEDAN', 'PICKUP', 'COP', 'BOXTRUCK', 'BUS', 'SPORTS'] as const;
const BOSS_INTERVAL_MS = 60000;
const COMBO_DECAY_MS = 3000;
export const POP_DURATION_MS = 220;
const NEAR_MISS_EXTRA_PX = 22;

// Traffic spawns on a bounded cooldown (min/max ms, scaled down as speed/
// distance ramp up) instead of a flat per-frame probability. A flat
// probability is bursty by nature — long empty stretches followed by
// clusters — which read as "sometimes no enemy, sometimes a ton" even
// though the average rate is unchanged. A cooldown keeps gaps consistent.
const VEHICLE_SPAWN_MIN_MS = 550;
const VEHICLE_SPAWN_MAX_MS = 1350;
const POWERUP_SPAWN_MIN_MS = 5000;
const POWERUP_SPAWN_MAX_MS = 11000;
const OBSTACLE_SPAWN_MIN_MS = 1800;
const OBSTACLE_SPAWN_MAX_MS = 4200;
// How close (px) a newly-spawned entity may land to an existing vehicle/
// obstacle it could otherwise spawn on top of or immediately merge into.
const SPAWN_X_BUFFER = 12;
// Minimum trailing gap enforced between two vehicles sharing overlapping
// x-ranges, so a faster car spawned behind a slower one can't visually
// clip through it before passing.
const VEHICLE_MIN_TRAIL_GAP = 46;

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private lastTime: number = 0;
  private animationId: number = 0;
  private onGameOver: (state: GameState) => void;
  private rng: () => number = Math.random;
  private selectedCar: CarType;
  private isDailyChallenge: boolean;
  private keys: Set<string> = new Set();
  private touchOffset: { x: number; y: number } = { x: 0, y: 0 };
  private isDragging: boolean = false;
  private joystickEnabled: boolean = false;
  private isPaused: boolean = false;
  private onPauseChange?: (paused: boolean) => void;
  private upgrades: { speed: number; armor: number; handling: number };
  private dailyModifier: DailyModifier;
  private joystick = {
    active: false,
    cx: 0, cy: 0,
    nx: 0, ny: 0,
  };
  private cameraY: number = 0;
  private initialPlayerY: number = 0;
  private grainPattern: CanvasPattern | null = null;
  private pixiRenderer: GameRenderer | null = null;
  // Bounded spawn-cooldown timers — see VEHICLE_SPAWN_MIN_MS doc comment.
  private vehicleSpawnTimer: number = 400;
  private powerupSpawnTimer: number = POWERUP_SPAWN_MIN_MS;
  private obstacleSpawnTimer: number = OBSTACLE_SPAWN_MIN_MS;
  // prefers-reduced-motion: screen shake is a known motion-sickness trigger,
  // so it's disabled entirely under reduced motion. The hit still registers
  // via the existing particle burst + invulnerability flicker, which aren't
  // camera-shake-based and are left untouched.
  private reducedMotion: boolean =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  constructor(
    canvas: HTMLCanvasElement,
    onGameOver: (state: GameState) => void,
    options?: { isDailyChallenge?: boolean; selectedCar?: CarType; joystickEnabled?: boolean; onPauseChange?: (paused: boolean) => void; upgrades?: { speed: number; armor: number; handling: number }; dailyModifier?: DailyModifier }
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onGameOver = onGameOver;
    this.selectedCar = options?.selectedCar ?? 'WAR_RUNNER';
    this.isDailyChallenge = options?.isDailyChallenge ?? false;
    this.joystickEnabled = options?.joystickEnabled ?? false;
    this.onPauseChange = options?.onPauseChange;
    this.upgrades = options?.upgrades ?? { speed: 0, armor: 0, handling: 0 };
    this.dailyModifier = options?.dailyModifier ?? { name: 'NONE', description: 'Standard rules.', speedMult: 1, spawnMult: 1, scoreMult: 1, obstacleMult: 1, scrapBonus: 0 };

    if (this.isDailyChallenge) {
      this.initDailyRNG();
    }

    const car = CAR_STATS[this.selectedCar];

    this.state = {
      player: {
        x: 0, y: 0,
        width: car.width,
        height: car.height,
        isInvulnerable: false,
        invulnTimer: 0,
        oilSlicked: false,
        oilTimer: 0,
      },
      vehicles: [],
      powerups: [],
      obstacles: [],
      particles: [],
      score: 0,
      lives: 3,
      distance: 0,
      isGameOver: false,
      activePowerUp: null,
      powerUpTimer: 0,
      powerUpsUsed: 0,
      screenShake: 0,
      roadOffset: 0,
      baseSpeed: 5,
      lanes: [],
      combo: 0,
      comboTimer: 0,
      maxCombo: 0,
      scorePop: 0,
      comboPop: 0,
      levelUpFlash: 0,
      levelUpText: '',
      lastSpeedLevel: 1,
      bossTimer: 0,
      bossActive: false,
      bossWarning: 0,
      wasHit: false,
      tanksSlayed: 0,
      achievementsEarned: [],
      speedMultiplier: 1,
      selectedCar: this.selectedCar,
      isDailyChallenge: this.isDailyChallenge,
    };

    this.init();
  }

  private initDailyRNG() {
    const d = new Date();
    let s = d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    this.rng = () => {
      s |= 0;
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private init() {
    const laneWidth = this.canvas.width / 3;
    this.state.lanes = [laneWidth / 2, laneWidth * 1.5, laneWidth * 2.5];
    this.state.player.x = this.state.lanes[1];
    this.state.player.y = this.canvas.height - 80;
    this.initialPlayerY = this.state.player.y;
    // cameraY is a delta from initialPlayerY (see draw()'s -cameraY translate),
    // so it starts at 0, not at the player's absolute position.
    this.cameraY = 0;
    this.joystick.cx = 70;
    this.joystick.cy = this.canvas.height - 80;
    this.joystick.nx = this.joystick.cx;
    this.joystick.ny = this.joystick.cy;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    this.canvas.addEventListener('touchcancel', this.handleTouchEnd, { passive: false });

    playAudio('gameplay', true);
  }

  public cleanup() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
    this.canvas.removeEventListener('touchend', this.handleTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.handleTouchEnd);
    cancelAnimationFrame(this.animationId);
    stopAudio('gameplay');
    this.pixiRenderer?.destroy();
    this.pixiRenderer = null;
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const tx = (touch.clientX - rect.left) * scaleX;
      const ty = (touch.clientY - rect.top) * scaleY;

      if (this.joystickEnabled) {
        const dx = tx - this.joystick.cx;
        const dy = ty - this.joystick.cy;
        if (Math.sqrt(dx * dx + dy * dy) <= 70) {
          this.joystick.active = true;
          this.updateJoystickKnob(tx, ty);
          return;
        }
      }

      this.touchOffset.x = tx - this.state.player.x;
      this.touchOffset.y = ty - this.state.player.y;
      this.isDragging = !this.state.player.oilSlicked;
    }
  };

  private handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const tx = (touch.clientX - rect.left) * scaleX;
      const ty = (touch.clientY - rect.top) * scaleY;

      if (this.joystick.active) {
        this.updateJoystickKnob(tx, ty);
        return;
      }

      if (this.isDragging && !this.state.player.oilSlicked) {
        this.state.player.x = tx - this.touchOffset.x;
        this.state.player.y = ty - this.touchOffset.y;
        this.clampPlayerPosition();
      }
    }
  };

  private handleTouchEnd = (e: TouchEvent) => {
    e.preventDefault();
    this.isDragging = false;
    this.joystick.active = false;
    this.joystick.nx = this.joystick.cx;
    this.joystick.ny = this.joystick.cy;
  };

  private updateJoystickKnob(tx: number, ty: number) {
    const maxR = 40;
    const dx = tx - this.joystick.cx;
    const dy = ty - this.joystick.cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= maxR) {
      this.joystick.nx = tx;
      this.joystick.ny = ty;
    } else {
      const ratio = maxR / dist;
      this.joystick.nx = this.joystick.cx + dx * ratio;
      this.joystick.ny = this.joystick.cy + dy * ratio;
    }
  }

  private clampPlayerPosition() {
    const player = this.state.player;
    const roadLeft = 18 + player.width / 2;
    const roadRight = this.canvas.width - 18 - player.width / 2;
    player.x = Math.max(roadLeft, Math.min(roadRight, player.x));
    player.y = Math.max(player.height / 2 + 10, Math.min(this.canvas.height - 60, player.y));
  }

  public start() {
    this.lastTime = performance.now();
    this.animationId = requestAnimationFrame(this.loop);
  }

  public pause() {
    if (this.isPaused || this.state.isGameOver) return;
    this.isPaused = true;
    this.onPauseChange?.(true);
  }

  public resume() {
    if (!this.isPaused || this.state.isGameOver) return;
    this.isPaused = false;
    this.lastTime = performance.now();
    this.onPauseChange?.(false);
  }

  public getPaused() {
    return this.isPaused;
  }

  // Read-only escape hatch for the DOM HUD overlay (game-hud-overlay.tsx),
  // which reads this every frame via its own rAF loop instead of React
  // state, to avoid re-rendering the component tree at 60fps. Callers must
  // not mutate the returned object.
  public getState(): Readonly<GameState> {
    return this.state;
  }

  // Swaps the draw path to a Pixi (WebGL) renderer — see GameRenderer above.
  // Passing null reverts to the built-in Canvas 2D draw().
  public attachRenderer(renderer: GameRenderer | null) {
    this.pixiRenderer?.destroy();
    this.pixiRenderer = renderer;
    if (renderer) {
      // Pixi's canvas is transparent and layered above this one; once it's
      // driving the frame, nothing else clears this canvas's last Canvas 2D
      // frame (HUD included), so it would otherwise show through forever.
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private loop = (timestamp: number) => {
    if (this.state.isGameOver) return;
    const dt = Math.min(timestamp - this.lastTime, 50);
    this.lastTime = timestamp;
    if (!this.isPaused) {
      this.update(dt);
    }
    if (this.pixiRenderer) {
      this.pixiRenderer.sync(this.state, this.cameraY, this.state.screenShake);
    } else {
      this.draw();
    }
    if (!this.state.isGameOver) {
      this.animationId = requestAnimationFrame(this.loop);
    }
  };

  private getSpeedLevel(distance: number) {
    return Math.min(5, 1 + Math.floor(distance / 1000 / 15));
  }

  private getSpeedMultiplier(distance: number) {
    return Math.min(3, 1 + (this.getSpeedLevel(distance) - 1) * 0.5);
  }

  private update(dt: number) {
    const state = this.state;

    // Input vector (keys + joystick)
    let dx = 0;
    let dy = 0;
    if (!state.player.oilSlicked) {
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dx -= 1;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dx += 1;
      if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) dy -= 1;
      if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) dy += 1;

      if (this.joystickEnabled && this.joystick.active) {
        const jdx = this.joystick.nx - this.joystick.cx;
        const jdy = this.joystick.ny - this.joystick.cy;
        const jlen = Math.sqrt(jdx * jdx + jdy * jdy);
        if (jlen > 4) {
          dx = jdx / jlen;
          dy = jdy / jlen;
        }
      }
    }

    // Speed
    const newLevel = this.getSpeedLevel(state.distance);
    const speedMult = this.getSpeedMultiplier(state.distance);
    state.speedMultiplier = speedMult;

    if (newLevel > state.lastSpeedLevel) {
      state.lastSpeedLevel = newLevel;
      state.levelUpFlash = 1800;
      state.levelUpText = speedMult >= 3 ? 'MAX SPEED!' : 'SPEED UP!';
      if (speedMult >= 3) this.grantAchievement('speed_demon');
    }

    const carMod = CAR_STATS[this.selectedCar].speedMod * (1 + this.upgrades.speed * 0.03);
    let currentSpeed = state.baseSpeed * speedMult * carMod * this.dailyModifier.speedMult;
    if (state.activePowerUp === 'SLOWMO') currentSpeed *= 0.4;

    // Forward / back speed feel (up = faster, down = slower)
    if (!state.player.oilSlicked) {
      if (dy < 0) currentSpeed *= 1.2;
      else if (dy > 0) currentSpeed *= 0.78;
    }
    currentSpeed = Math.max(1.5, currentSpeed);

    // Distance & score
    state.distance += currentSpeed * (dt / 16);
    const scoreMult = state.activePowerUp === 'SCORE_BLAST' ? 3 : 1;
    const comboBonus = 1 + Math.min(state.combo, 20) * 0.05;
    state.score += (currentSpeed / 10) * scoreMult * comboBonus * this.dailyModifier.scoreMult;

    // Road scroll
    state.roadOffset = (state.roadOffset + currentSpeed * 1.5) % 80;

    // Player movement
    if (!state.player.oilSlicked) {
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        // Base speed tuned so diagonal doesn't outrun horizontal/vertical
        const moveSpeed = 0.42 * (1 + this.upgrades.handling * 0.08) * (dt / 16);
        state.player.x += (dx / len) * moveSpeed;
        state.player.y += (dy / len) * moveSpeed;
      }
      this.clampPlayerPosition();
    } else {
      // Slight drift when oiled
      state.player.x += Math.sin(state.distance * 0.08) * 2;
      this.clampPlayerPosition();
    }

    // Camera follow — car drifts within the frame for a bigger sense of speed
    const targetCameraY = (state.player.y - this.initialPlayerY) * 0.65;
    const cameraMax = this.canvas.height * 0.18;
    const clampedTarget = Math.max(-cameraMax, Math.min(cameraMax, targetCameraY));
    this.cameraY += (clampedTarget - this.cameraY) * 0.12;

    // Timers
    if (state.activePowerUp) {
      state.powerUpTimer -= dt;
      if (state.powerUpTimer <= 0) state.activePowerUp = null;
    }
    if (state.player.invulnTimer > 0) {
      state.player.invulnTimer -= dt;
      state.player.isInvulnerable = state.player.invulnTimer > 0;
    }
    if (state.player.oilTimer > 0) {
      state.player.oilTimer -= dt;
      state.player.oilSlicked = state.player.oilTimer > 0;
    }
    if (state.screenShake > 0) state.screenShake = Math.max(0, state.screenShake - dt);
    if (state.levelUpFlash > 0) state.levelUpFlash -= dt;
    if (state.scorePop > 0) state.scorePop = Math.max(0, state.scorePop - dt);
    if (state.comboPop > 0) state.comboPop = Math.max(0, state.comboPop - dt);
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 0;
    }

    // Boss warning countdown
    if (state.bossWarning > 0) {
      state.bossWarning -= dt;
      if (state.bossWarning <= 0 && !state.bossActive) {
        this.spawnBoss(currentSpeed);
      }
    }

    // Boss interval timer
    if (!state.bossActive && state.bossWarning <= 0) {
      state.bossTimer += dt;
      if (state.bossTimer >= BOSS_INTERVAL_MS) {
        state.bossTimer = 0;
        state.bossWarning = 3000;
        playAudio('shield');
      }
    }

    // Spawn vehicles — bounded cooldown scheduler (see VEHICLE_SPAWN_MIN_MS
    // doc comment above) instead of a flat per-frame probability.
    const densityRamp = Math.min(2.2, 1 + state.distance / 18000);
    this.vehicleSpawnTimer -= dt;
    if (this.vehicleSpawnTimer <= 0) {
      const lane = this.spawnVehicle(currentSpeed);
      // Occasional pairs at higher distances
      if (state.distance > 25000 && lane !== undefined && this.rng() < 0.3) {
        this.spawnVehicle(currentSpeed, lane);
      }
      const factor = Math.max(0.4, speedMult * densityRamp * this.dailyModifier.spawnMult);
      const base = VEHICLE_SPAWN_MIN_MS + this.rng() * (VEHICLE_SPAWN_MAX_MS - VEHICLE_SPAWN_MIN_MS);
      this.vehicleSpawnTimer = Math.max(200, base / factor);
    }

    // Spawn powerups
    this.powerupSpawnTimer -= dt;
    if (this.powerupSpawnTimer <= 0) {
      this.trySpawnPowerup();
      this.powerupSpawnTimer = POWERUP_SPAWN_MIN_MS + this.rng() * (POWERUP_SPAWN_MAX_MS - POWERUP_SPAWN_MIN_MS);
    }

    // Spawn obstacles (only after first 10 seconds)
    if (state.distance > 10000) {
      this.obstacleSpawnTimer -= dt;
      if (this.obstacleSpawnTimer <= 0) {
        this.trySpawnObstacle();
        const factor = Math.max(0.4, speedMult * this.dailyModifier.obstacleMult);
        const base = OBSTACLE_SPAWN_MIN_MS + this.rng() * (OBSTACLE_SPAWN_MAX_MS - OBSTACLE_SPAWN_MIN_MS);
        this.obstacleSpawnTimer = Math.max(400, base / factor);
      }
    }

    // Update vehicles
    for (let i = state.vehicles.length - 1; i >= 0; i--) {
      const v = state.vehicles[i];
      v.y += currentSpeed + v.speed * 0.5;

      if (v.y > this.canvas.height + 150) {
        if (v.type === 'TANK') {
          state.score += 500;
          state.scorePop = POP_DURATION_MS;
          state.tanksSlayed++;
          if (state.tanksSlayed >= 3) this.grantAchievement('tank_slayer');
        }
        if (v.type === 'BOSS') {
          state.score += 1500;
          state.scorePop = POP_DURATION_MS;
          state.bossActive = false;
        }
        state.vehicles.splice(i, 1);
        continue;
      }

      // Near-miss detection: vehicle just passed the player's midpoint
      if (!v.passed && v.y > state.player.y + state.player.height / 2) {
        v.passed = true;
        const xDist = Math.abs(v.x - state.player.x);
        const minSafe = (state.player.width + v.width) / 2 - 5;
        const maxNearMiss = minSafe + NEAR_MISS_EXTRA_PX;
        if (xDist > minSafe && xDist < maxNearMiss) {
          state.combo++;
          state.comboPop = POP_DURATION_MS;
          if (state.combo > state.maxCombo) state.maxCombo = state.combo;
          state.comboTimer = COMBO_DECAY_MS;
          if (state.combo >= 10) this.grantAchievement('combo_king');
          if ('vibrate' in navigator) navigator.vibrate(25);
        }
      }

      // Collision
      if (!state.player.isInvulnerable && state.activePowerUp !== 'SHIELD' && this.checkCollision(state.player, v)) {
        this.handleCrash();
      }
    }

    // Separate vehicles with overlapping x-ranges that have crept closer
    // than the minimum trailing gap — without this, a fast vehicle spawned
    // behind a slow one (or a pair spawned close together) can visually
    // clip through / merge with it before passing off-screen.
    for (let i = 0; i < state.vehicles.length; i++) {
      const behind = state.vehicles[i];
      for (let j = 0; j < state.vehicles.length; j++) {
        if (i === j) continue;
        const ahead = state.vehicles[j];
        if (ahead.y <= behind.y) continue;
        const xOverlap = Math.abs(behind.x - ahead.x) < (behind.width + ahead.width) / 2 + 6;
        if (!xOverlap) continue;
        const gap = ahead.y - behind.y - (behind.height + ahead.height) / 2;
        if (gap < VEHICLE_MIN_TRAIL_GAP) {
          behind.y = ahead.y - (behind.height + ahead.height) / 2 - VEHICLE_MIN_TRAIL_GAP;
        }
      }
    }

    // Update powerups
    for (let i = state.powerups.length - 1; i >= 0; i--) {
      const p = state.powerups[i];
      p.y += currentSpeed;
      if (p.y > this.canvas.height + 50) { state.powerups.splice(i, 1); continue; }
      if (this.checkCollision(state.player, p)) {
        this.collectPowerUp(p.type);
        state.powerups.splice(i, 1);
      }
    }

    // Update obstacles
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      o.y += currentSpeed * 0.55;
      if (o.y > this.canvas.height + 80) { state.obstacles.splice(i, 1); continue; }

      if (!state.player.isInvulnerable && state.activePowerUp !== 'SHIELD' && this.checkCollision(state.player, o)) {
        if (o.type === 'OIL_SLICK' && !state.player.oilSlicked) {
          state.player.oilSlicked = true;
          state.player.oilTimer = 2500;
          state.obstacles.splice(i, 1);
          if ('vibrate' in navigator) navigator.vibrate([40, 40, 40]);
        } else if (o.type === 'DEBRIS') {
          this.handleCrash();
          state.obstacles.splice(i, 1);
        }
      }
    }

    // Update particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy + currentSpeed * 0.2;
      p.life -= dt;
      if (p.life <= 0) state.particles.splice(i, 1);
    }

    // Ongoing achievement checks
    if (state.distance >= 60000) this.grantAchievement('road_warrior');
    if (state.score >= 10000) this.grantAchievement('warboss');
    if (state.powerUpsUsed >= 5) this.grantAchievement('powerup_addict');
  }

  // True if no existing vehicle/obstacle sits within `xBuffer` horizontally
  // and `yBuffer` vertically of (x, spawnY) — used to keep new spawns from
  // landing on top of / merging into something already there.
  private isAreaClear(x: number, width: number, spawnY: number, yBuffer: number, xBuffer = SPAWN_X_BUFFER): boolean {
    const state = this.state;
    const overlaps = (ox: number, ow: number, oy: number) =>
      Math.abs(oy - spawnY) < yBuffer && Math.abs(ox - x) < (ow + width) / 2 + xBuffer;
    for (const v of state.vehicles) if (overlaps(v.x, v.width, v.y)) return false;
    for (const o of state.obstacles) if (overlaps(o.x, o.width, o.y)) return false;
    return true;
  }

  // Picks a lane + an x offset jittered across that lane's full width
  // (instead of always dead-center — see the "only the middle lane ever has
  // traffic" / "idle on a lane boundary is safe" reports), retrying a few
  // times against isAreaClear so it doesn't land on an existing vehicle.
  private findSafeSpawnX(width: number, excludeLane?: number): { lane: number; x: number } | null {
    const state = this.state;
    const laneWidth = this.canvas.width / 3;
    const jitterRange = Math.max(0, laneWidth / 2 - width / 2 - 8);
    for (let attempt = 0; attempt < 6; attempt++) {
      let lane = Math.floor(this.rng() * 3);
      if (excludeLane !== undefined && lane === excludeLane) lane = (lane + 1) % 3;
      const x = state.lanes[lane] + (this.rng() * 2 - 1) * jitterRange;
      if (this.isAreaClear(x, width, -100, 170)) return { lane, x };
    }
    return null;
  }

  private spawnVehicle(currentSpeed: number, excludeLane?: number): number | undefined {
    const state = this.state;
    const isTank = this.rng() < 0.01;
    let type: VehicleType = isTank
      ? 'TANK'
      : REGULAR_TYPES[Math.floor(this.rng() * REGULAR_TYPES.length)];

    let width = 30, height = 50, speed = currentSpeed * 0.8;
    if (type === 'BUS')      { width = 45; height = 90; speed = currentSpeed * 0.6; }
    if (type === 'SPORTS')   { height = 45; speed = currentSpeed * 1.5; }
    if (type === 'BOXTRUCK') { width = 35; height = 70; speed = currentSpeed * 0.7; }
    if (type === 'TANK')     { width = 50; height = 80; speed = currentSpeed * 0.4; }

    const spot = this.findSafeSpawnX(width, excludeLane);
    if (!spot) return undefined;

    const colors = ['#555', '#453c31', '#222', '#4b5320', '#cc0000', '#dcdcdc'];
    const color = colors[Math.floor(this.rng() * colors.length)];
    const variant = Math.floor(this.rng() * 3) + 1;

    state.vehicles.push({ type, x: spot.x, y: -100, width, height, color, speed, lane: spot.lane, passed: false, variant });
    return spot.lane;
  }

  private trySpawnPowerup() {
    const state = this.state;
    const types: PowerUpType[] = ['SHIELD', 'SLOWMO', 'SCORE_BLAST', 'EXTRA_LIFE'];
    const width = 30;
    for (let attempt = 0; attempt < 3; attempt++) {
      const lane = Math.floor(this.rng() * 3);
      const x = state.lanes[lane];
      if (this.isAreaClear(x, width, -50, 150)) {
        const type = types[Math.floor(this.rng() * types.length)];
        state.powerups.push({ type, x, y: -50, width, height: 30 });
        return;
      }
    }
  }

  private trySpawnObstacle() {
    const state = this.state;
    for (let attempt = 0; attempt < 3; attempt++) {
      const type: ObstacleType = this.rng() < 0.5 ? 'OIL_SLICK' : 'DEBRIS';
      const width = type === 'OIL_SLICK' ? 55 : 28;
      const height = type === 'OIL_SLICK' ? 28 : 22;
      const lane = Math.floor(this.rng() * 3);
      const x = state.lanes[lane];
      if (this.isAreaClear(x, width, -80, 150)) {
        state.obstacles.push({ type, x, y: -80, width, height });
        return;
      }
    }
  }

  private spawnBoss(currentSpeed: number) {
    const state = this.state;
    state.bossActive = true;
    const laneWidth = this.canvas.width / 3;
    // Boss centers between lanes 0-1 or 1-2
    const useLow = this.rng() < 0.5;
    const centerX = useLow
      ? (state.lanes[0] + state.lanes[1]) / 2
      : (state.lanes[1] + state.lanes[2]) / 2;

    state.vehicles.push({
      type: 'BOSS',
      x: centerX,
      y: -160,
      width: laneWidth * 1.85,
      height: 120,
      color: '#1a0a00',
      speed: currentSpeed * 0.25,
      lane: 1,
      passed: false,
      variant: 1,
    });
  }

  private checkCollision(r1: GameObject, r2: GameObject) {
    // Was 5px per side (10px total forgiveness) — stacked with the narrow
    // player cars (see CAR_STATS DEATHSLED/PHANTOM comments), the effective
    // hitbox shrank enough that careful play could avoid ever colliding.
    const shrink = 3;
    return (
      r1.x - r1.width / 2 + shrink < r2.x + r2.width / 2 - shrink &&
      r1.x + r1.width / 2 - shrink > r2.x - r2.width / 2 + shrink &&
      r1.y - r1.height / 2 + shrink < r2.y + r2.height / 2 - shrink &&
      r1.y + r1.height / 2 - shrink > r2.y - r2.height / 2 + shrink
    );
  }

  private handleCrash() {
    if (this.state.player.isInvulnerable) return;
    if (this.upgrades.armor > 0 && Math.random() < this.upgrades.armor * 0.1) {
      this.state.player.isInvulnerable = true;
      this.state.player.invulnTimer = 1500;
      this.createParticles(this.state.player.x, this.state.player.y, '#ffaa00', 10);
      if ('vibrate' in navigator) navigator.vibrate(60);
      return;
    }
    playAudio('crash');
    this.state.screenShake = this.reducedMotion ? 0 : 300;
    this.state.combo = 0;
    this.state.comboTimer = 0;
    this.state.wasHit = true;
    this.createParticles(this.state.player.x, this.state.player.y, '#ff3300', 20);
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);

    this.state.lives--;
    if (this.state.lives <= 0) {
      this.gameOver();
    } else {
      this.state.player.isInvulnerable = true;
      this.state.player.invulnTimer = 2000;
    }
  }

  private collectPowerUp(type: PowerUpType) {
    playAudio(type === 'SHIELD' ? 'shield' : 'powerup');
    if ('vibrate' in navigator) navigator.vibrate(60);
    this.state.powerUpsUsed++;

    if (type === 'EXTRA_LIFE') {
      this.state.lives = Math.min(5, this.state.lives + 1);
    } else {
      this.state.activePowerUp = type;
      this.state.powerUpTimer = POWERUP_DURATION_MS[type];
    }
  }

  private grantAchievement(id: string) {
    if (!this.state.achievementsEarned.includes(id)) {
      this.state.achievementsEarned.push(id);
    }
  }

  private createParticles(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      this.state.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10,
        life: 500 + Math.random() * 500,
        maxLife: 1000,
        color,
        size: 2 + Math.random() * 4,
      });
    }
  }

  private gameOver() {
    const state = this.state;
    state.isGameOver = true;
    if (!state.wasHit) this.grantAchievement('untouchable');
    if (state.lives >= 3) this.grantAchievement('survivor');
    playAudio('gameover');
    stopAudio('gameplay');
    this.onGameOver(state);
  }

  private draw() {
    const { ctx, canvas, state } = this;
    ctx.save();

    // Screen shake
    if (state.screenShake > 0) {
      const i = (state.screenShake / 300) * 9;
      ctx.translate((Math.random() - 0.5) * i, (Math.random() - 0.5) * i);
    }

    // Camera follow — car drifts within the frame for a bigger sense of speed
    ctx.save();
    ctx.translate(0, -this.cameraY);

    this.drawRoad(ctx, canvas);

    // Obstacles
    state.obstacles.forEach(o => {
      ctx.save();
      ctx.translate(o.x, o.y);
      drawObstacle(ctx, o.type, o.width, o.height);
      ctx.restore();
    });

    // Vehicles
    state.vehicles.forEach(v => {
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(Math.PI);
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
      ctx.strokeStyle = '#fff';
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
        // Outer rotating hexagon
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + t;
          const px = Math.cos(a) * 38, py = Math.sin(a) * 38;
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
        ctx.arc(0, 0, 28 + pulse * 4, 0, Math.PI * 2);
        ctx.stroke();
        // Fill
        ctx.fillStyle = 'rgba(0,255,255,0.08)';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3 + t;
          const px = Math.cos(a) * 38, py = Math.sin(a) * 38;
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

    // HUD, level-up flash, boss warning, and near-miss combo text all moved
    // to a DOM overlay (game-hud-overlay.tsx) — see the Pixi rewrite plan's
    // Phase D. It reads GameEngine.getState() directly and renders
    // independently of which renderer (this Canvas 2D path or Pixi) is
    // driving the game-world visuals underneath it.

    ctx.restore();

    // Virtual joystick
    this.drawJoystick(ctx);
  }

  private drawRoad(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const state = this.state;
    const W = canvas.width;
    const H = canvas.height;
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
    if (!this.joystickEnabled || this.state.isGameOver) return;
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
