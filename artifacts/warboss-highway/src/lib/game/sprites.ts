import { Assets, Graphics, Rectangle, Texture, type Renderer } from 'pixi.js';
import { CAR_STATS, type CarType, type PowerUpType } from '@workspace/game-core';

// Regular (non-boss) enemy vehicle types that ship 3 hand-drawn variants each
// in the sprite pack (sedan_v1..v3, pickup_v1..v3, ...). BOSS uses a single
// dedicated file instead.
export const ENEMY_VARIANT_TYPES = ['SEDAN', 'PICKUP', 'COP', 'BOXTRUCK', 'BUS', 'SPORTS', 'TANK'] as const;
export type EnemyVariantType = (typeof ENEMY_VARIANT_TYPES)[number];

export interface SpriteTextures {
  playerCars: Record<CarType, Texture>;
  roadTile: Texture;
  // 3 hand-drawn variants per regular enemy type — Vehicle.variant (1-3,
  // assigned at spawn in engine.ts) picks which one renders, so traffic
  // doesn't look like clones of a single silhouette.
  enemyVehicles: Record<EnemyVariantType, [Texture, Texture, Texture]>;
  bossVehicle: Texture;
  oilSlick: Texture;
  debris: Texture;
  guardrail: Texture;
  powerups: Record<PowerUpType, Texture>;
  // Soft-edged circle for particle bursts and the exhaust plume — no
  // dedicated art asset for this, generated at runtime same as before.
  softGlow: Texture;
  // Present only when textures came from loadSpriteTextures (real PNGs,
  // Assets-cache-managed). PixiRenderer.destroy() uses this to tell real
  // sprite-pack textures (left in the Assets cache, reused across restarts)
  // apart from placeholder textures (owned outright, must be destroyed).
  assetUrls?: string[];
}

const PLAYER_CAR_FILES: Record<CarType, string> = {
  RATTLETRAP: 'rattletrap.png',
  WAR_RUNNER: 'war_runner.png',
  DEATHSLED: 'deathsled.png',
  SCRAPQUEEN: 'scrapqueen.png',
  PHANTOM: 'phantom.png',
};

const ENEMY_FILE_PREFIX: Record<EnemyVariantType, string> = {
  SEDAN: 'sedan',
  PICKUP: 'pickup',
  COP: 'cop',
  BOXTRUCK: 'boxtruck',
  BUS: 'bus',
  SPORTS: 'sports',
  TANK: 'tank',
};

const POWERUP_FILES: Record<PowerUpType, string> = {
  SHIELD: 'shield.png',
  SLOWMO: 'slowmo.png',
  SCORE_BLAST: 'score_blast.png',
  EXTRA_LIFE: 'extra_life.png',
};

// Bumped whenever the on-disk sprite set changes shape, so a stale
// service-worker/CDN cache from a prior pack doesn't silently keep serving
// old art under the same URL.
const SPRITE_PACK_VERSION = 'v2';

function assetUrl(base: string, file: string): string {
  return `${base}/${file}?${SPRITE_PACK_VERSION}`;
}

// Loads the real PNG sprite pack (default: the premium v2 set) for the Pixi
// renderer. Replaces the Phase A placeholder (flat-colored runtime-generated
// textures) now that hand-drawn art exists for the full roster — see the
// "Warboss Highway Pixi rewrite" plan's Phase E.
export async function loadSpriteTextures(
  renderer: Renderer,
  base: string = '/sprites-premium'
): Promise<SpriteTextures> {
  const urls: string[] = [
    ...Object.values(PLAYER_CAR_FILES).map((f) => assetUrl(base, f)),
    ...ENEMY_VARIANT_TYPES.flatMap((type) =>
      [1, 2, 3].map((v) => assetUrl(base, `${ENEMY_FILE_PREFIX[type]}_v${v}.png`))
    ),
    assetUrl(base, 'boss.png'),
    assetUrl(base, 'asphalt_tile.png'),
    assetUrl(base, 'oil_slick.png'),
    assetUrl(base, 'debris.png'),
    assetUrl(base, 'guardrail_segment.png'),
    ...Object.values(POWERUP_FILES).map((f) => assetUrl(base, f)),
  ];

  const loaded = await Assets.load<Texture>(urls);
  const get = (file: string) => loaded[assetUrl(base, file)];

  const playerCars = {} as Record<CarType, Texture>;
  (Object.keys(PLAYER_CAR_FILES) as CarType[]).forEach((type) => {
    playerCars[type] = get(PLAYER_CAR_FILES[type]);
  });

  const enemyVehicles = {} as Record<EnemyVariantType, [Texture, Texture, Texture]>;
  ENEMY_VARIANT_TYPES.forEach((type) => {
    const prefix = ENEMY_FILE_PREFIX[type];
    enemyVehicles[type] = [
      get(`${prefix}_v1.png`),
      get(`${prefix}_v2.png`),
      get(`${prefix}_v3.png`),
    ];
  });

  const powerups = {} as Record<PowerUpType, Texture>;
  (Object.keys(POWERUP_FILES) as PowerUpType[]).forEach((type) => {
    powerups[type] = get(POWERUP_FILES[type]);
  });

  const glowG = new Graphics();
  glowG.circle(0, 0, 16).fill(0xffffff);
  const softGlow = renderer.generateTexture(glowG);
  glowG.destroy();

  // The source tile is vignetted (lighter center, darker toward its own
  // edges) rather than seamlessly tileable — repeating it as-is via
  // TilingSprite makes every tile boundary visible as a grid. Cropping to
  // its center avoids the vignette so the repeat reads as continuous
  // asphalt instead of a checkerboard.
  const rawRoadTile = get('asphalt_tile.png');
  const inset = rawRoadTile.width * 0.22;
  const roadTile = new Texture({
    source: rawRoadTile.source,
    frame: new Rectangle(
      rawRoadTile.frame.x + inset,
      rawRoadTile.frame.y + inset,
      rawRoadTile.width - inset * 2,
      rawRoadTile.height - inset * 2
    ),
  });

  return {
    playerCars,
    roadTile,
    enemyVehicles,
    bossVehicle: get('boss.png'),
    oilSlick: get('oil_slick.png'),
    debris: get('debris.png'),
    guardrail: get('guardrail_segment.png'),
    powerups,
    softGlow,
    assetUrls: urls,
  };
}

// Phase A placeholder art, kept only as an offline/dev fallback (e.g. sprite
// pack fails to load) so the Pixi pipeline still renders something instead
// of crashing on missing textures.
export function generatePlaceholderTextures(renderer: Renderer): SpriteTextures {
  const playerCars = {} as Record<CarType, Texture>;

  (Object.keys(CAR_STATS) as CarType[]).forEach((type) => {
    const car = CAR_STATS[type];
    const g = new Graphics();
    g.roundRect(-car.width / 2, -car.height / 2, car.width, car.height, 6).fill(car.color);
    g.roundRect(-car.width / 2 + 4, -car.height / 2 + 10, car.width - 8, car.height * 0.35, 3).fill(0x1a1a1a);
    playerCars[type] = renderer.generateTexture(g);
    g.destroy();
  });

  const roadG = new Graphics();
  roadG.rect(0, 0, 80, 80).fill(0x23252e);
  roadG.rect(0, 0, 80, 4).fill(0x2c2f3c);
  const roadTile = renderer.generateTexture(roadG);
  roadG.destroy();

  // 1x1 white square, tinted + scaled per-instance to the vehicle's own
  // width/height (Sprite.tint + Sprite.width/height need no texture detail).
  const enemyG = new Graphics();
  enemyG.rect(-0.5, -0.5, 1, 1).fill(0xffffff);
  const enemySolid = renderer.generateTexture(enemyG);
  enemyG.destroy();

  const enemyVehicles = {} as Record<EnemyVariantType, [Texture, Texture, Texture]>;
  ENEMY_VARIANT_TYPES.forEach((type) => {
    enemyVehicles[type] = [enemySolid, enemySolid, enemySolid];
  });

  const oilG = new Graphics();
  oilG.ellipse(0, 0, 20, 12).fill({ color: 0x6414c8, alpha: 0.75 });
  const oilSlick = renderer.generateTexture(oilG);
  oilG.destroy();

  const debrisG = new Graphics();
  debrisG.rect(-15, -12, 30, 24).fill(0x4a3a2a);
  const debris = renderer.generateTexture(debrisG);
  debrisG.destroy();

  const powerupColors: Record<PowerUpType, number> = {
    SHIELD: 0x00ffff,
    SLOWMO: 0xffff00,
    SCORE_BLAST: 0xffaa00,
    EXTRA_LIFE: 0xff4477,
  };
  const powerups = {} as Record<PowerUpType, Texture>;
  (Object.keys(powerupColors) as PowerUpType[]).forEach((type) => {
    const g = new Graphics();
    g.circle(0, 0, 15).fill(powerupColors[type]);
    powerups[type] = renderer.generateTexture(g);
    g.destroy();
  });

  const guardrailG = new Graphics();
  guardrailG.rect(0, 0, 20, 80).fill(0xdcb400);
  guardrailG.rect(0, 0, 20, 20).fill(0x1a1a1a);
  guardrailG.rect(0, 40, 20, 20).fill(0x1a1a1a);
  const guardrail = renderer.generateTexture(guardrailG);
  guardrailG.destroy();

  const glowG = new Graphics();
  glowG.circle(0, 0, 16).fill(0xffffff);
  const softGlow = renderer.generateTexture(glowG);
  glowG.destroy();

  return { playerCars, roadTile, enemyVehicles, bossVehicle: enemySolid, oilSlick, debris, guardrail, powerups, softGlow };
}
