import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine, GameState, CarType, CAR_STATS } from '@/lib/game/engine';
import { GameOverOverlay } from '@/components/game-over-overlay';
import { playAudio, stopAudio, toggleMute, getMuted } from '@/lib/game/audio';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ── Personal Best ──────────────────────────────────────────────────────────────
const getPB = (car: CarType): number =>
  parseInt(localStorage.getItem(`warboss_pb_${car}`) || '0', 10);

const updatePB = (car: CarType, score: number): boolean => {
  const prev = getPB(car);
  if (score > prev) {
    localStorage.setItem(`warboss_pb_${car}`, String(Math.floor(score)));
    return true;
  }
  return false;
};

// ── Streak ─────────────────────────────────────────────────────────────────────
const getStreak = (): { count: number; isNew: boolean } => {
  const today = new Date().toDateString();
  const last = localStorage.getItem('warboss_last_play');
  const count = parseInt(localStorage.getItem('warboss_streak') || '0', 10);

  if (last === today) return { count, isNew: false };

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const newCount = last === yesterday.toDateString() ? count + 1 : 1;

  localStorage.setItem('warboss_streak', String(newCount));
  localStorage.setItem('warboss_last_play', today);
  return { count: newCount, isNew: true };
};

// ── Car mini-preview (canvas) ──────────────────────────────────────────────────
import { drawVehicle } from '@/lib/game/renderer';

function CarPreview({ carType, selected }: { carType: CarType; selected: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 80, 100);
    ctx.save();
    ctx.translate(40, 50);
    const stats = CAR_STATS[carType];
    drawVehicle(ctx, carType, stats.width, stats.height, stats.color);
    ctx.restore();
  }, [carType]);

  return (
    <canvas
      ref={ref}
      width={80}
      height={100}
      className={`w-full h-20 object-contain transition-all ${selected ? 'opacity-100' : 'opacity-60'}`}
    />
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
type Screen = 'title' | 'playing' | 'gameover';

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [screen, setScreen] = useState<Screen>('title');
  const [gameOverState, setGameOverState] = useState<GameState | null>(null);
  const [isMuted, setIsMuted] = useState(getMuted());
  const [selectedCar, setSelectedCar] = useState<CarType>('WAR_RUNNER');
  const [isDailyChallenge, setIsDailyChallenge] = useState(false);
  const [streak, setStreak] = useState(0);
  const [personalBest, setPersonalBest] = useState(0);
  const [newRecord, setNewRecord] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);

  // Landscape detection
  useEffect(() => {
    const check = () => setIsLandscape(window.innerWidth > window.innerHeight);
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  // Title screen init
  useEffect(() => {
    if (screen === 'title') {
      playAudio('menu', true);
      const { count } = getStreak();
      setStreak(count);
      setPersonalBest(getPB(selectedCar));
    }
  }, [screen]);

  // Update PB when car changes
  useEffect(() => {
    setPersonalBest(getPB(selectedCar));
  }, [selectedCar]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { engineRef.current?.cleanup(); };
  }, []);

  const startGame = useCallback(() => {
    if (!canvasRef.current) return;
    stopAudio('menu');

    engineRef.current?.cleanup();
    setGameOverState(null);
    setNewRecord(false);
    setScreen('playing');

    engineRef.current = new GameEngine(
      canvasRef.current,
      (state) => {
        const isNew = updatePB(selectedCar, state.score);
        setNewRecord(isNew);
        setPersonalBest(getPB(selectedCar));
        setGameOverState(state);
        setScreen('gameover');
      },
      { isDailyChallenge, selectedCar }
    );
    engineRef.current.start();
  }, [isDailyChallenge, selectedCar]);

  const handleToggleMute = () => setIsMuted(toggleMute());

  const carTypes: CarType[] = ['RATTLETRAP', 'WAR_RUNNER', 'DEATHSLED'];

  return (
    <div className="relative w-full h-[100dvh] bg-black overflow-hidden flex items-center justify-center">
      {/* Landscape warning */}
      {isLandscape && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 text-white text-center p-8">
          <div className="text-5xl mb-4">📱</div>
          <p className="text-xl font-black font-mono tracking-widest text-primary mb-2">ROTATE YOUR DEVICE</p>
          <p className="text-sm text-muted-foreground font-mono">This game is best played in portrait mode</p>
        </div>
      )}

      <div className="relative w-full max-w-[420px] h-full shadow-2xl shadow-primary/20">
        {/* Game canvas — always mounted so the engine can attach */}
        <canvas
          ref={canvasRef}
          width={420}
          height={800}
          className={`w-full h-full object-cover touch-none ${screen === 'playing' ? 'block' : 'hidden'}`}
        />

        {/* Title / car-select screen */}
        {screen === 'title' && (
          <div className="absolute inset-0 flex flex-col items-center justify-between bg-black/95 z-10 py-10 px-5 overflow-y-auto">
            {/* Logo */}
            <div className="text-center mb-2">
              <h1 className="text-5xl font-black text-primary drop-shadow-[0_0_10px_rgba(220,38,38,0.8)] tracking-tighter leading-none mb-1">
                WARBOSS
              </h1>
              <h2 className="text-4xl font-black text-white tracking-widest">HIGHWAY</h2>
              <p className="text-muted-foreground font-mono text-xs mt-2">
                Dodge oncoming traffic. Survive the wasteland.
              </p>
            </div>

            {/* Streak badge */}
            {streak >= 2 && (
              <div className="flex items-center gap-2 bg-accent/20 border border-accent/40 px-4 py-1.5 rounded-none text-accent font-mono text-xs font-bold">
                🔥 DAY {streak} STREAK — BONUS ×{(1 + streak * 0.05).toFixed(2)} APPLIED
              </div>
            )}

            {/* Car selection */}
            <div className="w-full space-y-3 mt-2">
              <p className="text-center text-xs font-mono text-muted-foreground tracking-widest uppercase">
                Select Vehicle
              </p>
              <div className="grid grid-cols-3 gap-2">
                {carTypes.map((car) => {
                  const stats = CAR_STATS[car];
                  const isSelected = selectedCar === car;
                  return (
                    <button
                      key={car}
                      onClick={() => setSelectedCar(car)}
                      className={`flex flex-col items-center p-2 border-2 transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10 shadow-[0_0_12px_rgba(220,38,38,0.4)]'
                          : 'border-border bg-card/50 hover:border-primary/50'
                      }`}
                    >
                      <CarPreview carType={car} selected={isSelected} />
                      <span className="font-black text-[10px] tracking-widest mt-1 text-center leading-tight">
                        {stats.label}
                      </span>
                      <span className="text-[8px] font-mono text-muted-foreground mt-0.5 leading-tight text-center">
                        {stats.desc}
                      </span>
                      <span className="text-[7px] font-mono text-muted-foreground/70 mt-1 leading-tight text-center whitespace-pre">
                        {stats.stats}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Personal best */}
            {personalBest > 0 && (
              <div className="font-mono text-xs text-muted-foreground text-center">
                PERSONAL BEST: <span className="text-primary font-bold">{personalBest.toLocaleString()}</span>
              </div>
            )}

            {/* Daily challenge toggle */}
            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={() => setIsDailyChallenge((v) => !v)}
                className={`relative w-12 h-6 rounded-none border-2 transition-all ${
                  isDailyChallenge ? 'border-green-500 bg-green-900/40' : 'border-border bg-card/30'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white transition-all ${isDailyChallenge ? 'left-6' : 'left-0.5'}`} />
              </button>
              <span className="font-mono text-xs text-muted-foreground">
                {isDailyChallenge ? (
                  <span className="text-green-400 font-bold">◆ DAILY CHALLENGE</span>
                ) : (
                  'DAILY CHALLENGE'
                )}
              </span>
            </div>

            {/* Start */}
            <Button
              onClick={startGame}
              size="lg"
              className="w-full h-16 text-2xl font-black tracking-widest rounded-none border-2 border-primary bg-primary hover:bg-transparent hover:text-primary transition-all uppercase mt-2"
            >
              START ENGINE
            </Button>
          </div>
        )}

        {/* Game Over screen */}
        {screen === 'gameover' && gameOverState && (
          <div className="absolute inset-0 z-10">
            <GameOverOverlay
              score={gameOverState.score}
              distance={gameOverState.distance}
              powerupsUsed={gameOverState.powerUpsUsed}
              achievementsEarned={gameOverState.achievementsEarned}
              selectedCar={gameOverState.selectedCar}
              isDailyChallenge={gameOverState.isDailyChallenge}
              personalBest={personalBest}
              isNewRecord={newRecord}
              onRestart={startGame}
              onBack={() => { stopAudio('gameplay'); setScreen('title'); }}
            />
          </div>
        )}

        {/* Audio toggle */}
        <button
          onClick={handleToggleMute}
          className="absolute top-4 right-4 z-20 p-2 bg-black/50 text-white rounded-full border border-border/50 hover:bg-black/80 transition-colors"
        >
          {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}
