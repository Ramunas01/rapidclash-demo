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
  CELLS, FLEET_SHIPS, PLACEMENT_TIMEOUT_MS, SHIP_SIZES, SHOT_TIMEOUT_MS,
  autoCompleteFleet, firstShooterIndex, frontierCells, haloOf, makeRng, mixSeed,
  startCells, validateFleet,
} from './fleet.js';

/**
 * Ships Battle — a natively-2P skill game (docs/SHIPS_BATTLE.md). Each player hides a 35-square
 * fleet (the {1:5,2:4,3:3,4:2,5:1} polyomino set, no-touch) on a 10×10 sea, then they alternate
 * shooting; sink the opponent's whole fleet to win. ELO-ranked, 10% rake. No core branch.
 *
 * The whole integrity of the game is `viewFor`: a player is only ever sent their OWN board and the
 * opponent's board AS THEY HAVE PROBED IT (their hits/misses + revealed sunk ships/halos) — never
 * the opponent's un-probed squares or un-sunk ships. A cheating client cannot see hidden ships.
 *
 * Determinism: shot RESULTS are fully determined by the recorded placements; the only randomness —
 * auto-placement (`auto`/timeout), auto-fire (shot timeout), and the first-shooter flip — derives
 * from the match's fixed `seed` (auto-place/flip in `applyMove`, which gets no rng) or the injected
 * rng (auto-fire in `timeoutMove`), so replaying the recorded moves reproduces the match exactly.
 */

/** Moves — all JSON-enumerable, so they pass the core's strict legalMoves-membership check.
 *  PLACEMENT is built incrementally (one square at a time, like Roulette's chip placement); the
 *  rich colour/frontier builder is client-side UX over this same square stream. */
type ShipsMove =
  | { t: 'add'; c: number } // placement: add cell c to the current (in-progress) ship
  | { t: 'remove'; c: number } // placement: remove cell c from the current ship
  | { t: 'auto' } // placement: seeded auto-complete the rest of my fleet (hold-to-randomize / timeout)
  | { t: 'fire'; c: number }; // shooting: fire at opponent cell c

type ShotResult = 'hit' | 'miss';

interface PlayerBoard {
  /** Locked ships (largest-first). 15 once placement is done. */
  ships: number[][];
  /** Cells of the ship currently being built (placement only; empty between ships / when done). */
  current: number[];
  /** All 15 ships locked → this player is ready (waiting for the opponent). */
  placementDone: boolean;
  /** The OPPONENT's probes on THIS board: cell → hit|miss (incl. auto-marked halo misses on a sink). */
  shots: Record<number, ShotResult>;
  /** Indices into `ships` of this player's ships that are fully sunk. */
  sunk: number[];
}

interface ShipsBattleState {
  players: [PlayerId, PlayerId];
  /** Fixed at init — all seeded randomness (auto-place, auto-fire, first-shooter) derives from it. */
  seed: number;
  phase: 'placement' | 'shooting';
  /** Launch `now`; the ~60s placement deadline is measured from it (scheduledDeadlines). */
  placementStartedAt: number;
  boards: Record<PlayerId, PlayerBoard>;
  /** Shooting: whose turn it is. */
  turn: PlayerId | null;
  /** Shooting: `now` the current turn began; the ~20s shot deadline is measured from it. */
  turnStartedAt: number;
  winner?: PlayerId;
  forcedOutcome?: Outcome; // void — abandoned during placement
}

function cast(state: GameState): ShipsBattleState {
  return state as ShipsBattleState;
}
function other(s: ShipsBattleState, p: PlayerId): PlayerId {
  return s.players[0] === p ? s.players[1] : s.players[0];
}
function terminal(s: ShipsBattleState): boolean {
  return s.winner !== undefined || s.forcedOutcome !== undefined;
}
function freshBoard(): PlayerBoard {
  return { ships: [], current: [], placementDone: false, shots: {}, sunk: [] };
}
/** Cells occupied by this board's LOCKED ships (the current in-progress ship is separate). */
function lockedCells(b: PlayerBoard): Set<number> {
  const s = new Set<number>();
  for (const ship of b.ships) for (const c of ship) s.add(c);
  return s;
}
/** The no-touch buffer around all locked ships. */
function lockedHalo(b: PlayerBoard): Set<number> {
  const h = new Set<number>();
  for (const ship of b.ships) for (const c of haloOf(ship)) h.add(c);
  return h;
}
/** Ship index at cell c on this board (a defender's own ship), or -1. */
function shipIndexAt(b: PlayerBoard, c: number): number {
  for (let i = 0; i < b.ships.length; i++) if (b.ships[i].includes(c)) return i;
  return -1;
}

const meta: GameMeta = {
  id: 'ships-battle',
  displayName: 'Ships Battle',
  minPlayers: 2,
  maxPlayers: 2,
  // Skill game, like Chess → ELO ranking (the derived-on-query eloLeaderboard handles it) + 10% rake.
  ranking: { kind: 'elo', k: 32 },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 180,
  rakeRate: 0.1,
};

export const shipsBattleModule: GameModule = {
  meta,

  init(players: PlayerId[], rng: Rng): GameState {
    const state: ShipsBattleState = {
      players: [players[0], players[1]],
      seed: rng.int(0, 0x7fffffff),
      phase: 'placement',
      placementStartedAt: 0, // stamped by `launch`
      boards: { [players[0]]: freshBoard(), [players[1]]: freshBoard() } as Record<PlayerId, PlayerBoard>,
      turn: null,
      turnStartedAt: 0,
    };
    return state;
  },

  /** Stamp the placement clock origin at match formation (the ~60s placement window runs from it). */
  launch(state: GameState, now: number): GameState {
    return { ...cast(state), placementStartedAt: now };
  },

  legalMoves(state: GameState, playerId: PlayerId): Move[] {
    const s = cast(state);
    if (terminal(s) || !s.players.includes(playerId)) return [];
    const b = s.boards[playerId];

    if (s.phase === 'placement') {
      if (b.placementDone) return []; // ready — waiting for the opponent
      const occupied = lockedCells(b);
      const halo = lockedHalo(b);
      const moves: ShipsMove[] = [];
      if (b.current.length === 0) {
        for (const c of startCells(occupied, halo)) moves.push({ t: 'add', c });
      } else {
        for (const c of frontierCells(b.current, occupied, halo)) moves.push({ t: 'add', c });
        for (const c of b.current) moves.push({ t: 'remove', c });
      }
      moves.push({ t: 'auto' });
      return moves;
    }

    // Shooting: only the player to move may fire, at any un-probed opponent square.
    if (s.turn !== playerId) return [];
    const oppBoard = s.boards[other(s, playerId)];
    const moves: ShipsMove[] = [];
    for (let c = 0; c < CELLS; c++) if (oppBoard.shots[c] === undefined) moves.push({ t: 'fire', c });
    return moves;
  },

  applyMove(state: GameState, move: unknown, ctx: MoveContext): ApplyResult {
    const s = cast(state);
    const { playerId, now } = ctx;
    if (terminal(s) || !s.players.includes(playerId)) throw new IllegalMove(`${playerId} cannot move now`);
    const m = move as ShipsMove;
    if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') {
      throw new IllegalMove(`"${String(move)}" is not a valid move`);
    }

    if (s.phase === 'placement') return placementMove(s, playerId, m, now);
    return shootingMove(s, playerId, m, now);
  },

  isTerminal(state: GameState): boolean {
    return terminal(cast(state));
  },

  outcome(state: GameState): Outcome {
    const s = cast(state);
    if (s.forcedOutcome !== undefined) return s.forcedOutcome;
    return { type: 'win', winner: s.winner! };
  },

  /**
   * The integrity guarantee. Own board in full; the opponent's board only as THIS player has probed
   * it (their shots) + revealed SUNK ships and their halos. Never the opponent's un-sunk ships,
   * un-probed squares, or the seed (which could re-derive an auto-placed fleet). At terminal,
   * everything is revealed for verifiability.
   */
  viewFor(state: GameState, playerId: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s; // full reveal — the match is over

    const oppId = other(s, playerId);
    const opp = s.boards[oppId];
    // Reveal ONLY the opponent's sunk ships (their cells are already all-hit and known to this
    // player); strip every un-sunk ship and the in-progress build.
    const revealedShips = opp.sunk.map((i) => opp.ships[i]);
    const oppView: PlayerBoard = {
      ships: revealedShips,
      current: [],
      placementDone: opp.placementDone,
      shots: { ...opp.shots }, // this player's own probes — theirs to see
      sunk: opp.sunk.map((_, k) => k), // re-indexed onto revealedShips
    };

    const view: ShipsBattleState = {
      players: s.players,
      seed: 0, // redacted — never the real seed pre-terminal
      phase: s.phase,
      placementStartedAt: s.placementStartedAt,
      boards: { [playerId]: s.boards[playerId], [oppId]: oppView } as Record<PlayerId, PlayerBoard>,
      turn: s.turn,
      turnStartedAt: s.turnStartedAt,
    };
    return view as GameState;
  },

  /**
   * Explicit abandon. A DISCONNECT does NOT route here — Ships Battle opts into the generic
   * per-player timer (see scheduledDeadlines/timeoutMove), so an absent player is auto-placed /
   * auto-fired by the sweep, resolving the game. `forfeit` covers a real quit: during PLACEMENT →
   * void (refund, nothing has happened); during SHOOTING → the opponent wins. Never a void once
   * shooting has begun.
   */
  forfeit(state: GameState, quitter: PlayerId): GameState {
    const s = cast(state);
    if (terminal(s)) return s;
    if (s.phase === 'placement') return { ...s, forcedOutcome: { type: 'void' } };
    return { ...s, winner: other(s, quitter) };
  },

  /** Auto-move the core injects on a per-player timeout: PLACEMENT → `auto` (seeded auto-complete,
   *  resolved in applyMove from the stored seed); SHOOTING → fire a random un-probed square. */
  timeoutMove(state: GameState, playerId: PlayerId, rng: Rng): Move {
    const s = cast(state);
    if (s.phase === 'placement') return { t: 'auto' } satisfies ShipsMove;
    const oppBoard = s.boards[other(s, playerId)];
    const unprobed: number[] = [];
    for (let c = 0; c < CELLS; c++) if (oppBoard.shots[c] === undefined) unprobed.push(c);
    if (unprobed.length === 0) throw new IllegalMove(`${playerId} has nothing to fire at`);
    return { t: 'fire', c: unprobed[rng.int(0, unprobed.length - 1)] } satisfies ShipsMove;
  },

  /** Per-player deadlines (generic scheduled-timer capability): PLACEMENT → both unlocked players
   *  share the ~60s window from formation; SHOOTING → the player to move has ~20s from turn start. */
  scheduledDeadlines(state: GameState): Record<PlayerId, number> {
    const s = cast(state);
    if (terminal(s)) return {};
    const out: Record<PlayerId, number> = {};
    if (s.phase === 'placement') {
      if (s.placementStartedAt === 0) return {};
      for (const p of s.players) if (!s.boards[p].placementDone) out[p] = s.placementStartedAt + PLACEMENT_TIMEOUT_MS;
    } else if (s.turn != null) {
      out[s.turn] = s.turnStartedAt + SHOT_TIMEOUT_MS;
    }
    return out;
  },
};

// ── Placement ────────────────────────────────────────────────────────────────────────────────

function placementMove(s: ShipsBattleState, playerId: PlayerId, m: ShipsMove, now: number): ApplyResult {
  const cur = s.boards[playerId];
  if (cur.placementDone) throw new IllegalMove(`${playerId} has already locked their fleet`);

  const next: ShipsBattleState = cloneForBoardEdit(s, playerId);
  const b = next.boards[playerId];
  const events: GameEvent[] = [];

  switch (m.t) {
    case 'add': {
      const legal = m.c >= 0 && m.c < CELLS && isLegalAdd(b, m.c);
      if (!legal) throw new IllegalMove(`cell ${m.c} is not a legal placement`);
      b.current.push(m.c);
      // Auto-lock the current ship when it reaches its size (largest-first build order).
      const targetSize = SHIP_SIZES[b.ships.length];
      if (b.current.length === targetSize) {
        b.ships.push([...b.current].sort((x, y) => x - y));
        b.current = [];
        if (b.ships.length === FLEET_SHIPS) finishPlacement(next, playerId, events, now);
      }
      break;
    }
    case 'remove': {
      const i = b.current.indexOf(m.c);
      if (i < 0) throw new IllegalMove(`cell ${m.c} is not in the current ship`);
      b.current.splice(i, 1);
      break;
    }
    case 'auto': {
      // Seeded auto-complete from the LOCKED ships (the in-progress current ship is discarded). The
      // rng derives from the fixed seed + this player's index, so it's deterministic/replayable and
      // distinct per player. autoCompleteFleet always yields a valid fleet.
      const salt = s.players.indexOf(playerId);
      const fleet = autoCompleteFleet(b.ships, makeRng(mixSeed(s.seed, salt + 1)));
      b.ships = fleet.map((ship) => [...ship].sort((x, y) => x - y));
      b.current = [];
      finishPlacement(next, playerId, events, now);
      break;
    }
    default:
      throw new IllegalMove(`"${String((m as { t: unknown }).t)}" is not a placement move`);
  }

  return { state: next, events };
}

/** Is adding cell c legal for the current build state (a start cell, or a frontier extension)? */
function isLegalAdd(b: PlayerBoard, c: number): boolean {
  if (b.current.includes(c)) return false;
  const occupied = lockedCells(b);
  const halo = lockedHalo(b);
  if (b.current.length === 0) return startCells(occupied, halo).includes(c);
  return frontierCells(b.current, occupied, halo).includes(c);
}

/** Mark a player ready; once BOTH are ready, validate both fleets and begin shooting (seeded flip). */
function finishPlacement(s: ShipsBattleState, playerId: PlayerId, events: GameEvent[], now: number): void {
  const b = s.boards[playerId];
  // Backstop the construction invariants with the non-negotiable validator (never trust the shape).
  if (!validateFleet(b.ships)) throw new IllegalMove(`${playerId}'s fleet is invalid`);
  b.placementDone = true;
  events.push({ type: 'player_ready', payload: { playerId } }); // safe — only the readiness flag

  if (s.players.every((p) => s.boards[p].placementDone)) {
    s.phase = 'shooting';
    s.turn = s.players[firstShooterIndex(s.seed)]; // seeded coin-flip — the minor first-move edge
    s.turnStartedAt = now;
    events.push({ type: 'shooting_started', payload: { first: s.turn } }); // turn is public
  }
}

// ── Shooting ─────────────────────────────────────────────────────────────────────────────────

function shootingMove(s: ShipsBattleState, playerId: PlayerId, m: ShipsMove, now: number): ApplyResult {
  if (m.t !== 'fire') throw new IllegalMove(`"${m.t}" is not legal while shooting`);
  if (s.turn !== playerId) throw new IllegalMove(`not ${playerId}'s turn`);
  if (m.c < 0 || m.c >= CELLS) throw new IllegalMove(`cell ${m.c} is off the board`);

  const oppId = other(s, playerId);
  if (s.boards[oppId].shots[m.c] !== undefined) throw new IllegalMove(`cell ${m.c} already probed`);

  const next: ShipsBattleState = cloneForBoardEdit(s, oppId); // the shot lands on the opponent's board
  const opp = next.boards[oppId];
  const events: GameEvent[] = [];

  const shipIdx = shipIndexAt(opp, m.c);
  const hit = shipIdx >= 0;
  opp.shots[m.c] = hit ? 'hit' : 'miss';

  if (hit) {
    const ship = opp.ships[shipIdx];
    const sunkNow = ship.every((cell) => opp.shots[cell] === 'hit');
    if (sunkNow) {
      opp.sunk = [...opp.sunk, shipIdx];
      // No-touch guarantees the ship's halo is empty → auto-mark it as known-misses for the shooter.
      for (const h of haloOf(ship)) if (opp.shots[h] === undefined) opp.shots[h] = 'miss';
    }
  }

  // Broadcast-safe: only the probed cell + who fired (both players are entitled to this; each reads
  // the hit/miss + any sink from their own redacted viewFor — no hidden info travels in the event).
  events.push({ type: 'shot', payload: { by: playerId, c: m.c } });

  // Terminal the instant the opponent's whole fleet is sunk; otherwise pass the turn (one shot/turn).
  if (opp.sunk.length === FLEET_SHIPS) {
    next.winner = playerId;
  } else {
    next.turn = oppId;
    next.turnStartedAt = now;
  }
  return { state: next, events };
}

// ── Cloning (never mutate the input state; only the one edited board is deep-copied) ───────────

function cloneForBoardEdit(s: ShipsBattleState, boardOwner: PlayerId): ShipsBattleState {
  const b = s.boards[boardOwner];
  return {
    ...s,
    boards: {
      ...s.boards,
      [boardOwner]: {
        ships: b.ships.map((ship) => [...ship]),
        current: [...b.current],
        placementDone: b.placementDone,
        shots: { ...b.shots },
        sunk: [...b.sunk],
      },
    },
  };
}

export {
  CELLS, DIM, FLEET_SHIPS, FLEET_SQUARES, PLACEMENT_TIMEOUT_MS, SHIP_SIZES, SHOT_TIMEOUT_MS,
  autoPlaceFleet, validateFleet, idx, rowOf, colOf, haloOf,
} from './fleet.js';
