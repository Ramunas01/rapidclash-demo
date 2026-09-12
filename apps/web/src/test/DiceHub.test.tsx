// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { DiceHubScreen } from '../screens/DiceHub.js';
import type { DiceView } from '../App.js';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

// Web Audio is absent in jsdom — mock the sound module so we can assert the dice-roll/dice-win
// wiring (ticket 2026-09-12#3 item 1) without touching real AudioContext (same idea as
// ChessHub.test.tsx's equivalent mock for the move-thump sound).
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

type Props = Parameters<typeof DiceHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'me', username: 'me', opponentId: 'opp', balance: 1000, serverClockOffset: 0,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenRewards: vi.fn(), onOpenAffiliate: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
    ...over,
  };
}
const preRoll = (): DiceView => ({ players: ['me', 'opp'], seeds: {}, round: 0, replays: 0, revealed: {} });
const resolved = (): DiceView => ({
  players: ['me', 'opp'], seeds: { me: 1, opp: 2 }, round: 0, replays: 0, revealed: { me: true, opp: true },
  result: { rolls: { me: 5000, opp: 3000 }, round: 0 }, winner: 'me',
});

describe('DiceHubScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
    playMock.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: arming a bet enables PLAY (shared GameHub)', () => {
    const onPlay = vi.fn();
    render(<DiceHubScreen {...baseProps({ onPlay })} />);
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
    // Ticket 2026-09-12#3 item 1: the shared PLAY sound is generic to GameHub.tsx's ONE PlayPanel —
    // exercised here via Dice rather than duplicated per hub (per the ticket's own instruction).
    // It fires exactly once, only once a match is actually starting (a stake was armed).
    expect(playMock).toHaveBeenCalledWith('play');
    expect(playMock.mock.calls.filter((c) => c[0] === 'play')).toHaveLength(1);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<DiceHubScreen {...baseProps({ onPlay })} />);

    const play = screen.getByTestId('hub-play');
    expect(play).toBeEnabled(); // pressable with no stake armed (no longer a dead end)
    fireEvent.click(play);
    expect(onPlay).not.toHaveBeenCalled(); // guided to the bet panel, not started
    // The shared PLAY sound (GameHub.tsx's handlePlayPress) does NOT fire on the guideToBet()
    // early-return — only an actually-starting match plays it.
    expect(playMock).not.toHaveBeenCalledWith('play');
    expect(scrollSpy).toHaveBeenCalled(); // bet panel scrolled into view
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBe('true');
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/select a bet/i);

    fireEvent.click(screen.getByTestId('hub-bet-10')); // selecting a bet clears the frame + hint…
    expect(screen.getByTestId('hub-section-bet').getAttribute('data-needs-bet')).toBeNull();
    expect(screen.getByTestId('hub-bet-hint').textContent).toBe('');
    expect(onPlay).not.toHaveBeenCalled(); // …with NO auto-play
    expect(playMock).not.toHaveBeenCalledWith('play'); // still no sound — no match started
  });

  it('In-match: auto-commits the reveal (no decisions) and hides both rolls until resolved', () => {
    const onMakeMove = vi.fn();
    render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: preRoll(), legalMoves: ['reveal'], onMakeMove })} />);
    expect(onMakeMove).toHaveBeenCalledWith('reveal'); // auto-fired
    expect(screen.getByTestId('dice-status').textContent).toMatch(/rolling/i);
  });

  it('Resolved: reveals both rolls and the winner', () => {
    render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved() })} />);
    expect(screen.getByTestId('hub-board').textContent).toContain('50.00'); // my roll
    expect(screen.getByTestId('hub-board').textContent).toContain('30.00'); // opponent
    expect(screen.getByTestId('dice-status').textContent).toMatch(/you rolled higher/i);
  });

  it('T9: registered users see the Owner-approved $ skin in the bet panel too, not just the header wallet chip (GameHub.tsx PlayPanel, CHARTER.md #4)', () => {
    const { container } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved() })} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).toMatch(/\$/);
  });

  it('T9: guest mode keeps the play-money RcIcon bet display — no $ leaks into the game body', () => {
    const { container } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved(), isGuest: true })} />);
    const header = container.querySelector('header');
    const bodyText = (container.textContent ?? '').replace(header?.textContent ?? '', '');
    expect(bodyText).not.toMatch(/\$/);
  });

  // T5: the shared "VS" match-found overlay (GameHub.tsx, gated on `matchForming`). Dice keeps the
  // default 2400ms search-dwell floor (no `searchFloorMs` override), so an immediately-paired match
  // still holds `matchForming` open for that floor — the VS beat's real window.
  it('T5: the shared VS label fades in while matchForming holds, then fades back out once in-match', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<DiceHubScreen {...baseProps({ initialStake: 10 })} />);
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0'); // idle: hidden

      fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start

      // The server pairs the match immediately — rerender with a live match right away.
      rerender(<DiceHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState: preRoll(), legalMoves: ['reveal'] })} />);

      // Still inside the 2400ms dwell floor: phase holds at 'waiting' (matchForming true) — VS shows.
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('1');

      // Just past the floor: phase flips to in-match — VS fades back out.
      await act(async () => { await vi.advanceTimersByTimeAsync(1450); });
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0');
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-11#10 item 1: Dice (unlike RPS's flat ±123px) live-measures the real bar
  // positions via `getBoundingClientRect()` at the moment the slide first arms, reproducing the
  // prototype's own `startDice()` (`Full Spec.html:3396-3403`) exactly — never a hardcoded number.
  it('ticket 2026-09-11#10 item 1: measures the real bar positions live and slides the bars toward center while matchForming holds, then back to 0 once in-match', async () => {
    vi.useFakeTimers();
    const rect = (top: number, height: number): DOMRect =>
      ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-rc-gamewrap')) return rect(0, 0);
      if (this.hasAttribute('data-rc-oppbar')) return rect(80, 48);
      if (this.hasAttribute('data-rc-playerbar')) return rect(260, 48);
      return rect(0, 0);
    });
    try {
      const { rerender } = render(<DiceHubScreen {...baseProps({ initialStake: 10 })} />);
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');

      fireEvent.click(screen.getByTestId('hub-play'));
      rerender(<DiceHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState: preRoll(), legalMoves: ['reveal'] })} />);

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      // oTop=80, pTop=260, pr.height=48 → mid=(80+260+48)/2=194 (Full Spec.html:3403's own formula)
      // → o = mid-71-oTop = 194-71-80 = 43, p = mid+23-pTop = 194+23-260 = -43.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(43px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(-43px)');

      await act(async () => { await vi.advanceTimersByTimeAsync(1450); });
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
    } finally {
      rectSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  // Coordinator addendum (2026-09-12#3): the prototype's idle-state opacity for this panel
  // (`minesBoardOp`, `Full Spec.html:3756`) is `rpsMatching || mConverged ? 0.28 : 1` — plain idle
  // is full brightness, and the prototype's `isDice` idle block (`:531-604`) carries no copy at all.
  it('idle: full brightness (no dimmed opacity) and no idle caption — the prototype has neither', () => {
    render(<DiceHubScreen {...baseProps()} />);
    const board = screen.getByTestId('hub-board');
    expect(board.className).not.toMatch(/opacity-50/);
    expect(board.textContent).not.toMatch(/finding a rival/i);
    expect(board.textContent).not.toMatch(/place your bet/i);
  });

  // Coordinator addendum (2026-09-12#3): the prototype's `isDice` wrapper is ONE fixed-size div
  // (`height:266px`, `Full Spec.html:532-604`) spanning both idle and live states, not a `min-h`
  // floor that differs between them.
  it('idle and in-match boards share the prototype\'s fixed 266px box, not a min-h floor', () => {
    const { rerender } = render(<DiceHubScreen {...baseProps()} />);
    expect(screen.getByTestId('hub-board').className).toMatch(/h-\[266px\]/);
    expect(screen.getByTestId('hub-board').className).not.toMatch(/min-h/);

    rerender(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: preRoll(), legalMoves: ['reveal'] })} />);
    expect(screen.getByTestId('hub-board').className).toMatch(/h-\[266px\]/);
    expect(screen.getByTestId('hub-board').className).not.toMatch(/min-h/);
  });

  // Ticket 2026-09-12#3 item 3: `suppressResultOverlay` + `ownBarResult` replace the deleted
  // `DiceReveal` popup with the shared own-bar win-fill mechanism (mirrors CoinflipHub.test.tsx's /
  // MinesHub.test.tsx's equivalent tests).
  describe('ticket 2026-09-12#3 item 3: own-bar reveal (replaces the deleted DiceReveal popup)', () => {
    const winGameState = (): DiceView => ({
      players: ['me', 'opp'], seeds: { me: 1, opp: 2 }, round: 0, replays: 0, revealed: { me: true, opp: true },
      result: { rolls: { me: 5000, opp: 3000 }, round: 0 }, winner: 'me',
    });

    it('hub-result-dice popup never renders (dead code deleted) and hub-result-overlay never renders (suppressed)', async () => {
      const gameState = winGameState();
      const { rerender } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
      expect(screen.queryByTestId('hub-result-dice')).toBeNull();
      expect(screen.queryByTestId('hub-result-overlay')).toBeNull();

      rerender(
        <DiceHubScreen
          {...baseProps({
            currentMatchId: null,
            gameState,
            lastOutcome: { type: 'win', winner: 'me' },
            lastSettlement: { delta: 10, newBalance: 1010 },
          })}
        />,
      );
      expect(screen.queryByTestId('hub-result-dice')).toBeNull();
      expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
      // Real timers here (unlike the fake-timer test below): HOLD_MS=2200 + BAR_VERDICT_BEAT_MS=250
      // exceeds waitFor's default 1000ms window, so raise it — same idiom as CoinflipHub.test.tsx's
      // equivalent real-timer reveal test.
      await waitFor(() => expect(screen.getByTestId('hub-slot-own-verdict')).toBeInTheDocument(), { timeout: 3000 });
      expect(screen.queryByTestId('hub-result-dice')).toBeNull();
      expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    });

    it('own-bar win-fill mechanism fires on the own bar only — opponent bar never gets a win/lose ring', async () => {
      vi.useFakeTimers();
      try {
        const gameState = winGameState();
        const { rerender } = render(
          <DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />,
        );
        rerender(
          <DiceHubScreen
            {...baseProps({
              currentMatchId: null,
              gameState,
              lastOutcome: { type: 'win', winner: 'me' },
              lastSettlement: { delta: 10, newBalance: 1010 },
            })}
          />,
        );

        // HOLD_MS=2200 (this file's DiceHub.tsx constant) → result phase, then the fixed
        // BAR_VERDICT_BEAT_MS=250 (GameHub.tsx) → the own-bar verdict lights.
        await act(async () => { await vi.advanceTimersByTimeAsync(2200 + 50); });
        await act(async () => { await vi.advanceTimersByTimeAsync(250 + 50); });

        const ownBar = screen.getByTestId('hub-slot-own');
        const oppBar = screen.getByTestId('hub-slot-opponent');
        expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you win/i);
        expect(ownBar.querySelector('.bg-success')).not.toBeNull(); // green fill = a background layer
        expect(ownBar.className).not.toContain('ring-success'); // not yet settled to the outline
        // Own-bar only (matches Mines' equivalent regression guard) — the opponent's pill never
        // gets any win/lose treatment.
        expect(oppBar.querySelector('.bg-success')).toBeNull();
        expect(oppBar.className).not.toContain('ring-success');

        // 0.5s fill-in + 2s hold + 0.5s fade-out = 3s → settles to the persistent green outline.
        await act(async () => { await vi.advanceTimersByTimeAsync(3000 + 50); });
        expect(ownBar.className).toContain('ring-success');
        expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull(); // "You Win" left with the fill
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // Ticket 2026-09-12#3 item 1: dice-roll/dice-win sound wiring in the existing resolved-match
  // effect (deduped via `lastSigRef`, keyed on a round+rolls signature).
  describe('ticket 2026-09-12#3 item 1: dice-roll/dice-win sound', () => {
    const winRoll = (): DiceView => ({
      players: ['me', 'opp'], seeds: { me: 1, opp: 2 }, round: 0, replays: 0, revealed: { me: true, opp: true },
      result: { rolls: { me: 5000, opp: 3000 }, round: 0 }, winner: 'me',
    });
    const loseRoll = (): DiceView => ({
      players: ['me', 'opp'], seeds: { me: 1, opp: 2 }, round: 0, replays: 0, revealed: { me: true, opp: true },
      result: { rolls: { me: 2000, opp: 3000 }, round: 0 }, winner: 'opp',
    });

    it('play("dice-roll") fires exactly once per newly-resolved match, not on an unrelated re-render of the same result', () => {
      const gameState = winRoll();
      const { rerender } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
      expect(playMock.mock.calls.filter((c) => c[0] === 'dice-roll')).toHaveLength(1);

      // Re-render with the SAME resolved state (e.g. an unrelated prop change) — deduped, no re-fire.
      rerender(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [], balance: 999 })} />);
      expect(playMock.mock.calls.filter((c) => c[0] === 'dice-roll')).toHaveLength(1);
    });

    it('play("dice-win") fires only on an actual win, never on a loss — the prototype has no loss sound', () => {
      const { rerender } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: loseRoll(), legalMoves: [] })} />);
      expect(playMock.mock.calls.some((c) => c[0] === 'dice-roll')).toBe(true); // roll sound still fires
      expect(playMock.mock.calls.some((c) => c[0] === 'dice-win')).toBe(false); // no win sound on a loss

      playMock.mockClear();
      rerender(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: winRoll(), legalMoves: [] })} />);
      expect(playMock.mock.calls.some((c) => c[0] === 'dice-win')).toBe(true);
    });
  });
});
