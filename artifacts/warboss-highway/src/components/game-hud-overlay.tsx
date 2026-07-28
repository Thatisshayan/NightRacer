import { useEffect, useRef } from 'react';
import { GameEngine, POP_DURATION_MS, POWERUP_DURATION_MS, type PowerUpType } from '@workspace/game-core';

// Ease-out pop scale — mirrors the old Canvas 2D renderer.ts helper of the
// same name, now driving a CSS transform instead of a ctx.scale().
const popScale = (popMs: number, peak: number) => {
  const t = Math.max(0, Math.min(1, popMs / POP_DURATION_MS));
  return 1 + (peak - 1) * t * t;
};

// Keyed off Exclude<PowerUpType, 'EXTRA_LIFE'> (via POWERUP_DURATION_MS) so
// a lookup for an unsupported variant is a compile error, not a silent
// `undefined` at runtime. EXTRA_LIFE never sets activePowerUp — see
// GameEngine.collectPowerUp().
const POWERUP_META: Record<keyof typeof POWERUP_DURATION_MS, { color: string; label: string }> = {
  SHIELD: { color: '#00ffff', label: '\u{1F6E1} SHIELD' },
  SLOWMO: { color: '#ffff00', label: '⏱ SLOW-MO' },
  SCORE_BLAST: { color: '#ffaa00', label: '★ SCORE BLAST' },
};

// Renders the score/combo/lives/power-up bar/speedometer HUD, plus the
// level-up flash, boss-warning, and near-miss overlays that used to live in
// GameEngine.draw()'s Canvas 2D path — see the "Warboss Highway Pixi
// rewrite" plan, Phase D. Reads GameEngine.getState() directly via its own
// rAF loop and writes to the DOM imperatively (refs, not useState) so this
// component never re-renders the React tree at 60fps.
export function GameHudOverlay({ engine }: { engine: GameEngine }) {
  const scoreRef = useRef<HTMLDivElement>(null);
  const distRef = useRef<HTMLDivElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const dailyBadgeRef = useRef<HTMLDivElement>(null);
  const livesRef = useRef<HTMLDivElement>(null);
  const oilWarningRef = useRef<HTMLDivElement>(null);
  const powerUpBarRef = useRef<HTMLDivElement>(null);
  const powerUpLabelRef = useRef<HTMLDivElement>(null);
  const powerUpFillRef = useRef<HTMLDivElement>(null);
  const powerUpTimerRef = useRef<HTMLDivElement>(null);
  const speedArcRef = useRef<SVGCircleElement>(null);
  const speedTextRef = useRef<HTMLDivElement>(null);
  const levelUpRef = useRef<HTMLDivElement>(null);
  const levelUpTextRef = useRef<HTMLDivElement>(null);
  const bossWarningRef = useRef<HTMLDivElement>(null);
  const nearMissRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId = 0;
    const ARC_CIRCUMFERENCE = 2 * Math.PI * 36 * 0.75; // 270° of a r=36 circle

    const tick = () => {
      const state = engine.getState();

      if (scoreRef.current) {
        scoreRef.current.textContent = `SCORE: ${Math.floor(state.score)}`;
        scoreRef.current.style.color = state.activePowerUp === 'SCORE_BLAST' ? '#ffaa00' : '#ffffff';
        const s = popScale(state.scorePop, 1.3);
        scoreRef.current.style.transform = `scale(${s})`;
      }
      if (distRef.current) {
        distRef.current.textContent = `DIST: ${Math.floor(state.distance)}m  SPD: ${state.speedMultiplier.toFixed(1)}×`;
      }
      if (comboRef.current) {
        const show = state.combo > 1;
        comboRef.current.style.display = show ? 'block' : 'none';
        if (show) {
          comboRef.current.textContent = `COMBO ×${state.combo}`;
          comboRef.current.style.transform = `scale(${popScale(state.comboPop, 1.5)})`;
        }
      }
      if (dailyBadgeRef.current) {
        dailyBadgeRef.current.style.display = state.isDailyChallenge ? 'block' : 'none';
      }
      if (livesRef.current) {
        for (let i = 0; i < livesRef.current.children.length; i++) {
          (livesRef.current.children[i] as HTMLElement).style.visibility = i < state.lives ? 'visible' : 'hidden';
        }
      }
      if (oilWarningRef.current) {
        oilWarningRef.current.style.display = state.player.oilSlicked ? 'block' : 'none';
      }

      // EXTRA_LIFE is applied instantly in collectPowerUp() and never sets
      // activePowerUp, but the type is still PowerUpType | null here — guard
      // it explicitly rather than relying on that invariant staying true.
      const powerUp: Exclude<PowerUpType, 'EXTRA_LIFE'> | null =
        state.activePowerUp && state.activePowerUp !== 'EXTRA_LIFE' && state.powerUpTimer > 0
          ? state.activePowerUp
          : null;
      if (powerUpBarRef.current) {
        powerUpBarRef.current.style.display = powerUp ? 'block' : 'none';
        if (powerUp) {
          const meta = POWERUP_META[powerUp];
          const barFill = Math.max(0, (state.powerUpTimer / POWERUP_DURATION_MS[powerUp]) * 100);
          const seconds = Math.max(0, Math.ceil(state.powerUpTimer / 1000));
          if (powerUpLabelRef.current) {
            powerUpLabelRef.current.textContent = meta.label;
            powerUpLabelRef.current.style.color = meta.color;
          }
          if (powerUpFillRef.current) {
            powerUpFillRef.current.style.width = `${barFill}%`;
            powerUpFillRef.current.style.backgroundColor = meta.color;
          }
          if (powerUpTimerRef.current) powerUpTimerRef.current.textContent = `${seconds}s`;
        }
      }

      const speedRatio = Math.min(1, state.speedMultiplier / 3);
      if (speedArcRef.current) {
        speedArcRef.current.style.strokeDashoffset = String(ARC_CIRCUMFERENCE * (1 - speedRatio));
        speedArcRef.current.style.stroke =
          state.speedMultiplier >= 2.5 ? '#ff3333' : state.speedMultiplier >= 1.8 ? '#ffaa00' : '#55ffaa';
      }
      if (speedTextRef.current) speedTextRef.current.textContent = `${state.speedMultiplier.toFixed(1)}×`;

      if (levelUpRef.current) {
        const show = state.levelUpFlash > 0;
        levelUpRef.current.style.display = show ? 'block' : 'none';
        if (show) {
          const t = state.levelUpFlash / 1800;
          levelUpRef.current.style.backgroundColor = `rgba(255, 130, 0, ${Math.sin(t * Math.PI) * 0.35})`;
        }
        if (levelUpTextRef.current) {
          levelUpTextRef.current.style.display = state.levelUpFlash > 1200 ? 'block' : 'none';
          levelUpTextRef.current.textContent = state.levelUpText;
        }
      }

      if (bossWarningRef.current) {
        const show = state.bossWarning > 0;
        bossWarningRef.current.style.display = show ? 'block' : 'none';
        if (show) {
          const blink = Math.floor(performance.now() / 180) % 2 === 0;
          bossWarningRef.current.style.backgroundColor = blink ? 'rgba(180, 0, 0, 0.28)' : 'transparent';
        }
      }

      if (nearMissRef.current) {
        const show = state.combo > 1;
        nearMissRef.current.style.display = show ? 'block' : 'none';
        if (show) {
          nearMissRef.current.style.opacity = String(Math.min(1, state.comboTimer / 800));
          nearMissRef.current.style.fontSize = `${Math.min(24, 14 + state.combo)}px`;
          nearMissRef.current.textContent = `NEAR MISS ×${state.combo}!`;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [engine]);

  return (
    <div className="absolute inset-0 pointer-events-none select-none font-mono text-white z-10">
      {/* Top HUD bar */}
      <div className="absolute top-0 left-0 right-0 h-[72px] bg-black/55">
        <div ref={scoreRef} className="absolute left-[15px] top-[14px] origin-left text-2xl font-['Russo_One',sans-serif]" />
        <div ref={distRef} className="absolute left-[15px] top-[44px] text-[13px] text-[#888]" />
        <div ref={comboRef} className="absolute left-1/2 top-[22px] -translate-x-1/2 text-[13px] text-[#ffee22]" style={{ display: 'none' }} />
        <div ref={dailyBadgeRef} className="absolute left-1/2 top-[50px] -translate-x-1/2 text-[10px] text-[#55ffaa]" style={{ display: 'none' }}>
          {'◆ DAILY CHALLENGE'}
        </div>
        <div ref={livesRef} className="absolute right-[15px] top-[15px] flex flex-row-reverse gap-[4px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="text-[#cc0000] text-xl leading-none">{'♥'}</span>
          ))}
        </div>
        <div ref={oilWarningRef} className="absolute right-[12px] top-[48px] text-xs text-[#8888ff]" style={{ display: 'none' }}>
          {'⚠ SLIPPING'}
        </div>
      </div>

      {/* Power-up bar (bottom left) */}
      <div ref={powerUpBarRef} className="absolute left-[10px] bottom-[16px] w-[210px] h-[48px] bg-black/65 rounded-sm p-2" style={{ display: 'none' }}>
        <div ref={powerUpLabelRef} className="text-base font-['Russo_One',sans-serif]" />
        <div className="mt-1 h-2 w-[140px] bg-white/15 rounded-sm overflow-hidden">
          <div ref={powerUpFillRef} className="h-full" style={{ width: '0%' }} />
        </div>
        <div ref={powerUpTimerRef} className="absolute right-3 bottom-2 text-xs" />
      </div>

      {/* Speedometer gauge (bottom right) */}
      <div className="absolute right-[12px] bottom-[12px] w-[72px] h-[72px]">
        <svg width="72" height="72" className="absolute inset-0 -rotate-[135deg]">
          <circle cx="36" cy="36" r="36" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="6"
            strokeDasharray={`${2 * Math.PI * 36 * 0.75} ${2 * Math.PI * 36}`} />
          <circle ref={speedArcRef} cx="36" cy="36" r="36" fill="none" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 36 * 0.75} ${2 * Math.PI * 36}`} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div ref={speedTextRef} className="text-sm font-bold" />
          <div className="text-[8px] text-[#888]">SPD</div>
        </div>
      </div>

      {/* Level-up flash */}
      <div ref={levelUpRef} className="absolute inset-0 flex items-center justify-center" style={{ display: 'none' }}>
        <div ref={levelUpTextRef} className="text-3xl font-bold font-['Russo_One',sans-serif]" style={{ textShadow: '0 0 25px #ff8800' }} />
      </div>

      {/* Boss warning */}
      <div ref={bossWarningRef} className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ display: 'none' }}>
        <div className="text-[28px] font-bold text-[#ff2222] font-['Russo_One',sans-serif]" style={{ textShadow: '0 0 30px #ff0000' }}>
          {'⚠ WARBOSS INCOMING ⚠'}
        </div>
        <div className="text-base text-[#ffaaaa]">BRACE YOURSELF</div>
      </div>

      {/* Near-miss combo text */}
      <div ref={nearMissRef} className="absolute left-1/2 bottom-[100px] -translate-x-1/2 font-bold text-[#ffff44] font-['Russo_One',sans-serif]" style={{ display: 'none', textShadow: '0 0 12px #ff8800' }} />
    </div>
  );
}
