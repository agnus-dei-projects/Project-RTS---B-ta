// Effets sonores synthétisés (aucun fichier audio : le jeu reste un seul HTML léger).
import { settings } from './settings';
let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (!settings.sound || settings.volume <= 0) return null;
  try {
    if (!ctx) { const C = window.AudioContext || (window as any).webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { return null; }
  return ctx;
}
function tone(freq: number, dur: number, type: OscillatorType, at = 0, gain = 0.5, to = 0) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const v = gain * settings.volume * 0.3;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const sfx = {
  click: () => tone(520, 0.05, 'square', 0, 0.4),
  attack: () => { tone(180, 0.18, 'sawtooth', 0, 0.7, 90); tone(300, 0.1, 'square', 0.04, 0.4, 150); },
  build: () => { tone(330, 0.07, 'square', 0, 0.6); tone(440, 0.09, 'square', 0.07, 0.6); },
  coin: () => { tone(880, 0.06, 'square', 0, 0.5); tone(1320, 0.1, 'square', 0.06, 0.5); },
  proposal: () => { tone(660, 0.1, 'triangle', 0, 0.7); tone(880, 0.14, 'triangle', 0.1, 0.7); },
  ally: () => { tone(523, 0.1, 'triangle', 0, 0.7); tone(659, 0.1, 'triangle', 0.1, 0.7); tone(784, 0.2, 'triangle', 0.2, 0.7); },
  alarm: () => { tone(300, 0.15, 'sawtooth', 0, 0.6); tone(300, 0.15, 'sawtooth', 0.22, 0.6); },
  tech: () => { [440, 554, 659, 880].forEach((f, i) => tone(f, 0.12, 'square', i * 0.08, 0.5)); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', i * 0.14, 0.8)); },
  lose: () => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.28, 'triangle', i * 0.18, 0.8)); },
  error: () => tone(160, 0.12, 'square', 0, 0.5),
};
