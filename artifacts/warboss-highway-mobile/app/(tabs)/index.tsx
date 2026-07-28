import { StyleSheet, View } from 'react-native';
import { GameCanvas } from '@/components/game/GameCanvas';

// Phase 2 of the "native mobile rebuild" plan — replaces the never-built
// Replit/Expo scaffold placeholder with the real game, rendered natively
// via react-native-skia against the shared @workspace/game-core
// simulation. Title/car-select/HUD/game-over screens are still to come
// (Phases 4 and 6); this proves the render pipeline end to end first.
export default function TabOneScreen() {
  return (
    <View style={styles.container}>
      <GameCanvas />
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
});
