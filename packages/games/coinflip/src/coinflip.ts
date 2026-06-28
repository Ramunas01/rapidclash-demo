import type {
  ApplyResult,
  GameModule,
  GameState,
  Move,
  MoveContext,
  Outcome,
  PlayerId,
  Rng,
} from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';

type Side = 'heads' | 'tails';

const SIDES = ['heads', 'tails'] as const;

/** The pick window (ms). The core runs this as a generic per-player move timer (opt-in via
 *  `meta.moveTimeoutMs`); on expiry it injects `timeoutMove` (a seeded auto-pick) so a round
 *  where a player never chooses still resolves — same capability Keno/Limbo declare. The client
 *  renders a cosmetic countdown of the same length; the SERVER clock is authoritative. */
export const PICK_TIMEOUT_MS = 10_000;

interface CoinflipState {
  players: [PlayerId, PlayerId];
  /** Each player's chosen side. Hidden from the opponent (via viewFor) until terminal. */
  choices: Partial<Record<PlayerId, Side>>;
  /** The flip, fixed at init from the seeded rng — a deterministic function of the match
   *  seed, INDEPENDENT of either choice. Hidden by viewFor until the match is terminal. */
  result: Side;
  /** Base seed (fixed at init) for the timeout auto-pick. Redacted pre-terminal (it would let a
   *  player precompute the opponent's auto-pick); never touches the flip `result`. */
  seed: number;
  /** Present only when the match ended via forfeit, bypassing normal choice resolution. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): CoinflipState {
  return state as CoinflipState;
}

function isSide(v: unknown): v is Side {
  return typeof v === 'string' && (SIDES as readonly string[]).includes(v);
}

/** Deterministic seeded auto-pick for a timed-out player (fixed at init → reproducible on replay).
 *  Independent of the flip `result`, so a no-pick player still gets a fair, hidden 50/50 side. */
function autoPickFor(seed: number, playerIndex: number): Side {
  const h = Math.imul(seed ^ ((playerIndex + 1) * 0x9e3779b1), 0x85ebca6b) >>> 0;
  return SIDES[h & 1];
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
    rakeRate: 0.025, // 2.5% of the pot from the winner on a decisive result
    // Opt into the core's generic per-player pick timer (like Keno/Limbo). On expiry the core
    // injects `timeoutMove` (a seeded auto-pick) so the round always resolves; a disconnect during
    // the window rides to this timeout rather than an instant forfeit (generic `usesPlayerTimers`).
    moveTimeoutMs: PICK_TIMEOUT_MS,
  },

  init(players: PlayerId[], rng: Rng): GameState {
    // Fix the flip HERE from the injected rng, so it is a deterministic function of the
    // match seed and INDEPENDENT of either player's choice (which come later). Draw `result`
    // first so existing flip-seed assertions are unchanged, then the auto-pick seed.
    const result: Side = SIDES[rng.int(0, 1)];
    const state: CoinflipState = {
      players: [players[0], players[1]],
      choices: {},
      result,
      seed: rng.int(0, 0x7fffffff),
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
    // Pre-terminal: strip the OPPONENT's choice (keep only the viewer's own), the flip, AND the
    // seed (it would let either player precompute the opponent's timeout auto-pick).
    const redacted: Partial<Record<PlayerId, Side>> = {};
    const own = s.choices[playerId];
    if (own !== undefined) redacted[playerId] = own;
    const { result: _result, seed: _seed, ...rest } = s;
    return { ...rest, seed: 0, choices: redacted };
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    // Abandonment before BOTH have chosen → void (refund both), never a draw. Once both
    // have chosen the match is already terminal, so forfeit only applies pre-resolution.
    const forcedOutcome: Outcome = { type: 'void' };
    return { ...s, forcedOutcome };
  },

  /** Auto-move the core injects when a player's pick clock (meta.moveTimeoutMs) expires: a seeded
   *  side, fixed at init. Deterministic (reproducible on replay) and independent of the flip. */
  timeoutMove(state: GameState, playerId: PlayerId, _rng: Rng): Move {
    const s = cast(state);
    if (s.forcedOutcome !== undefined || playerId in s.choices) {
      throw new IllegalMove(`${playerId} has nothing to auto-pick`);
    }
    return autoPickFor(s.seed, s.players.indexOf(playerId));
  },
};
