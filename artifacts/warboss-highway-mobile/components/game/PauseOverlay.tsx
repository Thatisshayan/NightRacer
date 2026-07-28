import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// Web has no equivalent pause overlay component (its pause button lives
// inline in Game.tsx) — this is new UI for a capability GameEngine
// already had (pause()/resume(), onPauseChange) but nothing on mobile
// ever called.
export function PauseOverlay({ onResume, onQuit }: { onResume: () => void; onQuit: () => void }) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>PAUSED</Text>
      <Pressable style={[styles.button, styles.resumeButton]} onPress={onResume}>
        <Text style={styles.buttonText}>RESUME</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={onQuit}>
        <Text style={styles.buttonText}>QUIT TO MENU</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    zIndex: 20,
  },
  title: { fontSize: 36, fontWeight: '900', color: '#fff', letterSpacing: 3, marginBottom: 8 },
  button: { width: 220, height: 52, borderWidth: 2, borderColor: '#444', alignItems: 'center', justifyContent: 'center' },
  resumeButton: { borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.15)' },
  buttonText: { fontSize: 14, fontWeight: '900', color: '#fff', letterSpacing: 1 },
});
