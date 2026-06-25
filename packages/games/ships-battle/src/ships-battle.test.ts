import { describe, expect, it } from 'vitest';
import type { GameState, Move, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { shipsBattleModule as sb } from './ships-battle.js';
import { CELLS, FLEET_SHIPS, PLACEMENT_TIMEOUT_MS, SHOT_TIMEOUT_MS, idx, validateFleet } from './fleet.js';

const A: PlayerId = 'alice';
const B: PlayerId = 'bob';

/** init draws the base seed with one rng.int(0, …); fix it so the match is reproducible. */
const rngWith = (seed: number): Rng => ({ next: () => 0, int: () => seed });
/** A real seeded rng for timeoutMove auto-fire tests. */
const realRng = (s: number): Rng => {
  let a = s >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (min, max) => min + Math.floor(next() * (max - min + 1)) };
};

const apply = (state: GameState, p: PlayerId, move: Move, now = 0) => sb.applyMove(state, move, { playerId: p, now });
const view = (state: GameState, p: PlayerId) => sb.viewFor(state, p) as Record<string, unknown>;
const board = (v: Record<string, unknown>, p: PlayerId) => (v.boards as Record<string, { ships: number[][]; shots: Record<number, string>; current: number[] }>)[p];

const hShip = (r: number, c: number, len: number) => Array.from({ length: len }, (_, k) => idx(r, c + k));
/** A spaced, valid fleet in SHIP_SIZES order whose ships are horizontal (so manual left→right adds
 *  are always connected/legal). */
function refFleet(): number[][] {
  return [
    hShip(0, 0, 5),
    hShip(2, 0, 4), hShip(2, 5, 4),
    hShip(4, 0, 3), hShip(4, 4, 3), hShip(6, 0, 3),
    hShip(4, 8, 2), hShip(6, 4, 2), hShip(6, 7, 2), hShip(8, 0, 2),
    [idx(8, 3)], [idx(8, 5)], [idx(8, 7)], [idx(8, 9)], [idx(0, 6)],
  ];
}

/** Drive a player's placement by adding each ship's cells left→right (ships in SHIP_SIZES order). */
function placeManual(state: GameState, p: PlayerId, fleet: number[][]): GameState {
  let st = state;
  for (const ship of fleet) for (const c of ship) st = apply(st, p, { t: 'add', c }).state;
  return st;
}

/** A launched match in PLACEMENT, seed fixed. */
function launched(seed = 12345): GameState {
  return sb.launch!(sb.init([A, B], rngWith(seed)), 1_000_000);
}

describe('ships-battle.meta', () => {
  it('is a 2-player ELO skill game with 10% rake', () => {
    expect(sb.meta.id).toBe('ships-battle');
    expect(sb.meta.ranking).toEqual({ kind: 'elo', k: 32 });
    expect(sb.meta.rakeRate).toBe(0.1);
    expect(sb.meta.bet.symmetricStake).toBe(true);
  });
});

describe('placement (incremental builder, largest-first)', () => {
  it('starts by offering every cell as a ship-start + auto', () => {
    const s = launched();
    const moves = sb.legalMoves(s, A) as { t: string; c?: number }[];
    expect(moves.filter((m) => m.t === 'add')).toHaveLength(CELLS); // any cell can start the size-5
    expect(moves.some((m) => m.t === 'auto')).toBe(true);
  });

  it('auto-locks the current ship at its size, then offers the next ship; frontier extends only', () => {
    let s = launched();
    // Build the size-5 ship across row 0.
    s = apply(s, A, { t: 'add', c: idx(0, 0) }).state;
    // After one cell, only the frontier (4 neighbours, but on-edge → 2) extends, plus remove + auto.
    let mv = sb.legalMoves(s, A) as { t: string; c?: number }[];
    expect(mv.filter((m) => m.t === 'add').map((m) => m.c).sort((x, y) => x! - y!)).toEqual([idx(0, 1), idx(1, 0)]);
    expect(mv.some((m) => m.t === 'remove' && m.c === idx(0, 0))).toBe(true);
    for (const c of [idx(0, 1), idx(0, 2), idx(0, 3), idx(0, 4)]) s = apply(s, A, { t: 'add', c }).state;
    // The size-5 locked → next ship (size 4) starts; the locked ship's halo (row 1) is blocked.
    const b = (s as { boards: Record<string, { ships: number[][]; current: number[] }> }).boards[A];
    expect(b.ships).toHaveLength(1);
    expect(b.current).toHaveLength(0);
    mv = sb.legalMoves(s, A) as { t: string; c?: number }[];
    const starts = mv.filter((m) => m.t === 'add').map((m) => m.c);
    expect(starts).not.toContain(idx(1, 0)); // halo of the size-5 ship — blocked
    expect(starts).toContain(idx(2, 0)); // clear of the halo — a legal start
  });

  it('a full manual fleet validates and marks the player ready', () => {
    const s = placeManual(launched(), A, refFleet());
    const b = (s as { boards: Record<string, { ships: number[][]; placementDone: boolean }> }).boards[A];
    expect(b.ships).toHaveLength(FLEET_SHIPS);
    expect(b.placementDone).toBe(true);
    expect(validateFleet(b.ships)).toBe(true);
    expect(sb.legalMoves(s, A)).toEqual([]); // ready — waiting for the opponent
  });

  it('rejects an illegal add (a halo / non-frontier cell)', () => {
    let s = launched();
    s = apply(s, A, { t: 'add', c: idx(0, 0) }).state;
    expect(() => apply(s, A, { t: 'add', c: idx(5, 5) })).toThrow(IllegalMove); // not on the frontier
  });

  it('`auto` completes a valid fleet (the timeout/hold filler), deterministically by seed', () => {
    const s1 = apply(launched(777), A, { t: 'auto' }).state;
    const s2 = apply(launched(777), A, { t: 'auto' }).state;
    const b1 = (s1 as { boards: Record<string, { ships: number[][]; placementDone: boolean }> }).boards[A];
    expect(b1.placementDone).toBe(true);
    expect(validateFleet(b1.ships)).toBe(true);
    expect(b1.ships).toEqual((s2 as { boards: Record<string, { ships: number[][] }> }).boards[A].ships);
  });
});

describe('transition to shooting', () => {
  it('both ready → phase shooting with a seeded first shooter', () => {
    let s = placeManual(launched(), A, refFleet());
    expect((s as { phase: string }).phase).toBe('placement');
    s = placeManual(s, B, refFleet());
    const st = s as { phase: string; turn: PlayerId };
    expect(st.phase).toBe('shooting');
    expect([A, B]).toContain(st.turn);
    // The non-mover has no moves; the mover may fire any un-probed square.
    const mover = st.turn, waiter = mover === A ? B : A;
    expect(sb.legalMoves(s, waiter)).toEqual([]);
    expect(sb.legalMoves(s, mover)).toHaveLength(CELLS);
  });
});

/** Place both fleets and return { state, shooter } in SHOOTING. */
function inShooting(seed = 12345): { state: GameState; shooter: PlayerId } {
  let s = placeManual(launched(seed), A, refFleet());
  s = placeManual(s, B, refFleet());
  return { state: s, shooter: (s as { turn: PlayerId }).turn };
}

describe('shooting (hit / miss / sink + halo / win)', () => {
  it('records hit on a ship cell and miss on water; passes the turn after one shot', () => {
    const { state, shooter } = inShooting();
    const target = shooter === A ? B : A;
    // refFleet has a ship at (0,0); water at (1,1) (a halo cell, definitely empty).
    const r1 = apply(state, shooter, { t: 'fire', c: idx(0, 0) });
    const tb = board(view(r1.state, shooter), target);
    expect(tb.shots[idx(0, 0)]).toBe('hit');
    expect((r1.state as { turn: PlayerId }).turn).toBe(target); // one shot per turn

    // The opponent fires a miss, then the shooter fires water → miss.
    const r2 = apply(r1.state, target, { t: 'fire', c: idx(9, 9) });
    const r3 = apply(r2.state, shooter, { t: 'fire', c: idx(1, 1) });
    expect(board(view(r3.state, shooter), target).shots[idx(1, 1)]).toBe('miss');
  });

  it('completing a ship SINKS it and auto-marks its halo as known-misses', () => {
    const { state, shooter } = inShooting();
    const target = shooter === A ? B : A;
    const single = idx(0, 6); // a size-1 ship in refFleet → one hit sinks it
    const r = apply(state, shooter, { t: 'fire', c: single });
    const tb = board(view(r.state, shooter), target);
    expect(tb.shots[single]).toBe('hit');
    // Its 8-neighbour halo is auto-marked miss (no-touch makes that honest) and revealed as a sink.
    expect(tb.shots[idx(0, 5)]).toBe('miss');
    expect(tb.shots[idx(1, 6)]).toBe('miss');
    expect(tb.ships).toContainEqual([single]); // the sunk ship is revealed
  });

  it('rejects firing an already-probed square and firing out of turn', () => {
    const { state, shooter } = inShooting();
    const target = shooter === A ? B : A;
    expect(() => apply(state, target, { t: 'fire', c: idx(5, 5) })).toThrow(IllegalMove); // not your turn
    const r1 = apply(state, shooter, { t: 'fire', c: idx(0, 0) }); // shooter probes target (0,0)
    const r2 = apply(r1.state, target, { t: 'fire', c: idx(9, 9) }); // target's turn → back to shooter
    expect(() => apply(r2.state, shooter, { t: 'fire', c: idx(0, 0) })).toThrow(IllegalMove); // re-probe → rejected
  });
});

/** Play `shooter` to a win: it fires every one of the target's 35 ship cells, while the target
 *  fires harmless misses (cells empty on the shooter's board) on its turns. */
function playToWin(start: GameState, shooter: PlayerId, fleet: number[][]): GameState {
  const target = shooter === A ? B : A;
  const targetCells = fleet.flat(); // 35 cells to hit
  const shooterEmpty: number[] = [];
  const occ = new Set(fleet.flat());
  for (let c = 0; c < CELLS; c++) if (!occ.has(c)) shooterEmpty.push(c);
  let st = start, ti = 0, ei = 0, guard = 0;
  while (!sb.isTerminal(st) && guard++ < 300) {
    const turn = (st as { turn: PlayerId }).turn;
    if (turn === shooter) st = apply(st, shooter, { t: 'fire', c: targetCells[ti++] }).state;
    else st = apply(st, target, { t: 'fire', c: shooterEmpty[ei++] }).state;
  }
  return st;
}

describe('terminal + outcome', () => {
  it('sinking the opponent’s whole fleet wins (no draw)', () => {
    const { state, shooter } = inShooting();
    const end = playToWin(state, shooter, refFleet());
    expect(sb.isTerminal(end)).toBe(true);
    expect(sb.outcome(end)).toEqual({ type: 'win', winner: shooter });
  });

  it('forfeit: void in placement, opponent wins in shooting', () => {
    expect(sb.outcome(sb.forfeit(launched(), A))).toEqual({ type: 'void' });
    const { state, shooter } = inShooting();
    const quitter = shooter === A ? B : A;
    expect(sb.outcome(sb.forfeit(state, quitter))).toEqual({ type: 'win', winner: shooter });
  });
});

describe('redaction (viewFor) — the integrity guarantee', () => {
  it('NEVER reveals the opponent’s un-sunk ships, in-progress build, or the seed', () => {
    // Mid-placement: A has built some, B has built some. Neither sees the other's squares.
    let s = launched();
    s = apply(s, A, { t: 'add', c: idx(0, 0) }).state; // A starts a ship
    s = apply(s, B, { t: 'add', c: idx(9, 9) }).state; // B starts a ship
    const aSeesB = board(view(s, A), B);
    expect(aSeesB.ships).toEqual([]); // B's in-progress ship is invisible
    expect(aSeesB.current ?? []).toEqual([]);
    expect((view(s, A) as { seed: number }).seed).toBe(0); // seed redacted

    // Shooting: A has probed nothing of B's un-sunk fleet → A sees no B ships.
    const { state, shooter } = inShooting();
    const target = shooter === A ? B : A;
    const beforeAnyShot = board(view(state, shooter), target);
    expect(beforeAnyShot.ships).toEqual([]); // not one un-sunk opponent ship leaks
    // After sinking exactly ONE ship, ONLY that ship is revealed — the other 14 stay hidden.
    const r = apply(state, shooter, { t: 'fire', c: idx(0, 6) }).state; // sink the size-1
    const afterOneSink = board(view(r, shooter), target);
    expect(afterOneSink.ships).toEqual([[idx(0, 6)]]); // only the sunk ship
  });

  it('own board is always fully visible to its owner', () => {
    const { state, shooter } = inShooting();
    const ownView = board(view(state, shooter), shooter);
    expect(ownView.ships).toHaveLength(FLEET_SHIPS); // I see my own fleet
  });
});

describe('timers (generic per-player capability)', () => {
  it('placement deadlines for both unlocked players; cleared once ready', () => {
    let s = launched();
    expect(sb.scheduledDeadlines!(s)).toEqual({ [A]: 1_000_000 + PLACEMENT_TIMEOUT_MS, [B]: 1_000_000 + PLACEMENT_TIMEOUT_MS });
    s = placeManual(s, A, refFleet());
    expect(sb.scheduledDeadlines!(s)).toEqual({ [B]: 1_000_000 + PLACEMENT_TIMEOUT_MS }); // A is ready → dropped
  });

  it('shooting deadline for the player to move only', () => {
    const { state, shooter } = inShooting();
    const r = apply(state, shooter, { t: 'fire', c: idx(0, 0) }, 5_000_000);
    const target = shooter === A ? B : A;
    expect(sb.scheduledDeadlines!(r.state)).toEqual({ [target]: 5_000_000 + SHOT_TIMEOUT_MS });
  });

  it('timeoutMove → `auto` in placement, → a random un-probed `fire` in shooting', () => {
    expect(sb.timeoutMove!(launched(), A, realRng(1))).toEqual({ t: 'auto' });
    const { state, shooter } = inShooting();
    const fire = sb.timeoutMove!(state, shooter, realRng(1)) as { t: string; c: number };
    expect(fire.t).toBe('fire');
    expect(fire.c).toBeGreaterThanOrEqual(0);
    // applying it is legal (it's a real un-probed square).
    expect(() => apply(state, shooter, fire)).not.toThrow();
  });
});

describe('determinism', () => {
  it('same seed + same recorded placements + shots → identical results', () => {
    const play = () => {
      const { state, shooter } = inShooting(98765);
      const target = shooter === A ? B : A;
      // A fixed short shot sequence: shooter hits two cells of a ship, target misses between.
      let st = apply(state, shooter, { t: 'fire', c: idx(0, 0) }).state;
      st = apply(st, target, { t: 'fire', c: idx(9, 9) }).state;
      st = apply(st, shooter, { t: 'fire', c: idx(0, 1) }).state;
      return { shooter, view: sb.viewFor(st, shooter), term: sb.isTerminal(st) };
    };
    expect(play()).toEqual(play());
    // The first shooter is a deterministic function of the seed (not ambient).
    expect(inShooting(98765).shooter).toBe(inShooting(98765).shooter);
  });
});
