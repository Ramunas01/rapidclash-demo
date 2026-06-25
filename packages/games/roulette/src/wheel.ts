// Zeroless 36-pocket roulette wheel — the fairness core (invariant #1).
//
// Pockets 1–36, NO zero, 18 red / 18 black (standard wheel distribution). Removing the green
// zero is what deletes the house edge: for EVERY bet, coverage-fraction × payout-multiple = 1.00
// exactly, so paid odds equal true odds and the expected return per chip is 1.0 for all bet types
// — the contest is one of variance/nerve, never a solved optimum or a house tilt.
//
// The spun pocket derives purely from the match's base seed + round index (no ambient
// randomness), mirroring Mines' layout derivation, so the whole match — including replays and the
// auto-spread timeout path — replays byte-identically from its seed (the contract's determinism).

/** Each player starts every round with this many CHIPS (internal scoring units — NOT credits;
 *  chips never touch the wallet/ledger). The full stack must be allocated before a lock. */
export const CHIP_TOTAL = 1000;

/** Smallest chip increment (owner decision (c)). 1000 / 10 = 100 placeable units. */
export const CHIP_UNIT = 10;

/** Chip-tray denominations offered per bet in `legalMoves` (each filtered to ≤ remaining). The
 *  full remaining is also offered as an "all-in on this bet" amount (lets a bot go all-in in one
 *  move; lets a human max a bet). All are multiples of CHIP_UNIT. */
export const PLACE_DENOMS = [10, 100, 500] as const;

/** Betting window (owner decision (b): ~30 s). Reuses the core's generic per-player move timer
 *  (`meta.moveTimeoutMs` + `timeoutMove`); on expiry the core injects the `spread` auto-move. */
export const BETTING_TIMEOUT_MS = 30_000;

/** Safety cap: this many CONSECUTIVE replays (equal stacks) → void + refund both, no rake. */
export const REPLAY_CAP = 10;

/** Standard red pockets (European wheel distribution). The other 18 of 1–36 are black. */
const RED_POCKETS = new Set<number>([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export const isRed = (pocket: number): boolean => RED_POCKETS.has(pocket);

/** A bet's group, for the UI board layout and grouping. */
export type BetGroup = 'even-money' | 'dozen' | 'column' | 'straight';

/** A v1 bet: an id, a human label, the return multiple paid on a win (stake + winnings), and the
 *  pure predicate deciding whether the spun pocket is covered. `mult` is the TOTAL RETURN multiple
 *  (red = 2× means a winning red bet returns 2× the chips on it; a loss returns 0). */
export interface BetDef {
  id: string;
  label: string;
  group: BetGroup;
  /** Total-return multiple on a win (coverage × mult === 1 for every bet → zero house edge). */
  mult: number;
  covers(pocket: number): boolean;
}

/**
 * The v1 bet set, payouts recomputed for the 36-pocket wheel (they differ from a 37-pocket
 * European wheel). Exotics (splits/corners/streets) are deferred.
 *   even-money (cover 18): Red/Black, Odd/Even, High/Low → 2×
 *   dozen / column (cover 12)                            → 3×
 *   straight-up (cover 1)                                → 36×
 */
export const BETS: BetDef[] = [
  { id: 'red', label: 'Red', group: 'even-money', mult: 2, covers: (p) => isRed(p) },
  { id: 'black', label: 'Black', group: 'even-money', mult: 2, covers: (p) => !isRed(p) },
  { id: 'odd', label: 'Odd', group: 'even-money', mult: 2, covers: (p) => p % 2 === 1 },
  { id: 'even', label: 'Even', group: 'even-money', mult: 2, covers: (p) => p % 2 === 0 },
  { id: 'low', label: '1–18', group: 'even-money', mult: 2, covers: (p) => p <= 18 },
  { id: 'high', label: '19–36', group: 'even-money', mult: 2, covers: (p) => p >= 19 },
  { id: 'd1', label: '1st 12', group: 'dozen', mult: 3, covers: (p) => p >= 1 && p <= 12 },
  { id: 'd2', label: '2nd 12', group: 'dozen', mult: 3, covers: (p) => p >= 13 && p <= 24 },
  { id: 'd3', label: '3rd 12', group: 'dozen', mult: 3, covers: (p) => p >= 25 && p <= 36 },
  { id: 'c1', label: 'Col 1', group: 'column', mult: 3, covers: (p) => p % 3 === 1 },
  { id: 'c2', label: 'Col 2', group: 'column', mult: 3, covers: (p) => p % 3 === 2 },
  { id: 'c3', label: 'Col 3', group: 'column', mult: 3, covers: (p) => p % 3 === 0 },
  // Straight-up: one bet per pocket 1–36.
  ...Array.from({ length: 36 }, (_, i): BetDef => {
    const n = i + 1;
    return { id: `s${n}`, label: String(n), group: 'straight', mult: 36, covers: (p) => p === n };
  }),
];

const BET_BY_ID = new Map(BETS.map((b) => [b.id, b]));

/** Lookup a bet definition by id (undefined for an unknown id — the module rejects those). */
export const betById = (id: string): BetDef | undefined => BET_BY_ID.get(id);

/** The even-money bets the timeout auto-spread distributes the unallocated remainder across. */
export const AUTO_SPREAD_BETS = ['red', 'black'] as const;

// ── Deterministic pocket derivation (seed + round → pocket 1..36) ──────────────────────────────

/** mulberry32 — small, fast, well-distributed 32-bit PRNG (same primitive as Mines' board). */
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

/** Mix the base seed with the round index so each round spins an independent pocket. */
function mixSeed(base: number, round: number): number {
  let h = (base >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (round >>> 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/** The spun pocket (1..36) for a given (base seed, round). Pure + deterministic — both players
 *  share the ONE pocket, and a replay of the same seed reproduces it exactly. */
export function pocketFor(seed: number, round: number): number {
  const rand = mulberry32(mixSeed(seed, round));
  return 1 + Math.floor(rand() * 36); // uniform over 1..36
}

/** Total chip return of an allocation against a pocket: Σ over placed bets of
 *  (covers ? chips × mult : 0). A fully-allocated winning even-money all-in returns 2×1000=2000;
 *  an all-losing allocation returns 0. Unknown bet ids contribute 0 (never happens post-validation). */
export function scoreAllocation(allocation: Record<string, number>, pocket: number): number {
  let total = 0;
  for (const [id, chips] of Object.entries(allocation)) {
    const bet = BET_BY_ID.get(id);
    if (bet && bet.covers(pocket)) total += chips * bet.mult;
  }
  return total;
}
