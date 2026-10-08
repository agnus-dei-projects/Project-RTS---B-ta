import type { Persona } from './config';

export interface Player {
  id: number; name: string; color: string; isBot: boolean; persona: Persona;
  alive: boolean;
  gold: number; res: number[]; troops: number; cells: number;
  techGauge: number; techLevel: number;
  allies: number[];
  regionClaimed: boolean[];
  vpRegion: number; vpTech: number;
  goldRate: number;                  // or / s (mis à jour chaque seconde)
  betrayedUntil: number;             // tick jusqu'auquel les bots refusent ses alliances
  lastBreak: number;                 // tick de la dernière rupture d'alliance (bots)
  diff: number;                      // difficulté des bots : 0 facile, 1 normal, 2 difficile
}
export interface Building { id: number; kind: number; cell: number; owner: number; }
export interface Order {
  id: number; p: number; budget: number; initial: number;
  mask: Set<number>; queue: number[]; qh: number; queued: Set<number>;
  captured: number; stall: number; landing: number;     // case de débarquement (-1 si aucune)
  born: number;
}
export interface Alliance { a: number; b: number; until: number; }
export interface Proposal { from: number; to: number; t: number; }
export interface GameEvent { t: number; text: string; p: number; }
export interface State {
  tick: number; seed: number; rng: number;
  players: Player[];
  owner: Int8Array;                  // par case : -1 = neutre (ou hors France)
  bld: Int16Array;                   // par case : index du bâtiment, -1 si rien
  buildings: Building[];
  orders: Order[]; nextOrder: number;
  regCount: Int32Array;              // [joueur * NR + région] = nombre de cases
  resHolder: number[];               // détenteur du PV de chaque ressource
  titles: number[];                  // détenteurs des 3 titres (territoire, armée, revenu)
  techFirst: number[];               // 1er joueur à chaque niveau
  alliances: Alliance[];
  proposals: Proposal[];
  events: GameEvent[];
  timeLimit: number;                 // durée maximale en ticks (0 = illimitée)
  winner: number; over: boolean;
  version: number;                   // incrémenté à chaque changement de propriétaire (pour le rendu)
}

export type Command =
  | { type: 'attack'; p: number; cells: number[]; pct: number }
  | { type: 'recall'; p: number; order: number }
  | { type: 'build'; p: number; kind: number; cell: number }
  | { type: 'trade'; p: number; side: 'sell' | 'buy'; res: number; qty: number }
  | { type: 'draft'; p: number; qty: number }
  | { type: 'propose'; p: number; to: number }
  | { type: 'accept'; p: number; from: number }
  | { type: 'refuse'; p: number; from: number }
  | { type: 'break'; p: number; with: number }
  | { type: 'autopilot'; p: number };   // un humain déconnecté est repris par une IA
