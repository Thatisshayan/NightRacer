import { Application, ColorMatrixFilter, Container, Graphics, Sprite, TilingSprite } from 'pixi.js';
import { GlowFilter, MotionBlurFilter } from 'pixi-filters';
import type { GameRenderer, GameState, CarType, Vehicle, Obstacle, PowerUpItem, Particle } from '@workspace/game-core';
import { loadSpriteTextures, generatePlaceholderTextures, type SpriteTextures } from './sprites';
import { Projection } from './perspective';
import { Settings } from './settings';

// Mirrors the mobile Skia renderer's ROAD_TILE_SIZE (GameCanvas.tsx) so the
// road reads at the same in-game scale on both platforms. Was 80 — real
// playtesting called the asphalt texture too subtle/hard to make out at
// that repeat size.
const ROAD_TILE_DISPLAY_SIZE = 110;
// Paved shoulder + guardrail band outside the drivable road, at player-row
// scale. Decorative only — GameEngine's lane math still owns the full width.
const SHOULDER_WIDTH = 26;
// Transverse asphalt seams, in world units. Replaces the tiled asphalt
// texture as the surface's motion cue; see drawWorld().
const ROAD_SEAM_PERIOD = ROAD_TILE_DISPLAY_SIZE;
// Vertical depth of the distance-fog band under the horizon line.
const HORIZON_HAZE_PX = 34;
// Elevated-deck structure repeats in world units, so posts shrink and compress
// toward the horizon with the same projection as traffic and lane markings.
const DECK_POST_PERIOD = 160;
const VOID_BAND_COUNT = 11;
const LAMP_WIDTH = 34;
const LAMP_HEIGHT = 70;
const LAMP_SPAN = 6 * ROAD_TILE_DISPLAY_SIZE; // between same-side posts
// Matches the mobile Skia renderer's DashPathEffect intervals={[18, 14]}.
const LANE_DASH_LEN = 18;
const LANE_DASH_GAP = 14;
const LANE_DASH_PERIOD = LANE_DASH_LEN + LANE_DASH_GAP;
const EXPLOSION_FLASH_MS = 400;
const NEON = {
  midnight: 0x050816,
  // ASSETS.md's specified asphalt indigo. Kept as the reference value.
  asphalt: 0x11192a,
  // What the road is actually filled with. The old flat road reached its
  // approved luminance as `asphalt` + the authored tile + a contrast/
  // brightness boost filter; the projected road is plain vector geometry with
  // depth shading on top, and filling it at the raw spec value measured at
  // luminance 0.0013 — darker than the pre-audit build. Re-running the boost
  // filter over a flat fill made it worse, not better (contrast pushes an
  // already-dark colour further from mid-grey). This value is the spec hue
  // lifted until the near road measures back at the ~0.03 luminance the
  // readability pass established.
  roadSurface: 0x282f42,
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

// The direction divide sits between lanes 1 and 2 of engine.ts's 4 lanes.
function centerLineX(width: number): number {
  return width / 2;
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
  // Pseudo-3D ground-plane camera. Render-only: GameState stays flat, see
  // perspective.ts for the contract and the math.
  private projection: Projection;
  private skyLayer: Container;
  private skyGradient: Graphics;
  private skylineFar: TilingSprite;
  private skylineNear: TilingSprite;
  // The void sits behind the deck and adds the industrial drop outside the
  // highway without touching game-world or collision geometry.
  private cityVoidLayer: Graphics;
  // Rails, uprights, and braces sit above the road skin so the deck reads as
  // a constructed bridge rather than an asphalt trapezoid.
  private deckStructureLayer: Graphics;
  // Road surface, lane markings, shoulders and horizon haze are now one
  // rebuilt-in-place Graphics: in perspective every band has a different
  // width and spacing per frame, so a static build + scrolled transform (the
  // old TilingSprite/laneDividers approach) no longer applies.
  private roadLayer: Graphics;
  private roadSheen: Graphics;
  private weatherLayer: Graphics;
  private feedbackLayer: Graphics;
  private vehicleLightLayer: Graphics;
  private lampLayer: Graphics;
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
  private playerAnchor: Graphics;
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

    // --- Pseudo-3D world geometry ---------------------------------------
    // Everything from here to the lamp layer used to be drawn orthographically
    // (full-viewport asphalt rectangle, parallel lane dashes, vertical
    // guardrail strips). That view carries no approach cue, which is what made
    // traffic feel rhythmless and "boxed in". It is now projected onto a
    // ground plane receding to a vanishing point — see perspective.ts.
    this.projection = new Projection(app.screen.width, app.screen.height);
    const horizonY = this.projection.horizonY;

    // Sky band above the horizon. The skyline art shipped with the pack but
    // had no home in gameplay before the horizon existed; it was menu-only
    // DOM decoration.
    this.skyLayer = new Container();
    this.skyGradient = new Graphics();
    // Cheap vertical gradient: a few stacked bands, brightest just above the
    // horizon so the city glow reads as light pollution behind the skyline.
    const skyBands = 14;
    for (let i = 0; i < skyBands; i++) {
      const f = i / (skyBands - 1);
      this.skyGradient
        .rect(0, (horizonY * i) / skyBands, app.screen.width, horizonY / skyBands + 1)
        .fill({ color: NEON.cyan, alpha: 0.015 + f * f * 0.075 });
    }
    this.skyLayer.addChild(this.skyGradient);

    // Two horizontally-tiling skyline bands. They scroll at different rates
    // off the player's lateral position and the road scroll, so the world
    // reads as moving past a city rather than sliding on a treadmill.
    this.skylineFar = new TilingSprite({ texture: textures.skylineFar, width: app.screen.width, height: horizonY * 0.72 });
    this.skylineNear = new TilingSprite({ texture: textures.skylineNear, width: app.screen.width, height: horizonY * 0.52 });
    for (const [layer, alpha] of [[this.skylineFar, 0.45], [this.skylineNear, 0.72]] as const) {
      layer.tileScale.set(
        (horizonY * 0.9) / layer.texture.height,
        (horizonY * 0.9) / layer.texture.height
      );
      layer.alpha = alpha;
      this.skyLayer.addChild(layer);
    }
    this.skylineFar.y = horizonY - this.skylineFar.height;
    this.skylineNear.y = horizonY - this.skylineNear.height;
    this.skylineNear.tint = 0x9fd8ff;
    this.worldContainer.addChild(this.skyLayer);

    this.cityVoidLayer = new Graphics();
    this.worldContainer.addChild(this.cityVoidLayer);

    this.roadLayer = new Graphics();
    this.worldContainer.addChild(this.roadLayer);

    this.deckStructureLayer = new Graphics();
    this.worldContainer.addChild(this.deckStructureLayer);

    // Animated wet-road sheen and edge-light pools are drawn with one stable
    // Graphics node. Their geometry is rebuilt in sync(), not allocated as
    // per-frame scene objects.
    this.roadSheen = new Graphics();
    this.worldContainer.addChild(this.roadSheen);

    // Lamp posts. Previously repeating Sprites on a scrolled Container; in
    // perspective each post needs its own per-frame position, scale and
    // light-cone, so they are drawn as geometry alongside the road.
    this.lampLayer = new Graphics();
    this.worldContainer.addChild(this.lampLayer);

    this.worldContainer.addChild(this.obstacleLayer);
    this.vehicleLightLayer = new Graphics();
    this.worldContainer.addChild(this.vehicleLightLayer);
    // Raised from (1.2, 0.12): measured enemy-vs-road contrast was 3.25:1 and a
    // light vehicle only 2.48:1, against a 4.5:1 minimum for hit-critical objects.
    this.vehicleLayer.filters = [boostFilter(1.45, 0.42)];
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

    // Player anchor. ASSETS.md requires the player to be clear within 250ms of
    // first viewing the screen; a dark car on a dark road at the bottom edge
    // with no shadow and no underglow failed that check outright. Drawn into
    // one stable Graphics directly beneath the sprite, rebuilt in place.
    this.playerAnchor = new Graphics();
    this.worldContainer.addChild(this.playerAnchor);

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
    this.drawWorld(state);
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
    const burst = this.projection.project(state.player.x, state.player.y);
    this.explosionSprite.x = burst.x;
    this.explosionSprite.y = burst.y;
    this.explosionSprite.width = state.player.width * 1.8 * scale;
    this.explosionSprite.height = state.player.height * 1.8 * scale;
    this.explosionSprite.alpha = 1 - progress;
  }

  // Rebuilds the projected road, markings, shoulders and lamps each frame.
  // Perspective makes this necessary: unlike the old orthographic build, every
  // transverse feature has a different width and vertical spacing depending on
  // how far away it is, so nothing can be built once and scrolled.
  private drawWorld(state: GameState) {
    const proj = this.projection;
    const { width: W, height: H, horizonY, centerX: cx } = proj;
    const g = this.roadLayer;
    g.clear();

    const sHorizon = proj.scaleAt(0);
    const sBottom = proj.scaleAt(H);
    const hwTop = (W / 2) * sHorizon;
    const hwBottom = (W / 2) * sBottom;

    // The city void is a dedicated background layer so the bridge remains
    // visibly suspended over an industrial depth without touching the road's
    // collision plane or the shared engine's lane math.
    this.drawCityVoid(state, hwTop, hwBottom);

    // Road surface.
    g.poly([
      cx - hwTop, horizonY,
      cx + hwTop, horizonY,
      cx + hwBottom, H,
      cx - hwBottom, H,
    ]).fill({ color: NEON.roadSurface });

    this.drawRoadShadingAndMarkings(state, hwTop, hwBottom);
    this.drawShoulders(sHorizon, sBottom, hwTop, hwBottom);
    this.drawHorizonHaze();
    this.drawDeckStructure(state, sHorizon, sBottom, hwTop, hwBottom);

    this.drawLamps(state);
    this.syncSkyline(state);
  }

  // Rebuilds the world outside the road as a dark urban drop. The shapes use
  // the road projection instead of screen-space rectangles so supports and
  // distant structures compress naturally into the horizon.
  private drawCityVoid(state: GameState, hwTop: number, hwBottom: number) {
    const proj = this.projection;
    const { width: W, height: H, horizonY, centerX: cx } = proj;
    const g = this.cityVoidLayer;
    g.clear();

    const sHorizon = proj.scaleAt(0);
    const shoulderTop = SHOULDER_WIDTH * sHorizon;
    const shoulderBottom = SHOULDER_WIDTH * proj.scaleAt(H);

    for (const side of [-1, 1]) {
      const deckTop = cx + side * (hwTop + shoulderTop);
      const deckBottom = cx + side * (hwBottom + shoulderBottom);
      const screenEdge = side < 0 ? 0 : W;

      // A subtly blue-black void separates the elevated deck from the skyline.
      g.poly([deckTop, horizonY, screenEdge, horizonY, screenEdge, H, deckBottom, H])
        .fill({ color: 0x030712 });
      // Atmospheric light bloom sits high in the void so it reads as distant
      // city haze rather than a bright playfield-side distraction.
      g.poly([deckTop, horizonY, screenEdge, horizonY, screenEdge, horizonY + H * 0.38, deckBottom, horizonY + H * 0.18])
        .fill({ color: NEON.cyan, alpha: 0.025 });

      for (let i = 0; i < VOID_BAND_COUNT; i++) {
        const worldY = i * DECK_POST_PERIOD + (state.roadOffset * 0.18) % DECK_POST_PERIOD - DECK_POST_PERIOD;
        if (worldY < 0 || worldY > H) continue;
        const scale = proj.scaleAt(worldY);
        const y = proj.screenY(worldY);
        const roadHalfWidth = proj.halfWidthAt(worldY);
        const inner = cx + side * (roadHalfWidth + SHOULDER_WIDTH * scale);
        const towerWidth = (18 + (i % 3) * 7) * scale;
        const towerHeight = (42 + (i % 4) * 16) * scale;
        const towerX = side < 0 ? inner - towerWidth * 2.25 : inner + towerWidth * 1.25;
        const towerY = y - towerHeight * (0.75 + (i % 2) * 0.22);

        // Broken industrial silhouettes: deliberately sparse at the horizon
        // and more pronounced in the foreground, matching the reference's
        // city abyss while leaving traffic silhouette contrast intact.
        g.roundRect(towerX, towerY, towerWidth, towerHeight, Math.max(1, scale * 2))
          .fill({ color: i % 2 === 0 ? 0x07101d : 0x0a1321, alpha: 0.72 });
        if (i % 2 === 0) {
          const windowY = towerY + towerHeight * 0.33;
          g.rect(towerX + towerWidth * 0.28, windowY, towerWidth * 0.16, Math.max(0.8, towerHeight * 0.08))
            .fill({ color: NEON.cyan, alpha: 0.25 * scale });
        }
      }
    }
  }

  // Rails, posts and braces make the road a physical elevated deck. They are
  // decorative-only and render after asphalt so the playable road width remains
  // defined exclusively by the GameEngine.
  private drawDeckStructure(state: GameState, sHorizon: number, sBottom: number, hwTop: number, hwBottom: number) {
    const proj = this.projection;
    const { height: H, horizonY, centerX: cx } = proj;
    const g = this.deckStructureLayer;
    g.clear();

    const shoulderTop = SHOULDER_WIDTH * sHorizon;
    const shoulderBottom = SHOULDER_WIDTH * sBottom;
    for (const side of [-1, 1]) {
      const roadTop = cx + side * hwTop;
      const roadBottom = cx + side * hwBottom;
      const railTop = roadTop + side * shoulderTop;
      const railBottom = roadBottom + side * shoulderBottom;
      const outerTop = railTop + side * Math.max(2, 7 * sHorizon);
      const outerBottom = railBottom + side * Math.max(5, 11 * sBottom);

      // A layered rail silhouette: dark metal core, bright cyan road edge,
      // then a muted outer lip. This retains the reference's neon separation
      // without an expensive glow filter.
      g.moveTo(railTop, horizonY).lineTo(railBottom, H)
        .stroke({ width: Math.max(1.1, 4.5 * sBottom), color: 0x111d30, alpha: 0.98 });
      g.moveTo(roadTop, horizonY).lineTo(roadBottom, H)
        .stroke({ width: Math.max(0.8, 2.3 * sBottom), color: NEON.cyan, alpha: 0.75 });
      g.moveTo(outerTop, horizonY).lineTo(outerBottom, H)
        .stroke({ width: Math.max(0.6, 1.4 * sBottom), color: NEON.magenta, alpha: 0.32 });

      for (let i = 0; i < 10; i++) {
        const worldY = i * DECK_POST_PERIOD + state.roadOffset % DECK_POST_PERIOD - DECK_POST_PERIOD;
        if (worldY < 0 || worldY > H) continue;
        const scale = proj.scaleAt(worldY);
        const y = proj.screenY(worldY);
        const railX = cx + side * (proj.halfWidthAt(worldY) + SHOULDER_WIDTH * scale);
        const postHeight = Math.max(4, 34 * scale);
        const postWidth = Math.max(1, 4.5 * scale);
        const braceOut = side * Math.max(4, 20 * scale);

        // Uprights and one diagonal brace establish scale at a low command
        // count. Their screen-space sizes are depth-scaled, so nearer bridge
        // structure visibly passes the player faster than far structure.
        g.rect(railX - postWidth / 2, y - postHeight, postWidth, postHeight)
          .fill({ color: 0x172742, alpha: 0.96 });
        g.moveTo(railX, y - postHeight * 0.78).lineTo(railX + braceOut, y)
          .stroke({ width: Math.max(0.7, 1.6 * scale), color: 0x27415f, alpha: 0.85 });
        g.circle(railX, y - postHeight * 0.86, Math.max(0.9, 3.4 * scale))
          .fill({ color: NEON.amber, alpha: 0.82 });
      }
    }
  }

  // Depth shading, transverse seams, and lane markings on the road surface.
  private drawRoadShadingAndMarkings(state: GameState, hwTop: number, hwBottom: number) {
    const proj = this.projection;
    const { width: W, height: H, horizonY, centerX: cx } = proj;
    const g = this.roadLayer;

    // Depth shading: the surface darkens and desaturates toward the vanishing
    // point, which is most of what sells distance on a flat-coloured road.
    const shadeBands = 18;
    for (let i = 0; i < shadeBands; i++) {
      const t0 = i / shadeBands;
      const t1 = (i + 1) / shadeBands;
      const y0 = horizonY + (H - horizonY) * t0;
      const y1 = horizonY + (H - horizonY) * t1;
      const hw0 = hwTop + (hwBottom - hwTop) * t0;
      const hw1 = hwTop + (hwBottom - hwTop) * t1;
      // Kept mild deliberately: depth shading that reads nicely in a still
      // frame is exactly what pushed measured road luminance below the
      // readability floor when it was stronger.
      const alpha = 0.3 * (1 - t0) * (1 - t0);
      g.poly([cx - hw0, y0, cx + hw0, y0, cx + hw1, y1, cx - hw1, y1])
        .fill({ color: NEON.midnight, alpha });
    }

    // Transverse asphalt seams. Rendered as depth-spaced bands rather than a
    // tiled texture: at speed these are the strongest motion cue on the
    // surface, and in perspective they compress toward the horizon on their
    // own, which is exactly the "ground rushing past" read the flat tile
    // could never produce.
    const seamPhase = state.roadOffset % ROAD_SEAM_PERIOD;
    for (let k = 0; k < 26; k++) {
      const worldY = k * ROAD_SEAM_PERIOD + seamPhase - ROAD_SEAM_PERIOD;
      if (worldY < 0 || worldY > H) continue;
      const y = proj.screenY(worldY);
      const hw = proj.halfWidthAt(worldY);
      const thickness = Math.max(0.6, 2.2 * proj.scaleAt(worldY));
      g.rect(cx - hw, y, hw * 2, thickness).fill({ color: 0x1c2740, alpha: 0.5 });
    }

    // Lane markings — engine.ts's 4-lane math (`this.width / 4`). Lanes 0-1
    // are oncoming and 2-3 same-direction, so the 1|2 boundary is the
    // direction divide and stays a solid double-amber centre line like a real
    // two-way road. The other two are dashed and now converge on the
    // vanishing point.
    const laneWidth = W / 4;
    const dashPhase = state.roadOffset % LANE_DASH_PERIOD;
    for (const divX of [laneWidth, laneWidth * 3]) {
      for (let k = 0; k < 34; k++) {
        const wy0 = k * LANE_DASH_PERIOD + dashPhase - LANE_DASH_PERIOD;
        const wy1 = wy0 + LANE_DASH_LEN;
        if (wy1 < 0 || wy0 > H) continue;
        const a = proj.project(divX, Math.max(0, wy0));
        const b = proj.project(divX, Math.min(H, wy1));
        g.moveTo(a.x, a.y).lineTo(b.x, b.y)
          .stroke({ width: Math.max(0.7, 2.4 * b.scale), color: NEON.cyan, alpha: 0.3 });
      }
    }
    for (const offset of [-3, 3]) {
      const a = proj.project(centerLineX(W) + offset, 0);
      const b = proj.project(centerLineX(W) + offset, H);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y)
        .stroke({ width: Math.max(0.8, 2.6 * b.scale), color: NEON.amber, alpha: 0.72 });
    }
  }

  // Shoulders + guardrails as converging bands, with a neon edge light so
  // the road boundary stays readable at the horizon.
  private drawShoulders(sHorizon: number, sBottom: number, hwTop: number, hwBottom: number) {
    const proj = this.projection;
    const { horizonY, height: H, centerX: cx } = proj;
    const g = this.roadLayer;
    // Shoulder width shrinks with depth like everything else.
    const shoulderTop = SHOULDER_WIDTH * sHorizon;
    const shoulderBottom = SHOULDER_WIDTH * sBottom;

    for (const side of [-1, 1]) {
      const inTop = cx + side * hwTop;
      const inBot = cx + side * hwBottom;
      const outTop = inTop + side * shoulderTop;
      const outBot = inBot + side * shoulderBottom;
      g.poly([inTop, horizonY, outTop, horizonY, outBot, H, inBot, H])
        .fill({ color: 0x0d1524 });
      g.moveTo(inTop, horizonY).lineTo(inBot, H)
        .stroke({ width: Math.max(0.8, 2.4 * sBottom), color: NEON.cyan, alpha: 0.5 });
      g.moveTo(outTop, horizonY).lineTo(outBot, H)
        .stroke({ width: Math.max(0.6, 1.6 * sBottom), color: NEON.magenta, alpha: 0.22 });
    }
  }

  // Horizon haze — hides the hard trapezoid apex and reads as distance fog.
  private drawHorizonHaze() {
    const proj = this.projection;
    const { width: W, horizonY } = proj;
    const g = this.roadLayer;
    const hazeBands = 10;
    for (let i = 0; i < hazeBands; i++) {
      const f = i / hazeBands;
      g.rect(0, horizonY + f * HORIZON_HAZE_PX, W, HORIZON_HAZE_PX / hazeBands + 1)
        .fill({ color: NEON.roadSheen, alpha: 0.2 * (1 - f) * (1 - f) });
    }
  }

  // Street lamps, depth-placed. Each post also throws a light pool onto the
  // road, which gives the surface periodic bright patches — a second speed cue
  // independent of the lane dashes.
  private drawLamps(state: GameState) {
    const proj = this.projection;
    const g = this.lampLayer;
    g.clear();
    const H = proj.height;
    const phase = state.roadOffset % LAMP_SPAN;
    for (let k = 0; k < 14; k++) {
      const worldY = k * LAMP_SPAN + phase - LAMP_SPAN;
      if (worldY < 0 || worldY > H) continue;
      const lampIndex = Math.floor(worldY / LAMP_SPAN);
      const side = lampIndex % 2 === 0 ? 1 : -1;
      const scale = proj.scaleAt(worldY);
      const baseY = proj.screenY(worldY);
      const edgeX = proj.centerX + side * proj.halfWidthAt(worldY);
      const baseX = edgeX + side * SHOULDER_WIDTH * scale * 0.6;
      const postH = LAMP_HEIGHT * scale;
      const headX = baseX - side * LAMP_WIDTH * scale * 0.55;
      const headY = baseY - postH;

      // Light pool on the tarmac, drawn first so the post sits on top of it.
      g.ellipse(edgeX, baseY, LAMP_WIDTH * scale * 2.6, LAMP_HEIGHT * scale * 0.5)
        .fill({ color: NEON.amber, alpha: 0.09 });
      g.moveTo(baseX, baseY)
        .lineTo(baseX, headY)
        .lineTo(headX, headY)
        .stroke({ width: Math.max(0.8, 3 * scale), color: 0x2a3550, alpha: 0.9 });
      g.circle(headX, headY, Math.max(1.2, 4.5 * scale))
        .fill({ color: NEON.amber, alpha: 0.95 });
      g.circle(headX, headY, Math.max(2.5, 11 * scale))
        .fill({ color: NEON.amber, alpha: 0.16 });
    }
  }

  // Parallax city band. Horizontal offset tracks the player's lateral
  // position (so steering swings the world, not just the car) and creeps with
  // distance travelled; the near layer moves faster than the far one.
  private syncSkyline(state: GameState) {
    const lateral = state.player.x - this.projection.centerX;
    this.skylineFar.tilePosition.x = -state.distance * 0.004 - lateral * 0.06;
    this.skylineNear.tilePosition.x = -state.distance * 0.011 - lateral * 0.16;
  }

  private syncPlayerEffects(state: GameState) {
    if (this.currentCarType !== state.selectedCar) {
      this.playerSprite.texture = this.textures.playerCars[state.selectedCar];
      this.currentCarType = state.selectedCar;
    }
    const player = state.player;
    // Projected like every other entity. Projection.PLAYER_T pins the scale
    // here to exactly 1.0, so the player car and its hitbox render at the
    // same size as before the camera change — only its screen row moves.
    const p = this.projection.project(player.x, player.y);
    this.playerSprite.x = p.x;
    this.playerSprite.y = p.y;
    this.playerSprite.width = player.width * p.scale;
    this.playerSprite.height = player.height * p.scale;
    this.playerSprite.alpha = player.isInvulnerable ? (Math.floor(performance.now() / 100) % 2 === 0 ? 0.4 : 1) : 1;
    this.playerSprite.tint = player.oilSlicked ? 0x99aaff : 0xffffff;
    this.playerSprite.rotation = state.driveTilt * 0.14 + (state.rushTimer > 0 ? state.driveTilt * 0.035 : 0);
    // Ground shadow + cyan underglow. Underglow intensity tracks speed and
    // spikes during RUSH, so the player's own state is readable without
    // looking away from the road at the HUD.
    const glowColor = state.rushTimer > 0 ? NEON.magenta : NEON.cyan;
    const glowStrength = 0.3 + Math.min(0.35, state.speedMultiplier * 0.12) + (state.rushTimer > 0 ? 0.2 : 0);
    const pw = player.width * p.scale;
    const ph = player.height * p.scale;
    this.playerAnchor.clear();
    this.playerAnchor
      .ellipse(p.x, p.y + ph * 0.44, pw * 0.5, ph * 0.12)
      .fill({ color: 0x000000, alpha: 0.45 });
    this.playerAnchor
      .ellipse(p.x, p.y + ph * 0.3, pw * 0.78, ph * 0.42)
      .fill({ color: glowColor, alpha: glowStrength * 0.22 });
    this.playerAnchor
      .ellipse(p.x, p.y + ph * 0.34, pw * 0.55, ph * 0.22)
      .fill({ color: glowColor, alpha: glowStrength * 0.4 });

    this.exhaustSprite.visible = true;
    this.exhaustSprite.x = p.x;
    this.exhaustSprite.y = p.y + ph / 2 + 4;
    this.exhaustSprite.width = pw * 0.5;
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
    const p = this.projection.project(player.x, player.y);
    const radius = Math.max(player.width, player.height) * p.scale * 0.75 * (1 + Math.sin(performance.now() / 150) * 0.06);
    this.shieldRing.x = p.x;
    this.shieldRing.y = p.y;
    this.shieldRing.clear();
    this.shieldRing.circle(0, 0, radius).stroke({ width: 3, color: 0x00ffff, alpha: 0.9 });
  }

  // Places a pooled sprite on the projected ground plane. Size scales with
  // depth, which is the whole point: a car that grows as it closes is the
  // approach cue a flat top-down view cannot give. Hit testing is unaffected
  // — GameEngine still collides in flat world coordinates.
  private placeEntity(sprite: Sprite, worldX: number, worldY: number, w: number, h: number, rotation: number) {
    const proj = this.projection;
    const clamped = proj.clampWorldY(worldY);
    const p = proj.project(worldX, clamped);
    sprite.x = p.x;
    sprite.y = p.y;
    sprite.width = w * p.scale;
    sprite.height = h * p.scale;
    sprite.rotation = rotation;
    sprite.alpha = proj.fadeInAlpha(worldY);
    sprite.visible = sprite.alpha > 0.02;
  }

  private syncEntityPools(state: GameState) {
    this.gen++;
    syncPool(this.vehiclePool, state.vehicles, this.gen, this.vehicleLayer,
      (vehicle) => { const sprite = new Sprite(vehicleTexture(this.textures, vehicle)); sprite.anchor.set(0.5); return sprite; },
      (vehicle, sprite) => this.placeEntity(sprite, vehicle.x, vehicle.y, vehicle.width, vehicle.height, vehicle.direction === 'OPPOSITE' ? Math.PI : 0));
    syncPool(this.obstaclePool, state.obstacles, this.gen, this.obstacleLayer,
      (obstacle) => { const sprite = new Sprite(obstacle.type === 'OIL_SLICK' ? this.textures.oilSlick : this.textures.debris); sprite.anchor.set(0.5); return sprite; },
      (obstacle, sprite) => this.placeEntity(sprite, obstacle.x, obstacle.y, obstacle.width, obstacle.height, 0));
    syncPool(this.powerupPool, state.powerups, this.gen, this.powerupLayer,
      (powerup) => { const sprite = new Sprite(this.textures.powerups[powerup.type]); sprite.anchor.set(0.5); return sprite; },
      (powerup, sprite) => this.placeEntity(sprite, powerup.x, powerup.y, powerup.width, powerup.height, 0));
    const particles = this.quality === 'low' ? state.particles.slice(0, 20) : state.particles;
    syncPool(this.particlePool, particles, this.gen, this.particleLayer,
      () => { const sprite = new Sprite(this.textures.spark); sprite.anchor.set(0.5); sprite.blendMode = 'add'; return sprite; },
      (particle, sprite) => {
        const p = this.projection.project(particle.x, this.projection.clampWorldY(particle.y));
        sprite.tint = particle.color;
        sprite.x = p.x;
        sprite.y = p.y;
        sprite.width = sprite.height = particle.size * p.scale;
        sprite.alpha = Math.max(0, particle.life / particle.maxLife);
      });
  }

  // Stable Graphics layers keep the new world treatment inexpensive: their draw commands update in place.
  private drawNeonRainwayLayers(state: GameState) {
    this.drawRoadSheen(state);
    this.drawVehicleLights(state);
    this.drawWeather(state);
    this.drawFeedback(state);
  }

  // Wet-tarmac sheen, projected. The bands used to be fixed-width rounded
  // rects spanning the viewport and two vertical streaks pinned to the screen
  // edges — both read as stickers on the camera once the road started
  // receding. They now ride the ground plane and narrow with distance.
  private drawRoadSheen(state: GameState) {
    const proj = this.projection;
    const H = proj.height;
    this.roadSheen.clear();
    const speedGlint = 0.02 + Math.min(0.05, state.speedMultiplier * 0.014);
    for (let i = 0; i < 7; i++) {
      const worldY = ((i * 137 + state.roadOffset * 0.42) % (H + 180)) - 90;
      if (worldY < 0 || worldY > H) continue;
      const y = proj.screenY(worldY);
      const scale = proj.scaleAt(worldY);
      const hw = proj.halfWidthAt(worldY) * 0.9;
      this.roadSheen
        .roundRect(proj.centerX - hw, y, hw * 2, Math.max(1.5, 26 * scale), 13 * scale)
        .fill({ color: NEON.roadSheen, alpha: speedGlint + (i % 3) * 0.012 });
    }
  }

  private drawVehicleLights(state: GameState) {
    const proj = this.projection;
    this.vehicleLightLayer.clear();
    for (const vehicle of state.vehicles) {
      if (vehicle.type === 'BOSS') continue;
      const alpha = proj.fadeInAlpha(vehicle.y);
      if (alpha <= 0.02) continue;
      const p = proj.project(vehicle.x, proj.clampWorldY(vehicle.y));
      // Every dimension below is a world-space measurement scaled to this
      // vehicle's depth, so lights shrink into the distance with the car they
      // belong to instead of staying a constant screen size.
      const k = p.scale;
      const w = vehicle.width * k;
      const h = vehicle.height * k;
      const oncoming = vehicle.direction === 'OPPOSITE';
      const color = oncoming ? NEON.headlight : NEON.trafficRed;
      const y = p.y + h * 0.34;
      const spread = Math.max(2, w * 0.24);
      // Direction lights existed before this pass but were drawn at ~5px
      // radius, 0.5 alpha, with a 0.045-alpha beam — on a near-black playfield
      // that is below the threshold of noticing, so oncoming and
      // same-direction traffic read identically in play. Sized and lit to be
      // the primary direction signal.
      const radius = Math.max(1.5, w * 0.17);

      // Silhouette rim. Measured on a real capture, a light-bodied car reads
      // at 6.2:1 against the projected road but a dark olive/maroon one only
      // manages ~1.6:1 on body fill alone — the art itself is that dark, and
      // no amount of layer contrast fixes it without blowing out the light
      // vehicles. A cool halo just outside the sprite gives every vehicle a
      // hard edge against the tarmac regardless of its paint.
      // Soft ellipses, never a rounded rect: a rect halo reads as a card
      // behind each car, which is precisely the "everything is in a box" look
      // this pass exists to remove.
      this.vehicleLightLayer
        .ellipse(p.x, p.y, w * 0.62, h * 0.58)
        .fill({ color: NEON.headlight, alpha: 0.075 * alpha });
      this.vehicleLightLayer
        .ellipse(p.x, p.y, w * 0.52, h * 0.5)
        .fill({ color: NEON.headlight, alpha: 0.075 * alpha });

      // Contact shadow next, so the lamps below stay the brightest pixels.
      // Without it every vehicle floats, which is a large part of why the
      // playfield used to read as a flat box.
      this.vehicleLightLayer
        .ellipse(p.x, p.y + h * 0.46, w * 0.44, h * 0.1)
        .fill({ color: 0x000000, alpha: 0.4 * alpha });

      if (oncoming) {
        // Headlight cone thrown toward the player: the cue arrives before the
        // vehicle does, which is what makes closing speed readable. In
        // perspective the cone also widens as the car nears, so approach is
        // signalled twice over.
        const coneLength = h * 1.15;
        const coneHalf = w * 0.62;
        this.vehicleLightLayer
          .poly([p.x - spread, y, p.x + spread, y, p.x + coneHalf, y + coneLength, p.x - coneHalf, y + coneLength])
          .fill({ color, alpha: 0.16 * alpha });
        this.vehicleLightLayer
          .poly([p.x - spread, y, p.x + spread, y, p.x + coneHalf * 0.55, y + coneLength * 0.55, p.x - coneHalf * 0.55, y + coneLength * 0.55])
          .fill({ color, alpha: 0.2 * alpha });
      } else {
        // Same-direction traffic gets a taillight bar plus a short red wash —
        // a different *shape*, not just a different hue, so the cue survives
        // colour-vision deficiency (ASSETS.md accessibility clause).
        this.vehicleLightLayer
          .roundRect(p.x - w * 0.34, y - radius * 0.5, w * 0.68, radius, radius * 0.5)
          .fill({ color, alpha: 0.5 * alpha });
        this.vehicleLightLayer
          .roundRect(p.x - w * 0.3, y + radius, w * 0.6, h * 0.3, 6 * k)
          .fill({ color, alpha: 0.12 * alpha });
      }

      // Lamp cores last so they stay the brightest part of the cue.
      this.vehicleLightLayer.circle(p.x - spread, y, radius).fill({ color, alpha: 0.95 * alpha });
      this.vehicleLightLayer.circle(p.x + spread, y, radius).fill({ color, alpha: 0.95 * alpha });
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
    const p = this.projection.project(player.x, player.y);
    const progress = state.nearMissPulse / 300;
    const radius = Math.max(player.width, player.height) * p.scale * (0.72 + (1 - progress) * 0.7);
    this.feedbackLayer.circle(p.x, p.y, radius).stroke({ width: 2.5 * progress, color: NEON.magenta, alpha: progress * 0.75 });
  }

  private drawRushFeedback(state: GameState, player: GameState['player']) {
    if (state.rushTimer <= 0) return;
    const p = this.projection.project(player.x, player.y);
    const pw = player.width * p.scale;
    const ph = player.height * p.scale;
    const radius = Math.max(pw, ph) * 1.2 * (0.75 + Math.sin(performance.now() / 70) * 0.18);
    this.feedbackLayer.circle(p.x, p.y + ph * 0.24, radius).fill({ color: NEON.cyan, alpha: 0.10 });
    this.feedbackLayer.circle(p.x, p.y, radius * 0.9).stroke({ width: 2, color: NEON.magenta, alpha: 0.6 });
    for (let i = -2; i <= 2; i++) {
      const x = p.x + i * pw * 0.34;
      this.feedbackLayer.moveTo(x, p.y + ph * 0.42).lineTo(x - state.driveTilt * 12, p.y + ph * (1.2 + Math.abs(i) * 0.14)).stroke({ width: 2.2, color: i % 2 === 0 ? NEON.cyan : NEON.magenta, alpha: 0.55 });
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
      this.textures.skylineFar.destroy(true); // shared with skylineNear
    }
    this.textures.softGlow.destroy(true); // always runtime-generated, never Assets-managed

    this.app.destroy(true, { children: true });
  }
}
