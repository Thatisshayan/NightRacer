import { beforeEach, describe, expect, it } from 'vitest';
import { GameEngine, CAR_STATS, type GameState, type CarType } from './engine';

// game-core has zero DOM dependency by design (see engine.ts's header
// comment and global.d.ts) — these tests run in a plain Node environment,
// no jsdom, no browser shims, just the two ambient globals the engine
// actually needs (requestAnimationFrame, performance.now), faked here
// with a manually-advanceable clock so tests are deterministic instead of
// racing real timers.
let currentTime = 0;
let rafCallback: ((t: number) => void) | null = null;

beforeEach(() => {
  currentTime = 0;
  rafCallback = null;
  (globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame = ((
    cb: (t: number) => void
  ) => {
    rafCallback = cb;
    return 1;
  }) as typeof requestAnimationFrame;
  (globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame = (() => {
    rafCallback = null;
  }) as typeof cancelAnimationFrame;
  (globalThis as unknown as { performance: typeof performance }).performance = {
    now: () => currentTime,
  } as typeof performance;
});

function step(dtMs: number) {
  currentTime += dtMs;
  const cb = rafCallback;
  if (!cb) throw new Error('engine loop is not running — call engine.start() first');
  cb(currentTime);
}

function makeEngine(onGameOver: (state: GameState) => void = () => {}, selectedCar?: CarType) {
  const engine = new GameEngine({ width: 420, height: 800 }, onGameOver, { selectedCar });
  engine.start();
  return engine;
}

describe('GameEngine construction', () => {
  it('lays out 4 lane centers evenly across the play-field width', () => {
    const engine = makeEngine();
    const { lanes } = engine.getState();
    expect(lanes).toHaveLength(4);
    expect(lanes[0]).toBeCloseTo(420 / 8);
    expect(lanes[1]).toBeCloseTo((420 * 3) / 8);
    expect(lanes[2]).toBeCloseTo((420 * 5) / 8);
    expect(lanes[3]).toBeCloseTo((420 * 7) / 8);
  });

  it('starts the player centered in lane 2 (the near same-direction lane)', () => {
    const engine = makeEngine();
    const state = engine.getState();
    expect(state.player.x).toBeCloseTo(state.lanes[2]);
  });

  it('sizes the player to the selected car\'s stats', () => {
    const engine = makeEngine(() => {}, 'PHANTOM');
    const state = engine.getState();
    expect(state.player.width).toBe(CAR_STATS.PHANTOM.width);
    expect(state.player.height).toBe(CAR_STATS.PHANTOM.height);
  });
});

describe('GameEngine simulation over time', () => {
  it('advances distance and score as frames tick', () => {
    const engine = makeEngine();
    for (let i = 0; i < 60; i++) step(16);
    const state = engine.getState();
    expect(state.distance).toBeGreaterThan(0);
    expect(state.score).toBeGreaterThan(0);
  });

  it('spawns traffic within a bounded time window — not instantly, not never', () => {
    const engine = makeEngine();
    let framesUntilFirstVehicle = -1;
    for (let i = 0; i < 300; i++) {
      step(16);
      if (engine.getState().vehicles.length > 0) {
        framesUntilFirstVehicle = i;
        break;
      }
    }
    expect(framesUntilFirstVehicle).toBeGreaterThan(-1);
  });

  // Regression test for "enemy cars sometimes merge into each other" — the
  // spawn-safety check (isAreaClear/findSafeSpawnX) and the same-lane
  // trailing-gap correction pass in update() should mean no two vehicles
  // ever occupy overlapping space at the same time.
  it('never has two vehicles overlapping in both x and y at once', () => {
    const engine = makeEngine();
    for (let i = 0; i < 1500; i++) {
      step(16);
      const vehicles = engine.getState().vehicles;
      for (let a = 0; a < vehicles.length; a++) {
        for (let b = a + 1; b < vehicles.length; b++) {
          const v1 = vehicles[a];
          const v2 = vehicles[b];
          const xOverlap = Math.abs(v1.x - v2.x) < (v1.width + v2.width) / 2;
          const yOverlap = Math.abs(v1.y - v2.y) < (v1.height + v2.height) / 2;
          if (xOverlap && yOverlap) {
            throw new Error(
              `vehicles overlapping at frame ${i}: ` +
                `${v1.type}@(${v1.x.toFixed(1)},${v1.y.toFixed(1)}) vs ${v2.type}@(${v2.x.toFixed(1)},${v2.y.toFixed(1)})`
            );
          }
        }
      }
    }
  });

  // Regression test for "traffic only ever spawns in the middle of each
  // lane" — spawn jitter (findSafeSpawnX) should place at least some
  // vehicles meaningfully off the exact lane center.
  it('spawns traffic across the full lane width, not just dead-center', () => {
    const engine = makeEngine();
    const state = engine.getState();
    const laneWidth = 420 / 4;
    const spawnXs: number[] = [];

    for (let i = 0; i < 4000; i++) {
      step(16);
      for (const v of engine.getState().vehicles) {
        if (v.y <= -80) spawnXs.push(v.x); // still near its spawn point
      }
    }

    expect(spawnXs.length).toBeGreaterThan(0);
    const offCenter = spawnXs.some((x) => {
      const nearestLane = state.lanes.reduce((closest, lane) => (Math.abs(lane - x) < Math.abs(closest - x) ? lane : closest));
      return Math.abs(x - nearestLane) > laneWidth * 0.15;
    });
    expect(offCenter).toBe(true);
  });

  // Regression test for "an idle car parked on a lane boundary never
  // crashes" — with spawn jitter in place, traffic should eventually
  // cross wherever the player happens to be sitting, including exactly
  // on a lane boundary.
  it('crashes a stationary player parked on a lane boundary once traffic reaches it', () => {
    let gameOverState: GameState | null = null;
    const engine = makeEngine((s) => {
      gameOverState = s;
    });
    const state = engine.getState();
    const boundaryX = (state.lanes[0] + state.lanes[1]) / 2; // between lanes 0 and 1

    engine.pointerDown(state.player.x, state.player.y);
    engine.pointerMove(boundaryX, state.player.y);

    for (let i = 0; i < 5000 && !gameOverState; i++) step(16);

    expect(gameOverState).not.toBeNull();
  });

  it('crashes the player on direct vehicle contact and ends the run after 3 lives', () => {
    let gameOverState: GameState | null = null;
    const engine = makeEngine((s) => {
      gameOverState = s;
    });

    for (let i = 0; i < 5000 && !gameOverState; i++) {
      step(16);
      const state = engine.getState();
      const vehicle = state.vehicles[0];
      if (vehicle) {
        // Snap the player onto the nearest vehicle's exact position —
        // pointerDown at the player's current spot zeroes the drag
        // offset, so the very next pointerMove places it exactly at the
        // given coordinates.
        engine.pointerDown(state.player.x, state.player.y);
        engine.pointerMove(vehicle.x, vehicle.y);
      }
    }

    expect(gameOverState).not.toBeNull();
    expect(gameOverState!.lives).toBe(0);
    expect(gameOverState!.isGameOver).toBe(true);
  });

  it('never lets score exceed what plausibility rules would allow for the distance traveled', () => {
    // Mirrors the server-side plausibility check in
    // artifacts/api-server/src/routes/scores.ts (MAX_SCORE_PER_DISTANCE)
    // — if this ever drifted, real runs would start getting rejected by
    // the leaderboard API.
    const engine = makeEngine();
    for (let i = 0; i < 3000; i++) step(16);
    const state = engine.getState();
    const maxAllowed = Math.min(200_000, state.distance * 1.5 + 5000);
    expect(state.score).toBeLessThanOrEqual(maxAllowed);
  });
});

describe('CAR_STATS', () => {
  // Regression test for "player cars a couple of them are too narrow, so
  // they can basically run forever" (DEATHSLED was 22px, PHANTOM was
  // 16px — narrow enough to dodge nearly all traffic by default).
  it('keeps every car\'s hitbox width above the narrow-enough-to-dodge-everything threshold', () => {
    for (const stats of Object.values(CAR_STATS)) {
      expect(stats.width).toBeGreaterThanOrEqual(24);
    }
  });
});
