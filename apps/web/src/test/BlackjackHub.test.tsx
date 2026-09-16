// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { BlackjackHubScreen } from '../screens/BlackjackHub.js';
import type { BlackjackView } from '../App.js';
import type { OpenChallenge } from '@rapidclash/shared';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof BlackjackHubScreen>[0];

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

/** In-play view: own hand full (2 cards), opponent redacted to exactly ONE card. `replays` mirrors
 *  `draws` (as the real viewFor does) so the shared draw-beat reader sees the same field. */
function inPlayView(over: Partial<BlackjackView> = {}): BlackjackView {
  const merged: BlackjackView = {
    players: ['pid', 'bob'],
    round: 0,
    draws: 0,
    hands: {
      pid: { cards: [{ rank: '10', suit: '♠' }, { rank: '7', suit: '♥' }], done: false },
      bob: { cards: [{ rank: 'K', suit: '♣' }], done: false },
    },
    ...over,
  };
  return { replays: merged.draws, ...merged };
}

const c = (rank: string, suit = '♠'): { rank: string; suit: string } => ({ rank, suit });

describe('BlackjackHubScreen (GameHub + BlackjackPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: arming a bet enables PLAY (shared GameHub)', () => {
    const onPlay = vi.fn();
    render(<BlackjackHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // #143: pressable even with no stake armed
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<BlackjackHubScreen {...baseProps({ onPlay })} />);

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

  it('Idle board (item 1): the empty greyish table shows the "Place your bet and play" prompt', () => {
    render(<BlackjackHubScreen {...baseProps()} />);
    const board = screen.getByTestId('hub-board');
    expect(board.textContent).toMatch(/place your bet and play/i);
    // No live cards on the empty table (the right-edge decks are decorative, not `card`s).
    expect(within(board).queryByTestId('card')).toBeNull();
  });

  it('In-match: own hand in full, EXACTLY one opponent card + a face-down (redaction)', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    const own = within(screen.getByTestId('own-hand'));
    const opp = within(screen.getByTestId('opp-hand'));
    expect(own.getAllByTestId('card')).toHaveLength(2); // own hand fully shown
    expect(opp.getAllByTestId('card')).toHaveLength(1); // EXACTLY one opponent card
    expect(opp.getByTestId('card-back')).toBeInTheDocument(); // the rest stays hidden
    expect(screen.getByTestId('own-total').textContent).toBe('17'); // 10 + 7
  });

  it('In-match: Hit/Stand gated by legalMoves → onMove', () => {
    const onMakeMove = vi.fn();
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'], onMakeMove })} />);
    fireEvent.click(screen.getByTestId('hit-btn'));
    expect(onMakeMove).toHaveBeenCalledWith('hit');
    fireEvent.click(screen.getByTestId('stand-btn'));
    expect(onMakeMove).toHaveBeenCalledWith('stand');
    // Not your turn (no legalMoves) → both disabled.
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
    expect(screen.getByTestId('hit-btn')).toBeDisabled();
    expect(screen.getByTestId('stand-btn')).toBeDisabled();
  });

  it('Internal replay: a re-dealt round keeps the board (NOT the result overlay); no reflowing status line', () => {
    const replay = inPlayView({
      round: 1,
      draws: 1,
      hands: {
        pid: { cards: [{ rank: '9', suit: '♠' }, { rank: '8', suit: '♥' }], done: false },
        bob: { cards: [{ rank: '4', suit: '♣' }], done: false },
      },
    });
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: replay, legalMoves: ['hit', 'stand'] })} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull(); // a draw re-deal is NOT a match end
    // The old "Round 2 · 1 push — replaying" status line is gone — it reflowed the hand toward the
    // middle (layout invariant: no outcome may move the card display). "Push" shows only during the
    // ~2 s push beat (an overlay), never on a settled fresh round.
    expect(screen.queryByTestId('round-note')).toBeNull();
    expect(screen.queryByTestId('push-label')).toBeNull();
  });

  it('Item 2: match.end shows NO pop-up — the final cards persist on the board (both hands revealed)', async () => {
    const terminal = inPlayView({
      hands: {
        pid: { cards: [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }], done: true }, // 20
        bob: { cards: [{ rank: '9', suit: '♣' }, { rank: '8', suit: '♦' }], done: true }, // 17
      },
      winner: 'pid',
    });
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
    // Blackjack opts OUT of the shared result pop-up.
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    // The board stays up with BOTH hands revealed (no face-down) — the final cards persist.
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(within(screen.getByTestId('own-hand')).getAllByTestId('card')).toHaveLength(2);
    expect(within(screen.getByTestId('opp-hand')).getAllByTestId('card')).toHaveLength(2);
    expect(screen.queryByTestId('card-back')).toBeNull();
    // No wallet / balance-change result text anywhere (only the live ribbon chip updates).
    expect(screen.queryByText(/wallet change/i)).toBeNull();
    expect(screen.queryByText(/new balance/i)).toBeNull();
    // It never pops the overlay even after a beat.
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
  });

  it('Item 2: a beat after the reveal a green frame rings the player\'s own cards on a win (server outcome)', async () => {
    const terminal = inPlayView({
      hands: {
        pid: { cards: [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }], done: true },
        bob: { cards: [{ rank: '9', suit: '♣' }, { rank: '8', suit: '♦' }], done: true },
      },
      winner: 'pid',
    });
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
    // The win frame lands a beat after the reveal (FRAME_DELAY_MS) and stays.
    await waitFor(() => {
      for (const c of within(screen.getByTestId('own-hand')).getAllByTestId('card')) {
        expect(c.className).toMatch(/ring-success/);
      }
    }, { timeout: 2000 });
    // The opponent's cards are never framed; the frame is the player's own win/lose only.
    for (const c of within(screen.getByTestId('opp-hand')).getAllByTestId('card')) {
      expect(c.className).not.toMatch(/ring-success|ring-destructive/);
    }
  });

  it('Item 2: a loss rings the own cards red; a draw rings nothing (server outcome only)', async () => {
    const terminal = inPlayView({
      hands: {
        pid: { cards: [{ rank: '9', suit: '♠' }, { rank: '8', suit: '♥' }], done: true },
        bob: { cards: [{ rank: 'K', suit: '♣' }, { rank: 'Q', suit: '♦' }], done: true },
      },
      winner: 'bob',
    });
    const { rerender, unmount } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    // A loss is the server outcome `type:'win'` with the OPPONENT as winner (there is no 'lose').
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'bob' }, lastSettlement: { delta: -10, newBalance: 990 } })} />);
    await waitFor(() => {
      expect(within(screen.getByTestId('own-hand')).getAllByTestId('card')[0].className).toMatch(/ring-destructive/);
    }, { timeout: 2000 });
    unmount();

    // A draw is a non win/lose terminal → no frame (neutral, handled gracefully).
    const drawView = inPlayView({
      hands: {
        pid: { cards: [{ rank: 'K', suit: '♠' }, { rank: '9', suit: '♥' }], done: true },
        bob: { cards: [{ rank: 'K', suit: '♣' }, { rank: '9', suit: '♦' }], done: true },
      },
      forcedOutcome: { type: 'draw' },
    });
    const { rerender: rr2 } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm2', gameState: drawView, legalMoves: [] })} />);
    rr2(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: drawView, lastOutcome: { type: 'draw' }, lastSettlement: { delta: 0, newBalance: 1000 } })} />);
    await new Promise((r) => setTimeout(r, 1200));
    for (const c of within(screen.getByTestId('own-hand')).getAllByTestId('card')) {
      expect(c.className).not.toMatch(/ring-success|ring-destructive/);
    }
  });

  it('Item 2: after match.end the play button returns to PLAY (not "Playing…") to start a new game', () => {
    const terminal = inPlayView({
      hands: {
        pid: { cards: [{ rank: 'K', suit: '♠' }, { rank: 'Q', suit: '♥' }], done: true },
        bob: { cards: [{ rank: '9', suit: '♣' }, { rank: '8', suit: '♦' }], done: true },
      },
      winner: 'pid',
    });
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    expect(screen.getByTestId('hub-play').textContent).toMatch(/playing/i); // in-match
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
    // Result phase: PLAY is back (panel unfrozen) so a new game can start; bet re-enabled.
    const play = screen.getByTestId('hub-play');
    expect(play.textContent).toMatch(/play/i);
    expect(play.textContent).not.toMatch(/playing/i);
    expect(screen.getByTestId('hub-bet-10')).not.toBeDisabled();
  });

  it('Item 6: Hit/Stand live in the player\'s own slot pill (not on the table)', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    const ownPill = screen.getByTestId('hub-slot-own');
    expect(within(ownPill).getByTestId('hit-btn')).toBeInTheDocument();
    expect(within(ownPill).getByTestId('stand-btn')).toBeInTheDocument();
    // The table no longer carries an on-board Resign control or rules blurb.
    expect(screen.queryByText(/resign/i)).toBeNull();
    expect(screen.queryByText(/closest to 21/i)).toBeNull();
    expect(screen.queryByText(/your turn/i)).toBeNull();
  });

  it('Item 7: in-match freezes the play panel — PLAY reads "Playing…" (disabled), bet stays', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    const play = screen.getByTestId('hub-play');
    expect(play.textContent).toMatch(/playing/i);
    expect(play).toBeDisabled();
    // Bet amount + Play-a-Friend stay visible but disabled (not removed).
    expect(screen.getByTestId('hub-bet-10')).toBeDisabled();
    expect(screen.getByTestId('hub-play-friend')).toBeInTheDocument();
  });

  it('Item 2: the "Searching…" beat never fabricates a name (empty online list)', () => {
    // Waiting with no online players in the cross-game feed → just "Searching…", no scan name,
    // and never the opponentId.
    render(<BlackjackHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 30_000, challengesByGame: {} })} />);
    const opp = screen.getByTestId('hub-slot-opponent');
    expect(opp.textContent).toMatch(/searching/i);
    expect(screen.queryByTestId('hub-search-scan')).toBeNull();
    expect(opp.textContent).not.toMatch(/bob/); // opponentId is never shown
  });

  it('Item 2: the "Searching…" scan never flashes the player\'s OWN alias (#149)', () => {
    // The cross-game feed holds the player's own resting challenge ('me') plus a rival's. While
    // searching, the decorative scan must draw only from other players — never the current alias,
    // which would read as being matched against yourself.
    const ch = (matchId: string, ownerName: string): OpenChallenge => ({
      matchId, ownerName, ownerTier: 'Unranked', stake: 50, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'none',
    });
    render(
      <BlackjackHubScreen
        {...baseProps({
          username: 'me',
          waitingExpiresAt: Date.now() + 30_000,
          challengesByGame: { blackjack: [ch('c1', 'me')], coinflip: [ch('c2', 'rival')] },
        })}
      />,
    );
    const scan = screen.getByTestId('hub-search-scan');
    // Own challenge ('me') is excluded; only the rival remains in the pool. Ticket 2026-09-15#9
    // item 4: the scan now reads through displayHostName (strips any bot emoji, @-prefixes),
    // same already-approved formatting GamesCarousel.tsx uses — '@rival', not the raw 'rival'.
    expect(scan.textContent).toBe('@rival');
    expect(scan.textContent).not.toMatch(/me/);
  });

  it('Item 2: in-match shows a neutral "Opponent" when the joiner\'s name is unknown (never the id)', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
    const opp = screen.getByTestId('hub-slot-opponent');
    expect(opp.textContent).toContain('Opponent');
    expect(opp.textContent).not.toMatch(/bob/);
  });

  it('Item 2: in-match shows the REAL opponent name (from a joined challenge) in the slot', () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [], opponentName: 'Povcnent' })} />);
    expect(screen.getByTestId('hub-slot-opponent').textContent).toContain('Povcnent');
  });

  it('T9: registered users see the Owner-approved $ skin in the bet panel too, not just the header wallet chip (GameHub.tsx PlayPanel, CHARTER.md #4)', () => {
    const { container } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).toMatch(/\$/);
  });

  it('T9: guest mode keeps the play-money RcIcon bet display — no $ leaks into the game body', () => {
    const { container } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'], isGuest: true })} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).not.toMatch(/\$/);
  });

  // ── Part 1: hand-value label (soft/hard) — the docs/BLACKJACK.md worked examples ──
  describe('Part 1: hand-value label (soft/hard)', () => {
    /** Render an in-play view with the given OWN hand, read the own-total label. `done` marks a
     *  final (stood/bust) hand → the label collapses to a single best value. */
    function ownLabel(cards: { rank: string; suit: string }[], done = false): string {
      render(
        <BlackjackHubScreen
          {...baseProps({
            currentMatchId: 'm1',
            legalMoves: done ? [] : ['hit', 'stand'],
            gameState: inPlayView({ hands: { pid: { cards, done }, bob: { cards: [c('K', '♣')], done: false } } }),
          })}
        />,
      );
      return screen.getByTestId('own-total').textContent ?? '';
    }

    it('A+J (two-card soft 21) → "BJ" (short form, compact bubble — never the wide word)', () => {
      expect(ownLabel([c('A'), c('J')])).toBe('BJ');
    });
    it('A+6 live → 7 / 17 (the ace could still land either way)', () => {
      expect(ownLabel([c('A'), c('6')])).toBe('7 / 17');
    });
    it('A+6+4 (three-card soft 21) → 21 (not Blackjack)', () => {
      expect(ownLabel([c('A'), c('6'), c('4')])).toBe('21');
    });
    it('A+6+9 (soft would bust) → 16 only, never 16 / 26', () => {
      expect(ownLabel([c('A'), c('6'), c('9')])).toBe('16');
    });
    it('A+A → 2 / 12 (only one ace can be 11)', () => {
      expect(ownLabel([c('A'), c('A', '♥')])).toBe('2 / 12');
    });
    it('A+A+9 → 21', () => {
      expect(ownLabel([c('A'), c('A', '♥'), c('9')])).toBe('21');
    });
    it('9+9 (no ace) → 18', () => {
      expect(ownLabel([c('9'), c('9', '♥')])).toBe('18');
    });
    it('stand on A+7 (final) → 18, not 7 / 17', () => {
      expect(ownLabel([c('A'), c('7')], true)).toBe('18');
    });
    it('10+9+5 → 24 (bust, hard total)', () => {
      expect(ownLabel([c('10'), c('9'), c('5')], true)).toBe('24');
    });
  });

  // ── Part 2: draws → visible push (the shared universal-draw mechanic) ──
  describe('Part 2: push = visible result (shared draw flow, never a silent skip)', () => {
    /** Drive a live match into a push: an initial round (replays 0), then the re-dealt round that
     *  carries `lastResult` (the pushed hands) + a `replays` rise — which fires the shared draw beat. */
    function toPush(pushed: BlackjackView) {
      const { rerender } = render(
        <BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />,
      );
      rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: pushed, legalMoves: [] })} />);
    }

    it('Case 1 — both bust: red card outlines on both hands; an orange "Push" overlay; bars show NOTHING', async () => {
      const pushed = inPlayView({
        round: 1, draws: 1, replays: 1,
        // Fresh (round 1) hands — these must NOT be what shows during the beat.
        hands: { pid: { cards: [c('2'), c('3')], done: false }, bob: { cards: [c('4')], done: false } },
        lastResult: {
          round: 0, result: 'draw',
          hands: {
            pid: { cards: [c('K'), c('Q'), c('5')], total: 25 }, // busts
            bob: { cards: [c('10'), c('9'), c('8')], total: 27 }, // busts
          },
        },
      });
      toPush(pushed);

      await waitFor(() => {
        // The PUSHED hands are held (3 cards each), not the fresh round's re-deal (2 / 1).
        expect(within(screen.getByTestId('own-hand')).getAllByTestId('card')).toHaveLength(3);
        expect(within(screen.getByTestId('opp-hand')).getAllByTestId('card')).toHaveLength(3);
      });
      // Both hands fully revealed — no face-down during a push.
      expect(screen.queryByTestId('card-back')).toBeNull();
      // Both-bust → red (destructive) card outlines on every card, both hands. The outline waits for
      // the reveal to finish (revealComplete, Advisor #10) — assert it once the last card has landed.
      await waitFor(() => {
        for (const c2 of within(screen.getByTestId('own-hand')).getAllByTestId('card')) expect(c2.className).toMatch(/ring-destructive/);
        for (const c2 of within(screen.getByTestId('opp-hand')).getAllByTestId('card')) expect(c2.className).toMatch(/ring-destructive/);
      }, { timeout: 2000 });
      // The reversal: Blackjack's draw surface is CARDS + an orange "Push" label — NOT an orange bar.
      const push = screen.getByTestId('push-label');
      expect(push.textContent).toMatch(/push/i);
      expect(push.className).toMatch(/text-amber-400/); // orange
      // Neither player bar shows anything on a push (bars speak only on decided rounds).
      expect(screen.getByTestId('hub-slot-own').className).not.toMatch(/ring-amber-400|ring-destructive|ring-success/);
      expect(screen.getByTestId('hub-slot-opponent').className).not.toMatch(/ring-amber-400|ring-destructive|ring-success/);
      // A push is NOT a match end — never the result overlay.
      expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    });

    it('Case 2 — equal totals: orange card outlines on both hands; orange "Push" overlay; bars show NOTHING', async () => {
      const pushed = inPlayView({
        round: 1, draws: 1, replays: 1,
        hands: { pid: { cards: [c('2'), c('3')], done: false }, bob: { cards: [c('4')], done: false } },
        lastResult: {
          round: 0, result: 'draw',
          hands: {
            pid: { cards: [c('K'), c('Q')], total: 20 },
            bob: { cards: [c('J'), c('10', '♦')], total: 20 },
          },
        },
      });
      toPush(pushed);

      await waitFor(() => {
        expect(within(screen.getByTestId('own-hand')).getAllByTestId('card')).toHaveLength(2);
      });
      // Equal non-bust totals → orange (amber) card outlines, NOT red — both hands. The outline waits
      // for the reveal to finish (revealComplete, Advisor #10) — assert once the last card has landed.
      await waitFor(() => {
        for (const c2 of within(screen.getByTestId('own-hand')).getAllByTestId('card')) {
          expect(c2.className).toMatch(/ring-amber-400/);
          expect(c2.className).not.toMatch(/ring-destructive/);
        }
        for (const c2 of within(screen.getByTestId('opp-hand')).getAllByTestId('card')) {
          expect(c2.className).toMatch(/ring-amber-400/);
        }
      }, { timeout: 2000 });
      // Orange "Push" overlay; bars show nothing (the reversal).
      expect(screen.getByTestId('push-label').textContent).toMatch(/push/i);
      expect(screen.getByTestId('hub-slot-own').className).not.toMatch(/ring-amber-400|ring-destructive|ring-success/);
      expect(screen.getByTestId('hub-slot-opponent').className).not.toMatch(/ring-amber-400|ring-destructive|ring-success/);
      expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    });

    it('layout invariant: the "Push" overlay does not shift the cards (same positions with and without it)', async () => {
      const lastResult = {
        round: 0, result: 'draw' as const,
        hands: { pid: { cards: [c('K'), c('Q')], total: 20 }, bob: { cards: [c('J'), c('10', '♦')], total: 20 } },
      };
      // Baseline: a live round with the SAME two-card hands, no push overlay.
      const live = inPlayView({ hands: { pid: { cards: [c('K'), c('Q')], done: false }, bob: { cards: [c('J'), c('10', '♦')], done: false } } });
      const { unmount } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: live, legalMoves: [] })} />);
      const ownCount = within(screen.getByTestId('own-hand')).getAllByTestId('card').length;
      expect(screen.queryByTestId('push-label')).toBeNull(); // no overlay when not a push
      unmount();

      // Push: the overlay is absolutely positioned (non-displacing) — the hands keep their structure.
      toPush(inPlayView({ round: 1, draws: 1, replays: 1, hands: { pid: { cards: [c('2'), c('3')], done: false }, bob: { cards: [c('4')], done: false } }, lastResult }));
      await waitFor(() => expect(screen.getByTestId('push-label')).toBeInTheDocument());
      expect(within(screen.getByTestId('own-hand')).getAllByTestId('card').length).toBe(ownCount); // unchanged
      // The overlay lives OUTSIDE the hand sections (it can't reflow a hand it isn't inside).
      expect(within(screen.getByTestId('own-hand')).queryByTestId('push-label')).toBeNull();
      expect(within(screen.getByTestId('opp-hand')).queryByTestId('push-label')).toBeNull();
    });

    it('Win: cards green + the bar plays the shared win animation (username stays visible)', async () => {
      const terminal = inPlayView({
        hands: {
          pid: { cards: [c('K'), c('Q', '♥')], done: true }, // 20
          bob: { cards: [c('9', '♣'), c('8', '♦')], done: true }, // 17
        },
        winner: 'pid',
      });
      const { rerender } = render(<BlackjackHubScreen {...baseProps({ username: 'me', currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
      rerender(<BlackjackHubScreen {...baseProps({ username: 'me', currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);

      // The bar runs the SAME shared component as Coinflip: green fill + "You Win" alongside the
      // username (never swapped out), settling to the green outline.
      await waitFor(() => {
        expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you win/i);
      }, { timeout: 2000 });
      const ownBar = screen.getByTestId('hub-slot-own');
      expect(ownBar.querySelector('.bg-success')).not.toBeNull(); // green fill layer
      expect(ownBar.textContent).toContain('me'); // username stays visible
      // Cards also get the green frame (own hand).
      await waitFor(() => {
        for (const c2 of within(screen.getByTestId('own-hand')).getAllByTestId('card')) expect(c2.className).toMatch(/ring-success/);
      }, { timeout: 2000 });
    });

    it('Loss: cards red + the bar shows a red outline only (no fill, no text)', async () => {
      const terminal = inPlayView({
        hands: {
          pid: { cards: [c('9', '♠'), c('8', '♥')], done: true }, // 17
          bob: { cards: [c('K', '♣'), c('Q', '♦')], done: true }, // 20
        },
        winner: 'bob',
      });
      const { rerender } = render(<BlackjackHubScreen {...baseProps({ username: 'me', currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
      rerender(<BlackjackHubScreen {...baseProps({ username: 'me', currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'bob' }, lastSettlement: { delta: -10, newBalance: 990 } })} />);

      await waitFor(() => {
        expect(screen.getByTestId('hub-slot-own').className).toMatch(/ring-destructive/);
      }, { timeout: 2000 });
      const ownBar = screen.getByTestId('hub-slot-own');
      expect(ownBar.querySelector('.bg-success')).toBeNull(); // no green fill
      expect(within(ownBar).queryByTestId('hub-slot-own-verdict')).toBeNull(); // no "You Win"
    });
  });

  // ── Reveal choreography (continuous, in place) ──
  describe('Reveal choreography: hole card flips in place, z-order, no unmount', () => {
    it('the face-down hole card and both deck piles use the shared card-back / deck component (vector)', () => {
      render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
      // The hole card's face-down side is the shared CardBack (bolt watermark), not an inline gradient.
      const hole = within(screen.getByTestId('opp-hand')).getByTestId('card-back');
      expect(within(hole).getByTestId('card-back-art')).toBeInTheDocument();
      expect(within(hole).getByTestId('card-back-bolt')).toBeInTheDocument();
      // One shared deck pile per player.
      expect(screen.getAllByTestId('deck-pile')).toHaveLength(2);
      // No raster in the card visuals — SVG/CSS only, so it stays crisp through the flip/deal.
      expect(screen.getByTestId('hub-board').querySelector('img')).toBeNull();
    });

    it('the face-down hole card sits UNDER the first opponent card (z-order fixed before the deal)', () => {
      render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
      const opp = within(screen.getByTestId('opp-hand'));
      const firstCard = opp.getByTestId('card'); // the one revealed face-up card
      const hole = opp.getByTestId('card-back'); // the persistent hole card (face-down)
      // Lower z-index = underneath. The hole must never sit on top of the first card.
      expect(Number(hole.style.zIndex)).toBeLessThan(Number(firstCard.style.zIndex));
    });

    it('reveal is continuous: in play the hole is face-down; at terminal it reveals IN PLACE (the same slot becomes a card, no card-back), and opponent hits deal in', async () => {
      const terminal = inPlayView({
        hands: {
          pid: { cards: [c('K'), c('Q', '♥')], done: true }, // 20
          bob: { cards: [c('9', '♣'), c('8', '♦'), c('4')], done: true }, // c0 + hole + one hit → 3 cards
        },
        winner: 'pid',
      });
      const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
      // In play: exactly one face-up opponent card + the face-down hole (the hidden remainder).
      expect(within(screen.getByTestId('opp-hand')).getAllByTestId('card')).toHaveLength(1);
      expect(within(screen.getByTestId('opp-hand')).getByTestId('card-back')).toBeInTheDocument();

      // Terminal: the paced reveal lands (TERMINAL_HOLD_MS) → the hole flips in place (now a card, no
      // card-back) and the hit card is dealt in → the full opponent hand is shown.
      rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
      await waitFor(() => {
        expect(within(screen.getByTestId('opp-hand')).getAllByTestId('card')).toHaveLength(3);
      }, { timeout: 2000 });
      expect(screen.queryByTestId('card-back')).toBeNull(); // no lingering face-down card at the reveal
    });

    it('newest card renders ON TOP: a multi-card hand stacks ASCENDING (A over 10 over 8)', () => {
      const view = inPlayView({
        hands: {
          pid: { cards: [c('8'), c('10', '♥'), c('A')], done: false }, // dealt 8, then 10, then A
          bob: { cards: [c('K', '♣')], done: false },
        },
      });
      render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view, legalMoves: ['hit', 'stand'] })} />);
      const z = within(screen.getByTestId('own-hand')).getAllByTestId('card').map((el) => Number(el.style.zIndex));
      expect(z).toHaveLength(3);
      // Each later (newer) card sits OVER the previous — the standard overlapping fan.
      expect(z[0]).toBeLessThan(z[1]);
      expect(z[1]).toBeLessThan(z[2]);
    });

    it('key continuity: an already-visible card is NOT remounted from the last in-play frame through the push hold (no blink)', async () => {
      const inPlay = inPlayView({
        hands: {
          pid: { cards: [c('10'), c('7', '♥')], done: true }, // my final hand (17)
          bob: { cards: [c('K', '♣')], done: false }, // c0 visible; the hole is hidden
        },
      });
      // The draw re-deals a fresh round 1 (draws/replays rise) + carries lastResult = the resolved
      // round 0. The push must HOLD round 0's cards under their ORIGINAL keys — not remount them.
      const pushed = inPlayView({
        round: 1, draws: 1, replays: 1,
        hands: { pid: { cards: [c('2'), c('3')], done: false }, bob: { cards: [c('4')], done: false } },
        lastResult: {
          round: 0, result: 'draw',
          hands: {
            pid: { cards: [c('10'), c('7', '♥')], total: 17 },
            bob: { cards: [c('K', '♣'), c('7', '♦')], total: 17 }, // equal totals → orange push
          },
        },
      });
      const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlay, legalMoves: [] })} />);
      // Capture the already-visible cards BEFORE the push: my first card + the opponent's first card.
      const ownFirstBefore = within(screen.getByTestId('own-hand')).getAllByTestId('card')[0];
      const oppFirstBefore = within(screen.getByTestId('opp-hand')).getAllByTestId('card')[0];

      // Resolve into the push (drawBeat fires on the replays rise).
      rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: pushed, legalMoves: [] })} />);
      await waitFor(() => expect(screen.getByTestId('push-label')).toBeInTheDocument());

      // The SAME DOM nodes persist — no unmount/remount across reveal → push, so no blink.
      expect(within(screen.getByTestId('own-hand')).getAllByTestId('card')[0]).toBe(ownFirstBefore);
      expect(within(screen.getByTestId('opp-hand')).getAllByTestId('card')[0]).toBe(oppFirstBefore);
    });

    it("GameHub phase bridge (Advisor #2): a REAL decisive-terminal transition — currentMatchId genuinely goes to null, not held at 'm1' — never drops the board for a frame; both bar-adjacent AND own cards keep DOM identity", async () => {
      // Unlike the "key continuity" test above (and the reveal-choreography test below it), which
      // deliberately hold `currentMatchId: 'm1'` across the rerender to isolate the board's own
      // reveal choreography from GameHub's phase machine, this test exercises the actual wire
      // event: App's onMatchEnd sets lastOutcome/lastSettlement AND clears currentMatchId to null
      // in the same batch (verified in App.tsx's onMatchEnd handler). That is exactly the
      // transition where GameHub's `phase` derivation used to fall through to 'idle' for one
      // render (overlay/resultPending are effect-derived and lag a render behind), which unmounts
      // BlackjackPanel's board (idle → no cards) before it remounts fresh nodes the very next
      // render — every card, including the player's OWN (which never animates at reveal in the
      // correct behaviour), would replay its mount-entrance animation. Capturing DOM identity
      // across the single rerender call is the tell: a remount mints brand-new elements.
      const inPlay = inPlayView({
        hands: {
          pid: { cards: [c('K'), c('Q', '♥')], done: true }, // 20 — already final
          bob: { cards: [c('9', '♣')], done: false }, // one visible card + one persistent hidden hole card
        },
      });
      const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlay, legalMoves: [] })} />);
      const ownFirstBefore = within(screen.getByTestId('own-hand')).getAllByTestId('card')[0];
      const oppFirstBefore = within(screen.getByTestId('opp-hand')).getAllByTestId('card')[0];

      const terminal = inPlayView({
        hands: {
          pid: { cards: [c('K'), c('Q', '♥')], done: true },
          bob: { cards: [c('9', '♣'), c('8', '♦')], done: true },
        },
        winner: 'pid',
      });
      // The real decisive-terminal flow: currentMatchId clears to null in the SAME rerender that
      // delivers lastOutcome/lastSettlement — no artificial hold.
      rerender(<BlackjackHubScreen {...baseProps({
        currentMatchId: null, gameState: terminal, legalMoves: [],
        lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 },
      })} />);

      // The board must have stayed mounted throughout — the SAME DOM nodes persist, own card
      // included. A remount (the bug) would mint fresh elements for both hands.
      expect(within(screen.getByTestId('own-hand')).getAllByTestId('card')[0]).toBe(ownFirstBefore);
      expect(within(screen.getByTestId('opp-hand')).getAllByTestId('card')[0]).toBe(oppFirstBefore);
    });

    it('after the reveal flip the (face-up) hole card sits OVER the first card, and hits stack over in deal order', async () => {
      const terminal = inPlayView({
        hands: {
          pid: { cards: [c('K'), c('Q', '♥')], done: true },
          bob: { cards: [c('9', '♣'), c('8', '♦'), c('4')], done: true }, // first + hole + one hit
        },
        winner: 'pid',
      });
      const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
      rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
      await waitFor(() => {
        expect(within(screen.getByTestId('opp-hand')).getAllByTestId('card')).toHaveLength(3);
      }, { timeout: 2000 });
      // DOM order = deal order: first card, the revealed hole, the hit. Ascending z → hole OVER first,
      // hit OVER hole (the face-down "underneath" exception ends the moment it flips).
      const z = within(screen.getByTestId('opp-hand')).getAllByTestId('card').map((el) => Number(el.style.zIndex));
      expect(z[0]).toBeLessThan(z[1]); // revealed hole over the first card
      expect(z[1]).toBeLessThan(z[2]); // hit over the hole, in deal order
    });
  });

  // ── Advisor #10: the result bar + balance are gated on the board's reveal-complete signal ──
  // The bug: the own result BAR (and the ribbon balance) fired ~850ms+ BEFORE the card reveal
  // finished, because the bar keyed off a fixed beat while the cards keyed off the choreography.
  // Fix: ONE reveal-complete signal (computed by the board, which alone knows the timing) gates the
  // outlines, and — via onRevealComplete → gateResultOnReveal — the hub's bar and balance.
  describe('Advisor #10: result bar + balance gated on reveal-complete', () => {
    it('(a) slow reveal (opponent hits) — the own result bar stays neutral until the last hit lands (~revealMs), then fires', async () => {
      vi.useFakeTimers();
      try {
        // Opponent wins with FIVE cards → 3 hits → revealMs = 450 + (3-1)·220 + 550 = 1440ms.
        const terminal = inPlayView({
          hands: {
            pid: { cards: [c('K'), c('7', '♥')], done: true }, // 17 (loses)
            bob: { cards: [c('2'), c('3'), c('4'), c('5'), c('6')], done: true }, // 20, five cards
          },
          winner: 'bob',
        });
        const { rerender } = render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
        // The real decisive-terminal transition: currentMatchId clears to null with the outcome.
        rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, legalMoves: [], lastOutcome: { type: 'win', winner: 'bob' }, lastSettlement: { delta: -10, newBalance: 990 } })} />);

        // Before the last hit lands (< revealMs), the own bar shows NO verdict outline — in-play look.
        await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
        expect(screen.getByTestId('hub-slot-own').className).not.toMatch(/ring-destructive|ring-success|ring-amber-400/);

        // Just past revealMs (1440) the loss outline fires — bar and cards settle together.
        await act(async () => { await vi.advanceTimersByTimeAsync(120); });
        expect(screen.getByTestId('hub-slot-own').className).toMatch(/ring-destructive/);
        for (const card of within(screen.getByTestId('own-hand')).getAllByTestId('card')) {
          expect(card.className).toMatch(/ring-destructive/);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('(b) stand-pat opponent (no hits) — the own bar win reveal fires after the hole flip (~FLIP_MS)', async () => {
      vi.useFakeTimers();
      try {
        // Opponent stands pat (two cards) → no hits → revealMs = CARD_ANIM_MS ≈ 550ms (just the flip).
        const terminal = inPlayView({
          hands: {
            pid: { cards: [c('K'), c('Q', '♥')], done: true }, // 20 (wins)
            bob: { cards: [c('9', '♣'), c('8', '♦')], done: true }, // 17, two cards
          },
          winner: 'pid',
        });
        const { rerender } = render(<BlackjackHubScreen {...baseProps({ username: 'me', currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
        rerender(<BlackjackHubScreen {...baseProps({ username: 'me', currentMatchId: null, gameState: terminal, legalMoves: [], lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);

        // Before the flip completes, the win reveal ("You Win" verdict) has NOT started on the bar.
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull();

        // Just past FLIP_MS (~550) the shared win reveal begins on the bar.
        await act(async () => { await vi.advanceTimersByTimeAsync(120); });
        expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you win/i);
      } finally {
        vi.useRealTimers();
      }
    });

    it('(c) balance-hold — the ribbon balance holds its pre-settlement value until reveal-complete, then updates', async () => {
      vi.useFakeTimers();
      try {
        // Stand-pat opponent → revealMs ≈ 550ms. Balance settles 1000 → 1019 at match end.
        const terminal = inPlayView({
          hands: {
            pid: { cards: [c('K'), c('Q', '♥')], done: true }, // 20 (wins)
            bob: { cards: [c('9', '♣'), c('8', '♦')], done: true }, // 17
          },
          winner: 'pid',
        });
        const { rerender } = render(<BlackjackHubScreen {...baseProps({ balance: 1000, currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
        expect(screen.getByTestId('hub-balance').textContent).toContain('1,000');

        // Match ends: the settled balance (1019) arrives with the null currentMatchId.
        rerender(<BlackjackHubScreen {...baseProps({ balance: 1019, currentMatchId: null, gameState: terminal, legalMoves: [], lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);

        // Before reveal-complete the ribbon HOLDS the pre-settlement balance (no jump ahead).
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(screen.getByTestId('hub-balance').textContent).toContain('1,000');

        // Once the reveal completes (~revealMs) the settled balance applies, in lockstep with the bar.
        await act(async () => { await vi.advanceTimersByTimeAsync(120); });
        expect(screen.getByTestId('hub-balance').textContent).toContain('1,019');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // Regression guard for issue #387: GameHub's `searchFloorMs` prop now defaults to 2400 when a
  // hub omits it (byte-identical to the old hardcoded SEARCH_FLOOR_MS constant). Blackjack has a
  // generous timer budget so it deliberately does NOT opt into `searchFloorMs={0}` — this proves
  // the default dwell floor still holds for a game that doesn't pass the new prop.
  it('#387 regression: default 2.4s "Searching…" dwell floor still holds — phase stays waiting until it elapses', async () => {
    vi.useFakeTimers();
    try {
      const gameState = inPlayView();
      const { rerender } = render(<BlackjackHubScreen {...baseProps({ initialStake: 10 })} />);
      fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start (searchStartRef)

      // The server pairs the match immediately — rerender with a live match right away.
      rerender(<BlackjackHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState, legalMoves: [] })} />);

      // Still within the floor: the board must NOT show the in-match hands yet (own-hand/opp-hand
      // only render once phase reaches 'in-match'), unchanged from before this fix.
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.queryByTestId('own-hand')).toBeNull();

      // Just past the 2400ms floor, phase flips to in-match and the hands render.
      await act(async () => { await vi.advanceTimersByTimeAsync(1450); });
      expect(screen.getByTestId('own-hand')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // T5: the shared "VS" match-found overlay (GameHub.tsx, gated on `matchForming`). Blackjack keeps
  // the default 2400ms search-dwell floor (the #387 regression guard above), so it shares exactly
  // the same matchForming window Mines/Dice get — proof the shared addition doesn't regress
  // Blackjack's own transition (it never had separate transition logic to begin with; every hub
  // renders the same GameHub section).
  it('T5: the shared VS label fades in while matchForming holds, then fades back out once in-match', async () => {
    vi.useFakeTimers();
    try {
      const gameState = inPlayView();
      const { rerender } = render(<BlackjackHubScreen {...baseProps({ initialStake: 10 })} />);
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0'); // idle: hidden

      fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start
      rerender(<BlackjackHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState, legalMoves: [] })} />);

      // Still inside the floor: matchForming holds — VS shows, hands stay withheld (unchanged).
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('1');
      expect(screen.queryByTestId('own-hand')).toBeNull();

      // Just past the floor: phase flips to in-match — VS fades back out, hands render.
      await act(async () => { await vi.advanceTimersByTimeAsync(1450); });
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0');
      expect(screen.getByTestId('own-hand')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Issue #297: the guest chrome gates (hidden wallet/Open Games/related/footer/nav, locked bet
// picker) live in the SHARED GameHub component, already exercised for Coinflip
// (CoinflipHub.test.tsx "guest mode chrome") and Chess (ChessHub.test.tsx, issue #279) — this
// block proves that generically against the actual Blackjack hub, rather than assuming
// code-sharing implies identical behavior. Unlike Chess, Blackjack has no time-control concept at
// all (no `initialTimeControl` needed) — the guest pre-arm is `initialStake` only.
describe('BlackjackHubScreen — guest mode chrome (issue #297)', () => {
  beforeEach(() => {
    // Guest mode must never depend on the roster fetch — stub it to return nothing so a test
    // failure here (accidentally relying on /games) shows up as a broken assertion, not a fluke pass.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/games') || u.includes('/leaderboard'))
          return { ok: true, json: async () => [] } as Response;
        return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hides the wallet chip, Open Games, related-games rail, and the bottom nav; shows a plain Demo badge — generalized, not Coinflip/Chess-only', () => {
    render(<BlackjackHubScreen {...baseProps({ isGuest: true, balance: 200, initialStake: 100 })} />);

    expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument();
    expect(screen.getByTestId('hub-balance').textContent).toContain('200');
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull();
    expect(screen.queryByTestId('games-carousel')).toBeNull();
    expect(screen.queryByTestId('hub-section-related')).toBeNull();
    expect(screen.queryByTestId('hub-nav-games')).toBeNull();
    expect(screen.queryByTestId('hub-nav-account')).toBeNull();
  });

  it('the bet amount is pre-armed but genuinely interactive, minus the reserved stake (issue #353, matches Coinflip/Chess generically)', () => {
    render(<BlackjackHubScreen {...baseProps({ isGuest: true, initialStake: 100 })} />);
    expect(screen.getByTestId('hub-bet-100')).not.toBeDisabled();
    expect(screen.queryByTestId('hub-bet-1')).toBeNull(); // GUEST_HUMAN_RESERVED_STAKE withheld entirely
  });

  it('pre-arms the fixed guest stake with PLAY sending it without any tap — no time-control picker (Blackjack has none, unlike Chess)', () => {
    const onPlay = vi.fn();
    render(<BlackjackHubScreen {...baseProps({ isGuest: true, initialStake: 100, onPlay })} />);

    expect(screen.queryByTestId('hub-section-timecontrol')).toBeNull();

    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(100);
  });

  it('a non-guest hub is unaffected — still fetches the roster normally (regression guard)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
    render(<BlackjackHubScreen {...baseProps({ isGuest: false })} />);
    expect(screen.getByTestId('hub-play')).toBeInTheDocument();
    expect(screen.getByTestId('hub-nav-games')).toBeInTheDocument();
  });
});
