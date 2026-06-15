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
  /** The caller is the match's first/deterministic player (players[0]). */
  caller: PlayerId;
  /** The caller's call. Public once made; undefined until then. */
  call?: Side;
  /** The flip, fixed at init from the seeded rng — independent of the call.
   *  Hidden by viewFor until the match is terminal. */
  result: Side;
  /** Present only when the match ended via forfeit, bypassing the normal call/flip resolution. */
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
    // Fix the flip HERE from the injected rng, so it is a deterministic function
    // of the match seed and INDEPENDENT of the call that comes later.
    const result: Side = SIDES[rng.int(0, 1)];
    const state: CoinflipState = {
      players: [players[0], players[1]],
      caller: players[0],
      result,
    };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): Side[] {
    const { caller, call, forcedOutcome } = cast(state);
    // Only the caller, only while no call has been made and the match is live.
    if (forcedOutcome !== undefined || call !== undefined || playerId !== caller) return [];
    return [...SIDES];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    if (s.forcedOutcome !== undefined || s.call !== undefined) {
      throw new IllegalMove('the call has already been made');
    }
    if (playerId !== s.caller) {
      throw new IllegalMove(`${playerId} is not the caller`);
    }
    if (!isSide(move)) {
      throw new IllegalMove(`"${String(move)}" is not a valid call`);
    }
    const newState: CoinflipState = { ...s, call: move };
    // The call is public — broadcast it. The flip result stays hidden until terminal (viewFor).
    return {
      state: newState,
      events: [{ type: 'call_made', payload: { playerId, call: move } }],
    };
  },

  isTerminal(state: GameState): boolean {
    const { call, forcedOutcome } = cast(state);
    return call !== undefined || forcedOutcome !== undefined;
  },

  outcome(state: GameState): Outcome {
    const { players, caller, call, result, forcedOutcome } = cast(state);
    if (forcedOutcome !== undefined) return forcedOutcome;
    const opponent = players.find((p) => p !== caller)!;
    // Fair coin, exactly one winner, no draws: caller wins iff the call matches the flip.
    return { type: 'win', winner: call === result ? caller : opponent };
  },

  viewFor(state: GameState, _playerId: PlayerId): GameState {
    const s = cast(state);
    const terminal = s.call !== undefined || s.forcedOutcome !== undefined;
    // The flip is hidden from BOTH players until the match is terminal. The call,
    // once made, is public — but a made call is itself terminal, so it stays visible.
    if (terminal) return s;
    const { result: _result, ...redacted } = s;
    return redacted;
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    // Abandonment before the call → void (both refunded). A call makes the match
    // terminal, so forfeit only ever applies pre-call here.
    if (s.call !== undefined) return s;
    const forcedOutcome: Outcome = { type: 'void' };
    return { ...s, forcedOutcome };
  },
};
