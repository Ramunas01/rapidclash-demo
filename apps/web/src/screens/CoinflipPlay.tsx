import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CoinflipView } from '../App.js';

const SIDES = [
  { id: 'heads', label: 'Heads' },
  { id: 'tails', label: 'Tails' },
] as const;

interface Props {
  playerId: string;
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  opponentId: string;
  gameState: CoinflipView | null;
  legalMoves: string[];
  onMove(move: string): void;
  onForfeit(): void;
}

function sideLabel(side: string | undefined): string {
  return SIDES.find((s) => s.id === side)?.label ?? '?';
}

/** Tailwind face-gradients lifted from the export's CoinDisplay (amber heads / indigo tails). */
const coinFace: Record<'heads' | 'tails', string> = {
  heads: 'from-amber-300 via-amber-500 to-amber-700 text-amber-900/40',
  tails: 'from-indigo-400 via-indigo-500 to-indigo-700 text-indigo-950/40',
};

export function CoinflipPlayScreen({
  playerId,
  username,
  opponentId: _opponentId,
  gameState,
  legalMoves,
  onMove,
  onForfeit,
}: Props) {
  const canMove = legalMoves.length > 0;
  const isCaller = gameState != null && playerId === gameState.caller;
  const call = gameState?.call;
  const result = gameState?.result;

  // Terminal = the server has revealed the flip, or the match was forced (forfeit/void).
  // The flip `result` is PRESENT ONLY at terminal — pre-terminal viewFor strips it, so
  // its mere presence is the reveal signal. NEVER infer or render it before then.
  const isTerminal = gameState != null && (result !== undefined || gameState.forcedOutcome !== undefined);

  // Caller wins iff call === result; the local player wins iff that matches their role.
  const localWon = result !== undefined && call !== undefined && (call === result) === isCaller;

  const confettiFired = useRef(false);
  useEffect(() => {
    if (localWon && !confettiFired.current) {
      confettiFired.current = true;
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, disableForReducedMotion: true });
    }
  }, [localWon]);

  const face = (result as 'heads' | 'tails' | undefined) ?? 'heads';

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0e18] text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-6">
        <h1 className="mb-2 flex items-center justify-center gap-2 text-xl font-bold">
          <Coins className="h-5 w-5 text-brand" />
          Coinflip
        </h1>
        {username && (
          <p data-testid="play-you" className="mb-6 text-center text-xs font-medium text-white/60">
            You (<strong className="text-white">{username}</strong>)
          </p>
        )}

        {/* The coin: spinning suspense until the server includes `result` at terminal. */}
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="relative h-40 w-40" style={{ perspective: '800px' }}>
            {isTerminal && result ? (
              <motion.div
                initial={{ rotateY: 540, scale: 0.9 }}
                animate={{ rotateY: 0, scale: 1 }}
                transition={{ duration: 0.8, ease: [0.15, 0, 0.2, 1] }}
                aria-hidden
                className={cn(
                  'flex h-40 w-40 items-center justify-center rounded-full bg-gradient-to-br text-6xl font-black shadow-[0_8px_28px_rgba(0,0,0,0.4)]',
                  coinFace[face],
                  localWon ? 'ring-2 ring-green-400/60' : 'ring-2 ring-white/10',
                )}
              >
                {face === 'heads' ? 'H' : 'T'}
              </motion.div>
            ) : (
              <motion.div
                animate={{ rotateY: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                aria-hidden
                className="flex h-40 w-40 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 via-purple-600 to-indigo-800 text-6xl font-black text-white/40 shadow-[0_8px_28px_rgba(0,0,0,0.4)]"
              >
                ?
              </motion.div>
            )}
          </div>
          <div
            className={cn('text-xl font-bold', isTerminal && result ? 'text-white' : 'text-white/50')}
            data-testid="flip-result"
          >
            {isTerminal && result ? sideLabel(result) : '?'}
          </div>
        </div>

        {/* The call is PUBLIC once made — show it to both players. */}
        {call && (
          <p className="mb-4 text-center text-sm" data-testid="call-status">
            {isCaller ? 'You called ' : 'Opponent called '}
            <strong className="text-brand">{sideLabel(call)}</strong>
          </p>
        )}

        {isCaller ? (
          <div className="grid grid-cols-2 gap-3" role="group" aria-label="Coin call">
            {SIDES.map(({ id, label }) => {
              const accent =
                id === 'heads'
                  ? 'hover:border-amber-500/50 focus-visible:ring-amber-400'
                  : 'hover:border-indigo-500/50 focus-visible:ring-indigo-400';
              const dot = id === 'heads' ? 'bg-amber-400' : 'bg-indigo-400';
              return (
                <motion.button
                  key={id}
                  type="button"
                  whileHover={canMove ? { scale: 1.02 } : undefined}
                  whileTap={canMove ? { scale: 0.97 } : undefined}
                  onClick={() => onMove(id)}
                  disabled={!canMove}
                  aria-label={label}
                  data-testid={`move-${id}`}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl border-2 border-white/[0.08] bg-white/[0.03] py-4 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2',
                    accent,
                  )}
                >
                  {label}
                  <span className={cn('h-2 w-2 rounded-full', dot)} />
                </motion.button>
              );
            })}
          </div>
        ) : (
          !isTerminal && (
            <p className="my-4 text-center text-sm text-white/50" data-testid="waiting">
              Waiting for opponent to call…
            </p>
          )
        )}

        {/* Caller has called but the flip hasn't landed yet (resume edge). */}
        {isCaller && call && !isTerminal && (
          <p className="my-2 text-center text-sm text-white/50">Flipping…</p>
        )}

        {!isTerminal && (
          <button
            type="button"
            onClick={onForfeit}
            className="mt-auto pt-6 text-sm font-medium text-white/40 transition-colors hover:text-white/70"
          >
            Forfeit
          </button>
        )}
      </div>
    </div>
  );
}
