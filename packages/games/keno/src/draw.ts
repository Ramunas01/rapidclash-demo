// Keno — deterministic shared draw + per-player auto-fill (the fairness core).
//
// One seeded draw of DRAW_COUNT numbers falls against both players' PICK_COUNT picks; whoever
// matched more wins. No paytable (the house's edge) — matches are compared head-to-head. The draw
// and any timeout auto-fills are pure functions of (seed, round) so the whole match — including
// replays — reproduces byte-identically from its seed (the contract's determinism).

/** Number pool: 1..40. */
export const POOL_SIZE = 40;
/** Spots each player picks. */
export const PICK_COUNT = 8;
/** Numbers in the shared draw. (8 picks vs a 10-of-40 draw ≈ 2 expected matches.) */
export const DRAW_COUNT = 10;
/** Pick window (ms) — reuses the core's generic per-player move timer; on expiry the core injects
 *  the `autofill` move (fill to PICK_COUNT from the seed + lock). */
export const PICK_TIMEOUT_MS = 20_000;
/** Safety cap: this many CONSECUTIVE replays (equal matches) → void + refund both, no rake. */
export const REPLAY_CAP = 10;

/** mulberry32 — small, fast, well-distributed 32-bit PRNG (same primitive as Mines/Roulette). */
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

/** Mix a base seed with two integers (round + a salt) into one independent 32-bit seed, so the
 *  shared draw and each player's auto-fill are uncorrelated streams off the same base seed. */
function mix(base: number, a: number, b: number): number {
  let h = (base >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (a >>> 0), 0x85ebca6b);
  h = Math.imul(h ^ (b >>> 0), 0xc2b2ae35);
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

const DRAW_SALT = 1;
const FILL_SALT_BASE = 100; // + player index

/** A seeded permutation of 1..POOL_SIZE for the given (round, salt). Fisher–Yates, deterministic. */
function shuffledPool(seed: number, round: number, salt: number): number[] {
  const idx = Array.from({ length: POOL_SIZE }, (_, i) => i + 1);
  const rand = mulberry32(mix(seed, round, salt));
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }
  return idx;
}

/** The shared winning draw: DRAW_COUNT distinct numbers (sorted) for this (seed, round). Pure. */
export function drawFor(seed: number, round: number): number[] {
  return shuffledPool(seed, round, DRAW_SALT).slice(0, DRAW_COUNT).sort((a, b) => a - b);
}

/** Fill a player's picks up to PICK_COUNT with provably-fair numbers (their own seeded stream),
 *  skipping any they already chose. Pure function of (seed, round, playerIndex, existing) →
 *  deterministic across replays. Returns the completed, sorted pick list. */
export function autofillPicks(seed: number, round: number, playerIndex: number, existing: number[]): number[] {
  const have = new Set(existing);
  const out = [...existing];
  const pool = shuffledPool(seed, round, FILL_SALT_BASE + playerIndex);
  for (const n of pool) {
    if (out.length >= PICK_COUNT) break;
    if (!have.has(n)) {
      have.add(n);
      out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
}

/** How many of `picks` appear in `draw`. */
export function countMatches(picks: number[], draw: number[]): number {
  const drawn = new Set(draw);
  let n = 0;
  for (const p of picks) if (drawn.has(p)) n++;
  return n;
}
