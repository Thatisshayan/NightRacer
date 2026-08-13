import { DailyModifier } from './daily';

export type PowerUpType = 'SHIELD' | 'SLOWMO' | 'SCORE_BLAST' | 'EXTRA_LIFE';
export type CarType = 'RATTLETRAP' | 'WAR_RUNNER' | 'DEATHSLED' | 'SCRAPQUEEN' | 'PHANTOM';
export type VehicleType = 'SEDAN' | 'PICKUP' | 'COP' | 'BOXTRUCK' | 'BUS' | 'SPORTS' | 'TANK' | 'BOSS';
export type ObstacleType = 'OIL_SLICK' | 'DEBRIS';

// Single source of truth for timed power-up durations, shared with HUD
// overlays so their progress-bar fill can't drift out of sync with the
// actual timer set in collectPowerUp() below.
export const POWERUP_DURATION_MS: Record<Exclude<PowerUpType, 'EXTRA_LIFE'>, number> = {
  SHIELD: 5000,
  SLOWMO: 4000,
  SCORE_BLAST: 6000,
};

// Structural interface only — kept free of any rendering-library import so
// this package never pulls a specific renderer (Pixi on web, Skia on
// native) in statically. Each platform's app hands the engine a concrete
// implementation through `attachRenderer`.
export interface GameRenderer {
  sync(state: GameState, cameraY: number, screenShake: number): void;
  destroy(): void;
}

// Platform-supplied sound implementation — GameEngine only ever calls
// `audio.play(cue, loop?)` / `audio.stop(cue)`, never touches a concrete
// audio API directly, so it stays usable outside a browser. Defaults to a
// no-op if the host app doesn't supply one.
export interface AudioAdapter {
  play(cue: string, loop?: boolean): void;
  stop(cue: string): void;
}

const NOOP_AUDIO: AudioAdapter = { play() {}, stop() {} };

export interface CarStats {
  width: number;
  height: number;
  speedMod: number;
  color: string;
  label: string;
  desc: string;
  stats: string;
}

// Widths/heights scaled ×1.6 from their original values (2026-08-03) —
// going from 3 lanes to 4 (see init()'s laneWidth) narrowed each lane from
// 140px to 105px, and on top of that cars were already reading small
// against the road (a 30px-wide WAR_RUNNER was 21% of even the old, wider
// lane — a real highway lane is closer to 50% car-to-lane). ×1.6 puts
// WAR_RUNNER at 46% of the new 105px lane, with RATTLETRAP/SCRAPQUEEN
// intentionally tighter (61%/70%) to keep their "wide, hard to place"
// identity meaningful instead of homogenizing every car to one ratio.
export const CAR_STATS: Record<CarType, CarStats> = {
  RATTLETRAP: {
    width: 64,
    height: 99,
    speedMod: 0.85,
    color: '#a86b32',
    label: 'RATTLETRAP',
    desc: 'Wide & sturdy. Slower to react.',
    stats: 'SPD ██░░░  ARM █████',
  },
  WAR_RUNNER: {
    width: 48,
    height: 80,
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
    width: 48,
    height: 74,
    speedMod: 1.15,
    color: '#3d6db8',
    label: 'DEATHSLED',
    desc: 'Narrow & fast. High risk.',
    stats: 'SPD █████  ARM █░░░░',
  },
  SCRAPQUEEN: {
    width: 74,
    height: 112,
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
    width: 38,
    height: 67,
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
  // Lanes 0-1 are oncoming traffic (rushes toward the player, closing
  // speed = currentSpeed + v.speed — the original, only behavior before
  // this field existed); lanes 2-3 travel the same direction as the
  // player (closing speed = currentSpeed - v.speed, so a slower-type
  // vehicle drifts toward the player like traffic you're catching up to,
  // and a faster one can pull away). Renderers use this to pick sprite
  // rotation — oncoming traffic faces the player (rotated 180°), same-
  // direction traffic faces away, matching the player's own orientation.
  direction: 'SAME' | 'OPPOSITE';
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

// Platform-agnostic core simulation — no DOM/browser API of any kind.
// Input, haptics, audio, and world dimensions are all supplied by the
// host platform instead of read directly from `window`/`navigator`/a real
// `HTMLCanvasElement`, so the exact same simulation (traffic, collisions,
// scoring, power-ups, achievements — everything in `update()`) runs
// unmodified on both the web (Canvas2D/Pixi) and native (Skia) renderers.
// A platform subclass supplies rendering via `attachRenderer()` (see
// `GameRenderer` above) and may override `renderFallback()`/
// `onRendererAttached()` for a renderer-less fallback path (the web
// package's Canvas2D draw path is exactly this — see web-engine.ts).
export class GameEngine {
  protected width: number;
  protected height: number;
  private state: GameState;
  private lastTime: number = 0;
  private animationId: number = 0;
  private onGameOver: (state: GameState) => void;
  private rng: () => number = Math.random;
  protected selectedCar: CarType;
  protected isDailyChallenge: boolean;
  private keys: Set<string> = new Set();
  private touchOffset: { x: number; y: number } = { x: 0, y: 0 };
  private isDragging: boolean = false;
  protected joystickEnabled: boolean = false;
  private isPaused: boolean = false;
  private onPauseChange?: (paused: boolean) => void;
  protected upgrades: { speed: number; armor: number; handling: number };
  private dailyModifier: DailyModifier;
  protected joystick = {
    active: false,
    cx: 0, cy: 0,
    nx: 0, ny: 0,
  };
  protected cameraY: number = 0;
  private initialPlayerY: number = 0;
  private renderer: GameRenderer | null = null;
  // Bounded spawn-cooldown timers — see VEHICLE_SPAWN_MIN_MS doc comment.
  private vehicleSpawnTimer: number = 400;
  private powerupSpawnTimer: number = POWERUP_SPAWN_MIN_MS;
  private obstacleSpawnTimer: number = OBSTACLE_SPAWN_MIN_MS;
  private audio: AudioAdapter;
  // Optional platform haptics hook (web: navigator.vibrate, native:
  // expo-haptics) — every call site already only fires on discrete events
  // (crash, near-miss, powerup pickup...), so a single-argument-pattern
  // signature matching the Web Vibration API covers both.
  private haptics?: (pattern: number | number[]) => void;
  // prefers-reduced-motion: screen shake is a known motion-sickness trigger,
  // so it's disabled entirely under reduced motion. The hit still registers
  // via the existing particle burst + invulnerability flicker, which aren't
  // camera-shake-based and are left untouched. Supplied by the host platform
  // (web: window.matchMedia; native: AccessibilityInfo) instead of read
  // directly, since neither API exists universally.
  private reducedMotion: boolean;

  // dims are logical simulation pixels (not a canvas/element) — each
  // platform adapter maps its own rendering surface onto this space (see
  // web-engine.ts / native-engine.ts). `options.audio`/`haptics` are
  // no-op if omitted; `reducedMotion` disables screen shake only (see the
  // field comment above). All other options default to their web-parity
  // behavior when omitted.
  constructor(
    dims: { width: number; height: number },
    onGameOver: (state: GameState) => void,
    options?: {
      isDailyChallenge?: boolean;
      selectedCar?: CarType;
      joystickEnabled?: boolean;
      onPauseChange?: (paused: boolean) => void;
      upgrades?: { speed: number; armor: number; handling: number };
      dailyModifier?: DailyModifier;
      audio?: AudioAdapter;
      haptics?: (pattern: number | number[]) => void;
      reducedMotion?: boolean;
    }
  ) {
    this.width = dims.width;
    this.height = dims.height;
    this.onGameOver = onGameOver;
    this.selectedCar = options?.selectedCar ?? 'WAR_RUNNER';
    this.isDailyChallenge = options?.isDailyChallenge ?? false;
    this.joystickEnabled = options?.joystickEnabled ?? false;
    this.onPauseChange = options?.onPauseChange;
    this.upgrades = options?.upgrades ?? { speed: 0, armor: 0, handling: 0 };
    this.dailyModifier = options?.dailyModifier ?? { name: 'NONE', description: 'Standard rules.', speedMult: 1, spawnMult: 1, scoreMult: 1, obstacleMult: 1, scrapBonus: 0 };
    this.audio = options?.audio ?? NOOP_AUDIO;
    this.haptics = options?.haptics;
    this.reducedMotion = options?.reducedMotion ?? false;

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
    // 4 lanes instead of 3 (2026-08-03) — lanes 0-1 carry oncoming
    // traffic, lanes 2-3 carry same-direction traffic (see Vehicle.
    // direction). Player starts in lane 2, the near side of its own
    // direction's pair.
    const laneWidth = this.width / 4;
    this.state.lanes = [laneWidth / 2, laneWidth * 1.5, laneWidth * 2.5, laneWidth * 3.5];
    this.state.player.x = this.state.lanes[2];
    this.state.player.y = this.height - 80;
    this.initialPlayerY = this.state.player.y;
    // cameraY is a delta from initialPlayerY, so it starts at 0, not at the
    // player's absolute position.
    this.cameraY = 0;
    this.joystick.cx = 70;
    this.joystick.cy = this.height - 80;
    this.joystick.nx = this.joystick.cx;
    this.joystick.ny = this.joystick.cy;

    this.audio.play('gameplay', true);
  }

  // No DOM listeners to remove here — the host platform owns its own input
  // wiring and calls cleanup() on whatever teardown it needs independently.
  public cleanup() {
    cancelAnimationFrame(this.animationId);
    this.audio.stop('gameplay');
    this.renderer?.destroy();
    this.renderer = null;
  }

  // Host platform calls these from its own keyboard wiring (web only —
  // native has no physical keyboard). `code` matches KeyboardEvent.code
  // values (e.g. 'ArrowLeft', 'KeyA').
  public handleKeyDown(code: string) {
    this.keys.add(code);
  }

  public handleKeyUp(code: string) {
    this.keys.delete(code);
  }

  // Host platform calls these from its own pointer/touch/gesture wiring,
  // already converted into this canvas's coordinate space (i.e. the same
  // space as `width`/`height` passed to the constructor) — web converts
  // screen coords via getBoundingClientRect()+scale before calling in;
  // native gesture handlers already report local coordinates directly.
  public pointerDown(x: number, y: number) {
    if (this.joystickEnabled) {
      const dx = x - this.joystick.cx;
      const dy = y - this.joystick.cy;
      if (Math.sqrt(dx * dx + dy * dy) <= 70) {
        this.joystick.active = true;
        this.updateJoystickKnob(x, y);
        return;
      }
    }

    this.touchOffset.x = x - this.state.player.x;
    this.touchOffset.y = y - this.state.player.y;
    this.isDragging = !this.state.player.oilSlicked;
  }

  public pointerMove(x: number, y: number) {
    if (this.joystick.active) {
      this.updateJoystickKnob(x, y);
      return;
    }

    if (this.isDragging && !this.state.player.oilSlicked) {
      this.state.player.x = x - this.touchOffset.x;
      this.state.player.y = y - this.touchOffset.y;
      this.clampPlayerPosition();
    }
  }

  public pointerUp() {
    this.isDragging = false;
    this.joystick.active = false;
    this.joystick.nx = this.joystick.cx;
    this.joystick.ny = this.joystick.cy;
  }

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
    const roadRight = this.width - 18 - player.width / 2;
    player.x = Math.max(roadLeft, Math.min(roadRight, player.x));
    player.y = Math.max(player.height / 2 + 10, Math.min(this.height - 60, player.y));
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

  // Read-only escape hatch for HUD overlays, which read this every frame
  // via their own rAF loop instead of framework state, to avoid
  // re-rendering the component tree at 60fps. Callers must not mutate the
  // returned object.
  public getState(): Readonly<GameState> {
    return this.state;
  }

  // Swaps the active renderer (see `GameRenderer` above). Passing null
  // reverts to `renderFallback()` — a no-op here; the web package
  // overrides it with a Canvas2D draw path (see web-engine.ts).
  public attachRenderer(renderer: GameRenderer | null) {
    this.renderer?.destroy();
    this.renderer = renderer;
    if (renderer) this.onRendererAttached();
  }

  // Called once whenever a non-null renderer is attached — the web
  // subclass uses this to clear its own Canvas2D surface so a stale frame
  // doesn't show through underneath the new renderer's (transparent)
  // canvas forever.
  protected onRendererAttached(): void {}

  // Called every frame instead of a renderer's sync() when none is
  // attached. No-op here; the web subclass overrides it to run the
  // Canvas2D draw path.
  protected renderFallback(): void {}

  private loop = (timestamp: number) => {
    if (this.state.isGameOver) return;
    const dt = Math.min(timestamp - this.lastTime, 50);
    this.lastTime = timestamp;
    if (!this.isPaused) {
      this.update(dt);
    }
    if (this.renderer) {
      this.renderer.sync(this.state, this.cameraY, this.state.screenShake);
    } else {
      this.renderFallback();
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
    // Frame normalization factor — the per-frame motion below (traffic,
    // obstacles, powerups, particles) is expressed in "pixels per 60fps
    // frame" and must be scaled by this so the same wall-clock duration
    // moves the world identically at 30fps or 120fps. The player, distance,
    // and score updates already scale by dt/16; these must too, or the game
    // plays slower/faster depending on the device's refresh rate (see the
    // framerate-independence test in engine.test.ts).
    const frameScale = dt / 16;

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
        // Base speed tuned so diagonal doesn't outrun horizontal/vertical.
        // Was 0.42 (≈25px/sec at 60fps) since this was first written —
        // crossing a single lane took several seconds, an order of
        // magnitude slower than drag/touch input (which sets player.x
        // directly, effectively instant), so keyboard/joystick players
        // could never out-steer approaching traffic. A first pass raised
        // this to 5.5, which real playtesting called too twitchy; settled
        // here at a pace that crosses one of the (now-narrower, 105px)
        // lanes in a bit over half a second.
        const moveSpeed = 3.2 * (1 + this.upgrades.handling * 0.08) * (dt / 16);
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
    const cameraMax = this.height * 0.18;
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
        this.audio.play('shield');
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
      if (v.direction === 'SAME') {
        // Same-direction traffic: closing speed is currentSpeed minus its
        // own pace, not a sum — a slower type (BUS/TANK, low speed
        // multiplier) drifts toward the player like highway traffic
        // you're gaining on; a faster one (SPORTS) can pull away instead.
        // Floor keeps it from ever fully stalling on screen.
        v.y += Math.max(1.2, currentSpeed - v.speed * 0.7) * frameScale;
      } else {
        v.y += (currentSpeed + v.speed * 0.5) * frameScale;
      }

      if (v.y > this.height + 150) {
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
          this.haptics?.(25);
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
      p.y += currentSpeed * frameScale;
      if (p.y > this.height + 50) { state.powerups.splice(i, 1); continue; }
      if (this.checkCollision(state.player, p)) {
        this.collectPowerUp(p.type);
        state.powerups.splice(i, 1);
      }
    }

    // Update obstacles
    for (let i = state.obstacles.length - 1; i >= 0; i--) {
      const o = state.obstacles[i];
      o.y += currentSpeed * 0.55 * frameScale;
      if (o.y > this.height + 80) { state.obstacles.splice(i, 1); continue; }

      if (!state.player.isInvulnerable && state.activePowerUp !== 'SHIELD' && this.checkCollision(state.player, o)) {
        if (o.type === 'OIL_SLICK' && !state.player.oilSlicked) {
          state.player.oilSlicked = true;
          state.player.oilTimer = 2500;
          state.obstacles.splice(i, 1);
          this.haptics?.([40, 40, 40]);
        } else if (o.type === 'DEBRIS') {
          this.handleCrash();
          state.obstacles.splice(i, 1);
        }
      }
    }

    // Update particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx * frameScale;
      p.y += (p.vy + currentSpeed * 0.2) * frameScale;
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

  // Nearest lane index to x — bookkeeping only (used by the "occasional
  // pairs" spawn call to bias a second vehicle away from the first's
  // lane for visual variety), never a placement constraint. See the doc
  // comment on findSafeSpawnX for why placement itself must not be
  // lane-bucketed.
  private nearestLane(x: number): number {
    const state = this.state;
    let lane = 0;
    let bestDist = Infinity;
    for (let i = 0; i < state.lanes.length; i++) {
      const d = Math.abs(state.lanes[i] - x);
      if (d < bestDist) {
        bestDist = d;
        lane = i;
      }
    }
    return lane;
  }

  // Samples x continuously across the full playable road width (the same
  // margins clampPlayerPosition() uses) instead of picking a lane center
  // and jittering within it. An earlier version of this method jittered
  // within each lane's own half-width, which left a permanent dead zone
  // at every lane BOUNDARY that no vehicle could ever reach — since
  // vehicles never move in x after spawning, a player parked exactly on
  // a boundary was permanently safe from anything but the boss (whose
  // width spans multiple lanes). Verified by engine.test.ts's boundary
  // regression test, which caught this before it shipped again. Retries
  // a few times against isAreaClear so it doesn't land on an existing
  // vehicle/obstacle.
  private findSafeSpawnX(width: number, excludeLane?: number): { lane: number; x: number } | null {
    const margin = 18 + width / 2 + 8;
    const minX = margin;
    const maxX = Math.max(minX, this.width - margin);
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = minX + this.rng() * (maxX - minX);
      const lane = this.nearestLane(x);
      if (excludeLane !== undefined && lane === excludeLane) continue;
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

    // Scaled ×1.6 alongside CAR_STATS — see its comment for why.
    let width = 48, height = 80, speed = currentSpeed * 0.8;
    if (type === 'BUS')      { width = 72; height = 144; speed = currentSpeed * 0.6; }
    if (type === 'SPORTS')   { height = 72; speed = currentSpeed * 1.5; }
    if (type === 'BOXTRUCK') { width = 56; height = 112; speed = currentSpeed * 0.7; }
    if (type === 'TANK')     { width = 80; height = 128; speed = currentSpeed * 0.4; }

    const spot = this.findSafeSpawnX(width, excludeLane);
    if (!spot) return undefined;

    const colors = ['#555', '#453c31', '#222', '#4b5320', '#cc0000', '#dcdcdc'];
    const color = colors[Math.floor(this.rng() * colors.length)];
    const variant = Math.floor(this.rng() * 3) + 1;
    // Lanes 0-1 = oncoming, 2-3 = same direction as the player — see
    // Vehicle.direction's doc comment.
    const direction: Vehicle['direction'] = spot.lane < 2 ? 'OPPOSITE' : 'SAME';

    state.vehicles.push({ type, x: spot.x, y: -100, width, height, color, speed, lane: spot.lane, passed: false, variant, direction });
    return spot.lane;
  }

  private trySpawnPowerup() {
    const state = this.state;
    const types: PowerUpType[] = ['SHIELD', 'SLOWMO', 'SCORE_BLAST', 'EXTRA_LIFE'];
    const width = 30;
    const margin = 18 + width / 2 + 8;
    const minX = margin;
    const maxX = Math.max(minX, this.width - margin);
    for (let attempt = 0; attempt < 3; attempt++) {
      const x = minX + this.rng() * (maxX - minX);
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
      const margin = 18 + width / 2 + 8;
      const minX = margin;
      const maxX = Math.max(minX, this.width - margin);
      const x = minX + this.rng() * (maxX - minX);
      if (this.isAreaClear(x, width, -80, 150)) {
        state.obstacles.push({ type, x, y: -80, width, height });
        return;
      }
    }
  }

  private spawnBoss(currentSpeed: number) {
    const state = this.state;
    state.bossActive = true;
    const laneWidth = this.width / 4;
    // Centers on the direction divide (between lanes 1 and 2) so it spans
    // across both directions' lanes — a full-road blocker, matching its
    // "rival boss" threat level regardless of which pair it visually
    // overlaps more.
    const centerX = (state.lanes[1] + state.lanes[2]) / 2;

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
      direction: 'OPPOSITE',
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
    // Use the seeded rng (not Math.random) so daily-challenge runs stay
    // deterministic — initDailyRNG() reseeds this for reproducible days.
    if (this.upgrades.armor > 0 && this.rng() < this.upgrades.armor * 0.1) {
      this.state.player.isInvulnerable = true;
      this.state.player.invulnTimer = 1500;
      this.createParticles(this.state.player.x, this.state.player.y, '#ffaa00', 10);
      this.haptics?.(60);
      return;
    }
    this.audio.play('crash');
    this.state.screenShake = this.reducedMotion ? 0 : 300;
    this.state.combo = 0;
    this.state.comboTimer = 0;
    this.state.wasHit = true;
    this.createParticles(this.state.player.x, this.state.player.y, '#ff3300', 20);
    this.haptics?.([100, 50, 100]);

    this.state.lives--;
    if (this.state.lives <= 0) {
      this.gameOver();
    } else {
      this.state.player.isInvulnerable = true;
      this.state.player.invulnTimer = 2000;
    }
  }

  private collectPowerUp(type: PowerUpType) {
    this.audio.play(type === 'SHIELD' ? 'shield' : 'powerup');
    this.haptics?.(60);
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
        // Use the seeded rng (not Math.random) for daily-challenge determinism.
        vx: (this.rng() - 0.5) * 10,
        vy: (this.rng() - 0.5) * 10,
        life: 500 + this.rng() * 500,
        maxLife: 1000,
        color,
        size: 2 + this.rng() * 4,
      });
    }
  }

  private gameOver() {
    const state = this.state;
    state.isGameOver = true;
    if (!state.wasHit) this.grantAchievement('untouchable');
    if (state.lives >= 3) this.grantAchievement('survivor');
    this.audio.play('gameover');
    this.audio.stop('gameplay');
    this.onGameOver(state);
  }
}
