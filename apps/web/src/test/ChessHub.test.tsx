// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import confetti from 'canvas-confetti';
import { ChessHubScreen } from '../screens/ChessHub.js';
import type { ChessView, ChessMove, GameView } from '../App.js';
import type { PlayerClocks, GameMeta } from '@rapidclash/shared';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// Web Audio is absent in jsdom — mock the sound module so we can assert the move-thump wiring
// (play('move') on fen change) without touching real AudioContext. (Same idea as canvas-confetti.)
const { playMock } = vi.hoisted(() => ({ playMock: vi.fn() }));
vi.mock('../lib/sound.js', () => ({
  play: playMock,
  unlock: vi.fn(),
  installUnlockOnFirstGesture: vi.fn(),
  isMuted: () => false,
  toggleMute: vi.fn(),
  setMuted: vi.fn(),
  subscribe: () => () => {},
  preloadSounds: vi.fn(),
}));

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The chess meta the picker is data-driven from (mirrors the module's declared timeControl). */
const CHESS_META: GameMeta = {
  id: 'chess', displayName: 'Chess', minPlayers: 2, maxPlayers: 2,
  ranking: { kind: 'elo', k: 32 }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 300, rakeRate: 0.1,
  timeControl: {
    options: [
      { id: 'bullet1', label: 'Bullet · 1 min', baseMs: 60_000, incrementMs: 0 },
      { id: 'blitz5', label: 'Blitz · 5 min', baseMs: 300_000, incrementMs: 0 },
      { id: 'rapid10', label: 'Rapid · 10 min', baseMs: 600_000, incrementMs: 0 },
    ],
    defaultId: 'rapid10',
  },
};

type Props = Parameters<typeof ChessHubScreen>[0];
function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'alice', username: 'alice', opponentId: 'bob', balance: 1000,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
    ...over,
  };
}

const view = (partial: Partial<ChessView>): GameView => ({ players: ['alice', 'bob'], fen: START_FEN, ...partial } as GameView);
const OPENING: ChessMove[] = [{ from: 'e2', to: 'e4' }, { from: 'e2', to: 'e3' }, { from: 'd2', to: 'd4' }];
const asLegal = (m: ChessMove[]) => m as unknown as string[];
const sq = (c: HTMLElement, s: string): HTMLElement => {
  const el = c.querySelector(`[data-square="${s}"]`);
  if (!el) throw new Error(`square ${s} not rendered`);
  return el as HTMLElement;
};

describe('ChessHubScreen (GameHub + ChessPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games')) return { ok: true, json: async () => [CHESS_META] } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => playMock.mockClear());

  it('plays the move thump when the position (fen) changes — own OR opponent move — but not on the initial board render', () => {
    const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const AFTER_C5 = 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2';
    const { rerender } = render(
      <ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal([]) })} />,
    );
    expect(playMock).not.toHaveBeenCalled(); // no thump on the first (initial) fen

    // A server position update (any player's move updates view.fen) → one thump.
    rerender(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ fen: AFTER_E4 }), legalMoves: asLegal([]) })} />);
    expect(playMock).toHaveBeenCalledWith('move');
    expect(playMock).toHaveBeenCalledTimes(1);

    // A further position change (the opponent's reply) thumps again.
    rerender(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ fen: AFTER_C5 }), legalMoves: asLegal([]) })} />);
    expect(playMock).toHaveBeenCalledTimes(2);

    // A re-render with an UNCHANGED fen must NOT thump.
    rerender(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ fen: AFTER_C5 }), legalMoves: asLegal([]) })} />);
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<ChessHubScreen {...baseProps({ onPlay })} />);

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

  it('Idle: the time-control picker (data-driven from meta.timeControl) drives PLAY → onPlay(stake, control)', async () => {
    const onPlay = vi.fn();
    render(<ChessHubScreen {...baseProps({ onPlay })} />);
    // The picker appears once /games resolves; default control is preselected.
    await screen.findByTestId('hub-tc-rapid10');
    expect(screen.getByTestId('hub-tc-blitz5')).toBeInTheDocument();
    expect(screen.getByTestId('hub-tc-bullet1')).toBeInTheDocument();

    // Default control → PLAY posts at rapid10.
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenLastCalledWith(10, 'rapid10');

    // Pick Blitz → PLAY posts at blitz5.
    fireEvent.click(screen.getByTestId('hub-tc-blitz5'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenLastCalledWith(10, 'blitz5');
  });

  it('In-match: the board activates and a legal click sends the {from,to} move; an illegal target does not', () => {
    const onMakeMove = vi.fn();
    const { container } = render(
      <ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal(OPENING), onMakeMove })} />,
    );
    expect(screen.getByTestId('chess-board')).toBeInTheDocument();

    fireEvent.click(sq(container, 'e2')); // select the pawn
    fireEvent.click(sq(container, 'e4')); // push it (a server-issued legal target)
    expect(onMakeMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });

    onMakeMove.mockClear();
    fireEvent.click(sq(container, 'e2'));
    fireEvent.click(sq(container, 'e5')); // not in legalMoves → never sent
    expect(onMakeMove).not.toHaveBeenCalled();
  });

  it('Picker: each option is a two-line button — large duration over small mode name', async () => {
    render(<ChessHubScreen {...baseProps()} />);
    const rapid = await screen.findByTestId('hub-tc-rapid10');
    expect(rapid.textContent).toContain('10 min');
    expect(rapid.textContent).toContain('Rapid');
    expect(screen.getByTestId('hub-tc-bullet1').textContent).toContain('1 min');
    expect(screen.getByTestId('hub-tc-bullet1').textContent).toContain('Bullet');
    // Default control (rapid10) is pre-selected. The selection settles a tick after the picker
    // mounts (it's set by an effect once /games resolves the meta), so wait for it rather than
    // reading aria-pressed synchronously — otherwise the assertion races the effect (flaky).
    await waitFor(() => expect(screen.getByTestId('hub-tc-rapid10').getAttribute('aria-pressed')).toBe('true'));
  });

  it('In-match: the clocks live INSIDE the slot pills (opponent above, you below)', () => {
    const clock: PlayerClocks = {
      remainingMs: { alice: 300_000, bob: 8_000 }, active: 'bob', activeSince: Date.now(), timeControlId: 'blitz5',
    };
    render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ clock }), legalMoves: asLegal([]) })} />);

    // Migrated into the pills — not a separate grey clock table above the board.
    const ownPill = within(screen.getByTestId('hub-slot-own'));
    const oppPill = within(screen.getByTestId('hub-slot-opponent'));
    const self = ownPill.getByTestId('chess-clock-self');
    const opp = oppPill.getByTestId('chess-clock-opponent');
    expect(self.textContent).toContain('5:00'); // alice, paused at full
    expect(self.getAttribute('data-active')).toBe('false');
    // bob is on the move with <10s left → active + low-time.
    expect(opp.getAttribute('data-active')).toBe('true');
    expect(opp.getAttribute('data-low-time')).toBe('true');
  });

  // The visual order of the rendered squares tells us the orientation: react-chessboard renders
  // rows top→bottom, so white-orientation's first square is a8 (top-left) and last is h1; black
  // flips it (first h1, last a8). No layout needed — pure DOM order.
  const squareOrder = (c: HTMLElement): string[] =>
    Array.from(c.querySelectorAll('[data-square]')).map((el) => el.getAttribute('data-square')!);

  it('Fresh idle: the board is NEVER empty — the full starting position, white at the bottom, static (no interaction, no on-board text)', async () => {
    const onMakeMove = vi.fn();
    const { container } = render(<ChessHubScreen {...baseProps({ onMakeMove })} />);
    await screen.findByTestId('hub-tc-rapid10'); // wait for /games

    // The starting position is shown (all 32 pieces), not an empty grid.
    expect(container.querySelectorAll('[data-piece]').length).toBe(32);
    // White at the bottom: a8 first (top-left), h1 last (bottom-right).
    const order = squareOrder(container);
    expect(order[0]).toBe('a8');
    expect(order[order.length - 1]).toBe('h1');

    // Static: no legalMoves (no live game) → a click never produces a move, no selection highlight.
    fireEvent.click(sq(container, 'e2'));
    fireEvent.click(sq(container, 'e4'));
    expect(onMakeMove).not.toHaveBeenCalled();

    // No on-board helper copy.
    expect(container.textContent ?? '').not.toMatch(/tap a piece/i);
    expect(container.textContent ?? '').not.toMatch(/pick a bet/i);
    expect(container.textContent ?? '').not.toMatch(/waiting for an opponent…/i);
  });

  it('Live as black: a game where the player is black flips the board (black at the bottom) and unlocks interaction', () => {
    const onMakeMove = vi.fn();
    const { container } = render(
      // players[0] is bob → alice (playerId) is black; her legal opening replies drive interaction.
      <ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ players: ['bob', 'alice'] }), legalMoves: asLegal(OPENING), onMakeMove })} />,
    );
    // Black at the bottom: the square order is flipped (h1 first, a8 last).
    const order = squareOrder(container);
    expect(order[0]).toBe('h1');
    expect(order[order.length - 1]).toBe('a8');
    // Interactive: a server-issued legal move sends {from,to}.
    fireEvent.click(sq(container, 'e2'));
    fireEvent.click(sq(container, 'e4'));
    expect(onMakeMove).toHaveBeenCalledWith({ from: 'e2', to: 'e4' });
  });

  it('Post-game idle: the finished position stays frozen and static (gameState retained, no live match, no legalMoves)', () => {
    // The round-scoped-state rule retains gameState after the match ends until PLAY/leave, so an
    // idle hub with a retained view shows that final position — kept on the played orientation, static.
    const FINAL_FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const onMakeMove = vi.fn();
    const { container } = render(
      <ChessHubScreen {...baseProps({ currentMatchId: null, gameState: view({ fen: FINAL_FEN }), legalMoves: asLegal([]), onMakeMove })} />,
    );
    // The board renders the retained final position (pieces present), not the empty/starting grid.
    expect(screen.getByTestId('chess-board')).toBeInTheDocument();
    expect(container.querySelector('[data-square="e4"] [data-piece]')).not.toBeNull(); // the played e4 pawn
    // Static: no legalMoves → a click sends nothing (frozen final).
    fireEvent.click(sq(container, 'e2'));
    fireEvent.click(sq(container, 'e4'));
    expect(onMakeMove).not.toHaveBeenCalled();
  });

  it('not-your-turn: no legalMoves → a click never produces a move (pieces inert)', () => {
    const onMakeMove = vi.fn();
    const { container } = render(
      <ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal([]), onMakeMove })} />,
    );
    // The board still renders, but with no server-issued legalMoves a click sends nothing.
    expect(screen.getByTestId('chess-board')).toBeInTheDocument();
    fireEvent.click(sq(container, 'e2'));
    fireEvent.click(sq(container, 'e4'));
    expect(onMakeMove).not.toHaveBeenCalled();
  });

  it('Feed: a chess open-challenge shows in the cross-game Open Games ticker (game + ¢ stake)', async () => {
    const challenge = {
      matchId: 'c1', ownerName: 'rival', stake: 10, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'blitz5',
    };
    render(<ChessHubScreen {...baseProps({ challengesByGame: { chess: [challenge] } })} />);
    // The revised hub uses the Home page's cross-game ticker (no per-row time-control chip).
    await waitFor(() => expect(screen.getByTestId('home-row-c1')).toBeInTheDocument());
    expect(screen.getByTestId('home-stake-c1').textContent).toBe('10¢');
    expect(screen.getByTestId('home-row-game-c1').textContent).toBe('Chess');
  });

  // ── Chess result: lightweight in-hub popup + persistent bar outline (replaces the heavy overlay) ──
  type Outcome = NonNullable<Props['lastOutcome']>;
  // Drive the hub from in-match to the terminal result: render live, then rerender with the match
  // ended (currentMatchId cleared + the server outcome/settlement present) — chess has no holdResultMs
  // so the result phase is entered immediately.
  function renderToChessResult(outcome: Outcome, over: Partial<Props> = {}) {
    Element.prototype.scrollIntoView = vi.fn();
    const gameState = view({ fen: START_FEN });
    const { rerender } = render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]), ...over })} />);
    rerender(
      <ChessHubScreen {...baseProps({ currentMatchId: null, gameState, lastOutcome: outcome, lastSettlement: { delta: 0, newBalance: 1000 }, ...over })} />,
    );
    return { rerender, gameState };
  }

  it('Result: NO heavy overlay — no blur/confetti/wallet/balance/trophy/X; the frozen board stays sharp behind', () => {
    renderToChessResult({ type: 'win', winner: 'alice' });
    // The shared heavy overlay is suppressed for chess.
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull(); // no modal/blur backdrop
    expect(screen.queryByTestId('hub-result-delta')).toBeNull(); // no wallet-change line
    expect(screen.queryByTestId('hub-result-text')).toBeNull(); // no trophy/heavy result text
    expect(confetti).not.toHaveBeenCalled(); // no confetti
    // The frozen board is still mounted and sharp (no blur/darkening).
    expect(screen.getByTestId('chess-board')).toBeInTheDocument();
    // The lightweight in-hub popup shows instead.
    expect(screen.getByTestId('chess-result-popup')).toBeInTheDocument();
  });

  it.each([
    [{ type: 'win', winner: 'alice' } as Outcome, /you won/i, 'ring-success'],
    [{ type: 'win', winner: 'bob' } as Outcome, /rival won/i, 'ring-destructive'], // a loss → opponent's name
    [{ type: 'draw' } as Outcome, /^draw$/i, 'ring-amber-400'],
  ])('Result popup: a small native navy panel with the one-line text + the outcome outline (%o)', (outcome, textRe, ringClass) => {
    renderToChessResult(outcome, { opponentName: 'rival' });
    const popup = screen.getByTestId('chess-result-popup');
    expect(popup.className).toContain('bg-surface'); // same navy surface as the play panel — not a modal
    expect(popup.className).toContain(ringClass); // green / red / orange outcome outline
    expect(screen.getByTestId('chess-result-text').textContent).toMatch(textRe);
    expect(popup.getAttribute('data-outcome')).toBe(outcome.type === 'win' ? (outcome.winner === 'alice' ? 'win' : 'lose') : 'draw');
  });

  it('Result popup: every outcome dismisses on its own animation at 6.0 s', async () => {
    vi.useFakeTimers();
    try {
      renderToChessResult({ type: 'draw' });
      expect(screen.getByTestId('chess-result-popup')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(5900); });
      expect(screen.getByTestId('chess-result-popup')).toBeInTheDocument(); // still there just before 6 s (fading out)
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(screen.queryByTestId('chess-result-popup')).toBeNull(); // gone at 6.0 s
    } finally {
      vi.useRealTimers();
    }
  });

  it('Result popup — win: two-phase green flash (green fill, then fades to navy leaving the text + green outline)', async () => {
    vi.useFakeTimers();
    try {
      renderToChessResult({ type: 'win', winner: 'alice' });
      // Phase 1 (first beat): the panel is green-filled, "You Won".
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(screen.getByTestId('chess-result-fill')).toBeInTheDocument();
      expect(screen.getByTestId('chess-result-text').textContent).toMatch(/you won/i);
      // Phase 2 (after ~3.5 s): the green fill is gone, the navy panel + green outline + text remain.
      await act(async () => { await vi.advanceTimersByTimeAsync(3400); });
      expect(screen.queryByTestId('chess-result-fill')).toBeNull();
      expect(screen.getByTestId('chess-result-popup').className).toContain('ring-success');
      expect(screen.getByTestId('chess-result-text').textContent).toMatch(/you won/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Persistent own-bar outline: outlives the 6 s popup and clears on PLAY (round-scoped-state rule)', async () => {
    vi.useFakeTimers();
    try {
      renderToChessResult({ type: 'win', winner: 'alice' });
      // Settle the bar win-reveal (beat 250 + shared 0.5/2/0.5 = 3000) — staged so each timer's
      // re-render schedules the next (chained fake timers don't cascade in one big advance).
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3200); });
      expect(screen.getByTestId('hub-slot-own').className).toContain('ring-success'); // bar settled to its outline
      // Run past the popup's 6 s dismissal.
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(screen.queryByTestId('chess-result-popup')).toBeNull(); // popup gone…
      expect(screen.getByTestId('hub-slot-own').className).toContain('ring-success'); // …but the own-bar outline persists

      // PLAY (a new game) clears it: arm a bet, then press PLAY.
      fireEvent.click(screen.getByTestId('hub-bet-10'));
      fireEvent.click(screen.getByTestId('hub-play'));
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(screen.getByTestId('hub-slot-own').className).not.toContain('ring-success'); // outline cleared on PLAY
    } finally {
      vi.useRealTimers();
    }
  });

  it('Chess draw: the orange "Draw" result on the frozen board — terminal, no auto-rematch', () => {
    // A chess draw is a TERMINAL result (the popup only shows on match.end), never a mid-match replay:
    // chess carries no `replays`, so the shared draw→auto-rematch beat (fast/chance games only) never
    // fires. Refund-both / no-rake is server-authoritative (outcome {type:'draw'}, no winner → core
    // rakes 0 and refunds; covered in packages/games/chess + core settlement). Here: the presentation.
    renderToChessResult({ type: 'draw' }, { opponentName: 'rival' });
    expect(screen.getByTestId('chess-result-text').textContent).toMatch(/^draw$/i);
    expect(screen.getByTestId('chess-result-popup').className).toContain('ring-amber-400'); // orange
    expect(screen.getByTestId('chess-board')).toBeInTheDocument(); // stays on the frozen final position
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull(); // no heavy overlay, no auto-rematch UI
  });

  // ── Bug 1: JOIN gating — Open Games allows JOIN in the settled result view (match already deleted) ──
  const CHALLENGE = { matchId: 'j1', ownerName: 'rival', stake: 10, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'blitz5' };

  it('Bug 1: the settled post-game result view still allows JOIN on Open Games (no "one match at a time")', async () => {
    // The match is settled/deleted server-side once ended, so idling on the result board must NOT
    // block joining another open game — JOIN stays open exactly as it is in plain idle.
    renderToChessResult({ type: 'win', winner: 'alice' }, { challengesByGame: { chess: [CHALLENGE] }, opponentName: 'rival' });
    await waitFor(() => expect(screen.getByTestId('home-join-j1')).toBeInTheDocument());
    expect(screen.getByTestId('home-join-j1')).not.toBeDisabled();
    expect(screen.queryByText(/one match at a time/i)).toBeNull();
  });

  it('Bug 1: JOIN is still correctly blocked while actually in a match', async () => {
    render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal([]), challengesByGame: { chess: [CHALLENGE] } })} />);
    await waitFor(() => expect(screen.getByTestId('home-join-j1')).toBeInTheDocument());
    expect(screen.getByTestId('home-join-j1')).toBeDisabled(); // in-match → one commitment at a time
    expect(screen.getByText(/one match at a time/i)).toBeInTheDocument();
  });

  // ── Draw offers: the secondary-action button (Play a Friend → Draw request ⇄ Revoke DRAW) + indicator ──
  describe('Draw offers (CHESS_DRAW_OFFER.md)', () => {
    const inMatch = (over: Partial<Props> = {}) =>
      baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal(OPENING), ...over });

    it('idle shows the default Play a Friend, not a draw control', () => {
      render(<ChessHubScreen {...baseProps()} />);
      expect(screen.getByTestId('hub-play-friend')).toBeInTheDocument();
      expect(screen.queryByTestId('chess-draw-offer')).toBeNull();
      expect(screen.queryByTestId('chess-draw-revoke')).toBeNull();
    });

    it('in-match replaces Play a Friend with "Draw request"; tapping it sends onDrawOffer', () => {
      const onDrawOffer = vi.fn();
      render(<ChessHubScreen {...inMatch({ onDrawOffer })} />);
      const btn = screen.getByTestId('chess-draw-offer');
      expect(btn).toHaveTextContent(/draw request/i);
      expect(screen.queryByTestId('hub-play-friend')).toBeNull();
      fireEvent.click(btn);
      expect(onDrawOffer).toHaveBeenCalledTimes(1);
    });

    it('after you offer (public state) the button becomes "Revoke DRAW"; tapping it sends onDrawRevoke', () => {
      const onDrawRevoke = vi.fn();
      render(<ChessHubScreen {...inMatch({ gameState: view({ drawOffers: { alice: 3 } }), onDrawRevoke })} />);
      const btn = screen.getByTestId('chess-draw-revoke');
      expect(btn).toHaveTextContent(/revoke draw/i);
      expect(screen.queryByTestId('chess-draw-offer')).toBeNull();
      fireEvent.click(btn);
      expect(onDrawRevoke).toHaveBeenCalledTimes(1);
    });

    it('shows the "Draw offered" indicator on YOUR bar when you have offered', () => {
      render(<ChessHubScreen {...inMatch({ gameState: view({ drawOffers: { alice: 3 } }) })} />);
      expect(screen.getByTestId('chess-draw-offered-self')).toHaveTextContent(/draw offered/i);
      expect(screen.queryByTestId('chess-draw-offered-opponent')).toBeNull();
    });

    it("shows the indicator on the OPPONENT's bar when they have offered (both screens see the offerer)", () => {
      render(<ChessHubScreen {...inMatch({ gameState: view({ drawOffers: { bob: 3 } }) })} />);
      expect(screen.getByTestId('chess-draw-offered-opponent')).toBeInTheDocument();
      expect(screen.queryByTestId('chess-draw-offered-self')).toBeNull();
      // The opponent offered, not me → my button is still "Draw request" (mine to match or ignore).
      expect(screen.getByTestId('chess-draw-offer')).toBeInTheDocument();
    });

    it('no indicator in idle/preview (only surfaces in an active match)', () => {
      render(<ChessHubScreen {...baseProps({ gameState: view({ drawOffers: { alice: 3 } }) })} />);
      expect(screen.queryByTestId('chess-draw-offered-self')).toBeNull();
    });
  });

  // ── Resign: the three-state primary-action button (client-only; reuses the existing forfeit) ──
  describe('Resign (primary-action button: PLAY → RESIGN → Confirm)', () => {
    const inMatch = (over: Partial<Props> = {}) =>
      baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal(OPENING), ...over });

    it('idle shows the default PLAY button, not RESIGN', () => {
      render(<ChessHubScreen {...baseProps()} />);
      expect(screen.getByTestId('hub-play')).toBeInTheDocument();
      expect(screen.queryByTestId('chess-resign')).toBeNull();
      expect(screen.queryByTestId('chess-resign-confirm')).toBeNull();
    });

    it('in-match shows RESIGN in place of the default PLAY button', () => {
      render(<ChessHubScreen {...inMatch()} />);
      expect(screen.getByTestId('chess-resign')).toHaveTextContent(/resign/i);
      expect(screen.queryByTestId('hub-play')).toBeNull();
    });

    it('tapping RESIGN arms a red "Confirm resign" — one tap never forfeits', () => {
      const onForfeit = vi.fn();
      render(<ChessHubScreen {...inMatch({ onForfeit })} />);
      fireEvent.click(screen.getByTestId('chess-resign'));
      const confirm = screen.getByTestId('chess-resign-confirm');
      expect(confirm).toHaveTextContent(/confirm resign/i);
      expect(confirm.className).toContain('bg-destructive'); // red
      expect(onForfeit).not.toHaveBeenCalled(); // the first (accidental) tap must not resign
    });

    it('the deliberate second tap on Confirm resign forfeits via the existing path', () => {
      const onForfeit = vi.fn();
      render(<ChessHubScreen {...inMatch({ onForfeit })} />);
      fireEvent.click(screen.getByTestId('chess-resign'));
      fireEvent.click(screen.getByTestId('chess-resign-confirm'));
      expect(onForfeit).toHaveBeenCalledTimes(1);
    });

    it('no confirm within ~3 s auto-reverts to RESIGN (accidental first tap cancels itself)', () => {
      vi.useFakeTimers();
      try {
        const onForfeit = vi.fn();
        render(<ChessHubScreen {...inMatch({ onForfeit })} />);
        fireEvent.click(screen.getByTestId('chess-resign'));
        expect(screen.getByTestId('chess-resign-confirm')).toBeInTheDocument();
        act(() => { vi.advanceTimersByTime(3000); });
        expect(screen.getByTestId('chess-resign')).toBeInTheDocument(); // reverted
        expect(screen.queryByTestId('chess-resign-confirm')).toBeNull();
        expect(onForfeit).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── ClockPill: thick turn border + never pulse a dead/ended clock (Advisor #9) ──────────────
  describe('ClockPill: turn border weight + never pulse a dead/ended clock (Advisor #9)', () => {
    it('the active clock gets the thick full-opacity brand ring (ring-2 ring-brand), not the old faint ring-1/40', () => {
      const clock: PlayerClocks = {
        remainingMs: { alice: 300_000, bob: 8_000 }, active: 'bob', activeSince: Date.now(), timeControlId: 'blitz5',
      };
      render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ clock }), legalMoves: asLegal([]) })} />);
      const opp = within(screen.getByTestId('hub-slot-opponent')).getByTestId('chess-clock-opponent');
      expect(opp.className).toContain('ring-2');
      expect(opp.className).toContain('ring-brand');
      expect(opp.className).not.toContain('ring-1');
      expect(opp.className).not.toContain('ring-brand/40');
    });

    it('a low + active clock with ms > 0 still pulses during play (the live low-time warning is unaffected)', () => {
      const clock: PlayerClocks = {
        remainingMs: { alice: 300_000, bob: 8_000 }, active: 'bob', activeSince: Date.now(), timeControlId: 'blitz5',
      };
      render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ clock }), legalMoves: asLegal([]) })} />);
      const opp = within(screen.getByTestId('hub-slot-opponent')).getByTestId('chess-clock-opponent');
      expect(opp.getAttribute('data-active')).toBe('true');
      expect(opp.getAttribute('data-low-time')).toBe('true');
      expect(opp.className).toContain('animate-pulse'); // still running, under 10s → live warning intact
    });

    it('a clock at ms === 0 never gets animate-pulse, even while nominally "active" per the raw server clock', () => {
      const clock: PlayerClocks = {
        remainingMs: { alice: 0, bob: 300_000 }, active: 'alice', activeSince: Date.now(), timeControlId: 'blitz5',
      };
      render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ clock }), legalMoves: asLegal([]) })} />);
      const own = within(screen.getByTestId('hub-slot-own')).getByTestId('chess-clock-self');
      expect(own.textContent).toContain('0:00');
      expect(own.getAttribute('data-active')).toBe('true'); // clock.active === 'alice' — nominally active
      expect(own.getAttribute('data-low-time')).toBe('true');
      expect(own.className).not.toContain('animate-pulse'); // a dead clock (ms === 0) never pulses
    });

    it('once the match has ended (result phase), neither clock shows the active ring/dot or pulses — the timed-out clock freezes on a static red 0:00', () => {
      // forfeit() (resign/timeout) sets forcedOutcome but never clears clock.active — the raw server
      // clock still says 'alice' is active. The client must render BOTH clocks fully static once the
      // round is over, regardless of that stale active flag.
      const clock: PlayerClocks = {
        remainingMs: { alice: 0, bob: 300_000 }, active: 'alice', activeSince: Date.now(), timeControlId: 'blitz5',
      };
      renderToChessResult({ type: 'win', winner: 'bob' }, { gameState: view({ fen: START_FEN, clock }) });

      const own = within(screen.getByTestId('hub-slot-own')).getByTestId('chess-clock-self');
      const opp = within(screen.getByTestId('hub-slot-opponent')).getByTestId('chess-clock-opponent');

      expect(own.getAttribute('data-active')).toBe('false');
      expect(opp.getAttribute('data-active')).toBe('false');
      expect(own.className).not.toContain('animate-pulse');
      expect(opp.className).not.toContain('animate-pulse');
      expect(own.className).not.toContain('ring-2'); // no turn border on either side once ended

      // The timed-out/losing clock (alice, 0 ms) still reads a static red 0:00 — the low → red
      // coloring stays independent of active, so the loser's clock is frozen, not blank.
      expect(own.textContent).toContain('0:00');
      expect(own.className).toContain('text-destructive');
    });
  });
});
