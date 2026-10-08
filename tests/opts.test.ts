import * as G from '../src/core/game';
const cfgs = [
  { n: 1, d: 1, t: 10 }, { n: 3, d: 0, t: 15 }, { n: 9, d: 2, t: 10 }, { n: 5, d: 1, t: 0 },
];
let fail = 0;
for (const c of cfgs) {
  const s = G.newGame(5, { humanName: 'Moi', bots: Array.from({ length: c.n }, (_, i) => ({ name: `B${i}`, diff: c.d })), timeLimitMin: c.t });
  const max = c.t ? c.t * 600 + 5 : 20000;
  while (!s.over && s.tick < max) G.tick(s);
  const cells = s.players.map(p => p.cells);
  const okNames = s.players[1].name === 'B0' && s.players.length === c.n + 1;
  const okEnd = c.t ? s.over : true;
  console.log(`${c.n} bot(s) diff ${c.d} limite ${c.t || '∞'} min -> tick ${s.tick} over=${s.over} gagnant=${s.over ? s.players[s.winner].name : '-'} cases=[${cells.join(',')}] ${okNames && okEnd ? 'ok' : 'FAIL'}`);
  if (!(okNames && okEnd)) fail++;
}
process.exit(fail ? 1 : 0);
