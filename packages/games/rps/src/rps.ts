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

type RpsChoice = 'rock' | 'paper' | 'scissors';

const CHOICES = ['rock', 'paper', 'scissors'] as const;

interface RpsState {
  players: [PlayerId, PlayerId];
  choices: Partial<Record<PlayerId, RpsChoice>>;
  /** Present only when the match ended via forfeit, bypassing normal choice resolution. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): RpsState {
  return state as RpsState;
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
  },

  init(players: PlayerId[], _rng: Rng): GameState {
    const state: RpsState = { players: [players[0], players[1]], choices: {} };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): RpsChoice[] {
    const { choices, forcedOutcome } = cast(state);
    if (forcedOutcome !== undefined || playerId in choices) return [];
    return [...CHOICES];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    if (s.forcedOutcome !== undefined || playerId in s.choices) {
      throw new IllegalMove(`${playerId} has already chosen`);
    }
    if (!isChoice(move)) {
      throw new IllegalMove(`"${String(move)}" is not a valid RPS choice`);
    }
    const newState: RpsState = { ...s, choices: { ...s.choices, [playerId]: move } };
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
    const { players, choices, forcedOutcome } = cast(state);
    if (forcedOutcome !== undefined) return forcedOutcome;
    const [p1, p2] = players;
    const c1 = choices[p1]!;
    const c2 = choices[p2]!;
    const result = beats(c1, c2);
    if (result === 0) return { type: 'draw' };
    return { type: 'win', winner: result === 1 ? p1 : p2 };
  },

  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    const terminal = s.forcedOutcome !== undefined || s.players.every((p) => p in s.choices);
    if (terminal) return s;
    // Redact: include only the viewing player's own choice.
    const redacted: Partial<Record<PlayerId, RpsChoice>> = {};
    const own = s.choices[playerId];
    if (own !== undefined) redacted[playerId] = own;
    return { ...s, choices: redacted };
  },

  forfeit(state: GameState, quitter: PlayerId): GameState {
    const s = cast(state);
    const opponent = s.players.find((p) => p !== quitter);
    const opponentChose = opponent !== undefined && opponent in s.choices;
    const forcedOutcome: Outcome = opponentChose
      ? { type: 'win', winner: opponent as PlayerId }
      : { type: 'void' };
    return { ...s, forcedOutcome };
  },
};
