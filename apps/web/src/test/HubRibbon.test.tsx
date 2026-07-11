// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';

describe('HubRibbon — tight-cropped wordmark, shrunk logo box (Advisor #2)', () => {
  it('renders the wordmark at h-8 (32px), not the old oversized h-24 (96px) or h-10 (40px)', () => {
    render(<HubRibbon balance={1000} onLogo={vi.fn()} onWallet={vi.fn()} />);
    const logo = screen.getByAltText('RapidClash');
    expect(logo.className).toContain('h-8');
    expect(logo.className).not.toContain('h-24');
    expect(logo.className).not.toContain('h-10');
  });

  it('keeps the single safe-area-inset-top padding on the outer header — no doubled/removed inset', () => {
    render(<HubRibbon balance={1000} onLogo={vi.fn()} onWallet={vi.fn()} />);
    const header = screen.getByAltText('RapidClash').closest('header');
    expect(header?.className).toContain('pt-[env(safe-area-inset-top)]');
  });
});

describe('HubRibbon — solid full-width bg + below-header gap (Advisor #7)', () => {
  it('fills the outer header with the solid bg-background token, full width (not max-w-md)', () => {
    render(<HubRibbon balance={1000} onLogo={vi.fn()} onWallet={vi.fn()} />);
    const header = screen.getByAltText('RapidClash').closest('header');
    expect(header?.className).toContain('bg-background');
    expect(header?.className).not.toContain('bg-transparent');
    expect(header?.className).not.toMatch(/max-w-md/);
    expect(header?.className).toContain('w-full');
  });

  it('constrains the inner row to max-w-md and keeps it transparent (fill lives on the outer header)', () => {
    render(<HubRibbon balance={1000} onLogo={vi.fn()} onWallet={vi.fn()} />);
    const header = screen.getByAltText('RapidClash').closest('header');
    const row = header?.querySelector(':scope > div');
    expect(row?.className).toContain('max-w-md');
    expect(row?.className).not.toContain('bg-transparent');
  });

  it('adds a pb-4 gap on the inner row below the header content', () => {
    render(<HubRibbon balance={1000} onLogo={vi.fn()} onWallet={vi.fn()} />);
    const header = screen.getByAltText('RapidClash').closest('header');
    const row = header?.querySelector(':scope > div');
    expect(row?.className).toContain('pb-4');
  });
});

describe('HubRibbon — logo aligned to the content grid (Advisor #4)', () => {
  it('drops the leftover -ml-3 negative margin so the logo sits on the px-4 grid', () => {
    render(<HubRibbon balance={1000} onLogo={vi.fn()} onWallet={vi.fn()} />);
    const logoButton = screen.getByAltText('RapidClash').closest('button');
    expect(logoButton?.className).not.toContain('-ml-3');
    expect(logoButton?.className).toContain('flex items-center');
  });

  it('keeps the inner row on the px-4 content gutter the logo now aligns to', () => {
    render(<HubRibbon balance={1000} onLogo={vi.fn()} onWallet={vi.fn()} />);
    const header = screen.getByAltText('RapidClash').closest('header');
    const row = header?.querySelector(':scope > div');
    expect(row?.className).toContain('px-4');
  });
});
