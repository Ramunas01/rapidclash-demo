import type { Rng } from '@rapidclash/shared';

// Ships Battle geometry + the placement validator and seeded auto-placer (docs/SHIPS_BATTLE.md).
//
// A cell is a single integer index 0..99 (`row*DIM + col`) — JSON-friendly and enumerable, so a
// placement/shot move passes the core's strict legalMoves-membership check. The validator is the
// non-negotiable integrity gate (a locked fleet is accepted only if it satisfies every rule); the
// auto-placer reuses the SAME frontier helpers and is the dead-end safety net, the placement-timeout
// filler, and the builder's hold-to-randomize — one mechanism. Nothing here reads a clock/Math.random;
// the auto-placer takes the injected seeded `Rng`, so timeout placement replays exactly.

export const DIM = 10;
export const CELLS = DIM * DIM; // 100

/** 15 ships / 35 squares, built LARGEST-FIRST (the builder + auto-placer order). */
export const SHIP_SIZES: readonly number[] = [5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1];
export const FLEET_SHIPS = SHIP_SIZES.length; // 15
export const FLEET_SQUARES = SHIP_SIZES.reduce((a, b) => a + b, 0); // 35
/** Required ship-count by size — the validator's exact spec: {1:5, 2:4, 3:3, 4:2, 5:1}. */
export const FLEET_COUNTS: Readonly<Record<number, number>> = { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 };

/** Timers (ms) — reuse the generic per-player capability via the module's scheduledDeadlines. */
export const PLACEMENT_TIMEOUT_MS = 60_000;
export const SHOT_TIMEOUT_MS = 20_000;

export const rowOf = (i: number): number => Math.floor(i / DIM);
export const colOf = (i: number): number => i % DIM;
export const idx = (r: number, c: number): number => r * DIM + c;
const onBoard = (r: number, c: number): boolean => r >= 0 && r < DIM && c >= 0 && c < DIM;

/** The up/down/left/right neighbours of `i` that are on the board. */
export function edgeNeighbours(i: number): number[] {
  const r = rowOf(i), c = colOf(i);
  const out: number[] = [];
  if (onBoard(r - 1, c)) out.push(idx(r - 1, c));
  if (onBoard(r + 1, c)) out.push(idx(r + 1, c));
  if (onBoard(r, c - 1)) out.push(idx(r, c - 1));
  if (onBoard(r, c + 1)) out.push(idx(r, c + 1));
  return out;
}

/** The up-to-8 surrounding neighbours of `i` that are on the board (the no-touch / halo set). */
export function eightNeighbours(i: number): number[] {
  const r = rowOf(i), c = colOf(i);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (onBoard(r + dr, c + dc)) out.push(idx(r + dr, c + dc));
    }
  }
  return out;
}

/** The 8-neighbour halo around a ship (its surrounding buffer), excluding the ship's own cells. */
export function haloOf(ship: readonly number[]): number[] {
  const own = new Set(ship);
  const halo = new Set<number>();
  for (const c of ship) for (const n of eightNeighbours(c)) if (!own.has(n)) halo.add(n);
  return [...halo];
}

/** Is a set of cells an edge-connected polyomino (a single piece)? */
export function isConnected(cells: readonly number[]): boolean {
  if (cells.length === 0) return false;
  const set = new Set(cells);
  const seen = new Set<number>([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of edgeNeighbours(cur)) if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
  }
  return seen.size === cells.length;
}

/**
 * THE integrity gate. A fleet (array of ships, each an array of cell indices) is valid only if:
 *  - every cell is a distinct on-board integer (no overlap within or across ships);
 *  - ship counts by size are exactly FLEET_COUNTS;
 *  - each ship is an edge-connected polyomino of its length;
 *  - no two DISTINCT ships are 8-adjacent (the no-touch rule).
 * Anything else → false (the server rejects it, invariant #2).
 */
export function validateFleet(ships: readonly (readonly number[])[]): boolean {
  if (!Array.isArray(ships)) return false;
  // Counts by size.
  const counts: Record<number, number> = {};
  for (const ship of ships) {
    if (!Array.isArray(ship) || ship.length === 0) return false;
    counts[ship.length] = (counts[ship.length] ?? 0) + 1;
  }
  for (const size of Object.keys(FLEET_COUNTS)) {
    if ((counts[Number(size)] ?? 0) !== FLEET_COUNTS[Number(size)]) return false;
  }
  for (const size of Object.keys(counts)) {
    if (FLEET_COUNTS[Number(size)] === undefined) return false; // a ship of an illegal size
  }

  // Occupancy: every cell on-board, an integer, and owned by exactly one ship.
  const owner = new Map<number, number>();
  for (let si = 0; si < ships.length; si++) {
    for (const c of ships[si]) {
      if (!Number.isInteger(c) || c < 0 || c >= CELLS) return false;
      if (owner.has(c)) return false; // overlap (same ship dup or two ships share a cell)
      owner.set(c, si);
    }
  }

  // Connectivity per ship.
  for (const ship of ships) if (!isConnected(ship)) return false;

  // No two distinct ships 8-adjacent.
  for (let si = 0; si < ships.length; si++) {
    for (const c of ships[si]) {
      for (const n of eightNeighbours(c)) {
        const o = owner.get(n);
        if (o !== undefined && o !== si) return false;
      }
    }
  }
  return true;
}

/** Empty, on-board cells that may START a new ship: not occupied and not in any ship's halo. */
export function startCells(occupied: ReadonlySet<number>, halo: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (!occupied.has(i) && !halo.has(i)) out.push(i);
  return out;
}

/** Cells that may EXTEND the current (in-progress) ship: edge-adjacent to it, empty, not in any
 *  halo, and not already part of the current ship. (No whole-fleet pruning — v1, per spec.) */
export function frontierCells(current: readonly number[], occupied: ReadonlySet<number>, halo: ReadonlySet<number>): number[] {
  const cur = new Set(current);
  const out = new Set<number>();
  for (const c of current) {
    for (const n of edgeNeighbours(c)) {
      if (!cur.has(n) && !occupied.has(n) && !halo.has(n)) out.add(n);
    }
  }
  return [...out];
}

/** Grow ONE ship of `size` from a random eligible start along the frontier (the shared routine the
 *  human builder's hold-to-randomize uses too). Returns the ship, or null if it dead-ended → the
 *  caller restarts the whole fleet. Deterministic given `rng`. */
function placeOneShip(size: number, occupied: ReadonlySet<number>, halo: ReadonlySet<number>, rng: Rng): number[] | null {
  const starts = startCells(occupied, halo);
  if (starts.length === 0) return null;
  const ship = [starts[rng.int(0, starts.length - 1)]];
  while (ship.length < size) {
    const front = frontierCells(ship, occupied, halo);
    if (front.length === 0) return null; // boxed in → restart the fleet
    ship.push(front[rng.int(0, front.length - 1)]);
  }
  return ship;
}

const MAX_FLEET_ATTEMPTS = 500;

/**
 * Seeded auto-completer: given the ships ALREADY locked (largest-first prefix), place the
 * REMAINING ships around them, restarting the remaining-fleet on any dead-end (a naive pass
 * succeeds ~20% of the time; retry fills reliably in ~5 passes, sub-ms). If the locked ships have
 * boxed out the rest (no completion exists), fall back to a FRESH full fleet — so this is the
 * always-succeeds safety net (dead-end escape, hold-to-randomize, and the placement-timeout
 * filler). The result is guaranteed to pass `validateFleet`. Deterministic given `rng`.
 */
export function autoCompleteFleet(locked: readonly (readonly number[])[], rng: Rng): number[][] {
  const baseOccupied = new Set<number>();
  const baseHalo = new Set<number>();
  for (const ship of locked) {
    for (const c of ship) baseOccupied.add(c);
    for (const h of haloOf(ship)) baseHalo.add(h);
  }
  const remainingSizes = SHIP_SIZES.slice(locked.length);
  for (let attempt = 0; attempt < MAX_FLEET_ATTEMPTS; attempt++) {
    const occupied = new Set(baseOccupied);
    const halo = new Set(baseHalo);
    const added: number[][] = [];
    let ok = true;
    for (const size of remainingSizes) {
      const ship = placeOneShip(size, occupied, halo, rng);
      if (!ship) { ok = false; break; }
      for (const c of ship) occupied.add(c);
      for (const h of haloOf(ship)) halo.add(h);
      added.push(ship);
    }
    if (ok) return [...locked.map((s) => [...s]), ...added];
  }
  // The locked prefix is unsatisfiable — discard it and place a fresh full fleet (always succeeds).
  return locked.length === 0
    ? (() => { throw new Error('autoCompleteFleet: empty-prefix retries exhausted (statistically impossible)'); })()
    : autoCompleteFleet([], rng);
}

/** Seeded auto-placer for a WHOLE fleet (the common case + the dead-end safety net). */
export function autoPlaceFleet(rng: Rng): number[][] {
  return autoCompleteFleet([], rng);
}

/** mulberry32 — a small deterministic PRNG, used to derive seeded randomness inside `applyMove`
 *  (which gets no injected rng): the auto-placement and the first-shooter flip both derive from the
 *  match's fixed `seed`, so a replay of the recorded moves reproduces them exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix two 32-bit values into one seed (e.g. base seed + a per-player salt). */
export function mixSeed(a: number, b: number): number {
  let h = (a >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/** A seeded `Rng` (for the module's seed-derived auto-placement). */
export function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  return { next, int: (min, max) => min + Math.floor(next() * (max - min + 1)) };
}

/** Deterministic first-shooter index (0 or 1) from the match seed — the seeded coin-flip. */
export function firstShooterIndex(seed: number): 0 | 1 {
  return makeRng(mixSeed(seed, 0x5ca1ab1e)).int(0, 1) as 0 | 1;
}
