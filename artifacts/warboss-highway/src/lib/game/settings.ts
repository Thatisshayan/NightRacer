import { CarType } from './engine';

const STORAGE_PREFIX = 'warboss_';

function getKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function getItem(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(getKey(key));
  } catch {
    // storage can throw in private-browsing/sandboxed/embedded contexts
    return null;
  }
}

function setItem(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getKey(key), value);
  } catch {
    // best-effort persistence; in-memory state remains the source of truth
  }
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
    if (value === 'RATTLETRAP' || value === 'WAR_RUNNER' || value === 'DEATHSLED') {
      return value;
    }
    return 'WAR_RUNNER';
  },
  setSelectedCar(car: CarType): void {
    setItem('selected_car', car);
  },

  getJoystickEnabled(): boolean {
    return getItem('joystick_enabled') === 'true';
  },
  setJoystickEnabled(enabled: boolean): void {
    setItem('joystick_enabled', String(enabled));
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
  addScrap(amount: number): void {
    this.setScrap(this.getScrap() + amount);
  },
};
