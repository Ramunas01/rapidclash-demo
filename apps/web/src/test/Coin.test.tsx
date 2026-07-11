// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import {
  Coin,
  COIN_FACE_TOKENS,
  COIN_EDGE_TOKEN,
  planFlip,
  easeOutCubic,
} from '../components/coin/Coin.js';
import {
  resetThreeStub,
  capturedMaterials,
  capturedGeometryArgs,
  geometryRotateXCalls,
  rendererRenderCalls,
  rendererDisposed,
  geometryDisposed,
  sceneAdded,
  AmbientLight,
  DirectionalLight,
} from './three-stub.js';

// jsdom has no real WebGL context — `THREE.WebGLRenderer` would throw when constructed. Stub the
// whole module (mirrors how `canvas-confetti` is mocked elsewhere for chess/hub tests) with a
// lightweight stand-in that runs Coin.tsx's real logic (materials, geometry, rotation, disposal)
// against plain JS objects instead of a real GPU context. See `three-stub.ts` for what it implements.
vi.mock('three', async () => import('./three-stub.js'));

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** A controllable animation clock: each `requestAnimationFrame` call jumps a shared fake clock
 *  forward by a large simulated step and invokes the callback via a real (fast) macrotask — so a
 *  ~1.8-2.4s "logical" flip resolves in a handful of near-instant ticks, regardless of the test's
 *  real wall-clock speed or whether fake timers are active elsewhere. `performance.now()` is backed
 *  by the SAME clock so the component's own elapsed-time math (`now - startT`) sees consistent values. */
function installFakeAnimationClock(stepMs = 220) {
  let clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    clock += stepMs;
    return setTimeout(() => cb(clock), 0) as unknown as number;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.stubGlobal('performance', { now: () => clock });
}

beforeEach(() => {
  resetThreeStub();
  stubMatchMedia(false);
  // jsdom has no real 2D canvas context either (only WebGL is stubbed via three-stub above) — the
  // cap-texture painter already no-ops gracefully when `getContext('2d')` returns null, but jsdom's
  // real implementation console.errors a noisy "not implemented" on every call. Silence it.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Compare rotation.y angles CIRCULARLY (mod 2π) via cos/sin rather than a raw modulo, which has a
// floating-point wraparound edge case right at the 0/2π seam (e.g. 2π - epsilon mod 2π ≈ 2π, not 0).
function expectLandedOn(angle: number, target: 'heads' | 'tails') {
  const wantCos = target === 'heads' ? 1 : -1;
  expect(Math.cos(angle)).toBeCloseTo(wantCos, 9);
  expect(Math.sin(angle)).toBeCloseTo(0, 9);
}

describe('planFlip / easeOutCubic — pure flip math (no live Three.js needed)', () => {
  it('always lands exactly on the target angle mod 2π: 0 for heads, π for tails', () => {
    for (let i = 0; i < 20; i++) {
      expectLandedOn(planFlip(0, 'heads', false).to, 'heads');
      expectLandedOn(planFlip(0, 'tails', false).to, 'tails');
    }
  });

  it('lands correctly from a non-zero starting rotation too (a second flip in a row)', () => {
    const first = planFlip(0, 'tails', false);
    // Simulate the coin now resting at `first.to` and flipping again.
    const second = planFlip(first.to, 'heads', false);
    expectLandedOn(second.to, 'heads');
  });

  it('spins 5-7 full turns (10-14 half-turns) by default; two consecutive flips can differ', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValueOnce(0).mockReturnValueOnce(0); // halfTurns=10, duration=min
      const low = planFlip(0, 'heads', false);
      randomSpy.mockReturnValueOnce(0.999).mockReturnValueOnce(0.999); // halfTurns=14, duration=max
      const high = planFlip(0, 'heads', false);
      // Different turn counts → different total rotation distance travelled to reach the SAME face.
      expect(high.to).toBeGreaterThan(low.to);
      expect(high.to - low.to).toBeCloseTo(4 * Math.PI, 6); // 14 vs 10 half-turns = 4 extra half-turns
      // Duration also randomizes within the approved ~1.8-2.4s window.
      expect(low.durationMs).toBeGreaterThanOrEqual(1800);
      expect(high.durationMs).toBeLessThanOrEqual(2400);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('reduced motion: a short, single-turn settle (not the full 5-7 turn spin)', () => {
    const reduced = planFlip(0, 'heads', true);
    expect(reduced.durationMs).toBeLessThan(1800); // well under the full-motion floor
    expect(reduced.durationMs).toBeCloseTo(450, 0);
  });

  it('ease-out cubic decelerates: equal input steps produce shrinking output steps', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1].map(easeOutCubic);
    expect(steps[0]).toBeCloseTo(0);
    expect(steps[4]).toBeCloseTo(1);
    const deltas = steps.slice(1).map((v, i) => v - steps[i]);
    // Each successive delta is smaller — deceleration into the landing.
    expect(deltas[0]).toBeGreaterThan(deltas[1]);
    expect(deltas[1]).toBeGreaterThan(deltas[2]);
    expect(deltas[2]).toBeGreaterThan(deltas[3]);
  });
});

describe('Coin — resting state', () => {
  it('rests on heads: data-face reflects it, and NO render loop keeps running while static', async () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    render(<Coin />);
    expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads');
    // One resting frame is painted (mount effect), but the animation loop never starts while idle.
    expect(rendererRenderCalls.count).toBeGreaterThanOrEqual(1);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('builds a real cylinder: radius 1, ~0.26 height, 96 radial segments, rotated onto its side', () => {
    render(<Coin />);
    expect(capturedGeometryArgs).toEqual([{ top: 1, bottom: 1, height: 0.26, radialSegments: 96 }]);
    expect(geometryRotateXCalls).toEqual([Math.PI / 2]);
  });

  it('materials: [edge, headsCap, tailsCap] — one shared edge colour, two distinct cap textures', () => {
    render(<Coin />);
    expect(capturedMaterials).toHaveLength(3);
    const [edge, heads, tails] = capturedMaterials;
    expect(edge.color).toBeTruthy();
    expect(edge.map).toBeUndefined(); // the side is a flat colour, not a texture
    expect(heads.map).toBeTruthy(); // caps carry the face + tone-on-tone bolt via a canvas texture
    expect(tails.map).toBeTruthy();
    expect(heads.map).not.toBe(tails.map); // distinct textures per face
  });

  it('is unlit: MeshBasicMaterial with no metalness/roughness, and the scene has no lights (Advisor #3)', () => {
    render(<Coin />);
    expect(capturedMaterials).toHaveLength(3);
    for (const mat of capturedMaterials) {
      // MeshBasicMaterial genuinely has no metalness/roughness slot (unlike the old
      // MeshStandardMaterial) — assert they're absent, not just unset, so a regression back to a lit
      // material (which would add these) is caught even if someone leaves them undefined.
      expect(mat).not.toHaveProperty('metalness');
      expect(mat).not.toHaveProperty('roughness');
    }
    // No AmbientLight, no DirectionalLight — flat/unlit means nothing lights the coin at all.
    expect(sceneAdded.some((o) => o instanceof AmbientLight)).toBe(false);
    expect(sceneAdded.some((o) => o instanceof DirectionalLight)).toBe(false);
  });

  it('cap textures declare sRGB colour space so the rendered face matches the pill hex exactly', () => {
    render(<Coin />);
    const [, heads, tails] = capturedMaterials;
    expect(heads.map?.colorSpace).toBe('srgb');
    expect(tails.map?.colorSpace).toBe('srgb');
  });

  it('wrapper no longer carries the removed coin-glow CSS glow', () => {
    render(<Coin />);
    const wrapper = screen.getByTestId('coin-face');
    expect(wrapper.className).not.toMatch(/coin-glow/);
  });

  it('resolves colours from the CSS tokens at runtime — never a hardcoded literal', () => {
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle');
    getComputedStyleSpy.mockReturnValue({
      getPropertyValue: (name: string) => (name === '--coin-edge' ? '#123456' : ''),
    } as unknown as CSSStyleDeclaration);
    render(<Coin />);
    const [edge] = capturedMaterials;
    expect(edge.color).toBe('#123456'); // reflects the (mocked) token, not a baked-in constant
    getComputedStyleSpy.mockRestore();
  });

  it('exposes CSS-var strings (not resolved hex) for the pick-pill contract — CoinflipHub reads these directly', () => {
    expect(COIN_FACE_TOKENS.heads.face).toBe('var(--coin-heads-face)');
    expect(COIN_FACE_TOKENS.tails.face).toBe('var(--coin-tails-face)');
    expect(COIN_EDGE_TOKEN).toBe('var(--coin-edge)');
  });

  it('disposes the renderer/geometry/materials/textures on unmount — no leaked WebGL context', () => {
    const { unmount } = render(<Coin />);
    const [edge, heads, tails] = capturedMaterials;
    unmount();
    expect(rendererDisposed.value).toBe(true);
    expect(geometryDisposed.value).toBe(true);
    expect(edge.disposed).toBe(true);
    expect(heads.disposed).toBe(true);
    expect(tails.disposed).toBe(true);
    expect(heads.map?.disposed).toBe(true);
    expect(tails.map?.disposed).toBe(true);
  });
});

describe('Coin — flip animation (full motion)', () => {
  it('spins and lands on the server-decided face — heads', async () => {
    installFakeAnimationClock();
    const { rerender } = render(<Coin face={null} />);
    rerender(<Coin face="heads" />);
    await waitFor(() =>
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads')
    );
  });

  it('spins and lands on the server-decided face — tails', async () => {
    installFakeAnimationClock();
    const { rerender } = render(<Coin face={null} />);
    rerender(<Coin face="tails" />);
    await waitFor(() =>
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('tails')
    );
  });

  it('no motion blur: the canvas never gets a CSS blur() filter, mid-flip or landed (Advisor #3)', async () => {
    installFakeAnimationClock();
    const { container, rerender } = render(<Coin face={null} />);
    const canvas = container.querySelector('canvas')!;
    // Poll the canvas's filter across the whole flip (mid-spin, edge-on, and landed) — never a blur.
    let sawBlur = false;
    const observer = new MutationObserver(() => {
      if (/blur\(/.test(canvas.style.filter)) sawBlur = true;
    });
    observer.observe(canvas, { attributes: true, attributeFilter: ['style'] });
    rerender(<Coin face="tails" />);
    await waitFor(() =>
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('tails')
    );
    observer.disconnect();
    expect(sawBlur).toBe(false);
    expect(canvas.style.filter).toBe('');
    // The old `transition: filter .05s linear` inline style is gone too — nothing left to transition.
    expect(canvas.style.transition).toBe('');
  });

  it('never recolours mid-spin: the same three material instances persist across two different flips', async () => {
    installFakeAnimationClock();
    const { rerender } = render(<Coin face={null} />);
    const firstRoundMaterials = [...capturedMaterials];

    rerender(<Coin face="heads" />);
    await waitFor(() =>
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads')
    );
    rerender(<Coin face={null} />); // back to idle between rounds (CoinflipBoard's real behaviour)
    rerender(<Coin face="tails" />);
    await waitFor(() =>
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('tails')
    );

    // No new materials/geometry were ever created for either flip — only rotation changed.
    expect(capturedMaterials).toEqual(firstRoundMaterials);
    expect(capturedMaterials).toHaveLength(3);
  });

  it('resetting to null (a fresh round) snaps back to a static resting heads, no lingering spin', async () => {
    installFakeAnimationClock();
    const { rerender } = render(<Coin face={null} />);
    rerender(<Coin face="tails" />);
    await waitFor(() =>
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('tails')
    );
    rerender(<Coin face={null} />);
    expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads');
  });
});

describe('Coin — reduced motion', () => {
  it('honours prefers-reduced-motion: a short settle that still lands on the correct face', async () => {
    stubMatchMedia(true);
    installFakeAnimationClock();
    const { rerender } = render(<Coin face={null} />);
    rerender(<Coin face="tails" />);
    // The reduced-motion path (~450ms, 1 turn) needs far fewer simulated ticks than the full spin.
    await waitFor(
      () => expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('tails'),
      {
        timeout: 500,
      }
    );
  });
});
