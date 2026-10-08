import { newGame, tick, vp } from '../src/core/game';
const NG = +(process.argv[2] ?? 10), MIN = +(process.argv[3] ?? 20);
const agg: Record<string, { n: number; cells: number; pv: number; reg: number; tech: number; res: number; title: number; bld: number; lvl: number; elim: number; troops: number }> = {};
for (let seed = 1; seed <= NG; seed++) {
  const s = newGame(seed, { humanBot: true });
  while (s.tick < MIN * 600 && !s.over) tick(s);
  for (const p of s.players) {
    const a = (agg[p.persona] ??= { n: 0, cells: 0, pv: 0, reg: 0, tech: 0, res: 0, title: 0, bld: 0, lvl: 0, elim: 0, troops: 0 });
    const v = vp(s, p.id);
    a.n++; a.cells += p.cells; a.pv += v.total; a.reg += v.region; a.tech += v.tech; a.res += v.res; a.title += v.title;
    a.bld += s.buildings.filter(b => b.owner === p.id).length; a.lvl += p.techLevel; a.elim += p.alive ? 0 : 1; a.troops += p.troops;
  }
}
console.log(`moyennes par joueur après ${MIN} min (${NG} parties)`);
for (const [k, a] of Object.entries(agg)) {
  const f = (x: number) => (x / a.n).toFixed(1);
  console.log(`${k.padEnd(10)} n=${String(a.n).padStart(3)} | PV ${f(a.pv)} (rég ${f(a.reg)} tech ${f(a.tech)} res ${f(a.res)} titres ${f(a.title)}) | cases ${f(a.cells)} | bât ${f(a.bld)} | niv.tech ${f(a.lvl)} | soldats ${f(a.troops)} | éliminés ${(100 * a.elim / a.n).toFixed(0)} %`);
}
