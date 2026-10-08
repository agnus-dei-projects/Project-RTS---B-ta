import { newGame, tick, vp } from '../src/core/game';
const NG = +(process.argv[2] ?? 20);
const wins = new Array(10).fill(0), pvAvg = new Array(10).fill(0), cells = new Array(10).fill(0);
const S0 = +(process.argv[3] ?? 101);
for (let seed = S0; seed < S0 + NG; seed++) {
  const s = newGame(seed, { humanBot: true });
  while (!s.over && s.tick < 25 * 600) tick(s);
  let best = 0, bv = -1;
  for (const p of s.players) { const v = vp(s, p.id).total; pvAvg[p.id] += v; cells[p.id] += p.cells; if (v > bv || (v === bv && p.cells > s.players[best].cells)) { bv = v; best = p.id; } }
  wins[best]++;
}
console.log('par identifiant de joueur (0 = vous) sur', NG, 'parties, 25 min max');
console.log('victoires/meilleur PV :', wins.join(' '));
console.log('PV moyen              :', pvAvg.map(x => (x / NG).toFixed(1)).join(' '));
console.log('cases moyennes        :', cells.map(x => Math.round(x / NG)).join(' '));
