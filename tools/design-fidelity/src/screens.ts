import type { Page } from 'playwright-core';
import type { Anchor } from './region.js';

export type Theme = 'dark' | 'light';

/** A rectangle in capture CSS px (the header-to-nav band, ~390 × 729), scaled by the device
 *  pixel ratio when applied to a PNG. `y` is relative to the top of the captured region (the
 *  RapidClash wordmark row), not the viewport. */
export interface MaskRect {
  x: number;
  y: number;
  w: number;
  h: number;
  reason: string;
}

// `masks` (below) excludes Designer-said-carried-over regions from the diff. The games-hero
// banner was the first, but the `catrail` anchor now crops it out of the captured region
// entirely, so no MaskRect is currently in use — the mechanism stays for the next one.

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
  /** Which fixed landmark to anchor the capture on. Default `header`; the games screens use
   *  `catrail` because the carried-over banner above the rail differs in height between the
   *  prototype and the real app. */
  anchor?: Anchor;
  /** Also capture + diff the bottom-nav strip in isolation (`<screen>.nav.png`). The nav is
   *  shared chrome, so one screen carrying this is enough coverage for it. */
  capturesNav?: boolean;
  /** Below-the-fold coverage (Designer Q3): capture the whole scrollable content as
   *  `<screen>.frame0.png`, `.frame1.png`, … instead of just the above-the-fold `body` shot. Set
   *  this on screens taller than one viewport (Rewards, Account) — see `scroll.ts`. */
  scrollFrames?: boolean;
}

/** Bottom-nav helpers, shared across screens. The nav items are `<div role="button">` with a
 *  `<span>` label ("Menu" / "Games" / "Account" / "Rewards" / "Chat"). */
export async function navTo(page: Page, label: 'Games' | 'Rewards' | 'Account' | 'Menu' | 'Chat'): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).last().click();
  await page.waitForTimeout(250);
}

/**
 * Open one of the prototype's three not-yet-finished-until-T5/T6 games (Mines/RPS/Dice) by
 * clicking its actual grid tile — `openGame(k)` (the prototype's real view-transition handler,
 * `Full Spec.html`'s `IMGS` map) fires on `onClick="{{ g.open }}"`, not on any text match: the
 * tiles are plain `background-image` divs with no text content, so a text-based selector finds
 * nothing (this is exactly what caused the "no design source exists" false alarm — investigate
 * by driving the actual click, not by grepping for text). `needle` is the `IMGS[k]` filename
 * fragment (`game-mines` / `game-rps` / `game-dice`).
 */
export async function openGameTile(page: Page, needle: string): Promise<void> {
  const clicked = await page.evaluate((n: string) => {
    const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-rc-grid] > div'));
    const tile = tiles.find((t) => (t.style.backgroundImage || '').includes(n));
    if (tile) {
      tile.click();
      return true;
    }
    return false;
  }, needle);
  if (!clicked) throw new Error(`design-fidelity: prototype grid tile matching "${needle}" not found`);
  // openGame(k) itself just flips `view` to the idle pre-match state (bet ladder + PLAY, dimmed
  // board) — no match search starts until PLAY is pressed (that's what fires `startDice`/etc.'s
  // searching→found→split sequence). No long wait needed here, just the render.
  await page.waitForTimeout(400);
}

/**
 * Arm the cheapest stake chip (`$1`, `data-rc-bettrack="1"`'s first child) then tap PLAY
 * (`data-nav="play"`, shared across Mines/RPS/Dice) — the two real preconditions `startRps`/
 * `startMines`/`startDice` check before a search can begin (`this.state.loggedIn` and
 * `this.state.minesBet`; the caller must already be signed in via `signIn` above). Ticket
 * 2026-09-15#9 (D16): needed to reach the `rpsMatch === 'searching'` state at all — none of the
 * existing idle screens press PLAY, they only open the tile (`openGameTile`'s own comment).
 */
export async function armStakeAndPlay(page: Page): Promise<void> {
  const chipClicked = await page.evaluate(() => {
    const chip = document.querySelector<HTMLElement>('[data-rc-bettrack="1"] div[role="button"]');
    if (chip) { chip.click(); return true; }
    return false;
  });
  if (!chipClicked) throw new Error('design-fidelity: prototype bet chip ([data-rc-bettrack="1"] div[role=button]) not found');
  await page.waitForTimeout(200);
  const playClicked = await page.evaluate(() => {
    const play = document.querySelector<HTMLElement>('[data-nav="play"]');
    if (play) { play.click(); return true; }
    return false;
  });
  if (!playClicked) throw new Error('design-fidelity: prototype PLAY button ([data-nav="play"]) not found');
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
    anchor: 'catrail',
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
  },
  {
    id: 'games-chance',
    anchor: 'catrail',
    title: 'Games list — CHANCE GAMES',
    legacyShot: '02-chance-games.png',
    driveProto: async (page) => {
      await page.getByText(/^CHANCE GAMES$/i).first().click();
      await page.waitForTimeout(300);
    },
    // Issue #465: the rebuilt HomeHub's 5-tab category rail (`home-cat-chance`).
    driveApp: async (page) => {
      await page.waitForSelector('[data-testid="home-hub"]', { timeout: 10_000 });
      await page.getByTestId('home-cat-chance').click();
      await page.waitForTimeout(300);
    },
  },
  {
    id: 'search-open',
    anchor: 'catrail',
    title: 'Search expanded',
    legacyShot: '03-search-open.png',
    driveProto: async (page) => {
      // The search magnifier is the <svg onClick={toggleSearch}> that shares the rounded pill
      // with the (initially pointer-events:none) input.
      await page.locator('div:has(> [data-rc-search]) > svg').first().click();
      await page.waitForTimeout(600); // expand animation
    },
    // Issue #465: the rebuilt HomeHub's SEARCH pill (`home-search-toggle`).
    driveApp: async (page) => {
      await page.waitForSelector('[data-testid="home-hub"]', { timeout: 10_000 });
      await page.getByTestId('home-search-toggle').click();
      await page.waitForTimeout(600); // expand transition (380ms in the app's own CSS)
    },
  },
  {
    id: 'sort-sheet',
    anchor: 'catrail',
    title: 'Sort sheet open',
    legacyShot: '04-sort-sheet.png',
    driveProto: async (page) => {
      await page.getByText(/^SORT$/i).first().click();
      await page.waitForTimeout(400);
    },
    // Issue #465: the rebuilt HomeHub's SORT sheet (`home-sort-toggle` → `home-sort-sheet`).
    driveApp: async (page) => {
      await page.waitForSelector('[data-testid="home-hub"]', { timeout: 10_000 });
      await page.getByTestId('home-sort-toggle').click();
      await page.waitForTimeout(400);
    },
  },
  {
    id: 'rewards',
    title: 'Rewards / VIP — signed out',
    legacyShot: '05-rewards.png',
    // Rewards is one of the long screens Designer Q3 asked for below-the-fold coverage on —
    // `contentRegion`'s single header-to-nav frame never reaches most of the VIP-tier content.
    scrollFrames: true,
    driveProto: async (page) => {
      await navTo(page, 'Rewards');
    },
    // Issue #498 (T3b heavy group): RewardsHub is now light-mode-correct and reachable, so this
    // gets a driveApp. Unlike the prototype (whose `isRewards` view renders signed-out too, with
    // the profile card blurred), the real app gates RewardsHub behind auth entirely — a
    // signed-out tap on the Rewards nav item opens `AuthModal`, not the hub (`App.tsx`'s
    // `onRewardsTap`). So this drives a REAL sign-up through that modal first (mirrors the
    // prototype module's own `signIn` helper above, but for the app's real `api.register` flow,
    // not the prototype's `submitAuth` no-op): tap Rewards (signed out) → opens the auth modal →
    // fill a freshly-minted, run-unique username/password so repeat harness runs never collide on
    // "already taken" → submit → wait for the modal to close → tap Rewards again, now signed in,
    // which actually navigates (`onOpenRewards` → `goToRewards`). The resulting capture is a
    // real signed-in Rewards state (unranked, all locked-tier cards) rather than the prototype's
    // signed-out/blurred one — an expected, not a defect, mismatch; see the harness README's
    // fidelity-numbers caveat and the #498 PR description for the actual before/after numbers.
    driveApp: async (page) => {
      await page.waitForSelector('[data-testid="home-hub"]', { timeout: 10_000 });
      await page.getByTestId('hub-nav-rewards').click();
      await page.waitForSelector('[data-testid="auth-modal"]', { timeout: 8_000 });
      const username = `df${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
      await page.getByLabel('Username').fill(username);
      await page.getByLabel('Password').fill('design-fidelity-pass');
      await page.getByTestId('auth-submit').click();
      await page.waitForSelector('[data-testid="auth-modal"]', { state: 'hidden', timeout: 10_000 });
      await page.getByTestId('hub-nav-rewards').click();
      await page.waitForSelector('[data-testid="rewards-hub"]', { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    id: 'account-login-sheet',
    title: 'Account — login sheet (signed out)',
    legacyShot: '06-account-login-sheet.png',
    // Header-anchored (default) — this is the harness's HubRibbon coverage. capturesNav adds
    // the bottom-nav strip (shared chrome; one screen carrying it is enough).
    capturesNav: true,
    driveProto: async (page) => {
      await navTo(page, 'Account');
    },
    driveApp: async (page) => {
      await page.waitForSelector('[data-testid="home-hub"]', { timeout: 10_000 });
      await page.getByTestId('hub-nav-account').click();
      await page.waitForSelector('[data-testid="auth-modal"]', { timeout: 8_000 });
      await page.waitForTimeout(400);
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
  {
    id: 'mines-idle',
    title: 'Mines — idle (pre-match), signed out',
    // T7 (the Mines *engine* — board size, mechanic changes) is still blocked on the Designer's
    // answers (see NEW_DESIGN_MIGRATION.md). This screen only verifies the T6-family *visual*
    // work already shipped (the shared VS-label + per-game idle-preview boards); it will need
    // re-capturing once T7 lands and the board itself changes shape.
    driveProto: async (page) => {
      await openGameTile(page, 'game-mines');
    },
    // Wait on `hub-play` (GameHub's own PLAY button, GameHub.tsx:641/937), not `hub-board` —
    // that testid is only on each game's LIVE in-match component (MinesBoard/RpsBoard); the
    // idle-preview component (MinesIdle/RpsIdle) carries no testid of its own. `hub-play` is
    // shared GameHub chrome present in idle/waiting for every game, Mines/RPS/Dice included.
    driveApp: async (page) => {
      await page.waitForSelector('[data-testid="home-hub"]', { timeout: 10_000 });
      await page.getByTestId('home-tile-mines').click();
      await page.waitForSelector('[data-testid="hub-play"]', { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    id: 'rps-idle',
    title: 'RPS — idle (pre-match), signed out',
    driveProto: async (page) => {
      await openGameTile(page, 'game-rps');
    },
    // Issue T6b: RpsHub's idle preview now shows the real dimmed picker tiles (was a placeholder).
    // `hub-play`, not `hub-board` — see the mines-idle comment above for why.
    driveApp: async (page) => {
      await page.waitForSelector('[data-testid="home-hub"]', { timeout: 10_000 });
      await page.getByTestId('home-tile-rps').click();
      await page.waitForSelector('[data-testid="hub-play"]', { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    id: 'rps-searching',
    title: 'RPS — matchmaking search (blurred/scrambling opponent bar), signed in',
    // Ticket 2026-09-15#9 (D16): Designer's own closing ask — this state wasn't in the eight
    // screenshots the harness already had. `startRps` (`Full Spec.html:3291`) sets
    // `rpsMatch:'searching'` synchronously on PLAY (blur + the 70ms name/avatar scramble start
    // immediately, not after the 680ms the ticket text describes — that 680ms is the first leg of
    // the nested setTimeout delaying the 'found' transition, 680+1700=2380ms total) and holds it
    // until 'found' fires at that 2380ms mark. Captured well inside that window (armFreeze pins
    // `Math.random`, so the scramble's own random picks are deterministic — the same reproducible
    // frame every run, not a race against the live timers).
    signedIn: true,
    driveProto: async (page) => {
      await signIn(page);
      await openGameTile(page, 'game-rps');
      await armStakeAndPlay(page);
      await page.waitForTimeout(500); // inside the 0–2380ms searching window, comfortably clear of 'found'
    },
  },
  {
    id: 'dice-idle',
    title: 'Dice — idle (pre-match), signed out',
    driveProto: async (page) => {
      await openGameTile(page, 'game-dice');
    },
    // Issue T6a: DiceHub's idle preview now shows dimmed roll-gauge tracks (was a plain 🎲 + caption).
    driveApp: async (page) => {
      await page.waitForSelector('[data-testid="home-hub"]', { timeout: 10_000 });
      await page.getByTestId('home-tile-dice').click();
      await page.waitForSelector('[data-testid="hub-board"]', { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
  },
];

export function screenById(id: string): ScreenDef {
  const s = SCREENS.find((x) => x.id === id);
  if (!s) throw new Error(`design-fidelity: unknown screen "${id}". Known: ${SCREENS.map((x) => x.id).join(', ')}`);
  return s;
}
