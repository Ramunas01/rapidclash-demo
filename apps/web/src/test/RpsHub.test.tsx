// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RpsHubScreen } from '../screens/RpsHub.js';
import type { RpsView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof RpsHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'pid', username: 'me', opponentId: 'bob', balance: 1000,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenRewards: vi.fn(), onOpenAffiliate: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
    ...over,
  };
}

const CHALLENGE = { matchId: 'c1', ownerName: 'rival', stake: 50, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'none' };

describe('RpsHubScreen (GameHub + RpsPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: arming a bet enables PLAY, which posts that stake (shared GameHub)', () => {
    const onPlay = vi.fn();
    render(<RpsHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // #143: pressable even with no stake armed
    fireEvent.click(screen.getByTestId('hub-bet-25'));
    expect(screen.getByTestId('hub-play')).toBeEnabled();
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(25);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<RpsHubScreen {...baseProps({ onPlay })} />);

    const play = screen.getByTestId('hub-play');
    expect(play).toBeEnabled(); // pressable with no stake armed (no longer a dead end)
    fireEvent.click(play);
    expect(onPlay).not.toHaveBeenCalled(); // guided to the bet panel, not started
    expect(scrollSpy).toHaveBeenCalled(); // bet panel scrolled into view
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBe('true');
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/select a bet/i);

    fireEvent.click(screen.getByTestId('hub-bet-10')); // selecting a bet clears the frame + hint…
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBeNull();
    expect(screen.getByTestId('hub-bet-hint').textContent).toBe('');
    expect(onPlay).not.toHaveBeenCalled(); // …with NO auto-play
  });

  it('#143: the inert "Play a Friend" also guides to the bet panel when no stake is armed (guard pre-wired)', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    render(<RpsHubScreen {...baseProps()} />);
    fireEvent.click(screen.getByTestId('hub-play-friend'));
    expect(scrollSpy).toHaveBeenCalled();
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/select a bet/i);
  });

  it('In-match: the RPS board activates, choices come from legalMoves, and the opponent stays hidden', () => {
    const onMakeMove = vi.fn();
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], onMakeMove })} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    // Redaction: the opponent's pick is never shown before match.end.
    expect(screen.getByTestId('hub-opponent-pick').textContent).toBe('🤫');
    fireEvent.click(screen.getByTestId('hub-move-rock'));
    expect(onMakeMove).toHaveBeenCalledWith('rock');
  });

  it('own slot renders the player\'s chosen avatar preset (avatarId threaded into the own bar)', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    render(<RpsHubScreen {...baseProps({ avatarId: 'boy-light', currentMatchId: 'm1', gameState, legalMoves: ['rock'] })} />);
    const own = within(screen.getByTestId('hub-slot-own'));
    const ownAvatar = own.getByTestId('avatar');
    expect(ownAvatar.getAttribute('data-avatar-id')).toBe('boy-light');
    // A preset shows its <img>, not the default glyph.
    expect(own.getByTestId('avatar-img')).toBeInTheDocument();
    expect(own.queryByTestId('avatar-glyph')).toBeNull();
  });

  it('REDACTION: the in-match opponent bar stays the neutral silhouette regardless of MY avatar (opponent avatarId is never on the wire)', () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    // I picked a colourful preset; the opponent slot must NOT reflect any avatar — it has no avatarId
    // source at all (the opponent's stored avatar is never sent in-match, Charter #2).
    render(<RpsHubScreen {...baseProps({ avatarId: 'girl-light', currentMatchId: 'm1', gameState, legalMoves: ['rock'] })} />);
    const opp = within(screen.getByTestId('hub-slot-opponent'));
    const oppAvatar = opp.getByTestId('avatar');
    expect(oppAvatar.getAttribute('data-avatar-id')).toBe('default'); // never a preset
    expect(opp.queryByTestId('avatar-img')).toBeNull(); // no preset image
    expect(opp.getByTestId('avatar-glyph')).toBeInTheDocument(); // the neutral silhouette
    // NEUTRAL disc (no username) — distinct from any per-user disc.
    expect(oppAvatar.getAttribute('data-disc')).toBe('hsl(230, 10%, 88%)');
  });

  it('In-match: picks stay enabled and mutable for the whole window (timer-only-resolve #164)', () => {
    const onMakeMove = vi.fn();
    // A prior pick is on the server view, and legalMoves is empty — under the OLD model this froze
    // the board. The new model never gates on legalMoves/your_turn: all three throws stay tappable.
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock' } };
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [], onMakeMove })} />);
    expect(screen.getByTestId('hub-move-rock')).not.toBeDisabled();
    expect(screen.getByTestId('hub-move-scissors')).not.toBeDisabled();
    // The current pick shows selected (purple outline via aria-pressed)…
    expect(screen.getByTestId('hub-move-rock').getAttribute('aria-pressed')).toBe('true');
    // …and re-tapping a different throw changes the selection (mutable) and re-sends it.
    fireEvent.click(screen.getByTestId('hub-move-paper'));
    expect(onMakeMove).toHaveBeenCalledWith('paper');
    expect(screen.getByTestId('hub-move-paper').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('hub-move-rock').getAttribute('aria-pressed')).toBe('false');
  });

  it('Result: ending a match shows the overlay with the credits delta and the both-choices reveal', async () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: { pid: 'rock', bob: 'scissors' } };
    const { rerender } = render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    rerender(
      <RpsHubScreen
        {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 9, newBalance: 1009 } })}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('hub-result-overlay')).toBeInTheDocument());
    expect(screen.getByTestId('hub-result-text').textContent).toContain('You Won');
    expect(screen.getByTestId('hub-result-delta').textContent).toContain('+9');
    // Both choices are revealed at terminal (server-authoritative).
    expect(screen.getByTestId('hub-result-rps')).toBeInTheDocument();
  });

  it('JOIN balance-check + chrome (shared GameHub behaviour holds for RPS)', () => {
    const onTakeChallenge = vi.fn();
    render(<RpsHubScreen {...baseProps({ balance: 5, challengesByGame: { rps: [CHALLENGE] }, onTakeChallenge })} />);
    const row = document.querySelector('[data-match-id="c1"]') as HTMLElement;
    expect(within(row).getByTestId(/^games-carousel-stake-/).textContent).toBe('50');
    fireEvent.click(within(row).getByTestId(/^games-carousel-join-/));
    expect(onTakeChallenge).not.toHaveBeenCalled();
    expect(screen.getByTestId('games-carousel-notice').textContent).toMatch(/not enough/i);
  });

  it('T9: registered users see the Owner-approved $ skin in the bet panel too, not just the header wallet chip (GameHub.tsx PlayPanel, CHARTER.md #4)', () => {
    const { container } = render(<RpsHubScreen {...baseProps({ balance: 5 })} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).toMatch(/\$/);
  });

  it('T9: guest mode keeps the play-money RcIcon bet display — no $ leaks into the game body', () => {
    const { container } = render(<RpsHubScreen {...baseProps({ balance: 5, isGuest: true })} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).not.toMatch(/\$/);
  });

  // Issue #337: the shared footer must sit OUTSIDE the gapped `flex flex-col gap-4` content div
  // (a sibling, directly under <main>), not as its last gapped child — otherwise the parent's
  // own gap stacks on top of the gradient's margin, producing a page-specific black band. This
  // is the one thing jsdom (no real layout engine) CAN verify: DOM structure. It cannot verify
  // the actual rendered pixel gap — that needs a real browser, out of scope for this suite.
  it('renders the footer as a sibling of the gapped content div, directly under <main> (#337)', async () => {
    render(<RpsHubScreen {...baseProps()} />);
    const main = screen.getByTestId('hub-body');
    const footer = await screen.findByTestId('home-footer');
    expect(footer.parentElement).toBe(main);
    const gappedDiv = main.querySelector('.gap-4');
    expect(gappedDiv).not.toBeNull();
    expect(gappedDiv?.contains(footer)).toBe(false);
  });

  // Issue #342: the content div no longer needs hubBodyPadding's toolbar-clearance padding —
  // the footer now reserves that space itself (see HubFooter.test.tsx). Non-guest path only:
  // hubBodyPadding(isGuest) already returned '' for guests before this fix (guest mode never
  // renders HubFooter/HubToolbar), so this removal only changes the logged-in/non-guest branch.
  it('no longer carries the hubBodyPadding toolbar-clearance padding on the content div (#342)', async () => {
    render(<RpsHubScreen {...baseProps()} />);
    const main = screen.getByTestId('hub-body');
    await screen.findByTestId('home-footer');
    const gappedDiv = main.querySelector('.gap-4');
    expect(gappedDiv).not.toBeNull();
    expect(gappedDiv?.className).not.toMatch(/pb-\[calc/);
  });
});

describe('GameHub (logged out — via RpsHub)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('browsing stays open: the bet selector works + PLAY arms, but the chip is "Sign in" and the feed is the logged-out carousel', () => {
    const onPlay = vi.fn();
    const onTrackChallenges = vi.fn();
    render(<RpsHubScreen {...baseProps({ loggedIn: false, token: '', onPlay, onTrackChallenges })} />);
    // Sign-in chip, not a fake balance; the same GamesCarousel the Home hub uses, in its
    // logged-out (public-poll) mode — not the old teaser card, not the signed-in WS ticker.
    expect(screen.getByTestId('hub-signin-chip')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull();
    expect(screen.getByTestId('games-carousel')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-section-challenges-teaser')).toBeNull();
    expect(onTrackChallenges).not.toHaveBeenCalled(); // no WS feed while logged out
    // Browsing + arming a bet is allowed; the auth wall fires in the App at PLAY.
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('initialStake pre-arms the bet (the join-fallback lands here ready to post)', () => {
    render(<RpsHubScreen {...baseProps({ initialStake: 25 })} />);
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // pre-armed → PLAY ready immediately
  });
});

// Issue #387: RPS's entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS, resolves
// ONLY at expiry — never early). GameHub's ~2.4s "Searching…" dwell floor, applied by default to
// every hub game, was burning a chunk of that window before the throw buttons even rendered — in
// the worst case the window could elapse with the player never seeing them. RPS now passes
// `searchFloorMs={0}` so `phase` reaches 'in-match' (and the throw buttons render) the instant
// `currentMatchId` is set, with no artificial hold at all.
describe('RpsHubScreen — search dwell floor bypassed (#387)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('phase reaches in-match (throw buttons visible) the INSTANT currentMatchId is set — no 2.4s dwell', () => {
    const onPlay = vi.fn();
    const { rerender } = render(<RpsHubScreen {...baseProps({ initialStake: 10, onPlay })} />);
    fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start (searchStartRef)
    expect(onPlay).toHaveBeenCalledWith(10);

    // The server pairs the match immediately (as can genuinely happen) — rerender with a live match
    // and NO fake-timer advance at all. Under the default 2400ms floor this would still read
    // 'waiting' (no throw buttons); with searchFloorMs=0 the hold never arms.
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    rerender(<RpsHubScreen {...baseProps({ initialStake: 10, onPlay, currentMatchId: 'm1', gameState })} />);

    expect(screen.getByTestId('hub-move-rock')).toBeInTheDocument();
    expect(screen.getByTestId('hub-move-paper')).toBeInTheDocument();
    expect(screen.getByTestId('hub-move-scissors')).toBeInTheDocument();
    // T5: `matchForming` (phase 'waiting' with a currentMatchId already assigned) can only ever be
    // true while `holdSearch` is holding the dwell floor open — and with searchFloorMs=0 that hold
    // never arms (see the file-level comment above). So the shared VS label never gets a window to
    // show for RPS at all — it stays at its resting opacity 0, same as idle, by construction of this
    // same #387 bypass (not a separate carve-out).
    expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0');
  });
});
