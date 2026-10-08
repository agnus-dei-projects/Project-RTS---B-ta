import grid from './griddata.json';

function b64(s: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) lut[chars.charCodeAt(i)] = i;
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let o = 0, buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | lut[clean.charCodeAt(i)]; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
  }
  return out;
}

export const W: number = grid.w;
export const H: number = grid.h;
export const NCELL = W * H;
export const CELL_KM: number = grid.cell;
export const DEPT_NAMES: string[] = grid.deptNames;
export const REGION_NAMES: string[] = grid.regionNames;
export const NR = REGION_NAMES.length;

/** 0 = mer, 1 = France, 2 = terre étrangère (infranchissable) */
export const TERRAIN = b64(grid.terrain);
/** département + 1 (0 = aucun) */
export const DEPT = b64(grid.dept);
/** région de chaque case (255 hors France) */
export const REGION = new Uint8Array(NCELL).fill(255);
export const REGION_SIZE = new Int32Array(NR);
export const LAND: number[] = [];
for (let c = 0; c < NCELL; c++) {
  if (TERRAIN[c] === 1) {
    REGION[c] = grid.deptRegion[DEPT[c] - 1];
    REGION_SIZE[REGION[c]]++;
    LAND.push(c);
  }
}
export const LAND_COUNT = LAND.length;

export const isLand = (c: number) => TERRAIN[c] === 1;
export const cx = (c: number) => c % W;
export const cy = (c: number) => (c / W) | 0;

/** les 4 voisins d'une case (la grille a une marge de mer : pas de débordement pour les cases de terre) */
export function neighbors4(c: number, out: number[]): number {
  out[0] = c - 1; out[1] = c + 1; out[2] = c - W; out[3] = c + W;
  return 4;
}

/** case de terre française touchant la mer (4-voisinage) */
export const COASTAL = new Uint8Array(NCELL);
for (const c of LAND) {
  if (TERRAIN[c - 1] === 0 || TERRAIN[c + 1] === 0 || TERRAIN[c - W] === 0 || TERRAIN[c + W] === 0) COASTAL[c] = 1;
}

/** composante « continent » (pour choisir les départs hors îles) */
export const MAINLAND = new Uint8Array(NCELL);
{
  // on part de la case de terre la plus proche du centre de la grille
  let best = LAND[0], bd = 1e18;
  for (const c of LAND) { const d = (cx(c) - W / 2) ** 2 + (cy(c) - H / 2) ** 2; if (d < bd) { bd = d; best = c; } }
  const stack = [best]; MAINLAND[best] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    for (const n of [c - 1, c + 1, c - W, c + W]) if (TERRAIN[n] === 1 && !MAINLAND[n]) { MAINLAND[n] = 1; stack.push(n); }
  }
}
export const dist2 = (a: number, b: number) => (cx(a) - cx(b)) ** 2 + (cy(a) - cy(b)) ** 2;
