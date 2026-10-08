import { newGame, tick, vp, stateHash, applyCommand, buildCost, placementError, cellCost } from '../src/core/game';
import { BALANCE as B, NRES, TPS, K_PORT, K_UNI } from '../src/core/config';
import { NCELL, TERRAIN, LAND, W, COASTAL, REGION, NR, REGION_NAMES, MAINLAND } from '../src/core/world';
import type { State } from '../src/core/types';

let fails = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fails++; console.log('  ÉCHEC :', msg); } };

function invariants(s: State, tag: string) {
  let sum = 0;
  const cnt = new Array(s.players.length).fill(0);
  for (let c = 0; c < NCELL; c++) {
    const o = s.owner[c];
    if (o >= 0) { cnt[o]++; if (TERRAIN[c] !== 1) { check(false, `${tag}: case non-terrestre possédée ${c}`); return; } }
    sum += o >= 0 ? 1 : 0;
  }
  s.players.forEach((p, i) => {
    if (cnt[i] !== p.cells) check(false, `${tag}: compteur de cases incohérent ${p.name} ${cnt[i]} vs ${p.cells}`);
    if (p.alive !== (p.cells > 0)) check(false, `${tag}: alive incohérent ${p.name}`);
    if (!(p.troops >= -1e-6) || !isFinite(p.troops)) check(false, `${tag}: troupes invalides ${p.name} ${p.troops}`);
    if (p.gold < -1e-6) check(false, `${tag}: or négatif ${p.name}`);
    for (let r = 0; r < NRES; r++) if (p.res[r] < -1e-6) check(false, `${tag}: ressource ${r} négative ${p.name}`);
    for (const a of p.allies) if (!s.players[a].allies.includes(i)) check(false, `${tag}: alliance non réciproque ${i}-${a}`);
    if (p.allies.length > B.MAX_ALLIES) check(false, `${tag}: trop d'alliés ${p.name}`);
  });
  // régions : compteurs incrémentaux = recomptage
  const rc = new Int32Array(s.players.length * NR);
  for (const c of LAND) if (s.owner[c] >= 0) rc[s.owner[c] * NR + REGION[c]]++;
  for (let i = 0; i < rc.length; i++) if (rc[i] !== s.regCount[i]) { check(false, `${tag}: regCount incohérent ${i}`); break; }
  for (const b of s.buildings) if (b.owner !== s.owner[b.cell]) { check(false, `${tag}: bâtiment ${b.id} propriétaire ≠ case`); break; }
  void sum;
}

// ---------------------------------------------------------------- 1. carte
console.log('== Carte');
{
  console.log(`  grille ${W}x${NCELL / W}, ${LAND.length} cases de terre (~${Math.round(LAND.length * 36 / 1000)} milliers de km²)`);
  const coast = LAND.filter(c => COASTAL[c]).length;
  const isl = LAND.filter(c => !MAINLAND[c]).length;
  console.log(`  côtières ${coast}, hors continent (Corse et îles) ${isl}`);
  check(LAND.length > 14000 && LAND.length < 17000, 'nombre de cases de terre hors plage');
  for (let r = 0; r < NR; r++) check(LAND.some(c => REGION[c] === r), `région vide ${REGION_NAMES[r]}`);
}

// ---------------------------------------------------------------- 2. règles unitaires
console.log('== Règles');
{
  const s = newGame(5, { humanBot: true });
  // chaque joueur démarre avec une zone compacte et pas de PV
  check(s.players.every(p => p.cells > 60 && p.cells < 120), 'taille de départ');
  check(s.players.every(p => vp(s, p.id).total === 0), 'PV de départ non nuls');
  // construire hors territoire est refusé, sur son territoire accepté
  const p0 = s.players[0];
  const own = LAND.filter(c => s.owner[c] === 0);
  const foreign = LAND.find(c => s.owner[c] === -1)!;
  check(applyCommand(s, { type: 'build', p: 0, kind: 0, cell: foreign }) !== null, 'build hors territoire accepté');
  const g0 = p0.gold;
  const centre = own[Math.floor(own.length / 2)];
  const e = applyCommand(s, { type: 'build', p: 0, kind: 0, cell: centre });
  check(e === null, 'build valide refusé : ' + e);
  check(Math.abs(g0 - p0.gold - buildCost(s, 0, 0).gold) < 1e-6 || p0.gold < g0, 'or non débité');
  check(placementError(s, centre + 1, 0, 0) !== null, 'deux bâtiments collés acceptés');
  // le coût augmente avec le nombre de bâtiments
  const c1 = buildCost(s, 0, 0).gold;
  check(c1 > 90, 'coût non majoré après 1er bâtiment');
  // un port exige la côte
  const inland = own.find(c => !COASTAL[c] && placementError(s, c, 0, K_PORT) !== null)!;
  check(inland !== undefined, 'port constructible à l’intérieur ?');
  // attaque : cible neutre voisine
  const edge = own.find(c => s.owner[c + 1] === -1 && TERRAIN[c + 1] === 1)!;
  const before = p0.troops, cellsBefore = p0.cells;
  const cells: number[] = []; for (let d = 0; d < 8; d++) for (let dy = -2; dy <= 2; dy++) { const c = edge + 1 + d + dy * W; if (TERRAIN[c] === 1 && s.owner[c] === -1) cells.push(c); }
  check(applyCommand(s, { type: 'attack', p: 0, cells, pct: 50 }) === null, 'attaque valide refusée');
  check(Math.abs(p0.troops - before / 2) < 1e-6, 'budget non prélevé');
  for (let i = 0; i < 300; i++) tick(s);
  check(p0.cells > cellsBefore, 'l’attaque n’a rien pris');
  for (let i = 0; i < 3000; i++) tick(s);
  check(s.orders.every(o => o.p !== 0), 'ordre du joueur 0 jamais terminé');
  // zone hors de portée refusée
  const far = LAND.find(c => s.owner[c] === -1 && MAINLAND[c] && (c % W) > 150)!;
  check(applyCommand(s, { type: 'attack', p: 0, cells: [far], pct: 50 }) !== null, 'zone lointaine acceptée');
  // le coût d'une case ennemie dépend de la densité du défenseur, jamais d'un prédicteur : on vérifie juste la monotonie
  const e1 = LAND.find(c => s.owner[c] === 1)!;
  const k0 = cellCost(s, 0, e1); s.players[1].troops *= 3; const k1 = cellCost(s, 0, e1);
  check(k1 > k0, 'coût non croissant avec les troupes du défenseur');
  // alliances : réciproques, bloquent l'attaque, expirent, rupture
  const s2 = newGame(6, { humanBot: true });
  check(applyCommand(s2, { type: 'propose', p: 0, to: 1 }) === null, 'proposition refusée');
  check(applyCommand(s2, { type: 'accept', p: 1, from: 0 }) === null, 'acceptation refusée');
  check(s2.players[0].allies.includes(1) && s2.players[1].allies.includes(0), 'alliance non réciproque');
  const ec = LAND.find(c => s2.owner[c] === 1)!;
  check(applyCommand(s2, { type: 'attack', p: 0, cells: [ec], pct: 50 }) !== null, 'attaque contre un allié acceptée');
  s2.tick = B.ALLY_TTL * TPS - 1; tick(s2); tick(s2); // franchit l'échéance, au tick multiple de TPS
  s2.tick = Math.ceil(s2.tick / TPS) * TPS; tick(s2);
  check(!s2.players[0].allies.includes(1), 'alliance non expirée');
  check(applyCommand(s2, { type: 'propose', p: 0, to: 2 }) === null && applyCommand(s2, { type: 'accept', p: 2, from: 0 }) === null, 'nouvelle alliance');
  check(applyCommand(s2, { type: 'break', p: 0, with: 2 }) === null && s2.players[0].betrayedUntil > s2.tick, 'rupture / marque de traître');
  // débarquement : sans port, la Corse est hors de portée ; avec un port à portée, elle devient possible
  const s3 = newGame(7, { humanBot: true });
  const corse = LAND.filter(c => REGION[c] === NR - 1 || !MAINLAND[c]).filter(c => COASTAL[c]);
  check(corse.length > 0, 'pas de côte corse');
  check(applyCommand(s3, { type: 'attack', p: 0, cells: corse.slice(0, 20), pct: 50 }) !== null, 'débarquement sans port accepté');
}

// ---------------------------------------------------------------- 3. déterminisme
console.log('== Déterminisme');
{
  const run = (seed: number, n: number) => { const s = newGame(seed, { humanBot: true }); for (let i = 0; i < n; i++) tick(s); return stateHash(s); };
  const a = run(42, 6000), b = run(42, 6000), c = run(43, 6000);
  check(a === b, 'deux parties identiques divergent');
  check(a !== c, 'graines différentes, même partie');
  console.log(`  graine 42 : ${a} = ${b} ; graine 43 : ${c}`);
}

// ---------------------------------------------------------------- 4. parties complètes
const NG = +(process.argv[2] ?? 12);
console.log(`== ${NG} parties complètes (10 bots, limite ${B.TIME_LIMIT / 60} min)`);
const durations: number[] = [], win: Record<string, number> = {};
let comp = { region: 0, tech: 0, res: 0, title: 0 }, byTime = 0, allyEvents = 0, elim = 0;
for (let seed = 1; seed <= NG; seed++) {
  const s = newGame(seed, { humanBot: true });
  while (!s.over) { tick(s); if (s.tick % 3000 === 0) invariants(s, `graine ${seed} t=${s.tick / 600}min`); }
  invariants(s, `graine ${seed} fin`);
  const w = s.players[s.winner], v = vp(s, w.id);
  durations.push(s.tick / 600); win[w.persona] = (win[w.persona] ?? 0) + 1;
  comp.region += v.region; comp.tech += v.tech; comp.res += v.res; comp.title += v.title;
  if (s.tick >= B.TIME_LIMIT * TPS) byTime++;
  allyEvents += s.events.filter(e => e.text.includes('s’allient')).length;
  elim += s.players.filter(p => !p.alive).length;
  console.log(`  graine ${String(seed).padStart(2)} : ${w.name.padEnd(9)} (${w.persona.padEnd(9)}) ${(s.tick / 600).toFixed(0).padStart(3)} min  ${v.total} PV = régions ${v.region} + tech ${v.tech} + ressources ${v.res} + titres ${v.title} | ${w.cells} cases`);
}
durations.sort((a, b) => a - b);
const tot = comp.region + comp.tech + comp.res + comp.title || 1;
console.log(`  durée min ${durations[0].toFixed(0)} / médiane ${durations[Math.floor(NG / 2)].toFixed(0)} / max ${durations[NG - 1].toFixed(0)} min | victoire au temps ${byTime}/${NG} | éliminés/partie ${(elim / NG).toFixed(1)} | alliances formées/partie ${(allyEvents / NG).toFixed(1)}`);
console.log(`  PV des vainqueurs : régions ${(100 * comp.region / tot).toFixed(0)} % · technologie ${(100 * comp.tech / tot).toFixed(0)} % · ressources ${(100 * comp.res / tot).toFixed(0)} % · titres ${(100 * comp.title / tot).toFixed(0)} %`);
console.log('  victoires par profil :', JSON.stringify(win));
void K_UNI;
console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTous les contrôles passent.');
process.exit(fails ? 1 : 0);
