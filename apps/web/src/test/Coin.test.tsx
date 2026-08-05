// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import {
  Coin,
  COIN_FACE_TOKENS,
  COIN_EDGE_TOKEN,
  planFlip,
  easeOutCubic,
  planIntro,
  introRotationAt,
  easeInOutCubic,
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
  capturedMeshes,
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

/** A fully manual animation clock — unlike {@link installFakeAnimationClock}, nothing self-schedules
 *  via a real macrotask; `requestAnimationFrame` just parks its callback until `advance()` invokes it
 *  synchronously. This is what the intro tests below need: the intro's own tick loop re-schedules
 *  itself so fast (a handful of 0ms macrotasks) that even `waitFor` can't reliably catch it mid-flight
 *  with the self-chaining clock — by the time any poll runs, the whole ~1.35s sequence has often
 *  already finished for real. Driving frames one at a time by hand removes the race entirely. */
function installManualAnimationClock() {
  let clock = 0;
  let pending: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = null;
  });
  vi.stubGlobal('performance', { now: () => clock });
  return {
    /** Advance the clock by `ms` and, if a frame is pending, invoke it synchronously (which may itself
     *  park a new pending frame — the intro/flip loops both re-request every tick). Wrapped in `act()`
     *  because the callback can call a React state setter (`setDisplayFace` on landing) from outside
     *  React's own event/`act` scope — without this, React 18 may not flush that update to the DOM
     *  before the next synchronous assertion runs. */
    advance(ms: number) {
      clock += ms;
      const cb = pending;
      pending = null;
      act(() => {
        cb?.(clock);
      });
    },
    hasPending: () => pending != null,
  };
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

describe('planIntro / introRotationAt / easeInOutCubic — pure intro math (issue #262 Part 3)', () => {
  it('easeInOutCubic: starts at 0, ends at 1, symmetric around the midpoint', () => {
    expect(easeInOutCubic(0)).toBeCloseTo(0);
    expect(easeInOutCubic(1)).toBeCloseTo(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    // Symmetric: the gain over the first half mirrors the gain over the second half.
    expect(easeInOutCubic(0.25)).toBeCloseTo(1 - easeInOutCubic(0.75), 9);
  });

  it('three segments — tease 0→~0.7rad, return ~0.7rad→0, full spin 0→2π — chained front-to-back', () => {
    const segs = planIntro();
    expect(segs).toHaveLength(3);
    const [tease, ret, spin] = segs;
    expect(tease.from).toBe(0);
    expect(tease.to).toBeCloseTo(0.7, 5);
    expect(ret.from).toBe(tease.to); // chained: each segment starts where the previous ended
    expect(ret.to).toBe(0);
    expect(spin.from).toBe(0);
    expect(spin.to).toBeCloseTo(2 * Math.PI, 9); // ≡ 0 (mod 2π) — lands on heads
  });

  it('total duration is within the ~1.3–1.5s spec window', () => {
    const total = planIntro().reduce((sum, seg) => sum + seg.durationMs, 0);
    expect(total).toBeGreaterThanOrEqual(1300);
    expect(total).toBeLessThanOrEqual(1500);
  });

  it("introRotationAt: starts exactly at the first segment's `from`, interpolates within a segment, and lands on rotationY=0/done=true only at/after the total duration", () => {
    const segs = planIntro();
    const total = segs.reduce((sum, seg) => sum + seg.durationMs, 0);

    const start = introRotationAt(segs, 0);
    expect(start.rotationY).toBe(0);
    expect(start.done).toBe(false);

    // Midway through the tease segment: strictly between 0 and the tease's target (monotonic ease-out).
    const midTease = introRotationAt(segs, segs[0].durationMs / 2);
    expect(midTease.rotationY).toBeGreaterThan(0);
    expect(midTease.rotationY).toBeLessThan(segs[0].to);
    expect(midTease.done).toBe(false);

    // Just before the end: not yet done.
    const justBefore = introRotationAt(segs, total - 1);
    expect(justBefore.done).toBe(false);

    // At/after the total: done, and snapped to the canonical resting angle (not a raw eased sample).
    expect(introRotationAt(segs, total)).toEqual({ rotationY: 0, done: true });
    expect(introRotationAt(segs, total + 500)).toEqual({ rotationY: 0, done: true });
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

describe('Coin — one-time intro animation (issue #262 Part 3)', () => {
  it('off by default: no `intro` prop means no intro rAF loop, even while resting', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    render(<Coin />);
    expect(capturedMeshes[0].rotation.y).toBe(0);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('intro=true plays a multi-tick tease/return/spin sequence, then lands flat on heads (rotation.y = 0) and stops', () => {
    const clock = installManualAnimationClock();
    render(<Coin intro />);
    const mesh = capturedMeshes[0];
    expect(mesh.rotation.y).toBe(0); // hasn't ticked yet — the first frame hasn't been driven

    clock.advance(100); // one frame into the tease
    expect(mesh.rotation.y).not.toBe(0); // proves the sequence actually moved the coin, not a no-op
    expect(clock.hasPending()).toBe(true); // it re-scheduled itself — not a one-shot

    // Drive the rest of the ~1.35s sequence to completion (a generous cap of steps well past the
    // total duration; the loop will have already reported `done` and stopped re-scheduling by then).
    for (let i = 0; i < 30 && clock.hasPending(); i++) clock.advance(100);

    expect(clock.hasPending()).toBe(false); // no lingering render loop once landed
    expect(mesh.rotation.y).toBe(0); // lands exactly flat — the canonical resting angle
    expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads');

    // Advancing further does nothing more — the loop is genuinely stopped, not just between ticks.
    const rendersAtLanding = rendererRenderCalls.count;
    clock.advance(500);
    expect(rendererRenderCalls.count).toBe(rendersAtLanding);
  });

  it('skips the intro entirely under prefers-reduced-motion (no rotation change, no render loop)', () => {
    stubMatchMedia(true);
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    render(<Coin intro />);
    expect(capturedMeshes[0].rotation.y).toBe(0);
    expect(rafSpy).not.toHaveBeenCalled();
  });

  it('a match starting mid-intro cancels it, snaps rotation.y to 0 instantly, then the normal flip lands cleanly on the target face', () => {
    const clock = installManualAnimationClock();
    const { rerender } = render(<Coin intro face={null} />);
    const mesh = capturedMeshes[0];
    clock.advance(100); // one frame into the tease
    expect(mesh.rotation.y).not.toBe(0);

    rerender(<Coin intro face="tails" />);
    // The cancel + snap runs synchronously inside the flip effect (during the rerender), strictly
    // before the flip's own rAF loop takes its first tick — so the coin already reads flat here, and
    // the flip's `from` (which reads this same value) starts from 0, not the mid-tease angle.
    expect(mesh.rotation.y).toBe(0);
    expect(clock.hasPending()).toBe(true); // the flip claimed the next frame slot

    // Drive the flip (≤2400ms full-motion duration) to completion.
    for (let i = 0; i < 30 && clock.hasPending(); i++) clock.advance(300);
    expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('tails');
  });

  it("does not replay after a full round returns to idle (mount-only — relies on Part 2's single persistent mount)", () => {
    const clock = installManualAnimationClock();
    const { rerender } = render(<Coin intro face={null} />);
    const mesh = capturedMeshes[0];
    // Let the intro finish naturally.
    for (let i = 0; i < 30 && clock.hasPending(); i++) clock.advance(100);
    expect(mesh.rotation.y).toBe(0);

    // A full round: flips to a result, then the caller (CoinflipHub) returns to idle (face → null)
    // without ever unmounting this same <Coin> instance.
    rerender(<Coin intro face="heads" />);
    for (let i = 0; i < 30 && clock.hasPending(); i++) clock.advance(300);
    expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads');
    rerender(<Coin intro face={null} />);

    // Back at rest: the plain reset path snaps straight to 0 — no second tease/spin sequence fires,
    // so there's nothing left to advance (no pending frame at all).
    expect(mesh.rotation.y).toBe(0);
    expect(clock.hasPending()).toBe(false);
  });

  it('unmounting mid-intro cancels its render loop cleanly (no post-unmount rAF/render calls)', () => {
    const clock = installManualAnimationClock();
    const { unmount } = render(<Coin intro />);
    const mesh = capturedMeshes[0];
    clock.advance(100); // one frame into the tease
    expect(mesh.rotation.y).not.toBe(0);
    const rendersBeforeUnmount = rendererRenderCalls.count;

    unmount();
    expect(clock.hasPending()).toBe(false); // the effect cleanup cancelled the pending frame

    // Even if something tried to fire another frame, there's nothing pending to invoke — and the
    // render count hasn't moved since teardown.
    expect(rendererRenderCalls.count).toBe(rendersBeforeUnmount);
  });
});
