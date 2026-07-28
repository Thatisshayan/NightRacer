import { useEffect, useRef, useState } from 'react';
import type { CarType, DailyModifier, GameState } from '@workspace/game-core';
import { NativeGameEngine } from './native-engine';
import { Settings } from '@/lib/settings';

// Lifts engine ownership up to the screen (app/(tabs)/index.tsx) so both
// GameCanvas (rendering) and HudOverlay (score/lives/etc.) share the same
// instance — mirrors the web app's Game.tsx owning the engine and handing
// it to both PixiRenderer and GameHudOverlay.
//
// `runKey` gates construction: pass `null` (title/game-over screens) to
// skip creating an engine entirely, or a number that changes on each
// "PLAY AGAIN" to force a fresh instance instead of reusing/resetting the
// old one — GameEngine has no reset() method, only a fresh constructor
// call, same as the web app's Game.tsx re-`new GameEngine(...)`-ing on
// restart.
export function useNativeGameEngine(
  width: number,
  height: number,
  selectedCar: CarType,
  onGameOver: ((state: GameState) => void) | undefined,
  runKey: number | null,
  dailyModifier?: DailyModifier
): NativeGameEngine | null {
  const [engine, setEngine] = useState<NativeGameEngine | null>(null);
  // Read via refs so a new inline callback/object each render doesn't
  // tear down and recreate the engine — only runKey changing should.
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;
  const dailyModifierRef = useRef(dailyModifier);
  dailyModifierRef.current = dailyModifier;

  useEffect(() => {
    if (runKey === null) {
      setEngine(null);
      return;
    }

    const instance = new NativeGameEngine(
      { width, height },
      (state) => onGameOverRef.current?.(state),
      {
        selectedCar,
        isDailyChallenge: dailyModifierRef.current !== undefined,
        dailyModifier: dailyModifierRef.current,
        upgrades: Settings.getUpgrades(selectedCar),
      }
    );
    instance.start();
    setEngine(instance);

    return () => {
      instance.cleanup();
      setEngine(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, selectedCar, runKey]);

  return engine;
}
