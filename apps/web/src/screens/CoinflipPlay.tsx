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

type LocalOutcome = 'win' | 'lose' | 'draw' | 'void';
const outcomeCopy: Record<LocalOutcome, { text: string; cls: string }> = {
  win: { text: 'You win! 🏆', cls: 'text-green-400' },
  lose: { text: 'You lose 😔', cls: 'text-red-400' },
  draw: { text: 'Draw — same side 🤝', cls: 'text-white/70' },
  void: { text: 'Match voided', cls: 'text-white/70' },
};

export function CoinflipPlayScreen({ playerId, username, opponentId, gameState, legalMoves, onMove, onForfeit }: Props) {
  const canMove = legalMoves.length > 0;
  const myChoice = gameState?.choices?.[playerId];
  const result = gameState?.result;

  // Terminal: both players have chosen (server reveals both + result), or forcedOutcome set.
  // Same gating as RPS — the server sends a redacted view before then. NEVER reveal early.
  const isTerminal =
    gameState != null &&
    (gameState.forcedOutcome !== undefined || gameState.players.every((p) => p in (gameState.choices ?? {})));

  // The opponent's choice and the flip are ONLY available at terminal.
  const opponentChoice = isTerminal ? gameState?.choices?.[opponentId] : undefined;
  const showFlip = isTerminal && result !== undefined;

  // Local outcome (cosmetic) — only computed from the revealed terminal state.
  let localOutcome: LocalOutcome | null = null;
  if (isTerminal && gameState) {
    if (gameState.forcedOutcome) {
      localOutcome = gameState.forcedOutcome.type === 'win'
        ? gameState.forcedOutcome.winner === playerId ? 'win' : 'lose'
        : gameState.forcedOutcome.type === 'draw' ? 'draw' : 'void';
    } else if (myChoice !== undefined && opponentChoice !== undefined) {
      localOutcome = myChoice === opponentChoice ? 'draw' : myChoice === result ? 'win' : 'lose';
    }
  }
  const localWon = localOutcome === 'win';

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
          <p data-testid="play-you" className="mb-4 text-center text-xs font-medium text-white/60">
            You (<strong className="text-white">{username}</strong>)
          </p>
        )}

        {/* The coin: spinning suspense until the server reveals `result` at terminal. */}
        <div className="flex flex-col items-center gap-3 py-4">
          <div className="relative h-40 w-40" style={{ perspective: '800px' }}>
            {showFlip ? (
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
          <div className={cn('text-xl font-bold', showFlip ? 'text-white' : 'text-white/50')} data-testid="flip-result">
            {showFlip ? sideLabel(result) : '?'}
          </div>
        </div>

        {/* Picks — your own is always visible; the opponent's stays hidden until terminal. */}
        <div className="mb-4 flex items-stretch justify-center gap-3 text-center">
          <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] py-2">
            <p className="text-[10px] uppercase tracking-wide text-white/40">Your pick</p>
            <p className="text-sm font-semibold text-white" data-testid="my-pick">{myChoice ? sideLabel(myChoice) : '—'}</p>
          </div>
          <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] py-2">
            <p className="text-[10px] uppercase tracking-wide text-white/40">Opponent</p>
            {/* NEVER reveal the opponent's choice until terminal. */}
            <p className="text-sm font-semibold text-white" data-testid="opponent-pick">
              {isTerminal && opponentChoice ? sideLabel(opponentChoice) : '🤫'}
            </p>
          </div>
        </div>

        {isTerminal && localOutcome && (
          <p className={cn('mb-4 text-center text-lg font-black', outcomeCopy[localOutcome].cls)} data-testid="cf-outcome">
            {outcomeCopy[localOutcome].text}
          </p>
        )}

        {/* Both players choose a side (no caller). Rendered from server legalMoves; disabled once chosen. */}
        {!isTerminal && (
          <div className="grid grid-cols-2 gap-3" role="group" aria-label="Coin side">
            {SIDES.map(({ id, label }) => {
              const accent =
                id === 'heads'
                  ? 'hover:border-amber-500/50 focus-visible:ring-amber-400'
                  : 'hover:border-indigo-500/50 focus-visible:ring-indigo-400';
              const dot = id === 'heads' ? 'bg-amber-400' : 'bg-indigo-400';
              const picked = myChoice === id;
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
                    'flex items-center justify-center gap-2 rounded-xl border-2 bg-white/[0.03] py-4 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2',
                    picked ? 'border-brand/60' : 'border-white/[0.08]',
                    accent,
                  )}
                >
                  {label}
                  <span className={cn('h-2 w-2 rounded-full', dot)} />
                </motion.button>
              );
            })}
          </div>
        )}

        {myChoice && !isTerminal && (
          <p className="my-4 text-center text-sm text-white/50" data-testid="waiting">
            Locked in — waiting for opponent…
          </p>
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
