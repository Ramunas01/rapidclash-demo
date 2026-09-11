import type { Browser, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import { armFreeze, settleFrozen } from './freeze.js';
import type { Capture } from './prototype.js';
import { contentRegion, navRegion } from './region.js';
import { captureScrollFrames } from './scroll.js';
import { chromeExecutable, DEVICE_SCALE_FACTOR, VIEWPORT } from './paths.js';
import type { ScreenDef, Theme } from './screens.js';

/**
 * The app side of the diff. Unlike the prototype (a single static file we serve ourselves), the
 * built app needs its stack running — this connects to whatever is already serving it.
 *
 *   pnpm --filter @rapidclash/server build && node apps/server/dist/index.js   # :3000
 *   pnpm --filter @rapidclash/web build && pnpm --filter @rapidclash/web preview --port 4173
 *   pnpm --filter @rapidclash/design-fidelity capture-app -- --url http://localhost:4173
 *
 * or point DESIGN_FIDELITY_APP_URL at a deployed preview.
 */
export function appBaseUrl(cliUrl?: string): string {
  const url = cliUrl || process.env.DESIGN_FIDELITY_APP_URL;
  if (!url) {
    throw new Error(
      'design-fidelity: no app URL. Pass --url <http://…> or set DESIGN_FIDELITY_APP_URL, with the web app already served there.',
    );
  }
  return url.replace(/\/$/, '');
}

export async function launchApp(): Promise<Browser> {
  return chromium.launch({ executablePath: chromeExecutable(), headless: true });
}

/** Open the built app at `baseUrl` in the given theme and wait for it to render. */
export async function openApp(browser: Browser, baseUrl: string, theme: Theme): Promise<Page> {
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    colorScheme: theme === 'light' ? 'light' : 'dark',
  });
  await page.addInitScript((t: string) => {
    try {
      // Issue #491: this used to write 'rc-theme' — a guessed key that never matched the real
      // app. `lib/theme.ts`'s STORAGE_KEY (the single source of truth since issue #472) is
      // `rc_pref_theme`, and it only recognizes the literal values 'light'/'system' — anything
      // else (including the never-matched key's absence) falls back to 'dark'. So every
      // "light" app capture taken before this fix was silently still dark — confirmed live
      // while manually verifying #491 (the captured "light" games-originals.png showed the
      // same black background as the dark capture).
      localStorage.setItem('rc_pref_theme', t);
    } catch {
      /* private mode */
    }
  }, theme);
  await armFreeze(page);
  await page.goto(baseUrl, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForSelector('[data-testid="home-hub"], #root > *', { timeout: 15_000 });
  await settleFrozen(page);
  await page.waitForTimeout(600);
  return page;
}

/**
 * Capture one screen from the built app. Each `ScreenDef` supplies an optional `driveApp`
 * (mirroring `driveProto` but for our own testid-based DOM); screens without one yet are skipped
 * with a clear message rather than producing a misleading capture.
 */
export async function captureAppScreen(page: Page, screen: ScreenDef): Promise<Capture> {
  if (!screen.driveApp) {
    throw new Error(`no driveApp for "${screen.id}" yet — add one to src/screens.ts as that screen is rebuilt`);
  }
  await screen.driveApp(page);
  // A `driveApp` that clicks a below-the-fold element (e.g. a game tile deep in the grid) has
  // Playwright auto-scroll it into view first; the app's own client-side navigation does not
  // reset that scroll position, so the still-scrolled viewport can silently clip the wrong slice
  // of the new screen (confirmed while adding mines/rps/dice-idle — the capture skipped straight
  // past the opponent bar into content that only exists ~450px down the page). Reset here, once,
  // for every screen, rather than trusting each driveApp to remember to do it itself.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const opts = { animations: 'disabled', caret: 'hide' } as const;
  const body = await page.screenshot({ clip: await contentRegion(page, 'app', screen.anchor), ...opts });
  const nav = screen.capturesNav ? await page.screenshot({ clip: await navRegion(page, 'app'), ...opts }) : undefined;
  const frames = screen.scrollFrames ? await captureScrollFrames(page, 'app') : undefined;
  return { body, nav, frames };
}
