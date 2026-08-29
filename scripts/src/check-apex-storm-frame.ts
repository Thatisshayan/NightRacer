import type { GameState } from '@workspace/game-core';
import { APEX_STORM_ROAD, buildApexStormFrame, sampleApexRoad } from '@workspace/render-frame';

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(`Apex Storm frame check failed: ${message}`);
};

const state: GameState = {
  player: {
    x: 262.5,
    y: 720,
    width: 48,
    height: 80,
    isInvulnerable: false,
    invulnTimer: 0,
    oilSlicked: false,
    oilTimer: 0,
    vx: 0,
  },
  vehicles: [
    { x: 52.5, y: -40, width: 48, height: 80, type: 'SEDAN', color: '#d7f5ff', speed: 4, lane: 0, passed: false, variant: 1, direction: 'OPPOSITE' },
    { x: 367.5, y: 340, width: 48, height: 80, type: 'SPORTS', color: '#ff3f53', speed: 3, lane: 3, passed: false, variant: 2, direction: 'SAME' },
  ],
  powerups: [],
  obstacles: [],
  particles: [],
  score: 0,
  lives: 3,
  distance: 0,
  isGameOver: false,
  activePowerUp: null,
  powerUpTimer: 0,
  powerUpsUsed: 0,
  screenShake: 0,
  roadOffset: 0,
  baseSpeed: 5,
  driveTilt: 0,
  rushCharge: 0,
  rushTimer: 0,
  rushPulse: 0,
  nearMissPulse: 0,
  lanes: [52.5, 157.5, 262.5, 367.5],
  combo: 0,
  comboTimer: 0,
  maxCombo: 0,
  scorePop: 0,
  comboPop: 0,
  levelUpFlash: 0,
  levelUpText: '',
  lastSpeedLevel: 1,
  bossTimer: 0,
  bossActive: false,
  bossWarning: 0,
  wasHit: false,
  tanksSlayed: 0,
  achievementsEarned: [],
  speedMultiplier: 1,
  selectedCar: 'WAR_RUNNER',
  isDailyChallenge: false,
};

const first = buildApexStormFrame(state, { demo: true });
const second = buildApexStormFrame(state, { demo: true });
assert(JSON.stringify(first) === JSON.stringify(second), 'identical demo input must produce an identical frame');
assert(first.road.length === APEX_STORM_ROAD.segmentCount, 'road segment count must remain fixed');
assert(first.vehicles.length === 5, 'demo must contain one player plus four traffic depth bands');
assert(first.vehicles.every((pose, index, poses) => index === 0 || poses[index - 1].z >= pose.z), 'vehicles must be depth sorted from far to near');

for (const pose of first.vehicles) {
  assert(pose.wheelContacts.length === 4, `${pose.id} must have four wheel contacts`);
  assert(pose.wheelContacts.every((wheel) => wheel.y === 0), `${pose.id} wheels must stay on the road plane`);
  const road = sampleApexRoad(pose.z, first.roadPhase);
  assert(Math.abs(pose.x - road.x) <= road.halfWidth, `${pose.id} chassis must remain within the road corridor`);
}

const player = first.vehicles.find((pose) => pose.kind === 'player');
assert(player, 'frame must contain player pose');
assert(player!.shadow.x === player!.x && player!.shadow.z === player!.z + 0.1, 'player shadow must share the chassis road contact');
assert(player!.reflection.x === player!.x, 'player reflection must share the chassis road contact');

console.log('Apex Storm visual-frame checks passed');
