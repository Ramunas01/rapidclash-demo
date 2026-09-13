// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { HomeHubScreen } from '../screens/HomeHub.js';
import type { GameMeta, OpenChallenge } from '@rapidclash/shared';

type Props = Parameters<typeof HomeHubScreen>[0];

const META = (id: string, displayName: string): GameMeta => ({
  id, displayName, minPlayers: 2, maxPlayers: 2,
  ranking: { kind: 'net_winnings' }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 10, rakeRate: 0.025,
});

// /games returns the live PvP set; leaderboard/wallet return their shapes.
const GAMES: GameMeta[] = [META('coinflip', 'Coinflip'), META('chess', 'Chess'), META('mines', 'Mines')];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok',
    balance: 1000,
    challengesByGame: {},
    onTrackChallenges: vi.fn(),
    onUntrackChallenges: vi.fn(),
    onTakeChallenge: vi.fn(),
    onSelectGame: vi.fn(),
    onOpenWallet: vi.fn(),
    onOpenRewards: vi.fn(),
    onOpenAffiliate: vi.fn(),
    onHome: vi.fn(),
    ...over,
  };
}

const challenge = (matchId: string, ownerName: string, stake: number, openedAt: number): OpenChallenge => ({
  matchId, ownerName, ownerTier: 'Unranked', stake, openedAt, expiresAt: Date.now() + 30_000, timeControlId: 'none',
});

describe('HomeHubScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games/popularity')) return { ok: true, json: async () => ({}) } as Response;
      if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders PvP games as playable tiles and house games as inert "coming soon"', async () => {
    const onSelectGame = vi.fn();
    render(<HomeHubScreen {...baseProps({ onSelectGame })} />);

    // Playable: data-driven from /games.
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();
    expect(screen.getByTestId('home-tile-mines')).toBeInTheDocument();
    // Tapping a playable tile routes to that game's flow.
    fireEvent.click(screen.getByTestId('home-tile-coinflip'));
    expect(onSelectGame).toHaveBeenCalledWith(expect.objectContaining({ id: 'coinflip' }));

    // Breadth (not-yet-live) games render as coming-soon with NO play handler (a div, not a button).
    const baccarat = screen.getByTestId('home-coming-soon-baccarat');
    expect(baccarat).toBeInTheDocument();
    expect(baccarat.tagName).not.toBe('BUTTON');
    expect(screen.getByTestId('home-coming-soon-roulette')).toBeInTheDocument();
    // A coming-soon game is never a playable tile.
    expect(screen.queryByTestId('home-tile-baccarat')).toBeNull();
  });

  it('subscribes to every game feed for the cross-game ticker once games load', async () => {
    const onTrackChallenges = vi.fn();
    render(<HomeHubScreen {...baseProps({ onTrackChallenges })} />);
    await waitFor(() => expect(onTrackChallenges).toHaveBeenCalled());
    expect(onTrackChallenges).toHaveBeenCalledWith(['coinflip', 'chess', 'mines']);
  });

  it('the Games-page carousel (#305) merges per-game feeds and JOIN takes the real challenge', async () => {
    const onTakeChallenge = vi.fn();
    const challengesByGame = {
      coinflip: [challenge('c1', 'alice', 5, 100)],
      mines: [challenge('m1', 'bob', 25, 50)],
    };
    render(<HomeHubScreen {...baseProps({ challengesByGame, onTakeChallenge })} />);

    // Both games' challenges appear in the one carousel (real data, not fabricated) — rows are
    // keyed by the carousel's own synthetic uid (the pool can wrap when smaller than the 11-row
    // window), so look them up by the real `data-match-id` instead of a row testid.
    const carousel = within(screen.getByTestId('games-carousel'));
    const c1Row = document.querySelector('[data-match-id="c1"]') as HTMLElement;
    const m1Row = document.querySelector('[data-match-id="m1"]') as HTMLElement;
    expect(c1Row).toBeInTheDocument();
    expect(m1Row).toBeInTheDocument();
    // registered (default loggedIn: true) → the Owner-approved $ skin, 2026-09-11#8 item B.2
    expect(within(c1Row).getByText('$5')).toBeInTheDocument();
    expect(within(m1Row).getByText('$25')).toBeInTheDocument();
    await waitFor(() => expect(within(m1Row).getByText('Mines')).toBeInTheDocument());
    expect(carousel.getByTestId('games-carousel-live').textContent).toContain('2 LIVE');

    fireEvent.click(within(c1Row).getByTestId(/^games-carousel-join-/));
    expect(onTakeChallenge).toHaveBeenCalledWith('c1');
  });

  it('JOIN refuses clearly when the stake is uncovered, without taking', () => {
    const onTakeChallenge = vi.fn();
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 50, 100)] };
    render(<HomeHubScreen {...baseProps({ balance: 5, challengesByGame, onTakeChallenge })} />);
    const c1Row = document.querySelector('[data-match-id="c1"]') as HTMLElement;
    fireEvent.click(within(c1Row).getByTestId(/^games-carousel-join-/));
    expect(onTakeChallenge).not.toHaveBeenCalled();
    expect(screen.getByTestId('games-carousel-notice').textContent).toMatch(/not enough/i);
  });

  it('2026-09-11#8 item B.2: registered users see the Owner-approved $ skin in the GamesCarousel too, not just the header wallet chip (CHARTER.md #4)', async () => {
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)] };
    const { container } = render(<HomeHubScreen {...baseProps({ challengesByGame })} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).toMatch(/\$/);
  });

  it('2026-09-11#8 item B.2: logged-out visitors keep the play-money RcIcon display in the GamesCarousel — no $ leaks in for the public/unregistered audience', async () => {
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)] };
    const { container } = render(<HomeHubScreen {...baseProps({ challengesByGame, loggedIn: false, token: '' })} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).not.toMatch(/\$/);
  });

  it('renders the shared footer (#323) wired to Games/Rewards, no $ anywhere', async () => {
    const onHome = vi.fn();
    const onOpenRewards = vi.fn();
    render(<HomeHubScreen {...baseProps({ onHome, onOpenRewards })} />);
    const footer = await screen.findByTestId('home-footer');
    expect(within(footer).getByTestId('home-social-discord')).toBeInTheDocument();
    expect(within(footer).getByTestId('home-social-instagram')).toBeInTheDocument();
    expect(footer).toHaveTextContent(/18\+/);
    expect(footer.textContent ?? '').not.toMatch(/\$/);

    fireEvent.click(within(footer).getByText('Games'));
    expect(onHome).toHaveBeenCalled();
    fireEvent.click(within(footer).getByText('Rewards/VIP'));
    expect(onOpenRewards).toHaveBeenCalled();
  });

  // Issue #337: the footer must sit OUTSIDE the gapped `flex flex-col gap-6` content div (a
  // sibling, directly under <main>), not as its last gapped child — otherwise the parent's own
  // gap stacks on top of the gradient's margin, producing a page-specific black band. This is the
  // one thing jsdom (no real layout engine) CAN verify: DOM structure. It cannot verify the
  // actual rendered pixel gap — that needs a real browser, out of scope for this suite.
  it('renders the footer as a sibling of the gapped content div, directly under <main> (#337)', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    const main = screen.getByTestId('home-hub');
    const footer = await screen.findByTestId('home-footer');
    expect(footer.parentElement).toBe(main);
    // The gapped div (gap-6) is a previous sibling, not an ancestor, of the footer.
    const gappedDiv = main.querySelector('.gap-6');
    expect(gappedDiv).not.toBeNull();
    expect(gappedDiv?.contains(footer)).toBe(false);
  });

  // Issue #342: the content div no longer needs HUB_BODY's toolbar-clearance padding — the
  // footer now reserves that space itself (see HubFooter.test.tsx), so keeping it here would
  // just be dead space between the content and the now-sibling footer.
  it('no longer carries the HUB_BODY toolbar-clearance padding on the content div (#342)', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    const main = screen.getByTestId('home-hub');
    await screen.findByTestId('home-footer');
    const gappedDiv = main.querySelector('.gap-6');
    expect(gappedDiv).not.toBeNull();
    expect(gappedDiv?.className).not.toMatch(/pb-\[calc/);
  });
});

// #301 — Bring a Rival: Designer banner replacement + copy-link action. The banner is the
// Designer's export copied byte-for-byte (docs/COMMS/from-advisor/bring-a-rival-banner.md) —
// verbatim inline hex per spec, so (unlike the rest of the app) this is NOT tested for
// token-only styling; that assertion belonged to the old markup and is gone on purpose.
describe('HomeHubScreen — Bring a Rival banner (#301)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => [] } as Response;
      if (u.includes('/games/popularity')) return { ok: true, json: async () => ({}) } as Response;
      if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  function cta(): HTMLElement {
    const rival = screen.getByTestId('home-rival');
    const el = rival.querySelector('#bring-a-rival-cta');
    if (!el) throw new Error('#bring-a-rival-cta not found');
    return el as HTMLElement;
  }

  it('renders the Designer export copy — heading, subline, CTA label — and none of the old copy', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    const rival = screen.getByTestId('home-rival');
    expect(within(rival).getAllByText('Bring a rival').length).toBeGreaterThanOrEqual(2); // heading + CTA label
    expect(rival.textContent).toContain('RapidClash is all about real');
    expect(rival.textContent).toContain('opponents. Send this to whoever');
    expect(rival.textContent).toContain('you want to take money from first.');
    // Old copy fully gone.
    expect(rival.textContent ?? '').not.toMatch(/send a match link/i);
    expect(rival.textContent ?? '').not.toMatch(/challenge a friend/i);
    expect(screen.queryByText(/send a match link/i)).toBeNull();
  });

  it('the CTA is a plain, non-focusable <div> — verbatim as exported, no role/tabIndex added (Owner-confirmed, issue #301)', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    const el = cta();
    expect(el.tagName).toBe('DIV');
    expect(el).not.toHaveAttribute('role');
    expect(el).not.toHaveAttribute('tabindex');
  });

  it('tap copies https://rapidclash.com to the clipboard and shows the success toast', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<HomeHubScreen {...baseProps()} />);
    fireEvent.click(cta());
    expect(writeText).toHaveBeenCalledWith('https://rapidclash.com');
    expect(await screen.findByText('Link copied to clipboard')).toBeInTheDocument();
  });

  it('falls back to the copy-failed toast when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<HomeHubScreen {...baseProps()} />);
    fireEvent.click(cta());
    expect(await screen.findByText('Copy failed — link: rapidclash.com')).toBeInTheDocument();
  });

  it('a second tap resets the toast instead of stacking a new one', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<HomeHubScreen {...baseProps()} />);
    fireEvent.click(cta());
    await screen.findByText('Link copied to clipboard');
    fireEvent.click(cta());
    await waitFor(() => {
      expect(screen.getAllByText('Link copied to clipboard')).toHaveLength(1);
    });
  });
});

describe('HomeHubScreen — no-art game handling (#148)', () => {
  // A live roster including Limbo, whose art was approved in #148 — it must render as designed
  // art, never the gradient-name fallback.
  const GAMES_148: GameMeta[] = [
    META('coinflip', 'Coinflip'), META('limbo', 'Limbo'),
  ];
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => [] } as Response;
      if (u.includes('/games/popularity')) return { ok: true, json: async () => ({}) } as Response;
      if (u.includes('/games')) return { ok: true, json: async () => GAMES_148 } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Limbo renders as a playable tile with its art (not the gradient-name fallback)', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    const tile = await screen.findByTestId('home-tile-limbo');
    // The designed art renders as an <img>; the fallback would be a gradient div with the name text.
    expect(tile.querySelector('img')).not.toBeNull();
    expect(within(tile).queryByText('Limbo')).toBeNull();
    // It's never the coming-soon variant — Limbo is live.
    expect(screen.queryByTestId('home-coming-soon-limbo')).toBeNull();
  });

  it('every live game is tracked for the cross-game challenge ticker', async () => {
    const onTrackChallenges = vi.fn();
    render(<HomeHubScreen {...baseProps({ onTrackChallenges })} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    await waitFor(() => expect(onTrackChallenges).toHaveBeenCalled());
    expect(onTrackChallenges).toHaveBeenCalledWith(expect.arrayContaining(['coinflip', 'limbo']));
  });
});

describe('HomeHubScreen (logged out)', () => {
  // A public open-challenge as returned by GET /open-challenges (carries gameId).
  const pub = (matchId: string, gameId: string, ownerName: string, stake: number) => ({
    matchId, gameId, ownerName, ownerTier: 'Unranked' as const, stake, openedAt: 100, expiresAt: Date.now() + 30_000, timeControlId: 'none',
  });
  // Default mock: public endpoints succeed; the open-challenges snapshot is empty unless overridden.
  function stubFetch(openChallenges: unknown[] = []) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => openChallenges } as Response;
      if (u.includes('/games/popularity')) return { ok: true, json: async () => ({}) } as Response;
      if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  }
  beforeEach(() => stubFetch());
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('browses the grid via public /games; the wallet chip is "Sign in"; the carousel is the live public feed', async () => {
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '' })} />);
    // The game grid still renders (public endpoint) so a visitor can browse.
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    // No fake balance — the chip is a "Sign in" affordance.
    expect(screen.getByTestId('hub-signin-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull();
    // The Games-page carousel (#305) is the REAL public feed (no WS subscription).
    expect(screen.getByTestId('games-carousel')).toBeInTheDocument();
  });

  it('renders real public challenges; JOIN captures the row\'s game + stake (for the auth wall)', async () => {
    stubFetch([pub('p1', 'coinflip', 'zed', 15), pub('p2', 'mines', 'max', 40)]);
    const onTakePublicChallenge = vi.fn();
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '', onTakePublicChallenge })} />);

    // Real rows from GET /open-challenges (never fabricated).
    await waitFor(() => expect(document.querySelector('[data-match-id="p1"]')).toBeInTheDocument());
    const p1Row = document.querySelector('[data-match-id="p1"]') as HTMLElement;
    // Ticket 2026-09-13#6 item 2: every row (logged in or out) now shows a $-prefixed amount.
    expect(within(p1Row).getByText('$15')).toBeInTheDocument();
    expect(document.querySelector('[data-match-id="p2"]')).toBeInTheDocument();

    // A JOIN tap passes the row's matchId + gameId + stake so the auth wall can resume the take.
    fireEvent.click(within(p1Row).getByTestId(/^games-carousel-join-/));
    expect(onTakePublicChallenge).toHaveBeenCalledWith({ matchId: 'p1', gameId: 'coinflip', stake: 15 });
  });

  it('re-polls GET /open-challenges so the feed visibly moves', async () => {
    vi.useFakeTimers();
    stubFetch([pub('p1', 'coinflip', 'zed', 15)]);
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '' })} />);

    const calls = () => (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((c) => String(c[0])).filter((u) => u.includes('/open-challenges')).length;

    await vi.advanceTimersByTimeAsync(0); // flush the mount fetch
    const afterMount = calls();
    expect(afterMount).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(4_100); // one poll interval later
    expect(calls()).toBeGreaterThan(afterMount);
  });

  it('does not fetch the wallet or subscribe to WS feeds while logged out', async () => {
    const onTrackChallenges = vi.fn();
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '', onTrackChallenges })} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    expect(onTrackChallenges).not.toHaveBeenCalled(); // the WS feed is auth-only
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/wallet'))).toBe(false); // wallet is auth-only
    expect(urls.some((u) => u.includes('/open-challenges'))).toBe(true); // the public read IS used
  });

  it('the wallet chip sign-in affordance invokes the sign-in handler', async () => {
    const onOpenWallet = vi.fn();
    render(<HomeHubScreen {...baseProps({ loggedIn: false, token: '', onOpenWallet })} />);
    await waitFor(() => expect(screen.getByTestId('hub-signin-chip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('hub-signin-chip'));
    expect(onOpenWallet).toHaveBeenCalledTimes(1);
  });
});

// Full 12-game roster (issue #465) — used by the category/search/sort/random tests below, which
// need the real many-to-many membership to exercise properly (a 3-game roster can't show a game
// appearing in more than one non-ORIGINALS category).
const ALL_12: GameMeta[] = [
  META('coinflip', 'Coinflip'), META('blackjack', 'Blackjack'), META('chess', 'Chess'),
  META('mines', 'Mines'), META('rps', 'Rock Paper Scissors'), META('crash', 'Crash'),
  META('dice', 'Dice'), META('roulette', 'Roulette'), META('hilo', 'Hilo'),
  META('keno', 'Keno'), META('baccarat', 'Baccarat'), META('limbo', 'Limbo'),
];

function tileOrder(): string[] {
  return Array.from(document.querySelectorAll('[data-testid^="home-tile-"]'))
    .map((el) => el.getAttribute('data-testid')!.replace('home-tile-', ''));
}

describe('HomeHubScreen — category rail, SEARCH, SORT, RANDOM (issue #465)', () => {
  function stubFetch(popularity: Record<string, number> = {}) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => [] } as Response;
      if (u.includes('/games/popularity')) return { ok: true, json: async () => popularity } as Response;
      if (u.includes('/games')) return { ok: true, json: async () => ALL_12 } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  }
  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it('renders exactly 5 category tabs, ORIGINALS selected by default', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    // Scoped by testid prefix, not role="tab" — GamesCarousel's own OPEN GAMES/24H RACE/… rail
    // further down the page also uses role="tab", so a bare getAllByRole would over-match.
    const tabs = document.querySelectorAll('[data-testid^="home-cat-"]');
    expect(tabs).toHaveLength(5);
    expect(screen.getByTestId('home-cat-originals').getAttribute('aria-selected')).toBe('true');
    for (const id of ['card', 'chance', 'skill', 'events']) {
      expect(screen.getByTestId(`home-cat-${id}`).getAttribute('aria-selected')).toBe('false');
    }
  });

  it('Ticket 2026-09-13#1 §1: every tile — selected or not — shares the same background treatment (no bg-brand tint)', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    const selected = screen.getByTestId('home-cat-originals'); // active by default
    const unselected = screen.getByTestId('home-cat-card');
    expect(selected.className).not.toMatch(/bg-brand/);
    expect(unselected.className).not.toMatch(/bg-brand/);
    expect(selected.className).toContain('bg-surface');
    expect(unselected.className).toContain('bg-surface');
  });

  it('Ticket 2026-09-13#1 §1: every tile has the ledge box-shadow, unconditionally (selected and unselected alike)', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    const selected = screen.getByTestId('home-cat-originals');
    const unselected = screen.getByTestId('home-cat-card');
    // Dark by default (no light-theme toggle in this test) — Full Spec.html:186's dark value.
    expect(selected.style.boxShadow).toBe('0 7px 0 #1E1E33');
    expect(unselected.style.boxShadow).toBe('0 7px 0 #1E1E33');
  });

  it('Ticket 2026-09-13#1 §1: ORIGINALS icon renders at 29px, other tiles at 25px', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    const originalsIcon = screen.getByTestId('home-cat-originals').querySelector('svg');
    const cardIcon = screen.getByTestId('home-cat-card').querySelector('svg');
    expect(originalsIcon?.getAttribute('class')).toContain('h-[29px]');
    expect(originalsIcon?.getAttribute('class')).toContain('w-[29px]');
    expect(cardIcon?.getAttribute('class')).toContain('h-[25px]');
    expect(cardIcon?.getAttribute('class')).toContain('w-[25px]');
  });

  it('Ticket 2026-09-13#1 §2: rail edge fades exist and are scroll-driven, not fixed opacity', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    const left = screen.getByTestId('home-rail-fade-left');
    const right = screen.getByTestId('home-rail-fade-right');
    expect(left).toBeInTheDocument();
    expect(right).toBeInTheDocument();
    // At rest (no scroll yet): left fade invisible, right fade fully on — matches the prototype's
    // own initial state (Full Spec.html:3856-3857).
    expect(left.style.opacity).toBe('0');
    expect(right.style.opacity).toBe('1');

    const rail = screen.getByRole('tablist', { name: 'Game categories' });
    // maxScroll = scrollWidth - clientWidth = 48; scrollLeft = 12.
    // Formula (Full Spec.html:3861-3863): left = min(1, scrollLeft/24) = 0.5,
    // right = min(1, (max - scrollLeft)/24) = min(1, 36/24) = 1 (clamped).
    Object.defineProperty(rail, 'scrollWidth', { value: 148, configurable: true });
    Object.defineProperty(rail, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(rail, 'scrollLeft', { value: 12, configurable: true });
    fireEvent.scroll(rail);
    expect(left.style.opacity).toBe('0.5');
    expect(right.style.opacity).toBe('1');

    // Scroll further so the right-fade formula produces a value below the clamp (not just 1s and 0s).
    Object.defineProperty(rail, 'scrollLeft', { value: 30, configurable: true });
    fireEvent.scroll(rail);
    // left = min(1, 30/24) = 1 (clamped); right = min(1, (48-30)/24) = min(1, 0.75) = 0.75.
    expect(left.style.opacity).toBe('1');
    expect(right.style.opacity).toBe('0.75');
  });

  it('Ticket 2026-09-13#1 §3: section title icon changes with the active category, and the old static bolt-mark image is gone', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    const titleRow = screen.getByTestId('home-section-title').parentElement!;

    // No <img> in the title row at all, for any category (the old boltMark asset is gone).
    expect(titleRow.querySelector('img')).toBeNull();
    const originalsIconPath = titleRow.querySelector('svg')?.outerHTML;

    fireEvent.click(screen.getByTestId('home-cat-card'));
    expect(titleRow.querySelector('img')).toBeNull();
    const cardIconPath = titleRow.querySelector('svg')?.outerHTML;
    // A distinct icon renders for a distinct category (ORIGINALS' bolt vs CARD's spade).
    expect(cardIconPath).not.toBe(originalsIconPath);
  });

  it('Ticket 2026-09-13#1 §3: section title uses the prototype-exact Arial/21px/700/0.4px font', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    const title = screen.getByTestId('home-section-title');
    expect(title.style.fontFamily).toBe('Arial, Helvetica, sans-serif');
    expect(title.style.fontSize).toBe('21px');
    expect(title.style.fontWeight).toBe('700');
    expect(title.style.letterSpacing).toBe('0.4px');
  });

  it('section title shows RAPIDCLASH ORIGINALS by default and switches per active category', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    expect(screen.getByTestId('home-section-title').textContent).toBe('RAPIDCLASH ORIGINALS');

    fireEvent.click(screen.getByTestId('home-cat-card'));
    expect(screen.getByTestId('home-section-title').textContent).toBe('CARD GAMES');

    fireEvent.click(screen.getByTestId('home-cat-chance'));
    expect(screen.getByTestId('home-section-title').textContent).toBe('CHANCE GAMES');

    fireEvent.click(screen.getByTestId('home-cat-skill'));
    expect(screen.getByTestId('home-section-title').textContent).toBe('SKILL GAMES');

    fireEvent.click(screen.getByTestId('home-cat-events'));
    expect(screen.getByTestId('home-section-title').textContent).toBe('EVENTS');
  });

  it('ORIGINALS shows all 12 games', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    for (const g of ALL_12) expect(screen.getByTestId(`home-tile-${g.id}`)).toBeInTheDocument();
  });

  it('CARD GAMES = blackjack, hilo, baccarat only', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-cat-card'));
    for (const id of ['blackjack', 'hilo', 'baccarat']) expect(screen.getByTestId(`home-tile-${id}`)).toBeInTheDocument();
    for (const id of ['coinflip', 'chess', 'mines', 'rps', 'crash', 'dice', 'roulette', 'keno', 'limbo']) {
      expect(screen.queryByTestId(`home-tile-${id}`)).toBeNull();
    }
  });

  it('CHANCE GAMES = coinflip, dice, roulette, keno, limbo, mines, crash, baccarat', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-cat-chance'));
    for (const id of ['coinflip', 'dice', 'roulette', 'keno', 'limbo', 'mines', 'crash', 'baccarat']) {
      expect(screen.getByTestId(`home-tile-${id}`)).toBeInTheDocument();
    }
    for (const id of ['blackjack', 'chess', 'rps', 'hilo']) expect(screen.queryByTestId(`home-tile-${id}`)).toBeNull();
  });

  it('SKILL GAMES = chess, blackjack, hilo, rps', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-cat-skill'));
    for (const id of ['chess', 'blackjack', 'hilo', 'rps']) expect(screen.getByTestId(`home-tile-${id}`)).toBeInTheDocument();
    for (const id of ['coinflip', 'mines', 'crash', 'dice', 'roulette', 'keno', 'baccarat', 'limbo']) {
      expect(screen.queryByTestId(`home-tile-${id}`)).toBeNull();
    }
  });

  it('membership is many-to-many: Blackjack appears in ORIGINALS, CARD GAMES, and SKILL GAMES', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-blackjack')).toBeInTheDocument()); // ORIGINALS
    fireEvent.click(screen.getByTestId('home-cat-card'));
    expect(screen.getByTestId('home-tile-blackjack')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('home-cat-skill'));
    expect(screen.getByTestId('home-tile-blackjack')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('home-cat-chance'));
    expect(screen.queryByTestId('home-tile-blackjack')).toBeNull(); // NOT a chance game
  });

  it('EVENTS is empty by design — shows "No events running", not the grid', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-cat-events'));
    expect(screen.getByTestId('home-events-empty')).toHaveTextContent('No events running');
    expect(screen.queryByTestId('home-grid')?.querySelector('[data-testid^="home-tile-"]')).toBeNull();
  });

  it('SEARCH: case-insensitive substring on display name, across ALL games, ignoring the active tab', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    // Switch to CARD GAMES (chess is not a member) — search must still find it, since search
    // ignores whichever tab is active (Owner-resolved 2026-09-09).
    fireEvent.click(screen.getByTestId('home-cat-card'));
    expect(screen.queryByTestId('home-tile-chess')).toBeNull();

    fireEvent.click(screen.getByTestId('home-search-toggle'));
    fireEvent.change(screen.getByTestId('home-search-input'), { target: { value: 'CHE' } }); // uppercase
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tile-coinflip')).toBeNull();
    expect(screen.queryByTestId('home-tile-blackjack')).toBeNull();
  });

  it('SEARCH: an empty query falls back to the normal category-filtered view', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-cat-card'));

    fireEvent.click(screen.getByTestId('home-search-toggle'));
    fireEvent.change(screen.getByTestId('home-search-input'), { target: { value: 'chess' } });
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('home-search-input'), { target: { value: '' } });
    expect(screen.queryByTestId('home-tile-chess')).toBeNull(); // back to CARD GAMES (no chess)
    expect(screen.getByTestId('home-tile-blackjack')).toBeInTheDocument();
  });

  it('SEARCH: Cancel closes the search and clears the query', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-search-toggle'));
    fireEvent.change(screen.getByTestId('home-search-input'), { target: { value: 'chess' } });
    fireEvent.click(screen.getByTestId('home-search-cancel'));
    expect(screen.queryByTestId('home-search-cancel')).toBeNull();
    expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument(); // ORIGINALS view restored
  });

  it('SORT: Popularity (default) orders by all-time settled-match count, descending', async () => {
    stubFetch({ chess: 5, coinflip: 50, mines: 1 });
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-cat-skill')); // chess, blackjack, hilo, rps — only chess has a count
    await waitFor(() => {
      const order = tileOrder();
      expect(order[0]).toBe('chess'); // popularity 5, the highest among skill games
    });
  });

  it('SORT: Popularity tie-break (issue #476) falls back to the design GRID order, not alphabetical, when all counts are equal', async () => {
    stubFetch({}); // every count 0 — the normal fresh/quiet-database state
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    // ORIGINALS (all 12, all tied at 0) — must be the design's own GRID sequence, Coinflip first,
    // NOT alphabetical (which would put Baccarat first).
    expect(tileOrder()).toEqual([
      'coinflip', 'blackjack', 'chess', 'mines', 'rps', 'crash',
      'dice', 'roulette', 'hilo', 'keno', 'baccarat', 'limbo',
    ]);
  });

  it('SORT: Popularity tie-break on a non-ORIGINALS tab uses that category\'s own curated order, not the flat GRID order (issue #501)', async () => {
    stubFetch({}); // every count 0 — the normal fresh/quiet-database state
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-cat-chance'));
    // The prototype's own CHANCE GAMES order (`CAT_GAMES[2]`, `design/prototype/RapidClash Full
    // Spec.html:2846`) is coinflip, dice, roulette, keno, limbo, mines, crash, baccarat — NOT the
    // master GRID's sequence filtered down to chance members (which would put mines/crash right
    // after coinflip). Getting this wrong was most of games-chance's ~20pt fidelity-harness gap:
    // the tile grid showed a different game at nearly every position, not just a shifted one.
    await waitFor(() => {
      expect(tileOrder()).toEqual([
        'coinflip', 'dice', 'roulette', 'keno', 'limbo', 'mines', 'crash', 'baccarat',
      ]);
    });
  });

  it('SORT: Newest orders by fixed introduction-order ordinal, most-recently-added first', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-cat-skill')); // chess, blackjack, hilo, rps
    fireEvent.click(screen.getByTestId('home-sort-toggle'));
    fireEvent.click(screen.getByTestId('home-sort-opt-newest'));
    // Fixed ordinals (gameSort.ts): rps=0, chess=2, blackjack=3, hilo=11 — newest-first is
    // descending, so hilo (11, the most recently added of these 4) leads, rps (0, oldest) trails.
    expect(tileOrder()).toEqual(['hilo', 'blackjack', 'chess', 'rps']);
  });

  it('SORT: Alphabetical orders by display name, ascending', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-cat-card')); // Blackjack, Baccarat, Hilo
    fireEvent.click(screen.getByTestId('home-sort-toggle'));
    fireEvent.click(screen.getByTestId('home-sort-opt-alphabetical'));
    expect(tileOrder()).toEqual(['baccarat', 'blackjack', 'hilo']); // Baccarat, Blackjack, Hilo
  });

  it('SORT sheet shows a checkmark on the active option and closes on selection', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('home-sort-toggle'));
    expect(screen.getByTestId('home-sort-sheet')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('home-sort-opt-alphabetical'));
    expect(screen.queryByTestId('home-sort-sheet')).toBeNull(); // closes on pick
  });

  it('RANDOM never picks one of the six non-playable games, across many trials', async () => {
    vi.useFakeTimers();
    const onSelectGame = vi.fn();
    render(<HomeHubScreen {...baseProps({ onSelectGame })} />);
    await vi.waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    const PLAYABLE = new Set(['rps', 'dice', 'mines', 'coinflip', 'blackjack', 'chess']);
    const TRIALS = 30;
    for (let i = 0; i < TRIALS; i++) {
      fireEvent.click(screen.getByTestId('home-random'));
      await vi.advanceTimersByTimeAsync(1560); // RANDOM_TOTAL_MS — spin keyframe + post-settle delay
    }

    expect(onSelectGame).toHaveBeenCalledTimes(TRIALS);
    for (const call of onSelectGame.mock.calls) {
      expect(PLAYABLE.has((call[0] as GameMeta).id)).toBe(true);
    }
    // Sanity: over 30 trials, more than one distinct game should have come up (not a stuck pick).
    const distinct = new Set(onSelectGame.mock.calls.map((c) => (c[0] as GameMeta).id));
    expect(distinct.size).toBeGreaterThan(1);
    vi.useRealTimers();
  }, 20_000);

  it('RANDOM ignores a second tap while already spinning (re-entrancy guard)', async () => {
    vi.useFakeTimers();
    const onSelectGame = vi.fn();
    render(<HomeHubScreen {...baseProps({ onSelectGame })} />);
    await vi.waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-random'));
    fireEvent.click(screen.getByTestId('home-random')); // ignored — a spin is already in flight
    await vi.advanceTimersByTimeAsync(1560);
    expect(onSelectGame).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('MENU: tapping "Card games" opens the games view pre-filtered to CARD GAMES (issue #465)', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('menu-row-card-games'));
    expect(screen.getByTestId('home-section-title').textContent).toBe('CARD GAMES');
    expect(screen.getByTestId('home-cat-card').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('menu-overlay').getAttribute('aria-hidden')).toBe('true'); // menu closed
  });

  it('Advisor #2: hero carousel renders separate rounded cards with a gap + distinct alt text', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    const hero = screen.getByTestId('home-hero');
    const track = hero.firstElementChild as HTMLElement;

    // Cards, not one continuous strip: radius moves off the track onto each card, gap sits between.
    expect(track.className).toContain('gap-4');
    expect(track.className).not.toContain('rounded-[18px]');

    const heroImgs = within(hero).getAllByRole('img');
    expect(heroImgs).toHaveLength(3);
    for (const img of heroImgs) {
      expect(img.className).toContain('rounded-[18px]');
      expect(img.className).toContain('aspect-[2120/754]');
      expect(img.className).toContain('object-cover');
    }

    // Final Designer banner set: each slide has its own descriptive alt, not one shared string.
    const alts = heroImgs.map((img) => img.getAttribute('alt'));
    expect(new Set(alts).size).toBe(3);
    expect(alts[0]).toMatch(/never the house/i);
    expect(alts[1]).toMatch(/no house/i);
    expect(alts[2]).toMatch(/rivals/i);
  });

  it('Advisor #2: dot indicator uses a gap-aware page width, not raw clientWidth', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    const hero = screen.getByTestId('home-hero');
    const track = hero.firstElementChild as HTMLElement;
    const dots = hero.lastElementChild!.children;
    const imgs = within(hero).getAllByRole('img');

    // Simulate cards laid out with a large gap between them (offsetLeft spacing = 400px), so a
    // naive clientWidth-only calc (300px) and a gap-aware calc (400px spacing) disagree at index 2.
    imgs.forEach((img, i) => Object.defineProperty(img, 'offsetLeft', { value: i * 400, configurable: true }));
    Object.defineProperty(track, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(track, 'scrollLeft', { value: 800, configurable: true });
    fireEvent.scroll(track);

    // Gap-aware: 800 / 400 = index 2 (correct). A clientWidth-only calc would give round(800/300)=3,
    // which is out of range and would leave every dot un-highlighted.
    expect(dots[2].className).toContain('bg-brand');
    expect(dots[0].className).not.toContain('bg-brand');
    expect(dots[1].className).not.toContain('bg-brand');
  });
});
