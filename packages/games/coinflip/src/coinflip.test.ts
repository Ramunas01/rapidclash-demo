import { describe, expect, it } from 'vitest';
import type { Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { coinflipModule } from './coinflip.js';

const P1 = 'player-1'; // caller (players[0])
const P2 = 'player-2'; // opponent

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

/** Forces the flip: int(0,1) → 0 = 'heads', 1 = 'tails'. Lets a test pin the
 *  result independently of the call so outcome/redaction can be asserted exactly. */
function fixedRng(intVal: 0 | 1): Rng {
  return { next: () => intVal, int: () => intVal };
}

type CoinflipView = {
  players: [string, string];
  caller: string;
  call?: string;
  result?: string;
  forcedOutcome?: unknown;
};
function view(state: unknown): CoinflipView {
  return state as CoinflipView;
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
    });
  });
});

describe('coinflipModule.init', () => {
  it('sets caller = players[0] and leaves call unset', () => {
    const s = view(coinflipModule.init([P1, P2], fixedRng(0)));
    expect(s.caller).toBe(P1);
    expect(s.players).toEqual([P1, P2]);
    expect(s.call).toBeUndefined();
  });

  it('fixes the flip from the rng (0 → heads, 1 → tails)', () => {
    expect(view(coinflipModule.init([P1, P2], fixedRng(0))).result).toBe('heads');
    expect(view(coinflipModule.init([P1, P2], fixedRng(1))).result).toBe('tails');
  });
});

describe('coinflipModule.legalMoves', () => {
  it('offers the caller heads/tails before any call', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    expect(coinflipModule.legalMoves(state, P1)).toEqual(['heads', 'tails']);
  });

  it('offers the non-caller nothing', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    expect(coinflipModule.legalMoves(state, P2)).toEqual([]);
  });

  it('offers nothing once the call has been made', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0));
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;
    expect(coinflipModule.legalMoves(state, P1)).toEqual([]);
    expect(coinflipModule.legalMoves(state, P2)).toEqual([]);
  });
});

describe('coinflipModule.applyMove', () => {
  it('records the call and emits a public call_made event (call included)', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    const { state: next, events } = coinflipModule.applyMove(state, 'tails', ctx(P1));
    expect(view(next).call).toBe('tails');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('call_made');
    expect(events[0].payload).toEqual({ playerId: P1, call: 'tails' });
  });

  it('makes the match terminal', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0));
    expect(coinflipModule.isTerminal(state)).toBe(false);
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;
    expect(coinflipModule.isTerminal(state)).toBe(true);
  });

  it('rejects a call from the non-caller with IllegalMove', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    expect(() => coinflipModule.applyMove(state, 'heads', ctx(P2))).toThrow(IllegalMove);
  });

  it('rejects an invalid call value with IllegalMove', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    expect(() => coinflipModule.applyMove(state, 'edge', ctx(P1))).toThrow(IllegalMove);
  });

  it('rejects a second (double) call with IllegalMove', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0));
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;
    expect(() => coinflipModule.applyMove(state, 'tails', ctx(P1))).toThrow(IllegalMove);
  });
});

describe('coinflipModule.outcome', () => {
  it('caller wins when the call matches the flip', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0)); // result = heads
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;
    expect(coinflipModule.outcome(state)).toEqual({ type: 'win', winner: P1 });
  });

  it('opponent wins when the call misses the flip', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0)); // result = heads
    state = coinflipModule.applyMove(state, 'tails', ctx(P1)).state;
    expect(coinflipModule.outcome(state)).toEqual({ type: 'win', winner: P2 });
  });

  it('never draws — exactly one winner for either call', () => {
    for (const call of ['heads', 'tails'] as const) {
      let state = coinflipModule.init([P1, P2], fixedRng(1)); // result = tails
      state = coinflipModule.applyMove(state, call, ctx(P1)).state;
      const out = coinflipModule.outcome(state);
      expect(out.type).toBe('win');
    }
  });
});

describe('coinflipModule.viewFor — the flip is hidden until terminal', () => {
  it('strips result from BOTH players before the call (pre-terminal)', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    const p1 = view(coinflipModule.viewFor(state, P1));
    const p2 = view(coinflipModule.viewFor(state, P2));
    expect('result' in p1).toBe(false);
    expect('result' in p2).toBe(false);
    // Non-secret fields remain.
    expect(p1.caller).toBe(P1);
  });

  it('reveals result to BOTH players at terminal', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0)); // result = heads
    state = coinflipModule.applyMove(state, 'heads', ctx(P1)).state;
    expect(view(coinflipModule.viewFor(state, P1)).result).toBe('heads');
    expect(view(coinflipModule.viewFor(state, P2)).result).toBe('heads');
  });

  it('keeps the call visible to BOTH players once made', () => {
    let state = coinflipModule.init([P1, P2], fixedRng(0));
    state = coinflipModule.applyMove(state, 'tails', ctx(P1)).state;
    expect(view(coinflipModule.viewFor(state, P1)).call).toBe('tails');
    expect(view(coinflipModule.viewFor(state, P2)).call).toBe('tails');
  });
});

describe('coinflipModule.forfeit', () => {
  it('voids the match when abandoned before the call (both refunded)', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    const terminal = coinflipModule.forfeit(state, P1);
    expect(coinflipModule.isTerminal(terminal)).toBe(true);
    expect(coinflipModule.outcome(terminal)).toEqual({ type: 'void' });
  });

  it('voids regardless of which player abandons before the call', () => {
    const state = coinflipModule.init([P1, P2], fixedRng(0));
    expect(coinflipModule.outcome(coinflipModule.forfeit(state, P2))).toEqual({ type: 'void' });
  });
});

// S9 analogue — determinism of the seeded flip.
describe('determinism (S9 analogue)', () => {
  it('same seed → same flip result', () => {
    const a = view(coinflipModule.init([P1, P2], seededRng(HEADS_SEED))).result;
    const b = view(coinflipModule.init([P1, P2], seededRng(HEADS_SEED))).result;
    expect(a).toBe(b);
  });

  it('same seed + same call replays to byte-identical final state and outcome', () => {
    function runMatch(seed: number, call: 'heads' | 'tails') {
      let state = coinflipModule.init([P1, P2], seededRng(seed));
      state = coinflipModule.applyMove(state, call, ctx(P1)).state;
      return { state, outcome: coinflipModule.outcome(state) };
    }
    for (const seed of [HEADS_SEED, TAILS_SEED]) {
      for (const call of ['heads', 'tails'] as const) {
        const r1 = runMatch(seed, call);
        const r2 = runMatch(seed, call);
        expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
        expect(r1.outcome).toEqual(r2.outcome);
      }
    }
  });

  it('the flip is INDEPENDENT of the call: heads vs tails share one result, only the winner differs', () => {
    const heads = (() => {
      let s = coinflipModule.init([P1, P2], seededRng(HEADS_SEED));
      s = coinflipModule.applyMove(s, 'heads', ctx(P1)).state;
      return { result: view(s).result, outcome: coinflipModule.outcome(s) };
    })();
    const tails = (() => {
      let s = coinflipModule.init([P1, P2], seededRng(HEADS_SEED));
      s = coinflipModule.applyMove(s, 'tails', ctx(P1)).state;
      return { result: view(s).result, outcome: coinflipModule.outcome(s) };
    })();
    // Same seed → identical flip, no matter what was called.
    expect(heads.result).toBe(tails.result);
    // But the calls land on opposite sides, so the winners differ.
    expect(heads.outcome).not.toEqual(tails.outcome);
  });
});
