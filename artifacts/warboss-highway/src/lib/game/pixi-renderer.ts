import { Application, ColorMatrixFilter, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { GlowFilter, MotionBlurFilter } from 'pixi-filters';
import type { GameRenderer, GameState, CarType, Vehicle, Obstacle, PowerUpItem, Particle } from '@workspace/game-core';
import { loadSpriteTextures, generatePlaceholderTextures, type SpriteTextures } from './sprites';
import { Settings } from './settings';

// Mirrors the mobile Skia renderer's ROAD_TILE_SIZE (GameCanvas.tsx) so the
// road reads at the same in-game scale on both platforms.
const ROAD_TILE_DISPLAY_SIZE = 80;
const GUARDRAIL_WIDTH = 20;
const LAMP_WIDTH = 30;
const LAMP_HEIGHT = 60;
const LAMP_SPAN = 6 * ROAD_TILE_DISPLAY_SIZE; // 480px between same-side posts
const LAMP_PERIOD = 2 * LAMP_SPAN; // one left + one right post per period
const EXPLOSION_FLASH_MS = 400;

// Visual fix (2026-08-02), ported from the mobile Skia renderer
// (GameCanvas.tsx's ROAD_BOOST/VEHICLE_BOOST) after a real-device playtest
// showed the road reading as near-flat black and traffic blending into it.
// Pixi's ColorMatrixFilter.contrast()/.brightness() compose the same
// standard CSS-filter-style transform the mobile renderer applies via a raw
// Skia ColorMatrix, so both platforms end up with matching output despite
// using different graphics backends.
function boostFilter(contrast: number, brightness: number): ColorMatrixFilter {
  const f = new ColorMatrixFilter();
  // Pixi's contrast(amount) internally does v = amount + 1, so pass
  // (contrast - 1) to land on the same multiplier as the mobile renderer's
  // ROAD_BOOST/VEHICLE_BOOST constants (e.g. contrast=1.3 there == amount
  // 0.3 here). brightness() is multiplicative (b=1 is a no-op) rather than
  // additive like the CSS-filter formula the mobile side uses, so treat the
  // mobile brightness offset as "1 + offset" — close enough at these small
  // magnitudes that the two renderers read the same.
  f.contrast(contrast - 1, true);
  f.brightness(1 + brightness, true);
  return f;
}

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
  private laneDividers: Graphics;
  private guardrailLeft: TilingSprite;
  private guardrailRight: TilingSprite;
  private lampLayer: Container;
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
  private explosionSprite: Sprite;
  private prevScreenShake = 0;
  private explosionUntil = 0;
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
    // The sprite pack's road tile ships at high resolution (e.g. 2048x2048)
    // for print-quality source art, but TilingSprite repeats it at the
    // texture's native pixel size with no auto-fit — left alone, a single
    // tile is far larger than the whole canvas and the "road" is just an
    // undersampled crop of one tile, not a repeating pattern. Scale it down
    // to ROAD_TILE_DISPLAY_SIZE, matching the mobile Skia renderer's
    // ROAD_TILE_SIZE constant (GameCanvas.tsx) for visual parity between
    // platforms.
    this.road.tileScale.set(
      ROAD_TILE_DISPLAY_SIZE / textures.roadTile.width,
      ROAD_TILE_DISPLAY_SIZE / textures.roadTile.height
    );
    // Visual fix (2026-08-02): road boost + lane dividers, ported from the
    // mobile Skia renderer (see GameCanvas.tsx's ROAD_BOOST and
    // buildRoadGrid()'s lane-divider Lines) after a real-device playtest
    // showed the road reading as flat and unmarked.
    this.road.filters = [boostFilter(1.3, 0.05)];
    this.worldContainer.addChild(this.road);

    this.laneDividers = new Graphics();
    const laneWidth = app.screen.width / 3;
    for (const divX of [laneWidth, laneWidth * 2]) {
      this.laneDividers
        .moveTo(divX, 0)
        .lineTo(divX, app.screen.height)
        .stroke({ width: 2, color: 0xffffff, alpha: 0.16 });
    }
    this.worldContainer.addChild(this.laneDividers);

    // Roadside guardrails — this asset shipped fully rendered but was never
    // wired into either renderer (no shoulder in the full-bleed road
    // layout to place it in). Overlaid on the outermost road tiles at each
    // edge rather than narrowing the playable width, which is GameEngine's
    // shared lane math (this.width / 3) — not worth touching for a
    // decorative pass. Kept in sync with the road's own scroll below.
    this.guardrailLeft = new TilingSprite({ texture: textures.guardrail, width: GUARDRAIL_WIDTH, height: app.screen.height });
    this.guardrailRight = new TilingSprite({ texture: textures.guardrail, width: GUARDRAIL_WIDTH, height: app.screen.height });
    this.guardrailLeft.tileScale.set(GUARDRAIL_WIDTH / textures.guardrail.width, ROAD_TILE_DISPLAY_SIZE / textures.guardrail.height);
    this.guardrailRight.tileScale.set(GUARDRAIL_WIDTH / textures.guardrail.width, ROAD_TILE_DISPLAY_SIZE / textures.guardrail.height);
    this.guardrailRight.x = app.screen.width - GUARDRAIL_WIDTH;
    this.worldContainer.addChild(this.guardrailLeft);
    this.worldContainer.addChild(this.guardrailRight);

    // Lamp posts — same reasoning as guardrails (real, unused art with no
    // natural spawn point without touching shared lane math), but unlike
    // the guardrail segment this one isn't seamlessly tileable, so
    // TilingSprite doesn't apply. Built once as a repeating left/right pair
    // spaced LAMP_SPAN apart, covering the full scroll range, then the
    // whole container is translated by -(roadOffset % LAMP_PERIOD) each
    // frame in sync() below — same "static build + scroll a transform"
    // idea as the road grid, just via Container.y instead of tilePosition.
    // The static grid has to extend a full LAMP_PERIOD beyond the viewport
    // on both ends (not just LAMP_PERIOD total) — since lampLayer wraps at
    // LAMP_PERIOD, a smaller grid would expose empty space above/below at
    // the wrap boundary.
    this.lampLayer = new Container();
    const lampRows = Math.ceil((app.screen.height + 2 * LAMP_PERIOD) / LAMP_SPAN) + 1;
    const lampYStart = -LAMP_PERIOD;
    for (let row = 0; row < lampRows; row++) {
      const sprite = new Sprite(textures.lampPost);
      sprite.width = LAMP_WIDTH;
      sprite.height = LAMP_HEIGHT;
      sprite.x = row % 2 === 0 ? 0 : app.screen.width - LAMP_WIDTH;
      sprite.y = lampYStart + row * LAMP_SPAN;
      this.lampLayer.addChild(sprite);
    }
    this.worldContainer.addChild(this.lampLayer);

    this.worldContainer.addChild(this.obstacleLayer);
    this.vehicleLayer.filters = [boostFilter(1.2, 0.12)];
    this.worldContainer.addChild(this.vehicleLayer);
    this.worldContainer.addChild(this.powerupLayer);
    this.worldContainer.addChild(this.exhaustLayer);

    // smoke.png instead of the generated glow circle — normal blend (not
    // 'add') so it reads as an actual plume instead of a bloom; the
    // exhaustLayer's GlowFilter (quality:'high' only) still adds a heat
    // shimmer on top of it.
    this.exhaustSprite = new Sprite(textures.smoke);
    this.exhaustSprite.anchor.set(0.5);
    this.exhaustSprite.tint = 0xffaa33;
    this.exhaustSprite.visible = false;
    this.exhaustLayer.addChild(this.exhaustSprite);

    // One-shot crash flash — explosion.png, triggered off a rising edge in
    // state.screenShake (see sync() below) rather than a dedicated
    // GameState field, so it needs no game-core changes. Sits above
    // traffic/obstacles but behind the player, added here (same z-order
    // point as exhaustLayer) before playerSprite is created below.
    this.explosionSprite = new Sprite(textures.explosion);
    this.explosionSprite.anchor.set(0.5);
    this.explosionSprite.visible = false;
    this.worldContainer.addChild(this.explosionSprite);

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

    // Crash flash — a rising edge in screenShake (handleCrash() sets it to
    // 300 in engine.ts) is the only "a real crash just happened" signal
    // exposed to the renderer without a dedicated GameState field; the
    // armor-save near-miss path creates particles but never sets
    // screenShake, so this correctly skips that case.
    if (screenShake > this.prevScreenShake) {
      this.explosionUntil = performance.now() + EXPLOSION_FLASH_MS;
    }
    this.prevScreenShake = screenShake;
    const explosionRemaining = this.explosionUntil - performance.now();
    if (explosionRemaining > 0) {
      const t = 1 - explosionRemaining / EXPLOSION_FLASH_MS;
      this.explosionSprite.visible = true;
      this.explosionSprite.x = state.player.x;
      this.explosionSprite.y = state.player.y;
      const scale = 0.7 + t * 0.9;
      this.explosionSprite.width = state.player.width * 1.8 * scale;
      this.explosionSprite.height = state.player.height * 1.8 * scale;
      this.explosionSprite.alpha = 1 - t;
    } else {
      this.explosionSprite.visible = false;
    }

    this.road.tilePosition.y = -state.roadOffset;
    this.guardrailLeft.tilePosition.y = -state.roadOffset;
    this.guardrailRight.tilePosition.y = -state.roadOffset;
    // Road/guardrail tiles are uniform and repeat every 80px, so wrapping
    // their transform at that small period is indistinguishable from true
    // infinite scroll. Lamp posts are sparse, identical-looking objects
    // with visible gaps between them — wrapping at 80px would just make
    // each post jitter within a small band instead of travelling down the
    // screen, so this uses its own dedicated LAMP_PERIOD instead (see the
    // LAMP_PERIOD constant comment).
    this.lampLayer.y = -(state.roadOffset % LAMP_PERIOD);

    if (this.currentCarType !== state.selectedCar) {
      this.playerSprite.texture = this.textures.playerCars[state.selectedCar];
      this.currentCarType = state.selectedCar;
    }
    this.playerSprite.x = state.player.x;
    this.playerSprite.y = state.player.y;
    // Unlike vehicles/obstacles/powerups (sized every frame via syncPool),
    // the player sprite's width/height were never assigned at all — a
    // Sprite with no explicit size renders at its texture's native pixel
    // size. Harmless with small placeholder art, but the real sprite pack
    // ships at ~1373x2048px, so the player car rendered at ~full texture
    // resolution and filled/overflowed the entire canvas.
    this.playerSprite.width = state.player.width;
    this.playerSprite.height = state.player.height;
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
      () => { const s = new Sprite(this.textures.spark); s.anchor.set(0.5); s.blendMode = 'add'; return s; },
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
      this.textures.guardrail.destroy(true);
    }
    this.textures.softGlow.destroy(true); // always runtime-generated, never Assets-managed

    this.app.destroy(true, { children: true });
  }
}
