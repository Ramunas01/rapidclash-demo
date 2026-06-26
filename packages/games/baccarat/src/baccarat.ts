import type {
  ApplyResult,
  GameEvent,
  GameMeta,
  GameModule,
  GameState,
  Move,
  MoveContext,
  Outcome,
  PlayerId,
  Rng,
} from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';

/**
 * Baccarat — the INDEPENDENT-ROLL skeleton (see Dice) wearing authentic baccarat clothes
 * (docs/BACCARAT.md). The house game (bet Player/Banker/Tie, 5% commission claws back the Banker
 * edge) becomes: each player simply IS their own hand, dealt by authentic rules from their OWN
 * shoe (a SEPARATE seed) — higher last-digit total (closest to 9) wins. No Player/Banker/Tie bet
 * and no commission, so the edge the commission offsets never appears. Fairness is statistical
 * symmetry (identical rules + distributions). No decisions, no timer.
 *
 * Mechanically this is Dice with a hand instead of a number: each player commits one `reveal` (the
 * hands are rule-determined, no choices); once BOTH commit, the round resolves; equal totals →
 * instant internal replay with fresh shoes; a 10-replay cap → void. The hands derive from the two
 * recorded seeds → exact replays.
 */

const REVEAL = 'reveal';
const REPLAY_CAP = 10;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
const SUITS = ['♠', '♥', '♦', '♣'] as const;

/** Baccarat card value: A=1, 2–9 face, 10/J/Q/K = 0. */
export function cardValue(rank: string): number {
  if (rank === 'A') return 1;
  if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 0;
  return Number(rank);
}

interface Card {
  rank: string;
  suit: string;
}
export interface Hand {
  cards: Card[];
  /** Last-digit total (0–9; closest to 9 wins). */
  total: number;
  /** A two-card 8 or 9 — a natural; it stands. */
  natural: boolean;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mixSeed(seed: number, round: number): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (round >>> 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/**
 * Deal one player's hand from their shoe seed for `round`, by authentic baccarat rules: two cards,
 * then a third drawn iff the two-card total is 0–5 (stand on 6–7; a two-card 8/9 is a natural and
 * stands). Pure & seeded → exact replays. (Each card is drawn uniformly by rank — for a 2–3 card
 * hand this is statistically equivalent to a large shoe, and it keeps the draw deterministic.) */
export function dealHand(seed: number, round: number): Hand {
  const rng = mulberry32(mixSeed(seed, round));
  const draw = (): Card => ({ rank: RANKS[Math.floor(rng() * RANKS.length)], suit: SUITS[Math.floor(rng() * SUITS.length)] });
  const cards = [draw(), draw()];
  let total = (cardValue(cards[0].rank) + cardValue(cards[1].rank)) % 10;
  const natural = total >= 8; // an 8 or 9 on the first two cards
  if (!natural && total <= 5) {
    const third = draw();
    cards.push(third);
    total = (total + cardValue(third.rank)) % 10;
  }
  return { cards, total, natural };
}

interface BaccaratResult {
  hands: Record<PlayerId, Hand>;
  round: number;
}

interface BaccaratState {
  players: [PlayerId, PlayerId];
  /** A SEPARATE shoe seed per player — the independent-roll point; recorded for exact replays. */
  seeds: Record<PlayerId, number>;
  round: number;
  replays: number;
  revealed: Record<PlayerId, boolean>;
  result?: BaccaratResult;
  winner?: PlayerId;
  forcedOutcome?: Outcome; // void — replay cap, or abandoned before resolution
}

function cast(state: GameState): BaccaratState {
  return state as BaccaratState;
}
function terminal(s: BaccaratState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}
function bothRevealed(s: BaccaratState): boolean {
  return s.players.every((p) => s.revealed[p]);
}

/** Resolve once both reveal: deal both hands for the round and compare totals; equal → replay with
 *  fresh shoes (cap → void), higher total wins. Mutates `s`. */
function resolve(s: BaccaratState): GameEvent[] {
  const [p1, p2] = s.players;
  for (;;) {
    const h1 = dealHand(s.seeds[p1], s.round);
    const h2 = dealHand(s.seeds[p2], s.round);
    if (h1.total !== h2.total) {
      s.winner = h1.total > h2.total ? p1 : p2;
      s.result = { hands: { [p1]: h1, [p2]: h2 }, round: s.round };
      return [{ type: 'resolved', payload: { winner: s.winner, round: s.round } }];
    }
    s.replays += 1;
    if (s.replays >= REPLAY_CAP) {
      s.forcedOutcome = { type: 'void' };
      s.result = { hands: { [p1]: h1, [p2]: h2 }, round: s.round };
      return [{ type: 'voided', payload: { reason: 'replay_cap', replays: s.replays } }];
    }
    s.round += 1; // equal totals → fresh shoes
  }
}

const meta: GameMeta = {
  id: 'baccarat',
  displayName: 'Baccarat',
  minPlayers: 2,
  maxPlayers: 2,
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 5,
  rakeRate: 0.025,
};

export const baccaratModule: GameModule = {
  meta,

  init(players: PlayerId[], rng: Rng): GameState {
    const state: BaccaratState = {
      players: [players[0], players[1]],
      seeds: { [players[0]]: rng.int(0, 0x7fffffff), [players[1]]: rng.int(0, 0x7fffffff) },
      round: 0,
      replays: 0,
      revealed: {},
    };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): Move[] {
    const s = cast(state);
    if (terminal(s) || !s.players.includes(playerId) || s.revealed[playerId]) return [];
    return [REVEAL];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    if (terminal(s) || !s.players.includes(playerId) || s.revealed[playerId]) {
      throw new IllegalMove(`${playerId} cannot reveal now`);
    }
    if (move !== REVEAL) throw new IllegalMove(`"${String(move)}" is not a valid move`);

    const next: BaccaratState = { ...s, revealed: { ...s.revealed, [playerId]: true } };
    const events: GameEvent[] = [{ type: 'revealed', payload: { playerId } }];
    if (bothRevealed(next)) events.push(...resolve(next));
    return { state: next, events };
  },

  isTerminal(state: GameState): boolean {
    return terminal(cast(state));
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    return { type: 'win', winner: s.winner! };
  },

  /** Each player watches only their OWN hand resolve; the opponent's hand (and seed) is sent only
   *  at the simultaneous reveal at terminal. The own hand is dealt server-side from the viewer's
   *  own shoe for the current round. */
  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s; // full reveal: both hands + both seeds (provably fair)
    return {
      players: s.players,
      seeds: {}, // redacted — a seed would let a player precompute the opponent's hand
      round: s.round,
      replays: s.replays,
      revealed: { ...s.revealed },
      // The viewer's own hand, so they can watch it resolve; the opponent's stays hidden.
      hands: s.players.includes(playerId) ? { [playerId]: dealHand(s.seeds[playerId], s.round) } : {},
    } as GameState;
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    return { ...s, forcedOutcome: { type: 'void' } };
  },
};

export { REVEAL, REPLAY_CAP };
