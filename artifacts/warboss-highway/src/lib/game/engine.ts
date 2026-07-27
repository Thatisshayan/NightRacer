import { playAudio, stopAudio } from './audio';
import { drawVehicle, drawHUD, drawObstacle } from './renderer';
import { Settings } from './settings';
import { DailyModifier } from './daily';

export type PowerUpType = 'SHIELD' | 'SLOWMO' | 'SCORE_BLAST' | 'EXTRA_LIFE';
export type CarType = 'RATTLETRAP' | 'WAR_RUNNER' | 'DEATHSLED';
export type VehicleType = 'SEDAN' | 'PICKUP' | 'COP' | 'BOXTRUCK' | 'BUS' | 'SPORTS' | 'TANK' | 'BOSS';
export type ObstacleType = 'OIL_SLICK' | 'DEBRIS';

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
    width: 22,
    height: 46,
    speedMod: 1.15,
    color: '#3d6db8',
    label: 'DEATHSLED',
    desc: 'Narrow & fast. High risk.',
    stats: 'SPD █████  ARM █░░░░',
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

  private loop = (timestamp: number) => {
    if (this.state.isGameOver) return;
    const dt = Math.min(timestamp - this.lastTime, 50);
    this.lastTime = timestamp;
    if (!this.isPaused) {
      this.update(dt);
    }
    this.draw();
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

    // Spawn vehicles (scale up with distance to counter top-camping)
    const spawnRate = 0.02 * speedMult * Math.min(2.2, 1 + state.distance / 18000) * this.dailyModifier.spawnMult;
    let lastLane: number | undefined;
    if (this.rng() < spawnRate) {
      lastLane = this.spawnVehicle(currentSpeed);
    }
    // Occasional pairs at higher distances
    if (state.distance > 25000 && this.rng() < spawnRate * 0.25) {
      this.spawnVehicle(currentSpeed, lastLane);
    }

    // Spawn powerups
    if (this.rng() < 0.002) {
      const types: PowerUpType[] = ['SHIELD', 'SLOWMO', 'SCORE_BLAST', 'EXTRA_LIFE'];
      const type = types[Math.floor(this.rng() * types.length)];
      const lane = Math.floor(this.rng() * 3);
      state.powerups.push({ type, x: state.lanes[lane], y: -50, width: 30, height: 30 });
    }

    // Spawn obstacles (only after first 10 seconds)
    if (state.distance > 10000 && this.rng() < 0.005 * speedMult * this.dailyModifier.obstacleMult) {
      const type: ObstacleType = this.rng() < 0.5 ? 'OIL_SLICK' : 'DEBRIS';
      const lane = Math.floor(this.rng() * 3);
      state.obstacles.push({
        type, x: state.lanes[lane], y: -80,
        width: type === 'OIL_SLICK' ? 55 : 28,
        height: type === 'OIL_SLICK' ? 28 : 22,
      });
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

  private spawnVehicle(currentSpeed: number, excludeLane?: number): number {
    const state = this.state;
    let lane = Math.floor(this.rng() * 3);
    if (excludeLane !== undefined && lane === excludeLane) lane = (lane + 1) % 3;
    const isTank = this.rng() < 0.01;
    let type: VehicleType = isTank
      ? 'TANK'
      : REGULAR_TYPES[Math.floor(this.rng() * REGULAR_TYPES.length)];

    let width = 30, height = 50, speed = currentSpeed * 0.8;
    if (type === 'BUS')      { width = 45; height = 90; speed = currentSpeed * 0.6; }
    if (type === 'SPORTS')   { height = 45; speed = currentSpeed * 1.5; }
    if (type === 'BOXTRUCK') { width = 35; height = 70; speed = currentSpeed * 0.7; }
    if (type === 'TANK')     { width = 50; height = 80; speed = currentSpeed * 0.4; }

    const colors = ['#555', '#453c31', '#222', '#4b5320', '#cc0000', '#dcdcdc'];
    const color = colors[Math.floor(this.rng() * colors.length)];

    state.vehicles.push({ type, x: state.lanes[lane], y: -100, width, height, color, speed, lane, passed: false });
    return lane;
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
    });
  }

  private checkCollision(r1: GameObject, r2: GameObject) {
    const shrink = 5;
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
      const dur = type === 'SHIELD' ? 5000 : type === 'SCORE_BLAST' ? 6000 : 4000;
      this.state.powerUpTimer = dur;
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

    // Player car
    if (!state.player.isInvulnerable || Math.floor(performance.now() / 100) % 2 === 0) {
      ctx.save();
      ctx.translate(state.player.x, state.player.y);

      if (state.player.oilSlicked) {
        ctx.shadowColor = '#8888ff';
        ctx.shadowBlur = 20;
      }

      if (state.activePowerUp === 'SHIELD') {
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3 + performance.now() * 0.001;
          const px = Math.cos(angle) * 36;
          const py = Math.sin(angle) * 36;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,255,255,0.12)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      drawVehicle(ctx, this.selectedCar, state.player.width, state.player.height, CAR_STATS[this.selectedCar].color);
      ctx.restore();
    }

    // Particles
    state.particles.forEach(p => {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1;

    ctx.restore(); // end camera follow

    // Level-up flash
    if (state.levelUpFlash > 0) {
      const t = state.levelUpFlash / 1800;
      const alpha = Math.sin(t * Math.PI) * 0.35;
      ctx.fillStyle = `rgba(255, 130, 0, ${alpha})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (state.levelUpFlash > 1200) {
        ctx.font = 'bold 30px "Russo One", sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#ff8800';
        ctx.shadowBlur = 25;
        ctx.fillText(state.levelUpText, canvas.width / 2, canvas.height / 2 - 10);
        ctx.shadowBlur = 0;
      }
    }

    // Boss warning
    if (state.bossWarning > 0) {
      const blink = Math.floor(performance.now() / 180) % 2 === 0;
      if (blink) {
        ctx.fillStyle = 'rgba(180, 0, 0, 0.28)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.textAlign = 'center';
      ctx.font = 'bold 28px "Russo One", sans-serif';
      ctx.fillStyle = '#ff2222';
      ctx.shadowColor = '#ff0000';
      ctx.shadowBlur = 30;
      ctx.fillText('⚠ WARBOSS INCOMING ⚠', canvas.width / 2, canvas.height / 2);
      ctx.font = '16px "Roboto Mono", monospace';
      ctx.fillStyle = '#ffaaaa';
      ctx.shadowBlur = 0;
      ctx.fillText('BRACE YOURSELF', canvas.width / 2, canvas.height / 2 + 36);
    }

    // Near-miss combo text
    if (state.combo > 1) {
      const alpha = Math.min(1, state.comboTimer / 800);
      ctx.globalAlpha = alpha;
      const sz = Math.min(24, 14 + state.combo);
      ctx.font = `bold ${sz}px "Russo One", sans-serif`;
      ctx.fillStyle = '#ffff44';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#ff8800';
      ctx.shadowBlur = 12;
      ctx.fillText(`NEAR MISS ×${state.combo}!`, canvas.width / 2, canvas.height - 100);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // HUD
    const speedMult = this.getSpeedMultiplier(state.distance);
    drawHUD(ctx, canvas.width, canvas.height, state, speedMult);

    ctx.restore();

    // Virtual joystick
    this.drawJoystick(ctx);
  }

  private drawRoad(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const state = this.state;
    const laneWidth = canvas.width / 3;

    // Outer gutters (dark)
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Road surface — lifted and cooled vs. vehicle colors so cars pop
    ctx.fillStyle = '#2a2c34';
    ctx.fillRect(12, 0, canvas.width - 24, canvas.height);

    // Subtle horizontal grain rows (stable, not flickering)
    ctx.globalAlpha = 0.025;
    for (let r = 0; r < 5; r++) {
      const y = ((r * 200 + state.roadOffset * 3) % canvas.height);
      ctx.fillStyle = '#888';
      ctx.fillRect(12, y, canvas.width - 24, 100);
    }
    ctx.globalAlpha = 1;

    // Speed streak lines (long at high speed, scale with multiplier)
    const speedMult = state.speedMultiplier;
    const streakLen = 10 + speedMult * 30;
    const streakAlpha = 0.06 + speedMult * 0.06;
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.globalAlpha = streakAlpha;
    // 8 fixed X positions
    const streakXs = [30, 65, 100, 140, 180, 230, 270, 310];
    streakXs.forEach((sx, i) => {
      const yBase = ((i * 150 + state.roadOffset * (2 + speedMult)) % canvas.height);
      ctx.beginPath();
      ctx.moveTo(sx, yBase);
      ctx.lineTo(sx, yBase + streakLen);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // Edge guardrails with warning stripes
    const stripeH = 40;
    const stripeOffset = state.roadOffset * 2;
    for (let y = -stripeH + (stripeOffset % (stripeH * 2)); y < canvas.height + stripeH; y += stripeH * 2) {
      ctx.fillStyle = '#886600';
      ctx.fillRect(0, y, 12, stripeH);
      ctx.fillStyle = '#333';
      ctx.fillRect(0, y + stripeH, 12, stripeH);
      ctx.fillRect(canvas.width - 12, y, 12, stripeH);
      ctx.fillStyle = '#886600';
      ctx.fillRect(canvas.width - 12, y + stripeH, 12, stripeH);
    }

    // Lane dividers (dashed)
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 2;
    ctx.setLineDash([24, 24]);
    ctx.lineDashOffset = -(state.roadOffset * 2);
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(laneWidth * i, 0);
      ctx.lineTo(laneWidth * i, canvas.height);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  private drawExhaust(ctx: CanvasRenderingContext2D, state: GameState) {
    const spd = state.speedMultiplier;
    if (spd < 1.2) return;
    const alpha = Math.min(0.65, (spd - 1) * 0.4);
    const lineLen = spd * 18;
    const px = state.player.x;
    const py = state.player.y + state.player.height / 2;
    const hw = state.player.width * 0.28;

    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(200, 200, 200, ${alpha})`;
    ctx.beginPath(); ctx.moveTo(px - hw, py); ctx.lineTo(px - hw, py + lineLen); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px + hw, py); ctx.lineTo(px + hw, py + lineLen); ctx.stroke();

    if (spd >= 2) {
      ctx.strokeStyle = `rgba(255, 80, 0, ${alpha * 0.5})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + lineLen * 0.65); ctx.stroke();
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
