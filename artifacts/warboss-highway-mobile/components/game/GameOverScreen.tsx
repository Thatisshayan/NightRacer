import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSubmitScore } from '@workspace/api-client-react';
import { ACHIEVEMENTS, getAchievementById, type CarType, type GameState } from '@workspace/game-core';

// Native port of the web app's game-over-overlay.tsx — final stats,
// achievements unlocked, score submission to the Kill-Board, and
// restart/menu buttons. Deliberately not ported: the share/save
// score-card image (generateShareCard() rasterizes via Canvas2D
// toDataURL — web-only, would need real native image composition to
// port properly, not worth it for this pass).
export function GameOverScreen({
  state,
  selectedCar,
  personalBest,
  isNewRecord,
  scrapEarned,
  onRestart,
  onMenu,
}: {
  state: GameState;
  selectedCar: CarType;
  personalBest: number;
  isNewRecord: boolean;
  scrapEarned: number;
  onRestart: () => void;
  onMenu: () => void;
}) {
  const [playerName, setPlayerName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitScore = useSubmitScore();

  const handleSubmit = () => {
    const name = playerName.trim();
    if (!name) return;
    setError(null);
    submitScore.mutate(
      {
        data: {
          playerName: name.substring(0, 20),
          score: Math.floor(state.score),
          distanceTraveled: Math.floor(state.distance),
          powerupsUsed: state.powerUpsUsed,
          car: selectedCar,
          dailyMode: state.isDailyChallenge,
        },
      },
      {
        onSuccess: () => setSubmitted(true),
        onError: () => setError('Failed to submit score. Try again.'),
      }
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.wasted}>WASTED</Text>
      {isNewRecord && <Text style={styles.newRecord}>★ NEW PERSONAL RECORD ★</Text>}

      <View style={styles.card}>
        <StatRow label="FINAL SCORE" value={Math.floor(state.score).toLocaleString()} big />
        {personalBest > 0 && !isNewRecord && <StatRow label="PERSONAL BEST" value={personalBest.toLocaleString()} />}
        <StatRow label="DISTANCE" value={`${Math.floor(state.distance).toLocaleString()}m`} />
        <StatRow label="POWER-UPS" value={String(state.powerUpsUsed)} />
        {state.isDailyChallenge && <StatRow label="MODE" value="◆ DAILY" valueColor="#4ade80" />}
        <StatRow label="SCRAP EARNED" value={`+${scrapEarned.toLocaleString()}`} valueColor="#ffaa00" />

        {state.achievementsEarned.length > 0 && (
          <View style={styles.achievementsSection}>
            <Text style={styles.achievementsLabel}>Achievements Unlocked</Text>
            <View style={styles.achievementsRow}>
              {state.achievementsEarned.map((id) => {
                const a = getAchievementById(id);
                if (!a) return null;
                return (
                  <View key={id} style={styles.achievementChip}>
                    <Text style={styles.achievementText}>
                      {a.icon} {a.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {submitted ? (
          <Text style={styles.submittedText}>✓ SUBMITTED TO KILL-BOARD</Text>
        ) : (
          <View style={styles.submitForm}>
            <Text style={styles.inputLabel}>Callsign for Kill-Board</Text>
            <TextInput
              value={playerName}
              onChangeText={setPlayerName}
              maxLength={20}
              placeholder="WARBOSS_99"
              placeholderTextColor="#555"
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable
              style={[styles.submitButton, (!playerName.trim() || submitScore.isPending) && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={!playerName.trim() || submitScore.isPending}
            >
              {submitScore.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>SUBMIT TO KILL-BOARD</Text>
              )}
            </Pressable>
            {error && <Text style={styles.errorText}>{error}</Text>}
          </View>
        )}

        <View style={styles.actionsRow}>
          <Pressable style={styles.actionButton} onPress={onRestart}>
            <Text style={styles.actionButtonText}>PLAY AGAIN</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={onMenu}>
            <Text style={styles.actionButtonText}>MAIN MENU</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

function StatRow({ label, value, valueColor, big }: { label: string; value: string; valueColor?: string; big?: boolean }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[big ? styles.statValueBig : styles.statValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.92)', padding: 16, paddingTop: 32 },
  wasted: { fontSize: 44, fontWeight: '900', color: '#dc2626', letterSpacing: 1 },
  newRecord: { fontSize: 13, fontWeight: '900', color: '#ffaa00', marginTop: 4, marginBottom: 4 },
  card: { width: '100%', maxWidth: 360, backgroundColor: 'rgba(20,20,20,0.9)', borderWidth: 2, borderColor: '#333', padding: 18, marginTop: 12, gap: 4 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#333', paddingVertical: 8 },
  statLabel: { fontSize: 12, color: '#888' },
  statValue: { fontSize: 16, color: '#fff' },
  statValueBig: { fontSize: 24, fontWeight: '900', color: '#dc2626' },
  achievementsSection: { marginTop: 10, marginBottom: 6 },
  achievementsLabel: { fontSize: 10, color: '#888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  achievementsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  achievementChip: { backgroundColor: 'rgba(255,170,0,0.1)', borderWidth: 1, borderColor: 'rgba(255,170,0,0.3)', paddingHorizontal: 8, paddingVertical: 4 },
  achievementText: { fontSize: 10, color: '#ffaa00', fontWeight: '900' },
  submitForm: { marginTop: 10, gap: 8 },
  inputLabel: { fontSize: 11, color: '#888', fontWeight: '900', textTransform: 'uppercase' },
  input: { height: 48, borderWidth: 2, borderColor: 'rgba(220,38,38,0.5)', backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 16, textAlign: 'center', fontWeight: '900' },
  submitButton: { height: 52, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  submittedText: { fontSize: 13, fontWeight: '900', color: '#4ade80', textAlign: 'center', marginTop: 10 },
  errorText: { fontSize: 11, color: '#ff5555', textAlign: 'center' },
  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionButton: { flex: 1, height: 44, borderWidth: 1, borderColor: '#444', alignItems: 'center', justifyContent: 'center' },
  actionButtonText: { fontSize: 12, fontWeight: '700', color: '#ccc' },
});
