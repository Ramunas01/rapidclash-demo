import { describe, expect, it } from 'vitest';
import type { Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { rpsModule, PICK_WINDOW_MS } from './rps.js';

const P1 = 'player-1';
const P2 = 'player-2';

/** Mulberry32 — a copy of the core's seeded RNG (the seeded auto-throw depends on it). */
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

const rng: Rng = seededRng(1234);

/** A provisional pick lands DURING the open window (now < windowEndsAt). */
const at = (playerId: string, now = 0) => ({ playerId, now });

type RpsView = {
  players: [string, string];
  choices: Record<string, unknown>;
  locked?: Record<string, unknown>;
  windowEndsAt?: number;
  seed?: number;
  round?: number;
  replays?: number;
};
function view(state: unknown): RpsView {
  return state as RpsView;
}

/** init + launch: opens the fixed pick window at now=0 → windowEndsAt = PICK_WINDOW_MS. */
function launched(r: Rng = rng) {
  return rpsModule.launch!(rpsModule.init([P1, P2], r), 0);
}

/** A provisional (mutable) throw inside the window. */
function pick(state: unknown, p: string, choice: string, now = 0) {
  return rpsModule.applyMove(state, choice, at(p, now));
}

/** The core's deadline lock for one player: inject `timeoutMove` at the window close. */
function lock(state: unknown, p: string, now = PICK_WINDOW_MS) {
  const move = rpsModule.timeoutMove!(state, p, rng);
  return rpsModule.applyMove(state, move, at(p, now));
}

/** Full round: both throw provisionally, then both lock at the deadline. Uses a FRESH
 *  identically-seeded rng per call (not the shared, stateful module `rng`) so two `playWindow`
 *  runs start from the same `seed` — the precondition the determinism (S9) test asserts on. */
function playWindow(c1: string, c2: string, r: Rng = seededRng(1234)) {
  let s: unknown = launched(r);
  s = pick(s, P1, c1).state;
  s = pick(s, P2, c2).state;
  s = lock(s, P1).state;
  s = lock(s, P2).state;
  return s;
}

describe('rpsModule.meta', () => {
  it('has the exact meta specified in the contract — NO moveTimeoutMs', () => {
    expect(rpsModule.meta).toEqual({
      id: 'rps',
      displayName: 'Rock Paper Scissors',
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'win_rate' },
      bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      averageDurationSec: 10,
      rakeRate: 0.025,
    });
    expect(rpsModule.meta.moveTimeoutMs).toBeUndefined();
  });

  it('opts into the fixed-window hooks (launch + scheduledDeadlines + timeoutMove)', () => {
    expect(typeof rpsModule.launch).toBe('function');
    expect(typeof rpsModule.scheduledDeadlines).toBe('function');
    expect(typeof rpsModule.timeoutMove).toBe('function');
  });
});

describe('rpsModule.init + launch', () => {
  it('starts empty with no window until launch', () => {
    const s = view(rpsModule.init([P1, P2], rng));
    expect(s.choices).toEqual({});
    expect(s.locked).toEqual({});
    expect(s.windowEndsAt).toBe(0);
  });

  it('launch stamps an absolute window close = now + PICK_WINDOW_MS', () => {
    expect(view(rpsModule.launch!(rpsModule.init([P1, P2], rng), 5_000)).windowEndsAt).toBe(5_000 + PICK_WINDOW_MS);
  });
});

describe('rpsModule.legalMoves — all three stay legal all window', () => {
  it('returns all three for a player who has not chosen', () => {
    const state = launched();
    expect(rpsModule.legalMoves(state, P1)).toEqual(['rock', 'paper', 'scissors']);
    expect(rpsModule.legalMoves(state, P2)).toEqual(['rock', 'paper', 'scissors']);
  });

  it('STILL returns all three after a provisional throw (mutable — never [] mid-window)', () => {
    const state = pick(launched(), P1, 'rock').state;
    expect(rpsModule.legalMoves(state, P1)).toEqual(['rock', 'paper', 'scissors']);
  });

  it('returns [] only for a LOCKED player', () => {
    const state = lock(launched(), P1).state;
    expect(rpsModule.legalMoves(state, P1)).toEqual([]);
    expect(rpsModule.legalMoves(state, P2)).toEqual(['rock', 'paper', 'scissors']);
  });
});

describe('rpsModule.applyMove — mutable throws, no early resolve', () => {
  it('a provisional throw records the choice and emits NO events (no leak)', () => {
    const { state, events } = pick(launched(), P1, 'rock');
    expect(view(state).choices[P1]).toBe('rock');
    expect(events).toEqual([]);
    expect(JSON.stringify(events)).not.toContain('rock');
  });

  it('both players change throws repeatedly before the lock', () => {
    let s: unknown = launched();
    s = pick(s, P1, 'rock').state;
    s = pick(s, P1, 'paper').state;
    s = pick(s, P2, 'scissors').state;
    s = pick(s, P2, 'rock').state;
    expect(view(s).choices).toEqual({ [P1]: 'paper', [P2]: 'rock' });
    expect(rpsModule.isTerminal(s)).toBe(false);
  });

  it('does NOT resolve when both throw immediately (no early start)', () => {
    let s: unknown = launched();
    s = pick(s, P1, 'rock').state;
    s = pick(s, P2, 'scissors').state; // decisive throws, but the window has not closed
    expect(rpsModule.isTerminal(s)).toBe(false);
  });

  it('throws IllegalMove when a LOCKED player tries to move', () => {
    const state = lock(launched(), P1).state;
    expect(() => rpsModule.applyMove(state, 'paper', at(P1, PICK_WINDOW_MS))).toThrow(IllegalMove);
  });

  it('throws IllegalMove for an unrecognised throw', () => {
    expect(() => rpsModule.applyMove(launched(), 'dynamite', at(P1))).toThrow(IllegalMove);
  });
});

describe('rpsModule — timer-0 locks both simultaneously', () => {
  it('at the deadline both throws lock; resolve fires only on the SECOND lock', () => {
    let s: unknown = launched();
    s = pick(s, P1, 'rock').state;
    s = pick(s, P2, 'scissors').state;

    const l1 = lock(s, P1);
    expect(rpsModule.isTerminal(l1.state)).toBe(false);
    expect(l1.events).toEqual([]);

    const l2 = lock(l1.state, P2);
    expect(rpsModule.isTerminal(l2.state)).toBe(true);
    expect(rpsModule.outcome(l2.state)).toEqual({ type: 'win', winner: P1 }); // rock beats scissors
  });

  it('a NO-PICK round still resolves via seeded auto-throws', () => {
    let s: unknown = launched();
    s = lock(s, P1).state;
    const l2 = lock(s, P2);
    if (rpsModule.isTerminal(l2.state)) {
      expect(rpsModule.outcome(l2.state).type).toBe('win');
    } else {
      expect(view(l2.state).round).toBe(1); // auto-throws tied → replay
    }
  });

  it('timeoutMove locks the player\'s PROVISIONAL throw when they chose one', () => {
    const s = pick(launched(), P1, 'paper').state;
    expect(rpsModule.timeoutMove!(s, P1, rng)).toBe('paper');
  });
});

describe('rpsModule.outcome — win resolution', () => {
  it('resolves the standard cycle when both lock decisively', () => {
    expect(rpsModule.outcome(playWindow('rock', 'scissors'))).toEqual({ type: 'win', winner: P1 });
    expect(rpsModule.outcome(playWindow('scissors', 'paper'))).toEqual({ type: 'win', winner: P1 });
    expect(rpsModule.outcome(playWindow('paper', 'rock'))).toEqual({ type: 'win', winner: P1 });
    expect(rpsModule.outcome(playWindow('scissors', 'rock'))).toEqual({ type: 'win', winner: P2 });
    expect(rpsModule.outcome(playWindow('paper', 'scissors'))).toEqual({ type: 'win', winner: P2 });
    expect(rpsModule.outcome(playWindow('rock', 'paper'))).toEqual({ type: 'win', winner: P2 });
  });
});

describe('rpsModule — tie → instant replay (universal tie rule)', () => {
  function playTie(choice: string) {
    let s: unknown = launched();
    s = pick(s, P1, choice).state;
    s = pick(s, P2, choice).state;
    s = lock(s, P1).state;
    return lock(s, P2);
  }

  it('a same throw is NOT terminal — re-deals a fresh round + a fresh window', () => {
    for (const c of ['rock', 'paper', 'scissors']) {
      const { state, events } = playTie(c);
      expect(rpsModule.isTerminal(state)).toBe(false);
      expect(view(state).choices).toEqual({});
      expect(view(state).locked).toEqual({});
      expect(view(state).round).toBe(1);
      expect(view(state).replays).toBe(1);
      expect(view(state).windowEndsAt).toBe(2 * PICK_WINDOW_MS);
      expect(events.some((e) => e.type === 'new_round')).toBe(true);
      expect(events.some((e) => e.type === 'match_decided')).toBe(false);
    }
  });

  it('a decisive throw after a tie still settles (same escrow)', () => {
    let s: unknown = playTie('rock').state; // round 1, window re-stamped to 2*W
    const ends = view(s).windowEndsAt!;
    s = pick(s, P1, 'rock', ends - 1).state;
    s = pick(s, P2, 'scissors', ends - 1).state;
    s = lock(s, P1, ends).state;
    s = lock(s, P2, ends).state;
    expect(rpsModule.isTerminal(s)).toBe(true);
    expect(rpsModule.outcome(s)).toEqual({ type: 'win', winner: P1 });
  });

  it('10 consecutive ties → terminal void', () => {
    let s: unknown = launched();
    for (let i = 0; i < 10; i++) {
      expect(rpsModule.isTerminal(s)).toBe(false);
      const ends = view(s).windowEndsAt!;
      s = pick(s, P1, 'rock', ends - 1).state;
      s = pick(s, P2, 'rock', ends - 1).state;
      s = lock(s, P1, ends).state;
      s = lock(s, P2, ends).state;
    }
    expect(rpsModule.isTerminal(s)).toBe(true);
    expect(rpsModule.outcome(s)).toEqual({ type: 'void' });
    expect(view(s).replays).toBe(10);
  });
});

describe('rpsModule.viewFor — opponent throw + seed + locked hidden until terminal', () => {
  it("does not expose P1's throw / seed / locked to P2 before terminal (window public)", () => {
    const state = pick(launched(), P1, 'rock').state;
    const p2View = view(rpsModule.viewFor(state, P2));
    expect(P1 in p2View.choices).toBe(false);
    expect(JSON.stringify(p2View)).not.toContain('rock');
    expect(p2View.seed).toBe(0);
    expect('locked' in p2View).toBe(false);
    expect(p2View.windowEndsAt).toBe(PICK_WINDOW_MS);
  });

  it("shows P1's own throw in P1's view before terminal", () => {
    const state = pick(launched(), P1, 'rock').state;
    const p1View = view(rpsModule.viewFor(state, P1));
    expect(p1View.choices[P1]).toBe('rock');
    expect(P2 in p1View.choices).toBe(false);
  });

  it('reveals both throws to both players at terminal', () => {
    const state = playWindow('rock', 'scissors');
    const p2View = view(rpsModule.viewFor(state, P2));
    expect(p2View.choices[P1]).toBe('rock');
    expect(p2View.choices[P2]).toBe('scissors');
  });
});

describe('rpsModule.scheduledDeadlines', () => {
  it('both share the same deadline while unlocked; none before launch; locked drops out', () => {
    expect(rpsModule.scheduledDeadlines!(rpsModule.init([P1, P2], rng))).toEqual({});
    const s = launched();
    expect(rpsModule.scheduledDeadlines!(s)).toEqual({ [P1]: PICK_WINDOW_MS, [P2]: PICK_WINDOW_MS });
    const locked = lock(s, P1).state;
    expect(rpsModule.scheduledDeadlines!(locked)).toEqual({ [P2]: PICK_WINDOW_MS });
  });
});

describe('rpsModule.forfeit', () => {
  it('opponent wins when they had already chosen', () => {
    const state = pick(launched(), P1, 'rock').state;
    const terminal = rpsModule.forfeit(state, P2);
    expect(rpsModule.outcome(terminal)).toEqual({ type: 'win', winner: P1 });
  });

  it('void when neither has chosen, or only the quitter has', () => {
    expect(rpsModule.outcome(rpsModule.forfeit(launched(), P1))).toEqual({ type: 'void' });
    const mid = pick(launched(), P1, 'rock').state;
    expect(rpsModule.outcome(rpsModule.forfeit(mid, P1))).toEqual({ type: 'void' });
  });
});

describe('rpsModule — determinism (S9)', () => {
  it('same seed + same throws replays to byte-identical state + outcome', () => {
    const pairs: Array<[string, string]> = [
      ['rock', 'scissors'],
      ['scissors', 'paper'],
      ['paper', 'rock'],
      ['rock', 'paper'],
    ];
    for (const [c1, c2] of pairs) {
      const a = playWindow(c1, c2);
      const b = playWindow(c1, c2);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(rpsModule.outcome(a)).toEqual(rpsModule.outcome(b));
    }
  });

  it('the seeded auto-throw is deterministic and legal', () => {
    const s = launched();
    const m0 = rpsModule.timeoutMove!(s, P1, seededRng(9));
    const m1 = rpsModule.timeoutMove!(s, P1, seededRng(42));
    expect(m0).toBe(m1);
    expect(rpsModule.legalMoves(s, P1)).toContain(m0);
  });
});
