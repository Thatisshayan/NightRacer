import { useState } from 'react';
import { useSubmitScore } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLocation } from 'wouter';
import { useToast } from '@/hooks/use-toast';

interface GameOverOverlayProps {
  score: number;
  distance: number;
  powerupsUsed: number;
  onRestart: () => void;
}

export function GameOverOverlay({ score, distance, powerupsUsed, onRestart }: GameOverOverlayProps) {
  const [playerName, setPlayerName] = useState('');
  const submitScore = useSubmitScore();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;

    submitScore.mutate({
      data: {
        playerName: playerName.trim().substring(0, 20),
        score: Math.floor(score),
        distanceTraveled: Math.floor(distance),
        powerupsUsed
      }
    }, {
      onSuccess: () => {
        setLocation('/leaderboard');
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to submit score. Try again.",
          variant: "destructive"
        });
      }
    });
  };

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/80 p-4">
      <div className="text-center animate-in zoom-in duration-300">
        <h1 className="text-6xl md:text-8xl font-black text-destructive tracking-tighter mb-2 drop-shadow-[0_0_15px_rgba(220,38,38,0.8)]">
          WASTED
        </h1>
        
        <div className="bg-card/90 border-2 border-border p-6 mt-8 max-w-sm w-full mx-auto backdrop-blur-sm">
          <div className="space-y-4 mb-6 text-left font-mono">
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted-foreground">FINAL SCORE</span>
              <span className="text-2xl font-bold text-primary">{Math.floor(score)}</span>
            </div>
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted-foreground">DISTANCE</span>
              <span className="text-xl text-foreground">{Math.floor(distance)}m</span>
            </div>
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted-foreground">POWER-UPS</span>
              <span className="text-xl text-accent">{powerupsUsed}</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="playerName" className="text-xs font-bold text-muted-foreground uppercase tracking-wider block text-left">
                Enter Callsign for Kill-Board
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
              {submitScore.isPending ? 'TRANSMITTING...' : 'SUBMIT SCORE'}
            </Button>
            
            <Button 
              type="button" 
              variant="outline" 
              onClick={onRestart}
              className="w-full h-12 border-border hover:bg-secondary"
            >
              PLAY AGAIN (NO SUBMIT)
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
