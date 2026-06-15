import { useState, useEffect, type FormEvent } from 'react';
import type { GameMeta, OpenChallenge } from '@rapidclash/shared';
import { OpenChallengesList } from './OpenChallengesList.js';

interface Props {
  meta: GameMeta;
  onJoin(stake: number): void;
  onBack(): void;
  /** Open-challenge feed for this game (managed in App; this screen subscribes on mount). */
  challenges: OpenChallenge[];
  challengesMore: number;
  challengeNotice: string | null;
  onSubscribe(): void;
  onUnsubscribe(): void;
  /** Tap a listed challenge → claim it at ITS stake (independent of the typed amount). */
  onTakeChallenge(matchId: string): void;
}

export function StakeEntryScreen({
  meta,
  onJoin,
  onBack,
  challenges,
  challengesMore,
  challengeNotice,
  onSubscribe,
  onUnsubscribe,
  onTakeChallenge,
}: Props) {
  const [stake, setStake] = useState(meta.bet.minStake);

  // Subscribe to the open-challenge feed while this screen is visible; unsubscribe on leave.
  useEffect(() => {
    onSubscribe();
    return () => onUnsubscribe();
    // eslint-disable-next-line -- subscribe/unsubscribe exactly once per screen visit
  }, []);

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

      {/* Tap a resting bet to claim it instantly — its own stake, not the typed amount. */}
      <OpenChallengesList
        entries={challenges}
        more={challengesMore}
        notice={challengeNotice}
        onTake={onTakeChallenge}
      />
    </div>
  );
}
