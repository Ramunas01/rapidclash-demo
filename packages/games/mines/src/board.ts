// Deterministic Mines board derivation.
//
// A round's mine layout is derived purely from the match's base seed + the round
// index — no ambient randomness — so the whole match (including draw replays) replays
// byte-identically from its seed, the property the contract requires. The layout is
// NOT stored in state: any method re-derives it on demand via `minesFor`, so a redacted
// `viewFor` can never leak mine positions to a player who hasn't earned them.
//
// Both players play the SAME layout (an identical board each) — `minesFor` deliberately
// does NOT depend on the player, so the contest is a pure, equal-chance race.
//
// (v1 ships on this seeded RNG. The spec's commit-reveal — publish a board-seed hash
// before the deal, reveal the seed after — is the roadmap "provably fair by design"
// direction layered on top of this same deterministic shuffle; not built here.)

/** 8×8 grid. */
export const BOARD_SIZE = 64;
/** Mines randomly placed among the 64 squares. */
export const MINE_COUNT = 16;
/** Safe squares a player must uncover for a perfect (max-score) clear. */
export const SAFE_COUNT = BOARD_SIZE - MINE_COUNT; // 48
/** Per-player move timeout (ms) — see minesModule.moveTimeoutMs. */
export const MOVE_TIMEOUT_MS = 5000;

/** mulberry32 — a small, fast, well-distributed 32-bit PRNG. Deterministic per seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix the base seed with the round index into one 32-bit seed (each round → a new layout). */
function mixSeed(base: number, round: number): number {
  let h = (base >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (round >>> 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/**
 * The set of mined square indices (0..63) for a given (base seed, round). Identical for
 * both players. Derived by a Fisher–Yates shuffle of all 64 indices, taking the first
 * MINE_COUNT — uniform over all layouts and fully deterministic.
 */
export function minesFor(seed: number, round: number): Set<number> {
  const idx = Array.from({ length: BOARD_SIZE }, (_, i) => i);
  const rand = mulberry32(mixSeed(seed, round));
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }
  return new Set(idx.slice(0, MINE_COUNT));
}
