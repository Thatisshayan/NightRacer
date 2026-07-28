#!/usr/bin/env node
// Renders the same procedurally-generated SFX/music the web app synthesizes
// live via the Web Audio API (see
// artifacts/warboss-highway/src/lib/game/audio.ts) into real WAV files —
// there's no live-oscillator-synthesis API in React Native, so instead of
// porting the *engine* we bake its output once, offline, sample-by-sample,
// matching the exact same waveform/envelope math (oscillator type,
// frequency glide, exponential gain decay). Run with `node
// scripts/generate-sfx.mjs` whenever the web version's sound design
// changes — outputs to assets/audio/*.wav, played by lib/native-audio.ts
// via expo-audio.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SAMPLE_RATE = 44100;
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'audio');

/**
 * @typedef {{
 *   type: 'sine'|'square'|'sawtooth'|'triangle'|'noise',
 *   start: number, end: number,
 *   gainPeak: number,
 *   freqStart?: number, freqEnd?: number,
 * }} Note
 */

// Mirrors audio.ts's osc()/noise() gain envelope: set to gainPeak exactly
// at `start`, then Web Audio's exponentialRampToValueAtTime decays it to
// 0.0001 by `end` — an exponential (not linear) interpolation.
function envelope(t, start, end, gainPeak) {
  if (t < start || t > end) return 0;
  const span = end - start;
  if (span <= 0) return gainPeak;
  const frac = (t - start) / span;
  return gainPeak * Math.pow(0.0001 / gainPeak, frac);
}

// Same exponential glide for frequency when freqEnd is set (matches
// osc()'s `frequency.exponentialRampToValueAtTime(freqEnd, end)`).
function instantaneousFreq(t, start, end, freqStart, freqEnd) {
  if (freqEnd === undefined) return freqStart;
  const span = end - start;
  const frac = span <= 0 ? 1 : Math.max(0, Math.min(1, (t - start) / span));
  return freqStart * Math.pow(freqEnd / freqStart, frac);
}

function waveform(type, phase) {
  const cyc = phase / (2 * Math.PI);
  const frac = cyc - Math.floor(cyc);
  switch (type) {
    case 'sine':
      return Math.sin(phase);
    case 'square':
      return Math.sin(phase) >= 0 ? 1 : -1;
    case 'sawtooth':
      return 2 * frac - 1;
    case 'triangle':
      return 4 * Math.abs(frac - 0.5) - 1;
    default:
      return 0;
  }
}

/** @param {Note[]} notes */
function render(notes) {
  const duration = Math.max(...notes.map((n) => n.end)) + 0.05;
  const length = Math.ceil(duration * SAMPLE_RATE);
  const samples = new Float32Array(length);
  const phases = notes.map(() => 0);

  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    let sum = 0;
    notes.forEach((note, idx) => {
      const gain = envelope(t, note.start, note.end, note.gainPeak);
      if (gain <= 0) return;
      if (note.type === 'noise') {
        sum += gain * (Math.random() * 2 - 1);
        return;
      }
      const freq = instantaneousFreq(t, note.start, note.end, note.freqStart, note.freqEnd);
      phases[idx] += (2 * Math.PI * freq) / SAMPLE_RATE;
      sum += gain * waveform(note.type, phases[idx]);
    });
    samples[i] = sum;
  }

  // Soft-clip instead of hard-clip — several notes stacking briefly can
  // exceed [-1, 1], and a hard clip crackles.
  for (let i = 0; i < length; i++) {
    samples[i] = Math.tanh(samples[i]);
  }

  return samples;
}

function encodeWav(samples) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * bytesPerSample);
  }

  return buffer;
}

// ── SFX definitions — exact params from audio.ts's `sfx` object ───────────
const SFX = {
  crash: [
    { type: 'noise', start: 0, end: 0.25, gainPeak: 0.45 },
    { type: 'sawtooth', start: 0, end: 0.3, gainPeak: 0.25, freqStart: 120, freqEnd: 30 },
  ],
  powerup: [220, 330, 440, 660].map((f, i) => ({
    type: 'square',
    start: i * 0.07,
    end: i * 0.07 + 0.12,
    gainPeak: 0.18,
    freqStart: f,
  })),
  shield: [
    { type: 'sine', start: 0, end: 0.4, gainPeak: 0.2, freqStart: 880, freqEnd: 1200 },
    { type: 'sine', start: 0.05, end: 0.35, gainPeak: 0.1, freqStart: 440, freqEnd: 660 },
  ],
  gameover: [
    ...[330, 277, 220, 165].map((f, i) => ({
      type: 'sawtooth',
      start: i * 0.18,
      end: i * 0.18 + 0.28,
      gainPeak: 0.22,
      freqStart: f,
    })),
    { type: 'noise', start: 0, end: 0.12, gainPeak: 0.15 },
  ],
  scrap: [
    { type: 'sine', start: 0, end: 0.12, gainPeak: 0.15, freqStart: 1047, freqEnd: 1568 },
    { type: 'sine', start: 0.06, end: 0.16, gainPeak: 0.1, freqStart: 1319 },
  ],
  upgrade: [261, 329, 392, 523].map((f, i) => ({
    type: 'triangle',
    start: i * 0.09,
    end: i * 0.09 + 0.18,
    gainPeak: 0.2,
    freqStart: f,
  })),
  uiClick: [{ type: 'square', start: 0, end: 0.06, gainPeak: 0.08, freqStart: 600, freqEnd: 400 }],
};

// ── Looping ambient drones — simplified approximation of audio.ts's
// startMusic() (two oscillators + LFO tremolo + lowpass filter). A true
// biquad lowpass isn't worth implementing for this; using smoother
// waveforms (sine + a softened square-ish tone) gets a similar "warm pad"
// character without it.
//
// For a genuinely seamless loop (no click at the seam), every oscillator
// — including the tremolo LFO — must complete a whole number of cycles
// within the loop duration, AND the duration itself must land on an exact
// sample boundary (duration * SAMPLE_RATE must itself be an integer, or
// accumulated phase drifts by a fraction of a sample per loop). This is
// checked at generation time instead of assumed — an earlier version of
// this script asserted the loop was seamless without actually verifying
// the math, and it wasn't (329.6 and 494.4 cycles for the gameplay
// track's two oscillators — an audible click every loop).
function assertIntegerCycles(label, hz, durationSec) {
  const cycles = hz * durationSec;
  if (Math.abs(cycles - Math.round(cycles)) > 1e-9) {
    throw new Error(`${label}: ${hz}Hz over ${durationSec}s = ${cycles} cycles (not an integer) — loop will click`);
  }
}

function renderDrone(root, fifth, lfoHz, durationSec) {
  assertIntegerCycles('root', root, durationSec);
  assertIntegerCycles('fifth', fifth, durationSec);
  assertIntegerCycles('lfo', lfoHz, durationSec);
  const exactLength = durationSec * SAMPLE_RATE;
  if (Math.abs(exactLength - Math.round(exactLength)) > 1e-9) {
    throw new Error(`duration ${durationSec}s * ${SAMPLE_RATE}Hz = ${exactLength} samples (not an integer) — loop will drift`);
  }
  const length = Math.round(exactLength);

  const samples = new Float32Array(length);
  let phase1 = 0;
  let phase2 = 0;
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    phase1 += (2 * Math.PI * root) / SAMPLE_RATE;
    phase2 += (2 * Math.PI * fifth) / SAMPLE_RATE;
    const tremolo = 1 + 0.4 * Math.sin(2 * Math.PI * lfoHz * t);
    const pad1 = waveform('sine', phase1) * 0.5;
    const pad2 = waveform('triangle', phase2) * 0.35;
    samples[i] = (pad1 + pad2) * tremolo * 0.18;
  }
  return samples;
}

// 5s duration: at 44100Hz that's exactly 220500 samples, and every
// oscillator (including both LFOs) completes a whole number of cycles —
// verified by assertIntegerCycles above, not just asserted in a comment.
const MUSIC = {
  menu: () => renderDrone(110, 165, 0.4, 5),
  gameplay: () => renderDrone(82.4, 123.6, 1.2, 5),
};

for (const [name, notes] of Object.entries(SFX)) {
  const wav = encodeWav(render(notes));
  writeFileSync(path.join(OUT_DIR, `${name}.wav`), wav);
  console.log(`wrote ${name}.wav (${wav.length} bytes)`);
}

for (const [name, generator] of Object.entries(MUSIC)) {
  const wav = encodeWav(generator());
  writeFileSync(path.join(OUT_DIR, `music_${name}.wav`), wav);
  console.log(`wrote music_${name}.wav (${wav.length} bytes)`);
}
