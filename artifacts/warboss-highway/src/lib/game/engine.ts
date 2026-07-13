import { playAudio, stopAudio } from './audio';
import { drawVehicle, drawHUD } from './renderer';

export type PowerUpType = 'SHIELD' | 'SLOWMO' | 'SCORE_BLAST' | 'EXTRA_LIFE';

export interface GameObject {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Player extends GameObject {
  isInvulnerable: boolean;
  invulnTimer: number;
}

export interface Vehicle extends GameObject {
  type: 'SEDAN' | 'PICKUP' | 'COP' | 'BOXTRUCK' | 'BUS' | 'SPORTS' | 'TANK';
  color: string;
  speed: number;
  lane: number;
}

export interface PowerUpItem extends GameObject {
  type: PowerUpType;
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
}

const VEHICLE_TYPES = ['SEDAN', 'PICKUP', 'COP', 'BOXTRUCK', 'BUS', 'SPORTS'] as const;

export const INITIAL_STATE: GameState = {
  player: { x: 0, y: 0, width: 30, height: 50, isInvulnerable: false, invulnTimer: 0 },
  vehicles: [],
  powerups: [],
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
};

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private state: GameState;
  private lastTime: number = 0;
  private animationId: number = 0;
  private onGameOver: (state: GameState) => void;
  private keys: Record<string, boolean> = {};
  private targetLane: number = 1;

  constructor(canvas: HTMLCanvasElement, onGameOver: (state: GameState) => void) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.onGameOver = onGameOver;
    this.state = JSON.parse(JSON.stringify(INITIAL_STATE));
    this.init();
  }

  private init() {
    // 3 lanes
    const laneWidth = this.canvas.width / 3;
    this.state.lanes = [laneWidth / 2, laneWidth * 1.5, laneWidth * 2.5];
    this.state.player.x = this.state.lanes[1];
    this.state.player.y = this.canvas.height - 80;
    this.targetLane = 1;

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.canvas.addEventListener('touchstart', this.handleTouch);
    this.canvas.addEventListener('touchmove', this.handleTouch);

    playAudio('gameplay', true);
  }

  public cleanup() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.canvas.removeEventListener('touchstart', this.handleTouch);
    this.canvas.removeEventListener('touchmove', this.handleTouch);
    cancelAnimationFrame(this.animationId);
    stopAudio('gameplay');
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    this.keys[e.code] = true;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      this.targetLane = Math.max(0, this.targetLane - 1);
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      this.targetLane = Math.min(2, this.targetLane + 1);
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };

  private handleTouch = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      const touchX = e.touches[0].clientX;
      const rect = this.canvas.getBoundingClientRect();
      const x = touchX - rect.left;
      
      const laneWidth = this.canvas.width / 3;
      if (x < laneWidth) this.targetLane = 0;
      else if (x < laneWidth * 2) this.targetLane = 1;
      else this.targetLane = 2;
    }
  };

  public start() {
    this.lastTime = performance.now();
    this.animationId = requestAnimationFrame(this.loop);
  }

  private loop = (timestamp: number) => {
    if (this.state.isGameOver) return;

    const dt = timestamp - this.lastTime;
    this.lastTime = timestamp;

    this.update(dt);
    this.draw();

    if (!this.state.isGameOver) {
      this.animationId = requestAnimationFrame(this.loop);
    }
  };

  private update(dt: number) {
    const state = this.state;
    
    // Time-based speed multiplier
    const survivalSeconds = state.distance / 1000;
    const speedMultiplier = Math.min(3, 1 + Math.floor(survivalSeconds / 15) * 0.5);
    let currentSpeed = state.baseSpeed * speedMultiplier;

    if (state.activePowerUp === 'SLOWMO') {
      currentSpeed *= 0.4;
    }

    state.distance += currentSpeed * (dt / 16);
    const scoreMult = state.activePowerUp === 'SCORE_BLAST' ? 3 : 1;
    state.score += (currentSpeed / 10) * scoreMult;

    // Road scroll
    state.roadOffset = (state.roadOffset + currentSpeed) % 40;

    // Player movement
    const targetX = state.lanes[this.targetLane];
    state.player.x += (targetX - state.player.x) * 0.2; // Smooth glide

    // Timers
    if (state.activePowerUp) {
      state.powerUpTimer -= dt;
      if (state.powerUpTimer <= 0) {
        state.activePowerUp = null;
      }
    }

    if (state.player.invulnTimer > 0) {
      state.player.invulnTimer -= dt;
      state.player.isInvulnerable = state.player.invulnTimer > 0;
    }

    if (state.screenShake > 0) {
      state.screenShake = Math.max(0, state.screenShake - dt);
    }

    // Spawn vehicles
    if (Math.random() < 0.02 * speedMultiplier) {
      const lane = Math.floor(Math.random() * 3);
      const isTank = Math.random() < 0.01;
      let type: Vehicle['type'] = isTank ? 'TANK' : VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)];
      
      let width = 30, height = 50, speed = currentSpeed * 0.8;
      if (type === 'BUS') { width = 45; height = 90; speed = currentSpeed * 0.6; }
      if (type === 'SPORTS') { height = 45; speed = currentSpeed * 1.5; }
      if (type === 'BOXTRUCK') { width = 35; height = 70; speed = currentSpeed * 0.7; }
      if (type === 'TANK') { width = 50; height = 80; speed = currentSpeed * 0.4; }

      const colors = ['#555', '#453c31', '#222', '#4b5320', '#cc0000', '#dcdcdc'];
      const color = colors[Math.floor(Math.random() * colors.length)];

      state.vehicles.push({
        type,
        x: state.lanes[lane],
        y: -100,
        width,
        height,
        color,
        speed,
        lane
      });
    }

    // Spawn powerups
    if (Math.random() < 0.002) {
      const types: PowerUpType[] = ['SHIELD', 'SLOWMO', 'SCORE_BLAST', 'EXTRA_LIFE'];
      const type = types[Math.floor(Math.random() * types.length)];
      const lane = Math.floor(Math.random() * 3);
      state.powerups.push({
        type,
        x: state.lanes[lane],
        y: -50,
        width: 30,
        height: 30
      });
    }

    // Update vehicles
    for (let i = state.vehicles.length - 1; i >= 0; i--) {
      const v = state.vehicles[i];
      // Vehicles move down relative to player, so player speed + vehicle own speed
      // Wait, top-down racer: road moves down. Traffic usually moves slower than player so they come down.
      // If it's oncoming traffic, they move very fast down. Let's make them oncoming or slow moving.
      v.y += currentSpeed + v.speed * 0.5;

      if (v.y > this.canvas.height + 100) {
        if (v.type === 'TANK') state.score += 500; // Bonus for dodging tank
        state.vehicles.splice(i, 1);
        continue;
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

      if (p.y > this.canvas.height + 50) {
        state.powerups.splice(i, 1);
        continue;
      }

      if (this.checkCollision(state.player, p)) {
        this.collectPowerUp(p.type);
        state.powerups.splice(i, 1);
      }
    }

    // Update particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy + currentSpeed;
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
      }
    }
  }

  private checkCollision(r1: GameObject, r2: GameObject) {
    // Make hitboxes slightly smaller than visual bounds
    const shrink = 5;
    return (
      r1.x - r1.width/2 + shrink < r2.x + r2.width/2 - shrink &&
      r1.x + r1.width/2 - shrink > r2.x - r2.width/2 + shrink &&
      r1.y - r1.height/2 + shrink < r2.y + r2.height/2 - shrink &&
      r1.y + r1.height/2 - shrink > r2.y - r2.height/2 + shrink
    );
  }

  private handleCrash() {
    playAudio('crash');
    this.state.screenShake = 300;
    this.createParticles(this.state.player.x, this.state.player.y, '#ff3300', 20);
    
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
    this.state.powerUpsUsed++;
    
    if (type === 'EXTRA_LIFE') {
      this.state.lives = Math.min(5, this.state.lives + 1);
    } else {
      this.state.activePowerUp = type;
      this.state.powerUpTimer = type === 'SHIELD' ? 5000 : type === 'SCORE_BLAST' ? 6000 : 4000;
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
        size: 2 + Math.random() * 4
      });
    }
  }

  private gameOver() {
    this.state.isGameOver = true;
    playAudio('gameover');
    stopAudio('gameplay');
    this.onGameOver(this.state);
  }

  private draw() {
    const { ctx, canvas, state } = this;
    ctx.save();

    // Screen shake
    if (state.screenShake > 0) {
      const dx = (Math.random() - 0.5) * 10;
      const dy = (Math.random() - 0.5) * 10;
      ctx.translate(dx, dy);
    }

    // Background
    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Road (dark concrete)
    ctx.fillStyle = '#222222';
    ctx.fillRect(20, 0, canvas.width - 40, canvas.height);

    // Lane lines
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = 4;
    ctx.setLineDash([20, 20]);
    
    const laneWidth = canvas.width / 3;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(laneWidth * i, -40 + state.roadOffset);
      ctx.lineTo(laneWidth * i, canvas.height);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Vehicles
    state.vehicles.forEach(v => {
      ctx.save();
      ctx.translate(v.x, v.y);
      // Face downwards
      ctx.rotate(Math.PI);
      drawVehicle(ctx, v.type, v.width, v.height, v.color);
      ctx.restore();
    });

    // Powerups
    state.powerups.forEach(p => {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.type === 'SHIELD') ctx.fillStyle = '#00ffff';
      if (p.type === 'SLOWMO') ctx.fillStyle = '#ffff00';
      if (p.type === 'SCORE_BLAST') ctx.fillStyle = '#ffaa00';
      if (p.type === 'EXTRA_LIFE') ctx.fillStyle = '#ff0000';
      
      ctx.beginPath();
      ctx.arc(0, 0, p.width/2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    });

    // Player
    if (!state.player.isInvulnerable || Math.floor(performance.now() / 100) % 2 === 0) {
      ctx.save();
      ctx.translate(state.player.x, state.player.y);
      
      // Shield effect
      if (state.activePowerUp === 'SHIELD') {
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          const px = Math.cos(angle) * 35;
          const py = Math.sin(angle) * 35;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(0, 255, 255, 0.2)';
        ctx.fill();
      }

      drawVehicle(ctx, 'SEDAN', state.player.width, state.player.height, '#2b331f');
      ctx.restore();
    }

    // Particles
    state.particles.forEach(p => {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1;

    // HUD
    const survivalSeconds = state.distance / 1000;
    const speedMultiplier = Math.min(3, 1 + Math.floor(survivalSeconds / 15) * 0.5);
    drawHUD(ctx, canvas.width, canvas.height, state, speedMultiplier);

    ctx.restore();
  }
}