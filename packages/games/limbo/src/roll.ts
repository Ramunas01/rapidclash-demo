// Limbo — deterministic zero-edge roll + target ladder (the fairness core).
//
// Both players secretly pick a target multiplier; one shared seeded roll `R = 1/u` (u uniform on
// (0,1)) falls. With that distribution the survival probability of a target `t` is EXACTLY `1/t`
// — no house margin — so the "odds" are true and the contest is purely between the two targets.
// `R` and any timeout auto-targets are pure functions of the seed → exact replays.

/** Lowest selectable target (survival 1/1.10 ≈ 91%). */
export const MIN_TARGET = 1.1;
/** Highest selectable target (format/safety cap; survival 1/1e6). */
export const MAX_TARGET = 1_000_000;
/** Pick window (ms) — reuses the core's generic per-player move timer; on expiry the core injects
 *  the `auto` move (auto-assign a seeded target + lock). */
export const PICK_TIMEOUT_MS = 10_000;
/** Safety cap: this many CONSECUTIVE replays (push) → void + refund both, no rake. */
export const REPLAY_CAP = 10;

/** The selectable target ladder (log-spaced, MIN_TARGET … MAX_TARGET). Quantised so a target is an
 *  enumerable move (the core validates moves against `legalMoves` by JSON-equality). The implied
 *  survival chance of each is 1/target. */
export const TARGET_LADDER = [
  1.1, 1.25, 1.5, 2, 3, 5, 10, 25, 50, 100, 1000, 10_000, 100_000, 1_000_000,
];

const LADDER_SET = new Set(TARGET_LADDER);
export const isLadderTarget = (t: unknown): t is number => typeof t === 'number' && LADDER_SET.has(t);

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

const ROLL_SALT = 1;
const AUTO_SALT_BASE = 100; // + player index

/** The shared zero-edge roll `R = 1/u` for this (seed, round). `u` is clamped just inside (0,1) so
 *  R is finite and always > 1 (a 1.10× target can still bust when R < 1.10). Rounded to 2 dp for a
 *  clean multiplier display while staying deterministic. Pure. */
export function rollFor(seed: number, round: number): number {
  const raw = mulberry32(mix(seed, round, ROLL_SALT))();
  const u = Math.min(1 - 1e-9, Math.max(1e-9, raw));
  return Math.round((1 / u) * 100) / 100;
}

/** A deterministic auto-assigned target (a ladder value) for a timed-out player. Pure function of
 *  (seed, round, playerIndex) — different players draw different targets, replays reproduce them. */
export function autoTargetFor(seed: number, round: number, playerIndex: number): number {
  const idx = mix(seed, round, AUTO_SALT_BASE + playerIndex) % TARGET_LADDER.length;
  return TARGET_LADDER[idx];
}

/** Resolve a roll against two targets per the spec:
 *   - equal targets → push (null);
 *   - R ≥ both → the HIGHER target wins (bravery rewarded);
 *   - R between → the LOWER (surviving) target wins;
 *   - R < both → push (both bust).
 *  Returns the winning value ('hi' | 'lo' | 'push') relative to the two targets. */
export function decideRoll(roll: number, tA: number, tB: number): 'a' | 'b' | 'push' {
  if (tA === tB) return 'push';
  const hi = Math.max(tA, tB);
  const lo = Math.min(tA, tB);
  if (roll < lo) return 'push'; // both bust
  // The survivor: if R ≥ hi both cleared → higher wins; else only the lower cleared.
  const winnerTarget = roll >= hi ? hi : lo;
  return winnerTarget === tA ? 'a' : 'b';
}
