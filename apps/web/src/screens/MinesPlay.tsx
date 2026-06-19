import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bomb, Gem } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MinesView } from '../App.js';

interface Props {
  playerId: string;
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  opponentId: string;
  gameState: MinesView | null;
  /** Server-issued legal moves = this player's still-covered square indices. Empty once locked. */
  legalMoves: number[];
  onMove(move: number): void;
  onForfeit(): void;
}

const BOARD_SIZE = 64; // 8×8
const MOVE_TIMEOUT_MS = 5000;

type CellKind = 'covered' | 'safe' | 'mine' | 'bustedOn';

export function MinesPlayScreen({ playerId, username, opponentId, gameState, legalMoves, onMove, onForfeit }: Props) {
  const me = gameState?.boards?.[playerId];
  const opp = gameState && opponentId ? gameState.boards?.[opponentId] : undefined;

  const round = gameState?.round ?? 0;
  const myUncovered = useMemo(() => new Set(me?.uncovered ?? []), [me?.uncovered]);
  const myScore = me?.uncovered?.length ?? 0;
  const myLocked = me?.locked ?? false;
  const bustedOn = me?.bustedOn;
  // The mine layout is present in my view only once I've locked (busted/cleared); at terminal
  // it also arrives at the top level. Either way it's safe — I have no move left.
  const myMines = useMemo(
    () => new Set(me?.mines ?? gameState?.mines ?? []),
    [me?.mines, gameState?.mines],
  );
  const legalSet = useMemo(() => new Set(legalMoves), [legalMoves]);
  const canMove = !myLocked && legalMoves.length > 0;

  // Opponent's safe-count is server-redacted: undefined while both are active, a number once
  // either player has locked (the target you race / the chase). We NEVER see their board.
  const oppScore = opp?.score;
  const oppLocked = opp?.locked ?? false;

  // ── Per-player 5s move countdown ──────────────────────────────────────────
  // The server runs the authoritative per-player clock and auto-reveals on expiry (#91);
  // this is the matching visual. Reset whenever MY board advances (a reveal, a lock, or a
  // fresh replay round) — NOT on the opponent's moves, which never touch my board.
  const [secondsLeft, setSecondsLeft] = useState(MOVE_TIMEOUT_MS / 1000);
  const resetKey = `${round}:${myScore}:${myLocked}`;
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setSecondsLeft(MOVE_TIMEOUT_MS / 1000);
    if (tickRef.current) clearInterval(tickRef.current);
    if (myLocked) return; // locked → no clock (waiting on the opponent / the chase)
    tickRef.current = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [resetKey, myLocked]);

  function cellKind(i: number): CellKind {
    if (bustedOn === i) return 'bustedOn';
    if (myUncovered.has(i)) return 'safe';
    if (myMines.has(i)) return 'mine'; // revealed only once I'm locked
    return 'covered';
  }

  const myStatus = myLocked
    ? bustedOn !== undefined
      ? 'Busted'
      : 'Board cleared'
    : 'Your move';

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0e18] text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-6">
        <h1 className="mb-2 flex items-center justify-center gap-2 text-xl font-bold">
          <Bomb className="h-5 w-5 text-brand" />
          Mines
        </h1>

        {/* You / opponent count (chase) / round */}
        <div className="mb-3 flex items-center justify-between text-xs">
          <span data-testid="play-you" className="font-medium text-white/60">
            {username ? <>You (<strong className="text-white">{username}</strong>)</> : 'You'}
            <span className="ml-1 text-white/30">· {myScore} safe</span>
          </span>
          {round > 0 && (
            <span data-testid="round-indicator" className="rounded-full bg-white/5 px-2 py-0.5 text-white/50">
              Round {round + 1}
            </span>
          )}
          <span data-testid="opponent-count" className="font-medium text-white/60">
            Opponent ·{' '}
            {oppScore !== undefined ? (
              <strong className="text-white">{oppScore} safe</strong>
            ) : (
              <span className="text-white/30" aria-label="hidden">🙈</span>
            )}
            {oppLocked && <span className="ml-1 text-white/30">locked</span>}
          </span>
        </div>

        {/* Status + per-move countdown */}
        <div className="mb-3 flex items-center justify-between">
          <span
            data-testid="my-status"
            className={cn(
              'text-sm font-semibold',
              myLocked ? (bustedOn !== undefined ? 'text-red-400' : 'text-green-400') : 'text-brand',
            )}
          >
            {myStatus}
          </span>
          {!myLocked && (
            <span
              data-testid="move-timer"
              className={cn(
                'flex h-7 min-w-7 items-center justify-center rounded-full border px-2 text-xs font-bold tabular-nums',
                secondsLeft <= 2 ? 'border-red-500/50 bg-red-500/10 text-red-300' : 'border-white/15 bg-white/5 text-white/70',
              )}
              aria-label={`${secondsLeft} seconds to auto-reveal`}
            >
              {secondsLeft}s
            </span>
          )}
        </div>

        {/* Own 8×8 board. The opponent's board is NEVER rendered (server hides it). */}
        <div
          data-testid="mines-board"
          role="grid"
          aria-label="Your minefield"
          className="grid grid-cols-8 gap-1 rounded-xl border border-white/5 bg-white/[0.02] p-2"
        >
          {Array.from({ length: BOARD_SIZE }, (_, i) => {
            const kind = cellKind(i);
            const clickable = kind === 'covered' && canMove && legalSet.has(i);
            return (
              <motion.button
                key={i}
                type="button"
                role="gridcell"
                disabled={!clickable}
                onClick={() => clickable && onMove(i)}
                aria-label={`Square ${i}${kind === 'covered' ? '' : ` (${kind})`}`}
                data-testid={`cell-${i}`}
                data-kind={kind}
                whileHover={clickable ? { scale: 1.08 } : undefined}
                whileTap={clickable ? { scale: 0.92 } : undefined}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-md text-[10px] transition-colors',
                  kind === 'covered' &&
                    (clickable
                      ? 'cursor-pointer border border-white/10 bg-gradient-to-b from-purple-500/40 to-indigo-700/40 hover:from-purple-500/60 hover:to-indigo-700/60'
                      : 'cursor-not-allowed border border-white/5 bg-white/[0.04]'),
                  kind === 'safe' && 'border border-violet-400/20 bg-violet-500/10 text-violet-200',
                  kind === 'mine' && 'border border-white/10 bg-white/[0.06] text-white/40',
                  kind === 'bustedOn' && 'border border-red-500/50 bg-red-500/20 text-red-300',
                )}
              >
                {kind === 'safe' && <Gem className="h-3 w-3" />}
                {(kind === 'mine' || kind === 'bustedOn') && <Bomb className="h-3 w-3" />}
              </motion.button>
            );
          })}
        </div>

        <p className="mt-3 text-center text-xs text-white/40">
          {myLocked
            ? oppLocked
              ? 'Resolving…'
              : 'Locked in — watch your opponent race your score.'
            : 'Tap a tile. Avoid the mines — most safe tiles wins. 5s per move.'}
        </p>

        {!myLocked && (
          <button
            type="button"
            onClick={onForfeit}
            className="mt-auto pt-6 text-sm font-medium text-white/40 transition-colors hover:text-white/70"
          >
            Resign
          </button>
        )}
      </div>
    </div>
  );
}
