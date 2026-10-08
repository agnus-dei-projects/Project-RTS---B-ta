import { BALANCE as B, NKIND, NRES, K_UNI, K_BARRACKS, K_PORT, K_FORT, K_MARKET, TPS } from './config';
import { W, TERRAIN, LAND, COASTAL } from './world';
import * as S from './sim';
import type { State, Command } from './types';

interface Per { maxOrders: number; maxPct: number; aggr: number; expand: number; reserve: number; margin: number; ally: number; radius: number; w: number[]; }
const PERSONAS: Record<string, Per> = {
  equilibre: { maxOrders: 3, maxPct: 55, aggr: 1.0, expand: 1.0, reserve: 0.30, margin: 1.30, ally: 0.5, radius: 5, w: [1, 1, 1, 1, 1, 1, 1.2, 0.8, 0.5, 0.5, 1.0] },
  guerrier: { maxOrders: 4, maxPct: 65, aggr: 1.7, expand: 1.0, reserve: 0.30, margin: 1.22, ally: 0.2, radius: 5, w: [1, 1.5, 1, 1, 1, 1, 0.5, 2.0, 0.5, 1.2, 0.6] },
  marchand: { maxOrders: 2, maxPct: 40, aggr: 0.5, expand: 1.0, reserve: 0.40, margin: 1.50, ally: 0.9, radius: 5, w: [1, 1, 1, 1, 1, 1, 0.9, 0.6, 1.5, 0.7, 2.2] },
  techno: { maxOrders: 2, maxPct: 45, aggr: 0.6, expand: 1.0, reserve: 0.35, margin: 1.45, ally: 0.8, radius: 5, w: [1, 1, 1, 1, 1, 1, 2.5, 0.7, 0.6, 0.6, 0.9] },
};

/** réglage de difficulté : 0 facile (hésitant, peu d'offensives), 1 normal (inchangé), 2 difficile (agressif, marges serrées) */
const scaledCache = new Map<string, Per>();
function scaled(per: Per, diff: number): Per {
  if (diff === 1) return per;
  const key = `${diff}:${per.aggr}:${per.maxPct}`;
  let r = scaledCache.get(key);
  if (!r) {
    r = diff === 0
      ? { ...per, maxOrders: Math.max(1, per.maxOrders - 1), maxPct: Math.round(per.maxPct * 0.7), aggr: per.aggr * 0.65, reserve: Math.min(0.6, per.reserve * 1.3), margin: per.margin * 1.2 }
      : { ...per, maxOrders: per.maxOrders + 1, maxPct: Math.min(85, Math.round(per.maxPct * 1.2)), aggr: per.aggr * 1.15, reserve: per.reserve * 0.85, margin: Math.max(1.08, per.margin * 0.92) };
    scaledCache.set(key, r);
  }
  return r;
}

interface Scan { own: number[]; border: Map<number, number[]>; }
function scan(s: State, p: number): Scan {
  const own: number[] = [], border = new Map<number, number[]>();
  const al = s.players[p].allies;
  for (let i = 0; i < LAND.length; i++) {
    const c = LAND[i];
    if (s.owner[c] !== p) continue;
    own.push(c);
    const n4 = [c - 1, c + 1, c - W, c + W];
    for (const n of n4) {
      if (TERRAIN[n] !== 1) continue;
      const o = s.owner[n];
      if (o === p || (o >= 0 && al.includes(o))) continue;
      let l = border.get(o); if (!l) { l = []; border.set(o, l); }
      l.push(n);
    }
  }
  return { own, border };
}

export function botAct(s: State, p: number): void {
  const me = s.players[p];
  if (!me.alive) return;
  const per = scaled(PERSONAS[me.persona] ?? PERSONAS.equilibre, me.diff);
  const run = (c: Command) => S.applyCommand(s, c) === null;
  const sc = scan(s, p);
  const kinds = S.countKinds(s, p);
  diplomacy(s, p, per, sc, run);
  build(s, p, per, sc, kinds, run);
  attack(s, p, per, sc, kinds, run);
  // mobilisation : l'or inutilisé devient des soldats
  const keepGold = 350 + 12 * Math.sqrt(me.cells) * 4;
  if (me.gold > keepGold) {
    const room = Math.floor(S.maxTroops(s, p, kinds) - me.troops);
    const q = Math.min(room, Math.floor((me.gold - keepGold) / B.DRAFT_GOLD));
    if (q >= 20) run({ type: 'draft', p, qty: q });
  }
  // marché : on vend le surplus
  for (let r = 0; r < NRES; r++) if (me.res[r] > 160) run({ type: 'trade', p, side: 'sell', res: r, qty: Math.floor(me.res[r] - 90) });
}

// ---------------------------------------------------------------- diplomatie
function diplomacy(s: State, p: number, per: Per, sc: Scan, run: (c: Command) => boolean) {
  const me = s.players[p];
  const myT = Math.max(1, me.troops);
  // 1. répondre aux demandes
  for (const prop of s.proposals.filter(x => x.to === p)) {
    const from = s.players[prop.from];
    let threat = 0;
    for (const [o] of sc.border) if (o >= 0 && o !== prop.from) threat = Math.max(threat, s.players[o].troops / myT);
    let score = per.ally + (threat > 0.8 ? 0.35 : 0) - (from.cells > me.cells * 1.6 ? 0.25 : 0)
      - (from.betrayedUntil > s.tick ? 1 : 0) - (S.vp(s, from.id).total >= B.VP_TARGET - 4 ? 0.5 : 0) + (S.rand(s) - 0.5) * 0.4;
    if (S.allianceOf(s, p, prop.from)) score += 0.25;
    else if (me.allies.length >= B.MAX_ALLIES) score = -1;
    run({ type: score > 0.5 ? 'accept' : 'refuse', p, from: prop.from } as Command);
  }
  // 2a. renouveler les alliances qui arrivent à échéance (si on les apprécie encore)
  for (const al of s.alliances) {
    if (al.a !== p && al.b !== p) continue;
    const other = al.a === p ? al.b : al.a;
    if (al.until - s.tick > B.RENEW_WINDOW * TPS || s.proposals.some(x => x.from === p && x.to === other)) continue;
    const q = s.players[other];
    if (S.vp(s, other).total >= B.VP_TARGET - 4 || q.cells > me.cells * 1.8) continue;
    if (S.rand(s) < per.ally * 0.5) run({ type: 'propose', p, to: other });
  }
  // 2b. proposer parfois une alliance au voisin le plus fort
  if (me.allies.length < 2 && S.rand(s) < 0.03 * per.ally) {
    let best = -1, bt = -1;
    for (const [o] of sc.border) {
      if (o < 0) continue;
      const q = s.players[o];
      if (!q.alive || q.cells < me.cells * 0.4 || S.allied(s, p, o) || q.allies.length >= B.MAX_ALLIES) continue;
      if (s.proposals.some(x => x.from === p && x.to === o)) continue;
      if (q.troops > bt) { bt = q.troops; best = o; }
    }
    if (best >= 0) run({ type: 'propose', p, to: best });
  }
  // 3. rompre avec un allié sur le point de gagner (si on n'est pas soi-même en tête)
  if (me.allies.length && s.tick - me.lastBreak > 300 * TPS && per.aggr >= 1 && S.rand(s) < 0.2) {
    const mine = S.vp(s, p).total;
    for (const a of me.allies) {
      const v = S.vp(s, a).total;
      if (v >= B.VP_TARGET - 3 && v > mine + 2) { run({ type: 'break', p, with: a }); break; }
    }
  }
}

// ---------------------------------------------------------------- construction
function exposure(s: State, c: number, p: number, rad: number): number {
  let e = 0;
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    const n = c + dy * W + dx;
    if (TERRAIN[n] === 1 && s.owner[n] !== p) e++;
  }
  return e;
}

function build(s: State, p: number, per: Per, sc: Scan, kinds: number[], run: (c: Command) => boolean) {
  const me = s.players[p];
  if (!sc.own.length) return;
  // quantités de bâtiments des autres (pour viser les PV de ressources)
  const others = new Array(NKIND).fill(0);
  for (const b of s.buildings) if (b.owner !== p && s.players[b.owner].alive) others[b.kind] = Math.max(others[b.kind], 0);
  const cnt: number[][] = s.players.map(() => new Array(NKIND).fill(0));
  for (const b of s.buildings) cnt[b.owner][b.kind]++;
  for (const q of s.players) if (q.id !== p && q.alive) for (let k = 0; k < NKIND; k++) others[k] = Math.max(others[k], cnt[q.id][k]);
  let enemyBorder = 0, totalBorder = 0;
  for (const [o, l] of sc.border) { totalBorder += l.length; if (o >= 0) enemyBorder += l.length; }
  const maxT = S.maxTroops(s, p, kinds);
  let coastal = false;
  for (let i = 0; i < sc.own.length && !coastal; i += 3) if (COASTAL[sc.own[i]]) coastal = true;
  const reserveGold = 40;

  let bestK = -1, bestScore = 0;
  for (let k = 0; k < NKIND; k++) {
    const cost = S.buildCost(s, p, k, kinds);
    let totalGold = cost.gold;
    for (let r = 0; r < NRES; r++) totalGold += Math.max(0, cost.res[r] - me.res[r]) * B.BUY_PRICE;
    if (me.gold < totalGold + reserveGold) continue;
    let w = per.w[k];
    const mine = kinds[k];
    if (k < NRES) {
      if (mine === 0) w *= 2.5;
      if (mine + 1 > others[k] && mine + 1 >= B.RES_LEAD_MIN) w *= 1.8;
      if (me.res[k] < 25) w *= 1.4;
      w /= 1 + 0.25 * mine;
      if (k === 5 && per.w[K_UNI] >= 2) w *= 1.6;          // le profil « techno » veut des terres rares pour ses universités
    } else if (k === K_UNI) { w /= 1 + 0.3 * mine; }
    else if (k === K_BARRACKS) { w *= me.troops > 0.8 * maxT ? 1.6 : 0.7; w /= 1 + 0.25 * mine; }
    else if (k === K_FORT) { w *= 0.4 + Math.min(2.5, (totalBorder ? enemyBorder / totalBorder : 0) * 4); w /= 1 + 0.4 * mine; }
    else if (k === K_PORT) { if (!coastal || mine >= 2) continue; w /= 1 + 0.5 * mine; }
    else if (k === K_MARKET) { w /= 1 + 0.3 * mine; }
    w *= 0.85 + 0.3 * S.rand(s);
    if (w > bestScore) { bestScore = w; bestK = k; }
  }
  if (bestK < 0) return;
  // emplacement : fortifications à la frontière, le reste à l'abri
  let bestC = -1, bestE = bestK === K_FORT ? -1 : 1e9, found = 0;
  for (let tries = 0; tries < 80 && found < 14; tries++) {
    const c = sc.own[Math.floor(S.rand(s) * sc.own.length)];
    if (S.placementError(s, c, p, bestK)) continue;
    found++;
    const e = exposure(s, c, p, 3);
    if (bestK === K_FORT ? e > bestE : e < bestE) { bestE = e; bestC = c; }
  }
  if (bestC < 0) return;
  const cost = S.buildCost(s, p, bestK, kinds);
  for (let r = 0; r < NRES; r++) {
    const lack = Math.ceil(cost.res[r] - me.res[r]);
    if (lack > 0) run({ type: 'trade', p, side: 'buy', res: r, qty: lack });
  }
  run({ type: 'build', p, kind: bestK, cell: bestC });
}

// ---------------------------------------------------------------- attaque
function attack(s: State, p: number, per: Per, sc: Scan, kinds: number[], run: (c: Command) => boolean) {
  const me = s.players[p];
  if (s.orders.filter(o => o.p === p).length >= per.maxOrders) return;
  const maxT = S.maxTroops(s, p, kinds);
  if (me.troops < Math.max(B.MIN_BUDGET * 3, 0.15 * maxT)) return;
  if (!sc.border.size) return;
  // choix de la cible : le voisin (ou le neutre) le plus intéressant
  const ranked: { o: number; score: number }[] = [];
  const topVp = Math.max(...s.players.map(q => S.vp(s, q.id).total));
  for (const [o, list] of sc.border) {
    if (!list.length) continue;
    let score: number;
    if (o < 0) score = per.expand * 3.2 / (1 + 0.0009 * me.cells);
    else {
      const d = s.players[o];
      if (!d.alive) continue;
      const dens = S.density(s, o, true);
      score = per.aggr * 1.6 / (0.6 + dens * 0.18) * (1 + (S.vp(s, o).total >= topVp ? 0.4 : 0));
      if (me.cells < 60) score *= 0.3;
    }
    ranked.push({ o, score: score * (0.8 + 0.4 * S.rand(s)) });
  }
  ranked.sort((a, b) => b.score - a.score || a.o - b.o);
  const reserveT = per.reserve * maxT;
  // débarquement : si on a un port, on vise de temps en temps une côte neutre à portée (Corse, îles)
  if (kinds[K_PORT] > 0 && S.rand(s) < 0.25) {
    const ports = s.buildings.filter(b => b.kind === K_PORT && b.owner === p);
    const R2 = B.PORT_RANGE * B.PORT_RANGE;
    const cand: number[] = [];
    for (let i = 0; i < LAND.length; i += 2) {
      const c = LAND[i];
      if (s.owner[c] >= 0 || !COASTAL[c]) continue;
      if (ports.some(pt => ((pt.cell % W) - (c % W)) ** 2 + (((pt.cell / W) | 0) - ((c / W) | 0)) ** 2 <= R2)) cand.push(c);
    }
    if (cand.length) {
      const target = cand[Math.floor(S.rand(s) * cand.length)];
      const tx = target % W, ty = (target / W) | 0;
      const cells: number[] = [];
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        if (dx * dx + dy * dy > 36) continue;
        const c = (ty + dy) * W + tx + dx;
        if (TERRAIN[c] === 1 && s.owner[c] < 0) cells.push(c);
      }
      const room = Math.min(me.troops * per.maxPct / 100, me.troops - reserveT);
      if (cells.length && room >= 120) {
        const pct = Math.max(1, Math.ceil(100 * Math.min(room, 500) / me.troops));
        if (run({ type: 'attack', p, cells, pct })) return;
      }
    }
  }
  for (const { o } of ranked.slice(0, 2)) {
    const list = sc.border.get(o)!;
    const target = list[Math.floor(S.rand(s) * list.length)];
    const tx = target % W, ty = (target / W) | 0;
    for (let R = per.radius + (o < 0 ? 2 : 0); R >= 2; R--) {
      const cells: number[] = [];
      let est = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const c = (ty + dy) * W + tx + dx;
        if (TERRAIN[c] !== 1) continue;
        const ow = s.owner[c];
        if (ow === p || (ow >= 0 && S.allied(s, p, ow))) continue;
        cells.push(c); est += S.cellCost(s, p, c);
      }
      if (!cells.length) break;
      const required = est * (o < 0 ? 1.15 : per.margin);
      const room = Math.min(me.troops * per.maxPct / 100, me.troops - reserveT);
      if (required <= room || (o < 0 && R === 2 && room >= B.MIN_BUDGET)) {
        const budget = Math.min(room, Math.max(required, B.MIN_BUDGET));
        const pct = Math.max(1, Math.ceil(100 * budget / me.troops));
        if (run({ type: 'attack', p, cells, pct })) return;
      }
    }
  }
}
