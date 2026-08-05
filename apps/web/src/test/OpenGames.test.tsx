// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { OpenGamesTicker, PublicOpenGamesTicker } from '../components/hub-shared/OpenGames.js';
import type { OpenChallenge } from '@rapidclash/shared';

// issue #259 — flat panel + zebra pills + stepped top-down motion (replaces the old recessed-navy
// panel + continuous CSS marquee + duplicated "clone" rows). Owner-confirmed decisions
// (PM_TO_ADVISOR 2026-08-05#1): N = 5 visible rows, static-backdrop zebra with content gliding over
// fixed pills mid-slide is the intended look, one PR for the whole redesign.

const nameByGame = new Map([['coinflip', 'Coinflip'], ['mines', 'Mines']]);

function challenge(matchId: string, ownerName: string, stake: number, openedAt: number): OpenChallenge {
  return { matchId, ownerName, stake, openedAt, expiresAt: Date.now() + 30_000, timeControlId: 'none' };
}

/** Builds a `challengesByGame` map with N sequential coinflip challenges (g1 oldest .. gN newest),
 *  which is what pushes the ticker over the 5-row static threshold. */
function manyChallenges(n: number): Record<string, OpenChallenge[]> {
  return { coinflip: Array.from({ length: n }, (_, i) => challenge(`g${i + 1}`, `rival${i + 1}`, 10, i)) };
}

function rowIds() {
  return screen.getAllByTestId(/^home-row-[a-z0-9]+$/).map((el) => el.getAttribute('data-testid'));
}

/** requestAnimationFrame, backed by fake timers (mirrors the Coin.test.tsx convention) so the
 *  stepper's "next frame, flip the transition on" tick can be advanced deterministically. */
function stubRaf() {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

const HOLD_MS = 800;
const STEP_MS = Math.round(22_000 / 6); // mirrors OLD_MARQUEE_LOOP_MS / OLD_MARQUEE_REFERENCE_ROWS

beforeEach(() => {
  stubReducedMotion(false);
  stubRaf();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OpenGames — Part 1: flat panel, no dividers', () => {
  it('the ticker window has no panel bg/shadow/rounded — only the fixed-height clip', () => {
    render(<OpenGamesTicker challengesByGame={manyChallenges(2)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const body = screen.getByTestId('home-ticker-body');
    expect(body.className).not.toContain('bg-surface');
    expect(body.className).not.toMatch(/shadow-/);
    expect(body.className).not.toMatch(/rounded-/);
    expect(body.className).toContain('overflow-hidden'); // still clips to the fixed window
  });

  it('rows carry no top-border divider and no panel background', () => {
    render(<OpenGamesTicker challengesByGame={manyChallenges(2)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const row = screen.getByTestId('home-row-g1');
    expect(row.className).not.toMatch(/\bborder\b/);
    expect(row.className).not.toContain('border-brand');
  });

  it('empty state is flat text on the page background — no panel', () => {
    render(<OpenGamesTicker challengesByGame={{}} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const empty = screen.getByTestId('home-ticker-empty');
    expect(empty.className).not.toContain('bg-surface');
    expect(empty.className).not.toMatch(/shadow-|rounded-|\bborder\b/);
  });
});

describe('OpenGames — Part 2: static zebra backdrop', () => {
  it('paints exactly 5 flush slots, even = the elevated-surface pill (token, not a hardcoded hex), odd = transparent', () => {
    render(<OpenGamesTicker challengesByGame={manyChallenges(2)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const backdrop = screen.getByTestId('home-ticker-zebra');
    const slots = Array.from(backdrop.children);
    expect(slots).toHaveLength(5);
    slots.forEach((slot, i) => {
      const cls = (slot as HTMLElement).className;
      if (i % 2 === 0) {
        expect(cls).toContain('bg-surface'); // token (--rc-surface / #1a1a2e), never a raw hex
        expect(cls).toContain('rounded-full');
      } else {
        expect(cls).not.toContain('bg-surface');
      }
    });
  });

  it('padding is identical for every row regardless of the slot parity behind it', () => {
    render(<OpenGamesTicker challengesByGame={manyChallenges(4)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const rows = screen.getAllByTestId(/^home-row-[a-z0-9]+$/);
    const paddingClasses = rows.map((r) => r.className.match(/px-\d+/)?.[0]);
    expect(new Set(paddingClasses).size).toBe(1); // one shared padding value across all rows
  });

  it('the backdrop is a static layer — its slot nodes never change identity across a step (no flicker)', async () => {
    vi.useFakeTimers();
    render(<OpenGamesTicker challengesByGame={manyChallenges(7)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const before = Array.from(screen.getByTestId('home-ticker-zebra').children);

    await vi.advanceTimersByTimeAsync(HOLD_MS); // enter the slide
    await vi.advanceTimersByTimeAsync(1); // rAF flip to 'moving'
    await vi.advanceTimersByTimeAsync(STEP_MS); // commit
    await vi.advanceTimersByTimeAsync(HOLD_MS); // settle into the next hold

    const after = Array.from(screen.getByTestId('home-ticker-zebra').children);
    expect(after).toHaveLength(before.length);
    after.forEach((node, i) => expect(node).toBe(before[i])); // exact same DOM nodes, never re-rendered
  });
});

describe('OpenGames — static when small', () => {
  it('≤5 rows renders statically, no animation, all rows real and interactive', async () => {
    vi.useFakeTimers();
    const onTake = vi.fn();
    render(<OpenGamesTicker challengesByGame={manyChallenges(3)} nameByGame={nameByGame} balance={1000} onTake={onTake} />);
    expect(rowIds()).toEqual(['home-row-g1', 'home-row-g2', 'home-row-g3']);

    // Advance well past a hold+step boundary — nothing should ever start sliding.
    await vi.advanceTimersByTimeAsync(HOLD_MS + STEP_MS + HOLD_MS);
    expect(rowIds()).toEqual(['home-row-g1', 'home-row-g2', 'home-row-g3']);

    fireEvent.click(screen.getByTestId('home-join-g2'));
    expect(onTake).toHaveBeenCalledWith('g2');
  });

  it('window height is constant (5 × row height) whether the list is small or animated', () => {
    const { rerender } = render(<OpenGamesTicker challengesByGame={manyChallenges(2)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const smallHeight = screen.getByTestId('home-ticker-body').style.height;
    rerender(<OpenGamesTicker challengesByGame={manyChallenges(9)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const bigHeight = screen.getByTestId('home-ticker-body').style.height;
    expect(smallHeight).toBe('320px');
    expect(bigHeight).toBe('320px');
    expect(smallHeight).toBe(bigHeight); // no layout shift outside the list
  });
});

describe('OpenGames — Part 3: stepped top-down motion', () => {
  it('holds statically for 800ms, then slides exactly one row-height with the newest entering the top', async () => {
    vi.useFakeTimers();
    render(<OpenGamesTicker challengesByGame={manyChallenges(6)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    // Initial static frame: the 5 oldest, oldest on top (mirrors the old marquee's base ordering).
    expect(rowIds()).toEqual(['home-row-g1', 'home-row-g2', 'home-row-g3', 'home-row-g4', 'home-row-g5']);

    await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
    expect(rowIds()).toEqual(['home-row-g1', 'home-row-g2', 'home-row-g3', 'home-row-g4', 'home-row-g5']); // still holding

    await vi.advanceTimersByTimeAsync(1); // hold boundary reached — incoming (newest, g6) mounts at the top
    expect(rowIds()).toEqual(['home-row-g6', 'home-row-g1', 'home-row-g2', 'home-row-g3', 'home-row-g4', 'home-row-g5']);
    const wrapper = screen.getByTestId('home-row-g6').parentElement as HTMLElement;
    expect(wrapper.style.transform).toBe('translateY(-64px)'); // starts scrolled up — visually identical to the pre-step frame

    await vi.advanceTimersByTimeAsync(1); // next frame — the transition kicks in
    expect(wrapper.style.transform).toBe('translateY(0px)');
    expect(wrapper.style.transition).toContain(`${STEP_MS}ms`);

    // Mid-slide: still all 6 real rows, bottom one (g5) about to be clipped, not committed yet.
    await vi.advanceTimersByTimeAsync(STEP_MS / 2);
    expect(rowIds()).toEqual(['home-row-g6', 'home-row-g1', 'home-row-g2', 'home-row-g3', 'home-row-g4', 'home-row-g5']);

    await vi.advanceTimersByTimeAsync(STEP_MS / 2); // commit
    // Newest (g6) now permanently in slot 0; oldest visible (g5) dropped off the bottom.
    expect(rowIds()).toEqual(['home-row-g6', 'home-row-g1', 'home-row-g2', 'home-row-g3', 'home-row-g4']);
  });

  it('zebra re-resolves correctly after a step: slot 0 is still even/pill, position-based not row-based', async () => {
    vi.useFakeTimers();
    render(<OpenGamesTicker challengesByGame={manyChallenges(6)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(STEP_MS);
    const slots = Array.from(screen.getByTestId('home-ticker-zebra').children);
    expect((slots[0] as HTMLElement).className).toContain('bg-surface');
    expect((slots[1] as HTMLElement).className).not.toContain('bg-surface');
    expect((slots[2] as HTMLElement).className).toContain('bg-surface');
  });
});

describe('OpenGames — tap correctness mid-slide (the crux of #259)', () => {
  it('tapping JOIN on the incoming row mid-slide fires ITS OWN matchId', async () => {
    vi.useFakeTimers();
    const onTake = vi.fn();
    render(<OpenGamesTicker challengesByGame={manyChallenges(6)} nameByGame={nameByGame} balance={1000} onTake={onTake} />);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(STEP_MS / 3); // well into the slide, before it completes

    fireEvent.click(screen.getByTestId('home-join-g6')); // the incoming row, entering the top
    expect(onTake).toHaveBeenCalledWith('g6');
  });

  it('tapping JOIN on the outgoing (bottom, about-to-be-clipped) row mid-slide fires ITS OWN matchId, never a stale one', async () => {
    vi.useFakeTimers();
    const onTake = vi.fn();
    render(<OpenGamesTicker challengesByGame={manyChallenges(6)} nameByGame={nameByGame} balance={1000} onTake={onTake} />);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(STEP_MS / 3);

    fireEvent.click(screen.getByTestId('home-join-g5')); // the outgoing bottom row, still real & mounted
    expect(onTake).toHaveBeenCalledWith('g5');
    expect(onTake).not.toHaveBeenCalledWith('g6');
  });

  it('every row rendered mid-slide has its own live data-testids (no aria-hidden/inert clone anywhere)', async () => {
    vi.useFakeTimers();
    render(<OpenGamesTicker challengesByGame={manyChallenges(6)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await vi.advanceTimersByTimeAsync(1);
    for (const id of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']) {
      const join = screen.getByTestId(`home-join-${id}`);
      expect(join).not.toHaveAttribute('aria-hidden');
      expect(join.getAttribute('tabIndex')).not.toBe('-1');
    }
  });
});

describe('OpenGames — live-set reconciliation only at a hold boundary', () => {
  it('an update mid-slide does not change what is on screen; it is only picked up at the next hold', async () => {
    vi.useFakeTimers();
    const onTake = vi.fn();
    const { rerender } = render(<OpenGamesTicker challengesByGame={manyChallenges(6)} nameByGame={nameByGame} balance={1000} onTake={onTake} />);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    await vi.advanceTimersByTimeAsync(1); // now mid-slide: [g6, g1, g2, g3, g4, g5]
    const midSlide = rowIds();

    // Simulate a WS update landing mid-slide: g2 gets taken (removed) and a brand-new g7 opens.
    const updated: Record<string, OpenChallenge[]> = {
      coinflip: [
        challenge('g1', 'rival1', 10, 0), challenge('g3', 'rival3', 10, 2), challenge('g4', 'rival4', 10, 3),
        challenge('g5', 'rival5', 10, 4), challenge('g6', 'rival6', 10, 5), challenge('g7', 'rival7', 10, 6),
      ],
    };
    rerender(<OpenGamesTicker challengesByGame={updated} nameByGame={nameByGame} balance={1000} onTake={onTake} />);
    // Nothing on screen changes mid-slide — the removed row (g2) is still exactly where it was.
    expect(rowIds()).toEqual(midSlide);

    await vi.advanceTimersByTimeAsync(STEP_MS); // commit this ALREADY-in-flight step
    // The step that was already running when the update landed finishes on the data it started
    // with — g2 is still present. This step's commit was decided before the update arrived, so it
    // is not a new "hold boundary" reconciliation point.
    expect(rowIds()).toHaveLength(5);
    expect(rowIds()).toContain('home-row-g2');

    await vi.advanceTimersByTimeAsync(HOLD_MS); // the NEXT hold boundary — reconciliation applies now
    await vi.advanceTimersByTimeAsync(1);
    // g2 (taken) is gone and g7 (newly opened) is now a live candidate — both landed exactly here,
    // one hold after the update, never mid-slide.
    expect(rowIds()).not.toContain('home-row-g2');
    expect(rowIds()).toContain('home-row-g7');
  });
});

describe('OpenGames — prefers-reduced-motion', () => {
  it('shows a static snapshot of the visible set, never slides, even with many rows', async () => {
    stubReducedMotion(true);
    vi.useFakeTimers();
    render(<OpenGamesTicker challengesByGame={manyChallenges(8)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    expect(rowIds()).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(HOLD_MS + STEP_MS + HOLD_MS + STEP_MS);
    expect(rowIds()).toHaveLength(5); // still exactly 5, never 6 (no incoming ever mounts)
    expect(screen.getByTestId('home-ticker-zebra')).toBeInTheDocument(); // zebra still applies
  });
});

// Advisor #3: the uppercase header + LIVE badge collapse their line box (leading-none) so the
// caps center against the adjacent dot/icon under items-center.
describe('OpenGames — header leading (Advisor #3)', () => {
  it('the "Open Games" heading and the LIVE badge each carry leading-none', () => {
    render(<OpenGamesTicker challengesByGame={manyChallenges(1)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: 'Open Games' });
    expect(heading.className).toContain('leading-none');
    expect(heading.className).toContain('uppercase');
    const live = screen.getByText('Live');
    expect(live.className).toContain('leading-none');
    expect(live.className).toContain('items-center'); // dot alignment preserved
    // Advisor #9: badge nudged up ~3px to sit on the caps' optical centre.
    expect(live.className).toContain('-translate-y-[3px]');
  });
});

// ¢ stake formatting + text-success are unaffected by the redesign (no $/USDT crept in).
describe('OpenGames — stake formatting unaffected', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] }) as Response)));
  it('renders the ¢ stake in text-success, no $', () => {
    render(<OpenGamesTicker challengesByGame={manyChallenges(1)} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const stake = screen.getByTestId('home-stake-g1');
    expect(stake.textContent).toBe('10¢');
    expect(stake.className).toContain('text-success');
    expect(stake.textContent).not.toContain('$');
  });
});

describe('OpenGames — JOIN affordability + oldest-first ordering (regression)', () => {
  it('refuses clearly when the stake is uncovered, without taking', () => {
    const onTake = vi.fn();
    render(<OpenGamesTicker challengesByGame={{ coinflip: [challenge('g1', 'alice', 50, 0)] }} nameByGame={nameByGame} balance={5} onTake={onTake} />);
    fireEvent.click(screen.getByTestId('home-join-g1'));
    expect(onTake).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-ticker-notice').textContent).toMatch(/not enough/i);
  });

  it('merges per-game feeds oldest-first', () => {
    const challengesByGame = { coinflip: [challenge('c1', 'alice', 5, 100)], mines: [challenge('m1', 'bob', 25, 50)] };
    render(<OpenGamesTicker challengesByGame={challengesByGame} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    expect(rowIds()).toEqual(['home-row-m1', 'home-row-c1']); // m1 (openedAt 50) above c1 (openedAt 100)
  });
});

describe('OpenGames — logged-out (public) ticker', () => {
  it('renders real public challenges through the same flat/zebra body; JOIN captures the row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ ...challenge('p1', 'zed', 15, 0), gameId: 'coinflip' }] }) as Response));
    const onJoin = vi.fn();
    render(<PublicOpenGamesTicker nameByGame={nameByGame} onJoin={onJoin} onSignIn={vi.fn()} />);
    const body = await screen.findByTestId('home-ticker-body');
    expect(body.className).not.toContain('bg-surface');
    const within_ = within(body);
    expect(within_.getByTestId('home-row-p1')).toBeInTheDocument();
    fireEvent.click(within_.getByTestId('home-join-p1'));
    expect(onJoin).toHaveBeenCalledWith({ matchId: 'p1', gameId: 'coinflip', stake: 15 });
  });
});
