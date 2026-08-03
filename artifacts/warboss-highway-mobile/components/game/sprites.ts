import { useMemo } from 'react';
import { AlphaType, ColorType, Skia, useImage, type SkImage } from '@shopify/react-native-skia';
import type { CarType, PowerUpType } from '@workspace/game-core';

// The road tile source PNG is vignetted (lighter center, darker toward
// its own edges) rather than seamlessly tileable — repeating it as-is
// makes every tile boundary visible as a grid, exactly like the bug the
// web renderer hit and fixed (see sprites.ts on web: crops to the
// texture's center before tiling). react-native-skia's <Image> has no
// source-rect crop prop (unlike Pixi's Texture(source, frame)), so the
// crop is done manually: read the center region's raw pixels back out
// and build a new, smaller SkImage from just those pixels.
function cropCenterSquare(image: SkImage, insetFraction: number): SkImage | null {
  const w = image.width();
  const h = image.height();
  const inset = Math.round(Math.min(w, h) * insetFraction);
  const cropWidth = w - inset * 2;
  const cropHeight = h - inset * 2;
  if (cropWidth <= 0 || cropHeight <= 0) return image;

  const info = { width: cropWidth, height: cropHeight, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  const pixels = image.readPixels(inset, inset, info);
  if (!pixels || !(pixels instanceof Uint8Array)) return image;

  const data = Skia.Data.fromBytes(pixels);
  return Skia.Image.MakeImage(info, data, cropWidth * 4) ?? image;
}

// Memoizes the crop against the source image identity so it only runs
// once per load, not once per frame — GameCanvas re-renders every tick.
function useCroppedRoadTile(rawRoadTile: SkImage | null): SkImage | null {
  return useMemo(() => (rawRoadTile ? cropCenterSquare(rawRoadTile, 0.22) : null), [rawRoadTile]);
}

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
  guardrail: SkImage | null;
  lampPost: SkImage | null;
  spark: SkImage | null;
  smoke: SkImage | null;
  explosion: SkImage | null;
  powerups: Record<PowerUpType, SkImage | null>;
}

// Standalone (doesn't pull in the full enemy/powerup sprite set) — used by
// the title screen's car-select carousel, which only ever needs these 5.
export function usePlayerCarImages(): Record<CarType, SkImage | null> {
  return {
    RATTLETRAP: useImage(require('../../assets/sprites/rattletrap.png')),
    WAR_RUNNER: useImage(require('../../assets/sprites/war_runner.png')),
    DEATHSLED: useImage(require('../../assets/sprites/deathsled.png')),
    SCRAPQUEEN: useImage(require('../../assets/sprites/scrapqueen.png')),
    PHANTOM: useImage(require('../../assets/sprites/phantom.png')),
  };
}

// Same premium v2 sprite pack as the web app (copied into
// assets/sprites/ — see the "native mobile rebuild" plan's Phase 2).
export function useSpriteImages(): SpriteImages {
  const playerCars = usePlayerCarImages();

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

  const rawRoadTile = useImage(require('../../assets/sprites/asphalt_tile.png'));
  const roadTile = useCroppedRoadTile(rawRoadTile);

  return {
    playerCars,
    roadTile,
    enemyVehicles,
    bossVehicle: useImage(require('../../assets/sprites/boss.png')),
    oilSlick: useImage(require('../../assets/sprites/oil_slick.png')),
    debris: useImage(require('../../assets/sprites/debris.png')),
    guardrail: useImage(require('../../assets/sprites/guardrail_segment.png')),
    lampPost: useImage(require('../../assets/sprites/lamp_post.png')),
    spark: useImage(require('../../assets/sprites/spark.png')),
    smoke: useImage(require('../../assets/sprites/smoke.png')),
    explosion: useImage(require('../../assets/sprites/explosion.png')),
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
