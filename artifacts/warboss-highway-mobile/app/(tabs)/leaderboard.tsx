import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useGetGameStats, useGetLeaderboard } from '@workspace/api-client-react';

type Period = 'all' | 'daily' | 'weekly';

const PERIOD_LABELS: Record<Period, string> = {
  all: 'ALL TIME',
  weekly: 'THIS WEEK',
  daily: 'TODAY',
};

// Native port of the web app's Leaderboard.tsx — global stats + a
// period-filtered kill-board. Lives on its own tab rather than a
// pushed/navigated route, matching the fact that this game doesn't have
// a persistent nav chrome during gameplay (see app/_layout.tsx's tab
// setup).
export default function LeaderboardScreen() {
  const [period, setPeriod] = useState<Period>('all');
  const { data: scores, isLoading: scoresLoading } = useGetLeaderboard({ limit: 50, period });
  const { data: stats, isLoading: statsLoading } = useGetGameStats();

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>KILL-BOARD</Text>
      <Text style={styles.subtitle}>GLOBAL RANKINGS & STATS</Text>

      <View style={styles.statsGrid}>
        <StatCard label="TOTAL DEPLOYMENTS" value={stats?.totalGamesPlayed} loading={statsLoading} />
        <StatCard label="HIGHEST SCORE" value={stats?.highestScore} loading={statsLoading} />
        <StatCard label="AVERAGE SCORE" value={stats ? Math.floor(stats.averageScore) : undefined} loading={statsLoading} />
        <StatCard label="POWER-UPS BURNED" value={stats?.totalPowerupsUsed} loading={statsLoading} />
      </View>

      <View style={styles.periodRow}>
        {(['all', 'weekly', 'daily'] as Period[]).map((p) => (
          <Pressable
            key={p}
            onPress={() => setPeriod(p)}
            style={[styles.periodTab, period === p && styles.periodTabActive]}
          >
            <Text style={[styles.periodTabText, period === p && styles.periodTabTextActive]}>
              {PERIOD_LABELS[p]}
            </Text>
          </Pressable>
        ))}
      </View>

      {scoresLoading ? (
        <ActivityIndicator color="#dc2626" style={{ marginTop: 24 }} />
      ) : scores && scores.length > 0 ? (
        <View style={styles.table}>
          {scores.map((score, index) => (
            <View key={score.id} style={styles.row}>
              <View style={[styles.rankBadge, index === 0 && styles.rankGold, index === 1 && styles.rankSilver, index === 2 && styles.rankBronze]}>
                <Text style={styles.rankText}>#{index + 1}</Text>
              </View>
              <View style={styles.rowMain}>
                <Text style={styles.playerName} numberOfLines={1}>
                  {score.playerName}
                  {score.dailyMode ? ' ◆' : ''}
                </Text>
                <Text style={styles.rowSub}>
                  {score.car ?? 'UNKNOWN'} · {score.distanceTraveled.toLocaleString()}m · {score.powerupsUsed} PWR
                </Text>
              </View>
              <Text style={styles.scoreValue}>{score.score.toLocaleString()}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>
          {period === 'daily'
            ? 'NO OPERATORS TODAY. BE THE FIRST.'
            : period === 'weekly'
              ? 'NO OPERATORS THIS WEEK. BE THE FIRST.'
              : 'NO OPERATORS FOUND. BE THE FIRST.'}
        </Text>
      )}
    </ScrollView>
  );
}

function StatCard({ label, value, loading }: { label: string; value?: number; loading: boolean }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      {loading ? (
        <ActivityIndicator color="#888" size="small" />
      ) : (
        <Text style={styles.statValue}>{(value ?? 0).toLocaleString()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, paddingTop: 24, gap: 16 },
  title: { fontSize: 32, fontWeight: '900', color: '#dc2626' },
  subtitle: { fontSize: 11, color: '#888', letterSpacing: 1, marginTop: -8 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { width: '48%', backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: '#222', padding: 10, height: 64, justifyContent: 'space-between' },
  statLabel: { fontSize: 9, color: '#888', fontWeight: '700' },
  statValue: { fontSize: 18, fontWeight: '900', color: '#fff' },
  periodRow: { flexDirection: 'row', borderWidth: 1, borderColor: '#222' },
  periodTab: { flex: 1, paddingVertical: 8, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)' },
  periodTabActive: { backgroundColor: '#dc2626' },
  periodTabText: { fontSize: 10, fontWeight: '900', color: '#888', letterSpacing: 1 },
  periodTabTextActive: { color: '#fff' },
  table: { borderWidth: 1, borderColor: '#222' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  rankBadge: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  rankGold: { backgroundColor: 'rgba(255,170,0,0.25)' },
  rankSilver: { backgroundColor: 'rgba(200,200,200,0.15)' },
  rankBronze: { backgroundColor: 'rgba(205,127,50,0.25)' },
  rankText: { fontSize: 12, fontWeight: '900', color: '#ccc' },
  rowMain: { flex: 1 },
  playerName: { fontSize: 13, fontWeight: '900', color: '#fff', textTransform: 'uppercase' },
  rowSub: { fontSize: 10, color: '#888', marginTop: 2 },
  scoreValue: { fontSize: 15, fontWeight: '900', color: '#dc2626' },
  empty: { textAlign: 'center', color: '#666', fontSize: 12, marginTop: 24 },
});
