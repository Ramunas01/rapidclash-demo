// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
  it('item 1: the bomb icon wrapper is position:absolute on both the hit tile and other exposed mines', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [], locked: true, bustedOn: 10, mines: [10, 20] }), legalMoves: asLegal([]) })} />);
    // Structure: <div class="absolute..."><motion.div (classless)><svg/></motion.div></div> — the
    // svg's grandparent (not immediate parent) is the actual positioned/animated wrapper div.
    const hitIconWrapper = screen.getByTestId('cell-10').querySelectorAll('svg')[1].parentElement?.parentElement as HTMLElement;
    expect(hitIconWrapper.className).toContain('absolute');
    const otherMineIconWrapper = screen.getByTestId('cell-20').querySelector('svg')?.parentElement?.parentElement as HTMLElement;
    expect(otherMineIconWrapper.className).toContain('absolute');
  });

  // Ticket 2026-09-16#6 item 3: the hit tile's bomb halo + icon bounce (rcMineJump) — the other
  // exposed mines and every safe tile stay still (matches the prototype's own `hit`-only gating).
  it('item 3: the hit tile\'s bomb halo and icon carry the rcMineJump bounce; other exposed mines don\'t', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [], locked: true, bustedOn: 10, mines: [10, 20] }), legalMoves: asLegal([]) })} />);
    const hitCell = screen.getByTestId('cell-10');
    const [haloSvg, iconSvg] = hitCell.querySelectorAll('svg');
    expect(haloSvg.parentElement?.style.animation).toContain('rcMineJump'); // halo wrapper is the direct parent
    expect(iconSvg.parentElement?.parentElement?.style.animation).toContain('rcMineJump'); // icon wrapper is the grandparent
    const otherMineIconWrapper = screen.getByTestId('cell-20').querySelector('svg')?.parentElement?.parentElement as HTMLElement;
    expect(otherMineIconWrapper.style.animation).toBeFalsy();
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
    const gameState = view({ uncovered: [0, 1, 2, 3], locked: true });
    const { rerender } = render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />);
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();

    rerender(<MinesHubScreen {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'alice' }, lastSettlement: { delta: 18, newBalance: 1018 } })} />);
    // `suppressResultOverlay`: GameHub never renders the separate `ResultOverlay`, terminal or not.
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('hub-slot-own-verdict')).toBeInTheDocument());
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
  it('item 4: the round clock collapses once the result phase lands', () => {
    const gameState = view({ uncovered: [0, 1, 2, 3], locked: true });
    const { rerender } = render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState, legalMoves: asLegal([]) })} />);
    const clockWrapper = screen.getByTestId('mines-round-clock').parentElement as HTMLElement;
    expect(clockWrapper.style.maxHeight).toBe('46px');
    expect(clockWrapper.style.opacity).toBe('1');

    rerender(<MinesHubScreen {...baseProps({ currentMatchId: null, gameState, lastOutcome: { type: 'win', winner: 'alice' }, lastSettlement: { delta: 18, newBalance: 1018 } })} />);
    expect(clockWrapper.style.maxHeight).toMatch(/^0(px)?$/); // React renders a 0 style value unitless
    expect(clockWrapper.style.opacity).toBe('0');
  });

  // Ticket 2026-09-16#5 item 5: the gem/mine icon's own reveal pop — previously appeared instantly
  // with zero transition; now mounts at opacity:0/scale:0.4 and animates to opacity:1/scale:1 (the
  // wrapping motion.div's own inline style, before Framer Motion's rAF-driven animation advances it).
  it('item 5: the gem/mine icon mounts as a reveal pop (opacity 0, scale 0.4), not an instant appear', () => {
    render(<MinesHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ uncovered: [0], bustedOn: 5, mines: [5] }, {}, {}), legalMoves: asLegal([]) })} />);
    // cell-0's SVGs, in DOM order: GemHalo's (unpopped, its own separate opacity-only fade), then
    // the pop-wrapped GemIcon's — the second one, whose parent is the motion.div reveal-pop wrapper.
    const svgs = screen.getByTestId('cell-0').querySelectorAll('svg');
    const gemPop = svgs[1].parentElement as HTMLElement;
    expect(gemPop.style.opacity).toBe('0');
    expect(gemPop.style.transform).toContain('scale(0.4)');
  });

  it('Result win: shared 0.5/2/0.5 bar animation on the own bar only — keeps the username, "You Win" alongside, then settles to the green outline (mirrors CoinflipHub.test.tsx)', async () => {
    vi.useFakeTimers();
    try {
      const gameState = view({ uncovered: [0, 1, 2, 3], locked: true });
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

      // No `holdResultMs` for Mines (like RPS) — the result phase starts essentially immediately;
      // only the fixed BAR_VERDICT_BEAT_MS (250ms) gates the bar lighting.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250 + 50);
      });
      const ownBar = screen.getByTestId('hub-slot-own');
      const oppBar = screen.getByTestId('hub-slot-opponent');
      expect(ownBar.textContent).toContain('alice'); // username stays put (not swapped out)
      expect(screen.getByTestId('hub-slot-own-verdict').textContent).toMatch(/you win/i);
      expect(ownBar.querySelector('.bg-success')).not.toBeNull(); // green fill = a background layer
      expect(ownBar.className).not.toContain('ring-success'); // not yet settled to the outline
      // Ring is OWN-BAR ONLY (Full Spec.html:3786, `oppBarRing: 'none'` unconditionally) — the
      // opponent's pill never gets any win/lose/draw treatment.
      expect(oppBar.querySelector('.bg-success')).toBeNull();
      expect(oppBar.className).not.toContain('ring-success');

      // 0.5s fill-in + 2s hold + 0.5s fade-out = 3s → settles to the persistent outline.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000 + 50);
      });
      expect(ownBar.className).toContain('ring-success');
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
});
