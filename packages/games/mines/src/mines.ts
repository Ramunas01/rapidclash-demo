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
import { BOARD_SIZE, MINE_COUNT, SAFE_COUNT, MOVE_TIMEOUT_MS, minesFor } from './board.js';

/** After this many CONSECUTIVE drawn rounds the match voids (refund both, no rake). */
const DRAW_CAP = 10;

/** A move is the index (0..63) of the square a player uncovers. */
type MinesMove = number;

/** One player's instance of the shared board. */
interface PlayerBoard {
  /** Indices of the SAFE squares this player has uncovered, in reveal order. Its length
   *  is the player's score. A mine is never added here — uncovering one sets `bustedOn`. */
  uncovered: number[];
  /** Busted (hit a mine) or cleared (all 48 safe) → no more moves. */
  locked: boolean;
  /** The mine square that busted this player. Present only once busted. */
  bustedOn?: number;
}

/**
 * JSON-serializable Mines state.
 *
 * Concurrent (not turn-based): both players race their own instance of the SAME board.
 * The mine layout is NOT stored — it is re-derived from `seed` + `round` on demand
 * (see board.ts) so a redacted view can never leak it. `seed` itself is stripped from
 * in-play views (it would let a player compute the mines) and revealed only at terminal.
 *
 * A drawn round (equal final scores) re-deals a fresh board in the SAME match/escrow
 * (internal draws are NOT contract-draws). `winner` marks a decisive match (terminal);
 * `forcedOutcome` marks a void (draw cap reached, or a disconnect resolve that drew).
 */
interface MinesState {
  players: [PlayerId, PlayerId];
  /** Base seed (fixed at init from the injected rng); each round derives its layout from it. */
  seed: number;
  /** Current round index, 0-based (bumped on a draw replay). */
  round: number;
  /** Consecutive drawn rounds so far. */
  draws: number;
  boards: Record<PlayerId, PlayerBoard>;
  /** Set when a round produced a decisive winner → the match is terminal. */
  winner?: PlayerId;
  /** Set on void (draw cap, or a disconnect resolve that drew) → the match is terminal. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): MinesState {
  return state as MinesState;
}

function terminal(s: MinesState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}

function score(b: PlayerBoard): number {
  return b.uncovered.length;
}

function freshBoard(): PlayerBoard {
  return { uncovered: [], locked: false };
}

/** The squares a player may still uncover: every square not yet uncovered, while unlocked. */
function coveredSquares(b: PlayerBoard): MinesMove[] {
  if (b.locked) return [];
  const taken = new Set(b.uncovered);
  const covered: MinesMove[] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (!taken.has(i)) covered.push(i);
  }
  return covered;
}

function isSquareIndex(v: unknown): v is MinesMove {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < BOARD_SIZE;
}

/**
 * Is the match decided, and if so, what is the result? A player's score is final only
 * once they LOCK (bust or clear), so resolution can come well before either board is
 * exhausted:
 *   - both locked            → higher score wins; equal → 'draw'.
 *   - one locked at S, other active at S' → decided ONLY when S' > S (the active player
 *                              has irreversibly overtaken and wins); otherwise undecided.
 *   - neither locked         → undecided (no fixed target yet).
 */
function decide(s: MinesState): { done: boolean; result?: PlayerId | 'draw' } {
  const [p1, p2] = s.players;
  const b1 = s.boards[p1];
  const b2 = s.boards[p2];
  const s1 = score(b1);
  const s2 = score(b2);

  if (b1.locked && b2.locked) {
    if (s1 === s2) return { done: true, result: 'draw' };
    return { done: true, result: s1 > s2 ? p1 : p2 };
  }
  if (b1.locked && !b2.locked) {
    return s2 > s1 ? { done: true, result: p2 } : { done: false };
  }
  if (b2.locked && !b1.locked) {
    return s1 > s2 ? { done: true, result: p1 } : { done: false };
  }
  return { done: false };
}

/** Re-deal a fresh board to both players for the next round. Mutates `s`. */
function redeal(s: MinesState): void {
  s.boards = { [s.players[0]]: freshBoard(), [s.players[1]]: freshBoard() } as Record<PlayerId, PlayerBoard>;
}

/**
 * After a move has been applied to `s`, resolve the match if the outcome is now decided:
 *   - decisive → set `winner` (terminal);
 *   - draw     → increment `draws`; at the cap set `forcedOutcome: void`, else re-deal a
 *                fresh round in the same match/escrow.
 * Returns the broadcast-safe events for this transition (a tie can only occur with BOTH
 * players locked, so revealing scores here leaks nothing — both are final).
 */
function resolve(s: MinesState): GameEvent[] {
  const d = decide(s);
  if (!d.done) return [];

  if (d.result !== 'draw') {
    s.winner = d.result;
    return [{ type: 'match_decided', payload: { winner: d.result } }];
  }

  // Tie → it does NOT refund (internal draw, not a contract-draw): replay, or void at the cap.
  s.draws += 1;
  if (s.draws >= DRAW_CAP) {
    s.forcedOutcome = { type: 'void' };
    return [{ type: 'match_voided', payload: { reason: 'draw_cap', draws: s.draws } }];
  }
  s.round += 1;
  redeal(s);
  return [{ type: 'new_round', payload: { round: s.round, draws: s.draws } }];
}

const meta: GameMeta = {
  id: 'mines',
  displayName: 'Mines',
  minPlayers: 2,
  maxPlayers: 2,
  // net_winnings — a chance game, like Coinflip (spec: owner to confirm).
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 45,
  // Mines rake: 2.5% of the pot (chance game, like Coinflip/RPS), taken once on the
  // decisive result — declared per-game so the core never hard-codes it (invariant #5).
  rakeRate: 0.025,
  // Opt into the core's generic per-player move timer (#91): each player gets an
  // independent 5s clock; on expiry the core injects `timeoutMove` for them. This is
  // what makes the concurrent race work and the spec's disconnect behaviour fall out
  // (a dropped player is just one whose every move times out → auto-revealed to a lock).
  moveTimeoutMs: MOVE_TIMEOUT_MS,
};

export const minesModule: GameModule = {
  meta,

  init(players: PlayerId[], rng: Rng): GameState {
    // Fix the base seed HERE from the injected rng — every round's layout derives from it,
    // so the whole match (including replays) is deterministic and replayable. Both players
    // get the IDENTICAL layout (minesFor ignores the player) — a pure equal-chance race.
    const state: MinesState = {
      players: [players[0], players[1]],
      seed: rng.int(0, 0x7fffffff),
      round: 0,
      draws: 0,
      boards: { [players[0]]: freshBoard(), [players[1]]: freshBoard() } as Record<PlayerId, PlayerBoard>,
    };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): MinesMove[] {
    const s = cast(state);
    if (terminal(s)) return [];
    const board = s.boards[playerId];
    if (!board || board.locked) return []; // not in the match, or locked → waiting
    return coveredSquares(board);
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    const board = s.boards[playerId];

    if (terminal(s) || !board || board.locked) {
      throw new IllegalMove(`${playerId} cannot move now`);
    }
    if (!isSquareIndex(move)) {
      throw new IllegalMove(`"${String(move)}" is not a valid square`);
    }
    if (board.uncovered.includes(move)) {
      throw new IllegalMove(`square ${move} is already uncovered`);
    }

    // Work on a fresh copy (never mutate the input state).
    const next: MinesState = {
      ...s,
      boards: {
        ...s.boards,
        [playerId]: { uncovered: [...board.uncovered], locked: board.locked, bustedOn: board.bustedOn },
      },
    };
    const me = next.boards[playerId];
    const mines = minesFor(next.seed, next.round);

    const events: GameEvent[] = [];
    if (mines.has(move)) {
      // Hit a mine → bust: lock the board at its current score. NOTE the uncovered SAFE
      // count does not include this square — a bust does not raise the score.
      me.locked = true;
      me.bustedOn = move;
      // Broadcast-safe: a lock reveals this player's now-final score (the opponent is
      // allowed to know the target once a player locks — see viewFor).
      events.push({ type: 'player_locked', payload: { playerId, reason: 'bust', score: score(me) } });
    } else {
      me.uncovered.push(move);
      // No per-safe-reveal event: broadcasting it would let the opponent tally an active
      // player's score, which must stay hidden until they lock. The actor learns their own
      // progress via viewFor. Only a CLEAR (a lock) is announced.
      if (me.uncovered.length === SAFE_COUNT) {
        me.locked = true; // perfect run → lock at max score, NOT a bust
        events.push({ type: 'player_locked', payload: { playerId, reason: 'cleared', score: SAFE_COUNT } });
      }
    }

    // Re-evaluate resolution after every move — `match_decided`/`new_round`/`match_voided`
    // may fire the instant the line is crossed, mid-play.
    events.push(...resolve(next));

    return { state: next, events };
  },

  isTerminal(state: GameState): boolean {
    return terminal(cast(state));
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    // Mines only ever reaches a contract-level WIN (internal draws replay; the only
    // non-win terminal is the void above).
    return { type: 'win', winner: s.winner! };
  },

  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    const me = s.boards[playerId];
    const opponentId = s.players.find((p) => p !== playerId)!;
    const opp = s.boards[opponentId];

    // Terminal → full reveal (both boards + the mine layout + seed, for verifiability).
    if (terminal(s)) {
      return { ...s, mines: [...minesFor(s.seed, s.round)].sort((a, b) => a - b) } as GameState;
    }

    // Own board: full. The mine layout is revealed ONLY once this player has locked
    // (busted/cleared) — a locked player has no move left, so it leaks nothing exploitable.
    const myView: PlayerBoard & { mines?: number[] } = {
      uncovered: [...me.uncovered],
      locked: me.locked,
      ...(me.bustedOn !== undefined ? { bustedOn: me.bustedOn } : {}),
      ...(me.locked ? { mines: [...minesFor(s.seed, s.round)].sort((a, b) => a - b) } : {}),
    };

    // Opponent's BOARD is always hidden. Their running safe-count is revealed only when
    // EITHER player is locked: once the opponent locks it is the fixed target you race;
    // once YOU lock you watch their live count climb (the chase). While both are active,
    // the count stays hidden. The seed is never in an in-play view (it reveals the mines).
    const revealOppCount = opp.locked || me.locked;
    const oppView: { locked: boolean; score?: number } = {
      locked: opp.locked,
      ...(revealOppCount ? { score: score(opp) } : {}),
    };

    return {
      players: s.players,
      round: s.round,
      draws: s.draws,
      boards: { [playerId]: myView, [opponentId]: oppView },
    } as GameState;
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;

    // Explicit abandon/quit. NOT an instant void: lock both players at their CURRENT
    // scores and compare (higher wins) — the quitter can still win if they were ahead, the
    // present player wins if ahead; an equal score (incl. a 0–0 pre-first-move abandon)
    // → void. The single-call forfeit contract must return a terminal state, so this
    // stands both where they are.
    //
    // NOTE: a mere DISCONNECT does not route here for Mines — opting into the per-player
    // timer (meta.moveTimeoutMs + timeoutMove) means the core keeps auto-revealing random
    // squares for the absent player until they lock (the spec's "no void" disconnect),
    // resolving via the normal applyMove path. forfeit covers a genuine give-up.
    const next: MinesState = {
      ...s,
      boards: Object.fromEntries(
        s.players.map((p) => [p, { ...s.boards[p], uncovered: [...s.boards[p].uncovered], locked: true }]),
      ) as Record<PlayerId, PlayerBoard>,
    };

    const d = decide(next);
    if (d.result === 'draw') {
      next.forcedOutcome = { type: 'void' };
    } else {
      next.winner = d.result;
    }
    return next;
  },

  /**
   * The auto-move the core injects when `playerId`'s per-player clock expires (paired with
   * `meta.moveTimeoutMs`, #91): a random still-covered square — which may itself be a mine,
   * exactly like a manual pick. Returns a move in `legalMoves(state, playerId)`; the core
   * supplies the match's seeded rng so the whole match stays deterministic/replayable.
   */
  timeoutMove(state: GameState, playerId: PlayerId, rng: Rng): Move {
    const s = cast(state);
    const board = s.boards[playerId];
    const covered = board ? coveredSquares(board) : [];
    if (covered.length === 0) {
      throw new IllegalMove(`${playerId} has no covered square to auto-reveal`);
    }
    return covered[rng.int(0, covered.length - 1)];
  },
};

// Re-export the board constants for clients/tests that need them.
export { BOARD_SIZE, MINE_COUNT, SAFE_COUNT, MOVE_TIMEOUT_MS, minesFor };
