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

/** Moves. During SETUP a player pre-sets (or clears) an auto-eject altitude; during the climb
 *  they EJECT. Both are enumerable strings so the core's exact-membership check passes — the
 *  auto-eject can't be a free number, hence the fixed `autoEjectLadder`. */
const EJECT = 'eject';
const AUTO_OFF = 'auto:off';
const autoMove = (altitude: number) => `auto:${altitude}`;

/** Parse an `auto:*` move → its altitude (`null` = clear). Returns null for non-auto moves. */
function parseAuto(move: Move): number | null | undefined {
  if (typeof move !== 'string' || !move.startsWith('auto:')) return undefined;
  const suffix = move.slice('auto:'.length);
  return suffix === 'off' ? null : Number(suffix);
}

/** One player's resolution, present once they have ejected or crashed. */
interface CrashResult {
  /** Banked altitude (metres). 0 when crashed. */
  altitude: number;
  /** True if the climb reached C before this player ejected → banked 0. */
  crashed: boolean;
}

/**
 * JSON-serializable Crash state. Continuous, not turn-based: both players ride ONE shared, seeded
 * rocket through a SETUP window → ignition → climb. `crashAltitude` (C) is fixed at init from the
 * seed and HIDDEN until terminal; `setupEndsAt`/`startedAt` are the public phase boundaries
 * (seeded by the core's generic `launch` hook). The climb itself is never stored — altitude is
 * `altitudeAt(now − startedAt)`, recomputed on demand — so a redacted view can't leak the future,
 * and the round replays exactly from (seed, startedAt, the recorded move times). `autoEject` holds
 * each player's pre-set (hidden from the opponent); `results` records each player's eject/crash.
 */
interface CrashState {
  players: [PlayerId, PlayerId];
  /** Hidden crash altitude C (metres). Stripped from in-play views; revealed at terminal. */
  crashAltitude: number;
  /** Climb origin (ms): `now + setupMs + ignitionMs`. 0 until `launch` seeds it. */
  startedAt: number;
  /** End of the SETUP window (ms): `now + setupMs`. Public — drives the client countdown. */
  setupEndsAt: number;
  /** Each player's pre-set auto-eject altitude (metres). Hidden from the opponent until terminal. */
  autoEject: Record<PlayerId, number | undefined>;
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

const meta: GameMeta = {
  id: 'crash',
  displayName: 'Crash',
  minPlayers: 2,
  maxPlayers: 2,
  // Chance game (like Coinflip) → net_winnings ranking + 2.5% rake on a decisive result.
  ranking: { kind: 'net_winnings' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 15,
  rakeRate: 0.025,
};

export const crashModule: GameModule = {
  meta,

  /** Fix the hidden crash altitude C from the seed. `startedAt`/`setupEndsAt` are seeded later by
   *  `launch` (init has no formation `now`); until then the round is "armed" but not climbing. */
  init(players: PlayerId[], rng: Rng): GameState {
    const state: CrashState = {
      players: [players[0], players[1]],
      crashAltitude: drawCrashAltitude(rng),
      startedAt: 0,
      setupEndsAt: 0,
      autoEject: {},
      results: {},
    };
    return state;
  },

  /** Generic match-formation hook: open the SETUP window at `now` and set the climb's ORIGIN to
   *  `now + setupMs + ignitionMs`. The crash terminal + any auto-eject are scheduled FROM
   *  `startedAt`, so the whole schedule sits after the pad — nothing can crash during SETUP/
   *  ignition. Deterministic given (state, now) — the boundaries are pure functions of `now`. */
  launch(state: GameState, now: number): GameState {
    return {
      ...cast(state),
      setupEndsAt: now + CRASH_CONFIG.setupMs,
      startedAt: now + CRASH_CONFIG.setupMs + CRASH_CONFIG.ignitionMs,
    };
  },

  /** Permissive + time-independent (legalMoves has no `now`): until a player resolves, they may
   *  EJECT or (re)set/clear an auto-eject. `applyMove` enforces the PHASE — set-auto only before
   *  launch, eject only after — and the client shows the right control for the current phase. */
  legalMoves(state: GameState, playerId: PlayerId): Move[] {
    const s = cast(state);
    if (terminal(s) || !s.players.includes(playerId) || resolved(s, playerId)) return [];
    return [EJECT, AUTO_OFF, ...CRASH_CONFIG.autoEjectLadder.map(autoMove)];
  },

  /**
   * SETUP — `auto:<n>` / `auto:off` records (or clears) this player's auto-eject (no resolve, no
   * events). CLIMB — `eject` banks `min(liveAltitude, autoEject)` if below C, else CRASHES (0).
   * Phase is enforced from the injected `ctx.now` vs `startedAt` (an eject on the pad is rejected
   * WITHOUT consuming the player's single eject). The module never reads the clock, so a replay
   * with the same move `now`s reproduces every bank.
   */
  applyMove(state: GameState, move: Move, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId, now } = ctx;
    if (terminal(s) || !s.players.includes(playerId) || resolved(s, playerId)) {
      throw new IllegalMove(`${playerId} cannot move now`);
    }

    const auto = parseAuto(move);
    if (auto !== undefined) {
      // Pre-set auto-eject — SETUP/ignition only (before the climb origin).
      if (now >= s.startedAt) throw new IllegalMove(`${playerId} cannot set an auto-eject after launch`);
      if (auto !== null && !(CRASH_CONFIG.autoEjectLadder as readonly number[]).includes(auto)) {
        throw new IllegalMove(`auto-eject ${auto} is not a valid preset`);
      }
      const nextAuto = { ...s.autoEject };
      if (auto === null) delete nextAuto[playerId];
      else nextAuto[playerId] = auto;
      // No resolve, no events (the opponent's auto-eject is hidden until terminal).
      return { state: { ...s, autoEject: nextAuto }, events: [] };
    }

    // EJECT — climb only.
    if (now < s.startedAt) {
      throw new IllegalMove(`${playerId} cannot eject before launch`);
    }
    const liveAltitude = altitudeAt(now - s.startedAt);
    const preset = s.autoEject[playerId];
    // Whichever came first fires: a pre-set auto-eject below the live altitude banks exactly itself.
    const bankAltitude = preset != null ? Math.min(liveAltitude, preset) : liveAltitude;
    const crashed = bankAltitude >= s.crashAltitude;
    const result: CrashResult = crashed ? { altitude: 0, crashed: true } : { altitude: bankAltitude, crashed: false };

    const next: CrashState = { ...s, results: { ...s.results, [playerId]: result } };
    // NO events: the gateway broadcasts a move's events to BOTH players UNREDACTED, so emitting
    // the altitude/identity would leak the opponent's nerve. The actor learns their own ejection
    // from their redacted `viewFor`; the opponent learns nothing until the terminal reveal.
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
   * Per-player redacted view (invariant #2). PUBLIC: the phase boundaries `setupEndsAt`/`startedAt`
   * (the client renders the countdown + animates the climb). HIDDEN until terminal: the crash
   * altitude C, the opponent's auto-eject, and the opponent's ejection — a clean blind nerve duel.
   * A player always sees their OWN auto-eject + ejection. At terminal everything is revealed.
   */
  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    const opponentId = s.players.find((p) => p !== playerId)!;
    const common = { players: s.players, setupEndsAt: s.setupEndsAt, startedAt: s.startedAt };

    if (terminal(s)) {
      return {
        ...common,
        crashAltitude: s.crashAltitude,
        autoEject: { [playerId]: s.autoEject[playerId], [opponentId]: s.autoEject[opponentId] },
        results: { [playerId]: s.results[playerId], [opponentId]: s.results[opponentId] },
        terminal: true,
      } as GameState;
    }

    return {
      ...common,
      // C hidden; opponent's auto-eject + result omitted entirely (hidden nerve duel).
      autoEject: { [playerId]: s.autoEject[playerId] },
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

  /** OPT-IN absolute per-player deadlines (generic scheduled-event capability). Each still-aboard
   *  player is scheduled to be auto-ejected at whichever comes first: their pre-set auto-eject
   *  altitude, or the shared crash. When it fires the core injects `timeoutMove` (→ eject), which
   *  banks the auto-eject (below C) or crashes (at/above C). Resolved players are omitted. */
  scheduledDeadlines(state: GameState): Record<PlayerId, number> {
    const s = cast(state);
    if (s.startedAt === 0 || terminal(s)) return {};
    const crashTime = s.startedAt + timeToAltitudeMs(s.crashAltitude);
    const out: Record<PlayerId, number> = {};
    for (const p of s.players) {
      if (resolved(s, p)) continue;
      const preset = s.autoEject[p];
      const autoTime = preset != null ? s.startedAt + timeToAltitudeMs(preset) : Infinity;
      out[p] = Math.min(crashTime, autoTime);
    }
    return out;
  },

  /** The move the core injects when a player's scheduled deadline (auto-eject or crash) fires:
   *  eject. `applyMove` then banks the pre-set (below C) or crashes (at/above C) deterministically. */
  timeoutMove(state: GameState, playerId: PlayerId, _rng: Rng): Move {
    const s = cast(state);
    if (terminal(s) || resolved(s, playerId)) {
      throw new IllegalMove(`${playerId} has nothing to auto-eject`);
    }
    return EJECT;
  },
};

export { CRASH_CONFIG, altitudeAt, timeToAltitudeMs, drawCrashAltitude };
