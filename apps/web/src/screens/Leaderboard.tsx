import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@rapidclash/shared';
import { api } from '../api.js';

interface Props {
  token: string;
  /** The active/just-played game whose board to show (#46) — not hardcoded to rps. */
  gameId: string;
  onBack(): void;
}

/** Render a row's stat according to its ranking kind (ADR-007): win_rate shows a
 *  percentage; net_winnings shows signed credits (the sign is part of the value). */
export function formatStat(entry: LeaderboardEntry): string {
  if (entry.kind === 'net_winnings') {
    const v = entry.netWinnings;
    return `${v > 0 ? '+' : ''}${v} credits`;
  }
  return `${Math.round(entry.score * 100)}% win rate`;
}

export function LeaderboardScreen({ token, gameId, onBack }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api.leaderboard(gameId, token).then(setEntries).catch(e => setError(e instanceof Error ? e.message : 'Error')).finally(() => setLoading(false));
  }, [token, gameId]);

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
          <span className="lb-stat">{formatStat(e)}</span>
        </div>
      ))}
    </div>
  );
}
