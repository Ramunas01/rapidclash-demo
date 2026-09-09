import type { Page } from 'playwright-core';
import { FREEZE_SCRIPT, FREEZE_STYLE } from './paths.js';

/**
 * Make a page's rendering deterministic before it loads: pin `Math.random` / `Date.now` (seeded
 * mock data, clocks), and — once the DOM exists — strip every transition and animation. Call
 * before `page.goto`. The style is re-appended after render by `settleFrozen`.
 */
export async function armFreeze(page: Page): Promise<void> {
  await page.addInitScript(FREEZE_SCRIPT);
  await page.addInitScript((css: string) => {
    const apply = () => {
      const s = document.createElement('style');
      s.id = '__df_freeze';
      s.textContent = css;
      document.head?.appendChild(s);
    };
    if (document.head) apply();
    else document.addEventListener('DOMContentLoaded', apply, { once: true });
  }, FREEZE_STYLE);
}

/** Belt-and-braces: re-inject the freeze style after the app has rendered its own <head>. */
export async function settleFrozen(page: Page): Promise<void> {
  await page.addStyleTag({ content: FREEZE_STYLE }).catch(() => {});
}
