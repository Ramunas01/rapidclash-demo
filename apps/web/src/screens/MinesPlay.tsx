import { useMemo } from 'react';
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

// 5×5 / 3-mine ruleset (Designer, 2026-09-11 — see docs/NEW_DESIGN_MIGRATION.md § "Canonical
// new Mines ruleset"). NOTE: this file is the MINIMUM fix to keep the screen functional against
// the new engine (right dimensions, right copy) — it is NOT the full visual rebuild to the new
// 5×5 prototype design, which is out of scope here and tracked as a follow-up (see the T7 PR body).
const BOARD_SIZE = 25; // 5×5

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

  // Opponent's safe-count is server-redacted: hidden for the WHOLE round, revealed only once
  // BOTH players have locked (2026-09-11 ruleset — no early resolution, no mid-round chase).
  // We NEVER see their board, in-play or otherwise.
  const oppScore = opp?.score;
  const oppLocked = opp?.locked ?? false;

  // NOTE: the old per-move 5s countdown is removed along with the mechanic it displayed (rule
  // 10 — no per-move timer any more). The engine now runs a single 30s round clock from match
  // start (ADR-012's scheduledDeadlines/lockOnTimeout), which is not yet surfaced through
  // viewFor to the client — showing an accurate live countdown here is follow-up UI work, not
  // this ticket (T7 is the engine rewrite; see the PR body).

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

        {/* Status */}
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
        </div>

        {/* Own 5×5 board. The opponent's board is NEVER rendered (server hides it). */}
        <div
          data-testid="mines-board"
          role="grid"
          aria-label="Your minefield"
          className="grid grid-cols-5 gap-1 rounded-xl border border-white/5 bg-white/[0.02] p-2"
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
              : 'Locked in — waiting for your opponent to finish their round.'
            : 'Tap a tile. Avoid the mines — most safe tiles wins. A mine, 22 safe tiles, or the clock ends your round.'}
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
