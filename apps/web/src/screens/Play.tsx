import { motion } from 'framer-motion';
import { Swords } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RpsView } from '../App.js';

const RPS_CHOICES = [
  { id: 'rock', emoji: '✊', label: 'Rock' },
  { id: 'paper', emoji: '✋', label: 'Paper' },
  { id: 'scissors', emoji: '✌️', label: 'Scissors' },
] as const;

interface Props {
  playerId: string;
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  opponentId: string;
  gameState: RpsView | null;
  legalMoves: string[];
  onMove(move: string): void;
  onForfeit(): void;
}

function getChoiceLabel(choice: string | undefined): string {
  return RPS_CHOICES.find((c) => c.id === choice)?.emoji ?? '?';
}

type RpsResult = 'win' | 'lose' | 'tie';
const BEATS: Record<string, string> = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

/** Cosmetic-only: tint the cards once the match is terminal. Uses the same redacted
 *  state the server reveals at terminal — never inferred earlier. */
function terminalResult(state: RpsView, playerId: string, opponentId: string): RpsResult | null {
  if (state.forcedOutcome) {
    if (state.forcedOutcome.type === 'win') return state.forcedOutcome.winner === playerId ? 'win' : 'lose';
    return 'tie';
  }
  const me = state.choices?.[playerId];
  const opp = state.choices?.[opponentId];
  if (!me || !opp) return null;
  if (me === opp) return 'tie';
  return BEATS[me] === opp ? 'win' : 'lose';
}

const cardTint: Record<RpsResult, string> = {
  win: 'border-green-500/50 bg-green-500/10',
  lose: 'border-red-500/40 bg-red-500/10',
  tie: 'border-white/15 bg-white/[0.04]',
};

export function PlayScreen({ playerId, username, opponentId, gameState, legalMoves, onMove, onForfeit }: Props) {
  const canMove = legalMoves.length > 0;
  const myChoice = gameState?.choices?.[playerId];

  // Terminal: both choices known or forcedOutcome set.
  const isTerminal =
    gameState != null &&
    (gameState.forcedOutcome !== undefined || gameState.players.every((p) => p in (gameState.choices ?? {})));

  // Only show the opponent's choice if terminal — the server sends it redacted before then.
  const opponentChoice = isTerminal ? gameState?.choices?.[opponentId] : undefined;
  const result = isTerminal && gameState ? terminalResult(gameState, playerId, opponentId) : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0e18] text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-6">
        <h1 className="mb-6 flex items-center justify-center gap-2 text-xl font-bold">
          <Swords className="h-5 w-5 text-brand" />
          Rock Paper Scissors
        </h1>

        {/* Battle: You — VS — Opponent (opponent stays hidden until terminal). */}
        <div className="flex items-center justify-center gap-4 sm:gap-6">
          <div className="text-center">
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3 }}
              className={cn(
                'flex h-24 w-24 items-center justify-center rounded-2xl border-2 text-5xl transition-colors duration-300 sm:h-28 sm:w-28',
                result ? cardTint[result] : 'border-brand/40 bg-brand/10',
              )}
            >
              {myChoice ? getChoiceLabel(myChoice) : '—'}
            </motion.div>
            <div data-testid="play-you" className="mt-2 text-xs font-medium text-white/70">
              {username ? <>You (<strong className="text-white">{username}</strong>)</> : 'You'}
            </div>
          </div>

          <div className="text-sm font-bold text-white/30">VS</div>

          <div className="text-center">
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3 }}
              className="flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-purple-500/30 bg-purple-600/10 text-5xl sm:h-28 sm:w-28"
            >
              {/* NEVER show the opponent's choice until terminal. */}
              <span data-testid="opponent-choice">
                {isTerminal && opponentChoice ? getChoiceLabel(opponentChoice) : '🤫'}
              </span>
            </motion.div>
            <div className="mt-2 text-xs font-medium text-white/50">Opponent</div>
          </div>
        </div>

        {myChoice && !isTerminal && (
          <p className="my-5 text-center text-sm text-white/50">Waiting for opponent&apos;s move…</p>
        )}

        {/* Choice buttons — rendered from server-issued legalMoves (disabled otherwise). */}
        <div className="mt-8 grid grid-cols-3 gap-3" role="group" aria-label="RPS choices">
          {RPS_CHOICES.map(({ id, emoji, label }) => (
            <motion.button
              key={id}
              type="button"
              whileHover={canMove ? { scale: 1.05, y: -2 } : undefined}
              whileTap={canMove ? { scale: 0.94 } : undefined}
              onClick={() => onMove(id)}
              disabled={!canMove}
              aria-label={label}
              data-testid={`move-${id}`}
              className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] py-4 transition-colors hover:border-brand/50 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="text-3xl">{emoji}</span>
              <span className="text-xs font-medium text-white/70">{label}</span>
            </motion.button>
          ))}
        </div>

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
