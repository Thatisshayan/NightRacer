import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { POP_DURATION_MS, POWERUP_DURATION_MS, type GameState, type PowerUpType } from '@workspace/game-core';
import type { NativeGameEngine } from './native-engine';

// Native port of the web app's game-hud-overlay.tsx — score/combo/lives/
// power-up bar/speedometer plus level-up flash, boss warning, and
// near-miss text. Same "own rAF loop polling getState()" architecture as
// the web version (and as GameCanvas.tsx's frame sync), just re-rendering
// RN Views/Text each tick instead of mutating DOM refs directly, since RN
// has no equivalent lightweight "mutate a real node without React"
// escape hatch outside Reanimated shared values — kept consistent with
// GameCanvas's existing per-frame re-render rather than introducing a
// second HUD-only animation technique.
const popScale = (popMs: number, peak: number) => {
  const t = Math.max(0, Math.min(1, popMs / POP_DURATION_MS));
  return 1 + (peak - 1) * t * t;
};

const POWERUP_META: Record<keyof typeof POWERUP_DURATION_MS, { color: string; label: string }> = {
  SHIELD: { color: '#00ffff', label: '\u{1F6E1} SHIELD' },
  SLOWMO: { color: '#ffff00', label: '⏱ SLOW-MO' },
  SCORE_BLAST: { color: '#ffaa00', label: '★ SCORE BLAST' },
};

const ARC_R = 36;
const ARC_CIRCUMFERENCE = 2 * Math.PI * ARC_R * 0.75; // 270° of a r=36 circle

export function HudOverlay({
  engine,
  onPause,
  muted,
  onToggleMute,
}: {
  engine: NativeGameEngine;
  onPause: () => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const [, setTick] = useState(0);
  const stateRef = useRef<GameState | null>(null);

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      stateRef.current = engine.getState();
      setTick((t) => (t + 1) % 1_000_000);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [engine]);

  const state = stateRef.current;
  if (!state) return null;

  const powerUp: Exclude<PowerUpType, 'EXTRA_LIFE'> | null =
    state.activePowerUp && state.activePowerUp !== 'EXTRA_LIFE' && state.powerUpTimer > 0
      ? state.activePowerUp
      : null;
  const powerUpMeta = powerUp ? POWERUP_META[powerUp] : null;
  const powerUpBarFill = powerUp ? Math.max(0, (state.powerUpTimer / POWERUP_DURATION_MS[powerUp]) * 100) : 0;
  const powerUpSeconds = powerUp ? Math.max(0, Math.ceil(state.powerUpTimer / 1000)) : 0;

  const speedRatio = Math.min(1, state.speedMultiplier / 3);
  // Amber-at-rest instead of the previous mint green — mint read as a
  // generic fitness-app accent color, tonally off against the rest of the
  // grimdark palette. Escalates through orange to red exactly as before.
  const speedColor = state.rushTimer > 0 ? '#df4bff' : state.speedMultiplier >= 2.5 ? '#df4bff' : state.speedMultiplier >= 1.8 ? '#ffb347' : '#27d9ff';

  const showCombo = state.combo > 1;
  const showLevelUp = state.levelUpFlash > 0;
  const showBossWarning = state.bossWarning > 0;
  const showNearMiss = state.combo > 1;
  const rushReady = state.rushCharge >= 100 && state.rushTimer <= 0;
  const rushLabel = state.rushTimer > 0 ? 'RUSH ACTIVE' : rushReady ? 'RUSH — TAP' : `RUSH ${Math.floor(state.rushCharge)}%`;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Top HUD bar */}
      <View style={styles.topBar} pointerEvents="box-none">
        <Pressable onPress={onPause} style={styles.pauseButton} hitSlop={8}>
          <Text style={styles.pauseIcon}>❙❙</Text>
        </Pressable>
        <Pressable onPress={onToggleMute} style={styles.muteButton} hitSlop={8}>
          <Text style={styles.muteIcon}>{muted ? '🔇' : '🔊'}</Text>
        </Pressable>
        <Text
          style={[
            styles.score,
            { color: state.activePowerUp === 'SCORE_BLAST' ? '#ffaa00' : '#ffffff' },
            { transform: [{ scale: popScale(state.scorePop, 1.3) }] },
          ]}
        >
          SCORE: {Math.floor(state.score)}
        </Text>
        <Text style={styles.dist}>
          DIST: {Math.floor(state.distance)}m  SPD: {state.speedMultiplier.toFixed(1)}×
        </Text>
        {showCombo && (
          <Text style={[styles.combo, { transform: [{ scale: popScale(state.comboPop, 1.5) }] }]}>
            COMBO ×{state.combo}
          </Text>
        )}
        {state.isDailyChallenge && <Text style={styles.dailyBadge}>◆ DAILY CHALLENGE</Text>}
        <View style={styles.lives}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Text key={i} style={[styles.heart, i < state.lives ? styles.heartAlive : styles.heartLost]}>
              {'☠'}
            </Text>
          ))}
        </View>
        {state.player.oilSlicked && <Text style={styles.oilWarning}>⚠ SLIPPING</Text>}
      </View>

      {/* Earned Rush control. Its wide target keeps the burst usable one-handed
          on a phone while keyboard users can still use Space on the web build. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Activate Rush when charged"
        onPress={() => engine.triggerRush()}
        disabled={!rushReady}
        style={[
          styles.rushControl,
          {
            borderColor: state.rushTimer > 0 ? '#df4bff' : rushReady ? '#27d9ff' : 'rgba(130,149,170,0.55)',
            opacity: rushReady || state.rushTimer > 0 ? 1 : 0.68,
          },
        ]}
      >
        <View
          style={[
            styles.rushFill,
            {
              width: `${state.rushTimer > 0 ? 100 : state.rushCharge}%`,
              backgroundColor: state.rushTimer > 0 ? '#df4bff' : '#27d9ff',
            },
          ]}
        />
        <Text style={styles.rushLabel}>{rushLabel}</Text>
        <Text style={styles.rushHint}>CLOSE PASSES CHARGE</Text>
      </Pressable>

      {/* Power-up bar (bottom left) */}
      {powerUp && powerUpMeta && (
        <View style={styles.powerUpBar}>
          <Text style={[styles.powerUpLabel, { color: powerUpMeta.color }]}>{powerUpMeta.label}</Text>
          <View style={styles.powerUpTrack}>
            <View style={[styles.powerUpFill, { width: `${powerUpBarFill}%`, backgroundColor: powerUpMeta.color }]} />
          </View>
          <Text style={styles.powerUpTimer}>{powerUpSeconds}s</Text>
        </View>
      )}

      {/* Speedometer gauge (bottom right) — a dark metal bezel behind the
          arc so it reads as an instrument-panel gauge welded onto the HUD
          instead of a bare, floating fitness-app ring. */}
      <View style={styles.speedGauge}>
        <View style={styles.speedBezel} />
        <Svg width={72} height={72} style={StyleSheet.absoluteFill} transform="rotate(-135 36 36)">
          <Circle
            cx={36}
            cy={36}
            r={ARC_R}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={7}
            strokeDasharray={`${ARC_CIRCUMFERENCE} ${2 * Math.PI * ARC_R}`}
          />
          <Circle
            cx={36}
            cy={36}
            r={ARC_R}
            fill="none"
            stroke={speedColor}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={`${ARC_CIRCUMFERENCE} ${2 * Math.PI * ARC_R}`}
            strokeDashoffset={ARC_CIRCUMFERENCE * (1 - speedRatio)}
          />
        </Svg>
        <View style={styles.speedTextWrap}>
          <Text style={styles.speedText}>{state.speedMultiplier.toFixed(1)}×</Text>
          <Text style={styles.speedLabel}>SPD</Text>
        </View>
      </View>

      {/* Level-up flash */}
      {showLevelUp && (
        <View
          style={[
            styles.levelUpOverlay,
            { backgroundColor: `rgba(255, 130, 0, ${Math.sin((state.levelUpFlash / 1800) * Math.PI) * 0.35})` },
          ]}
        >
          {state.levelUpFlash > 1200 && <Text style={styles.levelUpText}>{state.levelUpText}</Text>}
        </View>
      )}

      {/* Boss warning */}
      {showBossWarning && (
        <View
          style={[
            styles.bossWarningOverlay,
            { backgroundColor: Math.floor(performance.now() / 180) % 2 === 0 ? 'rgba(180,0,0,0.28)' : 'transparent' },
          ]}
        >
          <Text style={styles.bossWarningText}>⚠ WARBOSS INCOMING ⚠</Text>
          <Text style={styles.bossWarningSubtext}>BRACE YOURSELF</Text>
        </View>
      )}

      {/* Near-miss combo text */}
      {showNearMiss && (
        <Text
          style={[
            styles.nearMiss,
            {
              opacity: Math.min(1, state.comboTimer / 800),
              fontSize: Math.min(24, 14 + state.combo),
            },
          ]}
        >
          NEAR MISS ×{state.combo}!
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 10 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 92, backgroundColor: 'rgba(5,8,22,0.78)', borderBottomWidth: 1, borderBottomColor: 'rgba(39,217,255,0.28)' },
  pauseButton: { position: 'absolute', left: 8, top: 6, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  pauseIcon: { fontSize: 14, color: '#fff' },
  muteButton: { position: 'absolute', right: 8, top: 6, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  muteIcon: { fontSize: 16 },
  // A flat drop-shadow (not a glow) reads as text engraved on/backed by a
  // metal plate rather than text floating with nothing behind it — cheap
  // depth cue, matches the HUD bar's dark backing panel it already sits on.
  score: {
    position: 'absolute',
    left: 15,
    top: 32,
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 0,
    textShadowOffset: { width: 0, height: 2 },
  },
  dist: {
    position: 'absolute',
    left: 15,
    top: 62,
    fontSize: 13,
    color: '#999',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 0,
    textShadowOffset: { width: 0, height: 1 },
  },
  combo: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 40,
    fontSize: 13,
    color: '#df4bff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowRadius: 0,
    textShadowOffset: { width: 0, height: 1 },
  },
  dailyBadge: { position: 'absolute', left: 0, right: 0, top: 68, fontSize: 10, color: '#27d9ff', textAlign: 'center' },
  lives: { position: 'absolute', right: 15, top: 34, flexDirection: 'row-reverse', gap: 4 },
  // Skulls instead of hearts — a heart icon read as generic mobile-game
  // chrome, out of place against the rest of the grimdark 40k styling
  // (sprites, "WASTED" game-over screen, etc). Remaining lives get a
  // bone-white skull with a faint red glow (textShadow); lost lives fade to
  // a dim outline instead of just disappearing, so the pip stays visible.
  heart: { fontSize: 20, lineHeight: 20 },
  heartAlive: {
    color: '#e8ded0',
    textShadowColor: 'rgba(255,40,20,0.85)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 0 },
  },
  heartLost: { color: 'rgba(255,255,255,0.15)' },
  oilWarning: { position: 'absolute', right: 12, top: 66, fontSize: 12, color: '#8888ff' },
  rushControl: {
    position: 'absolute',
    left: 138,
    bottom: 16,
    width: 144,
    height: 52,
    borderWidth: 1,
    backgroundColor: 'rgba(5,8,22,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rushFill: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.62 },
  rushLabel: { zIndex: 1, fontSize: 11, fontWeight: 'bold', letterSpacing: 1.6, color: '#d4e6f1' },
  rushHint: { zIndex: 1, marginTop: 3, fontSize: 8, letterSpacing: 1.4, color: 'rgba(212,230,241,0.75)' },
  powerUpBar: {
    position: 'absolute',
    left: 10,
    bottom: 80,
    width: 210,
    height: 48,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 2,
    padding: 8,
  },
  powerUpLabel: { fontSize: 16, fontWeight: 'bold' },
  powerUpTrack: { marginTop: 4, height: 8, width: 140, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, overflow: 'hidden' },
  powerUpFill: { height: '100%' },
  powerUpTimer: { position: 'absolute', right: 12, bottom: 8, fontSize: 12, color: '#fff' },
  speedGauge: { position: 'absolute', right: 12, bottom: 12, width: 72, height: 72 },
  speedBezel: {
    position: 'absolute',
    left: 4,
    top: 4,
    right: 4,
    bottom: 4,
    borderRadius: 32,
    backgroundColor: 'rgba(10,10,10,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  speedTextWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  speedText: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  speedLabel: { fontSize: 8, color: '#888' },
  levelUpOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  levelUpText: { fontSize: 30, fontWeight: 'bold', color: '#fff' },
  bossWarningOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 8 },
  bossWarningText: { fontSize: 28, fontWeight: 'bold', color: '#ff2222' },
  bossWarningSubtext: { fontSize: 16, color: '#ffaaaa' },
  nearMiss: { position: 'absolute', left: 0, right: 0, bottom: 142, fontWeight: 'bold', color: '#df4bff', textAlign: 'center' },
});
