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
  // Lateral velocity is simulation state rather than a renderer-only value,
  // so every platform gets the same responsive but non-binary steering feel.
  vx: number;
}

export interface Vehicle extends GameObject {
  // Assigned once at spawn (GameEngine.nextVehicleId) and never recomputed —
  // renderer adapters (e.g. render-frame's toRoadEntity) key pooled
  // resources off this, so it must stay stable across a vehicle's whole
  // lifetime even as x/y/lane change every frame.
  id: string;
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
  // Presentation-facing drive state. Renderers read these values but never
  // author their own handling or boost rules, preserving web/native parity.
  driveTilt: number;
  rushCharge: number;
  rushTimer: number;
  rushPulse: number;
  nearMissPulse: number;
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
// How far above the playfield entities spawn (negative world Y). Also the
// fade-in band width in the perspective renderer.
export const SPAWN_DEPTH = 160;

// --- Authored traffic patterns -------------------------------------------
// The cooldown scheduler above fixed burstiness but left every encounter
// identical in shape: one car, wait, one car. Playtest feedback was that
// traffic "has no rhythm" — nothing to read, anticipate or thread, just a
// stream. Difficulty could only be raised by shortening the cooldown, which
// makes the road denser without making it more interesting.
//
// Traffic is now emitted as short authored *patterns*: a sequence of beats,
// each naming the lanes that spawn on that beat, followed by an enforced rest
// so the player always gets a readable breath between encounters. Difficulty
// ramps by pattern TIER (which patterns are in the pool), not by raw spawn
// frequency.
//
// Invariant: no beat may occupy all four lanes. Every pattern is threadable.
export interface TrafficPattern {
  readonly id: string;
  /** Minimum distance before this pattern enters the pool. */
  readonly tier: number;
  /** Lane indices (0-3) spawning on each beat. */
  readonly beats: readonly (readonly number[])[];
  /** Gap after each beat, ms at 1x speed. */
  readonly beatGapMs: number;
}

export const TRAFFIC_PATTERNS: readonly TrafficPattern[] = [
  // Tier 0 — the vocabulary the player learns on.
  { id: 'single', tier: 0, beats: [[1]], beatGapMs: 620 },
  { id: 'single_wide', tier: 0, beats: [[3]], beatGapMs: 620 },
  // A slow car followed by a second in the neighbouring lane: teaches that
  // committing to a gap early can trap you.
  { id: 'stagger', tier: 0, beats: [[0], [1]], beatGapMs: 430 },
  // Tier 1 — two-lane shapes.
  { id: 'pair_split', tier: 6000, beats: [[0, 2]], beatGapMs: 700 },
  { id: 'diagonal', tier: 9000, beats: [[0], [1], [2]], beatGapMs: 380 },
  { id: 'convoy', tier: 9000, beats: [[2], [2], [2]], beatGapMs: 460 },
  // Tier 2 — the shapes that need a committed line.
  // Three abreast with exactly one gap: the signature "thread the needle".
  { id: 'wall_gap', tier: 18000, beats: [[0, 1, 2]], beatGapMs: 900 },
  { id: 'pincer', tier: 18000, beats: [[0, 3], [1, 2]], beatGapMs: 500 },
  // Funnel: the gap migrates across the road, so holding one line fails.
  { id: 'funnel', tier: 30000, beats: [[0, 1], [1, 2], [2, 3]], beatGapMs: 470 },
  { id: 'zipper', tier: 30000, beats: [[0, 2], [1, 3], [0, 2]], beatGapMs: 440 },
];

// Enforced quiet after a pattern completes. Without it, back-to-back patterns
// read as one undifferentiated stream again and the rhythm is lost. Scales
// down with speed so it stays a beat rather than a stall.
const PATTERN_REST_MIN_MS = 420;
const PATTERN_REST_MAX_MS = 900;
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
  // Authored-pattern playback state — see TRAFFIC_PATTERNS.
  private activePattern: TrafficPattern | null = null;
  private patternBeat: number = 0;
  private patternMirrored: boolean = false;
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
  // Set by a keyboard press or a platform HUD control, then consumed inside
  // update() so a Rush starts on a deterministic simulation frame.
  private rushRequested = false;
  // Monotonic source for Vehicle.id — never reused, so a despawned vehicle's
  // old id can never collide with a later spawn's.
  private vehicleIdCounter = 0;

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
      // Test/support hook: a caller may provide a deterministic source for
      // ordinary runs. Daily runs keep their date-seeded generator instead.
      random?: () => number;
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
    this.rng = options?.random ?? Math.random;

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
        vx: 0,
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
      driveTilt: 0,
      rushCharge: 0,
      rushTimer: 0,
      rushPulse: 0,
      nearMissPulse: 0,
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
    if (code === 'Space') this.rushRequested = true;
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
      // Direct touch drag remains instant and accessible; clearing carry-over
      // velocity prevents a keyboard/joystick steering drift after a touch grab.
      this.state.player.vx = 0;
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

  // Rush is an earned burst, not a purchasable advantage. A host can expose
  // this through any suitable input surface (Space on keyboard, a touch HUD
  // control on mobile) while the shared simulation owns eligibility and timing.
  public triggerRush(): boolean {
    const state = this.state;
    if (state.isGameOver || state.rushTimer > 0 || state.rushCharge < 100) return false;
    state.rushCharge = 0;
    state.rushTimer = 2400;
    state.rushPulse = 420;
    this.audio.play('powerup');
    this.haptics?.(25);
    this.createParticles(state.player.x, state.player.y + state.player.height * 0.35, '#27d9ff', 14);
    this.createParticles(state.player.x, state.player.y + state.player.height * 0.35, '#df4bff', 8);
    return true;
  }

  // Demo-only: forces the Rush visual state for renderer proof captures,
  // bypassing the earned-charge gate `triggerRush` enforces. `update()`
  // derives `speedMultiplier` from `rushTimer` each tick, so re-arming it
  // here (rather than assigning speedMultiplier directly) keeps the two in
  // sync without touching the readonly `getState()` snapshot.
  public debugForceRush(active: boolean): void {
    this.state.rushTimer = active ? 2400 : 0;
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

    // A requested Rush is consumed on the simulation frame, avoiding a
    // renderer- or platform-specific timing advantage.
    if (this.rushRequested) {
      this.triggerRush();
      this.rushRequested = false;
    }

    // Speed
    const newLevel = this.getSpeedLevel(state.distance);
    const speedMult = this.getSpeedMultiplier(state.distance);

    if (newLevel > state.lastSpeedLevel) {
      state.lastSpeedLevel = newLevel;
      state.levelUpFlash = 1800;
      state.levelUpText = speedMult >= 3 ? 'MAX SPEED!' : 'SPEED UP!';
      if (speedMult >= 3) this.grantAchievement('speed_demon');
    }

    const carMod = CAR_STATS[this.selectedCar].speedMod * (1 + this.upgrades.speed * 0.03);
    let currentSpeed = state.baseSpeed * speedMult * carMod * this.dailyModifier.speedMult;
    if (state.activePowerUp === 'SLOWMO') currentSpeed *= 0.4;
    if (state.rushTimer > 0) currentSpeed *= 1.24;
    state.speedMultiplier = speedMult * (state.rushTimer > 0 ? 1.24 : 1);

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

    // Player movement. Lateral steering now has a small, deterministic
    // velocity curve: responsive enough for a dodge game, but with visible
    // weight and recovery instead of the previous binary positional slide.
    if (!state.player.oilSlicked) {
      const len = Math.sqrt(dx * dx + dy * dy);
      const handling = 1 + this.upgrades.handling * 0.08;
      const targetVx = len > 0 ? (dx / len) * 5.1 * handling : 0;
      const steeringResponse = Math.min(1, 0.38 * frameScale);
      state.player.vx += (targetVx - state.player.vx) * steeringResponse;
      if (Math.abs(targetVx) < 0.01) state.player.vx *= Math.pow(0.72, frameScale);
      state.player.x += state.player.vx * frameScale;
      if (len > 0) {
        const verticalSpeed = 3.2 * handling * frameScale;
        state.player.y += (dy / len) * verticalSpeed;
      }
      state.driveTilt = Math.max(-1, Math.min(1, state.player.vx / (5.1 * handling)));
      this.clampPlayerPosition();
    } else {
      // Slight drift when oiled, with a matching visual bank that signals the
      // loss of control without relying on color alone.
      const slip = Math.sin(state.distance * 0.08) * 2;
      state.player.x += slip;
      state.player.vx = slip;
      state.driveTilt = Math.max(-1, Math.min(1, slip / 2));
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
    if (state.rushTimer > 0) state.rushTimer = Math.max(0, state.rushTimer - dt);
    if (state.rushPulse > 0) state.rushPulse = Math.max(0, state.rushPulse - dt);
    if (state.nearMissPulse > 0) state.nearMissPulse = Math.max(0, state.nearMissPulse - dt);
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
      this.advanceTrafficPattern(currentSpeed, speedMult, densityRamp);
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
        // own pace, not a sum — a slower type (BUS/TANK) drifts toward the
        // player like highway traffic you're gaining on.
        //
        // The 1.2px/frame floor that used to sit here meant *every* vehicle in
        // the game moved down-screen, only at different rates. With nothing
        // ever moving the other way there was no relative motion to read, and
        // the road felt like a conveyor belt. A faster car (SPORTS) now
        // genuinely recedes: it enters from behind the player (see
        // spawnsFromBehind) , overtakes, and pulls away up-screen. That is the
        // single clearest signal that the player is inside traffic rather than
        // in front of a spawner.
        v.y += (currentSpeed - v.speed * 0.7) * frameScale;
      } else {
        v.y += (currentSpeed + v.speed * 0.5) * frameScale;
      }

      // Receding same-direction traffic exits off the top; without this it
      // would climb forever and leak into the vehicle array.
      if (v.y < -260) {
        state.vehicles.splice(i, 1);
        continue;
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

      // Near-miss detection: vehicle just passed the player's midpoint.
      // Covers both oncoming/slower same-direction traffic crossing from
      // above and faster same-direction traffic receding from below.
      const playerMid = state.player.y + state.player.height / 2;
      const receding = v.direction === 'SAME' && currentSpeed - v.speed * 0.7 < 0;
      const crossed = receding ? v.y < playerMid : v.y > playerMid;
      if (!v.passed && crossed) {
        v.passed = true;
        const xDist = Math.abs(v.x - state.player.x);
        const minSafe = (state.player.width + v.width) / 2 - 5;
        const maxNearMiss = minSafe + NEAR_MISS_EXTRA_PX;
        if (xDist > minSafe && xDist < maxNearMiss) {
          state.combo++;
          state.comboPop = POP_DURATION_MS;
          state.nearMissPulse = 300;
          const wasBelowRush = state.rushCharge < 100;
          state.rushCharge = Math.min(100, state.rushCharge + 25);
          if (wasBelowRush && state.rushCharge === 100) this.audio.play('powerup');
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

  // Plays back one beat of the current authored pattern, or picks the next
  // pattern (after a rest beat) when the current one is exhausted. Called
  // whenever the spawn timer elapses; see TRAFFIC_PATTERNS for the rationale.
  private advanceTrafficPattern(currentSpeed: number, speedMult: number, densityRamp: number) {
    const factor = Math.max(0.4, speedMult * densityRamp * this.dailyModifier.spawnMult);

    if (!this.activePattern) {
      // Pool is every pattern whose tier the player has reached. Weighting the
      // pick toward the newest tiers keeps late runs from feeling like the
      // opening minute with a shorter cooldown.
      const pool = TRAFFIC_PATTERNS.filter((p) => this.state.distance >= p.tier);
      const eligible = pool.length > 0 ? pool : [TRAFFIC_PATTERNS[0]];
      const topTier = eligible[eligible.length - 1].tier;
      const advanced = eligible.filter((p) => p.tier === topTier);
      const useAdvanced = advanced.length > 0 && eligible.length > advanced.length && this.rng() < 0.45;
      const from = useAdvanced ? advanced : eligible;
      this.activePattern = from[Math.floor(this.rng() * from.length)];
      // Mirroring doubles the pattern vocabulary for free and stops the same
      // shape always resolving toward the same side of the road.
      this.patternMirrored = this.rng() < 0.5;
      this.patternBeat = 0;
    }

    const pattern = this.activePattern;
    const beat = pattern.beats[this.patternBeat];
    for (const lane of beat) {
      this.spawnVehicleInLane(currentSpeed, this.patternMirrored ? 3 - lane : lane);
    }
    this.patternBeat++;

    if (this.patternBeat >= pattern.beats.length) {
      this.activePattern = null;
      const rest = PATTERN_REST_MIN_MS + this.rng() * (PATTERN_REST_MAX_MS - PATTERN_REST_MIN_MS);
      this.vehicleSpawnTimer = Math.max(220, rest / factor);
    } else {
      this.vehicleSpawnTimer = Math.max(150, pattern.beatGapMs / factor);
    }
  }

  private spawnVehicle(currentSpeed: number, excludeLane?: number): number | undefined {
    const spec = this.rollVehicleSpec(currentSpeed);
    const spot = this.findSafeSpawnX(spec.width, excludeLane);
    if (!spot) return undefined;
    this.pushVehicle(spec, spot.lane, spot.x, currentSpeed);
    return spot.lane;
  }

  // Pattern-driven spawn: the lane is dictated by the beat, not sampled. If
  // that lane is occupied the beat simply drops the car rather than sliding it
  // elsewhere — moving it would destroy the pattern's shape, which is the
  // whole point of authoring one.
  private spawnVehicleInLane(currentSpeed: number, lane: number): boolean {
    const state = this.state;
    const spec = this.rollVehicleSpec(currentSpeed);
    const laneX = state.lanes[lane];
    if (laneX === undefined) return false;
    // Jitter within the lane. Pinning pattern spawns to exact lane centres
    // made traffic look mechanically placed (and regressed the "not just
    // dead-center" spawn test); +/-22% of a lane is enough variety to look
    // driven without blurring which lane the beat claimed.
    const laneWidth = this.width / 4;
    const margin = 18 + spec.width / 2 + 8;
    const jitter = (this.rng() - 0.5) * laneWidth * 0.44;
    const x = Math.min(Math.max(laneX + jitter, margin), Math.max(margin, this.width - margin));
    const fromBehind = this.spawnsFromBehind(spec, currentSpeed);
    const probeY = fromBehind ? this.height + 100 : -100;
    if (!this.isAreaClear(x, spec.width, probeY, 170)) return false;
    this.pushVehicle(spec, lane, x, currentSpeed);
    return true;
  }

  private rollVehicleSpec(currentSpeed: number): { type: VehicleType; width: number; height: number; speed: number } {
    const isTank = this.rng() < 0.01;
    const type: VehicleType = isTank
      ? 'TANK'
      : REGULAR_TYPES[Math.floor(this.rng() * REGULAR_TYPES.length)];

    // Scaled ×1.6 alongside CAR_STATS — see its comment for why.
    let width = 48, height = 80, speed = currentSpeed * 0.8;
    if (type === 'BUS')      { width = 72; height = 144; speed = currentSpeed * 0.6; }
    if (type === 'SPORTS')   { height = 72; speed = currentSpeed * 1.5; }
    if (type === 'BOXTRUCK') { width = 56; height = 112; speed = currentSpeed * 0.7; }
    if (type === 'TANK')     { width = 80; height = 128; speed = currentSpeed * 0.4; }
    return { type, width, height, speed };
  }

  // Same-direction traffic faster than the player recedes up-screen (see the
  // vehicle update loop). Such a car has to enter from *behind* the player or
  // it would spawn ahead and immediately drive away off the top, which is both
  // pointless and unreadable.
  private spawnsFromBehind(spec: { type: VehicleType; speed: number }, currentSpeed: number): boolean {
    if (spec.type === 'TANK' || spec.type === 'BOSS') return false;
    return currentSpeed - spec.speed * 0.7 < 0;
  }

  private pushVehicle(
    spec: { type: VehicleType; width: number; height: number; speed: number },
    lane: number,
    x: number,
    currentSpeed: number
  ) {
    const state = this.state;
    const colors = ['#555', '#453c31', '#222', '#4b5320', '#cc0000', '#dcdcdc'];
    const color = colors[Math.floor(this.rng() * colors.length)];
    const variant = Math.floor(this.rng() * 3) + 1;
    // Lanes 0-1 = oncoming, 2-3 = same direction as the player — see
    // Vehicle.direction's doc comment.
    const direction: Vehicle['direction'] = lane < 2 ? 'OPPOSITE' : 'SAME';
    const fromBehind = direction === 'SAME' && this.spawnsFromBehind(spec, currentSpeed);

    state.vehicles.push({
      id: `vehicle-${++this.vehicleIdCounter}`,
      type: spec.type,
      x,
      y: fromBehind ? this.height + 100 : -100,
      width: spec.width,
      height: spec.height,
      color,
      speed: spec.speed,
      lane,
      // Always start unpassed; the update loop marks it once the vehicle
      // crosses the player's midpoint in its travel direction.
      passed: false,
      variant,
      direction,
    });
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
      id: `vehicle-${++this.vehicleIdCounter}`,
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
    this.state.rushTimer = 0;
    this.state.rushPulse = 0;
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
