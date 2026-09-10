// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ProfileHubScreen } from '../screens/ProfileHub.js';
import type { RecentMatchEntry, RewardsSnapshot } from '@rapidclash/shared';

type Props = Parameters<typeof ProfileHubScreen>[0];

const REWARDS: RewardsSnapshot = {
  xpLifetime: 17_800,
  xpMonthly: 1_000,
  wageredLifetime: 5_000,
  claimableBalance: 20,
  tier: 'Bronze',
  rakebackRate: 0.04,
  nextTier: { tier: 'Silver', xpRequired: 25_000, rakebackRate: 0.07 },
};

/** 12 rows — enough for 3 pages at the component's 5-per-page collapsed/expanded size
 *  (ceil(12/5) = 3), and enough (>5) to exercise the VIEW MORE/pagination path at all. */
const ALL_MATCHES: RecentMatchEntry[] = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1;
  const outcome: RecentMatchEntry['outcome'] = n % 3 === 0 ? 'draw' : n % 2 === 0 ? 'loss' : 'win';
  return {
    matchId: `m${n}`,
    gameId: n % 2 === 0 ? 'chess' : 'coinflip',
    opponentId: `p${n}`,
    opponentDisplayName: `rival${n}`,
    opponentAvatarId: 'default',
    // Not yet rendered (issue #441 handles the frontend); populated here only so this fixture
    // still satisfies the RecentMatchEntry type after issue #440 added the field.
    opponentTier: 'Unranked',
    outcome,
    delta: outcome === 'win' ? 100 + n : outcome === 'loss' ? -(50 + n) : 0,
    settledAt: `2026-08-${String((n % 28) + 1).padStart(2, '0')}T09:42:00Z`,
  };
});

function matchesFetchResponse(url: string) {
  const u = new URL(url, 'http://x');
  const limit = Number(u.searchParams.get('limit') ?? '20');
  const offset = Number(u.searchParams.get('offset') ?? '0');
  return { matches: ALL_MATCHES.slice(offset, offset + limit), limit, offset, total: ALL_MATCHES.length };
}

function stubDefaultFetch(walletBalance = 1009) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/rewards')) return { ok: true, json: async () => REWARDS } as Response;
    if (u.includes('/matches/recent')) return { ok: true, json: async () => matchesFetchResponse(u) } as Response;
    if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: walletBalance, entries: [] }) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok',
    username: 'alice',
    balance: 1009,
    onLogout: vi.fn(),
    onHome: vi.fn(),
    onOpenProfile: vi.fn(),
    onOpenRewards: vi.fn(),
    ...over,
  };
}

describe('ProfileHubScreen', () => {
  beforeEach(() => {
    stubDefaultFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the profile card (alias + avatar)', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    expect(screen.getByTestId('profile-username').textContent).toBe('alice');
    await waitFor(() => expect(screen.getByTestId('profile-xp').textContent).toBe('17,800'));
  });

  // Regression for a docs/code correction confirmed 2026-08-23: the design README previously
  // (incorrectly) listed a "Bring a rival" banner as the Account screen's block 1. The approved
  // prototype (`Account Page.dc.html`) never renders it inside `isAccount` — only inside
  // `isGames`/`isRewards` — and the company manager confirmed no banner belongs here.
  it('does not render the Bring a Rival banner (docs/code correction, 2026-08-23)', () => {
    render(<ProfileHubScreen {...baseProps()} />);
    expect(screen.queryByTestId('home-rival')).toBeNull();
  });

  // Regression test for a real bug found live 2026-08-22: on a resumed session, App.tsx's
  // `balance` state can be stale/0 (it's only ever set from a fresh login/register response or a
  // match.end settlement — there's no independent /wallet refetch at the App level). The OLD
  // ProfileHub.tsx masked this by always fetching /wallet on mount; #404's redesign dropped that
  // fetch along with the ledger-entries list it also powered, losing the balance-freshness side
  // effect. This asserts the Account page's balance always reflects a fresh /wallet fetch, not
  // whatever (possibly stale) value the `balance` prop happened to carry in.
  it('always shows the FRESH balance from /wallet, even when the balance prop is stale/zero (#404 regression)', async () => {
    stubDefaultFetch(940); // /wallet reports the real, current balance
    render(<ProfileHubScreen {...baseProps({ balance: 0 })} />); // prop simulates a stale resumed session
    await waitFor(() => expect(screen.getByTestId('hub-balance').textContent).toContain('940'));
  });

  it('LOG OUT is a standalone bottom pill (not nested in the profile card) and calls onLogout', () => {
    const onLogout = vi.fn();
    render(<ProfileHubScreen {...baseProps({ onLogout })} />);
    const logout = screen.getByTestId('profile-logout');
    expect(within(screen.getByTestId('profile-card')).queryByTestId('profile-logout')).toBeNull();
    fireEvent.click(logout);
    expect(onLogout).toHaveBeenCalled();
  });

  // Issue #418: the sound-mute control isn't spec'd anywhere on the Account page — it's moved to
  // Preferences' own "Game sounds" toggle (see PreferencesHub.test.tsx), which now drives the
  // real lib/sound.ts module. This just asserts the Account page no longer renders one.
  it('renders no sound/mute control (moved to Preferences, issue #418)', () => {
    render(<ProfileHubScreen {...baseProps()} />);
    expect(screen.queryByTestId('hub-mute-toggle')).toBeNull();
  });

  // Regression for the CONTROLS icon fix (Advisor drop 2026-08-23#2): the row icons/chevron were
  // lucide-react outline glyphs — a visible mismatch against the design's solid-fill-with-knockout
  // art. Every row icon is now a solid <path>/<rect>/<circle> fill, not a stroke-only lucide SVG.
  it('CONTROLS row icons are solid-fill SVGs, not lucide outline glyphs (icon fix)', () => {
    render(<ProfileHubScreen {...baseProps()} />);
    for (const key of ['account-details', 'verification', 'security', 'preferences', 'responsible-gaming', 'blocked-players', 'help-support']) {
      const row = screen.getByTestId(`profile-control-${key}`);
      const svg = row.querySelector('svg')!;
      expect(svg).toBeInTheDocument();
      // lucide icons default to stroke="currentColor" fill="none" on the <svg> itself; the
      // restored design icons never set stroke on the <svg> root and always carry a solid fill
      // on their child shapes.
      expect(svg.getAttribute('stroke')).toBeNull();
      expect(svg.querySelector('[fill]')).toBeInTheDocument();
    }
    const affiliateRow = screen.getByTestId('profile-affiliate');
    expect(affiliateRow.querySelector('svg')?.getAttribute('stroke')).toBeNull();
  });

  it('renders the shared Avatar (not initials) in the profile card', () => {
    render(<ProfileHubScreen {...baseProps()} />);
    const card = within(screen.getByTestId('profile-card'));
    expect(card.getByTestId('avatar')).toBeInTheDocument();
    expect(card.queryByTestId('avatar-glyph')).toBeInTheDocument(); // darkened silhouette, not initials
    expect(card.getByTestId('profile-username').textContent).toBe('alice');
  });

  it('profile card renders the player\'s OWN avatar preset (avatarId prop)', () => {
    render(<ProfileHubScreen {...baseProps({ avatarId: 'boy-brown' })} />);
    const card = within(screen.getByTestId('profile-card'));
    expect(card.getByTestId('avatar').getAttribute('data-avatar-id')).toBe('boy-brown');
    expect(card.getByTestId('avatar-img')).toBeInTheDocument(); // a preset image, not the glyph
  });

  describe('avatar picker (Advisor #12 ii)', () => {
    it('tapping the avatar opens the bg-surface overlay with the default + 6 presets', () => {
      render(<ProfileHubScreen {...baseProps()} />);
      expect(screen.queryByTestId('avatar-picker')).toBeNull();
      fireEvent.click(screen.getByTestId('profile-avatar-button'));
      const picker = screen.getByTestId('avatar-picker');
      expect(picker).toBeInTheDocument();
      expect(picker.querySelector('.bg-surface')).not.toBeNull();
      for (const id of ['default', 'boy-light', 'girl-light', 'boy-brown', 'boy-dark', 'hooded-mono', 'hooded-degen']) {
        expect(screen.getByTestId(`avatar-option-${id}`)).toBeInTheDocument();
      }
    });

    it('selecting a preset shows the purple ring-brand selection ring', () => {
      render(<ProfileHubScreen {...baseProps({ avatarId: 'default' })} />);
      fireEvent.click(screen.getByTestId('profile-avatar-button'));
      const option = screen.getByTestId('avatar-option-boy-dark');
      fireEvent.click(option);
      expect(option.getAttribute('aria-pressed')).toBe('true');
      expect(option.className).toContain('ring-brand');
    });

    it('Save calls api.setAvatar, bubbles the id via onAvatarChange, and closes the overlay', async () => {
      const setAvatarCalls: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/auth/avatar')) {
          const sent = JSON.parse(String(init?.body)).avatarId as string;
          setAvatarCalls.push(sent);
          return { ok: true, json: async () => ({ avatarId: sent }) } as Response;
        }
        if (u.includes('/rewards')) return { ok: true, json: async () => REWARDS } as Response;
        if (u.includes('/matches/recent')) return { ok: true, json: async () => matchesFetchResponse(u) } as Response;
        if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1009, entries: [] }) } as Response;
        return { ok: true, json: async () => ({}) } as Response;
      }));
      const onAvatarChange = vi.fn();
      render(<ProfileHubScreen {...baseProps({ avatarId: 'default', onAvatarChange })} />);

      fireEvent.click(screen.getByTestId('profile-avatar-button'));
      fireEvent.click(screen.getByTestId('avatar-option-girl-light'));
      fireEvent.click(screen.getByTestId('avatar-picker-save'));

      await waitFor(() => expect(setAvatarCalls).toEqual(['girl-light']));
      expect(onAvatarChange).toHaveBeenCalledWith('girl-light');
      await waitFor(() => expect(screen.queryByTestId('avatar-picker')).toBeNull());
    });
  });

  describe('VIP progress card', () => {
    it('renders XP, progress %, and current/next tier from the /rewards snapshot', async () => {
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByTestId('profile-xp').textContent).toBe('17,800'));
      // Bronze (5,000) → Silver (25,000) at 17,800 XP = 64%, same math as RewardsHub.tsx.
      expect(screen.getByTestId('profile-vip-pct').textContent).toBe('64%');
      expect(screen.getByTestId('profile-vip-bar').getAttribute('style')).toContain('width: 64%');
      expect(screen.getByTestId('profile-vip-tier-current').textContent).toContain('BRONZE');
      expect(screen.getByTestId('profile-vip-tier-next').textContent).toContain('SILVER');
    });

    it('reads 0/Unranked sensibly before the snapshot resolves (no undefined/NaN) — same "no nextTier yet" contract as RewardsHub.tsx\'s top-of-ladder case', () => {
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))); // never resolves
      render(<ProfileHubScreen {...baseProps()} />);
      expect(screen.getByTestId('profile-xp').textContent).toBe('0');
      expect(screen.getByTestId('profile-vip-pct').textContent).toBe('100%');
      expect(screen.getByTestId('profile-vip-tier-current').textContent).toContain('UNRANKED');
      expect(screen.getByTestId('profile-vip-tier-next').textContent).toContain('MAX');
    });
  });

  describe('recent games', () => {
    it('renders rows from /matches/recent with win (green) vs loss (muted) coloring', async () => {
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByTestId('profile-match-m1')).toBeInTheDocument());
      // m1: win, delta 101 → green, signed '+'.
      const win = screen.getByTestId('profile-match-m1-amount');
      expect(win.textContent).toContain('+101');
      expect(win.getAttribute('style')).toContain('color: var(--rc-green)'); // issue #491: RC.green now aliases the shared token
      // m2: loss, delta -52 → muted, no leading '+'.
      const loss = screen.getByTestId('profile-match-m2-amount');
      expect(loss.textContent).toContain('-52');
      expect(loss.getAttribute('style')).toContain('color: var(--rc-muted)'); // issue #491: RC.muted now aliases the shared token
    });

    it('collapsed view shows a VIEW MORE pill; expanding reveals numbered page pills + VIEW LESS', async () => {
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByTestId('profile-match-m1')).toBeInTheDocument());
      expect(screen.getByTestId('profile-matches-view-more')).toBeInTheDocument();
      expect(screen.queryByTestId('profile-matches-page-1')).toBeNull();

      fireEvent.click(screen.getByTestId('profile-matches-view-more'));
      // 12 total / 5 per page = 3 pages.
      expect(screen.getByTestId('profile-matches-page-1')).toBeInTheDocument();
      expect(screen.getByTestId('profile-matches-page-2')).toBeInTheDocument();
      expect(screen.getByTestId('profile-matches-page-3')).toBeInTheDocument();
      expect(screen.getByTestId('profile-matches-view-less')).toBeInTheDocument();
      expect(screen.queryByTestId('profile-matches-view-more')).toBeNull();

      fireEvent.click(screen.getByTestId('profile-matches-view-less'));
      expect(screen.getByTestId('profile-matches-view-more')).toBeInTheDocument();
      expect(screen.queryByTestId('profile-matches-page-1')).toBeNull();
    });

    it('clicking a page pill re-fetches that offset', async () => {
      const fetchMock = vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/rewards')) return { ok: true, json: async () => REWARDS } as Response;
        if (u.includes('/matches/recent')) return { ok: true, json: async () => matchesFetchResponse(u) } as Response;
        if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1009, entries: [] }) } as Response;
        return { ok: true, json: async () => ({}) } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByTestId('profile-match-m1')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('profile-matches-view-more'));
      fireEvent.click(screen.getByTestId('profile-matches-page-2'));

      await waitFor(() => expect(screen.getByTestId('profile-match-m6')).toBeInTheDocument());
      const calledOffset5 = fetchMock.mock.calls.some(([url]) => String(url).includes('/matches/recent') && String(url).includes('offset=5'));
      expect(calledOffset5).toBe(true);
    });

    it('shows an empty state and no VIEW MORE when there are no matches yet', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/rewards')) return { ok: true, json: async () => REWARDS } as Response;
        if (u.includes('/matches/recent')) return { ok: true, json: async () => ({ matches: [], limit: 5, offset: 0, total: 0 }) } as Response;
        if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1009, entries: [] }) } as Response;
        return { ok: true, json: async () => ({}) } as Response;
      }));
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByText(/No matches yet/)).toBeInTheDocument());
      expect(screen.queryByTestId('profile-matches-view-more')).toBeNull();
    });
  });

  // Issue #441: zebra rows (matching GamesCarousel.tsx's Open Games rows exactly), the bot-glyph
  // strip + '@' normalize helper, and VS colored by outcome.
  describe('recent games — zebra rows, opponent normalize, VS color (#441)', () => {
    const ZEBRA_MATCHES: RecentMatchEntry[] = [
      { matchId: 'z1', gameId: 'coinflip', opponentId: 'p1', opponentDisplayName: '🤖 rival1', opponentAvatarId: 'default', opponentTier: 'Unranked', outcome: 'win', delta: 50, settledAt: '2026-08-01T09:00:00Z' },
      { matchId: 'z2', gameId: 'chess', opponentId: 'p2', opponentDisplayName: 'rival2', opponentAvatarId: 'default', opponentTier: 'Unranked', outcome: 'loss', delta: -30, settledAt: '2026-08-02T09:00:00Z' },
      { matchId: 'z3', gameId: 'coinflip', opponentId: 'p3', opponentDisplayName: '@rival3', opponentAvatarId: 'default', opponentTier: 'Unranked', outcome: 'draw', delta: 0, settledAt: '2026-08-03T09:00:00Z' },
      { matchId: 'z4', gameId: 'chess', opponentId: 'p4', opponentDisplayName: '🤖rival4', opponentAvatarId: 'default', opponentTier: 'Unranked', outcome: 'win', delta: 20, settledAt: '2026-08-04T09:00:00Z' },
    ];

    function stubZebraFetch() {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/rewards')) return { ok: true, json: async () => REWARDS } as Response;
        if (u.includes('/matches/recent')) return { ok: true, json: async () => ({ matches: ZEBRA_MATCHES, limit: 5, offset: 0, total: ZEBRA_MATCHES.length }) } as Response;
        if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1009, entries: [] }) } as Response;
        return { ok: true, json: async () => ({}) } as Response;
      }));
    }

    // Regression: these literals must match GamesCarousel.tsx's Open Games row styling exactly
    // (height: '74px', gap: '11px', background/borderRadius keyed off even/odd index, padding
    // '0 16px') — see the `g.zebra ? '#1A1A2E' : 'transparent'` / `g.zebra ? '26px' : '0px'` row
    // around line 553 of that file.
    it('rows alternate the GamesCarousel zebra fill/radius by index, with no gap between rows', async () => {
      stubZebraFetch();
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByTestId('profile-match-z1')).toBeInTheDocument());

      const even = screen.getByTestId('profile-match-z1'); // index 0 — filled
      const evenStyle = even.getAttribute('style') ?? '';
      expect(evenStyle).toContain('height: 74px');
      expect(evenStyle).toContain('gap: 11px');
      expect(evenStyle).toContain('padding: 0px 16px');
      expect(evenStyle).toContain('background: var(--rc-surface)'); // issue #491: RC.surface now aliases the shared token
      expect(evenStyle).toContain('border-radius: 26px');

      const odd = screen.getByTestId('profile-match-z2'); // index 1 — transparent
      const oddStyle = odd.getAttribute('style') ?? '';
      expect(oddStyle).toContain('background: transparent');
      expect(oddStyle).toContain('border-radius: 0px');

      // No `gap` on the rows' flex container — each row supplies its own spacing via height/fill.
      const container = even.parentElement!;
      expect(container.getAttribute('style')).toContain('gap: 0;');
    });

    it('normalizes opponent names: strips a leading 🤖 (with or without a space) and any leading @, then always prepends exactly one @', async () => {
      stubZebraFetch();
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByTestId('profile-match-z1')).toBeInTheDocument());

      expect(within(screen.getByTestId('profile-match-z1')).getByText('@rival1')).toBeInTheDocument(); // '🤖 rival1' → '@rival1'
      expect(within(screen.getByTestId('profile-match-z2')).getByText('@rival2')).toBeInTheDocument(); // 'rival2' (missing '@') → '@rival2'
      expect(within(screen.getByTestId('profile-match-z3')).getByText('@rival3')).toBeInTheDocument(); // '@rival3' (already correct) → '@rival3'
      expect(within(screen.getByTestId('profile-match-z4')).getByText('@rival4')).toBeInTheDocument(); // '🤖rival4' (no space) → '@rival4'

      // The raw 🤖 glyph itself never reaches the DOM.
      expect(screen.getByTestId('profile-hub').textContent ?? '').not.toContain('🤖');
    });

    it('colors VS green on a win, white on a loss, and the existing muted grey on a draw', async () => {
      stubZebraFetch();
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByTestId('profile-match-z1')).toBeInTheDocument());

      const winVs = within(screen.getByTestId('profile-match-z1')).getByText('VS');
      expect(winVs.getAttribute('style')).toContain('color: var(--rc-green)'); // issue #491: RC.green now aliases the shared token

      const lossVs = within(screen.getByTestId('profile-match-z2')).getByText('VS');
      expect(lossVs.getAttribute('style')).toContain('color: var(--rc-text)'); // issue #491: RC.text now aliases the shared token

      const drawVs = within(screen.getByTestId('profile-match-z3')).getByText('VS');
      expect(drawVs.getAttribute('style')).toContain('color: var(--rc-muted)'); // issue #491: RC.muted now aliases the shared token
    });

    // #440 (the parallel backend ticket adding `opponentTier`) may not have merged when this
    // ships — a match with no `opponentTier` field must still render cleanly, with no tier icon
    // and no placeholder/reserved gap for one.
    it('omits the tier icon entirely when opponentTier is absent/Unranked (guards #440 not being merged yet)', async () => {
      stubZebraFetch();
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByTestId('profile-match-z1')).toBeInTheDocument());
      const row = screen.getByTestId('profile-match-z1');
      // None of these fixture rows carry `opponentTier` — the row's only two <svg>s are the
      // opponent's default-avatar glyph (`Avatar`'s `PersonGlyph`) and the credits `RcIcon` next
      // to the settlement delta; neither is a tier icon, and no third <svg> (a `TierIcon`) exists.
      expect(row.querySelectorAll('svg')).toHaveLength(2);
    });

    // Forward-compat: once #440 lands `opponentTier` on the real `RecentMatchEntry`/wire
    // response, a ranked opponent's row must pick it up and render the shared `TierIcon` — this
    // stands in for that not-yet-existing field via a loosened fixture cast.
    it('renders the opponent TierIcon once an opponentTier field is present and not Unranked (forward-compat for #440)', async () => {
      const rankedMatch = { ...ZEBRA_MATCHES[0], matchId: 'z-ranked', opponentTier: 'Gold' } as RecentMatchEntry;
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/rewards')) return { ok: true, json: async () => REWARDS } as Response;
        if (u.includes('/matches/recent')) return { ok: true, json: async () => ({ matches: [rankedMatch], limit: 5, offset: 0, total: 1 }) } as Response;
        if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1009, entries: [] }) } as Response;
        return { ok: true, json: async () => ({}) } as Response;
      }));
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByTestId('profile-match-z-ranked')).toBeInTheDocument());
      const row = screen.getByTestId('profile-match-z-ranked');
      // Avatar glyph + RcIcon (both present in the Unranked case above) + one more for the tier
      // icon = 3.
      expect(row.querySelectorAll('svg')).toHaveLength(3);
    });
  });

  describe('CONTROLS / Affiliate', () => {
    it('renders every CONTROLS row plus the Affiliate row', () => {
      render(<ProfileHubScreen {...baseProps()} />);
      for (const key of ['account-details', 'verification', 'security', 'preferences', 'responsible-gaming', 'blocked-players', 'help-support']) {
        expect(screen.getByTestId(`profile-control-${key}`)).toBeInTheDocument();
      }
      expect(screen.getByTestId('profile-affiliate')).toBeInTheDocument();
    });

    it('Preferences routes to the real screen via onOpenPreferences (not a placeholder)', () => {
      const onOpenPreferences = vi.fn();
      render(<ProfileHubScreen {...baseProps({ onOpenPreferences })} />);
      fireEvent.click(screen.getByTestId('profile-control-preferences'));
      expect(onOpenPreferences).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('profile-placeholder-toast')).toBeNull();
    });

    it('every non-Preferences CONTROLS row shows a "coming soon" placeholder instead of a real destination', () => {
      render(<ProfileHubScreen {...baseProps()} />);
      fireEvent.click(screen.getByTestId('profile-control-verification'));
      expect(screen.getByTestId('profile-placeholder-toast').textContent).toMatch(/Verification.*coming soon/);
    });

    // Issue #423: the Affiliate row now routes to the real Affiliate screen via onOpenAffiliate —
    // no longer the shared placeholder toast.
    it('Affiliate routes to the real screen via onOpenAffiliate (not a placeholder)', () => {
      const onOpenAffiliate = vi.fn();
      render(<ProfileHubScreen {...baseProps({ onOpenAffiliate })} />);
      fireEvent.click(screen.getByTestId('profile-affiliate'));
      expect(onOpenAffiliate).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('profile-placeholder-toast')).toBeNull();
    });

    it('the temporary #401 header icon-button entry point is fully gone (no leftover duplicate)', () => {
      render(<ProfileHubScreen {...baseProps({ onOpenPreferences: vi.fn() })} />);
      expect(screen.queryByTestId('profile-open-preferences')).toBeNull();
    });
  });

  it('is sanitized: no $ leaks into the game body (the header wallet chip legitimately shows the Owner-approved $ skin — CHARTER.md #4, issue #484)', async () => {
    const { container } = render(<ProfileHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('profile-xp').textContent).toBe('17,800'));
    await waitFor(() => expect(screen.getByTestId('profile-match-m1')).toBeInTheDocument());
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).not.toMatch(/\$/);
  });

  it('renders the shared footer (#323), wired to Games/Rewards, replacing the old inline footer', async () => {
    const onHome = vi.fn();
    const onOpenRewards = vi.fn();
    const { container } = render(<ProfileHubScreen {...baseProps({ onHome, onOpenRewards })} />);
    const footer = await screen.findByTestId('home-footer');
    expect(within(footer).getByText('JOIN THE COMMUNITY')).toBeInTheDocument();

    fireEvent.click(within(footer).getByText('Games'));
    expect(onHome).toHaveBeenCalled();
    fireEvent.click(within(footer).getByText('Rewards/VIP'));
    expect(onOpenRewards).toHaveBeenCalled();

    expect(container.querySelectorAll('footer')).toHaveLength(1);
    expect(container.textContent ?? '').not.toMatch(/play-money demo\./i);
  });

  // Issue #337: footer must be a sibling of the gapped `flex flex-col gap-5` content div, not
  // its last gapped child, so the parent's gap no longer stacks on top of the gradient's own
  // margin. DOM-structure only — jsdom can't verify the actual rendered pixel gap.
  it('renders the footer as a sibling of the gapped content div, directly under <main> (#337)', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    const main = screen.getByTestId('profile-hub');
    const footer = await screen.findByTestId('home-footer');
    expect(footer.parentElement).toBe(main);
    const gappedDiv = main.querySelector('.gap-5');
    expect(gappedDiv).not.toBeNull();
    expect(gappedDiv?.contains(footer)).toBe(false);
  });

  // Issue #342: the content div no longer needs HUB_BODY's toolbar-clearance padding — the
  // footer now reserves that space itself (see HubFooter.test.tsx).
  it('no longer carries the HUB_BODY toolbar-clearance padding on the content div (#342)', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    const main = screen.getByTestId('profile-hub');
    await screen.findByTestId('home-footer');
    const gappedDiv = main.querySelector('.gap-5');
    expect(gappedDiv).not.toBeNull();
    expect(gappedDiv?.className).not.toMatch(/pb-\[calc/);
  });
});
