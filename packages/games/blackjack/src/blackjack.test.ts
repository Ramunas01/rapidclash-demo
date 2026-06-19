import { describe, expect, it } from 'vitest';
import type { GameState, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { blackjackModule as bj } from './blackjack.js';
import { handValue, deckFor, type Card, type Rank } from './deck.js';

const A = 'player-A';
const B = 'player-B';
const ctx = (playerId: string) => ({ playerId, now: 0 });

// Seeded rng stub. Blackjack only calls rng.int once (at init) to fix the base seed.
const rngWith = (seed: number): Rng => ({ next: () => 0, int: () => seed });

// ── Test view of the (opaque) state, and a builder for exact-card scenarios ──
interface Hand {
  cards: Card[];
  done: boolean;
}
interface Bj {
  players: [string, string];
  seed?: number;
  round: number;
  draws: number;
  hands: Record<string, Hand>;
  winner?: string;
  forcedOutcome?: { type: string };
}
const as = (s: GameState): Bj => s as Bj;

const card = (rank: Rank, suit: '♠' | '♥' | '♦' | '♣' = '♠'): Card => ({ rank, suit });

/** Build an in-play state with exact hands (decks are only consulted on a 'hit'). */
function state(p1: Card[], p2: Card[], extra: Partial<Bj> = {}): GameState {
  return {
    players: [A, B],
    seed: 12345,
    round: 0,
    draws: 0,
    hands: { [A]: { cards: p1, done: false }, [B]: { cards: p2, done: false } },
    ...extra,
  } as GameState;
}

/** Both players stand from the given state → triggers resolution. Returns the post-state. */
function bothStand(s: GameState): GameState {
  const afterA = bj.applyMove(s, 'stand', ctx(A)).state;
  return bj.applyMove(afterA, 'stand', ctx(B)).state;
}

// ── handValue (ace downgrade, bust value) ───────────────────────────────────

describe('handValue — ace handling & totals', () => {
  it('counts an ace as 11 when it fits', () => {
    expect(handValue([card('A'), card('9')])).toBe(20);
    expect(handValue([card('A'), card('K')])).toBe(21); // 21, treated as plain 21
  });
  it('auto-downgrades an ace from 11 to 1 to avoid a bust', () => {
    expect(handValue([card('A'), card('9'), card('5')])).toBe(15); // 11→1
    expect(handValue([card('A'), card('A'), card('9')])).toBe(21); // 11+1+9
  });
  it('faces are 10 and a real bust exceeds 21', () => {
    expect(handValue([card('K'), card('Q')])).toBe(20);
    expect(handValue([card('K'), card('Q'), card('2')])).toBe(22);
  });
});

// ── meta ────────────────────────────────────────────────────────────────────

describe('blackjackModule.meta', () => {
  it('declares the spec meta incl. rakeRate 0.025 and net_winnings ranking', () => {
    expect(bj.meta).toMatchObject({
      id: 'blackjack',
      displayName: 'Blackjack',
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'net_winnings' },
      bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      rakeRate: 0.025,
    });
  });
});

// ── init / deal ──────────────────────────────────────────────────────────────

describe('blackjackModule.init', () => {
  it('deals two cards to each player from their own deck', () => {
    const s = as(bj.init([A, B], rngWith(777)));
    expect(s.hands[A].cards).toHaveLength(2);
    expect(s.hands[B].cards).toHaveLength(2);
    expect(s.round).toBe(0);
    expect(s.draws).toBe(0);
    // Independent decks: each player's deal is the head of its own derived deck.
    expect(s.hands[A].cards).toEqual(deckFor(s.seed!, 0, 0).slice(0, 2));
    expect(s.hands[B].cards).toEqual(deckFor(s.seed!, 0, 1).slice(0, 2));
  });
  it('is JSON-serializable', () => {
    const s = bj.init([A, B], rngWith(1));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

// ── legalMoves (concurrent, per-player) ──────────────────────────────────────

describe('blackjackModule.legalMoves', () => {
  it('offers hit/stand to both players at the deal (concurrent, not turn-based)', () => {
    const s = bj.init([A, B], rngWith(5));
    expect(bj.legalMoves(s, A)).toEqual(['hit', 'stand']);
    expect(bj.legalMoves(s, B)).toEqual(['hit', 'stand']);
  });
  it('returns [] for a player who is done while the other still acts', () => {
    const afterA = bj.applyMove(state([card('10'), card('9')], [card('7'), card('7')]), 'stand', ctx(A)).state;
    expect(bj.legalMoves(afterA, A)).toEqual([]); // A stood
    expect(bj.legalMoves(afterA, B)).toEqual(['hit', 'stand']); // B still acting
  });
  it('returns [] once terminal', () => {
    const s = state([card('10'), card('9')], [card('K'), card('K')]); // 19 vs 20
    const done = bothStand(s);
    expect(bj.isTerminal(done)).toBe(true);
    expect(bj.legalMoves(done, A)).toEqual([]);
    expect(bj.legalMoves(done, B)).toEqual([]);
  });
});

// ── applyMove: hit / stand / bust ───────────────────────────────────────────

describe('blackjackModule.applyMove — hit, stand, bust', () => {
  it('hit draws the next card from the player’s own deck', () => {
    const s = bj.init([A, B], rngWith(42));
    const expectedNext = deckFor(as(s).seed!, 0, 0)[2];
    const after = as(bj.applyMove(s, 'hit', ctx(A)).state);
    expect(after.hands[A].cards).toHaveLength(3);
    expect(after.hands[A].cards[2]).toEqual(expectedNext);
  });

  it('hitting a hard 20 busts and locks the hand (no further moves)', () => {
    // From [10,10]=20 any non-ace busts; within two hits a bust is guaranteed.
    let s = state([card('10'), card('10', '♥')], [card('2'), card('3')]);
    s = bj.applyMove(s, 'hit', ctx(A)).state;
    if (!as(s).hands[A].done) s = bj.applyMove(s, 'hit', ctx(A)).state;
    const me = as(s).hands[A];
    expect(me.done).toBe(true);
    expect(handValue(me.cards)).toBeGreaterThan(21);
    // The locked (busted) player can no longer act.
    expect(bj.legalMoves(s, A)).toEqual([]);
    expect(() => bj.applyMove(s, 'hit', ctx(A))).toThrow(IllegalMove);
  });

  it('stand locks the hand at its current total (this is also the timeout/auto-stand action)', () => {
    // Per spec, a 10s timeout auto-stands the player; the core injects exactly this 'stand'.
    const s = state([card('10'), card('8')], [card('5'), card('5')]); // A=18
    const after = as(bj.applyMove(s, 'stand', ctx(A)).state);
    expect(after.hands[A].done).toBe(true);
    expect(handValue(after.hands[A].cards)).toBe(18); // unchanged — locked at current total
  });

  it('rejects an invalid action, and acting when done/terminal', () => {
    const s = state([card('10'), card('9')], [card('7'), card('7')]);
    expect(() => bj.applyMove(s, 'double', ctx(A))).toThrow(IllegalMove);
    const afterA = bj.applyMove(s, 'stand', ctx(A)).state;
    expect(() => bj.applyMove(afterA, 'stand', ctx(A))).toThrow(IllegalMove); // already done
  });

  it('emits nothing about a hand during play (no opponent leak), only a reveal at round end', () => {
    const s = state([card('10'), card('8')], [card('5'), card('5')]);
    const hit = bj.applyMove(s, 'hit', ctx(B)); // mid-round action
    expect(hit.events).toEqual([]);
    const a = bj.applyMove(hit.state, 'stand', ctx(A));
    expect(a.events).toEqual([]); // B still acting → still no reveal
    const b = bj.applyMove(a.state, 'stand', ctx(B)); // both done → reveal
    expect(b.events.some((e) => e.type === 'round_revealed')).toBe(true);
  });
});

// ── win matrix ──────────────────────────────────────────────────────────────

describe('blackjackModule — win matrix', () => {
  it('higher total wins', () => {
    const r = bothStand(state([card('10'), card('9')], [card('10'), card('8')])); // 19 vs 18
    expect(bj.outcome(r)).toEqual({ type: 'win', winner: A });
  });
  it('a non-buster beats a buster', () => {
    const r = bothStand(state([card('10'), card('10'), card('5')], [card('10'), card('9')])); // 25 vs 19
    expect(bj.outcome(r)).toEqual({ type: 'win', winner: B });
  });
  it('lower total loses', () => {
    const r = bothStand(state([card('5'), card('6')], [card('K'), card('9')])); // 11 vs 19
    expect(bj.outcome(r)).toEqual({ type: 'win', winner: B });
  });
});

// ── draws → replay (internal draws are NOT contract-draws) ──────────────────

describe('blackjackModule — draw triggers replay (not a refund)', () => {
  it('equal totals re-deal a fresh round in the same match (not terminal, not a draw outcome)', () => {
    const r = as(bothStand(state([card('K'), card('K')], [card('Q'), card('Q')]))); // 20 vs 20
    expect(bj.isTerminal(r as GameState)).toBe(false);
    expect(r.round).toBe(1);
    expect(r.draws).toBe(1);
    expect(r.hands[A].cards).toHaveLength(2); // fresh deal
    expect(r.hands[B].cards).toHaveLength(2);
    expect(r.hands[A].done).toBe(false);
  });
  it('both-bust is a draw → replay', () => {
    const r = as(bothStand(state([card('K'), card('Q'), card('5')], [card('10'), card('9'), card('8')])));
    expect(bj.isTerminal(r as GameState)).toBe(false);
    expect(r.round).toBe(1);
    expect(r.draws).toBe(1);
  });
});

// ── 10-draw cap → void ───────────────────────────────────────────────────────

describe('blackjackModule — draw cap', () => {
  it('after 10 consecutive draws the match voids (refund both)', () => {
    // 9 draws already; this drawn round makes it 10 → void.
    const s = state([card('K'), card('K')], [card('Q'), card('Q')], { draws: 9, round: 9 });
    const r = bothStand(s);
    expect(bj.isTerminal(r)).toBe(true);
    expect(bj.outcome(r)).toEqual({ type: 'void' });
    expect(as(r).draws).toBe(10);
  });
  it('a draw just below the cap still replays', () => {
    const s = state([card('K'), card('K')], [card('Q'), card('Q')], { draws: 8, round: 8 });
    const r = bothStand(s);
    expect(bj.isTerminal(r)).toBe(false);
    expect(as(r).draws).toBe(9);
  });
});

// ── isTerminal / outcome ─────────────────────────────────────────────────────

describe('blackjackModule.isTerminal / outcome', () => {
  it('is not terminal while a player is still acting', () => {
    const s = state([card('10'), card('5')], [card('7'), card('7')]);
    expect(bj.isTerminal(s)).toBe(false);
    const afterA = bj.applyMove(s, 'stand', ctx(A)).state; // A done, B not
    expect(bj.isTerminal(afterA)).toBe(false);
  });
  it('only ever yields a contract-level win (decisive) or void', () => {
    const win = bothStand(state([card('K'), card('9')], [card('K'), card('8')]));
    expect(bj.outcome(win)).toEqual({ type: 'win', winner: A });
  });
});

// ── viewFor redaction ────────────────────────────────────────────────────────

describe('blackjackModule.viewFor — redaction', () => {
  it('shows own hand fully and exactly one opponent card, hiding the seed & opp status', () => {
    const s = state([card('10'), card('9')], [card('7'), card('8'), card('2')], { seed: 999 });
    const aView = as(bj.viewFor(s, A));
    expect(aView.hands[A].cards).toHaveLength(2); // own full
    expect(aView.hands[B].cards).toHaveLength(1); // exactly one opponent card
    expect(aView.hands[B].cards[0]).toEqual(card('7')); // the first one
    expect(aView.hands[B].done).toBe(false); // opponent status hidden
    expect(aView.seed).toBeUndefined(); // seed stripped (would reveal hidden cards)
  });
  it('reveals everything at terminal (both hands + seed)', () => {
    const s = state([card('10'), card('9')], [card('10'), card('8')], { seed: 999 });
    const done = bothStand(s);
    const view = as(bj.viewFor(done, B));
    expect(view.hands[A].cards).toHaveLength(2); // opponent fully revealed
    expect(view.hands[B].cards).toHaveLength(2);
    expect(view.seed).toBe(999); // revealed for verifiability
  });
});

// ── forfeit / disconnect → auto-stand (not void, unless it draws) ───────────

describe('blackjackModule.forfeit — disconnect = auto-stand on current total', () => {
  it('the dropped player can still WIN if their current total is higher', () => {
    const s = state([card('K'), card('9')], [card('10'), card('8')]); // quitter A=19 vs B=18
    const r = bj.forfeit(s, A);
    expect(bj.isTerminal(r)).toBe(true);
    expect(bj.outcome(r)).toEqual({ type: 'win', winner: A }); // not an instant forfeit-loss
  });
  it('the present player wins if higher', () => {
    const s = state([card('5'), card('6')], [card('10'), card('9')]); // A=11 quits, B=19
    expect(bj.outcome(bj.forfeit(s, A))).toEqual({ type: 'win', winner: B });
  });
  it('a tie on the auto-stand resolve → void (covers both-disconnect draw)', () => {
    const s = state([card('K'), card('K')], [card('Q'), card('Q')]); // 20 vs 20
    const r = bj.forfeit(s, A);
    expect(bj.isTerminal(r)).toBe(true);
    expect(bj.outcome(r)).toEqual({ type: 'void' });
  });
});

// ── determinism ──────────────────────────────────────────────────────────────

describe('blackjackModule — determinism', () => {
  it('same seed + same moves → byte-identical state and outcome', () => {
    const run = () => {
      let s = bj.init([A, B], rngWith(2024));
      // Both stand immediately — never busts, so the sequence is always legal and the
      // resolution (decisive or draw→replay) is a pure function of the seed.
      s = bj.applyMove(s, 'stand', ctx(A)).state;
      s = bj.applyMove(s, 'stand', ctx(B)).state;
      return { state: s, outcome: bj.isTerminal(s) ? bj.outcome(s) : null };
    };
    const r1 = run();
    const r2 = run();
    expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
    expect(r1.outcome).toEqual(r2.outcome);
  });
});
