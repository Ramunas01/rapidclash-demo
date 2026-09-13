// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';

const RECT = { left: 10, top: 20, width: 30, height: 40 };
const OTHER_RECT = { left: 1, top: 2, width: 3, height: 4 };

describe('useMenuOverlay', () => {
  it('starts closed with a null anchorRect', () => {
    const { result } = renderHook(() => useMenuOverlay());
    expect(result.current.open).toBe(false);
    expect(result.current.anchorRect).toBeNull();
  });

  it('onMenu sets the rect AND toggles open in the same call (the existing click behavior)', () => {
    const { result } = renderHook(() => useMenuOverlay());
    act(() => result.current.onMenu(RECT));
    expect(result.current.open).toBe(true);
    expect(result.current.anchorRect).toEqual(RECT);

    act(() => result.current.onMenu(OTHER_RECT));
    expect(result.current.open).toBe(false); // toggled back closed
    expect(result.current.anchorRect).toEqual(OTHER_RECT); // still re-measures on every call
  });

  // Ticket 2026-09-13#2, item 2: reportAnchorRect is the new mount-time path — it must set the
  // rect WITHOUT ever toggling `open`, so a fresh HubToolbar mount can report the Menu button's
  // real position before `open` is ever flipped true for the first time.
  it('reportAnchorRect sets anchorRect without touching open', () => {
    const { result } = renderHook(() => useMenuOverlay());
    expect(result.current.open).toBe(false);

    act(() => result.current.reportAnchorRect(RECT));
    expect(result.current.anchorRect).toEqual(RECT);
    expect(result.current.open).toBe(false); // unchanged — this is the whole point of the fix

    act(() => result.current.reportAnchorRect(OTHER_RECT));
    expect(result.current.anchorRect).toEqual(OTHER_RECT);
    expect(result.current.open).toBe(false);
  });

  // The actual bug this fix closes: simulating mount-then-first-click, `anchorRect` must already
  // be the real rect BEFORE the first `onMenu` call — i.e. before `open` is ever flipped true.
  it('simulated mount-then-first-click: anchorRect is already correct before the first onMenu call', () => {
    const { result } = renderHook(() => useMenuOverlay());

    // Mount-time report (what HubToolbar's new useLayoutEffect does).
    act(() => result.current.reportAnchorRect(RECT));
    expect(result.current.anchorRect).toEqual(RECT);
    expect(result.current.open).toBe(false); // not yet opened

    // First actual click.
    act(() => result.current.onMenu(RECT));
    expect(result.current.open).toBe(true);
    expect(result.current.anchorRect).toEqual(RECT); // unchanged — already correct pre-click
  });

  it('close() closes regardless of how it was opened', () => {
    const { result } = renderHook(() => useMenuOverlay());
    act(() => result.current.onMenu(RECT));
    expect(result.current.open).toBe(true);
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });

  it('wrap() closes the overlay and calls the wrapped callback', () => {
    const { result } = renderHook(() => useMenuOverlay());
    act(() => result.current.onMenu(RECT));
    expect(result.current.open).toBe(true);

    let called = false;
    act(() => result.current.wrap(() => { called = true; })());
    expect(called).toBe(true);
    expect(result.current.open).toBe(false);
  });
});
