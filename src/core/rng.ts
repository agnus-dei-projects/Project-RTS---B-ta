// PRNG déterministe : l'état est un simple entier (State.rng), donc la partie est rejouable.
export function nextRand(state: { rng: number }): number {
  const a = (state.rng + 0x6d2b79f5) | 0;
  state.rng = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
