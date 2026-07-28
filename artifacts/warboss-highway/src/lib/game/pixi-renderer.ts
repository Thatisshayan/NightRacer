import { Application, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { GlowFilter, MotionBlurFilter } from 'pixi-filters';
import type { GameRenderer, GameState, CarType, Vehicle, Obstacle, PowerUpItem, Particle } from './engine';
import { loadSpriteTextures, generatePlaceholderTextures, type SpriteTextures } from './sprites';
import { Settings } from './settings';

function vehicleTexture(textures: SpriteTextures, v: Vehicle) {
  if (v.type === 'BOSS') return textures.bossVehicle;
  const variants = textures.enemyVehicles[v.type as keyof typeof textures.enemyVehicles];
  const idx = Math.min(3, Math.max(1, v.variant || 1)) - 1;
  return variants[idx];
}

// A pooled sprite keyed by the backing GameState object's own identity (the
// arrays never get new objects for the same on-screen entity, only
// spliced when it despawns — see GameEngine.update()). `gen` is bumped to
// the current sync() call's generation each time the object is still
// present; anything left stale after a sync is despawned and pruned.
interface PoolEntry {
  sprite: Sprite;
  gen: number;
}

function syncPool<T extends object>(
  pool: Map<T, PoolEntry>,
  items: T[],
  gen: number,
  container: Container,
  create: (item: T) => Sprite,
  update: (item: T, sprite: Sprite) => void
) {
  for (const item of items) {
    let entry = pool.get(item);
    if (!entry) {
      const sprite = create(item);
      container.addChild(sprite);
      entry = { sprite, gen };
      pool.set(item, entry);
    }
    entry.gen = gen;
    update(item, entry.sprite);
  }
  for (const [item, entry] of pool) {
    if (entry.gen !== gen) {
      entry.sprite.destroy();
      pool.delete(item);
    }
  }
}

// Phase B: adds enemy vehicles, obstacles, and powerups as pooled sprites on
// top of Phase A's road + player car. Particles/lighting/HUD still come
// from the Canvas 2D path (GameEngine.draw()) — see the "Warboss Highway
// Pixi rewrite" plan, Phases C-E.
export class PixiRenderer implements GameRenderer {
  private app: Application;
  private textures: SpriteTextures;
  private worldContainer: Container;
  private road: TilingSprite;
  // z-order back-to-front, matching the original Canvas 2D draw() sequence:
  // road -> obstacles -> vehicles -> powerups -> player.
  private obstacleLayer = new Container();
  private vehicleLayer = new Container();
  private powerupLayer = new Container();
  // Glow-filtered effect layers (separate containers so each gets its own
  // GlowFilter color — exhaust warm-orange, shield cyan) plus particles on
  // top of everything, matching the original draw() order: obstacles ->
  // vehicles -> powerups -> exhaust -> player -> shield -> particles.
  private exhaustLayer = new Container();
  private shieldLayer = new Container();
  private particleLayer = new Container();
  private playerSprite: Sprite;
  private exhaustSprite: Sprite;
  private shieldRing: Graphics;
  private currentCarType: CarType | null = null;
  private gen = 0;
  private vehiclePool = new Map<Vehicle, PoolEntry>();
  private obstaclePool = new Map<Obstacle, PoolEntry>();
  private powerupPool = new Map<PowerUpItem, PoolEntry>();
  private particlePool = new Map<Particle, PoolEntry>();
  // 'low' skips GlowFilter (GPU cost) and caps particle count; read once at
  // boot since there's no live settings UI for this yet (Phase C decision:
  // auto-only, driven by prefers-reduced-motion — see settings.ts).
  private quality: 'low' | 'high' = Settings.getGraphicsQuality();
  // Simplification of the original chromatic-aberration speed-streak effect
  // (drawRoad()'s multi-strip fillRect at extreme speed) — see the Pixi
  // rewrite plan's Phase C note on this deliberate visual trade-off.
  private motionBlur: MotionBlurFilter | null = null;

  private constructor(app: Application, textures: SpriteTextures) {
    this.app = app;
    this.textures = textures;

    this.worldContainer = new Container();
    this.app.stage.addChild(this.worldContainer);

    this.road = new TilingSprite({
      texture: textures.roadTile,
      width: app.screen.width,
      height: app.screen.height,
    });
    this.worldContainer.addChild(this.road);
    this.worldContainer.addChild(this.obstacleLayer);
    this.worldContainer.addChild(this.vehicleLayer);
    this.worldContainer.addChild(this.powerupLayer);
    this.worldContainer.addChild(this.exhaustLayer);

    this.exhaustSprite = new Sprite(textures.softGlow);
    this.exhaustSprite.anchor.set(0.5);
    this.exhaustSprite.tint = 0xffaa33;
    this.exhaustSprite.blendMode = 'add';
    this.exhaustSprite.visible = false;
    this.exhaustLayer.addChild(this.exhaustSprite);

    this.playerSprite = new Sprite(Object.values(textures.playerCars)[0]);
    this.playerSprite.anchor.set(0.5);
    this.worldContainer.addChild(this.playerSprite);

    this.worldContainer.addChild(this.shieldLayer);
    this.shieldRing = new Graphics();
    this.shieldRing.circle(0, 0, 1).stroke({ width: 3, color: 0x00ffff, alpha: 0.9 });
    this.shieldRing.visible = false;
    this.shieldLayer.addChild(this.shieldRing);

    if (this.quality === 'high') {
      this.exhaustLayer.filters = [new GlowFilter({ distance: 10, outerStrength: 2, color: 0xffaa33, quality: 0.2 })];
      this.shieldLayer.filters = [new GlowFilter({ distance: 12, outerStrength: 2, color: 0x00ffff, quality: 0.2 })];
      this.motionBlur = new MotionBlurFilter({ velocity: { x: 0, y: 0 }, kernelSize: 5 });
      this.worldContainer.filters = [this.motionBlur];
    }

    this.worldContainer.addChild(this.particleLayer);
  }

  static async create(container: HTMLElement, width: number, height: number): Promise<PixiRenderer> {
    const app = new Application();
    await app.init({ width, height, backgroundAlpha: 0, antialias: true });
    container.appendChild(app.canvas);
    let textures: SpriteTextures;
    try {
      textures = await loadSpriteTextures(app.renderer);
    } catch (err) {
      console.error('[pixi] sprite pack failed to load, falling back to placeholder art', err);
      textures = generatePlaceholderTextures(app.renderer);
    }
    return new PixiRenderer(app, textures);
  }

  sync(state: GameState, cameraY: number, screenShake: number) {
    const shakeAmp = screenShake > 0 ? (screenShake / 300) * 9 : 0;
    this.worldContainer.x = shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0;
    this.worldContainer.y = (shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0) - cameraY;

    this.road.tilePosition.y = -state.roadOffset;

    if (this.currentCarType !== state.selectedCar) {
      this.playerSprite.texture = this.textures.playerCars[state.selectedCar];
      this.currentCarType = state.selectedCar;
    }
    this.playerSprite.x = state.player.x;
    this.playerSprite.y = state.player.y;
    this.playerSprite.alpha = state.player.isInvulnerable
      ? (Math.floor(performance.now() / 100) % 2 === 0 ? 0.4 : 1)
      : 1;
    // Bluish cast while slipping on an oil slick.
    this.playerSprite.tint = state.player.oilSlicked ? 0x99aaff : 0xffffff;

    // Exhaust plume trails behind the player (down-screen, since the sprite
    // faces up), intensity/length scaled by the current speed multiplier.
    this.exhaustSprite.visible = true;
    this.exhaustSprite.x = state.player.x;
    this.exhaustSprite.y = state.player.y + state.player.height / 2 + 4;
    this.exhaustSprite.width = state.player.width * 0.5;
    this.exhaustSprite.height = 14 + state.speedMultiplier * 10;
    this.exhaustSprite.alpha = 0.35 + Math.min(0.4, state.speedMultiplier * 0.15);

    const shieldActive = state.activePowerUp === 'SHIELD' && state.powerUpTimer > 0;
    this.shieldRing.visible = shieldActive;
    if (shieldActive) {
      this.shieldRing.x = state.player.x;
      this.shieldRing.y = state.player.y;
      const pulse = 1 + Math.sin(performance.now() / 150) * 0.06;
      this.shieldRing.scale.set((Math.max(state.player.width, state.player.height) * 0.75) * pulse);
    }

    if (this.motionBlur) {
      this.motionBlur.velocity = { x: 0, y: state.speedMultiplier * 4 };
    }

    this.gen++;

    syncPool(
      this.vehiclePool, state.vehicles, this.gen, this.vehicleLayer,
      (v) => { const s = new Sprite(vehicleTexture(this.textures, v)); s.anchor.set(0.5); return s; },
      (v, s) => {
        s.width = v.width;
        s.height = v.height;
        s.x = v.x;
        s.y = v.y;
        // Mirrors the original ctx.rotate(Math.PI) applied to oncoming
        // traffic in GameEngine.draw() — see the Pixi rewrite plan's
        // "sprite orientation" decision.
        s.rotation = Math.PI;
      }
    );

    syncPool(
      this.obstaclePool, state.obstacles, this.gen, this.obstacleLayer,
      (o) => { const s = new Sprite(o.type === 'OIL_SLICK' ? this.textures.oilSlick : this.textures.debris); s.anchor.set(0.5); return s; },
      (o, s) => { s.x = o.x; s.y = o.y; s.width = o.width; s.height = o.height; }
    );

    syncPool(
      this.powerupPool, state.powerups, this.gen, this.powerupLayer,
      (p) => { const s = new Sprite(this.textures.powerups[p.type]); s.anchor.set(0.5); return s; },
      (p, s) => { s.x = p.x; s.y = p.y; s.width = p.width; s.height = p.height; }
    );

    // 'low' quality caps the visible particle count instead of rendering
    // every burst — see settings.ts's graphicsQuality doc comment.
    const particles = this.quality === 'low' ? state.particles.slice(0, 20) : state.particles;
    syncPool(
      this.particlePool, particles, this.gen, this.particleLayer,
      () => { const s = new Sprite(this.textures.softGlow); s.anchor.set(0.5); s.blendMode = 'add'; return s; },
      (particle, s) => {
        s.tint = particle.color;
        s.x = particle.x;
        s.y = particle.y;
        s.width = s.height = particle.size;
        s.alpha = Math.max(0, particle.life / particle.maxLife);
      }
    );
  }

  destroy() {
    if (this.textures.assetUrls) {
      // Real sprite-pack textures are cached by pixi.Assets and meant to be
      // reused across restarts (menu -> play -> game over -> play again)
      // instead of re-fetched every time. Destroying or unloading them here
      // raced the next PixiRenderer.create()'s Assets.load() of the same
      // URLs — loading a key that's mid-unload never resolved, silently
      // stalling the whole renderer (no error, Pixi just never attached).
      // Leave the shared cache alone; only clean up what this instance
      // derived/owns itself: the cropped road-tile wrapper (not its shared
      // source) and the runtime-generated glow texture.
      this.textures.roadTile.destroy(false);
    } else {
      // generateTexture()'d placeholder textures aren't Assets-managed and
      // aren't owned by the scene graph either, so app.destroy({children:
      // true}) won't reclaim their GPU memory — destroy them explicitly.
      for (const texture of Object.values(this.textures.playerCars)) texture.destroy(true);
      for (const texture of Object.values(this.textures.powerups)) texture.destroy(true);
      for (const variants of Object.values(this.textures.enemyVehicles)) {
        variants.forEach((t) => t.destroy(true));
      }
      this.textures.roadTile.destroy(true);
      this.textures.bossVehicle.destroy(true);
      this.textures.oilSlick.destroy(true);
      this.textures.debris.destroy(true);
    }
    this.textures.softGlow.destroy(true); // always runtime-generated, never Assets-managed

    this.app.destroy(true, { children: true });
  }
}
