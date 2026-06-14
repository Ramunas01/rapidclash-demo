import { useEffect, useState } from 'react';
import type { GameMeta } from '@rapidclash/shared';
import { api } from '../api.js';

interface Props {
  token: string;
  onSelect(meta: GameMeta): void;
  onBack(): void;
}

export function GameListScreen({ token, onSelect, onBack }: Props) {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.games(token).then(setGames).catch(e => setError(e instanceof Error ? e.message : 'Error')).finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="screen">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn-ghost btn" style={{ width: 'auto' }} onClick={onBack}>←</button>
        <h1>Games</h1>
      </div>
      {loading && <p>Loading…</p>}
      {error && <p className="error-msg">{error}</p>}
      {games.map(g => (
        <button key={g.id} className="card" style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none' }} onClick={() => onSelect(g)}>
          <h2>{g.displayName}</h2>
          <p>Stake: {g.bet.minStake}–{g.bet.maxStake} credits · ~{g.averageDurationSec}s</p>
        </button>
      ))}
    </div>
  );
}
