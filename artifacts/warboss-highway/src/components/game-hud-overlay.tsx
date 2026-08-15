import { useEffect, useRef } from 'react';
import { GameEngine, POP_DURATION_MS, POWERUP_DURATION_MS, type GameState, type PowerUpType } from '@workspace/game-core';

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

type HudNodes = {
  score: { current: HTMLDivElement | null };
  distance: { current: HTMLDivElement | null };
  combo: { current: HTMLDivElement | null };
  dailyBadge: { current: HTMLDivElement | null };
  lives: { current: HTMLDivElement | null };
  oilWarning: { current: HTMLDivElement | null };
  powerUpBar: { current: HTMLDivElement | null };
  powerUpLabel: { current: HTMLDivElement | null };
  powerUpFill: { current: HTMLDivElement | null };
  powerUpTimer: { current: HTMLDivElement | null };
  speedArc: { current: SVGCircleElement | null };
  speedText: { current: HTMLDivElement | null };
  levelUp: { current: HTMLDivElement | null };
  levelUpText: { current: HTMLDivElement | null };
  bossWarning: { current: HTMLDivElement | null };
  nearMiss: { current: HTMLDivElement | null };
  rushFill: { current: HTMLDivElement | null };
  rushButton: { current: HTMLButtonElement | null };
  rushLabel: { current: HTMLSpanElement | null };
};

function syncCoreHud(state: GameState, nodes: HudNodes) {
  if (nodes.score.current) {
    nodes.score.current.textContent = `SCORE: ${Math.floor(state.score)}`;
    nodes.score.current.style.color = state.activePowerUp === 'SCORE_BLAST' ? '#ffaa00' : '#ffffff';
    nodes.score.current.style.transform = `scale(${popScale(state.scorePop, 1.3)})`;
  }
  if (nodes.distance.current) nodes.distance.current.textContent = `DIST: ${Math.floor(state.distance)}m  SPD: ${state.speedMultiplier.toFixed(1)}×`;
  if (nodes.combo.current) {
    const show = state.combo > 1;
    nodes.combo.current.style.display = show ? 'block' : 'none';
    if (show) {
      nodes.combo.current.textContent = `COMBO ×${state.combo}`;
      nodes.combo.current.style.transform = `scale(${popScale(state.comboPop, 1.5)})`;
    }
  }
  if (nodes.dailyBadge.current) nodes.dailyBadge.current.style.display = state.isDailyChallenge ? 'block' : 'none';
  if (nodes.lives.current) {
    for (let i = 0; i < nodes.lives.current.children.length; i++) {
      const life = nodes.lives.current.children[i] as HTMLElement;
      const alive = i < state.lives;
      life.style.color = alive ? '#e8ded0' : 'rgba(255,255,255,0.15)';
      life.style.textShadow = alive ? '0 0 4px rgba(255,40,20,0.85)' : 'none';
    }
  }
  if (nodes.oilWarning.current) nodes.oilWarning.current.style.display = state.player.oilSlicked ? 'block' : 'none';
}

function syncPowerUpHud(state: GameState, nodes: HudNodes) {
  const powerUp: Exclude<PowerUpType, 'EXTRA_LIFE'> | null =
    state.activePowerUp && state.activePowerUp !== 'EXTRA_LIFE' && state.powerUpTimer > 0 ? state.activePowerUp : null;
  if (!nodes.powerUpBar.current) return;
  nodes.powerUpBar.current.style.display = powerUp ? 'block' : 'none';
  if (!powerUp) return;
  const meta = POWERUP_META[powerUp];
  const barFill = Math.max(0, (state.powerUpTimer / POWERUP_DURATION_MS[powerUp]) * 100);
  if (nodes.powerUpLabel.current) {
    nodes.powerUpLabel.current.textContent = meta.label;
    nodes.powerUpLabel.current.style.color = meta.color;
  }
  if (nodes.powerUpFill.current) {
    nodes.powerUpFill.current.style.width = `${barFill}%`;
    nodes.powerUpFill.current.style.backgroundColor = meta.color;
  }
  if (nodes.powerUpTimer.current) nodes.powerUpTimer.current.textContent = `${Math.max(0, Math.ceil(state.powerUpTimer / 1000))}s`;
}

function syncSpeedHud(state: GameState, nodes: HudNodes, arcCircumference: number) {
  if (nodes.speedArc.current) {
    nodes.speedArc.current.style.strokeDashoffset = String(arcCircumference * (1 - Math.min(1, state.speedMultiplier / 3)));
    nodes.speedArc.current.style.stroke = state.speedMultiplier >= 2.5 ? '#ff3333' : state.speedMultiplier >= 1.8 ? '#ff8800' : '#cc8833';
  }
  if (nodes.speedText.current) nodes.speedText.current.textContent = `${state.speedMultiplier.toFixed(1)}×`;
}

function syncLevelUpHud(state: GameState, nodes: HudNodes) {
  if (nodes.levelUp.current) {
    const show = state.levelUpFlash > 0;
    nodes.levelUp.current.style.display = show ? 'block' : 'none';
    if (show) nodes.levelUp.current.style.backgroundColor = `rgba(255, 130, 0, ${Math.sin((state.levelUpFlash / 1800) * Math.PI) * 0.35})`;
  }
  if (nodes.levelUpText.current) {
    nodes.levelUpText.current.style.display = state.levelUpFlash > 1200 ? 'block' : 'none';
    nodes.levelUpText.current.textContent = state.levelUpText;
  }
}

function syncWarningsHud(state: GameState, nodes: HudNodes, now: number) {
  if (nodes.bossWarning.current) {
    const show = state.bossWarning > 0;
    nodes.bossWarning.current.style.display = show ? 'block' : 'none';
    if (show) nodes.bossWarning.current.style.backgroundColor = Math.floor(now / 180) % 2 === 0 ? 'rgba(180, 0, 0, 0.28)' : 'transparent';
  }
  if (nodes.nearMiss.current) {
    const show = state.combo > 1;
    nodes.nearMiss.current.style.display = show ? 'block' : 'none';
    if (show) {
      nodes.nearMiss.current.style.opacity = String(Math.min(1, state.comboTimer / 800));
      nodes.nearMiss.current.style.fontSize = `${Math.min(24, 14 + state.combo)}px`;
      nodes.nearMiss.current.textContent = `NEAR MISS ×${state.combo}!`;
    }
  }
}

function syncRushHud(state: GameState, nodes: HudNodes) {
  const rushReady = state.rushCharge >= 100 && state.rushTimer <= 0;
  if (nodes.rushFill.current) {
    nodes.rushFill.current.style.width = `${state.rushTimer > 0 ? 100 : state.rushCharge}%`;
    nodes.rushFill.current.style.background = state.rushTimer > 0 ? 'linear-gradient(90deg, #27d9ff, #df4bff)' : 'linear-gradient(90deg, #183148, #27d9ff)';
  }
  if (nodes.rushButton.current) {
    nodes.rushButton.current.disabled = !rushReady;
    nodes.rushButton.current.style.opacity = rushReady || state.rushTimer > 0 ? '1' : '0.68';
    nodes.rushButton.current.style.borderColor = state.rushTimer > 0 ? '#df4bff' : rushReady ? '#27d9ff' : 'rgba(130,149,170,0.55)';
    nodes.rushButton.current.style.boxShadow = rushReady ? '0 0 18px rgba(39,217,255,0.42)' : state.rushTimer > 0 ? '0 0 18px rgba(223,75,255,0.42)' : 'none';
  }
  if (nodes.rushLabel.current) nodes.rushLabel.current.textContent = state.rushTimer > 0 ? 'RUSH ACTIVE' : rushReady ? 'RUSH — TAP' : `RUSH ${Math.floor(state.rushCharge)}%`;
}

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

    const nodes: HudNodes = {
      score: scoreRef, distance: distRef, combo: comboRef, dailyBadge: dailyBadgeRef,
      lives: livesRef, oilWarning: oilWarningRef, powerUpBar: powerUpBarRef,
      powerUpLabel: powerUpLabelRef, powerUpFill: powerUpFillRef, powerUpTimer: powerUpTimerRef,
      speedArc: speedArcRef, speedText: speedTextRef, levelUp: levelUpRef, levelUpText: levelUpTextRef,
      bossWarning: bossWarningRef, nearMiss: nearMissRef, rushFill: rushFillRef,
      rushButton: rushButtonRef, rushLabel: rushLabelRef,
    };
    const tick = () => {
      const state = engine.getState();
      syncCoreHud(state, nodes);
      syncPowerUpHud(state, nodes);
      syncSpeedHud(state, nodes, ARC_CIRCUMFERENCE);
      syncLevelUpHud(state, nodes);
      syncWarningsHud(state, nodes, performance.now());
      syncRushHud(state, nodes);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [engine]);

  return (
    <div className="absolute inset-0 pointer-events-none select-none font-mono text-white z-10">
      {/* Top HUD bar */}
      <div className="absolute top-0 left-0 right-0 h-[86px] bg-black/60">
        <div
          ref={scoreRef}
          className="absolute left-[62px] top-[12px] origin-left text-2xl font-['Russo_One',sans-serif]"
          style={{ textShadow: '0 2px 0 rgba(0,0,0,0.9)' }}
        />
        <div ref={distRef} className="absolute left-[62px] top-[48px] text-[14px] font-semibold tracking-wide text-[#d4e6f1]" style={{ textShadow: '0 1px 0 rgba(0,0,0,0.9)' }} />
        <div
          ref={comboRef}
          className="absolute left-1/2 top-[20px] -translate-x-1/2 text-[15px] font-bold text-[#ffee22]"
          style={{ display: 'none', textShadow: '0 1px 0 rgba(0,0,0,0.9)' }}
        />
        <div ref={dailyBadgeRef} className="absolute left-1/2 top-[52px] -translate-x-1/2 text-[11px] text-[#55ffaa]" style={{ display: 'none' }}>
          {'◆ DAILY CHALLENGE'}
        </div>
        <div ref={livesRef} className="absolute right-[62px] top-[14px] flex flex-row-reverse gap-[6px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="text-2xl leading-none">{'☠'}</span>
          ))}
        </div>
        <div ref={oilWarningRef} className="absolute right-[62px] top-[52px] text-xs font-semibold text-[#a9b6ff]" style={{ display: 'none' }}>
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
        className="pointer-events-auto absolute left-1/2 bottom-[26px] -translate-x-1/2 w-[196px] h-[62px] rounded-md overflow-hidden border bg-[#050816]/90 text-white transition-[opacity,box-shadow,border-color] duration-150 active:scale-[0.96] motion-reduce:active:scale-100 z-20"
      >
        <div ref={rushFillRef} className="absolute inset-y-0 left-0 w-0 opacity-70 transition-[width] duration-100" />
        <span ref={rushLabelRef} className="relative z-10 text-[13px] font-bold tracking-[0.16em]">RUSH 0%</span>
        <span className="relative z-10 block mt-0.5 text-[9px] tracking-[0.2em] text-[#d4e6f1]/85">CLOSE PASSES CHARGE</span>
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
          <div className="text-[9px] font-semibold text-[#d4e6f1]">SPD</div>
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
      <div ref={nearMissRef} className="absolute left-1/2 bottom-[102px] -translate-x-1/2 font-bold text-[#df4bff] font-['Russo_One',sans-serif]" style={{ display: 'none', textShadow: '0 0 12px #27d9ff' }} />
    </div>
  );
}
