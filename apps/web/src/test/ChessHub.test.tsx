// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import confetti from 'canvas-confetti';
import { ChessHubScreen } from '../screens/ChessHub.js';
import type { ChessView, ChessMove, GameView } from '../App.js';
import type { PlayerClocks, GameMeta, OpenChallenge } from '@rapidclash/shared';
import { balancesOf } from './testBalances.js';

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
  ranking: { kind: 'elo', k: 32 }, bet: { minStake: 1, maxStake: 10000, symmetricStake: true },
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
    token: 'tok', playerId: 'alice', username: 'alice', opponentId: 'bob', balances: balancesOf(1000),
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenSignup: vi.fn(), onOpenRewards: vi.fn(), onOpenAffiliate: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
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
      return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
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
    // Ticket 2026-10-04#4 (D80): repointed from the generic 'move' clip to Chess's own dedicated
    // 'chess-piece-move' — same trigger, new asset.
    rerender(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ fen: AFTER_E4 }), legalMoves: asLegal([]) })} />);
    expect(playMock).toHaveBeenCalledWith('chess-piece-move');
    expect(playMock).toHaveBeenCalledTimes(1);

    // A further position change (the opponent's reply) thumps again.
    rerender(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ fen: AFTER_C5 }), legalMoves: asLegal([]) })} />);
    expect(playMock).toHaveBeenCalledTimes(2);

    // A re-render with an UNCHANGED fen must NOT thump.
    rerender(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ fen: AFTER_C5 }), legalMoves: asLegal([]) })} />);
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  // Ticket 2026-10-04#4 (D80): the verification plan's own extra cases — a castling move is still
  // ONE fen transition (one sound), and neither selecting/deselecting a piece nor an illegal drop
  // attempt ever mutates fen, so both stay silent.
  it('a castling move (king+rook, one FEN transition) plays the move sound exactly once, not twice', () => {
    const BEFORE_CASTLE = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const AFTER_CASTLE = 'r3k2r/8/8/8/8/8/8/2KR3R w kq - 1 1'; // white castled queenside
    const { rerender } = render(
      <ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ fen: BEFORE_CASTLE }), legalMoves: asLegal([]) })} />,
    );
    expect(playMock).not.toHaveBeenCalled();
    rerender(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ fen: AFTER_CASTLE }), legalMoves: asLegal([]) })} />);
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(playMock).toHaveBeenCalledWith('chess-piece-move');
  });

  it('selecting a piece, and an illegal drop attempt, both play ZERO move sounds — neither ever mutates fen', () => {
    render(
      <ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal(OPENING) })} />,
    );
    const board = screen.getByTestId('chess-board');
    fireEvent.click(sq(board, 'e2')); // select — no move, no fen change
    expect(playMock).not.toHaveBeenCalled();

    fireEvent.click(sq(board, 'e5')); // not a legal destination for this piece per the OPENING list
    expect(playMock).not.toHaveBeenCalled(); // attemptMove returns false, selection just updates, no fen change
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
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/choose your bet/i);

    fireEvent.click(screen.getByTestId('hub-bet-10')); // selecting a bet clears the frame + hint…
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBeNull();
    expect(screen.getByTestId('hub-bet-hint').textContent).toBe('');
    expect(onPlay).not.toHaveBeenCalled(); // …with NO auto-play
  });

  // Ticket 2026-09-12 (Chess high-stake escalation, PM-scoped product decision — no prototype
  // source exists; `Full Spec.html` only ever sets a bet chip to its exact tapped value, no
  // escalation gesture anywhere). Chess-only: the "100" preset's tap-again gesture cycles through
  // CHESS_HIGH_STAKES (ChessHub.tsx), the same #381 "1→2" gesture shape generalized via GameHub's
  // `highStakeCycle` prop. Mirrors CoinflipHub.test.tsx's #381 describe block structure closely.
  describe('ticket 2026-09-12: tap-again on the 100 preset cycles the Chess-only high-stake tiers', () => {
    it('repeated taps cycle 100 → 250 → 500 → 1000 → 2500 → 5000 → 10000 → back to 100', () => {
      render(<ChessHubScreen {...baseProps()} />);
      const preset = screen.getByTestId('hub-bet-100');
      const expected = [100, 250, 500, 1000, 2500, 5000, 10000, 100];
      for (const stake of expected) {
        fireEvent.click(preset);
        expect(preset.textContent).toBe(`$${stake.toLocaleString('en-US')}`);
        expect(preset.getAttribute('aria-pressed')).toBe('true');
      }
    });

    it('tapping a different preset then tapping 100 again lands on exactly 100, not mid-cycle', () => {
      render(<ChessHubScreen {...baseProps()} />);
      const preset = screen.getByTestId('hub-bet-100');
      fireEvent.click(preset); // 100
      fireEvent.click(preset); // 250
      fireEvent.click(preset); // 500
      fireEvent.click(screen.getByTestId('hub-bet-10')); // a different preset resets the gesture
      fireEvent.click(preset); // fresh tap on 100
      expect(preset.textContent).toBe('$100');
      expect(preset.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('hub-bet-10').getAttribute('aria-pressed')).toBe('false');
    });

    it('none of the intermediate high-stake tiers ever appear as their own preset button in the grid', () => {
      render(<ChessHubScreen {...baseProps()} />);
      const preset = screen.getByTestId('hub-bet-100');
      for (const tier of [250, 500, 1000, 2500, 5000, 10000]) {
        expect(screen.queryByTestId(`hub-bet-${tier}`)).toBeNull();
      }
      fireEvent.click(preset); // 100
      fireEvent.click(preset); // 250
      for (const tier of [250, 500, 1000, 2500, 5000, 10000]) {
        expect(screen.queryByTestId(`hub-bet-${tier}`)).toBeNull(); // still no separate grid entry
      }
    });
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

  it('Feed: a chess open-challenge shows in the shared GamesCarousel (game + stake)', async () => {
    const challenge: OpenChallenge = {
      matchId: 'c1', ownerName: 'rival', ownerTier: 'Unranked', stake: 10, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'blitz5', currency: 'USD',
    };
    render(<ChessHubScreen {...baseProps({ challengesByGame: { chess: [challenge] } })} />);
    // The hub uses the same GamesCarousel the Home page renders (no per-row time-control chip).
    await waitFor(() => expect(document.querySelector('[data-match-id="c1"]')).toBeTruthy());
    const row = document.querySelector('[data-match-id="c1"]') as HTMLElement;
    // registered (default loggedIn: true) → the Owner-approved $ skin, 2026-09-11#8 item B.2
    expect(within(row).getByTestId(/^games-carousel-stake-/).textContent).toBe('$10');
    expect(within(row).getByTestId(/^games-carousel-game-/).textContent).toBe('Chess');
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
      <ChessHubScreen {...baseProps({ currentMatchId: null, gameState, lastOutcome: outcome, lastSettlement: { delta: 0, newBalance: 1000, currency: 'USD' }, ...over })} />,
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

  // Ticket 2026-09-27#2 (D64): the popup's own ring is now the Chess-local literal color
  // (`chessPopupOutlineStyle`, `--tw-ring-color` inline), not the shared `ring-success`/
  // `ring-destructive`/`ring-amber-400` classes — same inline-color shape as `OwnSlot`'s own
  // `lossRingColor`/`winRingColor`/`drawRingColor` allow-list pattern (see DiceHub.test.tsx's
  // equivalent assertions).
  it.each([
    [{ type: 'win', winner: 'alice' } as Outcome, /you won/i, '#16A34A'],
    [{ type: 'win', winner: 'bob' } as Outcome, /rival won/i, '#FF3E5E'], // a loss → opponent's name
    [{ type: 'draw' } as Outcome, /^draw$/i, '#FF8A1E'],
  ])('Result popup: a small native navy panel with the one-line text + the outcome outline (%o)', (outcome, textRe, ringColor) => {
    renderToChessResult(outcome, { opponentName: 'rival' });
    const popup = screen.getByTestId('chess-result-popup');
    expect(popup.className).toContain('bg-surface'); // same navy surface as the play panel — not a modal
    expect(popup.className).toContain('ring-[3px]');
    expect(popup.style.getPropertyValue('--tw-ring-color')).toBe(ringColor); // green / red / orange outcome outline
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
      const popup = screen.getByTestId('chess-result-popup');
      expect(popup.className).toContain('ring-[3px]');
      expect(popup.style.getPropertyValue('--tw-ring-color')).toBe('#16A34A'); // ticket 2026-09-27#2
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
      // Ticket 2026-09-27#2 (D64): the own-bar ring is now the inline #16A34A (Chess joined the
      // GameHub.tsx allow-list), not the shared ring-success class.
      const ownBar = screen.getByTestId('hub-slot-own');
      expect(ownBar.className).toContain('ring-[3px]'); // bar settled to its outline
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('#16A34A');
      // Run past the popup's 6 s dismissal.
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(screen.queryByTestId('chess-result-popup')).toBeNull(); // popup gone…
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('#16A34A'); // …but the own-bar outline persists

      // PLAY (a new game) clears it: arm a bet, then press PLAY.
      fireEvent.click(screen.getByTestId('hub-bet-10'));
      fireEvent.click(screen.getByTestId('hub-play'));
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(ownBar.className).not.toContain('ring-[3px]'); // outline cleared on PLAY
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-10-04#4 (D80), item 2: the generic win sound, extended to Chess via the same
  // `winSoundName` gate D79 built for Coinflip. Only ONE win-triggering test is needed per end
  // reason — confirmed by reading the code, not assumed: `lastOutcome` is the single uniform
  // `{type, winner}` shape every one of Chess's end reasons (checkmate's own ordinary match.end,
  // resignation, timeout, opponent-disconnect-forfeit) resolves into before it ever reaches this
  // component — `ChessHub.tsx` has no separate per-reason branch, and `forcedOutcome` (the
  // resign/timeout/disconnect-side field on `ChessView`) is never actually read by this component
  // or `GameHub.tsx` at all (grepped both — zero hits beyond one doc comment). So a win is a win
  // here regardless of why the match ended; one test genuinely covers all 4 reasons structurally.
  it('play("generic-win") fires exactly once on a win, in the same beat the bar\'s own green fill starts', async () => {
    vi.useFakeTimers();
    try {
      renderToChessResult({ type: 'win', winner: 'alice' });
      expect(playMock.mock.calls.filter((c) => c[0] === 'generic-win')).toHaveLength(0); // not yet — still mid pre-fill beat
      await act(async () => { await vi.advanceTimersByTimeAsync(300); }); // past the 250ms bar-verdict beat → fill-in starts
      expect(playMock.mock.calls.filter((c) => c[0] === 'generic-win')).toHaveLength(1);
      // Stays at exactly 1 through the rest of the reveal (fill-in → hold → fade-out → settle).
      await act(async () => { await vi.advanceTimersByTimeAsync(3200); });
      expect(playMock.mock.calls.filter((c) => c[0] === 'generic-win')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('play("generic-win") never fires on a loss or a draw — zero calls through the whole reveal, either way', async () => {
    vi.useFakeTimers();
    try {
      renderToChessResult({ type: 'win', winner: 'bob' }); // a loss (opponent won)
      await act(async () => { await vi.advanceTimersByTimeAsync(300 + 3200); });
      expect(playMock.mock.calls.filter((c) => c[0] === 'generic-win')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }

    playMock.mockClear();
    vi.useFakeTimers();
    try {
      renderToChessResult({ type: 'draw' });
      await act(async () => { await vi.advanceTimersByTimeAsync(300 + 3200); });
      expect(playMock.mock.calls.filter((c) => c[0] === 'generic-win')).toHaveLength(0);
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
    // Ticket 2026-09-27#2 (D64): inline #FF8A1E (Chess joined GameHub.tsx's drawRingColor
    // allow-list), not the shared ring-amber-400 class.
    const popup = screen.getByTestId('chess-result-popup');
    expect(popup.className).toContain('ring-[3px]');
    expect(popup.style.getPropertyValue('--tw-ring-color')).toBe('#FF8A1E'); // orange
    expect(screen.getByTestId('chess-board')).toBeInTheDocument(); // stays on the frozen final position
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull(); // no heavy overlay, no auto-rematch UI
  });

  // ── Bug 1: JOIN gating — Open Games allows JOIN in the settled result view (match already deleted) ──
  const CHALLENGE: OpenChallenge = { matchId: 'j1', ownerName: 'rival', ownerTier: 'Unranked', stake: 10, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'blitz5', currency: 'USD' };

  it('Bug 1: the settled post-game result view still allows JOIN on Open Games', async () => {
    // The match is settled/deleted server-side once ended, so idling on the result board must NOT
    // block joining another open game — JOIN stays open exactly as it is in plain idle.
    renderToChessResult({ type: 'win', winner: 'alice' }, { challengesByGame: { chess: [CHALLENGE] }, opponentName: 'rival' });
    await waitFor(() => expect(document.querySelector('[data-match-id="j1"]')).toBeTruthy());
    const join = within(document.querySelector('[data-match-id="j1"]') as HTMLElement).getByTestId(/^games-carousel-join-/);
    expect(join).not.toBeDisabled();
  });

  it('Bug 1: JOIN is still correctly blocked while actually in a match', async () => {
    render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal([]), challengesByGame: { chess: [CHALLENGE] } })} />);
    await waitFor(() => expect(document.querySelector('[data-match-id="j1"]')).toBeTruthy());
    const join = within(document.querySelector('[data-match-id="j1"]') as HTMLElement).getByTestId(/^games-carousel-join-/);
    expect(join).toBeDisabled(); // in-match → one commitment at a time
  });

  // ── Draw offers: the secondary-action button (Play a Friend → Draw request ⇄ Revoke DRAW) + the
  // per-side offered/accept indicator (CHESS_DRAW_OFFER.md rev 3 — asymmetric offer→accept) ──────────
  describe('Draw offers (CHESS_DRAW_OFFER.md rev 3 — offer→accept)', () => {
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

    it('after you offer (public state) the button becomes "Revoke DRAW", solid amber/dark text; tapping it sends onDrawRevoke', () => {
      const onDrawRevoke = vi.fn();
      render(<ChessHubScreen {...inMatch({ gameState: view({ drawOffers: { alice: 3 } }), onDrawRevoke })} />);
      const btn = screen.getByTestId('chess-draw-revoke');
      expect(btn).toHaveTextContent(/revoke draw/i);
      expect(btn.className).toMatch(/bg-amber-400/);
      expect(btn.className).toMatch(/text-background/);
      expect(screen.queryByTestId('chess-draw-offer')).toBeNull();
      fireEvent.click(btn);
      expect(onDrawRevoke).toHaveBeenCalledTimes(1);
    });

    it('own offer: shows a solid-amber, non-tappable "DRAW OFFERED" status on YOUR bar — no "½", not a button', () => {
      render(<ChessHubScreen {...inMatch({ gameState: view({ drawOffers: { alice: 3 } }) })} />);
      const chip = screen.getByTestId('chess-draw-offered-self');
      expect(chip).toHaveTextContent(/draw offered/i);
      expect(chip.textContent).not.toContain('½');
      expect(chip.tagName).not.toBe('BUTTON');
      expect(chip.className).toMatch(/bg-amber-400/);
      expect(chip.className).toMatch(/text-background/);
      expect(screen.queryByTestId('chess-draw-offered-opponent')).toBeNull();
    });

    it("opponent's offer: shows a solid-amber, TAPPABLE \"ACCEPT DRAW?\" pill on the offerer's bar; tapping it sends onDrawAccept", () => {
      const onDrawAccept = vi.fn();
      render(<ChessHubScreen {...inMatch({ gameState: view({ drawOffers: { bob: 3 } }), onDrawAccept })} />);
      const chip = screen.getByTestId('chess-draw-offered-opponent');
      expect(chip.tagName).toBe('BUTTON');
      expect(chip).toHaveTextContent(/accept draw/i);
      expect(chip.className).toMatch(/bg-amber-400/);
      expect(chip.className).toMatch(/text-background/);
      expect(screen.queryByTestId('chess-draw-offered-self')).toBeNull();
      fireEvent.click(chip);
      expect(onDrawAccept).toHaveBeenCalledTimes(1);
      // The opponent offered, not me → my own button is still "Draw request" (never itself accepts).
      expect(screen.getByTestId('chess-draw-offer')).toBeInTheDocument();
    });

    it("my own Draw request button never accepts the opponent's pending offer — pressing it only sends my own onDrawOffer", () => {
      const onDrawOffer = vi.fn();
      const onDrawAccept = vi.fn();
      render(<ChessHubScreen {...inMatch({ gameState: view({ drawOffers: { bob: 3 } }), onDrawOffer, onDrawAccept })} />);
      fireEvent.click(screen.getByTestId('chess-draw-offer'));
      expect(onDrawOffer).toHaveBeenCalledTimes(1);
      expect(onDrawAccept).not.toHaveBeenCalled();
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

  // Ticket 2026-09-27#1 (D63, ADVISOR_TO_PM.md) item 1: same gap class D60 already fixed for
  // Coinflip — Chess never opted into the already-generic `matchBarSlide` mechanism. Mirrors
  // MinesHub.test.tsx's own measured-shift test (identical mocked rects/formula) — Chess uses the
  // same 'measured' mode (not a new one), so a taller board naturally produces correct offsets
  // with zero Chess-specific math.
  describe('ticket 2026-09-27#1 (D63): opponent-search bar convergence', () => {
    it('measures the real bar positions live and slides the bars toward center + dims the board while matchForming holds, then back to normal once in-match', async () => {
      const rect = (top: number, height: number): DOMRect =>
        ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute('data-rc-gamewrap')) return rect(0, 0);
        if (this.hasAttribute('data-rc-oppbar')) return rect(100, 48);
        if (this.hasAttribute('data-rc-playerbar')) return rect(300, 48);
        return rect(0, 0);
      });
      try {
        const { rerender } = render(<ChessHubScreen {...baseProps()} />);
        await screen.findByTestId('hub-tc-rapid10'); // wait for /games before PLAY is meaningful
        vi.useFakeTimers();
        const board = screen.getByTestId('chess-board').parentElement as HTMLElement;
        // Idle: the slide hasn't armed yet — no shift, board at full opacity.
        expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
        expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
        expect(board.style.opacity).toBe('1');

        fireEvent.click(screen.getByTestId('hub-bet-10')); // #143: PLAY with no stake armed only guides to the bet panel
        fireEvent.click(screen.getByTestId('hub-play'));
        rerender(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({}), legalMoves: asLegal([]) })} />);

        act(() => { vi.advanceTimersByTime(1000); });
        // oTop=100, pTop=300, pr.height=48 → mid=(100+300+48)/2=224 → o=224-71-100=53, p=224+23-300=-53
        // (same formula MinesHub.test.tsx's own measured-shift test verifies).
        expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(53px)');
        expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(-53px)');
        expect(board.style.opacity).toBe('0.28');

        // Just past the dwell floor: phase flips to in-match — bars slide back, board un-dims.
        act(() => { vi.advanceTimersByTime(1450); });
        expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
        expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
        expect(board.style.opacity).toBe('1');
      } finally {
        rectSpy.mockRestore();
        vi.useRealTimers();
      }
    });
  });

  // Ticket 2026-09-27#1 (D63) item 2: Chess's clock chip has no phase gating of its own, so it used
  // to render fully visible right through the search phase, colliding with GameHub.tsx's own
  // "Searching…" label (both used to independently claim the same absolute spot). Fixed by merging
  // them into one flex row (GameHub.tsx) plus opacity-gating the clock's own content on `searching`
  // (ChessHub.tsx's ChessSlotAside) — this test is the actual regression check: both coexist,
  // neither is unmounted, and the clock is genuinely invisible (not just visually behind) while
  // searching.
  describe('ticket 2026-09-27#1 (D63): "Searching…" no longer collides with the clock pill', () => {
    it('the opponent clock chip stays mounted but fades to opacity 0 while searching, and both "Searching…" and the clock coexist in the DOM', async () => {
      render(<ChessHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 10_000 })} />);
      await screen.findByTestId('hub-tc-rapid10'); // wait for /games — the clock's pre-match
      // fallback needs timeControlBaseMs, populated once the meta resolves.
      const oppBar = within(screen.getByTestId('hub-slot-opponent'));
      expect(oppBar.getByText('Searching…')).toBeInTheDocument();
      const clock = oppBar.getByTestId('chess-clock-opponent');
      expect(clock).toBeInTheDocument(); // mounted, not unmounted — coexists with "Searching…"
      expect(clock.parentElement?.style.opacity).toBe('0'); // but genuinely invisible
    });

    it('the clock fades back in (opacity 1) once the match is actually live', () => {
      const clock: PlayerClocks = {
        remainingMs: { alice: 300_000, bob: 300_000 }, active: 'alice', activeSince: Date.now(), timeControlId: 'blitz5',
      };
      render(<ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ clock }), legalMoves: asLegal([]) })} />);
      const oppBar = within(screen.getByTestId('hub-slot-opponent'));
      const oppClock = oppBar.getByTestId('chess-clock-opponent');
      expect(oppClock.parentElement?.style.opacity).toBe('1');
    });
  });

  // Ticket 2026-09-27#2 (D64) item 2: the win-fill layer's literal background color, not the
  // shared bg-success class.
  it('ticket 2026-09-27#2: the win popup\'s fill layer is the literal #16A34A, not the shared bg-success class', async () => {
    vi.useFakeTimers();
    try {
      renderToChessResult({ type: 'win', winner: 'alice' });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      const fill = screen.getByTestId('chess-result-fill');
      expect(fill.className).not.toContain('bg-success');
      expect(fill.style.background).toBe('rgb(22, 163, 74)'); // #16A34A, jsdom-normalized
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-27#2 (D64) item 3: the king's check halo, confirmed wrong today (generic
  // Tailwind destructive red, rgba(239,68,68,0.7)) — now the app's own #FF3E5E loss red.
  it("ticket 2026-09-27#2: the checked king's halo is the app's own #FF3E5E loss red, not the generic Tailwind destructive red", async () => {
    // Black rook on e2 checks the white king on e1 along the open e-file.
    const CHECK_FEN = '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1';
    const { container } = render(
      <ChessHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ fen: CHECK_FEN }), legalMoves: asLegal([]) })} />
    );
    await waitFor(() => {
      // react-chessboard applies customSquareStyles to the square's own inner content div, not
      // the outer [data-square] element itself (confirmed via direct DOM inspection).
      const halo = sq(container, 'e1').firstElementChild as HTMLElement | null;
      expect(halo?.getAttribute('style') ?? '').toContain('rgba(255,62,94,0.7)');
    });
  });
});

// Issue #279: the guest chrome gates (hidden wallet/Open Games/related/footer/nav, locked bet
// picker) live in the SHARED GameHub component, exercised identically for Coinflip
// (CoinflipHub.test.tsx "guest mode chrome") — this block proves that generically, against the
// actual chess hub, rather than assuming code-sharing implies identical behavior. It also proves
// the `initialTimeControl` pre-arm (added by #279 to fix a real bug: guest sessions skip the
// `/games` roster fetch, so without this the fixed control would never actually be sent).
describe('ChessHubScreen — guest mode chrome + fixed time control (issue #279)', () => {
  beforeEach(() => {
    // Guest mode must never depend on the roster fetch — stub it to return nothing so a test
    // failure here (accidentally relying on /games) shows up as a broken assertion, not a fluke pass.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/games') || u.includes('/leaderboard'))
          return { ok: true, json: async () => [] } as Response;
        return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hides the wallet chip, Open Games, related-games rail, and the bottom nav; shows a plain Demo badge — generalized, not Coinflip-only', () => {
    render(<ChessHubScreen {...baseProps({ isGuest: true, balances: balancesOf(200), initialStake: 100, initialTimeControl: 'blitz5' })} />);

    expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument();
    expect(screen.getByTestId('hub-balance').textContent).toContain('200');
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull();
    expect(screen.queryByTestId('games-carousel')).toBeNull();
    expect(screen.queryByTestId('hub-section-related')).toBeNull();
    expect(screen.queryByTestId('hub-nav-games')).toBeNull();
    expect(screen.queryByTestId('hub-nav-account')).toBeNull();
    // #337: the footer moved from inside the `!isGuest` fragment to a standalone
    // `{!isGuest && <HubFooter/>}` sibling of the gapped content div — still gated identically.
    expect(screen.queryByTestId('home-footer')).toBeNull();
  });

  it('the bet amount is pre-armed but genuinely interactive, minus the reserved stake (issue #353, matches Coinflip generically)', () => {
    render(<ChessHubScreen {...baseProps({ isGuest: true, initialStake: 100, initialTimeControl: 'blitz5' })} />);
    expect(screen.getByTestId('hub-bet-100')).not.toBeDisabled();
    expect(screen.queryByTestId('hub-bet-1')).toBeNull(); // GUEST_HUMAN_RESERVED_STAKE withheld entirely
  });

  it('pre-arms the fixed guest time control with NO time-control picker shown, and PLAY sends it without any tap', () => {
    const onPlay = vi.fn();
    render(<ChessHubScreen {...baseProps({ isGuest: true, initialStake: 100, initialTimeControl: 'blitz5', onPlay })} />);

    // No picker UI at all — a guest never sees a control to pick (guest mode has no pickers).
    expect(screen.queryByTestId('hub-section-timecontrol')).toBeNull();
    expect(screen.queryByTestId('hub-tc-blitz5')).toBeNull();

    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(100, 'blitz5');
  });

  it('a non-guest hub is unaffected — still fetches the roster and shows its own picker (regression guard)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games')) return { ok: true, json: async () => [CHESS_META] } as Response;
      if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
    }));
    render(<ChessHubScreen {...baseProps({ isGuest: false })} />);
    await screen.findByTestId('hub-tc-rapid10'); // the real picker still shows and defaults normally
    expect(screen.getByTestId('hub-nav-games')).toBeInTheDocument();
  });
});
