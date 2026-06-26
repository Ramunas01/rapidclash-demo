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
  PICK_TIMEOUT_MS,
  REPLAY_CAP,
  TARGET_LADDER,
  autoTargetFor,
  decideRoll,
  isLadderTarget,
  rollFor,
} from './roll.js';

/**
 * Limbo — PvP nerve duel (docs/LIMBO.md). Both players secretly pick a target multiplier; one
 * shared zero-edge roll `R = 1/u` falls; the bravery-vs-caution rule decides it. The payout curve
 * is set to zero house edge by construction (survival(t) = 1/t), so the contest is purely between
 * the two targets.
 *
 * Same shared-event hidden-pick family as Roulette/Keno: the target accrues in HIDDEN state via
 * enumerable `pick` moves (a quantised ladder — the core validates moves by JSON-equality, so an
 * arbitrary float can't be submitted); `lock` freezes it; `auto` (also the timeout auto-move)
 * assigns a seeded target and locks. `viewFor` hides each target + `R` until reveal. A push (equal
 * targets or both bust) → internal replay; REPLAY_CAP → void + refund.
 */

type LimboMove =
  | { t: 'pick'; target: number } // choose a ladder target (re-pickable until locked)
  | { t: 'lock' } // freeze — REJECTED unless a target is chosen
  | { t: 'auto' }; // auto-assign a seeded target + lock (timeout / auto path)

interface PlayerPick {
  /** Chosen target multiplier (a ladder value), hidden from the opponent until both lock. */
  target: number | null;
  locked: boolean;
  /** Locked via the auto-assign path (timeout, or the explicit `auto` move). */
  auto: boolean;
}

interface RoundResult {
  round: number;
  roll: number;
  targets: Record<PlayerId, number>;
  winner: PlayerId | null; // null = push (equal targets or both bust)
}

interface LimboState {
  players: [PlayerId, PlayerId];
  seed: number;
  round: number;
  replays: number;
  picks: Record<PlayerId, PlayerPick>;
  lastResult?: RoundResult;
  winner?: PlayerId;
  forcedOutcome?: Outcome;
}

function cast(state: GameState): LimboState {
  return state as LimboState;
}
function terminal(s: LimboState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}
function freshPick(): PlayerPick {
  return { target: null, locked: false, auto: false };
}
function bothLocked(s: LimboState): boolean {
  return s.players.every((p) => s.picks[p].locked);
}

/**
 * Once BOTH players are locked: reveal, roll the seeded `R`, and decide per the bravery rule
 * (R ≥ both → higher wins; R between → lower survivor wins; R < both or equal targets → push). A
 * decisive result is terminal; a push replays (fresh round; at REPLAY_CAP → void). Mutates `s`.
 */
function resolve(s: LimboState): GameEvent[] {
  if (!bothLocked(s) || terminal(s)) return [];
  const [p1, p2] = s.players;
  const roll = rollFor(s.seed, s.round);
  const t1 = s.picks[p1].target!;
  const t2 = s.picks[p2].target!;
  const d = decideRoll(roll, t1, t2);
  const winner = d === 'push' ? null : d === 'a' ? p1 : p2;
  s.lastResult = { round: s.round, roll, targets: { [p1]: t1, [p2]: t2 }, winner };
  const events: GameEvent[] = [{ type: 'round_resolved', payload: s.lastResult }];

  if (winner !== null) {
    s.winner = winner;
    events.push({ type: 'match_decided', payload: { winner } });
    return events;
  }
  s.replays += 1;
  if (s.replays >= REPLAY_CAP) {
    s.forcedOutcome = { type: 'void' };
    events.push({ type: 'match_voided', payload: { reason: 'replay_cap', replays: s.replays } });
    return events;
  }
  s.round += 1;
  s.picks = { [p1]: freshPick(), [p2]: freshPick() } as Record<PlayerId, PlayerPick>;
  events.push({ type: 'new_round', payload: { round: s.round, replays: s.replays } });
  return events;
}

const meta: GameMeta = {
  id: 'limbo',
  displayName: 'Limbo',
  minPlayers: 2,
  maxPlayers: 2,
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 12,
  rakeRate: 0.025,
  // 10s pick window via the core's generic per-player move timer; on expiry → `auto` (seeded target).
  moveTimeoutMs: PICK_TIMEOUT_MS,
};

export const limboModule: GameModule = {
  meta,

  init(players: PlayerId[], rng: Rng): GameState {
    const state: LimboState = {
      players: [players[0], players[1]],
      seed: rng.int(0, 0x7fffffff),
      round: 0,
      replays: 0,
      picks: { [players[0]]: freshPick(), [players[1]]: freshPick() } as Record<PlayerId, PlayerPick>,
    };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): Move[] {
    const s = cast(state);
    if (terminal(s)) return [];
    const me = s.picks[playerId];
    if (!me || me.locked) return [];
    const moves: LimboMove[] = TARGET_LADDER.map((target) => ({ t: 'pick', target }));
    if (me.target !== null) moves.push({ t: 'lock' });
    moves.push({ t: 'auto' });
    return moves;
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    const cur = s.picks[playerId];
    if (terminal(s) || !cur || cur.locked) throw new IllegalMove(`${playerId} cannot pick now`);
    const m = move as LimboMove;
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') {
      throw new IllegalMove(`"${String(move)}" is not a valid limbo move`);
    }

    const next: LimboState = { ...s, picks: { ...s.picks, [playerId]: { ...cur } } };
    const me = next.picks[playerId];
    const events: GameEvent[] = [];

    switch (m.t) {
      case 'pick': {
        if (!isLadderTarget(m.target)) throw new IllegalMove(`target ${String(m.target)} is not a selectable multiplier`);
        me.target = m.target;
        break;
      }
      case 'lock': {
        if (me.target === null) throw new IllegalMove('choose a target before lock');
        me.locked = true;
        events.push({ type: 'player_locked', payload: { playerId } });
        break;
      }
      case 'auto': {
        me.target = autoTargetFor(next.seed, next.round, next.players.indexOf(playerId));
        me.locked = true;
        me.auto = true;
        events.push({ type: 'player_locked', payload: { playerId, auto: true } });
        break;
      }
      default:
        throw new IllegalMove(`"${String((m as { t: unknown }).t)}" is not a limbo move`);
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
    const view: LimboState = {
      players: s.players,
      seed: 0, // redacted — seed would reveal the hidden roll
      round: s.round,
      replays: s.replays,
      picks: {
        [playerId]: { target: me.target, locked: me.locked, auto: me.auto },
        [opponentId]: { target: null, locked: s.picks[opponentId].locked, auto: false },
      } as Record<PlayerId, PlayerPick>,
      ...(s.lastResult ? { lastResult: s.lastResult } : {}),
    };
    return view as GameState;
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    const next: LimboState = {
      ...s,
      picks: Object.fromEntries(s.players.map((p) => [p, { ...s.picks[p] }])) as Record<PlayerId, PlayerPick>,
    };
    for (const p of next.players) {
      const me = next.picks[p];
      if (!me.locked) {
        me.target = autoTargetFor(next.seed, next.round, next.players.indexOf(p));
        me.locked = true;
        me.auto = true;
      }
    }
    const [p1, p2] = next.players;
    const roll = rollFor(next.seed, next.round);
    const d = decideRoll(roll, next.picks[p1].target!, next.picks[p2].target!);
    const winner = d === 'push' ? null : d === 'a' ? p1 : p2;
    next.lastResult = { round: next.round, roll, targets: { [p1]: next.picks[p1].target!, [p2]: next.picks[p2].target! }, winner };
    if (winner === null) next.forcedOutcome = { type: 'void' };
    else next.winner = winner;
    return next;
  },

  /** Auto-move injected when a player's 10s pick clock expires (paired with meta.moveTimeoutMs):
   *  auto-assign a seeded ladder target and lock. Deterministic — the seeded target is fixed. */
  timeoutMove(_state: GameState, _playerId: PlayerId, _rng: Rng): Move {
    return { t: 'auto' } satisfies LimboMove;
  },
};

export { MAX_TARGET, MIN_TARGET, PICK_TIMEOUT_MS, REPLAY_CAP, TARGET_LADDER, autoTargetFor, decideRoll, rollFor } from './roll.js';
