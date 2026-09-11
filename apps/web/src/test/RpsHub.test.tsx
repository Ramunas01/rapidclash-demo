// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
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

  // 2026-09-11#9 item 2 (deliberate, Owner-approved redaction rollback — ADVISOR_TO_PM.md): a tied
  // round's new_round event carries revealedChoices, and RpsBoard flips the opponent card to the
  // real throw, holds it, then resets to redacted — a real, intentional behavior change from "always
  // hidden pre-terminal", not a regression.
  it("2026-09-11#9: a tied round's new_round event flips the opponent card to the real throw, holds ~1.5s, then resets to redacted", () => {
    vi.useFakeTimers();
    try {
      const gameState: RpsView = { players: ['pid', 'bob'], choices: {}, round: 1 };
      const events = [
        { type: 'new_round', payload: { round: 1, replays: 1, revealedChoices: { pid: 'rock', bob: 'scissors' } } },
      ];
      render(
        <RpsHubScreen
          {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'], events })}
        />,
      );
      // Flipped: the redacted 🤫 tile is gone; the opponent's real (scissors) throw is now in the DOM
      // (both flip faces are always present — backface-visibility is a visual-only 3D property jsdom
      // doesn't lay out — so this asserts the revealed face was added, not that the hidden face left).
      expect(screen.queryByTestId('hub-opponent-pick')).toBeNull();
      expect(screen.getByTestId('hub-opponent-pick-revealed').textContent).toContain('✌️');

      // After the flip (820ms) + hold (~1.5s), it falls back to the redacted tile.
      act(() => { vi.advanceTimersByTime(820 + 1500); });
      expect(screen.getByTestId('hub-opponent-pick').textContent).toBe('🤫');
    } finally {
      vi.useRealTimers();
    }
  });

  it("2026-09-11#9: a DECISIVE round's new_round-less broadcast never flips the opponent card (revealedChoices is tie-only)", () => {
    const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
    // No `events` at all — the common case (a provisional pick's broadcast carries none either).
    render(<RpsHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['rock', 'paper', 'scissors'] })} />);
    expect(screen.getByTestId('hub-opponent-pick').textContent).toBe('🤫');
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
    // registered (default loggedIn: true) → the Owner-approved $ skin, 2026-09-11#8 item B.2
    expect(within(row).getByTestId(/^games-carousel-stake-/).textContent).toBe('$50');
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

// Ticket 2026-09-11#9 (ADVISOR_TO_PM.md): a deliberate Owner-directed REVERSAL of #387's
// `searchFloorMs={0}`. RPS's entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS,
// resolves ONLY at expiry — never early); restoring the ~3.8s "Searching…"/"found"/"split" dwell
// floor now deliberately holds `phase` at 'waiting' for that beat even when `currentMatchId` is
// already set, matching the prototype's `startRps()` timing (`Full Spec.html:3291-3313`) — accepting
// that this eats into the player's SEEN share of the already-ticking server window (see the code
// comment at RpsHub.tsx's `searchFloorMs` prop for the full rationale). This replaces the old
// "bypassed (#387)" behavior the tests below used to assert.
describe('RpsHubScreen — search dwell floor restored (2026-09-11#9)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('holds at waiting (throw buttons hidden, VS label shown) through the ~3.8s dwell floor even when currentMatchId is already set, then reveals the throw buttons once the floor elapses', () => {
    vi.useFakeTimers();
    try {
      const onPlay = vi.fn();
      const { rerender } = render(<RpsHubScreen {...baseProps({ initialStake: 10, onPlay })} />);
      fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start (searchStartRef)
      expect(onPlay).toHaveBeenCalledWith(10);

      // The server pairs the match immediately (as can genuinely happen) — rerender with a live match
      // and NO time elapsed. The restored ~3.8s dwell floor holds `phase` at 'waiting' regardless.
      const gameState: RpsView = { players: ['pid', 'bob'], choices: {} };
      rerender(<RpsHubScreen {...baseProps({ initialStake: 10, onPlay, currentMatchId: 'm1', gameState })} />);

      expect(screen.queryByTestId('hub-move-rock')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hub-move-paper')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hub-move-scissors')).not.toBeInTheDocument();
      // T5: `matchForming` (phase 'waiting' with a currentMatchId already assigned) is exactly the
      // window the restored floor now holds open — the shared VS label arms for RPS again.
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('1');
      // Ticket 2026-09-11#10 item 1: the same `matchForming` window now also slides the bars toward
      // the VS label — RPS uses the prototype's own flat fallback magnitude (`Full Spec.html:3754`'s
      // `!gameV` branch), opponent bar +123px, player bar -123px.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(123px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(-123px)');

      // Advance past the restored ~3.8s floor — the hold clears and the throw buttons render.
      act(() => { vi.advanceTimersByTime(3800); });

      expect(screen.getByTestId('hub-move-rock')).toBeInTheDocument();
      expect(screen.getByTestId('hub-move-paper')).toBeInTheDocument();
      expect(screen.getByTestId('hub-move-scissors')).toBeInTheDocument();
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0');
      // Slides back to 0 the same beat `in-match` takes over (prototype's `found`→`split` beat).
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticket 2026-09-11#10 item 1: the bar-slide also arms during pure searching (no match yet), matching the prototype\'s rpsMatching flag covering BOTH its searching and found sub-states', () => {
    vi.useFakeTimers();
    try {
      render(<RpsHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: Date.now() + 10_000 })} />);
      // No currentMatchId at all — this is the prototype's `rpsMatch === 'searching'` sub-state, not
      // `found`, yet `rpsMatching` (Full Spec.html:3517-3530) is true for both, so the slide is armed.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(123px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(-123px)');
    } finally {
      vi.useRealTimers();
    }
  });
});
