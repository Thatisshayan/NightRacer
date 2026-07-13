import { type PowerUpType, type GameState } from './engine';

export const drawHUD = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  speedMultiplier: number
) => {
  ctx.save();
  
  // HUD Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(0, 0, width, 50);

  // Score
  ctx.font = '24px "Russo One", sans-serif';
  ctx.fillStyle = state.activePowerUp === 'SCORE_BLAST' ? '#ffaa00' : '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${Math.floor(state.score)}`, 15, 32);

  // Speed/Distance
  ctx.font = '14px "Roboto Mono", monospace';
  ctx.fillStyle = '#aaaaaa';
  ctx.fillText(`DIST: ${Math.floor(state.distance)}m | SPD: ${speedMultiplier.toFixed(1)}x`, 15, 65);

  // Lives
  ctx.textAlign = 'right';
  for (let i = 0; i < state.lives; i++) {
    ctx.fillStyle = '#cc0000';
    ctx.beginPath();
    const x = width - 25 - (i * 25);
    const y = 25;
    // Draw a simple chunky heart
    ctx.moveTo(x, y + 5);
    ctx.lineTo(x - 8, y - 3);
    ctx.lineTo(x - 4, y - 8);
    ctx.lineTo(x, y - 5);
    ctx.lineTo(x + 4, y - 8);
    ctx.lineTo(x + 8, y - 3);
    ctx.fill();
  }

  // Active Power-up
  if (state.activePowerUp && state.powerUpTimer > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(10, height - 50, 200, 40);
    
    let color = '#fff';
    let label = '';
    if (state.activePowerUp === 'SHIELD') { color = '#00ffff'; label = 'SHIELD'; }
    if (state.activePowerUp === 'SLOWMO') { color = '#ffff00'; label = 'SLOW-MO'; }
    if (state.activePowerUp === 'SCORE_BLAST') { color = '#ffaa00'; label = 'SCORE BLAST'; }
    
    ctx.fillStyle = color;
    ctx.font = '18px "Russo One", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 20, height - 25);
    
    // Timer bar
    ctx.fillStyle = color;
    const barWidth = 100 * (state.powerUpTimer / (state.activePowerUp === 'SHIELD' ? 5000 : state.activePowerUp === 'SLOWMO' ? 4000 : 6000));
    ctx.fillRect(110, height - 35, Math.max(0, barWidth), 10);
  }

  // Wasted state handled via React UI instead to easily overlay the form

  ctx.restore();
};

export const drawVehicle = (ctx: CanvasRenderingContext2D, type: string, w: number, h: number, color: string) => {
  ctx.save();
  
  if (type === 'SEDAN') {
    ctx.fillStyle = color || '#555';
    ctx.fillRect(-w/2, -h/2, w, h);
    // Roof
    ctx.fillStyle = '#222';
    ctx.fillRect(-w/2 + 4, -h/2 + 10, w - 8, h - 20);
    // Windshields
    ctx.fillStyle = '#88aaff';
    ctx.fillRect(-w/2 + 5, -h/2 + 11, w - 10, 6);
    ctx.fillRect(-w/2 + 5, h/2 - 17, w - 10, 6);
  } 
  else if (type === 'PICKUP') {
    // Bed
    ctx.fillStyle = color || '#453c31';
    ctx.fillRect(-w/2, -h/2, w, h);
    // Cab
    ctx.fillStyle = '#222';
    ctx.fillRect(-w/2 + 2, -h/2 + 8, w - 4, h/2);
    // Windshield
    ctx.fillStyle = '#88aaff';
    ctx.fillRect(-w/2 + 4, -h/2 + 9, w - 8, 6);
  }
  else if (type === 'COP') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(-w/2, -h/2, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(-w/2, -h/2 + 5, w, h - 10);
    // Lights
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(-w/2 + 2, -h/2 + 15, w/2 - 2, 4);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, -h/2 + 15, w/2 - 2, 4);
    // Roof
    ctx.fillStyle = '#fff';
    ctx.fillRect(-w/2 + 4, -h/2 + 22, w - 8, h - 40);
  }
  else if (type === 'BOXTRUCK') {
    ctx.fillStyle = '#dcdcdc';
    ctx.fillRect(-w/2, -h/2, w, h);
    // Cab
    ctx.fillStyle = color || '#333';
    ctx.fillRect(-w/2 + 4, h/2 - 15, w - 8, 15);
  }
  else if (type === 'BUS') {
    ctx.fillStyle = color || '#4b5320';
    ctx.fillRect(-w/2, -h/2, w, h);
    // Windows
    ctx.fillStyle = '#111';
    for(let i=0; i<5; i++) {
        ctx.fillRect(-w/2 + 2, -h/2 + 10 + i*(h/5), 4, (h/5)-4);
        ctx.fillRect(w/2 - 6, -h/2 + 10 + i*(h/5), 4, (h/5)-4);
    }
  }
  else if (type === 'SPORTS') {
    ctx.fillStyle = color || '#cc0000';
    ctx.beginPath();
    ctx.moveTo(0, h/2); // front tip
    ctx.lineTo(-w/2, h/4);
    ctx.lineTo(-w/2 + 2, -h/2);
    ctx.lineTo(w/2 - 2, -h/2);
    ctx.lineTo(w/2, h/4);
    ctx.closePath();
    ctx.fill();
    // Windshield
    ctx.fillStyle = '#111';
    ctx.fillRect(-w/2 + 6, -h/4, w - 12, h/3);
  }
  else if (type === 'TANK') {
    ctx.fillStyle = '#2b331f';
    ctx.fillRect(-w/2 + 10, -h/2, w - 20, h);
    // Treads
    ctx.fillStyle = '#111';
    ctx.fillRect(-w/2, -h/2 - 5, 10, h + 10);
    ctx.fillRect(w/2 - 10, -h/2 - 5, 10, h + 10);
    // Turret
    ctx.fillStyle = '#3c4a2c';
    ctx.beginPath();
    ctx.arc(0, 0, w/3, 0, Math.PI * 2);
    ctx.fill();
    // Cannon (facing up)
    ctx.fillStyle = '#1a1f12';
    ctx.fillRect(-4, 0, 8, h/2 + 20);
  }

  ctx.restore();
};
