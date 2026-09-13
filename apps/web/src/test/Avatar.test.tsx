// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Avatar } from '../components/hub-shared/Avatar.js';
import rc01 from '../assets/avatars/rc-01.png';
import rc02 from '../assets/avatars/rc-02.png';
import rc10 from '../assets/avatars/rc-10.png';

/** Read the disc/glyph tokens the component exposes for testability (raw hsl/hex, CSSOM-agnostic). */
function tokens() {
  const el = screen.getByTestId('avatar');
  return { disc: el.getAttribute('data-disc'), glyph: el.getAttribute('data-glyph'), el };
}

describe('Avatar (shared)', () => {
  it('default renders the DARKENED silhouette glyph, not white and not a preset image', () => {
    render(<Avatar username="alice" avatarId="default" />);
    // The person glyph is present…
    const glyph = screen.getByTestId('avatar-glyph');
    expect(glyph).toBeInTheDocument();
    // …and it is NOT a preset <img>.
    expect(screen.queryByTestId('avatar-img')).toBeNull();
    // The glyph colour is the darker same-hue tone, never white (white would vanish on the light disc).
    const { glyph: glyphColor } = tokens();
    expect(glyphColor).toMatch(/^hsl\(\d+, 45%, 40%\)$/);
    expect(glyphColor).not.toMatch(/#fff|#ffffff|white/i);
  });

  it('renders a preset <img> (by src) for a non-default avatarId', () => {
    render(<Avatar username="alice" avatarId="rc-01" />);
    const img = screen.getByTestId('avatar-img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(rc01);
    // No default glyph when a preset is shown.
    expect(screen.queryByTestId('avatar-glyph')).toBeNull();
  });

  // Ticket 2026-09-13#7 items 1+2: the Designer's own official `rc-01`-`rc-10` export replaced
  // the six previously-named presets (including the #312 meme-style pair) outright.
  it('renders the Designer-supplied rc-01..rc-10 presets (2026-09-13#7)', () => {
    render(<Avatar username="alice" avatarId="rc-02" />);
    expect((screen.getByTestId('avatar-img') as HTMLImageElement).getAttribute('src')).toBe(rc02);
    expect(screen.queryByTestId('avatar-glyph')).toBeNull();
    cleanup();
    render(<Avatar username="alice" avatarId="rc-10" />);
    expect((screen.getByTestId('avatar-img') as HTMLImageElement).getAttribute('src')).toBe(rc10);
    expect(screen.queryByTestId('avatar-glyph')).toBeNull();
  });

  it('derives a deterministic LIGHT disc from the username (same name → identical disc)', () => {
    render(<Avatar username="alice" />);
    const first = tokens().disc;
    cleanup();
    render(<Avatar username="alice" />);
    const second = tokens().disc;
    expect(first).toBe(second); // deterministic
    // The disc is LIGHT (high lightness — the hsl(…, 90%) form) so the darkened glyph reads on it.
    expect(first).toMatch(/^hsl\(\d+, 55%, 90%\)$/);
  });

  it('gives two different usernames different hues (generally)', () => {
    render(<Avatar username="alice" />);
    const a = tokens().disc;
    cleanup();
    render(<Avatar username="bob" />);
    const b = tokens().disc;
    expect(a).not.toBe(b);
  });

  it('NEUTRAL mode (no username) → the fixed neutral disc + slate glyph, regardless of avatarId', () => {
    render(<Avatar avatarId="default" />);
    const { disc, glyph } = tokens();
    expect(disc).toBe('hsl(230, 10%, 88%)'); // fixed neutral, distinct from per-user discs
    expect(glyph).toBe('#3c4054'); // fixed slate silhouette
    // A null username behaves the same as an absent one.
    cleanup();
    render(<Avatar username={null} />);
    expect(tokens().disc).toBe('hsl(230, 10%, 88%)');
  });

  it('is sizeable (default 32 → the slot-bar size)', () => {
    render(<Avatar username="alice" size={56} />);
    const el = screen.getByTestId('avatar');
    expect(el.style.width).toBe('56px');
    expect(el.style.height).toBe('56px');
  });
});
