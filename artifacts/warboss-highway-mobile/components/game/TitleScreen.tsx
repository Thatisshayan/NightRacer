import React, { useState } from 'react';
import { Image as RNImage, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CAR_STATS, type CarType } from '@workspace/game-core';
import { CarPreview3D } from '@/components/game3d/CarPreview3D';
import { Settings } from '@/lib/settings';

const CAR_TYPES = Object.keys(CAR_STATS) as CarType[];
const UPGRADE_COST = 100;
const PREVIEW_SIZE = 90;
// The garage cards used to be plain bordered boxes with just a text label —
// visually flatter than the vehicle carousel right above them. A small
// glyph per stat is a cheap, no-new-asset way to close that gap.
const UPGRADE_ICON: Record<'speed' | 'armor' | 'handling', string> = {
  speed: '⚡',
  armor: '⛨',
  handling: '⚙',
};

// Native port of the web app's title/car-select screen (see
// artifacts/warboss-highway/src/pages/Game.tsx's title JSX) — car
// carousel, personal best, daily challenge toggle, garage/upgrades,
// start button. The car card is a live spinning render of the actual GLB
// (CarPreview3D, same model the in-game renderer draws), not a static 2D
// image. No virtual-joystick toggle (native input is always drag-to-steer
// — see GameCanvas.tsx).
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

  return (
    <View style={styles.screen}>
      {/* Skyline parallax backdrop — these two assets sat in the project
          completely unused (no code referenced them at all) despite being
          genuinely good art; the title screen is the one place with open
          canvas around the UI for a backdrop to actually show. layer1 is
          the darker, more-distant ruins silhouette; layer2 (junkyard/fire
          barrels) sits lower/closer, slightly brighter, for a cheap sense
          of depth without real parallax scrolling. */}
      <RNImage source={require('../../assets/sprites/skyline_layer1.png')} style={styles.skylineLayer1} resizeMode="cover" />
      <RNImage source={require('../../assets/sprites/skyline_layer2.png')} style={styles.skylineLayer2} resizeMode="cover" />
      {/* The skyline images have a hard top edge and the scrollable content
          above rarely fills the screen, so without this the boundary reads
          as a stark seam cutting the screen in two rather than a backdrop
          peeking up from below. Fades the same black as the screen
          background down to transparent over the skyline's own top edge. */}
      <LinearGradient
        colors={['#000000', 'rgba(0,0,0,0)']}
        style={styles.skylineFade}
        pointerEvents="none"
      />
      <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.titleLine1}>WARBOSS</Text>
      <Text style={styles.titleLine2}>HIGHWAY</Text>

      <Text style={styles.sectionLabel}>Select Vehicle</Text>
      <View style={styles.carouselRow}>
        <Pressable onPress={cyclePrev} style={styles.arrowButton} hitSlop={8}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>

        <View style={styles.carCard}>
          {/* No key={selectedCar} here: that used to remount the whole
              <Canvas> (a fresh GL context) on every carousel tap. Cycling
              through cars quickly enough could exhaust iOS's limited
              EAGLContext pool before the old one finished tearing down —
              the same class of GL-churn crash this app has already hit
              multiple times (see the GLTFLoader/Suspense crash fixes in
              git history). CarPreview3D's Canvas now stays mounted for the
              screen's lifetime; only the model inside swaps, which
              expo-asset/useLoader already cache per key, so switching cars
              is still cheap. */}
          <CarPreview3D carType={selectedCar} size={PREVIEW_SIZE} />
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
              <Text style={styles.upgradeIcon}>{UPGRADE_ICON[type]}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  // Both layers pinned to the bottom edge (skylines read along a horizon),
  // full width, a fixed height tall enough to read clearly without
  // swallowing the whole screen. layer1 sits further back/dimmer; layer2
  // is drawn on top of it, shorter and slightly brighter for depth.
  skylineLayer1: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 220, opacity: 0.55 },
  skylineLayer2: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 150, opacity: 0.8 },
  // Straddles skylineLayer1's top edge (the taller of the two) so the
  // backdrop fades in instead of cutting on abruptly.
  skylineFade: { position: 'absolute', left: 0, right: 0, bottom: 220, height: 90 },
  // Was opaque black — now transparent so the skyline backdrop shows
  // through behind the scrollable content.
  root: { flexGrow: 1, alignItems: 'center', backgroundColor: 'transparent', padding: 16, gap: 10 },
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
  upgradeIcon: { fontSize: 16, color: '#ffaa00', marginBottom: 2 },
  upgradeLabel: { fontSize: 10, fontWeight: '900', color: '#fff' },
  upgradeLevel: { fontSize: 10, color: '#888', marginTop: 2 },
  garageHint: { fontSize: 10, color: '#666', textAlign: 'center' },
  startButton: { width: '100%', height: 60, marginTop: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dc2626', borderWidth: 2, borderColor: '#dc2626' },
  startButtonText: { fontSize: 22, fontWeight: '900', color: '#fff', letterSpacing: 2 },
});
