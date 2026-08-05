import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { cn } from '@/lib/utils';
import { BOLT_PATH } from '../cards/CardBack.js';

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

/** Cap texture size (px) — a canvas this small is plenty for a coin rendered at typical hub sizes. */
const CAP_TEXTURE_SIZE = 256;

/**
 * Paint a cap: the face colour fills the square (the cylinder's circular UV inscribes it), plus the
 * shared {@link BOLT_PATH} stamped tone-on-tone via `markHex` (a subtle canvas texture — the
 * simplest way to get the SVG brand mark onto a Three.js cap without a real decal/GLSL pass).
 *
 * **Rotation (bolt-upright fix, verified numerically — see the coder's confidence note in
 * `CODER_TO_PM.md`).** `BOLT_PATH` is authored upright for a normal y-down 2D surface (it's the same
 * path `CardBack.tsx`'s SVG draws unrotated). But this cap is a `CylinderGeometry` cap after
 * `geometry.rotateX(π/2)` (applied once, below) — walking through Three's actual cap-UV formulas
 * (`u = z/(2r)+0.5`, `v = ±x/(2r)+0.5`, read straight from the installed `three` source) composed
 * with that rotateX and the camera projection shows the canvas image lands on screen rotated +90°
 * (clockwise). `ROTATE = -π/2` here cancels that, verified by projecting the bolt's four distinctive
 * (asymmetric) path points through the real geometry + camera and confirming the "top" vertex ends up
 * above the "bottom" vertex, and "far right" ends up right of "far left" — not just "some rotation".
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
    // BOLT_PATH's viewBox is 0 0 24 24, roughly centred on (12, 12). Scale it to ~55% of the cap
    // diameter and centre it, tone-on-tone (mark is a shade of the face colour, never a stark cutout).
    const ROTATE = -Math.PI / 2;
    const scale = (CAP_TEXTURE_SIZE * 0.55) / 24;
    const half = CAP_TEXTURE_SIZE / 2;
    ctx.save();
    // Rotate in place around the cap's centre: move the origin to canvas-centre, rotate, scale, then
    // shift BOLT_PATH's own centre (~12, 12) onto that origin — in that order, so the path spins about
    // the cap centre rather than orbiting off it.
    ctx.translate(half, half);
    ctx.rotate(ROTATE);
    ctx.scale(scale, scale);
    ctx.translate(-12, -12);
    ctx.fillStyle = markHex;
    ctx.fill(new Path2D(BOLT_PATH));
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
}: {
  face?: CoinFace | null;
  size?: number;
  intro?: boolean;
  className?: string;
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
