// Menu principal : solo, multijoueur (salon), paramètres.
import { BOT_NAMES, BOT_PERSONAS } from '../core/config';
import { Net, type LobbyMsg, type StartMsg } from './net';
import { settings, prefs, saveSettings, savePrefs } from './settings';
import { sfx } from './audio';

export interface SoloOpts { name: string; bots: { name: string; diff: number }[]; timeLimitMin: number; seed?: number; }
export interface MenuHooks {
  onSolo(o: SoloOpts): void;
  onMultiStart(net: Net, m: StartMsg): void;
  onResume(): void;
  onQuit(): void;
}
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const inp = (id: string) => document.getElementById(id) as HTMLInputElement;
const sel = (id: string) => document.getElementById(id) as HTMLSelectElement;
export const cleanName = (t: string) => t.replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, 16);
const PERS: Record<string, string> = { equilibre: 'équilibré', guerrier: 'guerrier', marchand: 'marchand', techno: 'technologue' };
const DIFFS = ['Facile', 'Normal', 'Difficile'];
const TIMES: [number, string][] = [[10, '10 minutes'], [15, '15 minutes'], [20, '20 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 heure'], [90, '1 h 30'], [0, 'Illimitée']];

export function initMenu(h: MenuHooks) {
  const screens = ['main', 'pause', 'solo', 'multi', 'settings', 'howto'];
  let current = 'main', back = 'main';
  let net: Net | null = null;
  let inGame = false;

  function show(name: string) {
    $('menu').style.display = 'flex';
    if (name === 'settings' || name === 'howto') back = current === 'settings' || current === 'howto' ? back : current;
    current = name;
    for (const s of screens) ($('scr-' + s) as HTMLElement).hidden = s !== name;
    $('menusub').style.display = name === 'main' || name === 'pause' ? '' : 'none';
    if (name === 'settings') syncSettings();
    if (name === 'solo') renderSolo();
    if (name === 'multi') renderMulti();
  }
  const hide = () => { $('menu').style.display = 'none'; };

  // ------------------------------------------------------------ solo
  const soloNames = () => { while (prefs.botNames.length < 9) prefs.botNames.push(''); return prefs.botNames; };
  const soloDiff = () => { while (prefs.botDiff.length < 9) prefs.botDiff.push(1); return prefs.botDiff; };
  function botRows(box: HTMLElement, n: number, names: string[], diffs: number[], editable: boolean, changed: () => void) {
    // ne reconstruit pas pendant la frappe
    box.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const row = document.createElement('div'); row.className = 'botrow';
      const num = document.createElement('span'); num.className = 'muted'; num.textContent = String(i + 1);
      const t = document.createElement('input'); t.type = 'text'; t.maxLength = 16; t.placeholder = BOT_NAMES[i % BOT_NAMES.length]; t.value = names[i] || ''; t.disabled = !editable;
      t.addEventListener('input', () => { names[i] = cleanName(t.value); changed(); });
      const d = document.createElement('select'); d.disabled = !editable;
      DIFFS.forEach((l, k) => { const o = document.createElement('option'); o.value = String(k); o.textContent = l; d.appendChild(o); });
      d.value = String(diffs[i] ?? 1);
      d.addEventListener('change', () => { diffs[i] = +d.value; changed(); });
      const p = document.createElement('span'); p.className = 'pers'; p.textContent = PERS[BOT_PERSONAS[i % BOT_PERSONAS.length]];
      row.append(num, t, d, p); box.appendChild(row);
    }
  }
  function fillTimes(s: HTMLSelectElement) {
    s.innerHTML = ''; for (const [v, l] of TIMES) { const o = document.createElement('option'); o.value = String(v); o.textContent = l; s.appendChild(o); }
  }
  fillTimes(sel('s-time')); fillTimes(sel('m-time'));
  function renderSolo() {
    inp('s-name').value = prefs.name;
    inp('s-nbots').value = String(prefs.nBots); $('s-nbots-v').textContent = String(prefs.nBots);
    sel('s-time').value = String(TIMES.some(t => t[0] === prefs.timeLimitMin) ? prefs.timeLimitMin : 45);
    botRows($('s-bots'), prefs.nBots, soloNames(), soloDiff(), true, savePrefs);
  }
  inp('s-nbots').addEventListener('input', () => { prefs.nBots = +inp('s-nbots').value; renderSolo(); savePrefs(); });
  sel('s-time').addEventListener('change', () => { prefs.timeLimitMin = +sel('s-time').value; savePrefs(); });
  inp('s-name').addEventListener('input', () => { prefs.name = cleanName(inp('s-name').value); savePrefs(); });

  // ------------------------------------------------------------ multijoueur
  const mNames = () => { while (prefs.mBotNames.length < 9) prefs.mBotNames.push(''); return prefs.mBotNames; };
  const mDiff = () => { while (prefs.mBotDiff.length < 9) prefs.mBotDiff.push(1); return prefs.mBotDiff; };
  const isWeb = /^https?:$/.test(location.protocol);
  function renderMulti() {
    inp('m-name').value = prefs.name;
    inp('m-addr').value = isWeb ? '' : prefs.server; inp('m-code').value = prefs.code;
    inp('m-addr').placeholder = isWeb ? 'vide = le serveur de cette page' : 'mon-jeu.onrender.com  ou  192.168.1.20:8080';
    $('m-addr-l').textContent = isWeb ? 'Adresse (option)' : 'Adresse du serveur';
    $('m-hint').innerHTML = isWeb
      ? 'Vous êtes sur la page du serveur : cliquez simplement sur « Se connecter ». Le premier connecté devient l’hôte du salon, il règle et lance la partie.'
      : 'Entrez l’adresse du serveur de jeu (celle que votre ami hôte ou l’hébergeur vous a donnée), ou ouvrez-la directement dans votre navigateur. Le premier connecté devient l’hôte du salon.';
    $('m-err').textContent = '';
    ($('m-connect') as HTMLElement).hidden = !!net; ($('m-lobby') as HTMLElement).hidden = !net;
    if (net && net.lobby) renderLobby(net.lobby);
  }
  let cfgTimer: number | undefined;
  function sendCfg() {
    clearTimeout(cfgTimer);
    cfgTimer = window.setTimeout(() => {
      if (!net) return;
      net.send({ t: 'cfg', cfg: { nBots: prefs.mBots, bots: mNames().map((n, i) => ({ name: n, diff: mDiff()[i] })).slice(0, 9), timeLimitMin: prefs.mTime } });
    }, 200);
  }
  function renderLobby(m: LobbyMsg) {
    const isHost = m.host === net?.myId;
    $('m-who').textContent = isHost ? 'Vous êtes l’hôte : réglez la partie puis lancez-la quand tout le monde est là.' : 'En attente de l’hôte pour lancer la partie…';
    $('m-players').innerHTML = m.players.map(p => `<div>${p.id === m.host ? '👑' : '👤'} <b>${p.name.replace(/[<>&"]/g, '')}</b>${p.id === net?.myId ? ' <span class="muted">(vous)</span>' : ''}</div>`).join('') +
      `<div class="muted small">${m.players.length} joueur(s) humain(s) — ${m.max} places au total avec les bots</div>`;
    const maxBots = Math.max(0, m.max - m.players.length);
    const nb = Math.min(m.cfg.nBots, maxBots);
    const rng = inp('m-nbots'); rng.max = String(maxBots); rng.disabled = !isHost;
    const typing = document.activeElement && ($('m-bots').contains(document.activeElement));
    if (!isHost) { prefs.mBots = nb; } else { prefs.mBots = Math.min(prefs.mBots, maxBots); }
    const shown = isHost ? prefs.mBots : nb;
    rng.value = String(shown); $('m-nbots-v').textContent = String(shown);
    const ts = sel('m-time'); ts.disabled = !isHost; ts.value = String(isHost ? prefs.mTime : m.cfg.timeLimitMin);
    if (!isHost) {
      const names = m.cfg.bots.map(b => b.name), diffs = m.cfg.bots.map(b => b.diff);
      botRows($('m-bots'), shown, names, diffs, false, () => {});
    } else if (!typing) botRows($('m-bots'), shown, mNames(), mDiff(), true, sendCfg);
    $('m-note').textContent = isHost ? `Les bots peuvent être nommés et réglés (${shown} bot(s) + ${m.players.length} humain(s)).` : '';
    const b = $('m-startbtn') as HTMLButtonElement; b.disabled = !isHost; b.style.opacity = isHost ? '1' : '.4';
    b.textContent = m.phase === 'playing' ? 'Partie en cours…' : 'Lancer la partie';
    if (m.phase === 'playing') { b.disabled = true; b.style.opacity = '.4'; }
  }
  inp('m-nbots').addEventListener('input', () => { prefs.mBots = +inp('m-nbots').value; $('m-nbots-v').textContent = String(prefs.mBots); if (net?.lobby) { botRows($('m-bots'), prefs.mBots, mNames(), mDiff(), true, sendCfg); } sendCfg(); savePrefs(); });
  sel('m-time').addEventListener('change', () => { prefs.mTime = +sel('m-time').value; sendCfg(); savePrefs(); });

  async function connect() {
    const name = cleanName(inp('m-name').value) || 'Joueur';
    prefs.name = name; prefs.server = inp('m-addr').value.trim(); prefs.code = inp('m-code').value.trim(); savePrefs();
    const btn = $('m-connectbtn') as HTMLButtonElement; btn.disabled = true; $('m-err').textContent = 'Connexion…'; $('m-err').className = 'muted small';
    try {
      const n = await Net.connect(prefs.server, name, prefs.code, msg => { $('m-err').textContent = msg; });
      net = n;
      n.onLobby = m => { if (current === 'multi' && !($('m-lobby') as HTMLElement).hidden) renderLobby(m); };
      n.onStart = m => { h.onMultiStart(n, m); };
      n.onClose = reason => { net = null; inGame = false; h.onQuit(); show('multi'); $('m-err').textContent = reason; $('m-err').className = 'err small'; };
      show('multi');
    } catch (e: any) { $('m-err').textContent = e.message || String(e); $('m-err').className = 'err small'; }
    btn.disabled = false;
  }
  function leaveRoom() { net?.leave(); net = null; show('multi'); }

  // ------------------------------------------------------------ paramètres
  function syncSettings() {
    inp('o-sound').checked = settings.sound; inp('o-vol').value = String(Math.round(settings.volume * 100));
    sel('o-quality').value = settings.quality; sel('o-fps').value = String(settings.fps); inp('o-labels').checked = settings.labels;
  }
  let onSettings: () => void = () => {};
  const apply = () => { settings.sound = inp('o-sound').checked; settings.volume = +inp('o-vol').value / 100; settings.quality = sel('o-quality').value as 'high' | 'low'; settings.fps = +sel('o-fps').value as 30 | 60; settings.labels = inp('o-labels').checked; saveSettings(); onSettings(); };
  for (const id of ['o-sound', 'o-vol', 'o-quality', 'o-fps', 'o-labels']) $(id).addEventListener('change', apply);
  $('o-vol').addEventListener('input', apply);

  // ------------------------------------------------------------ clics
  $('menu').addEventListener('click', e => {
    const el = (e.target as HTMLElement).closest('[data-go],[data-act],[data-all]') as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    sfx.click();
    if (el.dataset.go) { if (el.dataset.go === 'main' && inGame) show('pause'); else show(el.dataset.go); return; }
    if (el.dataset.all !== undefined) { const d = +el.dataset.all; for (let i = 0; i < 9; i++) soloDiff()[i] = d; savePrefs(); renderSolo(); return; }
    switch (el.dataset.act) {
      case 'back': show(back); break;
      case 'resume': hide(); h.onResume(); break;
      case 'quit': {
        const b = el as HTMLButtonElement;
        if (b.dataset.armed) { b.dataset.armed = ''; b.textContent = 'Quitter la partie'; inGame = false; h.onQuit(); if (net) { net.leave(); net = null; } show('main'); }
        else { b.dataset.armed = '1'; b.textContent = 'Cliquer encore pour confirmer'; setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Quitter la partie'; }, 3500); }
        break;
      }
      case 'solostart': {
        const n = prefs.nBots, names = soloNames(), diffs = soloDiff();
        const seedTxt = inp('s-seed').value.trim();
        inGame = true; hide();
        h.onSolo({ name: cleanName(inp('s-name').value) || 'Vous', bots: Array.from({ length: n }, (_, i) => ({ name: cleanName(names[i] || ''), diff: diffs[i] ?? 1 })), timeLimitMin: prefs.timeLimitMin, seed: /^\d+$/.test(seedTxt) ? +seedTxt : undefined });
        break;
      }
      case 'connect': void connect(); break;
      case 'leave': leaveRoom(); break;
      case 'mstart': net?.send({ t: 'start' }); break;
      case 'testsound': sfx.attack(); setTimeout(sfx.ally, 350); break;
      case 'fullscreen': if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}); break;
    }
  });
  for (const id of ['m-name', 'm-addr', 'm-code']) $(id).addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') void connect(); });

  show('main');
  return {
    show, hide,
    isOpen: () => $('menu').style.display !== 'none',
    setInGame: (v: boolean) => { inGame = v; },
    pause: () => { show('pause'); },
    escape: () => { if (current === 'pause') { hide(); h.onResume(); } else if (current === 'settings' || current === 'howto') show(back); },
    onSettings: (f: () => void) => { onSettings = f; },
    /** fin d'une partie multijoueur : retour au salon si la connexion tient, au menu sinon */
    backToLobby: () => { inGame = false; if (net) show('multi'); else show('main'); },
    get net() { return net; },
  };
}
