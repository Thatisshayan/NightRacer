import { useGetLeaderboard, useGetGameStats } from '@workspace/api-client-react';
import { format } from 'date-fns';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Trophy, Activity, Target, Zap } from 'lucide-react';
import { playAudio, stopAudio } from '@/lib/game/audio';
import { useEffect } from 'react';

export default function Leaderboard() {
  const { data: scores, isLoading: isScoresLoading } = useGetLeaderboard({ limit: 20 });
  const { data: stats, isLoading: isStatsLoading } = useGetGameStats();

  useEffect(() => {
    // Play menu music on leaderboard
    stopAudio('gameplay');
    playAudio('menu', true);
  }, []);

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground py-8 px-4 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <h1 className="text-5xl font-black text-primary tracking-tighter drop-shadow-[0_0_10px_rgba(220,38,38,0.5)]">
              KILL-BOARD
            </h1>
            <p className="text-muted-foreground font-mono mt-2">GLOBAL RANKINGS & STATS</p>
          </div>
          <Link href="/">
            <Button size="lg" className="font-black tracking-widest h-14 px-8 border-2 border-primary bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all">
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
              value={isStatsLoading ? '...' : stats?.totalGamesPlayed?.toLocaleString()} 
              icon={<Target className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard 
              label="HIGHEST SCORE" 
              value={isStatsLoading ? '...' : stats?.highestScore?.toLocaleString()} 
              icon={<Trophy className="w-4 h-4 text-accent" />}
            />
            <StatCard 
              label="AVERAGE SCORE" 
              value={isStatsLoading ? '...' : Math.floor(stats?.averageScore || 0).toLocaleString()} 
              icon={<Activity className="w-4 h-4 text-muted-foreground" />}
            />
            <StatCard 
              label="POWER-UPS BURNED" 
              value={isStatsLoading ? '...' : stats?.totalPowerupsUsed?.toLocaleString()} 
              icon={<Zap className="w-4 h-4 text-accent" />}
            />
          </div>
        </section>

        {/* Leaderboard Table */}
        <section>
          <h2 className="text-xl font-bold text-muted-foreground mb-4 flex items-center gap-2">
            <Trophy className="w-5 h-5" /> TOP OPERATORS
          </h2>
          
          <div className="bg-card border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-secondary/50 font-mono text-xs text-muted-foreground border-b border-border">
                    <th className="p-4 font-bold">RANK</th>
                    <th className="p-4 font-bold">CALLSIGN</th>
                    <th className="p-4 font-bold text-right">SCORE</th>
                    <th className="p-4 font-bold text-right">DIST (m)</th>
                    <th className="p-4 font-bold text-center hidden md:table-cell">PWR</th>
                    <th className="p-4 font-bold text-right hidden sm:table-cell">DATE</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-sm">
                  {isScoresLoading ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        DECRYPTING DATA...
                      </td>
                    </tr>
                  ) : scores && scores.length > 0 ? (
                    scores.map((score, index) => (
                      <tr 
                        key={score.id} 
                        className="border-b border-border/50 hover:bg-white/5 transition-colors group"
                      >
                        <td className="p-4 font-black">
                          <span className={`
                            inline-flex items-center justify-center w-8 h-8 rounded-sm
                            ${index === 0 ? 'bg-accent text-accent-foreground shadow-[0_0_10px_rgba(255,170,0,0.5)]' : 
                              index === 1 ? 'bg-secondary text-secondary-foreground' : 
                              index === 2 ? 'bg-[#cd7f32] text-white' : 
                              'bg-transparent text-muted-foreground'}
                          `}>
                            #{index + 1}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-foreground uppercase truncate max-w-[150px]">
                          {score.playerName}
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
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        NO OPERATORS FOUND. BE THE FIRST.
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

function StatCard({ label, value, icon }: { label: string, value: React.ReactNode, icon: React.ReactNode }) {
  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between h-24">
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] sm:text-xs font-mono text-muted-foreground font-bold leading-tight">{label}</span>
        {icon}
      </div>
      <div className="text-xl sm:text-2xl font-black text-foreground truncate">
        {value}
      </div>
    </div>
  );
}
