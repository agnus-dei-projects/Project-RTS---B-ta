import { newGame, tick, vp } from '../src/core/game';
import { LAND_COUNT } from '../src/core/world';
const seed = +(process.argv[2] ?? 1);
const maxMin = +(process.argv[3] ?? 40);
const s = newGame(seed, { humanBot: true });
console.log('cases de terre :', LAND_COUNT);
const t0 = Date.now();
while (!s.over && s.tick < maxMin * 600) {
  tick(s);
  if (s.tick % 600 === 0) {
    const min = s.tick / 600;
    const neutral = LAND_COUNT - s.players.reduce((a, p) => a + p.cells, 0);
    const line = s.players.map(p => `${p.name.slice(0, 3)}:${p.cells}/${Math.round(p.troops)}`).join(' ');
    console.log(`min ${String(min).padStart(2)} | neutre ${String(neutral).padStart(5)} | ordres ${s.orders.length} | ${line}`);
  }
}
console.log('fin', s.over ? `${s.players[s.winner].name} à ${(s.tick / 600).toFixed(1)} min` : 'non terminée', `| calcul ${Date.now() - t0} ms`);
for (const p of s.players) {
  const v = vp(s, p.id);
  const k = s.buildings.filter(b => b.owner === p.id).length;
  console.log(`${p.name.padEnd(10)} ${p.persona.padEnd(9)} PV ${v.total} (rég ${v.region} tech ${v.tech} res ${v.res} titres ${v.title}) cases ${p.cells} bât ${k} techN${p.techLevel} or ${Math.round(p.gold)} alliés [${p.allies.join(',')}]`);
}
