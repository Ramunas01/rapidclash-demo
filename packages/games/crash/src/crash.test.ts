import { describe, expect, it } from 'vitest';
import type { GameState, Move, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { crashModule as crash } from './crash.js';
import { altitudeAt, timeToAltitudeMs, drawCrashAltitude, CRASH_CONFIG } from './curve.js';

const A: PlayerId = 'alice';
const B: PlayerId = 'bob';
const START = 1_000_000; // arbitrary non-zero formation `now`

/** Seeded rng stub. `init` draws C with a single `rng.next()`. */
const rngWith = (u: number): Rng => ({ next: () => u, int: () => 0 });

/** A fresh launched round at C drawn from `u`. SETUP opens at START; the climb origin is later. */
function launched(u = 0.5): { state: GameState; C: number } {
  const s0 = crash.init([A, B], rngWith(u));
  const state = crash.launch!(s0, START);
  return { state, C: (state as { crashAltitude: number }).crashAltitude };
}

const startedAt = (s: GameState) => (s as { startedAt: number }).startedAt;
const view = (s: GameState, p: PlayerId) => crash.viewFor(s, p) as Record<string, unknown>;
const results = (v: Record<string, unknown>) => v.results as Record<string, { altitude: number; crashed: boolean } | undefined>;

/** Eject `atMs` after LAUNCH (after SETUP+ignition) → elapsed === atMs. */
const eject = (state: GameState, p: PlayerId, atMs: number) =>
  crash.applyMove(state, 'eject', { playerId: p, now: startedAt(state) + atMs });
/** Set an auto-eject during SETUP (a moment after formation). */
const setAuto = (state: GameState, p: PlayerId, altitude: number, move: Move = `auto:${altitude}`) =>
  crash.applyMove(state, move, { playerId: p, now: START + 1000 });

describe('crash curve (gentle, slow-start exponential)', () => {
  it('rises slowly at first, then accelerates', () => {
    expect(altitudeAt(0)).toBe(0);
    expect(altitudeAt(1000)).toBe(1); // barely moves in the first second (latency-tolerant)
    expect(altitudeAt(2000)).toBe(4);
    expect(altitudeAt(5000)).toBe(17);
    expect(altitudeAt(10_000)).toBe(95); // then climbs fast
    expect(altitudeAt(-500)).toBe(0); // clamped on the pad
  });

  it('the inverse round-trips at or above C across the range', () => {
    for (const C of [5, 50, 358, 1000, 2000]) {
      expect(altitudeAt(timeToAltitudeMs(C))).toBeGreaterThanOrEqual(C);
    }
  });

  it('C is drawn low-skewed within the capped range', () => {
    expect(drawCrashAltitude(rngWith(0))).toBe(CRASH_CONFIG.minCrashAltitude);
    expect(drawCrashAltitude(rngWith(0.999999))).toBeLessThanOrEqual(CRASH_CONFIG.maxCrashAltitude);
    expect(drawCrashAltitude(rngWith(0.5))).toBeLessThan((CRASH_CONFIG.minCrashAltitude + CRASH_CONFIG.maxCrashAltitude) / 2);
  });
});

describe('crash SETUP → ignition → climb phases', () => {
  it('launch opens SETUP at `now` and sets the climb origin a setup+ignition ahead', () => {
    const { state } = launched(0.5);
    expect((state as { setupEndsAt: number }).setupEndsAt).toBe(START + CRASH_CONFIG.setupMs);
    expect(startedAt(state)).toBe(START + CRASH_CONFIG.setupMs + CRASH_CONFIG.ignitionMs);
  });

  it('nothing crashes on the pad — every scheduled deadline is at/after the climb origin', () => {
    const { state } = launched(0.5);
    const origin = startedAt(state);
    for (const at of Object.values(crash.scheduledDeadlines!(state))) expect(at).toBeGreaterThanOrEqual(origin);
  });

  it('an EJECT on the pad (SETUP or ignition) is rejected and does NOT consume the eject', () => {
    const { state } = launched(0.5);
    // during SETUP
    expect(() => crash.applyMove(state, 'eject', { playerId: A, now: START + 2000 })).toThrow(IllegalMove);
    // during ignition (after setupEndsAt, before startedAt)
    expect(() => crash.applyMove(state, 'eject', { playerId: A, now: START + CRASH_CONFIG.setupMs + 500 })).toThrow(IllegalMove);
    // The eject is intact → A can still bank once the climb begins.
    const r = eject(state, A, 5000);
    expect(results(view(r.state, A))[A]!.altitude).toBe(17);
  });
});

describe('crashModule.meta', () => {
  it('is a 2-player net_winnings chance game with 2.5% rake', () => {
    expect(crash.meta.id).toBe('crash');
    expect(crash.meta.ranking).toEqual({ kind: 'net_winnings' });
    expect(crash.meta.rakeRate).toBe(0.025);
    expect(crash.meta.bet.symmetricStake).toBe(true);
  });
});

describe('crash gameplay (the climb)', () => {
  it('legalMoves offers eject + the auto-eject ladder until you resolve, then []', () => {
    const { state } = launched();
    const moves = crash.legalMoves(state, A);
    expect(moves).toContain('eject');
    expect(moves).toContain('auto:100');
    expect(moves).toContain('auto:off');
    const r = eject(state, A, 3000);
    expect(crash.legalMoves(r.state, A)).toEqual([]); // A has ejected
    expect(crash.legalMoves(r.state, B)).not.toEqual([]); // B still aboard
  });

  it('ejecting below C banks the live altitude; the higher bank wins', () => {
    const { state, C } = launched(0.5); // C = 358
    expect(C).toBe(358);
    const r1 = eject(state, A, 3000); // 7 m
    const r2 = eject(r1.state, B, 7000); // 35 m
    expect(crash.isTerminal(r2.state)).toBe(true);
    expect(crash.outcome(r2.state)).toEqual({ type: 'win', winner: B });
  });

  it('reaching C before ejecting busts you (bank 0) — banker beats a crash', () => {
    const { state } = launched(0.5); // C = 358 → crash ~14.3 s into the climb
    const r1 = eject(state, A, 3000); // banks 7
    const r2 = eject(r1.state, B, 16_000); // ≥ C → crash, banks 0
    expect(crash.outcome(r2.state)).toEqual({ type: 'win', winner: A });
  });

  it('both crash → draw; equal banks → draw', () => {
    const both = launched(0.5);
    const r = eject(eject(both.state, A, 16_000).state, B, 17_000);
    expect(crash.outcome(r.state)).toEqual({ type: 'draw' });

    const tie = launched(0.5);
    const r2 = eject(eject(tie.state, A, 3000).state, B, 3000);
    expect(crash.outcome(r2.state)).toEqual({ type: 'draw' });
  });
});

describe('crash auto-eject (server-authoritative pre-set)', () => {
  it('a set-auto-eject during SETUP records the altitude, emits no events, and does not resolve', () => {
    const { state } = launched(0.5);
    const r = setAuto(state, A, 100);
    expect(r.events).toEqual([]); // hidden — no broadcast
    expect(crash.legalMoves(r.state, A)).not.toEqual([]); // not resolved — A can still eject/re-set
    expect((view(r.state, A).autoEject as Record<string, number>)[A]).toBe(100); // A sees their own
  });

  it('schedules the auto-eject at min(its altitude time, the crash) and banks EXACTLY the preset', () => {
    const { state } = launched(0.5); // C = 358
    const r = setAuto(state, A, 100); // 100 < 358 → fires before the crash
    const autoAt = startedAt(r.state) + timeToAltitudeMs(100);
    expect(crash.scheduledDeadlines!(r.state)[A]).toBe(autoAt);
    // The sweep injects eject at that deadline → banks exactly 100 (deterministic, not now-sensitive).
    const fired = crash.applyMove(r.state, 'eject', { playerId: A, now: autoAt });
    expect(results(view(fired.state, A))[A]).toEqual({ altitude: 100, crashed: false });
    // Even a late sweep (slightly past the deadline) still banks the preset, not the live altitude.
    const late = crash.applyMove(r.state, 'eject', { playerId: A, now: autoAt + 400 });
    expect(results(view(late.state, A))[A]!.altitude).toBe(100);
  });

  it('an auto-eject set above C is overtaken by the crash (scheduled at the crash) → busts', () => {
    const { state } = launched(0.5); // C = 358
    const r = setAuto(state, A, 1000); // 1000 > 358
    const crashAt = startedAt(r.state) + timeToAltitudeMs(358);
    expect(crash.scheduledDeadlines!(r.state)[A]).toBe(crashAt); // the crash comes first
    const fired = crash.applyMove(r.state, 'eject', { playerId: A, now: crashAt });
    expect(results(view(fired.state, A))[A]!.crashed).toBe(true);
  });

  it('is re-settable / clearable during SETUP, and rejected after launch', () => {
    const { state } = launched(0.5);
    const r1 = setAuto(state, A, 100);
    const r2 = setAuto(r1.state, A, 500); // re-set
    expect((view(r2.state, A).autoEject as Record<string, number>)[A]).toBe(500);
    const r3 = setAuto(r2.state, A, 0, 'auto:off'); // clear
    expect((view(r3.state, A).autoEject as Record<string, number | undefined>)[A]).toBeUndefined();
    // After launch, set-auto is rejected.
    expect(() => crash.applyMove(state, 'auto:100', { playerId: A, now: startedAt(state) + 1000 })).toThrow(IllegalMove);
  });
});

describe('crash redaction (viewFor)', () => {
  it('hides C + the opponent auto-eject + the opponent ejection in play; reveals all at terminal', () => {
    const { state, C } = launched(0.5);
    const r0 = setAuto(state, B, 100); // B pre-sets (hidden from A)
    const r1 = eject(r0.state, A, 3000); // A banks 7, B still aboard

    const aView = view(r1.state, A);
    expect(aView.setupEndsAt).toBe(START + CRASH_CONFIG.setupMs); // public boundary
    expect(aView.startedAt).toBe(START + CRASH_CONFIG.setupMs + CRASH_CONFIG.ignitionMs);
    expect(aView.crashAltitude).toBeUndefined(); // C hidden
    expect((aView.autoEject as Record<string, unknown>)[B]).toBeUndefined(); // opponent's pre-set hidden
    expect(results(aView)[B]).toBeUndefined(); // opponent ejection hidden
    expect(results(aView)[A]!.altitude).toBe(7); // own ejection seen at once

    // Terminal → C + both auto-ejects + both ejections revealed.
    const r2 = eject(r1.state, B, 5000);
    const term = view(r2.state, A);
    expect(term.crashAltitude).toBe(C);
    expect((term.autoEject as Record<string, number>)[B]).toBe(100);
    expect(results(term)[B]!.altitude).toBe(17);
  });
});

describe('crash scheduled crash + forfeit (generic timer integration)', () => {
  it('timeoutMove is eject (the auto-bust the core injects at the deadline)', () => {
    const { state } = launched();
    expect(crash.timeoutMove!(state, A, rngWith(0))).toBe('eject');
  });

  it('forfeit busts the quitter and the opponent wins (terminal, never a void)', () => {
    const { state } = launched(0.5);
    const r1 = eject(state, A, 3000); // A banks 7
    const term = crash.forfeit(r1.state, B); // B gives up → crashes
    expect(crash.isTerminal(term)).toBe(true);
    expect(crash.outcome(term)).toEqual({ type: 'win', winner: A });
  });
});

describe('crash determinism', () => {
  it('same seed + same move times (auto-eject set + ejects) → identical C, banks, outcome', () => {
    const play = () => {
      const { state, C } = launched(0.5); // C = 358
      const r1 = setAuto(state, A, 100); // A pre-sets auto-eject at 100
      const aAt = startedAt(r1.state) + timeToAltitudeMs(100);
      const r2 = crash.applyMove(r1.state, 'eject', { playerId: A, now: aAt }); // A auto-banks 100
      const r3 = eject(r2.state, B, 5000); // B manual at 5 s → 17
      const v = view(r3.state, A);
      return { C, a: results(v)[A]!.altitude, b: results(v)[B]!.altitude, outcome: crash.outcome(r3.state) };
    };
    const first = play();
    expect(first).toEqual(play());
    // Exact expected values (not just self-consistency).
    expect(first).toEqual({ C: 358, a: 100, b: 17, outcome: { type: 'win', winner: A } });
  });
});
