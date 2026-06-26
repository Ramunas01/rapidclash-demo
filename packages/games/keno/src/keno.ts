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
import {
  PICK_COUNT,
  PICK_TIMEOUT_MS,
  POOL_SIZE,
  REPLAY_CAP,
  autofillPicks,
  countMatches,
  drawFor,
} from './draw.js';

/**
 * Keno — PvP shared-draw race (docs/KENO.md). Both players secretly pick PICK_COUNT spots on a
 * 1..POOL_SIZE pool; one shared seeded draw of DRAW_COUNT falls; whoever matched more wins the
 * (play-money) pot. The house paytable is deleted — matches are compared head-to-head.
 *
 * Same shared-event hidden-pick family as Roulette: picks accrue in HIDDEN state via enumerable
 * moves (the core validates moves against `legalMoves` by JSON-equality, so a whole pick-set can't
 * be submitted at once); `lock` is accepted only at exactly PICK_COUNT picks; `autofill` (also the
 * timeout auto-move) completes the set from the seed and locks. `viewFor` hides each player's picks
 * until both lock; the draw stays hidden until the reveal. Equal matches → internal replay (fresh
 * seeded draw + pick phase), the Blackjack/Mines path; REPLAY_CAP → void + refund.
 */

/** The only moves — all JSON-enumerable so they pass the core's legalMoves membership check. */
type KenoMove =
  | { t: 'pick'; n: number } // select a spot (while < PICK_COUNT chosen)
  | { t: 'unpick'; n: number } // deselect a spot
  | { t: 'clear' } // deselect all
  | { t: 'lock' } // freeze — REJECTED unless exactly PICK_COUNT spots are chosen
  | { t: 'autofill' }; // fill to PICK_COUNT from the seed + lock (timeout / auto path)

interface PlayerPicks {
  /** Chosen spots (1..POOL_SIZE), kept hidden from the opponent until both lock. */
  picks: number[];
  locked: boolean;
  /** Locked via the auto-fill path (timeout, or the explicit `autofill` move). */
  autoFilled: boolean;
}

/** A resolved round — public (both were locked), shown to BOTH and carried across an internal
 *  replay so a player can see the draw that just happened. */
interface RoundResult {
  round: number;
  draw: number[];
  picks: Record<PlayerId, number[]>;
  matched: Record<PlayerId, number>;
}

interface KenoState {
  players: [PlayerId, PlayerId];
  seed: number; // base seed (fixed at init); each round's draw + auto-fills derive from it
  round: number; // 0-based; bumped on a replay
  replays: number; // consecutive equal-match replays so far
  picks: Record<PlayerId, PlayerPicks>;
  lastResult?: RoundResult;
  winner?: PlayerId;
  forcedOutcome?: Outcome;
}

function cast(state: GameState): KenoState {
  return state as KenoState;
}
function terminal(s: KenoState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}
function freshPicks(): PlayerPicks {
  return { picks: [], locked: false, autoFilled: false };
}
function bothLocked(s: KenoState): boolean {
  return s.players.every((p) => s.picks[p].locked);
}
const isSpot = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= POOL_SIZE;

/**
 * Once BOTH players are locked: reveal, draw the seeded numbers, count matches, and either decide
 * the match (more matches → winner, terminal) or replay (equal → fresh round; at REPLAY_CAP →
 * void). Mutates `s`; returns broadcast-safe events. Revealing both pick-sets is safe — a
 * resolution can only happen with both locked.
 */
function resolve(s: KenoState): GameEvent[] {
  if (!bothLocked(s) || terminal(s)) return [];
  const [p1, p2] = s.players;
  const draw = drawFor(s.seed, s.round);
  const m1 = countMatches(s.picks[p1].picks, draw);
  const m2 = countMatches(s.picks[p2].picks, draw);
  s.lastResult = {
    round: s.round,
    draw,
    picks: { [p1]: [...s.picks[p1].picks], [p2]: [...s.picks[p2].picks] },
    matched: { [p1]: m1, [p2]: m2 },
  };
  const events: GameEvent[] = [{ type: 'round_resolved', payload: s.lastResult }];

  if (m1 !== m2) {
    s.winner = m1 > m2 ? p1 : p2;
    events.push({ type: 'match_decided', payload: { winner: s.winner } });
    return events;
  }
  s.replays += 1;
  if (s.replays >= REPLAY_CAP) {
    s.forcedOutcome = { type: 'void' };
    events.push({ type: 'match_voided', payload: { reason: 'replay_cap', replays: s.replays } });
    return events;
  }
  s.round += 1;
  s.picks = { [p1]: freshPicks(), [p2]: freshPicks() } as Record<PlayerId, PlayerPicks>;
  events.push({ type: 'new_round', payload: { round: s.round, replays: s.replays } });
  return events;
}

const meta: GameMeta = {
  id: 'keno',
  displayName: 'Keno',
  minPlayers: 2,
  maxPlayers: 2,
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 25,
  rakeRate: 0.025,
  // The 20s pick window reuses the core's generic per-player move timer: one move (the lock) per
  // player; on expiry the core injects `timeoutMove` (→ `autofill`) for them. A disconnect in
  // picking is just a player whose clock expires → auto-fill + proceed (no game-id branch).
  moveTimeoutMs: PICK_TIMEOUT_MS,
};

export const kenoModule: GameModule = {
  meta,

  init(players: PlayerId[], rng: Rng): GameState {
    const state: KenoState = {
      players: [players[0], players[1]],
      seed: rng.int(0, 0x7fffffff),
      round: 0,
      replays: 0,
      picks: { [players[0]]: freshPicks(), [players[1]]: freshPicks() } as Record<PlayerId, PlayerPicks>,
    };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): Move[] {
    const s = cast(state);
    if (terminal(s)) return [];
    const me = s.picks[playerId];
    if (!me || me.locked) return [];
    const chosen = new Set(me.picks);
    const moves: KenoMove[] = [];
    if (me.picks.length < PICK_COUNT) {
      for (let n = 1; n <= POOL_SIZE; n++) if (!chosen.has(n)) moves.push({ t: 'pick', n });
    }
    for (const n of me.picks) moves.push({ t: 'unpick', n });
    if (me.picks.length > 0) moves.push({ t: 'clear' });
    if (me.picks.length === PICK_COUNT) moves.push({ t: 'lock' }); // exact-count rule
    moves.push({ t: 'autofill' }); // timeout / auto-complete; always legal while picking
    return moves;
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    const cur = s.picks[playerId];
    if (terminal(s) || !cur || cur.locked) throw new IllegalMove(`${playerId} cannot pick now`);
    const m = move as KenoMove;
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') {
      throw new IllegalMove(`"${String(move)}" is not a valid keno move`);
    }

    const next: KenoState = {
      ...s,
      picks: { ...s.picks, [playerId]: { ...cur, picks: [...cur.picks] } },
    };
    const me = next.picks[playerId];
    const events: GameEvent[] = [];

    switch (m.t) {
      case 'pick': {
        if (!isSpot(m.n)) throw new IllegalMove(`spot ${String(m.n)} out of range 1..${POOL_SIZE}`);
        if (me.picks.includes(m.n)) throw new IllegalMove(`spot ${m.n} already picked`);
        if (me.picks.length >= PICK_COUNT) throw new IllegalMove(`already picked ${PICK_COUNT} spots`);
        me.picks.push(m.n);
        break;
      }
      case 'unpick': {
        const i = me.picks.indexOf(m.n);
        if (i < 0) throw new IllegalMove(`spot ${String(m.n)} is not picked`);
        me.picks.splice(i, 1);
        break;
      }
      case 'clear': {
        if (me.picks.length === 0) throw new IllegalMove('nothing to clear');
        me.picks = [];
        break;
      }
      case 'lock': {
        // Exact-count rule (mirrors Roulette's full-stack lock): rejected unless PICK_COUNT chosen.
        if (me.picks.length !== PICK_COUNT) {
          throw new IllegalMove(`must pick exactly ${PICK_COUNT} spots before lock (have ${me.picks.length})`);
        }
        me.locked = true;
        events.push({ type: 'player_locked', payload: { playerId } });
        break;
      }
      case 'autofill': {
        me.picks = autofillPicks(next.seed, next.round, next.players.indexOf(playerId), me.picks);
        me.locked = true;
        me.autoFilled = true;
        events.push({ type: 'player_locked', payload: { playerId, auto: true } });
        break;
      }
      default:
        throw new IllegalMove(`"${String((m as { t: unknown }).t)}" is not a keno move`);
    }

    events.push(...resolve(next));
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

  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    const opponentId = s.players.find((p) => p !== playerId)!;
    if (terminal(s)) return { ...s } as GameState;

    const me = s.picks[playerId];
    const view: KenoState = {
      players: s.players,
      seed: 0, // redacted — the seed would let a player compute the hidden draw
      round: s.round,
      replays: s.replays,
      picks: {
        [playerId]: { picks: [...me.picks], locked: me.locked, autoFilled: me.autoFilled },
        [opponentId]: { picks: [], locked: s.picks[opponentId].locked, autoFilled: false },
      } as Record<PlayerId, PlayerPicks>,
      ...(s.lastResult ? { lastResult: s.lastResult } : {}),
    };
    return view as GameState;
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    // Explicit abandon: auto-fill BOTH unlocked players and resolve THIS round to a terminal result
    // (a per-player-timer game's disconnect is handled by the sweep, not this). Tie → void.
    const next: KenoState = {
      ...s,
      picks: Object.fromEntries(s.players.map((p) => [p, { ...s.picks[p], picks: [...s.picks[p].picks] }])) as Record<PlayerId, PlayerPicks>,
    };
    for (const p of next.players) {
      const me = next.picks[p];
      if (!me.locked) {
        me.picks = autofillPicks(next.seed, next.round, next.players.indexOf(p), me.picks);
        me.locked = true;
        me.autoFilled = true;
      }
    }
    const [p1, p2] = next.players;
    const draw = drawFor(next.seed, next.round);
    const m1 = countMatches(next.picks[p1].picks, draw);
    const m2 = countMatches(next.picks[p2].picks, draw);
    next.lastResult = {
      round: next.round,
      draw,
      picks: { [p1]: [...next.picks[p1].picks], [p2]: [...next.picks[p2].picks] },
      matched: { [p1]: m1, [p2]: m2 },
    };
    if (m1 === m2) next.forcedOutcome = { type: 'void' };
    else next.winner = m1 > m2 ? p1 : p2;
    return next;
  },

  /** Auto-move injected when a player's 20s pick clock expires (paired with meta.moveTimeoutMs):
   *  fill to PICK_COUNT from the seed and lock. Deterministic — the seeded auto-fill is fixed. */
  timeoutMove(_state: GameState, _playerId: PlayerId, _rng: Rng): Move {
    return { t: 'autofill' } satisfies KenoMove;
  },
};

export {
  DRAW_COUNT,
  PICK_COUNT,
  PICK_TIMEOUT_MS,
  POOL_SIZE,
  REPLAY_CAP,
  autofillPicks,
  countMatches,
  drawFor,
} from './draw.js';
