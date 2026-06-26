import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { baccaratModule as bac, dealHand, cardValue, REPLAY_CAP } from './baccarat.js';

const A: PlayerId = 'alice';
const B: PlayerId = 'bob';
const rngSeq = (seeds: number[]): Rng => { let i = 0; return { next: () => 0, int: () => seeds[i++] }; };
const reveal = (state: GameState, p: PlayerId) => bac.applyMove(state, 'reveal', { playerId: p, now: 0 });

describe('baccarat.meta', () => {
  it('is a 2-player net_winnings chance game with 2.5% rake', () => {
    expect(bac.meta.id).toBe('baccarat');
    expect(bac.meta.ranking).toEqual({ kind: 'net_winnings' });
    expect(bac.meta.rakeRate).toBe(0.025);
    expect(bac.meta.bet.symmetricStake).toBe(true);
  });
});

describe('card values + authentic third-card rules', () => {
  it('scores A=1, 2–9 face, 10/J/Q/K = 0', () => {
    expect(cardValue('A')).toBe(1);
    expect(['10', 'J', 'Q', 'K'].map(cardValue)).toEqual([0, 0, 0, 0]);
    expect(['2', '7', '9'].map(cardValue)).toEqual([2, 7, 9]);
  });

  it('deals 2–3 cards, last-digit total 0–9, obeying the player draw rule across many shoes', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const h = dealHand(seed, 0);
      expect(h.cards.length === 2 || h.cards.length === 3).toBe(true);
      expect(h.total).toBeGreaterThanOrEqual(0);
      expect(h.total).toBeLessThanOrEqual(9);
      const twoCard = (cardValue(h.cards[0].rank) + cardValue(h.cards[1].rank)) % 10;
      if (h.cards.length === 3) expect(twoCard).toBeLessThanOrEqual(5); // drew a third only on 0–5
      else expect(twoCard).toBeGreaterThanOrEqual(6); // stood on 6–7 or a natural 8–9
      if (h.natural) { expect(h.cards).toHaveLength(2); expect(twoCard).toBeGreaterThanOrEqual(8); }
    }
  });

  it('is a pure function of (seed, round)', () => {
    expect(dealHand(42, 0)).toEqual(dealHand(42, 0));
    expect(dealHand(42, 1)).not.toEqual(dealHand(42, 0)); // a fresh shoe per replay round
  });
});

describe('init draws SEPARATE shoe seeds', () => {
  it('records one seed per player', () => {
    const s = bac.init([A, B], rngSeq([111, 222]));
    expect((s as { seeds: Record<string, number> }).seeds).toEqual({ [A]: 111, [B]: 222 });
  });
});

describe('reveal + resolve', () => {
  it('legalMoves is [reveal] until you commit, then []', () => {
    const s = bac.init([A, B], rngSeq([111, 222]));
    expect(bac.legalMoves(s, A)).toEqual(['reveal']);
    const r = reveal(s, A);
    expect(bac.legalMoves(r.state, A)).toEqual([]);
  });

  it('once BOTH reveal, the higher total (closest to 9) wins', () => {
    const s = bac.init([A, B], rngSeq([12345, 67890]));
    const r2 = reveal(reveal(s, A).state, B);
    expect(bac.isTerminal(r2.state)).toBe(true);
    const outcome = bac.outcome(r2.state);
    expect(outcome.type).toBe('win');
    const res = (r2.state as { result: { hands: Record<string, { total: number }> } }).result;
    if (outcome.type === 'win') expect(outcome.winner).toBe(res.hands[A].total > res.hands[B].total ? A : B);
  });

  it('equal totals replay; identical seeds tie every round → void at the cap', () => {
    const s = bac.init([A, B], rngSeq([555, 555])); // same shoe → identical hand every round
    const r2 = reveal(reveal(s, A).state, B);
    expect(bac.outcome(r2.state)).toEqual({ type: 'void' });
    expect((r2.state as { replays: number }).replays).toBe(REPLAY_CAP);
  });

  it('rejects a non-reveal move and a double-reveal; forfeit pre-resolution → void', () => {
    const s = bac.init([A, B], rngSeq([1, 2]));
    expect(() => bac.applyMove(s, 'deal', { playerId: A, now: 0 })).toThrow(IllegalMove);
    const r = reveal(s, A);
    expect(() => reveal(r.state, A)).toThrow(IllegalMove);
    expect(bac.outcome(bac.forfeit(s, A))).toEqual({ type: 'void' });
  });
});

describe('viewFor — own hand resolves; opponent hidden until terminal', () => {
  it('sends the viewer their OWN hand pre-terminal, hides the opponent + seeds; reveals all at terminal', () => {
    const s = bac.init([A, B], rngSeq([111, 222]));
    const va = bac.viewFor(s, A) as { seeds: Record<string, number>; hands: Record<string, unknown> };
    expect(va.seeds).toEqual({}); // no seed leaks
    expect(va.hands[A]).toEqual(dealHand(111, 0)); // A watches their own hand resolve
    expect(va.hands[B]).toBeUndefined(); // opponent hand hidden

    const term = reveal(reveal(s, A).state, B).state;
    const tv = bac.viewFor(term, A) as { seeds: Record<string, number>; result: { hands: Record<string, unknown> } };
    expect(tv.seeds).toEqual({ [A]: 111, [B]: 222 }); // both shoes revealed at terminal
    expect(tv.result.hands[A]).toBeDefined();
    expect(tv.result.hands[B]).toBeDefined();
  });
});

describe('determinism', () => {
  it('same seeds + same reveals → identical hands, winner, outcome', () => {
    const play = () => {
      const s = bac.init([A, B], rngSeq([4242, 1337]));
      const end = reveal(reveal(s, A).state, B).state;
      return { result: (end as { result: unknown }).result, outcome: bac.outcome(end) };
    };
    expect(play()).toEqual(play());
  });
});
