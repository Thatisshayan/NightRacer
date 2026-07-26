import { useState, useEffect, useRef } from 'react';
import { useGetLeaderboard, useGetGameStats } from '@workspace/api-client-react';
import { format } from 'date-fns';
import { Link, useSearchParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, Activity, Target, Zap } from 'lucide-react';
import { playAudio, stopAudio } from '@/lib/game/audio';

type Period = 'all' | 'daily' | 'weekly';

const PERIOD_LABELS: Record<Period, string> = {
  all: 'ALL TIME',
  weekly: 'THIS WEEK',
  daily: 'TODAY',
};

export default function Leaderboard() {
  const [period, setPeriod] = useState<Period>('all');
  const [searchParams] = useSearchParams();
  const highlightId = searchParams.get('highlight');
  const highlightRef = useRef<HTMLTableRowElement>(null);
  const hasScrolledToHighlight = useRef(false);

  const { data: scores, isLoading: isScoresLoading } = useGetLeaderboard({
    limit: 50,
    period,
  });
  const { data: stats, isLoading: isStatsLoading } = useGetGameStats();

  useEffect(() => {
    stopAudio('gameplay');
    playAudio('menu', true);
  }, []);

  // Scroll to the just-submitted score once its row is actually in the DOM
  // (only fires once per arrival — re-sorting/refetching shouldn't re-scroll).
  useEffect(() => {
    if (!highlightId || hasScrolledToHighlight.current) return;
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      hasScrolledToHighlight.current = true;
    }
  }, [highlightId, scores]);

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground py-8 px-4 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <h1 className="text-5xl font-black text-primary tracking-tighter drop-shadow-[0_0_10px_rgba(220,38,38,0.5)]">
              KILL-BOARD
            </h1>
            <p className="text-muted-foreground font-mono mt-2">GLOBAL RANKINGS & STATS</p>
          </div>
          <Link href="/">
            <Button
              size="lg"
              className="font-black tracking-widest h-14 px-8 border-2 border-primary bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all"
            >
              PLAY AGAIN
            </Button>
          </Link>
        </div>

        {/* Global Stats */}
        <section>
          <h2 className="text-xl font-bold text-muted-foreground mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5" /> WARZONE INTEL
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="TOTAL DEPLOYMENTS"
              value={isStatsLoading ? undefined : stats?.totalGamesPlayed?.toLocaleString()}
              icon={<Target className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard
              label="HIGHEST SCORE"
              value={isStatsLoading ? undefined : stats?.highestScore?.toLocaleString()}
              icon={<Trophy className="w-4 h-4 text-accent" />}
            />
            <StatCard
              label="AVERAGE SCORE"
              value={isStatsLoading ? undefined : Math.floor(stats?.averageScore || 0).toLocaleString()}
              icon={<Activity className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard
              label="POWER-UPS BURNED"
              value={isStatsLoading ? undefined : stats?.totalPowerupsUsed?.toLocaleString()}
              icon={<Zap className="w-4 h-4 text-accent" />}
            />
          </div>
        </section>

        {/* Period tabs */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-muted-foreground flex items-center gap-2">
              <Trophy className="w-5 h-5" /> TOP OPERATORS
            </h2>
            <div className="flex border border-border overflow-hidden">
              {(['all', 'weekly', 'daily'] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-mono font-bold tracking-widest transition-[background-color,color,transform] duration-150 active:scale-[0.94] motion-reduce:active:scale-100 ${
                    period === p
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-card border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-secondary/50 font-mono text-xs text-muted-foreground border-b border-border">
                    <th className="p-4 font-bold">RANK</th>
                    <th className="p-4 font-bold">CALLSIGN</th>
                    <th className="p-4 font-bold text-center hidden md:table-cell">RIDE</th>
                    <th className="p-4 font-bold text-right">SCORE</th>
                    <th className="p-4 font-bold text-right">DIST (m)</th>
                    <th className="p-4 font-bold text-center hidden md:table-cell">PWR</th>
                    <th className="p-4 font-bold text-right hidden sm:table-cell">DATE</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-sm">
                  {isScoresLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="p-4"><Skeleton className="h-8 w-8" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-24" /></td>
                        <td className="p-4 text-center hidden md:table-cell"><Skeleton className="h-4 w-16 mx-auto" /></td>
                        <td className="p-4 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
                        <td className="p-4 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
                        <td className="p-4 text-center hidden md:table-cell"><Skeleton className="h-4 w-6 mx-auto" /></td>
                        <td className="p-4 text-right hidden sm:table-cell"><Skeleton className="h-4 w-20 ml-auto" /></td>
                      </tr>
                    ))
                  ) : scores && scores.length > 0 ? (
                    scores.map((score, index) => {
                      const isHighlighted = highlightId !== null && String(score.id) === highlightId;
                      return (
                      <tr
                        key={score.id}
                        ref={isHighlighted ? highlightRef : undefined}
                        className={`border-b border-border/50 hover:bg-white/5 transition-colors group ${
                          isHighlighted ? 'bg-accent/15 animate-[pulse_1.5s_ease-in-out_2]' : ''
                        }`}
                      >
                        <td className="p-4 font-black">
                          <span
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-sm ${
                              index === 0
                                ? 'bg-accent text-accent-foreground shadow-[0_0_10px_rgba(255,170,0,0.5)]'
                                : index === 1
                                  ? 'bg-secondary text-secondary-foreground'
                                  : index === 2
                                    ? 'bg-[#cd7f32] text-white'
                                    : 'bg-transparent text-muted-foreground'
                            }`}
                          >
                            #{index + 1}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-foreground uppercase truncate max-w-[150px]">
                          {score.playerName}
                        </td>
                        <td className="p-4 text-center text-muted-foreground hidden md:table-cell">
                          <span className="inline-flex items-center gap-1">
                            {score.car || 'UNKNOWN'}
                            {score.dailyMode && (
                              <span className="text-[10px] text-green-400 font-bold ml-1">◆</span>
                            )}
                          </span>
                        </td>
                        <td className="p-4 text-right font-bold text-primary group-hover:text-primary/80 transition-colors">
                          {score.score.toLocaleString()}
                        </td>
                        <td className="p-4 text-right text-muted-foreground">
                          {score.distanceTraveled.toLocaleString()}
                        </td>
                        <td className="p-4 text-center text-accent hidden md:table-cell">
                          {score.powerupsUsed}
                        </td>
                        <td className="p-4 text-right text-muted-foreground hidden sm:table-cell">
                          {format(new Date(score.createdAt), 'MMM dd, yyyy')}
                        </td>
                      </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        {period === 'daily'
                          ? 'NO OPERATORS TODAY. BE THE FIRST.'
                          : period === 'weekly'
                            ? 'NO OPERATORS THIS WEEK. BE THE FIRST.'
                            : 'NO OPERATORS FOUND. BE THE FIRST.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between h-24">
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] sm:text-xs font-mono text-muted-foreground font-bold leading-tight">
          {label}
        </span>
        {icon}
      </div>
      <div className="text-xl sm:text-2xl font-black text-foreground truncate">
        {value === undefined ? <Skeleton className="h-6 w-16" /> : value}
      </div>
    </div>
  );
}
