import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, getAchievementById } from './achievements';

describe('getAchievementById', () => {
  it('finds every achievement declared in ACHIEVEMENTS by id', () => {
    for (const achievement of ACHIEVEMENTS) {
      expect(getAchievementById(achievement.id)).toEqual(achievement);
    }
  });

  it('returns undefined for an unknown id instead of throwing', () => {
    expect(getAchievementById('not_a_real_achievement')).toBeUndefined();
  });

  it('has no duplicate ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
