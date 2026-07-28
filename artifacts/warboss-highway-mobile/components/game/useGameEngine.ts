import { useEffect, useRef, useState } from 'react';
import type { CarType, GameState } from '@workspace/game-core';
import { NativeGameEngine } from './native-engine';

// Lifts engine ownership up to the screen (app/(tabs)/index.tsx) so both
// GameCanvas (rendering) and HudOverlay (score/lives/etc.) share the same
// instance — mirrors the web app's Game.tsx owning the engine and handing
// it to both PixiRenderer and GameHudOverlay.
export function useNativeGameEngine(
  width: number,
  height: number,
  selectedCar: CarType,
  onGameOver?: (state: GameState) => void
): NativeGameEngine | null {
  const [engine, setEngine] = useState<NativeGameEngine | null>(null);
  // onGameOver is read via a ref so a new inline callback each render
  // (the common case at call sites) doesn't tear down and recreate the
  // engine — only width/height/selectedCar changing should do that.
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  useEffect(() => {
    const instance = new NativeGameEngine(
      { width, height },
      (state) => onGameOverRef.current?.(state),
      { selectedCar }
    );
    instance.start();
    setEngine(instance);

    return () => {
      instance.cleanup();
      setEngine(null);
    };
  }, [width, height, selectedCar]);

  return engine;
}
