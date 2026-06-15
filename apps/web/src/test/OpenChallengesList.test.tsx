// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OpenChallengesList, applyChallengesUpdate } from '../screens/OpenChallengesList.js';
import type { OpenChallenge } from '@rapidclash/shared';

function challenge(over: Partial<OpenChallenge> = {}): OpenChallenge {
  const now = Date.now();
  return { matchId: 'm1', ownerName: 'alice', stake: 10, openedAt: now - 6000, expiresAt: now + 48000, ...over };
}

describe('OpenChallengesList (OC2)', () => {
  it('renders a card per entry with owner, stake, and a live countdown', () => {
    render(<OpenChallengesList entries={[challenge()]} more={0} onTake={vi.fn()} />);
    expect(screen.getByText('alice')).toBeInTheDocument();
    // Play-money stake (credits, not crypto).
    expect(screen.getByTestId('stake-m1').textContent).toBe('10 cr');
    // Countdown renders as M:SS (~0:48 for a 48s-out expiry), driven by expiresAt.
    expect(screen.getByTestId('countdown-m1').textContent).toMatch(/\d:\d\d/);
  });

  it('uses play-money framing — no crypto / deposit / buy-chips copy', () => {
    const { container } = render(<OpenChallengesList entries={[challenge()]} more={2} onTake={vi.fn()} />);
    expect(container.textContent?.toLowerCase()).not.toMatch(/crypto|deposit|buy chips|buy-chips|usdc|\$/);
  });

  it('tapping a row calls onTake with that challenge\'s matchId', () => {
    const onTake = vi.fn();
    render(<OpenChallengesList entries={[challenge({ matchId: 'm-42' })]} more={0} onTake={onTake} />);
    fireEvent.click(screen.getByTestId('challenge-m-42'));
    expect(onTake).toHaveBeenCalledWith('m-42');
  });

  it('shows a quiet "+N more waiting" line from `more` (no scroll)', () => {
    render(<OpenChallengesList entries={[challenge()]} more={3} onTake={vi.fn()} />);
    expect(screen.getByTestId('more-waiting').textContent).toContain('+3 more');
  });

  it('is ABSENT entirely when there are no entries and no notice', () => {
    const { container } = render(<OpenChallengesList entries={[]} more={0} onTake={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows a notice (e.g. after a failed take) even with no rows', () => {
    render(<OpenChallengesList entries={[]} more={0} onTake={vi.fn()} notice="That challenge was just taken." />);
    expect(screen.getByTestId('challenge-notice').textContent).toContain('just taken');
  });

  it('a challenges.update add/remove mutates the rendered list', () => {
    const a = challenge({ matchId: 'a', ownerName: 'amy', openedAt: 1 });
    const b = challenge({ matchId: 'b', ownerName: 'bob', openedAt: 2 });
    const { rerender } = render(<OpenChallengesList entries={[a]} more={0} onTake={vi.fn()} />);
    expect(screen.queryByTestId('challenge-b')).toBeNull();

    // `added` → row appears.
    const afterAdd = applyChallengesUpdate([a], { gameId: 'rps', added: b });
    rerender(<OpenChallengesList entries={afterAdd} more={0} onTake={vi.fn()} />);
    expect(screen.getByTestId('challenge-b')).toBeInTheDocument();

    // `removed` → row disappears.
    const afterRemove = applyChallengesUpdate(afterAdd, { gameId: 'rps', removed: { matchId: 'a', reason: 'taken' } });
    rerender(<OpenChallengesList entries={afterRemove} more={0} onTake={vi.fn()} />);
    expect(screen.queryByTestId('challenge-a')).toBeNull();
    expect(screen.getByTestId('challenge-b')).toBeInTheDocument();
  });
});

describe('applyChallengesUpdate', () => {
  const base: OpenChallenge[] = [
    { matchId: 'a', ownerName: 'amy', stake: 10, openedAt: 1, expiresAt: 100 },
    { matchId: 'b', ownerName: 'bob', stake: 20, openedAt: 2, expiresAt: 200 },
  ];

  it('appends an added challenge, keeping longest-waiting-first order', () => {
    const added: OpenChallenge = { matchId: 'c', ownerName: 'cleo', stake: 30, openedAt: 0, expiresAt: 90 };
    const next = applyChallengesUpdate(base, { gameId: 'rps', added });
    expect(next.map((e) => e.matchId)).toEqual(['c', 'a', 'b']); // openedAt asc
  });

  it('removes by matchId and ignores duplicate adds', () => {
    const removed = applyChallengesUpdate(base, { gameId: 'rps', removed: { matchId: 'a', reason: 'expired' } });
    expect(removed.map((e) => e.matchId)).toEqual(['b']);
    const dupe = applyChallengesUpdate(base, { gameId: 'rps', added: base[0] });
    expect(dupe).toHaveLength(2); // no duplicate
  });
});
