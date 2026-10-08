// Tous les réglages d'équilibrage. 1 tick = 0,1 s de jeu (TPS = 10). Les taux ci-dessous sont « par seconde ».
export const TPS = 10;

export const RES_NAMES = ['Bois', 'Fer', 'Charbon', 'Pétrole', 'Eau', 'Terres rares'] as const;
export const RES_ICONS = ['🪵', '⛓️', '⚫', '🛢️', '💧', '💎'] as const;
export const NRES = 6;

// ---------------------------------------------------------------- bâtiments
export const K_UNI = 6, K_BARRACKS = 7, K_PORT = 8, K_FORT = 9, K_MARKET = 10;
export const NKIND = 11;
export interface BuildingDef {
  id: number; name: string; desc: string;
  gold: number; res: number[];        // coût de base (or + 6 ressources)
  color: string;                       // couleur de la plaque
  glyph: string;                       // 'dark' | 'light' : couleur du pictogramme
}
const r = (...a: number[]) => { const o = [0, 0, 0, 0, 0, 0]; a.forEach((v, i) => { o[i] = v; }); return o; };
export const BUILDINGS: BuildingDef[] = [
  { id: 0, name: 'Scierie', desc: 'Produit du bois', gold: 90, res: r(0), color: '#6f9b3a', glyph: 'dark' },
  { id: 1, name: 'Mine de fer', desc: 'Produit du fer', gold: 110, res: r(15), color: '#a9b4c2', glyph: 'dark' },
  { id: 2, name: 'Mine de charbon', desc: 'Produit du charbon', gold: 110, res: r(15), color: '#3a3f47', glyph: 'light' },
  { id: 3, name: 'Puits de pétrole', desc: 'Produit du pétrole', gold: 140, res: r(20, 10), color: '#d99a1e', glyph: 'dark' },
  { id: 4, name: 'Station de pompage', desc: 'Produit de l’eau', gold: 100, res: r(15), color: '#3f9be8', glyph: 'light' },
  { id: 5, name: 'Mine de terres rares', desc: 'Produit des terres rares', gold: 150, res: r(15, 0, 15), color: '#c24fc0', glyph: 'light' },
  { id: 6, name: 'Université', desc: 'Fait monter la jauge de technologie', gold: 220, res: r(20, 0, 0, 0, 10, 12), color: '#f2f2f2', glyph: 'dark' },
  { id: 7, name: 'Caserne', desc: 'Plus de soldats et récupération plus rapide', gold: 150, res: r(0, 20), color: '#c0392b', glyph: 'light' },
  { id: 8, name: 'Port', desc: 'Débarquements par mer, un peu d’or', gold: 140, res: r(20, 0, 0, 10), color: '#2a6f97', glyph: 'light' },
  { id: 9, name: 'Forteresse', desc: 'Défense renforcée autour d’elle', gold: 200, res: r(0, 25, 15), color: '#6b5b4b', glyph: 'light' },
  { id: 10, name: 'Marché', desc: 'Rapporte de l’or', gold: 160, res: r(15, 0, 0, 0, 10), color: '#e0c34a', glyph: 'dark' },
];

// ---------------------------------------------------------------- technologie : jauge -> niveaux automatiques
export interface TechLevel { at: number; name: string; desc: string; gold?: number; regen?: number; def?: number; prod?: number; atk?: number; troops?: number; }
export const TECH_LEVELS: TechLevel[] = [
  { at: 60, name: 'Comptabilité', desc: '+10 % d’or', gold: 0.10 },
  { at: 160, name: 'Hygiène & logistique', desc: '+15 % de récupération des soldats', regen: 0.15 },
  { at: 320, name: 'Génie militaire', desc: '+20 % de défense', def: 0.20 },
  { at: 540, name: 'Mécanisation', desc: '+20 % de production de ressources', prod: 0.20 },
  { at: 820, name: 'Armes modernes', desc: '+15 % d’efficacité d’attaque', atk: 0.15 },
  { at: 1200, name: 'Mondialisation', desc: '+20 % d’or', gold: 0.20 },
  { at: 1700, name: 'Mobilisation', desc: '+25 % de soldats maximum', troops: 0.25 },
  { at: 2300, name: 'Doctrine totale', desc: '+20 % d’attaque et +20 % de défense', atk: 0.20, def: 0.20 },
];
export interface TechBonus { gold: number; regen: number; def: number; prod: number; atk: number; troops: number; }
export const TECH_TABLE: TechBonus[] = [];
{
  const acc: TechBonus = { gold: 0, regen: 0, def: 0, prod: 0, atk: 0, troops: 0 };
  TECH_TABLE.push({ ...acc });
  for (const t of TECH_LEVELS) {
    acc.gold += t.gold ?? 0; acc.regen += t.regen ?? 0; acc.def += t.def ?? 0;
    acc.prod += t.prod ?? 0; acc.atk += t.atk ?? 0; acc.troops += t.troops ?? 0;
    TECH_TABLE.push({ ...acc });
  }
}

// ---------------------------------------------------------------- équilibrage
export const BALANCE = {
  VP_TARGET: 15,                   // 30 PV existent au total sur la carte : 15 = la moitié, cf. README
  TIME_LIMIT: 45 * 60,             // secondes ; à l'échéance, le plus de PV gagne
  // économie
  START_GOLD: 300, START_RES: [40, 20, 20, 10, 20, 10], START_TROOPS: 220, START_RADIUS: 5.5,
  GOLD_PER_CELL: 0.012, MARKET_GOLD: 1.4, PORT_GOLD: 0.7,
  RES_OUT: 0.3, UNI_OUT: 0.5,
  COST_SCALE: 0.12, COST_SCALE2: 0.012,   // coût × (1 + 0,12 n + 0,012 n²) pour le n-ième bâtiment d'un type
  MIN_BUILD_DIST: 3,                // distance minimale entre deux bâtiments (cases)
  SELL_PRICE: 1.0, BUY_PRICE: 3.0,
  DRAFT_GOLD: 3.0,                  // or par soldat mobilisé
  // soldats
  MAXT_BASE: 150, MAXT_PER_CELL: 4, BARRACKS_MAXT: 160,
  REGEN_K: 0.03, REGEN_BASE: 0.5, REGEN_PER_MAX: 0.0015, BARRACKS_REGEN: 0.08,
  // combat
  NEUTRAL_COST: 4.0, SIZE_FRICTION: 0.0003,
  DEF_K: 1.5, LOSS_K: 1.2, MIN_CELLS_DENS: 25,
  ALLY_SUPPORT: 0.15, FORT_RADIUS: 8, FORT_MULT: 1.8,
  ORDER_FRAC: 0.2, ORDER_MAX: 36, MAX_ORDERS: 8, MAX_MASK: 6000, MIN_BUDGET: 10,
  PORT_RANGE: 40, LANDING_COST: 25,
  // alliances
  MAX_ALLIES: 3, ALLY_GOLD: 0.06, ALLY_TECH: 0.10, PROPOSAL_TTL: 60, BETRAY_BAN: 480,
  ALLY_TTL: 360, RENEW_WINDOW: 90,             // une alliance dure 6 min ; renouvelable pendant ses 90 dernières secondes
  // points de victoire
  REGION_MAJORITY: 0.5, TITLE_MARGIN: 1.05, RES_LEAD_MIN: 2,
  TITLE_MIN_CELLS: 400, TITLE_MIN_TROOPS: 1200, TITLE_MIN_INCOME: 8,   // seuils pour qu'un titre ait un sens
};

// ---------------------------------------------------------------- joueurs
export const PLAYER_COLORS = [
  '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
  '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990',
];
export const BOT_NAMES = ['Vauban', 'Colbert', 'Richelieu', 'Turgot', 'Haussmann', 'Eiffel', 'Lumière', 'Pasteur', 'Curie'];
export const BOT_PERSONAS = ['equilibre', 'guerrier', 'marchand', 'techno', 'guerrier', 'equilibre', 'marchand', 'techno', 'equilibre'] as const;
export type Persona = typeof BOT_PERSONAS[number] | 'humain';
export const TITLE_NAMES = ['Plus grand territoire', 'Plus puissante armée', 'Plus gros revenu'] as const;
