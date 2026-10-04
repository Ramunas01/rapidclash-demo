import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { cn } from '@/lib/utils';

/**
 * Nominal flip duration (s) — the midpoint of the approved 1.8–2.4s range (COINFLIP_COIN.md). Each
 * flip actually randomizes its own duration inside that range (see {@link DUR_MIN_MS}/{@link
 * DUR_MAX_MS} below); this constant is kept exported for anything that wants a representative value
 * (docs, tests) — mirrors the old flat coin's `COIN_FLIP_DURATION_S` export for API stability.
 */
export const COIN_FLIP_DURATION_S = 2.1;

export type CoinFace = 'heads' | 'tails';

/**
 * Per-face palette tokens the H/T pick pills read directly (`CoinflipHub.tsx` — `SIDES[].face`,
 * unchanged contract). Token-driven (index.css `--coin-*`), never hardcoded hex. `mark` is the
 * tone-on-tone bolt colour stamped on that face's cap.
 *
 * Judgment call (flagged in COINFLIP_COIN.md as a Designer/Owner flag): the old flat coin had a
 * PER-FACE edge token (`--coin-heads-edge` / `--coin-tails-edge`) because each face was drawn as its
 * own independent SVG disc. A real cylinder has exactly ONE continuous side surface — it cannot show
 * two different edge colours without recolouring mid-spin, which the spec forbids ("never recolour
 * to fake the result"). So the edge collapses to a single shared token, {@link COIN_EDGE_TOKEN}.
 */
export const COIN_FACE_TOKENS: Record<CoinFace, { face: string; mark: string }> = {
  heads: { face: 'var(--coin-heads-face)', mark: 'var(--coin-heads-mark)' },
  tails: { face: 'var(--coin-tails-face)', mark: 'var(--coin-tails-mark)' },
};
/** The single shared edge/side colour (see the judgment-call note on {@link COIN_FACE_TOKENS}). */
export const COIN_EDGE_TOKEN = 'var(--coin-edge)';

// ---- Runtime token → colour resolution --------------------------------------------------------
// Three.js materials need real colour values, not CSS `var(...)` strings — so we read the resolved
// custom property off :root at mount time. Tokens are the source of truth (index.css); the fallback
// hex below only covers environments where the stylesheet never loaded (e.g. this component rendered
// in a unit test without `index.css` imported) — it is not a second source of truth in the real app.
function readColorToken(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Exported so the flip math is unit-testable without a live Three.js/WebGL scene (turn-count
 *  variance, exact landing angle, and the ease-out shape — see `Coin.test.tsx`). */
export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);

/** Symmetric accelerate-then-decelerate curve — the intro's return-to-rest and full-spin segments use
 *  this (a soft start AND a soft landing); the tease's initial rise uses {@link easeOutCubic} instead
 *  (an immediate, snappier start reads better for a quick "notice me" tilt). Exported alongside
 *  `easeOutCubic` for the same unit-testability reason. */
export const easeInOutCubic = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

/** Random 5–7 full turns (10–14 half-turns) per COINFLIP_COIN.md's "chance feel" requirement. */
function randomHalfTurns(): number {
  return 10 + Math.floor(Math.random() * 5);
}
/** Randomized flip duration inside the approved ~1.8–2.4s window. */
const DUR_MIN_MS = 1800;
const DUR_MAX_MS = 2400;
function randomDurationMs(): number {
  return DUR_MIN_MS + Math.random() * (DUR_MAX_MS - DUR_MIN_MS);
}
/** Reduced-motion: one quick settle, not the full multi-turn spin (matches the prototype's `reduce` branch). */
const REDUCED_HALF_TURNS = 2;
const REDUCED_DUR_MS = 450;

/**
 * Pure flip-plan math (no Three.js/DOM), split out of the component so it's directly unit-testable:
 * random turn count (5–7 full turns, or the reduced-motion 1 turn), the exact target rotation
 * (`rotation.y ≡ 0 (mod 2π)` → heads/gold, `≡ π` → tails/silver — never recolours, only rotates), and
 * the randomized ~1.8–2.4s duration (or the reduced-motion ~450ms quick settle).
 */
export function planFlip(
  fromY: number,
  target: CoinFace,
  reduce: boolean
): { halfTurns: number; to: number; durationMs: number } {
  const targetMod = target === 'heads' ? 0 : Math.PI;
  const halfTurns = reduce ? REDUCED_HALF_TURNS : randomHalfTurns();
  const base = fromY + halfTurns * Math.PI;
  const remainder = (((targetMod - base) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const to = base + remainder;
  const durationMs = reduce ? REDUCED_DUR_MS : randomDurationMs();
  return { halfTurns, to, durationMs };
}

// ---- One-time intro (issue #262, Part 3) — a scripted rotation on the resting coin: tease tilt →
// return to flat → one full spin landing back on heads. Reuses `mesh.rotation.y` + the same rAF render
// loop the flip already uses (no new visual path); the sequence math is split out pure (mirrors
// `planFlip` above) so it's directly unit-testable without a live Three.js scene. ----

/** Tease tilt amplitude (rad, ~40°) — a brief "notice me" lean before the coin returns flat and spins. */
const INTRO_TEASE_RAD = 0.7;
const INTRO_TEASE_MS = 350;
const INTRO_RETURN_MS = 300;
const INTRO_SPIN_MS = 700;

export type IntroSegment = {
  from: number;
  to: number;
  durationMs: number;
  ease: (p: number) => number;
};

/**
 * The intro's three segments, in order: tease 0→~0.7rad (easeOut, snappy start), return ~0.7rad→0
 * (easeInOut), then a full 2π turn back to 0 — i.e. `rotation.y ≡ 0 (mod 2π)`, landing on heads, same
 * convention as `planFlip` (easeInOut, its natural deceleration into the landing is the spec's "slight
 * end deceleration"). Total ≈ {@link INTRO_TEASE_MS} + {@link INTRO_RETURN_MS} + {@link INTRO_SPIN_MS}
 * = 1350ms, inside the ~1.3–1.5s target. Not reduced-motion-aware itself — the component skips calling
 * this entirely under `prefersReducedMotion()` (the intro is decorative, not the outcome-bearing flip,
 * so unlike `planFlip` there's no reduced settle variant — it's just skipped).
 */
export function planIntro(): IntroSegment[] {
  return [
    { from: 0, to: INTRO_TEASE_RAD, durationMs: INTRO_TEASE_MS, ease: easeOutCubic },
    { from: INTRO_TEASE_RAD, to: 0, durationMs: INTRO_RETURN_MS, ease: easeInOutCubic },
    { from: 0, to: 2 * Math.PI, durationMs: INTRO_SPIN_MS, ease: easeInOutCubic },
  ];
}

/**
 * Given the intro's segments and elapsed ms since it started, the current `rotation.y` and whether the
 * whole sequence has finished. Pure (no Three.js/DOM/clock reads) — the component's rAF tick just
 * calls this with `performance.now() - startT`. Landing (`done`) snaps to exactly `0`, not whatever the
 * last eased sample computed to (floating-point easeInOut at `p=1` is already ~2π, but `rotationY: 0`
 * is the canonical resting value the rest of the component/tests compare against).
 */
export function introRotationAt(
  segments: IntroSegment[],
  elapsedMs: number
): { rotationY: number; done: boolean } {
  const total = segments.reduce((sum, seg) => sum + seg.durationMs, 0);
  if (elapsedMs >= total) return { rotationY: 0, done: true };
  let acc = 0;
  for (const seg of segments) {
    if (elapsedMs < acc + seg.durationMs) {
      const p = Math.max(0, Math.min(1, (elapsedMs - acc) / seg.durationMs));
      return { rotationY: seg.from + (seg.to - seg.from) * seg.ease(p), done: false };
    }
    acc += seg.durationMs;
  }
  return { rotationY: 0, done: true }; // unreachable given the `elapsedMs >= total` guard above
}

/**
 * The real RapidClash lightning-bolt mark (viewBox 0 0 351 374), ticket 2026-09-26#2 (D61,
 * ADVISOR_TO_PM.md). Replaces the old generic placeholder bolt this coin used to share with
 * `CardBack.tsx`'s `BOLT_PATH` (Blackjack/Hilo/Baccarat's card backs) — deliberately a NEW,
 * coin-scoped constant rather than swapping `BOLT_PATH` itself, so this ticket's blast radius
 * stays Coinflip-only (the card-back placeholder is the SAME known-wrong bolt and would benefit
 * from the identical fix, but that is a separate, unticketed follow-up — see the mailbox entry).
 * Same path `RpsHub.tsx`'s own `RpsRedactedIcon` already draws (the redacted-opponent-throw
 * icon) — this coin cap and that icon are two independent consumers of the one real brand mark,
 * not a shared import (RPS's own icon stays private to `RpsHub.tsx`; duplicating this string is
 * cheaper than coupling a coin component to a screen component for one constant).
 */
const COIN_BOLT_PATH =
  'M189.84 23.99C187.66 24.20 185.18 24.67 182.99 25.40C180.80 26.13 178.56 27.05 176.69 28.37C174.81 29.69 173.35 31.62 171.73 33.30C170.12 34.98 168.61 36.77 167.01 38.47C165.41 40.17 163.74 41.80 162.15 43.50C160.56 45.21 159.03 46.98 157.46 48.69C155.88 50.41 154.28 52.11 152.67 53.80C151.07 55.50 149.41 57.14 147.82 58.85C146.23 60.56 144.72 62.34 143.13 64.05C141.55 65.76 139.91 67.43 138.31 69.12C136.71 70.82 135.10 72.51 133.52 74.22C131.94 75.94 130.42 77.71 128.82 79.41C127.22 81.11 125.54 82.74 123.94 84.43C122.34 86.13 120.78 87.87 119.20 89.58C117.61 91.29 116.02 93.00 114.43 94.70C112.84 96.41 111.23 98.10 109.64 99.81C108.05 101.51 106.49 103.25 104.89 104.94C103.28 106.64 101.61 108.27 100.02 109.97C98.42 111.67 96.90 113.44 95.31 115.15C93.73 116.86 92.09 118.53 90.50 120.23C88.90 121.93 87.30 123.63 85.72 125.35C84.14 127.06 82.59 128.81 80.99 130.51C79.39 132.21 77.72 133.84 76.13 135.54C74.54 137.25 73.01 139.02 71.43 140.73C69.85 142.45 68.25 144.15 66.65 145.84C65.04 147.54 63.39 149.18 61.80 150.89C60.21 152.60 58.70 154.38 57.11 156.09C55.53 157.80 53.89 159.46 52.28 161.16C50.68 162.85 49.08 164.55 47.50 166.26C45.92 167.98 44.40 169.75 42.80 171.45C41.20 173.15 39.52 174.78 37.92 176.47C36.32 178.17 34.76 179.90 33.18 181.62C31.60 183.34 29.80 184.91 28.46 186.79C27.13 188.67 25.86 190.72 25.17 192.89C24.49 195.06 24.43 197.50 24.34 199.82C24.26 202.14 24.30 204.51 24.65 206.81C24.99 209.10 25.53 211.43 26.39 213.57C27.24 215.72 28.41 217.82 29.77 219.68C31.13 221.54 32.75 223.31 34.55 224.75C36.35 226.18 38.43 227.44 40.57 228.28C42.70 229.12 45.08 229.50 47.38 229.77C49.68 230.05 52.04 229.92 54.38 229.95C56.71 229.98 59.04 229.93 61.38 229.95C63.71 229.97 66.04 229.99 68.37 230.05C70.71 230.12 73.04 230.27 75.37 230.36C77.70 230.46 80.03 230.56 82.36 230.60C84.69 230.65 87.03 230.64 89.36 230.66C91.69 230.68 94.03 230.70 96.36 230.71C98.69 230.72 101.03 230.72 103.36 230.72C105.69 230.72 108.03 230.73 110.36 230.73C112.69 230.73 115.03 230.72 117.36 230.73C119.69 230.74 122.03 230.72 124.36 230.77C126.69 230.82 129.03 230.91 131.36 231.02C133.69 231.13 136.01 231.37 138.34 231.45C140.67 231.53 143.01 231.49 145.34 231.52C147.68 231.54 150.46 230.98 152.34 231.59C154.22 232.20 156.30 233.47 156.64 235.17C156.98 236.88 155.16 239.60 154.40 241.81C153.65 244.01 152.91 246.23 152.12 248.42C151.33 250.62 150.44 252.78 149.67 254.98C148.89 257.18 148.23 259.42 147.46 261.62C146.69 263.82 145.84 266.00 145.04 268.19C144.24 270.38 143.43 272.57 142.66 274.77C141.90 276.98 141.22 279.21 140.44 281.41C139.65 283.61 138.76 285.76 137.97 287.96C137.18 290.15 136.47 292.38 135.71 294.58C134.94 296.79 134.19 298.99 133.39 301.19C132.60 303.38 131.74 305.55 130.96 307.75C130.19 309.95 129.43 312.16 128.75 314.39C128.06 316.62 127.21 318.84 126.84 321.12C126.48 323.41 126.35 325.81 126.58 328.10C126.81 330.40 127.31 332.77 128.22 334.87C129.12 336.97 130.47 339.00 132.00 340.70C133.54 342.41 135.43 343.94 137.41 345.11C139.39 346.28 141.66 347.09 143.88 347.74C146.11 348.39 148.46 348.86 150.76 348.99C153.07 349.13 155.45 348.98 157.71 348.54C159.98 348.11 162.35 347.49 164.34 346.39C166.34 345.29 167.99 343.51 169.70 341.93C171.41 340.36 172.98 338.61 174.59 336.93C176.20 335.24 177.77 333.51 179.37 331.81C180.96 330.10 182.53 328.38 184.14 326.69C185.74 325.00 187.40 323.35 189.01 321.66C190.62 319.97 192.20 318.26 193.79 316.55C195.38 314.84 196.94 313.11 198.55 311.42C200.16 309.73 201.83 308.10 203.44 306.41C205.06 304.73 206.63 303.01 208.23 301.31C209.83 299.61 211.42 297.90 213.03 296.21C214.64 294.52 216.27 292.86 217.88 291.16C219.48 289.47 221.06 287.75 222.65 286.05C224.25 284.34 225.81 282.61 227.43 280.93C229.04 279.24 230.72 277.62 232.33 275.93C233.95 274.25 235.51 272.52 237.10 270.80C238.68 269.09 240.25 267.36 241.85 265.67C243.46 263.97 245.11 262.33 246.73 260.64C248.34 258.96 249.95 257.27 251.54 255.56C253.13 253.86 254.66 252.09 256.26 250.39C257.85 248.69 259.51 247.04 261.13 245.36C262.75 243.68 264.38 242.02 265.98 240.31C267.57 238.61 269.09 236.84 270.68 235.13C272.27 233.43 273.91 231.76 275.53 230.08C277.15 228.40 278.79 226.75 280.39 225.05C281.99 223.35 283.53 221.59 285.12 219.88C286.71 218.18 288.32 216.49 289.93 214.81C291.55 213.12 293.20 211.47 294.81 209.78C296.42 208.09 297.99 206.37 299.58 204.66C301.17 202.96 302.75 201.24 304.36 199.55C305.97 197.86 307.61 196.20 309.22 194.51C310.82 192.82 312.42 191.11 314.00 189.40C315.58 187.68 317.28 186.05 318.71 184.22C320.14 182.38 321.48 180.43 322.57 178.39C323.66 176.34 324.69 174.18 325.26 171.95C325.82 169.72 326.01 167.31 325.96 165.00C325.92 162.70 325.73 160.26 324.99 158.10C324.25 155.95 322.96 153.87 321.53 152.07C320.11 150.27 318.32 148.62 316.43 147.30C314.54 145.98 312.38 144.93 310.22 144.13C308.05 143.32 305.72 142.86 303.43 142.44C301.14 142.03 298.81 141.77 296.49 141.62C294.16 141.48 291.82 141.58 289.49 141.57C287.15 141.56 284.82 141.57 282.49 141.57C280.15 141.57 277.82 141.57 275.49 141.57C273.15 141.57 270.82 141.57 268.49 141.57C266.15 141.57 263.82 141.57 261.49 141.57C259.15 141.57 256.82 141.56 254.49 141.55C252.15 141.54 249.82 141.52 247.49 141.51C245.15 141.50 242.82 141.51 240.49 141.51C238.15 141.51 235.82 141.51 233.49 141.51C231.15 141.51 228.82 141.51 226.49 141.51C224.15 141.50 221.82 141.50 219.49 141.50C217.15 141.49 214.82 141.50 212.49 141.49C210.15 141.49 207.82 141.49 205.49 141.47C203.15 141.44 200.80 141.52 198.49 141.33C196.18 141.14 193.04 141.55 191.63 140.34C190.21 139.13 189.98 136.25 190.01 134.08C190.04 131.90 191.14 129.55 191.80 127.31C192.45 125.07 193.22 122.87 193.94 120.65C194.67 118.43 195.43 116.22 196.15 114.00C196.86 111.78 197.50 109.54 198.23 107.32C198.96 105.11 199.77 102.92 200.53 100.71C201.29 98.50 202.06 96.30 202.79 94.09C203.53 91.87 204.19 89.63 204.95 87.43C205.71 85.22 206.58 83.05 207.35 80.85C208.12 78.65 208.82 76.42 209.56 74.21C210.31 72.00 211.06 69.79 211.84 67.59C212.61 65.39 213.50 63.22 214.20 61.00C214.91 58.78 215.58 56.54 216.06 54.26C216.54 51.98 217.01 49.65 217.07 47.34C217.13 45.02 216.97 42.62 216.44 40.39C215.92 38.15 215.13 35.83 213.90 33.91C212.68 31.99 210.93 30.24 209.09 28.88C207.25 27.52 205.03 26.53 202.86 25.73C200.69 24.93 198.24 24.38 196.07 24.09C193.90 23.80 192.02 23.77 189.84 23.99Z';

/** Cap texture size (px) — a canvas this small is plenty for a coin rendered at typical hub sizes. */
const CAP_TEXTURE_SIZE = 256;

/**
 * Paint a cap: the face colour fills the square (the cylinder's circular UV inscribes it), plus
 * {@link COIN_BOLT_PATH} stamped tone-on-tone via `markHex` (a subtle canvas texture — the simplest
 * way to get the SVG brand mark onto a Three.js cap without a real decal/GLSL pass).
 *
 * **Rotation (bolt-upright fix, verified numerically — see the coder's confidence note in
 * `CODER_TO_PM.md`).** The bolt path is authored upright for a normal y-down 2D surface (same SVG
 * convention `CardBack.tsx`'s own placeholder bolt uses — a plain `<path>` in a `viewBox` with no
 * extra transform). But this cap is a `CylinderGeometry` cap after `geometry.rotateX(π/2)` (applied
 * once, below) — walking through Three's actual cap-UV formulas (`u = z/(2r)+0.5`, `v = ±x/(2r)+0.5`,
 * read straight from the installed `three` source) composed with that rotateX and the camera
 * projection shows the canvas image lands on screen rotated +90° (clockwise). `ROTATE = -π/2` here
 * cancels that, verified by projecting the bolt's four distinctive (asymmetric) path points through
 * the real geometry + camera and confirming the "top" vertex ends up above the "bottom" vertex, and
 * "far right" ends up right of "far left" — not just "some rotation".
 *
 * **Ticket 2026-09-26#2 (D61): `ROTATE` carries over unchanged to the new, much larger 351×374 path
 * — reasoned through explicitly, not just assumed, though NOT re-verified with a live render (this
 * environment has no browser/WebGL tooling to open the deployed coin and look).** `ROTATE` is applied
 * to canvas-space BEFORE anything is drawn (`ctx.rotate` runs before `ctx.fill`), so it is a fixed,
 * path-shape-independent transform: the same affine composition (translate → rotate → scale →
 * translate, see below) maps canvas "up"/"right" to the same screen directions regardless of WHAT
 * gets drawn afterward, only how it's oriented in its own coordinate space. Since the new path uses
 * the identical upright, y-down SVG convention as the old one (confirmed: a plain `<path>` in its own
 * `viewBox`, no pre-rotation), the old verification's conclusion — "canvas-space up/right map to a
 * specific, fixed pair of screen directions under this ROTATE" — applies to it unchanged. Separately
 * (cheaper, actually run): the new scale/translate below were checked numerically against the real
 * path data (its own bounding box, ~24.3–326.0 × ~23.8–349.1 in the 351×374 viewBox) — the path's own
 * centre maps to the exact canvas centre (128,128) and its full rotated extent lands within
 * roughly x∈[40,216]/y∈[47,210], comfortably inside the 256×256 canvas with no clipping or
 * off-centre drift. **Still recommending Owner/Designer glance at both live coin faces once
 * deployed** — this closes the 2D placement question with real confidence, but a live look is the
 * only way to fully close the 3D-orientation question the same way the original verification did.
 *
 * **Heads vs tails — no mirror needed (verified, not assumed).** The two caps face opposite
 * directions, which usually means an identically-painted texture reads MIRRORED on one of them. Here
 * it doesn't: Three's own cap generator already flips the sign of the bottom cap's `v` formula (to
 * account for it facing -Y instead of +Y), and that flip exactly cancels the flip animation's own
 * 180°-around-Y rotation that brings tails to face the camera. The same numeric check run against the
 * TAILS cap (with `mesh.rotation.y = π`, i.e. tails actually facing the camera) lands the identical
 * screen positions as heads with the SAME `ROTATE` and no extra mirror; adding a `ctx.scale(-1, 1)` to
 * "fix" tails was checked too and reproduces a backwards bolt, confirming the mirror hypothesis is
 * wrong for this geometry. `side` is kept (tags the texture) so the two call sites stay
 * self-documenting and there's a named hook if a future geometry change ever does need to diverge.
 */
function makeCapTexture(
  faceHex: string,
  markHex: string,
  side: 'heads' | 'tails'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CAP_TEXTURE_SIZE;
  canvas.height = CAP_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = faceHex;
    ctx.fillRect(0, 0, CAP_TEXTURE_SIZE, CAP_TEXTURE_SIZE);
    // COIN_BOLT_PATH's viewBox is 0 0 351 374, centred on (175.5, 187). Ticket 2026-09-26#2 (D61):
    // scale to 74% of the viewBox WIDTH (matching the citation's own `width="74%"` SVG semantics —
    // width sets the scale factor, height follows via default preserveAspectRatio) and centre it,
    // tone-on-tone (mark is a shade of the face colour, never a stark cutout).
    const ROTATE = -Math.PI / 2;
    const scale = (CAP_TEXTURE_SIZE * 0.74) / 351;
    const half = CAP_TEXTURE_SIZE / 2;
    ctx.save();
    // Rotate in place around the cap's centre: move the origin to canvas-centre, rotate, scale, then
    // shift COIN_BOLT_PATH's own centre (175.5, 187 — half of 351, half of 374) onto that origin — in
    // that order, so the path spins about the cap centre rather than orbiting off it.
    ctx.translate(half, half);
    ctx.rotate(ROTATE);
    ctx.scale(scale, scale);
    ctx.translate(-175.5, -187);
    ctx.fillStyle = markHex;
    ctx.fill(new Path2D(COIN_BOLT_PATH));
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.name = side === 'heads' ? 'coin-cap-heads' : 'coin-cap-tails';
  // Colour-space guard (verified necessary, not belt-and-suspenders): `renderer.outputColorSpace`
  // defaults to `SRGBColorSpace` in r0.185, and a `THREE.Color` parsed from a hex string round-trips
  // through that correctly on its own — but a hand-built `CanvasTexture.map` does NOT get an implicit
  // `SRGBColorSpace` (its default is `NoColorSpace`, per three's own source/docs: "Most `map` textures
  // set `texture.colorSpace = SRGBColorSpace`" — it's the caller's job). Without this line the canvas's
  // sRGB-encoded pixels would be treated as already-linear, then re-encoded on output — landing off the
  // exact pill hex. This only affects the caps (their colour comes from `map`); the edge's flat
  // `color:` doesn't need it.
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type SceneRefs = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  edgeMat: THREE.MeshBasicMaterial;
  headsMat: THREE.MeshBasicMaterial;
  tailsMat: THREE.MeshBasicMaterial;
};

type FlipState = {
  animating: boolean;
  from: number;
  to: number;
  startT: number;
  dur: number;
  target: CoinFace;
};

/**
 * A real 3D cylinder coin (Three.js), spinning on the VERTICAL axis and landing on the
 * server-decided face — supersedes the old flat `scaleX` squash (see COINFLIP_COIN.md). Purely
 * presentational: the server still decides the outcome (`face` prop), this only animates to it.
 *
 * `face` null → resting heads (perfect circle, no spin, no running render loop). `face` set → spins
 * to that side, one-shot per transition into a flip (mirrors the old Coin contract so the board's
 * idle / in-match / terminal / draw-flip choreography — `CoinflipHub.tsx` — is unchanged).
 *
 * `intro` (opt-in, default off — issue #262 Part 3): plays the one-time tease/return/spin sequence
 * (`planIntro`/`introRotationAt` above) once, on mount, while resting. It never repeats while this
 * component stays mounted — callers that want "once per page entry" (not "once per phase transition")
 * must mount `<Coin>` exactly once per visit (see `CoinflipHub.tsx`'s Part 2 hoist, which is why these
 * two parts shipped together). Skipped entirely under `prefers-reduced-motion`. If `face` transitions
 * to a value mid-intro, the intro is cancelled and the coin snaps flat before the normal flip takes
 * over — never both animating at once.
 */
export function Coin({
  face = null,
  size = 128,
  intro = false,
  className,
  onSpinStart,
}: {
  face?: CoinFace | null;
  size?: number;
  intro?: boolean;
  className?: string;
  /** Ticket 2026-10-04#3 (D79): fires exactly once per real flip, right as it kicks off — strictly
   *  BEFORE the rotate/rAF loop's first tick, never on arrival. Deliberately NOT wired into the
   *  one-time page-entry `intro` tease (a separate effect below) — that's a decorative first-visit
   *  animation, not a real round, so it must never fire this. */
  onSpinStart?(): void;
}) {
  const flipping = face != null;
  const target: CoinFace = face ?? 'heads';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneRefs | null>(null);
  const flipRef = useRef<FlipState>({
    animating: false,
    from: 0,
    to: 0,
    startT: 0,
    dur: 0,
    target: 'heads',
  });
  const rafRef = useRef<number | null>(null);
  // Whether the one-time intro's own rAF loop currently owns `rafRef`/`mesh.rotation.y`. Only the flip
  // effect below reads this (to cancel + snap flat if a match starts mid-intro); the intro effect owns
  // writing it.
  const introRef = useRef<{ active: boolean }>({ active: false });
  // The one bit of React-visible state: which face is currently "true" — resting immediately, or the
  // just-landed face once a flip settles. Everything else (rotation) is driven imperatively so we
  // don't re-render on every animation frame.
  const [displayFace, setDisplayFace] = useState<CoinFace>('heads');

  // ---- Mount: build the Three.js scene once. Tears it down on unmount (no leaked WebGL contexts —
  // this component mounts/unmounts as the player navigates the hub). ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const goldHex = readColorToken('--coin-heads-face', '#F2A63B');
    const silverHex = readColorToken('--coin-tails-face', '#556EF6');
    const edgeHex = readColorToken('--coin-edge', '#ED742F');
    const headsMarkHex = readColorToken('--coin-heads-mark', '#C8761F');
    const tailsMarkHex = readColorToken('--coin-tails-mark', '#3F52D6');

    const scene = new THREE.Scene();
    // fov ~17 (down from 30, coin polish v2 — ADVISOR_TO_PM.md 2026-07-10#2): a telephoto zoom that
    // frames the coin at ~90% of the canvas instead of ~47%, with no added perspective distortion.
    // Same z=8 and the same slight (0.35, 0.35) tilt — this is camera framing only, not a geometry
    // or flip-math change.
    const camera = new THREE.PerspectiveCamera(17, 1, 0.1, 100);
    camera.position.set(0.35, 0.35, 8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);

    // Thickness ≈ 13% of diameter (radius 1 → height 0.26). rotateX so the caps face the camera
    // (±Z); the flip then rotates around Y — the VERTICAL axis (COINFLIP_COIN.md).
    const geometry = new THREE.CylinderGeometry(1, 1, 0.26, 96);
    geometry.rotateX(Math.PI / 2);

    // Flat/unlit (Designer + Owner — ADVISOR_TO_PM.md 2026-07-11#3): the previous lit
    // `MeshStandardMaterial` under three scene lights dimmed/tinted the tokens (measured ~⅔ down,
    // colour-shifted) — an unlit `MeshBasicMaterial` renders `color`/`map` at their exact value with
    // no lighting to dull or tint them. This also gives the "no shine/glow" flat look for free: basic
    // material ignores lights entirely, so there's nothing left to remove per-material (only the
    // scene's lights themselves, deleted below, need to go).
    const edgeMat = new THREE.MeshBasicMaterial({ color: edgeHex });
    const headsMat = new THREE.MeshBasicMaterial({
      map: makeCapTexture(goldHex, headsMarkHex, 'heads'),
    });
    const tailsMat = new THREE.MeshBasicMaterial({
      map: makeCapTexture(silverHex, tailsMarkHex, 'tails'),
    });
    // CylinderGeometry material order: [side, topCap, bottomCap]; after rotateX the top cap faces
    // the camera at rest — heads (gold) up, matching resting-heads.
    const mesh = new THREE.Mesh(geometry, [edgeMat, headsMat, tailsMat]);
    scene.add(mesh);

    sceneRef.current = { renderer, scene, camera, mesh, geometry, edgeMat, headsMat, tailsMat };
    renderer.render(scene, camera); // paint the resting frame once — no rAF loop while static.

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      geometry.dispose();
      edgeMat.dispose();
      headsMat.map?.dispose();
      headsMat.dispose();
      tailsMat.map?.dispose();
      tailsMat.dispose();
      renderer.dispose();
      sceneRef.current = null;
    };
    // Built once on mount; `size` changes are handled by the resize effect below, not a rebuild.
  }, []);

  // ---- Resize: reflect a `size` prop change without rebuilding the scene. ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.renderer.setSize(size, size, false);
    if (!flipRef.current.animating) s.renderer.render(s.scene, s.camera);
  }, [size]);

  // ---- React to `face`: null → snap to rest; a value → spin to it (one-shot per transition). ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;

    if (!flipping) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      flipRef.current.animating = false;
      s.mesh.rotation.y = 0;
      s.renderer.render(s.scene, s.camera);
      setDisplayFace('heads');
      return;
    }

    // A match just started (`flipping` went true). If the one-time intro (Part 3, below) is still
    // mid-sequence, cancel it immediately and snap flat — the flip below always starts `from` wherever
    // `mesh.rotation.y` currently reads, and per spec the snap is instant (not "continue from the
    // tease angle"). `introRef` is the only other owner of `rafRef` besides this flip loop, so
    // cancelling here (before the flip claims it below) is sufficient — the intro effect's own tick
    // also checks `introRef.current.active` and no-ops if it fires again regardless.
    if (introRef.current.active) {
      introRef.current.active = false;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      s.mesh.rotation.y = 0;
    }

    if (flipRef.current.animating) return; // a flip is already underway to somewhere — let it land.

    // Ticket 2026-10-04#3 (D79): the real flip is genuinely starting here — this guard above
    // already makes this one-shot per flip (no extra ref needed), and this fires strictly BEFORE
    // `requestAnimationFrame(tick)` first runs below, covering both the full spin and the
    // reduced-motion settle (both drive the SAME tick loop, just with a shorter `planFlip` duration).
    onSpinStart?.();

    const reduce = prefersReducedMotion();
    const from = s.mesh.rotation.y;
    const { to, durationMs } = planFlip(from, target, reduce);

    flipRef.current = {
      animating: true,
      from,
      to,
      startT: performance.now(),
      dur: durationMs,
      target,
    };

    const tick = () => {
      // Read the clock ourselves rather than trusting the rAF callback's timestamp argument — some
      // environments (observed in jsdom) hand back a timestamp on a different/inconsistent clock
      // than `performance.now()`, which would desync from `startT` and never let `p` reach 1.
      const now = performance.now();
      const current = sceneRef.current;
      const anim = flipRef.current;
      if (!current) return;

      if (anim.animating) {
        const p = Math.min(1, (now - anim.startT) / anim.dur);
        current.mesh.rotation.y = anim.from + (anim.to - anim.from) * easeOutCubic(p);
        if (p >= 1) {
          anim.animating = false;
          current.mesh.rotation.y = ((anim.to % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          setDisplayFace(anim.target);
        }
      }
      current.renderer.render(current.scene, current.camera);
      rafRef.current = anim.animating ? requestAnimationFrame(tick) : null;
    };
    rafRef.current = requestAnimationFrame(tick);
    // No extra cleanup needed here: a running flip either lands (clearing rafRef itself) or gets
    // cancelled by the next `!flipping` transition / unmount effect above.
  }, [flipping, target]);

  // ---- One-time intro (Part 3, issue #262): tease tilt → return flat → full spin, once, on mount,
  // while resting. Deliberately mount-only (`[]` deps) — `intro` is a static opt-in prop and this must
  // fire exactly once per hub visit, never again while the component stays mounted (see the doc
  // comment above `Coin`). Declared AFTER the flip/reset effect above on purpose: that effect's mount-
  // time `!flipping` branch unconditionally cancels `rafRef` and zeroes rotation — if this effect ran
  // first it would win the race and get its own just-started rAF loop killed a tick later. ----
  useEffect(() => {
    const s = sceneRef.current;
    if (!s || !intro || flipping || prefersReducedMotion()) return;

    const segments = planIntro();
    introRef.current.active = true;
    const startT = performance.now();

    const tick = () => {
      const current = sceneRef.current;
      if (!current || !introRef.current.active) return; // cancelled mid-flight (match start / unmount)
      const { rotationY, done } = introRotationAt(segments, performance.now() - startT);
      current.mesh.rotation.y = rotationY;
      current.renderer.render(current.scene, current.camera);
      if (done) {
        introRef.current.active = false;
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      // Unmount mid-intro: stop the loop. (Rotation itself doesn't need resetting here — the scene is
      // being torn down by the mount effect's own cleanup right alongside this one.) The mid-flip
      // cancel path is handled separately, above, by the flip effect reading/clearing this same flag.
      introRef.current.active = false;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return (
    <div
      data-testid="coin-face"
      data-face={displayFace}
      aria-hidden="true"
      className={cn('block shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <canvas ref={canvasRef} width={size} height={size} className="block h-full w-full" />
    </div>
  );
}
