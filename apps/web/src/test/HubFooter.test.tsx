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

describe('HubFooter drift fixes (issue #333)', () => {
  it('renders the verbatim Discord path at 21x21, balanced within its own viewBox', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const discord = within(footer).getByTestId('home-social-discord');
    const svg = discord.querySelector('svg');
    expect(svg).toHaveAttribute('width', '21');
    expect(svg).toHaveAttribute('height', '21');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    const path = svg?.querySelector('path');
    expect(path).toHaveAttribute(
      'd',
      'M20 5.3A17 17 0 0 0 15.9 4l-.4.8a12.6 12.6 0 0 0-7 0L8.1 4A17 17 0 0 0 4 5.3C1.4 9.2.7 13 1 16.8A16.9 16.9 0 0 0 6.2 19l.9-1.5c-.6-.2-1.2-.5-1.7-.9l.4-.3a12.1 12.1 0 0 0 10.4 0l.4.3c-.5.4-1.1.7-1.7.9l.9 1.5a16.8 16.8 0 0 0 5.2-2.2c.4-4.4-.7-8.2-3-11.5ZM8.4 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.2 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z',
    );
  });

  it('leaves X, Telegram, and Instagram icons untouched (out of scope for #333)', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const x = within(footer).getByTestId('home-social-x').querySelector('svg');
    expect(x).toHaveAttribute('width', '17');
    expect(x).toHaveAttribute('height', '17');
    const telegram = within(footer).getByTestId('home-social-telegram').querySelector('svg');
    expect(telegram).toHaveAttribute('width', '20');
    expect(telegram).toHaveAttribute('height', '20');
    const instagram = within(footer).getByTestId('home-social-instagram').querySelector('svg');
    expect(instagram).toHaveAttribute('width', '20');
    expect(instagram).toHaveAttribute('height', '20');
  });

  it('uses the bg-surface token for the footer CONTENT wrapper background, not bg-background (issue #346: <footer> itself is now transparent)', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const content = within(footer).getByTestId('home-footer-content');
    expect(content.className).toContain('bg-surface');
    expect(content.className).not.toContain('bg-background');
    // <footer> itself no longer carries a background at all — it must stay transparent so the
    // gradient div's 0% stop composites against the page's real black, not navy-on-navy (#346).
    expect(footer.className).not.toContain('bg-surface');
    expect(footer.className).not.toContain('bg-background');
  });

  it('renders a gradient band, first inside <footer>, before the wordmark, with the exact spec stops/height/margin', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const gradient = within(footer).getByTestId('home-footer-gradient');
    expect(gradient).toHaveAttribute('aria-hidden', 'true');
    // First element child of <footer>, and precedes the wordmark image.
    expect(footer.firstElementChild).toBe(gradient);
    const wordmark = within(footer).getByAltText('RapidClash');
    expect(
      gradient.compareDocumentPosition(wordmark) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(gradient.className).toContain('h-16');
    expect(gradient.className).toContain('mt-6');
    expect(gradient.style.background).toBe(
      'linear-gradient(to bottom, rgba(26,26,46,0) 0%, rgba(26,26,46,0.45) 55%, rgba(26,26,46,0.85) 82%, rgba(26,26,46,1) 100%)',
    );
    // The gradient's terminal stop is opaque #1A1A2E, matching the content wrapper's bg-surface
    // exactly — no seam between the gradient's bottom edge and the content wrapper's top edge.
  });

  it('issue #346: the gradient div is a sibling of the bg-surface content wrapper, not its parent — genuinely composites over page-black', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const gradient = within(footer).getByTestId('home-footer-gradient');
    const content = within(footer).getByTestId('home-footer-content');
    // Siblings under <footer>, gradient first — not gradient-inside-content or content-inside-gradient.
    expect(gradient.parentElement).toBe(footer);
    expect(content.parentElement).toBe(footer);
    expect(
      gradient.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The gradient carries no bg-surface/background token of its own — its whole visible color
    // comes from the inline gradient style compositing over whatever is actually behind it.
    expect(gradient.className).not.toContain('bg-surface');
  });

  it('issue #346: the gradient spans the footer\'s full width (no horizontal inset); the content wrapper keeps px-4', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const gradient = within(footer).getByTestId('home-footer-gradient');
    const content = within(footer).getByTestId('home-footer-content');
    expect(gradient.className).not.toMatch(/(^|\s)px-\d/);
    expect(footer.className).not.toMatch(/(^|\s)px-\d/);
    expect(content.className).toContain('px-4');
  });

  it('renders the four column headings with text-brand and the 15px/bold/1.4px-tracking hierarchy', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    for (const heading of ['PLATFORM', 'FAIRNESS', 'SUPPORT', 'LEGAL']) {
      const el = within(footer).getByText(heading);
      expect(el.className).toContain('text-brand');
      expect(el.className).not.toContain('text-muted-foreground');
      expect(el.className).toContain('text-[15px]');
      expect(el.className).toContain('font-bold');
      expect(el.className).toContain('tracking-[1.4px]');
    }
  });

  it('renders footer links at 14px (up from 12.5px), colour/weight otherwise unchanged', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const link = within(footer).getByText('Games');
    expect(link.className).toContain('text-[14px]');
    expect(link.className).not.toContain('text-[12.5px]');
    expect(link.className).toContain('text-foreground');
  });
});

describe('HubFooter positioning fix (issue #337)', () => {
  // #337: the <footer> element no longer carries its own leading margin — every call site now
  // renders it as a sibling outside the page's gapped content div, so the gradient div's own
  // `mt-6` (24px) is the single, page-independent source of the leading gap. Confirmed here as a
  // static className check (jsdom doesn't compute real layout/margins); the actual rendered
  // pixel gap can only be verified in a real browser, which this suite doesn't have.
  it('does not carry its own mt-4 (or any other leading margin) on the <footer> element', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    expect(footer.className).not.toContain('mt-4');
    expect(footer.className).not.toMatch(/(^|\s)mt-\d/);
  });

  it('keeps the gradient div\'s mt-6 as the sole leading-gap source (unchanged by #337)', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const gradient = within(footer).getByTestId('home-footer-gradient');
    expect(gradient.className).toContain('mt-6');
  });
});

describe('HubFooter toolbar-clearance fix (issue #342)', () => {
  // #337 moved <HubFooter> outside each page's HUB_BODY-padded content div, which fixed the
  // leading gap but left the footer — now genuinely last — with zero reserved clearance from the
  // fixed HubToolbar (HUB_BODY's own doc comment says that padding exists so "the last item
  // clears the fixed toolbar"; the footer wasn't that last item's container anymore). The fix:
  // the footer carried HUB_BODY's own padding value directly, replacing its old flat `pb-6`.
  //
  // #346 moved this padding again, from <footer> onto the new bg-surface content wrapper: once
  // <footer> itself went transparent (so the gradient div's 0% stop reads real page-black), the
  // reserved trailing clearance space behind the fixed toolbar needed to keep reading as solid
  // navy, not a transparent strip revealing page-black. The *meaning* of this test — "the
  // reserved clearance space is opaque navy, not a gap" — is preserved by asserting it on
  // whichever element actually carries both the padding and the background now.
  it('carries the HUB_BODY toolbar-clearance padding on the bg-surface content wrapper (not the old flat pb-6, not on the now-transparent <footer>)', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const content = within(footer).getByTestId('home-footer-content');
    expect(content.className).toContain('pb-[calc(7rem_+_env(safe-area-inset-bottom))]');
    expect(content.className).not.toMatch(/(^|\s)pb-6(\s|$)/);
    // <footer> itself no longer carries this padding (or any pb-* at all) — it moved to the
    // content wrapper, which also carries bg-surface, so the reserved clearance stays opaque navy.
    expect(footer.className).not.toMatch(/(^|\s)pb-/);
  });

  it('leaves the gradient div\'s mt-6 leading gap untouched by the trailing-clearance fix', () => {
    render(<HubFooter />);
    const footer = screen.getByTestId('home-footer');
    const gradient = within(footer).getByTestId('home-footer-gradient');
    expect(gradient.className).toContain('mt-6');
    expect(footer.className).not.toMatch(/(^|\s)mt-\d/);
  });
});
