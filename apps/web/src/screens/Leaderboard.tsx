import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@rapidclash/shared';
import { api } from '../api.js';

interface Props {
  token: string;
  onBack(): void;
}

export function LeaderboardScreen({ token, onBack }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.leaderboard('rps', token).then(setEntries).catch(e => setError(e instanceof Error ? e.message : 'Error')).finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="screen">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn-ghost btn" style={{ width: 'auto' }} onClick={onBack}>←</button>
        <h1>Leaderboard</h1>
      </div>
      {loading && <p>Loading…</p>}
      {error && <p className="error-msg">{error}</p>}
      {!loading && entries.length === 0 && !error && <p>No matches yet.</p>}
      {entries.map(e => (
        <div key={e.playerId} className="lb-row">
          <span className="lb-rank">#{e.rank}</span>
          <span className="lb-name">{e.displayName}</span>
          <span className="lb-stat">{Math.round(e.score * 100)}% win rate</span>
        </div>
      ))}
    </div>
  );
}
