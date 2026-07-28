import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Canvas, Image } from '@shopify/react-native-skia';
import { CAR_STATS, type CarType } from '@workspace/game-core';
import { usePlayerCarImages } from './sprites';
import { Settings } from '@/lib/settings';

const CAR_TYPES = Object.keys(CAR_STATS) as CarType[];
const UPGRADE_COST = 100;
const PREVIEW_SIZE = 90;

// Native port of the web app's title/car-select screen (see
// artifacts/warboss-highway/src/pages/Game.tsx's title JSX) — car
// carousel, personal best, daily challenge toggle, garage/upgrades,
// start button. Deliberately simplified vs. the web version: no bobbing
// car-preview animation (static Skia image instead of the web's animated
// Canvas2D CarPreview) and no virtual-joystick toggle (native input is
// always drag-to-steer — see GameCanvas.tsx).
export function TitleScreen({
  selectedCar,
  onSelectCar,
  isDailyChallenge,
  onToggleDailyChallenge,
  personalBest,
  streak,
  onStart,
}: {
  selectedCar: CarType;
  onSelectCar: (car: CarType) => void;
  isDailyChallenge: boolean;
  onToggleDailyChallenge: () => void;
  personalBest: number;
  streak: number;
  onStart: () => void;
}) {
  const carImages = usePlayerCarImages();
  const stats = CAR_STATS[selectedCar];
  const [scrap, setScrap] = useState(Settings.getScrap());
  const [upgrades, setUpgrades] = useState(Settings.getUpgrades(selectedCar));

  const selectCar = (car: CarType) => {
    onSelectCar(car);
    setUpgrades(Settings.getUpgrades(car));
  };

  const cyclePrev = () => {
    const idx = CAR_TYPES.indexOf(selectedCar);
    selectCar(CAR_TYPES[(idx - 1 + CAR_TYPES.length) % CAR_TYPES.length]);
  };
  const cycleNext = () => {
    const idx = CAR_TYPES.indexOf(selectedCar);
    selectCar(CAR_TYPES[(idx + 1) % CAR_TYPES.length]);
  };

  const purchaseUpgrade = (type: 'speed' | 'armor' | 'handling') => {
    const current = upgrades[type];
    if (current >= 5 || scrap < UPGRADE_COST) return;
    const next = { ...upgrades, [type]: current + 1 };
    Settings.setUpgrades(selectedCar, next);
    Settings.setScrap(scrap - UPGRADE_COST);
    setUpgrades(next);
    setScrap(Settings.getScrap());
  };

  const carImage = carImages[selectedCar];

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.titleLine1}>WARBOSS</Text>
      <Text style={styles.titleLine2}>HIGHWAY</Text>

      <Text style={styles.sectionLabel}>Select Vehicle</Text>
      <View style={styles.carouselRow}>
        <Pressable onPress={cyclePrev} style={styles.arrowButton} hitSlop={8}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>

        <View style={styles.carCard}>
          {carImage && (
            <Canvas style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}>
              <Image
                image={carImage}
                x={(PREVIEW_SIZE - stats.width) / 2}
                y={(PREVIEW_SIZE - stats.height) / 2}
                width={stats.width}
                height={stats.height}
                fit="fill"
              />
            </Canvas>
          )}
          <Text style={styles.carLabel}>{stats.label}</Text>
          <Text style={styles.carDesc}>{stats.desc}</Text>
          <Text style={styles.carStats}>{stats.stats}</Text>
        </View>

        <Pressable onPress={cycleNext} style={styles.arrowButton} hitSlop={8}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>

      <View style={styles.dots}>
        {CAR_TYPES.map((car) => (
          <Pressable key={car} onPress={() => selectCar(car)} hitSlop={8}>
            <View style={[styles.dot, car === selectedCar && styles.dotActive]} />
          </Pressable>
        ))}
      </View>

      {personalBest > 0 && (
        <Text style={styles.personalBest}>
          PERSONAL BEST: <Text style={styles.personalBestValue}>{personalBest.toLocaleString()}</Text>
        </Text>
      )}

      {streak >= 2 && (
        <View style={styles.streakBanner}>
          <Text style={styles.streakText}>
            🔥 DAY {streak} STREAK — BONUS ×{(1 + streak * 0.05).toFixed(2)} APPLIED
          </Text>
        </View>
      )}

      <Pressable style={styles.toggleRow} onPress={onToggleDailyChallenge}>
        <View style={[styles.toggleTrack, isDailyChallenge && styles.toggleTrackOn]}>
          <View style={[styles.toggleThumb, isDailyChallenge && styles.toggleThumbOn]} />
        </View>
        <Text style={[styles.toggleLabel, isDailyChallenge && styles.toggleLabelOn]}>
          {isDailyChallenge ? '◆ DAILY CHALLENGE' : 'DAILY CHALLENGE'}
        </Text>
      </Pressable>

      <View style={styles.garageHeader}>
        <Text style={styles.garageTitle}>Garage</Text>
        <Text style={styles.garageScrap}>SCRAP: {scrap.toLocaleString()}</Text>
      </View>
      <View style={styles.garageGrid}>
        {(['speed', 'armor', 'handling'] as const).map((type) => {
          const level = upgrades[type];
          const affordable = scrap >= UPGRADE_COST && level < 5;
          return (
            <Pressable
              key={type}
              onPress={() => purchaseUpgrade(type)}
              disabled={!affordable}
              style={[styles.upgradeButton, affordable && styles.upgradeButtonActive]}
            >
              <Text style={styles.upgradeLabel}>{type.toUpperCase()}</Text>
              <Text style={styles.upgradeLevel}>Lv {level}/5</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.garageHint}>100 scrap per upgrade. Upgrades are per vehicle.</Text>

      <Pressable style={styles.startButton} onPress={onStart}>
        <Text style={styles.startButtonText}>START ENGINE</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, alignItems: 'center', backgroundColor: '#000', padding: 16, gap: 10 },
  titleLine1: { fontSize: 40, fontWeight: '900', color: '#dc2626', letterSpacing: 1 },
  titleLine2: { fontSize: 28, fontWeight: '900', color: '#fff', marginTop: -8, marginBottom: 8 },
  sectionLabel: { fontSize: 11, color: '#888', letterSpacing: 2, textTransform: 'uppercase' },
  carouselRow: { flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%' },
  arrowButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#333' },
  arrowText: { fontSize: 18, fontWeight: '900', color: '#888' },
  carCard: { flex: 1, alignItems: 'center', padding: 12, borderWidth: 2, borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)' },
  carLabel: { fontSize: 14, fontWeight: '900', color: '#fff', marginTop: 6, letterSpacing: 1, textAlign: 'center' },
  carDesc: { fontSize: 11, color: '#888', marginTop: 4, textAlign: 'center' },
  carStats: { fontSize: 11, color: '#666', marginTop: 4, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 8, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#444' },
  dotActive: { backgroundColor: '#dc2626' },
  personalBest: { fontSize: 11, color: '#888' },
  personalBestValue: { color: '#dc2626', fontWeight: '900' },
  streakBanner: { backgroundColor: 'rgba(255,170,0,0.15)', borderWidth: 1, borderColor: 'rgba(255,170,0,0.4)', paddingHorizontal: 12, paddingVertical: 6 },
  streakText: { fontSize: 10, fontWeight: '900', color: '#ffaa00' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  toggleTrack: { width: 44, height: 22, borderWidth: 2, borderColor: '#333', justifyContent: 'center' },
  toggleTrackOn: { borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.2)' },
  toggleThumb: { width: 14, height: 14, backgroundColor: '#fff', marginLeft: 2 },
  toggleThumbOn: { marginLeft: 24 },
  toggleLabel: { fontSize: 11, color: '#888' },
  toggleLabelOn: { color: '#4ade80', fontWeight: '900' },
  garageHeader: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 8 },
  garageTitle: { fontSize: 11, color: '#888', letterSpacing: 2, textTransform: 'uppercase' },
  garageScrap: { fontSize: 11, color: '#ffaa00', fontWeight: '900' },
  garageGrid: { flexDirection: 'row', gap: 8, width: '100%' },
  upgradeButton: { flex: 1, alignItems: 'center', padding: 8, borderWidth: 2, borderColor: '#333', backgroundColor: 'rgba(255,255,255,0.03)' },
  upgradeButtonActive: { borderColor: '#ffaa00', backgroundColor: 'rgba(255,170,0,0.1)' },
  upgradeLabel: { fontSize: 10, fontWeight: '900', color: '#fff' },
  upgradeLevel: { fontSize: 10, color: '#888', marginTop: 2 },
  garageHint: { fontSize: 10, color: '#666', textAlign: 'center' },
  startButton: { width: '100%', height: 60, marginTop: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dc2626', borderWidth: 2, borderColor: '#dc2626' },
  startButtonText: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 2 },
});
