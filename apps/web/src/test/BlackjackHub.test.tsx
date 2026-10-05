// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { BlackjackHubScreen } from '../screens/BlackjackHub.js';
import type { BlackjackView } from '../App.js';
import type { OpenChallenge } from '@rapidclash/shared';
import { balancesOf } from './testBalances.js';
import { setCurSel } from '../lib/currency.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// Web Audio is absent in jsdom — mock the sound module so we can assert the deal/flip SFX wiring
// (ticket 2026-10-01#4, D72) without touching real AudioContext (same idiom as MinesHub.test.tsx's
// equivalent mock).
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

type Props = Parameters<typeof BlackjackHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'pid', username: 'me', opponentId: 'bob', balances: balancesOf(1000),
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenSignup: vi.fn(), onOpenRewards: vi.fn(), onOpenAffiliate: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
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

// Ticket 2026-10-01#4 (D72): deal/flip SFX — mocks play() and asserts the EXACT call count/order
// per scenario, directly proving the double-fire guards actually work (not just reasoning about
// them). Real (non-fake) timers throughout, same idiom as the Reveal-choreography describe block
// above — Framer Motion's onAnimationComplete needs real animation time to elapse.
describe('Ticket 2026-10-01#4 (D72): Blackjack deal/flip sounds', () => {
  beforeEach(() => {
// NOTE: this block is deliberately positioned BEFORE 'Advisor #10' (further down this file) —
// that block's fake-timers + an infinite-repeat (`repeat: Infinity`) pulsing animation leaves
// Framer Motion's shared frame-loop driver unable to complete any REAL animation for the rest
// of this file's test run (confirmed empirically: these tests pass standalone and here, but
// fail with a stuck 0-count if run anywhere after 'Advisor #10' in the same file). Pre-existing
// test-infrastructure fragility, unrelated to this ticket's own implementation — not something
// this ticket needs to fix, just work around by ordering.
    vi.useRealTimers();
    playMock.mockClear();
  });

  it('opening deal: exactly 4 deal sounds (own×2 + opp visible + hole landing), 0 flip', async () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(4);
    }, { timeout: 8000 });
    expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-flip')).toHaveLength(0);
  }, 20000);

  it('Hit×2 + Stand + 1 dealer draw: exactly 7 deal sounds, 1 flip, flip after every deal from play (not before)', async () => {
    const { rerender } = render(
      <BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />,
    );
    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(4);
    }, { timeout: 8000 }); // opening deal lands first

    // Hit #1 — own hand grows to 3 cards.
    rerender(<BlackjackHubScreen {...baseProps({
      currentMatchId: 'm1', legalMoves: ['hit', 'stand'],
      gameState: inPlayView({ hands: { pid: { cards: [c('10'), c('7', '♥'), c('2')], done: false }, bob: { cards: [c('K', '♣')], done: false } } }),
    })} />);
    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(5);
    }, { timeout: 8000 });

    // Hit #2 — own hand grows to 4 cards.
    rerender(<BlackjackHubScreen {...baseProps({
      currentMatchId: 'm1', legalMoves: ['hit', 'stand'],
      gameState: inPlayView({ hands: { pid: { cards: [c('10'), c('7', '♥'), c('2'), c('3')], done: false }, bob: { cards: [c('K', '♣')], done: false } } }),
    })} />);
    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(6);
    }, { timeout: 8000 });

    // Stand → terminal. The dealer (opponent) drew exactly 1 card during their own turn (nHits=1):
    // the hole flips (1 flip) and that one hit card deals in (+1 deal → 7 total).
    rerender(<BlackjackHubScreen {...baseProps({
      currentMatchId: 'm1', legalMoves: [],
      gameState: inPlayView({
        hands: {
          pid: { cards: [c('10'), c('7', '♥'), c('2'), c('3')], done: true },
          bob: { cards: [c('K', '♣'), c('9'), c('2', '♥')], done: true }, // c0 + hole + 1 hit
        },
        winner: 'bob',
      }),
    })} />);

    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(7);
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-flip')).toHaveLength(1);
    }, { timeout: 9000 });

    // "Relative order" — the flip happens only after the 2 in-play hits' own deal sounds (staged,
    // guaranteed by this test's own rerender sequence), never before. The flip vs. the dealer's own
    // single hit-card deal (both fire off independent async completions — a useEffect vs. a Framer
    // Motion animation-complete — within the SAME terminal transition) has no guaranteed relative
    // order between each other, so this doesn't assert which of those two comes last.
    const flipIdx = playMock.mock.calls.findIndex((c2) => c2[0] === 'blackjack-card-flip');
    const dealsBeforeFlip = playMock.mock.calls.slice(0, flipIdx).filter((c2) => c2[0] === 'blackjack-card-deal');
    expect(dealsBeforeFlip.length).toBeGreaterThanOrEqual(6); // opening (4) + both hits (2), at minimum
  }, 25000);

  it('a player-bust terminal (stand-pat opponent, no dealer hits): the flip still fires exactly once, never twice', async () => {
    const { rerender } = render(
      <BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />,
    );
    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(4);
    }, { timeout: 8000 });

    // Player busts on a 3rd (hit) card; opponent never draws beyond their own 2 cards (c0 + hole,
    // no hits) — this is exactly the `pulsing -> settled` re-resolution risk the ticket's own guard
    // targets: the hole card's outer div transitions from its pulsing animate target straight to
    // the terminal one.
    rerender(<BlackjackHubScreen {...baseProps({
      currentMatchId: 'm1', legalMoves: [],
      gameState: inPlayView({
        hands: {
          pid: { cards: [c('10'), c('9'), c('5')], done: true }, // 24, busts
          bob: { cards: [c('K', '♣'), c('9')], done: true }, // stand-pat, no hits
        },
        winner: 'bob',
      }),
    })} />);

    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-flip')).toHaveLength(1);
    }, { timeout: 9000 });
    // Ticket 2026-10-04#2 (D78): the player's own hand grew from 2 to 3 cards this rerender (the
    // bust card) — a genuinely NEW PlayingCard mount, with its own legitimate deal sound. Under the
    // OLD arrival-based timing (`onAnimationComplete`), that sound needed a further ~550ms
    // (CARD_ANIM_S) of real animation time to fire, so it reliably hadn't landed yet by this
    // checkpoint and the count read 4. Under D78's departure-based timing it fires almost
    // immediately (delay=0) — the count is now correctly 5, not a regression. No DEALER hits occur
    // in this scenario, so 5 (not 6+) is still the ceiling: confirms the hole card's own
    // pulsing→settled re-resolution does NOT spuriously re-fire its own already-fired departure
    // sound, the actual risk this test's own title is about.
    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(5);
    }, { timeout: 2000 });

    // Give any spurious re-fire a real chance to show up before asserting it stayed single/stable.
    await new Promise((r) => setTimeout(r, 500));
    expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-flip')).toHaveLength(1);
    expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(5);
  }, 20000);

  // Ticket 2026-10-04#2 (D78): Owner asked for the deal sound to fire on DEPARTURE (the instant a
  // card leaves the deck, `delay` seconds after mount), not on ARRIVAL (`delay + CARD_ANIM_S`, the
  // old onAnimationComplete wiring this file's own D72 tests above never needed to distinguish —
  // they only assert eventual COUNTS, which the old wiring already satisfied). These two assert the
  // actual timing, the thing D72's tests structurally can't catch.
  it('the deal sound fires close to mount, well before the full ~550ms (CARD_ANIM_S) card-travel animation could possibly have completed', async () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    // The opening deal's first card has delay=0 — under the OLD onAnimationComplete wiring this
    // could not possibly fire before CARD_ANIM_S (550ms) of REAL animation time has elapsed, a
    // floor that doesn't shrink under test-environment slowness (motion duration is wall-clock
    // real time, not CPU-bound). 300ms is comfortably inside that floor with real margin either way.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const count = playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal').length;
    expect(count).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(4);
    }, { timeout: 8000 });
  }, 10000);

  it('the 4 opening deal sounds land staggered over real time, not simultaneously — the exact trap an onAnimationStart swap would hit (it fires once, synchronously, for the whole animate-prop assignment, BEFORE any per-card transition.delay is honored)', async () => {
    render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
    // Own-card index 1's own real delay is 2×DEAL_STAGGER_S = 440ms, the opponent's visible card is
    // 220ms, the hole card is 660ms — none of the later three should have fired yet at 150ms, so
    // the count here should read roughly 1 (just the delay=0 own card), never all 4. An accidental
    // onAnimationStart swap would show 4 here almost immediately, since it fires synchronously at
    // mount for every card regardless of its own individual delay.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const earlyCount = playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal').length;
    expect(earlyCount).toBeLessThan(4);

    await waitFor(() => {
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'blackjack-card-deal')).toHaveLength(4);
    }, { timeout: 8000 });
  }, 10000);
});

describe('BlackjackHubScreen (GameHub + BlackjackPanel)', () => {
  beforeEach(() => {
    // Ticket 2026-09-27#7's SOL-default reversal changed the app-wide curSel singleton's own
    // default — these tests are about the USD `$` ribbon balance specifically, not currency
    // switching, so force USD explicitly.
    setCurSel('USD');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
    }));
    // Ticket 2026-10-05#1 (D82): Blackjack now genuinely fires generic-win on a real win, so
    // playMock's call history must not leak across tests in this describe the way it previously
    // got away with (nothing here asserted on it before this ticket).
    playMock.mockClear();
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

  // Ticket 2026-09-27#6 (D68, ADVISOR_TO_PM.md): the full 3D-button treatment — equal width,
  // brand colors, a box-shadow ledge, and disabled opacity-50 (was 0.4, the same category of bug
  // D66 already found on the shared PLAY button).
  describe('ticket 2026-09-27#6 (D68): Hit/Stand get the full 3D-button treatment', () => {
    it('item 1: both pills share the same min-width (92px), regardless of their own text length', () => {
      render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
      const hit = screen.getByTestId('hit-btn');
      const stand = screen.getByTestId('stand-btn');
      expect(hit.style.minWidth).toBe('92px');
      expect(stand.style.minWidth).toBe('92px');
    });

    it('item 2: Hit keeps the brand face color; Stand gets the literal #4F4CEA face — both distinct from the plain flat pill this used to be', () => {
      render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
      const hit = screen.getByTestId('hit-btn');
      const stand = screen.getByTestId('stand-btn');
      expect(hit.className).toContain('bg-brand');
      expect(stand.style.background).toBe('rgb(79, 76, 234)'); // #4F4CEA, jsdom-normalized
    });

    it('item 3: both pills carry a box-shadow ledge (Hit #5F27B8, Stand #4340D8) and release via active:translate-y-[3px], copied from the shared PLAY button construction', () => {
      render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
      const hit = screen.getByTestId('hit-btn');
      const stand = screen.getByTestId('stand-btn');
      expect(hit.style.boxShadow).toBe('0 5px 0 #5F27B8');
      expect(stand.style.boxShadow).toBe('0 5px 0 #4340D8');
      expect(hit.className).toContain('active:translate-y-[3px]');
      expect(stand.className).toContain('active:translate-y-[3px]');
    });

    it('item 3: disabled opacity is 0.5 (not the old 0.4)', () => {
      render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
      const hit = screen.getByTestId('hit-btn');
      const stand = screen.getByTestId('stand-btn');
      expect(hit.className).toContain('disabled:opacity-50');
      expect(hit.className).not.toContain('disabled:opacity-40');
      expect(stand.className).toContain('disabled:opacity-50');
      expect(stand.className).not.toContain('disabled:opacity-40');
    });

    it('item 4: pressing Hit fires the rcNavBarPop pulse on Hit only, and it self-clears after 460ms so a repeat press restarts cleanly', () => {
      vi.useFakeTimers();
      try {
        render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
        const hit = screen.getByTestId('hit-btn');
        const stand = screen.getByTestId('stand-btn');
        expect(hit.style.animation).toBe('');
        fireEvent.pointerDown(hit);
        expect(hit.style.animation).toContain('rcNavBarPop');
        expect(stand.style.animation).toBe(''); // Stand's own key is untouched — per-key, not shared
        act(() => { vi.advanceTimersByTime(460); });
        expect(hit.style.animation).toBe(''); // self-clears, doesn't just accumulate
      } finally {
        vi.useRealTimers();
      }
    });

    it('item 4: pressing Stand fires the pulse on Stand only (independent per-key state, not a shared bar-wide pulse)', () => {
      render(<BlackjackHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['hit', 'stand'] })} />);
      const hit = screen.getByTestId('hit-btn');
      const stand = screen.getByTestId('stand-btn');
      fireEvent.pointerDown(stand);
      expect(stand.style.animation).toContain('rcNavBarPop');
      expect(hit.style.animation).toBe('');
    });
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
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019, currency: 'USD' } })} />);
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
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019, currency: 'USD' } })} />);
    // The win frame lands a beat after the reveal (FRAME_DELAY_MS) and stays.
    // Ticket 2026-09-27#5 (D67): the ring is now the inline literal #16A34A, not the shared
    // ring-success class (cardFrameClass is Blackjack-local, not the shared outlineClasses()).
    await waitFor(() => {
      for (const c of within(screen.getByTestId('own-hand')).getAllByTestId('card')) {
        expect(c.className).toMatch(/ring-\[3px\]/);
        expect((c as HTMLElement).style.getPropertyValue('--tw-ring-color')).toBe('#16A34A');
      }
    }, { timeout: 2000 });
    // The opponent's cards are never framed; the frame is the player's own win/lose only.
    for (const c of within(screen.getByTestId('opp-hand')).getAllByTestId('card')) {
      expect(c.className).not.toMatch(/ring-\[3px\]/);
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
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'bob' }, lastSettlement: { delta: -10, newBalance: 990, currency: 'USD' } })} />);
    // Ticket 2026-09-27#5 (D67): inline literal #FF3E5E, not the shared ring-destructive class.
    await waitFor(() => {
      const card = within(screen.getByTestId('own-hand')).getAllByTestId('card')[0] as HTMLElement;
      expect(card.className).toMatch(/ring-\[3px\]/);
      expect(card.style.getPropertyValue('--tw-ring-color')).toBe('#FF3E5E');
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
    rr2(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: drawView, lastOutcome: { type: 'draw' }, lastSettlement: { delta: 0, newBalance: 1000, currency: 'USD' } })} />);
    await new Promise((r) => setTimeout(r, 1200));
    for (const c of within(screen.getByTestId('own-hand')).getAllByTestId('card')) {
      expect(c.className).not.toMatch(/ring-\[3px\]/);
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
    rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019, currency: 'USD' } })} />);
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
      matchId, ownerName, ownerTier: 'Unranked', stake: 50, openedAt: 0, expiresAt: Date.now() + 30_000, timeControlId: 'none', currency: 'USD',
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
    // item 4: the scan reads through displayHostName (strips any bot emoji, prepends '@'), same
    // formatting GamesCarousel.tsx uses. Ticket 2026-09-25#6, Part 1: OpponentSlot's own
    // stripBotDisclosure then strips that '@' too, so the scan reads the bare 'rival'.
    expect(scan.textContent).toBe('rival');
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
      // Ticket 2026-09-27#5 (D67): the ring is now the inline literal #FF3E5E on this Blackjack-local
      // cardFrameClass, not the shared ring-destructive class.
      await waitFor(() => {
        for (const c2 of within(screen.getByTestId('own-hand')).getAllByTestId('card') as HTMLElement[]) {
          expect(c2.className).toMatch(/ring-\[3px\]/);
          expect(c2.style.getPropertyValue('--tw-ring-color')).toBe('#FF3E5E');
        }
        for (const c2 of within(screen.getByTestId('opp-hand')).getAllByTestId('card') as HTMLElement[]) {
          expect(c2.className).toMatch(/ring-\[3px\]/);
          expect(c2.style.getPropertyValue('--tw-ring-color')).toBe('#FF3E5E');
        }
      }, { timeout: 2000 });
      // The reversal: Blackjack's draw surface is CARDS + an orange "Push" label — NOT an orange bar.
      const push = screen.getByTestId('push-label');
      expect(push.textContent).toMatch(/push/i);
      expect(push.className).toMatch(/text-amber-400/); // orange
      // Neither player bar shows anything on a push (bars speak only on decided rounds).
      expect(screen.getByTestId('hub-slot-own').className).not.toMatch(/ring-\[3px\]/);
      expect(screen.getByTestId('hub-slot-opponent').className).not.toMatch(/ring-\[3px\]/);
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
      // Ticket 2026-09-27#5 (D67): inline literal #FF8A1E, no glow (matching Mines' own no-glow draw
      // ring exactly) — not the shared ring-amber-400 class.
      await waitFor(() => {
        for (const c2 of within(screen.getByTestId('own-hand')).getAllByTestId('card') as HTMLElement[]) {
          expect(c2.className).toMatch(/ring-\[3px\]/);
          expect(c2.style.getPropertyValue('--tw-ring-color')).toBe('#FF8A1E');
        }
        for (const c2 of within(screen.getByTestId('opp-hand')).getAllByTestId('card') as HTMLElement[]) {
          expect(c2.className).toMatch(/ring-\[3px\]/);
          expect(c2.style.getPropertyValue('--tw-ring-color')).toBe('#FF8A1E');
        }
      }, { timeout: 2000 });
      // Orange "Push" overlay; bars show nothing (the reversal).
      expect(screen.getByTestId('push-label').textContent).toMatch(/push/i);
      expect(screen.getByTestId('hub-slot-own').className).not.toMatch(/ring-\[3px\]/);
      expect(screen.getByTestId('hub-slot-opponent').className).not.toMatch(/ring-\[3px\]/);
      expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
      // Ticket 2026-10-05#1 (D82): a push is outcome.type==='draw' — `win` stays false the whole
      // round, so the generic-win sound (now enabled for Blackjack) must stay silent here too.
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'generic-win')).toHaveLength(0);
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
      rerender(<BlackjackHubScreen {...baseProps({ username: 'me', currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019, currency: 'USD' } })} />);

      // The bar runs the SAME shared component as Coinflip: green fill + "You Win" alongside the
      // username (never swapped out), settling to the green outline. Ticket 2026-09-27#5 (D67):
      // Blackjack joined GameHub.tsx's winFillColor allow-list — inline literal #16A34A, not the
      // shared bg-success class.
      await waitFor(() => {
        expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you won/i);
      }, { timeout: 2000 });
      const ownBar = screen.getByTestId('hub-slot-own');
      const ownFill = ownBar.querySelector('.pointer-events-none.absolute.inset-0') as HTMLElement | null;
      expect(ownFill?.style.background).toBe('rgb(22, 163, 74)'); // #16A34A, jsdom-normalized
      expect(ownBar.textContent).toContain('me'); // username stays visible
      // Cards also get the green frame (own hand) — the Blackjack-local cardFrameClass fix.
      await waitFor(() => {
        for (const c2 of within(screen.getByTestId('own-hand')).getAllByTestId('card') as HTMLElement[]) {
          expect(c2.className).toMatch(/ring-\[3px\]/);
          expect(c2.style.getPropertyValue('--tw-ring-color')).toBe('#16A34A');
        }
      }, { timeout: 2000 });
      // Ticket 2026-10-05#1 (D82): Blackjack is now enabled in GameHub.tsx's winSoundName ternary
      // (it was deliberately silent here under D79/D80, proven by this same assertion asserting
      // zero back then) — fires exactly once, on the same beat the green fill/verdict text landed
      // above.
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'generic-win')).toHaveLength(1);
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
      rerender(<BlackjackHubScreen {...baseProps({ username: 'me', currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'bob' }, lastSettlement: { delta: -10, newBalance: 990, currency: 'USD' } })} />);

      // Ticket 2026-09-27#5 (D67): inline literal #FF3E5E, not the shared ring-destructive class.
      await waitFor(() => {
        const ownBar = screen.getByTestId('hub-slot-own');
        expect(ownBar.className).toMatch(/ring-\[3px\]/);
        expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('var(--rc-loss)');
      }, { timeout: 2000 });
      const ownBar = screen.getByTestId('hub-slot-own');
      expect(ownBar.querySelector('.pointer-events-none.absolute.inset-0')).toBeNull(); // no fill layer
      expect(within(ownBar).queryByTestId('hub-slot-own-verdict')).toBeNull(); // no "You Win"
      // Ticket 2026-10-05#1 (D82): win stays false the whole round on a loss — generic-win silent.
      expect(playMock.mock.calls.filter((c2) => c2[0] === 'generic-win')).toHaveLength(0);
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
      rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019, currency: 'USD' } })} />);
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
        lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019, currency: 'USD' },
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
      rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019, currency: 'USD' } })} />);
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
        rerender(<BlackjackHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, legalMoves: [], lastOutcome: { type: 'win', winner: 'bob' }, lastSettlement: { delta: -10, newBalance: 990, currency: 'USD' } })} />);

        // Before the last hit lands (< revealMs), the own bar shows NO verdict outline — in-play look.
        await act(async () => { await vi.advanceTimersByTimeAsync(1400); });
        expect(screen.getByTestId('hub-slot-own').className).not.toMatch(/ring-\[3px\]/);

        // Just past revealMs (1440) the loss outline fires — bar and cards settle together.
        // Ticket 2026-09-27#5 (D67): inline literal #FF3E5E, not the shared ring-destructive class.
        await act(async () => { await vi.advanceTimersByTimeAsync(120); });
        const ownBar = screen.getByTestId('hub-slot-own');
        expect(ownBar.className).toMatch(/ring-\[3px\]/);
        expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('var(--rc-loss)');
        for (const card of within(screen.getByTestId('own-hand')).getAllByTestId('card') as HTMLElement[]) {
          expect(card.className).toMatch(/ring-\[3px\]/);
          expect(card.style.getPropertyValue('--tw-ring-color')).toBe('#FF3E5E');
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
        rerender(<BlackjackHubScreen {...baseProps({ username: 'me', currentMatchId: null, gameState: terminal, legalMoves: [], lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019, currency: 'USD' } })} />);

        // Before the flip completes, the win reveal ("You Win" verdict) has NOT started on the bar.
        await act(async () => { await vi.advanceTimersByTimeAsync(500); });
        expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull();

        // Just past FLIP_MS (~550) the shared win reveal begins on the bar.
        await act(async () => { await vi.advanceTimersByTimeAsync(120); });
        expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you won/i);
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
        const { rerender } = render(<BlackjackHubScreen {...baseProps({ balances: balancesOf(1000), currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
        expect(screen.getByTestId('hub-balance').textContent).toContain('1,000');

        // Match ends: the settled balance (1019) arrives with the null currentMatchId.
        rerender(<BlackjackHubScreen {...baseProps({ balances: balancesOf(1019), currentMatchId: null, gameState: terminal, legalMoves: [], lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019, currency: 'USD' } })} />);

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

  // Ticket 2026-09-27#3 (D65, ADVISOR_TO_PM.md) item 1: the same bar-slide gap D60/D63 already
  // fixed for Coinflip/Chess — Blackjack never opted into `matchBarSlide`. Mirrors
  // MinesHub.test.tsx's/ChessHub.test.tsx's own measured-shift test (identical mocked rects/
  // formula) — Blackjack uses the same 'measured' mode, so its own table height is irrelevant.
  it('ticket 2026-09-27#3: measures the real bar positions live and slides the bars toward center + dims the table while matchForming holds, then back to normal once in-match', () => {
    vi.useFakeTimers();
    const rect = (top: number, height: number): DOMRect =>
      ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-rc-gamewrap')) return rect(0, 0);
      if (this.hasAttribute('data-rc-oppbar')) return rect(100, 48);
      if (this.hasAttribute('data-rc-playerbar')) return rect(300, 48);
      return rect(0, 0);
    });
    try {
      const gameState = inPlayView();
      const { rerender } = render(<BlackjackHubScreen {...baseProps({ initialStake: 10 })} />);
      const table = screen.getByTestId('hub-board').parentElement as HTMLElement;
      // Idle: the slide hasn't armed yet — no shift, table at full opacity.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
      expect(table.style.opacity).toBe('1');

      fireEvent.click(screen.getByTestId('hub-play'));
      rerender(<BlackjackHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState, legalMoves: [] })} />);

      act(() => { vi.advanceTimersByTime(1000); });
      // oTop=100, pTop=300, pr.height=48 → mid=(100+300+48)/2=224 → o=224-71-100=53, p=224+23-300=-53
      // (same formula MinesHub.test.tsx's own measured-shift test verifies).
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(53px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(-53px)');
      expect(table.style.opacity).toBe('0.28');

      // Just past the 2400ms dwell floor: phase flips to in-match — bars slide back, table un-dims.
      act(() => { vi.advanceTimersByTime(1450); });
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
      expect(table.style.opacity).toBe('1');
    } finally {
      rectSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-27#3 (D65) item 3: "Waiting for an opponent…" collided with the now-converged
  // bars/VS label — the only place this text could ever render (`phase === 'waiting'`), so hiding
  // it reduces to a one-branch change, not new logic. 'idle''s own text is untouched.
  it('ticket 2026-09-27#3: "Waiting for an opponent…" no longer renders while searching; "Place your bet and play" still shows at idle', () => {
    const gameState = inPlayView();
    const { rerender } = render(<BlackjackHubScreen {...baseProps({ initialStake: 10 })} />);
    expect(screen.getByTestId('hub-board').textContent).toContain('Place your bet and play');

    fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start
    rerender(<BlackjackHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState, legalMoves: [] })} />);
    // Still within the dwell floor: matchForming holds `phase` at 'waiting'.
    expect(screen.queryByTestId('own-hand')).toBeNull();
    expect(screen.getByTestId('hub-board').textContent).not.toContain('Waiting for an opponent');
    expect(screen.getByTestId('hub-board').textContent).not.toContain('Place your bet and play');
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
        return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hides the wallet chip, Open Games, related-games rail, and the bottom nav; shows a plain Demo badge — generalized, not Coinflip/Chess-only', () => {
    render(<BlackjackHubScreen {...baseProps({ isGuest: true, balances: balancesOf(200), initialStake: 100 })} />);

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
      return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
    }));
    render(<BlackjackHubScreen {...baseProps({ isGuest: false })} />);
    expect(screen.getByTestId('hub-play')).toBeInTheDocument();
    expect(screen.getByTestId('hub-nav-games')).toBeInTheDocument();
  });
});
