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
    onHome: vi.fn(),
    ...over,
  };
}

const challenge = (matchId: string, ownerName: string, stake: number, openedAt: number): OpenChallenge => ({
  matchId, ownerName, stake, openedAt, expiresAt: Date.now() + 30_000, timeControlId: 'none',
});

describe('HomeHubScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
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
    expect(within(c1Row).getByText('5')).toBeInTheDocument();
    expect(within(m1Row).getByText('25')).toBeInTheDocument();
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

  it('is sanitized: no $ anywhere on the hub', async () => {
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)] };
    const { container } = render(<HomeHubScreen {...baseProps({ challengesByGame })} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());
    expect(container.textContent ?? '').not.toMatch(/\$/);
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
  // A live roster that includes Limbo (now has approved art) and Ships Battle (live, no art).
  const GAMES_148: GameMeta[] = [
    META('coinflip', 'Coinflip'), META('limbo', 'Limbo'), META('ships-battle', 'Ships Battle'),
  ];
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => [] } as Response;
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

  it('Ships Battle is hidden from the grid but stays live & reachable (still loaded + subscribed)', async () => {
    const onTrackChallenges = vi.fn();
    render(<HomeHubScreen {...baseProps({ onTrackChallenges })} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    // Absent from the home grid — neither a playable tile nor a (mislabeled) coming-soon one.
    expect(screen.queryByTestId('home-tile-ships-battle')).toBeNull();
    expect(screen.queryByTestId('home-coming-soon-ships-battle')).toBeNull();

    // Registration/reachability unaffected: it's still in the loaded /games set and subscribed
    // for the cross-game ticker (HIDDEN_ON_HOME only suppresses the grid tile, not the route).
    await waitFor(() => expect(onTrackChallenges).toHaveBeenCalled());
    expect(onTrackChallenges).toHaveBeenCalledWith(expect.arrayContaining(['ships-battle']));
  });
});

describe('HomeHubScreen (logged out)', () => {
  // A public open-challenge as returned by GET /open-challenges (carries gameId).
  const pub = (matchId: string, gameId: string, ownerName: string, stake: number) => ({
    matchId, gameId, ownerName, stake, openedAt: 100, expiresAt: Date.now() + 30_000, timeControlId: 'none',
  });
  // Default mock: public endpoints succeed; the open-challenges snapshot is empty unless overridden.
  function stubFetch(openChallenges: unknown[] = []) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => openChallenges } as Response;
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
    expect(within(p1Row).getByText('15')).toBeInTheDocument();
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

describe('HomeHubScreen — grid taxonomy + controls (design frame)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/open-challenges')) return { ok: true, json: async () => [] } as Response;
      if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Advisor #3: the category heading collapses its line box (leading-none) so caps center vs the bolt icon', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    // Default category is "All Games"; the h2 renders CAT_TITLE for every category via one element.
    const heading = await screen.findByRole('heading', { name: 'All Games' });
    expect(heading.className).toContain('leading-none');
    expect(heading.className).toContain('uppercase');
    // Advisor #9: the bolt icon (aria-hidden img sibling in the heading row) is nudged up
    // ~3px to sit on the caps' optical centre rather than the row centre.
    const bolt = heading.parentElement?.querySelector('img[aria-hidden="true"]');
    expect(bolt?.className).toContain('-translate-y-[3px]');
  });

  it('Originals excludes chess; Classics shows only chess', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-cat-originals'));
    expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument();
    expect(screen.getByTestId('home-tile-mines')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tile-chess')).toBeNull(); // chess is a Classic, not an Original

    fireEvent.click(screen.getByTestId('home-cat-classics'));
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tile-coinflip')).toBeNull();
    expect(screen.queryByTestId('home-tile-mines')).toBeNull();
  });

  it('Events shows the Dice Rush tournament card image — no $ / prize copy', async () => {
    const { container } = render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-cat-events'));
    const events = screen.getByTestId('home-events');
    // The announcement copy is baked into the image — the Events card is now a single <img>.
    expect(events.tagName).toBe('IMG');
    const src = events.getAttribute('src');
    expect(src).toBeTruthy();
    // Vite resolves the asset import to a URL that carries the filename; if a
    // future transform stubs it out, the alt below still pins it to Dice Rush.
    if (src && /dice-rush/i.test(src)) expect(src).toMatch(/dice-rush/i);
    expect(events.getAttribute('alt')).toMatch(/Dice Rush/i);
    // Hero-matching corner radius (same rounded-[18px] the HeroCarousel cards use).
    expect(events.className).toContain('rounded-[18px]');
    // The grid of tiles is replaced by the announcement.
    expect(screen.queryByTestId('home-tile-coinflip')).toBeNull();
    // Play-money only — no real-money / prize-pool copy (trivially true now; kept as a guard).
    expect(container.textContent ?? '').not.toMatch(/\$/);
    expect(events.textContent ?? '').not.toMatch(/prize pool/i);
  });

  it('Find filters tiles by substring', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-find-toggle'));
    fireEvent.change(screen.getByTestId('home-find-input'), { target: { value: 'che' } });
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tile-coinflip')).toBeNull();
    expect(screen.queryByTestId('home-tile-mines')).toBeNull();
  });

  it('Filter by game kind narrows the grid (Logic = chess + mines, not coinflip)', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('home-tile-coinflip')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('home-filter'));
    fireEvent.click(screen.getByTestId('home-filter-opt-logic'));
    expect(screen.getByTestId('home-tile-chess')).toBeInTheDocument();
    expect(screen.getByTestId('home-tile-mines')).toBeInTheDocument();
    expect(screen.queryByTestId('home-tile-coinflip')).toBeNull(); // coinflip is a Table game
  });

  it('Designer #6: shorter ~2.8:1 hero + navy Filter/Sort pills matching the search row', async () => {
    render(<HomeHubScreen {...baseProps()} />);
    // Hero: both slides constrained to ~2.8:1 (2120/754), still object-cover; dots/carousel unchanged.
    const heroImgs = within(screen.getByTestId('home-hero')).getAllByRole('img');
    expect(heroImgs.length).toBeGreaterThanOrEqual(2);
    for (const img of heroImgs) {
      expect(img.className).toContain('aspect-[2120/754]');
      expect(img.className).toContain('object-cover');
    }
    // Filter + Sort each sit on a bg-surface navy pill (matching the search control) — one consistent row.
    await waitFor(() => expect(screen.getByTestId('home-filter')).toBeInTheDocument());
    expect(screen.getByTestId('home-filter').className).toContain('bg-surface');
    expect(screen.getByTestId('home-sort').className).toContain('bg-surface');
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
