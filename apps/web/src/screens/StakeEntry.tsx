import { useState, type FormEvent } from 'react';
import type { GameMeta } from '@rapidclash/shared';

interface Props {
  meta: GameMeta;
  onJoin(stake: number): void;
  onBack(): void;
}

export function StakeEntryScreen({ meta, onJoin, onBack }: Props) {
  const [stake, setStake] = useState(meta.bet.minStake);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onJoin(stake);
  }

  return (
    <div className="screen">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button className="btn-ghost btn" style={{ width: 'auto' }} onClick={onBack}>←</button>
        <h1>{meta.displayName}</h1>
      </div>
      <form onSubmit={handleSubmit}>
        <label htmlFor="stake" style={{ display: 'block', marginBottom: 8, color: 'var(--muted)' }}>
          Stake (credits)
        </label>
        <input
          id="stake"
          className="input"
          type="number"
          min={meta.bet.minStake}
          max={meta.bet.maxStake}
          value={stake}
          onChange={e => setStake(Math.min(meta.bet.maxStake, Math.max(meta.bet.minStake, Number(e.target.value))))}
          aria-label="stake amount"
        />
        <p style={{ marginBottom: 16 }}>Range: {meta.bet.minStake}–{meta.bet.maxStake} credits</p>
        <button className="btn" type="submit">Join Lobby</button>
      </form>
    </div>
  );
}
