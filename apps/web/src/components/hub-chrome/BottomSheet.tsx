import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** Controls visibility via `transform`/`opacity`, never conditional mounting — this component
   *  always renders its own DOM (translated off-screen when `open` is false) so there's something
   *  to animate FROM the very first time `open` flips true. Same "always mounted" idiom
   *  `ChatSheet.tsx`/`MenuOverlay.tsx` already use for their own overlay chrome. */
  open: boolean;
  /** Fired when the scrim is tapped, or the drag handle passes the half-height threshold on
   *  release. Also fired on a plain (non-drag) tap on the handle, matching the existing
   *  tap-to-close affordance `CreateCampaignSheet`'s handle already had. */
  onClose(): void;
  children: ReactNode;
  /** Tailwind z-index class applied to both the scrim and the sheet. Defaults to `z-30` — a
   *  deliberate in-flow action sheet (the campaign sheet's own existing stacking). A caller that
   *  needs to sit BELOW the persistent bottom nav (`z-20`, `hub-chrome/HubToolbar.tsx`) — the auth
   *  sheet, per its own preserved stacking-order lesson (see `AuthModal.tsx`'s top-of-file comment)
   *  — passes `'z-10'` instead. */
  zIndexClassName?: string;
  scrimTestId?: string;
  sheetTestId?: string;
  handleTestId?: string;
  'aria-label'?: string;
}

/** Downward-only drag distance (px) at which the scrim has fully faded to transparent — matches
 *  the prototype's own `authScrimOp` formula, `Full Spec.html:2452-2453`. */
const SCRIM_FADE_DISTANCE = 320;
/** Fallback sheet height (px) used only if a live measurement isn't available yet (e.g. the very
 *  first pointerdown before layout) — matches the prototype's own `_dragH` fallback. */
const FALLBACK_DRAG_HEIGHT = 400;
const SHEET_TRANSITION = 'transform 440ms cubic-bezier(0.22,0.61,0.36,1)';

/**
 * Shared bottom-sheet chrome (ticket 2026-09-13#4) — scrim + a fixed-height, asymmetric-radius
 * sheet with drag-to-dismiss, built fresh against the prototype's own auth-sheet spec
 * (`Full Spec.html:2452-2453`, `:4181`, `:4185-4200`) rather than extracted from
 * `AffiliateHub.tsx`'s pre-existing `CreateCampaignSheet` (confirmed, on direct inspection, to
 * have had zero drag support and 3 geometry mismatches of its own — see that ticket's item 2).
 * Both `CreateCampaignSheet` and `AuthModal` render their own content as `children` here, picking
 * up the correct height/radius/shadow/drag mechanics for free.
 *
 * Drag mechanics (`dragStart`/`dragMove`/`dragEnd`, `:4185-4200`): pointer capture on the drag
 * handle itself (so pointermove/pointerup keep firing even if the pointer leaves the handle's own
 * bounds), the sheet's own LIVE `getBoundingClientRect().height` measured at drag-start (not a
 * hardcoded pixel number), downward-only movement, and release decides past-half-height (close)
 * vs. snap-back (stay open) against that live height. No transition while actively dragging — the
 * sheet must follow the finger with zero lag; the 440ms settle transition only applies once the
 * pointer lifts.
 */
export function BottomSheet({
  open,
  onClose,
  children,
  zIndexClassName = 'z-30',
  scrimTestId,
  sheetTestId,
  handleTestId,
  'aria-label': ariaLabel,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragFromRef = useRef(0);
  const dragHeightRef = useRef(FALLBACK_DRAG_HEIGHT);
  const sheetRef = useRef<HTMLDivElement>(null);

  function dragStart(e: ReactPointerEvent<HTMLButtonElement>) {
    // jsdom (unit tests) doesn't implement the Pointer Events capture methods — guard rather than
    // let a missing polyfill throw and abort the drag before it starts.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no pointer-capture support (e.g. jsdom) — drag still works via React's own event delivery */
    }
    dragFromRef.current = e.clientY;
    dragHeightRef.current = sheetRef.current?.getBoundingClientRect().height || FALLBACK_DRAG_HEIGHT;
    setDragging(true);
    setDragY(0);
  }

  function dragMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    const dy = e.clientY - dragFromRef.current;
    setDragY(Math.max(0, dy)); // downward-only — never drags upward past the open position
  }

  function dragEnd(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released (e.g. pointercancel fired first) — nothing to do */
    }
    const past = dragY > dragHeightRef.current / 2; // past HALF the sheet's own live height
    setDragging(false);
    setDragY(0);
    if (past) onClose();
  }

  const scrimOpacity = !open ? 0 : dragging ? Math.max(0, 1 - dragY / SCRIM_FADE_DISTANCE) : 1;
  const transform = open ? `translateY(${dragY}px)` : 'translateY(104%)';

  return (
    <>
      {/* Scrim — `Full Spec.html:2452-2453`: z-index 7, rgba(0,0,0,0.6), 320ms ease opacity
          (proportional to drag while actively dragging, per `authScrimOp`). */}
      <div
        data-testid={scrimTestId}
        aria-hidden={!open}
        onClick={onClose}
        className={cn('fixed inset-0', zIndexClassName)}
        style={{
          background: 'rgba(0,0,0,0.6)',
          opacity: scrimOpacity,
          transition: dragging ? 'none' : 'opacity 320ms ease',
          pointerEvents: open ? 'auto' : 'none',
        }}
      />

      {/* Sheet — fixed 70% height, asymmetric 34px/52px radius, `0 -18px 40px rgba(0,0,0,0.45)`
          shadow, all per the same citation range. */}
      <div
        ref={sheetRef}
        data-testid={sheetTestId}
        role="dialog"
        aria-modal={open}
        aria-hidden={!open}
        aria-label={ariaLabel}
        className={cn('fixed inset-x-0 bottom-0 flex flex-col', zIndexClassName)}
        style={{
          height: '70%',
          background: 'var(--rc-surface)',
          borderRadius: '34px 34px 52px 52px',
          boxShadow: '0 -18px 40px rgba(0,0,0,0.45)',
          boxSizing: 'border-box',
          transform,
          transition: dragging ? 'none' : SHEET_TRANSITION,
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <button
          type="button"
          data-testid={handleTestId}
          aria-label="Close"
          onClick={onClose}
          onPointerDown={dragStart}
          onPointerMove={dragMove}
          onPointerUp={dragEnd}
          onPointerCancel={dragEnd}
          className="mx-auto mb-2 mt-3 h-[5px] w-14 flex-none touch-none rounded-full bg-[var(--rc-muted)]/40"
        />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-8">{children}</div>
      </div>
    </>
  );
}
