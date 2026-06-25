import type { Rng } from '@rapidclash/shared';

/**
 * The one tunable Crash config (like Mines' MINE_COUNT) — owner-adjustable.
 *
 * The rocket's altitude (metres) climbs as a deterministic, accelerating function of elapsed
 * time; the hidden crash altitude `C` is drawn skewed-LOW and capped so a round is "authentic,
 * short & tense" — usually a few seconds, never more than ~`maxCrashAltitude`'s climb time.
 * Nothing here reads a clock or `Math.random` — `C` is drawn from the injected seeded rng and
 * the curve is a pure function of elapsed ms, so a round replays exactly (invariant #2).
 */
export const CRASH_CONFIG = {
  /** altitude(s) = ALTITUDE_RATE · s^ALTITUDE_EXP  (metres; EXP > 1 ⇒ an accelerating climb). */
  altitudeRate: 10,
  altitudeExp: 2,
  /** `C` is drawn in [minCrashAltitude, maxCrashAltitude]. With rate 10 / exp 2 these map to a
   *  climb time of ~1.6 s … ~22 s. */
  minCrashAltitude: 25,
  maxCrashAltitude: 5000,
  /** Low-skew exponent: C = min + (max − min)·u^crashSkew, u ~ U[0,1). > 1 ⇒ C is usually low
   *  (most rounds short and tense), the cap reached only rarely. */
  crashSkew: 2.5,
  /** Server-authoritative pre-launch hold: the rocket sits on the pad for this long before the
   *  climb's origin. A real server phase (the climb's `startedAt` is shifted forward by it, so the
   *  crash + auto-ejects are all scheduled AFTER it) — not a cosmetic client countdown. A 3-2-1
   *  beat so short rounds + client latency never crash before the altitude even renders. */
  launchCountdownMs: 3000,
} as const;

/** Integer altitude (metres) reached `elapsedMs` after launch. The sole climb function — the
 *  client animates the same curve from the server's `startedAt` (display-only). */
export function altitudeAt(elapsedMs: number): number {
  const s = Math.max(0, elapsedMs) / 1000;
  return Math.floor(CRASH_CONFIG.altitudeRate * Math.pow(s, CRASH_CONFIG.altitudeExp));
}

/** Inverse of the curve: the ms after launch at which the climb first reaches `altitude`. Used to
 *  schedule the crash terminal at `C`. Rounded UP so `altitudeAt(timeToAltitudeMs(C)) >= C`. */
export function timeToAltitudeMs(altitude: number): number {
  const s = Math.pow(Math.max(0, altitude) / CRASH_CONFIG.altitudeRate, 1 / CRASH_CONFIG.altitudeExp);
  return Math.ceil(s * 1000);
}

/** Draw the hidden crash altitude `C` from the seeded rng (skewed low, capped). Deterministic
 *  given the rng — the whole round derives from the match seed. */
export function drawCrashAltitude(rng: Rng): number {
  const { minCrashAltitude, maxCrashAltitude, crashSkew } = CRASH_CONFIG;
  const u = rng.next();
  return Math.round(minCrashAltitude + (maxCrashAltitude - minCrashAltitude) * Math.pow(u, crashSkew));
}
