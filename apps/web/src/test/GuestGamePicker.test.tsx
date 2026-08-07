// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuestGamePicker } from '../screens/GuestGamePicker.js';

vi.mock('@rapidclash/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rapidclash/shared')>();
  return { ...actual, GUEST_CURATED_GAMES: ['coinflip', 'chess'] };
});

afterEach(() => vi.restoreAllMocks());

describe('GuestGamePicker (issue #279)', () => {
  it('renders exactly one tile per curated game, data-driven off GUEST_CURATED_GAMES', () => {
    render(<GuestGamePicker onSelect={vi.fn()} />);
    expect(screen.getByTestId('guest-picker-coinflip')).toBeInTheDocument();
    expect(screen.getByTestId('guest-picker-chess')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^guest-picker-/)).toHaveLength(2);
  });

  it('tapping a tile calls onSelect with that gameId', () => {
    const onSelect = vi.fn();
    render(<GuestGamePicker onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('guest-picker-chess'));
    expect(onSelect).toHaveBeenCalledWith('chess');
    fireEvent.click(screen.getByTestId('guest-picker-coinflip'));
    expect(onSelect).toHaveBeenCalledWith('coinflip');
  });
});
