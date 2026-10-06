import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Ticket 2026-10-06#1 (D83): the shared 3D "ledge" pill construction — a raised face sitting over
 * a darker box-shadow ledge, pressed flush on tap. Extracted from `BlackjackHub.tsx`'s own
 * already-shipped Hit/Stand (ticket 2026-09-27#6/D68) rather than re-derived a second time for
 * Coinflip's own HEADS/TAILS pick pills — Designer's own phrasing was "the SAME component" for
 * both, singular.
 *
 * Two interaction models, both supported by this one construction:
 *  - Momentary action (Hit/Stand): `selected` is never passed. The only press feedback is the
 *    caller's OWN `active:translate-y-[3px]` Tailwind class — CSS-only, releases the instant the
 *    pointer lifts. No `selected` means this component sets no inline `transform`/reduced-ledge
 *    at all, so that class's `:active` rule is free to apply without an inline style outranking it.
 *  - Persistent toggle (Coinflip HEADS/TAILS): `selected` is always explicitly `true`/`false`. The
 *    pressed pose — `translateY(3px)`, a shallower `0 2px 0` ledge (down from `0 5px 0`), and
 *    `filter: brightness(0.85)` — is driven by React state and stays until deselected, never
 *    releasing on pointer-up the way Hit/Stand's does.
 */
export const PILL_BUTTON_MIN_WIDTH = 92;
/** Press-pulse duration (ms) — Hit/Stand's own `NAV_BAR_POP_MS` (`Full Spec.html:3963-3969`). */
export const PILL_BUTTON_POP_MS = 460;

export function PillButton({
  label,
  faceClassName,
  faceColor,
  ledge,
  selected,
  disabled = false,
  onClick,
  testid,
  className,
}: {
  label: string;
  /** A Tailwind background class (e.g. `'bg-brand'`) — mutually exclusive with `faceColor`, used
   *  when the face is a themed token rather than a fixed literal (Hit's own `bg-brand`). */
  faceClassName?: string;
  /** A literal/inline color (hex or `var(--...)`,) — mutually exclusive with `faceClassName`. */
  faceColor?: string;
  /** The ledge's own color (just the hex/token, NOT a full box-shadow string — this component
   *  builds `0 <depth>px 0 <ledge>` itself). */
  ledge: string;
  /** Omit entirely for a momentary action button (Hit/Stand); pass `true`/`false` explicitly for
   *  a persistent toggle (Coinflip's HEADS/TAILS). See this file's own top doc comment. */
  selected?: boolean;
  disabled?: boolean;
  onClick?(): void;
  testid?: string;
  className?: string;
}) {
  // The press-pulse (`rcNavBarPop`) is self-contained per instance — each pill owns its own timer,
  // not a bar-wide shared key, so two pills can never interfere with each other's animation.
  const [popping, setPopping] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick
        ? {
            type: 'button' as const,
            onClick,
            disabled,
            'aria-pressed': selected,
            onPointerDown: () => {
              clearTimeout(timeoutRef.current);
              setPopping(true);
              timeoutRef.current = setTimeout(() => setPopping(false), PILL_BUTTON_POP_MS);
            },
          }
        : {})}
      data-testid={testid}
      data-selected={selected || undefined}
      aria-label={label}
      style={{
        minWidth: PILL_BUTTON_MIN_WIDTH,
        ...(faceColor ? { background: faceColor } : {}),
        boxShadow: selected === undefined ? `0 5px 0 ${ledge}` : selected ? `0 2px 0 ${ledge}` : `0 5px 0 ${ledge}`,
        // Omitted (not even `translateY(0)`) when `selected` is undefined, so Hit/Stand's own
        // `active:translate-y-[3px]` class isn't outranked by an inline style targeting the same
        // property — inline styles always win over a class's pseudo-state rule when both are set.
        transform: selected === undefined ? undefined : selected ? 'translateY(3px)' : 'translateY(0)',
        filter: selected ? 'brightness(0.85)' : undefined,
        transition: 'transform 120ms ease, box-shadow 200ms ease, filter 200ms ease',
        animation: popping ? 'rcNavBarPop 420ms cubic-bezier(0.22,0.61,0.36,1)' : undefined,
      }}
      className={cn(
        'rounded-full px-4 py-1.5 text-center text-sm text-white transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        faceClassName,
        onClick && 'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {label}
    </Tag>
  );
}
