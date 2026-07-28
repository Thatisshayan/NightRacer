import { StyleSheet, View } from 'react-native';
import { GameCanvas, GAME_WIDTH, GAME_HEIGHT } from '@/components/game/GameCanvas';
import { HudOverlay } from '@/components/game/HudOverlay';
import { useNativeGameEngine } from '@/components/game/useGameEngine';

// Phase 2-4 of the "native mobile rebuild" plan — replaces the never-built
// Replit/Expo scaffold placeholder with the real game, rendered natively
// via react-native-skia against the shared @workspace/game-core
// simulation, with drag-to-steer input (Phase 3) and a ported HUD
// (Phase 4). Title/car-select/game-over screens are still to come
// (Phase 6).
export default function TabOneScreen() {
  const engine = useNativeGameEngine(GAME_WIDTH, GAME_HEIGHT, 'WAR_RUNNER');

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
