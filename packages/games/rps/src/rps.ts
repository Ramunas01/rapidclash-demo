import type {
  ApplyResult,
  GameEvent,
  GameModule,
  GameState,
  Move,
  MoveContext,
  Outcome,
  PlayerId,
  Rng,
} from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';

type RpsChoice = 'rock' | 'paper' | 'scissors';

const CHOICES = ['rock', 'paper', 'scissors'] as const;

/** The pick window (ms). Identical model to Coinflip (#164): a FIXED-LENGTH window is the SOLE
 *  lock-and-proceed trigger — the round resolves ONLY at window expiry, never on "both chosen".
 *  Run as a generic absolute scheduled deadline (opt-in via `launch` + `scheduledDeadlines`, the
 *  Crash hook): an ABSOLUTE time stamped at round start, unaffected by taps, so picks stay mutable
 *  for the whole window and every round has identical duration (no timing side-channel). On expiry
 *  the core injects `timeoutMove` for each still-unlocked player, locking their current provisional
 *  throw (or a seeded auto-throw if they never chose). */
export const PICK_WINDOW_MS = 10_000;

/** The effective window length, read at each `launch`. Overridable via `RC_PICK_WINDOW_MS` (mirrors
 *  the `MATCH_TURN_TIMEOUT_MS` env pattern) so integration tests can run a sub-second window instead
 *  of waiting the real 10s; defaults to `PICK_WINDOW_MS`. The exported constant stays the client's
 *  cosmetic-countdown length. */
function pickWindowMs(): number {
  // Read via globalThis so this stays isomorphic: `process` is undefined in the browser (the client
  // imports PICK_WINDOW_MS from this module), and the package has no @types/node.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const n = Number.parseInt(env?.RC_PICK_WINDOW_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : PICK_WINDOW_MS;
}

/** Consecutive ties (same throw) before the match voids (refund both, no rake) — the universal
 *  tie rule (CHARTER.md). A tie is NOT terminal; it re-deals a fresh throw in the same escrow. */
const REPLAY_CAP = 10;

interface RpsState {
  players: [PlayerId, PlayerId];
  /** Each player's throw. Mutable for the whole window; final only when `locked[p]` is set at the
   *  deadline. Hidden from the opponent (via viewFor) until terminal. */
  choices: Partial<Record<PlayerId, RpsChoice>>;
  /** Set for a player ONLY on the deadline/timeout lock path (never on a provisional tap). The
   *  round resolves ONLY once BOTH are locked; `legalMoves(p)` empties once `locked[p]`. Hidden
   *  pre-terminal (timing information). */
  locked: Partial<Record<PlayerId, true>>;
  /** Absolute wall-clock time (ms) at which the pick window closes and both throws lock. 0 until
   *  the core's `launch` hook stamps it at formation; re-stamped on each tie-replay round. Public —
   *  it drives the client countdown. Unaffected by taps. */
  windowEndsAt: number;
  /** Base seed (fixed at init) for the timeout auto-throw. Redacted pre-terminal (it would let a
   *  player precompute the opponent's auto-throw). */
  seed: number;
  /** Current round (0-based; bumped on each tie replay). Public scaffolding. */
  round: number;
  /** Consecutive ties so far. */
  replays: number;
  /** A decided round → terminal. */
  winner?: PlayerId;
  /** Present when the match ended via forfeit, or voided at the replay cap. */
  forcedOutcome?: Outcome;
}

function cast(state: GameState): RpsState {
  return state as RpsState;
}

function terminal(s: RpsState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}

/** Is `now` at/after the window close, i.e. a LOCK moment rather than a provisional pick? The
 *  window must actually be open (`windowEndsAt > 0`, i.e. after `launch`). Mirrors Crash's
 *  "phase by injected now" gate; the module never reads the wall clock itself (determinism). */
function isLockTime(s: RpsState, now: number): boolean {
  return s.windowEndsAt > 0 && now >= s.windowEndsAt;
}

/** A small seeded mix — pure fn of (seed, round) — feeding the deterministic auto-throw. */
function mix(base: number, round: number): number {
  let h = (base >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (round >>> 0), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Deterministic seeded auto-throw for a timed-out player THIS round (reproducible on replay). */
function autoThrowFor(seed: number, round: number, playerIndex: number): RpsChoice {
  const h = Math.imul(mix(seed, round) ^ ((playerIndex + 1) * 0x9e3779b1), 0x85ebca6b) >>> 0;
  return CHOICES[h % CHOICES.length];
}

/** Resolve once BOTH players are locked (never on "both chosen"): a decisive throw sets the winner
 *  (terminal); a TIE (same throw) re-deals a fresh round in the same escrow — at REPLAY_CAP it
 *  voids. Re-stamps the window from `now`. Mutates `s`. */
function resolve(s: RpsState, now: number): GameEvent[] {
  const [p1, p2] = s.players;
  const r = beats(s.choices[p1]!, s.choices[p2]!);
  if (r !== 0) {
    s.winner = r === 1 ? p1 : p2;
    return [{ type: 'match_decided', payload: { winner: s.winner } }];
  }
  // Tie → not terminal: replay (the universal tie rule), or void at the cap.
  s.replays += 1;
  if (s.replays >= REPLAY_CAP) {
    s.forcedOutcome = { type: 'void' };
    return [{ type: 'match_voided', payload: { reason: 'replay_cap', replays: s.replays } }];
  }
  // Snapshot the just-tied round's throws BEFORE `s.choices` is reset for the fresh round below —
  // once reset, this round's throws are gone from state entirely and no viewFor could ever recover
  // them. Deliberately reveals both throws to both players on a tied round — a real info-leak a
  // strategic player could exploit round-to-round. Owner-approved 2026-09-11: this is an
  // investor-demo build, not the production implementation: visual/experiential fidelity to the
  // Designer's prototype outweighs this correctness concern at this stage. Do not treat this as an
  // oversight; do not silently "fix" it back to redacted without Owner sign-off. (ADVISOR_TO_PM.md
  // 2026-09-11#9, item 2.) Carried in the EVENT only (not state) so it stays a bounded, one-time
  // reveal to whoever is connected at that instant — a later reconnect/resume never re-derives it.
  const revealedChoices = { ...s.choices };
  s.round += 1;
  s.choices = {};
  s.locked = {};
  s.windowEndsAt = now + pickWindowMs(); // fresh full-length window
  return [{ type: 'new_round', payload: { round: s.round, replays: s.replays, revealedChoices } }];
}

function isChoice(v: unknown): v is RpsChoice {
  return typeof v === 'string' && (CHOICES as readonly string[]).includes(v);
}

/** Returns 1 if a beats b, -1 if b beats a, 0 for a tie. */
function beats(a: RpsChoice, b: RpsChoice): -1 | 0 | 1 {
  if (a === b) return 0;
  if (
    (a === 'rock' && b === 'scissors') ||
    (a === 'scissors' && b === 'paper') ||
    (a === 'paper' && b === 'rock')
  ) {
    return 1;
  }
  return -1;
}

export const rpsModule: GameModule = {
  meta: {
    id: 'rps',
    displayName: 'Rock Paper Scissors',
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'win_rate' },
    bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 10,
    rakeRate: 0.025, // 2.5% of the pot from the winner on a decisive result
    // NB: no `moveTimeoutMs`. The pick window is a FIXED absolute deadline (see PICK_WINDOW_MS +
    // `launch`/`scheduledDeadlines`), not a per-move budget that resets on each tap.
  },

  init(players: PlayerId[], rng: Rng): GameState {
    // `windowEndsAt` is stamped later by `launch`. `seed` drives the deterministic auto-throw.
    const state: RpsState = {
      players: [players[0], players[1]],
      choices: {},
      locked: {},
      windowEndsAt: 0,
      seed: rng.int(0, 0x7fffffff),
      round: 0,
      replays: 0,
    };
    return state;
  },

  /** Generic match-formation hook: open the fixed pick window at `now` (absolute, tap-independent).*/
  launch(state: GameState, now: number): GameState {
    return { ...cast(state), windowEndsAt: now + pickWindowMs() };
  },

  legalMoves(state: GameState, playerId: PlayerId): RpsChoice[] {
    const s = cast(state);
    // All three throws stay legal for a player throughout the whole window — even after a
    // provisional pick — so picks are freely mutable and the client is never gated by `your_turn`
    // churn. Only a LOCKED player has nothing left to do.
    if (terminal(s) || s.locked[playerId]) return [];
    return [...CHOICES];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId, now } = ctx;
    if (terminal(s) || s.locked[playerId]) {
      throw new IllegalMove(`${playerId} is locked`);
    }
    if (!isChoice(move)) {
      throw new IllegalMove(`"${String(move)}" is not a valid RPS choice`);
    }

    // A provisional throw during the open window just (re)sets the choice — mutable, no lock, no
    // resolve, NO events (announcing it would leak the opponent's timing; Crash's hidden-move
    // pattern). The round can NEVER resolve early.
    const next: RpsState = { ...s, choices: { ...s.choices, [playerId]: move } };
    if (!isLockTime(s, now)) {
      return { state: next, events: [] };
    }

    // Window expiry → LOCK this player's current throw. Both lock at the shared deadline (the core
    // injects `timeoutMove` for each unlocked player at the same `now`) → simultaneous reveal.
    next.locked = { ...s.locked, [playerId]: true };
    const events: GameEvent[] = [];
    if (next.players.every((p) => next.locked[p])) events.push(...resolve(next, now));
    return { state: next, events };
  },

  isTerminal(state: GameState): boolean {
    return terminal(cast(state));
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    // The only non-void terminal is a decisive winner — a tie replays, never resolves here.
    return { type: 'win', winner: s.winner! };
  },

  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    // Redact: include only the viewing player's own throw; strip the seed (auto-throw precompute)
    // and the `locked` map (timing). `windowEndsAt`/round/replays stay public (identical for both).
    const redacted: Partial<Record<PlayerId, RpsChoice>> = {};
    const own = s.choices[playerId];
    if (own !== undefined) redacted[playerId] = own;
    const { seed: _seed, locked: _locked, ...rest } = s;
    return { ...rest, seed: 0, choices: redacted };
  },

  forfeit(state: GameState, quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    const opponent = s.players.find((p) => p !== quitter);
    const opponentChose = opponent !== undefined && opponent in s.choices;
    const forcedOutcome: Outcome = opponentChose
      ? { type: 'win', winner: opponent as PlayerId }
      : { type: 'void' };
    return { ...s, forcedOutcome };
  },

  /** OPT-IN absolute per-player deadline: BOTH players share the same window-close time. The core
   *  reads this to drive the generic move-timer sweep — at `windowEndsAt` it injects `timeoutMove`
   *  for each still-unlocked player, locking both simultaneously. */
  scheduledDeadlines(state: GameState): Record<PlayerId, number> {
    const s = cast(state);
    if (s.windowEndsAt === 0 || terminal(s)) return {};
    const out: Record<PlayerId, number> = {};
    for (const p of s.players) if (!s.locked[p]) out[p] = s.windowEndsAt;
    return out;
  },

  /** The move the core injects when the shared pick window closes: LOCK this player's current
   *  throw. If they picked provisionally, that exact throw is locked; if they never chose, a
   *  deterministic seeded auto-throw stands in. `applyMove` sees `now >= windowEndsAt` → sets
   *  `locked[p]`. */
  timeoutMove(state: GameState, playerId: PlayerId, _rng: Rng): Move {
    const s = cast(state);
    if (terminal(s) || s.locked[playerId]) {
      throw new IllegalMove(`${playerId} is already locked`);
    }
    return s.choices[playerId] ?? autoThrowFor(s.seed, s.round, s.players.indexOf(playerId));
  },
};
