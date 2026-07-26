import { useState, useRef } from 'react';
import { useSubmitScore } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';
import { ACHIEVEMENTS, getAchievementById } from '@/lib/game/achievements';
import { CarType } from '@/lib/game/engine';

interface GameOverOverlayProps {
  score: number;
  distance: number;
  powerupsUsed: number;
  achievementsEarned: string[];
  selectedCar: CarType;
  isDailyChallenge: boolean;
  personalBest: number;
  isNewRecord: boolean;
  scrapEarned: number;
  onRestart: () => void;
  onBack: () => void;
}

function generateShareCard(
  score: number,
  distance: number,
  playerName: string,
  car: CarType,
  isDaily: boolean
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 240;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 480, 240);

  // Left accent bar
  ctx.fillStyle = '#8b0000';
  ctx.fillRect(0, 0, 6, 240);

  // Top stripe
  ctx.fillStyle = '#1a0000';
  ctx.fillRect(6, 0, 474, 6);

  // Title
  ctx.font = 'bold 36px Arial';
  ctx.fillStyle = '#cc2222';
  ctx.textAlign = 'left';
  ctx.fillText('WARBOSS', 24, 52);
  ctx.font = 'bold 24px Arial';
  ctx.fillStyle = '#cccccc';
  ctx.fillText('HIGHWAY', 24, 80);

  if (isDaily) {
    ctx.font = 'bold 11px Arial';
    ctx.fillStyle = '#55ffaa';
    ctx.fillText('◆ DAILY CHALLENGE', 24, 100);
  }

  // Score (big)
  ctx.font = 'bold 64px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(Math.floor(score).toLocaleString(), 460, 110);

  ctx.font = '13px Arial';
  ctx.fillStyle = '#666';
  ctx.fillText('FINAL SCORE', 460, 130);

  // Stats row
  ctx.font = '15px Arial';
  ctx.fillStyle = '#999';
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.floor(distance)}m SURVIVED`, 24, 158);

  ctx.fillStyle = '#aaa';
  ctx.fillText(`VEHICLE: ${car}`, 24, 180);

  // Player name
  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#cc2222';
  ctx.fillText(playerName.toUpperCase(), 24, 210);

  // Tag line
  ctx.font = '11px Arial';
  ctx.fillStyle = '#333';
  ctx.textAlign = 'right';
  ctx.fillText('SURVIVE THE WASTELAND  warboss-highway.repl.co', 460, 230);

  return canvas.toDataURL('image/png');
}

export function GameOverOverlay({
  score,
  distance,
  powerupsUsed,
  achievementsEarned,
  selectedCar,
  isDailyChallenge,
  personalBest,
  isNewRecord,
  scrapEarned,
  onRestart,
  onBack,
}: GameOverOverlayProps) {
  const [playerName, setPlayerName] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const submitScore = useSubmitScore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const shareRef = useRef<HTMLAnchorElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;

    submitScore.mutate(
      {
        data: {
          playerName: playerName.trim().substring(0, 20),
          score: Math.floor(score),
          distanceTraveled: Math.floor(distance),
          powerupsUsed,
          car: selectedCar,
          dailyMode: isDailyChallenge,
        },
      },
      {
        onSuccess: (created) => {
          // Carry the newly created row's id so the leaderboard can
          // highlight/scroll to it instead of dead-ending into an unrelated
          // page load right after the player's one moment of payoff.
          setLocation(`/leaderboard?highlight=${created.id}`);
        },
        onError: () => {
          toast({
            title: 'Error',
            description: 'Failed to submit score. Try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const dataURLToBlob = (dataUrl: string) => {
    const arr = dataUrl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], { type: mime });
  };

  const handleShare = () => {
    const name = playerName.trim() || 'WARBOSS';
    const url = generateShareCard(score, distance, name, selectedCar, isDailyChallenge);
    setShareUrl(url);
    // Trigger download
    setTimeout(() => {
      if (shareRef.current) shareRef.current.click();
    }, 50);
  };

  const handleShareNative = async () => {
    const name = playerName.trim() || 'WARBOSS';
    const url = generateShareCard(score, distance, name, selectedCar, isDailyChallenge);
    const fileName = `warboss-${Math.floor(score)}.png`;
    const file = new File([dataURLToBlob(url)], fileName, { type: 'image/png' });

    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `WARBOSS HIGHWAY — ${Math.floor(score).toLocaleString()} points`,
          text: `I survived ${Math.floor(distance).toLocaleString()}m in WARBOSS HIGHWAY!`,
          files: [file],
        });
        return;
      }
    } catch (err) {
      // User canceled or share failed — fall through to clipboard fallback
    }

    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': file }),
      ]);
      toast({ title: 'Copied', description: 'Score card copied to clipboard.' });
    } catch {
      // Final fallback: download
      setShareUrl(url);
      setTimeout(() => shareRef.current?.click(), 50);
    }
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-start bg-black/88 p-4 overflow-y-auto">
      <div className="w-full max-w-sm mx-auto mt-6 text-center">
        <h1 className="text-6xl font-black text-destructive tracking-tighter mb-1 drop-shadow-[0_0_15px_rgba(220,38,38,0.8)]">
          WASTED
        </h1>
        {isNewRecord && (
          <div className="text-accent font-black font-mono text-sm tracking-widest animate-pulse mb-2">
            ★ NEW PERSONAL RECORD ★
          </div>
        )}

        <div className="bg-card/90 border-2 border-border p-5 mt-4 backdrop-blur-sm space-y-0">
          {/* Stats */}
          <div className="space-y-3 mb-5 text-left font-mono">
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted-foreground text-sm">FINAL SCORE</span>
              <span className="text-2xl font-bold text-primary">{Math.floor(score).toLocaleString()}</span>
            </div>
            {personalBest > 0 && !isNewRecord && (
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <span className="text-muted-foreground text-sm">PERSONAL BEST</span>
                <span className="text-sm text-muted-foreground">{personalBest.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted-foreground text-sm">DISTANCE</span>
              <span className="text-lg text-foreground">{Math.floor(distance).toLocaleString()}m</span>
            </div>
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted-foreground text-sm">POWER-UPS</span>
              <span className="text-lg text-accent">{powerupsUsed}</span>
            </div>
            {isDailyChallenge && (
              <div className="flex justify-between items-center border-b border-border/50 pb-2">
                <span className="text-muted-foreground text-sm">MODE</span>
                <span className="text-sm text-green-400 font-bold">◆ DAILY</span>
              </div>
            )}
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted-foreground text-sm">SCRAP EARNED</span>
              <span className="text-lg text-accent font-bold">+{scrapEarned.toLocaleString()}</span>
            </div>
          </div>

          {/* Achievements earned this run */}
          {achievementsEarned.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2 text-left">
                Achievements Unlocked
              </p>
              <div className="flex flex-wrap gap-1.5">
                {achievementsEarned.map((id) => {
                  const a = getAchievementById(id);
                  if (!a) return null;
                  return (
                    <div
                      key={id}
                      className="flex items-center gap-1 bg-accent/10 border border-accent/30 px-2 py-1 text-[10px] font-mono text-accent"
                      title={a.description}
                    >
                      <span>{a.icon}</span>
                      <span className="font-bold">{a.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Score submit form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <label
                htmlFor="playerName"
                className="text-xs font-bold text-muted-foreground uppercase tracking-wider block text-left"
              >
                Callsign for Kill-Board
              </label>
              <Input
                id="playerName"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={20}
                placeholder="WARBOSS_99"
                className="font-mono uppercase bg-black/50 border-primary/50 focus-visible:ring-primary text-lg text-center h-12"
                required
                autoFocus
                autoComplete="off"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-14 text-lg font-black tracking-widest bg-primary hover:bg-primary/80 text-primary-foreground"
              disabled={submitScore.isPending}
            >
              {submitScore.isPending ? 'TRANSMITTING...' : 'SUBMIT TO KILL-BOARD'}
            </Button>
          </form>

          {/* Share card */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleShareNative}
              className="h-10 border-border/60 text-sm font-mono"
            >
              🔗 SHARE
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleShare}
              className="h-10 border-border/60 text-sm font-mono"
            >
              📸 SAVE
            </Button>
          </div>

          {/* Hidden download link for share card */}
          {shareUrl && (
            <a
              ref={shareRef}
              href={shareUrl}
              download={`warboss-${Math.floor(score)}.png`}
              className="hidden"
            >
              download
            </a>
          )}

          <div className="flex gap-2 mt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onRestart}
              className="flex-1 h-11 border-border hover:bg-secondary font-mono text-sm"
            >
              PLAY AGAIN
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              className="flex-1 h-11 border-border hover:bg-secondary font-mono text-sm"
            >
              MAIN MENU
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
