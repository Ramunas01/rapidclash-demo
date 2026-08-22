// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AffiliateHubScreen } from '../screens/AffiliateHub.js';
import { ProfileHubScreen } from '../screens/ProfileHub.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';

type Props = Parameters<typeof AffiliateHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    username: 'alice',
    balance: 1642,
    onBack: vi.fn(),
    onHome: vi.fn(),
    onOpenProfile: vi.fn(),
    onOpenRewards: vi.fn(),
    onOpenAffiliate: vi.fn(),
    ...over,
  };
}

function stubClipboard() {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('AffiliateHubScreen — entry points (issue #423)', () => {
  it("ProfileHub's Affiliate row routes here via onOpenAffiliate, not the placeholder toast", () => {
    const onOpenAffiliate = vi.fn();
    render(
      <ProfileHubScreen
        token="tok"
        username="alice"
        balance={1000}
        onLogout={vi.fn()}
        onHome={vi.fn()}
        onOpenProfile={vi.fn()}
        onOpenRewards={vi.fn()}
        onOpenAffiliate={onOpenAffiliate}
      />,
    );
    fireEvent.click(screen.getByTestId('profile-affiliate'));
    expect(onOpenAffiliate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('profile-placeholder-toast')).toBeNull();
  });

  it("Menu overlay's EARN → Affiliate program row routes here via onOpenAffiliate", () => {
    const onOpenAffiliate = vi.fn();
    function Harness() {
      const menu = useMenuOverlay();
      return (
        <>
          <HubToolbar onGames={vi.fn()} onAccount={vi.fn()} onRewards={vi.fn()} onMenu={menu.onMenu} active={menu.open ? 'menu' : 'games'} />
          <MenuOverlay open={menu.open} anchorRect={menu.anchorRect} onClose={menu.close} onOpenGames={vi.fn()} onOpenRewards={vi.fn()} onOpenAffiliate={onOpenAffiliate} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByTestId('hub-nav-menu'));
    fireEvent.click(screen.getByTestId('menu-row-affiliate'));
    expect(onOpenAffiliate).toHaveBeenCalledTimes(1);
  });
});

describe('AffiliateHubScreen — tabs', () => {
  it('defaults to OVERVIEW and switches tabs on tap', () => {
    render(<AffiliateHubScreen {...baseProps()} />);
    expect(screen.getByTestId('affiliate-tab-overview').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('affiliate-copy-link')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('affiliate-tab-earnings'));
    expect(screen.getByTestId('affiliate-tab-earnings').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('affiliate-tab-overview').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('affiliate-claim')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('affiliate-tab-referred-users'));
    expect(screen.getByTestId('affiliate-referred-empty')).toHaveTextContent('No referred users');

    fireEvent.click(screen.getByTestId('affiliate-tab-campaigns'));
    expect(screen.getByTestId('affiliate-create-campaign')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('affiliate-tab-material'));
    expect(screen.getByTestId('affiliate-material-empty')).toBeInTheDocument();
    expect(screen.getByTestId('affiliate-material-empty')).toBeEmptyDOMElement();
  });

  it('back button calls onBack', () => {
    const onBack = vi.fn();
    render(<AffiliateHubScreen {...baseProps({ onBack })} />);
    fireEvent.click(screen.getByTestId('affiliate-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('AffiliateHubScreen — expandable rows', () => {
  it('the commission structure row expands and collapses independently', () => {
    render(<AffiliateHubScreen {...baseProps()} />);
    const row = screen.getByTestId('affiliate-commission');
    const grid = row.parentElement!.querySelector('div[style*="grid-template-rows"]') as HTMLElement;
    expect(grid.style.gridTemplateRows).toBe('0fr');
    fireEvent.click(row);
    expect(grid.style.gridTemplateRows).toBe('1fr');
    expect(screen.getByText(/Rake % × wagered × Commission rate/)).toBeInTheDocument();
    fireEvent.click(row);
    expect(grid.style.gridTemplateRows).toBe('0fr');
  });

  it('the three "how to get started" steps expand independently', () => {
    render(<AffiliateHubScreen {...baseProps()} />);
    const step1Grid = screen.getByTestId('affiliate-step-1').nextElementSibling as HTMLElement;
    const step2Grid = screen.getByTestId('affiliate-step-2').nextElementSibling as HTMLElement;
    expect(step1Grid.style.gridTemplateRows).toBe('0fr');

    fireEvent.click(screen.getByTestId('affiliate-step-1'));
    expect(step1Grid.style.gridTemplateRows).toBe('1fr');
    // Step 2 stays collapsed — independent state, not a shared accordion.
    expect(step2Grid.style.gridTemplateRows).toBe('0fr');
  });
});

describe('AffiliateHubScreen — clipboard copy', () => {
  it('OVERVIEW link/code COPY buttons write to the clipboard and show the toast', () => {
    const writeText = stubClipboard();
    render(<AffiliateHubScreen {...baseProps()} />);
    fireEvent.click(screen.getByTestId('affiliate-copy-link'));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('affiliate-toast')).toHaveTextContent('COPIED TO CLIPBOARD');

    fireEvent.click(screen.getByTestId('affiliate-copy-code'));
    expect(writeText).toHaveBeenCalledTimes(2);
  });
});

describe('AffiliateHubScreen — campaigns', () => {
  beforeEach(() => stubClipboard());

  it('seeds two starting campaigns per screenshots/campaigns-01-list.png', () => {
    render(<AffiliateHubScreen {...baseProps()} />);
    fireEvent.click(screen.getByTestId('affiliate-tab-campaigns'));
    expect(screen.getByText('bobbylee')).toBeInTheDocument();
    expect(screen.getByText('winorgohome')).toBeInTheDocument();
  });

  it('an existing campaign expands and its link/code can be copied', () => {
    const writeText = stubClipboard();
    render(<AffiliateHubScreen {...baseProps()} />);
    fireEvent.click(screen.getByTestId('affiliate-tab-campaigns'));
    const card = screen.getByTestId('affiliate-campaign-seed-2');
    const grid = screen.getByTestId('affiliate-campaign-seed-2-toggle').nextElementSibling as HTMLElement;
    expect(grid.style.gridTemplateRows).toBe('0fr');
    fireEvent.click(screen.getByTestId('affiliate-campaign-seed-2-toggle'));
    expect(grid.style.gridTemplateRows).toBe('1fr');
    expect(within(card).getByText('Signups')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('affiliate-campaign-seed-2-copy-link'));
    expect(writeText).toHaveBeenCalledWith('rapidclash.com/r/WINORGOHOME');
  });

  it('validates the campaign name on blur, and a valid submit adds it to the list', () => {
    render(<AffiliateHubScreen {...baseProps()} />);
    fireEvent.click(screen.getByTestId('affiliate-tab-campaigns'));
    fireEvent.click(screen.getByTestId('affiliate-create-campaign'));
    const sheet = screen.getByTestId('affiliate-create-sheet');
    expect(sheet).toBeInTheDocument();

    const input = screen.getByTestId('affiliate-campaign-name-input');
    const submit = screen.getByTestId('affiliate-create-sheet-submit');
    expect(submit).toBeDisabled();

    // Blur empty → validation error.
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(screen.getByTestId('affiliate-campaign-name-error')).toHaveTextContent('Campaign name is required');

    // Typing clears the error.
    fireEvent.change(input, { target: { value: 'My Stream' } });
    expect(screen.queryByTestId('affiliate-campaign-name-error')).not.toBeInTheDocument();
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(screen.getByTestId('affiliate-toast')).toHaveTextContent('CAMPAIGN CREATED');

    const list = screen.getByTestId('affiliate-campaign-list');
    expect(within(list).getByText('My Stream')).toBeInTheDocument();
  });
});

describe('AffiliateHubScreen — earnings claim flow', () => {
  it('CLAIM is pressable against a seeded non-zero balance, resets to 0, and adds a claim-history row', () => {
    render(<AffiliateHubScreen {...baseProps()} />);
    fireEvent.click(screen.getByTestId('affiliate-tab-earnings'));

    const claimBtn = screen.getByTestId('affiliate-claim');
    expect(claimBtn).not.toBeDisabled();
    expect(screen.getByTestId('affiliate-claim-history-empty')).toBeInTheDocument();

    fireEvent.click(claimBtn);

    expect(claimBtn).toBeDisabled();
    expect(screen.getByTestId('affiliate-toast')).toHaveTextContent('COMMISSION CLAIMED');
    expect(screen.getByTestId('affiliate-claim-history')).toBeInTheDocument();
    expect(screen.queryByTestId('affiliate-claim-history-empty')).not.toBeInTheDocument();
  });
});
