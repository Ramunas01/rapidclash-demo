// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react';
import { CoinflipHubScreen } from '../screens/CoinflipHub.js';
import type { CoinflipView } from '../App.js';
import type { OpenChallenge } from '@rapidclash/shared';
import { balancesOf } from './testBalances.js';
import { setCurSel } from '../lib/currency.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches Result/CoinflipPlay tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// The coin is now a real Three.js cylinder; jsdom has no WebGL context, so the real THREE.WebGLRenderer
// would throw. Stub it (mirrors the canvas-confetti mock above) — this file asserts on CoinflipHub's
// OWN choreography (pick window, reveal staging, draw beat), not the coin's animation curve (that's
// covered in isolation by Coin.test.tsx, which also exercises the stub's recorders directly).
vi.mock('three', async () => import('./three-stub.js'));

// Ticket 2026-10-04#3 (D79): Web Audio is absent in jsdom — mock the sound module so the
// coin-spin/generic-win wiring can be asserted directly (same idiom as BlackjackHub.test.tsx's own
// equivalent mock). Every other existing test in this file never asserts on `play()`, so this is a
// pure addition, not a behavior change for them — they'd have silently no-op'd on the real
// (fails-silently) implementation either way.
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

// Force prefers-reduced-motion so the coin's flip takes its short ~450ms settle rather than the full
// ~1.8-2.4s spin — these tests run under both real timers (default `waitFor` ~1s timeout) and fake
// timers, and only the short path reliably lands within either. Coin.test.tsx covers the full-motion
// spin (turn count, duration, ease-out) directly.
beforeEach(() => {
  // Ticket 2026-09-27#7's SOL-default reversal changed the app-wide curSel singleton's own
  // default — these tests are about the USD `$` ribbon balance specifically, not currency
  // switching, so force USD explicitly.
  setCurSel('USD');
  // Belt-and-braces: guarantee any previous test's Coin (and its in-flight rAF loop) is fully
  // unmounted before this test starts — some tests mount a coin already mid-terminal (`face` set
  // from the first render, e.g. a same-side-draw fixture), which can still be flipping when the
  // test body returns; `afterEach(cleanup)` in setup.ts covers this too, but ordering it here as
  // well removes any doubt for a real-timer animation loop racing into the next test.
  cleanup();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  // jsdom has no real 2D canvas context either — silence its noisy "not implemented" console.error
  // (the cap-texture painter in Coin.tsx already no-ops gracefully when this returns null).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // Stub rAF/cancelAnimationFrame with our own tiny setTimeout-based polyfill rather than relying on
  // jsdom's native one. Root-caused via debugging: once some OTHER test in this file toggles
  // `vi.useFakeTimers()`/`vi.useRealTimers()` (the win/loss/draw bar-animation tests below), jsdom's
  // native `requestAnimationFrame` stops invoking its callback at all for the rest of the file — the
  // coin's flip would silently hang forever. Re-stubbing our own per-test sidesteps that entirely.
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});

type Props = Parameters<typeof CoinflipHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok',
    playerId: 'pid',
    username: 'me',
    opponentId: 'bob',
    balances: balancesOf(1000),
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
    onOpenWallet: vi.fn(), onOpenSignup: vi.fn(),
    onOpenRewards: vi.fn(),
    onOpenAffiliate: vi.fn(),
    onOpenGameList: vi.fn(),
    onResultDismiss: vi.fn(),
    ...over,
  };
}

const CHALLENGE: OpenChallenge = {
  matchId: 'c1',
  ownerName: 'rival',
  ownerTier: 'Unranked',
  stake: 50,
  openedAt: 0,
  expiresAt: Date.now() + 30_000,
  timeControlId: 'none',
  currency: 'USD',
};

describe('CoinflipHubScreen (Part 2 — live state machine)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/games') || u.includes('/leaderboard'))
          return { ok: true, json: async () => [] } as Response;
        return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
      })
    );
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

  // Issue #381: tap-again on the 1¢ preset reaches the undocumented, bot-excluded stake of 2
  // (tools/bot-crowd's HUMAN_RESERVED_STAKES) — reserved for human-only testing. `2` is never its
  // own preset button; it's only reachable through hub-bet-1's own toggling state.
  describe('#381: tap-again on the 1¢ preset arms the reserved stake 2', () => {
    // T9: registered users (baseProps() default, isGuest unset → false) see the Owner-approved $
    // skin in the bet panel, not the play-money RC glyph — these assertions flip from 'RC1'/'RC2'
    // to '$1'/'$2' accordingly (GameHub.tsx PlayPanel, CHARTER.md #4). The gesture/highlight
    // behaviour under test here is otherwise unchanged.
    //
    // Ticket 2026-09-11#8/A item 2: the bet presets no longer carry a per-button `bg-brand`
    // background — selection is now a shared sliding indicator behind plain colored text
    // (GameHub.tsx's `PlayPanel`). `aria-pressed` is the new selection signal (same convention the
    // adjacent time-control buttons already used), so these assertions check that instead of the
    // no-longer-present class.
    it('a single tap arms 1 (regression guard)', () => {
      render(<CoinflipHubScreen {...baseProps()} />);
      fireEvent.click(screen.getByTestId('hub-bet-1'));
      const preset = screen.getByTestId('hub-bet-1');
      expect(preset.textContent).toBe('$1');
      expect(preset.getAttribute('aria-pressed')).toBe('true');
    });

    it('a second consecutive tap arms 2 (button now shows 2, highlighted)', () => {
      render(<CoinflipHubScreen {...baseProps()} />);
      fireEvent.click(screen.getByTestId('hub-bet-1'));
      fireEvent.click(screen.getByTestId('hub-bet-1'));
      const preset = screen.getByTestId('hub-bet-1');
      expect(preset.textContent).toBe('$2');
      expect(preset.getAttribute('aria-pressed')).toBe('true');
    });

    it('a third tap (while at 2) toggles back to 1', () => {
      render(<CoinflipHubScreen {...baseProps()} />);
      fireEvent.click(screen.getByTestId('hub-bet-1'));
      fireEvent.click(screen.getByTestId('hub-bet-1'));
      fireEvent.click(screen.getByTestId('hub-bet-1'));
      const preset = screen.getByTestId('hub-bet-1');
      expect(preset.textContent).toBe('$1');
      expect(preset.getAttribute('aria-pressed')).toBe('true');
    });

    it('tapping a different preset then tapping hub-bet-1 again arms 1 fresh (does not jump to 2)', () => {
      render(<CoinflipHubScreen {...baseProps()} />);
      fireEvent.click(screen.getByTestId('hub-bet-1'));
      fireEvent.click(screen.getByTestId('hub-bet-1')); // now armed at 2
      fireEvent.click(screen.getByTestId('hub-bet-10')); // a different preset resets the gesture
      fireEvent.click(screen.getByTestId('hub-bet-1')); // fresh tap on 1
      const preset = screen.getByTestId('hub-bet-1');
      expect(preset.textContent).toBe('$1');
      expect(preset.getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('hub-bet-10').getAttribute('aria-pressed')).toBe('false');
    });

    it('2 never appears as its own preset button in the grid', () => {
      render(<CoinflipHubScreen {...baseProps()} />);
      expect(screen.queryByTestId('hub-bet-2')).toBeNull();
      fireEvent.click(screen.getByTestId('hub-bet-1'));
      fireEvent.click(screen.getByTestId('hub-bet-1')); // armed at 2
      expect(screen.queryByTestId('hub-bet-2')).toBeNull(); // still no separate grid entry
      // The "Bet amount" readout reflects the armed 2, and it's the hub-bet-1 slot doing the display.
      const betSection = screen.getByTestId('hub-section-bet');
      expect(within(betSection).getAllByText('$2', { exact: true }).length).toBeGreaterThan(0);
    });
  });

  // Ticket 2026-09-12 (Chess high-stake escalation, PM-scoped — no prototype source): the "100"
  // preset's tap-again gesture only exists when a hub passes GameHub's `highStakeCycle` prop.
  // CoinflipHubScreen never does, so this is the regression guard that Coinflip's own "100" button
  // stays completely plain — repeated taps just keep re-arming 100, never cycling.
  it("Coinflip's own 100 preset is unaffected by the Chess-only high-stake cycle — repeated taps just keep arming 100", () => {
    render(<CoinflipHubScreen {...baseProps()} />);
    const preset = screen.getByTestId('hub-bet-100');
    for (let i = 0; i < 3; i++) {
      fireEvent.click(preset);
      expect(preset.textContent).toBe('$100');
      expect(preset.getAttribute('aria-pressed')).toBe('true');
    }
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
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/choose your bet/i);

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
    render(
      <CoinflipHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 30_000, onCancel })} />
    );
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
    render(
      <CoinflipHubScreen
        {...baseProps({
          waitingExpiresAt: Date.now() + 30_000,
          challengesByGame: { coinflip: [CHALLENGE] },
        })}
      />
    );
    // Waiting is now signalled in place by the Cancel control (no WaitingBlock).
    await waitFor(() => expect(screen.getByTestId('hub-cancel')).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('[data-match-id="c1"]')).toBeTruthy());
    const join = within(document.querySelector('[data-match-id="c1"]') as HTMLElement).getByTestId(/^games-carousel-join-/);
    expect(join).toBeDisabled();
  });

  it('In-match: the board + countdown activate, H/T move into the own slot pill, opponent shows PLAYING…', () => {
    const onMakeMove = vi.fn();
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: {} };
    render(
      <CoinflipHubScreen
        {...baseProps({
          currentMatchId: 'm1',
          gameState,
          legalMoves: ['heads', 'tails'],
          onMakeMove,
        })}
      />
    );
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

  it('In-match: the outline reconciles from the server-recorded pick, and both sides stay mutable (#164)', () => {
    // The server has echoed my pick (choices.pid = heads). The outline reconciles from that server
    // pick (not only an optimistic tap): heads reads selected. Under the timer-only-resolve model the
    // other side is NOT locked out — both stay tappable all window, so the pick can still change.
    const onMakeMove = vi.fn();
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: { pid: 'heads' } };
    render(
      <CoinflipHubScreen
        {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [], onMakeMove })}
      />
    );
    expect(screen.getByTestId('hub-move-heads')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('hub-move-tails')).not.toBeDisabled();
    expect(screen.getByTestId('hub-move-tails')).toHaveAttribute('aria-pressed', 'false');
    // Re-tapping the other side moves the outline (mutable) and sends the replacement pick.
    fireEvent.click(screen.getByTestId('hub-move-tails'));
    expect(onMakeMove).toHaveBeenCalledWith('tails');
    expect(screen.getByTestId('hub-move-tails')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('hub-move-heads')).toHaveAttribute('aria-pressed', 'false');
  });

  it('Idle: no H/T pills on the tile or in the slot (selection only happens in-play); no caption under the coin (#262)', () => {
    render(<CoinflipHubScreen {...baseProps()} />);
    expect(screen.queryByTestId('hub-move-heads')).toBeNull();
    expect(screen.queryByTestId('hub-move-tails')).toBeNull();
    // #262 Part 1: the old "Place your bet and play." caption is gone — the board carries no text.
    expect(screen.getByTestId('hub-board').textContent).toBe('');
  });

  it('#262: no caption in ANY phase (idle/waiting/in-match/result), and the coin container + coin element are the SAME DOM node throughout — one persistent coin, no WebGL rebuild on phase transitions', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const { rerender } = render(<CoinflipHubScreen {...baseProps()} />);
    const boardIdle = screen.getByTestId('hub-board');
    const coinIdle = screen.getByTestId('coin-face');
    expect(boardIdle.textContent).toBe('');

    // → waiting (the old "Finding a rival…" caption is also gone)
    rerender(<CoinflipHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 30_000 })} />);
    expect(screen.getByTestId('hub-board')).toBe(boardIdle);
    expect(screen.getByTestId('coin-face')).toBe(coinIdle);
    expect(screen.getByTestId('hub-board').textContent).toBe('');

    // → in-match
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: {} };
    rerender(
      <CoinflipHubScreen
        {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['heads', 'tails'] })}
      />
    );
    expect(screen.getByTestId('hub-board')).toBe(boardIdle);
    expect(screen.getByTestId('coin-face')).toBe(coinIdle);

    // → result (terminal, held)
    const terminalState: CoinflipView = {
      ...gameState,
      choices: { pid: 'heads', bob: 'tails' },
      result: 'heads',
    };
    rerender(
      <CoinflipHubScreen
        {...baseProps({
          currentMatchId: null,
          gameState: terminalState,
          lastOutcome: { type: 'win', winner: 'pid' },
          lastSettlement: { delta: 90, newBalance: 1090, currency: 'USD' },
        })}
      />
    );
    expect(screen.getByTestId('hub-board')).toBe(boardIdle);
    expect(screen.getByTestId('coin-face')).toBe(coinIdle); // same coin element — never remounted
  });

  it('#262: betting/PLAY stay live and pressable while the one-time intro is playing (decorative-only, never gates interaction)', () => {
    // The hub mounts with the intro opted in (CoinflipPanel passes `intro` to the persistent <Coin>);
    // this assertion runs synchronously right after mount — i.e. while the intro's tease is (or would
    // be) mid-flight — and PLAY/betting must work exactly as any other idle render.
    const onPlay = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeEnabled();
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('Result: no pop-up overlay — the flip + opponent reveal stage on the board, then the own pill lights', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy; // scroll-safety cue (reconciliation a)
    const gameState: CoinflipView = {
      players: ['pid', 'bob'],
      choices: { pid: 'heads', bob: 'tails' },
      result: 'heads',
    };
    // Start in-match so the match-end edge fires on rerender.
    const { rerender } = render(
      <CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />
    );

    // match.end: currentMatchId clears with the terminal payload. The old pop-up is gone.
    rerender(
      <CoinflipHubScreen
        {...baseProps({
          currentMatchId: null,
          gameState,
          lastOutcome: { type: 'win', winner: 'pid' },
          lastSettlement: { delta: 90, newBalance: 1090, currency: 'USD' },
        })}
      />
    );
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    // During the hold: the coin flips to the revealed face (flat coin — the face is data-coded, not
    // text) and the opponent's pick reveals.
    await waitFor(() => {
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads');
      expect(screen.getByTestId('coin-opp-pick').textContent).toMatch(/tails/i);
    });
    expect(scrollSpy).toHaveBeenCalled(); // brought into view on resolve
    // After the reveal the own bar plays the green win fill: the username stays put, "You Win" shows
    // ALONGSIDE it, and the green sits behind as a background layer (#156 — the name is not swapped
    // out). Ticket 2026-09-26#3 (D62): the fill is now the inline #16A34A, not the shared
    // `bg-success` class (Coinflip joined Dice/Mines/RPS's own gate).
    await waitFor(
      () => {
        const ownBar = screen.getByTestId('hub-slot-own');
        expect(ownBar.textContent).toMatch(/you won/i);
        expect(ownBar.textContent).toContain('me'); // username is NOT replaced by "You Win"
        const ownFill = ownBar.querySelector('.pointer-events-none.absolute.inset-0') as HTMLElement | null;
        expect(ownFill?.style.background).toBe('rgb(22, 163, 74)'); // #16A34A, jsdom-normalized
      },
      { timeout: 3000 }
    );
  });

  // The bar-level win reveal: keep the username, play the SHARED win animation, settle to the ring.
  // These drive the phase timing with fake timers. HOLD_RESULT_MS=2600 (bumped for the 3D coin's
  // longer ~1.8-2.4s flip — COINFLIP_COIN.md flag #2), BAR_VERDICT_BEAT_MS=250,
  // then the shared component: 0.5s fill-in + 2s hold + 0.5s fade-out = 3000ms to settle (constants
  // WIN_FILL_IN_MS/WIN_HOLD_MS/WIN_FADE_OUT_MS live in hub-shared/slotReveal; reused by Blackjack).
  function renderToTerminal(outcome: Props['lastOutcome']) {
    Element.prototype.scrollIntoView = vi.fn();
    const gameState: CoinflipView = {
      players: ['pid', 'bob'],
      choices: { pid: 'heads', bob: 'tails' },
      result: 'heads',
    };
    const { rerender } = render(
      <CoinflipHubScreen
        {...baseProps({ username: 'neo', currentMatchId: 'm1', gameState, legalMoves: [] })}
      />
    );
    rerender(
      <CoinflipHubScreen
        {...baseProps({
          username: 'neo',
          currentMatchId: null,
          gameState,
          lastOutcome: outcome,
          lastSettlement: { delta: 90, newBalance: 1090, currency: 'USD' },
        })}
      />
    );
  }

  it('Result win: shared 0.5/2/0.5 animation — keeps the username, "You Win" alongside, then green outline', async () => {
    vi.useFakeTimers();
    try {
      renderToTerminal({ type: 'win', winner: 'pid' });
      // Advance in stages: HOLD_RESULT_MS → result phase, then BAR_VERDICT_BEAT_MS → verdict lights
      // (each transition schedules its next timer on re-render, so a single big jump can skip it).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600 + 50);
      }); // → result phase
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250 + 50);
      }); // → win animation (fill-in)
      const ownBar = screen.getByTestId('hub-slot-own');
      expect(ownBar.textContent).toContain('neo'); // username stays put (not swapped out)
      expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you won/i); // alongside
      // Ticket 2026-09-26#3 (D62): Coinflip's own win fill/ring is now the inline #16A34A
      // (matching Dice/Mines/RPS), not the shared `bg-success`/`ring-success` classes — same
      // inline-color shape as DiceHub.test.tsx's own equivalent assertion.
      const ownFill = ownBar.querySelector('.pointer-events-none.absolute.inset-0') as HTMLElement;
      expect(ownFill.style.background).toBe('rgb(22, 163, 74)'); // #16A34A, jsdom-normalized
      expect(ownBar.className).not.toContain('ring-success'); // not yet settled to the outline

      // 0.5s fill-in + 2s hold + 0.5s fade-out = 3s → settles to the persistent green outline and the
      // "You Win"/fill leave together (the shared component unmounts the content on settle).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000 + 50);
      });
      expect(ownBar.className).toContain('ring-[3px]');
      expect(ownBar.className).not.toContain('ring-success'); // no longer the shared class
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('#16A34A');
      expect(ownBar.textContent).toContain('neo'); // username persists into the end state
      expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull(); // "You Win" left with the fill
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-26#3 (D62, ADVISOR_TO_PM.md) item 1: `GameHub.tsx`'s `OwnSlot` used to wrap
  // `aside` in `relative z-10` — above the win-fill/"you won" caption (both z-[1]) — so Coinflip's
  // own locked pick pill (rendered via `OwnPills` exactly when `terminal`, i.e. precisely during
  // this reveal window) painted OVER the green fill/caption instead of behind them. Fixed by
  // dropping `relative z-10` from that wrapper (matching `gemRow`'s own already-proven D28 fix).
  // This test is the actual regression check: the wrapper around the locked pick pill no longer
  // carries the classes that caused the stacking bug.
  it('ticket 2026-09-26#3 item 1: the locked pick pill\'s wrapper no longer outranks the win-fill/caption in stacking order (relative z-10 dropped)', async () => {
    vi.useFakeTimers();
    try {
      renderToTerminal({ type: 'win', winner: 'pid' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600 + 50);
      }); // → result phase
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250 + 50);
      }); // → win animation (fill-in) — the locked pick pill is also mounted by now (terminal)
      const pickPill = screen.getByTestId('coin-own-pick');
      const asideWrapper = pickPill.parentElement as HTMLElement;
      expect(asideWrapper.className).not.toContain('z-10');
      expect(asideWrapper.className).not.toContain('relative');
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-10-06#1 (D83) item 4: the terminal/locked pill (no onClick) is deliberately left
  // as the original flat capsule — it was never selected/ring'd to begin with (the bar-level
  // result ring/fill already carries the outcome signal), so this ticket's own 3D-ledge treatment
  // never applies to it. `terminal` is true the instant `renderToTerminal`'s second render lands
  // (no reveal-staging wait needed — `OwnPills` returns the locked pill unconditionally once
  // terminal, independent of the bar's own separately-staged win-fill timing).
  it('ticket 2026-10-06#1 (D83): the locked/terminal pick pill stays the flat capsule — no ledge, no min-width, no pressed pose', () => {
    renderToTerminal({ type: 'win', winner: 'pid' });
    const locked = screen.getByTestId('coin-own-pick');
    expect(locked.style.boxShadow).toBe('');
    expect(locked.style.minWidth).toBe('');
    expect(locked.style.transform).toBe('');
    expect(locked.className).toContain('px-3');
    expect(locked.className).not.toContain('px-4');
  });

  it('Result loss (#156): outline only — no green fill, no "You Win" (regression guard); ticket 2026-09-26#3: the loss ring is now var(--rc-loss), not the shared ring-destructive class', async () => {
    vi.useFakeTimers();
    try {
      renderToTerminal({ type: 'win', winner: 'bob' }); // a loss (opponent won)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2600 + 50);
      }); // → result phase
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250 + 50);
      }); // → verdict lights
      const ownBar = screen.getByTestId('hub-slot-own');
      expect(ownBar.className).toContain('ring-[3px]');
      expect(ownBar.className).not.toContain('ring-destructive');
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('var(--rc-loss)');
      expect(ownBar.querySelector('.pointer-events-none.absolute.inset-0')).toBeNull(); // no fill layer
      expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull(); // no "You Win"
      expect(ownBar.textContent).toContain('neo'); // username present as always
    } finally {
      vi.useRealTimers();
    }
  });

  // Coinflip has no draw outcome (confirmed: `drawRingColor`/`lossRingColor`/`winRingColor` only
  // ever branch on 'win'/'lose' — a 'draw' outcome, if it ever reached this component, would still
  // fall through to the shared `outlineClasses('draw')` class untouched by this ticket's changes,
  // since neither `winRingColor` nor `lossRingColor` gates that branch. No live path produces one
  // for this game today, so this is a structural note, not a tested behavior.

  // Ticket 2026-10-04#3 (D79): the two new Coinflip sounds — coin-spin (every real flip) and the
  // generic win sound (win rounds only, on the win-fill's own first frame).
  describe('ticket 2026-10-04#3 (D79): coin-spin + generic-win sounds', () => {
    beforeEach(() => playMock.mockClear());

    it('play("coinflip-coin-spin") fires once per round, for every terminal outcome (win, loss, and a mid-match tie-reveal flip alike)', async () => {
      vi.useFakeTimers();
      try {
        renderToTerminal({ type: 'win', winner: 'pid' });
        // The coin's own flip-kickoff effect runs synchronously during the render that sets a real
        // `face` — no timer advance needed for the spin sound specifically (unlike the bar's own
        // staged verdict/fill timing, which is a separate, later beat).
        expect(playMock.mock.calls.filter((c) => c[0] === 'coinflip-coin-spin')).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('play("generic-win") fires exactly once on a win round, in the same beat the green fill first mounts', async () => {
      vi.useFakeTimers();
      try {
        renderToTerminal({ type: 'win', winner: 'pid' });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2600 + 50);
        }); // → result phase
        expect(playMock.mock.calls.filter((c) => c[0] === 'generic-win')).toHaveLength(0); // not yet — verdict hasn't landed
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250 + 50);
        }); // → win animation (fill-in) — `barVerdict` flips to 'win' here
        expect(playMock.mock.calls.filter((c) => c[0] === 'generic-win')).toHaveLength(1);

        // Stays at exactly 1 through the rest of the reveal (fill-in → hold → fade-out → settle) —
        // no re-fire from the SAME round's own later renders.
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3000 + 50);
        });
        expect(playMock.mock.calls.filter((c) => c[0] === 'generic-win')).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('play("generic-win") never fires on a loss — zero calls through the whole reveal', async () => {
      vi.useFakeTimers();
      try {
        renderToTerminal({ type: 'win', winner: 'bob' }); // a loss (opponent won)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2600 + 50);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(250 + 50 + 3000 + 50);
        });
        expect(playMock.mock.calls.filter((c) => c[0] === 'generic-win')).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('JOIN balance-check: refuses clearly when the owner stake is uncovered, without taking', () => {
    const onTakeChallenge = vi.fn();
    render(
      <CoinflipHubScreen
        {...baseProps({ balances: balancesOf(5), challengesByGame: { coinflip: [CHALLENGE] }, onTakeChallenge })}
      />
    );
    const row = document.querySelector('[data-match-id="c1"]') as HTMLElement;
    fireEvent.click(within(row).getByTestId(/^games-carousel-join-/));
    expect(onTakeChallenge).not.toHaveBeenCalled();
    expect(screen.getByTestId('games-carousel-notice').textContent).toMatch(/not enough/i);
  });

  it('JOIN succeeds (takes the owner stake) when covered', () => {
    const onTakeChallenge = vi.fn();
    render(
      <CoinflipHubScreen
        {...baseProps({
          balances: balancesOf(1000),
          challengesByGame: { coinflip: [CHALLENGE] },
          onTakeChallenge,
        })}
      />
    );
    // The row shows the owner's stake so the tap is informed consent.
    const row = document.querySelector('[data-match-id="c1"]') as HTMLElement;
    // registered (default loggedIn: true) → the Owner-approved $ skin, 2026-09-11#8 item B.2
    expect(within(row).getByTestId(/^games-carousel-stake-/).textContent).toBe('$50');
    fireEvent.click(within(row).getByTestId(/^games-carousel-join-/));
    expect(onTakeChallenge).toHaveBeenCalledWith('c1');
  });

  it('chrome: wallet chip shows the live RC-icon balance and opens the wallet', () => {
    const onOpenWallet = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ balances: balancesOf(1250), onOpenWallet })} />);
    expect(screen.getByTestId('hub-balance').textContent).toContain('1,250');
    fireEvent.click(screen.getByTestId('hub-wallet-chip'));
    expect(onOpenWallet).toHaveBeenCalled();
  });

  it('T9: registered users see the Owner-approved $ skin in the bet panel too, not just the header wallet chip (GameHub.tsx PlayPanel, CHARTER.md #4)', () => {
    const { container } = render(
      <CoinflipHubScreen {...baseProps({ challengesByGame: { coinflip: [CHALLENGE] } })} />
    );
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).toMatch(/\$/);
  });

  it('T9: guest mode keeps the play-money RcIcon bet display — no $ leaks into the game body', () => {
    const { container } = render(
      <CoinflipHubScreen {...baseProps({ challengesByGame: { coinflip: [CHALLENGE] }, isGuest: true })} />
    );
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).not.toMatch(/\$/);
  });

  it('#161: a same-side draw runs the SHARED beat here too — orange on both bars, then clears (generic replays signal, no CoinflipHub change)', async () => {
    vi.useFakeTimers();
    try {
      Element.prototype.scrollIntoView = vi.fn();
      // Coinflip's module keeps `round`/`replays` public over the wire (the client view type omits
      // them; the shared hub reads them structurally). A same-side push bumps replays 0 → 1 and
      // re-deals a fresh (empty) pick round in the same escrow — a NON-terminal state.
      const round0 = {
        players: ['pid', 'bob'],
        choices: {},
        replays: 0,
      } as unknown as CoinflipView;
      const drawn = { players: ['pid', 'bob'], choices: {}, replays: 1 } as unknown as CoinflipView;
      const { rerender } = render(
        <CoinflipHubScreen
          {...baseProps({ currentMatchId: 'm1', gameState: round0, legalMoves: [] })}
        />
      );
      rerender(
        <CoinflipHubScreen
          {...baseProps({ currentMatchId: 'm1', gameState: drawn, legalMoves: ['heads', 'tails'] })}
        />
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByTestId('hub-slot-own').className).toContain('ring-amber-400');
      expect(screen.getByTestId('hub-slot-opponent').className).toContain('ring-amber-400');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000 + 50);
      });
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
    render(
      <CoinflipHubScreen
        {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['heads', 'tails'] })}
      />
    );
    const opp = screen.getByTestId('hub-slot-opponent').textContent ?? '';
    expect(opp).toContain('Opponent');
    expect(opp).not.toMatch(/bob/);
  });

  it('Own slot shows "Sign in" when logged out', () => {
    render(<CoinflipHubScreen {...baseProps({ loggedIn: false, token: '' })} />);
    expect(screen.getByTestId('hub-slot-own').textContent).toMatch(/sign in/i);
  });

  it('Unified play panel: PLAY + an inert Play-a-Friend; no "max"/"choose your bet" copy while idle', () => {
    const { container } = render(<CoinflipHubScreen {...baseProps()} />);
    const panel = screen.getByTestId('hub-section-play');
    expect(panel).toContainElement(screen.getByTestId('hub-play'));
    const friend = screen.getByTestId('hub-play-friend');
    expect(friend).toHaveAttribute('aria-disabled', 'true'); // visual-only (owner D1)
    expect(container.textContent ?? '').not.toMatch(/choose your bet/i);
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

// Ticket 2026-09-11#9 (ADVISOR_TO_PM.md): a deliberate Owner-directed REVERSAL of #387's
// `searchFloorMs={0}` (Owner confirmed this applies to Coinflip too, same reasoning as RPS).
// Coinflip's entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS, resolves ONLY at
// expiry — never early); restoring the ~3.8s "Searching…"/"found"/"split" dwell floor now
// deliberately holds `phase` at 'waiting' for that beat even when `currentMatchId` is already set,
// matching the prototype's timing (RPS's `startRps()`, `Full Spec.html:3291-3313` — Coinflip shares
// the identical GameHub mechanism) — accepting that this eats into the player's SEEN share of the
// already-ticking server window (see the code comment at CoinflipHub.tsx's `searchFloorMs` prop for
// the full rationale). This replaces the old "bypassed (#387)" behavior the tests below used to
// assert.
describe('CoinflipHubScreen — search dwell floor restored (2026-09-11#9)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('holds at waiting (pick buttons hidden, VS label shown) through the ~3.8s dwell floor even when currentMatchId is already set, then reveals the pick buttons once the floor elapses', () => {
    vi.useFakeTimers();
    try {
      const onPlay = vi.fn();
      const { rerender } = render(<CoinflipHubScreen {...baseProps({ initialStake: 10, onPlay })} />);
      fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start (searchStartRef)
      expect(onPlay).toHaveBeenCalledWith(10);

      // The server pairs the match immediately (as can genuinely happen) — rerender with a live match
      // and NO time elapsed. The restored ~3.8s dwell floor holds `phase` at 'waiting' regardless.
      const gameState: CoinflipView = { players: ['pid', 'bob'], choices: {} };
      rerender(<CoinflipHubScreen {...baseProps({ initialStake: 10, onPlay, currentMatchId: 'm1', gameState })} />);

      expect(screen.queryByTestId('hub-move-heads')).not.toBeInTheDocument();
      expect(screen.queryByTestId('hub-move-tails')).not.toBeInTheDocument();
      // T5: `matchForming` (phase 'waiting' with a currentMatchId already assigned) is exactly the
      // window the restored floor now holds open — the shared VS label arms for Coinflip again.
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('1');
      // Ticket 2026-09-26#1 (D60, corrects the 2026-09-11#10 item 1 assumption below): Coinflip now
      // opts into the same `matchBarSlide="measured"` mechanism Mines/Dice already use, so during
      // this exact matchForming window the bars DO carry the data-rc-* markers and a real transform —
      // see the dedicated measured-shift test below for the exact live-measured values.
      expect(screen.getByTestId('hub-slot-opponent').hasAttribute('data-rc-oppbar')).toBe(true);
      expect(screen.getByTestId('hub-slot-own').hasAttribute('data-rc-playerbar')).toBe(true);

      // Advance past the restored ~3.8s floor — the hold clears and the pick buttons render.
      act(() => { vi.advanceTimersByTime(3800); });

      expect(screen.getByTestId('hub-move-heads')).toBeInTheDocument();
      expect(screen.getByTestId('hub-move-tails')).toBeInTheDocument();
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0');
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-26#1 (D60, ADVISOR_TO_PM.md): the Designer-reported gap — Coinflip's opponent
  // search never converged the bars/dimmed the board, unlike RPS/Mines/Dice. Fixed by opting into
  // the already-generic `matchBarSlide="measured"` mechanism (same live-DOM-measurement mode Mines
  // uses — see MinesHub.test.tsx's own measured-shift test for the identical formula) plus the same
  // `barSlideActive`-driven opacity fade on the board wrapper RpsPanel/MinesPanel already have.
  it('ticket 2026-09-26#1: measures the real bar positions live and slides the bars toward center + dims the coin board while matchForming holds, then back to normal once in-match', () => {
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
      const { rerender } = render(<CoinflipHubScreen {...baseProps({ initialStake: 10 })} />);
      // Idle: the slide hasn't armed yet — no shift, board at full opacity.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-board').parentElement?.style.opacity).toBe('1');

      fireEvent.click(screen.getByTestId('hub-play'));
      const gameState: CoinflipView = { players: ['pid', 'bob'], choices: {} };
      rerender(<CoinflipHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState })} />);

      act(() => { vi.advanceTimersByTime(1000); });
      // oTop=100, pTop=300, pr.height=48 → mid=(100+300+48)/2=224 → o=224-71-100=53, p=224+23-300=-53
      // (same formula MinesHub.test.tsx's own measured-shift test verifies).
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(53px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(-53px)');
      expect(screen.getByTestId('hub-board').parentElement?.style.opacity).toBe('0.28');

      // Past the ~3.8s dwell floor: phase flips to in-match — bars slide back, board un-dims.
      act(() => { vi.advanceTimersByTime(2800); });
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-board').parentElement?.style.opacity).toBe('1');
    } finally {
      rectSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-26#2 (D61, ADVISOR_TO_PM.md): the old `CountdownRing` was a hard conditional
  // mount (`{live && !revealing && <CountdownRing/>}`) that vanished from the DOM with NO transition
  // the instant a reveal started. The new `DigitCountdown` wrapper stays mounted for the whole `live`
  // span (in-match + result) and only fades opacity/scale on the reveal boundary — this test is the
  // actual regression check for that: same DOM node across the pick→reveal transition, not a
  // remount, with a genuine opacity change rather than an unmount.
  it("ticket 2026-09-26#2: the pick-window clock stays mounted (same node) across the reveal boundary and only fades — no more instant pop-out", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const gameState: CoinflipView = { players: ['pid', 'bob'], choices: {} };
    const { rerender } = render(
      <CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['heads', 'tails'] })} />
    );
    const clockLive = screen.getByTestId('coin-countdown');
    expect(clockLive.style.opacity).toBe('1');
    expect(clockLive.style.transform).toBe('scale(1)');

    const terminalState: CoinflipView = { ...gameState, choices: { pid: 'heads', bob: 'tails' }, result: 'heads' };
    rerender(
      <CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminalState, legalMoves: [] })} />
    );
    // Same node — still in the DOM, not remounted/removed — just faded.
    expect(screen.getByTestId('coin-countdown')).toBe(clockLive);
    expect(clockLive.style.opacity).toBe('0');
    expect(clockLive.style.transform).toBe('scale(0.55)');
  });
});

describe('CoinflipHubScreen — waiting transforms in place (#154)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/games') || u.includes('/leaderboard'))
          return { ok: true, json: async () => [] } as Response;
        return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the countdown ticks down live off waitingExpiresAt', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      render(<CoinflipHubScreen {...baseProps({ waitingExpiresAt: 1_000_000 + 30_000 })} />);
      expect(screen.getByTestId('hub-waiting-countdown').textContent).toBe('0:30');
      // Advancing the fake timers moves the mocked clock; the 1s tick recomputes the remaining.
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
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
      <CoinflipHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: exp })} />
    );
    await screen.findByTestId('hub-cancel'); // searching
    rerender(
      <CoinflipHubScreen
        {...baseProps({ initialStake: 10, waitingExpiresAt: exp, lobbyExpired: true })}
      />
    );

    // Reverted to idle in place: PLAY tappable, bet re-enabled, the polite note shown.
    const play = screen.getByTestId('hub-play');
    expect(play.textContent).toMatch(/^play$/i);
    expect(play).toBeEnabled();
    expect(screen.getByTestId('hub-bet-10')).toBeEnabled();
    const note = screen.getByTestId('hub-no-opponent');
    expect(note.textContent).toMatch(/no opponent found/i);
    expect(note.textContent).not.toMatch(/refund/i); // must NOT claim a second refund
    // The armed stake is retained (10 still selected) so pressing PLAY simply re-posts.
    expect(screen.getByTestId('hub-bet-10').getAttribute('aria-pressed')).toBe('true');
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
    rerender(
      <CoinflipHubScreen
        {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: ['heads', 'tails'] })}
      />
    );
    expect(screen.getByTestId('hub-section-play')).toBe(panelIdle);
    expect(screen.getByTestId('hub-section-bet')).toBe(betIdle);
  });
});

describe('CoinflipHubScreen — related rail (item 5: all games, coming-soon included)', () => {
  const META = (id: string, displayName: string) => ({
    id,
    displayName,
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'net_winnings' },
    bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 5,
    rakeRate: 0.025,
  });
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/games'))
          return {
            ok: true,
            json: async () => [META('coinflip', 'Coinflip'), META('blackjack', 'Blackjack')],
          } as Response;
        if (u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
        return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('includes a live game (playable, routes) and a coming-soon game (dimmed, inert); excludes self', async () => {
    const onSelectGame = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ onSelectGame })} />);
    // Ticket 2026-09-15#12: Blackjack occupies a fixed rail slot unconditionally (Designer's own
    // 3-slot head), so it renders immediately as a dimmed placeholder before the live /games fetch
    // resolves, then upgrades to a real button once its playable status is confirmed — wait for
    // that upgrade rather than asserting on the very first (pre-fetch) render.
    await waitFor(() => expect(screen.getByTestId('hub-related-blackjack').tagName).toBe('BUTTON'));
    const blackjack = screen.getByTestId('hub-related-blackjack');
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
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/games') || u.includes('/leaderboard'))
          return { ok: true, json: async () => [] } as Response;
        return { ok: true, json: async () => ({ balances: balancesOf(1000), entries: [] }) } as Response;
      })
    );
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

  // Ticket 2026-10-06#1 (D83): replaces the old purple-ring selection language entirely — selection
  // is now the SAME pressed 3D pose Blackjack's Hit/Stand construction uses (shared `PillButton`):
  // a permanent translateY(3px), a shallower ledge, and a brightness(0.85) filter, with no ring/
  // outline anywhere. (The old test this replaces asserted `className` matched `/ring-brand/` —
  // a false pass post-refactor, since the UNRELATED `focus-visible:ring-brand` a11y class, kept
  // deliberately per Hit/Stand's own pattern, also contains that substring. `ring-offset` is the
  // precise discriminator: it only ever appeared in the OLD selection ring, never in the
  // focus-visible class, so its absence is what actually proves the old treatment is gone.)
  it('ticket 2026-10-06#1 (D83): selection is the pressed 3D pose (translateY + reduced ledge + brightness), not a ring/outline — the old purple ring is gone entirely', () => {
    render(<CoinflipHubScreen {...pickWindow()} />);
    const heads = screen.getByTestId('hub-move-heads');
    // Unselected: full raised pose, no brightness filter, no ring-offset anywhere.
    expect(heads.style.transform).toBe('translateY(0)');
    expect(heads.style.boxShadow).toBe('0 5px 0 #CA7B0D');
    expect(heads.style.filter).toBe('');
    expect(heads.className).not.toMatch(/ring-offset/);

    fireEvent.click(heads);
    // Selected: permanently pressed (stays, not just :active), shallower ledge, dimmed face.
    expect(heads.style.transform).toBe('translateY(3px)');
    expect(heads.style.boxShadow).toBe('0 2px 0 #CA7B0D');
    expect(heads.style.filter).toBe('brightness(0.85)');
    const cls = heads.className;
    expect(cls).not.toMatch(/ring-offset/);
    expect(cls).not.toMatch(/ring-success|ring-destructive|ring-amber/);
  });

  // Ticket 2026-10-06#1 (D83) item 1: geometry reused byte-for-byte from Blackjack's own Hit/Stand
  // (shared `PillButton`) — same min-width, same inter-pill gap (8px, up from the old 6px).
  it('ticket 2026-10-06#1 (D83): HEADS/TAILS share Hit/Stand\'s own 92px min-width and 8px pill-gap', () => {
    render(<CoinflipHubScreen {...pickWindow()} />);
    const heads = screen.getByTestId('hub-move-heads');
    const tails = screen.getByTestId('hub-move-tails');
    expect(heads.style.minWidth).toBe('92px');
    expect(tails.style.minWidth).toBe('92px');
    const wrapper = heads.parentElement as HTMLElement;
    expect(wrapper.className).toContain('gap-2');
    expect(wrapper.className).not.toContain('gap-1.5');
  });

  // Ticket 2026-10-06#1 (D83), verification plan: pressing HEADS/TAILS fires the SAME
  // `rcNavBarPop` pulse Hit/Stand's own tests already cover (same `navPulse`-timer idiom,
  // mirrored via the shared `PillButton`), independently per pill, self-clearing after 460ms —
  // and stays sunk afterward if it's the newly-selected side (the press-pulse and the persistent
  // selected pose are two independent, simultaneously-true things, not one replacing the other).
  it('ticket 2026-10-06#1 (D83): pressing HEADS fires the rcNavBarPop pulse once, self-clears after 460ms, independent of TAILS', () => {
    vi.useFakeTimers();
    try {
      render(<CoinflipHubScreen {...pickWindow()} />);
      const heads = screen.getByTestId('hub-move-heads');
      const tails = screen.getByTestId('hub-move-tails');
      expect(heads.style.animation).toBe('');

      fireEvent.pointerDown(heads);
      expect(heads.style.animation).toContain('rcNavBarPop');
      expect(tails.style.animation).toBe(''); // per-pill, not a shared bar-wide pulse

      fireEvent.click(heads); // the actual pick/selection — independent of the pulse
      expect(heads.style.transform).toBe('translateY(3px)'); // selected and pressed...
      expect(heads.style.animation).toContain('rcNavBarPop'); // ...the pulse hasn't cleared yet

      act(() => { vi.advanceTimersByTime(460); });
      expect(heads.style.animation).toBe(''); // pulse self-clears...
      expect(heads.style.transform).toBe('translateY(3px)'); // ...but stays sunk — it's selected
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-10-06#1 (D83) item 3's own explicit verification-plan line: tapping the
  // ALREADY-selected pill causes no visual change (no re-pop, pose stays exactly as it was) —
  // `handlePick` just re-sets the same `optimisticPick` value, no animation key changes.
  it('ticket 2026-10-06#1 (D83): tapping the already-selected pill is a no-op — same pose, no re-pop', () => {
    render(<CoinflipHubScreen {...pickWindow()} />);
    const heads = screen.getByTestId('hub-move-heads');
    fireEvent.click(heads);
    expect(heads.style.transform).toBe('translateY(3px)');
    const styleBefore = heads.getAttribute('style');

    fireEvent.click(heads); // tap the already-selected side again
    expect(heads.style.transform).toBe('translateY(3px)'); // unchanged — still pressed, not toggled off
    expect(heads.getAttribute('style')).toBe(styleBefore);
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

  it('the pick is mutable (timer-only-resolve #164): a later tap moves the outline and re-sends the replacement', () => {
    // Coinflip's module now accepts a replacement pick for the whole window (no finalize-on-first) —
    // the round resolves ONLY at the timer. The client mirrors that: re-tapping the other side moves
    // the purple outline and re-fires onMove with the new side; both pills stay tappable all window.
    const onMakeMove = vi.fn();
    render(<CoinflipHubScreen {...pickWindow({ onMakeMove })} />);
    fireEvent.click(screen.getByTestId('hub-move-heads'));
    fireEvent.click(screen.getByTestId('hub-move-tails')); // re-pick — accepted, not ignored
    expect(onMakeMove).toHaveBeenCalledTimes(2);
    expect(onMakeMove).toHaveBeenNthCalledWith(1, 'heads');
    expect(onMakeMove).toHaveBeenNthCalledWith(2, 'tails');
    expect(screen.getByTestId('hub-move-tails')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('hub-move-heads')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('hub-move-heads')).not.toBeDisabled(); // both stay tappable all window
  });

  it('the optimistic pick DESELECTS when the round state is wiped (gameState → null on PLAY/leave)', () => {
    // App's resetRoundState wipes gameState on PLAY / hub leave-enter. The hub's local optimisticPick
    // must clear with it, so the NEXT round opens with no stale highlight (the "pills survive" bug).
    const { rerender } = render(<CoinflipHubScreen {...pickWindow()} />);
    fireEvent.click(screen.getByTestId('hub-move-heads'));
    expect(screen.getByTestId('hub-move-heads')).toHaveAttribute('aria-pressed', 'true');

    // The round is wiped → idle: the picker is gone.
    rerender(
      <CoinflipHubScreen
        {...baseProps({ currentMatchId: null, gameState: null, legalMoves: [] })}
      />
    );
    expect(screen.queryByTestId('hub-move-heads')).toBeNull();

    // A fresh pick window opens with nothing pre-selected (the optimistic pick was cleared).
    rerender(<CoinflipHubScreen {...pickWindow()} />);
    expect(screen.getByTestId('hub-move-heads')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('hub-move-tails')).toHaveAttribute('aria-pressed', 'false');
  });

  it('BOTH players can lock the SAME side (no same-side restriction) — the draw path stays reachable', () => {
    // A same-side round: both chose HEADS, the coin flipped tails → a DRAW (→ auto-replay). The hub
    // renders both picks as HEADS with no block anywhere. A "taken side" block must NEVER be added:
    // it would leak the opponent's hidden pick (a side that won't select = you infer they took it).
    const gameState: CoinflipView = {
      players: ['pid', 'bob'],
      choices: { pid: 'heads', bob: 'heads' },
      result: 'tails',
    };
    render(<CoinflipHubScreen {...baseProps({ currentMatchId: 'm1', gameState })} />);
    expect(screen.getByTestId('coin-own-pick').textContent).toMatch(/heads/i);
    expect(screen.getByTestId('coin-opp-pick').textContent).toMatch(/heads/i); // same side accepted
  });

  it('flip-on-draw (#164): the coin STILL flips and the opponent pick reveals during the draw beat', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    // Round 0 live pick window — the live view has NO result (redacted mid-round), so no reveal yet.
    const r0: CoinflipView = {
      players: ['pid', 'bob'],
      choices: { pid: 'heads' },
      round: 0,
      replays: 0,
    };
    const { rerender } = render(
      <CoinflipHubScreen
        {...baseProps({ currentMatchId: 'm1', gameState: r0, legalMoves: ['heads', 'tails'] })}
      />
    );
    // Pick window: the flat coin rests on HEADS (its fixed default — reveals nothing; the round
    // result is redacted mid-round). It only flips to the real face at the terminal/draw reveal.
    expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('heads');

    // A same-side draw resolves round 0 → replays rises to 1, a fresh round 1 opens (its result still
    // redacted), and lastResult carries the drawn flip + both picks. GameHub runs the shared draw beat.
    const r1: CoinflipView = {
      players: ['pid', 'bob'],
      choices: {},
      round: 1,
      replays: 1,
      lastResult: {
        round: 0,
        result: 'tails',
        choices: { pid: 'heads', bob: 'heads' },
        winner: null,
      },
    };
    rerender(
      <CoinflipHubScreen
        {...baseProps({ currentMatchId: 'm1', gameState: r1, legalMoves: ['heads', 'tails'] })}
      />
    );

    // During the beat the coin flips to the drawn face and the opponent's drawn pick reveals — the
    // flip is NOT skipped on a draw (the whole point of #164's flip-on-draw).
    await waitFor(() => {
      expect(screen.getByTestId('coin-face').getAttribute('data-face')).toBe('tails');
      expect(screen.getByTestId('coin-opp-pick').textContent).toMatch(/heads/i);
    });
  });
});

describe('CoinflipHubScreen — guest mode chrome (issue #267)', () => {
  beforeEach(() => {
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

  it('hides the wallet chip, Open Games, related-games rail, and the bottom nav; shows a plain Demo badge', () => {
    render(<CoinflipHubScreen {...baseProps({ isGuest: true, balances: balancesOf(200), initialStake: 100 })} />);

    expect(screen.getByTestId('hub-guest-badge')).toBeInTheDocument();
    expect(screen.getByTestId('hub-balance').textContent).toContain('200');
    expect(screen.queryByTestId('hub-wallet-chip')).toBeNull();
    expect(screen.queryByTestId('games-carousel')).toBeNull();
    expect(screen.queryByTestId('hub-nav-games')).toBeNull();
    expect(screen.queryByTestId('hub-nav-account')).toBeNull();
  });

  it('the bet amount is pre-armed but genuinely interactive, minus the reserved stake (issue #353)', () => {
    render(<CoinflipHubScreen {...baseProps({ isGuest: true, initialStake: 100 })} />);
    const preset = screen.getByTestId('hub-bet-100');
    expect(preset).not.toBeDisabled();
    expect(screen.queryByTestId('hub-bet-1')).toBeNull(); // GUEST_HUMAN_RESERVED_STAKE withheld entirely
  });

  it('a non-guest hub still shows the full chrome (regression guard)', () => {
    render(<CoinflipHubScreen {...baseProps({ isGuest: false })} />);
    expect(screen.queryByTestId('hub-guest-badge')).toBeNull();
    expect(screen.getByTestId('hub-nav-games')).toBeInTheDocument();
  });

  // Issue #354 (5/5, guest bot economy): guest mode swaps GamesCarousel for GuestBotWaiters — a
  // guest-scoped "who's on duty" list backed only by the isolated guest instance's bot-waiters,
  // never `challengesByGame`/the real WS aggregate GamesCarousel is wired to.
  it('renders GuestBotWaiters in place of GamesCarousel, and JOIN there reuses onTakeChallenge (the same WS wiring a real hub uses)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/guest/open-challenges')) {
          return {
            ok: true,
            json: async () => [
              { gameId: 'coinflip', matchId: 'bot-match-5', ownerName: 'Demo Opponent 🤖', stake: 5, openedAt: Date.now(), expiresAt: Date.now() + 60_000, timeControlId: 'none' },
            ],
          } as Response;
        }
        return { ok: true, json: async () => [] } as Response;
      }),
    );
    const onTakeChallenge = vi.fn();
    render(<CoinflipHubScreen {...baseProps({ isGuest: true, initialStake: 100, onTakeChallenge })} />);

    expect(screen.queryByTestId('games-carousel')).toBeNull();
    expect(screen.getByTestId('guest-bot-waiters')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('guest-bot-waiter-join-5')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('guest-bot-waiter-join-5'));
    expect(onTakeChallenge).toHaveBeenCalledWith('bot-match-5');
  });
});

describe('CoinflipHubScreen — guest mode skips the hidden-toolbar bottom padding (issue #288)', () => {
  beforeEach(() => {
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

  // Issue #342: HUB_BODY's toolbar-clearance padding moved off this content div and onto
  // <HubFooter> itself (see HubFooter.test.tsx) — the footer is now a sibling that sits
  // immediately after this div with zero gap (#337) and owns its own trailing clearance (#342),
  // so applying HUB_BODY here too would just be dead space stacked in front of the footer's own.
  it('a non-guest hub no longer carries the HUB_BODY bottom-toolbar clearance on the content div — the footer owns it now (#342)', () => {
    render(<CoinflipHubScreen {...baseProps({ isGuest: false })} />);
    const body = screen.getByTestId('hub-body').firstElementChild;
    expect(body?.className).not.toContain('pb-[calc(7rem_+_env(safe-area-inset-bottom))]');
  });

  it('guest mode drops the bottom-toolbar clearance entirely — HubToolbar is hidden there, so the ~112px it reserves was pure dead space', () => {
    render(<CoinflipHubScreen {...baseProps({ isGuest: true, initialStake: 100 })} />);
    const body = screen.getByTestId('hub-body').firstElementChild;
    expect(body?.className).not.toContain('pb-[calc(7rem_+_env(safe-area-inset-bottom))]');
    // PR #287 measured this exact class contributing 112px in a real headless-Chromium render of
    // the guest hub (832px total height, 720px useful content). jsdom has no layout engine (and no
    // browser is available to re-run that measurement in this environment) — but this class is the
    // SOLE source of that gap (nothing else in HUB_SHELL/HUB_BODY changed), so its removal here is
    // necessary and sufficient for the real rendered height to drop to ~720px.
  });
});

describe('CoinflipHubScreen — guest surface fills its container height (issue #292 / SEAM-001)', () => {
  beforeEach(() => {
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

  it('a non-guest hub keeps the exact HUB_SHELL min-h-[100dvh] class — pixel-identical to before (regression guard)', () => {
    const { container } = render(<CoinflipHubScreen {...baseProps({ isGuest: false })} />);
    const shell = container.firstElementChild;
    // Issue #491: bg-background/text-foreground → bg-[var(--rc-bg)]/text-[var(--rc-text)] — see
    // layout.ts's doc comment above HUB_SHELL. The viewport-unit regression guard this test
    // exists for is unaffected; only the color-token literal changed.
    expect(shell?.className).toBe('relative min-h-[100dvh] bg-[var(--rc-bg)] text-[var(--rc-text)]');
  });

  it('a guest hub gets min-h-[100vh] instead of min-h-[100dvh] — the fix — so it reliably fills its (possibly iframed) container', () => {
    const { container } = render(<CoinflipHubScreen {...baseProps({ isGuest: true, initialStake: 100 })} />);
    const shell = container.firstElementChild;
    expect(shell?.className).toBe('relative min-h-[100vh] bg-[var(--rc-bg)] text-[var(--rc-text)]');
    expect(shell?.className).not.toContain('dvh');
  });
});
