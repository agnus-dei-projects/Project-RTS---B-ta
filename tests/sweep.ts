// Compare des réglages : pour chaque jeu de paramètres, N parties de 10 bots, on note quand le meilleur joueur atteint 8, 10, 12, 14, 16, 20 PV.
import { newGame, tick, vp } from '../src/core/game';
import { BALANCE as B } from '../src/core/config';
type Over = Partial<Record<keyof typeof B, number>>;
const base = { ...B };
const THR = [8, 10, 12, 14, 16, 20];
function trial(label: string, over: Over, ng: number, maxMin: number) {
  Object.assign(B, base, over, { VP_TARGET: 999 });
  const times: number[][] = THR.map(() => []);
  const comp = { region: 0, tech: 0, res: 0, title: 0 };
  const win: Record<string, number> = {};
  let elim = 0, alive = 0, wars = 0;
  for (let seed = 1; seed <= ng; seed++) {
    const s = newGame(seed, { humanBot: true });
    const hit: (number | null)[] = THR.map(() => null);
    while (s.tick < maxMin * 600 && s.players.filter(p => p.alive).length > 1) {
      tick(s);
      if (s.tick % 100 === 0) {
        let top = 0;
        for (const p of s.players) top = Math.max(top, vp(s, p.id).total);
        THR.forEach((t, i) => { if (hit[i] === null && top >= t) hit[i] = s.tick / 600; });
      }
    }
    THR.forEach((_, i) => { if (hit[i] !== null) times[i].push(hit[i]!); });
    let best = 0, bv = -1;
    for (const p of s.players) { const v = vp(s, p.id).total; if (v > bv) { bv = v; best = p.id; } }
    const v = vp(s, best);
    comp.region += v.region; comp.tech += v.tech; comp.res += v.res; comp.title += v.title;
    win[s.players[best].persona] = (win[s.players[best].persona] ?? 0) + 1;
    elim += s.players.filter(p => !p.alive).length; alive += s.players.filter(p => p.alive).length; void wars;
  }
  const med = (a: number[]) => { if (!a.length) return '   -'; const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)].toFixed(0).padStart(4); };
  const tot = comp.region + comp.tech + comp.res + comp.title || 1;
  console.log(`${label.padEnd(30)} | ` + THR.map((t, i) => `${t}PV: ${med(times[i])}m (${times[i].length}/${ng})`).join(' | '));
  console.log(`${''.padEnd(30)} | PV du meilleur à la fin : régions ${(100 * comp.region / tot).toFixed(0)}% tech ${(100 * comp.tech / tot).toFixed(0)}% ressources ${(100 * comp.res / tot).toFixed(0)}% titres ${(100 * comp.title / tot).toFixed(0)}% | éliminés/partie ${(elim / ng).toFixed(1)} | ${JSON.stringify(win)}`);
}
const NG = +(process.argv[2] ?? 8), MAXMIN = +(process.argv[3] ?? 35);
const sets: [string, Over][] = JSON.parse(process.argv[4] ?? '[["actuel",{}]]');
for (const [l, o] of sets) trial(l, o, NG, MAXMIN);
