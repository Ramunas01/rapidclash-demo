// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LimboHubScreen } from '../screens/LimboHub.js';
import type { LimboView } from '../App.js';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof LimboHubScreen>[0];
function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'alice', username: 'alice', opponentId: 'bob', balance: 1000,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenRewards: vi.fn(), onOpenAffiliate: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
    ...over,
  };
}
function view(target: number | null = null, over: Partial<LimboView> = {}): LimboView {
  return {
    players: ['alice', 'bob'], round: 0, replays: 0,
    picks: { alice: { target, locked: false }, bob: { target: null, locked: false } },
    ...over,
  };
}
const inMatch = (over: Partial<Props> = {}) => baseProps({ currentMatchId: 'm1', gameState: view(), ...over });

describe('LimboHubScreen (GameHub + LimboPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: arming a bet enables PLAY', () => {
    const onPlay = vi.fn();
    render(<LimboHubScreen {...baseProps({ onPlay })} />);
    fireEvent.click(screen.getByTestId('hub-bet-5'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(5);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<LimboHubScreen {...baseProps({ onPlay })} />);

    const play = screen.getByTestId('hub-play');
    expect(play).toBeEnabled(); // pressable with no stake armed (no longer a dead end)
    fireEvent.click(play);
    expect(onPlay).not.toHaveBeenCalled(); // guided to the bet panel, not started
    expect(scrollSpy).toHaveBeenCalled(); // bet panel scrolled into view
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBe('true');
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/choose your bet/i);

    fireEvent.click(screen.getByTestId('hub-bet-10')); // selecting a bet clears the frame + hint…
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBeNull();
    expect(screen.getByTestId('hub-bet-hint').textContent).toBe('');
    expect(onPlay).not.toHaveBeenCalled(); // …with NO auto-play
  });

  it('In-match: the target ladder renders and LOCK is disabled until a target is chosen', () => {
    render(<LimboHubScreen {...inMatch()} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.getByTestId('target-2')).toBeInTheDocument();
    expect(screen.getByTestId('target-1000000')).toBeInTheDocument();
    expect(screen.getByTestId('lock-btn')).toBeDisabled();
  });

  it('picking a target sends a pick move; LOCK enables once chosen', () => {
    const onMakeMove = vi.fn();
    render(<LimboHubScreen {...inMatch({ onMakeMove })} />);
    fireEvent.click(screen.getByTestId('target-5'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'pick', target: 5 });
    // a view with a chosen target → LOCK enabled
    onMakeMove.mockClear();
    render(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view(5), onMakeMove })} />);
    const lock = screen.getAllByTestId('lock-btn').at(-1)!;
    expect(lock).not.toBeDisabled();
    fireEvent.click(lock);
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'lock' });
  });

  it("Redaction: the opponent's target is never rendered; the roll shows once resolved", () => {
    const resolved = view(null, {
      round: 1,
      lastResult: { round: 0, roll: 2.47, targets: { alice: 2, bob: 5 }, winner: 'alice' },
    });
    render(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved })} />);
    expect(screen.getByTestId('roll-value').textContent).toMatch(/2\.47/);
    expect(screen.getByTestId('hub-slot-opponent').textContent).toMatch(/playing/i);
  });

  it('locked: shows the waiting banner with the locked target', () => {
    const locked = view(10);
    locked.picks.alice.locked = true;
    render(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: locked })} />);
    expect(screen.getByTestId('locked-banner').textContent).toMatch(/10×/);
    expect(screen.queryByTestId('lock-btn')).toBeNull();
  });

  it('T9: registered users see the Owner-approved $ skin in the bet panel too, not just the header wallet chip (GameHub.tsx PlayPanel, CHARTER.md #4)', () => {
    const { container } = render(<LimboHubScreen {...inMatch()} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).toMatch(/\$/);
  });

  it('T9: guest mode keeps the play-money RcIcon bet display — no $ leaks into the game body', () => {
    const { container } = render(<LimboHubScreen {...inMatch({ isGuest: true })} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).not.toMatch(/\$/);
  });

  // ── Shared draw→rematch beat (#161) — reuse proof on a SECOND game ───────────
  // Driven by the generic `replays` signal in GameHub (NOT a per-gameId branch); Limbo gets the
  // beat for free by exposing the same `replays` field every tie-replay module bumps on a push.
  const ownRing = () => screen.getByTestId('hub-slot-own').className;
  const oppRing = () => screen.getByTestId('hub-slot-opponent').className;
  // A non-terminal tie round: replays bumped, a fresh pick round dealt, `lastResult` = the push
  // (winner null). This is exactly what the server sends on the universal-tie replay.
  const tieRound = (replays: number): LimboView =>
    view(null, {
      round: replays,
      replays,
      lastResult: { round: replays - 1, roll: 5, targets: { alice: 5, bob: 5 }, winner: null },
    });

  it('a tie round flashes the orange outline on BOTH bars, holds, then clears for the fresh round', async () => {
    vi.useFakeTimers();
    try {
      const onPlay = vi.fn();
      const { rerender } = render(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view(), onPlay })} />);
      // The server re-deals in the same escrow → a NON-terminal state with replays 0 → 1.
      rerender(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: tieRound(1), onPlay })} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(ownRing()).toContain('ring-amber-400'); // orange on the player's bar
      expect(oppRing()).toContain('ring-amber-400'); // …and the opponent's bar
      expect(onPlay).not.toHaveBeenCalled(); // AUTO-rematch is server-driven — the client never re-posts

      // After the ~2 s hold the outline clears and the fresh pick round stands.
      await act(async () => { await vi.advanceTimersByTimeAsync(2000 + 50); });
      expect(ownRing()).not.toContain('ring-amber-400');
      expect(oppRing()).not.toContain('ring-amber-400');
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-fires the beat on a SECOND consecutive tie (each push is its own beat)', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view() })} />);
      rerender(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: tieRound(1) })} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000 + 50); }); // first beat elapses
      expect(ownRing()).not.toContain('ring-amber-400');
      rerender(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: tieRound(2) })} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(ownRing()).toContain('ring-amber-400'); // the second push beats again
    } finally {
      vi.useRealTimers();
    }
  });

  it('the 10-replay cap terminates as a void via match.end (no infinite client loop), and no re-escrow', async () => {
    vi.useFakeTimers();
    try {
      const onPlay = vi.fn();
      const { rerender } = render(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view(), onPlay })} />);
      // Walk several ties — each a non-terminal replay in the SAME escrow (client posts nothing).
      for (let r = 1; r <= 3; r++) {
        rerender(<LimboHubScreen {...baseProps({ currentMatchId: 'm1', gameState: tieRound(r), onPlay })} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(2000 + 50); });
      }
      expect(onPlay).not.toHaveBeenCalled(); // escrow carried over across every replay — never re-collected

      // At the cap the server settles once and sends match.end(void): currentMatchId clears +
      // a void outcome. The hub shows the terminal result overlay — it does NOT keep beating.
      rerender(<LimboHubScreen {...baseProps({ currentMatchId: null, gameState: tieRound(10), lastOutcome: { type: 'void' }, lastSettlement: { delta: 0, newBalance: 1000 } })} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(2000 + 50); });
      expect(screen.getByTestId('hub-result-overlay')).toBeInTheDocument();
      expect(screen.getByTestId('hub-result-text').textContent).toMatch(/void/i);
      expect(screen.getByTestId('hub-slot-own').className).not.toContain('ring-amber-400'); // beat did not loop
    } finally {
      vi.useRealTimers();
    }
  });
});
