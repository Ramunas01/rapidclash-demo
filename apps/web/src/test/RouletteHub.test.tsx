// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RouletteHubScreen } from '../screens/RouletteHub.js';
import type { RouletteView } from '../App.js';

// canvas-confetti needs a real <canvas> (absent in jsdom) — mock it (matches the other hub tests).
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

type Props = Parameters<typeof RouletteHubScreen>[0];

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

/** A betting-phase view: my allocation is `mine`, the opponent's is hidden ({}), neither locked. */
function view(mine: Record<string, number> = {}, over: Partial<RouletteView> = {}): RouletteView {
  return {
    players: ['alice', 'bob'],
    round: 0,
    replays: 0,
    bets: {
      alice: { allocation: mine, locked: false },
      bob: { allocation: {}, locked: false },
    },
    ...over,
  };
}

const inMatch = (over: Partial<Props> = {}) =>
  baseProps({ currentMatchId: 'm1', gameState: view(), legalMoves: [], ...over });

describe('RouletteHubScreen (GameHub + RoulettePanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes('/games') || u.includes('/leaderboard')) return { ok: true, json: async () => [] } as Response;
      return { ok: true, json: async () => ({ balance: 1000, entries: [] }) } as Response;
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Idle: arming a bet enables PLAY, which posts that stake (shared GameHub)', () => {
    const onPlay = vi.fn();
    render(<RouletteHubScreen {...baseProps({ onPlay })} />);
    expect(screen.getByTestId('hub-play')).toBeDisabled();
    fireEvent.click(screen.getByTestId('hub-bet-5'));
    fireEvent.click(screen.getByTestId('hub-play'));
    expect(onPlay).toHaveBeenCalledWith(5);
  });

  it('In-match: the betting board renders and LOCK is disabled until the full stack is placed', () => {
    render(<RouletteHubScreen {...inMatch()} />);
    expect(screen.getByTestId('hub-board')).toBeInTheDocument();
    expect(screen.getByTestId('bet-red')).toBeInTheDocument();
    expect(screen.getByTestId('bet-s7')).toBeInTheDocument(); // a straight-up cell
    expect(screen.getByTestId('lock-btn')).toBeDisabled();
    expect(screen.getByTestId('stack-indicator').textContent).toMatch(/0 \/ 1000|1000 left/);
  });

  it('placing a chip sends a place move with the selected denomination', () => {
    const onMakeMove = vi.fn();
    render(<RouletteHubScreen {...inMatch({ onMakeMove })} />);
    fireEvent.click(screen.getByTestId('chip-100')); // select the 100 chip
    fireEvent.click(screen.getByTestId('bet-red'));
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'place', bet: 'red', amount: 100 });
  });

  it('LOCK enables only at a full 1000-chip stack (the full-stack rule, reflected in the UI)', () => {
    const onMakeMove = vi.fn();
    // A fully-allocated view (all 1000 on red) → LOCK enabled and emits the lock move.
    render(<RouletteHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ red: 1000 }), onMakeMove })} />);
    expect(screen.getByTestId('stack-indicator').textContent).toMatch(/full stack allocated/i);
    const lockBtn = screen.getByTestId('lock-btn');
    expect(lockBtn).not.toBeDisabled();
    fireEvent.click(lockBtn);
    expect(onMakeMove).toHaveBeenCalledWith({ t: 'lock' });
  });

  it("Redaction: the opponent's allocation is never rendered while betting", () => {
    // alice placed on s7; bob's allocation is hidden ({}). bob's chips must not appear as a badge.
    render(<RouletteHubScreen {...baseProps({ currentMatchId: 'm1', gameState: view({ s7: 200 }) })} />);
    // alice's own placement shows a chip badge…
    expect(within(screen.getByTestId('bet-s7')).getByTestId('bet-chip').textContent).toBe('200');
    // …and the opponent slot pill shows the generic "Playing…" tag, never an allocation.
    expect(screen.getByTestId('hub-slot-opponent').textContent).toMatch(/playing/i);
  });

  it('locked: shows the waiting banner instead of the betting board', () => {
    const locked = view({ red: 1000 });
    locked.bets.alice.locked = true;
    render(<RouletteHubScreen {...baseProps({ currentMatchId: 'm1', gameState: locked })} />);
    expect(screen.getByTestId('locked-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('lock-btn')).toBeNull();
  });

  it('after a spin, the result strip reveals the pocket + both stacks; an equal result notes a replay', () => {
    // Equal stacks (both all-in on the winning colour) → a tie that replays in place.
    const resolved = view({}, {
      round: 1,
      replays: 1,
      lastResult: { round: 0, pocket: 17, bets: { alice: { red: 1000 }, bob: { red: 1000 } }, stacks: { alice: 2000, bob: 2000 } },
    });
    render(<RouletteHubScreen {...baseProps({ currentMatchId: 'm1', gameState: resolved })} />);
    const strip = screen.getByTestId('spin-result');
    expect(strip.textContent).toContain('17');
    expect(strip.textContent).toMatch(/You 2000/);
    expect(strip.textContent).toMatch(/Opp 2000/);
    expect(screen.getByTestId('replay-note').textContent).toMatch(/replaying/i);
  });

  // A decisive terminal view: alice all-in Red, bob all-in Black, pocket 19 (red) → alice 2000, bob 0.
  function terminalView(): RouletteView {
    return {
      players: ['alice', 'bob'],
      round: 0,
      replays: 0,
      bets: {
        alice: { allocation: { red: 1000 }, locked: true },
        bob: { allocation: { black: 1000 }, locked: true },
      },
      lastResult: { round: 0, pocket: 19, bets: { alice: { red: 1000 }, bob: { black: 1000 } }, stacks: { alice: 2000, bob: 0 } },
      winner: 'alice',
      seed: 123,
    };
  }

  /** Render in-match then transition to the terminal (match.end) so GameHub enters the result phase. */
  function renderTerminal() {
    const terminal = terminalView();
    const r = render(<RouletteHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal, legalMoves: [] })} />);
    r.rerender(
      <RouletteHubScreen
        {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'win', winner: 'alice' }, lastSettlement: { delta: 9, newBalance: 1009 } })}
      />,
    );
    return r;
  }

  it('Terminal: NO result pop-up — Roulette opts out (suppressResultOverlay)', () => {
    renderTerminal();
    expect(screen.queryByTestId('hub-result-overlay')).toBeNull();
    expect(screen.getByTestId('roulette-result')).toBeInTheDocument();
  });

  it('Terminal: the on-board breakdown shows the winning pocket, both bet lists, and totals', () => {
    renderTerminal();
    // a. winning pocket (number + colour).
    expect(screen.getByTestId('result-pocket').textContent).toBe('19');
    expect(screen.getByTestId('roulette-result').textContent).toMatch(/Red/);
    // b. side-by-side breakdown: my Red won (+1000), opponent's Black lost (−1000).
    const you = within(screen.getByTestId('result-you'));
    expect(you.getByText('Red')).toBeInTheDocument();
    expect(you.getByText('+1000')).toBeInTheDocument();
    const opp = within(screen.getByTestId('result-opp'));
    expect(opp.getByText('Black')).toBeInTheDocument();
    expect(opp.getByText('−1000')).toBeInTheDocument();
    // c. cumulative totals per player.
    expect(screen.getByTestId('result-you-total').textContent).toBe('2000');
    expect(screen.getByTestId('result-opp-total').textContent).toBe('0');
    // winner highlighted + verdict.
    expect(within(screen.getByTestId('result-you')).getByText(/win/i)).toBeInTheDocument();
    expect(screen.getByTestId('result-verdict').textContent).toMatch(/you win with 2000/i);
  });

  it('Terminal: a void (equal stacks) shows a push with no winner highlight', () => {
    const terminal: RouletteView = {
      players: ['alice', 'bob'],
      round: 0,
      replays: 10,
      bets: { alice: { allocation: { red: 1000 }, locked: true }, bob: { allocation: { red: 1000 }, locked: true } },
      lastResult: { round: 0, pocket: 19, bets: { alice: { red: 1000 }, bob: { red: 1000 } }, stacks: { alice: 2000, bob: 2000 } },
      forcedOutcome: { type: 'void' },
    };
    const { rerender } = render(<RouletteHubScreen {...baseProps({ currentMatchId: 'm1', gameState: terminal })} />);
    rerender(<RouletteHubScreen {...baseProps({ currentMatchId: null, gameState: terminal, lastOutcome: { type: 'void' }, lastSettlement: { delta: 0, newBalance: 1000 } })} />);
    expect(screen.getByTestId('result-verdict').textContent).toMatch(/push/i);
    expect(within(screen.getByTestId('result-you')).queryByText(/win/i)).toBeNull();
  });

  it('is sanitized: no $ anywhere on the hub (play-money credits, chips are scoring only)', () => {
    const { container } = render(<RouletteHubScreen {...inMatch()} />);
    expect(container.textContent ?? '').not.toMatch(/\$/);
  });
});
