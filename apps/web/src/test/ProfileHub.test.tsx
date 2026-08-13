// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ProfileHubScreen } from '../screens/ProfileHub.js';
import { setMuted, isMuted } from '../lib/sound.js';
import type { GameMeta, LedgerEntry, LeaderboardEntry } from '@rapidclash/shared';

type Props = Parameters<typeof ProfileHubScreen>[0];

const META = (id: string, displayName: string): GameMeta => ({
  id, displayName, minPlayers: 2, maxPlayers: 2,
  ranking: { kind: 'net_winnings' }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 10, rakeRate: 0.025,
});
const GAMES: GameMeta[] = [META('coinflip', 'Coinflip'), META('chess', 'Chess')];

const LEDGER: LedgerEntry[] = [
  { id: 'e1', type: 'GRANT', amount: 1000, idempotencyKey: 'k1', createdAt: '2026-06-20T10:00:00Z' },
  { id: 'e2', type: 'BET_ESCROW', amount: -10, idempotencyKey: 'k2', createdAt: '2026-06-20T11:00:00Z' },
  { id: 'e3', type: 'SETTLE_WIN', amount: 19, matchId: 'm1', idempotencyKey: 'k3', createdAt: '2026-06-20T11:01:00Z' },
];

const CF_BOARD: LeaderboardEntry[] = [
  { rank: 1, playerId: 'p1', displayName: 'alice', avatarId: 'boy-light', score: 90, kind: 'net_winnings', netWinnings: 90 },
  { rank: 2, playerId: 'p2', displayName: 'bob', avatarId: 'default', score: -10, kind: 'net_winnings', netWinnings: -10 },
];
const CHESS_BOARD: LeaderboardEntry[] = [
  { rank: 1, playerId: 'p3', displayName: 'carol', avatarId: 'default', score: 1516, kind: 'elo', rating: 1516 },
];

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
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
      if (u.includes('/leaderboard/chess')) return { ok: true, json: async () => CHESS_BOARD } as Response;
      if (u.includes('/leaderboard/coinflip')) return { ok: true, json: async () => CF_BOARD } as Response;
      if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1009, entries: LEDGER }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the profile header (alias + log out)', () => {
    const onLogout = vi.fn();
    render(<ProfileHubScreen {...baseProps({ onLogout })} />);
    expect(screen.getByTestId('profile-username').textContent).toBe('alice');
    fireEvent.click(screen.getByTestId('profile-logout'));
    expect(onLogout).toHaveBeenCalled();
  });

  it('has the sound mute toggle in the header section beside Log out (moved off the ribbon), and toggling flips + persists global mute', () => {
    setMuted(false); // known baseline: sound ON
    const { container } = render(<ProfileHubScreen {...baseProps()} />);

    // It lives in the profile-header section, next to Log out — NOT in the ribbon header.
    const section = within(screen.getByTestId('profile-header'));
    const toggle = section.getByTestId('hub-mute-toggle');
    expect(section.getByTestId('profile-logout')).toBeInTheDocument();
    const ribbon = container.querySelector('header')!;
    expect(within(ribbon).queryByTestId('hub-mute-toggle')).toBeNull(); // gone from the header

    // Toggling flips the global, persisted mute (no behaviour change — same module/localStorage).
    expect(toggle.getAttribute('aria-pressed')).toBe('false'); // sound ON
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true'); // muted
    expect(window.localStorage.getItem('rc:sound:muted')).toBe('1'); // persisted
    expect(isMuted()).toBe(true); // global module state
    setMuted(false); // cleanup for other tests / files
  });

  it('shows the wallet balance in ¢ and the recent ledger entries (signed amounts)', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    // Balance refreshed from /wallet, rendered in ¢.
    await waitFor(() => expect(screen.getByTestId('profile-balance').textContent).toBe('1,009¢'));
    const ledger = within(screen.getByTestId('profile-ledger'));
    expect(ledger.getByTestId('profile-entry-e1').textContent).toMatch(/GRANT/);
    expect(ledger.getByTestId('profile-entry-e1').textContent).toContain('+1,000¢');
    expect(ledger.getByTestId('profile-entry-e2').textContent).toContain('-10¢'); // BET_ESCROW debit
    expect(ledger.getByTestId('profile-entry-e3').textContent).toContain('+19¢'); // SETTLE_WIN credit
  });

  it('renders the leaderboard and switches game via the picker (kind-aware)', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    // Default coinflip (net_winnings, ¢, can be negative).
    await waitFor(() => expect(screen.getByTestId('profile-rank-p1')).toBeInTheDocument());
    const board = within(screen.getByTestId('profile-leaderboard'));
    expect(board.getByTestId('profile-rank-p1').textContent).toContain('+90¢');
    expect(board.getByTestId('profile-rank-p2').textContent).toContain('-10¢');

    // Pick chess → elo rendering.
    fireEvent.click(board.getByTestId('profile-lb-pick-chess'));
    await waitFor(() => expect(screen.getByTestId('profile-rank-p3')).toBeInTheDocument());
    expect(screen.getByTestId('profile-rank-p3').textContent).toContain('1516 ELO');
  });

  it('renders the shared Avatar (not initials) in the header and on each leaderboard row', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    // Header shows the shared Avatar (a default person glyph), never the old initials text.
    const header = within(screen.getByTestId('profile-header'));
    expect(header.getByTestId('avatar')).toBeInTheDocument();
    expect(header.queryByTestId('avatar-glyph')).toBeInTheDocument(); // darkened silhouette, not initials
    expect(header.getByTestId('profile-username').textContent).toBe('alice');

    // Each ProfileLeaderboard row (public alias) gets the shared Avatar too.
    await waitFor(() => expect(screen.getByTestId('profile-rank-p1')).toBeInTheDocument());
    expect(within(screen.getByTestId('profile-rank-p1')).getByTestId('avatar')).toBeInTheDocument();
    expect(within(screen.getByTestId('profile-rank-p2')).getByTestId('avatar')).toBeInTheDocument();
  });

  it('header renders the player\'s OWN avatar preset (avatarId prop → header disc)', () => {
    render(<ProfileHubScreen {...baseProps({ avatarId: 'boy-brown' })} />);
    const header = within(screen.getByTestId('profile-header'));
    expect(header.getByTestId('avatar').getAttribute('data-avatar-id')).toBe('boy-brown');
    expect(header.getByTestId('avatar-img')).toBeInTheDocument(); // a preset image, not the glyph
  });

  it('each leaderboard row honours entry.avatarId (public board carries the stored avatar)', async () => {
    render(<ProfileHubScreen {...baseProps()} />);
    // p1 (alice) has a 'boy-light' preset in the fixture → its row shows the preset image…
    await waitFor(() => expect(screen.getByTestId('profile-rank-p1')).toBeInTheDocument());
    const p1 = within(screen.getByTestId('profile-rank-p1'));
    expect(p1.getByTestId('avatar').getAttribute('data-avatar-id')).toBe('boy-light');
    expect(p1.getByTestId('avatar-img')).toBeInTheDocument();
    // …while p2 (bob, 'default') falls back to the derived glyph, no preset image.
    const p2 = within(screen.getByTestId('profile-rank-p2'));
    expect(p2.getByTestId('avatar').getAttribute('data-avatar-id')).toBe('default');
    expect(p2.queryByTestId('avatar-img')).toBeNull();
  });

  describe('avatar picker (Advisor #12 ii)', () => {
    it('tapping the header avatar opens the bg-surface overlay with the default + 6 presets', () => {
      render(<ProfileHubScreen {...baseProps()} />);
      expect(screen.queryByTestId('avatar-picker')).toBeNull();
      fireEvent.click(screen.getByTestId('profile-avatar-button'));
      const picker = screen.getByTestId('avatar-picker');
      expect(picker).toBeInTheDocument();
      // the auth-popup treatment: an inner bg-surface panel (no rim).
      expect(picker.querySelector('.bg-surface')).not.toBeNull();
      // default + 6 presets are offered (incl. the #312 meme-style pair).
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
        if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
        if (u.includes('/leaderboard/coinflip')) return { ok: true, json: async () => CF_BOARD } as Response;
        if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1009, entries: LEDGER }) } as Response;
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

    it('selecting and saving a #312 meme-style preset (hooded-degen) calls api.setAvatar with that id', async () => {
      const setAvatarCalls: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/auth/avatar')) {
          const sent = JSON.parse(String(init?.body)).avatarId as string;
          setAvatarCalls.push(sent);
          return { ok: true, json: async () => ({ avatarId: sent }) } as Response;
        }
        if (u.includes('/games')) return { ok: true, json: async () => GAMES } as Response;
        if (u.includes('/leaderboard/coinflip')) return { ok: true, json: async () => CF_BOARD } as Response;
        if (u.includes('/wallet')) return { ok: true, json: async () => ({ balance: 1009, entries: LEDGER }) } as Response;
        return { ok: true, json: async () => ({}) } as Response;
      }));
      const onAvatarChange = vi.fn();
      render(<ProfileHubScreen {...baseProps({ avatarId: 'default', onAvatarChange })} />);

      fireEvent.click(screen.getByTestId('profile-avatar-button'));
      fireEvent.click(screen.getByTestId('avatar-option-hooded-degen'));
      fireEvent.click(screen.getByTestId('avatar-picker-save'));

      await waitFor(() => expect(setAvatarCalls).toEqual(['hooded-degen']));
      expect(onAvatarChange).toHaveBeenCalledWith('hooded-degen');
      await waitFor(() => expect(screen.queryByTestId('avatar-picker')).toBeNull());
    });
  });

  it('is sanitized: no $ anywhere on the hub', async () => {
    const { container } = render(<ProfileHubScreen {...baseProps()} />);
    await waitFor(() => expect(screen.getByTestId('profile-balance').textContent).toBe('1,009¢'));
    await waitFor(() => expect(screen.getByTestId('profile-rank-p1')).toBeInTheDocument());
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
