// Hilo — deterministic shared card sequence (the fairness core).
//
// One seeded sequence is dealt IDENTICALLY to both players (like Mines' identical boards); each
// runs it independently, seeing only their own progress. Cards are position-indexed pure functions
// of (seed, round) — so the sequence, and therefore replays, reproduce byte-identically. Drawn with
// replacement (a tie in rank is possible and counts as correct), which keeps each call independent.

/** Ranks 2..14 (J=11, Q=12, K=13, A=14 high). */
export const MIN_RANK = 2;
export const MAX_RANK = 14;
const SUITS = ['♠', '♥', '♦', '♣'];

/** Sequence length — long enough that the 30 s cap, not exhaustion, is the usual terminator. */
export const SEQ_LEN = 64;
/** Shared match clock (ms): an anti-stall cap. At 0 the round ends; every un-busted streak freezes.
 *  Reuses the core's generic scheduled-deadline timer (launch + scheduledDeadlines + timeoutMove). */
export const MATCH_CAP_MS = 30_000;
/** Safety cap: this many CONSECUTIVE replays (equal streaks) → void + refund both, no rake. */
export const REPLAY_CAP = 10;

export interface Card {
  rank: number; // 2..14
  suit: string; // cosmetic
}

/** mulberry32 — small, fast, well-distributed 32-bit PRNG (same primitive as the other modules). */
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
function mix(base: number, a: number, b: number): number {
  let h = (base >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (a >>> 0), 0x85ebca6b);
  h = Math.imul(h ^ (b >>> 0), 0xc2b2ae35);
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/** The card at a given (seed, round, position). Pure + deterministic; identical for both players. */
export function cardFor(seed: number, round: number, position: number): Card {
  const r = mulberry32(mix(seed, round, position));
  const rank = MIN_RANK + Math.floor(r() * (MAX_RANK - MIN_RANK + 1)); // 2..14
  const suit = SUITS[Math.floor(r() * SUITS.length)];
  return { rank, suit };
}

/** Was the call correct? A higher/lower call is correct when the next rank goes that way; an EQUAL
 *  rank counts as correct regardless of the call (a tie never busts you). */
export function callCorrect(call: 'hi' | 'lo', current: Card, next: Card): boolean {
  if (next.rank === current.rank) return true;
  return call === 'hi' ? next.rank > current.rank : next.rank < current.rank;
}
