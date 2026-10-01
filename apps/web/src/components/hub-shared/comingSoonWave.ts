/**
 * Ticket 2026-10-01#6 (D73): builds one clip-path from the rounded rects of every `.rc-card--soon`
 * inside the games grid, so the single shared `.rc-soon-wave` purple diagonal line is visible only
 * over those "coming soon" cards — never over the gaps between cards or over live/playable ones.
 *
 * Ported close to verbatim from the handoff's own `coming-soon.js`
 * (`D73/coming-soon-effect/coming-soon.js`) — identical measurement math and clip-path
 * construction. The one real translation: the demo's own fire-and-forget module script becomes
 * `initSoonWave(grid)`, called from a caller's own `useEffect` (see `HomeHub.tsx`'s grid section)
 * so React's mount/unmount lifecycle re-wires the observers correctly if the grid element is ever
 * unmounted and remounted (the handoff's own explicit warning: "make sure the grid element isn't
 * re-created without re-calling initSoonWave").
 */

/** Matches `rounded-xl` (12px) — PlayableTile's/ComingSoonTile's own card radius. */
const CARD_RADIUS = 12;

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${x + r} ${y}H${x + w - r}` +
    `A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}` +
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}` +
    `A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  );
}

export function updateSoonClip(grid: HTMLElement): void {
  const wave = grid.querySelector<HTMLElement>('.rc-soon-wave');
  if (!wave) return;
  const g = grid.getBoundingClientRect();
  // Correct for any CSS transform scale on ancestors.
  const s = grid.offsetWidth ? g.width / grid.offsetWidth : 1;
  const parts: string[] = [];
  grid.querySelectorAll<HTMLElement>('.rc-card--soon').forEach((el) => {
    const b = el.getBoundingClientRect();
    parts.push(roundedRect((b.left - g.left) / s, (b.top - g.top) / s, b.width / s, b.height / s, CARD_RADIUS));
  });
  wave.style.clipPath = parts.length ? `path("${parts.join('')}")` : 'inset(100%)';
}

/**
 * Call once per grid element (from a `useEffect`). Re-measures on resize and whenever cards are
 * added/removed/changed (category switch, search filter, sort) via a `MutationObserver` watching
 * the grid's own subtree/class attributes — no extra plumbing needed at those call sites. Returns
 * a cleanup function disconnecting both observers and cancelling the initial measurement frame.
 *
 * `ResizeObserver` is guarded (`typeof ResizeObserver !== 'undefined'`) — jsdom (confirmed: as of
 * the version this repo pins) does not implement it, the same gap `App.tsx`'s own guest-mode
 * resize listener already works around; `MutationObserver` IS natively available there, no guard
 * needed for it.
 */
export function initSoonWave(grid: HTMLElement): () => void {
  const run = () => updateSoonClip(grid);
  const raf = requestAnimationFrame(run);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(run) : null;
  ro?.observe(grid);
  const mo = new MutationObserver(run);
  mo.observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  return () => {
    cancelAnimationFrame(raf);
    ro?.disconnect();
    mo.disconnect();
  };
}
