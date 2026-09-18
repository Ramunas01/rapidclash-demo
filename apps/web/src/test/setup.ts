import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);

// jsdom (as of 25.0.1) does not implement PointerEvent at all, so
// fireEvent.pointerDown/Move/Up() falls back to constructing a plain Event,
// silently dropping properties like clientY/pointerId. Polyfill a minimal
// PointerEvent on top of MouseEvent (which jsdom already supports clientX/Y
// for) so drag-handling components under test see real coordinates.
if (typeof window !== 'undefined' && !window.PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  // @ts-expect-error - polyfilling a jsdom gap, not a spec-complete PointerEvent
  window.PointerEvent = PointerEventPolyfill;
}

// jsdom does not implement window.scrollTo — throws "Not implemented" (logged, non-fatal) on
// every render that reaches it. Ticket 2026-09-18#1 added a real `window.scrollTo` call
// (GameHub.tsx, scroll-to-top on match start), which now fires in any test that transitions
// currentMatchId — i.e. most hub tests, not just the ones about this specific ticket. Stub it
// globally so that's silent everywhere; individual tests can still spy on it themselves
// (`window.scrollTo = vi.fn()`) to assert the call.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}
