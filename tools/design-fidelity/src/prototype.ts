import { readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import {
  chromeExecutable,
  DEVICE_SCALE_FACTOR,
  PROTOTYPE_HTML,
  PROTOTYPE_URL,
  REACT_DOM_UMD,
  REACT_UMD,
  VIEWPORT,
} from './paths.js';
import { armFreeze, settleFrozen } from './freeze.js';
import { contentRegion, navRegion } from './region.js';
import type { ScreenDef, Theme } from './screens.js';

export type { Theme };

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: chromeExecutable(), headless: true });
}

/**
 * The prototype's only real theme switch is `this.state.theme === 'light'` — its "System" option
 * is cosmetic (nothing reads `prefers-color-scheme`), and the value is not persisted, so it
 * resets to dark on every reload. Rather than drive the in-app theme picker before every capture
 * (which also needs a sign-in), we intercept the HTML and seed `theme: 'light'` straight into the
 * component's initial state. Survives reloads because the route stays installed.
 */
function patchThemeIntoHtml(html: string, theme: Theme): string {
  if (theme === 'dark') return html;
  const anchor = "tab: 0, view: 'games'";
  if (!html.includes(anchor)) {
    throw new Error("prototype: could not find the initial-state anchor to seed the light theme — the spec's script block changed");
  }
  return html.replace(anchor, `tab: 0, theme: 'light', view: 'games'`);
}

/**
 * Open the prototype in a fresh page, in the given theme, with React served from the workspace
 * (not unpkg), and wait for the dc-runtime to render.
 */
export async function openPrototype(browser: Browser, theme: Theme = 'dark'): Promise<Page> {
  const react = readFileSync(REACT_UMD());
  const reactDom = readFileSync(REACT_DOM_UMD());
  const html = patchThemeIntoHtml(readFileSync(PROTOTYPE_HTML, 'utf8'), theme);

  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });

  // tsx/esbuild compiles page.evaluate() callbacks with `keepNames`, which emits `__name(...)`
  // calls that don't exist in the browser. Polyfill it as identity so any evaluate body works.
  await page.addInitScript(() => {
    // @ts-expect-error - injected shim
    window.__name = window.__name || ((fn: unknown) => fn);
  });
  await armFreeze(page);

  await page.route(PROTOTYPE_URL, (r) => r.fulfill({ body: html, contentType: 'text/html; charset=utf-8' }));
  await page.route(/unpkg\.com\/react@[\d.]+\/umd\/react\.production\.min\.js/, (r) =>
    r.fulfill({ body: react, contentType: 'application/javascript' }),
  );
  await page.route(/unpkg\.com\/react-dom@[\d.]+\/umd\/react-dom\.production\.min\.js/, (r) =>
    r.fulfill({ body: reactDom, contentType: 'application/javascript' }),
  );

  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));

  await page.goto(PROTOTYPE_URL, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForSelector('[data-rc-scroll]', { timeout: 15_000 }).catch(() => {
    throw new Error(
      `prototype did not render (no [data-rc-scroll]).${failures.length ? ' pageerrors: ' + failures.join(' | ') : ''}`,
    );
  });
  await tagScreenElement(page);
  await settleFrozen(page);
  await page.waitForTimeout(600); // fonts + first paint settle
  return page;
}

/**
 * The prototype renders inside a phone-bezel mockup. Tag the inner "screen" element (the
 * `width:390px; border-radius:52px; overflow:hidden` div that also declares the `--rc-*` custom
 * properties) so captures can clip to it and drop the bezel.
 */
async function tagScreenElement(page: Page): Promise<void> {
  const tagged = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll<HTMLElement>('div')).find((d) => {
      const cs = getComputedStyle(d);
      return (
        cs.borderTopLeftRadius === '52px' &&
        cs.overflow === 'hidden' &&
        Math.round(d.getBoundingClientRect().width) === 390
      );
    });
    if (el) {
      el.id = '__df_screen';
      return true;
    }
    return false;
  });
  if (!tagged) throw new Error('prototype: could not locate the phone-screen element to clip to');
  await page.waitForSelector('#__df_screen', { timeout: 5_000 });
}

export const SCREEN_CLIP = '#__df_screen';

/** Reload to the default state (cheaper and more reliable than unwinding overlays). Theme sticks
 *  because the HTML route stays installed. */
export async function resetPrototype(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-rc-scroll]', { timeout: 15_000 });
  await tagScreenElement(page);
  await settleFrozen(page);
  await page.waitForTimeout(600);
}

export interface Capture {
  body: Buffer;
  /** The bottom-nav strip, when `screen.capturesNav` is set. */
  nav?: Buffer;
}

export async function captureScreen(page: Page, screen: ScreenDef): Promise<Capture> {
  await screen.driveProto(page);
  await page.waitForTimeout(250);
  const opts = { animations: 'disabled', caret: 'hide' } as const;
  const body = await page.screenshot({ clip: await contentRegion(page, 'prototype', screen.anchor), ...opts });
  const nav = screen.capturesNav ? await page.screenshot({ clip: await navRegion(page, 'prototype'), ...opts }) : undefined;
  return { body, nav };
}
