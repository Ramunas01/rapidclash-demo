import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared card-back + deck visuals (SVG/CSS only — no raster), so every place a back or a deck shows
 * uses ONE source of truth: Blackjack's opponent hole card and its deck piles today; Hilo / Baccarat
 * and any future card game tomorrow. Colours live in tokens (`--card-back` / `--card-back-mark`) so
 * there is one palette, not scattered hexes. Everything is vector, so it stays crisp through the flip
 * and deal animations at any size.
 */

/**
 * The RapidClash lightning-bolt watermark path (viewBox 0 0 24 24). ⚠️ This is a clean GENERIC bolt —
 * the brand mark only exists as a raster (`assets/brand/bolt-mark.webp`), so there is no single clean
 * SVG path to reuse (per the spec's fallback). Swap THIS ONE constant for the designer's exact bolt
 * path when provided — nothing else changes.
 */
export const BOLT_PATH = 'M13 2 L3 14 L12 14 L11 22 L21 10 L12 10 Z';

/**
 * A single card back: a white card (radius matching the card faces, soft drop shadow) with a flat
 * blue-violet inset panel (`--card-back`), an even white frame on all sides (via `p-[10%]`, which is
 * relative to width so the frame is uniform), and the bolt watermark (`--card-back-mark`, tone-on-tone)
 * scaled large, centred and upright. Fills its container — size/position it via `className`.
 */
export function CardBack({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden="true"
      data-testid="card-back-art"
      className={cn('rounded-lg bg-white p-[10%] shadow-lg', className)}
      style={style}
    >
      <div
        className="flex h-full w-full items-center justify-center rounded-md"
        style={{ backgroundColor: 'var(--card-back)' }}
      >
        <svg
          viewBox="0 0 24 24"
          data-testid="card-back-bolt"
          className="h-[70%] w-auto"
          style={{ fill: 'var(--card-back-mark)' }}
          aria-hidden="true"
        >
          <path d={BOLT_PATH} />
        </svg>
      </div>
    </div>
  );
}

/** How many white card edges peek beneath the top card (the ridged "pile" look). */
const PILE_EDGES = 4;
/** Vertical offset (px) between each peeking edge. */
const PILE_OFFSET_PX = 2.5;

/**
 * A deck pile: the top card is the blue {@link CardBack}; beneath it a few thin white card edges peek
 * out, offset progressively DOWNWARD (the ridged stack), with one soft drop shadow under the whole
 * thing. Fills / positions via `className` (e.g. the table's right edge). Deal animations originate
 * here and the sliding card reuses the same {@link CardBack}.
 */
export function DeckPile({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" data-testid="deck-pile" className={cn('relative', className)}>
      {/* Peeking white edges beneath the top card — each shifted a little further down and behind. */}
      {Array.from({ length: PILE_EDGES }).map((_, i) => (
        <div
          key={i}
          data-testid="deck-edge"
          className="absolute inset-0 rounded-lg border border-black/10 bg-white"
          style={{ transform: `translateY(${(PILE_EDGES - i) * PILE_OFFSET_PX}px)`, zIndex: i }}
        />
      ))}
      {/* Top card = the blue back, over the pile; its soft shadow reads as the stack's single shadow. */}
      <CardBack className="relative z-10 h-full w-full" />
    </div>
  );
}
