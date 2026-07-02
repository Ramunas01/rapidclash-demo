import { describe, expect, it } from 'vitest';
import type { Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { coinflipModule, PICK_WINDOW_MS } from './coinflip.js';

const P1 = 'player-1';
const P2 = 'player-2';

/** A provisional pick lands DURING the open window (now < windowEndsAt). */
const at = (playerId: string, now = 0) => ({ playerId, now });

/** Mulberry32 — a copy of the core's seeded RNG, so these tests exercise the
 *  same deterministic behaviour the real match uses. Never Math.random. */
function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next(): number {
      s += 0x6d2b79f5;
      let z = s;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
    },
    int(min, max): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
  };
}

/** Forces the flip: int(0,1) → 0 = 'heads', 1 = 'tails'. Pins the result so the
 *  win/draw resolution can be asserted exactly. */
function fixedRng(intVal: 0 | 1): Rng {
  return { next: () => intVal, int: () => intVal };
}

type Side = 'heads' | 'tails';
type CoinflipView = {
  players: [string, string];
  choices: Partial<Record<string, Side>>;
  locked?: Partial<Record<string, true>>;
  windowEndsAt?: number;
  result?: Side;
  seed?: number;
  round?: number;
  replays?: number;
  winner?: string;
  lastResult?: { round: number; result: Side; choices: Partial<Record<string, Side>>; winner: string | null };
  forcedOutcome?: unknown;
};
function view(state: unknown): CoinflipView {
  return state as CoinflipView;
}

/** init + launch: opens the fixed pick window at now=0 → windowEndsAt = PICK_WINDOW_MS. */
function launched(rng: Rng) {
  return coinflipModule.launch!(coinflipModule.init([P1, P2], rng), 0);
}

/** A provisional (mutable) pick inside the window. */
function pick(state: unknown, p: string, side: Side, now = 0) {
  return coinflipModule.applyMove(state, side, at(p, now));
}

/** The core's deadline lock for one player: inject `timeoutMove` at the window close. Returns the
 *  ApplyResult so callers can read the events (resolve fires on the SECOND lock). */
function lock(state: unknown, p: string, now = PICK_WINDOW_MS) {
  const move = coinflipModule.timeoutMove!(state, p, fixedRng(0));
  return coinflipModule.applyMove(state, move, at(p, now));
}

/** Full round: both pick provisionally inside the window, then both lock at the deadline (the
 *  simultaneous close the core drives via the shared `scheduledDeadlines`). */
function playWindow(rng: Rng, c1: Side, c2: Side) {
  let s: unknown = launched(rng);
  s = pick(s, P1, c1).state;
  s = pick(s, P2, c2).state;
  s = lock(s, P1).state;
  s = lock(s, P2).state;
  return s;
}

// Find two seeds that flip to opposite sides, so seed-driven assertions are concrete.
const HEADS_SEED = (() => {
  for (let s = 0; s < 1000; s++) if (seededRng(s).int(0, 1) === 0) return s;
  throw new Error('no heads seed found');
})();
const TAILS_SEED = (() => {
  for (let s = 0; s < 1000; s++) if (seededRng(s).int(0, 1) === 1) return s;
  throw new Error('no tails seed found');
})();

describe('coinflipModule.meta', () => {
  it('has the exact meta specified in the contract (ranking: net_winnings) — NO moveTimeoutMs', () => {
    expect(coinflipModule.meta).toEqual({
      id: 'coinflip',
      displayName: 'Coinflip',
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'net_winnings' },
      bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      averageDurationSec: 5,
      rakeRate: 0.025,
    });
    // The fixed window is a scheduled deadline, NOT a per-move budget.
    expect(coinflipModule.meta.moveTimeoutMs).toBeUndefined();
  });

  it('opts into the fixed-window hooks (launch + scheduledDeadlines + timeoutMove)', () => {
    expect(typeof coinflipModule.launch).toBe('function');
    expect(typeof coinflipModule.scheduledDeadlines).toBe('function');
    expect(typeof coinflipModule.timeoutMove).toBe('function');
  });
});

describe('coinflipModule.init + launch — the pick window', () => {
  it('starts with empty choices, nothing locked, and no window until launch', () => {
    const s = view(coinflipModule.init([P1, P2], fixedRng(0)));
    expect(s.players).toEqual([P1, P2]);
    expect(s.choices).toEqual({});
    expect(s.locked).toEqual({});
    expect(s.windowEndsAt).toBe(0);
  });

  it('launch stamps an absolute window close = now + PICK_WINDOW_MS', () => {
    const s = view(coinflipModule.launch!(coinflipModule.init([P1, P2], fixedRng(0)), 5_000));
    expect(s.windowEndsAt).toBe(5_000 + PICK_WINDOW_MS);
  });

  it('fixes the flip from the rng (0 → heads, 1 → tails)', () => {
    expect(view(coinflipModule.init([P1, P2], fixedRng(0))).result).toBe('heads');
    expect(view(coinflipModule.init([P1, P2], fixedRng(1))).result).toBe('tails');
  });
});

describe('coinflipModule.legalMoves — both sides stay legal all window', () => {
  it('offers BOTH players heads/tails before they choose', () => {
    const state = launched(fixedRng(0));
    expect(coinflipModule.legalMoves(state, P1)).toEqual(['heads', 'tails']);
    expect(coinflipModule.legalMoves(state, P2)).toEqual(['heads', 'tails']);
  });

  it('STILL offers both sides after a provisional pick (picks are mutable — never [] mid-window)', () => {
    const state = pick(launched(fixedRng(0)), P1, 'heads').state;
    expect(coinflipModule.legalMoves(state, P1)).toEqual(['heads', 'tails']); // P1 may re-pick
    expect(coinflipModule.legalMoves(state, P2)).toEqual(['heads', 'tails']);
  });

  it('offers nothing to a LOCKED player; only the deadline empties legalMoves', () => {
    const state = lock(launched(fixedRng(0)), P1).state; // P1 locked at the window close
    expect(coinflipModule.legalMoves(state, P1)).toEqual([]);
    expect(coinflipModule.legalMoves(state, P2)).toEqual(['heads', 'tails']);
  });
});

describe('coinflipModule.applyMove — mutable picks, no early resolve', () => {
  it('a provisional pick records the choice and emits NO events (no side/timing leak)', () => {
    const { state: next, events } = pick(launched(fixedRng(0)), P1, 'tails');
    expect(view(next).choices[P1]).toBe('tails');
    expect(events).toEqual([]);
    expect(JSON.stringify(events)).not.toContain('tails');
  });

  it('BOTH players change their picks repeatedly before the lock (mutable window)', () => {
    let s: unknown = launched(fixedRng(0));
    s = pick(s, P1, 'heads').state;
    s = pick(s, P1, 'tails').state; // P1 changes their mind
    s = pick(s, P2, 'tails').state;
    s = pick(s, P2, 'heads').state; // P2 changes their mind
    s = pick(s, P1, 'heads').state; // ...and P1 again
    expect(view(s).choices).toEqual({ [P1]: 'heads', [P2]: 'heads' });
    expect(coinflipModule.isTerminal(s)).toBe(false); // never resolves mid-window
    expect(view(s).locked).toEqual({});
  });

  it('does NOT resolve when both pick immediately — the round waits for the window (no early start)', () => {
    let s: unknown = launched(fixedRng(0));
    s = pick(s, P1, 'heads').state;
    s = pick(s, P2, 'tails').state; // different sides, both in the first instant
    expect(coinflipModule.isTerminal(s)).toBe(false); // NOT resolved — only the timer locks
    expect(view(s).locked).toEqual({});
  });

  it('rejects a move from a LOCKED player with IllegalMove', () => {
    const state = lock(launched(fixedRng(0)), P1).state;
    expect(() => coinflipModule.applyMove(state, 'tails', at(P1, PICK_WINDOW_MS))).toThrow(IllegalMove);
  });

  it('rejects an invalid side with IllegalMove', () => {
    expect(() => coinflipModule.applyMove(launched(fixedRng(0)), 'edge', at(P1))).toThrow(IllegalMove);
  });
});

describe('coinflipModule — timer-0 locks both simultaneously', () => {
  it('at the deadline both current picks lock; resolve fires only on the SECOND lock', () => {
    let s: unknown = launched(fixedRng(0)); // result = heads
    s = pick(s, P1, 'heads').state;
    s = pick(s, P2, 'tails').state;

    const l1 = lock(s, P1); // first lock at the window close
    expect(coinflipModule.isTerminal(l1.state)).toBe(false); // P2 not yet locked → no resolve
    expect(view(l1.state).locked).toEqual({ [P1]: true });
    expect(l1.events).toEqual([]); // no reveal yet

    const l2 = lock(l1.state, P2); // second lock → both locked → resolve
    expect(coinflipModule.isTerminal(l2.state)).toBe(true);
    expect(view(l2.state).locked).toEqual({ [P1]: true, [P2]: true });
    expect(l2.events.some((e) => e.type === 'match_decided')).toBe(true);
    expect(coinflipModule.outcome(l2.state)).toEqual({ type: 'win', winner: P1 }); // heads matches
  });

  it('a NO-PICK round still resolves: both auto-pick (seeded) at the deadline', () => {
    let s: unknown = launched(seededRng(TAILS_SEED)); // neither player picks
    // The core injects timeoutMove for each unlocked player at the shared close.
    s = lock(s, P1).state;
    const l2 = lock(s, P2);
    // Either the seeded auto-picks differed → decisive win, or matched → a tie replay (round bumped).
    if (coinflipModule.isTerminal(l2.state)) {
      expect(coinflipModule.outcome(l2.state).type).toBe('win');
    } else {
      expect(view(l2.state).round).toBe(1);
    }
  });

  it('the timeoutMove locks the player\'s PROVISIONAL pick when they chose one', () => {
    const s = pick(launched(fixedRng(0)), P1, 'tails').state;
    expect(coinflipModule.timeoutMove!(s, P1, fixedRng(0))).toBe('tails'); // their own pick, not an auto-pick
  });
});

describe('coinflipModule — tie → instant replay (universal tie rule)', () => {
  it('SAME locked choice is NOT a terminal draw — it re-flips a fresh round + a FRESH window', () => {
    let s: unknown = launched(fixedRng(0));
    s = pick(s, P1, 'heads').state;
    s = pick(s, P2, 'heads').state;
    s = lock(s, P1).state;
    const { state, events } = lock(s, P2); // same side → tie
    expect(coinflipModule.isTerminal(state)).toBe(false);
    expect(view(state).choices).toEqual({});
    expect(view(state).locked).toEqual({});
    expect(view(state).round).toBe(1);
    expect(view(state).replays).toBe(1);
    expect(view(state).windowEndsAt).toBe(PICK_WINDOW_MS + PICK_WINDOW_MS); // re-stamped from now=WINDOW
    expect(events.some((e) => e.type === 'new_round')).toBe(true);
    expect(events.some((e) => e.type === 'match_decided')).toBe(false);
  });

  it('a decisive round after a tie still settles (same escrow)', () => {
    let s: unknown = launched(fixedRng(0));
    s = pick(s, P1, 'heads').state;
    s = pick(s, P2, 'heads').state;
    s = lock(s, P1).state;
    s = lock(s, P2).state; // tie → round 1 with a fresh window
    expect(coinflipModule.isTerminal(s)).toBe(false);
    const round2Ends = view(s).windowEndsAt!;
    s = pick(s, P1, 'heads', round2Ends - 1).state;
    s = pick(s, P2, 'tails', round2Ends - 1).state;
    s = lock(s, P1, round2Ends).state;
    s = lock(s, P2, round2Ends).state; // different sides → decisive
    expect(coinflipModule.isTerminal(s)).toBe(true);
    expect(coinflipModule.outcome(s).type).toBe('win');
  });

  it('10 consecutive same-side rounds → terminal void (refund both, no rake)', () => {
    let s: unknown = launched(fixedRng(0));
    let now = 0;
    for (let i = 0; i < 10; i++) {
      expect(coinflipModule.isTerminal(s)).toBe(false);
      const ends = view(s).windowEndsAt!;
      s = pick(s, P1, 'heads', ends - 1).state;
      s = pick(s, P2, 'heads', ends - 1).state;
      s = lock(s, P1, ends).state;
      s = lock(s, P2, ends).state;
      now = ends;
    }
    void now;
    expect(coinflipModule.isTerminal(s)).toBe(true);
    expect(coinflipModule.outcome(s)).toEqual({ type: 'void' });
    expect(view(s).replays).toBe(10);
  });
});

// The Advisor's money-integrity invariants (#164): the timer is the ONLY resolve trigger, no code
// path compares the two picks before the deadline, and a player's chosen side is never rewritten —
// so money is never settled on a pick a player did not make. The old draw bug was resolve() firing
// on "both chosen" → a silent mid-timer replay → both auto-picked a phantom round → a winner settled
// on unmade picks. These assert that path is gone.
describe('coinflipModule — money integrity (#164)', () => {
  it('both pick the same side mid-window → NOTHING resolves before the deadline (no compare, no replay)', () => {
    const s0 = launched(fixedRng(0));
    const r1 = pick(s0, P1, 'heads', 1_000); // t=1s, well inside the 10s window
    const r2 = pick(r1.state, P2, 'heads', 1_000); // both same side
    expect(r1.events).toEqual([]);
    expect(r2.events).toEqual([]); // no early lock / replay / resolve signal
    const v = view(r2.state);
    expect(coinflipModule.isTerminal(r2.state)).toBe(false);
    expect(v.replays ?? 0).toBe(0); // no phantom replay mid-timer
    expect(v.round).toBe(0);
    expect(v.choices).toEqual({ [P1]: 'heads', [P2]: 'heads' }); // picks intact, unlocked
    expect(v.locked ?? {}).toEqual({});
    expect(v.lastResult).toBeUndefined(); // no round has resolved yet
  });

  it('a same-side round NEVER declares a winner or settles — it always replays, whatever the flip', () => {
    for (const seed of [HEADS_SEED, TAILS_SEED]) {
      const s = playWindow(seededRng(seed), 'heads', 'heads'); // same side, both flip outcomes
      expect(coinflipModule.isTerminal(s)).toBe(false); // never terminal on one same-side round
      expect(view(s).winner).toBeUndefined(); // no winner declared
      expect(view(s).forcedOutcome).toBeUndefined(); // not settled/void (single round)
      expect(view(s).replays).toBe(1); // replayed instead
      expect(view(s).lastResult!.winner).toBeNull(); // recorded as a draw
    }
  });

  it('the deadline auto-pick applies ONLY to a genuinely-absent pick — a chosen side is never rewritten', () => {
    // P1 picks tails and never re-picks; P2 never picks.
    const s = pick(launched(seededRng(HEADS_SEED)), P1, 'tails', 1_000).state;
    expect(coinflipModule.timeoutMove!(s, P1, fixedRng(0))).toBe('tails'); // P1's own side, not an auto-pick
    expect(['heads', 'tails']).toContain(coinflipModule.timeoutMove!(s, P2, fixedRng(0))); // P2 → seeded auto
    // Lock both at the deadline: P1's recorded side is EXACTLY their pick, never rewritten by the
    // auto/replay path — whether the round ends decisively or replays.
    const l2 = lock(lock(s, P1).state, P2);
    const recorded = coinflipModule.isTerminal(l2.state)
      ? view(l2.state).choices
      : view(l2.state).lastResult!.choices;
    expect(recorded[P1]).toBe('tails');
  });
});

// Flip-on-draw (#164): a same-side draw is not terminal, but the coin MUST still flip. The module
// records the just-resolved round in a public `lastResult` so the client can animate reveal → flip
// during the shared draw beat, before the fresh round takes over.
describe('coinflipModule — flip-on-draw', () => {
  it('a same-side draw records lastResult (the flip + both picks, winner=null) and replays', () => {
    const s = playWindow(seededRng(HEADS_SEED), 'heads', 'heads');
    const v = view(s);
    expect(coinflipModule.isTerminal(s)).toBe(false);
    expect(v.lastResult).toBeDefined();
    expect(v.lastResult!.winner).toBeNull(); // draw
    expect(v.lastResult!.choices).toEqual({ [P1]: 'heads', [P2]: 'heads' });
    expect(v.lastResult!.result).toBe('heads'); // HEADS_SEED → the flip that played is heads
    expect(v.round).toBe(1); // fresh round is live
  });

  it('viewFor exposes lastResult (the finished round) but still redacts the FRESH round', () => {
    const drawn = playWindow(seededRng(HEADS_SEED), 'heads', 'heads'); // round 0 draw → round 1 live
    const s = pick(drawn, P2, 'tails', view(drawn).windowEndsAt! - 1).state; // P2 picks in the fresh round
    const asP1 = view(coinflipModule.viewFor(s, P1));
    // The previous round is public + fully revealed…
    expect(asP1.lastResult!.choices).toEqual({ [P1]: 'heads', [P2]: 'heads' });
    expect(asP1.lastResult!.result).toBe('heads');
    // …but the fresh round stays redacted: opponent's new pick, the new flip, and the seed are hidden.
    expect(asP1.choices?.[P2]).toBeUndefined();
    expect(asP1.result).toBeUndefined();
    expect(asP1.seed).toBe(0);
  });

  it('a DECISIVE round also records lastResult with the winner', () => {
    const s = playWindow(seededRng(HEADS_SEED), 'heads', 'tails'); // different sides → decisive
    const v = view(s);
    expect(coinflipModule.isTerminal(s)).toBe(true);
    expect(v.lastResult!.winner).toBe(P1); // heads matches the HEADS_SEED flip → P1
    expect(v.lastResult!.result).toBe('heads');
  });
});

describe('coinflipModule.outcome — the flip decides between different sides', () => {
  it('DIFFERENT choices → the player whose side matches the flip wins', () => {
    expect(coinflipModule.outcome(playWindow(fixedRng(0), 'heads', 'tails'))).toEqual({ type: 'win', winner: P1 });
    expect(coinflipModule.outcome(playWindow(fixedRng(0), 'tails', 'heads'))).toEqual({ type: 'win', winner: P2 });
    expect(coinflipModule.outcome(playWindow(fixedRng(1), 'heads', 'tails'))).toEqual({ type: 'win', winner: P2 });
    expect(coinflipModule.outcome(playWindow(fixedRng(1), 'tails', 'heads'))).toEqual({ type: 'win', winner: P1 });
  });
});

describe('coinflipModule.viewFor — opponent choice, flip, seed, locked, ALL hidden until terminal', () => {
  it('leaks NO opponent choice / result / seed / locked pre-terminal (window still public)', () => {
    const state = pick(launched(seededRng(HEADS_SEED)), P1, 'heads').state; // only P1 picked, not terminal

    const p1View = view(coinflipModule.viewFor(state, P1));
    const p2View = view(coinflipModule.viewFor(state, P2));

    // No flip result pre-terminal.
    expect('result' in p1View).toBe(false);
    expect('result' in p2View).toBe(false);
    // P1 sees their own choice; P2 must NOT see P1's choice.
    expect(p1View.choices[P1]).toBe('heads');
    expect(P1 in p2View.choices).toBe(false);
    expect(JSON.stringify(p2View)).not.toContain('heads');
    // Seed is zeroed on the wire; the `locked` timing map is stripped; the fixed window is public.
    expect(p2View.seed).toBe(0);
    expect('locked' in p2View).toBe(false);
    expect(p2View.windowEndsAt).toBe(PICK_WINDOW_MS);
  });

  it('reveals BOTH choices and the flip to BOTH players at terminal', () => {
    const state = playWindow(fixedRng(0), 'heads', 'tails'); // result heads
    for (const viewer of [P1, P2]) {
      const v = view(coinflipModule.viewFor(state, viewer));
      expect(v.result).toBe('heads');
      expect(v.choices[P1]).toBe('heads');
      expect(v.choices[P2]).toBe('tails');
    }
  });
});

describe('coinflipModule.scheduledDeadlines — the fixed shared window drives the sweep', () => {
  it('both players share the same absolute deadline while unlocked; none before launch', () => {
    expect(coinflipModule.scheduledDeadlines!(coinflipModule.init([P1, P2], fixedRng(0)))).toEqual({});
    const s = launched(fixedRng(0));
    expect(coinflipModule.scheduledDeadlines!(s)).toEqual({ [P1]: PICK_WINDOW_MS, [P2]: PICK_WINDOW_MS });
  });

  it('a locked player drops out of the schedule', () => {
    const s = lock(launched(fixedRng(0)), P1).state;
    expect(coinflipModule.scheduledDeadlines!(s)).toEqual({ [P2]: PICK_WINDOW_MS });
  });
});

describe('coinflipModule.forfeit', () => {
  it('voids when abandoned before a round resolves (both refunded), never a draw', () => {
    const fresh = launched(fixedRng(0));
    expect(coinflipModule.outcome(coinflipModule.forfeit(fresh, P1))).toEqual({ type: 'void' });

    const mid = pick(launched(fixedRng(0)), P1, 'heads').state;
    expect(coinflipModule.outcome(coinflipModule.forfeit(mid, P2))).toEqual({ type: 'void' });
  });
});

describe('coinflipModule — deterministic auto-pick + replay', () => {
  it('timeoutMove returns a currently-legal side for a no-pick player, ignoring the injected rng', () => {
    const state = launched(seededRng(HEADS_SEED));
    const m0 = coinflipModule.timeoutMove!(state, P1, fixedRng(0));
    const m1 = coinflipModule.timeoutMove!(state, P1, fixedRng(1));
    expect(coinflipModule.legalMoves(state, P1)).toContain(m0);
    expect(m0).toBe(m1); // deterministic (fixed at init, not from the injected rng)
  });

  it('timeoutMove throws once a player is locked (nothing left to lock)', () => {
    const state = lock(launched(fixedRng(0)), P1).state;
    expect(() => coinflipModule.timeoutMove!(state, P1, fixedRng(0))).toThrow(IllegalMove);
  });

  it('same seed + same choices replays to byte-identical final state and outcome', () => {
    const combos: Array<[Side, Side]> = [
      ['heads', 'heads'],
      ['heads', 'tails'],
      ['tails', 'heads'],
      ['tails', 'tails'],
    ];
    for (const seed of [HEADS_SEED, TAILS_SEED]) {
      for (const [c1, c2] of combos) {
        const a = playWindow(seededRng(seed), c1, c2);
        const b = playWindow(seededRng(seed), c1, c2);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(coinflipModule.outcome(a)).toEqual(coinflipModule.outcome(b));
      }
    }
  });

  it('same seed → same flip, INDEPENDENT of the choices', () => {
    const a = view(playWindow(seededRng(HEADS_SEED), 'heads', 'tails')).result;
    const b = view(playWindow(seededRng(HEADS_SEED), 'tails', 'heads')).result;
    expect(a).toBe(b);
  });
});
