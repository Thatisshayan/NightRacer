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
  const rushFillRef = useRef<HTMLDivElement>(null);
  const rushButtonRef = useRef<HTMLButtonElement>(null);
  const rushLabelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId = 0;
    const ARC_CIRCUMFERENCE = 2 * Math.PI * 32.5 * 0.75; // 270° of a r=32.5 circle — must match the JSX circle radius below

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
          const el = livesRef.current.children[i] as HTMLElement;
          const alive = i < state.lives;
          // Skulls ported from the mobile HUD pass — a heart icon read as
          // generic mobile-game chrome against the grimdark 40k styling.
          // Remaining lives get a bone-white skull with a faint red glow;
          // lost lives fade to a dim outline instead of disappearing, so
          // the pip stays visible (mirrors HudOverlay.tsx's heartAlive/
          // heartLost split).
          el.style.color = alive ? '#e8ded0' : 'rgba(255,255,255,0.15)';
          el.style.textShadow = alive ? '0 0 4px rgba(255,40,20,0.85)' : 'none';
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
        // Amber-at-rest instead of mint green — ported from the mobile HUD
        // pass (HudOverlay.tsx): mint read as a generic fitness-app accent,
        // tonally off against the grimdark palette everywhere else.
        speedArcRef.current.style.stroke =
          state.speedMultiplier >= 2.5 ? '#ff3333' : state.speedMultiplier >= 1.8 ? '#ff8800' : '#cc8833';
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

      const rushReady = state.rushCharge >= 100 && state.rushTimer <= 0;
      if (rushFillRef.current) {
        rushFillRef.current.style.width = `${state.rushTimer > 0 ? 100 : state.rushCharge}%`;
        rushFillRef.current.style.background = state.rushTimer > 0
          ? 'linear-gradient(90deg, #27d9ff, #df4bff)'
          : 'linear-gradient(90deg, #183148, #27d9ff)';
      }
      if (rushButtonRef.current) {
        rushButtonRef.current.disabled = !rushReady;
        rushButtonRef.current.style.opacity = rushReady || state.rushTimer > 0 ? '1' : '0.68';
        rushButtonRef.current.style.borderColor = state.rushTimer > 0 ? '#df4bff' : rushReady ? '#27d9ff' : 'rgba(130,149,170,0.55)';
        rushButtonRef.current.style.boxShadow = rushReady
          ? '0 0 18px rgba(39,217,255,0.42)'
          : state.rushTimer > 0 ? '0 0 18px rgba(223,75,255,0.42)' : 'none';
      }
      if (rushLabelRef.current) rushLabelRef.current.textContent = state.rushTimer > 0 ? 'RUSH ACTIVE' : rushReady ? 'RUSH — TAP' : `RUSH ${Math.floor(state.rushCharge)}%`;

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [engine]);

  return (
    <div className="absolute inset-0 pointer-events-none select-none font-mono text-white z-10">
      {/* Top HUD bar */}
      <div className="absolute top-0 left-0 right-0 h-[72px] bg-black/55">
        <div
          ref={scoreRef}
          className="absolute left-[15px] top-[14px] origin-left text-2xl font-['Russo_One',sans-serif]"
          style={{ textShadow: '0 2px 0 rgba(0,0,0,0.9)' }}
        />
        <div ref={distRef} className="absolute left-[15px] top-[44px] text-[13px] text-[#888]" style={{ textShadow: '0 1px 0 rgba(0,0,0,0.9)' }} />
        <div
          ref={comboRef}
          className="absolute left-1/2 top-[22px] -translate-x-1/2 text-[13px] text-[#ffee22]"
          style={{ display: 'none', textShadow: '0 1px 0 rgba(0,0,0,0.9)' }}
        />
        <div ref={dailyBadgeRef} className="absolute left-1/2 top-[50px] -translate-x-1/2 text-[10px] text-[#55ffaa]" style={{ display: 'none' }}>
          {'◆ DAILY CHALLENGE'}
        </div>
        <div ref={livesRef} className="absolute right-[15px] top-[15px] flex flex-row-reverse gap-[4px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="text-xl leading-none">{'☠'}</span>
          ))}
        </div>
        <div ref={oilWarningRef} className="absolute right-[12px] top-[48px] text-xs text-[#8888ff]" style={{ display: 'none' }}>
          {'⚠ SLIPPING'}
        </div>
      </div>

      {/* Earned Rush control. It is deliberately a physical tap target on
          touch devices and keyboard players can activate it with Space. */}
      <button
        ref={rushButtonRef}
        type="button"
        onClick={() => engine.triggerRush()}
        aria-label="Activate Rush when charged"
        className="pointer-events-auto absolute left-1/2 bottom-[18px] -translate-x-1/2 w-[154px] h-[52px] overflow-hidden border bg-[#050816]/90 text-white transition-[opacity,box-shadow,border-color] duration-150 active:scale-[0.96] motion-reduce:active:scale-100"
      >
        <div ref={rushFillRef} className="absolute inset-y-0 left-0 w-0 opacity-70 transition-[width] duration-100" />
        <span ref={rushLabelRef} className="relative z-10 text-[11px] font-bold tracking-[0.16em]">RUSH 0%</span>
        <span className="relative z-10 block mt-0.5 text-[8px] tracking-[0.2em] text-[#d4e6f1]/75">CLOSE PASSES CHARGE</span>
      </button>

      {/* Power-up bar (bottom left) */}
      <div ref={powerUpBarRef} className="absolute left-[10px] bottom-[16px] w-[210px] h-[48px] bg-black/65 rounded-sm p-2" style={{ display: 'none' }}>
        <div ref={powerUpLabelRef} className="text-base font-['Russo_One',sans-serif]" />
        <div className="mt-1 h-2 w-[140px] bg-white/15 rounded-sm overflow-hidden">
          <div ref={powerUpFillRef} className="h-full" style={{ width: '0%' }} />
        </div>
        <div ref={powerUpTimerRef} className="absolute right-3 bottom-2 text-xs" />
      </div>

      {/* Speedometer gauge (bottom right) — a dark metal bezel behind the
          arc so it reads as an instrument-panel gauge welded onto the HUD
          instead of a bare, floating fitness-app ring (ported from the
          mobile HUD pass's speedBezel). */}
      <div className="absolute right-[12px] bottom-[12px] w-[72px] h-[72px]">
        <div className="absolute inset-[4px] rounded-full bg-black/55 border border-white/10" />
        {/* r=32.5, not 36 — a 7px stroke on a r=36 circle in a 72px SVG
            extends to r=39.5, clipping ~3.5px of the ring off each edge
            (CodeRabbit catch: this stroke width was bumped from 6 without
            adjusting the radius to still fit). 32.5+3.5=36 fits exactly. */}
        <svg width="72" height="72" className="absolute inset-0 -rotate-[135deg]">
          <circle cx="36" cy="36" r="32.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7"
            strokeDasharray={`${2 * Math.PI * 32.5 * 0.75} ${2 * Math.PI * 32.5}`} />
          <circle ref={speedArcRef} cx="36" cy="36" r="32.5" fill="none" strokeWidth="7" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 32.5 * 0.75} ${2 * Math.PI * 32.5}`} />
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
      <div ref={nearMissRef} className="absolute left-1/2 bottom-[92px] -translate-x-1/2 font-bold text-[#df4bff] font-['Russo_One',sans-serif]" style={{ display: 'none', textShadow: '0 0 12px #27d9ff' }} />
    </div>
  );
}
