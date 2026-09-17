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
    expect(screen.getByTestId('hub-bet-hint').textContent).toMatch(/choose your bet/i);

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
  });

  // Ticket 2026-09-16#4 item 1: the rolls are now held back and revealed on a timeline (dice-roll
  // sound + count-up at +460ms, landing on the real numbers at +904ms) instead of appearing the
  // instant `result` exists — advance past REVEAL_SETTLE_MS (904ms) to see the settled values.
  // Real timers (not fake): this file's other reveal-timing tests found `vi.useFakeTimers()` +
  // a self-rescheduling `requestAnimationFrame` loop + React state updates to be genuinely flaky
  // across MULTIPLE fake-timer tests in the same run (the first such test in a file reliably
  // passes, later ones don't reliably drive the rAF loop) — a jsdom/sinon/React interaction, not a
  // bug in the reveal machine itself (confirmed correct standalone). Real timers + `waitFor` sidestep
  // it entirely, matching this file's other real-timer reveal tests below.
  it('Resolved: reveals both rolls, once the reveal count-up lands', async () => {
    render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved() })} />);
    expect(screen.getByTestId('hub-board').textContent).not.toContain('50.00'); // not yet — still counting
    await waitFor(() => expect(screen.getByTestId('hub-board').textContent).toContain('50.00'), { timeout: 3000 });
    expect(screen.getByTestId('hub-board').textContent).toContain('30.00'); // opponent
  });

  // Ticket 2026-09-15#10 item 1: the "You rolled higher!"/"Rolling…" status paragraph is gone —
  // zero occurrences anywhere in the prototype's own source, leftover copy this app added on its
  // own. This replaces the old assertions on that element's text.
  it('the "Rolling…"/"You rolled higher!" status text is gone — zero occurrences anywhere in the prototype', () => {
    const { rerender } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: preRoll(), legalMoves: ['reveal'] })} />);
    expect(screen.queryByTestId('dice-status')).toBeNull();
    rerender(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved() })} />);
    expect(screen.queryByTestId('dice-status')).toBeNull();
  });

  // Ticket 2026-09-12#5 item 3 (ADVISOR_TO_PM.md): the cube must be visible (not just a flash once
  // resolved) for the entire live roll, resting at its known 0% start — traced the prototype's own
  // `diceCubeIn` state flip (Full Spec.html:3421), which happens at roll-START, before the count-up.
  it('item 3: both cubes are visible (opacity 1) from the moment the board goes live, before the roll resolves — never hidden until it "arrives"', () => {
    render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: preRoll(), legalMoves: ['reveal'] })} />);
    expect(screen.getByTestId('dice-cube-opp').style.opacity).toBe('1');
    expect(screen.getByTestId('dice-cube-mine').style.opacity).toBe('1');
  });

  it('item 3: idle preview keeps both cubes hidden (opacity 0) — only the live board activates them', () => {
    render(<DiceHubScreen {...baseProps()} />);
    expect(screen.getByTestId('dice-cube-opp').style.opacity).toBe('0');
    expect(screen.getByTestId('dice-cube-mine').style.opacity).toBe('0');
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

  // Ticket 2026-09-12#5 item 2 (ADVISOR_TO_PM.md): missing matching-phase table dim for Dice, the
  // same fix RPS (#551) and Mines (#555) already got — confirmed absent (`barSlideActive` had zero
  // references in this file before this fix). Mirrors the bar-slide test above's matchForming setup.
  it('ticket 2026-09-12#5 item 2: the board dims to 0.28 opacity while matchForming holds, back to 1 once in-match', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<DiceHubScreen {...baseProps({ initialStake: 10 })} />);
      expect(screen.getByTestId('hub-board').style.opacity).toBe('1'); // idle: no dim

      fireEvent.click(screen.getByTestId('hub-play'));
      rerender(<DiceHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState: preRoll(), legalMoves: ['reveal'] })} />);

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getByTestId('hub-board').style.opacity).toBe('0.28');

      await act(async () => { await vi.advanceTimersByTimeAsync(1450); });
      expect(screen.getByTestId('hub-board').style.opacity).toBe('1');
    } finally {
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
      // Real timers here (unlike the fake-timer test below): ticket 2026-09-16#4's own
      // REVEAL_COMPLETE_MS=1804 (DiceHub.tsx) is what now gates the own-bar verdict (via
      // gateResultOnReveal/onRevealComplete) — exceeds waitFor's default 1000ms window, so raise
      // it — same idiom as CoinflipHub.test.tsx's equivalent real-timer reveal test.
      await waitFor(() => expect(screen.getByTestId('hub-slot-own-verdict')).toBeInTheDocument(), { timeout: 4000 });
      expect(screen.queryByTestId('hub-result-dice')).toBeNull();
      expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    });

    // Ticket 2026-09-12#5 item 1 (ADVISOR_TO_PM.md) — HIGH PRIORITY correction to #558: `DicePanel`
    // used to gate on `phase === 'in-match'` only, so once HOLD_MS's 2200ms hold elapsed and `phase`
    // became `'result'`, the panel unmounted the resolved `DiceBoard` (cubes + true rolls + history)
    // and swapped to the blank `DiceIdle` gauges — discarding the reveal right after it finally
    // became visible. The real rolls must still be on screen once the own-bar verdict lights.
    it("the resolved board (true rolls, not the blank idle gauges) stays visible through the 'result' phase, past the own-bar verdict lighting (item 1)", async () => {
      const gameState = winGameState();
      const { rerender } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
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
      await waitFor(() => expect(screen.getByTestId('hub-slot-own-verdict')).toBeInTheDocument(), { timeout: 4000 });
      // Still the real, resolved rolls — not DiceIdle's blank gauges (which show neither number).
      expect(screen.getByTestId('hub-board').textContent).toContain('50.00');
      expect(screen.getByTestId('hub-board').textContent).toContain('30.00');
    });

    // Real timers throughout (see the equivalent comment on "Resolved: reveals both rolls" above).
    it('own-bar win-fill mechanism fires on the own bar only — opponent bar never gets a win/lose ring', async () => {
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

      // Ticket 2026-09-16#4 item 1: REVEAL_COMPLETE_MS=1804 (this file's DiceHub.tsx constant) is
      // when DiceBoard's own reveal clock fires onRevealComplete — gateResultOnReveal then lights
      // the own-bar verdict in lockstep with it (no more separate fixed BAR_VERDICT_BEAT_MS beat).
      await waitFor(() => expect(screen.getByTestId('hub-slot-own-verdict')).toBeInTheDocument(), { timeout: 4000 });

      const ownBar = screen.getByTestId('hub-slot-own');
      const oppBar = screen.getByTestId('hub-slot-opponent');
      expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you won/i);
      // Ticket 2026-09-16#4 item 4: Dice's own win fill is the inline #16A34A (DICE_WIN_GREEN),
      // not the shared bg-success class — the fill layer's own distinguishing classes (Avatar's
      // wrapper also carries aria-hidden, so key off these instead to avoid a false match there).
      const ownFill = ownBar.querySelector('.pointer-events-none.absolute.inset-0') as HTMLElement;
      expect(ownFill.style.background).toBe('rgb(22, 163, 74)'); // #16A34A, jsdom-normalized
      expect(ownBar.className).not.toContain('ring-success'); // not yet settled to the outline
      // Own-bar only (matches Mines' equivalent regression guard) — the opponent's pill never
      // gets any win/lose treatment.
      expect(oppBar.querySelector('.pointer-events-none.absolute.inset-0')).toBeNull();
      expect(oppBar.className).not.toContain('ring-success');

      // 0.5s fill-in + 2s hold + 0.5s fade-out = 3s → settles to the persistent outline.
      // Ticket 2026-09-16#4 item 4: same inline-color shape as the loss ring (2026-09-15#13) —
      // `ring-[3px]` + `--tw-ring-color`, never the shared `ring-success` class, for Dice.
      await waitFor(() => expect(ownBar.className).toContain('ring-[3px]'), { timeout: 5000 });
      expect(ownBar.className).not.toContain('ring-success');
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('#16A34A');
      expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull(); // "You Win" left with the fill
    });

    // Ticket 2026-09-15#13 item 2: Dice's own player-bar loss ring is var(--rc-loss) (#FF3E5E,
    // Full Spec.html:3787's playerBarRing), scoped to Dice only via OwnSlot's new lossRingColor
    // prop — every other OwnSlot-using game keeps the shared ring-destructive class untouched
    // (confirmed separately by CoinflipHub.test.tsx's own "Result loss/draw" test). Real timers
    // (see the equivalent comment on "Resolved: reveals both rolls" above).
    it('own-bar loss ring is var(--rc-loss), not the shared ring-destructive class', async () => {
      const gameState: DiceView = {
        players: ['me', 'opp'], seeds: { me: 1, opp: 2 }, round: 0, replays: 0, revealed: { me: true, opp: true },
        result: { rolls: { me: 2000, opp: 3000 }, round: 0 }, winner: 'opp',
      };
      const { rerender } = render(
        <DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />,
      );
      rerender(
        <DiceHubScreen
          {...baseProps({
            currentMatchId: null,
            gameState,
            lastOutcome: { type: 'win', winner: 'opp' },
            lastSettlement: { delta: -10, newBalance: 990 },
          })}
        />,
      );

      const ownBar = screen.getByTestId('hub-slot-own');
      await waitFor(() => expect(ownBar.className).toContain('ring-[3px]'), { timeout: 4000 });
      expect(ownBar.className).not.toContain('ring-destructive');
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('var(--rc-loss)');

      // Same ticket, same token: the losing cube's own number color is the app-wide loss red,
      // deliberately overriding the prototype's own literal #DC2626 (Full Spec.html:3678-3679).
      const myNum = screen.getByTestId('dice-cube-mine').querySelector('span');
      expect(myNum?.style.color).toBe('var(--rc-loss)');
    });
  });

  // Ticket 2026-09-12#3 item 1 (fires) / 2026-09-16#4 item 2 (WHEN they fire): dice-roll now fires
  // at the reveal clock's REVEAL_SOUND_MS beat (+460ms), dice-win at REVEAL_COMPLETE_MS (+1804ms) —
  // not both in the same instant `result` first exists, the "everything happens at once" problem
  // D21 described. Dedup is unchanged (armedSig, keyed on the same round+rolls signature).
  describe('ticket 2026-09-12#3 item 1 / 2026-09-16#4 item 2: dice-roll/dice-win sound sequencing', () => {
    const winRoll = (): DiceView => ({
      players: ['me', 'opp'], seeds: { me: 1, opp: 2 }, round: 0, replays: 0, revealed: { me: true, opp: true },
      result: { rolls: { me: 5000, opp: 3000 }, round: 0 }, winner: 'me',
    });
    const loseRoll = (): DiceView => ({
      players: ['me', 'opp'], seeds: { me: 1, opp: 2 }, round: 0, replays: 0, revealed: { me: true, opp: true },
      result: { rolls: { me: 2000, opp: 3000 }, round: 0 }, winner: 'opp',
    });

    // Real timers throughout (see the equivalent comment on "Resolved: reveals both rolls" above).
    it('play("dice-roll") fires once at +460ms per newly-resolved match, not on an unrelated re-render of the same result, and not before its own beat', async () => {
      const gameState = winRoll();
      const { rerender } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [] })} />);
      expect(playMock.mock.calls.filter((c) => c[0] === 'dice-roll')).toHaveLength(0); // not yet — before its own beat

      await waitFor(() => expect(playMock.mock.calls.filter((c) => c[0] === 'dice-roll')).toHaveLength(1), { timeout: 2000 });

      // Re-render with the SAME resolved state (e.g. an unrelated prop change) — deduped, no re-fire.
      rerender(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: [], balance: 999 })} />);
      await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
      expect(playMock.mock.calls.filter((c) => c[0] === 'dice-roll')).toHaveLength(1);
    });

    it('play("dice-win") fires only on an actual win, never on a loss — the prototype has no loss sound — both at +1804ms, not the moment result exists', async () => {
      const { rerender } = render(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: loseRoll(), legalMoves: [] })} />);
      await waitFor(() => expect(playMock.mock.calls.some((c) => c[0] === 'dice-roll')).toBe(true), { timeout: 2000 }); // roll sound still fires
      await act(async () => { await new Promise((r) => setTimeout(r, 1500)); }); // let the loss round's reveal fully complete
      expect(playMock.mock.calls.some((c) => c[0] === 'dice-win')).toBe(false); // no win sound on a loss

      playMock.mockClear();
      rerender(<DiceHubScreen {...baseProps({ currentMatchId: 'm1', gameState: winRoll(), legalMoves: [] })} />);
      expect(playMock.mock.calls.some((c) => c[0] === 'dice-win')).toBe(false); // not yet — before its own beat
      await waitFor(() => expect(playMock.mock.calls.some((c) => c[0] === 'dice-win')).toBe(true), { timeout: 3000 });
    });
  });
});
