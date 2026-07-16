// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpenGamesTicker, PublicOpenGamesTicker } from '../components/hub-shared/OpenGames.js';
import type { OpenChallenge } from '@rapidclash/shared';

// The recessed-navy restyle (ADVISOR_TO_PM 2026-07-07#2): the Open Games list uses the SAME
// tokens as the PLAY panel — bg-surface, a --background inset shadow, brand-purple row hairlines —
// and NO rim/border or hardcoded hex. These lock the token contract so a hex can't creep back.

const CHALLENGE: OpenChallenge = { matchId: 'g1', ownerName: 'rival', stake: 10, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'none' };
const nameByGame = new Map([['coinflip', 'Coinflip']]);

describe('OpenGames — recessed navy panel (token-only)', () => {
  it('signed-in: the list body is bg-surface with a --background inset shadow, no rim', () => {
    render(<OpenGamesTicker challengesByGame={{ coinflip: [CHALLENGE] }} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const body = screen.getByTestId('home-ticker-body');
    expect(body.className).toContain('bg-surface'); // identical navy to the PLAY panel (--rc-surface)
    expect(body.className).toContain('shadow-[inset_0_0_24px_8px_hsl(var(--background))]'); // recessed, edges → #0b0b0b
    expect(body.className).not.toContain('bg-card'); // old grey gone
    expect(body.className).not.toMatch(/\bborder\b/); // no rim
  });

  it('row dividers are brand-purple hairlines via token — never the old hardcoded hex', () => {
    render(<OpenGamesTicker challengesByGame={{ coinflip: [CHALLENGE] }} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const row = screen.getByTestId('home-row-g1');
    expect(row.className).toContain('border-brand/40'); // brand purple, opacity-tuned (--brand-purple)
    expect(row.className).toContain('first:border-t-0'); // first row has no top divider
    expect(row.className).not.toContain('1e1e1e'); // the latent hardcoded-hex violation is fixed
  });

  it('empty state uses the same recessed navy panel (no rim, no bg-card)', () => {
    render(<OpenGamesTicker challengesByGame={{}} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const empty = screen.getByTestId('home-ticker-empty');
    expect(empty.className).toContain('bg-surface');
    expect(empty.className).toContain('shadow-[inset_0_0_24px_8px_hsl(var(--background))]');
    expect(empty.className).not.toContain('bg-card');
    expect(empty.className).not.toMatch(/\bborder\b/);
  });

  it('logged-out (public) ticker renders through the same recessed body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ ...CHALLENGE, gameId: 'coinflip' }] }) as Response));
    render(<PublicOpenGamesTicker nameByGame={nameByGame} onJoin={vi.fn()} onSignIn={vi.fn()} />);
    const body = await screen.findByTestId('home-ticker-body');
    expect(body.className).toContain('bg-surface');
    expect(body.className).toContain('shadow-[inset_0_0_24px_8px_hsl(var(--background))]');
  });
});

// Advisor #3: the uppercase header + LIVE badge collapse their line box (leading-none) so the
// caps center against the adjacent dot/icon under items-center.
describe('OpenGames — header leading (Advisor #3)', () => {
  it('the "Open Games" heading and the LIVE badge each carry leading-none', () => {
    render(<OpenGamesTicker challengesByGame={{ coinflip: [CHALLENGE] }} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
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

// ¢ stake formatting + text-success are unaffected by the restyle (no $/USDT crept in).
describe('OpenGames — stake formatting unaffected', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] }) as Response)));
  afterEach(() => vi.unstubAllGlobals());
  it('renders the ¢ stake in text-success, no $', () => {
    render(<OpenGamesTicker challengesByGame={{ coinflip: [CHALLENGE] }} nameByGame={nameByGame} balance={1000} onTake={vi.fn()} />);
    const stake = screen.getByTestId('home-stake-g1');
    expect(stake.textContent).toBe('10¢');
    expect(stake.className).toContain('text-success');
    expect(stake.textContent).not.toContain('$');
  });
});
