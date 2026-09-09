import type { Page } from 'playwright-core';

export type Theme = 'dark' | 'light';

/** A rectangle in capture CSS px (the 390-wide × 732-tall clipped space), scaled by the device
 *  pixel ratio when applied to a PNG. */
export interface MaskRect {
  x: number;
  y: number;
  w: number;
  h: number;
  reason: string;
}

/**
 * Regions the Designer said to carry over from production unchanged (Q5, 2026-09-09) — the
 * games-hero banner carousel is the first. Masked in both images before diffing so a rebuild
 * doesn't fail the gate on a difference we chose on purpose. Measured from the running prototype.
 */
export const BANNER_MASK: MaskRect = { x: 12, y: 72, w: 366, h: 156, reason: 'carousel banner — carried over, Designer Q5' };

/**
 * The screen catalogue. Each entry knows how to drive the prototype (and, later, the built app)
 * into one specific state, starting from a freshly-loaded page in the default state
 * (`view: 'games'`, ORIGINALS tab, signed out, no overlays).
 *
 * `driveProto` runs against the prototype DOM. Selectors lean on the prototype's own
 * `data-rc-*` hooks and visible text — the dc-runtime does not expose its logic instance,
 * so every transition is a real click/interaction, same as a user.
 */
export interface ScreenDef {
  id: string;
  /** Human label for the report. */
  title: string;
  /** Matches the README's own screenshot list where one exists. */
  legacyShot?: string;
  /** Whether this state requires a signed-in session. */
  signedIn?: boolean;
  /** Drive the prototype (`design/prototype/RapidClash Full Spec.html`) into this state. */
  driveProto: (page: Page) => Promise<void>;
  /** Drive the built app into this state. Added per screen as it's rebuilt; absent = skipped. */
  driveApp?: (page: Page) => Promise<void>;
  /** Regions excluded from the diff (carried-over-from-production areas). */
  masks?: MaskRect[];
}

/** Bottom-nav helpers, shared across screens. The nav items are `<div role="button">` with a
 *  `<span>` label ("Menu" / "Games" / "Account" / "Rewards" / "Chat"). */
export async function navTo(page: Page, label: 'Games' | 'Rewards' | 'Account' | 'Menu' | 'Chat'): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).last().click();
  await page.waitForTimeout(250);
}

/**
 * Sign in through the auth sheet. `submitAuth` in the prototype just sets `loggedIn: true`
 * unconditionally and closes the sheet — no validation — so we fill the fields for realism
 * then submit via the button next to the password input.
 */
export async function signIn(page: Page): Promise<void> {
  await navTo(page, 'Account'); // opens the login sheet when signed out
  await page.getByPlaceholder('Enter username').fill('DemoDirector');
  await page.getByPlaceholder('Enter password').fill('demo-pass');
  await page
    .locator('input[placeholder="Enter password"]')
    .locator('xpath=following::*[@role="button"][1]')
    .click();
  // submitAuth fires a "LOGGED IN" toast — wait for it to clear so it doesn't bleed into captures.
  await page.getByText('LOGGED IN', { exact: true }).waitFor({ state: 'hidden', timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

export const SCREENS: ScreenDef[] = [
  {
    id: 'games-originals',
    title: 'Games list — ORIGINALS',
    legacyShot: '01-games-originals.png',
    driveProto: async () => {
      /* default state — nothing to do */
    },
    // The current HomeHub is the pre-redesign screen; this captures its starting fidelity.
    driveApp: async (page) => {
      await page.waitForSelector('[data-testid="home-hub"]', { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
    masks: [BANNER_MASK],
  },
  {
    id: 'games-chance',
    title: 'Games list — CHANCE GAMES',
    legacyShot: '02-chance-games.png',
    driveProto: async (page) => {
      await page.getByText(/^CHANCE GAMES$/i).first().click();
      await page.waitForTimeout(300);
    },
    masks: [BANNER_MASK],
  },
  {
    id: 'search-open',
    title: 'Search expanded',
    legacyShot: '03-search-open.png',
    driveProto: async (page) => {
      // The search magnifier is the <svg onClick={toggleSearch}> that shares the rounded pill
      // with the (initially pointer-events:none) input.
      await page.locator('div:has(> [data-rc-search]) > svg').first().click();
      await page.waitForTimeout(600); // expand animation
    },
    masks: [BANNER_MASK],
  },
  {
    id: 'sort-sheet',
    title: 'Sort sheet open',
    legacyShot: '04-sort-sheet.png',
    masks: [BANNER_MASK],
    driveProto: async (page) => {
      await page.getByText(/^SORT$/i).first().click();
      await page.waitForTimeout(400);
    },
  },
  {
    id: 'rewards',
    title: 'Rewards / VIP — signed out',
    legacyShot: '05-rewards.png',
    driveProto: async (page) => {
      await navTo(page, 'Rewards');
    },
  },
  {
    id: 'account-login-sheet',
    title: 'Account — login sheet (signed out)',
    legacyShot: '06-account-login-sheet.png',
    driveProto: async (page) => {
      await navTo(page, 'Account');
    },
  },
  {
    id: 'menu',
    title: 'Menu overlay',
    legacyShot: '07-menu.png',
    driveProto: async (page) => {
      await navTo(page, 'Menu');
    },
  },
  {
    id: 'account-signed-in',
    title: 'Account — signed in',
    legacyShot: '09-account-signed-in.png',
    signedIn: true,
    driveProto: async (page) => {
      await signIn(page);
      await navTo(page, 'Account');
    },
  },
];

export function screenById(id: string): ScreenDef {
  const s = SCREENS.find((x) => x.id === id);
  if (!s) throw new Error(`design-fidelity: unknown screen "${id}". Known: ${SCREENS.map((x) => x.id).join(', ')}`);
  return s;
}
