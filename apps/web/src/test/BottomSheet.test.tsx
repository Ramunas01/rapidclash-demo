// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomSheet } from '../components/hub-chrome/BottomSheet.js';

/** jsdom has no real layout, so `getBoundingClientRect` is mocked the same way
 *  `HubToolbar.test.tsx`/`DiceHub.test.tsx`'s own bar-slide tests already do — a
 *  `vi.spyOn(HTMLElement.prototype, ...)` stub, restored in `finally`. */
function withMockedSheetHeight(height: number, fn: () => void) {
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height, width: 400, top: 0, left: 0, right: 400, bottom: height, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  try {
    fn();
  } finally {
    rectSpy.mockRestore();
  }
}

describe('BottomSheet', () => {
  it('is always mounted — present in the DOM (translated off-screen) even when open=false', () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()} sheetTestId="sheet" scrimTestId="scrim" handleTestId="handle">
        content
      </BottomSheet>,
    );
    const sheet = screen.getByTestId('sheet');
    expect(sheet).toBeInTheDocument();
    expect(sheet.style.transform).toBe('translateY(104%)');
    expect(screen.getByTestId('scrim')).toBeInTheDocument();
  });

  it('open=true renders at rest (no drag offset) with the verified geometry', () => {
    render(
      <BottomSheet open onClose={vi.fn()} sheetTestId="sheet" scrimTestId="scrim" handleTestId="handle">
        content
      </BottomSheet>,
    );
    const sheet = screen.getByTestId('sheet');
    expect(sheet.style.transform).toBe('translateY(0px)');
    expect(sheet.style.height).toBe('70%');
    expect(sheet.style.borderRadius).toBe('34px 34px 52px 52px');
    expect(sheet.style.boxShadow).toBe('0 -18px 40px rgba(0,0,0,0.45)');
    expect(screen.getByTestId('scrim').style.opacity).toBe('1');
  });

  it('scrim tap calls onClose', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} sheetTestId="sheet" scrimTestId="scrim" handleTestId="handle">
        content
      </BottomSheet>,
    );
    fireEvent.click(screen.getByTestId('scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a plain tap on the handle (no drag) calls onClose', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} sheetTestId="sheet" scrimTestId="scrim" handleTestId="handle">
        content
      </BottomSheet>,
    );
    fireEvent.click(screen.getByTestId('handle'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drag past half the sheet\'s own live height closes on release', () => {
    withMockedSheetHeight(400, () => {
      const onClose = vi.fn();
      render(
        <BottomSheet open onClose={onClose} sheetTestId="sheet" scrimTestId="scrim" handleTestId="handle">
          content
        </BottomSheet>,
      );
      const handle = screen.getByTestId('handle');
      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientY: 100 + 250, pointerId: 1 }); // dy=250 > 400/2=200
      fireEvent.pointerUp(handle, { clientY: 100 + 250, pointerId: 1 });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('drag short of half the sheet\'s own live height snaps back (no close)', () => {
    withMockedSheetHeight(400, () => {
      const onClose = vi.fn();
      render(
        <BottomSheet open onClose={onClose} sheetTestId="sheet" scrimTestId="scrim" handleTestId="handle">
          content
        </BottomSheet>,
      );
      const handle = screen.getByTestId('handle');
      const sheet = screen.getByTestId('sheet');
      fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientY: 100 + 100, pointerId: 1 }); // dy=100 < 400/2=200
      expect(sheet.style.transform).toBe('translateY(100px)');
      fireEvent.pointerUp(handle, { clientY: 100 + 100, pointerId: 1 });
      expect(onClose).not.toHaveBeenCalled();
      // Resets to the open, at-rest transform once the drag ends.
      expect(sheet.style.transform).toBe('translateY(0px)');
    });
  });

  it('drag is downward-only — an upward pointermove never produces a negative offset', () => {
    withMockedSheetHeight(400, () => {
      render(
        <BottomSheet open onClose={vi.fn()} sheetTestId="sheet" scrimTestId="scrim" handleTestId="handle">
          content
        </BottomSheet>,
      );
      const handle = screen.getByTestId('handle');
      const sheet = screen.getByTestId('sheet');
      fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 }); // dy=-100 → clamped to 0
      expect(sheet.style.transform).toBe('translateY(0px)');
    });
  });

  it('scrim opacity fades proportionally to drag distance while dragging, with no transition mid-drag', () => {
    withMockedSheetHeight(400, () => {
      render(
        <BottomSheet open onClose={vi.fn()} sheetTestId="sheet" scrimTestId="scrim" handleTestId="handle">
          content
        </BottomSheet>,
      );
      const handle = screen.getByTestId('handle');
      const scrim = screen.getByTestId('scrim');
      const sheet = screen.getByTestId('sheet');
      fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 });
      fireEvent.pointerMove(handle, { clientY: 160, pointerId: 1 }); // dy=160, half of the 320 fade distance
      expect(scrim.style.opacity).toBe('0.5');
      expect(scrim.style.transition).toBe('none');
      expect(sheet.style.transition).toBe('none');
    });
  });
});
