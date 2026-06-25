import type {
  ApplyResult,
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
import { CRASH_CONFIG, altitudeAt, timeToAltitudeMs, drawCrashAltitude } from './curve.js';

/** The only move: eject now (bank the live altitude, or crash if the climb has reached C). */
const EJECT = 'eject';

/** One player's resolution, present once they have ejected or crashed. */
interface CrashResult {
  /** Banked altitude (metres). 0 when crashed. */
  altitude: number;
  /** True if the climb reached C before this player ejected → banked 0. */
  crashed: boolean;
}

/**
 * JSON-serializable Crash state. Continuous, not turn-based: both players ride ONE shared,
 * seeded rocket. `crashAltitude` (C) is fixed at init from the seed and HIDDEN until terminal;
 * `startedAt` is the launch `now` (seeded by the core's generic `launch` hook). The climb itself
 * is never stored — altitude is `altitudeAt(now − startedAt)`, recomputed on demand — so a
 * redacted view can never leak the future, and the round replays exactly from (seed, startedAt,
 * eject times). `results` records each player's eject/crash; the match is terminal once both are in.
 */
interface CrashState {
  players: [PlayerId, PlayerId];
  /** Hidden crash altitude C (metres). Stripped from in-play views; revealed at terminal. */
  crashAltitude: number;
  /** Launch time (ms). 0 until the core's `launch` hook seeds it at match formation. */
  startedAt: number;
  /** Per-player resolution; an entry exists iff that player has ejected or crashed. */
  results: Record<PlayerId, CrashResult | undefined>;
  /** Set by `forfeit` (an explicit give-up) → terminal with a forced result. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): CrashState {
  return state as CrashState;
}

function resolved(s: CrashState, p: PlayerId): boolean {
  return s.results[p] !== undefined;
}

function terminal(s: CrashState): boolean {
  return s.forcedOutcome !== undefined || s.players.every((p) => resolved(s, p));
}

function bank(r: CrashResult): number {
  return r.crashed ? 0 : r.altitude;
}

/** The crash time (ms, absolute) — when the shared climb reaches C and busts anyone still aboard. */
function crashAtMs(s: CrashState): number {
  return s.startedAt + timeToAltitudeMs(s.crashAltitude);
}

const meta: GameMeta = {
  id: 'crash',
  displayName: 'Crash',
  minPlayers: 2,
  maxPlayers: 2,
  // Chance game (like Coinflip) → net_winnings ranking + 2.5% rake on a decisive result.
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 12,
  rakeRate: 0.025,
};

export const crashModule: GameModule = {
  meta,

  /** Fix the hidden crash altitude C from the seed. `startedAt` is seeded later by `launch`
   *  (init has no formation `now`); until then the round is "armed" but not climbing. */
  init(players: PlayerId[], rng: Rng): GameState {
    const state: CrashState = {
      players: [players[0], players[1]],
      crashAltitude: drawCrashAltitude(rng),
      startedAt: 0,
      results: {},
    };
    return state;
  },

  /** Generic match-formation hook: set the climb's ORIGIN to `now + launchCountdownMs` — the
   *  rocket sits on the pad through a server-authoritative 3-2-1, then climbs from 0. Because the
   *  crash terminal and any auto-eject are scheduled from this shifted `startedAt`, the whole
   *  schedule moves forward with it (nothing can crash on the pad). Deterministic given (state,
   *  now) — `startedAt` is still a pure function of the injected `now`. */
  launch(state: GameState, now: number): GameState {
    return { ...cast(state), startedAt: now + CRASH_CONFIG.launchCountdownMs };
  },

  legalMoves(state: GameState, playerId: PlayerId): Move[] {
    const s = cast(state);
    if (terminal(s) || !s.players.includes(playerId) || resolved(s, playerId)) return [];
    return [EJECT];
  },

  /**
   * Eject. Banks `altitudeAt(now − startedAt)` if that is below C; otherwise the climb has
   * already reached C and the player CRASHES (banks 0). Uses the injected `ctx.now` only — the
   * module never reads the clock, so a replay with the same eject `now` reproduces the bank.
   * The crash sweep injects this same move for anyone still aboard at the crash time.
   */
  applyMove(state: GameState, move: Move, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId, now } = ctx;
    if (terminal(s) || !s.players.includes(playerId) || resolved(s, playerId)) {
      throw new IllegalMove(`${playerId} cannot eject now`);
    }
    if (move !== EJECT) {
      throw new IllegalMove(`"${String(move)}" is not a legal move`);
    }
    // On the pad (pre-launch): reject the eject WITHOUT consuming it — a 3-2-1 tap must not waste
    // the player's single eject (nothing can crash here either, so there's nothing to escape yet).
    if (now < s.startedAt) {
      throw new IllegalMove(`${playerId} cannot eject before launch`);
    }

    const altitude = altitudeAt(now - s.startedAt);
    const crashed = altitude >= s.crashAltitude;
    const result: CrashResult = crashed ? { altitude: 0, crashed: true } : { altitude, crashed: false };

    const next: CrashState = { ...s, results: { ...s.results, [playerId]: result } };
    // NO events: the gateway broadcasts a move's events to BOTH players UNREDACTED, so emitting
    // the altitude/identity here would leak the opponent's nerve. The actor learns their own
    // ejection from their redacted `viewFor` (results[me]); the opponent must learn nothing until
    // terminal (the blind nerve duel) — mirrors Mines, which omits its per-reveal events. Both
    // ejections + C are revealed in the terminal `viewFor`, which is broadcast-safe.
    return { state: next, events: [] };
  },

  isTerminal(state: GameState): boolean {
    return terminal(cast(state));
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    const [a, b] = s.players;
    const ba = bank(s.results[a]!);
    const bb = bank(s.results[b]!);
    // Higher bank wins; equal banks (incl. both-crash at 0) → draw → refund both, no rake.
    if (ba === bb) return { type: 'draw' };
    return { type: 'win', winner: ba > bb ? a : b };
  },

  /**
   * Per-player redacted view (invariant #2). PUBLIC: `startedAt` (the client animates the same
   * shared climb from it). HIDDEN until terminal: the crash altitude C and the opponent's
   * ejection — a clean blind nerve duel. A player always sees their OWN ejection immediately.
   * At terminal everything is revealed (C + both ejections) for verifiability.
   */
  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    const opponentId = s.players.find((p) => p !== playerId)!;

    if (terminal(s)) {
      return {
        players: s.players,
        startedAt: s.startedAt,
        crashAltitude: s.crashAltitude,
        results: { [playerId]: s.results[playerId], [opponentId]: s.results[opponentId] },
        terminal: true,
      } as GameState;
    }

    return {
      players: s.players,
      startedAt: s.startedAt,
      // crashAltitude omitted (hidden); opponent's result omitted entirely (hidden nerve duel).
      results: { [playerId]: s.results[playerId] },
      terminal: false,
    } as GameState;
  },

  /**
   * Explicit give-up. A genuine DISCONNECT does NOT route here — Crash opts into the generic
   * scheduled crash (see `scheduledDeadlines` + `timeoutMove`), so an absent player simply rides
   * to C and crashes via the sweep. `forfeit` covers a real quit, and must return a terminal
   * state: the quitter crashes (banks 0); the opponent wins unless they had also already crashed
   * (→ both-crash draw). Never a void.
   */
  forfeit(state: GameState, quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    const opponentId = s.players.find((p) => p !== quitter)!;
    const next: CrashState = {
      ...s,
      results: { ...s.results, [quitter]: { altitude: 0, crashed: true } },
    };
    const oppRes = next.results[opponentId];
    if (oppRes && bank(oppRes) === 0) {
      next.forcedOutcome = { type: 'draw' }; // both crashed → refund both
    } else {
      next.forcedOutcome = { type: 'win', winner: opponentId };
    }
    return next;
  },

  /** OPT-IN absolute per-player deadlines (generic scheduled-event capability). Every still-aboard
   *  player is scheduled to be auto-ejected at the shared crash time; when it fires the core
   *  injects `timeoutMove` (→ eject) and they crash. A player who has ejected/crashed is omitted. */
  scheduledDeadlines(state: GameState): Record<PlayerId, number> {
    const s = cast(state);
    if (s.startedAt === 0 || terminal(s)) return {};
    const at = crashAtMs(s);
    const out: Record<PlayerId, number> = {};
    for (const p of s.players) if (!resolved(s, p)) out[p] = at;
    return out;
  },

  /** The move the core injects when a player's scheduled deadline (the crash) fires: eject. At
   *  that `now` the climb has reached C, so `applyMove` banks 0 (a crash). */
  timeoutMove(state: GameState, playerId: PlayerId, _rng: Rng): Move {
    const s = cast(state);
    if (terminal(s) || resolved(s, playerId)) {
      throw new IllegalMove(`${playerId} has nothing to auto-eject`);
    }
    return EJECT;
  },
};

export { CRASH_CONFIG, altitudeAt, timeToAltitudeMs, drawCrashAltitude };
