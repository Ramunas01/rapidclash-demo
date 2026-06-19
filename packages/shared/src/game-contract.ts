// packages/shared/src/game-contract.ts
// Keystone document — do not alter without an ADR and owner approval.

export type PlayerId = string;

/** Opaque to the core. Must be JSON-serializable. */
export type GameState = unknown;
export type Move = unknown;

/** Injected by the core. Seeded server-side and recorded with the match,
 *  so a match is fully reproducible. Modules MUST use this and never
 *  Math.random, Date.now, or any other ambient nondeterminism. */
export interface Rng {
  /** uniform float in [0, 1) */
  next(): number;
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number;
}

export type RankingType =
  | { kind: 'elo'; k: number } // skill games, e.g. chess
  | { kind: 'glicko' }
  | { kind: 'net_winnings' } // chance games, e.g. coinflip
  | { kind: 'win_rate' };

export interface BetRules {
  minStake: number;
  maxStake: number;
  /** both players commit an equal stake into escrow (true for all demo games) */
  symmetricStake: boolean;
}

export interface GameMeta {
  id: string; // "rps", "coinflip", "chess", ...
  displayName: string;
  minPlayers: number; // 2 for every demo game
  maxPlayers: number;
  ranking: RankingType;
  bet: BetRules;
  averageDurationSec: number; // UX/matchmaking hint
  /** Rake as a fraction of the pot (e.g. 0.025 = 2.5%) taken from the winner on a
   *  decisive result. The core applies this generically at settlement; draw/void take
   *  no rake. Declared per game so the core never branches on the game id (invariant #5). */
  rakeRate: number;
}

export interface MoveContext {
  playerId: PlayerId;
  now: number; // server time in ms, passed in — do not read the clock yourself
}

export interface GameEvent {
  type: string; // e.g. "move_made", "round_revealed"
  payload: unknown; // already safe to broadcast to both players
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[]; // the core relays these to clients
}

/** Outcome is expressed RELATIVE to the pot. The core applies the fee and
 *  writes the ledger. A module never sees or touches a wallet. */
export type Outcome =
  | { type: 'win'; winner: PlayerId }
  | { type: 'draw' } // pot split, fee may or may not apply (core policy)
  | { type: 'void' }; // refund both in full, no fee (e.g. abandoned)

/** Thrown by applyMove when the submitted move is not in legalMoves. */
export class IllegalMove extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'IllegalMove';
  }
}

export interface GameModule {
  meta: GameMeta;

  /** Build the starting state for these players using the injected rng. */
  init(players: PlayerId[], rng: Rng): GameState;

  /** Moves this player may legally make right now. Empty = not their turn / nothing to do. */
  legalMoves(state: GameState, playerId: PlayerId): Move[];

  /** Apply a move. Must reject anything not in legalMoves (throw IllegalMove). */
  applyMove(state: GameState, move: Move, ctx: MoveContext): ApplyResult;

  /** Is the match over? */
  isTerminal(state: GameState): boolean;

  /** Final result. Only defined when isTerminal(state) is true. */
  outcome(state: GameState): Outcome;

  /** Per-player redacted view. The opponent's hidden information
   *  (concealed RPS move, face-down cards) MUST be stripped here so it
   *  never leaves the server. Default for perfect-information games
   *  (chess): return state unchanged. */
  viewFor(state: GameState, playerId: PlayerId): GameState;

  /** What happens if a player abandons/times out mid-match. The core calls
   *  this to get a terminal state; typically the remaining player wins,
   *  or void if it was pre-first-move. */
  forfeit(state: GameState, quitter: PlayerId): GameState;
}
