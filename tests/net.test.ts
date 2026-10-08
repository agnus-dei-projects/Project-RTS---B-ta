// Test réseau : lance le vrai serveur, connecte 3 clients (simulation locale chacun) et vérifie que les états restent identiques.
import { spawn } from 'node:child_process';
import * as G from '../src/core/game';
import type { State, Command } from '../src/core/types';

const PORT = 18080 + Math.floor(Math.random() * 500);
const srv = spawn(process.execPath, ['serveur.cjs', String(PORT)], { env: { ...process.env, TURN_MS: '8' }, stdio: ['ignore', 'pipe', 'inherit'] });
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

class Cl {
  ws!: WebSocket; id = -1; slot = -1; S!: State; lobby: any = null; started = false; desync = 0; err = '';
  constructor(public name: string) {}
  async open() {
    this.ws = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise<void>((res, rej) => { this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('connexion')); });
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data as string);
      if (m.t === 'welcome') this.id = m.id;
      else if (m.t === 'lobby') this.lobby = m;
      else if (m.t === 'error') this.err = m.msg;
      else if (m.t === 'desync') this.desync++;
      else if (m.t === 'start') {
        this.slot = m.you; this.started = true;
        this.S = G.newGame(m.seed, { humans: m.humans, bots: m.bots, timeLimitMin: m.timeLimitMin });
      } else if (m.t === 'turn' && this.S && !this.S.over) {
        for (let i = 0; i < 2; i++) G.tick(this.S, i === 0 ? m.cmds : []);
        if (this.S.tick % 100 === 0) this.send({ t: 'hash', tick: this.S.tick, h: G.stateHash(this.S) });
      }
    };
    this.send({ t: 'join', name: this.name });
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
}

async function codeTest() {
  const port = PORT + 700;
  const s2 = spawn(process.execPath, ['serveur.cjs'], { env: { ...process.env, PORT: String(port), ACCESS_CODE: 'secret' }, stdio: 'ignore' });
  await sleep(700);
  try {
    const join = (code: string) => new Promise<string>(res => {
      const ws = new WebSocket(`ws://localhost:${port}`); let out = 'rien';
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: 'X', code }));
      ws.onmessage = e => { const m = JSON.parse(e.data as string); if (m.t === 'welcome' || m.t === 'error') { out = m.t; ws.close(); } };
      ws.onclose = () => res(out);
    });
    ok(await join('mauvais') === 'error', 'code d’accès incorrect refusé (serveur lancé via la variable PORT)');
    ok(await join('secret') === 'welcome', 'bon code d’accès accepté');
    const h = await fetch(`http://localhost:${port}/healthz`); ok(h.status === 200, 'route /healthz');
  } finally { s2.kill(); }
}
async function main() {
  await codeTest();
  await sleep(600);
  const r = await fetch(`http://localhost:${PORT}/`); const html = await r.text();
  ok(r.status === 200 && html.includes('Project Bêta'), 'le serveur sert le jeu en HTTP');

  const a = new Cl('Alice'), b = new Cl('Bob'), c = new Cl('Alice'); // même pseudo : doit être dédoublonné
  await a.open(); await b.open(); await c.open(); await sleep(150);
  ok(a.lobby.players.length === 3, 'trois joueurs dans le salon');
  ok(new Set(a.lobby.players.map((p: any) => p.name)).size === 3, `pseudos dédoublonnés (${a.lobby.players.map((p: any) => p.name).join(', ')})`);
  ok(a.lobby.host === a.id, 'le premier connecté est l’hôte');

  // un non-hôte ne peut ni régler ni lancer
  b.send({ t: 'cfg', cfg: { nBots: 1, bots: [], timeLimitMin: 5 } }); b.send({ t: 'start' }); await sleep(150);
  ok(!b.started && a.lobby.cfg.nBots === 5, 'un non-hôte ne peut pas régler/lancer');
  a.send({ t: 'cfg', cfg: { nBots: 4, bots: [{ name: 'Ada', diff: 2 }, { name: 'Bug<b>', diff: 0 }], timeLimitMin: 20 } }); await sleep(150);
  ok(b.lobby.cfg.nBots === 4 && b.lobby.cfg.bots[0].name === 'Ada' && !b.lobby.cfg.bots[1].name.includes('<'), 'config de l’hôte diffusée et nettoyée');

  a.send({ t: 'start' }); await sleep(300);
  ok(a.started && b.started && c.started, 'la partie démarre pour tous');
  ok(a.S.players.length === 7 && a.S.players[3].name === "Ada" && a.S.players[3].diff === 2 && a.S.players[4].diff === 0 && a.S.players[4].name === "Bugb", 'bots : nombre, pseudos et difficultés appliqués');
  ok(a.S.timeLimit === 20 * 60 * 10, 'durée limite appliquée');
  ok(a.slot === 0 && b.slot === 1 && c.slot === 2, 'emplacements joueurs distincts');

  // quelques ordres réels, plus un usurpateur et des paquets invalides
  const act = (cl: Cl) => {
    const S = cl.S, p = cl.slot;
    const mine: number[] = []; for (let i = 0; i < S.owner.length; i++) if (S.owner[i] === p) mine.push(i);
    const c0 = mine[Math.floor(mine.length / 2)];
    cl.send({ t: 'cmd', c: { type: 'build', p, kind: 0, cell: c0 } });
    const edge = mine.find(i => S.owner[i + 1] === -1 && S.owner[i - 1] === p); // bord est
    if (edge !== undefined) cl.send({ t: 'cmd', c: { type: 'attack', p, cells: Array.from({ length: 30 }, (_, k) => edge + 1 + (k % 6) + 206 * ((k / 6) | 0)), pct: 50 } });
  };
  act(a); act(b); act(c);
  b.send({ t: 'cmd', c: { type: 'draft', p: 0, qty: 100 } });            // usurpation : p sera forcé à 1
  b.send({ t: 'cmd', c: { type: 'hack', p: 0 } });                        // type inconnu
  b.send({ t: 'cmd', c: { type: 'attack', p: 1, cells: [1.5, 'x'], pct: 5 } });  // cellules invalides
  b.ws.send('pas du json');
  for (let k = 0; k < 6; k++) { await sleep(900); act(a); act(b); act(c); a.send({ t: 'cmd', c: { type: 'propose', p: 0, to: 1 } }); b.send({ t: 'cmd', c: { type: 'accept', p: 1, from: 0 } }); }
  await sleep(2500);
  const ha = G.stateHash(a.S), hb = G.stateHash(b.S), hc = G.stateHash(c.S);
  console.log('  ticks', a.S.tick, b.S.tick, c.S.tick, 'hash', ha, hb, hc);
  ok(a.S.tick > 1500, `la simulation avance (${a.S.tick} ticks)`);
  ok(a.S.tick === b.S.tick && b.S.tick === c.S.tick, 'même tick chez tous');
  ok(ha === hb && hb === hc, 'états identiques (empreintes égales)');
  ok(a.desync + b.desync + c.desync === 0, 'aucune désynchronisation détectée par le serveur');
  ok(a.S.buildings.length > 0 && a.S.players[0].allies.includes(1), 'ordres appliqués (bâtiments, alliance)');
  ok(a.S.players[0].troops !== 0 && a.S.players[1].gold >= 0, 'sanity');

  // déconnexion : une IA reprend
  c.ws.close(); await sleep(1500);
  ok(a.S.players[2].isBot && a.S.players[2].alive !== undefined, 'joueur déconnecté repris par une IA');
  ok(G.stateHash(a.S) === G.stateHash(b.S), 'états toujours identiques après déconnexion');

  // un nouvel arrivant en cours de partie est refusé
  const d = new Cl('Tardif'); await d.open(); await sleep(300);
  ok(/en cours/.test(d.err), 'connexion refusée pendant une partie');

  a.send({ t: 'over' }); await sleep(300);
  ok(a.lobby.phase === 'lobby', 'retour au salon après la fin');
  a.ws.close(); b.ws.close();
}
main().catch(e => { console.error(e); fails++; }).finally(() => { srv.kill(); console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTous les tests réseau passent'); process.exit(fails ? 1 : 0); });
