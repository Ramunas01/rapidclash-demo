// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StakeEntryScreen } from '../screens/StakeEntry.js';
import type { GameMeta } from '@rapidclash/shared';

const meta: GameMeta = {
  id: 'rps',
  displayName: 'Rock Paper Scissors',
  minPlayers: 2,
  maxPlayers: 2,
  ranking: { kind: 'win_rate' },
  bet: { minStake: 1, maxStake: 100, symmetricStake: true },
  averageDurationSec: 10,
};

function renderScreen(overrides: Partial<Parameters<typeof StakeEntryScreen>[0]> = {}) {
  const onJoin = vi.fn();
  render(
    <StakeEntryScreen
      meta={meta}
      onJoin={onJoin}
      onBack={vi.fn()}
      challenges={[]}
      challengesMore={0}
      challengeNotice={null}
      onSubscribe={vi.fn()}
      onUnsubscribe={vi.fn()}
      onTakeChallenge={vi.fn()}
      {...overrides}
    />,
  );
  const input = screen.getByLabelText('stake amount') as HTMLInputElement;
  const submit = screen.getByRole('button', { name: 'Join Lobby' });
  return { onJoin, input, submit };
}

describe('StakeEntryScreen — stake input (#33)', () => {
  it('clears the field and types a fresh multi-digit value (no per-keystroke clamp)', () => {
    const { input } = renderScreen();
    expect(input.value).toBe('1'); // defaults to min

    // Clear it — must NOT snap back to the minimum.
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');

    // Type "50" — mid-typing "5" stays "5" (not clamped to 1).
    fireEvent.change(input, { target: { value: '5' } });
    expect(input.value).toBe('5');
    fireEvent.change(input, { target: { value: '50' } });
    expect(input.value).toBe('50');
  });

  it('strips non-digits but allows an empty/partial value mid-edit', () => {
    const { input } = renderScreen();
    fireEvent.change(input, { target: { value: '5a0' } });
    expect(input.value).toBe('50');
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
  });

  it('submits a valid in-range value via onJoin as an integer', () => {
    const { input, submit, onJoin } = renderScreen();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.click(submit);
    expect(onJoin).toHaveBeenCalledWith(50);
  });

  it('rejects an empty stake on submit with an inline message and does NOT join', () => {
    const { input, submit, onJoin } = renderScreen();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(submit);
    expect(onJoin).not.toHaveBeenCalled();
    expect(screen.getByTestId('stake-error')).toBeInTheDocument();
  });

  it('rejects an out-of-range stake on submit (above max)', () => {
    const { input, submit, onJoin } = renderScreen();
    // Force an out-of-range value without blurring (direct submit).
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.submit(submit.closest('form')!);
    expect(onJoin).not.toHaveBeenCalled();
    expect(screen.getByTestId('stake-error').textContent).toMatch(/between 1 and 100/);
  });

  it('clamps a typed value into range on blur', () => {
    const { input } = renderScreen();
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);
    expect(input.value).toBe('100'); // clamped to max
  });

  it('+/− steppers move within [min, max] and clamp at the bounds', () => {
    const { input } = renderScreen();
    const dec = screen.getByTestId('stake-decrement');
    const inc = screen.getByTestId('stake-increment');

    // At min (1): − is disabled, + moves to 2.
    expect(dec).toBeDisabled();
    fireEvent.click(inc);
    expect(input.value).toBe('2');

    // Back down to 1, then − is disabled again (clamped).
    fireEvent.click(dec);
    expect(input.value).toBe('1');
    expect(dec).toBeDisabled();

    // Jump to max via a chip, then + is disabled (clamped at max).
    fireEvent.click(screen.getByTestId('stake-chip-100'));
    expect(input.value).toBe('100');
    expect(inc).toBeDisabled();
  });

  it('quick-pick chips set the stake directly', () => {
    const { input, submit, onJoin } = renderScreen();
    fireEvent.click(screen.getByTestId('stake-chip-100'));
    expect(input.value).toBe('100');
    fireEvent.click(submit);
    expect(onJoin).toHaveBeenCalledWith(100);
  });

  // Re-skin guardrail: the investor demo must read as play-money, never crypto/real-money.
  it('frames stakes as play-money credits with no crypto / deposit affordance', () => {
    const { container } = render(
      <StakeEntryScreen
        meta={meta}
        onJoin={vi.fn()}
        onBack={vi.fn()}
        challenges={[]}
        challengesMore={0}
        challengeNotice={null}
        onSubscribe={vi.fn()}
        onUnsubscribe={vi.fn()}
        onTakeChallenge={vi.fn()}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/credits/i);
    // No real-money / crypto wording lifted from the Base44 source (USDT/ETH/BTC, $, deposit, buy chips).
    expect(text).not.toMatch(/USDT|\bETH\b|\bBTC\b|deposit|buy chips|\$/i);
    // The crypto currency selector from the design source must not survive the port.
    expect(screen.queryByText(/currency/i)).toBeNull();
  });
});
