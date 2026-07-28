import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BlurMask, Canvas, Circle, Group, Image, Line, LinearGradient, Path, RadialGradient } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { CAR_STATS, type GameRenderer, type GameState } from '@workspace/game-core';
import type { NativeGameEngine } from './native-engine';
import { useSpriteImages, vehicleImage } from './sprites';

// Matches the web app's internal game resolution (see
// artifacts/warboss-highway/src/pages/Game.tsx's canvas width/height) so
// GameEngine's lane math produces the same layout on both platforms.
export const GAME_WIDTH = 420;
export const GAME_HEIGHT = 800;
const ROAD_TILE_SIZE = 80;

interface Frame {
  state: GameState;
  cameraY: number;
}

function hexagonPath(cx: number, cy: number, r: number, rotation: number): string {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + rotation;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    d += i === 0 ? `M ${x} ${y} ` : `L ${x} ${y} `;
  }
  return `${d}Z`;
}

// Phase 2 of the "native mobile rebuild" plan (now with the visual-parity
// pass that was originally deferred): proves the shared game-core
// simulation renders on native via react-native-skia, matching the web
// renderer's feedback effects — crash particles, shield ring, hit-flicker,
// screen shake, oil-slick glow, exhaust trail, player underglow — instead
// of just sprites moving around with no juice. Renders declaratively from
// getState()/cameraY each frame — react-native-skia's <Canvas> here is a
// React scene graph (unlike Pixi's imperative per-frame draw), so a
// render is triggered via a tick counter bumped from the attached
// GameRenderer.sync() rather than an onDraw callback.
//
// Takes `engine` as a prop (owned by the screen — see useGameEngine.ts)
// instead of creating its own, so HudOverlay can share the same instance.
export function GameCanvas({ engine }: { engine: NativeGameEngine }) {
  const images = useSpriteImages();
  const frameRef = useRef<Frame | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const renderer: GameRenderer = {
      sync(state, cameraY) {
        frameRef.current = { state, cameraY };
        setTick((t) => (t + 1) % 1_000_000);
      },
      destroy() {},
    };

    engine.attachRenderer(renderer);
    return () => engine.attachRenderer(null);
  }, [engine]);

  const frame = frameRef.current;

  // Mirrors the web renderer's drag-to-steer (handleTouchStart/Move/End
  // in web-engine.ts) via GameEngine's DOM-agnostic pointerDown/Move/Up —
  // same input model, different wiring. Pan callbacks run as worklets on
  // the UI thread (Reanimated is installed), so calls into the engine
  // instance (plain JS, lives on the JS thread) go through runOnJS.
  // GestureDetector's view is sized to exactly match the Canvas below, so
  // the gesture's local x/y land directly in the same coordinate space
  // GameEngine expects — no separate screen-to-canvas scaling needed like
  // the web version's getBoundingClientRect() math (there's no CSS-vs-
  // backing-resolution mismatch here).
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          runOnJS(handlePointerDown)(e.x, e.y);
        })
        .onUpdate((e) => {
          runOnJS(handlePointerMove)(e.x, e.y);
        })
        .onEnd(() => {
          runOnJS(handlePointerUp)();
        }),
    [engine]
  );

  function handlePointerDown(x: number, y: number) {
    engine.pointerDown(x, y);
  }
  function handlePointerMove(x: number, y: number) {
    engine.pointerMove(x, y);
  }
  function handlePointerUp() {
    engine.pointerUp();
  }

  if (!frame) {
    return (
      <GestureDetector gesture={pan}>
        <Canvas style={{ width: GAME_WIDTH, height: GAME_HEIGHT, backgroundColor: '#0c0c0e' }} />
      </GestureDetector>
    );
  }

  const { state, cameraY } = frame;
  const now = performance.now();
  const carColor = CAR_STATS[state.selectedCar].color;

  // Screen shake — same random-jitter-scaled-by-screenShake as the web
  // draw()'s `ctx.translate((Math.random()-0.5)*i, ...)`.
  const shakeAmp = state.screenShake > 0 ? (state.screenShake / 300) * 9 : 0;
  const shakeX = shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0;
  const shakeY = shakeAmp > 0 ? (Math.random() - 0.5) * shakeAmp : 0;

  const flickerVisible = !state.player.isInvulnerable || Math.floor(now / 80) % 2 === 0;
  const shieldActive = state.activePowerUp === 'SHIELD';
  const invulnAlpha = state.player.isInvulnerable ? 0.7 + 0.3 * Math.sin(now * 0.03) : 1;

  const playerImage = images.playerCars[state.selectedCar];
  const underglowCy = state.player.y + state.player.height * 0.35;
  const underglowR = state.player.width * 1.4;

  return (
    <GestureDetector gesture={pan}>
      <Canvas style={{ width: GAME_WIDTH, height: GAME_HEIGHT, backgroundColor: '#0c0c0e' }}>
        <Group transform={[{ translateX: shakeX }, { translateY: shakeY - cameraY }]}>
          {images.roadTile && renderRoad(images.roadTile, state.roadOffset)}

          {state.obstacles.map((o, i) => {
            const img = o.type === 'OIL_SLICK' ? images.oilSlick : images.debris;
            if (!img) return null;
            return (
              <Image
                key={`obstacle-${i}`}
                image={img}
                x={o.x - o.width / 2}
                y={o.y - o.height / 2}
                width={o.width}
                height={o.height}
                fit="fill"
              />
            );
          })}

          {state.vehicles.map((v, i) => {
            const img = vehicleImage(images, v.type, v.variant);
            if (!img) return null;
            return (
              <Image
                key={`vehicle-${i}`}
                image={img}
                x={v.x - v.width / 2}
                y={v.y - v.height / 2}
                width={v.width}
                height={v.height}
                fit="fill"
                transform={[{ rotate: Math.PI }]}
                origin={{ x: v.x, y: v.y }}
              />
            );
          })}

          {state.powerups.map((p, i) => {
            const img = images.powerups[p.type];
            if (!img) return null;
            return (
              <Image
                key={`powerup-${i}`}
                image={img}
                x={p.x - p.width / 2}
                y={p.y - p.height / 2}
                width={p.width}
                height={p.height}
                fit="contain"
              />
            );
          })}

          {/* Exhaust trail — matches web drawExhaust()'s gradient plumes */}
          {state.speedMultiplier > 1.1 && renderExhaust(state, carColor)}

          {/* Player underglow */}
          <Circle cx={state.player.x} cy={underglowCy} r={underglowR} opacity={0.33}>
            <RadialGradient c={{ x: state.player.x, y: underglowCy }} r={underglowR} colors={[carColor, 'rgba(0,0,0,0)']} />
          </Circle>

          {/* Player car */}
          {flickerVisible && playerImage && (
            <Group opacity={invulnAlpha}>
              {state.player.oilSlicked && (
                <Circle
                  cx={state.player.x}
                  cy={state.player.y}
                  r={Math.max(state.player.width, state.player.height) * 0.55}
                  color="#8888ff"
                  opacity={0.35}
                >
                  <BlurMask blur={14} style="normal" />
                </Circle>
              )}

              {shieldActive && (
                <Group>
                  <Path
                    path={hexagonPath(state.player.x, state.player.y, 38, now * 0.0012)}
                    color="#00ffff"
                    style="stroke"
                    strokeWidth={2.5}
                    opacity={0.9}
                  />
                  <Circle
                    cx={state.player.x}
                    cy={state.player.y}
                    r={28 + (0.5 + 0.5 * Math.sin(now * 0.0012 * 4)) * 4}
                    color="#00ffff"
                    style="stroke"
                    strokeWidth={1}
                    opacity={0.5}
                  />
                </Group>
              )}

              <Image
                image={playerImage}
                x={state.player.x - state.player.width / 2}
                y={state.player.y - state.player.height / 2}
                width={state.player.width}
                height={state.player.height}
                fit="fill"
              />
            </Group>
          )}

          {/* Crash/hit particles — glowing circles, matches web draw()'s
              radial-gradient particle rendering. */}
          {state.particles.map((p, i) => {
            const life = Math.max(0, p.life / p.maxLife);
            if (life <= 0) return null;
            return (
              <Circle key={`particle-${i}`} cx={p.x} cy={p.y} r={p.size * 1.2} color={p.color} opacity={life}>
                <BlurMask blur={p.size * 0.8} style="normal" />
              </Circle>
            );
          })}
        </Group>
      </Canvas>
    </GestureDetector>
  );
}

// Simple full-tile repeat — the source image is pre-cropped by
// useSpriteImages()/cropCenterSquare() (see sprites.ts) to remove its
// vignette before it ever reaches here, so a plain repeat (stretched to
// each 80x80 destination cell via fit="fill") reads as continuous road
// instead of a visible grid.
function renderRoad(roadTile: NonNullable<ReturnType<typeof useSpriteImages>['roadTile']>, roadOffset: number) {
  const tiles: React.ReactNode[] = [];
  const cols = Math.ceil(GAME_WIDTH / ROAD_TILE_SIZE);
  const rows = Math.ceil(GAME_HEIGHT / ROAD_TILE_SIZE) + 2;
  const yStart = -ROAD_TILE_SIZE + (roadOffset % ROAD_TILE_SIZE);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push(
        <Image
          key={`road-${row}-${col}`}
          image={roadTile}
          x={col * ROAD_TILE_SIZE}
          y={yStart + row * ROAD_TILE_SIZE}
          width={ROAD_TILE_SIZE}
          height={ROAD_TILE_SIZE}
          fit="fill"
        />
      );
    }
  }
  return <>{tiles}</>;
}

function renderExhaust(state: GameState, carColor: string) {
  const spd = state.speedMultiplier;
  const px = state.player.x;
  const py = state.player.y + state.player.height / 2;
  const hw = state.player.width * 0.3;
  const len = spd * 22;
  const hot = spd >= 2.2;
  const plumeColor = hot ? 'rgba(255,90,10,0.6)' : 'rgba(180,190,200,0.4)';

  const plume = (ox: number, width: number, key: string) => (
    <Line key={key} p1={{ x: px + ox, y: py }} p2={{ x: px + ox, y: py + len }} style="stroke" strokeWidth={width} strokeCap="round">
      <LinearGradient start={{ x: px + ox, y: py }} end={{ x: px + ox, y: py + len }} colors={[plumeColor, 'rgba(0,0,0,0)']} />
    </Line>
  );

  return (
    <Group>
      {plume(-hw, 2.5, 'exhaust-l')}
      {plume(hw, 2.5, 'exhaust-r')}
      {spd >= 2.0 && plume(0, 1.5, 'exhaust-c')}
      {spd >= 2.5 && (
        <Line p1={{ x: px, y: py }} p2={{ x: px, y: py + len * 0.8 }} style="stroke" strokeWidth={state.player.width * 0.7} strokeCap="round">
          <LinearGradient start={{ x: px, y: py }} end={{ x: px, y: py + len * 0.8 }} colors={[carColor, 'rgba(0,0,0,0)']} />
        </Line>
      )}
    </Group>
  );
}
