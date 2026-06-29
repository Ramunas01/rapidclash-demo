// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { CrashHubScreen, altitudeAt } from '../screens/CrashHub.js';
import type { CrashView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof CrashHubScreen>[0];

function baseProps(over: Partial<Props> = {}): Props {
  return {
    token: 'tok', playerId: 'pid', username: 'me', opponentId: 'bob', balance: 1000,
    currentMatchId: null, gameState: null, legalMoves: [], waitingExpiresAt: null, lobbyExpired: false,
    lastOutcome: null, lastSettlement: null, challengesByGame: {},
    onPlay: vi.fn(), onCancel: vi.fn(), onRepost: vi.fn(), onTakeChallenge: vi.fn(),
    onMakeMove: vi.fn(), onForfeit: vi.fn(), onTrackChallenges: vi.fn(), onUntrackChallenges: vi.fn(),
    onSelectGame: vi.fn(), onOpenWallet: vi.fn(), onOpenGameList: vi.fn(), onResultDismiss: vi.fn(),
    serverClockOffset: 0,
    ...over,
  };
}

/** A live CLIMB view: setup + ignition are in the past, this player still aboard. */
function inPlayView(over: Partial<CrashView> = {}): CrashView {
  const now = Date.now();
  return { players: ['pid', 'bob'], setupEndsAt: now - 4000, startedAt: now - 3000, results: {}, ...over };
}

/** A SETUP view: the launch is still ~8s out (set your auto-eject). */
function setupView(over: Partial<CrashView> = {}): CrashView {
  const now = Date.now();
  return { players: ['pid', 'bob'], setupEndsAt: now + 8000, startedAt: now + 9000, results: {}, ...over };
}

describe('CrashHubScreen (GameHub + CrashPanel)', () => {
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
    render(<CrashHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeDisabled();
    fireEvent.click(screen.getByTestId('hub-bet-10'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(10);
  });

  it('Preview: the real chart frozen at 0m — parked rocket + helper text, no live altitude/eject', () => {
    render(<CrashHubScreen {...baseProps()} />);
    const board = screen.getByTestId('hub-board');
    expect(board.textContent).toMatch(/place your bet and launch/i);
    expect(within(board).getByTestId('crash-chart')).toBeInTheDocument(); // the live frame at rest
    expect(within(board).getByTestId('crash-rocket')).toBeInTheDocument(); // parked at the origin
    expect(within(board).queryByTestId('crash-curve')).toBeNull(); // no trail at 0m
    expect(within(board).queryByTestId('crash-altitude')).toBeNull();
    expect(screen.queryByTestId('crash-eject')).toBeNull();
    expect(screen.getByTestId('hub-play')).toBeInTheDocument(); // the one primary button = PLAY in idle
  });

  it('One transforming button: PLAY in idle is replaced in place by EJECT in flight (never both)', () => {
    const { rerender } = render(<CrashHubScreen {...baseProps()} />);
    expect(screen.getByTestId('hub-play')).toBeInTheDocument();
    expect(screen.queryByTestId('crash-eject')).toBeNull();
    rerender(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['eject'] })} />);
    expect(screen.getByTestId('crash-eject')).toBeInTheDocument();
    expect(screen.queryByTestId('hub-play')).toBeNull(); // PLAY transformed in place — no second control
  });

  it('SETUP: shows a short countdown, no altitude/EJECT, and NO auto-eject input (live-eject only)', () => {
    render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: setupView(), legalMoves: ['eject', 'auto:off', 'auto:100'] })} />);
    expect(screen.getByTestId('crash-countdown').textContent).toMatch(/launching in/i);
    expect(screen.queryByTestId('crash-auto-eject')).toBeNull(); // auto-eject input removed from the human UI
    expect(screen.queryByTestId('crash-auto-100')).toBeNull();
    expect(screen.queryByTestId('crash-altitude')).toBeNull(); // no altitude until the climb begins
    expect(screen.queryByTestId('crash-eject')).toBeNull(); // no climb EJECT on the pad
  });

  it('Bug #1: the displayed altitude aligns to the SERVER clock (offset), not the raw client clock', () => {
    const startedAt = 1_000_000;
    const serverNow = startedAt + 5000; // server says 5s into the climb → altitudeAt(5000)
    const clientNow = serverNow - 7000; // this client's clock is 7s behind the server (skew)
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(clientNow);
    try {
      const offset = serverNow - clientNow; // = what App computes from payload.serverNow
      const view = inPlayView({ startedAt, setupEndsAt: startedAt - 1000 });
      render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view, legalMoves: ['eject'], serverClockOffset: offset })} />);
      // Without alignment the raw client clock (998_000 < startedAt) would read as pre-launch;
      // aligned (clientNow + offset = serverNow) it's 5s in → the server-authoritative altitude.
      expect(screen.getByTestId('crash-altitude').textContent).toContain(String(altitudeAt(5000)));
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('client altitude curve matches the server (same constants → same metres banked)', () => {
    // The exact values the crash module test also asserts — "what you see == what you bank".
    expect(altitudeAt(0)).toBe(0);
    expect(altitudeAt(2000)).toBe(1);
    expect(altitudeAt(5000)).toBe(6);
    expect(altitudeAt(10_000)).toBe(71);
  });

  it('In-match: a climbing altitude + EJECT gated by legalMoves → onMove("eject")', () => {
    const onMakeMove = vi.fn();
    const { rerender } = render(
      <CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['eject'], onMakeMove })} />,
    );
    expect(screen.getByTestId('crash-altitude')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crash-eject'));
    expect(onMakeMove).toHaveBeenCalledWith('eject');

    // No legal moves (already resolved / not actionable) → EJECT disabled.
    rerender(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: [] })} />);
    expect(screen.getByTestId('crash-eject')).toBeDisabled();
  });

  it('In-match: after my own ejection the locked altitude moves onto my pill; button → Waiting…', () => {
    const view = inPlayView({ results: { pid: { altitude: 120, crashed: false } } });
    render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view, legalMoves: [] })} />);
    // Locked altitude is on the pill (off the button), seen the instant I eject.
    expect(screen.getByTestId('crash-own-pill').textContent).toMatch(/locked 120m/i);
    expect(screen.queryByTestId('crash-eject')).toBeNull();
    expect(screen.getByTestId('crash-waiting')).toBeInTheDocument(); // button → disabled waiting state
    // Opponent pill stays blank during flight (leak guard).
    expect(screen.queryByTestId('crash-opp-pill')).toBeNull();
  });

  it('Redaction: the climbing view exposes only the live curve — no opponent eject, no crash point', () => {
    // The server's redacted in-play view carries neither the opponent's result nor C (asserted at
    // the module level); the climbing render must therefore show no opponent marker and no
    // explosion (C is unknown until terminal) — only this player's own rising altitude.
    render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView({ results: {} }), legalMoves: ['eject'] })} />);
    expect(screen.getByTestId('crash-curve')).toBeInTheDocument();
    expect(screen.getByTestId('crash-rocket')).toBeInTheDocument();
    expect(screen.queryByTestId('crash-explosion')).toBeNull(); // C is hidden → no crash point drawn
    const board = screen.getByTestId('hub-board');
    expect(board.textContent ?? '').not.toMatch(/opponent/i); // no opponent altitude/marker in-climb
  });

  it('Result: explosion on the board + the Stage-3 pill reveal (no pop-up), then the 0.5s outline beat', async () => {
    const terminal = inPlayView({
      crashAltitude: 904,
      terminal: true,
      results: { pid: { altitude: 250, crashed: false }, bob: { altitude: 0, crashed: true } },
    });
    const { rerender } = render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    // §7 crash visual stays on the chart; the reveal moves onto the slot pills (no overlay).
    expect(screen.getByTestId('crash-explosion')).toBeInTheDocument();
    expect(screen.getByTestId('hub-board').textContent).toMatch(/exploded at 904 m/i);
    expect(screen.getByTestId('crash-own-pill').textContent).toMatch(/locked 250m/i);
    expect(screen.getByTestId('crash-opp-pill').textContent).toMatch(/crashed/i); // bob never ejected
    expect(screen.queryByTestId('hub-result-crash')).toBeNull(); // the side-by-side overlay is gone

    rerender(<CrashHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'pid' }, lastSettlement: { delta: 19, newBalance: 1019 } })} />);
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull(); // suppressed — pill outline instead
    // 0.5s after the opponent's reveal, the own pill outlines green (won) — driven by the server outcome.
    await waitFor(() => expect(screen.getByTestId('crash-own-pill').className).toContain('ring-success'), { timeout: 2000 });
  });

  it('is sanitized: no $ anywhere on the hub', () => {
    const { container } = render(<CrashHubScreen {...baseProps({ currentMatchId: 'm1', gameState: inPlayView(), legalMoves: ['eject'] })} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
