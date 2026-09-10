// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RewardsHubScreen } from '../screens/RewardsHub.js';
import type { RewardsSnapshot } from '@rapidclash/shared';

type Props = Parameters<typeof RewardsHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok',
    username: 'Bobbylee',
    balance: 1642,
    onHome: vi.fn(),
    onOpenProfile: vi.fn(),
    onOpenRewards: vi.fn(),
    onOpenAffiliate: vi.fn(),
    ...over,
  };
}

// Mirrors the design file's own placeholder persona (design-ref/games-and-rewards/, gitignored —
// transcribed in RewardsHub.tsx's module doc): 17,800 XP lands Bronze→Silver at exactly 64%,
// independently verified against the decoded template's own hardcoded `64%` — a strong signal
// the progress formula (band-relative, not absolute-over-nextTier) is the right one.
const BOBBYLEE_SNAPSHOT: RewardsSnapshot = {
  xpLifetime: 17_800,
  xpMonthly: 3_000,
  wageredLifetime: 18_400,
  claimableBalance: 25,
  tier: 'Bronze',
  rakebackRate: 0.04,
  nextTier: { tier: 'Silver', xpRequired: 25_000, rakebackRate: 0.07 },
};

// A brand-new player: below Wood, so a 0% rakeback rate and a claimable balance that is not just
// currently 0 but can never be anything else (issue #435's locked-state gate).
const UNRANKED_SNAPSHOT: RewardsSnapshot = {
  xpLifetime: 250,
  xpMonthly: 0,
  wageredLifetime: 0,
  claimableBalance: 0,
  tier: 'Unranked',
  rakebackRate: 0,
  nextTier: { tier: 'Wood', xpRequired: 500, rakebackRate: 0.01 },
};

// The first paying tier — one step above the gate, where the card must be fully live again.
const WOOD_SNAPSHOT: RewardsSnapshot = {
  xpLifetime: 800,
  xpMonthly: 800,
  wageredLifetime: 2_000,
  claimableBalance: 12,
  tier: 'Wood',
  rakebackRate: 0.01,
  nextTier: { tier: 'Bronze', xpRequired: 5_000, rakebackRate: 0.04 },
};

function stubFetch(snapshot: RewardsSnapshot, claimResponse?: { credited: number; newClaimableBalance: number }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/rewards/claim') && method === 'POST') {
      return { ok: true, json: async () => (claimResponse ?? { credited: snapshot.claimableBalance, newClaimableBalance: 0 }) } as Response;
    }
    if (u.includes('/rewards')) return { ok: true, json: async () => snapshot } as Response;
    if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1642, entries: [] }) } as Response;
    return { ok: true, json: async () => ({}) } as Response;
  }));
}

describe('RewardsHubScreen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows real username and lifetime XP from GET /rewards', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    expect(screen.getByTestId('rewards-username').textContent).toBe('@Bobbylee');
    await waitFor(() => expect(screen.getByTestId('rewards-xp').textContent).toBe('17,800'));
  });

  it('computes the VIP progress bar as the band-relative percent toward nextTier (Bronze→Silver at 17,800 XP = 64%, matching the design file exactly)', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-progress-pct').textContent).toBe('64%'));
    expect(screen.getByTestId('rewards-progress-bar').style.width).toBe('64%');
    expect(screen.getByTestId('rewards-tier-current').textContent).toContain('BRONZE');
    expect(screen.getByTestId('rewards-tier-next').textContent).toContain('SILVER');
  });

  it('reads 100% progress and "MAX" at the top of the ladder (Diamond, no nextTier)', async () => {
    stubFetch({ ...BOBBYLEE_SNAPSHOT, tier: 'Diamond', xpLifetime: 2_000_000, nextTier: undefined });
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-progress-pct').textContent).toBe('100%'));
    expect(screen.getByTestId('rewards-tier-next').textContent).toContain('MAX');
  });

  it('reads 0-500 XP as Unranked progress toward Wood (no tier badge, since the design has none below Wood)', async () => {
    stubFetch(UNRANKED_SNAPSHOT); // 250 of the 500 XP to Wood
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-progress-pct').textContent).toBe('50%'));
    expect(screen.getByTestId('rewards-tier-current').textContent).toContain('UNRANKED');
    expect(screen.getByTestId('rewards-tier-next').textContent).toContain('WOOD');
  });

  it('highlights the current tier column in the VIP_ROWS table (Bronze = index 1 → left: 226px)', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-tier-highlight')).toBeInTheDocument());
    // 150 (label column) + 76 * tierIndex(Bronze=1) = 226px — the design's own `tierMarkLeft` formula.
    expect(screen.getByTestId('rewards-tier-highlight').style.left).toBe('226px');
  });

  it('renders the real VIP_ROWS reference table verbatim (all 6 tiers, thresholds, rakeback rates)', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    const table = within(await screen.findByTestId('rewards-vip-table'));
    for (const label of ['WOOD', 'BRONZE', 'SILVER', 'GOLD', 'EMERALD', 'DIAMOND']) {
      expect(table.getByText(label)).toBeInTheDocument();
    }
    expect(table.getByText('1,500,000')).toBeInTheDocument(); // Diamond XP required
    expect(table.getByText('20%')).toBeInTheDocument(); // Diamond rakeback
  });

  it('the CLAIM button is wired to POST /rewards/claim, shows the real claimable balance, and zeroes it on success', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-claimable').textContent).toBe('25'));
    expect(screen.getByTestId('rewards-claim-button')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('rewards-claim-button'));
    await waitFor(() => expect(screen.getByTestId('rewards-claimable').textContent).toBe('0'));
    expect(screen.getByTestId('rewards-claim-button')).toBeDisabled();
  });

  it('a zero claimable balance renders the CLAIM button disabled (idempotent — nothing to claim)', async () => {
    stubFetch({ ...BOBBYLEE_SNAPSHOT, claimableBalance: 0 });
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-claimable').textContent).toBe('0'));
    expect(screen.getByTestId('rewards-claim-button')).toBeDisabled();
  });

  // Issue #435: Unranked earns 0% rakeback, so `claimableBalance` can only ever be 0 there — the
  // card must not read as a live, claimable one. The active-state testids (`rewards-claimable`,
  // `rewards-claim-button`) are deliberately absent in that state: there is no amount to show and
  // no claim to make, so asserting they still render would be asserting the bug.
  it('rakeback card renders the locked treatment at Unranked (no live amount, no claim button)', async () => {
    stubFetch(UNRANKED_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-rakeback-locked').textContent).toBe('Wager to unlock'));
    expect(screen.queryByTestId('rewards-claimable')).toBeNull();
    expect(screen.queryByTestId('rewards-claim-button')).toBeNull();
  });

  it('rakeback card is live again at the first paying tier (Wood, 1%) — real amount + working CLAIM', async () => {
    stubFetch(WOOD_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-claimable').textContent).toBe('12'));
    expect(screen.getByTestId('rewards-claim-button')).not.toBeDisabled();
    expect(screen.queryByTestId('rewards-rakeback-locked')).toBeNull();

    fireEvent.click(screen.getByTestId('rewards-claim-button'));
    await waitFor(() => expect(screen.getByTestId('rewards-claimable').textContent).toBe('0'));
    expect(screen.getByTestId('rewards-claim-button')).toBeDisabled();
  });

  // The Designer's requirement behind extracting the shared locked-state components: the two
  // cards must be identical in their locked state apart from title and illustration. Comparing
  // the rendered markup is what actually catches a future copy-paste divergence.
  it('both cards render the SAME locked treatment at Unranked (one shared component, not two copies)', async () => {
    stubFetch(UNRANKED_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-rakeback-locked')).toBeInTheDocument());

    const claimRows = screen.getAllByTestId('rewards-locked-claim');
    expect(claimRows).toHaveLength(2); // rakeback + volume bonus
    expect(claimRows[0].outerHTML).toBe(claimRows[1].outerHTML);

    // ...and the unlock copy above it matches too (same wording, same row styling).
    const rakeback = screen.getByTestId('rewards-rakeback-locked');
    const volume = screen.getByTestId('rewards-volume-progress');
    expect(rakeback.textContent).toBe(volume.textContent);
    expect(rakeback.getAttribute('style')).toBe(volume.getAttribute('style'));
  });

  it('only the volume bonus card is locked at a paying tier below Emerald', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT); // Bronze
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-claim-button')).toBeInTheDocument());
    expect(screen.getAllByTestId('rewards-locked-claim')).toHaveLength(1);
  });

  it('volume bonus card reads "Wager to unlock" below Emerald', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT); // Bronze
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-volume-progress').textContent).toBe('Wager to unlock'));
  });

  it('volume bonus card shows real monthly-XP progress toward the next milestone at Emerald+', async () => {
    stubFetch({ ...BOBBYLEE_SNAPSHOT, tier: 'Emerald', xpMonthly: 60_000 });
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-volume-progress').textContent).toBe('60,000 / 120,000 XP'));
  });

  it('volume bonus card reads "Max bonus reached" once the top Diamond milestone clears', async () => {
    stubFetch({ ...BOBBYLEE_SNAPSHOT, tier: 'Diamond', xpMonthly: 400_000 });
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-volume-progress').textContent).toBe('Max bonus reached'));
  });

  it('HubToolbar Rewards nav is active and Games/Account route out (App.tsx wiring, same pattern as ProfileHub/HomeHub)', async () => {
    const onHome = vi.fn();
    const onOpenProfile = vi.fn();
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps({ onHome, onOpenProfile })} />);
    await waitFor(() => expect(screen.getByTestId('rewards-xp')).toBeInTheDocument());
    expect(screen.getByTestId('hub-nav-rewards').getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByTestId('hub-nav-games'));
    expect(onHome).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('hub-nav-account'));
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it('Quests and the second (PLATINUM/TIERS) tier list render nothing — confirmed dead markup in the design file, not merely undone', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    const { container } = render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-xp')).toBeInTheDocument());
    expect(container.textContent ?? '').not.toMatch(/PLATINUM/i);
    expect(container.textContent ?? '').not.toMatch(/quest/i);
  });

  it('the XP Engine / Rakeback / Volume Bonus accordions open on click (collapsed → expanded grid-rows)', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-xp-engine-toggle')).toBeInTheDocument());
    // The toggle <span> is the sole child of its heading <div>; the collapsible content <div> is
    // that heading div's next sibling (AccordionShell renders the two as adjacent fragment children).
    const heading = screen.getByTestId('rewards-xp-engine-toggle').parentElement as HTMLElement;
    const panel = heading.nextElementSibling as HTMLElement;
    expect(panel.style.gridTemplateRows).toBe('0fr');
    fireEvent.click(screen.getByTestId('rewards-xp-engine-toggle'));
    expect(panel.style.gridTemplateRows).toBe('1fr');
  });

  it('is sanitized: no $ leaks into the game body (the header wallet chip legitimately shows the Owner-approved $ skin — CHARTER.md #4, issue #484)', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    const { container } = render(<RewardsHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('rewards-xp')).toBeInTheDocument());
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).not.toMatch(/\$/);
  });

  it('renders the shared footer (#323) between Bring a Rival and the bottom nav, wired to Games/Rewards', async () => {
    const onHome = vi.fn();
    const onOpenRewards = vi.fn();
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps({ onHome, onOpenRewards })} />);
    const footer = await screen.findByTestId('home-footer');
    expect(within(footer).getByText('JOIN THE COMMUNITY')).toBeInTheDocument();

    fireEvent.click(within(footer).getByText('Games'));
    expect(onHome).toHaveBeenCalled();
    fireEvent.click(within(footer).getByText('Rewards/VIP'));
    expect(onOpenRewards).toHaveBeenCalled();
  });

  // Issue #337: footer must be a sibling of the content div (a direct child of <main>, not
  // nested inside it) so it no longer inherits any parent-container spacing. DOM-structure only
  // — jsdom can't verify the actual rendered pixel gap, which needs a real browser.
  it('renders the footer as a sibling of the content div, directly under <main> (#337)', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    const main = screen.getByTestId('rewards-hub');
    const footer = await screen.findByTestId('home-footer');
    expect(footer.parentElement).toBe(main);
    const contentDiv = main.firstElementChild;
    expect(contentDiv).not.toBeNull();
    expect(contentDiv?.contains(footer)).toBe(false);
  });

  // Issue #342: the content div no longer needs HUB_BODY's toolbar-clearance padding — the
  // footer now reserves that space itself (see HubFooter.test.tsx).
  it('no longer carries the HUB_BODY toolbar-clearance padding on the content div (#342)', async () => {
    stubFetch(BOBBYLEE_SNAPSHOT);
    render(<RewardsHubScreen {...baseProps()} />);
    const main = screen.getByTestId('rewards-hub');
    await screen.findByTestId('home-footer');
    const contentDiv = main.firstElementChild;
    expect(contentDiv).not.toBeNull();
    expect(contentDiv?.className).not.toMatch(/pb-\[calc/);
  });
});
