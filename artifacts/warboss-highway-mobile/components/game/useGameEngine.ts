import { useEffect, useState } from 'react';
import type { CarType } from '@workspace/game-core';
import { NativeGameEngine } from './native-engine';

// Lifts engine ownership up to the screen (app/(tabs)/index.tsx) so both
// GameCanvas (rendering) and HudOverlay (score/lives/etc.) share the same
// instance — mirrors the web app's Game.tsx owning the engine and handing
// it to both PixiRenderer and GameHudOverlay.
export function useNativeGameEngine(
  width: number,
  height: number,
  selectedCar: CarType = 'WAR_RUNNER'
): NativeGameEngine | null {
  const [engine, setEngine] = useState<NativeGameEngine | null>(null);

  useEffect(() => {
    const instance = new NativeGameEngine(
      { width, height },
      () => {
        // Phase 6 wires a real game-over screen; for now the run just
        // stops rendering new frames (state.isGameOver freezes the loop).
      },
      { selectedCar }
    );
    instance.start();
    setEngine(instance);

    return () => {
      instance.cleanup();
      setEngine(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, selectedCar]);

  return engine;
}
