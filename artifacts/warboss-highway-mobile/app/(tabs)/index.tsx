import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { getDailyModifier, type CarType, type GameState } from '@workspace/game-core';
import { GameCanvas, GAME_WIDTH, GAME_HEIGHT } from '@/components/game/GameCanvas';
import { HudOverlay } from '@/components/game/HudOverlay';
import { TitleScreen } from '@/components/game/TitleScreen';
import { GameOverScreen } from '@/components/game/GameOverScreen';
import { useNativeGameEngine } from '@/components/game/useGameEngine';
import { Settings } from '@/lib/settings';

type Screen = 'title' | 'playing' | 'gameover';

interface GameOverInfo {
  state: GameState;
  isNewRecord: boolean;
  scrapEarned: number;
}

// Phase 2-6 of the "native mobile rebuild" plan: title/car-select ->
// playing -> game-over, same screen-state-machine shape as the web app's
// Game.tsx. Leaderboard viewing lives on its own tab (see
// app/(tabs)/leaderboard.tsx) rather than this screen.
export default function TabOneScreen() {
  const [screen, setScreen] = useState<Screen>('title');
  const [selectedCar, setSelectedCar] = useState<CarType>(() => Settings.getSelectedCar());
  const [isDailyChallenge, setIsDailyChallenge] = useState(() => Settings.getDailyChallenge());
  const [gameOverInfo, setGameOverInfo] = useState<GameOverInfo | null>(null);
  const [runKey, setRunKey] = useState(0);

  const dailyModifier = useMemo(() => getDailyModifier(), []);

  const handleSelectCar = useCallback((car: CarType) => {
    setSelectedCar(car);
    Settings.setSelectedCar(car);
  }, []);

  const handleToggleDailyChallenge = useCallback(() => {
    setIsDailyChallenge((v) => {
      const next = !v;
      Settings.setDailyChallenge(next);
      return next;
    });
  }, []);

  const handleGameOver = useCallback(
    (state: GameState) => {
      const isNewRecord = Settings.updatePersonalBest(selectedCar, state.score);
      const scrapEarned =
        Math.floor(state.score / 100) +
        (state.isDailyChallenge ? Math.floor(state.score * dailyModifier.scrapBonus) : 0);
      Settings.addScrap(scrapEarned);
      setGameOverInfo({ state, isNewRecord, scrapEarned });
      setScreen('gameover');
    },
    [selectedCar, dailyModifier]
  );

  // Only constructed while actually playing — the title/game-over screens
  // don't need an engine instance running behind them, unlike the web
  // app's canvas (which stays mounted so its crash frame shows through
  // the game-over overlay). runKey forces a fresh engine on "PLAY AGAIN".
  const engine = useNativeGameEngine(
    GAME_WIDTH,
    GAME_HEIGHT,
    selectedCar,
    handleGameOver,
    screen === 'playing' ? runKey : null,
    isDailyChallenge ? dailyModifier : undefined
  );

  const startGame = useCallback(() => {
    setGameOverInfo(null);
    setRunKey((k) => k + 1);
    setScreen('playing');
  }, []);

  return (
    <View style={styles.container}>
      {screen === 'title' && (
        <TitleScreen
          selectedCar={selectedCar}
          onSelectCar={handleSelectCar}
          isDailyChallenge={isDailyChallenge}
          onToggleDailyChallenge={handleToggleDailyChallenge}
          personalBest={Settings.getPersonalBest(selectedCar)}
          onStart={startGame}
        />
      )}

      {screen === 'playing' && (
        <View style={styles.gameArea}>
          {engine && <GameCanvas engine={engine} />}
          {engine && <HudOverlay engine={engine} />}
        </View>
      )}

      {screen === 'gameover' && gameOverInfo && (
        <GameOverScreen
          state={gameOverInfo.state}
          selectedCar={selectedCar}
          personalBest={Settings.getPersonalBest(selectedCar)}
          isNewRecord={gameOverInfo.isNewRecord}
          scrapEarned={gameOverInfo.scrapEarned}
          onRestart={startGame}
          onMenu={() => setScreen('title')}
        />
      )}
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
