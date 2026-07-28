import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GameState } from '@workspace/game-core';
import { GameCanvas, GAME_WIDTH, GAME_HEIGHT } from '@/components/game/GameCanvas';
import { HudOverlay } from '@/components/game/HudOverlay';
import { useNativeGameEngine } from '@/components/game/useGameEngine';
import { Settings } from '@/lib/settings';

// Phase 2-5 of the "native mobile rebuild" plan — replaces the never-built
// Replit/Expo scaffold placeholder with the real game, rendered natively
// via react-native-skia against the shared @workspace/game-core
// simulation, with drag-to-steer input (Phase 3), a ported HUD (Phase 4),
// and persisted settings (Phase 5 — selected car + scrap earned).
// Title/car-select/game-over screens are still to come (Phase 6); this
// screen auto-starts a run with whatever car was last selected.
export default function TabOneScreen() {
  const selectedCar = useMemo(() => Settings.getSelectedCar(), []);

  const handleGameOver = useCallback((state: GameState) => {
    const earned = Math.floor(state.score / 100);
    Settings.addScrap(earned);
  }, []);

  const engine = useNativeGameEngine(GAME_WIDTH, GAME_HEIGHT, selectedCar, handleGameOver);

  return (
    <View style={styles.container}>
      <View style={styles.gameArea}>
        {engine && <GameCanvas engine={engine} />}
        {engine && <HudOverlay engine={engine} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  gameArea: {
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
});
