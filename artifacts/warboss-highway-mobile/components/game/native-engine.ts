import * as Haptics from 'expo-haptics';
import { GameEngine, type GameState, type CarType, type DailyModifier } from '@workspace/game-core';
import { NativeAudio } from '@/lib/native-audio';

// Native counterpart to the web package's WebGameEngine (see
// artifacts/warboss-highway/src/lib/game/web-engine.ts) — supplies the
// platform pieces GameEngine needs (haptics, pre-rendered SFX/music via
// NativeAudio — see lib/native-audio.ts and scripts/generate-sfx.mjs)
// instead of DOM wiring. Rendering is NOT done via attachRenderer()'s
// Canvas2D-style draw here — GameCanvas.tsx renders declaratively from
// getState()/cameraY each frame instead, since react-native-skia's
// Canvas is a React scene graph, not an imperative 2D context. GameCanvas
// still attaches a tiny GameRenderer so it can read cameraY, which isn't
// part of GameState.
const NATIVE_ENTITY_SCALE = 0.78;

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
    // Validate dimensions to ensure they are positive
    if (dims.width <= 0 || dims.height <= 0) {
      throw new Error("Invalid dimensions for NativeGameEngine");
    }
    super(dims, onGameOver, {
      ...options,
      // The native game is drawn from a chase camera, where the 2D game's
      // car-to-lane ratio (a car ~half a lane wide) leaves almost no room to
      // place the car. Smaller hitboxes, drawn to match, open the lanes up.
      entityScale: NATIVE_ENTITY_SCALE,
      audio: NativeAudio,
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
