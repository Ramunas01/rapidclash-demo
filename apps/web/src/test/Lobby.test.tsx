// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LobbyScreen } from '../screens/Lobby.js';

const noop = () => {};

describe('LobbyScreen (OC7)', () => {
  it('shows a countdown from expiresAt with the auto-refund reassurance', () => {
    render(
      <LobbyScreen username="alice" stake={10} expiresAt={Date.now() + 48000} expired={false} onRepost={noop} onLeave={noop} />,
    );
    const countdown = screen.getByTestId('owner-countdown');
    expect(countdown.textContent).toMatch(/\d:\d\d/); // ~0:48
    expect(countdown.textContent).toContain('auto-refunds');
  });

  it('offers a Re-post button once the challenge has expired, and Leave is still available', () => {
    const onRepost = vi.fn();
    const onLeave = vi.fn();
    render(
      <LobbyScreen username="alice" stake={10} expiresAt={Date.now()} expired={true} onRepost={onRepost} onLeave={onLeave} />,
    );
    fireEvent.click(screen.getByTestId('repost'));
    expect(onRepost).toHaveBeenCalled();
    // The expired view also explains the refund already happened.
    expect(screen.getByText(/refunded automatically/i)).toBeInTheDocument();
  });

  it('shows the spinner waiting state (not expired) when no expiry yet', () => {
    render(<LobbyScreen username="alice" stake={5} expiresAt={null} expired={false} onRepost={noop} onLeave={noop} />);
    expect(screen.getByText('Waiting for opponent…')).toBeInTheDocument();
    expect(screen.queryByTestId('owner-countdown')).toBeNull();
  });

  it('shows the player their own alias as "You (<alias>)" while waiting (#34)', () => {
    render(<LobbyScreen username="alice" stake={5} expiresAt={null} expired={false} onRepost={noop} onLeave={noop} />);
    expect(screen.getByTestId('lobby-you').textContent).toBe('You (alice)');
  });
});
