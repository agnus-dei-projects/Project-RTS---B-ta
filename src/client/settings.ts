// Préférences enregistrées dans le navigateur (localStorage, avec repli silencieux s'il est indisponible).
export interface Settings { sound: boolean; volume: number; quality: 'high' | 'low'; fps: 30 | 60; labels: boolean; }
export interface Prefs {
  name: string; code: string; nBots: number; timeLimitMin: number; botNames: string[]; botDiff: number[]; server: string;
  mBots: number; mTime: number; mBotNames: string[]; mBotDiff: number[];
}
const DEF_S: Settings = { sound: true, volume: 0.6, quality: 'high', fps: 60, labels: true };
const DEF_P: Prefs = {
  name: '', code: '', nBots: 9, timeLimitMin: 45, botNames: [], botDiff: [], server: '',
  mBots: 5, mTime: 30, mBotNames: [], mBotDiff: [],
};
function load<T>(key: string, def: T): T {
  try { const raw = localStorage.getItem(key); if (raw) return { ...def, ...JSON.parse(raw) }; } catch { /* stockage indisponible */ }
  return { ...def };
}
function save(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignoré */ } }
export const settings: Settings = load('rts-settings', DEF_S);
export const prefs: Prefs = load('rts-prefs', DEF_P);
export const saveSettings = () => save('rts-settings', settings);
export const savePrefs = () => save('rts-prefs', prefs);
