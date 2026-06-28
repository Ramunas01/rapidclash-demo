import { describe, expect, it } from 'vitest';
import type { Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { coinflipModule } from './coinflip.js';

const P1 = 'player-1';
const P2 = 'player-2';

const ctx = (playerId: string) => ({ playerId, now: 0 });

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
  result?: Side;
  forcedOutcome?: unknown;
  caller?: unknown;
  call?: unknown;
};
function view(state: unknown): CoinflipView {
  return state as CoinflipView;
}

/** Play a full match: P1 chooses c1, then P2 chooses c2. */
function play(rng: Rng, c1: Side, c2: Side) {
  let s = coinflipModule.init([P1, P2], rng);
  s = coinflipModule.applyMove(s, c1, ctx(P1)).state;
  s = coinflipModule.applyMove(s, c2, ctx(P2)).state;
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
  it('has the exact meta specified in the contract (ranking: net_winnings)', () => {
    expect(coinflipModule.meta).toEqual({
      id: 'coinflip',
      displayName: 'Coinflip',
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'net_winnings' },
      bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      averageDurationSec: 5,
      rakeRate: 0.025,
      moveTimeoutMs: 10_000,
    });
  });

  it('declares a 2.5% rake rate', () => {
    expect(coinflipModule.meta.rakeRate).toBe(0.025);
  });
});

describe('coinflipModule.init', () => {
  it('starts with empty choices and no caller role', () => {
    const s = view(coinflipModule.init([P1, P2], fixedRng(0)));
    expect(s.players).toEqual([P1, P2]);
    expect(s.choices).toEqual({});
    expect(s.caller).toBeUndefined();
    expect(s.call).toBeUndefined();
  });

  it('fixes the flip from the rng (0 → heads, 1 → tails)', () => {
    expect(view(coinflipModule.init([P1, P2], fixedRng(0))).result).toBe('heads');
    expect(view(coinflipModule.init([P1, P2], fixedRng(1))).result).toBe('tails');
  });
});

describe('coinflipModule.legalMoves', () => {
  it('offers BOTH players heads/tails before they choose (no caller)', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    expect(coinflipModule.legalMoves(state, P1)).toEqual(['heads', 'tails']);
    expect(coinflipModule.legalMoves(state, P2)).toEqual(['heads', 'tails']);
  });

  it('offers nothing to a player who has already chosen; the other may still choose', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0));
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;
    expect(coinflipModule.legalMoves(state, P1)).toEqual([]);
    expect(coinflipModule.legalMoves(state, P2)).toEqual(['heads', 'tails']);
  });

  it('offers nothing once both have chosen', () => {
    const state = play(fixedRng(0), 'heads', 'tails');
    expect(coinflipModule.legalMoves(state, P1)).toEqual([]);
    expect(coinflipModule.legalMoves(state, P2)).toEqual([]);
  });
});

describe('coinflipModule.applyMove', () => {
  it('records the choice and emits move_made WITHOUT leaking the side', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    const { state: next, events } = coinflipModule.applyMove(state, 'tails', ctx(P1));
    expect(view(next).choices[P1]).toBe('tails');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('move_made');
    // The side must NOT appear in the public event (it's hidden until terminal).
    expect(events[0].payload).toEqual({ playerId: P1 });
    expect(JSON.stringify(events)).not.toContain('tails');
  });

  it('rejects a second choice from the same player with IllegalMove', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0));
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;
    expect(() => coinflipModule.applyMove(state, 'tails', ctx(P1))).toThrow(IllegalMove);
  });

  it('rejects an invalid side with IllegalMove', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    expect(() => coinflipModule.applyMove(state, 'edge', ctx(P1))).toThrow(IllegalMove);
  });
});

describe('coinflipModule.isTerminal', () => {
  it('is false until BOTH have chosen, then true', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0));
    expect(coinflipModule.isTerminal(state)).toBe(false);
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;
    expect(coinflipModule.isTerminal(state)).toBe(false); // only one chose
    state = coinflipModule.applyMove(state, 'tails', ctx(P2)).state;
    expect(coinflipModule.isTerminal(state)).toBe(true);
  });
});

describe('coinflipModule.outcome', () => {
  it('SAME choice → draw (both refunded), no flip needed', () => {
    expect(coinflipModule.outcome(play(fixedRng(0), 'heads', 'heads'))).toEqual({ type: 'draw' });
    expect(coinflipModule.outcome(play(fixedRng(1), 'tails', 'tails'))).toEqual({ type: 'draw' });
  });

  it('DIFFERENT choices → the player whose side matches the flip wins', () => {
    // result = heads → whoever chose heads wins.
    expect(coinflipModule.outcome(play(fixedRng(0), 'heads', 'tails'))).toEqual({ type: 'win', winner: P1 });
    expect(coinflipModule.outcome(play(fixedRng(0), 'tails', 'heads'))).toEqual({ type: 'win', winner: P2 });
    // result = tails → whoever chose tails wins.
    expect(coinflipModule.outcome(play(fixedRng(1), 'heads', 'tails'))).toEqual({ type: 'win', winner: P2 });
    expect(coinflipModule.outcome(play(fixedRng(1), 'tails', 'heads'))).toEqual({ type: 'win', winner: P1 });
  });
});

describe('coinflipModule.viewFor — opponent choice AND flip hidden until terminal', () => {
  it('leaks NO opponent choice and NO result pre-terminal (from BOTH views)', () => {
    // Only P1 has chosen → not terminal.
    let state = coinflipModule.init([P1, P2], fixedRng(0));
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;

    const p1View = view(coinflipModule.viewFor(state, P1));
    const p2View = view(coinflipModule.viewFor(state, P2));

    // Neither view exposes the flip result.
    expect('result' in p1View).toBe(false);
    expect('result' in p2View).toBe(false);
    // P1 sees their own choice; P2 must NOT see P1's choice.
    expect(p1View.choices[P1]).toBe('heads');
    expect(P1 in p2View.choices).toBe(false);
    expect(JSON.stringify(p2View)).not.toContain('heads');
  });

  it('reveals BOTH choices and the flip to BOTH players at terminal', () => {
    const state = play(fixedRng(0), 'heads', 'tails'); // result heads
    for (const viewer of [P1, P2]) {
      const v = view(coinflipModule.viewFor(state, viewer));
      expect(v.result).toBe('heads');
      expect(v.choices[P1]).toBe('heads');
      expect(v.choices[P2]).toBe('tails');
    }
  });
});

describe('coinflipModule.forfeit', () => {
  it('voids when abandoned before BOTH have chosen (both refunded), never a draw', () => {
    // No one has chosen.
    const fresh = coinflipModule.init([P1, P2], fixedRng(0));
    const v0 = coinflipModule.forfeit(fresh, P1);
    expect(coinflipModule.isTerminal(v0)).toBe(true);
    expect(coinflipModule.outcome(v0)).toEqual({ type: 'void' });

    // One player has chosen, the other abandons → still void (not a draw/win).
    let mid = coinflipModule.init([P1, P2], fixedRng(0));
    mid = coinflipModule.applyMove(mid, 'heads', ctx(P1)).state;
    expect(coinflipModule.outcome(coinflipModule.forfeit(mid, P2))).toEqual({ type: 'void' });
  });
});

describe('coinflipModule — pick timer + seeded auto-pick (opt-in per-player timer)', () => {
  it('declares the 10s per-player pick timer', () => {
    expect(coinflipModule.meta.moveTimeoutMs).toBe(10_000);
  });

  it('timeoutMove returns a valid, currently-legal side for a player who has not picked', () => {
    const state = coinflipModule.init([P1, P2], seededRng(HEADS_SEED));
    const m1 = coinflipModule.timeoutMove!(state, P1, fixedRng(0));
    expect(coinflipModule.legalMoves(state, P1)).toContain(m1); // membership — the core re-checks this
    expect(['heads', 'tails']).toContain(m1);
  });

  it('the auto-pick is deterministic (fixed at init) and ignores the injected rng', () => {
    const state = coinflipModule.init([P1, P2], seededRng(HEADS_SEED));
    expect(coinflipModule.timeoutMove!(state, P1, fixedRng(0))).toBe(coinflipModule.timeoutMove!(state, P1, fixedRng(1)));
  });

  it('a no-pick round resolves: both players auto-pick on timeout → terminal with an outcome', () => {
    let state = coinflipModule.init([P1, P2], seededRng(TAILS_SEED));
    state = coinflipModule.applyMove(state, coinflipModule.timeoutMove!(state, P1, fixedRng(0)), ctx(P1)).state;
    state = coinflipModule.applyMove(state, coinflipModule.timeoutMove!(state, P2, fixedRng(0)), ctx(P2)).state;
    expect(coinflipModule.isTerminal(state)).toBe(true);
    expect(['win', 'draw']).toContain(coinflipModule.outcome(state).type);
  });

  it('timeoutMove throws once a player has already chosen (nothing to auto-pick)', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0));
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;
    expect(() => coinflipModule.timeoutMove!(state, P1, fixedRng(0))).toThrow(IllegalMove);
  });

  it('redaction: the seed is stripped pre-terminal (no precomputing the opponent auto-pick)', () => {
    let state = coinflipModule.init([P1, P2], seededRng(HEADS_SEED));
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state; // P1 picked, P2 has not → pre-terminal
    const p2View = coinflipModule.viewFor(state, P2) as { seed: number };
    expect(p2View.seed).toBe(0); // real seed never on the wire pre-terminal
  });
});

describe('coinflipModule — determinism (S9 analogue)', () => {
  it('same seed + same choices replays to byte-identical final state and outcome', () => {
    const combos: Array<[Side, Side]> = [
      ['heads', 'heads'],
      ['heads', 'tails'],
      ['tails', 'heads'],
      ['tails', 'tails'],
    ];
    for (const seed of [HEADS_SEED, TAILS_SEED]) {
      for (const [c1, c2] of combos) {
        const a = play(seededRng(seed), c1, c2);
        const b = play(seededRng(seed), c1, c2);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        expect(coinflipModule.outcome(a)).toEqual(coinflipModule.outcome(b));
      }
    }
  });

  it('same seed → same flip, INDEPENDENT of the choices', () => {
    const a = view(play(seededRng(HEADS_SEED), 'heads', 'tails')).result;
    const b = view(play(seededRng(HEADS_SEED), 'tails', 'heads')).result;
    expect(a).toBe(b); // identical flip; only who-matches-it differs
  });
});
