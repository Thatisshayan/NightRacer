import gameplayTrack from "@assets/generated_audio/gameplay_track.mp3";
import menuTrack from "@assets/generated_audio/menu_track.mp3";
import sfxCrash from "@assets/generated_audio/sfx_crash.mp3";
import sfxPowerup from "@assets/generated_audio/sfx_powerup.mp3";
import sfxShield from "@assets/generated_audio/sfx_shield.mp3";
import sfxGameover from "@assets/generated_audio/sfx_gameover.mp3";
import { Settings } from './settings';

export const audioCache: Record<string, HTMLAudioElement> = {};
let isMuted = Settings.getMuted();

const initAudio = () => {
  if (!audioCache['gameplay']) audioCache['gameplay'] = new Audio(gameplayTrack);
  if (!audioCache['menu']) audioCache['menu'] = new Audio(menuTrack);
  if (!audioCache['crash']) audioCache['crash'] = new Audio(sfxCrash);
  if (!audioCache['powerup']) audioCache['powerup'] = new Audio(sfxPowerup);
  if (!audioCache['shield']) audioCache['shield'] = new Audio(sfxShield);
  if (!audioCache['gameover']) audioCache['gameover'] = new Audio(sfxGameover);
};

export const playAudio = (
  type: 'gameplay' | 'menu' | 'crash' | 'powerup' | 'shield' | 'gameover',
  loop = false
) => {
  if (isMuted) return;
  initAudio();
  
  const audio = audioCache[type];
  if (audio && audio.src) {
    audio.loop = loop;
    if (!loop) {
      audio.currentTime = 0;
    }
    audio.play().catch(e => console.warn("Audio play blocked", e));
  }
};

export const stopAudio = (type: string) => {
  if (audioCache[type]) {
    audioCache[type].pause();
    audioCache[type].currentTime = 0;
  }
};

export const pauseAudio = (type: string) => {
  if (audioCache[type]) {
    audioCache[type].pause();
  }
};

export const resumeAudio = (type: string) => {
  if (isMuted) return;
  if (audioCache[type]) {
    audioCache[type].play().catch(e => console.warn("Audio resume blocked", e));
  }
};

export const toggleMute = () => {
  isMuted = !isMuted;
  Settings.setMuted(isMuted);
  if (isMuted) {
    Object.values(audioCache).forEach(a => a.pause());
  } else {
    // Rely on game logic to resume music
  }
  return isMuted;
};

export const getMuted = () => isMuted;
