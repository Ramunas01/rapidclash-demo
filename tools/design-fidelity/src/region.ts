import type { Page } from 'playwright-core';
import { VIEWPORT } from './paths.js';

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which fixed landmark the capture is anchored on.
 *  - `header`   — the RapidClash wordmark / LOGIN row. Default.
 *  - `catrail`  — the games-page category rail (the ORIGINALS tab). Used for the games screens
 *                because the carried-over banner between the header and the rail renders at a
 *                different height in the prototype than in the real app, which would otherwise
 *                push everything below it out of alignment.
 */
export type Anchor = 'header' | 'catrail';

/**
 * The captured region: from the top of the header (RapidClash wordmark row) down to the TOP of
 * the fixed bottom-nav. The prototype draws a fake iOS status bar above its header and a fake
 * in-app-browser URL bar below its nav — the real app has neither — so anchoring on the header
 * top makes the two captures line up instead of being offset by the fake chrome.
 *
 * The bottom-nav itself is excluded (it sits at a different height in the prototype's squeezed
 * mockup vs the app's full viewport, and it's shared chrome the per-screen rebuilds don't own —
 * it gets compared when the shared-chrome workstream lands). Below-the-fold content is a
 * separate follow-up (Designer Q3 — viewport-sized scroll frames).
 */
export async function contentRegion(page: Page, kind: 'prototype' | 'app', anchor: Anchor = 'header'): Promise<Clip> {
  const box = await page.evaluate(
    ({ k, a, VIEWPORT_W }: { k: string; a: string; VIEWPORT_W: number }) => {
    const rect = (el: Element | null | undefined) => (el ? el.getBoundingClientRect() : null);

    let header: DOMRect | null = null;
    let nav: DOMRect | null = null;

    // The header's own top padding above the first interactive chip (LOGIN / balance), in the app.
    // The prototype has the same visual gap; we align on it so both regions start at the same place.
    const HEADER_PAD = 10;

    // catrail: anchor on the top of the category rail instead of the header — the ORIGINALS tab.
    if (a === 'catrail') {
      const railTab =
        k === 'app'
          ? document.querySelector('[data-testid^="home-cat-"]')
          : Array.from(document.querySelectorAll<HTMLElement>('*')).find((e) => {
              const t = (e.textContent || '').replace(/\s+/g, '').trim();
              return t === 'ORIGINALS' && e.getBoundingClientRect().width < 160 && e.getBoundingClientRect().width > 40;
            });
      header = railTab ? (() => { const r = railTab.getBoundingClientRect(); return { top: r.top - 8, left: r.left, right: r.right, bottom: r.top } as DOMRect; })() : null;
    }

    if (k === 'app') {
      if (!header) {
        const h = rect(document.querySelector('header'));
        header = h ? ({ top: h.top, left: h.left, right: h.right, bottom: h.top } as DOMRect) : null;
      }
      nav = rect(document.querySelector('nav[aria-label="Primary"]'));
    } else {
      const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
      const screen = document.getElementById('__df_screen')?.getBoundingClientRect();
      const navEl = all.find((e) => {
        const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
        return /Menu ?Games ?Account ?Rewards ?Chat/.test(t) && t.length < 60 && e.getBoundingClientRect().width >= 280;
      });
      nav = rect(navEl);
      if (!header) {
        // Top anchor: the LOGIN/SIGN UP chip row (signed out) or, signed in, a fixed drop below
        // the fake status bar — minus the app header's top padding, so the two line up.
        const chip = all.find((e) => {
          const t = (e.textContent || '').trim();
          return (t === 'LOGIN' || t === 'SIGNUP') && e.getBoundingClientRect().top < 220;
        });
        const statusBar = all.find((e) => (e.textContent || '').trim() === '01:06');
        const chipTop = chip ? chip.getBoundingClientRect().top - HEADER_PAD : null;
        const sbFallback = statusBar ? statusBar.getBoundingClientRect().bottom + 11 : null;
        const top = chipTop ?? sbFallback ?? (screen ? screen.top + 48 : null);
        if (top != null && screen) header = { top, left: screen.left, right: screen.right, bottom: top } as DOMRect;
      }
    }

    if (!header || !nav) return { missing: true, header: !!header, nav: !!nav };
    // Fixed full-width column, x=0 — deriving width from element bounds gave different widths on
    // the two sides (the prototype's nav pill is more inset than the app's), which left the app
    // capture's right edge comparing against nothing.
    return {
      x: 0,
      y: Math.max(0, Math.round(header.top)),
      width: VIEWPORT_W,
      height: Math.round(nav.top - header.top),
    };
    },
    { k: kind, a: anchor, VIEWPORT_W: VIEWPORT.width },
  );

  if ('missing' in box) {
    throw new Error(`design-fidelity: could not anchor the ${kind} capture — header:${box.header} nav:${box.nav}`);
  }
  return box;
}
