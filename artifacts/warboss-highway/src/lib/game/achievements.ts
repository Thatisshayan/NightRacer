export interface Achievement {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'road_warrior',
    label: 'ROAD WARRIOR',
    description: 'Survive 60 seconds',
    icon: '🛣️',
  },
  {
    id: 'untouchable',
    label: 'UNTOUCHABLE',
    description: 'Finish a run without getting hit',
    icon: '👻',
  },
  {
    id: 'combo_king',
    label: 'COMBO KING',
    description: 'Reach a 10× near-miss combo',
    icon: '⚡',
  },
  {
    id: 'powerup_addict',
    label: 'BURN IT ALL',
    description: 'Use 5 power-ups in one run',
    icon: '🔥',
  },
  {
    id: 'tank_slayer',
    label: 'TANK SLAYER',
    description: 'Dodge 3 tanks in one run',
    icon: '🎯',
  },
  {
    id: 'speed_demon',
    label: 'SPEED DAEMON',
    description: 'Reach maximum speed (3×)',
    icon: '💀',
  },
  {
    id: 'survivor',
    label: 'SURVIVOR',
    description: 'End a run with 3+ lives remaining',
    icon: '❤️',
  },
  {
    id: 'warboss',
    label: 'WARBOSS',
    description: 'Score over 10,000 points',
    icon: '🏆',
  },
];

export const getAchievementById = (id: string): Achievement | undefined =>
  ACHIEVEMENTS.find((a) => a.id === id);
