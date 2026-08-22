// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ProfileHubScreen } from '../screens/ProfileHub.js';
import { setMuted, isMuted } from '../lib/sound.js';
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

function stubDefaultFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/rewards')) return { ok: true, json: async () => REWARDS } as Response;
    if (u.includes('/matches/recent')) return { ok: true, json: async () => matchesFetchResponse(u) } as Response;
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

  it('shows the profile card (alias + avatar) and the Bring a Rival banner', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    expect(screen.getByTestId('profile-username').textContent).toBe('alice');
    expect(screen.getByTestId('home-rival')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('profile-xp').textContent).toBe('17,800'));
  });

  it('LOG OUT is a standalone bottom pill (not nested in the profile card) and calls onLogout', () => {
    const onLogout = vi.fn();
    render(<ProfileHubScreen {...baseProps({ onLogout })} />);
    const logout = screen.getByTestId('profile-logout');
    expect(within(screen.getByTestId('profile-card')).queryByTestId('profile-logout')).toBeNull();
    fireEvent.click(logout);
    expect(onLogout).toHaveBeenCalled();
  });

  it('has the sound mute toggle outside the ribbon header, and toggling flips + persists global mute', () => {
    setMuted(false); // known baseline: sound ON
    const { container } = render(<ProfileHubScreen {...baseProps()} />);

    const toggle = screen.getByTestId('hub-mute-toggle');
    const ribbon = container.querySelector('header')!;
    expect(within(ribbon).queryByTestId('hub-mute-toggle')).toBeNull(); // never in the sticky ribbon

    expect(toggle.getAttribute('aria-pressed')).toBe('false'); // sound ON
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true'); // muted
    expect(window.localStorage.getItem('rc:sound:muted')).toBe('1'); // persisted
    expect(isMuted()).toBe(true); // global module state
    setMuted(false); // cleanup for other tests / files
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
      expect(win.getAttribute('style')).toContain('color: rgb(52, 211, 153)'); // #34D399
      // m2: loss, delta -52 → muted, no leading '+'.
      const loss = screen.getByTestId('profile-match-m2-amount');
      expect(loss.textContent).toContain('-52');
      expect(loss.getAttribute('style')).toContain('color: rgb(131, 131, 143)'); // #83838F
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
        return { ok: true, json: async () => ({}) } as Response;
      }));
      render(<ProfileHubScreen {...baseProps()} />);
      await waitFor(() => expect(screen.getByText(/No matches yet/)).toBeInTheDocument());
      expect(screen.queryByTestId('profile-matches-view-more')).toBeNull();
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

    it('the Affiliate row shows the same "coming soon" placeholder (real screen is a later ticket)', () => {
      render(<ProfileHubScreen {...baseProps()} />);
      fireEvent.click(screen.getByTestId('profile-affiliate'));
      expect(screen.getByTestId('profile-placeholder-toast').textContent).toMatch(/Affiliate program.*coming soon/);
    });

    it('the temporary #401 header icon-button entry point is fully gone (no leftover duplicate)', () => {
      render(<ProfileHubScreen {...baseProps({ onOpenPreferences: vi.fn() })} />);
      expect(screen.queryByTestId('profile-open-preferences')).toBeNull();
    });
  });

  it('is sanitized: no $ anywhere on the hub', async () => {
    const { container } = render(<ProfileHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('profile-xp').textContent).toBe('17,800'));
    await waitFor(() => expect(screen.getByTestId('profile-match-m1')).toBeInTheDocument());
    expect(container.textContent ?? '').not.toMatch(/\$/);
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
