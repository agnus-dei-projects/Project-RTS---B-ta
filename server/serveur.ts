// Serveur de parties « Project Bêta » : relais déterministe (lockstep).
// Il ne simule rien : il ordonne les commandes des joueurs et les diffuse à tous, par « tours » de 2 ticks.
// Il sert aussi le jeu lui-même : les amis n'ont qu'à ouvrir http://<IP de l'hôte>:<port> dans leur navigateur.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';

const PORT = +(process.argv[2] || process.env.PORT || 8080);
const TURN_MS = +(process.env.TURN_MS || 200);   // un tour = 2 ticks de simulation (0,1 s chacun)
const MAX_PLAYERS = 10;
const ACCESS_CODE = (process.env.ACCESS_CODE || '').trim();   // facultatif : si défini, il faut le saisir pour entrer dans le salon
const HTML_NAME = 'Project-Beta.html';
const here = path.dirname(path.resolve(process.argv[1] || '.'));

const ALLOWED = new Set(['attack', 'recall', 'build', 'trade', 'draft', 'propose', 'accept', 'refuse', 'break']);
const isInt = (v: unknown) => Number.isInteger(v);

interface Cfg { nBots: number; bots: { name: string; diff: number }[]; timeLimitMin: number; }
interface Client { ws: WebSocket; id: number; name: string; slot: number; alive: boolean; }

const defCfg = (): Cfg => ({ nBots: 5, bots: [], timeLimitMin: 30 });
let cfg: Cfg = defCfg();
let phase: 'lobby' | 'playing' = 'lobby';
const clients = new Map<WebSocket, Client>();
let nextId = 1, hostId = -1;
let queue: any[] = [];
let turnNo = 0, timer: NodeJS.Timeout | null = null, t0 = 0;
let hashes = new Map<number, Map<number, string>>();

const send = (ws: WebSocket, m: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const all = (m: unknown) => { const j = JSON.stringify(m); for (const c of clients.values()) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(j); };
const clean = (s: unknown, max: number, fb: string) => {
  const t = String(s ?? '').replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, max);
  return t || fb;
};

function lobbyMsg() {
  return {
    t: 'lobby', phase, host: hostId, cfg,
    players: [...clients.values()].map(c => ({ id: c.id, name: c.name })),
    max: MAX_PLAYERS,
  };
}
const pushLobby = () => all(lobbyMsg());

function sanitizeCfg(raw: any): Cfg {
  const n = Math.max(0, Math.min(MAX_PLAYERS - 1, isInt(raw?.nBots) ? raw.nBots : 5));
  const bots = Array.isArray(raw?.bots) ? raw.bots.slice(0, MAX_PLAYERS - 1).map((b: any) => ({ name: clean(b?.name, 16, ''), diff: [0, 1, 2].includes(b?.diff) ? b.diff : 1 })) : [];
  const tl = Number(raw?.timeLimitMin);
  return { nBots: n, bots, timeLimitMin: Number.isFinite(tl) && tl >= 0 && tl <= 240 ? Math.round(tl) : 30 };
}

function startGame() {
  const humans = [...clients.values()];
  humans.forEach((c, i) => { c.slot = i; c.alive = true; });
  const room = MAX_PLAYERS - humans.length;
  const nBots = Math.min(cfg.nBots, room);
  const bots = Array.from({ length: nBots }, (_, i) => ({ name: cfg.bots[i]?.name || '', diff: cfg.bots[i]?.diff ?? 1 }));
  const seed = Math.floor(Math.random() * 1e6);
  phase = 'playing'; queue = []; turnNo = 0; hashes = new Map();
  for (const c of humans) send(c.ws, { t: 'start', seed, humans: humans.map(h => h.name), bots, timeLimitMin: cfg.timeLimitMin, you: c.slot });
  pushLobby();
  t0 = Date.now();
  timer = setInterval(() => {
    // rattrape les retards d'horloge pour garder un rythme moyen régulier
    const due = Math.floor((Date.now() - t0) / TURN_MS);
    let guard = 0;
    while (turnNo < due && guard++ < 5) { all({ t: 'turn', n: turnNo, cmds: queue }); queue = []; turnNo++; }
  }, 50);
}
function stopGame() {
  if (timer) clearInterval(timer);
  timer = null; phase = 'lobby'; queue = [];
  pushLobby();
}

function validate(m: any, slot: number): any | null {
  if (!m || typeof m !== 'object' || !ALLOWED.has(m.type)) return null;
  const c: any = { type: m.type, p: slot };
  switch (m.type) {
    case 'attack':
      if (!Array.isArray(m.cells) || m.cells.length > 20000 || !m.cells.every(isInt) || typeof m.pct !== 'number') return null;
      c.cells = m.cells; c.pct = m.pct; break;
    case 'recall': if (!isInt(m.order)) return null; c.order = m.order; break;
    case 'build': if (!isInt(m.kind) || !isInt(m.cell)) return null; c.kind = m.kind; c.cell = m.cell; break;
    case 'trade': if ((m.side !== 'sell' && m.side !== 'buy') || !isInt(m.res) || !isInt(m.qty)) return null; c.side = m.side; c.res = m.res; c.qty = m.qty; break;
    case 'draft': if (!isInt(m.qty)) return null; c.qty = m.qty; break;
    case 'propose': if (!isInt(m.to)) return null; c.to = m.to; break;
    case 'accept': case 'refuse': if (!isInt(m.from)) return null; c.from = m.from; break;
    case 'break': if (!isInt(m.with)) return null; c.with = m.with; break;
  }
  return c;
}

function drop(cl: Client) {
  clients.delete(cl.ws);
  if (phase === 'playing') {
    if (cl.alive) queue.push({ type: 'autopilot', p: cl.slot });
    if (![...clients.values()].length) stopGame();
  }
  if (hostId === cl.id) hostId = clients.size ? [...clients.values()][0].id : -1;
  if (!clients.size) { cfg = defCfg(); phase = 'lobby'; if (timer) clearInterval(timer); timer = null; }
  pushLobby();
}

function onMessage(cl: Client, raw: string) {
  let m: any;
  try { m = JSON.parse(raw); } catch { return; }
  switch (m?.t) {
    case 'cfg':
      if (cl.id !== hostId || phase !== 'lobby') return;
      cfg = sanitizeCfg(m.cfg); pushLobby(); break;
    case 'start':
      if (cl.id !== hostId || phase !== 'lobby') return;
      startGame(); break;
    case 'cmd': {
      if (phase !== 'playing') return;
      const c = validate(m.c, cl.slot);
      if (c) queue.push(c);
      break;
    }
    case 'hash': {
      if (phase !== 'playing' || !isInt(m.tick) || typeof m.h !== 'string') return;
      let row = hashes.get(m.tick);
      if (!row) { row = new Map(); hashes.set(m.tick, row); if (hashes.size > 20) hashes.delete(hashes.keys().next().value!); }
      row.set(cl.id, m.h);
      const expected = [...clients.values()].filter(c => c.alive).length;
      if (row.size >= expected) {
        if (new Set(row.values()).size > 1) all({ t: 'desync', tick: m.tick });
        hashes.delete(m.tick);
      }
      break;
    }
    case 'ping': send(cl.ws, { t: 'pong' }); break;
    case 'over': if (phase === 'playing') stopGame(); break;
    case 'chat': all({ t: 'chat', from: cl.name, text: clean(m.text, 140, '') }); break;
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html' || url === '/' + HTML_NAME) {
    const f = [path.join(here, HTML_NAME), path.join(process.cwd(), HTML_NAME)].find(existsSync);
    if (!f) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`${HTML_NAME} introuvable à côté du serveur.`); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(f)); return;
  }
  if (url === '/ping' || url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 512 * 1024 });
wss.on('connection', ws => {
  if (clients.size >= MAX_PLAYERS) { send(ws, { t: 'error', msg: 'Salon plein (10 joueurs maximum).' }); ws.close(); return; }
  if (phase === 'playing') { send(ws, { t: 'error', msg: 'Une partie est en cours : réessayez à la fin.' }); ws.close(); return; }
  (ws as any).isAlive = true;
  ws.on('pong', () => { (ws as any).isAlive = true; });
  let cl: Client | null = null;
  ws.on('message', data => {
    const raw = data.toString();
    if (!cl) {
      let m: any; try { m = JSON.parse(raw); } catch { return; }
      if (m?.t !== 'join') return;
      if (ACCESS_CODE && String(m.code ?? '').trim() !== ACCESS_CODE) { send(ws, { t: 'error', msg: 'Code d’accès incorrect.' }); ws.close(); return; }
      let name = clean(m.name, 16, 'Joueur'); const base = name; let k = 2;
      while ([...clients.values()].some(c => c.name.toLowerCase() === name.toLowerCase())) name = `${base.slice(0, 13)} ${k++}`;
      cl = { ws, id: nextId++, name, slot: -1, alive: false };
      clients.set(ws, cl);
      if (hostId < 0) hostId = cl.id;
      send(ws, { t: 'welcome', id: cl.id });
      pushLobby();
      return;
    }
    onMessage(cl, raw);
  });
  ws.on('close', () => { if (cl && clients.has(ws)) drop(cl); });
  ws.on('error', () => { /* géré par close */ });
});
setInterval(() => {
  for (const ws of wss.clients) {
    if ((ws as any).isAlive === false) { ws.terminate(); continue; }
    (ws as any).isAlive = false; ws.ping();
  }
}, 15000);

server.on('error', (e: any) => {
  console.error(e.code === 'EADDRINUSE' ? `Le port ${PORT} est déjà utilisé (un autre serveur tourne ?). Essayez : node serveur.cjs ${PORT + 1}` : e);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  Project Bêta — serveur de parties démarré\n');
  console.log(`  Vous (hôte)      : http://localhost:${PORT}`);
  const ips: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  if (ips.length) { console.log('  Vos amis         :'); for (const ip of ips) console.log(`                     http://${ip}:${PORT}`); }
  if (ACCESS_CODE) console.log('  Code d\'accès activé (variable ACCESS_CODE).');
  console.log('\n  Même réseau local / VPN (Tailscale, Radmin, Hamachi) : l\'adresse ci-dessus suffit.');
  console.log(`  Par Internet : redirigez le port TCP ${PORT} de votre box vers ce PC, puis donnez votre IP publique.`);
  console.log('  Laissez cette fenêtre ouverte pendant la partie (Ctrl+C pour arrêter).\n');
});
