import { describe, expect, it } from 'vitest';
import type { Rng } from '@rapidclash/shared';
import {
  CELLS, FLEET_COUNTS, FLEET_SHIPS, FLEET_SQUARES, SHIP_SIZES,
  autoPlaceFleet, eightNeighbours, frontierCells, haloOf, idx, isConnected, startCells, validateFleet,
} from './fleet.js';

/** A real seeded PRNG for the auto-placer tests (mulberry32). */
function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (min, max) => min + Math.floor(next() * (max - min + 1)) };
}

/** A horizontal ship of `len` cells starting at (r,c). */
const hShip = (r: number, c: number, len: number) => Array.from({ length: len }, (_, k) => idx(r, c + k));

/** A spaced-out valid reference fleet in SHIP_SIZES order (ships on even rows, ≥1 empty col
 *  between them → guaranteed no-touch), for validator tests. f[0]=5, f[1..2]=4, f[3..5]=3,
 *  f[6..9]=2, f[10..14]=1. */
function refFleet(): number[][] {
  return [
    hShip(0, 0, 5),
    hShip(2, 0, 4), hShip(2, 5, 4),
    hShip(4, 0, 3), hShip(4, 4, 3), hShip(6, 0, 3),
    hShip(4, 8, 2), hShip(6, 4, 2), hShip(6, 7, 2), hShip(8, 0, 2),
    [idx(8, 3)], [idx(8, 5)], [idx(8, 7)], [idx(8, 9)], [idx(0, 6)],
  ];
}

describe('fleet geometry', () => {
  it('declares the {1:5, 2:4, 3:3, 4:2, 5:1} fleet (15 ships, 35 squares)', () => {
    expect(FLEET_SHIPS).toBe(15);
    expect(FLEET_SQUARES).toBe(35);
    const counts: Record<number, number> = {};
    for (const s of SHIP_SIZES) counts[s] = (counts[s] ?? 0) + 1;
    expect(counts).toEqual({ 5: 1, 4: 2, 3: 3, 2: 4, 1: 5 });
    expect(FLEET_COUNTS).toEqual({ 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 });
  });

  it('isConnected accepts a polyomino and rejects a split', () => {
    expect(isConnected([idx(0, 0), idx(0, 1), idx(1, 1)])).toBe(true); // an L-tromino
    expect(isConnected([idx(0, 0), idx(0, 2)])).toBe(false); // gap
    expect(isConnected([idx(5, 5)])).toBe(true);
  });

  it('eightNeighbours/haloOf respect the board edges', () => {
    expect(eightNeighbours(idx(0, 0)).sort((a, b) => a - b)).toEqual([idx(0, 1), idx(1, 0), idx(1, 1)]);
    expect(haloOf([idx(0, 0)]).sort((a, b) => a - b)).toEqual([idx(0, 1), idx(1, 0), idx(1, 1)]);
  });
});

describe('validateFleet (the integrity gate)', () => {
  it('accepts a correct, spaced-out fleet', () => {
    expect(validateFleet(refFleet())).toBe(true);
  });

  it('rejects wrong ship counts', () => {
    const f = refFleet(); f.pop(); // 14 ships
    expect(validateFleet(f)).toBe(false);
    const g = refFleet(); g.push([idx(0, 9)]); // a 6th size-1
    expect(validateFleet(g)).toBe(false);
  });

  it('rejects a disconnected "ship"', () => {
    const f = refFleet();
    f[0] = [idx(0, 0), idx(0, 1), idx(0, 2), idx(0, 3), idx(0, 9)]; // size 5 but split
    expect(validateFleet(f)).toBe(false);
  });

  it('rejects two ships that touch (even diagonally)', () => {
    const f = refFleet();
    f[14] = [idx(1, 5)]; // diagonally adjacent to the row-2 ship at (2,6)
    expect(validateFleet(f)).toBe(false);
  });

  it('rejects overlap and off-board cells', () => {
    const f = refFleet(); f[14] = [idx(0, 0)]; // overlaps the size-5 ship
    expect(validateFleet(f)).toBe(false);
    const g = refFleet(); g[14] = [CELLS + 3];
    expect(validateFleet(g)).toBe(false);
  });
});

describe('auto-placer (dead-end safety net + timeout filler)', () => {
  it('reliably fills a complete, VALID fleet across many seeds', () => {
    for (let seed = 1; seed <= 600; seed++) {
      const fleet = autoPlaceFleet(seededRng(seed));
      expect(validateFleet(fleet)).toBe(true);
      expect(fleet.flat()).toHaveLength(FLEET_SQUARES);
    }
  });

  it('is deterministic: same seed → identical fleet', () => {
    expect(autoPlaceFleet(seededRng(42))).toEqual(autoPlaceFleet(seededRng(42)));
    expect(autoPlaceFleet(seededRng(42))).not.toEqual(autoPlaceFleet(seededRng(43)));
  });

  it('frontier/start helpers only offer empty, non-halo cells', () => {
    const occupied = new Set(hShip(0, 0, 3));
    const halo = new Set(haloOf(hShip(0, 0, 3)));
    for (const s of startCells(occupied, halo)) { expect(occupied.has(s)).toBe(false); expect(halo.has(s)).toBe(false); }
    const front = frontierCells([idx(5, 5)], occupied, halo);
    expect(front.sort((a, b) => a - b)).toEqual([idx(4, 5), idx(5, 4), idx(5, 6), idx(6, 5)].sort((a, b) => a - b));
  });
});
