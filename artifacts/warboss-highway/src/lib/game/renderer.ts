import { type GameState, type ObstacleType, POP_DURATION_MS } from './engine';

// Ease-out pop scale: peaks right when a `*Pop` timer is (re)triggered, decays
// back to 1 over POP_DURATION_MS. Mirrors the screen-shake/level-up-flash
// pattern already used for hit/level-up feedback, applied to score/combo text.
const popScale = (popMs: number, peak: number) => {
  const t = Math.max(0, Math.min(1, popMs / POP_DURATION_MS));
  return 1 + (peak - 1) * t * t;
};

export const drawHUD = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: GameState,
  speedMultiplier: number
) => {
  ctx.save();

  // Top HUD background
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, width, 72);

  // Score (pops on TANK/BOSS kills — see engine.ts scorePop)
  ctx.save();
  ctx.translate(15, 34);
  ctx.scale(popScale(state.scorePop, 1.3), popScale(state.scorePop, 1.3));
  ctx.font = '24px "Russo One", sans-serif';
  ctx.fillStyle = state.activePowerUp === 'SCORE_BLAST' ? '#ffaa00' : '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${Math.floor(state.score)}`, 0, 0);
  ctx.restore();

  // Distance & speed
  ctx.font = '13px "Roboto Mono", monospace';
  ctx.fillStyle = '#888';
  ctx.textAlign = 'left';
  ctx.fillText(`DIST: ${Math.floor(state.distance)}m  SPD: ${speedMultiplier.toFixed(1)}×`, 15, 58);

  // Combo counter (top center, pops on each near-miss — see engine.ts comboPop)
  if (state.combo > 1) {
    ctx.save();
    ctx.translate(width / 2, 34);
    ctx.scale(popScale(state.comboPop, 1.5), popScale(state.comboPop, 1.5));
    ctx.font = '13px "Roboto Mono", monospace';
    ctx.fillStyle = '#ffee22';
    ctx.textAlign = 'center';
    ctx.fillText(`COMBO ×${state.combo}`, 0, 0);
    ctx.restore();
  }

  // Daily challenge badge
  if (state.isDailyChallenge) {
    ctx.font = '10px "Roboto Mono", monospace';
    ctx.fillStyle = '#55ffaa';
    ctx.textAlign = 'center';
    ctx.fillText('◆ DAILY CHALLENGE', width / 2, 60);
  }

  // Lives (top right)
  ctx.textAlign = 'right';
  for (let i = 0; i < state.lives; i++) {
    ctx.fillStyle = '#cc0000';
    ctx.beginPath();
    const hx = width - 22 - i * 26;
    const hy = 28;
    ctx.moveTo(hx, hy + 6);
    ctx.lineTo(hx - 9, hy - 2);
    ctx.lineTo(hx - 5, hy - 8);
    ctx.lineTo(hx, hy - 5);
    ctx.lineTo(hx + 5, hy - 8);
    ctx.lineTo(hx + 9, hy - 2);
    ctx.fill();
  }

  // Oil slick indicator
  if (state.player.oilSlicked) {
    ctx.font = '12px "Roboto Mono", monospace';
    ctx.fillStyle = '#8888ff';
    ctx.textAlign = 'right';
    ctx.fillText('⚠ SLIPPING', width - 12, 60);
  }

  // Active power-up bar (bottom left)
  if (state.activePowerUp && state.powerUpTimer > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(10, height - 58, 210, 48);

    let color = '#fff';
    let label = '';
    if (state.activePowerUp === 'SHIELD')      { color = '#00ffff'; label = '🛡 SHIELD'; }
    if (state.activePowerUp === 'SLOWMO')      { color = '#ffff00'; label = '⏱ SLOW-MO'; }
    if (state.activePowerUp === 'SCORE_BLAST') { color = '#ffaa00'; label = '★ SCORE BLAST'; }

    const maxDur = state.activePowerUp === 'SHIELD' ? 5000 : state.activePowerUp === 'SCORE_BLAST' ? 6000 : 4000;
    const barFill = Math.max(0, (state.powerUpTimer / maxDur) * 140);
    const timerSeconds = Math.max(0, Math.ceil(state.powerUpTimer / 1000));

    ctx.fillStyle = color;
    ctx.font = '16px "Russo One", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 20, height - 34);

    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(20, height - 26, 140, 8);
    ctx.fillStyle = color;
    ctx.fillRect(20, height - 26, barFill, 8);

    ctx.font = '12px "Roboto Mono", monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(`${timerSeconds}s`, 168, height - 28);
  }

  // Speedometer gauge (bottom right)
  const cx = width - 48;
  const cy = height - 48;
  const radius = 36;
  const speedRatio = Math.min(1, speedMultiplier / 3);
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const fillAngle = startAngle + (endAngle - startAngle) * speedRatio;

  // Background arc
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.stroke();

  // Fill arc
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, fillAngle);
  const speedColor = speedMultiplier >= 2.5 ? '#ff3333' : speedMultiplier >= 1.8 ? '#ffaa00' : '#55ffaa';
  ctx.strokeStyle = speedColor;
  ctx.lineCap = 'round';
  ctx.shadowColor = speedColor;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineCap = 'butt';

  // Speed text
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px "Roboto Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${speedMultiplier.toFixed(1)}×`, cx, cy + 2);
  ctx.font = '8px "Roboto Mono", monospace';
  ctx.fillStyle = '#888';
  ctx.fillText('SPD', cx, cy - 14);

  ctx.restore();
};

export const drawObstacle = (
  ctx: CanvasRenderingContext2D,
  type: ObstacleType,
  w: number,
  h: number
) => {
  ctx.save();

  if (type === 'OIL_SLICK') {
    const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, w / 2);
    grad.addColorStop(0,   'rgba(100, 20, 200, 0.85)');
    grad.addColorStop(0.5, 'rgba(0, 50, 120, 0.70)');
    grad.addColorStop(1,   'rgba(0, 0, 30, 0.20)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // Iridescent edge
    ctx.strokeStyle = 'rgba(160, 110, 255, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Text warning
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('OIL', 0, 0);
  } else if (type === 'DEBRIS') {
    const chunks: [number, number, number, number, string][] = [
      [-w * 0.3, -h * 0.2, 10, 7,  '#6a5040'],
      [ w * 0.1, -h * 0.3,  8, 6,  '#504030'],
      [-w * 0.1,  h * 0.1, 11, 5,  '#403020'],
      [ w * 0.25, h * 0.2,  7, 9,  '#5a4535'],
      [-w * 0.05, h * 0.3,  6, 4,  '#303030'],
    ];
    chunks.forEach(([cx, cy, cw, ch, col]) => {
      ctx.fillStyle = col;
      ctx.fillRect(cx, cy, cw, ch);
    });
  }

  ctx.restore();
};

export const drawVehicle = (
  ctx: CanvasRenderingContext2D,
  type: string,
  w: number,
  h: number,
  color: string
) => {
  ctx.save();

  if (type === 'SEDAN' || type === 'WAR_RUNNER') {
    ctx.fillStyle = color || '#555';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#222';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 10, w - 8, h - 20);
    ctx.fillStyle = '#88aaff';
    ctx.fillRect(-w / 2 + 5, -h / 2 + 11, w - 10, 6);
    ctx.fillRect(-w / 2 + 5,  h / 2 - 17, w - 10, 6);
  }
  else if (type === 'RATTLETRAP') {
    // Wide boxy rusted truck
    ctx.fillStyle = color || '#5a3a1a';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#3a1a0a';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 8, w - 8, h - 18);
    ctx.fillStyle = '#669999';
    ctx.fillRect(-w / 2 + 6, -h / 2 + 10, w - 12, 7);
    // Rust patches
    ctx.fillStyle = 'rgba(120,50,10,0.5)';
    ctx.fillRect(-w / 2 + 2, -h / 4, 9, 9);
    ctx.fillRect( w / 2 - 11,  h / 4, 9, 7);
    // Front bumper
    ctx.fillStyle = '#888';
    ctx.fillRect(-w / 2 + 2, h / 2 - 6, w - 4, 5);
  }
  else if (type === 'DEATHSLED') {
    // Narrow sleek wedge
    ctx.fillStyle = color || '#1a1a2e';
    ctx.beginPath();
    ctx.moveTo(0,          h / 2);
    ctx.lineTo(-w / 2,     h / 4);
    ctx.lineTo(-w / 2 + 2, -h / 2);
    ctx.lineTo( w / 2 - 2, -h / 2);
    ctx.lineTo( w / 2,     h / 4);
    ctx.closePath();
    ctx.fill();
    // Neon blue trim
    ctx.strokeStyle = '#4466ff';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Dark windshield
    ctx.fillStyle = '#0a0a22';
    ctx.fillRect(-w / 2 + 4, -h / 3, w - 8, h / 4);
    // Blue taillights
    ctx.fillStyle = '#4488ff';
    ctx.fillRect(-w / 2 + 2,  h / 2 - 5, 5, 4);
    ctx.fillRect( w / 2 - 7,  h / 2 - 5, 5, 4);
  }
  else if (type === 'PICKUP') {
    ctx.fillStyle = color || '#453c31';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#222';
    ctx.fillRect(-w / 2 + 2, -h / 2 + 8, w - 4, h / 2);
    ctx.fillStyle = '#88aaff';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 9, w - 8, 6);
  }
  else if (type === 'COP') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#000';
    ctx.fillRect(-w / 2, -h / 2 + 5, w, h - 10);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(-w / 2 + 2, -h / 2 + 16, w / 2 - 2, 5);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0,           -h / 2 + 16, w / 2 - 2, 5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-w / 2 + 4, -h / 2 + 24, w - 8, h - 42);
  }
  else if (type === 'BOXTRUCK') {
    ctx.fillStyle = '#dcdcdc';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = color || '#333';
    ctx.fillRect(-w / 2 + 4, h / 2 - 18, w - 8, 18);
    ctx.fillStyle = '#88aaff';
    ctx.fillRect(-w / 2 + 6, h / 2 - 16, w - 12, 6);
  }
  else if (type === 'BUS') {
    ctx.fillStyle = color || '#4b5320';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = '#111';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(-w / 2 + 2, -h / 2 + 10 + i * (h / 5), 4, h / 5 - 4);
      ctx.fillRect( w / 2 - 6, -h / 2 + 10 + i * (h / 5), 4, h / 5 - 4);
    }
  }
  else if (type === 'SPORTS') {
    ctx.fillStyle = color || '#cc0000';
    ctx.beginPath();
    ctx.moveTo(0,       h / 2);
    ctx.lineTo(-w / 2,  h / 4);
    ctx.lineTo(-w / 2 + 2, -h / 2);
    ctx.lineTo( w / 2 - 2, -h / 2);
    ctx.lineTo( w / 2,  h / 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(-w / 2 + 6, -h / 4, w - 12, h / 3);
  }
  else if (type === 'TANK') {
    ctx.fillStyle = '#2b331f';
    ctx.fillRect(-w / 2 + 10, -h / 2, w - 20, h);
    ctx.fillStyle = '#111';
    ctx.fillRect(-w / 2, -h / 2 - 5, 10, h + 10);
    ctx.fillRect( w / 2 - 10, -h / 2 - 5, 10, h + 10);
    ctx.fillStyle = '#3c4a2c';
    ctx.beginPath();
    ctx.arc(0, 0, w / 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1f12';
    ctx.fillRect(-4, 0, 8, h / 2 + 20);
  }
  else if (type === 'SCRAPQUEEN') {
    // Wide armoured behemoth — welded scrap plates, purple hue
    ctx.fillStyle = color || '#7a4a8a';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // Armour plating — overlapping panels
    ctx.fillStyle = '#5a2a6a';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 5, w - 6, h * 0.4);
    ctx.fillRect(-w / 2 + 3,  h / 2 - h * 0.35, w - 6, h * 0.33);
    // Weld seams
    ctx.strokeStyle = '#9a6aaa';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 3, 0); ctx.lineTo(w / 2 - 3, 0);
    ctx.moveTo(0, -h / 2 + 5); ctx.lineTo(0, h / 2 - 5);
    ctx.stroke();
    // Heavy front bumper
    ctx.fillStyle = '#aaa';
    ctx.fillRect(-w / 2 + 2, h / 2 - 8, w - 4, 7);
    // Spikes on bumper
    ctx.fillStyle = '#888';
    for (let i = 0; i < 4; i++) {
      const sx = -w / 2 + 8 + i * ((w - 16) / 3);
      ctx.beginPath();
      ctx.moveTo(sx, h / 2 + 4);
      ctx.lineTo(sx - 3, h / 2 - 1);
      ctx.lineTo(sx + 3, h / 2 - 1);
      ctx.closePath();
      ctx.fill();
    }
    // Purple taillights
    ctx.fillStyle = '#cc44ff';
    ctx.shadowColor = '#cc44ff';
    ctx.shadowBlur = 6;
    ctx.fillRect(-w / 2 + 4, -h / 2 + 4, 7, 4);
    ctx.fillRect( w / 2 - 11, -h / 2 + 4, 7, 4);
    ctx.shadowBlur = 0;
    // Cracked windshield
    ctx.fillStyle = '#336644';
    ctx.fillRect(-w / 2 + 6, -h / 2 + 10, w - 12, 8);
  }
  else if (type === 'PHANTOM') {
    // Ultra-narrow ghost racer — teal neon, translucent
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color || '#00ffcc';
    // Sleek needle body
    ctx.beginPath();
    ctx.moveTo(0,         h / 2);
    ctx.lineTo(-w / 2,    h / 3);
    ctx.lineTo(-w / 2 + 1, -h / 2 + 4);
    ctx.lineTo( w / 2 - 1, -h / 2 + 4);
    ctx.lineTo( w / 2,    h / 3);
    ctx.closePath();
    ctx.fill();
    // Neon glow outline
    ctx.shadowColor = '#00ffcc';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#00ffcc';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // Ghost cockpit — near-invisible
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-w / 2 + 2, -h / 4, w - 4, h / 5);
    ctx.globalAlpha = 0.85;
    // Trailing exhaust shimmer at rear
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#00ffcc';
    ctx.beginPath();
    ctx.ellipse(0, h / 2 + 6, w / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  else if (type === 'BOSS') {
    // Massive armored war-rig
    const bw = w, bh = h;
    // Hull
    ctx.fillStyle = color || '#1a0a00';
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    // Armored panel
    ctx.fillStyle = '#2a1200';
    ctx.fillRect(-bw / 2 + 5, -bh / 2 + 6, bw - 10, bh - 12);
    // Treads
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(-bw / 2,      -bh / 2 - 4, 14, bh + 8);
    ctx.fillRect( bw / 2 - 14, -bh / 2 - 4, 14, bh + 8);
    // Tread details
    ctx.fillStyle = '#1a1a1a';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(-bw / 2 + 2, -bh / 2 + i * (bh / 5), 10, bh / 5 - 2);
      ctx.fillRect( bw / 2 - 12, -bh / 2 + i * (bh / 5), 10, bh / 5 - 2);
    }
    // Front spikes
    ctx.fillStyle = '#888';
    for (let i = 0; i < 5; i++) {
      const sx = -bw / 2 + 20 + i * ((bw - 40) / 4);
      ctx.beginPath();
      ctx.moveTo(sx, -bh / 2 - 10);
      ctx.lineTo(sx - 5, -bh / 2);
      ctx.lineTo(sx + 5, -bh / 2);
      ctx.closePath();
      ctx.fill();
    }
    // Red visor slit
    ctx.fillStyle = '#cc0000';
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 8;
    ctx.fillRect(-bw / 2 + 18, -bh / 4 - 2, bw - 36, 9);
    ctx.shadowBlur = 0;
    // Skull emblem
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.min(22, bh / 4)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('☠', 0, bh / 6);
    // Chain bumper
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-bw / 2 + 15, bh / 2);
    ctx.lineTo( bw / 2 - 15, bh / 2);
    ctx.stroke();
  }

  ctx.restore();
};
