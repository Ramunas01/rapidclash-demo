import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Coins, Gamepad2, Minus, Plus, Scissors, Zap, type LucideIcon } from 'lucide-react';
import type { GameMeta, OpenChallenge } from '@rapidclash/shared';
import { cn } from '@/lib/utils';
import { CREDIT_SYMBOL, formatCredits } from '../format.js';
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

/** Screen-scoped art so the hero matches the Base44 lobby look. Presentation only —
 *  the playable name/stakes come from GameMeta. Unknown games fall back to a generic icon. */
const GAME_ICON: Record<string, LucideIcon> = {
  rps: Scissors,
  coinflip: Coins,
};

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
  const Icon = GAME_ICON[meta.id] ?? Gamepad2;

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
    <div className="min-h-screen bg-[#0b0e18] text-white">
      <div className="mx-auto max-w-md px-4 py-4">
        {/* Header / back */}
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-sm font-medium text-white/70">Lobby</span>
        </div>

        {/* Game hero — play-money framing (no crypto / deposit / buy-chips). */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative mb-6 overflow-hidden rounded-2xl border border-brand/30 p-5"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[#2d0f6b] via-[#1e0a4a] to-[#0b0818]" />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(139,61,255,0.35) 0%, transparent 65%)' }}
          />
          <div className="absolute right-6 top-1/2 -translate-y-1/2 opacity-10">
            <Icon className="h-28 w-28" />
          </div>
          <div className="relative z-10 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/10 backdrop-blur-sm">
              <Icon className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{meta.displayName}</h1>
              <p className="mt-1 text-sm text-white/70">
                Play-money duel · {meta.minPlayers === meta.maxPlayers ? `${meta.minPlayers} players` : `${meta.minPlayers}–${meta.maxPlayers} players`} · ~{meta.averageDurationSec}s
              </p>
            </div>
          </div>
        </motion.div>

        {/* Stake card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.4 }}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
        >
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Zap className="h-5 w-5 text-brand" /> Set Your Stake
          </h2>

          <form onSubmit={handleSubmit}>
            <label htmlFor="stake" className="mb-2 block text-xs font-medium text-white/50">
              Stake (play-money credits)
            </label>

            {/* − [ value ] +  — steppers work on every device (the native number spinner doesn't on mobile). */}
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                aria-label="decrease stake"
                data-testid="stake-decrement"
                onClick={() => step(-1)}
                disabled={current <= minStake}
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Minus className="h-5 w-5" />
              </button>
              <input
                id="stake"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                min={minStake}
                max={maxStake}
                value={stakeText}
                onChange={e => handleChange(e.target.value)}
                onBlur={handleBlur}
                aria-label="stake amount"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#0b0e18] py-2 text-center text-2xl font-bold text-white outline-none transition-colors focus:border-brand"
              />
              <button
                type="button"
                aria-label="increase stake"
                data-testid="stake-increment"
                onClick={() => step(1)}
                disabled={current >= maxStake}
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>

            {/* Quick-pick chips. */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {chips.map(v => (
                <button
                  key={v}
                  type="button"
                  data-testid={`stake-chip-${v}`}
                  onClick={() => pick(v)}
                  className={cn(
                    'rounded-lg border py-2 text-sm font-medium transition-all',
                    current === v
                      ? 'border-brand bg-brand text-white'
                      : 'border-white/10 bg-white/5 text-white/70 hover:border-brand/50 hover:text-white',
                  )}
                >
                  {formatCredits(v)}
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs text-white/50">Range: {minStake}–{maxStake}{CREDIT_SYMBOL}</p>
            {error && (
              <p className="mt-2 text-sm text-red-400" data-testid="stake-error" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-brand to-indigo-600 py-3.5 text-base font-bold text-white shadow-lg shadow-brand/20 transition-all hover:from-brand hover:to-indigo-500 hover:shadow-brand/30"
            >
              Join Lobby
            </button>
          </form>
        </motion.div>

        {/* Tap a resting bet to claim it instantly — its own stake, not the typed amount. */}
        <div className="mt-6">
          <OpenChallengesList
            entries={challenges}
            more={challengesMore}
            notice={challengeNotice}
            onTake={onTakeChallenge}
          />
        </div>
      </div>
    </div>
  );
}
