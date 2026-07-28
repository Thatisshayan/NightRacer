import { useImage, type SkImage } from '@shopify/react-native-skia';
import type { CarType, PowerUpType } from '@workspace/game-core';

// Mirrors the web package's ENEMY_VARIANT_TYPES (see
// artifacts/warboss-highway/src/lib/game/sprites.ts) — kept in sync by
// hand since Metro's `require()` needs static, literal paths per asset
// (no runtime-built filename strings like the web version's fetch URLs).
export const ENEMY_VARIANT_TYPES = ['SEDAN', 'PICKUP', 'COP', 'BOXTRUCK', 'BUS', 'SPORTS', 'TANK'] as const;
export type EnemyVariantType = (typeof ENEMY_VARIANT_TYPES)[number];

export interface SpriteImages {
  playerCars: Record<CarType, SkImage | null>;
  roadTile: SkImage | null;
  enemyVehicles: Record<EnemyVariantType, [SkImage | null, SkImage | null, SkImage | null]>;
  bossVehicle: SkImage | null;
  oilSlick: SkImage | null;
  debris: SkImage | null;
  powerups: Record<PowerUpType, SkImage | null>;
}

// Same premium v2 sprite pack as the web app (copied into
// assets/sprites/ — see the "native mobile rebuild" plan's Phase 2).
export function useSpriteImages(): SpriteImages {
  const playerCars: Record<CarType, SkImage | null> = {
    RATTLETRAP: useImage(require('../../assets/sprites/rattletrap.png')),
    WAR_RUNNER: useImage(require('../../assets/sprites/war_runner.png')),
    DEATHSLED: useImage(require('../../assets/sprites/deathsled.png')),
    SCRAPQUEEN: useImage(require('../../assets/sprites/scrapqueen.png')),
    PHANTOM: useImage(require('../../assets/sprites/phantom.png')),
  };

  const enemyVehicles: Record<EnemyVariantType, [SkImage | null, SkImage | null, SkImage | null]> = {
    SEDAN: [
      useImage(require('../../assets/sprites/sedan_v1.png')),
      useImage(require('../../assets/sprites/sedan_v2.png')),
      useImage(require('../../assets/sprites/sedan_v3.png')),
    ],
    PICKUP: [
      useImage(require('../../assets/sprites/pickup_v1.png')),
      useImage(require('../../assets/sprites/pickup_v2.png')),
      useImage(require('../../assets/sprites/pickup_v3.png')),
    ],
    COP: [
      useImage(require('../../assets/sprites/cop_v1.png')),
      useImage(require('../../assets/sprites/cop_v2.png')),
      useImage(require('../../assets/sprites/cop_v3.png')),
    ],
    BOXTRUCK: [
      useImage(require('../../assets/sprites/boxtruck_v1.png')),
      useImage(require('../../assets/sprites/boxtruck_v2.png')),
      useImage(require('../../assets/sprites/boxtruck_v3.png')),
    ],
    BUS: [
      useImage(require('../../assets/sprites/bus_v1.png')),
      useImage(require('../../assets/sprites/bus_v2.png')),
      useImage(require('../../assets/sprites/bus_v3.png')),
    ],
    SPORTS: [
      useImage(require('../../assets/sprites/sports_v1.png')),
      useImage(require('../../assets/sprites/sports_v2.png')),
      useImage(require('../../assets/sprites/sports_v3.png')),
    ],
    TANK: [
      useImage(require('../../assets/sprites/tank_v1.png')),
      useImage(require('../../assets/sprites/tank_v2.png')),
      useImage(require('../../assets/sprites/tank_v3.png')),
    ],
  };

  const powerups: Record<PowerUpType, SkImage | null> = {
    SHIELD: useImage(require('../../assets/sprites/shield.png')),
    SLOWMO: useImage(require('../../assets/sprites/slowmo.png')),
    SCORE_BLAST: useImage(require('../../assets/sprites/score_blast.png')),
    EXTRA_LIFE: useImage(require('../../assets/sprites/extra_life.png')),
  };

  return {
    playerCars,
    roadTile: useImage(require('../../assets/sprites/asphalt_tile.png')),
    enemyVehicles,
    bossVehicle: useImage(require('../../assets/sprites/boss.png')),
    oilSlick: useImage(require('../../assets/sprites/oil_slick.png')),
    debris: useImage(require('../../assets/sprites/debris.png')),
    powerups,
  };
}

export function vehicleImage(
  images: SpriteImages,
  type: string,
  variant: number
): SkImage | null {
  if (type === 'BOSS') return images.bossVehicle;
  const variants = images.enemyVehicles[type as EnemyVariantType];
  if (!variants) return null;
  const idx = Math.min(3, Math.max(1, variant || 1)) - 1;
  return variants[idx];
}
