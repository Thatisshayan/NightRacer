import { useEffect, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { type GameState, type CarType, CAR_STATS, getDailyModifier } from '@workspace/game-core';
import { WebGameEngine } from '@/lib/game/web-engine';
import { GameOverOverlay } from '@/components/game-over-overlay';
import { GameHudOverlay } from '@/components/game-hud-overlay';
import { playAudio, stopAudio, toggleMute, getMuted, pauseAudio, resumeAudio } from '@/lib/game/audio';
import { Settings } from '@/lib/game/settings';
import { Volume2, VolumeX, Pause, Play, RotateCcw, Home, Settings2, Gamepad2, HelpCircle, X, Wrench, ArrowUp, Shield, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Enter/move curve from the ui-animation skill's easing defaults.
const ENTER_EASE = [0.22, 1, 0.36, 1] as const;

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
    const stats = CAR_STATS[carType];

    const reducedMotion =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false;

    const render = (bobY: number) => {
      ctx.clearRect(0, 0, 80, 100);
      ctx.save();
      ctx.translate(40, 50 + bobY);
      drawVehicle(ctx, carType, stats.width, stats.height, stats.color);
      ctx.restore();
    };

    if (reducedMotion) {
      render(0);
      return;
    }

    // Small idle bob so the selected car reads as a vehicle, not a static
    // icon — a stronger cue on the selected card, near-still otherwise.
    let rafId = 0;
    const start = performance.now();
    const loop = (now: number) => {
      const t = (now - start) / 1000;
      const amplitude = selected ? 3 : 1;
      render(Math.sin(t * 2) * amplitude);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [carType, selected]);

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

// The shipped Pixi scene remains the default and `?renderer=canvas2d` remains
// its explicit fallback. The isolated `?renderer=rebuild` path is the visual
// replacement proof slice; it shares GameEngine but owns a separate canvas so
// it can be judged and reverted without disturbing the shipped renderer.
const requestedRenderer =
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('renderer');
const useRebuildRenderer = requestedRenderer === 'rebuild';
const usePixiRenderer = requestedRenderer !== 'canvas2d' && !useRebuildRenderer;
const useOverlayRenderer = usePixiRenderer || useRebuildRenderer;
const useGroundingDemo =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === 'grounding';

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiHostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WebGameEngine | null>(null);

  const [screen, setScreen] = useState<Screen>('title');
  const [gameOverState, setGameOverState] = useState<GameState | null>(null);
  const [isMuted, setIsMuted] = useState(getMuted());
  const [selectedCar, setSelectedCar] = useState<CarType>(Settings.getSelectedCar());
  const [isDailyChallenge, setIsDailyChallenge] = useState(Settings.getDailyChallenge());
  const [joystickEnabled, setJoystickEnabled] = useState(Settings.getJoystickEnabled());
  const [showTutorial, setShowTutorial] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [dailyModifier] = useState(() => getDailyModifier());
  const [scrap, setScrap] = useState(() => Settings.getScrap());
  const [upgrades, setUpgrades] = useState(() => Settings.getUpgrades(Settings.getSelectedCar()));
  const [scrapEarned, setScrapEarned] = useState(0);
  const [streak, setStreak] = useState(0);
  const [personalBest, setPersonalBest] = useState(0);
  const [newRecord, setNewRecord] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  // True once the Pixi renderer has actually attached. Until then, the
  // Canvas 2D fallback (WebGameEngine.renderFallback → draw()) is what's
  // driving the frame — its own older, procedural road/guardrail/lamp-post
  // rendering, visibly different from the sprite-pack-driven Pixi look.
  // Pixi loads async (dynamic import + sprite pack fetch, see startGame()
  // below), so without this a real user saw that older rendering flash
  // for real time before Pixi swapped in. Covered instead of just letting
  // it show, rather than changing what renderFallback() draws (it's still
  // the real fallback if Pixi genuinely fails to load).
  const [pixiReady, setPixiReady] = useState(false);
  const prefersReducedMotion = useReducedMotion();

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

  // Persist settings whenever they change
  useEffect(() => { Settings.setSelectedCar(selectedCar); setPersonalBest(getPB(selectedCar)); }, [selectedCar]);
  useEffect(() => { Settings.setDailyChallenge(isDailyChallenge); }, [isDailyChallenge]);
  useEffect(() => { Settings.setJoystickEnabled(joystickEnabled); }, [joystickEnabled]);
  useEffect(() => { Settings.setMuted(isMuted); }, [isMuted]);
  useEffect(() => { setUpgrades(Settings.getUpgrades(selectedCar)); }, [selectedCar]);

  // Animated title screen — scrolling road on the background canvas
  useEffect(() => {
    if (screen !== 'title' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    let roadY = 0;
    let rafId = 0;
    let lastTs = 0;
    const PIXELS_PER_SECOND = 180;

    const draw = (ts: number) => {
      const dt = lastTs ? (ts - lastTs) / 1000 : 0;
      lastTs = ts;
      roadY = (roadY + dt * PIXELS_PER_SECOND) % 60;

      // Dark road
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, W, H);

      // Road surface
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(W * 0.1, 0, W * 0.8, H);

      // Lane markings
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2;
      ctx.setLineDash([30, 30]);
      ctx.lineDashOffset = -roadY;
      for (const lx of [W * 0.367, W * 0.633]) {
        ctx.beginPath();
        ctx.moveTo(lx, 0);
        ctx.lineTo(lx, H);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Road edges
      ctx.strokeStyle = 'rgba(220,38,38,0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W * 0.1, 0); ctx.lineTo(W * 0.1, H);
      ctx.moveTo(W * 0.9, 0); ctx.lineTo(W * 0.9, H);
      ctx.stroke();

      // Player car silhouette in center lane
      const car = CAR_STATS[selectedCar];
      const cx = W / 2;
      const cy = H * 0.72;
      // Glow
      ctx.shadowColor = car.color;
      ctx.shadowBlur = 20;
      ctx.save();
      ctx.translate(cx, cy);
      drawVehicle(ctx, selectedCar, car.width * 1.4, car.height * 1.4, car.color);
      ctx.restore();
      ctx.shadowBlur = 0;

      // Vignette
      const vig = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, H*0.75);
      vig.addColorStop(0, 'transparent');
      vig.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      if (!prefersReducedMotion) rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [screen, selectedCar, prefersReducedMotion]);

  // Cleanup on unmount
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      engineRef.current?.cleanup();
    };
  }, []);

  // Pause/resume keyboard shortcut
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (screen !== 'playing') return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [screen]);

  // Show tutorial on first title visit
  useEffect(() => {
    if (screen !== 'title' || Settings.getTutorialSeen()) return;
    // Let the title screen render and settle first — opening the modal on the
    // same frame hides the game's identity behind a wall of instructions.
    const timer = window.setTimeout(() => setShowTutorial(true), 1100);
    return () => window.clearTimeout(timer);
  }, [screen]);

  const togglePause = useCallback(() => {
    if (!engineRef.current) return;
    if (engineRef.current.getPaused()) {
      engineRef.current.resume();
      resumeAudio('gameplay');
      setIsPaused(false);
    } else {
      engineRef.current.pause();
      pauseAudio('gameplay');
      setIsPaused(true);
    }
  }, []);

  const purchaseUpgrade = useCallback((type: 'speed' | 'armor' | 'handling') => {
    const current = upgrades[type];
    if (current >= 5 || scrap < 100) return;
    const next = { ...upgrades, [type]: current + 1 } as typeof upgrades;
    Settings.setUpgrades(selectedCar, next);
    Settings.setScrap(scrap - 100);
    setUpgrades(next);
    setScrap(Settings.getScrap());
  }, [upgrades, scrap, selectedCar]);

  const startGame = useCallback(() => {
    if (!canvasRef.current) return;
    stopAudio('menu');

    engineRef.current?.cleanup();
    setGameOverState(null);
    setNewRecord(false);
    setScreen('playing');
    setPixiReady(!useOverlayRenderer);

    engineRef.current = new WebGameEngine(
      canvasRef.current,
      (state) => {
        const isNew = updatePB(selectedCar, state.score);
        const earned = Math.floor(state.score / 100) + (isDailyChallenge ? Math.floor(state.score * dailyModifier.scrapBonus) : 0);
        Settings.addScrap(earned);
        setScrap(Settings.getScrap());
        setScrapEarned(earned);
        setNewRecord(isNew);
        setPersonalBest(getPB(selectedCar));
        setGameOverState(state);
        setIsPaused(false);
        setScreen('gameover');
      },
      {
        isDailyChallenge,
        selectedCar,
        joystickEnabled,
        onPauseChange: (paused) => {
          setIsPaused(paused);
          if (paused) pauseAudio('gameplay');
          else resumeAudio('gameplay');
        },
        upgrades,
        dailyModifier: isDailyChallenge ? dailyModifier : { name: 'NONE', description: 'Standard rules.', speedMult: 1, spawnMult: 1, scoreMult: 1, obstacleMult: 1, scrapBonus: 0 },
      }
    );
    // The grounding proof is an approval frame, not a playable alternate mode.
    // Keep the authoritative initial state frozen while its renderer loads so a
    // collision cannot replace the proof with a game-over overlay before capture.
    if (!useGroundingDemo) engineRef.current.start();

    if (useOverlayRenderer && pixiHostRef.current) {
      const engine = engineRef.current;
      const host = pixiHostRef.current;
      host.innerHTML = '';
      const rendererPromise = useRebuildRenderer
        ? import('@/lib/game/rebuild-renderer').then(({ RebuildRenderer }) =>
            RebuildRenderer.create(host, 420, 800, useGroundingDemo)
          )
        : import('@/lib/game/pixi-renderer').then(({ PixiRenderer }) =>
            PixiRenderer.create(host, 420, 800)
          );
      rendererPromise.then((renderer) => {
        // Bail if the engine was torn down (restart) or the component
        // unmounted while the renderer bundle was still loading — otherwise
        // this would attach to (or leak) a renderer nothing owns anymore.
        if (unmountedRef.current || engineRef.current !== engine) { renderer.destroy(); return; }
        engine.attachRenderer(renderer);
        if (useGroundingDemo) renderer.sync(engine.getState(), 0, 0);
        setPixiReady(true);
      }).catch((err) => {
        console.error('[renderer-debug] failed to attach renderer', err);
        setPixiReady(true); // uncover the Canvas 2D fallback if attachment fails
      });
    }
  }, [isDailyChallenge, selectedCar, joystickEnabled]);

  const handleToggleMute = () => setIsMuted(toggleMute());

  const carTypes: CarType[] = ['RATTLETRAP', 'WAR_RUNNER', 'DEATHSLED', 'SCRAPQUEEN', 'PHANTOM'];

  // Title screen entrance: logo -> streak -> car grid -> PB -> daily toggle ->
  // CTA, staggered per the ui-animation skill's 30-50ms/item guidance. This is
  // the highest-traffic screen in the app (first paint every session), so it
  // gets the most orchestration; other screens use a plain cross-fade.
  const titleVariants = {
    hidden: { opacity: 0, scale: 0.98 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: prefersReducedMotion
        ? { duration: 0 }
        : { duration: 0.2, ease: ENTER_EASE, staggerChildren: 0.045, delayChildren: 0.06 },
    },
    exit: { opacity: 0, transition: { duration: prefersReducedMotion ? 0 : 0.15 } },
  };
  const titleItemVariants = {
    hidden: { opacity: 0, y: prefersReducedMotion ? 0 : 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: prefersReducedMotion ? { duration: 0 } : { duration: 0.22, ease: ENTER_EASE },
    },
  };

  return (
    <div className="relative w-full h-[100dvh] bg-[#050816] overflow-hidden flex items-center justify-center">
      {/* Landscape warning */}
      {isLandscape && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/95 text-white text-center p-8">
          <div className="text-5xl mb-4">📱</div>
          <p className="text-xl font-black font-mono tracking-widest text-primary mb-2">ROTATE YOUR DEVICE</p>
          <p className="text-sm text-muted-foreground font-mono">This game is best played in portrait mode</p>
        </div>
      )}

      {/* Border ported from the mobile app's gameFrame style — a thin red
          instrument-viewport border, matching the grimdark accent used
          elsewhere (HUD skulls, buttons), on top of the pre-existing glow
          shadow. */}
      <div className="relative w-full max-w-[420px] h-full shadow-[0_0_52px_rgba(39,217,255,0.18)] border border-[#27d9ff]/55 bg-[#050816]">
        {/* Game canvas — always mounted (and always visible) so the engine can
            attach, and so the crash frame stays painted underneath the
            game-over overlay as it fades in instead of hard-cutting to black. */}
        <canvas
          ref={canvasRef}
          width={420}
          height={800}
          className="block w-full h-full object-cover touch-none"
        />

        {/* Pixi (WebGL) renderer host — default renderer, opt out with
            ?renderer=canvas2d. Sits over the Canvas 2D element and
            is pointer-events-none so input still reaches the canvas, which
            owns all touch/keyboard listeners regardless of active renderer.
            Stays visible through 'gameover' too (not just 'playing') since
            attachRenderer() clears the Canvas 2D surface underneath and the
            engine stops calling draw() — hiding this on death would expose a
            blank layer instead of the frozen crash frame the game-over
            overlay is meant to fade in over. */}
        {useOverlayRenderer && (
          <div
            ref={pixiHostRef}
            className="absolute inset-0 pointer-events-none"
            style={{ display: screen !== 'title' ? 'block' : 'none' }}
          />
        )}

        {/* Loading cover — masks the Canvas 2D fallback's older,
            procedural road/guardrail/lamp-post rendering while Pixi's
            bundle + sprite pack are still loading. See pixiReady's doc
            comment. */}
        {useOverlayRenderer && screen === 'playing' && !pixiReady && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black">
            <div className="text-xs font-mono text-muted-foreground tracking-widest uppercase">Loading…</div>
          </div>
        )}

        {/* HUD — DOM overlay, independent of which renderer (Canvas 2D or
            Pixi) is drawing the game world underneath it. */}
        {screen === 'playing' && engineRef.current && (
          <GameHudOverlay engine={engineRef.current} />
        )}

        {/* Title / car-select screen */}
        <AnimatePresence>
        {screen === 'title' && (
          <motion.div
            key="title"
            variants={titleVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute inset-0 flex flex-col items-center justify-between bg-[#050816]/[0.80] z-10 py-8 px-5 overflow-y-auto">
            {/* Neon Rainway title field: restrained ambient light, a distant
                highway beam, and the existing city layers build depth without
                turning the menu into a non-interactive full-screen poster. */}
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_50%_105%,rgba(39,217,255,0.25),transparent_43%),radial-gradient(ellipse_at_92%_18%,rgba(223,75,255,0.16),transparent_30%)]" />
            <div className="absolute left-1/2 bottom-[-18%] h-[72%] w-[52%] -translate-x-1/2 skew-x-[-6deg] border-x border-[#27d9ff]/25 bg-gradient-to-t from-[#11192a]/90 via-[#101a2a]/30 to-transparent pointer-events-none" />
            {/* Skyline parallax backdrop remains low-contrast scenery, never a competing primary action. */}
            <img
              src={`${import.meta.env.BASE_URL}sprites/skyline_layer1.png`}
              alt=""
              className="absolute left-0 right-0 bottom-0 w-full h-[230px] object-cover opacity-38 mix-blend-screen pointer-events-none"
            />
            <img
              src={`${import.meta.env.BASE_URL}sprites/skyline_layer2.png`}
              alt=""
              className="absolute left-0 right-0 bottom-0 w-full h-[160px] object-cover opacity-58 pointer-events-none"
            />
            <div className="relative z-10 flex w-full flex-col items-center justify-between">
            {/* Logo / mission framing */}
            <motion.div variants={titleItemVariants} className="relative text-center mb-1">
              <p className="mb-2 text-[9px] font-mono font-bold tracking-[0.34em] text-[#27d9ff]">NEON RAINWAY // SECTOR 09</p>
              <h1 className="text-5xl font-black text-[#d4e6f1] drop-shadow-[0_0_18px_rgba(39,217,255,0.44)] tracking-tighter leading-none mb-1">
                WARBOSS
              </h1>
              <h2 className="text-4xl font-black tracking-[0.17em] text-transparent bg-clip-text bg-gradient-to-r from-[#27d9ff] via-[#d4e6f1] to-[#df4bff]">HIGHWAY</h2>
              <div className="mx-auto mt-3 h-px w-28 bg-gradient-to-r from-transparent via-[#27d9ff] to-transparent" />
              <p className="text-[#8295aa] font-mono text-[11px] tracking-wide mt-3">
                SURVIVE THE STORM. CHARGE RUSH THROUGH CLOSE PASSES.
              </p>
            </motion.div>

            {/* Streak badge */}
            {streak >= 2 && (
              <motion.div
                variants={titleItemVariants}
                className="flex items-center gap-2 bg-accent/20 border border-accent/40 px-4 py-1.5 rounded-none text-accent font-mono text-xs font-bold"
              >
                🔥 DAY {streak} STREAK — BONUS ×{(1 + streak * 0.05).toFixed(2)} APPLIED
              </motion.div>
            )}

            {/* Car selection — carousel */}
            <motion.div variants={titleItemVariants} className="w-full space-y-2 mt-2">
              <p className="text-center text-xs font-mono text-muted-foreground tracking-widest uppercase">
                Select Vehicle
              </p>

              {/* Main card + arrows */}
              <div className="flex items-center gap-2">
                {/* Prev */}
                <button
                  onClick={() => {
                    const idx = carTypes.indexOf(selectedCar);
                    setSelectedCar(carTypes[(idx - 1 + carTypes.length) % carTypes.length]);
                  }}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center border border-border bg-card/50 hover:border-primary/60 active:scale-95 transition-all font-black text-lg text-muted-foreground hover:text-primary"
                  aria-label="Previous vehicle"
                >
                  ‹
                </button>

                {/* Selected card */}
                {(() => {
                  const stats = CAR_STATS[selectedCar];
                  return (
                    <div className="flex-1 flex flex-col items-center p-3 border border-[#27d9ff]/70 bg-[#0d1828]/75 shadow-[0_0_22px_rgba(39,217,255,0.18)]">
                      <CarPreview carType={selectedCar} selected={true} />
                      <span className="font-black text-sm tracking-widest mt-2 text-center leading-tight text-white">
                        {stats.label}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground mt-1 leading-tight text-center">
                        {stats.desc}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground/70 mt-1 leading-tight text-center whitespace-pre">
                        {stats.stats}
                      </span>
                    </div>
                  );
                })()}

                {/* Next */}
                <button
                  onClick={() => {
                    const idx = carTypes.indexOf(selectedCar);
                    setSelectedCar(carTypes[(idx + 1) % carTypes.length]);
                  }}
                  className="flex-shrink-0 w-9 h-9 flex items-center justify-center border border-border bg-card/50 hover:border-primary/60 active:scale-95 transition-all font-black text-lg text-muted-foreground hover:text-primary"
                  aria-label="Next vehicle"
                >
                  ›
                </button>
              </div>

              {/* Dot indicators */}
              <div className="flex items-center justify-center gap-2 pt-1">
                {carTypes.map((car) => (
                  <button
                    key={car}
                    type="button"
                    onClick={() => setSelectedCar(car)}
                    aria-label={CAR_STATS[car].label}
                    aria-current={selectedCar === car ? 'true' : undefined}
                    className="w-6 h-6 flex items-center justify-center"
                  >
                    <span
                      className={`block w-2 h-2 transition-all ${
                        selectedCar === car ? 'bg-[#27d9ff] scale-125 shadow-[0_0_8px_rgba(39,217,255,0.9)]' : 'bg-[#8295aa]/45 hover:bg-[#d4e6f1]/75'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </motion.div>

            {/* Personal best */}
            {personalBest > 0 && (
              <motion.div variants={titleItemVariants} className="font-mono text-xs text-muted-foreground text-center">
                PERSONAL BEST: <span className="text-primary font-bold">{personalBest.toLocaleString()}</span>
              </motion.div>
            )}

            {/* Daily challenge toggle */}
            <motion.div variants={titleItemVariants} className="flex items-center gap-3 mt-1">
              <button
                onClick={() => setIsDailyChallenge((v) => !v)}
                className={`relative w-12 h-6 rounded-none border-2 transition-all active:scale-[0.94] motion-reduce:active:scale-100 ${
                  isDailyChallenge ? 'border-[#27d9ff] bg-[#27d9ff]/15' : 'border-[#8295aa]/45 bg-[#0d1828]/60'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white transition-all ${isDailyChallenge ? 'left-6' : 'left-0.5'}`} />
              </button>
              <span className="font-mono text-xs text-muted-foreground">
                {isDailyChallenge ? (
                  <span className="text-[#27d9ff] font-bold">◆ DAILY CHALLENGE</span>
                ) : (
                  'DAILY CHALLENGE'
                )}
              </span>
            </motion.div>

            {isDailyChallenge && (
              <motion.div variants={titleItemVariants} className="w-full border border-[#27d9ff]/40 bg-[#0d1828]/75 p-3 text-center">
                <p className="text-[#27d9ff] font-black text-xs tracking-widest mb-1">{dailyModifier.name}</p>
                <p className="text-[#d4e6f1]/75 text-[10px] font-mono leading-tight">{dailyModifier.description}</p>
              </motion.div>
            )}

            {/* Virtual joystick toggle */}
            <motion.div variants={titleItemVariants} className="flex items-center gap-3 mt-1">
              <button
                onClick={() => setJoystickEnabled((v) => !v)}
                className={`relative w-12 h-6 rounded-none border-2 transition-all active:scale-[0.94] motion-reduce:active:scale-100 ${
                  joystickEnabled ? 'border-blue-500 bg-blue-900/40' : 'border-border bg-card/30'
                }`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white transition-all ${joystickEnabled ? 'left-6' : 'left-0.5'}`} />
              </button>
              <span className="font-mono text-xs text-muted-foreground">
                {joystickEnabled ? (
                  <span className="text-blue-400 font-bold">VIRTUAL JOYSTICK</span>
                ) : (
                  'VIRTUAL JOYSTICK'
                )}
              </span>
            </motion.div>

            {/* Upgrades / Garage */}
            <motion.div variants={titleItemVariants} className="w-full space-y-2 mt-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase">Garage</p>
                <p className="text-xs font-mono text-accent font-bold">SCRAP: {scrap.toLocaleString()}</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => purchaseUpgrade('speed')}
                  disabled={scrap < 100 || upgrades.speed >= 5}
                  className={`flex flex-col items-center p-2 border-2 transition-all active:scale-[0.94] motion-reduce:active:scale-100 ${scrap >= 100 && upgrades.speed < 5 ? 'border-accent bg-accent/10 hover:bg-accent/20' : 'border-border bg-card/30 opacity-60'}`}
                >
                  <Gauge className="w-3 h-3 mb-1" />
                  <span className="text-[10px] font-mono font-bold">SPEED</span>
                  <span className="text-[10px] font-mono text-muted-foreground">Lv {upgrades.speed}/5</span>
                </button>
                <button
                  onClick={() => purchaseUpgrade('armor')}
                  disabled={scrap < 100 || upgrades.armor >= 5}
                  className={`flex flex-col items-center p-2 border-2 transition-all active:scale-[0.94] motion-reduce:active:scale-100 ${scrap >= 100 && upgrades.armor < 5 ? 'border-accent bg-accent/10 hover:bg-accent/20' : 'border-border bg-card/30 opacity-60'}`}
                >
                  <Shield className="w-3 h-3 mb-1" />
                  <span className="text-[10px] font-mono font-bold">ARMOR</span>
                  <span className="text-[10px] font-mono text-muted-foreground">Lv {upgrades.armor}/5</span>
                </button>
                <button
                  onClick={() => purchaseUpgrade('handling')}
                  disabled={scrap < 100 || upgrades.handling >= 5}
                  className={`flex flex-col items-center p-2 border-2 transition-all active:scale-[0.94] motion-reduce:active:scale-100 ${scrap >= 100 && upgrades.handling < 5 ? 'border-accent bg-accent/10 hover:bg-accent/20' : 'border-border bg-card/30 opacity-60'}`}
                >
                  <ArrowUp className="w-3 h-3 mb-1" />
                  <span className="text-[10px] font-mono font-bold">HANDLING</span>
                  <span className="text-[10px] font-mono text-muted-foreground">Lv {upgrades.handling}/5</span>
                </button>
              </div>
              <p className="text-[10px] font-mono text-muted-foreground text-center">100 scrap per upgrade. Upgrades are per vehicle.</p>
            </motion.div>

            {/* Start */}
            <Button
              asChild
              size="lg"
              className="w-full h-16 text-2xl font-black tracking-[0.14em] rounded-none border border-[#27d9ff] bg-[#27d9ff] text-[#050816] hover:bg-transparent hover:text-[#27d9ff] transition-all uppercase mt-2 shadow-[0_0_24px_rgba(39,217,255,0.25)]"
            >
              {/* framer-motion owns this element's `transform` (the y-offset
                  stagger-in variant), so press feedback uses whileTap instead
                  of the CSS active:scale in buttonVariants — an inline style
                  and a CSS :active rule both targeting transform would
                  conflict, and the inline style always wins, silently
                  no-op-ing the CSS one. */}
              <motion.button
                variants={titleItemVariants}
                whileTap={{ scale: prefersReducedMotion ? 1 : 0.97 }}
                onClick={startGame}
              >
                START ENGINE
              </motion.button>
            </Button>
            </div>
          </motion.div>
        )}

        {/* Game Over screen */}
        {screen === 'gameover' && gameOverState && (
          <motion.div
            key="gameover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { duration: 0.25, ease: ENTER_EASE }
            }
            className="absolute inset-0 z-10"
          >
            <GameOverOverlay
              score={gameOverState.score}
              distance={gameOverState.distance}
              powerupsUsed={gameOverState.powerUpsUsed}
              achievementsEarned={gameOverState.achievementsEarned}
              selectedCar={gameOverState.selectedCar}
              isDailyChallenge={gameOverState.isDailyChallenge}
              personalBest={personalBest}
              isNewRecord={newRecord}
              scrapEarned={scrapEarned}
              onRestart={startGame}
              onBack={() => { stopAudio('gameplay'); setScreen('title'); }}
            />
          </motion.div>
        )}
        </AnimatePresence>

        {/* Audio toggle */}
        <button
          onClick={handleToggleMute}
          className="absolute top-4 right-4 z-20 p-2 bg-black/50 text-white rounded-full border border-border/50 hover:bg-black/80 transition-[background-color,transform] duration-150 active:scale-90 motion-reduce:active:scale-100"
        >
          {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>

        {/* Pause button */}
        {screen === 'playing' && (
          <button
            onClick={togglePause}
            className="absolute top-4 left-4 z-20 p-2 bg-black/50 text-white rounded-full border border-border/50 hover:bg-black/80 transition-[background-color,transform] duration-150 active:scale-90 motion-reduce:active:scale-100"
          >
            {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
          </button>
        )}

        {/* Pause overlay */}
        <AnimatePresence>
          {isPaused && screen === 'playing' && (
            <motion.div
              key="pause"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
              className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 p-6"
            >
              <h2 className="text-4xl font-black text-white tracking-widest mb-8 drop-shadow-[0_0_15px_rgba(220,38,38,0.6)]">
                PAUSED
              </h2>
              <div className="w-full max-w-xs space-y-3">
                <Button
                  onClick={togglePause}
                  className="w-full h-14 text-lg font-black tracking-widest bg-[#27d9ff] hover:bg-[#27d9ff]/80 text-[#050816] rounded-none border border-[#27d9ff]"
                >
                  <Play className="w-5 h-5 mr-2" /> RESUME
                </Button>
                <Button
                  onClick={() => { engineRef.current?.cleanup(); setIsPaused(false); startGame(); }}
                  variant="outline"
                  className="w-full h-12 rounded-none border-border font-mono text-sm hover:bg-secondary"
                >
                  <RotateCcw className="w-4 h-4 mr-2" /> RESTART
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setIsMuted(toggleMute())}
                    className="flex items-center justify-center gap-2 h-12 border-2 border-border bg-card/50 hover:bg-card text-xs font-mono font-bold text-white uppercase"
                  >
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    {isMuted ? 'SOUND OFF' : 'SOUND ON'}
                  </button>
                  <button
                    onClick={() => setJoystickEnabled((v) => !v)}
                    className="flex items-center justify-center gap-2 h-12 border-2 border-border bg-card/50 hover:bg-card text-xs font-mono font-bold text-white uppercase"
                  >
                    <Gamepad2 className="w-4 h-4" />
                    {joystickEnabled ? 'JOYSTICK ON' : 'JOYSTICK OFF'}
                  </button>
                </div>
                <Button
                  onClick={() => { engineRef.current?.cleanup(); setIsPaused(false); stopAudio('gameplay'); setScreen('title'); }}
                  variant="outline"
                  className="w-full h-12 rounded-none border-border font-mono text-sm hover:bg-secondary"
                >
                  <Home className="w-4 h-4 mr-2" /> EXIT TO MENU
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tutorial overlay */}
        <AnimatePresence>
          {showTutorial && screen === 'title' && (
            <motion.div
              key="tutorial"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.25, ease: ENTER_EASE }}
              className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#050816]/95 p-6"
            >
              <div className="w-full max-w-sm space-y-5">
                <div className="text-center">
                  <h2 className="text-3xl font-black text-[#27d9ff] tracking-tighter mb-1">NIGHT DRIVE BRIEF</h2>
                  <p className="text-[#8295aa] font-mono text-xs">SURVIVAL TRAINING // SECTOR 09</p>
                </div>
                <div className="space-y-4">
                  <div className="flex items-start gap-3 border border-border p-3 bg-card/50">
                    <div className="text-2xl">🎮</div>
                    <div>
                      <p className="font-bold text-sm text-white">DRIVE FREE</p>
                      <p className="text-xs text-muted-foreground">WASD / Arrows or drag to move. Up speeds you up, down slows you down.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 border border-border p-3 bg-card/50">
                    <div className="text-2xl">⚡</div>
                    <div>
                      <p className="font-bold text-sm text-white">NEAR-MISS COMBOS</p>
                      <p className="text-xs text-muted-foreground">Pass close to vehicles without hitting them to build combos and score.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 border border-border p-3 bg-card/50">
                    <div className="text-2xl">🛡</div>
                    <div>
                      <p className="font-bold text-sm text-white">POWER-UPS</p>
                      <p className="text-xs text-muted-foreground">Grab shields, slow-mo, score blast, and extra lives.</p>
                    </div>
                  </div>
                </div>
                <Button
                  onClick={() => { setShowTutorial(false); Settings.setTutorialSeen(true); }}
                  className="w-full h-14 text-lg font-black tracking-widest bg-[#27d9ff] hover:bg-[#27d9ff]/80 text-[#050816] rounded-none border border-[#27d9ff]"
                >
                  GOT IT
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
