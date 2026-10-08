// Pictogrammes 7x7 des bâtiments ('#' = trait, '.' = vide). Le fond de la plaque porte la couleur de la ressource.
export const GLYPHS: string[][] = [
  // 0 scierie : arbre
  ['...#...', '..###..', '.#####.', '..###..', '.#####.', '...#...', '...#...'],
  // 1 mine de fer : pioche
  ['.#####.', '#..#..#', '...#...', '...#...', '...#...', '...#...', '...#...'],
  // 2 charbon : blocs
  ['.......', '..##...', '.####.#', '######.', '#######', '.......', '.......'],
  // 3 pétrole : derrick
  ['...#...', '..###..', '...#...', '..###..', '.#.#.#.', '#..#..#', '#######'],
  // 4 eau : goutte
  ['...#...', '..###..', '.#####.', '#######', '#######', '.#####.', '..###..'],
  // 5 terres rares : diamant
  ['..###..', '.#####.', '#######', '.#####.', '..###..', '...#...', '.......'],
  // 6 université : toit + colonnes
  ['...#...', '..###..', '.#####.', '#######', '.#.#.#.', '.#.#.#.', '#######'],
  // 7 caserne : créneaux
  ['#.#.#.#', '#######', '.#####.', '.#.#.#.', '.#.#.#.', '.#####.', '.......'],
  // 8 port : ancre
  ['...#...', '..###..', '...#...', '#..#..#', '#..#..#', '.#####.', '..###..'],
  // 9 forteresse : tour
  ['##.#.##', '#######', '.#####.', '.#####.', '.##.##.', '.##.##.', '#######'],
  // 10 marché : pièce
  ['.#####.', '#..#..#', '#.###.#', '#..#..#', '#.###.#', '#..#..#', '.#####.'],
];

import { BUILDINGS } from '../core/config';

/** dessine un bâtiment : plaque colorée + bordure à la couleur du joueur + pictogramme. (x, y) = coin haut-gauche. */
export function drawBuilding(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, u: number, owner: string, alpha = 1) {
  const def = BUILDINGS[kind], g = GLYPHS[kind];
  const b = Math.max(1, Math.round(u)), size = 7 * u + 2 * b;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = '#0b0f14'; ctx.fillRect(x - 1, y - 1, size + 2, size + 2);
  ctx.fillStyle = owner; ctx.fillRect(x, y, size, size);
  ctx.fillStyle = def.color; ctx.fillRect(x + b, y + b, 7 * u, 7 * u);
  ctx.fillStyle = def.glyph === 'dark' ? '#101418' : '#f4f6f8';
  for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) if (g[j][i] === '#') ctx.fillRect(x + b + i * u, y + b + j * u, u, u);
  ctx.restore();
  return size;
}
