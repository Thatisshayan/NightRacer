import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// Native port of the web app's first-run tutorial overlay (Game.tsx,
// gated by Settings.getTutorialSeen()/setTutorialSeen() — those existed
// on mobile since Phase 5 but nothing ever rendered this until now).
// Copy adapted for native input: web says "WASD / Arrows or drag to
// move" since it supports both; mobile is drag-only (see GameCanvas.tsx's
// GestureDetector), so it just says "drag."
const CARDS = [
  { title: 'DRIVE FREE', body: 'Drag anywhere to steer. Up speeds you up, down slows you down.' },
  { title: 'NEAR-MISS COMBOS', body: 'Pass close to vehicles without hitting them to build combos and score.' },
  { title: 'POWER-UPS', body: 'Grab shields, slow-mo, score blast, and extra lives.' },
];

export function TutorialOverlay({ onDismiss }: { onDismiss: () => void }) {
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>WARBOSS ACADEMY</Text>
        <Text style={styles.subtitle}>BASIC SURVIVAL TRAINING</Text>
      </View>

      <View style={styles.cards}>
        {CARDS.map((card) => (
          <View key={card.title} style={styles.card}>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.cardBody}>{card.body}</Text>
          </View>
        ))}
      </View>

      <Pressable style={styles.gotItButton} onPress={onDismiss}>
        <Text style={styles.gotItText}>GOT IT</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    zIndex: 30,
  },
  header: { alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 26, fontWeight: '900', color: '#dc2626', letterSpacing: 1 },
  subtitle: { fontSize: 11, color: '#888', marginTop: 2, letterSpacing: 1 },
  cards: { width: '100%', maxWidth: 340, gap: 12 },
  card: { borderWidth: 1, borderColor: '#333', backgroundColor: 'rgba(255,255,255,0.03)', padding: 12 },
  cardTitle: { fontSize: 13, fontWeight: '900', color: '#fff', marginBottom: 4 },
  cardBody: { fontSize: 12, color: '#888', lineHeight: 17 },
  gotItButton: { width: '100%', maxWidth: 340, height: 52, marginTop: 20, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  gotItText: { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 1 },
});
