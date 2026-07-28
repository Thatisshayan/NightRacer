import * as Haptics from 'expo-haptics';
import { GameEngine, type GameState, type CarType, type DailyModifier } from '@workspace/game-core';

// Native counterpart to the web package's WebGameEngine (see
// artifacts/warboss-highway/src/lib/game/web-engine.ts) — supplies the
// platform pieces GameEngine needs (haptics here; audio is still a no-op,
// see the "native mobile rebuild" plan's Phase 7) instead of DOM wiring.
// Rendering is NOT done via attachRenderer()'s Canvas2D-style draw here —
// GameCanvas.tsx renders declaratively from getState()/cameraY each frame
// instead, since react-native-skia's Canvas is a React scene graph, not an
// imperative 2D context. GameCanvas still attaches a tiny GameRenderer so
// it can read cameraY, which isn't part of GameState.
export class NativeGameEngine extends GameEngine {
  constructor(
    dims: { width: number; height: number },
    onGameOver: (state: GameState) => void,
    options?: {
      isDailyChallenge?: boolean;
      selectedCar?: CarType;
      onPauseChange?: (paused: boolean) => void;
      upgrades?: { speed: number; armor: number; handling: number };
      dailyModifier?: DailyModifier;
    }
  ) {
    super(dims, onGameOver, {
      ...options,
      haptics: (pattern) => {
        const style = Array.isArray(pattern)
          ? Haptics.ImpactFeedbackStyle.Heavy
          : pattern >= 80
            ? Haptics.ImpactFeedbackStyle.Heavy
            : Haptics.ImpactFeedbackStyle.Light;
        Haptics.impactAsync(style).catch(() => {});
      },
    });
  }
}
