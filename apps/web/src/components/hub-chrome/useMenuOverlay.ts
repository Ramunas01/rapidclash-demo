import { useCallback, useState } from 'react';

/** A plain snapshot of the tapped Menu button's position — not a live `DOMRect` (those go stale
 *  the instant the layout changes), just the four numbers `MenuOverlay` needs for its clip-path
 *  reveal origin. */
export interface MenuAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Issue #414: the Menu overlay's open/close + reveal-origin state, shared by every hub screen
 * that renders `<HubToolbar>` (HomeHub, GameHub, RewardsHub, ProfileHub) so each one doesn't
 * hand-roll its own copy of the same three lines. `HubToolbar` owns the actual Menu button (and
 * its ref) internally — on tap it computes that button's live `getBoundingClientRect()` and hands
 * the plain numbers to `onMenu`, which this hook exposes. The design's own clip-path literal
 * (`circle(0px at 55px 797px)`) is the mock's fixed viewport coordinate for ITS Menu button;
 * recomputing it from the real button on every open is what makes the reveal work on any
 * viewport/device instead of just the one the mock was captured at.
 */
export function useMenuOverlay() {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<MenuAnchorRect | null>(null);

  const onMenu = useCallback((rect: MenuAnchorRect) => {
    setAnchorRect(rect);
    setOpen((prev) => !prev);
  }, []);

  // Ticket 2026-09-13#2, item 2: `anchorRect` used to be set ONLY by `onMenu` above, which also
  // flips `open` in the same call — so on a fresh instance's very first open, the render that
  // reveals the overlay ALSO moves the clip-path's center away from MenuOverlay's `(0,0)`
  // fallback, in the same CSS transition (a visible slide-then-correct-reveal instead of a clean
  // grow-from-the-right-spot). `reportAnchorRect` is a rect-only path that never touches `open`,
  // so `HubToolbar` can report the Menu button's real position on MOUNT — before `open` is ever
  // flipped true for the first time — leaving the existing click-triggered `onMenu` path (which
  // still both measures and toggles) completely unchanged for every open after that.
  const reportAnchorRect = useCallback((rect: MenuAnchorRect) => {
    setAnchorRect(rect);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Tapping any OTHER nav item (Games/Account/Rewards) must also close the overlay (issue #414's
  // own spec). Simply passing the host screen's own onGames/onAccount/onRewards straight through
  // isn't enough: those are full App-level navigation callbacks, and if the tapped item is
  // already the current screen (e.g. tapping Account while already on Profile), navigation is a
  // self-no-op that never unmounts this component — so the overlay would silently stay open with
  // no unmount to close it as a side effect. Wrapping every non-Menu nav callback the host passes
  // to `<HubToolbar>` guarantees the close happens regardless of what navigation actually does.
  const wrap = useCallback((fn: () => void) => () => { setOpen(false); fn(); }, []);

  return { open, anchorRect, onMenu, reportAnchorRect, close, wrap };
}
