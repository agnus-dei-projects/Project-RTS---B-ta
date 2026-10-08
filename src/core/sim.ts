import {
  BALANCE as B, BUILDINGS, NKIND, NRES, TPS, TECH_LEVELS, TECH_TABLE, TITLE_NAMES, RES_NAMES,
  K_UNI, K_BARRACKS, K_PORT, K_FORT, K_MARKET, BOT_NAMES, BOT_PERSONAS, PLAYER_COLORS,
} from './config';
import { W, NCELL, TERRAIN, REGION, REGION_SIZE, REGION_NAMES, NR, LAND, MAINLAND, COASTAL, cx, cy, dist2, DEPT, DEPT_NAMES } from './world';
import { nextRand } from './rng';
import type { State, Player, Command, Order, GameEvent } from './types';

export const rand = (s: State) => nextRand(s);

// ================================================================ création
export interface BotSpec { name?: string; diff?: number; }
export interface NewGameOpts {
  nBots?: number; humanBot?: boolean; humanName?: string;
  humans?: string[];            // pseudos des joueurs humains (multijoueur) ; prioritaire sur humanName
  bots?: BotSpec[];             // pseudo + difficulté de chaque bot ; prioritaire sur nBots
  timeLimitMin?: number;        // 0 = pas de limite ; défaut : BALANCE.TIME_LIMIT
}

export function newGame(seed: number, opts: NewGameOpts = {}): State {
  const humans = opts.humans && opts.humans.length ? opts.humans : [opts.humanName ?? 'Vous'];
  const specs: BotSpec[] = opts.bots ?? Array.from({ length: opts.nBots ?? 9 }, () => ({}));
  const mk = (id: number, name: string, isBot: boolean, persona: Player['persona'], diff = 1): Player => ({
    id, name, color: PLAYER_COLORS[id], isBot, persona, alive: true, diff,
    gold: B.START_GOLD, res: [...B.START_RES], troops: B.START_TROOPS, cells: 0,
    techGauge: 0, techLevel: 0, allies: [], regionClaimed: new Array(NR).fill(false),
    vpRegion: 0, vpTech: 0, goldRate: 0, betrayedUntil: 0, lastBreak: -1e9,
  });
  const players: Player[] = humans.map((n, i) => mk(i, n, !!opts.humanBot, opts.humanBot ? 'equilibre' : 'humain'));
  specs.forEach((b, i) => {
    if (players.length >= PLAYER_COLORS.length) return;
    players.push(mk(players.length, b.name || BOT_NAMES[i % BOT_NAMES.length], true, BOT_PERSONAS[i % BOT_PERSONAS.length], b.diff ?? 1));
  });
  const s: State = {
    tick: 0, seed, rng: seed | 0, players,
    owner: new Int8Array(NCELL).fill(-1), bld: new Int16Array(NCELL).fill(-1), buildings: [],
    orders: [], nextOrder: 1, regCount: new Int32Array(players.length * NR),
    resHolder: new Array(NRES).fill(-1), titles: [-1, -1, -1], techFirst: new Array(TECH_LEVELS.length).fill(-1),
    alliances: [], proposals: [], events: [], timeLimit: Math.round((opts.timeLimitMin ?? B.TIME_LIMIT / 60) * 60 * TPS), winner: -1, over: false, version: 0,
  };

  // départs : échantillonnage du point le plus éloigné, hors Corse, hors îles, avec de la terre autour
  const R = Math.ceil(B.START_RADIUS);
  const okStart = (c: number) => {
    if (!MAINLAND[c]) return false;
    let land = 0, tot = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > B.START_RADIUS * B.START_RADIUS) continue;
      tot++; if (TERRAIN[c + dy * W + dx] === 1) land++;
    }
    return land >= tot * 0.9;
  };
  const cand = LAND.filter(c => (c % 3 === 0) && okStart(c));
  const starts: number[] = [cand[Math.floor(rand(s) * cand.length)]];
  while (starts.length < players.length) {
    const scored = cand.map(c => ({ c, d: Math.min(...starts.map(x => dist2(x, c))) })).sort((a, b) => b.d - a.d || a.c - b.c);
    const top = scored.slice(0, Math.max(3, Math.floor(scored.length * 0.02)));
    starts.push(top[Math.floor(rand(s) * top.length)].c);
  }
  for (let i = starts.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [starts[i], starts[j]] = [starts[j], starts[i]]; }
  players.forEach((p, i) => {
    const c0 = starts[i];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > B.START_RADIUS * B.START_RADIUS) continue;
      const c = c0 + dy * W + dx;
      if (TERRAIN[c] === 1 && s.owner[c] < 0) setOwner(s, c, p.id, true);
    }
  });
  // les régions de départ ne rapportent pas de PV
  for (const p of players) for (let r = 0; r < NR; r++) p.regionClaimed[r] = s.regCount[p.id * NR + r] > REGION_SIZE[r] * B.REGION_MAJORITY ? true : p.regionClaimed[r];
  return s;
}

// ================================================================ utilitaires
export function log(s: State, p: number, text: string) {
  const e: GameEvent = { t: s.tick, text, p };
  s.events.push(e);
  if (s.events.length > 300) s.events.splice(0, s.events.length - 300);
}
export const allied = (s: State, a: number, b: number) => s.players[a].allies.includes(b);
export const techB = (s: State, p: number) => TECH_TABLE[s.players[p].techLevel];

export function vp(s: State, p: number) {
  const pl = s.players[p];
  let res = 0; for (const h of s.resHolder) if (h === p) res++;
  let title = 0; for (const h of s.titles) if (h === p) title++;
  return { region: pl.vpRegion, tech: pl.vpTech, res, title, total: pl.vpRegion + pl.vpTech + res + title };
}

export function countKinds(s: State, p: number): number[] {
  const n = new Array(NKIND).fill(0);
  for (const b of s.buildings) if (b.owner === p) n[b.kind]++;
  return n;
}
export function maxTroops(s: State, p: number, kinds?: number[]): number {
  const pl = s.players[p];
  const k = kinds ?? countKinds(s, p);
  return (B.MAXT_BASE + B.MAXT_PER_CELL * pl.cells + B.BARRACKS_MAXT * k[K_BARRACKS]) * (1 + TECH_TABLE[pl.techLevel].troops);
}
export function buildCost(s: State, p: number, kind: number, kinds?: number[]) {
  const k = kinds ?? countKinds(s, p);
  const n = k[kind], m = 1 + B.COST_SCALE * n + B.COST_SCALE2 * n * n, d = BUILDINGS[kind];
  return { gold: Math.ceil(d.gold * m), res: d.res.map(v => Math.ceil(v * m)) };
}
export function canAfford(s: State, p: number, cost: { gold: number; res: number[] }): boolean {
  const pl = s.players[p];
  if (pl.gold < cost.gold) return false;
  for (let r = 0; r < NRES; r++) if (pl.res[r] < cost.res[r]) return false;
  return true;
}

// ================================================================ propriétaire d'une case
function setOwner(s: State, c: number, p: number, silent = false) {
  const o = s.owner[c];
  if (o === p) return;
  const reg = REGION[c];
  if (o >= 0) { s.players[o].cells--; s.regCount[o * NR + reg]--; }
  s.owner[c] = p;
  s.version++;
  const b = s.bld[c];
  if (b >= 0) s.buildings[b].owner = p;
  if (p >= 0) {
    const pl = s.players[p];
    pl.cells++;
    const i = p * NR + reg;
    s.regCount[i]++;
    if (!silent && !pl.regionClaimed[reg] && s.regCount[i] > REGION_SIZE[reg] * B.REGION_MAJORITY) {
      pl.regionClaimed[reg] = true; pl.vpRegion++;
      log(s, p, `${pl.name} contrôle ${REGION_NAMES[reg]} (+1 PV)`);
    }
  }
  if (o >= 0 && s.players[o].cells === 0) eliminate(s, o);
}

function eliminate(s: State, p: number) {
  const pl = s.players[p];
  pl.alive = false; pl.troops = 0;
  s.orders = s.orders.filter(o => o.p !== p);
  for (const a of pl.allies) { const al = s.players[a]; al.allies = al.allies.filter(x => x !== p); }
  pl.allies = [];
  s.alliances = s.alliances.filter(x => x.a !== p && x.b !== p);
  s.proposals = s.proposals.filter(x => x.from !== p && x.to !== p);
  log(s, p, `${pl.name} est éliminé`);
}

// ================================================================ combat
function fortFactor(s: State, o: number, c: number): number {
  const R2 = B.FORT_RADIUS * B.FORT_RADIUS;
  for (const b of s.buildings) if (b.kind === K_FORT && b.owner === o && dist2(b.cell, c) <= R2) return B.FORT_MULT;
  return 1;
}
export function density(s: State, o: number, withAllies: boolean): number {
  const d = s.players[o];
  let t = d.troops;
  if (withAllies) for (const a of d.allies) t += B.ALLY_SUPPORT * s.players[a].troops;
  return t / Math.max(B.MIN_CELLS_DENS, d.cells);
}
/** coût (en soldats) pour prendre une case : jamais montré au joueur */
export function cellCost(s: State, p: number, c: number): number {
  const o = s.owner[c], atk = 1 + TECH_TABLE[s.players[p].techLevel].atk;
  const fr = 1 + B.SIZE_FRICTION * s.players[p].cells;          // plus l'empire est grand, plus l'offensive coûte
  if (o < 0) return B.NEUTRAL_COST * fr / (1 + (atk - 1) * 0.5);
  const defB = 1 + TECH_TABLE[s.players[o].techLevel].def;
  return (1 + density(s, o, true) * B.DEF_K * defB * fortFactor(s, o, c)) * fr / atk;
}

function adjacentToMine(s: State, p: number, c: number): boolean {
  return s.owner[c - 1] === p || s.owner[c + 1] === p || s.owner[c - W] === p || s.owner[c + W] === p;
}

/** case de débarquement possible : côtière, dans la zone, à portée d'un port du joueur */
export function findLanding(s: State, p: number, mask: Iterable<number>): number {
  const ports = s.buildings.filter(b => b.kind === K_PORT && b.owner === p);
  if (!ports.length) return -1;
  const R2 = B.PORT_RANGE * B.PORT_RANGE;
  let best = -1, bd = Infinity;
  for (const c of mask) {
    if (!COASTAL[c] || s.owner[c] === p) continue;
    for (const pt of ports) { const d = dist2(pt.cell, c); if (d <= R2 && d < bd) { bd = d; best = c; } }
  }
  return best;
}

function makeOrder(s: State, p: number, cells: number[], pct: number): Order | string {
  const pl = s.players[p];
  const mask = new Set<number>();
  for (const c of cells) {
    if (c < 0 || c >= NCELL || TERRAIN[c] !== 1) continue;
    const o = s.owner[c];
    if (o === p || (o >= 0 && allied(s, p, o))) continue;
    mask.add(c);
    if (mask.size >= B.MAX_MASK) break;
  }
  if (!mask.size) return 'Zone sans cible';
  const budget = pl.troops * Math.min(100, Math.max(1, pct)) / 100;
  if (budget < B.MIN_BUDGET) return 'Pas assez de soldats';
  if (s.orders.filter(o => o.p === p).length >= B.MAX_ORDERS) return 'Trop d’attaques en cours';
  const queue: number[] = [], queued = new Set<number>();
  for (const c of mask) if (adjacentToMine(s, p, c)) { queue.push(c); queued.add(c); }
  let landing = -1;
  if (!queue.length) {
    landing = findLanding(s, p, mask);
    if (landing < 0) return 'Zone hors de portée : il faut une frontière commune ou un port à portée';
    queue.push(landing); queued.add(landing);
  }
  pl.troops -= budget;
  return { id: s.nextOrder++, p, budget, initial: budget, mask, queue, qh: 0, queued, captured: 0, stall: 0, landing, born: s.tick };
}

function finishOrder(s: State, o: Order) {
  const pl = s.players[o.p];
  if (pl.alive) pl.troops += o.budget;
  o.budget = 0;
  if (pl.alive && (!pl.isBot || o.captured >= 40)) {
    if (o.captured > 0 || !pl.isBot) log(s, o.p, `${pl.name} : offensive terminée (${o.captured} cases)`);
  }
}

function processOrder(s: State, o: Order): boolean {
  const p = o.p, pl = s.players[p];
  if (!pl.alive) return true;
  const nb = [0, 0, 0, 0];
  let n = Math.min(B.ORDER_MAX, Math.max(1, Math.ceil((o.queue.length - o.qh) * B.ORDER_FRAC)));
  while (n-- > 0) {
    if (o.qh >= o.queue.length) {
      // file vide : on cherche les cases de la zone qui touchent maintenant notre territoire
      o.queue.length = 0; o.qh = 0; o.queued.clear();
      for (const c of o.mask) if (s.owner[c] !== p && adjacentToMine(s, p, c)) { o.queue.push(c); o.queued.add(c); }
      if (!o.queue.length) return true;
    }
    const c = o.queue[o.qh++];
    const ow = s.owner[c];
    if (ow === p) continue;
    if (ow >= 0 && allied(s, p, ow)) continue;
    const landingStep = c === o.landing && o.captured === 0;
    const cost = cellCost(s, p, c) + (landingStep ? B.LANDING_COST : 0);
    if (o.budget < cost) {
      if (o.budget < 1 || ++o.stall > 60) return true;
      o.queue.push(c);
      continue;
    }
    o.budget -= cost; o.stall = 0;
    if (ow >= 0) {
      const d = s.players[ow];
      d.troops = Math.max(0, d.troops - B.LOSS_K * (d.troops / Math.max(B.MIN_CELLS_DENS, d.cells)));
    }
    setOwner(s, c, p);
    o.captured++;
    nb[0] = c - 1; nb[1] = c + 1; nb[2] = c - W; nb[3] = c + W;
    for (let i = 0; i < 4; i++) {
      const m = nb[i];
      if (o.mask.has(m) && !o.queued.has(m) && s.owner[m] !== p) { o.queued.add(m); o.queue.push(m); }
    }
  }
  if (o.qh > 4096 && o.qh * 2 > o.queue.length) { o.queue.splice(0, o.qh); o.qh = 0; }   // compacte la file
  return false;
}

// ================================================================ alliances
export function allianceOf(s: State, a: number, b: number) {
  return s.alliances.find(x => (x.a === a && x.b === b) || (x.a === b && x.b === a));
}
function makeAlliance(s: State, a: number, b: number) {
  const ex = allianceOf(s, a, b);
  if (ex) { ex.until = s.tick + B.ALLY_TTL * TPS; return; }
  s.alliances.push({ a, b, until: s.tick + B.ALLY_TTL * TPS });
  s.players[a].allies.push(b); s.players[b].allies.push(a);
}
function endAlliance(s: State, a: number, b: number) {
  s.alliances = s.alliances.filter(x => !((x.a === a && x.b === b) || (x.a === b && x.b === a)));
  s.players[a].allies = s.players[a].allies.filter(x => x !== b);
  s.players[b].allies = s.players[b].allies.filter(x => x !== a);
}

// ================================================================ commandes
function placeOk(s: State, c: number, p: number, kind: number): string | null {
  if (c < 0 || c >= NCELL || TERRAIN[c] !== 1) return 'Pas ici';
  if (s.owner[c] !== p) return 'Ce n’est pas votre territoire';
  if (s.bld[c] >= 0) return 'Un bâtiment est déjà là';
  const D = B.MIN_BUILD_DIST - 1;
  for (let dy = -D; dy <= D; dy++) for (let dx = -D; dx <= D; dx++) if (s.bld[c + dy * W + dx] >= 0) return 'Trop près d’un autre bâtiment';
  if (kind === K_PORT && !COASTAL[c]) return 'Un port doit toucher la mer';
  return null;
}
export const placementError = placeOk;

export function applyCommand(s: State, c: Command): string | null {
  if (s.over) return 'La partie est terminée';
  const pl = s.players[c.p];
  if (!pl || !pl.alive) return 'Joueur éliminé';
  switch (c.type) {
    case 'attack': {
      const o = makeOrder(s, c.p, c.cells, c.pct);
      if (typeof o === 'string') return o;
      s.orders.push(o);
      return null;
    }
    case 'recall': {
      const i = s.orders.findIndex(o => o.id === c.order && o.p === c.p);
      if (i < 0) return 'Attaque introuvable';
      finishOrder(s, s.orders[i]); s.orders.splice(i, 1);
      return null;
    }
    case 'build': {
      if (!(c.kind >= 0 && c.kind < NKIND)) return 'Bâtiment inconnu';
      const e = placeOk(s, c.cell, c.p, c.kind);
      if (e) return e;
      const cost = buildCost(s, c.p, c.kind);
      if (pl.gold < cost.gold) return 'Pas assez d’or';
      for (let r = 0; r < NRES; r++) if (pl.res[r] < cost.res[r]) return `Pas assez de ${RES_NAMES[r].toLowerCase()}`;
      pl.gold -= cost.gold; for (let r = 0; r < NRES; r++) pl.res[r] -= cost.res[r];
      const id = s.buildings.length;
      s.buildings.push({ id, kind: c.kind, cell: c.cell, owner: c.p });
      s.bld[c.cell] = id;
      return null;
    }
    case 'trade': {
      const q = Math.floor(c.qty);
      if (!(q >= 1) || !(c.res >= 0 && c.res < NRES)) return 'Quantité invalide';
      if (c.side === 'sell') {
        if (pl.res[c.res] < q) return 'Stock insuffisant';
        pl.res[c.res] -= q; pl.gold += q * B.SELL_PRICE;
      } else {
        const cost = q * B.BUY_PRICE;
        if (pl.gold < cost) return 'Pas assez d’or';
        pl.gold -= cost; pl.res[c.res] += q;
      }
      return null;
    }
    case 'draft': {
      const n = Math.floor(c.qty);
      if (!(n >= 1)) return 'Quantité invalide';
      const room = Math.floor(maxTroops(s, c.p) - pl.troops);
      if (room < 1) return 'Réserve de soldats pleine';
      const q = Math.min(n, room);
      if (pl.gold < q * B.DRAFT_GOLD) return 'Pas assez d’or';
      pl.gold -= q * B.DRAFT_GOLD; pl.troops += q;
      return null;
    }
    case 'propose': {
      const to = s.players[c.to];
      if (!to || !to.alive || c.to === c.p) return 'Joueur invalide';
      const ex = allianceOf(s, c.p, c.to);
      if (ex && ex.until - s.tick > B.RENEW_WINDOW * TPS) return 'Déjà alliés (renouvellement possible dans les dernières 90 s)';
      if (!ex && pl.allies.length >= B.MAX_ALLIES) return `Vous avez déjà ${B.MAX_ALLIES} alliés`;
      if (s.proposals.some(x => x.from === c.p && x.to === c.to)) return 'Demande déjà envoyée';
      if (s.proposals.some(x => x.from === c.to && x.to === c.p)) return applyCommand(s, { type: 'accept', p: c.p, from: c.to });
      s.proposals.push({ from: c.p, to: c.to, t: s.tick });
      return null;
    }
    case 'accept': {
      const i = s.proposals.findIndex(x => x.from === c.from && x.to === c.p);
      if (i < 0) return 'Aucune demande de ce joueur';
      const o = s.players[c.from];
      if (!o.alive) { s.proposals.splice(i, 1); return 'Joueur éliminé'; }
      const renew = !!allianceOf(s, c.p, c.from);
      if (!renew && (pl.allies.length >= B.MAX_ALLIES || o.allies.length >= B.MAX_ALLIES)) { s.proposals.splice(i, 1); return 'Limite d’alliés atteinte'; }
      s.proposals = s.proposals.filter(x => !((x.from === c.p && x.to === c.from) || (x.from === c.from && x.to === c.p)));
      makeAlliance(s, c.p, c.from);
      log(s, c.p, renew ? `${pl.name} et ${o.name} renouvellent leur alliance` : `${pl.name} et ${o.name} s’allient`);
      return null;
    }
    case 'refuse': {
      const i = s.proposals.findIndex(x => x.from === c.from && x.to === c.p);
      if (i < 0) return 'Aucune demande de ce joueur';
      s.proposals.splice(i, 1);
      return null;
    }
    case 'autopilot': {
      if (pl.isBot) return null;
      pl.isBot = true; pl.diff = 1; pl.persona = 'equilibre';
      log(s, c.p, `${pl.name} est déconnecté : une IA reprend ses terres`);
      return null;
    }
    case 'break': {
      if (!allied(s, c.p, c.with)) return 'Vous n’êtes pas alliés';
      const o = s.players[c.with];
      endAlliance(s, c.p, c.with);
      pl.betrayedUntil = s.tick + B.BETRAY_BAN * TPS; pl.lastBreak = s.tick;
      log(s, c.p, `${pl.name} rompt son alliance avec ${o.name}`);
      return null;
    }
  }
}

// ================================================================ économie (1 fois par seconde)
function updateTitle(s: State, key: number, vals: number[], margin: number, min: number) {
  const cur = s.titles[key];
  let best = -1, bv = min - 1e-9;
  for (let i = 0; i < vals.length; i++) if (s.players[i].alive && vals[i] > bv + 1e-9) { best = i; bv = vals[i]; }
  if (best < 0) { if (cur >= 0 && !(s.players[cur].alive && vals[cur] >= min)) s.titles[key] = -1; return; }
  if (cur < 0 || !s.players[cur].alive || vals[cur] < min) {
    s.titles[key] = best; log(s, best, `${s.players[best].name} : ${TITLE_NAMES[key].toLowerCase()} (+1 PV)`); return;
  }
  if (best !== cur && vals[best] > vals[cur] * margin) {
    s.titles[key] = best; log(s, best, `${s.players[best].name} prend : ${TITLE_NAMES[key].toLowerCase()} (+1 PV)`);
  }
}

function econ(s: State) {
  const np = s.players.length;
  const kinds: number[][] = s.players.map(() => new Array(NKIND).fill(0));
  for (const b of s.buildings) kinds[b.owner][b.kind]++;
  const income: number[] = new Array(np).fill(0), cells: number[] = [], troops: number[] = [];
  for (const pl of s.players) {
    if (!pl.alive) { cells.push(0); troops.push(0); continue; }
    const k = kinds[pl.id], tb = TECH_TABLE[pl.techLevel], na = pl.allies.length;
    const rate = (B.GOLD_PER_CELL * pl.cells + B.MARKET_GOLD * k[K_MARKET] + B.PORT_GOLD * k[K_PORT]) * (1 + tb.gold + B.ALLY_GOLD * na);
    pl.goldRate = rate; income[pl.id] = rate; pl.gold += rate;
    const pm = 1 + tb.prod;
    for (let r = 0; r < NRES; r++) pl.res[r] += B.RES_OUT * k[r] * pm;
    pl.techGauge += B.UNI_OUT * k[K_UNI] * (1 + B.ALLY_TECH * na);
    while (pl.techLevel < TECH_LEVELS.length && pl.techGauge >= TECH_LEVELS[pl.techLevel].at) {
      const lv = pl.techLevel; pl.techLevel++;
      if (s.techFirst[lv] < 0) { s.techFirst[lv] = pl.id; pl.vpTech++; log(s, pl.id, `${pl.name} atteint « ${TECH_LEVELS[lv].name} » en premier (+1 PV)`); }
      else log(s, pl.id, `${pl.name} atteint « ${TECH_LEVELS[lv].name} »`);
    }
    // soldats
    const mx = maxTroops(s, pl.id, k);
    if (pl.troops < mx) {
      const g = (B.REGEN_K * pl.troops * (1 - pl.troops / mx) + B.REGEN_BASE + B.REGEN_PER_MAX * mx) * (1 + tb.regen + B.BARRACKS_REGEN * k[K_BARRACKS]);
      pl.troops = Math.min(mx, pl.troops + g);
    }
    cells.push(pl.cells); troops.push(pl.troops);
  }
  // PV : ressources (plus de bâtiments de ce type, minimum 2)
  for (let r = 0; r < NRES; r++) {
    const vals = s.players.map((p, i) => (p.alive ? kinds[i][r] : 0));
    const cur = s.resHolder[r];
    let best = -1, bv = B.RES_LEAD_MIN - 1;
    for (let i = 0; i < np; i++) if (vals[i] > bv) { best = i; bv = vals[i]; }
    if (best < 0) { if (cur >= 0 && vals[cur] < B.RES_LEAD_MIN) s.resHolder[r] = -1; continue; }
    if (cur < 0 || vals[cur] < B.RES_LEAD_MIN || !s.players[cur].alive) { s.resHolder[r] = best; log(s, best, `${s.players[best].name} domine ${RES_NAMES[r].toLowerCase()} (+1 PV)`); }
    else if (best !== cur && vals[best] > vals[cur]) { s.resHolder[r] = best; log(s, best, `${s.players[best].name} prend la tête de ${RES_NAMES[r].toLowerCase()} (+1 PV)`); }
  }
  updateTitle(s, 0, cells, B.TITLE_MARGIN, B.TITLE_MIN_CELLS);
  updateTitle(s, 1, troops, B.TITLE_MARGIN, B.TITLE_MIN_TROOPS);
  updateTitle(s, 2, income, B.TITLE_MARGIN, B.TITLE_MIN_INCOME);
}

function checkVictory(s: State) {
  const alive = s.players.filter(p => p.alive);
  if (alive.length === 1) { s.over = true; s.winner = alive[0].id; log(s, alive[0].id, `${alive[0].name} est le dernier en lice`); return; }
  let best = -1, bv = -1;
  for (const p of s.players) { const v = vp(s, p.id).total; if (v >= B.VP_TARGET && v > bv) { best = p.id; bv = v; } }
  if (best >= 0) { s.over = true; s.winner = best; log(s, best, `${s.players[best].name} atteint ${bv} PV et gagne`); return; }
  if (s.timeLimit > 0 && s.tick >= s.timeLimit) {
    for (const p of alive) {
      const v = vp(s, p.id).total;
      if (v > bv || (v === bv && p.cells > s.players[best].cells)) { best = p.id; bv = v; }
    }
    s.over = true; s.winner = best; log(s, best, `Temps écoulé : ${s.players[best].name} gagne avec ${bv} PV`);
  }
}

// ================================================================ un tick
import { botAct } from './bots';
const BOT_CADENCE = [32, 20, 12];   // ticks entre deux décisions : facile / normal / difficile
export function tick(s: State, cmds: Command[] = [], onErr?: (c: Command, e: string) => void): string[] {
  const errs: string[] = [];
  if (s.over) return errs;
  for (const c of cmds) { const e = applyCommand(s, c); if (e) { errs.push(e); onErr?.(c, e); } }
  if (s.orders.length) {
    const keep: Order[] = [];
    for (const o of s.orders) { if (processOrder(s, o)) finishOrder(s, o); else keep.push(o); }
    // une attaque terminée a pu changer s.orders (élimination) : on ne garde que celles encore listées
    s.orders = keep.filter(o => s.players[o.p].alive);
  }
  if (s.tick % TPS === 0) {
    econ(s);
    s.proposals = s.proposals.filter(x => s.tick - x.t < B.PROPOSAL_TTL * TPS && s.players[x.from].alive && s.players[x.to].alive);
    for (const al of s.alliances.filter(x => x.until <= s.tick)) {
      endAlliance(s, al.a, al.b);
      log(s, al.a, `L’alliance ${s.players[al.a].name} – ${s.players[al.b].name} arrive à terme`);
    }
    checkVictory(s);
  }
  for (const p of s.players) if (p.isBot && p.alive && (s.tick + p.id * 3) % BOT_CADENCE[p.diff] === 0) botAct(s, p.id);
  s.tick++;
  return errs;
}

/** empreinte de l'état, pour vérifier le déterminisme */
export function stateHash(s: State): string {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
  for (let i = 0; i < NCELL; i++) mix(s.owner[i]);
  for (const p of s.players) { mix(Math.round(p.gold * 100)); mix(Math.round(p.troops * 100)); mix(p.cells); mix(p.techLevel); mix(p.vpRegion); for (const a of p.allies) mix(a + 1000); }
  for (const al of s.alliances) mix(al.until);
  mix(s.buildings.length); mix(s.tick); mix(s.rng);
  return h.toString(16);
}
export const regionOf = (c: number) => REGION[c];
export const placeName = (c: number) => (DEPT[c] ? DEPT_NAMES[DEPT[c] - 1] : '');
void cx; void cy; void LAND;
