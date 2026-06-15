import { useEffect, useState } from 'react';
import type { LedgerEntry } from '@rapidclash/shared';
import { api } from '../api.js';

interface Props {
  token: string;
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  balance: number;
  onPlay(): void;
  onLogout(): void;
}

export function WalletScreen({ token, username, balance: initialBalance, onPlay, onLogout }: Props) {
  const [balance, setBalance] = useState(initialBalance);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.wallet(token).then(data => {
      setBalance(data.balance);
      setEntries(data.entries.slice(-5).reverse());
    }).catch(console.error).finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>Wallet</h1>
        <button className="btn-ghost btn" style={{ width: 'auto' }} onClick={onLogout}>Sign out</button>
      </div>
      {username && (
        <p style={{ color: 'var(--muted)', marginBottom: 16 }} data-testid="signed-in-as">
          Signed in as <strong style={{ color: 'var(--text)' }}>{username}</strong>
        </p>
      )}
      <div className="card" style={{ textAlign: 'center' }}>
        <p style={{ color: 'var(--muted)', marginBottom: 4 }}>Balance</p>
        <div style={{ fontSize: '2.5rem', fontWeight: 'bold', color: 'var(--text)' }} aria-label="balance">
          {balance.toLocaleString()} <span style={{ fontSize: '1rem', color: 'var(--muted)' }}>credits</span>
        </div>
      </div>
      {loading ? <p>Loading…</p> : entries.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Recent transactions</h2>
          {entries.map(e => (
            <div key={e.id} className="entry-row">
              <span>{e.type.replace('_', ' ')}</span>
              <span className={e.amount > 0 ? 'amount-pos' : 'amount-neg'}>
                {e.amount > 0 ? '+' : ''}{e.amount}
              </span>
            </div>
          ))}
        </div>
      )}
      <button className="btn" onClick={onPlay} style={{ marginTop: 'auto' }}>Play</button>
    </div>
  );
}
