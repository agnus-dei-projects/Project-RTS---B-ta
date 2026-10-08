// Client réseau : parle au serveur de parties (WebSocket, relais lockstep).
import type { Command } from '../core/types';

export interface LobbyMsg { t: 'lobby'; phase: 'lobby' | 'playing'; host: number; cfg: { nBots: number; bots: { name: string; diff: number }[]; timeLimitMin: number }; players: { id: number; name: string }[]; max: number; }
export interface StartMsg { t: 'start'; seed: number; humans: string[]; bots: { name: string; diff: number }[]; timeLimitMin: number; you: number; }
export interface TurnMsg { t: 'turn'; n: number; cmds: Command[]; }

export class Net {
  ws!: WebSocket;
  myId = -1;
  lobby: LobbyMsg | null = null;
  turns: TurnMsg[] = [];
  onLobby: (m: LobbyMsg) => void = () => {};
  onStart: (m: StartMsg) => void = () => {};
  onDesync: (tick: number) => void = () => {};
  onChat: (from: string, text: string) => void = () => {};
  onClose: (reason: string) => void = () => {};
  closed = false;

  /** adresse saisie → URL WebSocket.
   *  vide + page servie en http(s) : même hôte ; IP / « localhost » / nom sans point : ws://…:8080 ; nom de domaine sans port : wss:// (hébergeur) ; préfixe http(s):// ou ws(s):// respecté. */
  static url(input: string): string {
    const page = /^https?:$/.test(location.protocol);
    const t = input.trim();
    if (!t && page) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    let a = t, secure: boolean | null = null;
    const m = a.match(/^([a-z]+):\/\//i);
    if (m) { secure = /^(https|wss)$/i.test(m[1]); a = a.slice(m[0].length); }
    a = a.replace(/\/.*$/, '') || 'localhost';
    const hasPort = /:\d+$/.test(a), host = a.replace(/:\d+$/, '');
    const local = host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[.*\]$/.test(host) || !host.includes('.');
    if (secure === null) secure = !local && !hasPort;
    if (!hasPort && local) a += ':8080';
    return (secure ? 'wss://' : 'ws://') + a;
  }

  /** Une tentative. Rejette avec fatal=true si le serveur répond « non » (salon plein, partie en cours, mauvais code). */
  private static attempt(url: string, name: string, code: string): Promise<Net> {
    return new Promise((resolve, reject) => {
      const n = new Net();
      let done = false;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch { reject(Object.assign(new Error('Adresse invalide'), { fatal: true })); return; }
      n.ws = ws;
      const fail = (msg: string, fatal = false) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch { /* */ } reject(Object.assign(new Error(msg), { fatal })); };
      const timer = setTimeout(() => fail('Pas de réponse du serveur'), 9000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, code }));
      ws.onerror = () => fail('Connexion impossible');
      ws.onmessage = ev => {
        let m: any; try { m = JSON.parse(ev.data as string); } catch { return; }
        switch (m.t) {
          case 'welcome': n.myId = m.id; if (!done) { done = true; clearTimeout(timer); n.keepAlive(); resolve(n); } break;
          case 'error': if (!done) fail(m.msg, true); else n.onClose(m.msg); break;
          case 'lobby': n.lobby = m; n.onLobby(m); break;
          case 'start': n.turns = []; n.onStart(m); break;
          case 'turn': n.turns.push(m); break;
          case 'desync': n.onDesync(m.tick); break;
          case 'chat': n.onChat(m.from, m.text); break;
        }
      };
      ws.onclose = () => { if (!done) fail('Connexion fermée par le serveur'); else if (!n.closed) { n.closed = true; n.stopKeepAlive(); n.onClose('Connexion au serveur perdue'); } };
    });
  }

  /** Se connecte en réessayant jusqu'à ~90 s : un hébergeur gratuit s'endort sans visite et met environ une minute à se réveiller. */
  static async connect(input: string, name: string, code = '', onStatus: (msg: string) => void = () => {}): Promise<Net> {
    const url = Net.url(input), t0 = Date.now();
    let tries = 0;
    for (;;) {
      try { return await Net.attempt(url, name, code); }
      catch (e: any) {
        if (e.fatal || Date.now() - t0 > 90000) throw new Error(tries ? `${e.message} (serveur injoignable après ${Math.round((Date.now() - t0) / 1000)} s : adresse, serveur lancé, port ouvert ?)` : `${e.message} (adresse, serveur lancé, port ouvert ?)`);
        tries++;
        onStatus(`Le serveur ne répond pas encore (réveil possible, jusqu’à 1 min)… tentative ${tries + 1}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  private ka: number | undefined;
  /** un message applicatif régulier garde un serveur gratuit éveillé pendant que le salon attend */
  private keepAlive() { this.ka = window.setInterval(() => this.send({ t: 'ping' }), 25000); }
  private stopKeepAlive() { clearInterval(this.ka); }
  send(m: unknown) { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  leave() { this.closed = true; this.stopKeepAlive(); try { this.ws.close(); } catch { /* */ } }
}
