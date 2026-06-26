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
import { type Card, MATCH_CAP_MS, REPLAY_CAP, SEQ_LEN, callCorrect, cardFor } from './deck.js';

/**
 * Hilo — PvP symmetric streak race (docs/HILO.md). Both players run the SAME seeded card sequence,
 * each seeing only their own card + progress; on each card they call hi/lo for the next. Correct
 * (or an equal rank) advances + extends the streak; wrong busts. A shared 30 s match clock caps the
 * round: at 0 every un-busted streak freezes. The longer correct streak wins the (play-money) pot.
 *
 * Timer: this is the SHARED-DEADLINE mode (Crash's generic hooks) — `launch` stamps the clock start
 * at formation, `scheduledDeadlines` reports the shared end time for each still-active player, and
 * the core injects `timeoutMove` (→ `timeout`, freeze) when it fires. No per-player move budget, no
 * game-id branch. An internal replay (equal streaks) re-deals a fresh sequence + clock; REPLAY_CAP
 * → void. Redaction: each player is sent only their own card/streak; future cards are never sent
 * ahead of the call; the opponent's progress is hidden until terminal.
 */

type HiloMove = { t: 'hi' } | { t: 'lo' } | { t: 'timeout' };

interface PlayerProgress {
  /** Index of the card currently faced (== correct streak so far; both start at 0). */
  position: number;
  /** Busted on a wrong call (streak frozen at `position`). */
  busted: boolean;
  /** Frozen by the shared 30 s cap (streak frozen, NOT busted). */
  frozen: boolean;
  /** The card that busted this player — present only once busted (their own info). */
  bustCard?: Card;
}

interface RoundResult {
  round: number;
  streaks: Record<PlayerId, number>;
}

interface HiloState {
  players: [PlayerId, PlayerId];
  seed: number;
  round: number;
  replays: number;
  /** Shared match-clock start (ms); 0 until `launch`. Reset to the move `now` on a replay. */
  startedAt: number;
  /** Shared match-clock end (ms): startedAt + MATCH_CAP_MS. */
  endsAt: number;
  progress: Record<PlayerId, PlayerProgress>;
  lastResult?: RoundResult;
  winner?: PlayerId;
  forcedOutcome?: Outcome;
}

function cast(state: GameState): HiloState {
  return state as HiloState;
}
function terminal(s: HiloState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}
function freshProgress(): PlayerProgress {
  return { position: 0, busted: false, frozen: false };
}
/** A player is finished when they bust, freeze, or exhaust the sequence — no more calls. */
function finished(p: PlayerProgress): boolean {
  return p.busted || p.frozen || p.position >= SEQ_LEN;
}
function bothFinished(s: HiloState): boolean {
  return s.players.every((p) => finished(s.progress[p]));
}

/**
 * Once BOTH players are finished (busted / frozen / exhausted): compare streaks. Higher wins
 * (terminal); equal → internal replay (fresh sequence + a fresh shared clock from `now`); at
 * REPLAY_CAP → void. Mutates `s`; returns broadcast-safe events (only the streaks — both final).
 */
function resolve(s: HiloState, now: number): GameEvent[] {
  if (!bothFinished(s) || terminal(s)) return [];
  const [p1, p2] = s.players;
  const s1 = s.progress[p1].position;
  const s2 = s.progress[p2].position;
  s.lastResult = { round: s.round, streaks: { [p1]: s1, [p2]: s2 } };
  const events: GameEvent[] = [{ type: 'round_resolved', payload: s.lastResult }];

  if (s1 !== s2) {
    s.winner = s1 > s2 ? p1 : p2;
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
  s.progress = { [p1]: freshProgress(), [p2]: freshProgress() } as Record<PlayerId, PlayerProgress>;
  // Fresh shared clock for the new round, from the move that triggered the replay.
  s.startedAt = now;
  s.endsAt = now + MATCH_CAP_MS;
  events.push({ type: 'new_round', payload: { round: s.round, replays: s.replays } });
  return events;
}

const meta: GameMeta = {
  id: 'hilo',
  displayName: 'Hilo',
  minPlayers: 2,
  maxPlayers: 2,
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 30,
  rakeRate: 0.025,
  // No per-player budget — the shared 30s cap is an ABSOLUTE scheduled deadline (see launch +
  // scheduledDeadlines + timeoutMove below). The core drives it through the same generic sweep.
};

export const hiloModule: GameModule = {
  meta,

  init(players: PlayerId[], rng: Rng): GameState {
    const state: HiloState = {
      players: [players[0], players[1]],
      seed: rng.int(0, 0x7fffffff),
      round: 0,
      replays: 0,
      startedAt: 0, // stamped by `launch` at formation
      endsAt: 0,
      progress: { [players[0]]: freshProgress(), [players[1]]: freshProgress() } as Record<PlayerId, PlayerProgress>,
    };
    return state;
  },

  /** Generic formation hook: start the shared match clock at the formation `now`. */
  launch(state: GameState, now: number): GameState {
    const s = cast(state);
    return { ...s, startedAt: now, endsAt: now + MATCH_CAP_MS };
  },

  legalMoves(state: GameState, playerId: PlayerId): Move[] {
    const s = cast(state);
    if (terminal(s)) return [];
    const me = s.progress[playerId];
    if (!me || finished(me)) return [];
    // hi/lo are the player's calls; `timeout` is the cap's auto-freeze (kept legal so the scheduled
    // sweep can inject it — the UI ignores it, the bot filters to hi/lo). Time-independent: the cap
    // is enforced from ctx.now in applyMove + the scheduled deadline, not here.
    return [{ t: 'hi' }, { t: 'lo' }, { t: 'timeout' }];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId, now } = ctx;
    const cur = s.progress[playerId];
    if (terminal(s) || !cur || finished(cur)) throw new IllegalMove(`${playerId} cannot call now`);
    const m = move as HiloMove;
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') {
      throw new IllegalMove(`"${String(move)}" is not a valid hilo move`);
    }

    const next: HiloState = {
      ...s,
      progress: { ...s.progress, [playerId]: { ...cur } },
    };
    const me = next.progress[playerId];
    const events: GameEvent[] = [];

    if (m.t === 'timeout') {
      // The shared cap auto-freeze (also enforces the cap on a late human call below).
      me.frozen = true;
      events.push({ type: 'player_frozen', payload: { playerId, streak: me.position } });
    } else if (m.t === 'hi' || m.t === 'lo') {
      // The cap is authoritative from ctx.now: a call at/after the deadline is rejected (the sweep
      // will freeze the player). Guard only once the clock has actually started.
      if (next.startedAt > 0 && now >= next.endsAt) {
        throw new IllegalMove('the match clock has expired');
      }
      const current = cardFor(next.seed, next.round, me.position);
      const upcoming = cardFor(next.seed, next.round, me.position + 1);
      if (callCorrect(m.t, current, upcoming)) {
        me.position += 1; // correct (or equal rank) → advance, streak++
        events.push({ type: 'player_advanced', payload: { playerId, streak: me.position } });
      } else {
        me.busted = true;
        me.bustCard = upcoming;
        events.push({ type: 'player_busted', payload: { playerId, streak: me.position } });
      }
    } else {
      throw new IllegalMove(`"${String((m as { t: unknown }).t)}" is not a hilo move`);
    }

    events.push(...resolve(next, now));
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

    // Terminal → full reveal (seed + both streaks) for verifiability.
    if (terminal(s)) return { ...s } as GameState;

    // In play: my own card + progress only; the opponent's progress is entirely hidden; the seed is
    // stripped (it would let me compute future cards). The shared clock (startedAt/endsAt) is public.
    const me = s.progress[playerId];
    const myView: PlayerProgress & { card?: Card } = {
      position: me.position,
      busted: me.busted,
      frozen: me.frozen,
      ...(me.bustCard ? { bustCard: me.bustCard } : {}),
      // The current card I'm facing (never the next one — that's revealed only by my call).
      ...(finished(me) ? {} : { card: cardFor(s.seed, s.round, me.position) }),
    };
    const view: HiloState = {
      players: s.players,
      seed: 0, // redacted
      round: s.round,
      replays: s.replays,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      progress: {
        [playerId]: myView as PlayerProgress,
        [opponentId]: {} as PlayerProgress, // hidden until terminal
      } as Record<PlayerId, PlayerProgress>,
      ...(s.lastResult ? { lastResult: s.lastResult } : {}),
    };
    return view as GameState;
  },

  forfeit(state: GameState, quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    // Explicit abandon: freeze BOTH players where they are and compare (the quitter can still win if
    // they were ahead). A per-player-timer game's disconnect is handled by the sweep; this is a
    // genuine give-up. Tie → void.
    const next: HiloState = {
      ...s,
      progress: Object.fromEntries(s.players.map((p) => [p, { ...s.progress[p] }])) as Record<PlayerId, PlayerProgress>,
    };
    for (const p of next.players) {
      const me = next.progress[p];
      if (!finished(me)) me.frozen = true;
    }
    void quitter;
    const [p1, p2] = next.players;
    const a = next.progress[p1].position;
    const b = next.progress[p2].position;
    next.lastResult = { round: next.round, streaks: { [p1]: a, [p2]: b } };
    if (a === b) next.forcedOutcome = { type: 'void' };
    else next.winner = a > b ? p1 : p2;
    return next;
  },

  /** Shared-deadline schedule: each still-active player's auto-fire time is the shared clock end.
   *  The core keeps only players who still have a legal move (a busted player drops out), so the
   *  cap freezes whoever is still calling. Empty until launch / at terminal. */
  scheduledDeadlines(state: GameState): Record<PlayerId, number> {
    const s = cast(state);
    if (s.startedAt === 0 || terminal(s)) return {};
    const out: Record<PlayerId, number> = {};
    for (const p of s.players) if (!finished(s.progress[p])) out[p] = s.endsAt;
    return out;
  },

  /** The auto-move the core injects when the shared clock fires: freeze this player's streak. */
  timeoutMove(_state: GameState, _playerId: PlayerId, _rng: Rng): Move {
    return { t: 'timeout' } satisfies HiloMove;
  },
};

export { MATCH_CAP_MS, REPLAY_CAP, SEQ_LEN, callCorrect, cardFor } from './deck.js';
