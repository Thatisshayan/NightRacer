import { useEffect, useRef, useState } from 'react';
import { GameEngine, GameState } from '@/lib/game/engine';
import { GameOverOverlay } from '@/components/game-over-overlay';
import { playAudio, toggleMute, getMuted } from '@/lib/game/audio';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameOverState, setGameOverState] = useState<GameState | null>(null);
  const [isMuted, setIsMuted] = useState(getMuted());

  // Mount/Unmount
  useEffect(() => {
    // Preload menu music
    if (!isPlaying && !gameOverState) {
      playAudio('menu', true);
    }
    
    return () => {
      if (engineRef.current) {
        engineRef.current.cleanup();
      }
    };
  }, [isPlaying, gameOverState]);

  const startGame = () => {
    if (!canvasRef.current) return;
    
    setGameOverState(null);
    setIsPlaying(true);
    
    if (engineRef.current) {
      engineRef.current.cleanup();
    }
    
    engineRef.current = new GameEngine(canvasRef.current, (state) => {
      setGameOverState(state);
      setIsPlaying(false);
    });
    
    engineRef.current.start();
  };

  const handleToggleMute = () => {
    setIsMuted(toggleMute());
  };

  return (
    <div className="relative w-full h-[100dvh] bg-black overflow-hidden flex items-center justify-center">
      {/* Game Canvas Container */}
      <div className="relative w-full max-w-[420px] h-full shadow-2xl shadow-primary/20">
        <canvas
          ref={canvasRef}
          width={420}
          height={800} // Logical size, scales via CSS
          className="w-full h-full object-cover touch-none"
        />

        {/* Start Screen */}
        {!isPlaying && !gameOverState && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 p-6 text-center">
            <div className="mb-12 animate-pulse">
              <h1 className="text-5xl font-black text-primary drop-shadow-[0_0_10px_rgba(220,38,38,0.8)] tracking-tighter leading-none mb-2">
                WARBOSS
              </h1>
              <h2 className="text-4xl font-black text-white tracking-widest">
                HIGHWAY
              </h2>
            </div>
            
            <p className="text-muted-foreground font-mono text-sm mb-10 max-w-[280px]">
              Dodge oncoming traffic.<br/>
              Swipe or use A/D to steer.<br/>
              Survive the wasteland.
            </p>

            <Button 
              onClick={startGame}
              size="lg"
              className="h-16 px-12 text-2xl font-black tracking-widest rounded-none border-2 border-primary bg-primary hover:bg-transparent hover:text-primary transition-all uppercase"
            >
              START ENGINE
            </Button>
          </div>
        )}

        {/* Game Over Screen */}
        {gameOverState && (
          <GameOverOverlay 
            score={gameOverState.score}
            distance={gameOverState.distance}
            powerupsUsed={gameOverState.powerUpsUsed}
            onRestart={startGame}
          />
        )}

        {/* Audio Toggle */}
        <button
          onClick={handleToggleMute}
          className="absolute top-4 right-4 z-20 p-2 bg-black/50 text-white rounded-full border border-border/50 hover:bg-black/80 transition-colors"
        >
          {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
      </div>
    </div>
  );
}
