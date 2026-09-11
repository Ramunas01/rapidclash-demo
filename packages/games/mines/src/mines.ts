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
import { BOARD_SIZE, MINE_COUNT, SAFE_COUNT, ROUND_TIMEOUT_MS, minesFor } from './board.js';

/** After this many CONSECUTIVE drawn rounds the match voids (refund both, no rake). */
const DRAW_CAP = 10;

/** A move is the index (0..BOARD_SIZE-1) of the square a player uncovers. */
type MinesMove = number;

/** One player's instance of the shared board. */
interface PlayerBoard {
  /** Indices of the SAFE squares this player has uncovered, in reveal order. Its length
   *  is the player's score. A mine is never added here — uncovering one sets `bustedOn`. */
  uncovered: number[];
  /** Busted (hit a mine), cleared (all SAFE_COUNT safe), or timed out → no more moves. */
  locked: boolean;
  /** The mine square that busted this player. Present only once busted. */
  bustedOn?: number;
}

/**
 * JSON-serializable Mines state.
 *
 * Concurrent (not turn-based): both players race their own instance of the SAME board,
 * each running to their OWN completion independently (a mine, the 30s round clock, or a
 * perfect 22-tile clear — whichever comes first for them). There is no early resolution:
 * the match only resolves once BOTH players have locked (Designer ruleset, 2026-09-11,
 * rules 2/3 of the rules-diff answers) — see `decide`.
 *
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
  /** The `now` (ms) at which the CURRENT round's 30s clock started — stamped by `launch` for
   *  round 0, and re-stamped on every draw-replay redeal. 0 until `launch` runs (the core
   *  calls it once, right after `init`, with the match-formation time). Drives
   *  `scheduledDeadlines`: a player's absolute lock time is `roundStartedAt + ROUND_TIMEOUT_MS`,
   *  a fixed cap from round start — never reset by tapping (rule 3). */
  roundStartedAt: number;
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
 * Is the match decided, and if so, what is the result? NO EARLY RESOLUTION (Designer ruleset,
 * 2026-09-11): both players play their own round to completion — independently, via a mine, the
 * clock, or a perfect 22-tile clear — and only once BOTH have locked is a result compared. A
 * locked player being mathematically passed by a still-active opponent is NOT itself a
 * conclusion; the match stays undecided until the opponent's own round also ends. This is a
 * deliberate reversal of the old engine's instant-overtake resolution.
 */
function decide(s: MinesState): { done: boolean; result?: PlayerId | 'draw' } {
  const [p1, p2] = s.players;
  const b1 = s.boards[p1];
  const b2 = s.boards[p2];
  if (!b1.locked || !b2.locked) return { done: false };

  const s1 = score(b1);
  const s2 = score(b2);
  if (s1 === s2) return { done: true, result: 'draw' };
  return { done: true, result: s1 > s2 ? p1 : p2 };
}

/** Re-deal a fresh board to both players for the next round, restarting the round clock from
 *  `now` (each round gets its own full 30s cap — rule 3). Mutates `s`. */
function redeal(s: MinesState, now: number): void {
  s.boards = { [s.players[0]]: freshBoard(), [s.players[1]]: freshBoard() } as Record<PlayerId, PlayerBoard>;
  s.roundStartedAt = now;
}

/**
 * After a player has locked (bust, clear, or timeout) in `s`, resolve the match if the outcome
 * is now decided (i.e. both players are locked):
 *   - decisive → set `winner` (terminal);
 *   - draw     → increment `draws`; at the cap set `forcedOutcome: void`, else re-deal a
 *                fresh round (own clock) in the same match/escrow.
 * Returns the broadcast-safe events for this transition (a tie can only occur with BOTH
 * players locked, so revealing scores here leaks nothing — both are final). `now` threads
 * through to `redeal` so a replay round's clock starts from the moment resolution happened,
 * not some stale value.
 */
function resolve(s: MinesState, now: number): GameEvent[] {
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
  redeal(s, now);
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
  averageDurationSec: 30,
  // Mines rake: 2.5% of the pot (chance game, like Coinflip/RPS), taken once on the
  // decisive result — declared per-game so the core never hard-codes it (invariant #5).
  rakeRate: 0.025,
  // NOTE: no `moveTimeoutMs` — the per-move timer/auto-reveal mechanism is gone entirely
  // (Designer ruleset rule 10). Mines now opts into the core's scheduled-deadline mode
  // (`scheduledDeadlines` + `lockOnTimeout`, ADR-012) instead: one absolute 30s round clock
  // per player, not a per-move budget.
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
      roundStartedAt: 0, // stamped by `launch` at match formation
    };
    return state;
  },

  /** Stamp the round-0 clock start from the match's formation time (the core calls this once,
   *  right after `init`). Every subsequent round (draw replay) re-stamps it in `redeal`. */
  launch(state: GameState, now: number): GameState {
    return { ...cast(state), roundStartedAt: now };
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
    const opponentId = next.players.find((p) => p !== playerId)!;
    const mines = minesFor(next.seed, next.round, BOARD_SIZE, MINE_COUNT);

    const events: GameEvent[] = [];
    if (mines.has(move)) {
      // Hit a mine → bust: lock the board at its current score. NOTE the uncovered SAFE
      // count does not include this square — a bust does not raise the score (rule 5: bust
      // keeps your gems, unchanged from before).
      me.locked = true;
      me.bustedOn = move;
      // The event is broadcast UNREDACTED to both players (GAME_MODULE_INTERFACE.md's
      // redaction rule) — `score` may only ride along if `viewFor` ALSO reveals it to the
      // opponent at this exact instant, i.e. this lock is the one that makes the opponent's
      // side already-locked too (revealOppCount's own `opp.locked && me.locked` gate,
      // mirrored here). Otherwise the still-active opponent would learn the exact target the
      // instant it's set — defeating the whole point of hiding it until both are done.
      events.push({
        type: 'player_locked',
        payload: { playerId, reason: 'bust', ...(next.boards[opponentId].locked ? { score: score(me) } : {}) },
      });
    } else {
      me.uncovered.push(move);
      // No per-safe-reveal event: broadcasting it would let the opponent tally an active
      // player's score, which must stay hidden until BOTH lock. The actor learns their own
      // progress via viewFor. Only a CLEAR (a lock) is announced.
      if (me.uncovered.length === SAFE_COUNT) {
        me.locked = true; // perfect run (all 22 safe tiles) → lock at max score, rule 1 of the
        // rules-diff answers: auto-lock at 22, same mechanism as a bust-lock but no mine.
        events.push({
          type: 'player_locked',
          payload: { playerId, reason: 'cleared', ...(next.boards[opponentId].locked ? { score: SAFE_COUNT } : {}) },
        });
      }
    }

    // Re-evaluate resolution after every move — this only actually resolves once BOTH players
    // are locked (see `decide`); `match_decided`/`new_round`/`match_voided` never fire from one
    // side alone.
    events.push(...resolve(next, ctx.now));

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

    // Terminal → full reveal (both boards + the mine layout + seed, for verifiability). Since
    // early resolution is removed, this branch can only ever fire once BOTH players are done —
    // the one path that could once have exposed the seed prematurely no longer exists.
    if (terminal(s)) {
      return { ...s, mines: [...minesFor(s.seed, s.round, BOARD_SIZE, MINE_COUNT)].sort((a, b) => a - b) } as GameState;
    }

    // Own board: full. The mine layout is revealed ONLY once this player has locked
    // (busted/cleared/timed out) — a locked player has no move left, so it leaks nothing
    // exploitable.
    const myView: PlayerBoard & { mines?: number[] } = {
      uncovered: [...me.uncovered],
      locked: me.locked,
      ...(me.bustedOn !== undefined ? { bustedOn: me.bustedOn } : {}),
      ...(me.locked ? { mines: [...minesFor(s.seed, s.round, BOARD_SIZE, MINE_COUNT)].sort((a, b) => a - b) } : {}),
    };

    // Opponent's BOARD is always hidden, and — Designer ruleset rules 2+3 of the rules-diff
    // answers — their running safe-count now stays hidden for the WHOLE round, revealed ONLY
    // once BOTH players are locked (i.e. only ever alongside the terminal branch above in
    // practice, since a match resolves the instant both lock). While either player is still
    // active, the opponent's count is never shown — no visible target, no chase. The seed is
    // never in an in-play view (it reveals the mines).
    const revealOppCount = opp.locked && me.locked;
    const oppView: { locked: boolean; score?: number } = {
      locked: opp.locked,
      ...(revealOppCount ? { score: score(opp) } : {}),
    };

    return {
      players: s.players,
      round: s.round,
      draws: s.draws,
      // Public per-round timing metadata (T8): when the CURRENT round's 30s clock started.
      // Reveals no mine position or opponent score — the client derives a local countdown
      // as `roundStartedAt + ROUND_TIMEOUT_MS`, mirroring scheduledDeadlines' own math.
      roundStartedAt: s.roundStartedAt,
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
    // NOTE: a mere DISCONNECT does not route here for Mines — the 30s round clock
    // (scheduledDeadlines + lockOnTimeout, ADR-012) locks an absent player at whatever gems
    // they had (including zero) once it expires; no void, no special handling (Designer
    // ruleset, disconnect confirmation). forfeit covers a genuine explicit give-up.
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

  /** OPT-IN absolute per-player deadline (ADR-012): each still-active player's round ends at
   *  `roundStartedAt + ROUND_TIMEOUT_MS` — a single 30s clock from the CURRENT round's start,
   *  never reset by tapping (rule 3: a cap on an idle/disconnected player, not a mechanic). A
   *  locked player has nothing scheduled (the core re-checks `legalMoves` too, but omitting
   *  them here keeps this function's own contract self-evident). */
  scheduledDeadlines(state: GameState): Record<PlayerId, number> {
    const s = cast(state);
    if (s.roundStartedAt === 0 || terminal(s)) return {};
    const out: Record<PlayerId, number> = {};
    for (const p of s.players) {
      if (!s.boards[p].locked) out[p] = s.roundStartedAt + ROUND_TIMEOUT_MS;
    }
    return out;
  },

  /** ADR-012: when `playerId`'s round clock expires, lock them at their CURRENT score — no
   *  move is synthesized (rule 10: nothing happens until the clock; there is no auto-reveal
   *  any more). Mirrors the bust/clear lock exactly, just reached from the clock instead of a
   *  tap: sets `locked = true` and pushes the same `player_locked` event shape, `reason:
   *  'timeout'`. `score` is included only if the opponent is already locked too (same
   *  broadcast-redaction gate as the bust/clear sites in `applyMove` — see there for why).
   *  Then re-evaluates resolution exactly like a normal move would. */
  lockOnTimeout(state: GameState, playerId: PlayerId, now: number): ApplyResult {
    const s = cast(state);
    const board = s.boards[playerId];
    const opponentId = s.players.find((p) => p !== playerId)!;
    const next: MinesState = {
      ...s,
      boards: { ...s.boards, [playerId]: { ...board, locked: true } },
    };
    const events: GameEvent[] = [
      {
        type: 'player_locked',
        payload: { playerId, reason: 'timeout', ...(next.boards[opponentId].locked ? { score: score(board) } : {}) },
      },
    ];
    events.push(...resolve(next, now));
    return { state: next, events };
  },
};

// Re-export the board constants for clients/tests that need them.
export { BOARD_SIZE, MINE_COUNT, SAFE_COUNT, ROUND_TIMEOUT_MS, minesFor };
