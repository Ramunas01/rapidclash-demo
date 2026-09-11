import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Source-level checks for the two new tokens issue #472 adds (sort-sheet background, the
 * theme-picker radio's selected-state shadow). jsdom doesn't apply an externally `import`-ed
 * stylesheet's real cascade (no `[data-theme="light"]` attribute-selector resolution through
 * `getComputedStyle` the way a real browser would), so — rather than a flaky simulation of that —
 * these assert directly against the CSS source (the actual light/dark hex pairs from the issue's
 * table) and against the component sources (no hardcoded hex literal left behind for either of
 * these two specific things, per the issue's verification checklist).
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('theme tokens (issue #472)', () => {
  const css = read('../index.css');

  it('defines --rc-sort-sheet-bg with the dark default (#1A1A2E) in :root', () => {
    const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='light']"));
    expect(rootBlock).toMatch(/--rc-sort-sheet-bg:\s*#1a1a2e;/i);
  });

  it("overrides --rc-sort-sheet-bg to the light value (#D3D3DD) under [data-theme='light']", () => {
    const lightBlock = css.slice(css.indexOf("[data-theme='light']"));
    expect(lightBlock).toMatch(/--rc-sort-sheet-bg:\s*#d3d3dd;/i);
  });

  it('defines --rc-theme-btn-shadow as a single value shared by both themes (not overridden for light)', () => {
    // The prototype's own darkGlow/lightGlow/systemGlow (RapidClash Full Spec.html ~line 4331)
    // compute the SAME rgba glow regardless of theme — it's keyed off selection state, not
    // light/dark — so this token is intentionally not overridden inside [data-theme='light'].
    // It's defined twice in :root/.dark (the pre-existing mirrored-block pattern this file
    // already used for every other --rc-* token), but never inside the light override block.
    const occurrences = css.match(/--rc-theme-btn-shadow:/g) ?? [];
    expect(occurrences.length).toBe(2);
    expect(css).toMatch(/--rc-theme-btn-shadow:\s*0 0 10px 2px rgba\(139, 69, 240, 0\.55\);/);

    const lightBlock = css.slice(css.indexOf("[data-theme='light']"));
    expect(lightBlock).not.toMatch(/--rc-theme-btn-shadow/);
  });

  it('the full --rc-* light palette matches the issue #472 table exactly', () => {
    const lightBlock = css.slice(css.indexOf("[data-theme='light']"), css.indexOf("[data-theme='light']") + css.slice(css.indexOf("[data-theme='light']")).indexOf('}'));
    const expected: Record<string, string> = {
      '--rc-bg': '#ffffff',
      '--rc-surface': '#e9e9f0',
      '--rc-sunken': '#d3d3dd',
      '--rc-text': '#0b0b0b',
      '--rc-muted': '#6e6e7a',
      '--rc-island': '#e4e4ee',
      '--rc-green': '#0b8f5a',
      '--rc-danger': '#c42b41',
    };
    for (const [token, hex] of Object.entries(expected)) {
      const re = new RegExp(`${token}:\\s*${hex};`, 'i');
      expect(lightBlock, `${token} should resolve to ${hex} under [data-theme='light']`).toMatch(re);
    }
  });

  it('the dark --rc-* palette (the existing values) is unchanged in :root', () => {
    const rootBlock = css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='light']"));
    const expected: Record<string, string> = {
      '--rc-bg': '#0b0b0b',
      '--rc-surface': '#1a1a2e',
      '--rc-sunken': '#0b0b0b',
      '--rc-text': '#ffffff',
      '--rc-muted': '#83838f',
      '--rc-island': '#1a1930',
      '--rc-green': '#34d399',
      '--rc-danger': '#f0556b',
    };
    for (const [token, hex] of Object.entries(expected)) {
      const re = new RegExp(`${token}:\\s*${hex};`, 'i');
      expect(rootBlock, `${token} should resolve to ${hex} in :root (dark)`).toMatch(re);
    }
  });

  it('PreferencesHub.tsx no longer hardcodes the theme-button shadow literal — reads the token', () => {
    const src = read('../screens/PreferencesHub.tsx');
    expect(src).not.toMatch(/rgba\(129,\s*64,\s*226/); // the old inline literal
    expect(src).toMatch(/shadow-\[var\(--rc-theme-btn-shadow\)\]/);
  });

  it('HomeHub.tsx’s sort sheet reads --rc-sort-sheet-bg rather than a hardcoded hex or bg-card', () => {
    const src = read('../screens/HomeHub.tsx');
    const sheetDivMatch = src.match(/rounded-\[26px\] bg-\S+ p-2 shadow-2xl/);
    expect(sheetDivMatch?.[0]).toContain('bg-[var(--rc-sort-sheet-bg)]');
  });
});
