import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Outcome, SettlementSummary } from '@rapidclash/shared';

interface Props {
  outcome: Outcome;
  settlement: SettlementSummary;
  playerId?: string;
  onPlayAgain(): void;
  onLeaderboard(): void;
}

type ResultKind = 'win' | 'lose' | 'neutral';

function resultInfo(outcome: Outcome, playerId?: string): { kind: ResultKind; text: string } {
  if (outcome.type === 'draw') return { kind: 'neutral', text: 'Draw! 🤝' };
  if (outcome.type === 'void') return { kind: 'neutral', text: 'Match voided' };
  const didWin = playerId === undefined || outcome.winner === playerId;
  return didWin ? { kind: 'win', text: 'You Won! 🏆' } : { kind: 'lose', text: 'You Lost 😔' };
}

const kindStyle: Record<ResultKind, { card: string; text: string }> = {
  win: { card: 'border-green-500/40 bg-green-500/10', text: 'text-green-400' },
  lose: { card: 'border-red-500/40 bg-red-500/10', text: 'text-red-400' },
  neutral: { card: 'border-white/15 bg-white/[0.04]', text: 'text-white/70' },
};

export function ResultScreen({ outcome, settlement, playerId, onPlayAgain, onLeaderboard }: Props) {
  const { kind, text } = resultInfo(outcome, playerId);
  const delta = settlement.delta;
  const style = kindStyle[kind];

  const confettiFired = useRef(false);
  useEffect(() => {
    if (kind === 'win' && !confettiFired.current) {
      confettiFired.current = true;
      // Tasteful, single burst — investor-friendly.
      confetti({ particleCount: 110, spread: 75, origin: { y: 0.55 }, disableForReducedMotion: true });
    }
  }, [kind]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0b0e18] px-4 py-8 text-white">
      <div className="w-full max-w-sm">
        <motion.div
          initial={{ opacity: 0, y: -16, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className={cn('relative mb-5 rounded-2xl border px-8 py-6 text-center backdrop-blur-md', style.card)}
        >
          {kind === 'win' && (
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-2xl"
              animate={{
                boxShadow: ['0 0 0px rgba(34,197,94,0)', '0 0 44px rgba(34,197,94,0.18)', '0 0 0px rgba(34,197,94,0)'],
              }}
              transition={{ duration: 1.8, repeat: 1 }}
            />
          )}
          <Trophy className={cn('mx-auto mb-2 h-7 w-7', style.text, kind !== 'win' && 'opacity-40')} />
          <div className={cn('relative text-2xl font-black', style.text)} data-testid="outcome-text">
            {text}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.3 }}
          className="mb-6 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-5 text-center"
        >
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-white/40">Wallet change</p>
          <div
            className={cn('text-3xl font-bold tabular-nums', delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-white/80')}
            data-testid="delta"
          >
            {delta > 0 ? '+' : ''}
            {delta} credits
          </div>
          <p className="mt-3 text-sm text-white/50">
            New balance: <strong className="text-white">{settlement.newBalance.toLocaleString()}</strong> credits
          </p>
        </motion.div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Play Again
          </button>
          <button
            type="button"
            onClick={onLeaderboard}
            className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Leaderboard
          </button>
        </div>
      </div>
    </div>
  );
}
