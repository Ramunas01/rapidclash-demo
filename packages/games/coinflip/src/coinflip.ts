import type {
  ApplyResult,
  GameModule,
  GameState,
  MoveContext,
  Outcome,
  PlayerId,
  Rng,
} from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';

type Side = 'heads' | 'tails';

const SIDES = ['heads', 'tails'] as const;

interface CoinflipState {
  players: [PlayerId, PlayerId];
  /** Each player's chosen side. Hidden from the opponent (via viewFor) until terminal. */
  choices: Partial<Record<PlayerId, Side>>;
  /** The flip, fixed at init from the seeded rng — a deterministic function of the match
   *  seed, INDEPENDENT of either choice. Hidden by viewFor until the match is terminal. */
  result: Side;
  /** Present only when the match ended via forfeit, bypassing normal choice resolution. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): CoinflipState {
  return state as CoinflipState;
}

function isSide(v: unknown): v is Side {
  return typeof v === 'string' && (SIDES as readonly string[]).includes(v);
}

export const coinflipModule: GameModule = {
  meta: {
    id: 'coinflip',
    displayName: 'Coinflip',
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'net_winnings' },
    bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 5,
  },

  init(players: PlayerId[], rng: Rng): GameState {
    // Fix the flip HERE from the injected rng, so it is a deterministic function of the
    // match seed and INDEPENDENT of either player's choice (which come later).
    const result: Side = SIDES[rng.int(0, 1)];
    const state: CoinflipState = {
      players: [players[0], players[1]],
      choices: {},
      result,
    };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): Side[] {
    const { choices, forcedOutcome } = cast(state);
    // Both players may choose, independently — a player who hasn't chosen yet may.
    if (forcedOutcome !== undefined || playerId in choices) return [];
    return [...SIDES];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    if (s.forcedOutcome !== undefined || playerId in s.choices) {
      throw new IllegalMove(`${playerId} has already chosen`);
    }
    if (!isSide(move)) {
      throw new IllegalMove(`"${String(move)}" is not a valid coin side`);
    }
    const newState: CoinflipState = { ...s, choices: { ...s.choices, [playerId]: move } };
    // Announce only THAT a choice was made — never the side (it stays hidden until terminal).
    return {
      state: newState,
      events: [{ type: 'move_made', payload: { playerId } }],
    };
  },

  isTerminal(state: GameState): boolean {
    const { players, choices, forcedOutcome } = cast(state);
    return forcedOutcome !== undefined || players.every((p) => p in choices);
  },

  outcome(state: GameState): Outcome {
    const { players, choices, result, forcedOutcome } = cast(state);
    if (forcedOutcome !== undefined) return forcedOutcome;
    const [p1, p2] = players;
    const c1 = choices[p1]!;
    const c2 = choices[p2]!;
    // Same side → draw (no flip needed). Different sides → exactly one matches the flip.
    if (c1 === c2) return { type: 'draw' };
    return { type: 'win', winner: c1 === result ? p1 : p2 };
  },

  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    const terminal = s.forcedOutcome !== undefined || s.players.every((p) => p in s.choices);
    // At terminal: reveal both choices AND the flip result.
    if (terminal) return s;
    // Pre-terminal: strip the OPPONENT's choice (keep only the viewer's own) AND the flip.
    const redacted: Partial<Record<PlayerId, Side>> = {};
    const own = s.choices[playerId];
    if (own !== undefined) redacted[playerId] = own;
    const { result: _result, ...rest } = s;
    return { ...rest, choices: redacted };
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    // Abandonment before BOTH have chosen → void (refund both), never a draw. Once both
    // have chosen the match is already terminal, so forfeit only applies pre-resolution.
    const forcedOutcome: Outcome = { type: 'void' };
    return { ...s, forcedOutcome };
  },
};
