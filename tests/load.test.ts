// Mesure la charge du serveur : N salons simulés (1 salon = 10 clients humains) pendant D secondes à la cadence réelle (200 ms/tour).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const ROOMS = +(process.argv[2] || 1), SECS = +(process.argv[3] || 30), PLAYERS = 10;
const base = 19000 + Math.floor(Math.random() * 500);
// un processus serveur ne gère qu'un salon : on en lance ROOMS pour mesurer le coût d'une instance « par salon »
const procs = Array.from({ length: ROOMS }, (_, i) => spawn(process.execPath, ['serveur.cjs', String(base + i)], { stdio: 'ignore' }));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const stat = (pid: number) => { const s = readFileSync(`/proc/${pid}/stat`, 'utf8').split(' '); const rss = +readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1] * 4096; return { cpu: (+s[13] + +s[14]) / 100, rss }; };
async function main() {
  await sleep(800);
  let bytesIn = 0, bytesOut = 0, turns = 0;
  const wss: WebSocket[][] = [];
  for (let r = 0; r < ROOMS; r++) {
    const row: WebSocket[] = [];
    for (let k = 0; k < PLAYERS; k++) {
      const ws = new WebSocket(`ws://localhost:${base + r}`);
      await new Promise<void>(res => { ws.onopen = () => res(); });
      ws.onmessage = e => { const n = (e.data as string).length; bytesOut += n; if (k === 0 && (JSON.parse(e.data as string).t === 'turn')) turns++; };
      ws.send(JSON.stringify({ t: 'join', name: 'J' + k })); row.push(ws);
    }
    wss.push(row);
  }
  await sleep(300);
  const before = procs.map(p => stat(p.pid!));
  for (const row of wss) row[0].send(JSON.stringify({ t: 'start' }));
  // chaque joueur envoie ~1 commande/s (attaque de 150 cases = cas lourd) + un hash toutes les 10 s
  const cells = Array.from({ length: 150 }, (_, i) => 1000 + i);
  const timer = setInterval(() => {
    for (const row of wss) for (const ws of row) { const m = JSON.stringify({ t: 'cmd', c: { type: 'attack', p: 0, cells, pct: 10 } }); bytesIn += m.length; ws.send(m); }
  }, 1000);
  await sleep(SECS * 1000);
  clearInterval(timer);
  const after = procs.map(p => stat(p.pid!));
  const cpu = after.reduce((a, s, i) => a + (s.cpu - before[i].cpu), 0), rss = Math.max(...after.map(s => s.rss));
  console.log(`${ROOMS} salon(s) × ${PLAYERS} joueurs, ${SECS} s : CPU total ${(100 * cpu / SECS).toFixed(1)} % d'un cœur (${(100 * cpu / SECS / ROOMS).toFixed(1)} % / salon) | RAM max/process ${(rss / 1e6).toFixed(0)} Mo | trafic sortant serveur ${(bytesOut / SECS / 1e3).toFixed(0)} Ko/s total (${(bytesOut / SECS / 1e3 / ROOMS / PLAYERS).toFixed(1)} Ko/s/joueur) | entrant ${(bytesIn / SECS / 1e3).toFixed(0)} Ko/s | tours reçus ${turns} (attendu ${SECS * 5 * ROOMS})`);
  for (const p of procs) p.kill();
  process.exit(0);
}
main();
