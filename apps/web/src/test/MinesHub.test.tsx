// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MinesHubScreen } from '../screens/MinesHub.js';
import type { MinesView, MinesBoardView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof MinesHubScreen>[0];

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

const allCovered = Array.from({ length: 25 }, (_, i) => i);
const kind = (i: number) => screen.getByTestId(`cell-${i}`).getAttribute('data-kind');

function view(me: Partial<MinesBoardView>, opp: Partial<MinesBoardView> = {}, extra: Partial<MinesView> = {}): MinesView {
  return {
    players: ['alice', 'bob'],
    round: 0,
    draws: 0,
    boards: { alice: { locked: false, ...me }, bob: { locked: false, ...opp } },
    ...extra,
  };
}

// In-match the App feeds the hub the mines square indices as legalMoves (typed string[] at the
// generic slot boundary, number-valued at runtime for Mines) — mirror that here.
const asLegal = (idxs: number[]) => idxs as unknown as string[];

describe('MinesHubScreen (GameHub + MinesPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  // Ticket 2026-09-12#2 item 1 (ADVISOR_TO_PM.md): the redundant idle paragraph ("Waiting for an
  // opponent…" / "Choose a bet and press PLAY…") is gone — zero prototype equivalent, same removal
  // RpsHub.tsx got in #551. The shared PLAY-button label already covers the waiting case.
  it('Idle: no idle paragraph copy in either idle sub-state (item 1)', () => {
    const { rerender } = render(<MinesHubScreen {...baseProps()} />);
    expect(screen.queryByText(/waiting for an opponent…/i)).toBeNull();
    expect(screen.queryByText(/choose a bet and press play/i)).toBeNull();

    rerender(<MinesHubScreen {...baseProps({ waitingExpiresAt: Date.now() + 10_000 })} />);
    expect(screen.queryByText(/waiting for an opponent…/i)).toBeNull();
    expect(screen.queryByText(/choose a bet and press play/i)).toBeNull();
  });

  // Ticket 2026-09-12#2 item 2 (ADVISOR_TO_PM.md): the panel wrapper now dims to 28% opacity while
  // `barSlideActive` (searching/matchForming) — matches `minesBoardOp: rpsMatching || mConverged ?
  // 0.28 : 1` (`Full Spec.html:3756`) for its search-phase half; mirrors RpsHub.test.tsx's equivalent
  // #551 assertion via `hub-rps-panel`, here via this file's own `hub-mines-panel` testid.
  it('Panel dims to 0.28 opacity during pure searching (no match yet), matching RPS/Coinflip', () => {
    // Mirrors RpsHub.test.tsx's equivalent #551 assertion ("the bar-slide also arms during pure
    // searching") — `rpsMatching` covers both the searching and found sub-states.
    render(<MinesHubScreen {...baseProps({ initialStake: 10, waitingExpiresAt: Date.now() + 10_000 })} />);
    expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('0.28');
  });

  it('Panel dims to 0.28 opacity while matchForming holds, back to 1 once in-match (item 2)', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<MinesHubScreen {...baseProps({ initialStake: 10 })} />);
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('1'); // idle: no dim

      fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start (searchStartRef)

      // The server pairs the match immediately — rerender with a live match right away.
      rerender(<MinesHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState: view({ uncovered: [] }), legalMoves: asLegal(allCovered) })} />);

      // Still inside the 2400ms dwell floor: phase holds at 'waiting' (matchForming true) — dimmed.
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('0.28');

      // Just past the floor: phase flips to in-match — the panel un-dims (`barSlideActive` false).
      await act(async () => { await vi.advanceTimersByTimeAsync(1450); });
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Idle: arming a bet enables PLAY, which posts that stake (shared GameHub)', () => {
    const onPlay = vi.fn();
    render(<MinesHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeEnabled(); // #143: pressable even with no stake armed
    fireEvent.click(screen.getByTestId('hub-bet-25'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(25);
  });

  it('#143: PLAY with no bet armed guides to the bet panel (no match starts); arming clears the cue, no auto-play', () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const onPlay = vi.fn();
    render(<MinesHubScreen {...baseProps({ onPlay })} />);

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

  it('In-match: the 5×5 board activates, and clicks are gated to server legalMoves → onMove(index)', () => {
    const onMakeMove = vi.fn();
    // Server says only square 5 is covered+legal right now.
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [] }), legalMoves: asLegal([5]), onMakeMove })} />);
    expect(screen.getByTestId('mines-board')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(25);

    expect(screen.getByTestId('cell-5')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('cell-5'));
    expect(onMakeMove).toHaveBeenCalledWith(5);

    // A covered square NOT in legalMoves is disabled and never fires.
    onMakeMove.mockClear();
    expect(screen.getByTestId('cell-6')).toBeDisabled();
    fireEvent.click(screen.getByTestId('cell-6'));
    expect(onMakeMove).not.toHaveBeenCalled();
  });

  it('In-match: renders own safe / busted / mine cells once locked', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [0, 1], locked: true, bustedOn: 10, mines: [10, 20, 22] }), legalMoves: asLegal([]) })} />);
    expect(kind(0)).toBe('safe');
    expect(kind(10)).toBe('bustedOn'); // the detonated mine wins over plain 'mine'
    expect(kind(20)).toBe('mine');     // layout revealed once locked
    // Ticket 2026-09-16#6 item 2: an untouched, non-mine tile auto-reveals (ghosted) once locked —
    // it no longer stays 'covered' forever, matching the prototype's own `open = picked || busted`.
    expect(kind(2)).toBe('autoSafe');
  });

  // Ticket 2026-09-16#6 item 1: the bomb icon on the hit tile is position:absolute (matching its
  // halo sibling, which already was) — otherwise the halo, being positioned, paints ABOVE the
  // icon regardless of DOM order (a CSS stacking-context mechanic, not a DOM-order bug). The
  // non-hit exposed mine gets the same treatment too (harmless there, no halo sibling exists).
  it('item 1: the bomb icon is position:absolute on both the hit tile and other exposed mines', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [], locked: true, bustedOn: 10, mines: [10, 20] }), legalMoves: asLegal([]) })} />);
    // Ticket 2026-09-17#2 item 1: no wrapper divs at all now — the icon IS a motion.svg with
    // position:absolute directly on itself (a DIRECT child of the tile's flex container), relying
    // on CSS "static position" centering rather than an intermediate wrapper's own centering.
    const hitIcon = screen.getByTestId('cell-10').querySelectorAll('svg')[1] as unknown as SVGElement;
    expect(hitIcon.getAttribute('class')).toContain('absolute');
    const otherMineIcon = screen.getByTestId('cell-20').querySelector('svg') as unknown as SVGElement;
    expect(otherMineIcon.getAttribute('class')).toContain('absolute');
  });

  // Ticket 2026-09-17#1 item 1: GemIcon (the 'safe' and 'autoSafe' cases — the two branches that
  // never got the 2026-09-16#6 fix, since only the mine-hit branches had a halo sibling to prove
  // the bug against at the time) needs the identical position:absolute wrapper — a bare, normal-
  // flow flex item containing a percentage-width SVG stretches to the tile's full width in
  // Chromium, leaving nothing for justify-content:center to center, so the icon drifts off-center.
  it("item 1: the gem icon is position:absolute on both a tapped-open tile and a ghosted auto-revealed one", () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [0], locked: true, bustedOn: 10, mines: [10] }), legalMoves: asLegal([]) })} />);
    // 'safe' (cell 0): halo svg first, then the gem icon svg — both now direct absolute children.
    const safeIcon = screen.getByTestId('cell-0').querySelectorAll('svg')[1] as unknown as SVGElement;
    expect(safeIcon.getAttribute('class')).toContain('absolute');
    // 'autoSafe' (any untouched, non-mine tile once locked — e.g. cell 2): no halo, one svg.
    const autoSafeIcon = screen.getByTestId('cell-2').querySelector('svg') as unknown as SVGElement;
    expect(autoSafeIcon.getAttribute('class')).toContain('absolute');
  });

  // Ticket 2026-09-16#6 item 3: the hit tile's bomb halo + icon bounce (rcMineJump) — the other
  // exposed mines and every safe tile stay still (matches the prototype's own `hit`-only gating).
  it('item 3: the hit tile\'s bomb halo and icon carry the rcMineJump bounce; other exposed mines don\'t', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [], locked: true, bustedOn: 10, mines: [10, 20] }), legalMoves: asLegal([]) })} />);
    const hitCell = screen.getByTestId('cell-10');
    const [haloSvg, iconSvg] = hitCell.querySelectorAll('svg');
    // Ticket 2026-09-17#2 item 1: no wrapper divs — the animation is inline on the SVGs' own style now.
    expect((haloSvg as unknown as SVGElement).style.animation).toContain('rcMineJump');
    expect((iconSvg as unknown as SVGElement).style.animation).toContain('rcMineJump');
    const otherMineIcon = screen.getByTestId('cell-20').querySelector('svg') as unknown as SVGElement;
    expect(otherMineIcon.style.animation).toBeFalsy();
  });

  // Ticket 2026-09-16#5 item 1: the duplicate You/Opponent status row (and its own "N safe"/
  // "hidden" redaction display) is gone — the shared GameHub bars now cover this, and neither
  // player's safe-count is shown anywhere in Mines' own UI at all (matches the prototype's own
  // `isMines` block, which never displays a score as text either — confirmed, not just assumed).
  // What's still a real, independent regression guard: the opponent's own board is never rendered.
  it('Redaction: never renders an opponent board — only the player\'s own 25 cells exist in the DOM', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [1] }, { locked: false }), legalMoves: asLegal(allCovered) })} />);
    expect(screen.getAllByRole('gridcell')).toHaveLength(25);
  });

  // T8: the 30s round clock, driven by the server-authoritative `roundStartedAt` (not a
  // client-guessed/reset-on-render value).
  it('T8: the round clock counts down accurately from server-authoritative roundStartedAt', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    try {
      render(
        <MinesHubScreen
          {...baseProps({
            currentMatchId: 'm1',
            gameState: view({ uncovered: [] }, {}, { roundStartedAt: now }),
            legalMoves: asLegal(allCovered),
          })}
        />,
      );
      const clock = screen.getByTestId('mines-round-clock');
      expect(clock.textContent).toContain('30s'); // just started — full 30s

      await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
      expect(clock.textContent).toContain('18s'); // 30 - 12 = 18s left

      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(clock.textContent).toContain('0s'); // clamped at 0, never negative
    } finally {
      vi.useRealTimers();
    }
  });

  it('T8: the round clock keeps counting for a locked player (shared round cap, not a per-player window)', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    try {
      render(
        <MinesHubScreen
          {...baseProps({
            currentMatchId: 'm1',
            gameState: view({ uncovered: [0, 1], locked: true, bustedOn: 10 }, { locked: false }, { roundStartedAt: now }),
            legalMoves: asLegal([]),
          })}
        />,
      );
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(screen.getByTestId('mines-round-clock').textContent).toContain('25s');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Replay: an internal draw-replay re-deals — the board resets for the new round, no result overlay', () => {
    const { rerender } = render(
      <MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [0, 1, 2] }), legalMoves: asLegal([3, 4, 5]) })} />,
    );
    expect(kind(0)).toBe('safe');

    // Draw → replay within the SAME match (currentMatchId stays set): round bumps, board resets,
    // and crucially no result overlay is shown (the match keeps going).
    rerender(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [] }, {}, { round: 1 }), legalMoves: asLegal(allCovered) })} />);
    expect(kind(0)).toBe('covered'); // the previously-safe square is covered again
    expect(screen.getByTestId('cell-0')).not.toBeDisabled();
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
  });

  // Ticket 2026-09-12#2 item 3(b) (ADVISOR_TO_PM.md): `suppressResultOverlay` + `ownBarResult` are
  // now wired on Mines' `<GameHub>` call — the same reference pattern `CoinflipHub.tsx` uses. The
  // separate result pop-up (this test used to assert appeared) no longer renders at all; the win/
  // lose/draw reveal happens on the player's own bar instead (the shared frame-ring/win-fill
  // mechanism, already proven on Coinflip — see `CoinflipHub.test.tsx`'s equivalent tests for the
  // exact testids/assertions mirrored below).
  it('Result: no separate overlay — match.end reveals the outcome via the own-bar frame ring / win-fill (ownBarResult) instead', async () => {
    // Ticket 2026-09-17#1 item 2: both boards locked — a real, decisive (non-bust, non-cleared)
    // "timeout" lock reason for MY board specifically (uncovered.length=4, not SAFE_COUNT=22).
    const gameState = view({ uncovered: [0, 1, 2, 3], locked: true }, { locked: true });
    const { rerender } = render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />);
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();

    rerender(<MinesHubScreen {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'alice' }, lastSettlement: { delta: 18, newBalance: 1018 } })} />);
    // `suppressResultOverlay`: GameHub never renders the separate `ResultOverlay`, terminal or not.
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    // Ticket 2026-09-17#1 item 2: a "timeout" lock now goes through the same real sequence a bust
    // does (500ms reason delay + 820 + 700 = 2020ms), not the old instant/fixed-250ms-beat path —
    // real timers here, generous waitFor timeout (matches this file's own real-timer idiom).
    await waitFor(() => expect(screen.getByTestId('hub-slot-own-verdict')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you win/i);
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull(); // still absent after the reveal
  });

  // Ticket 2026-09-12#5 item 1 (ADVISOR_TO_PM.md) — HIGH PRIORITY correction to #555: `MinesPanel`
  // used to gate on `phase === 'in-match'` only, so the instant `phase` became `'result'` (Mines has
  // no `holdResultMs`, so this is immediate) the panel unmounted the resolved board and swapped to
  // the blank idle grid, discarding the busted-tile/cleared-board reveal before it was ever visible.
  it("Result: the resolved board (MinesBoard, not the blank idle grid) stays mounted and visible through the 'result' phase (item 1)", () => {
    const gameState = view({ uncovered: [0, 1, 2, 3], locked: true });
    const { rerender } = render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();

    rerender(<MinesHubScreen {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'alice' }, lastSettlement: { delta: 18, newBalance: 1018 } })} />);
    // No holdResultMs for Mines — phase jumps straight to 'result'. The real board must still be
    // the thing rendered, not MinesIdle's blank preview grid.
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
  });

  // Ticket 2026-09-16#5 item 1: the duplicate You/Opponent row, status line, explainer paragraph,
  // and Resign button are gone — zero equivalent anywhere in the prototype's own `isMines` block.
  // `onForfeit` itself is untouched (still generic shared infra for RPS/Chess/Blackjack's own real
  // Resign buttons) — only Mines' own now-orphaned button is gone, confirmed via the grep D22 asked
  // for turning up exactly one hit (the button's own text) before this fix.
  it("item 1: the duplicate status row/paragraph/Resign button are gone — the shared GameHub bars cover it instead", () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [0, 1] }), legalMoves: asLegal(allCovered) })} />);
    expect(screen.queryByTestId('play-you')).toBeNull();
    expect(screen.queryByTestId('opponent-count')).toBeNull();
    expect(screen.queryByTestId('my-status')).toBeNull();
    expect(screen.queryByTestId('round-indicator')).toBeNull();
    expect(screen.queryByRole('button', { name: /resign/i })).toBeNull();
    expect(screen.queryByText(/tap a tile/i)).toBeNull();
    // The shared bars still show the real names, unaffected by the deletion.
    expect(screen.getByTestId('hub-slot-own')).toBeInTheDocument();
    expect(screen.getByTestId('hub-slot-opponent')).toBeInTheDocument();
  });

  // Ticket 2026-09-16#5 item 4: the round clock collapses (max-height 46px→0, opacity 1→0) once the
  // result phase lands — it used to render unconditionally, staying visible through the whole
  // result-hold window. `Full Spec.html:3758-3759`'s own gating (`minesClockOp`/`minesClockH`)
  // confirms this is the prototype's real behavior, not a cosmetic nice-to-have.
  it('item 4: the round clock collapses once the result phase lands', async () => {
    const gameState = view({ uncovered: [0, 1, 2, 3], locked: true }, { locked: true });
    const { rerender } = render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />);
    const clockWrapper = screen.getByTestId('mines-round-clock').parentElement as HTMLElement;
    expect(clockWrapper.style.maxHeight).toBe('46px');
    expect(clockWrapper.style.opacity).toBe('1');

    rerender(<MinesHubScreen {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'alice' }, lastSettlement: { delta: 18, newBalance: 1018 } })} />);
    // Ticket 2026-09-17#1 item 2: see the equivalent comment on the "no separate overlay" test above.
    await waitFor(() => expect(clockWrapper.style.opacity).toBe('0'), { timeout: 4000 });
    expect(clockWrapper.style.maxHeight).toMatch(/^0(px)?$/); // React renders a 0 style value unitless
  });

  // Ticket 2026-09-16#5 item 5: the gem/mine icon's own reveal pop — previously appeared instantly
  // with zero transition; now mounts at opacity:0/scale:0.4 and animates to opacity:1/scale:1 (the
  // wrapping motion.div's own inline style, before Framer Motion's rAF-driven animation advances it).
  it('item 5: the gem/mine icon mounts as a reveal pop (opacity 0, scale 0.4), not an instant appear', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [0], bustedOn: 5, mines: [5] }, {}, {}), legalMoves: asLegal([]) })} />);
    // cell-0's SVGs, in DOM order: GemHalo's (unpopped, its own separate opacity-only fade), then
    // GemIcon's — a motion.svg now, so the reveal-pop inline style lives on the svg itself.
    const svgs = screen.getByTestId('cell-0').querySelectorAll('svg');
    const gemIcon = svgs[1] as unknown as SVGElement;
    expect(gemIcon.style.opacity).toBe('0');
    expect(gemIcon.style.transform).toContain('scale(0.4)');
  });

  it('Result win: shared 0.5/2/0.5 bar animation on the own bar only — keeps the username, "You Win" alongside, then settles to the green outline (mirrors CoinflipHub.test.tsx)', async () => {
    vi.useFakeTimers();
    try {
      // Ticket 2026-09-17#1 item 2: both boards locked — a real "timeout" lock reason for MY board
      // (uncovered.length=4, not SAFE_COUNT=22, no bustedOn).
      const gameState = view({ uncovered: [0, 1, 2, 3], locked: true }, { locked: true });
      const { rerender } = render(
        <MinesHubScreen {...baseProps({ username: 'alice', currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />,
      );
      rerender(
        <MinesHubScreen
          {...baseProps({
            username: 'alice',
            currentMatchId: null,
            gameState,
            lastOutcome: { type: 'win', winner: 'alice' },
            lastSettlement: { delta: 18, newBalance: 1018 },
          })}
        />,
      );

      // Ticket 2026-09-17#1 item 2: a "timeout" lock's full holdResultMs is 500 (reason delay) +
      // 820 + 700 = 2020ms, THEN the fixed BAR_VERDICT_BEAT_MS (250ms) gates the bar lighting on
      // top of that — two separate advances (not one combined number), same idiom this file's own
      // item 4 convergence test already uses, so React gets a chance to flush the intermediate
      // phase→'result' render before the second timer registers.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2020 + 50);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250 + 50);
      });
      const ownBar = screen.getByTestId('hub-slot-own');
      const oppBar = screen.getByTestId('hub-slot-opponent');
      expect(ownBar.textContent).toContain('alice'); // username stays put (not swapped out)
      expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you win/i);
      // Ticket 2026-09-16#7 item 4: Mines' own win fill is the inline #22C55E, not the shared
      // bg-success class — same shape as Dice's own winFillColor fix (2026-09-16#4).
      const ownFill = ownBar.querySelector('.pointer-events-none.absolute.inset-0') as HTMLElement;
      expect(ownFill.style.background).toBe('rgb(34, 197, 94)'); // #22C55E, jsdom-normalized
      expect(ownBar.className).not.toContain('ring-success'); // not yet settled to the outline
      // Ring is OWN-BAR ONLY (Full Spec.html:3786, `oppBarRing: 'none'` unconditionally) — the
      // opponent's pill never gets any win/lose/draw treatment.
      expect(oppBar.querySelector('.pointer-events-none.absolute.inset-0')).toBeNull();
      expect(oppBar.className).not.toContain('ring-success');

      // 0.5s fill-in + 2s hold + 0.5s fade-out = 3s → settles to the persistent outline.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000 + 50);
      });
      expect(ownBar.className).toContain('ring-[3px]');
      expect(ownBar.className).not.toContain('ring-success');
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('#22C55E');
      expect(screen.queryByTestId('hub-slot-own-verdict')).toBeNull(); // "You Win" left with the fill
    } finally {
      vi.useRealTimers();
    }
  });

  // T5: the shared "VS" match-found overlay (GameHub.tsx, gated on `matchForming` = phase 'waiting'
  // with a currentMatchId already assigned). Mines keeps the default 2400ms search-dwell floor
  // (RPS/Coinflip pass their own explicit ~3800ms floor as of ticket 2026-09-11#9, reversing #387's
  // `searchFloorMs={0}` — see RpsHub.test.tsx/CoinflipHub.test.tsx), so a match paired immediately
  // after PLAY still holds `matchForming` open for that floor — the VS beat's real window.
  it('T5: the shared VS label fades in while matchForming holds, then fades back out once in-match', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<MinesHubScreen {...baseProps({ initialStake: 10 })} />);
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0'); // idle: hidden

      fireEvent.click(screen.getByTestId('hub-play')); // arms the search dwell start (searchStartRef)

      // The server pairs the match immediately — rerender with a live match right away.
      rerender(<MinesHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState: view({ uncovered: [] }), legalMoves: asLegal(allCovered) })} />);

      // Still inside the 2400ms dwell floor: phase holds at 'waiting' (matchForming true) — VS shows.
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('1');
      expect(screen.queryByTestId('cell-0')).toBeNull(); // board itself still withheld (unchanged behavior)

      // Just past the floor: phase flips to in-match — VS fades back out, board mounts.
      await act(async () => { await vi.advanceTimersByTimeAsync(1450); });
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0');
      expect(screen.getByTestId('cell-0')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-11#10 item 1: Mines (unlike RPS's flat ±123px) live-measures the real bar
  // positions via `getBoundingClientRect()` at the moment the slide first arms, reproducing the
  // prototype's own `startMines()` (`Full Spec.html:3341-3348`) exactly — never a hardcoded number.
  it('ticket 2026-09-11#10 item 1: measures the real bar positions live and slides the bars toward center while matchForming holds, then back to 0 once in-match', async () => {
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
      const { rerender } = render(<MinesHubScreen {...baseProps({ initialStake: 10 })} />);
      // Idle: the slide hasn't armed yet — no shift, even though `matchBarSlide="measured"` is set.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');

      fireEvent.click(screen.getByTestId('hub-play'));
      rerender(<MinesHubScreen {...baseProps({ initialStake: 10, currentMatchId: 'm1', gameState: view({ uncovered: [] }), legalMoves: asLegal(allCovered) })} />);

      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      // oTop=100, pTop=300, pr.height=48 → mid=(100+300+48)/2=224 (Full Spec.html:3348's own formula)
      // → o = mid-71-oTop = 224-71-100 = 53, p = mid+23-pTop = 224+23-300 = -53.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(53px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(-53px)');

      // Just past the floor: phase flips to in-match — the bars slide back to 0.
      await act(async () => { await vi.advanceTimersByTimeAsync(1450); });
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      expect(screen.getByTestId('hub-slot-own').style.transform).toBe('translateY(0px)');
    } finally {
      rectSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-16#7 item 4 / 2026-09-17#1 item 2: a bust converges the bars + dims the board
  // at +1500ms from MY OWN lock (`bustedOn !== undefined` here) — independent of match settlement;
  // `lastOutcome`/`lastSettlement` arrive later in this test specifically to also exercise the ring
  // (which DOES need confirmed data, via `holdResultMs`), but converge itself has already armed off
  // the bust alone by the time they land. The opponent here never locks at all (`opp: { locked:
  // false }`, never flipped) — resultPhase legitimately stays held at 'converge' forever in this
  // fixture; only the ring's own `holdResultMs` (computed independently of resultPhase — see that
  // prop's own doc comment) is what this test actually verifies past the convergence beat. The
  // hold-then-RELEASE path (opponent locks AFTER convergence) has its own dedicated test below.
  it("item 4/item 2: a bust converges the bars + dims the board off MY OWN lock, and the ring holds until the sequence's own final beat even when the opponent never locks", async () => {
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
      const gameState = view({ uncovered: [0, 1, 2, 3], locked: true, bustedOn: 10 }, { locked: false });
      const { rerender } = render(
        <MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />,
      );
      // Locked (busted) from the very first render, but converge hasn't fired yet — it's SCHEDULED
      // (1500ms out), not immediate; nothing visible changes synchronously.
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('1');
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');

      rerender(
        <MinesHubScreen
          {...baseProps({
            currentMatchId: null,
            gameState,
            lastOutcome: { type: 'win', winner: 'bob' },
            lastSettlement: { delta: -10, newBalance: 990 },
          })}
        />,
      );

      // Just before the converge beat — still nothing.
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(0px)');
      const ownBar = screen.getByTestId('hub-slot-own');
      expect(ownBar.className).not.toContain('ring-[3px]');

      // Converge lands (+1500 from my own lock, ~the same moment as this render since I locked at
      // render 1) — bars shift, board dims. The opponent here never locks, so resultPhase stays
      // held at 'converge' for the rest of this test — deliberately, see this test's own header.
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('0.28');
      // oTop=100, pTop=300, pr.height=48 → mid=(100+300+48)/2=224 → o=224-71-100=53, p=224+23-300=-53.
      expect(screen.getByTestId('hub-slot-opponent').style.transform).toBe('translateY(53px)');
      expect(ownBar.style.transform).toBe('translateY(-53px)');
      // Ring hasn't lit yet — well past the OLD fixed 250ms beat, confirming the new gated timing.
      expect(ownBar.className).not.toContain('ring-[3px]');

      // holdResultMs (1500+1520=3020 at elapsed≈0, computed independently of resultPhase/the
      // opponent ever locking — see that prop's own doc comment) gates the ring here, then
      // GameHub's own fixed BAR_VERDICT_BEAT_MS (250ms) on top of that (this path isn't
      // gateResultOnReveal-gated, unlike Dice's) — the loss ring lights, Mines' own var(--rc-loss)
      // (same token Dice's own lossRingColor already uses). Two separate advances (not one
      // combined number) — same idiom the "Result win" test above already uses — so React gets a
      // chance to flush the intermediate phase→'result' render before the second timer registers.
      await act(async () => { await vi.advanceTimersByTimeAsync(1450); });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      expect(ownBar.className).toContain('ring-[3px]');
      expect(ownBar.className).not.toContain('ring-destructive');
      expect(ownBar.style.getPropertyValue('--tw-ring-color')).toBe('var(--rc-loss)');
    } finally {
      rectSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-17#1 item 2: the genuinely new behavior — a held 'converge' (opponent not yet
  // locked) releases once their `locked` is observed true, and 'reveal'/'final' fire relative to
  // THAT release moment, not the original convergence timestamp. This is the core of item 2's fix:
  // without it, a long-held wait would either fire reveal/final too early (stale schedule from
  // convergence) or never at all.
  it("item 2: a held converge releases once the opponent locks, with reveal timed from the RELEASE moment — not the original convergence timestamp", async () => {
    vi.useFakeTimers();
    try {
      const gameState = view({ uncovered: [0, 1, 2, 3], locked: true, bustedOn: 10 }, { locked: false });
      const { rerender } = render(
        <MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />,
      );

      // Converge lands at +1500 (my own lock) — board dims. The opponent hasn't locked, so this
      // holds indefinitely — confirmed by waiting WELL past where reveal (+820) and even final
      // (+1520) would have landed on the OLD, un-held schedule, and seeing nothing further happen.
      await act(async () => { await vi.advanceTimersByTimeAsync(1500 + 100); });
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('0.28'); // converged
      const oppBar = screen.getByTestId('hub-slot-opponent');
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); // well past +820/+1520
      expect(within(oppBar).queryByTestId('mines-gem-row')).toBeNull(); // still held — never armed

      // The opponent locks now (a long, real-world wait for their round to finish) — this is the
      // RELEASE moment. Re-supply the same gameState with their board now locked + scored.
      const releasedState = view({ uncovered: [0, 1, 2, 3], locked: true, bustedOn: 10 }, { locked: true, score: 6 });
      rerender(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: releasedState, legalMoves: asLegal([]) })} />);

      // Just before +820 from the RELEASE (not from the original convergence, which was ~2100ms
      // ago by now) — the row now exists (their score is known) but is still invisible.
      await act(async () => { await vi.advanceTimersByTimeAsync(700); });
      expect(within(oppBar).getByTestId('mines-gem-row').style.opacity).toBe('0');

      // +820 from release — reveal lands, the opponent's row becomes visible.
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      const oppGemRow = within(oppBar).getByTestId('mines-gem-row');
      expect(oppGemRow.style.opacity).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-16#7 item 5: the gem-count rows — hidden until the sequence's own 'reveal'
  // beat, capped at 22, own count shown immediately at 'converge' (matches the prototype's own
  // flat, never-fading `playGemStripOp`), opponent's genuinely fades in only at 'reveal'.
  it('item 5: gem-count rows appear on the sequence\'s own beats, capped at 22, own row earlier than the opponent\'s', async () => {
    vi.useFakeTimers();
    try {
      const gameState = view(
        { uncovered: Array.from({ length: 24 }, (_, i) => i), locked: true, bustedOn: 24 },
        { locked: true, score: 30 },
      );
      const { rerender } = render(
        <MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />,
      );
      rerender(
        <MinesHubScreen
          {...baseProps({
            currentMatchId: null,
            gameState,
            lastOutcome: { type: 'win', winner: 'bob' },
            lastSettlement: { delta: -10, newBalance: 990 },
          })}
        />,
      );

      // Converge (+1500): own row present (24 opened → capped at 22), opponent row present but
      // still opacity 0 (not yet 'reveal').
      await act(async () => { await vi.advanceTimersByTimeAsync(1550); });
      const ownBar = screen.getByTestId('hub-slot-own');
      const oppBar = screen.getByTestId('hub-slot-opponent');
      expect(ownBar.querySelectorAll('svg[viewBox="0 0 48 44"]')).toHaveLength(22); // capped, not 24
      const oppGemWrapper = within(oppBar).getByTestId('mines-gem-row');
      expect(oppGemWrapper.style.opacity).toBe('0');

      // Reveal (+2320 total, ~820ms further) — opponent's row fades in (30 opened → capped at 22).
      await act(async () => { await vi.advanceTimersByTimeAsync(820); });
      expect(oppGemWrapper.style.opacity).toBe('1');
      expect(oppBar.querySelectorAll('svg[viewBox="0 0 48 44"]')).toHaveLength(22);
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-17#3 items 1-2: the VS label extends to the result sequence (matchForming ||
  // resultConverge), and the gem-count CAPTIONS (separate from the icon strip above) appear on
  // their own asymmetric beats — own caption from 'converge' (singularizing at exactly 1 gem),
  // opponent's caption only at 'reveal' (never singularizes, even at 1).
  it('items 1-2: the VS label reappears for the result sequence, and the gem-count captions singularize/timed correctly', async () => {
    vi.useFakeTimers();
    try {
      const gameState = view(
        { uncovered: [0], locked: true, bustedOn: 24 },
        { locked: true, score: 1 },
      );
      const { rerender } = render(
        <MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />,
      );
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0'); // pre-lock: hidden
      expect(screen.queryByTestId('hub-gem-text-own')).toBeNull();

      rerender(
        <MinesHubScreen
          {...baseProps({
            currentMatchId: null,
            gameState,
            lastOutcome: { type: 'win', winner: 'bob' },
            lastSettlement: { delta: -10, newBalance: 990 },
          })}
        />,
      );

      // Converge (+1500ms, bust delay): VS reappears; own caption shows, singular at exactly 1 gem;
      // opponent's caption is present (rendered, matching the icon row's own pattern) but still
      // opacity 0 — not yet 'reveal'.
      await act(async () => { await vi.advanceTimersByTimeAsync(1550); });
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('1');
      expect(screen.getByTestId('hub-gem-text-own').textContent).toBe('1 gem'); // singular
      expect(screen.getByTestId('hub-gem-text-own').style.opacity).toBe('1');
      expect(screen.getByTestId('hub-gem-text-opponent').style.opacity).toBe('0');

      // Reveal (+820ms further): opponent's caption appears — always plural, even at 1 gem.
      await act(async () => { await vi.advanceTimersByTimeAsync(820); });
      expect(screen.getByTestId('hub-gem-text-opponent').textContent).toBe('1 gems'); // never singular
      expect(screen.getByTestId('hub-gem-text-opponent').style.opacity).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-17#4/#5: tapping the game section dismisses a landed ('final') result — bar-
  // shift/board-dim/VS release automatically (they key off `resultConverge`, redefined to exclude
  // 'closed'), the own caption fades out (its own explicit exclusion), but the opponent's icon
  // strip and caption BOTH stay exactly as they were (the icon strip gets 'closed' ADDED to its
  // allowlist; the caption's allowlist already excluded 'closed' by construction). A tap before
  // 'final' (mid-converge here) is a no-op — the sequence keeps running on its own schedule.
  it("item (dismiss): tapping the game section at 'final' returns bars/board home while a tap before 'final' does nothing", async () => {
    vi.useFakeTimers();
    try {
      const gameState = view(
        { uncovered: [0], locked: true, bustedOn: 24 },
        { locked: true, score: 1 },
      );
      const { rerender } = render(
        <MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />,
      );
      rerender(
        <MinesHubScreen
          {...baseProps({
            currentMatchId: null,
            gameState,
            lastOutcome: { type: 'win', winner: 'bob' },
            lastSettlement: { delta: -10, newBalance: 990 },
          })}
        />,
      );

      // Mid-converge (well before 'final'): a tap does nothing — the sequence isn't dismissible yet.
      await act(async () => { await vi.advanceTimersByTimeAsync(1550); });
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('0.28');
      fireEvent.click(screen.getByTestId('hub-section-game'));
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('0.28'); // unchanged

      // Reach 'final' (+820 reveal, +700 final = 1520ms further).
      await act(async () => { await vi.advanceTimersByTimeAsync(1520); });
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('1');
      expect(screen.getByTestId('hub-gem-text-own').style.opacity).toBe('1');
      const oppGemWrapperFinal = within(screen.getByTestId('hub-slot-opponent')).getByTestId('mines-gem-row');
      expect(oppGemWrapperFinal.style.opacity).toBe('1');
      expect(screen.getByTestId('hub-gem-text-opponent').style.opacity).toBe('1');

      // Tap dismisses: bar-shift/board-dim/VS release; own caption hides. The opponent's ICON STRIP
      // stays exactly as it was ('closed' explicitly added to its own allowlist), but the
      // opponent's CAPTION does hide — its allowlist ('reveal'/'final') never included 'closed' in
      // the first place, so it resolves to hidden by construction, not by a new exclusion.
      fireEvent.click(screen.getByTestId('hub-section-game'));
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('1');
      expect(screen.getByTestId('hub-match-vs').style.opacity).toBe('0');
      expect(screen.getByTestId('hub-gem-text-own').style.opacity).toBe('0');
      expect(oppGemWrapperFinal.style.opacity).toBe('1'); // unchanged — icon strip stays
      expect(screen.getByTestId('hub-gem-text-opponent').style.opacity).toBe('0'); // caption hides
    } finally {
      vi.useRealTimers();
    }
  });

  // Ticket 2026-09-17#1 item 3: the player's own gem-count row is now live — visible DURING an
  // active, still-in-progress round (no lock, no bust, no result phase at all), matching the
  // prototype's own `minesGems` binding directly to the opened-safe-tile count. Previously gated
  // behind `didBust`, so it only ever appeared after the round had already ended.
  it("item 3: the player's own gem row is live — visible mid-round, well before any lock or result", () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [0, 1, 2] }), legalMoves: asLegal([3, 4, 5]) })} />);
    const ownBar = screen.getByTestId('hub-slot-own');
    const ownGemWrapper = within(ownBar).getByTestId('mines-gem-row');
    expect(ownGemWrapper.style.opacity).toBe('1');
    expect(ownBar.querySelectorAll('svg[viewBox="0 0 48 44"]')).toHaveLength(3);
    // The opponent's row stays absent — no result sequence has armed at all (no bust yet).
    expect(within(screen.getByTestId('hub-slot-opponent')).queryByTestId('mines-gem-row')).toBeNull();
  });

  // Ticket 2026-09-17#1 item 2: a clean clear (all SAFE_COUNT=22 safe tiles, no bustedOn) is
  // distinguished from a bust and uses the SAME 500ms delay as a timeout, per the Owner's own
  // confirmed answer (2026-09-17) — the prototype has no source for this case at all. Confirmed by
  // checking convergence has ALREADY fired well before bust's 1500ms would allow.
  it("item 2: a clean clear (all 22 safe tiles) converges at the confirmed 500ms delay, not bust's 1500ms", async () => {
    vi.useFakeTimers();
    try {
      const gameState = view(
        { uncovered: Array.from({ length: 22 }, (_, i) => i), locked: true },
        { locked: true },
      );
      render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />);
      // Well past 'cleared'/'timeout's 500ms, well before bust's 1500ms — if this were mistakenly
      // treated as a bust, convergence would NOT have fired yet at this point.
      await act(async () => { await vi.advanceTimersByTimeAsync(500 + 100); });
      expect(screen.getByTestId('hub-mines-panel').style.opacity).toBe('0.28');
    } finally {
      vi.useRealTimers();
    }
  });
});
