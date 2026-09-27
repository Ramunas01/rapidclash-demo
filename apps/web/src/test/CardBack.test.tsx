// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CardBack, DeckPile, BOLT_PATH } from '../components/cards/CardBack.js';

describe('CardBack (shared SVG/CSS card back)', () => {
  it('is a white card with an inset panel frame and a centred, upright bolt watermark (token colours)', () => {
    render(<CardBack />);
    const art = screen.getByTestId('card-back-art');
    expect(art.className).toContain('bg-white'); // white card
    expect(art.className).toContain('p-[10%]'); // even white frame (padding, relative to width)
    expect(art.className).toContain('rounded-lg'); // outer radius matching the card faces

    // The blue inset panel uses the token — one source of truth, not a scattered hex.
    const panel = art.firstElementChild as HTMLElement;
    expect(panel.style.backgroundColor).toBe('var(--card-back)');

    // Bolt watermark: an SVG path, token-coloured, upright (no rotation), scaled large.
    const bolt = screen.getByTestId('card-back-bolt');
    expect(bolt.tagName.toLowerCase()).toBe('svg');
    expect((bolt as unknown as SVGElement).style.fill).toBe('var(--card-back-mark)');
    expect(bolt.querySelector('path')?.getAttribute('d')).toBe(BOLT_PATH);
    // Ticket 2026-09-27#4 (D66): width-driven (74% of the panel width), not height-driven — the
    // old height-driven sizing against a square 24x24 viewBox genuinely overflowed a non-square
    // panel (e.g. Blackjack's own portrait hole card). See the panel's own overflow-hidden check
    // below for the safety-net half of the same fix.
    expect(bolt.getAttribute('class') ?? '').toContain('w-[74%]');
    expect(bolt.getAttribute('viewBox')).toBe('0 0 351 374');
    expect(panel.className).toContain('overflow-hidden');
    expect(art.getAttribute('style') ?? '').not.toMatch(/rotate/); // centred + upright by default
  });

  it('is vector only — no raster image', () => {
    const { container } = render(<CardBack />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('accepts a style (e.g. the flip transform) so it can be a flip-card face', () => {
    render(<CardBack style={{ transform: 'rotateY(180deg)' }} />);
    expect(screen.getByTestId('card-back-art').style.transform).toBe('rotateY(180deg)');
  });
});

describe('DeckPile (shared deck)', () => {
  it('renders the blue back over ~4–5 offset white peeking edges (the ridged pile), vector only', () => {
    const { container } = render(<DeckPile className="h-[68px] w-12" />);
    expect(screen.getByTestId('deck-pile')).toBeInTheDocument();

    const edges = screen.getAllByTestId('deck-edge');
    expect(edges.length).toBeGreaterThanOrEqual(4);
    expect(edges.length).toBeLessThanOrEqual(5);
    for (const e of edges) {
      expect(e.className).toContain('bg-white'); // thin white card edges
      expect(e.style.transform).toMatch(/translateY\(/); // offset progressively downward
    }

    // The top card reuses the shared CardBack (blue back), and it is all SVG/CSS — no raster.
    expect(screen.getByTestId('card-back-art')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
