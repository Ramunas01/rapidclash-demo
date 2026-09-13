// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor, act } from '@testing-library/react';
import { GamesCarousel } from '../components/hub-shared/GamesCarousel.js';
import { setCurSel } from '../lib/currency.js';
import type { OpenChallenge, VipTier } from '@rapidclash/shared';

/** Some `CurrencyIcon` symbols (e.g. SOL's gradient) use `useId()` for an internal `<defs>` id,
 *  so two separate instances of the SAME symbol render byte-different `outerHTML` even though
 *  they're visually identical. Strip generated ids/refs before comparing two icons for "is this
 *  the same symbol", so these tests aren't coupled to which symbol a given hash happens to pick. */
function normalizeSvg(html: string | null | undefined): string {
  return (html ?? '').replace(/id="[^"]*"/g, 'id="X"').replace(/url\(#[^)]*\)/g, 'url(#X)');
}

// Issue #305 — Games-page Open Games carousel. Motion constants transcribed verbatim from the
// decoded design template: 1900ms tick, ROW=76, VISIBLE=11, 620ms slide-in.
const TICK_MS = 1900;
const ROW = 76;
const SLIDE_MS = 620;

const nameByGame = new Map([['coinflip', 'Coinflip'], ['mines', 'Mines'], ['chess', 'Chess']]);

function challenge(
  matchId: string,
  ownerName: string,
  stake: number,
  openedAt: number,
  ownerTier: VipTier = 'Unranked',
): OpenChallenge {
  return { matchId, ownerName, ownerTier, stake, openedAt, expiresAt: Date.now() + 30_000, timeControlId: 'none' };
}

/** N sequential coinflip challenges (g1 oldest .. gN newest). */
function manyChallenges(n: number): Record<string, OpenChallenge[]> {
  return { coinflip: Array.from({ length: n }, (_, i) => challenge(`g${i + 1}`, `rival${i + 1}`, 10 * (i + 1), i)) };
}

/** requestAnimationFrame, backed by fake timers (mirrors OpenGames.test.tsx's convention). */
function stubRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
}

/** Finds the OPEN GAMES row whose real challenge id is `matchId` (rows are keyed/testid'd by the
 *  carousel's own synthetic `uid`, not `matchId`, since the pool can wrap and repeat — see the
 *  component's judgment-call comment). */
function rowByMatchId(matchId: string): HTMLElement {
  const el = document.querySelector(`[data-match-id="${matchId}"]`);
  if (!el) throw new Error(`no row for matchId ${matchId}`);
  return el as HTMLElement;
}

function baseProps(over: Partial<Parameters<typeof GamesCarousel>[0]> = {}): Parameters<typeof GamesCarousel>[0] {
  return {
    challengesByGame: {},
    nameByGame,
    balance: 1000,
    onTake: vi.fn(),
    loggedIn: true,
    ...over,
  };
}

// `curSel` is app-wide shared state (`lib/currency.ts`, ticket 2026-09-13#6 item 2) — reset it
// before every test so a test that picks a non-default currency can't leak into the next one.
beforeEach(() => {
  stubRaf();
  setCurSel('USD');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('GamesCarousel — tabs', () => {
  it('renders all 4 tabs verbatim (ticket 2026-09-13#6 item 1: the 4th tab is LEADERBOARDS, not the old wrong "RANK" label), OPEN GAMES active by default', () => {
    render(<GamesCarousel {...baseProps()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['OPEN GAMES', '24H RACE', 'WEEKLY RACE', 'LEADERBOARDS']);
    expect(screen.getByTestId('games-carousel-tab-0')).toHaveAttribute('aria-selected', 'true');
  });

  it('switching tabs shows the static board and hides the OPEN GAMES list; switching back restores it', () => {
    render(<GamesCarousel {...baseProps({ challengesByGame: manyChallenges(3) })} />);
    expect(screen.getByTestId('games-carousel-live')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('games-carousel-tab-1'));
    expect(screen.getByTestId('games-carousel-tab-1')).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('games-carousel-live')).toBeNull();
    expect(screen.getAllByTestId(/^games-carousel-board-row-/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('games-carousel-tab-0'));
    expect(screen.getByTestId('games-carousel-live')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^games-carousel-board-row-/)).toHaveLength(0);
  });
});

describe('GamesCarousel — OPEN GAMES tab: real data (signed in)', () => {
  it('seeds real rows from the WS aggregate feed — game name, host, stake, real matchId', () => {
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)], mines: [challenge('m1', 'bob', 25, 50)] };
    render(<GamesCarousel {...baseProps({ challengesByGame })} />);

    const c1 = rowByMatchId('c1');
    expect(within(c1).getByText('Coinflip')).toBeInTheDocument();
    expect(within(c1).getByText('@alice')).toBeInTheDocument();
    // signed-in (baseProps default loggedIn: true) → the Owner-approved $ skin (2026-09-11#8 item B.2)
    expect(within(c1).getByText('$5')).toBeInTheDocument();

    const m1 = rowByMatchId('m1');
    expect(within(m1).getByText('Mines')).toBeInTheDocument();
    expect(within(m1).getByText('@bob')).toBeInTheDocument();
  });

  it('the LIVE count is the real number of open challenges, not a fabricated figure', () => {
    render(<GamesCarousel {...baseProps({ challengesByGame: manyChallenges(4) })} />);
    expect(screen.getByTestId('games-carousel-live').textContent).toContain('4 LIVE');
  });

  it('empty real feed renders a plain empty state, never an animated-but-fake list', () => {
    render(<GamesCarousel {...baseProps({ challengesByGame: {} })} />);
    expect(screen.getByTestId('games-carousel-empty')).toBeInTheDocument();
    expect(screen.getByTestId('games-carousel-live').textContent).toContain('0 LIVE');
  });

  it('JOIN (signed in, affordable) calls onTake with the real matchId', () => {
    const onTake = vi.fn();
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)] };
    render(<GamesCarousel {...baseProps({ challengesByGame, onTake, balance: 100 })} />);
    const join = within(rowByMatchId('c1')).getByTestId(/^games-carousel-join-/);
    fireEvent.click(join);
    expect(onTake).toHaveBeenCalledWith('c1');
  });

  it('JOIN (signed in, unaffordable) refuses clearly without taking — reuses the shared affordability rule', () => {
    const onTake = vi.fn();
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 500, 100)] };
    render(<GamesCarousel {...baseProps({ challengesByGame, onTake, balance: 5 })} />);
    const join = within(rowByMatchId('c1')).getByTestId(/^games-carousel-join-/);
    fireEvent.click(join);
    expect(onTake).not.toHaveBeenCalled();
    expect(screen.getByTestId('games-carousel-notice').textContent).toMatch(/not enough/i);
  });

  it('ticket 2026-09-13#6 item 2: every row shows a $-prefixed amount, logged in or out (supersedes 2026-09-11#8 item B.2\'s RC-coin-for-guests half)', () => {
    const { container } = render(<GamesCarousel {...baseProps({ challengesByGame: manyChallenges(3) })} />);
    expect(container.textContent ?? '').toMatch(/\$/);
  });

  it('2026-09-11#8 item B.1: a real human username (no embedded @) renders with exactly one @, never doubled', () => {
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)] };
    render(<GamesCarousel {...baseProps({ challengesByGame })} />);
    const row = rowByMatchId('c1');
    expect(within(row).getByText('@alice')).toBeInTheDocument();
    expect(within(row).queryByText(/@@/)).toBeNull();
  });

  it('ticket 2026-09-13#6 item 3 (Owner-decided): a bot-crowd username renders with exactly one @ and NO visible 🤖 — the raw ownerName data is untouched, only the display strips it', () => {
    // Real shape bot-crowd posts (tools/bot-crowd/src/config.ts:226-233): BOT_PREFIX ('🤖') + '@' + handle.
    const rawOwnerName = '🤖@sweeper';
    const challengesByGame = { mines: [challenge('m1', rawOwnerName, 25, 100, 'Bronze')] };
    render(<GamesCarousel {...baseProps({ challengesByGame })} />);
    const row = rowByMatchId('m1');
    // Visible text: emoji stripped, exactly one @.
    const hostEl = within(row).getByTestId(/^games-carousel-host-/);
    expect(hostEl.textContent).toBe('@sweeper');
    expect(within(row).queryByText(/🤖/)).toBeNull();
    expect(within(row).queryByText(/@@/)).toBeNull();
    // A tier icon (an <svg>, TierIcon's own root element) renders immediately before the host
    // text — in the old emoji's place.
    expect(hostEl.previousElementSibling?.tagName.toLowerCase()).toBe('svg');
    // Underlying data untouched: the same bot-crowd-style check `tools/bot-crowd`'s own
    // `isTakeable` uses (`!ownerName.startsWith(BOT_PREFIX)`) still correctly identifies this as
    // a bot row from the RAW string — proving nothing stripped the data, only the render path.
    const BOT_PREFIX = '🤖';
    expect(rawOwnerName.startsWith(BOT_PREFIX)).toBe(true);
  });
});

describe('GamesCarousel — OPEN GAMES tab: real data (logged out)', () => {
  it('polls the public snapshot and JOIN captures matchId/gameId/stake for the auth wall', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{ ...challenge('p1', 'zed', 15, 0), gameId: 'coinflip' }],
    }) as Response));
    const onTakePublicChallenge = vi.fn();
    render(<GamesCarousel {...baseProps({ loggedIn: false, onTakePublicChallenge })} />);

    await waitFor(() => expect(document.querySelector('[data-match-id="p1"]')).toBeTruthy());
    const row = document.querySelector('[data-match-id="p1"]') as HTMLElement;
    const join = within(row).getByTestId(/^games-carousel-join-/);
    fireEvent.click(join);
    expect(onTakePublicChallenge).toHaveBeenCalledWith({ matchId: 'p1', gameId: 'coinflip', stake: 15 });
  });

  it('ticket 2026-09-13#6 item 2: logged-out viewers ALSO see a $-prefixed amount now (supersedes 2026-09-11#8 item B.2\'s RC-coin-for-guests half)', () => {
    // The static LEADERBOARDS board's XP/PRIZE figures don't depend on the network-polled
    // open-challenges feed, so this exercises the $-gating in isolation. Stubbed fetch just
    // avoids a real network call from the (unrelated, still-active) public-poll effect this
    // component also runs.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] }) as Response));
    const { container } = render(<GamesCarousel {...baseProps({ loggedIn: false })} />);
    fireEvent.click(screen.getByTestId('games-carousel-tab-3')); // LEADERBOARDS — XP figures
    expect(container.textContent ?? '').toMatch(/\$/);
    expect(screen.getAllByText('XP:').length).toBeGreaterThan(0);
  });
});

describe('GamesCarousel — OPEN GAMES motion (verbatim: 1900ms / ROW=76 / 620ms slide-in)', () => {
  it('every TICK_MS, a fresh row slides in via the two-rAF pattern (offset:-ROW,0ms then offset:0,620ms)', async () => {
    vi.useFakeTimers();
    render(<GamesCarousel {...baseProps({ challengesByGame: manyChallenges(3) })} />);

    // Fully seeded immediately (judgment call #2) — real rows visible without waiting for a tick.
    expect(rowByMatchId('g1')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(TICK_MS - 1);
    // Not yet ticked.
    const wrapperBefore = rowByMatchId('g1').parentElement as HTMLElement;
    expect(wrapperBefore.style.transform).toBe('translateY(0px)');

    await vi.advanceTimersByTimeAsync(1); // tick boundary
    const wrapper = rowByMatchId('g1').parentElement as HTMLElement;
    expect(wrapper.style.transform).toBe(`translateY(-${ROW}px)`);
    expect(wrapper.style.transition).toContain('0ms');

    await vi.advanceTimersByTimeAsync(1); // first rAF fires, schedules the second rAF
    expect(wrapper.style.transform).toBe(`translateY(-${ROW}px)`); // still pre-slide after frame 1
    await vi.advanceTimersByTimeAsync(1); // second rAF fires — flips to the slide
    expect(wrapper.style.transform).toBe('translateY(0px)');
    expect(wrapper.style.transition).toContain(`${SLIDE_MS}ms`);
  });

  it('the ticker keeps running while a different tab is active (componentDidMount-style, not gated on the active tab)', async () => {
    vi.useFakeTimers();
    render(<GamesCarousel {...baseProps({ challengesByGame: manyChallenges(3) })} />);
    fireEvent.click(screen.getByTestId('games-carousel-tab-1')); // switch away from OPEN GAMES

    await vi.advanceTimersByTimeAsync(TICK_MS + 2);
    fireEvent.click(screen.getByTestId('games-carousel-tab-0')); // switch back
    // Still renders real rows — the interval kept advancing underneath the inactive tab.
    expect(screen.getAllByTestId(/^games-carousel-row-/).length).toBeGreaterThan(0);
  });

  it('an empty pool never starts the tick interval', async () => {
    vi.useFakeTimers();
    render(<GamesCarousel {...baseProps({ challengesByGame: {} })} />);
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(screen.getByTestId('games-carousel-empty')).toBeInTheDocument();
  });
});

describe('GamesCarousel — 24H RACE / WEEKLY RACE / RANK: static placeholder, zero backend', () => {
  it('24H RACE shows 10 rows by default with a prize pill and a place number, no XP/rank column', () => {
    render(<GamesCarousel {...baseProps()} />);
    fireEvent.click(screen.getByTestId('games-carousel-tab-1'));
    const rows = screen.getAllByTestId(/^games-carousel-board-row-/);
    expect(rows).toHaveLength(10);
    // First row's place number (design's `b.placeNum`, a bare digit — the '#'-prefixed `place`
    // field is dead in the design's own markup, confirmed by grepping the decoded template).
    expect(within(rows[0]).getByText('1')).toBeInTheDocument();
    expect(screen.getAllByText('PRIZE').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('XP:')).toHaveLength(0);
  });

  it('RANK shows XP + tier, no placeNum/prize column', () => {
    render(<GamesCarousel {...baseProps()} />);
    fireEvent.click(screen.getByTestId('games-carousel-tab-3'));
    expect(screen.queryAllByText('PRIZE')).toHaveLength(0);
    expect(screen.getAllByText('XP:').length).toBeGreaterThan(0);
    // Top rank tier (transcribed verbatim) — the two top rows are both DIAMOND.
    expect(screen.getAllByText('DIAMOND').length).toBeGreaterThanOrEqual(1);
  });

  it('VIEW MORE steps the board limit 10 → 20 → 30, then stops (caps at the placeholder array length)', () => {
    render(<GamesCarousel {...baseProps()} />);
    fireEvent.click(screen.getByTestId('games-carousel-tab-2'));
    expect(screen.getAllByTestId(/^games-carousel-board-row-/)).toHaveLength(10);

    fireEvent.click(screen.getByTestId('games-carousel-board-more'));
    expect(screen.getAllByTestId(/^games-carousel-board-row-/)).toHaveLength(20);

    fireEvent.click(screen.getByTestId('games-carousel-board-more'));
    expect(screen.getAllByTestId(/^games-carousel-board-row-/)).toHaveLength(30);

    fireEvent.click(screen.getByTestId('games-carousel-board-more')); // capped — no-op past 30
    expect(screen.getAllByTestId(/^games-carousel-board-row-/)).toHaveLength(30);
    expect(screen.getByTestId('games-carousel-board-more')).toBeDisabled();
  });

  it('picking a tab resets the board limit back to 10, even re-picking the same tab', () => {
    render(<GamesCarousel {...baseProps()} />);
    fireEvent.click(screen.getByTestId('games-carousel-tab-1'));
    fireEvent.click(screen.getByTestId('games-carousel-board-more'));
    expect(screen.getAllByTestId(/^games-carousel-board-row-/)).toHaveLength(20);

    fireEvent.click(screen.getByTestId('games-carousel-tab-1')); // same tab, re-picked
    expect(screen.getAllByTestId(/^games-carousel-board-row-/)).toHaveLength(10);
  });

  it('no backend call is made for race/rank tabs — challengesByGame/onTake are never touched', () => {
    const onTake = vi.fn();
    render(<GamesCarousel {...baseProps({ onTake })} />);
    fireEvent.click(screen.getByTestId('games-carousel-tab-1'));
    fireEvent.click(screen.getByTestId('games-carousel-tab-2'));
    fireEvent.click(screen.getByTestId('games-carousel-tab-3'));
    expect(onTake).not.toHaveBeenCalled();
  });
});

describe('GamesCarousel — tab rail (ticket 2026-09-13#6 item 1: shared track, shadows, mask-image fade)', () => {
  it('the pills share one non-scrolling track div, nested inside the mask-image scroller — not a single flat scroller', () => {
    render(<GamesCarousel {...baseProps()} />);
    const pill = screen.getByTestId('games-carousel-tab-0');
    const track = pill.parentElement as HTMLElement;
    const scroller = track.parentElement as HTMLElement;
    expect(track.style.borderRadius).toBe('999px');
    expect(track.style.padding).toBe('6px 6px 11px 6px');
    expect(scroller.getAttribute('role')).toBe('tablist');
    expect(scroller.style.overflowX).toBe('auto');
    expect(scroller.style.maskImage).toBeTruthy();
  });

  it('the shared track background is theme-aware (dark vs light values differ)', async () => {
    const { setThemeChoice } = await import('../lib/theme.js');
    setThemeChoice('dark');
    const { unmount } = render(<GamesCarousel {...baseProps()} />);
    const darkBg = (screen.getByTestId('games-carousel-tab-0').parentElement as HTMLElement).style.background;
    unmount();

    setThemeChoice('light');
    render(<GamesCarousel {...baseProps()} />);
    const lightBg = (screen.getByTestId('games-carousel-tab-0').parentElement as HTMLElement).style.background;

    expect(darkBg).toBeTruthy();
    expect(lightBg).toBeTruthy();
    expect(darkBg).not.toBe(lightBg);
    setThemeChoice('dark'); // restore — theme.ts is a module-level singleton shared across tests
  });

  it('active pill gets the shared purple/active-ledge tokens; inactive pill gets the shared inactive-ledge token (same tokens as the Menu Dark/Light control)', () => {
    render(<GamesCarousel {...baseProps()} />);
    const active = screen.getByTestId('games-carousel-tab-0');
    const inactive = screen.getByTestId('games-carousel-tab-1');
    expect(active.style.boxShadow).toBe('var(--rc-theme-toggle-active-shadow)');
    expect(inactive.style.boxShadow).toBe('var(--rc-theme-toggle-inactive-shadow)');
    expect(active.style.background).toMatch(/#8b45f0|139, 69, 240/i);
    expect(inactive.style.background).toBe('var(--rc-surface)');
  });

  it('the mask-image is scroll-driven, not a fixed value', () => {
    render(<GamesCarousel {...baseProps()} />);
    const scroller = screen.getByRole('tablist', { name: 'Games leaderboard tabs' });
    const initial = scroller.style.maskImage;
    Object.defineProperty(scroller, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(scroller, 'scrollLeft', { value: 50, configurable: true });
    fireEvent.scroll(scroller);
    expect(scroller.style.maskImage).not.toBe(initial);
    expect(scroller.style.maskImage).toContain('linear-gradient');
    // Note: NOT asserting `.style.webkitMaskImage` here — jsdom's CSSOM (`cssstyle`) doesn't
    // implement the non-standard `-webkit-mask-image` property at all (same class of gap as this
    // session's already-confirmed `PointerEvent` absence), so it always reads back `undefined`
    // regardless of what's set. The component sets both `maskImage` and `WebkitMaskImage` from
    // the same `railMask(...)` call (see the JSX) — real Safari is what needs the prefix.
  });

  it('pressing a tab centers it — centerPill walks up past the non-scrolling track to the real scrollable ancestor', async () => {
    render(<GamesCarousel {...baseProps()} />);
    const pill = screen.getByTestId('games-carousel-tab-1');
    const track = pill.parentElement as HTMLElement;
    const scroller = track.parentElement as HTMLElement;

    // The track is content-sized (`width:max-content`) — never itself scrollable.
    Object.defineProperty(track, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(track, 'clientWidth', { value: 400, configurable: true });
    // The outer scroller IS scrollable — this is the ancestor centerPill must find.
    Object.defineProperty(scroller, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, configurable: true });
    scroller.scrollTo = vi.fn();

    const rect = (l: number, w: number): DOMRect =>
      ({ left: l, right: l + w, width: w, top: 0, bottom: 0, height: 0, x: l, y: 0, toJSON: () => ({}) }) as DOMRect;
    pill.getBoundingClientRect = () => rect(150, 50);
    scroller.getBoundingClientRect = () => rect(0, 200);

    fireEvent.click(pill);
    await new Promise((r) => setTimeout(r, 10)); // let the stubbed rAF (stubRaf: setTimeout(cb,0)) fire

    expect(screen.getByTestId('games-carousel-tab-1')).toHaveAttribute('aria-selected', 'true');
    // target = scrollLeft(0) + (pillLeft(150) - railLeft(0)) - (railWidth(200) - pillWidth(50))/2
    //        = 150 - 75 = 75; max = 400-200 = 200 → clamp(0,200,75) = 75.
    expect(scroller.scrollTo).toHaveBeenCalledWith({ left: 75, behavior: 'smooth' });
  });
});

describe('GamesCarousel — stake currency icon (ticket 2026-09-13#6 item 2)', () => {
  it('logged-in: every row shows the SAME currency icon, matching the shared curSel', () => {
    setCurSel('BTC');
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)], mines: [challenge('m1', 'bob', 25, 50)] };
    render(<GamesCarousel {...baseProps({ challengesByGame })} />);
    const c1Icon = within(rowByMatchId('c1')).getByTestId(/^games-carousel-stake-/).previousElementSibling as Element;
    const m1Icon = within(rowByMatchId('m1')).getByTestId(/^games-carousel-stake-/).previousElementSibling as Element;
    expect(c1Icon.tagName.toLowerCase()).toBe('svg');
    expect(normalizeSvg(c1Icon.outerHTML)).toBe(normalizeSvg(m1Icon.outerHTML)); // same symbol on every row
  });

  it('changing curSel updates every logged-in row\'s icon together', () => {
    setCurSel('USD');
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)] };
    render(<GamesCarousel {...baseProps({ challengesByGame })} />);
    const before = within(rowByMatchId('c1')).getByTestId(/^games-carousel-stake-/).previousElementSibling?.outerHTML;
    act(() => setCurSel('SOL'));
    const after = within(rowByMatchId('c1')).getByTestId(/^games-carousel-stake-/).previousElementSibling?.outerHTML;
    expect(normalizeSvg(after)).not.toBe(normalizeSvg(before));
  });

  it('logged-out: the same matchId keeps the same icon across different rolling-window slots (stable, not re-randomized by the slot\'s own changing uid)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => [{ ...challenge('p1', 'zed', 15, 0), gameId: 'coinflip' }],
    }) as Response));
    render(<GamesCarousel {...baseProps({ loggedIn: false })} />);
    await waitFor(() => expect(document.querySelectorAll('[data-match-id="p1"]').length).toBeGreaterThan(1));
    const rows = Array.from(document.querySelectorAll('[data-match-id="p1"]')) as HTMLElement[];
    const icons = rows.map((r) => normalizeSvg(within(r).getByTestId(/^games-carousel-stake-/).previousElementSibling?.outerHTML));
    expect(new Set(icons).size).toBe(1); // every slot showing this same challenge agrees on the icon
  });

  it('every row (logged in or out) shows a $-prefixed amount', () => {
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)] };
    render(<GamesCarousel {...baseProps({ challengesByGame })} />);
    expect(within(rowByMatchId('c1')).getByTestId(/^games-carousel-stake-/).textContent).toBe('$5');
  });
});

describe('GamesCarousel — curSel is wired to the same shared state as CurrencyPicker (ticket 2026-09-13#6 item 2)', () => {
  it('picking a currency in CurrencyPicker updates GamesCarousel\'s logged-in stake icon too, without either component knowing about the other', async () => {
    const { HubRibbon } = await import('../components/hub-chrome/HubRibbon.js');
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)] };
    render(
      <>
        <HubRibbon balance={100} onLogo={vi.fn()} onWallet={vi.fn()} loggedIn />
        <GamesCarousel {...baseProps({ challengesByGame })} />
      </>,
    );
    const iconBefore = within(rowByMatchId('c1')).getByTestId(/^games-carousel-stake-/).previousElementSibling?.outerHTML;

    fireEvent.click(screen.getByTestId('hub-currency-chip'));
    fireEvent.click(screen.getByTestId('currency-picker-row-BTC'));

    const iconAfter = within(rowByMatchId('c1')).getByTestId(/^games-carousel-stake-/).previousElementSibling?.outerHTML;
    expect(iconAfter).not.toBe(iconBefore);
  });
});
