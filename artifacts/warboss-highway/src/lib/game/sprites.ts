import { Graphics, type Renderer, type Texture } from 'pixi.js';
import { CAR_STATS, type CarType, type PowerUpType } from './engine';

export interface SpriteTextures {
  playerCars: Record<CarType, Texture>;
  roadTile: Texture;
  // Enemy vehicles (incl. BOSS) share one neutral silhouette, tinted per
  // instance from the vehicle's own `color` field and scaled to its own
  // width/height — real art gives each type its own baked sprite instead.
  enemyVehicle: Texture;
  oilSlick: Texture;
  debris: Texture;
  powerups: Record<PowerUpType, Texture>;
  // Soft-edged circle for particle bursts and the exhaust plume — tinted
  // per-instance, same "shared neutral texture" approach as enemyVehicle.
  softGlow: Texture;
}

const POWERUP_COLORS: Record<PowerUpType, number> = {
  SHIELD: 0x00ffff,
  SLOWMO: 0xffff00,
  SCORE_BLAST: 0xffaa00,
  EXTRA_LIFE: 0xff4477,
};

// Phase A placeholder art: generates flat-colored car/road textures at
// runtime from CAR_STATS so the Pixi pipeline is provable end-to-end before
// any AI-generated sprite art exists. A later phase swaps this module's
// internals for `PIXI.Assets.loadBundle` against public/sprites/**, without
// changing the `SpriteTextures` shape consumed by pixi-renderer.ts.
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
  const enemyVehicle = renderer.generateTexture(enemyG);
  enemyG.destroy();

  const oilG = new Graphics();
  oilG.ellipse(0, 0, 20, 12).fill({ color: 0x6414c8, alpha: 0.75 });
  const oilSlick = renderer.generateTexture(oilG);
  oilG.destroy();

  const debrisG = new Graphics();
  debrisG.rect(-15, -12, 30, 24).fill(0x4a3a2a);
  const debris = renderer.generateTexture(debrisG);
  debrisG.destroy();

  const powerups = {} as Record<PowerUpType, Texture>;
  (Object.keys(POWERUP_COLORS) as PowerUpType[]).forEach((type) => {
    const g = new Graphics();
    g.circle(0, 0, 15).fill(POWERUP_COLORS[type]);
    powerups[type] = renderer.generateTexture(g);
    g.destroy();
  });

  const glowG = new Graphics();
  glowG.circle(0, 0, 16).fill(0xffffff);
  const softGlow = renderer.generateTexture(glowG);
  glowG.destroy();

  return { playerCars, roadTile, enemyVehicle, oilSlick, debris, powerups, softGlow };
}
