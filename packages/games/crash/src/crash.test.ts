import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { crashModule as crash } from './crash.js';
import { altitudeAt, timeToAltitudeMs, drawCrashAltitude, CRASH_CONFIG } from './curve.js';

const A: PlayerId = 'alice';
const B: PlayerId = 'bob';
const START = 1_000_000; // arbitrary non-zero launch `now`

/** Seeded rng stub. `init` draws C with a single `rng.next()`. */
const rngWith = (u: number): Rng => ({ next: () => u, int: () => 0 });

/** A fresh launched round at C drawn from `u`. The climb origin sits a countdown ahead of START. */
function launched(u = 0.5): { state: GameState; C: number } {
  const s0 = crash.init([A, B], rngWith(u));
  const state = crash.launch!(s0, START);
  return { state, C: (state as { crashAltitude: number }).crashAltitude };
}

const startedAt = (s: GameState) => (s as { startedAt: number }).startedAt;
/** Eject `atMs` after LAUNCH (i.e. after the pad countdown) → elapsed === atMs. */
const eject = (state: GameState, p: PlayerId, atMs: number) =>
  crash.applyMove(state, 'eject', { playerId: p, now: startedAt(state) + atMs });

describe('crash curve', () => {
  it('altitude accelerates and the inverse round-trips above C', () => {
    expect(altitudeAt(0)).toBe(0);
    expect(altitudeAt(1000)).toBe(10); // 10·1²
    expect(altitudeAt(3000)).toBe(90); // 10·3²
    expect(altitudeAt(5000)).toBe(250); // 10·5²
    // timeToAltitudeMs rounds UP so the climb has definitely reached the altitude by then.
    for (const C of [25, 100, 904, 4999, 5000]) {
      expect(altitudeAt(timeToAltitudeMs(C))).toBeGreaterThanOrEqual(C);
    }
  });

  it('C is drawn low-skewed within the capped range', () => {
    expect(drawCrashAltitude(rngWith(0))).toBe(CRASH_CONFIG.minCrashAltitude);
    expect(drawCrashAltitude(rngWith(0.999999))).toBeLessThanOrEqual(CRASH_CONFIG.maxCrashAltitude);
    // Skewed low: the midpoint u draws C well below the linear midpoint.
    const mid = drawCrashAltitude(rngWith(0.5));
    expect(mid).toBeLessThan((CRASH_CONFIG.minCrashAltitude + CRASH_CONFIG.maxCrashAltitude) / 2);
  });
});

describe('crash pre-launch countdown (server-authoritative pad)', () => {
  it('launch sets the climb origin a countdown ahead of `now`', () => {
    const s = crash.launch!(crash.init([A, B], rngWith(0.5)), START);
    expect(startedAt(s)).toBe(START + CRASH_CONFIG.launchCountdownMs);
  });

  it('the whole schedule (the crash) shifts forward by the countdown — nothing fires on the pad', () => {
    const { state } = launched(0.5); // C = 904
    const crashAt = crash.scheduledDeadlines!(state)[A];
    expect(crashAt).toBe(START + CRASH_CONFIG.launchCountdownMs + timeToAltitudeMs(904));
    expect(crashAt).toBeGreaterThan(startedAt(state)); // crash is after the pad, never on it
  });

  it('an eject ON THE PAD is rejected and does NOT consume the single eject', () => {
    const { state } = launched(0.5);
    // now during the countdown (before startedAt) → rejected.
    expect(() => crash.applyMove(state, 'eject', { playerId: A, now: START + 1000 })).toThrow(IllegalMove);
    // The eject is intact: A can still eject once the climb begins, banking the live altitude.
    expect(crash.legalMoves(state, A)).toEqual(['eject']);
    const r = eject(state, A, 2000); // 2 s after launch → 10·2² = 40 m
    expect((crash.viewFor(r.state, A) as { results: Record<string, { altitude: number }> }).results[A].altitude).toBe(40);
  });

  it('altitude is clamped to 0 on the pad (negative elapsed)', () => {
    expect(altitudeAt(-CRASH_CONFIG.launchCountdownMs)).toBe(0);
    expect(altitudeAt(-1)).toBe(0);
  });
});

describe('crashModule.meta', () => {
  it('is a 2-player net_winnings chance game with 2.5% rake', () => {
    expect(crash.meta.id).toBe('crash');
    expect(crash.meta.ranking).toEqual({ kind: 'net_winnings' });
    expect(crash.meta.rakeRate).toBe(0.025);
    expect(crash.meta.bet.symmetricStake).toBe(true);
    expect(crash.meta.bet.minStake).toBeGreaterThanOrEqual(1);
    expect(crash.meta.bet.maxStake).toBeLessThanOrEqual(100);
  });
});

describe('crash gameplay', () => {
  it('legalMoves is [eject] until you resolve, then []', () => {
    const { state } = launched();
    expect(crash.legalMoves(state, A)).toEqual(['eject']);
    expect(crash.legalMoves(state, B)).toEqual(['eject']);
    const r = eject(state, A, 3000);
    expect(crash.legalMoves(r.state, A)).toEqual([]); // A has ejected
    expect(crash.legalMoves(r.state, B)).toEqual(['eject']); // B still aboard
  });

  it('ejecting below C banks the live altitude; the higher bank wins', () => {
    const { state, C } = launched(0.5); // C = 904
    expect(C).toBe(904);
    const r1 = eject(state, A, 3000); // 90 m
    const r2 = eject(r1.state, B, 5000); // 250 m
    expect(crash.isTerminal(r2.state)).toBe(true);
    expect(crash.outcome(r2.state)).toEqual({ type: 'win', winner: B });
  });

  it('reaching C before ejecting busts you (bank 0) — banker beats a crash', () => {
    const { state } = launched(0.5); // C = 904 → crash time ~9508ms
    const r1 = eject(state, A, 3000); // banks 90
    const r2 = eject(r1.state, B, 10_000); // 1000 m ≥ C → crash, banks 0
    expect(crash.isTerminal(r2.state)).toBe(true);
    expect(crash.outcome(r2.state)).toEqual({ type: 'win', winner: A });
  });

  it('both crash (neither ejects before C) → draw (refund)', () => {
    const { state } = launched(0.5);
    const r1 = eject(state, A, 10_000); // crash
    const r2 = eject(r1.state, B, 11_000); // crash
    expect(crash.outcome(r2.state)).toEqual({ type: 'draw' });
  });

  it('equal banks → draw', () => {
    const { state } = launched(0.5);
    const r1 = eject(state, A, 3000); // 90
    const r2 = eject(r1.state, B, 3000); // 90
    expect(crash.outcome(r2.state)).toEqual({ type: 'draw' });
  });

  it('rejects a non-eject move and a double-eject', () => {
    const { state } = launched();
    expect(() => crash.applyMove(state, 'boost', { playerId: A, now: START + 1000 })).toThrow(IllegalMove);
    const r = eject(state, A, 1000);
    expect(() => eject(r.state, A, 2000)).toThrow(IllegalMove);
  });
});

describe('crash redaction (viewFor)', () => {
  it('hides C and the opponent ejection in play; reveals your own; full reveal at terminal', () => {
    const { state, C } = launched(0.5);
    const r1 = eject(state, A, 3000); // A banks 90, B still aboard

    // applyMove emits NO events — the gateway broadcasts events to BOTH players unredacted, so an
    // eject must leak nothing (the opponent learns of it only via the terminal viewFor).
    expect(r1.events).toEqual([]);

    // B's in-play view: no C, no sight of A's ejection, but B sees the public startedAt.
    const bView = crash.viewFor(r1.state, B) as Record<string, unknown>;
    expect(bView.startedAt).toBe(START + CRASH_CONFIG.launchCountdownMs);
    expect(bView.crashAltitude).toBeUndefined();
    expect((bView.results as Record<string, unknown>)[A]).toBeUndefined(); // opponent ejection hidden
    expect((bView.results as Record<string, unknown>)[B]).toBeUndefined(); // B hasn't ejected

    // A's own view shows A's own ejection immediately, still no C.
    const aView = crash.viewFor(r1.state, A) as Record<string, unknown>;
    expect(aView.crashAltitude).toBeUndefined();
    expect((aView.results as Record<string, { altitude: number }>)[A].altitude).toBe(90);

    // Terminal → both ejections + C revealed (verifiability).
    const r2 = eject(r1.state, B, 5000);
    const term = crash.viewFor(r2.state, B) as Record<string, unknown>;
    expect(term.crashAltitude).toBe(C);
    expect((term.results as Record<string, { altitude: number }>)[A].altitude).toBe(90);
    expect((term.results as Record<string, { altitude: number }>)[B].altitude).toBe(250);
  });
});

describe('crash scheduled crash (generic timer integration)', () => {
  it('scheduledDeadlines holds the crash time for un-resolved players and drops resolved ones', () => {
    const { state } = launched(0.5); // crash at startedAt + timeToAltitudeMs(904)
    const crashAt = startedAt(state) + timeToAltitudeMs(904);
    expect(crash.scheduledDeadlines!(state)).toEqual({ [A]: crashAt, [B]: crashAt });

    const r1 = eject(state, A, 3000);
    expect(crash.scheduledDeadlines!(r1.state)).toEqual({ [B]: crashAt }); // A dropped out
  });

  it('timeoutMove is eject (the auto-bust the core injects at the crash)', () => {
    const { state } = launched();
    expect(crash.timeoutMove!(state, A, rngWith(0))).toBe('eject');
  });

  it('forfeit busts the quitter and the opponent wins (terminal, never a void)', () => {
    const { state } = launched(0.5);
    const r1 = eject(state, A, 3000); // A banks 90
    const term = crash.forfeit(r1.state, B); // B gives up → crashes
    expect(crash.isTerminal(term)).toBe(true);
    expect(crash.outcome(term)).toEqual({ type: 'win', winner: A });
  });
});

describe('crash determinism', () => {
  it('same seed + same eject event times → identical C, banks, and outcome', () => {
    const play = () => {
      const { state, C } = launched(0.5);
      const r1 = eject(state, A, 3000);
      const r2 = eject(r1.state, B, 7000);
      const view = crash.viewFor(r2.state, A) as { results: Record<string, { altitude: number }> };
      return { C, a: view.results[A].altitude, b: view.results[B].altitude, outcome: crash.outcome(r2.state) };
    };
    const first = play();
    const second = play();
    expect(first).toEqual(second);
    // And it reproduces the exact expected values (not just self-consistency).
    expect(first.C).toBe(904);
    expect(first.a).toBe(90); // altitude at 3s
    expect(first.b).toBe(490); // altitude at 7s (10·7²)
    expect(first.outcome).toEqual({ type: 'win', winner: B });
  });
});
