// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HubFooter } from '../components/hub-shared/HubFooter.js';

describe('HubFooter (issue #323)', () => {
  it('renders the wordmark, heading, socials, link grid, disclaimer, copyright and 18+ row', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    expect(within(footer).getByAltText('RapidClash')).toBeInTheDocument();
    expect(within(footer).getByText('JOIN THE COMMUNITY')).toBeInTheDocument();
    for (const label of ['Discord', 'X', 'Telegram', 'Instagram']) {
      expect(within(footer).getByTestId(`home-social-${label.toLowerCase()}`)).toBeInTheDocument();
    }
    for (const heading of ['PLATFORM', 'FAIRNESS', 'SUPPORT', 'LEGAL']) {
      expect(within(footer).getByText(heading)).toBeInTheDocument();
    }
    for (const label of [
      'Games', 'Tournaments', 'Rewards/VIP', 'Leaderboards',
      'How it works', 'Provably fair', 'Fees & rake', 'Game rules',
      'Help center', 'Contact us', 'Responsible gaming', 'Complaint form',
      'Terms of Service', 'Privacy Policy', 'AML Policy', 'Responsible Gaming Policy',
    ]) {
      expect(within(footer).getByText(label)).toBeInTheDocument();
    }
    expect(footer).toHaveTextContent(/All rights reserved\./);
    expect(footer).toHaveTextContent(/Players vs Players, Never the House\./);
    expect(footer).toHaveTextContent(/18\+/);
    expect(footer.textContent ?? '').not.toMatch(/\$/);
  });

  it('only Games and Rewards/VIP navigate — every other link/icon has no onClick attached', () => {
    const onGames = vi.fn();
    const onRewards = vi.fn();
    render(<HubFooter onGames={onGames} onRewards={onRewards} />);
    const footer = screen.getByTestId('home-footer');

    fireEvent.click(within(footer).getByText('Games'));
    expect(onGames).toHaveBeenCalledTimes(1);
    fireEvent.click(within(footer).getByText('Rewards/VIP'));
    expect(onRewards).toHaveBeenCalledTimes(1);

    const inertLabels = [
      'Tournaments', 'Leaderboards', 'How it works', 'Provably fair', 'Fees & rake', 'Game rules',
      'Help center', 'Contact us', 'Responsible gaming', 'Complaint form',
      'Terms of Service', 'Privacy Policy', 'AML Policy', 'Responsible Gaming Policy',
    ];
    for (const label of inertLabels) {
      const el = within(footer).getByText(label);
      expect(el.onclick).toBeNull();
      // Visually identical treatment — same styling, cursor:pointer — just no handler wired.
      expect(el.className).toContain('cursor-pointer');
      fireEvent.click(el);
    }
    // The 14 inert clicks must never have reached the real callbacks.
    expect(onGames).toHaveBeenCalledTimes(1);
    expect(onRewards).toHaveBeenCalledTimes(1);

    // Social icons: no href, no onClick — visually a link, does nothing.
    for (const label of ['discord', 'x', 'telegram', 'instagram']) {
      const el = within(footer).getByTestId(`home-social-${label}`);
      expect(el.onclick).toBeNull();
      expect(el).not.toHaveAttribute('href');
      fireEvent.click(el);
    }
    expect(onGames).toHaveBeenCalledTimes(1);
    expect(onRewards).toHaveBeenCalledTimes(1);
  });

  it('renders inertly with no handlers when onGames/onRewards are omitted (both optional)', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    fireEvent.click(within(footer).getByText('Games'));
    fireEvent.click(within(footer).getByText('Rewards/VIP'));
    // No throw — nothing to assert beyond survival, since both props are optional.
    expect(footer).toBeInTheDocument();
  });
});
