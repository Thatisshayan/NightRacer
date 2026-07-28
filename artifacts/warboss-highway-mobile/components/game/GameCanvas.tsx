import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, Group, Image } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { GameRenderer, GameState } from '@workspace/game-core';
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

// Phase 2 of the "native mobile rebuild" plan: proves the shared
// game-core simulation renders on native via react-native-skia. Renders
// declaratively from getState()/cameraY each frame — react-native-skia's
// <Canvas> here is a React scene graph (unlike Pixi's imperative
// per-frame draw), so a render is triggered via a tick counter bumped
// from the attached GameRenderer.sync() rather than an onDraw callback.
//
// Takes `engine` as a prop (owned by the screen — see useGameEngine.ts)
// instead of creating its own, so HudOverlay can share the same instance.
//
// Deliberately out of scope for this pass (tracked as fast-follow, not
// forgotten): the same road-tile vignette crop the web renderer applies
// (cosmetic; needs a Skia clip/scale trick since <Image> has no
// source-rect crop prop), obstacles/powerups visual polish (particles,
// glow, exhaust), and audio (Phase 7, deferred even on web parity
// grounds — see native-engine.ts).
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

  return (
    <GestureDetector gesture={pan}>
    <Canvas style={{ width: GAME_WIDTH, height: GAME_HEIGHT, backgroundColor: '#0c0c0e' }}>
      <Group transform={[{ translateY: frame ? -frame.cameraY : 0 }]}>
        {images.roadTile && frame && renderRoad(images.roadTile, frame.state.roadOffset)}

        {frame?.state.obstacles.map((o, i) => {
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

        {frame?.state.vehicles.map((v, i) => {
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

        {frame?.state.powerups.map((p, i) => {
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

        {frame && images.playerCars[frame.state.selectedCar] && (
          <Image
            image={images.playerCars[frame.state.selectedCar]}
            x={frame.state.player.x - frame.state.player.width / 2}
            y={frame.state.player.y - frame.state.player.height / 2}
            width={frame.state.player.width}
            height={frame.state.player.height}
            fit="fill"
          />
        )}
      </Group>
    </Canvas>
    </GestureDetector>
  );
}

// Simple full-tile repeat (no vignette crop yet — see the doc comment
// above) covering the full game height plus one tile of overscroll in
// each direction so the scroll never shows a gap at the seam.
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
