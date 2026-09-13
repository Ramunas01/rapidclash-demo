/**
 * Shared shared-track rail mechanics — the `mask-image` edge-fade + scroll-to-center-the-clicked-
 * pill pattern used by every "pill rail sitting on a non-scrolling track div" in this app: the
 * Open Games tab rail (`GamesCarousel.tsx`, ticket 2026-09-13#6 item 1) and now the Account page's
 * inline avatar-picker strip (`ProfileHub.tsx`, ticket 2026-09-13#7 item 2b). Extracted here rather
 * than left duplicated a second time — both call sites' own versions of
 * `railMask`/`centerPill` were byte-identical (transcribed verbatim from the prototype's own
 * `railMask(l, r)`/`centerPill(pill)`, `design/prototype/RapidClash Full Spec.html:3492-3508`),
 * so a shared helper is a straightforward win, not a forced abstraction.
 *
 * NOTE: this is the TWO-LEVEL rail shape (an outer `mask-image`-bearing scroller wrapping an
 * inner non-scrolling track div) — `centerPill` walks UP from the clicked pill past that inner
 * track to find the real scrollable ancestor. `HomeHub.tsx`'s `CategoryTabs`/`selectAndCenter`
 * (issue #501) is a simpler ONE-level rail (the pill's own parent IS the scroller) and also uses
 * the overlay-div fade technique, not `mask-image` — a genuinely different rail, not a candidate
 * for this same helper (confirmed via 2026-09-13#6 item 1's own investigation).
 */

/** A single `linear-gradient(...)` string for `mask-image`/`-webkit-mask-image` on the rail's
 *  scroller, fading `a`px in from the left and `b`px in from the right (both derived from `l`/`r`,
 *  0-1 scroll-fraction state the caller tracks via its own scroll handler). Returns `'none'` when
 *  there's nothing to fade (both edges fully visible). */
export function railMask(l: number, r: number): string {
  const a = Math.round(Math.max(0, Math.min(1, l || 0)) * 34);
  const b = Math.round(Math.max(0, Math.min(1, r ?? 1)) * 34);
  if (!a && !b) return 'none';
  return `linear-gradient(to right, rgba(0,0,0,0) 0px, #000 ${a}px, #000 calc(100% - ${b}px), rgba(0,0,0,0) 100%)`;
}

/** Walks UP from the clicked pill past the non-scrolling inner track div to find the actual
 *  scrollable ancestor, then smooth-scrolls that ancestor so the pill lands centered (clamped to
 *  the scrollable range). `rail.scrollTo?.(...)` — optional call: jsdom (the unit-test DOM)
 *  doesn't implement `Element.scrollTo` at all; every real browser does. */
export function centerPill(pill: HTMLElement): void {
  let rail: HTMLElement | null = pill.parentElement;
  while (rail && rail.scrollWidth <= rail.clientWidth + 1) rail = rail.parentElement;
  if (!rail) return;
  const pr = pill.getBoundingClientRect();
  const rr = rail.getBoundingClientRect();
  const target = rail.scrollLeft + (pr.left - rr.left) - (rr.width - pr.width) / 2;
  const max = rail.scrollWidth - rail.clientWidth;
  rail.scrollTo?.({ left: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
}
