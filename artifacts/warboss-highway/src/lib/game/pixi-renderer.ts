import { Application, ColorMatrixFilter, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { GlowFilter, MotionBlurFilter } from 'pixi-filters';
import type { GameRenderer, GameState, CarType, Vehicle, Obstacle, PowerUpItem, Particle } from '@workspace/game-core';
import { loadSpriteTextures, generatePlaceholderTextures, type SpriteTextures } from './sprites';
import { Settings } from './settings';

// Mirrors the mobile Skia renderer's ROAD_TILE_SIZE (GameCanvas.tsx) so the
// road reads at the same in-game scale on both platforms. Was 80 — real
// playtesting called the asphalt texture too subtle/hard to make out at
// that repeat size.
const ROAD_TILE_DISPLAY_SIZE = 110;
const GUARDRAIL_WIDTH = 24;
const LAMP_WIDTH = 34;
const LAMP_HEIGHT = 70;
const LAMP_SPAN = 6 * ROAD_TILE_DISPLAY_SIZE; // between same-side posts
const LAMP_PERIOD = 2 * LAMP_SPAN; // one left + one right post per period
// Matches the mobile Skia renderer's DashPathEffect intervals={[18, 14]}.
const LANE_DASH_LEN = 18;
const LANE_DASH_GAP = 14;
const LANE_DASH_PERIOD = LANE_DASH_LEN + LANE_DASH_GAP;
const EXPLOSION_FLASH_MS = 400;
const NEON = {
  midnight: 0x050816,
  roadSheen: 0x294766,
  cyan: 0x27d9ff,
  magenta: 0xdf4bff,
  amber: 0xffb347,
  trafficRed: 0xff3d67,
  headlight: 0xeaf7ff,
};
// A prior pass addressed "cars look tiny vs. the road" with a render-only
// VISUAL_SCALE multiplier (visual size inflated past the actual collision
// hitbox). Superseded (2026-08-03) by properly upsizing CAR_STATS/spawn
// dimensions in engine.ts itself and narrowing lanes from 3 to 4 — real
// hitbox and rendered size now match again, no separate multiplier needed.

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
  private backdrop: Graphics;
  private road: TilingSprite;
  private roadSheen: Graphics;
  private weatherLayer: Graphics;
  private feedbackLayer: Graphics;
  private vehicleLightLayer: Graphics;
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

    // A deliberately dark, cool base makes the road materials and functional
    // lights feel luminous without relying on a full-screen post-process.
    this.backdrop = new Graphics();
    this.backdrop.rect(0, 0, app.screen.width, app.screen.height).fill(NEON.midnight);
    this.worldContainer.addChild(this.backdrop);

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
    // Visual fix, ported from the mobile Skia renderer (see GameCanvas.
    // tsx's ROAD_BOOST). Contrast raised further (was 1.3/0.05) — real
    // playtesting still called the asphalt too flat/hard to make out even
    // with the first boost pass.
    this.road.filters = [boostFilter(1.55, 0.08)];
    this.worldContainer.addChild(this.road);

    // Animated wet-road sheen and edge-light pools are drawn with one stable
    // Graphics node. Their geometry is rebuilt in sync(), not allocated as
    // per-frame scene objects.
    this.roadSheen = new Graphics();
    this.worldContainer.addChild(this.roadSheen);

    // Lane markings — matches engine.ts's 4-lane math (`this.width / 4`).
    // Lanes 0-1 (oncoming) and 2-3 (same direction) are each dashed
    // internally (ordinary lane splits, matching the mobile Skia
    // renderer's DashPathEffect); the boundary between lane 1 and 2 is
    // the direction divide, drawn as a solid double-yellow center line
    // like a real two-way road — never dashed, so it doesn't need the
    // scroll treatment below (a shifted continuous line looks identical
    // to a static one; only the dashes need real motion, see sync()).
    this.laneDividers = new Graphics();
    const laneWidth = app.screen.width / 4;
    const dashSpan = app.screen.height + 2 * LANE_DASH_PERIOD;
    for (const divX of [laneWidth, laneWidth * 3]) {
      for (let y = -LANE_DASH_PERIOD; y < dashSpan; y += LANE_DASH_PERIOD) {
        this.laneDividers
          .moveTo(divX, y)
          .lineTo(divX, y + LANE_DASH_LEN)
          .stroke({ width: 2, color: NEON.cyan, alpha: 0.24 });
      }
    }
    const centerX = laneWidth * 2;
    for (const offset of [-2.5, 2.5]) {
      this.laneDividers
        .moveTo(centerX + offset, -LANE_DASH_PERIOD)
        .lineTo(centerX + offset, dashSpan)
          .stroke({ width: 2.5, color: NEON.amber, alpha: 0.72 });
    }
    this.worldContainer.addChild(this.laneDividers);

    // Roadside guardrails — this asset shipped fully rendered but was never
    // wired into either renderer (no shoulder in the full-bleed road
    // layout to place it in). Overlaid on the outermost road tiles at each
    // edge rather than narrowing the playable width, which is GameEngine's
    // shared lane math — not worth touching for a decorative pass. Kept in
    // sync with the road's own scroll below. Boosted like vehicles/road —
    // previously had no filter at all, dark art on a dark road with
    // nothing pushing it forward, easy to miss entirely at a glance.
    const roadsideBoost = boostFilter(1.4, 0.14);
    this.guardrailLeft = new TilingSprite({ texture: textures.guardrail, width: GUARDRAIL_WIDTH, height: app.screen.height });
    this.guardrailRight = new TilingSprite({ texture: textures.guardrail, width: GUARDRAIL_WIDTH, height: app.screen.height });
    this.guardrailLeft.tileScale.set(GUARDRAIL_WIDTH / textures.guardrail.width, ROAD_TILE_DISPLAY_SIZE / textures.guardrail.height);
    this.guardrailRight.tileScale.set(GUARDRAIL_WIDTH / textures.guardrail.width, ROAD_TILE_DISPLAY_SIZE / textures.guardrail.height);
    this.guardrailRight.x = app.screen.width - GUARDRAIL_WIDTH;
    this.guardrailLeft.filters = [roadsideBoost];
    this.guardrailRight.filters = [roadsideBoost];
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
    this.lampLayer.filters = [roadsideBoost];
    this.worldContainer.addChild(this.lampLayer);

    this.worldContainer.addChild(this.obstacleLayer);
    this.vehicleLightLayer = new Graphics();
    this.worldContainer.addChild(this.vehicleLightLayer);
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
    // Redrawn every frame at its real target radius in sync() below
    // instead of being drawn once at radius 1 and scaled up via
    // Graphics.scale — scale.set() scales the stroke width along with the
    // geometry, so a 3px stroke on a unit circle became a 3px * ~50 =
    // ~150px-wide ring at gameplay size: a solid-looking blob many times
    // the player's own size, not a thin ring around it.
    this.shieldRing = new Graphics();
    this.shieldRing.visible = false;
    this.shieldLayer.addChild(this.shieldRing);

    if (this.quality === 'high') {
      this.exhaustLayer.filters = [new GlowFilter({ distance: 10, outerStrength: 2, color: 0xffaa33, quality: 0.2 })];
      this.shieldLayer.filters = [new GlowFilter({ distance: 12, outerStrength: 2, color: 0x00ffff, quality: 0.2 })];
      this.motionBlur = new MotionBlurFilter({ velocity: { x: 0, y: 0 }, kernelSize: 5 });
      this.worldContainer.filters = [this.motionBlur];
    }

    this.worldContainer.addChild(this.particleLayer);

    // Weather and player-event effects sit above the world but below the HUD.
    // They use stable graphics instead of a large particle pool, keeping the
    // visual upgrade inexpensive on browser GPU paths.
    this.weatherLayer = new Graphics();
    this.feedbackLayer = new Graphics();
    this.worldContainer.addChild(this.weatherLayer);
    this.worldContainer.addChild(this.feedbackLayer);
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
    this.syncWorldTransform(cameraY, screenShake);
    this.syncCrashFlash(state, screenShake);
    this.syncRoadScroll(state);
    this.syncPlayerEffects(state);
    this.syncEntityPools(state);
    this.drawNeonRainwayLayers(state);
  }

  private syncWorldTransform(cameraY: number, screenShake: number) {
    const shakeAmp = screenShake > 0 ? (screenShake / 300) * 9 : 0;
    this.worldContainer.x = shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0;
    this.worldContainer.y = (shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0) - cameraY;
  }

  private syncCrashFlash(state: GameState, screenShake: number) {
    if (screenShake > this.prevScreenShake) this.explosionUntil = performance.now() + EXPLOSION_FLASH_MS;
    this.prevScreenShake = screenShake;
    const remaining = this.explosionUntil - performance.now();
    this.explosionSprite.visible = remaining > 0;
    if (remaining <= 0) return;
    const progress = 1 - remaining / EXPLOSION_FLASH_MS;
    const scale = 0.7 + progress * 0.9;
    this.explosionSprite.x = state.player.x;
    this.explosionSprite.y = state.player.y;
    this.explosionSprite.width = state.player.width * 1.8 * scale;
    this.explosionSprite.height = state.player.height * 1.8 * scale;
    this.explosionSprite.alpha = 1 - progress;
  }

  private syncRoadScroll(state: GameState) {
    this.road.tilePosition.y = -state.roadOffset;
    this.laneDividers.y = -(state.roadOffset % LANE_DASH_PERIOD);
    this.guardrailLeft.tilePosition.y = -state.roadOffset;
    this.guardrailRight.tilePosition.y = -state.roadOffset;
    this.lampLayer.y = -(state.roadOffset % LAMP_PERIOD);
  }

  private syncPlayerEffects(state: GameState) {
    if (this.currentCarType !== state.selectedCar) {
      this.playerSprite.texture = this.textures.playerCars[state.selectedCar];
      this.currentCarType = state.selectedCar;
    }
    const player = state.player;
    this.playerSprite.x = player.x;
    this.playerSprite.y = player.y;
    this.playerSprite.width = player.width;
    this.playerSprite.height = player.height;
    this.playerSprite.alpha = player.isInvulnerable ? (Math.floor(performance.now() / 100) % 2 === 0 ? 0.4 : 1) : 1;
    this.playerSprite.tint = player.oilSlicked ? 0x99aaff : 0xffffff;
    this.playerSprite.rotation = state.driveTilt * 0.14 + (state.rushTimer > 0 ? state.driveTilt * 0.035 : 0);
    this.exhaustSprite.visible = true;
    this.exhaustSprite.x = player.x;
    this.exhaustSprite.y = player.y + player.height / 2 + 4;
    this.exhaustSprite.width = player.width * 0.5;
    this.exhaustSprite.height = 14 + state.speedMultiplier * 10;
    this.exhaustSprite.alpha = 0.35 + Math.min(0.4, state.speedMultiplier * 0.15);
    this.syncShield(state);
    if (this.motionBlur) this.motionBlur.velocity = { x: 0, y: state.speedMultiplier * (state.rushTimer > 0 ? 6 : 4) };
  }

  private syncShield(state: GameState) {
    const active = state.activePowerUp === 'SHIELD' && state.powerUpTimer > 0;
    this.shieldRing.visible = active;
    if (!active) return;
    const player = state.player;
    const radius = Math.max(player.width, player.height) * 0.75 * (1 + Math.sin(performance.now() / 150) * 0.06);
    this.shieldRing.x = player.x;
    this.shieldRing.y = player.y;
    this.shieldRing.clear();
    this.shieldRing.circle(0, 0, radius).stroke({ width: 3, color: 0x00ffff, alpha: 0.9 });
  }

  private syncEntityPools(state: GameState) {
    this.gen++;
    syncPool(this.vehiclePool, state.vehicles, this.gen, this.vehicleLayer,
      (vehicle) => { const sprite = new Sprite(vehicleTexture(this.textures, vehicle)); sprite.anchor.set(0.5); return sprite; },
      (vehicle, sprite) => { sprite.width = vehicle.width; sprite.height = vehicle.height; sprite.x = vehicle.x; sprite.y = vehicle.y; sprite.rotation = vehicle.direction === 'OPPOSITE' ? Math.PI : 0; });
    syncPool(this.obstaclePool, state.obstacles, this.gen, this.obstacleLayer,
      (obstacle) => { const sprite = new Sprite(obstacle.type === 'OIL_SLICK' ? this.textures.oilSlick : this.textures.debris); sprite.anchor.set(0.5); return sprite; },
      (obstacle, sprite) => { sprite.x = obstacle.x; sprite.y = obstacle.y; sprite.width = obstacle.width; sprite.height = obstacle.height; });
    syncPool(this.powerupPool, state.powerups, this.gen, this.powerupLayer,
      (powerup) => { const sprite = new Sprite(this.textures.powerups[powerup.type]); sprite.anchor.set(0.5); return sprite; },
      (powerup, sprite) => { sprite.x = powerup.x; sprite.y = powerup.y; sprite.width = powerup.width; sprite.height = powerup.height; });
    const particles = this.quality === 'low' ? state.particles.slice(0, 20) : state.particles;
    syncPool(this.particlePool, particles, this.gen, this.particleLayer,
      () => { const sprite = new Sprite(this.textures.spark); sprite.anchor.set(0.5); sprite.blendMode = 'add'; return sprite; },
      (particle, sprite) => { sprite.tint = particle.color; sprite.x = particle.x; sprite.y = particle.y; sprite.width = sprite.height = particle.size; sprite.alpha = Math.max(0, particle.life / particle.maxLife); });
  }

  // Stable Graphics layers keep the new world treatment inexpensive: their draw commands update in place.
  private drawNeonRainwayLayers(state: GameState) {
    this.drawRoadSheen(state);
    this.drawVehicleLights(state);
    this.drawWeather(state);
    this.drawFeedback(state);
  }

  private drawRoadSheen(state: GameState) {
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    this.roadSheen.clear();
    for (let i = 0; i < 7; i++) {
      const y = ((i * 137 + state.roadOffset * 0.42) % (height + 180)) - 90;
      this.roadSheen.roundRect(30, y, width - 60, 26, 13).fill({ color: NEON.roadSheen, alpha: 0.025 + (i % 3) * 0.012 });
    }
    const edgeAlpha = 0.16 + Math.min(0.22, state.speedMultiplier * 0.06);
    for (let i = 0; i < 6; i++) {
      const y = ((i * 180 + state.roadOffset * 1.25) % (height + 140)) - 70;
      this.roadSheen.roundRect(12, y, 3, 72, 2).fill({ color: NEON.cyan, alpha: edgeAlpha });
      this.roadSheen.roundRect(width - 15, y + 42, 3, 72, 2).fill({ color: NEON.cyan, alpha: edgeAlpha * 0.82 });
    }
  }

  private drawVehicleLights(state: GameState) {
    this.vehicleLightLayer.clear();
    for (const vehicle of state.vehicles) {
      if (vehicle.type === 'BOSS') continue;
      const oncoming = vehicle.direction === 'OPPOSITE';
      const color = oncoming ? NEON.headlight : NEON.trafficRed;
      const y = vehicle.y + vehicle.height * 0.34;
      const spread = Math.max(7, vehicle.width * 0.24);
      const radius = Math.max(3, vehicle.width * 0.12);
      this.vehicleLightLayer.circle(vehicle.x - spread, y, radius).fill({ color, alpha: oncoming ? 0.55 : 0.5 });
      this.vehicleLightLayer.circle(vehicle.x + spread, y, radius).fill({ color, alpha: oncoming ? 0.55 : 0.5 });
      if (oncoming) this.vehicleLightLayer.roundRect(vehicle.x - vehicle.width * 0.18, y + radius, vehicle.width * 0.36, vehicle.height * 0.42, 6).fill({ color, alpha: 0.045 });
    }
  }

  private drawWeather(state: GameState) {
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    const count = this.quality === 'low' ? 8 : state.rushTimer > 0 ? 34 : 22;
    const alpha = this.quality === 'low' ? 0.08 : state.rushTimer > 0 ? 0.2 : 0.12;
    this.weatherLayer.clear();
    for (let i = 0; i < count; i++) {
      const x = 8 + ((i * 71) % Math.max(1, width - 16));
      const y = ((i * 113 + state.roadOffset * (1.25 + (i % 4) * 0.13)) % (height + 110)) - 55;
      this.weatherLayer.moveTo(x, y).lineTo(x - 2, y + 10 + (i % 5) * 5 + state.speedMultiplier * 3).stroke({ width: i % 3 === 0 ? 1.1 : 0.65, color: 0xb9e9ff, alpha });
    }
  }

  private drawFeedback(state: GameState) {
    const player = state.player;
    this.feedbackLayer.clear();
    this.drawNearMissFeedback(state, player);
    this.drawRushFeedback(state, player);
  }

  private drawNearMissFeedback(state: GameState, player: GameState['player']) {
    if (state.nearMissPulse <= 0) return;
    const progress = state.nearMissPulse / 300;
    const radius = Math.max(player.width, player.height) * (0.72 + (1 - progress) * 0.7);
    this.feedbackLayer.circle(player.x, player.y, radius).stroke({ width: 2.5 * progress, color: NEON.magenta, alpha: progress * 0.75 });
  }

  private drawRushFeedback(state: GameState, player: GameState['player']) {
    if (state.rushTimer <= 0) return;
    const radius = Math.max(player.width, player.height) * 1.2 * (0.75 + Math.sin(performance.now() / 70) * 0.18);
    this.feedbackLayer.circle(player.x, player.y + player.height * 0.24, radius).fill({ color: NEON.cyan, alpha: 0.10 });
    this.feedbackLayer.circle(player.x, player.y, radius * 0.9).stroke({ width: 2, color: NEON.magenta, alpha: 0.6 });
    for (let i = -2; i <= 2; i++) {
      const x = player.x + i * player.width * 0.34;
      this.feedbackLayer.moveTo(x, player.y + player.height * 0.42).lineTo(x - state.driveTilt * 12, player.y + player.height * (1.2 + Math.abs(i) * 0.14)).stroke({ width: 2.2, color: i % 2 === 0 ? NEON.cyan : NEON.magenta, alpha: 0.55 });
    }
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
