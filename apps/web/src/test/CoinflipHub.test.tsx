// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { CoinflipHubScreen } from '../screens/CoinflipHub.js';
import type { CoinflipView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches Result/CoinflipPlay tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof CoinflipHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok',
    playerId: 'pid',
    username: 'me',
    opponentId: 'bob',
    balance: 1000,
    currentMatchId: null,
    gameState: null,
    legalMoves: [],
    waitingExpiresAt: null,
    lobbyExpired: false,
    lastOutcome: null,
    lastSettlement: null,
    challengesByGame: {},
    onPlay: vi.fn(),
    onCancel: vi.fn(),
    onRepost: vi.fn(),
    onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(),
    onForfeit: vi.fn(),
    onTrackChallenges: vi.fn(),
    onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(),
    onOpenWallet: vi.fn(),
    onOpenGameList: vi.fn(),
    onResultDismiss: vi.fn(),
    ...over,
  };
}

const CHALLENGE = { matchId: 'c1', ownerName: 'rival', stake: 50, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'none' };

describe('CoinflipHubScreen (Part 2 — live state machine)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: arming a bet enables PLAY, which posts that stake', () => {
    const onPlay = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // #143: pressable even with no stake armed
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    expect(screen.getByTestId('hub-play')).toBeEnabled();
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ onPlay })} />);

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

  it('Waiting (#154): PLAY transforms in place to a non-tappable "WAITING FOR AN OPPONENT · m:ss"; no separate WaitingBlock', async () => {
    const onPlay = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 30_000, onPlay })} />);
    // No separate waiting block ever renders.
    expect(screen.queryByTestId('hub-waiting')).toBeNull();
    // The primary button is the waiting label with a live m:ss countdown, and is non-tappable.
    const play = await screen.findByTestId('hub-play');
    expect(play.textContent).toMatch(/waiting for an opponent/i);
    expect(within(play).getByTestId('hub-waiting-countdown').textContent).toMatch(/^\d:\d\d$/);
    expect(play).toBeDisabled();
    fireEvent.click(play);
    expect(onPlay).not.toHaveBeenCalled(); // non-tappable → posts nothing
  });

  it('Waiting (#154): Play-a-Friend becomes the active "Cancel" and the bet row is greyed/inert', async () => {
    const onCancel = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 30_000, onCancel })} />);
    // Play-a-Friend transformed → Cancel (active), Play-a-Friend testid gone.
    const cancel = await screen.findByTestId('hub-cancel');
    expect(cancel.textContent).toMatch(/cancel/i);
    expect(screen.queryByTestId('hub-play-friend')).toBeNull();
    // Bet row is dimmed + inert (same freeze as in-match) and its presets disabled.
    expect(screen.getByTestId('hub-section-bet').className).toMatch(/opacity-50/);
    expect(screen.getByTestId('hub-bet-10')).toBeDisabled();
    // Cancel fires the hardened leaveQueue path.
    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalled();
  });

  it('Waiting: JOIN on other challenges is disabled (one commitment at a time)', async () => {
    render(<CoinflipHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 30_000, challengesByGame: { coinflip: [CHALLENGE] } })} />);
    // Waiting is now signalled in place by the Cancel control (no WaitingBlock).
    await waitFor(() => expect(screen.getByTestId('hub-cancel')).toBeInTheDocument());
    expect(screen.getByTestId('home-join-c1')).toBeDisabled();
  });

  it('In-match: the board + countdown activate, H/T move into the own slot pill, opponent shows PLAYING…', () => {
    const onMakeMove = vi.fn();
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: {} };
    render(<CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['heads', 'tails'], onMakeMove })} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.getByTestId('coin-countdown')).toBeInTheDocument(); // 10s pick deadline (cosmetic)
    // Redaction: the opponent's pick is never rendered before match.end.
    expect(screen.queryByTestId('coin-opp-pick')).toBeNull();
    const oppSlot = screen.getByTestId('hub-slot-opponent').textContent ?? '';
    expect(oppSlot).not.toMatch(/heads|tails/i);
    // Correction 1: "PLAYING…" is shown on the opponent bar during the pick window.
    expect(oppSlot).toMatch(/playing/i);
    // H/T now live in the player's own slot pill (renderSlotAside 'own'); tapping picks.
    const ownSlot = screen.getByTestId('hub-slot-own');
    expect(within(ownSlot).getByTestId('hub-move-heads')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('hub-move-heads'));
    expect(onMakeMove).toHaveBeenCalledWith('heads');
  });

  it('In-match: once chosen the pick locks (#160) — the recorded side shows selected, the other disables', () => {
    // The server has echoed my pick (choices.pid = heads) and legalMoves emptied (one-shot). The
    // outline reconciles from the server pick too (not only an optimistic tap): heads reads selected,
    // tails locks out.
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: { pid: 'heads' } };
    render(<CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    expect(screen.getByTestId('hub-move-heads')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('hub-move-tails')).toBeDisabled();
  });

  it('Idle: no H/T pills on the tile or in the slot (selection only happens in-play)', () => {
    render(<CoinflipHubScreen {...baseProps()} />);
    expect(screen.queryByTestId('hub-move-heads')).toBeNull();
    expect(screen.queryByTestId('hub-move-tails')).toBeNull();
    expect(screen.getByTestId('hub-board').textContent).toMatch(/place your bet and play/i);
  });

  it('Result: no pop-up overlay — the flip + opponent reveal stage on the board, then the own pill lights', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy; // scroll-safety cue (reconciliation a)
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: { pid: 'heads', bob: 'tails' }, result: 'heads' };
    // Start in-match so the match-end edge fires on rerender.
    const { rerender } = render(<CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);

    // match.end: currentMatchId clears with the terminal payload. The old pop-up is gone.
    rerender(
      <CoinflipHubScreen
        {...baseProps({
          currentMatchId: null,
          gameState,
          lastOutcome: { type: 'win', winner: 'pid' },
          lastSettlement: { delta: 90, newBalance: 1090 },
        })}
      />,
    );
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    // During the hold: the coin flips to the revealed face and the opponent's pick reveals.
    await waitFor(() => {
      expect(screen.getByTestId('coin-face').textContent).toBe('heads');
      expect(screen.getByTestId('coin-opp-pick').textContent).toMatch(/tails/i);
    });
    expect(scrollSpy).toHaveBeenCalled(); // brought into view on resolve
    // After the reveal the own bar plays the green win fill: the username stays put, "You Win" shows
    // ALONGSIDE it, and the green sits behind as a background layer (#156 — the name is not swapped out).
    await waitFor(() => {
      const ownBar = screen.getByTestId('hub-slot-own');
      expect(ownBar.textContent).toMatch(/you win/i);
      expect(ownBar.textContent).toContain('me'); // username is NOT replaced by "You Win"
      expect(ownBar.querySelector('.bg-success')).not.toBeNull(); // green fill = a background layer
    }, { timeout: 3000 });
  });

  // #156 — the bar-level win reveal: keep the username, play the timed green fill, settle to the ring.
  // These drive the phase timing with fake timers. HOLD_RESULT_MS=1500, BAR_VERDICT_BEAT_MS=250,
  // WIN_FILL_HOLD_MS=3000, WIN_FILL_FADE_MS=500 (constants live in CoinflipHub/GameHub).
  function renderToTerminal(outcome: Props['lastOutcome']) {
    Element.prototype.scrollIntoView = vi.fn();
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: { pid: 'heads', bob: 'tails' }, result: 'heads' };
    const { rerender } = render(<CoinflipHubScreen {...baseProps({ username: 'neo', currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    rerender(
      <CoinflipHubScreen
        {...baseProps({ username: 'neo', currentMatchId: null, gameState, lastOutcome: outcome, lastSettlement: { delta: 90, newBalance: 1090 } })}
      />,
    );
  }

  it('Result win (#156): keeps the username, shows "You Win" alongside, then settles fill → green outline', async () => {
    vi.useFakeTimers();
    try {
      renderToTerminal({ type: 'win', winner: 'pid' });
      // Advance in stages: HOLD_RESULT_MS → result phase, then BAR_VERDICT_BEAT_MS → verdict lights
      // (each transition schedules its next timer on re-render, so a single big jump can skip it).
      await act(async () => { await vi.advanceTimersByTimeAsync(1500 + 50); }); // → result phase
      await act(async () => { await vi.advanceTimersByTimeAsync(250 + 50); }); // → win fill phase
      const ownBar = screen.getByTestId('hub-slot-own');
      expect(ownBar.textContent).toContain('neo'); // username stays put (not swapped out)
      expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you win/i); // alongside
      expect(ownBar.querySelector('.bg-success')).not.toBeNull(); // green as a background layer
      expect(ownBar.className).not.toContain('ring-success'); // not yet settled to the outline

      // The 3s hold elapses → settles to the green outline (username persists); then the 0.5s
      // ease-out completes → "You Win" leaves with the fill and unmounts.
      await act(async () => { await vi.advanceTimersByTimeAsync(3000 + 50); }); // hold → settle
      expect(ownBar.className).toContain('ring-success'); // shared outlineClasses('win')
      expect(ownBar.textContent).toContain('neo'); // username persists into the end state
      await act(async () => { await vi.advanceTimersByTimeAsync(500 + 50); }); // ease-out completes
      expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull(); // "You Win" left with the fill
    } finally {
      vi.useRealTimers();
    }
  });

  it('Result loss/draw (#156): outline only — no green fill, no "You Win" (regression guard)', async () => {
    for (const [outcome, ring] of [
      [{ type: 'win', winner: 'bob' } as const, 'ring-destructive'], // a loss (opponent won)
      [{ type: 'draw' } as const, 'ring-amber-400'],
    ] as const) {
      vi.useFakeTimers();
      try {
        renderToTerminal(outcome);
        await act(async () => { await vi.advanceTimersByTimeAsync(1500 + 50); }); // → result phase
        await act(async () => { await vi.advanceTimersByTimeAsync(250 + 50); }); // → verdict lights
        const ownBar = screen.getByTestId('hub-slot-own');
        expect(ownBar.className).toContain(ring);
        expect(ownBar.querySelector('.bg-success')).toBeNull(); // no fill layer
        expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull(); // no "You Win"
        expect(ownBar.textContent).toContain('neo'); // username present as always
      } finally {
        vi.useRealTimers();
        cleanup(); // unmount before the next verdict iteration (afterEach only runs between tests)
      }
    }
  });

  it('JOIN balance-check: refuses clearly when the owner stake is uncovered, without taking', () => {
    const onTakeChallenge = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ balance: 5, challengesByGame: { coinflip: [CHALLENGE] }, onTakeChallenge })} />);
    fireEvent.click(screen.getByTestId('home-join-c1'));
    expect(onTakeChallenge).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-ticker-notice').textContent).toMatch(/not enough/i);
  });

  it('JOIN succeeds (takes the owner stake) when covered', () => {
    const onTakeChallenge = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ balance: 1000, challengesByGame: { coinflip: [CHALLENGE] }, onTakeChallenge })} />);
    // The row shows the owner's stake so the tap is informed consent.
    expect(screen.getByTestId('home-stake-c1').textContent).toBe('50¢');
    fireEvent.click(screen.getByTestId('home-join-c1'));
    expect(onTakeChallenge).toHaveBeenCalledWith('c1');
  });

  it('chrome: wallet chip shows the live ¢ balance and opens the wallet', () => {
    const onOpenWallet = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ balance: 1250, onOpenWallet })} />);
    expect(screen.getByTestId('hub-balance').textContent).toBe('1,250¢');
    fireEvent.click(screen.getByTestId('hub-wallet-chip'));
    expect(onOpenWallet).toHaveBeenCalled();
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<CoinflipHubScreen {...baseProps({ challengesByGame: { coinflip: [CHALLENGE] } })} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });

  it('#161: a same-side draw runs the SHARED beat here too — orange on both bars, then clears (generic replays signal, no CoinflipHub change)', async () => {
    vi.useFakeTimers();
    try {
      Element.prototype.scrollIntoView = vi.fn();
      // Coinflip's module keeps `round`/`replays` public over the wire (the client view type omits
      // them; the shared hub reads them structurally). A same-side push bumps replays 0 → 1 and
      // re-deals a fresh (empty) pick round in the same escrow — a NON-terminal state.
      const round0 = { players: ['pid', 'bob'], choices: {}, replays: 0 } as unknown as CoinflipView;
      const drawn = { players: ['pid', 'bob'], choices: {}, replays: 1 } as unknown as CoinflipView;
      const { rerender } = render(<CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState: round0, legalMoves: [] })} />);
      rerender(<CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState: drawn, legalMoves: ['heads', 'tails'] })} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(screen.getByTestId('hub-slot-own').className).toContain('ring-amber-400');
      expect(screen.getByTestId('hub-slot-opponent').className).toContain('ring-amber-400');
      await act(async () => { await vi.advanceTimersByTimeAsync(2000 + 50); });
      expect(screen.getByTestId('hub-slot-own').className).not.toContain('ring-amber-400');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Frame revision: shared template structure (items 1, 3) ──────────────────
  it('Arena slot pills: neutral opponent (no alias) above, own username below', () => {
    render(<CoinflipHubScreen {...baseProps({ username: 'neo' })} />);
    // Idle → a neutral "Opponent" placeholder (never the opponent's alias).
    expect(screen.getByTestId('hub-slot-opponent').textContent).toMatch(/opponent/i);
    expect(screen.getByTestId('hub-slot-opponent').textContent).not.toMatch(/bob/); // opponentId is never shown
    expect(screen.getByTestId('hub-slot-own').textContent).toContain('neo');
  });

  it('In-match: the opponent slot reads "Opponent" (still no alias)', () => {
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: {} };
    render(<CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['heads', 'tails'] })} />);
    const opp = screen.getByTestId('hub-slot-opponent').textContent ?? '';
    expect(opp).toContain('Opponent');
    expect(opp).not.toMatch(/bob/);
  });

  it('Own slot shows "Sign in" when logged out', () => {
    render(<CoinflipHubScreen {...baseProps({ loggedIn: false, token: '' })} />);
    expect(screen.getByTestId('hub-slot-own').textContent).toMatch(/sign in/i);
  });

  it('Unified play panel: PLAY + an inert Play-a-Friend; no "max"/"select a bet" copy', () => {
    const { container } = render(<CoinflipHubScreen {...baseProps()} />);
    const panel = screen.getByTestId('hub-section-play');
    expect(panel).toContainElement(screen.getByTestId('hub-play'));
    const friend = screen.getByTestId('hub-play-friend');
    expect(friend).toHaveAttribute('aria-disabled', 'true'); // visual-only (owner D1)
    expect(container.textContent ?? '').not.toMatch(/select a bet/i);
    expect(container.textContent ?? '').not.toMatch(/max /i);
  });

  it('PLAY stays full purple and pressable before a bet is armed (gate the ACTION via guidance, not colour/disable — #143)', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ onPlay })} />);
    const play = screen.getByTestId('hub-play');
    expect(play).toBeEnabled(); // #143: pressable; the bet gates the action, not the button
    expect(play.className).toContain('bg-brand');
    expect(play.className).not.toContain('bg-brand/40'); // no dimmed variant
    expect(play.className).not.toContain('cursor-not-allowed');
    fireEvent.click(play);
    expect(onPlay).not.toHaveBeenCalled(); // pressing without a bet guides to the bet panel, never starts
  });
});

describe('CoinflipHubScreen — waiting transforms in place (#154)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the countdown ticks down live off waitingExpiresAt', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      render(<CoinflipHubScreen {...baseProps({ waitingExpiresAt: 1_000_000 + 30_000 })} />);
      expect(screen.getByTestId('hub-waiting-countdown').textContent).toBe('0:30');
      // Advancing the fake timers moves the mocked clock; the 1s tick recomputes the remaining.
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(screen.getByTestId('hub-waiting-countdown').textContent).toBe('0:25');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Cancel restores idle: PLAY / Play a Friend return and the bet row re-enables', async () => {
    render(<CoinflipHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 30_000 })} />);
    const cancel = await screen.findByTestId('hub-cancel');
    fireEvent.click(cancel);
    // Back to idle in place: PLAY tappable, Play a Friend back, Cancel gone, bet re-enabled.
    const play = screen.getByTestId('hub-play');
    expect(play.textContent).toMatch(/^play$/i);
    expect(play).toBeEnabled();
    expect(screen.getByTestId('hub-play-friend')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-cancel')).toBeNull();
    expect(screen.getByTestId('hub-bet-10')).toBeEnabled();
    expect(screen.getByTestId('hub-section-bet').className).not.toMatch(/opacity-50/);
  });

  it('Expiry (lobbyExpired) → idle PLAY + bet enabled + "No opponent found" note; armed stake kept', async () => {
    // Search with an armed stake, then the search expires. Keep waitingExpiresAt STABLE so only
    // the lobbyExpired change drives the transition.
    const exp = Date.now() + 30_000;
    const { rerender } = render(
      <CoinflipHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: exp })} />,
    );
    await screen.findByTestId('hub-cancel'); // searching
    rerender(<CoinflipHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: exp, lobbyExpired: true })} />);

    // Reverted to idle in place: PLAY tappable, bet re-enabled, the polite note shown.
    const play = screen.getByTestId('hub-play');
    expect(play.textContent).toMatch(/^play$/i);
    expect(play).toBeEnabled();
    expect(screen.getByTestId('hub-bet-10')).toBeEnabled();
    const note = screen.getByTestId('hub-no-opponent');
    expect(note.textContent).toMatch(/no opponent found/i);
    expect(note.textContent).not.toMatch(/refund/i); // must NOT claim a second refund
    // The armed stake is retained (10 still selected) so pressing PLAY simply re-posts.
    expect(screen.getByTestId('hub-bet-10').className).toMatch(/bg-brand/);
  });

  it('structural stability: the play panel + bet row are the SAME nodes across idle→waiting→in-match (no remount)', async () => {
    const { rerender } = render(<CoinflipHubScreen {...baseProps()} />);
    const panelIdle = await screen.findByTestId('hub-section-play');
    const betIdle = screen.getByTestId('hub-section-bet');

    // → waiting
    rerender(<CoinflipHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 30_000 })} />);
    await screen.findByTestId('hub-cancel');
    expect(screen.getByTestId('hub-section-play')).toBe(panelIdle);
    expect(screen.getByTestId('hub-section-bet')).toBe(betIdle);

    // → in-match
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: {} };
    rerender(<CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['heads', 'tails'] })} />);
    expect(screen.getByTestId('hub-section-play')).toBe(panelIdle);
    expect(screen.getByTestId('hub-section-bet')).toBe(betIdle);
  });
});

describe('CoinflipHubScreen — related rail (item 5: all games, coming-soon included)', () => {
  const META = (id: string, displayName: string) => ({
    id, displayName, minPlayers: 2, maxPlayers: 2,
    ranking: { kind: 'net_winnings' }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 5, rakeRate: 0.025,
  });
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games')) return { ok: true, json: async () => [META('coinflip', 'Coinflip'), META('blackjack', 'Blackjack')] } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('includes a live game (playable, routes) and a coming-soon game (dimmed, inert); excludes self', async () => {
    const onSelectGame = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ onSelectGame })} />);
    // Live PvP related → a button that routes via onSelectGame.
    const blackjack = await screen.findByTestId('hub-related-blackjack');
    expect(blackjack.tagName).toBe('BUTTON');
    fireEvent.click(blackjack);
    expect(onSelectGame).toHaveBeenCalledWith(expect.objectContaining({ id: 'blackjack' }));
    // Coming-soon house game → present but NOT a button (inert), per the roster.
    const baccarat = screen.getByTestId('hub-related-baccarat');
    expect(baccarat.tagName).not.toBe('BUTTON');
    // The current game is excluded from its own related rail.
    expect(screen.queryByTestId('hub-related-coinflip')).toBeNull();
  });
});

describe('CoinflipHubScreen — choice controls: optimistic purple pick (#160)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  /** A live pick window: matched, my pick not yet echoed into view.choices (still empty). */
  function pickWindow(over: Partial<Props> = {}) {
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: {} };
    return baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['heads', 'tails'], ...over });
  }

  it('tapping a side shows the purple outline IMMEDIATELY — no dependency on view.choices', () => {
    const onMakeMove = vi.fn();
    const props = pickWindow({ onMakeMove });
    render(<CoinflipHubScreen {...props} />);

    // Pre-tap: neither pill is selected.
    expect(screen.getByTestId('hub-move-heads')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('hub-move-heads'));

    // Instant optimistic selection — the server pick is still un-echoed (choices stayed {}).
    expect((props.gameState as CoinflipView).choices).toEqual({});
    const heads = screen.getByTestId('hub-move-heads');
    expect(heads).toHaveAttribute('aria-pressed', 'true');
    expect(heads).toHaveAttribute('data-selected', 'true');
    expect(onMakeMove).toHaveBeenCalledWith('heads'); // onMove stays authoritative
  });

  it('purple = SELECTION: the outline is the brand ring, never the green/red/orange result rings', () => {
    render(<CoinflipHubScreen {...pickWindow()} />);
    fireEvent.click(screen.getByTestId('hub-move-heads'));
    const cls = screen.getByTestId('hub-move-heads').className;
    expect(cls).toMatch(/ring-brand/);
    expect(cls).not.toMatch(/ring-success|ring-destructive|ring-amber/);
  });

  it('only one pill is outlined at a time; the outline reflects OWN pick only, never the opponent', () => {
    render(<CoinflipHubScreen {...pickWindow()} />);
    fireEvent.click(screen.getByTestId('hub-move-heads'));
    // One at a time: heads selected, tails not.
    expect(screen.getByTestId('hub-move-heads')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('hub-move-tails')).toHaveAttribute('aria-pressed', 'false');
    // Redaction: the opponent's pick is never rendered pre-reveal (only "PLAYING…").
    expect(screen.queryByTestId('coin-opp-pick')).toBeNull();
    expect(screen.getByTestId('hub-slot-opponent').textContent).toMatch(/playing/i);
  });

  it('the pick is one-shot (server-authoritative): first tap commits; a later tap does not re-fire onMove or move the outline', () => {
    // Coinflip's module is one-shot — applyMove throws once a side is chosen. The client mirrors
    // that: the first tap commits; the outline can never drift from the recorded pick. (Pre-lock
    // re-picking would need a module change — flagged on the PR as a doc/module conflict.)
    const onMakeMove = vi.fn();
    render(<CoinflipHubScreen {...pickWindow({ onMakeMove })} />);
    fireEvent.click(screen.getByTestId('hub-move-heads'));
    fireEvent.click(screen.getByTestId('hub-move-tails')); // ignored — already committed
    expect(onMakeMove).toHaveBeenCalledTimes(1);
    expect(onMakeMove).toHaveBeenCalledWith('heads');
    expect(screen.getByTestId('hub-move-heads')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('hub-move-tails')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('hub-move-tails')).toBeDisabled(); // the un-picked side locks out
  });

  it('BOTH players can lock the SAME side (no same-side restriction) — the draw path stays reachable', () => {
    // A same-side round: both chose HEADS, the coin flipped tails → a DRAW (→ auto-replay). The hub
    // renders both picks as HEADS with no block anywhere. A "taken side" block must NEVER be added:
    // it would leak the opponent's hidden pick (a side that won't select = you infer they took it).
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: { pid: 'heads', bob: 'heads' }, result: 'tails' };
    render(<CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState })} />);
    expect(screen.getByTestId('coin-own-pick').textContent).toMatch(/heads/i);
    expect(screen.getByTestId('coin-opp-pick').textContent).toMatch(/heads/i); // same side accepted
  });
});
