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

type Side = 'heads' | 'tails';

const SIDES = ['heads', 'tails'] as const;

/** The pick window (ms). A FIXED-LENGTH window is the SOLE lock-and-proceed trigger (#164): the
 *  round resolves ONLY at window expiry, never on "both chosen". The core runs it as a generic
 *  absolute scheduled deadline (opt-in via `launch` + `scheduledDeadlines`, the Crash/Hilo hook) —
 *  an ABSOLUTE time stamped at round start, unaffected by taps, so picks stay mutable for the whole
 *  window and every round has identical duration (nothing about the opponent's behaviour leaks
 *  pre-reveal). On expiry the core injects `timeoutMove` for each still-unlocked player, locking
 *  their current provisional pick (or a seeded auto-pick if they never chose). The client renders a
 *  cosmetic countdown of the same length; the SERVER clock is authoritative. */
export const PICK_WINDOW_MS = 10_000;

/** Back-compat export (the old name for the window length). */
export const PICK_TIMEOUT_MS = PICK_WINDOW_MS;

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

/** Consecutive ties (same side) before the match voids (refund both, no rake) — the universal tie
 *  rule (CHARTER.md). A same-side round is NOT terminal; it re-flips a fresh round in the same
 *  escrow. */
const REPLAY_CAP = 10;

interface CoinflipState {
  players: [PlayerId, PlayerId];
  /** Each player's chosen side. Mutable for the whole window (a replacement pick is accepted); it
   *  becomes final only when `locked[p]` is set at the deadline. Hidden from the opponent (via
   *  viewFor) until terminal. */
  choices: Partial<Record<PlayerId, Side>>;
  /** Set for a player ONLY on the deadline/timeout lock path (never on a provisional tap). The
   *  round resolves ONLY once BOTH are locked; `legalMoves(p)` returns `[]` once `locked[p]` so the
   *  core's sweep stops re-injecting that player. Hidden pre-terminal (it is timing information). */
  locked: Partial<Record<PlayerId, true>>;
  /** Absolute wall-clock time (ms) at which the pick window closes and both picks lock. 0 until the
   *  core's `launch` hook stamps it at formation; re-stamped on each tie-replay round. Public — it
   *  drives the client countdown. Unaffected by taps (the fixed window is the only lock event). */
  windowEndsAt: number;
  /** The CURRENT round's flip — round 0 fixed at init from the seeded rng; each tie replay re-draws
   *  it from `seed` + the new round. A deterministic function of the seed, INDEPENDENT of either
   *  choice. Hidden by viewFor until the match is terminal. */
  result: Side;
  /** Base seed (fixed at init) for the replay flips + the timeout auto-pick. Redacted pre-terminal
   *  (it would let a player precompute the flip / the opponent's auto-pick). */
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

function cast(state: GameState): CoinflipState {
  return state as CoinflipState;
}

function terminal(s: CoinflipState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}

function isSide(v: unknown): v is Side {
  return typeof v === 'string' && (SIDES as readonly string[]).includes(v);
}

/** Is `now` at/after the window close, i.e. a LOCK moment rather than a provisional pick? The window
 *  must actually be open (`windowEndsAt > 0`, i.e. after `launch`) — a pre-launch/uninitialised
 *  state (0) never locks. This is the SAME "phase by injected now" gate Crash uses for SETUP→climb;
 *  the module never reads the wall clock itself (determinism). */
function isLockTime(s: CoinflipState, now: number): boolean {
  return s.windowEndsAt > 0 && now >= s.windowEndsAt;
}

/** mulberry32 + mix — a small seeded PRNG, used to derive a fresh flip / auto-pick each replay
 *  round as a pure function of (seed, round). Round 0's flip stays the init rng draw (unchanged). */
function mulberry32(seed: number): number {
  let a = seed >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
function mix(base: number, round: number): number {
  let h = (base >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (round >>> 0), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** The seeded flip for a replay round (round ≥ 1): a deterministic 50/50 side. */
function flipFor(seed: number, round: number): Side {
  return SIDES[mulberry32(mix(seed, round)) & 1];
}

/** Deterministic seeded auto-pick for a timed-out player THIS round (reproducible on replay).
 *  Independent of the flip `result`, so a no-pick player still gets a fair, hidden 50/50 side. */
function autoPickFor(seed: number, round: number, playerIndex: number): Side {
  const h = Math.imul(mix(seed, round) ^ ((playerIndex + 1) * 0x9e3779b1), 0x85ebca6b) >>> 0;
  return SIDES[h & 1];
}

/** Resolve once BOTH players are locked (never on "both chosen"): DIFFERENT sides → the side
 *  matching the flip wins (terminal); a SAME-side tie re-flips a fresh round in the same escrow (the
 *  universal tie rule) — at REPLAY_CAP it voids. Re-stamps the window from `now` so the fresh round
 *  gets its own full-length window (the core re-schedules the deadline via `scheduledDeadlines`).
 *  Mutates `s`. */
function resolve(s: CoinflipState, now: number): GameEvent[] {
  const [p1, p2] = s.players;
  const c1 = s.choices[p1]!;
  const c2 = s.choices[p2]!;
  if (c1 !== c2) {
    s.winner = c1 === s.result ? p1 : p2;
    return [{ type: 'match_decided', payload: { winner: s.winner } }];
  }
  s.replays += 1;
  if (s.replays >= REPLAY_CAP) {
    s.forcedOutcome = { type: 'void' };
    return [{ type: 'match_voided', payload: { reason: 'replay_cap', replays: s.replays } }];
  }
  s.round += 1;
  s.choices = {};
  s.locked = {};
  s.result = flipFor(s.seed, s.round); // fresh hidden flip for the new round
  s.windowEndsAt = now + pickWindowMs(); // fresh full-length window
  return [{ type: 'new_round', payload: { round: s.round, replays: s.replays } }];
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
    rakeRate: 0.025, // 2.5% of the pot from the winner on a decisive result
    // NB: no `moveTimeoutMs`. The pick window is a FIXED absolute deadline (see PICK_WINDOW_MS +
    // `launch`/`scheduledDeadlines`), not a per-move budget that resets on each tap.
  },

  init(players: PlayerId[], rng: Rng): GameState {
    // Fix round 0's flip HERE from the injected rng, so it is a deterministic function of the
    // match seed and INDEPENDENT of either player's choice (which come later). Draw `result`
    // first so existing flip-seed assertions are unchanged, then the seed (replay flips + auto-pick).
    // `windowEndsAt` is stamped later by `launch` (init has no formation `now`).
    const result: Side = SIDES[rng.int(0, 1)];
    const state: CoinflipState = {
      players: [players[0], players[1]],
      choices: {},
      locked: {},
      windowEndsAt: 0,
      result,
      seed: rng.int(0, 0x7fffffff),
      round: 0,
      replays: 0,
    };
    return state;
  },

  /** Generic match-formation hook: open the fixed pick window at `now`. The deadline is absolute, so
   *  it is unaffected by how many times either player re-taps their pick. Deterministic given
   *  (state, now). */
  launch(state: GameState, now: number): GameState {
    return { ...cast(state), windowEndsAt: now + pickWindowMs() };
  },

  legalMoves(state: GameState, playerId: PlayerId): Side[] {
    const s = cast(state);
    // Both sides stay legal for a player throughout the whole window — even after a provisional
    // pick — so picks are freely mutable and the client is never gated by `your_turn` churn. Only a
    // LOCKED player (deadline reached) has nothing left to do → the core's sweep stops on them.
    if (terminal(s) || s.locked[playerId]) return [];
    return [...SIDES];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId, now } = ctx;
    if (terminal(s) || s.locked[playerId]) {
      throw new IllegalMove(`${playerId} is locked`);
    }
    if (!isSide(move)) {
      throw new IllegalMove(`"${String(move)}" is not a valid coin side`);
    }

    // A provisional pick during the open window just (re)sets the choice — mutable, no lock, no
    // resolve. Emit NO events: the gateway broadcasts a move's events to BOTH players unredacted, so
    // announcing that/when a player picked would leak the opponent's timing (the actor learns their
    // own pick from their redacted view; the opponent learns nothing until the reveal — Crash's
    // hidden-move pattern). The round can NEVER resolve early, even if both picked in the first
    // second.
    const next: CoinflipState = { ...s, choices: { ...s.choices, [playerId]: move } };
    if (!isLockTime(s, now)) {
      return { state: next, events: [] };
    }

    // Window expiry → LOCK this player's current pick. Once BOTH are locked, resolve (reveal → flip
    // → decisive/replay). The core's sweep injects `timeoutMove` for each unlocked player at the
    // shared deadline, so both lock at the same `now` → a truly simultaneous reveal.
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
    // The only non-void terminal is a decisive winner — a same-side tie replays, never resolves here.
    return { type: 'win', winner: s.winner! };
  },

  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    // At terminal: reveal both choices AND the flip result.
    if (terminal(s)) return s;
    // Pre-terminal (incl. a replay's fresh pick phase): strip the OPPONENT's choice (keep only the
    // viewer's own), the flip, the seed (it would let either player precompute the flip / the
    // opponent's timeout auto-pick), AND the `locked` map (timing information). `windowEndsAt`/
    // round/replays stay public (the fixed-length window is identical for both players — no leak).
    const redacted: Partial<Record<PlayerId, Side>> = {};
    const own = s.choices[playerId];
    if (own !== undefined) redacted[playerId] = own;
    const { result: _result, seed: _seed, locked: _locked, ...rest } = s;
    return { ...rest, seed: 0, choices: redacted };
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    // Abandonment before a round resolves → void (refund both), never a draw. Once a round resolves
    // decisively the match is already terminal, so forfeit only applies pre-resolution.
    return { ...s, forcedOutcome: { type: 'void' } };
  },

  /** OPT-IN absolute per-player deadline: BOTH players share the same window-close time. The core
   *  reads this to drive the SAME generic move-timer sweep Crash/Blackjack use — at `windowEndsAt`
   *  it injects `timeoutMove` for each still-unlocked player, locking both simultaneously. A locked
   *  (or all-terminal) player is omitted; `windowEndsAt === 0` (pre-launch) schedules nothing. */
  scheduledDeadlines(state: GameState): Record<PlayerId, number> {
    const s = cast(state);
    if (s.windowEndsAt === 0 || terminal(s)) return {};
    const out: Record<PlayerId, number> = {};
    for (const p of s.players) if (!s.locked[p]) out[p] = s.windowEndsAt;
    return out;
  },

  /** The move the core injects when the shared pick window closes: LOCK this player's current pick.
   *  If they picked provisionally, that exact side is locked; if they never chose, a deterministic
   *  seeded auto-pick (reproducible on replay, independent of the flip) stands in. `applyMove` sees
   *  `now >= windowEndsAt` and sets `locked[p]`. */
  timeoutMove(state: GameState, playerId: PlayerId, _rng: Rng): Move {
    const s = cast(state);
    if (terminal(s) || s.locked[playerId]) {
      throw new IllegalMove(`${playerId} is already locked`);
    }
    return s.choices[playerId] ?? autoPickFor(s.seed, s.round, s.players.indexOf(playerId));
  },
};
