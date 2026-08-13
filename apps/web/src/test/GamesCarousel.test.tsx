// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { GamesCarousel } from '../components/hub-shared/GamesCarousel.js';
import type { OpenChallenge } from '@rapidclash/shared';

// Issue #305 — Games-page Open Games carousel. Motion constants transcribed verbatim from the
// decoded design template: 1900ms tick, ROW=76, VISIBLE=11, 620ms slide-in.
const TICK_MS = 1900;
const ROW = 76;
const SLIDE_MS = 620;

const nameByGame = new Map([['coinflip', 'Coinflip'], ['mines', 'Mines'], ['chess', 'Chess']]);

function challenge(matchId: string, ownerName: string, stake: number, openedAt: number): OpenChallenge {
  return { matchId, ownerName, stake, openedAt, expiresAt: Date.now() + 30_000, timeControlId: 'none' };
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

beforeEach(() => stubRaf());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('GamesCarousel — tabs', () => {
  it('renders all 4 tabs verbatim, OPEN GAMES active by default', () => {
    render(<GamesCarousel {...baseProps()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['OPEN GAMES', '24H RACE', 'WEEKLY RACE', 'RANK']);
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
    expect(within(c1).getByText('5')).toBeInTheDocument();

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

  it('no $ anywhere — play-money framing only', () => {
    const { container } = render(<GamesCarousel {...baseProps({ challengesByGame: manyChallenges(3) })} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
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
