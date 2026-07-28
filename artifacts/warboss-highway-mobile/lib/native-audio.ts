import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import type { AudioAdapter } from '@workspace/game-core';
import { Settings } from './settings';

// Native counterpart to the web app's Web-Audio-API-synthesized audio.ts.
// There's no live-oscillator-synthesis API in React Native, so instead of
// porting the *synthesis engine*, its output is pre-rendered once offline
// (scripts/generate-sfx.mjs, matching the exact same waveform/envelope
// math) into assets/audio/*.wav, played here via expo-audio. See that
// script's header comment for the full rationale.
const SFX_SOURCES = {
  crash: require('../assets/audio/crash.wav'),
  powerup: require('../assets/audio/powerup.wav'),
  shield: require('../assets/audio/shield.wav'),
  gameover: require('../assets/audio/gameover.wav'),
  scrap: require('../assets/audio/scrap.wav'),
  upgrade: require('../assets/audio/upgrade.wav'),
  uiClick: require('../assets/audio/uiClick.wav'),
} as const;

const MUSIC_SOURCES = {
  menu: require('../assets/audio/music_menu.wav'),
  gameplay: require('../assets/audio/music_gameplay.wav'),
} as const;

type SfxCue = keyof typeof SFX_SOURCES;
type MusicCue = keyof typeof MUSIC_SOURCES;

function isSfxCue(cue: string): cue is SfxCue {
  return cue in SFX_SOURCES;
}
function isMusicCue(cue: string): cue is MusicCue {
  return cue in MUSIC_SOURCES;
}

// One player per SFX cue, reused and seeked back to 0 on each trigger —
// cheaper than creating/tearing down a player per play() call, and these
// are all under ~0.5s so overlapping retriggers aren't a real concern.
const sfxPlayers = new Map<SfxCue, AudioPlayer>();
function getSfxPlayer(cue: SfxCue): AudioPlayer {
  let player = sfxPlayers.get(cue);
  if (!player) {
    player = createAudioPlayer(SFX_SOURCES[cue]);
    sfxPlayers.set(cue, player);
  }
  return player;
}

let musicPlayer: AudioPlayer | null = null;
let currentMusicCue: MusicCue | null = null;

function playMusic(cue: MusicCue) {
  if (currentMusicCue === cue) {
    if (!Settings.getMuted()) musicPlayer?.play();
    return;
  }
  musicPlayer?.pause();
  musicPlayer?.remove();
  musicPlayer = createAudioPlayer(MUSIC_SOURCES[cue]);
  musicPlayer.loop = true;
  musicPlayer.volume = 0.35;
  currentMusicCue = cue;
  if (!Settings.getMuted()) musicPlayer.play();
}

function stopMusic() {
  musicPlayer?.pause();
  musicPlayer?.remove();
  musicPlayer = null;
  currentMusicCue = null;
}

export const NativeAudio: AudioAdapter = {
  play(cue) {
    if (Settings.getMuted()) return;
    if (isMusicCue(cue)) {
      playMusic(cue);
    } else if (isSfxCue(cue)) {
      const player = getSfxPlayer(cue);
      player.seekTo(0).catch(() => {});
      player.play();
    }
  },
  stop(cue) {
    if (isMusicCue(cue)) stopMusic();
  },
};

export function pauseMusic(): void {
  musicPlayer?.pause();
}
export function resumeMusic(): void {
  if (!Settings.getMuted()) musicPlayer?.play();
}

export function toggleMuted(): boolean {
  const muted = !Settings.getMuted();
  Settings.setMuted(muted);
  if (muted) musicPlayer?.pause();
  else musicPlayer?.play();
  return muted;
}
export function getMutedState(): boolean {
  return Settings.getMuted();
}
