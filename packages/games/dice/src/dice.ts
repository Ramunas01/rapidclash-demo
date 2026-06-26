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
 * Dice — the reference implementation of the INDEPENDENT-ROLL pattern (docs/DICE.md). The house
 * Dice (roll over/under a chosen line, the house pays adjusted odds) reduced to its honest core:
 * each player gets their OWN seeded roll 0.00–99.99 from a SEPARATE seed, higher wins. No target,
 * no over/under, no house line — and no shared event (unlike Crash/Roulette): fairness is pure
 * STATISTICAL symmetry (identical distributions ⇒ P(A>B)=P(B>A)). No decisions, no timer.
 *
 * State machine: each player commits one `reveal` (auto-fired by the client/bot — there are no
 * choices); once BOTH have committed, the round resolves at the simultaneous reveal. An exact tie
 * (equal to two decimals, ≈1/10,000) → instant internal replay with fresh independent rolls; a
 * 10-replay safety cap → void/refund (the only non-win terminal, like Roulette/Mines). The rolls
 * derive from the two recorded seeds → exact replays. Baccarat reuses this skeleton, swapping the
 * roll for an authentic-rules hand.
 */

const REVEAL = 'reveal';
/** Consecutive exact ties before the match voids (refund both, no rake). */
const REPLAY_CAP = 10;
/** A roll is an integer in [0, ROLL_RANGE) = hundredths of 0.00–99.99 (compared exactly, no float). */
const ROLL_RANGE = 10_000;

/** mulberry32 — a small deterministic PRNG. Each roll is a pure function of (seed, round). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Mix a per-player seed with the round index → a fresh independent draw each replay. */
function mixSeed(seed: number, round: number): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (round >>> 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/** One player's independent roll for `round`: an integer 0..9999 (= 0.00–99.99). Pure & seeded. */
export function rollFor(seed: number, round: number): number {
  return Math.floor(mulberry32(mixSeed(seed, round))() * ROLL_RANGE);
}
/** Display form, e.g. 4237 → "42.37". */
export function formatRoll(roll: number): string {
  return (roll / 100).toFixed(2);
}

/** The final-round result, present once the match resolves (public — shown to both at terminal). */
interface DiceResult {
  rolls: Record<PlayerId, number>;
  round: number; // the deciding round index (= number of ties before it)
}

interface DiceState {
  players: [PlayerId, PlayerId];
  /** A SEPARATE seed per player — the independent-roll point; recorded so the match replays exactly. */
  seeds: Record<PlayerId, number>;
  round: number; // current round (0-based; bumped on each tie replay)
  replays: number; // consecutive ties so far
  /** Who has committed their `reveal`. The round resolves once both have. */
  revealed: Record<PlayerId, boolean>;
  result?: DiceResult; // set at resolution
  winner?: PlayerId;
  forcedOutcome?: Outcome; // void — replay cap reached, or abandoned before resolution
}

function cast(state: GameState): DiceState {
  return state as DiceState;
}
function terminal(s: DiceState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}
function bothRevealed(s: DiceState): boolean {
  return s.players.every((p) => s.revealed[p]);
}

/** Resolve once both players have revealed: compare the round's two independent rolls; a tie
 *  replays with fresh rolls (cap → void), a decisive round sets the winner. Mutates `s`. */
function resolve(s: DiceState): GameEvent[] {
  const [p1, p2] = s.players;
  for (;;) {
    const a = rollFor(s.seeds[p1], s.round);
    const b = rollFor(s.seeds[p2], s.round);
    if (a !== b) {
      s.winner = a > b ? p1 : p2;
      s.result = { rolls: { [p1]: a, [p2]: b }, round: s.round };
      return [{ type: 'resolved', payload: { winner: s.winner, round: s.round } }];
    }
    s.replays += 1;
    if (s.replays >= REPLAY_CAP) {
      s.forcedOutcome = { type: 'void' };
      s.result = { rolls: { [p1]: a, [p2]: b }, round: s.round };
      return [{ type: 'voided', payload: { reason: 'replay_cap', replays: s.replays } }];
    }
    s.round += 1; // tie → fresh independent rolls
  }
}

const meta: GameMeta = {
  id: 'dice',
  displayName: 'Dice',
  minPlayers: 2,
  maxPlayers: 2,
  // Pure chance, compared not against a house but each other → net_winnings, 2.5% rake (like Coinflip).
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 5,
  rakeRate: 0.025,
};

export const diceModule: GameModule = {
  meta,

  init(players: PlayerId[], rng: Rng): GameState {
    // Two SEPARATE seeds — the independent-roll point (vs a single shared seed). Recorded in state.
    const state: DiceState = {
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
    return [REVEAL]; // the lone no-op commit; both players auto-fire it
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    if (terminal(s) || !s.players.includes(playerId) || s.revealed[playerId]) {
      throw new IllegalMove(`${playerId} cannot reveal now`);
    }
    if (move !== REVEAL) throw new IllegalMove(`"${String(move)}" is not a valid move`);

    const next: DiceState = { ...s, revealed: { ...s.revealed, [playerId]: true } };
    // Broadcast-safe: only THAT this player committed — never their roll (hidden until terminal).
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

  /** Neither roll (nor the seeds) leaves the server until the SIMULTANEOUS reveal at terminal —
   *  the integrity of an independent-roll game. Pre-terminal a player sees only the public
   *  scaffolding (round/replays/who has committed). At terminal, both rolls + seeds are revealed. */
  viewFor(state: GameState, _playerId: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s; // full reveal: both seeds + the deciding rolls (provably fair)
    return {
      players: s.players,
      seeds: {}, // redacted — a seed would let a player precompute a roll
      round: s.round,
      replays: s.replays,
      revealed: { ...s.revealed },
    } as GameState;
  },

  /** Abandon before the round resolves → void (refund both), never a draw. Once both have revealed
   *  the match is already terminal, so forfeit only applies pre-resolution. */
  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    return { ...s, forcedOutcome: { type: 'void' } };
  },
};

export { REVEAL, REPLAY_CAP, ROLL_RANGE };
