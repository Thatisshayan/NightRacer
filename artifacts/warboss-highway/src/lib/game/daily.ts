export interface DailyModifier {
  name: string;
  description: string;
  speedMult: number;
  spawnMult: number;
  scoreMult: number;
  obstacleMult: number;
  scrapBonus: number;
}

const MODIFIERS: DailyModifier[] = [
  {
    name: 'TURBO TUESDAY',
    description: 'Top speed +25%, but traffic is thicker.',
    speedMult: 1.25,
    spawnMult: 1.35,
    scoreMult: 1.0,
    obstacleMult: 1.0,
    scrapBonus: 0.1,
  },
  {
    name: 'SCORE RUSH',
    description: 'Double points, but power-ups are rarer.',
    speedMult: 1.0,
    spawnMult: 1.0,
    scoreMult: 2.0,
    obstacleMult: 1.0,
    scrapBonus: 0.2,
  },
  {
    name: 'SLIPPERY SUNDAY',
    description: 'Oil slicks spawn far more often.',
    speedMult: 1.0,
    spawnMult: 1.0,
    scoreMult: 1.0,
    obstacleMult: 2.0,
    scrapBonus: 0.15,
  },
  {
    name: 'WARZONE',
    description: 'Everything is harder. +50% score bonus.',
    speedMult: 1.15,
    spawnMult: 1.5,
    scoreMult: 1.5,
    obstacleMult: 1.5,
    scrapBonus: 0.3,
  },
  {
    name: 'IRON RUN',
    description: 'Slower speed, but extra scrap reward.',
    speedMult: 0.85,
    spawnMult: 1.0,
    scoreMult: 1.0,
    obstacleMult: 1.0,
    scrapBonus: 0.5,
  },
  {
    name: 'RANDOM RUMBLE',
    description: 'All the chaos. Slower speed, more traffic.',
    speedMult: 0.9,
    spawnMult: 1.25,
    scoreMult: 1.25,
    obstacleMult: 1.25,
    scrapBonus: 0.25,
  },
  {
    name: 'NIGHT RAID',
    description: 'Faster traffic, bigger score.',
    speedMult: 1.2,
    spawnMult: 1.2,
    scoreMult: 1.35,
    obstacleMult: 1.0,
    scrapBonus: 0.2,
  },
];

function dayIndex(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return Math.floor(d.getTime() / 86400000);
}

export function getDailyModifier(date = new Date()): DailyModifier {
  return MODIFIERS[dayIndex(date) % MODIFIERS.length];
}

export function getDailyModifierFor(date = new Date()): DailyModifier {
  return getDailyModifier(date);
}
