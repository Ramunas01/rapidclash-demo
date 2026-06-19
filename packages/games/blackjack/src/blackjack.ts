import type {
  ApplyResult,
  GameEvent,
  GameMeta,
  GameModule,
  GameState,
  MoveContext,
  Outcome,
  PlayerId,
  Rng,
} from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { type Card, deckFor, handValue, BUST_THRESHOLD } from './deck.js';

type Action = 'hit' | 'stand';
const ACTIONS = ['hit', 'stand'] as const;

/** Cards initially dealt to each player from their own deck. */
const INITIAL_DEAL = 2;
/** After this many CONSECUTIVE drawn rounds the match voids (refund both, no rake). */
const DRAW_CAP = 10;

interface Hand {
  cards: Card[];
  /** True once the player has stood, busted, or timed-out (auto-stand) — they then wait. */
  done: boolean;
}

/**
 * JSON-serializable Blackjack state.
 *
 * Concurrent (not turn-based): both players act on their own hand. A round resolves
 * only when BOTH are done; a draw re-deals a fresh round in the SAME match/escrow
 * (internal draws are NOT contract-draws). `winner` marks a decisive round (terminal);
 * `forcedOutcome` marks a void (draw cap reached, or a disconnect resolve that drew).
 *
 * Decks are NOT stored — they are re-derived from `seed` + `round` on demand, so a
 * redacted view can never leak a player's unseen cards. `seed` itself is redacted from
 * in-play views (it would let an opponent compute the hidden cards) and revealed only
 * at terminal.
 */
interface BlackjackState {
  players: [PlayerId, PlayerId];
  /** Base seed (fixed at init from the injected rng); each round derives its decks from it. */
  seed: number;
  /** Current round index, 0-based. */
  round: number;
  /** Consecutive drawn rounds so far. */
  draws: number;
  hands: Record<PlayerId, Hand>;
  /** Set when a round produced a decisive winner → the match is terminal. */
  winner?: PlayerId;
  /** Set on void (draw cap, or a disconnect resolve that drew) → the match is terminal. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): BlackjackState {
  return state as BlackjackState;
}

function isAction(v: unknown): v is Action {
  return typeof v === 'string' && (ACTIONS as readonly string[]).includes(v);
}

function playerIndex(s: BlackjackState, pid: PlayerId): number {
  return s.players[0] === pid ? 0 : 1;
}

function terminal(s: BlackjackState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}

/** Deal a fresh `round` to both players from their own decks. Mutates `s`. */
function deal(s: BlackjackState): void {
  const hands: Record<PlayerId, Hand> = {};
  s.players.forEach((pid, idx) => {
    hands[pid] = { cards: deckFor(s.seed, s.round, idx).slice(0, INITIAL_DEAL), done: false };
  });
  s.hands = hands;
}

/** Decisive winner of the current (fully-revealed) round, or 'draw'. Win matrix per spec. */
function roundWinner(s: BlackjackState): PlayerId | 'draw' {
  const [p1, p2] = s.players;
  const v1 = handValue(s.hands[p1].cards);
  const v2 = handValue(s.hands[p2].cards);
  const b1 = v1 > BUST_THRESHOLD;
  const b2 = v2 > BUST_THRESHOLD;
  if (b1 && b2) return 'draw'; // both bust
  if (b1) return p2; // one busts → the other wins
  if (b2) return p1;
  if (v1 === v2) return 'draw'; // equal totals (a natural is plain 21, no bonus)
  return v1 > v2 ? p1 : p2; // higher total wins
}

function revealEvent(s: BlackjackState, result: PlayerId | 'draw'): GameEvent {
  const [p1, p2] = s.players;
  return {
    type: 'round_revealed',
    payload: {
      round: s.round,
      result: result === 'draw' ? 'draw' : 'win',
      winner: result === 'draw' ? undefined : result,
      hands: {
        [p1]: { cards: s.hands[p1].cards, total: handValue(s.hands[p1].cards) },
        [p2]: { cards: s.hands[p2].cards, total: handValue(s.hands[p2].cards) },
      },
    },
  };
}

/**
 * Both players are done → resolve the round, mutating `s`:
 * - decisive  → set `winner` (terminal);
 * - draw      → increment `draws`; at the cap set `forcedOutcome: void`, else re-deal a
 *               fresh round in the same match.
 * Returns the public events for this transition.
 */
function resolveRound(s: BlackjackState): GameEvent[] {
  const result = roundWinner(s);
  const events: GameEvent[] = [revealEvent(s, result)];

  if (result !== 'draw') {
    s.winner = result;
    return events;
  }

  // Draw → it does NOT refund (internal draw, not a contract-draw): replay or, at the cap, void.
  s.draws += 1;
  if (s.draws >= DRAW_CAP) {
    s.forcedOutcome = { type: 'void' };
    events.push({ type: 'match_voided', payload: { reason: 'draw_cap', draws: s.draws } });
    return events;
  }
  s.round += 1;
  deal(s);
  events.push({ type: 'new_round', payload: { round: s.round, draws: s.draws } });
  return events;
}

/**
 * Meta. `rakeRate` is declared per-game (invariant #5: the core reads it generically).
 */
const meta: GameMeta = {
  id: 'blackjack',
  displayName: 'Blackjack',
  minPlayers: 2,
  maxPlayers: 2,
  // net_winnings — chance-dominant, like the other chance games (spec: owner to confirm vs win_rate).
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 60,
  // Blackjack rake: 2.5% of the pot, taken once on the decisive result (never per replay).
  rakeRate: 0.025,
  // Per-player 10s move timer (opt-in core capability): on expiry the core injects
  // `timeoutMove` (→ 'stand') for that player through the normal applyMove path.
  moveTimeoutMs: 10000,
};

export const blackjackModule: GameModule = {
  meta,

  init(players: PlayerId[], rng: Rng): GameState {
    // Fix the base seed HERE from the injected rng — every round's decks derive from it,
    // so the whole match (including replays) is deterministic and replayable.
    const state: BlackjackState = {
      players: [players[0], players[1]],
      seed: rng.int(0, 0x7fffffff),
      round: 0,
      draws: 0,
      hands: {},
    };
    deal(state);
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): Action[] {
    const s = cast(state);
    if (terminal(s)) return [];
    const hand = s.hands[playerId];
    if (!hand || hand.done) return []; // not in the match, or already done → waiting
    return [...ACTIONS];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    const hand = s.hands[playerId];

    if (terminal(s) || !hand || hand.done) {
      throw new IllegalMove(`${playerId} cannot act now`);
    }
    if (!isAction(move)) {
      throw new IllegalMove(`"${String(move)}" is not a valid blackjack action`);
    }

    // Work on a fresh copy (never mutate the input state).
    const next: BlackjackState = {
      ...s,
      hands: { ...s.hands, [playerId]: { cards: [...hand.cards], done: hand.done } },
    };
    const me = next.hands[playerId];

    if (move === 'hit') {
      const deck = deckFor(next.seed, next.round, playerIndex(next, playerId));
      const card = deck[me.cards.length];
      if (card === undefined) {
        me.done = true; // deck exhausted (not reachable in normal play) → auto-stand
      } else {
        me.cards.push(card);
        if (handValue(me.cards) > BUST_THRESHOLD) me.done = true; // bust locks the hand
      }
    } else {
      me.done = true; // stand
    }

    // During play, broadcast NOTHING about either hand (the actor sees their own card via
    // viewFor; the opponent must not learn of a hit, a stand, or a bust until the reveal).
    let events: GameEvent[] = [];
    if (next.players.every((p) => next.hands[p].done)) {
      events = resolveRound(next);
    }

    return { state: next, events };
  },

  isTerminal(state: GameState): boolean {
    return terminal(cast(state));
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    // Blackjack only ever reaches a contract-level WIN (internal draws replay; the only
    // non-win terminal is the void above).
    return { type: 'win', winner: s.winner! };
  },

  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    // Terminal → full reveal (both hands + the seed, for verifiability).
    if (terminal(s)) return s;

    // In play → own hand in full; opponent shows EXACTLY ONE card, with hit count and
    // stand/bust status hidden; the seed is stripped (it would reveal the hidden cards).
    const redactedHands: Record<PlayerId, Hand> = {};
    for (const p of s.players) {
      if (p === playerId) {
        redactedHands[p] = s.hands[p];
      } else {
        redactedHands[p] = { cards: s.hands[p].cards.slice(0, 1), done: false };
      }
    }
    return {
      players: s.players,
      round: s.round,
      draws: s.draws,
      hands: redactedHands,
    } as BlackjackState;
  },

  timeoutMove(_state: GameState, _playerId: PlayerId, _rng: Rng): Action {
    // Per spec: a player who lets their 10s timer expire auto-stands on their current
    // total (deterministic — rng unused). The core applies this via the normal applyMove
    // path, so the round resolves/replays exactly as if the player had pressed Stand.
    return 'stand';
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;

    // Disconnect/timeout → auto-stand on current total (NOT an instant forfeit: the dropped
    // player can still win if their total is higher or the opponent busts). The contract's
    // forfeit must return a TERMINAL state, so we stand both at their current totals and run
    // the win matrix; a resulting draw → void (covers "both disconnect → void", and a single
    // disconnect that draws can't replay terminally).
    //
    // NOTE: the spec's richer "auto-stand the dropped player but let a present opponent keep
    // playing / replay on a draw" needs a generic per-player core timer (flagged separately);
    // this is the faithful terminal approximation available through the current contract.
    const next: BlackjackState = {
      ...s,
      hands: Object.fromEntries(
        s.players.map((p) => [p, { cards: [...s.hands[p].cards], done: true }]),
      ) as Record<PlayerId, Hand>,
    };
    const result = roundWinner(next);
    if (result === 'draw') {
      next.forcedOutcome = { type: 'void' };
    } else {
      next.winner = result;
    }
    return next;
  },
};
