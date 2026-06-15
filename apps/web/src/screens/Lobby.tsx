import { useEffect, useState } from 'react';
import { formatClock } from '../format.js';

interface Props {
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  stake: number;
  /** Server-authoritative expiry of the owner's own resting bet (OC7); null until queue.waiting. */
  expiresAt: number | null;
  /** True once challenge.expired arrives — escrow is already refunded server-side. */
  expired: boolean;
  onRepost(): void;
  onLeave(): void;
}

export function LobbyScreen({ username, stake, expiresAt, expired, onRepost, onLeave }: Props) {
  // ONE client-side timer for the owner's countdown (no polling).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (expired) {
    return (
      <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: 16 }}>↩️</div>
        <h1>Challenge expired</h1>
        <p>Your {stake}-credit stake was refunded automatically.</p>
        <button className="btn" onClick={onRepost} data-testid="repost">Re-post challenge</button>
        <button className="btn btn-secondary" onClick={onLeave} style={{ marginTop: 12 }}>Back</button>
      </div>
    );
  }

  return (
    <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>⏳</div>
      <h1>Waiting for opponent…</h1>
      {username && <p data-testid="lobby-you">You (<strong>{username}</strong>)</p>}
      <p>Stake: {stake} credits</p>
      <div style={{ margin: '32px 0' }}>
        <div style={{ width: 40, height: 40, border: '3px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }} />
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {expiresAt !== null && (
        <p style={{ color: 'var(--muted)' }} data-testid="owner-countdown">
          Your challenge expires in {formatClock(expiresAt - now)} and auto-refunds — no need to cancel.
        </p>
      )}
      <button className="btn btn-secondary" onClick={onLeave}>Leave Queue</button>
    </div>
  );
}
