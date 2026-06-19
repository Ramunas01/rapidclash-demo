// Deterministic deck derivation for Blackjack.
//
// A round's two decks (one per player) are derived purely from the match's base
// seed + the round index + the player index — no ambient randomness. This means a
// round (and the whole match) replays byte-identically from its seed, the property
// the contract requires. The decks are NOT stored in state: any method re-derives a
// player's deck on demand, so `viewFor` can never leak a player's unseen cards.
//
// (v1 ships on this seeded RNG. The spec's commit-reveal — publish a hash before the
// deal, reveal the seed after — is the roadmap "provably fair by design" direction
// layered on top of this same deterministic shuffle; not built here.)

export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  rank: Rank;
  suit: Suit;
}

const SUITS: readonly Suit[] = ['♠', '♥', '♦', '♣'];
const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A fresh, ordered 52-card deck (before shuffling). */
function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  return deck;
}

/** mulberry32 — a small, fast, well-distributed 32-bit PRNG. Deterministic per seed. */
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

/** Mix three integers into one 32-bit seed (so each (round, player) gets an independent deck). */
function mixSeed(base: number, round: number, playerIndex: number): number {
  let h = (base >>> 0) ^ 0x9e3779b9;
  for (const v of [round, playerIndex]) {
    h = Math.imul(h ^ (v >>> 0), 0x85ebca6b);
    h = (h ^ (h >>> 13)) >>> 0;
  }
  return h >>> 0;
}

/** Deterministically shuffled deck for a given (base seed, round, player). */
export function deckFor(base: number, round: number, playerIndex: number): Card[] {
  const deck = freshDeck();
  const rand = mulberry32(mixSeed(base, round, playerIndex));
  // Fisher–Yates.
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}

/** Blackjack value of a hand: face cards = 10, aces 11 then auto-downgraded to 1 to avoid bust. */
export function handValue(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      aces++;
      total += 11;
    } else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') {
      total += 10;
    } else {
      total += Number(c.rank);
    }
  }
  // Downgrade aces from 11 to 1 while busting.
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

export const BUST_THRESHOLD = 21;
