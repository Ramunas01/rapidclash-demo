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
