import { useState, useEffect, useMemo, type FormEvent } from 'react';
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
  const { minStake, maxStake } = meta.bet;

  // The field is an editable STRING so it can be cleared and retyped on mobile.
  // We do NOT clamp per keystroke (the old bug) — clamp/validate on blur + submit.
  const [stakeText, setStakeText] = useState(String(minStake));
  const [error, setError] = useState('');

  const clamp = (n: number) => Math.min(maxStake, Math.max(minStake, n));

  // Quick-pick chips: min, a sensible middle, max (deduped + ordered).
  const chips = useMemo(() => {
    const mid = clamp(Math.round((minStake + maxStake) / 2));
    return [...new Set([minStake, mid, maxStake])].sort((a, b) => a - b);
    // eslint-disable-next-line -- min/max are stable for the screen's lifetime
  }, [minStake, maxStake]);

  // Subscribe to the open-challenge feed while this screen is visible; unsubscribe on leave.
  useEffect(() => {
    onSubscribe();
    return () => onUnsubscribe();
    // eslint-disable-next-line -- subscribe/unsubscribe exactly once per screen visit
  }, []);

  // Effective current value (empty field counts as the minimum for stepper bounds).
  const current = stakeText === '' ? minStake : Number(stakeText);

  function handleChange(value: string) {
    // Digits only; empty/partial is allowed mid-edit (no clamping here).
    setStakeText(value.replace(/[^0-9]/g, ''));
    if (error) setError('');
  }

  function handleBlur() {
    // Clamp a typed value into range on blur; leave an empty field empty so it stays editable.
    if (stakeText !== '') setStakeText(String(clamp(Number(stakeText))));
  }

  function step(delta: number) {
    setStakeText(String(clamp(current + delta)));
    setError('');
  }

  function pick(value: number) {
    setStakeText(String(value));
    setError('');
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const n = Number(stakeText);
    if (stakeText.trim() === '' || !Number.isInteger(n) || n < minStake || n > maxStake) {
      setError(`Enter a stake between ${minStake} and ${maxStake} credits.`);
      return;
    }
    setError('');
    onJoin(n);
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

        {/* − [ value ] +  — steppers work on every device (the native number spinner doesn't on mobile). */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
          <button
            type="button"
            className="btn btn-secondary stake-step"
            aria-label="decrease stake"
            data-testid="stake-decrement"
            onClick={() => step(-1)}
            disabled={current <= minStake}
          >
            −
          </button>
          <input
            id="stake"
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            min={minStake}
            max={maxStake}
            value={stakeText}
            onChange={e => handleChange(e.target.value)}
            onBlur={handleBlur}
            aria-label="stake amount"
            style={{ textAlign: 'center', marginBottom: 0 }}
          />
          <button
            type="button"
            className="btn btn-secondary stake-step"
            aria-label="increase stake"
            data-testid="stake-increment"
            onClick={() => step(1)}
            disabled={current >= maxStake}
          >
            +
          </button>
        </div>

        {/* Quick-pick chips. */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {chips.map(v => (
            <button
              key={v}
              type="button"
              className="btn btn-secondary"
              style={{ width: 'auto', flex: '1 1 0', minWidth: 0, padding: '8px 12px' }}
              data-testid={`stake-chip-${v}`}
              onClick={() => pick(v)}
            >
              {v}
            </button>
          ))}
        </div>

        <p style={{ margin: '16px 0 8px' }}>Range: {minStake}–{maxStake} credits</p>
        {error && <p className="error-msg" data-testid="stake-error">{error}</p>}
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
