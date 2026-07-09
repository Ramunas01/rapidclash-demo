// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';

describe('HubRibbon — tight-cropped wordmark, shrunk logo box (Advisor #2)', () => {
  it('renders the wordmark at h-10 (40px), not the old oversized h-24 (96px)', () => {
    render(<HubRibbon balance={1000} onLogo={vi.fn()} onWallet={vi.fn()} />);
    const logo = screen.getByAltText('RapidClash');
    expect(logo.className).toContain('h-10');
    expect(logo.className).not.toContain('h-24');
  });

  it('keeps the single safe-area-inset-top padding on the header — no doubled/removed inset', () => {
    render(<HubRibbon balance={1000} onLogo={vi.fn()} onWallet={vi.fn()} />);
    const header = screen.getByAltText('RapidClash').closest('header');
    expect(header?.className).toContain('pt-[env(safe-area-inset-top)]');
  });
});
