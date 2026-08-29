import AsyncStorage from '@react-native-async-storage/async-storage';
import { CAR_STATS, type CarType } from '@workspace/game-core';

// Native counterpart to the web app's localStorage-backed Settings (see
// artifacts/warboss-highway/src/lib/game/settings.ts) — same key names
// and get/set API shape, so Phase 6's screens (car select, garage/
// upgrades) can be ported with the same call sites. AsyncStorage is
// inherently async where localStorage is sync, so reads here are served
// from an in-memory cache instead of hitting storage each call; the
// cache is hydrated once at app boot (hydrateSettings(), awaited in
// app/_layout.tsx before any screen mounts) and only writes go async to
// AsyncStorage underneath.
//
// Deliberately not ported: joystickEnabled (native input is always
// drag-to-steer — see GameCanvas.tsx's GestureDetector, there's no
// virtual on-screen joystick concept to toggle) and graphicsQuality
// (gates Pixi-specific GPU filters on web; not applicable to the Skia
// renderer the same way).

const STORAGE_PREFIX = 'warboss_';
const getKey = (key: string) => `${STORAGE_PREFIX}${key}`;

const cache = new Map<string, string>();

const CAR_TYPES = Object.keys(CAR_STATS) as CarType[];
const FIXED_KEYS = ['muted', 'selected_car', 'daily_challenge', 'tutorial_seen', 'scrap', 'streak', 'last_play', 'native_3d_renderer'];
const ALL_KEYS = [
  ...FIXED_KEYS,
  ...CAR_TYPES.map((car) => `upgrades_${car}`),
  ...CAR_TYPES.map((car) => `pb_${car}`),
].map(getKey);

let hydratePromise: Promise<void> | null = null;

export function hydrateSettings(): Promise<void> {
  if (!hydratePromise) {
    hydratePromise = AsyncStorage.multiGet(ALL_KEYS)
      .then((pairs) => {
        for (const [key, value] of pairs) {
          if (value !== null) cache.set(key, value);
        }
      })
      .catch(() => {
        // best-effort — an empty cache just means defaults everywhere,
        // same fallback behavior as a fresh install
      });
  }
  return hydratePromise;
}

function getItem(key: string): string | null {
  return cache.get(getKey(key)) ?? null;
}

function setItem(key: string, value: string): void {
  const k = getKey(key);
  cache.set(k, value);
  AsyncStorage.setItem(k, value).catch(() => {
    // best-effort persistence; in-memory cache remains the source of truth
  });
}

export const Settings = {
  getMuted(): boolean {
    return getItem('muted') === 'true';
  },
  setMuted(muted: boolean): void {
    setItem('muted', String(muted));
  },

  getSelectedCar(): CarType {
    const value = getItem('selected_car') as CarType | null;
    return value && value in CAR_STATS ? value : 'WAR_RUNNER';
  },
  setSelectedCar(car: CarType): void {
    setItem('selected_car', car);
  },

  getDailyChallenge(): boolean {
    return getItem('daily_challenge') === 'true';
  },
  setDailyChallenge(enabled: boolean): void {
    setItem('daily_challenge', String(enabled));
  },

  getTutorialSeen(): boolean {
    return getItem('tutorial_seen') === 'true';
  },
  setTutorialSeen(seen: boolean): void {
    setItem('tutorial_seen', String(seen));
  },

  // Persisted, runtime toggle for the opt-in native 3D renderer (see
  // components/game3d/) — reachable via a hidden long-press on the title
  // screen (see TitleScreen.tsx), not a build-time env var. __DEV__ is
  // always false in a Release/TestFlight archive, so a build-time-only
  // gate is unreachable outside a local dev build; this is what actually
  // lets it be inspected on a real TestFlight install.
  getNative3DRenderer(): boolean {
    return getItem('native_3d_renderer') === 'true';
  },
  setNative3DRenderer(enabled: boolean): void {
    setItem('native_3d_renderer', String(enabled));
  },

  getUpgrades(car: CarType): { speed: number; armor: number; handling: number } {
    const raw = getItem(`upgrades_${car}`);
    if (!raw) return { speed: 0, armor: 0, handling: 0 };
    try {
      const parsed = JSON.parse(raw);
      return {
        speed: Math.min(5, Math.max(0, Number(parsed.speed) || 0)),
        armor: Math.min(5, Math.max(0, Number(parsed.armor) || 0)),
        handling: Math.min(5, Math.max(0, Number(parsed.handling) || 0)),
      };
    } catch {
      return { speed: 0, armor: 0, handling: 0 };
    }
  },
  setUpgrades(car: CarType, upgrades: { speed: number; armor: number; handling: number }): void {
    setItem(`upgrades_${car}`, JSON.stringify(upgrades));
  },

  getScrap(): number {
    return Math.max(0, Number(getItem('scrap')) || 0);
  },
  setScrap(scrap: number): void {
    setItem('scrap', String(Math.max(0, scrap)));
  },
  getPersonalBest(car: CarType): number {
    return Math.max(0, Number(getItem(`pb_${car}`)) || 0);
  },
  // Returns true if `score` beat the stored best (and persists it).
  updatePersonalBest(car: CarType, score: number): boolean {
    const prev = this.getPersonalBest(car);
    if (score > prev) {
      setItem(`pb_${car}`, String(Math.floor(score)));
      return true;
    }
    return false;
  },

  addScrap(amount: number): void {
    this.setScrap(this.getScrap() + amount);
  },

  // Ports the web app's getStreak() (Game.tsx) — call once per title-
  // screen visit. Consecutive-day play extends the streak; a skipped day
  // resets it to 1; playing again the same day returns the existing count
  // unchanged. Unlike the web version (which shows a "BONUS APPLIED"
  // banner but never actually applies one anywhere in the codebase — a
  // pre-existing bug there), the mobile scrap-earned calculation in
  // app/(tabs)/index.tsx actually multiplies by this bonus.
  getStreak(): { count: number; isNew: boolean } {
    const today = new Date().toDateString();
    const last = getItem('last_play');
    const count = Math.max(0, parseInt(getItem('streak') || '0', 10) || 0);

    if (last === today) return { count, isNew: false };

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const newCount = last === yesterday.toDateString() ? count + 1 : 1;

    setItem('streak', String(newCount));
    setItem('last_play', today);
    return { count: newCount, isNew: true };
  },
};
