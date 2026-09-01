import { useEffect, useRef } from 'react';
import { buildApexStormFrame, type ApexStormFrame } from '@workspace/render-frame';
import type { GameRenderer, GameState } from '@workspace/game-core';
import type { NativeGameEngine } from '../game/native-engine';

// Matches GameCanvas.tsx's own attachRenderer pattern: GameEngine drives its
// own simulation RAF loop and calls sync() on it directly. We stash the
// latest computed frame in a ref for the R3F <Canvas>'s useFrame to read on
// its own render tick — React Three Fiber is a declarative scene graph like
// react-native-skia's <Canvas>, so per-frame updates must flow through refs,
// not through React re-renders.
export function useApexNativeRenderer(engine: NativeGameEngine) {
  const latestFrame = useRef<ApexStormFrame | null>(null);
  const latestScreenShake = useRef(0);

  useEffect(() => {
    const renderer: GameRenderer = {
      sync(state: GameState, _cameraY: number, screenShake: number) {
        latestFrame.current = buildApexStormFrame(state, { demo: false });
        latestScreenShake.current = screenShake;
      },
      destroy() {},
    };
    engine.attachRenderer(renderer);
    return () => engine.attachRenderer(null);
  }, [engine]);

  return { latestFrame, latestScreenShake };
}
