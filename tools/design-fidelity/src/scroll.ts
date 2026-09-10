import type { Page } from 'playwright-core';
import { VIEWPORT } from './paths.js';

/**
 * Below-the-fold coverage (Designer Q3: "full page, captured in viewport-sized slices"). The
 * single-frame `contentRegion` capture only ever sees the header-to-nav band — fine for screens
 * that fit in one viewport, useless for long ones (Rewards, Account) where most of the content
 * never gets diffed at all. This scrolls the real content and takes one viewport-tall screenshot
 * per scroll position, same as a user swiping down would see.
 *
 * The two sides scroll differently, so this hides that behind one interface:
 *  - The prototype's phone-screen content scrolls inside `[data-rc-scroll]`
 *    (`position:absolute; inset:0; overflow-y:auto` — Full Spec.html:170); the outer browser
 *    viewport never moves.
 *  - The built app scrolls the real page `window` — `HubRibbon`'s header is `sticky top-0` and
 *    `HubToolbar`'s nav is `fixed bottom-0` specifically so they ride along a scrolling body
 *    (see those files' own doc comments).
 * Screenshot `clip` is always relative to the current viewport, so no coordinate translation is
 * needed between scroll positions — only the scroll mechanism differs per side.
 */

interface ScrollExtent {
  scrollHeight: number;
  viewportHeight: number;
}

async function scrollExtent(page: Page, kind: 'prototype' | 'app'): Promise<ScrollExtent> {
  return page.evaluate((k: string) => {
    if (k === 'prototype') {
      const el = document.querySelector('[data-rc-scroll]') as HTMLElement | null;
      if (!el) throw new Error('design-fidelity: [data-rc-scroll] not found');
      return { scrollHeight: el.scrollHeight, viewportHeight: el.clientHeight };
    }
    return { scrollHeight: document.documentElement.scrollHeight, viewportHeight: window.innerHeight };
  }, kind);
}

async function setScrollTop(page: Page, kind: 'prototype' | 'app', y: number): Promise<void> {
  await page.evaluate(
    ({ k, y }: { k: string; y: number }) => {
      if (k === 'prototype') {
        const el = document.querySelector('[data-rc-scroll]') as HTMLElement | null;
        if (el) el.scrollTop = y;
      } else {
        window.scrollTo(0, y);
      }
    },
    { k: kind, y },
  );
}

/** Hard ceiling so a bad `scrollHeight` reading (e.g. 0, or a layout that never settles) can't
 *  spin the harness into taking hundreds of screenshots. No real screen needs this many slices. */
const MAX_FRAMES = 12;

/**
 * Captures the whole scrollable content as a sequence of raw, viewport-sized screenshots — frame
 * N is exactly what's on screen after scrolling N full viewport-heights down. Deliberately not
 * anchor-cropped like `contentRegion`: the point is coverage past what that ever reaches, and a
 * sticky header / fixed nav reappearing in every frame is what a real scroll actually looks like,
 * not a capture artifact to correct for.
 */
export async function captureScrollFrames(page: Page, kind: 'prototype' | 'app'): Promise<Buffer[]> {
  const { scrollHeight, viewportHeight } = await scrollExtent(page, kind);
  const frames: Buffer[] = [];
  let y = 0;
  while (y < scrollHeight && frames.length < MAX_FRAMES) {
    await setScrollTop(page, kind, y);
    await page.waitForTimeout(200); // let sticky/fixed elements and any lazy content settle
    frames.push(
      await page.screenshot({
        clip: { x: 0, y: 0, width: VIEWPORT.width, height: viewportHeight },
        animations: 'disabled',
        caret: 'hide',
      }),
    );
    y += viewportHeight;
  }
  await setScrollTop(page, kind, 0); // leave the page clean for whatever runs next
  return frames;
}
