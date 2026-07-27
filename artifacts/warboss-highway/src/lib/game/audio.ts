// ── Web Audio API synthesised sound engine ─────────────────────────────────
// No audio files required — all SFX are generated procedurally.
// Music is a looping generative drone built from oscillators.
import { Settings } from './settings';

let ctx: AudioContext | null = null;
let isMuted = Settings.getMuted();
let musicGain: GainNode | null = null;
let musicNodes: AudioNode[] = [];
let musicPlaying = false;

const getCtx = (): AudioContext => {
  if (!ctx) ctx = new AudioContext();
  return ctx;
};

// ── Helpers ────────────────────────────────────────────────────────────────

const osc = (
  ac: AudioContext,
  freq: number,
  type: OscillatorType,
  start: number,
  end: number,
  gainPeak = 0.3,
  freqEnd?: number,
  dest: AudioNode = ac.destination
) => {
  const g = ac.createGain();
  g.gain.setValueAtTime(gainPeak, start);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  g.connect(dest);

  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (freqEnd !== undefined) {
    o.frequency.exponentialRampToValueAtTime(freqEnd, end);
  }
  o.connect(g);
  o.start(start);
  o.stop(end);
};

const noise = (ac: AudioContext, start: number, dur: number, gainPeak = 0.3, dest: AudioNode = ac.destination) => {
  const bufLen = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const g = ac.createGain();
  g.gain.setValueAtTime(gainPeak, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  g.connect(dest);

  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(g);
  src.start(start);
  src.stop(start + dur);
};

// ── SFX ────────────────────────────────────────────────────────────────────

const sfx: Record<string, () => void> = {
  crash: () => {
    const ac = getCtx();
    const t = ac.currentTime;
    noise(ac, t, 0.25, 0.45);
    osc(ac, 120, 'sawtooth', t, t + 0.3, 0.25, 30);
  },

  powerup: () => {
    const ac = getCtx();
    const t = ac.currentTime;
    [220, 330, 440, 660].forEach((f, i) => {
      osc(ac, f, 'square', t + i * 0.07, t + i * 0.07 + 0.12, 0.18);
    });
  },

  shield: () => {
    const ac = getCtx();
    const t = ac.currentTime;
    osc(ac, 880, 'sine', t, t + 0.4, 0.2, 1200);
    osc(ac, 440, 'sine', t + 0.05, t + 0.35, 0.1, 660);
  },

  gameover: () => {
    const ac = getCtx();
    const t = ac.currentTime;
    [330, 277, 220, 165].forEach((f, i) => {
      osc(ac, f, 'sawtooth', t + i * 0.18, t + i * 0.18 + 0.28, 0.22);
    });
    noise(ac, t, 0.12, 0.15);
  },

  scrap: () => {
    const ac = getCtx();
    const t = ac.currentTime;
    osc(ac, 1047, 'sine', t, t + 0.12, 0.15, 1568);
    osc(ac, 1319, 'sine', t + 0.06, t + 0.16, 0.1);
  },

  upgrade: () => {
    const ac = getCtx();
    const t = ac.currentTime;
    [261, 329, 392, 523].forEach((f, i) => {
      osc(ac, f, 'triangle', t + i * 0.09, t + i * 0.09 + 0.18, 0.2);
    });
  },

  uiClick: () => {
    const ac = getCtx();
    const t = ac.currentTime;
    osc(ac, 600, 'square', t, t + 0.06, 0.08, 400);
  },
};

// ── Generative background music ────────────────────────────────────────────
// A simple two-oscillator drone + slow LFO that loops indefinitely.

const stopMusic = () => {
  musicNodes.forEach(n => {
    try { (n as OscillatorNode).stop?.(); } catch {}
    try { n.disconnect(); } catch {}
  });
  musicNodes = [];
  musicPlaying = false;
};

const startMusic = (type: 'menu' | 'gameplay') => {
  if (musicPlaying) return;
  const ac = getCtx();
  if (ac.state === 'suspended') ac.resume();

  musicGain = ac.createGain();
  musicGain.gain.setValueAtTime(0.07, ac.currentTime);
  musicGain.connect(ac.destination);

  const root = type === 'menu' ? 110 : 82.4;
  const fifth = root * 1.5;
  const pad1 = ac.createOscillator();
  pad1.type = 'sawtooth';
  pad1.frequency.value = root;

  const pad2 = ac.createOscillator();
  pad2.type = 'square';
  pad2.frequency.value = fifth;

  // Slow LFO tremolo
  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = type === 'menu' ? 0.4 : 1.2;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 0.03;
  lfo.connect(lfoGain);
  lfoGain.connect(musicGain.gain);

  // Filter for warmth
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = type === 'menu' ? 600 : 900;
  filter.Q.value = 1.5;

  pad1.connect(filter);
  pad2.connect(filter);
  filter.connect(musicGain);

  pad1.start();
  pad2.start();
  lfo.start();

  musicNodes = [pad1, pad2, lfo, lfoGain, filter, musicGain];
  musicPlaying = true;
};

// ── Public API (matches old audio.ts signature) ────────────────────────────

export const audioCache: Record<string, unknown> = {}; // kept for compat

export const playAudio = (
  type: 'gameplay' | 'menu' | 'crash' | 'powerup' | 'shield' | 'gameover' | 'scrap' | 'upgrade' | 'uiClick',
  loop = false
) => {
  if (isMuted) return;
  try {
    if (type === 'gameplay' || type === 'menu') {
      startMusic(type);
    } else {
      sfx[type]?.();
    }
  } catch (e) {
    // AudioContext blocked (e.g. before first user gesture) — silently skip
  }
};

export const stopAudio = (type: string) => {
  if (type === 'gameplay' || type === 'menu') {
    stopMusic();
  }
};

// `type` is unused (kept for call-site compat — only one music channel now).
// Suspends the whole audio graph rather than just fading the music gain, so
// SFX triggered while "paused" stay silent too instead of still audibly firing.
export const pauseAudio = (_type?: string) => {
  if (ctx && ctx.state === 'running') ctx.suspend();
};

export const resumeAudio = (_type?: string) => {
  if (isMuted) return;
  if (ctx && ctx.state === 'suspended') ctx.resume();
};

export const toggleMute = (): boolean => {
  isMuted = !isMuted;
  Settings.setMuted(isMuted);
  if (isMuted) {
    pauseAudio();
  } else {
    resumeAudio();
  }
  return isMuted;
};

export const getMuted = () => isMuted;
