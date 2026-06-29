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

/** The pick window (ms). The core runs this as a generic per-player move timer (opt-in via
 *  `meta.moveTimeoutMs`); on expiry it injects `timeoutMove` (a seeded auto-pick) so a round
 *  where a player never chooses still resolves — same capability Keno/Limbo declare. The client
 *  renders a cosmetic countdown of the same length; the SERVER clock is authoritative. */
export const PICK_TIMEOUT_MS = 10_000;

/** Consecutive ties (same side) before the match voids (refund both, no rake) — the universal tie
 *  rule (CHARTER.md). A same-side round is NOT terminal; it re-flips a fresh round in the same
 *  escrow. */
const REPLAY_CAP = 10;

interface CoinflipState {
  players: [PlayerId, PlayerId];
  /** Each player's chosen side. Hidden from the opponent (via viewFor) until terminal. */
  choices: Partial<Record<PlayerId, Side>>;
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

/** Resolve once both have chosen: DIFFERENT sides → the side matching the flip wins (terminal); a
 *  SAME-side tie re-flips a fresh round in the same escrow (the universal tie rule) — at REPLAY_CAP
 *  it voids. Mutates `s`. */
function resolve(s: CoinflipState): GameEvent[] {
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
  s.result = flipFor(s.seed, s.round); // fresh hidden flip for the new round
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
    // Opt into the core's generic per-player pick timer (like Keno/Limbo). On expiry the core
    // injects `timeoutMove` (a seeded auto-pick) so the round always resolves; a disconnect during
    // the window rides to this timeout rather than an instant forfeit (generic `usesPlayerTimers`).
    moveTimeoutMs: PICK_TIMEOUT_MS,
  },

  init(players: PlayerId[], rng: Rng): GameState {
    // Fix round 0's flip HERE from the injected rng, so it is a deterministic function of the
    // match seed and INDEPENDENT of either player's choice (which come later). Draw `result`
    // first so existing flip-seed assertions are unchanged, then the seed (replay flips + auto-pick).
    const result: Side = SIDES[rng.int(0, 1)];
    const state: CoinflipState = {
      players: [players[0], players[1]],
      choices: {},
      result,
      seed: rng.int(0, 0x7fffffff),
      round: 0,
      replays: 0,
    };
    return state;
  },

  legalMoves(state: GameState, playerId: PlayerId): Side[] {
    const s = cast(state);
    // Both players may choose, independently — a player who hasn't chosen yet may.
    if (terminal(s) || playerId in s.choices) return [];
    return [...SIDES];
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId } = ctx;
    if (terminal(s) || playerId in s.choices) {
      throw new IllegalMove(`${playerId} has already chosen`);
    }
    if (!isSide(move)) {
      throw new IllegalMove(`"${String(move)}" is not a valid coin side`);
    }
    const next: CoinflipState = { ...s, choices: { ...s.choices, [playerId]: move } };
    // Announce only THAT a choice was made — never the side (it stays hidden until terminal).
    const events: GameEvent[] = [{ type: 'move_made', payload: { playerId } }];
    if (next.players.every((p) => p in next.choices)) events.push(...resolve(next));
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
    // viewer's own), the flip, AND the seed (it would let either player precompute the flip / the
    // opponent's timeout auto-pick). round/replays stay public.
    const redacted: Partial<Record<PlayerId, Side>> = {};
    const own = s.choices[playerId];
    if (own !== undefined) redacted[playerId] = own;
    const { result: _result, seed: _seed, ...rest } = s;
    return { ...rest, seed: 0, choices: redacted };
  },

  forfeit(state: GameState, _quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    // Abandonment before a round resolves → void (refund both), never a draw. Once a round resolves
    // decisively the match is already terminal, so forfeit only applies pre-resolution.
    return { ...s, forcedOutcome: { type: 'void' } };
  },

  /** Auto-move the core injects when a player's pick clock (meta.moveTimeoutMs) expires: a seeded
   *  side for the CURRENT round. Deterministic (reproducible on replay) and independent of the flip. */
  timeoutMove(state: GameState, playerId: PlayerId, _rng: Rng): Move {
    const s = cast(state);
    if (terminal(s) || playerId in s.choices) {
      throw new IllegalMove(`${playerId} has nothing to auto-pick`);
    }
    return autoPickFor(s.seed, s.round, s.players.indexOf(playerId));
  },
};
