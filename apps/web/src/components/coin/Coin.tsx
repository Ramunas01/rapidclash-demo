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

/** Cap texture size (px) — a canvas this small is plenty for a coin rendered at typical hub sizes. */
const CAP_TEXTURE_SIZE = 256;

/** Paint a cap: the face colour fills the square (the cylinder's circular UV inscribes it), plus the
 *  shared {@link BOLT_PATH} stamped tone-on-tone via `markHex` (a subtle canvas texture — the
 *  simplest way to get the SVG brand mark onto a Three.js cap without a real decal/GLSL pass). */
function makeCapTexture(faceHex: string, markHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CAP_TEXTURE_SIZE;
  canvas.height = CAP_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = faceHex;
    ctx.fillRect(0, 0, CAP_TEXTURE_SIZE, CAP_TEXTURE_SIZE);
    // BOLT_PATH's viewBox is 0 0 24 24, roughly centred on (12, 12). Scale it to ~55% of the cap
    // diameter and centre it, tone-on-tone (mark is a shade of the face colour, never a stark cutout).
    const scale = (CAP_TEXTURE_SIZE * 0.55) / 24;
    const half = CAP_TEXTURE_SIZE / 2;
    ctx.save();
    ctx.translate(half - 12 * scale, half - 12 * scale);
    ctx.scale(scale, scale);
    ctx.fillStyle = markHex;
    ctx.fill(new Path2D(BOLT_PATH));
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

type SceneRefs = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  edgeMat: THREE.MeshStandardMaterial;
  headsMat: THREE.MeshStandardMaterial;
  tailsMat: THREE.MeshStandardMaterial;
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
 */
export function Coin({
  face = null,
  size = 128,
  className,
}: {
  face?: CoinFace | null;
  size?: number;
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
  const lastFrameRef = useRef(0);
  // The one bit of React-visible state: which face is currently "true" — resting immediately, or the
  // just-landed face once a flip settles. Everything else (rotation, blur) is driven imperatively so
  // we don't re-render on every animation frame.
  const [displayFace, setDisplayFace] = useState<CoinFace>('heads');

  // ---- Mount: build the Three.js scene once. Tears it down on unmount (no leaked WebGL contexts —
  // this component mounts/unmounts as the player navigates the hub). ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const goldHex = readColorToken('--coin-heads-face', '#F2A63B');
    const silverHex = readColorToken('--coin-tails-face', '#5956F6');
    const edgeHex = readColorToken('--coin-edge', '#ED742F');
    const headsMarkHex = readColorToken('--coin-heads-mark', '#C8761F');
    const tailsMarkHex = readColorToken('--coin-tails-mark', '#5351E2');
    const brandHex = readColorToken('--brand-purple', '#8140e2');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
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

    const edgeMat = new THREE.MeshStandardMaterial({
      color: edgeHex,
      metalness: 0.5,
      roughness: 0.45,
    });
    const headsMat = new THREE.MeshStandardMaterial({
      map: makeCapTexture(goldHex, headsMarkHex),
      metalness: 0.55,
      roughness: 0.34,
    });
    const tailsMat = new THREE.MeshStandardMaterial({
      map: makeCapTexture(silverHex, tailsMarkHex),
      metalness: 0.6,
      roughness: 0.3,
    });
    // CylinderGeometry material order: [side, topCap, bottomCap]; after rotateX the top cap faces
    // the camera at rest — heads (gold) up, matching resting-heads.
    const mesh = new THREE.Mesh(geometry, [edgeMat, headsMat, tailsMat]);
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(3, 4, 5);
    scene.add(key);
    // Subtle brand rim light — colour comes from the `--brand-purple` token, never a hardcoded hex.
    const rim = new THREE.DirectionalLight(brandHex, 0.55);
    rim.position.set(-4, -1, 2);
    scene.add(rim);

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
      if (canvasRef.current) canvasRef.current.style.filter = 'none';
      s.renderer.render(s.scene, s.camera);
      setDisplayFace('heads');
      return;
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
    lastFrameRef.current = performance.now();

    const tick = () => {
      // Read the clock ourselves rather than trusting the rAF callback's timestamp argument — some
      // environments (observed in jsdom) hand back a timestamp on a different/inconsistent clock
      // than `performance.now()`, which would desync from `startT` and never let `p` reach 1.
      const now = performance.now();
      const current = sceneRef.current;
      const anim = flipRef.current;
      if (!current) return;
      const dt = Math.max(1, now - lastFrameRef.current);
      lastFrameRef.current = now;

      if (anim.animating) {
        const p = Math.min(1, (now - anim.startT) / anim.dur);
        const prevY = current.mesh.rotation.y;
        current.mesh.rotation.y = anim.from + (anim.to - anim.from) * easeOutCubic(p);
        const speed = Math.abs(current.mesh.rotation.y - prevY) / (dt / 16.67); // rad per ~frame
        if (canvasRef.current)
          canvasRef.current.style.filter = `blur(${Math.min(7, speed * 2.4).toFixed(2)}px)`;
        if (p >= 1) {
          anim.animating = false;
          current.mesh.rotation.y = ((anim.to % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          if (canvasRef.current) canvasRef.current.style.filter = 'none';
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

  return (
    <div
      data-testid="coin-face"
      data-face={displayFace}
      aria-hidden="true"
      className={cn('block', className)}
      style={{ width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="block h-full w-full"
        style={{ transition: 'filter .05s linear' }}
      />
    </div>
  );
}
