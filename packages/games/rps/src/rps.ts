import type {
  ApplyResult,
  GameEvent,
  GameModule,
  GameState,
  MoveContext,
  Outcome,
  PlayerId,
  Rng,
} from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';

type RpsChoice = 'rock' | 'paper' | 'scissors';

const CHOICES = ['rock', 'paper', 'scissors'] as const;

/** Consecutive ties (same throw) before the match voids (refund both, no rake) — the universal
 *  tie rule (CHARTER.md). A tie is NOT terminal; it re-deals a fresh throw in the same escrow. */
const REPLAY_CAP = 10;

interface RpsState {
  players: [PlayerId, PlayerId];
  choices: Partial<Record<PlayerId, RpsChoice>>;
  /** Current round (0-based; bumped on each tie replay). Public scaffolding. */
  round: number;
  /** Consecutive ties so far. */
  replays: number;
  /** A decided round → terminal. */
  winner?: PlayerId;
  /** Present when the match ended via forfeit, or voided at the replay cap. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): RpsState {
  return state as RpsState;
}

function terminal(s: RpsState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}

/** Resolve once both have thrown: a decisive throw sets the winner (terminal); a TIE (same throw)
 *  re-deals a fresh round in the same escrow — at REPLAY_CAP it voids. Mutates `s`. */
function resolve(s: RpsState): GameEvent[] {
  const [p1, p2] = s.players;
  const r = beats(s.choices[p1]!, s.choices[p2]!);
  if (r !== 0) {
    s.winner = r === 1 ? p1 : p2;
    return [{ type: 'match_decided', payload: { winner: s.winner } }];
  }
  // Tie → not terminal: replay (the universal tie rule), or void at the cap.
  s.replays += 1;
  if (s.replays >= REPLAY_CAP) {
    s.forcedOutcome = { type: 'void' };
    return [{ type: 'match_voided', payload: { reason: 'replay_cap', replays: s.replays } }];
  }
  s.round += 1;
  s.choices = {};
  return [{ type: 'new_round', payload: { round: s.round, replays: s.replays } }];
}

function isChoice(v: unknown): v is RpsChoice {
  return typeof v === 'string' && (CHOICES as readonly string[]).includes(v);
}

/** Returns 1 if a beats b, -1 if b beats a, 0 for a tie. */
function beats(a: RpsChoice, b: RpsChoice): -1 | 0 | 1 {
  if (a === b) return 0;
  if (
    (a === 'rock' && b === 'scissors') ||
    (a === 'scissors' && b === 'paper') ||
    (a === 'paper' && b === 'rock')
  ) {
    return 1;
  }
  return -1;
}

export const rpsModule: GameModule = {
  meta: {
    id: 'rps',
    displayName: 'Rock Paper Scissors',
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'win_rate' },
    bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 10,
    rakeRate: 0.025, // 2.5% of the pot from the winner on a decisive result
  },

  init(players: PlayerId[], _rng: Rng): GameState {
    const state: RpsState = { players: [players[0], players[1]], choices: {}, round: 0, replays: 0 };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): RpsChoice[] {
    const s = cast(state);
    if (terminal(s) || playerId in s.choices) return [];
    return [...CHOICES];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    if (terminal(s) || playerId in s.choices) {
      throw new IllegalMove(`${playerId} has already chosen`);
    }
    if (!isChoice(move)) {
      throw new IllegalMove(`"${String(move)}" is not a valid RPS choice`);
    }
    const next: RpsState = { ...s, choices: { ...s.choices, [playerId]: move } };
    // Only announce THAT a choice was made (never the throw — hidden until terminal).
    const events: GameEvent[] = [{ type: 'move_made', payload: { playerId } }];
    if (next.players.every((p) => p in next.choices)) events.push(...resolve(next));
    return { state: next, events };
  },

  isTerminal(state: GameState): boolean {
    return terminal(cast(state));
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    // The only non-void terminal is a decisive winner — a tie replays, never resolves here.
    return { type: 'win', winner: s.winner! };
  },

  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    // Redact: include only the viewing player's own choice (round/replays stay public).
    const redacted: Partial<Record<PlayerId, RpsChoice>> = {};
    const own = s.choices[playerId];
    if (own !== undefined) redacted[playerId] = own;
    return { ...s, choices: redacted };
  },

  forfeit(state: GameState, quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    const opponent = s.players.find((p) => p !== quitter);
    const opponentChose = opponent !== undefined && opponent in s.choices;
    const forcedOutcome: Outcome = opponentChose
      ? { type: 'win', winner: opponent as PlayerId }
      : { type: 'void' };
    return { ...s, forcedOutcome };
  },
};
