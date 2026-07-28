import { describe, expect, it } from 'vitest';
import { getDailyModifier } from './daily';

describe('getDailyModifier', () => {
  it('is deterministic for the same calendar date', () => {
    const date = new Date('2026-03-15T08:00:00Z');
    const a = getDailyModifier(date);
    const b = getDailyModifier(new Date('2026-03-15T22:00:00Z')); // same UTC day, different time
    expect(a.name).toBe(b.name);
  });

  it('changes across different calendar days', () => {
    const day1 = getDailyModifier(new Date('2026-03-15T12:00:00Z'));
    const day2 = getDailyModifier(new Date('2026-03-16T12:00:00Z'));
    expect(day1.name).not.toBe(day2.name);
    // Not guaranteed to differ every single day (7 modifiers cycling), but
    // over a full week every day must map to some modifier and the whole
    // cycle must be represented — a stronger, still-deterministic check.
    const seen = new Set<string>();
    for (let d = 0; d < 14; d++) {
      const date = new Date(Date.UTC(2026, 0, 1 + d));
      seen.add(getDailyModifier(date).name);
    }
    expect(seen.size).toBeGreaterThanOrEqual(7);
  });

  it('always returns positive multipliers (never a modifier that zeroes out the run)', () => {
    for (let d = 0; d < 30; d++) {
      const modifier = getDailyModifier(new Date(Date.UTC(2026, 0, 1 + d)));
      expect(modifier.speedMult).toBeGreaterThan(0);
      expect(modifier.spawnMult).toBeGreaterThan(0);
      expect(modifier.scoreMult).toBeGreaterThan(0);
      expect(modifier.obstacleMult).toBeGreaterThan(0);
    }
  });
});
