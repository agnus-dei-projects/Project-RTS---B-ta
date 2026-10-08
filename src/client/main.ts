import * as G from '../core/game';
import {
  BALANCE as B, BUILDINGS, TECH_LEVELS, TECH_TABLE, RES_ICONS, RES_NAMES, NRES, NKIND, TPS, TITLE_NAMES,
  K_UNI, K_BARRACKS, K_PORT, K_MARKET,
} from '../core/config';
import { W, H, NCELL, TERRAIN, LAND, LAND_COUNT, DEPT, DEPT_NAMES, REGION, REGION_NAMES } from '../core/world';
import { drawBuilding } from './sprites';
import type { State, Command } from '../core/types';
import { settings } from './settings';
import { sfx } from './audio';
import { initMenu, type SoloOpts } from './menu';
import { Net, type StartMsg } from './net';

let ME = 0;
const TURN_TICKS = 2;        // un tour réseau = 2 ticks
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const fmt = (n: number) => Math.floor(n + 1e-9).toLocaleString('fr-FR');
const esc = (t: string) => t.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]!));
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------- partie
const params = new URLSearchParams(location.search);
let seed = params.has('seed') ? +params.get('seed')! : (Date.now() % 1000000);
let S: State = G.newGame(seed);        // carte de fond du menu
let multi = false;
let net: Net | null = null;
let gameId = 0;
let lastSolo: SoloOpts | null = null;
let lastSpeed = 1;
let overSent = false;
const getDpr = () => (settings.quality === 'low' ? 1 : (window.devicePixelRatio || 1));
let speed = 1;
let started = false;
let mode: 'attack' | 'pan' | 'build' = 'attack';
let buildKind = -1;
let brush = 3;
let tab = 'build';
const view = { k: 4, tx: 0, ty: 0, fit: 4 };
let hover = -1;
let lastProposals = 0;
let breakArmed = -1;

// ---------------------------------------------------------------- rendu pixel
const canvas = $('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const off = document.createElement('canvas'); off.width = W; off.height = H;
const octx = off.getContext('2d')!;
const img = octx.createImageData(W, H);
const hash = (c: number) => { let h = Math.imul(c ^ 0x9e3779b1, 2654435761) >>> 0; h ^= h >>> 15; return (h & 255) / 255; };
const baseRGB = new Uint8Array(NCELL * 3);
const noise = new Int8Array(NCELL);
{
  for (let c = 0; c < NCELL; c++) {
    const t = TERRAIN[c], n = hash(c);
    noise[c] = Math.round((n - 0.5) * 14);
    let r: number, g: number, b: number;
    if (t === 1) {
      // terre : vert / ocre selon un bruit à basse fréquence, plus clair sur la côte
      const x = c % W, y = (c / W) | 0;
      const low = hash(((x >> 2) * 73856093) ^ ((y >> 2) * 19349663));
      r = 92 + low * 36; g = 126 + low * 18; b = 70 + low * 10;
      if (TERRAIN[c - 1] === 0 || TERRAIN[c + 1] === 0 || TERRAIN[c - W] === 0 || TERRAIN[c + W] === 0) { r += 34; g += 24; b += 8; }
    } else if (t === 2) { r = 66; g = 62; b = 58; }
    else {
      r = 12; g = 30; b = 54;
      // eaux peu profondes près des côtes
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) { const n2 = c + dy * W + dx; if (n2 >= 0 && n2 < NCELL && TERRAIN[n2] !== 0) { near = true; break; } }
      if (near) { r = 20; g = 48; b = 82; }
    }
    baseRGB[c * 3] = r; baseRGB[c * 3 + 1] = g; baseRGB[c * 3 + 2] = b;
  }
}
const hex = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
let pcol = S.players.map(p => hex(p.color));
const paint = new Uint8Array(NCELL);
let paintList: number[] = [];
const orderMark = new Uint8Array(NCELL);
let lastVersion = -1, overlayDirty = true, dirty = true;

function compose() {
  const d = img.data;
  const low = settings.quality === 'low';
  orderMark.fill(0);
  for (const o of S.orders) if (o.p === ME) for (const c of o.mask) if (S.owner[c] !== ME) orderMark[c] = 1;
  for (let c = 0; c < NCELL; c++) {
    let r = baseRGB[c * 3], g = baseRGB[c * 3 + 1], b = baseRGB[c * 3 + 2];
    if (TERRAIN[c] === 1) {
      const o = S.owner[c], n = low ? 0 : noise[c];
      if (o >= 0) {
        const pc = pcol[o];
        r = pc[0] * 0.8 + r * 0.2 + n; g = pc[1] * 0.8 + g * 0.2 + n; b = pc[2] * 0.8 + b * 0.2 + n;
        if ((TERRAIN[c - 1] === 1 && S.owner[c - 1] !== o) || (TERRAIN[c + 1] === 1 && S.owner[c + 1] !== o) ||
            (TERRAIN[c - W] === 1 && S.owner[c - W] !== o) || (TERRAIN[c + W] === 1 && S.owner[c + W] !== o)) { r *= 0.52; g *= 0.52; b *= 0.52; }
      } else { r += n; g += n; b += n; }
      if (orderMark[c]) { r = r * 0.7 + 255 * 0.3; g = g * 0.7 + 230 * 0.3; b = b * 0.7; }
      if (paint[c]) { r = r * 0.35 + 255 * 0.65; g = g * 0.35 + 220 * 0.65; b = b * 0.35 + 40 * 0.65; }
    }
    const i = c * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  lastVersion = S.version; overlayDirty = false;
}

// étiquettes (nom + soldats) au centre de chaque territoire
let labels: { p: number; x: number; y: number }[] = [];
let labelTick = -1;
function updateLabels() {
  const sx = new Float64Array(S.players.length), sy = new Float64Array(S.players.length), n = new Int32Array(S.players.length);
  for (let i = 0; i < LAND.length; i++) { const c = LAND[i], o = S.owner[c]; if (o >= 0) { sx[o] += c % W; sy[o] += (c / W) | 0; n[o]++; } }
  labels = [];
  for (const p of S.players) {
    if (!p.alive || n[p.id] < 20) continue;
    let mx = sx[p.id] / n[p.id], my = sy[p.id] / n[p.id];
    // si le centre n'est pas à nous, on cherche la case à nous la plus proche
    if (S.owner[Math.round(my) * W + Math.round(mx)] !== p.id) {
      let best = -1, bd = 1e18;
      for (let i = 0; i < LAND.length; i += 3) { const c = LAND[i]; if (S.owner[c] !== p.id) continue; const dd = ((c % W) - mx) ** 2 + (((c / W) | 0) - my) ** 2; if (dd < bd) { bd = dd; best = c; } }
      if (best >= 0) { mx = best % W; my = (best / W) | 0; }
    }
    labels.push({ p: p.id, x: mx, y: my });
  }
  labelTick = S.tick;
}

function draw() {
  const dpr = getDpr();
  const cw = canvas.width / dpr, ch = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0c1e36'; ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = false;
  const k = view.k;
  ctx.drawImage(off, 0, 0, W, H, Math.round(view.tx), Math.round(view.ty), Math.round(W * k), Math.round(H * k));
  const sx = (x: number) => Math.round(view.tx + x * k), sy = (y: number) => Math.round(view.ty + y * k);

  // bâtiments
  const u = Math.max(1, Math.floor((2.4 * k - 4) / 7));
  const size = 7 * u + 2 * Math.max(1, Math.round(u));
  for (const b of S.buildings) {
    const x = sx((b.cell % W) + 0.5) - (size >> 1), y = sy(((b.cell / W) | 0) + 0.5) - (size >> 1);
    if (x < -size || y < -size || x > cw || y > ch) continue;
    drawBuilding(ctx, b.kind, x, y, u, S.players[b.owner].color);
  }
  // étiquettes
  if (labelTick !== S.tick && S.tick % TPS === 0) updateLabels();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (settings.labels) for (const l of labels) {
    const p = S.players[l.p];
    const fs = Math.max(0, Math.min(22, Math.sqrt(p.cells) * k * 0.3));
    if (fs < 9) continue;
    const x = sx(l.x + 0.5), y = sy(l.y + 0.5);
    ctx.font = `700 ${Math.round(fs)}px ui-monospace, Consolas, monospace`;
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,12,18,.9)'; ctx.fillStyle = '#fff';
    ctx.strokeText(p.name, x, y - fs * 0.55); ctx.fillText(p.name, x, y - fs * 0.55);
    ctx.font = `700 ${Math.round(fs * 0.9)}px ui-monospace, Consolas, monospace`;
    const t = fmt(p.troops);
    ctx.strokeText(t, x, y + fs * 0.5); ctx.fillStyle = '#ffe9a0'; ctx.fillText(t, x, y + fs * 0.5);
  }
  // fantôme de construction / pinceau
  if (hover >= 0) {
    const hx = hover % W, hy = (hover / W) | 0;
    if (mode === 'build' && buildKind >= 0) {
      const err = G.placementError(S, hover, ME, buildKind);
      const x = sx(hx + 0.5) - (size >> 1), y = sy(hy + 0.5) - (size >> 1);
      drawBuilding(ctx, buildKind, x, y, u, err ? '#ff5050' : '#6dff9b', 0.9);
      ctx.strokeStyle = err ? '#ff5050' : '#6dff9b'; ctx.lineWidth = 2;
      ctx.strokeRect(x - 3, y - 3, size + 6, size + 6);
      const hint = $('buildhint'); hint.style.display = 'block';
      hint.textContent = `${BUILDINGS[buildKind].name} — ${err ?? 'cliquez pour poser'}`;
    } else if (mode === 'attack') {
      ctx.strokeStyle = 'rgba(255,224,90,.9)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx(hx + 0.5), sy(hy + 0.5), (brush + 0.5) * k, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (!(mode === 'build' && buildKind >= 0)) $('buildhint').style.display = 'none';
  dirty = false;
}

// ---------------------------------------------------------------- vue
function resize() {
  const wrap = $('mapwrap');
  const dpr = getDpr();
  const w = wrap.clientWidth, h = wrap.clientHeight;
  canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  view.fit = Math.min(w / W, h / H);
  if (view.k < view.fit * 0.8) view.k = view.fit * 0.8;
  dirty = true;
}
function centerOn(cx: number, cy: number, k?: number) {
  const wrap = $('mapwrap');
  if (k) view.k = Math.max(view.fit * 0.8, Math.min(28, k));
  view.tx = wrap.clientWidth / 2 - cx * view.k; view.ty = wrap.clientHeight / 2 - cy * view.k;
  dirty = true;
}
function centerOnPlayer(p: number, k?: number) {
  if (labelTick < 0) updateLabels();
  const l = labels.find(x => x.p === p);
  if (l) centerOn(l.x, l.y, k);
}
const toCell = (px: number, py: number) => {
  const gx = Math.floor((px - view.tx) / view.k), gy = Math.floor((py - view.ty) / view.k);
  return gx >= 0 && gy >= 0 && gx < W && gy < H ? gy * W + gx : -1;
};

// ---------------------------------------------------------------- commandes
function toast(msg: string, err = false) {
  const t = $('toast');
  t.textContent = msg; t.className = err ? 'err show' : 'show';
  clearTimeout((toast as any)._t);
  (toast as any)._t = setTimeout(() => { t.className = ''; }, 2600);
}
function sfxFor(c: Command) {
  switch (c.type) {
    case 'attack': sfx.attack(); break;
    case 'build': sfx.build(); break;
    case 'trade': case 'draft': sfx.coin(); break;
    case 'accept': sfx.ally(); break;
    default: sfx.click();
  }
}
function cmd(c: Command): boolean {
  if (multi) {
    if (!S.players[ME].alive) { toast('Vous êtes éliminé : vous observez la partie', true); return false; }
    net!.send({ t: 'cmd', c }); sfxFor(c);
    return true;           // le résultat (ou l'erreur) arrive avec le prochain tour
  }
  const e = G.applyCommand(S, c);
  if (e) { toast(e, true); sfx.error(); } else sfxFor(c);
  dirty = true; overlayDirty = true; ui(true);
  return e === null;
}

// ---------------------------------------------------------------- pinceau d'attaque
function stamp(cx0: number, cy0: number) {
  const r = brush;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r + r * 0.5) continue;
    const x = cx0 + dx, y = cy0 + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const c = y * W + x;
    if (TERRAIN[c] !== 1 || paint[c]) continue;
    const o = S.owner[c];
    if (o === ME || (o >= 0 && G.allied(S, ME, o))) continue;
    paint[c] = 1; paintList.push(c);
  }
  overlayDirty = true;
}
function stampLine(c0: number, c1: number) {
  let x0 = c0 % W, y0 = (c0 / W) | 0; const x1 = c1 % W, y1 = (c1 / W) | 0;
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) stamp(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n));
  void x0; void y0;
}
function clearPaint() { for (const c of paintList) paint[c] = 0; paintList = []; overlayDirty = true; }
function launchPaint() {
  if (!paintList.length) { toast('Zone sans cible (surlignez du terrain qui n’est pas à vous)', true); return; }
  const pct = +(($('pct') as HTMLInputElement).value);
  const n = paintList.length, cells = paintList.slice();
  clearPaint();
  if (cmd({ type: 'attack', p: ME, cells, pct })) toast(`Offensive lancée : ${n} cases visées, ${pct} % des soldats engagés`);
}

// ---------------------------------------------------------------- souris
type Drag = { kind: 'pan' | 'paint'; x0: number; y0: number; tx0: number; ty0: number; last: number };
let drag: Drag | null = null;
const local = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  if (!started) return;
  canvas.setPointerCapture(e.pointerId);
  const p = local(e), c = toCell(p.x, p.y);
  if (e.button === 1 || e.button === 2 || mode === 'pan') { drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, tx0: view.tx, ty0: view.ty, last: c }; canvas.style.cursor = 'grabbing'; return; }
  if (e.button !== 0) return;
  if (mode === 'build') {
    if (buildKind >= 0 && c >= 0) cmd({ type: 'build', p: ME, kind: buildKind, cell: c });
    return;
  }
  clearPaint();
  drag = { kind: 'paint', x0: e.clientX, y0: e.clientY, tx0: 0, ty0: 0, last: c };
  if (c >= 0) stamp(c % W, (c / W) | 0);
});
canvas.addEventListener('pointermove', e => {
  const p = local(e), c = toCell(p.x, p.y);
  if (c !== hover) { hover = c; dirty = true; showTip(c, p.x, p.y); }
  else if (c >= 0) showTip(c, p.x, p.y);
  if (!drag) return;
  if (drag.kind === 'pan') { view.tx = drag.tx0 + (e.clientX - drag.x0); view.ty = drag.ty0 + (e.clientY - drag.y0); dirty = true; }
  else if (c >= 0) { if (drag.last >= 0) stampLine(drag.last, c); else stamp(c % W, (c / W) | 0); drag.last = c; }
});
canvas.addEventListener('pointerup', () => {
  if (drag?.kind === 'paint') launchPaint();
  drag = null; canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
});
canvas.addEventListener('pointerleave', () => { hover = -1; $('tip').style.display = 'none'; dirty = true; });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const p = local(e as unknown as PointerEvent);
  const nk = Math.min(28, Math.max(view.fit * 0.8, view.k * Math.pow(1.0018, -e.deltaY)));
  const real = nk / view.k;
  view.tx = p.x - (p.x - view.tx) * real; view.ty = p.y - (p.y - view.ty) * real; view.k = nk; dirty = true;
}, { passive: false });

function showTip(c: number, x: number, y: number) {
  const tip = $('tip');
  if (c < 0 || TERRAIN[c] !== 1) { tip.style.display = 'none'; return; }
  const o = S.owner[c], b = S.bld[c];
  let html = `<b>${DEPT[c] ? DEPT_NAMES[DEPT[c] - 1] : ''}</b> <span class="muted">${REGION_NAMES[REGION[c]]}</span><br>` +
    `<span class="dot" style="background:${o >= 0 ? S.players[o].color : '#5d7a4c'}"></span>${o >= 0 ? esc(S.players[o].name) : 'Neutre'}`;
  if (o >= 0 && G.allied(S, ME, o)) html += ' 🤝';
  if (b >= 0) html += `<br>${BUILDINGS[S.buildings[b].kind].name}`;
  tip.innerHTML = html; tip.style.display = 'block';
  const wrap = $('mapwrap');
  tip.style.left = Math.min(x + 14, wrap.clientWidth - tip.offsetWidth - 6) + 'px';
  tip.style.top = Math.min(y + 14, wrap.clientHeight - tip.offsetHeight - 6) + 'px';
}

// ---------------------------------------------------------------- interface
const lastSig: Record<string, string> = {};
function setHTML(id: string, sig: string, html: () => string) {
  if (lastSig[id] === sig) return;
  lastSig[id] = sig; $(id).innerHTML = html();
}
const costChips = (cost: { gold: number; res: number[] }) => {
  const me = S.players[ME];
  let h = `<span class="chip${me.gold >= cost.gold ? '' : ' no'}">${fmt(cost.gold)} or</span>`;
  cost.res.forEach((v, r) => { if (v) h += `<span class="chip${me.res[r] >= v ? '' : ' no'}">${RES_ICONS[r]} ${v}</span>`; });
  return h;
};

function updateTop(kinds: number[]) {
  const me = S.players[ME], tb = TECH_TABLE[me.techLevel];
  let h = `<div class="res gold" title="Or"><span class="ico">🪙</span><b>${fmt(me.gold)}</b><small>+${me.goldRate.toFixed(1)}/s</small></div>`;
  for (let r = 0; r < NRES; r++) {
    const rate = B.RES_OUT * kinds[r] * (1 + tb.prod);
    h += `<div class="res" title="${RES_NAMES[r]}"><span class="ico">${RES_ICONS[r]}</span><b>${fmt(me.res[r])}</b><small>${rate > 0 ? '+' + rate.toFixed(1) : '·'}</small></div>`;
  }
  const next = TECH_LEVELS[me.techLevel], prev = me.techLevel ? TECH_LEVELS[me.techLevel - 1].at : 0;
  const frac = next ? Math.min(100, 100 * (me.techGauge - prev) / (next.at - prev)) : 100;
  h += `<div class="res gauge" title="Jauge de technologie"><i style="width:${frac}%"></i><span>🎓 niv. ${me.techLevel}${next ? ` · ${fmt(me.techGauge)}/${next.at}` : ' · max'}</span></div>`;
  h += `<div class="res" title="Soldats / maximum"><span class="ico">🪖</span><b>${fmt(me.troops)}</b><small>/ ${fmt(G.maxTroops(S, ME, kinds))}</small></div>`;
  const v = G.vp(S, ME);
  h += `<div class="res pv" title="Points de victoire"><span class="ico">🏆</span><b>${v.total}</b><small>/ ${B.VP_TARGET}</small></div>`;
  h += `<div class="res"><span class="ico">⏱</span><b>${mmss(S.tick / TPS)}</b></div>`;
  $('stats').innerHTML = h;
  document.querySelectorAll<HTMLElement>('#speeds button').forEach(b => b.classList.toggle('on', +b.dataset.s! === speed));
}

function updateScore() {
  const rows = S.players.map(p => ({ p, v: G.vp(S, p.id) })).sort((a, b) => b.v.total - a.v.total || b.p.cells - a.p.cells);
  let h = `<h4>Points de victoire <small>région·tech·ressources·titres</small></h4>`;
  for (const { p, v } of rows) {
    const w = Math.min(100, 100 * v.total / B.VP_TARGET);
    h += `<div class="prow${p.id === ME ? ' me' : ''}${p.alive ? '' : ' dead'}" data-center="${p.id}" title="${v.region}·${v.tech}·${v.res}·${v.title}">` +
      `<span class="dot" style="background:${p.color}"></span><span class="pname">${esc(p.name)}${G.allied(S, ME, p.id) ? ' 🤝' : ''}</span>` +
      `<span class="bar"><i style="width:${w}%;background:${p.color}"></i></span><b>${v.total}</b><small>${(100 * p.cells / LAND_COUNT).toFixed(0)} %</small><small>🪖${fmt(p.troops)}</small></div>`;
  }
  h += `<div class="heads"><small class="muted">Ressources :</small>`;
  for (let r = 0; r < NRES; r++) { const hd = S.resHolder[r]; h += `<span class="lead" title="${RES_NAMES[r]} : ${hd >= 0 ? S.players[hd].name : 'personne (2 bâtiments minimum)'}" style="border-color:${hd >= 0 ? S.players[hd].color : '#2c3a4b'}">${RES_ICONS[r]}</span>`; }
  h += `</div><div class="heads"><small class="muted">Titres :</small>`;
  ['🗺', '🪖', '🪙'].forEach((ic, i) => { const hd = S.titles[i]; h += `<span class="lead" title="${TITLE_NAMES[i]} : ${hd >= 0 ? S.players[hd].name : 'personne'}" style="border-color:${hd >= 0 ? S.players[hd].color : '#2c3a4b'}">${ic}</span>`; });
  h += '</div>';
  return h;
}

function renderBuild(kinds: number[]) {
  const me = S.players[ME];
  let sig = `${buildKind}|${kinds.join()}|`;
  const costs = BUILDINGS.map(b => G.buildCost(S, ME, b.id, kinds));
  costs.forEach(c => { sig += G.canAfford(S, ME, c) ? 1 : 0; for (let r = 0; r < NRES; r++) sig += me.res[r] >= c.res[r] ? 1 : 0; sig += me.gold >= c.gold ? 1 : 0; });
  setHTML('tabbuild', sig, () => {
    let h = `<div class="muted small" style="margin-bottom:5px">Choisissez un bâtiment, puis cliquez sur votre territoire (au moins ${B.MIN_BUILD_DIST} cases entre deux bâtiments). Chaque exemplaire supplémentaire coûte plus cher.</div>`;
    for (const b of BUILDINGS) {
      h += `<div class="brow${buildKind === b.id ? ' sel' : ''}" data-build="${b.id}"><canvas width="32" height="32" data-glyph="${b.id}"></canvas><div><b>${b.name}</b> <span class="muted">×${kinds[b.id]}</span><div class="muted small">${b.desc}</div><div class="chips">${costChips(costs[b.id])}</div></div></div>`;
    }
    return h;
  });
  document.querySelectorAll<HTMLCanvasElement>('#tabbuild canvas[data-glyph]').forEach(cv => {
    if (cv.dataset.done) return; cv.dataset.done = '1';
    const g = cv.getContext('2d')!; g.imageSmoothingEnabled = false;
    drawBuilding(g, +cv.dataset.glyph!, 2, 2, 3, S.players[ME].color);
  });
}

function renderTech(kinds: number[]) {
  const me = S.players[ME];
  const sig = `${me.techLevel}|${Math.floor(me.techGauge)}|${S.techFirst.join()}|${me.res.map(x => Math.floor(x / 10)).join()}|${Math.floor(me.gold / 30)}|${kinds[K_UNI]}`;
  setHTML('tabtech', sig, () => {
    const rate = B.UNI_OUT * kinds[K_UNI] * (1 + B.ALLY_TECH * me.allies.length);
    let h = `<h4>Technologie <small>${kinds[K_UNI]} université(s) · +${rate.toFixed(1)}/s</small></h4>`;
    TECH_LEVELS.forEach((t, i) => {
      const first = S.techFirst[i];
      const got = me.techLevel > i;
      const f = first >= 0 ? `<small style="color:${S.players[first].color}">1ᵉʳ : ${esc(S.players[first].name)}</small>` : '<small style="color:var(--ac)">🏆 +1 PV au premier</small>';
      h += `<div class="lvl${got ? ' got' : ''}"><div class="th"><b>${got ? '✔ ' : ''}Niv. ${i + 1} · ${t.name}</b>${f}</div><div class="muted small">${t.desc} · ${t.at} pts</div></div>`;
    });
    h += `<h4 style="margin-top:8px">Marché <small>vente ${B.SELL_PRICE.toFixed(0)} or · achat ${B.BUY_PRICE.toFixed(0)} or</small></h4>`;
    for (let r = 0; r < NRES; r++) {
      h += `<div class="mrow"><span>${RES_ICONS[r]} ${RES_NAMES[r]}</span><b>${fmt(me.res[r])}</b><button data-sell="${r}" ${me.res[r] >= 10 ? '' : 'class="dis"'}>Vendre 10</button><button data-buy="${r}" ${me.gold >= 10 * B.BUY_PRICE ? '' : 'class="dis"'}>Acheter 10</button></div>`;
    }
    h += `<h4 style="margin-top:8px">Mobilisation <small>${B.DRAFT_GOLD} or par soldat</small></h4><div class="mrow" style="grid-template-columns:1fr 1fr"><button data-draft="100" ${me.gold >= 100 * B.DRAFT_GOLD ? '' : 'class="dis"'}>+100 soldats</button><button data-draft="500" ${me.gold >= 500 * B.DRAFT_GOLD ? '' : 'class="dis"'}>+500 soldats</button></div>`;
    return h;
  });
}

function renderDip() {
  const me = S.players[ME];
  const sig = `${breakArmed}|` + S.players.map(p => `${p.alive}${p.allies.join('.')}`).join('|') + '|' + S.proposals.map(x => `${x.from}>${x.to}`).join() + '|' + Math.floor(S.tick / TPS);
  setHTML('tabdip', sig, () => {
    let h = `<div class="muted small" style="margin-bottom:5px">Un allié ne peut pas vous attaquer, vous rapporte +${Math.round(B.ALLY_GOLD * 100)} % d’or et +${Math.round(B.ALLY_TECH * 100)} % de recherche, et ${Math.round(B.ALLY_SUPPORT * 100)} % de ses soldats renforcent votre défense. Alliance de ${B.ALLY_TTL / 60} min, renouvelable pendant ses ${B.RENEW_WINDOW} dernières secondes. ${me.allies.length}/${B.MAX_ALLIES} alliés.</div>`;
    for (const p of S.players) {
      if (p.id === ME || !p.alive) continue;
      const al = G.allianceOf(S, ME, p.id);
      const toMe = S.proposals.find(x => x.from === p.id && x.to === ME);
      const fromMe = S.proposals.find(x => x.from === ME && x.to === p.id);
      let st = '', acts = '';
      if (toMe) { st = '<span style="color:var(--ac)">vous propose une alliance</span>'; acts = `<button data-accept="${p.id}">Accepter</button><button data-refuse="${p.id}">Refuser</button>`; }
      else if (al) {
        const left = (al.until - S.tick) / TPS;
        st = `🤝 allié · encore ${mmss(left)}`;
        acts = (left <= B.RENEW_WINDOW && !fromMe ? `<button data-propose="${p.id}">Renouveler</button>` : '') + `<button data-break="${p.id}" style="${breakArmed === p.id ? 'border-color:var(--ko)' : ''}">${breakArmed === p.id ? 'Confirmer la rupture ?' : 'Rompre'}</button>`;
      } else if (fromMe) st = '<span class="muted">demande envoyée…</span>';
      else { st = '<span class="muted">aucune relation</span>'; acts = `<button data-propose="${p.id}" ${me.allies.length >= B.MAX_ALLIES ? 'class="dis"' : ''}>Proposer une alliance</button>`; }
      const v = G.vp(S, p.id);
      h += `<div class="dip"><div class="th"><span><span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b></span><span class="muted small">${v.total} PV · ${(100 * p.cells / LAND_COUNT).toFixed(0)} % · 🪖${fmt(p.troops)}</span></div><div class="small">${st}${p.allies.length ? ` <span class="muted">· alliés : ${p.allies.map(a => esc(S.players[a].name)).join(', ')}</span>` : ''}</div><div class="acts">${acts}</div></div>`;
    }
    return h;
  });
  const n = S.proposals.filter(x => x.to === ME).length;
  document.querySelector<HTMLElement>('#tabs button[data-t="dip"]')!.innerHTML = 'Diplomatie' + (n ? `<span class="badge">${n}</span>` : '');
  if (n > lastProposals) { toast('Une alliance vous est proposée (onglet Diplomatie)'); sfx.proposal(); }
  lastProposals = n;
}

function renderOrders() {
  const mine = S.orders.filter(o => o.p === ME);
  const sig = mine.map(o => `${o.id}:${Math.floor(100 * o.budget / o.initial / 5)}:${o.captured}`).join('|');
  setHTML('orders', sig, () => mine.map(o => `<div class="ord"><span>⚔ ${o.captured} cases</span><span class="bar"><i style="width:${Math.max(0, 100 * o.budget / o.initial)}%;background:#ffd54a"></i></span><button data-recall="${o.id}" title="Rappeler les troupes restantes">↩</button></div>`).join(''));
}

function renderLog() {
  const ev = S.events.slice(-40).reverse();
  setHTML('log', `${S.events.length}|${S.tick >> 5}`, () => ev.map(e => `<div class="ev"><span class="muted">${mmss(e.t / TPS)}</span> <span style="color:${S.players[e.p].color}">●</span> ${esc(e.text)}</div>`).join(''));
}

let lastUI = 0;
function ui(force = false) {
  const now = performance.now();
  if (!force && now - lastUI < 250) return;
  lastUI = now;
  const kinds = G.countKinds(S, ME);
  updateTop(kinds);
  setHTML('score', `${S.players.map(p => `${p.cells}.${Math.floor(p.troops / 5)}.${G.vp(S, p.id).total}.${p.allies.join('')}`).join('|')}${S.resHolder.join()}${S.titles.join()}`, updateScore);
  if (tab === 'build') renderBuild(kinds); else if (tab === 'tech') renderTech(kinds);
  renderDip(); renderOrders(); renderLog();
  const me = S.players[ME], pct = +(($('pct') as HTMLInputElement).value);
  $('atkread').innerHTML = `Engager <b>${pct} %</b> = <b>${fmt(me.troops * pct / 100)}</b> soldats <span class="muted">(réserve ${fmt(me.troops)} / ${fmt(G.maxTroops(S, ME, kinds))})</span>`;
  $('brushv').textContent = String(brush);
  if (S.over) showEnd(); else if (!me.alive) showDead();
}

// ---------------------------------------------------------------- événements du panneau (pointerdown : insensible aux reconstructions du DOM)
document.addEventListener('pointerdown', e => {
  const t = (e.target as HTMLElement);
  const el = t.closest('[data-build],[data-sell],[data-buy],[data-draft],[data-propose],[data-accept],[data-refuse],[data-break],[data-recall],[data-center],[data-t],[data-s],[data-mode],[data-brush]') as HTMLElement | null;
  if (!el) return;
  const d = el.dataset;
  if (el.classList.contains('dis')) { toast('Ressources ou conditions insuffisantes', true); return; }
  if (d.build !== undefined) { const k = +d.build; if (buildKind === k && mode === 'build') setMode('attack'); else { buildKind = k; setMode('build'); } lastSig.tabbuild = ''; ui(true); }
  else if (d.sell !== undefined) cmd({ type: 'trade', p: ME, side: 'sell', res: +d.sell, qty: 10 });
  else if (d.buy !== undefined) cmd({ type: 'trade', p: ME, side: 'buy', res: +d.buy, qty: 10 });
  else if (d.draft !== undefined) cmd({ type: 'draft', p: ME, qty: +d.draft });
  else if (d.propose !== undefined) { if (cmd({ type: 'propose', p: ME, to: +d.propose })) toast('Demande envoyée'); }
  else if (d.accept !== undefined) cmd({ type: 'accept', p: ME, from: +d.accept });
  else if (d.refuse !== undefined) cmd({ type: 'refuse', p: ME, from: +d.refuse });
  else if (d.break !== undefined) {
    const id = +d.break;
    if (breakArmed === id) { breakArmed = -1; cmd({ type: 'break', p: ME, with: id }); }
    else { breakArmed = id; lastSig.tabdip = ''; ui(true); clearTimeout((window as any)._ba); (window as any)._ba = setTimeout(() => { breakArmed = -1; lastSig.tabdip = ''; }, 4000); }
  }
  else if (d.recall !== undefined) cmd({ type: 'recall', p: ME, order: +d.recall });
  else if (d.center !== undefined) centerOnPlayer(+d.center, Math.max(view.k, 5));
  else if (d.t !== undefined) setTab(d.t);
  else if (d.s !== undefined) { if (!multi) { speed = +d.s; if (speed) lastSpeed = speed; ui(true); } }
  else if (d.mode !== undefined) setMode(d.mode as 'attack' | 'pan');
  else if (d.brush !== undefined) { brush = Math.max(1, Math.min(9, brush + +d.brush)); ui(true); }
});

function setMode(m: 'attack' | 'pan' | 'build') {
  mode = m;
  if (m !== 'build') { buildKind = -1; lastSig.tabbuild = ''; }
  document.querySelectorAll<HTMLElement>('#tools button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  canvas.style.cursor = m === 'pan' ? 'grab' : 'crosshair';
  clearPaint(); dirty = true;
}
function setTab(t: string) {
  tab = t;
  for (const id of ['build', 'dip', 'tech']) $('tab' + id).style.display = id === t ? 'block' : 'none';
  document.querySelectorAll<HTMLElement>('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  for (const k of ['tabbuild', 'tabtech', 'tabdip']) lastSig[k] = '';
  ui(true);
}

// ---------------------------------------------------------------- clavier
const keys = new Set<string>();
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (menu.isOpen()) { if (k === 'escape') menu.escape(); return; }
  if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return;
  if (!started) return;
  if (k === ' ') { e.preventDefault(); if (!multi) { speed = speed === 0 ? lastSpeed : 0; if (speed) lastSpeed = speed; ui(true); } }
  else if (k === 'escape') { if (drag?.kind === 'paint') { clearPaint(); drag = null; } else if (mode !== 'attack') setMode('attack'); else openPause(); }
  else if (k === 'a') setMode('attack');
  else if (k === 'h') setMode('pan');
  else if (k === '[') { brush = Math.max(1, brush - 1); ui(true); }
  else if (k === ']') { brush = Math.min(9, brush + 1); ui(true); }
  else if (k >= '0' && k <= '9' && k.length === 1) { ($('pct') as HTMLInputElement).value = String(k === '0' ? 100 : +k * 10); ui(true); }
  else if (k === ',' && !multi) { speed = Math.max(1, (speed === 8 ? 4 : speed === 4 ? 2 : 1)); lastSpeed = speed; ui(true); }
  else if (k === '.' && !multi) { speed = speed === 0 ? 1 : Math.min(8, speed * 2); lastSpeed = speed; ui(true); }
  else keys.add(k);
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
$('pct').addEventListener('input', () => ui(true));
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- écrans de fin
function endButtons(dead: boolean) {
  return `<div style="display:flex;gap:8px;flex-wrap:wrap">${multi ? '' : '<button id="again" class="go" style="flex:1">Rejouer</button>'}<button id="watch" style="flex:1">${dead ? 'Observer' : 'Continuer à observer'}</button><button id="tomenu" style="flex:1">${multi ? 'Retour au salon' : 'Menu principal'}</button></div>`;
}
function bindEnd() {
  const end = $('end');
  const again = document.getElementById('again'); if (again) again.onclick = () => { if (lastSolo) startSolo({ ...lastSolo, seed: Math.floor(Math.random() * 1e6) }); };
  $('watch').onclick = () => { end.style.display = 'none'; };
  $('tomenu').onclick = () => { end.style.display = 'none'; leaveGame(); };
  end.style.display = 'flex';
}
function showEnd() {
  const end = $('end');
  if (multi && !overSent) { overSent = true; net?.send({ t: 'over' }); }
  if (end.dataset.seen === String(gameId)) return;
  end.dataset.seen = String(gameId);
  const w = S.players[S.winner], v = G.vp(S, w.id), me = G.vp(S, ME);
  const win = S.winner === ME;
  if (win) sfx.win(); else sfx.lose();
  $('endbox').innerHTML = `<h2>${win ? '🏆 Victoire !' : 'Partie terminée'}</h2>` +
    `<p><b style="color:${w.color}">${esc(w.name)}</b> l’emporte avec <b>${v.total} PV</b> (régions ${v.region} · technologie ${v.tech} · ressources ${v.res} · titres ${v.title}) après ${mmss(S.tick / TPS)}.</p>` +
    `<p class="muted">Vous : ${me.total} PV (régions ${me.region} · technologie ${me.tech} · ressources ${me.res} · titres ${me.title}).${multi ? '' : ` Graine ${seed}.`}</p>` + endButtons(false);
  bindEnd();
}
function showDead() {
  const end = $('end');
  if (end.dataset.dead === String(gameId)) return;
  end.dataset.dead = String(gameId);
  sfx.lose();
  $('endbox').innerHTML = `<h2>Vous avez été éliminé</h2><p class="muted">Plus aucune case ne vous appartient. Vous pouvez observer la fin de la partie ou ${multi ? 'revenir au salon' : 'recommencer'}.</p>` + endButtons(true);
  bindEnd();
}

// ---------------------------------------------------------------- démarrage / sortie de partie
function begin(st: State, me: number, isMulti: boolean) {
  S = st; ME = me; multi = isMulti; gameId++; overSent = false;
  pcol = S.players.map(p => hex(p.color));
  for (const k of Object.keys(lastSig)) lastSig[k] = '';
  clearPaint(); setMode('attack'); lastProposals = 0; labelTick = -1; lastVersion = -1; acc = 0;
  watchInit();
  $('end').style.display = 'none';
  $('speeds').style.display = isMulti ? 'none' : '';
  const nb = $('netbar'); nb.style.display = isMulti ? 'block' : 'none';
  speed = 1; lastSpeed = 1; started = true;
  menu.setInGame(true); menu.hide();
  resize(); centerOnPlayer(ME, 7); dirty = true; overlayDirty = true; ui(true);
}
function startSolo(o: SoloOpts) {
  lastSolo = o;
  seed = o.seed ?? Math.floor(Math.random() * 1e6);
  net = null;
  begin(G.newGame(seed, { humanName: o.name, bots: o.bots, timeLimitMin: o.timeLimitMin }), 0, false);
}
function startMulti(n: Net, m: StartMsg) {
  net = n; seed = m.seed;
  begin(G.newGame(m.seed, { humans: m.humans, bots: m.bots, timeLimitMin: m.timeLimitMin }), m.you, true);
}
function leaveGame() {
  const wasMulti = multi;
  started = false; speed = 0; multi = false;
  $('speeds').style.display = ''; $('netbar').style.display = 'none';
  if (wasMulti) menu.backToLobby(); else { net = null; menu.show('main'); }
}
function openPause() {
  if (!started) return;
  if (!multi && speed > 0) lastSpeed = speed;
  if (!multi) speed = 0;
  menu.pause();
}
function resumeGame() { if (!multi) speed = lastSpeed || 1; ui(true); }
const menu = initMenu({
  onSolo: startSolo, onMultiStart: startMulti, onResume: resumeGame,
  onQuit: () => { started = false; multi = false; net = null; $('speeds').style.display = ''; $('netbar').style.display = 'none'; },
});
menu.onSettings(() => { resize(); overlayDirty = true; dirty = true; });
$('menubtn').addEventListener('click', openPause);
$('layers').innerHTML = '<button data-center="0" title="Centrer sur mon territoire">🎯 Mon territoire</button>';

// ---------------------------------------------------------------- sons d'événements
let wTech = 0, wAllies = 0, wCells = 0, wAlarmAt = -1e9, wTick = 0;
function watchInit() { const me = S.players[ME]; wTech = me.techLevel; wAllies = me.allies.length; wCells = me.cells; wAlarmAt = -1e9; wTick = S.tick; }
function watch() {
  if (!started || S.tick - wTick < 10) return;
  wTick = S.tick;
  const me = S.players[ME];
  if (me.techLevel > wTech) sfx.tech();
  if (me.allies.length > wAllies) sfx.ally();
  if (wCells - me.cells >= 4 && S.tick - wAlarmAt > 80) { sfx.alarm(); wAlarmAt = S.tick; }
  wTech = me.techLevel; wAllies = me.allies.length; wCells = me.cells;
}

// ---------------------------------------------------------------- boucle
let last = performance.now(), acc = 0, lastDraw = 0, lastTurnAt = 0;
function runTurn(cmds: Command[]) {
  for (let i = 0; i < TURN_TICKS; i++) G.tick(S, i === 0 ? cmds : [], (c, e) => { if (c.p === ME) { toast(e, true); sfx.error(); } });
  if (S.tick % 100 === 0) net?.send({ t: 'hash', tick: S.tick, h: G.stateHash(S) });
  overlayDirty = true;
}
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (started && multi && net) {
    const q = net.turns;
    if (!S.over) {
      acc += dt * TPS * (q.length > 8 ? 4 : q.length > 3 ? 2 : 1);
      let g = 0;
      while (acc >= TURN_TICKS && q.length && g++ < 60) { runTurn(q.shift()!.cmds); acc -= TURN_TICKS; lastTurnAt = now; }
      if (!q.length && acc > TURN_TICKS) acc = TURN_TICKS;
      const wait = now - lastTurnAt > 1500;
      const nb = $('netbar'); const txt = `🌐 ${S.players.filter(p => !p.isBot).length} humain(s)${wait ? ' · ⏳ en attente du serveur…' : ''}`;
      if (nb.textContent !== txt) nb.textContent = txt;
    }
  } else if (started && speed > 0 && !S.over) {
    acc += dt * speed * TPS;
    let n = 0;
    while (acc >= 1 && n < 400) { G.tick(S); acc -= 1; n++; }
    if (acc > 400) acc = 0;
  }
  if (started) watch();
  if (keys.size) {
    const v = 600 * dt;
    if (keys.has('w') || keys.has('arrowup')) view.ty += v;
    if (keys.has('s') || keys.has('arrowdown')) view.ty -= v;
    if (keys.has('a') && false) view.tx += v;
    if (keys.has('arrowleft')) view.tx += v;
    if (keys.has('d') || keys.has('arrowright')) view.tx -= v;
    dirty = true;
  }
  if (S.version !== lastVersion || overlayDirty) { compose(); dirty = true; }
  if (started && !S.over) dirty = true;      // étiquettes et jauges vivantes
  if (dirty && now - lastDraw >= 1000 / settings.fps - 3) { draw(); lastDraw = now; }
  ui();
  requestAnimationFrame(frame);
}
resize(); setTab('build'); setMode('attack');
centerOn(W / 2, H / 2, view.fit);
ui(true);
requestAnimationFrame(frame);

(window as any).__rts = {
  get S() { return S; }, G, view, cmd, netUrl: (t: string) => Net.url(t), centerOn, centerOnPlayer, toCell, menu, get net() { return net; }, get multi() { return multi; }, get ME() { return ME; },
  tick: (n = 1) => { for (let i = 0; i < n; i++) G.tick(S); dirty = true; ui(true); },
  solo: (o: Partial<SoloOpts> = {}) => startSolo({ name: 'Vous', bots: Array.from({ length: 9 }, () => ({ name: '', diff: 1 })), timeLimitMin: 45, seed: 7, ...o }),
  setSpeed: (v: number) => { speed = v; }, setMode, setTab, get mode() { return mode; },
  setBuild: (k: number) => { buildKind = k; setMode('build'); },
  hover: (c: number) => { hover = c; dirty = true; },
};
void NKIND; void K_BARRACKS; void K_PORT; void K_MARKET; void LAND;
