import type { Rng } from '@rapidclash/shared';

/**
 * The one tunable Crash config (like Mines' MINE_COUNT) — owner-adjustable.
 *
 * Round shape: a fixed SETUP window (set your auto-eject), a brief IGNITION beat, then the climb.
 * The rocket's altitude (metres) climbs on a SLOW-START, accelerating (exponential, rocket-like)
 * curve — so the first ~1–2 s rise barely moves, which makes the launch far less sensitive to
 * client latency (a sub-second hiccup skips almost no altitude). The hidden crash altitude `C` is
 * drawn skewed-LOW and capped so a round stays "authentic, short & tense". Nothing here reads a
 * clock or `Math.random` — `C` is drawn from the injected seeded rng and the curve is a pure
 * function of elapsed ms, so a round replays exactly (invariant #2).
 */
export const CRASH_CONFIG = {
  /** Pre-climb phases (ms). [now, now+setupMs) = SETUP (settle/prepare); then ignitionMs of
   *  "ignition"; the climb's origin is `now + setupMs + ignitionMs`. Tunable. */
  setupMs: 3000,
  ignitionMs: 1_000,
  /** altitude(s) = scale · (e^(growth·s) − 1)  (metres). Slow at first (initial rate scale·growth
   *  ≈ 0.36 m/s — ~4× gentler than before, so the readout is readable and latency-tolerant near
   *  launch), then the exponential takes over (real-rocket acceleration). */
  scale: 0.8,
  growth: 0.45,
  /** `C` is drawn in [minCrashAltitude, maxCrashAltitude]. With this curve those map to a climb
   *  time of ~4 s … ~17 s. */
  minCrashAltitude: 5,
  maxCrashAltitude: 1500,
  /** Low-skew exponent: C = min + (max − min)·u^crashSkew, u ~ U[0,1). > 1 ⇒ C is usually low
   *  (most rounds short and tense), the cap reached only rarely. */
  crashSkew: 2.5,
  /** Enumerable pre-set auto-eject altitudes (metres). The core validates a move by exact
   *  membership in `legalMoves`, so the auto-eject can't be a free number — it's this fixed
   *  ladder (the client offers them as presets). */
  autoEjectLadder: [50, 100, 200, 350, 500, 750, 1000, 1500],
} as const;

/** Integer altitude (metres) reached `elapsedMs` after launch. The sole climb function — the
 *  client animates the same curve from the server's `startedAt` (display-only). Clamped to 0 for
 *  negative elapsed (the rocket is still on the pad during SETUP/ignition). */
export function altitudeAt(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return Math.floor(CRASH_CONFIG.scale * (Math.exp(CRASH_CONFIG.growth * s) - 1));
}

/** Inverse of the curve: the ms after launch at which the climb first reaches `altitude`. Used to
 *  schedule the crash terminal at `C` (and any pre-set auto-eject). Rounded UP so
 *  `altitudeAt(timeToAltitudeMs(C)) >= C`. */
export function timeToAltitudeMs(altitude: number): number {
  const s = Math.log(Math.max(0, altitude) / CRASH_CONFIG.scale + 1) / CRASH_CONFIG.growth;
  return Math.ceil(s * 1000);
}

/** Draw the hidden crash altitude `C` from the seeded rng (skewed low, capped). Deterministic
 *  given the rng — the whole round derives from the match seed. */
export function drawCrashAltitude(rng: Rng): number {
  const { minCrashAltitude, maxCrashAltitude, crashSkew } = CRASH_CONFIG;
  const u = rng.next();
  return Math.round(minCrashAltitude + (maxCrashAltitude - minCrashAltitude) * Math.pow(u, crashSkew));
}
