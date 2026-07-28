import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { getDailyModifier, type CarType, type GameState } from '@workspace/game-core';
import { GameCanvas, GAME_WIDTH, GAME_HEIGHT } from '@/components/game/GameCanvas';
import { HudOverlay } from '@/components/game/HudOverlay';
import { TitleScreen } from '@/components/game/TitleScreen';
import { GameOverScreen } from '@/components/game/GameOverScreen';
import { PauseOverlay } from '@/components/game/PauseOverlay';
import { TutorialOverlay } from '@/components/game/TutorialOverlay';
import { useNativeGameEngine } from '@/components/game/useGameEngine';
import { Settings } from '@/lib/settings';
import { NativeAudio, getMutedState, toggleMuted } from '@/lib/native-audio';

type Screen = 'title' | 'playing' | 'gameover';

interface GameOverInfo {
  state: GameState;
  isNewRecord: boolean;
  scrapEarned: number;
}

// Phase 2-7 of the "native mobile rebuild" plan: title/car-select ->
// playing -> game-over, same screen-state-machine shape as the web app's
// Game.tsx, now with the pieces that were originally deferred: a pause
// button/overlay, a mute toggle, the first-run tutorial, and the daily
// streak system. Leaderboard viewing lives on its own tab (see
// app/(tabs)/leaderboard.tsx) rather than this screen.
export default function TabOneScreen() {
  const [screen, setScreen] = useState<Screen>('title');
  const [selectedCar, setSelectedCar] = useState<CarType>(() => Settings.getSelectedCar());
  const [isDailyChallenge, setIsDailyChallenge] = useState(() => Settings.getDailyChallenge());
  const [gameOverInfo, setGameOverInfo] = useState<GameOverInfo | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [muted, setMuted] = useState(() => getMutedState());
  const [showTutorial, setShowTutorial] = useState(false);
  const [streak, setStreak] = useState(0);
  // The simulation always runs at a fixed 420x800 logical resolution (see
  // GAME_WIDTH/GAME_HEIGHT), but the actual usable screen area varies with
  // device size and safe-area/tab-bar insets. Without scaling to fit, a
  // narrower or shorter viewport than 420x800 clips gameplay and the drag
  // gesture surface. Measured via onLayout since useWindowDimensions
  // doesn't account for this container's own safe-area/tab-bar insets.
  const [availableSize, setAvailableSize] = useState<{ width: number; height: number } | null>(null);
  const scale = availableSize
    ? Math.min(availableSize.width / GAME_WIDTH, availableSize.height / GAME_HEIGHT)
    : 1;

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

  const handleToggleMute = useCallback(() => {
    setMuted(toggleMuted());
  }, []);

  const handleGameOver = useCallback(
    (state: GameState) => {
      const isNewRecord = Settings.updatePersonalBest(selectedCar, state.score);
      const streakBonus = 1 + streak * 0.05;
      const scrapEarned = Math.floor(
        (Math.floor(state.score / 100) + (state.isDailyChallenge ? Math.floor(state.score * dailyModifier.scrapBonus) : 0)) *
          streakBonus
      );
      Settings.addScrap(scrapEarned);
      setIsPaused(false);
      setGameOverInfo({ state, isNewRecord, scrapEarned });
      setScreen('gameover');
    },
    [selectedCar, dailyModifier, streak]
  );

  const handlePauseChange = useCallback((paused: boolean) => {
    setIsPaused(paused);
  }, []);

  // The Game tab stays mounted when the user switches to Kill-Board (both
  // NativeTabs and the classic Tabs navigator preserve sibling screens), so
  // without this the engine's animation loop and gameplay audio would keep
  // running off-screen — silently losing lives/time the player never saw.
  // Auto-pause on blur, same as manually tapping the pause button; requires
  // an explicit resume tap rather than auto-resuming on refocus.
  const isFocused = useIsFocused();
  useEffect(() => {
    if (!isFocused && screen === 'playing') {
      engine?.pause();
    }
  }, [isFocused, screen, engine]);

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
    isDailyChallenge ? dailyModifier : undefined,
    handlePauseChange
  );

  const startGame = useCallback(() => {
    NativeAudio.stop('menu');
    setGameOverInfo(null);
    setIsPaused(false);
    setRunKey((k) => k + 1);
    setScreen('playing');
  }, []);

  const quitToMenu = useCallback(() => {
    engine?.cleanup();
    setIsPaused(false);
    setScreen('title');
  }, [engine]);

  // Mirrors the web app's title-screen effect (Game.tsx: `if (screen ===
  // 'title') { playAudio('menu', true); const { count } = getStreak();
  // ... }`) — 'gameplay' music is started/stopped by the engine itself
  // (see game-core's init()/cleanup()). Also gates the first-run
  // tutorial the same way Game.tsx does with Settings.getTutorialSeen().
  useEffect(() => {
    if (screen === 'title') {
      NativeAudio.play('menu', true);
      setStreak(Settings.getStreak().count);
      if (!Settings.getTutorialSeen()) setShowTutorial(true);
    }
  }, [screen]);

  return (
    <View style={styles.container}>
      {screen === 'title' && (
        <TitleScreen
          selectedCar={selectedCar}
          onSelectCar={handleSelectCar}
          isDailyChallenge={isDailyChallenge}
          onToggleDailyChallenge={handleToggleDailyChallenge}
          personalBest={Settings.getPersonalBest(selectedCar)}
          streak={streak}
          onStart={startGame}
        />
      )}

      {screen === 'playing' && (
        <View
          style={styles.gameAreaMeasure}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setAvailableSize({ width, height });
          }}
        >
          <View style={{ width: GAME_WIDTH * scale, height: GAME_HEIGHT * scale }}>
            {engine && <GameCanvas engine={engine} scale={scale} />}
            {engine && (
              <HudOverlay
                engine={engine}
                onPause={() => engine.pause()}
                muted={muted}
                onToggleMute={handleToggleMute}
              />
            )}
            {isPaused && <PauseOverlay onResume={() => engine?.resume()} onQuit={quitToMenu} />}
          </View>
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

      {showTutorial && (
        <TutorialOverlay
          onDismiss={() => {
            setShowTutorial(false);
            Settings.setTutorialSeen(true);
          }}
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
  gameAreaMeasure: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
