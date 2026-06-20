import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bomb, Gem } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MinesView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

const BOARD_SIZE = 64; // 8×8
const MOVE_TIMEOUT_MS = 5000;

type CellKind = 'covered' | 'safe' | 'mine' | 'bustedOn';

/** Greyed preview shown in Idle/Waiting — a dimmed 8×8 grid, the visual anchor before a
 *  match activates it (mirrors RpsIdle / CoinflipIdle). */
function MinesIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-1">
      <div
        aria-hidden
        className="grid w-full grid-cols-8 gap-1 rounded-xl border border-border bg-surface/40 p-2 opacity-50"
      >
        {Array.from({ length: BOARD_SIZE }, (_, i) => (
          <div key={i} className="aspect-square rounded-md border border-border/60 bg-background" />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/**
 * The live in-match board — MinesPlay's own 8×8 grid lifted into the GameHub slot, v2-tokenised.
 * Covered tiles fire onMove(index), gated by the server-issued legalMoves (this player's still-
 * covered squares). Own uncovered-safe / busted / mine cells render once known; the opponent's
 * board is NEVER rendered (viewFor redaction), and their safe-count appears only once someone
 * locks (the chase). An internal draw-replay re-deals the board within the same match — the cells
 * derive straight from gameState, so a new round (round bumps, uncovered resets) re-covers the
 * board on its own; only the decisive match.end surfaces the GameHub result overlay.
 */
function MinesBoard({ playerId, opponentId, username, gameState, legalMoves, onMove, onForfeit }: GameAreaArgs) {
  const view = gameState as MinesView | null;
  // Mines moves are square indices: legalMoves/onMove are number-valued here (the GameHub slot
  // types them as string for the generic games — narrow them back for Mines).
  const legalIdx = legalMoves as unknown as number[];
  const moveIdx = onMove as unknown as (i: number) => void;

  const me = playerId ? view?.boards?.[playerId] : undefined;
  const opp = view && opponentId ? view.boards?.[opponentId] : undefined;

  const round = view?.round ?? 0;
  const myUncovered = useMemo(() => new Set(me?.uncovered ?? []), [me?.uncovered]);
  const myScore = me?.uncovered?.length ?? 0;
  const myLocked = me?.locked ?? false;
  const bustedOn = me?.bustedOn;
  // The mine layout is present in my view only once I've locked (busted/cleared); at terminal
  // it also arrives at the top level. Either way it's safe — I have no move left.
  const myMines = useMemo(
    () => new Set(me?.mines ?? view?.mines ?? []),
    [me?.mines, view?.mines],
  );
  const legalSet = useMemo(() => new Set(legalIdx), [legalIdx]);
  const canMove = !myLocked && legalIdx.length > 0;

  // Opponent's safe-count is server-redacted: undefined while both are active, a number once
  // either player has locked (the target you race / the chase). We NEVER see their board.
  const oppScore = opp?.score;
  const oppLocked = opp?.locked ?? false;

  // ── Per-player 5s move countdown ──────────────────────────────────────────
  // The server runs the authoritative per-player clock and auto-reveals on expiry (#91); this is
  // the matching visual. Reset whenever MY board advances (a reveal, a lock, or a fresh replay
  // round) — NOT on the opponent's moves, which never touch my board.
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

  const myStatus = myLocked ? (bustedOn !== undefined ? 'Busted' : 'Board cleared') : 'Your move';

  return (
    <div className="flex flex-col gap-3" data-testid="hub-board">
      {/* You / opponent count (chase) / round */}
      <div className="flex items-center justify-between text-xs">
        <span data-testid="play-you" className="font-medium text-muted-foreground">
          {username ? <>You (<strong className="text-foreground">{username}</strong>)</> : 'You'}
          <span className="ml-1 text-foreground/40">· {myScore} safe</span>
        </span>
        {round > 0 && (
          <span data-testid="round-indicator" className="rounded-full bg-surface px-2 py-0.5 text-muted-foreground">
            Round {round + 1}
          </span>
        )}
        <span data-testid="opponent-count" className="font-medium text-muted-foreground">
          Opponent ·{' '}
          {oppScore !== undefined ? (
            <strong className="text-foreground">{oppScore} safe</strong>
          ) : (
            <span className="text-foreground/40" aria-label="hidden">🙈</span>
          )}
          {oppLocked && <span className="ml-1 text-foreground/40">locked</span>}
        </span>
      </div>

      {/* Status + per-move countdown */}
      <div className="flex items-center justify-between">
        <span
          data-testid="my-status"
          className={cn(
            'text-sm font-semibold',
            myLocked ? (bustedOn !== undefined ? 'text-destructive' : 'text-success') : 'text-brand',
          )}
        >
          {myStatus}
        </span>
        {!myLocked && (
          <span
            data-testid="move-timer"
            className={cn(
              'flex h-7 min-w-7 items-center justify-center rounded-full border px-2 text-xs font-bold tabular-nums',
              secondsLeft <= 2
                ? 'border-destructive/50 bg-destructive/10 text-destructive'
                : 'border-border bg-surface text-muted-foreground',
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
        className="grid grid-cols-8 gap-1 rounded-xl border border-border bg-surface/40 p-2"
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
              onClick={() => clickable && moveIdx(i)}
              aria-label={`Square ${i}${kind === 'covered' ? '' : ` (${kind})`}`}
              data-testid={`cell-${i}`}
              data-kind={kind}
              whileHover={clickable ? { scale: 1.08 } : undefined}
              whileTap={clickable ? { scale: 0.92 } : undefined}
              className={cn(
                'flex aspect-square items-center justify-center rounded-md text-[10px] transition-colors',
                kind === 'covered' &&
                  (clickable
                    ? 'cursor-pointer border border-brand/30 bg-gradient-to-b from-brand/40 to-indigo-700/40 hover:from-brand/60 hover:to-indigo-700/60'
                    : 'cursor-not-allowed border border-border bg-background'),
                kind === 'safe' && 'border border-success/30 bg-success/10 text-success',
                kind === 'mine' && 'border border-border bg-surface text-muted-foreground',
                kind === 'bustedOn' && 'border border-destructive/50 bg-destructive/20 text-destructive',
              )}
            >
              {kind === 'safe' && <Gem className="h-3 w-3" />}
              {(kind === 'mine' || kind === 'bustedOn') && <Bomb className="h-3 w-3" />}
            </motion.button>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
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
          className="pt-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Resign
        </button>
      )}
    </div>
  );
}

/** The Mines game-area slot: greyed idle preview, or the live board in-match. */
function MinesPanel(args: GameAreaArgs) {
  return args.phase === 'in-match' ? <MinesBoard {...args} /> : <MinesIdle phase={args.phase} />;
}

/**
 * Mines Hub = the shared GameHub + a Mines play-panel (own 8×8 board, per-move countdown,
 * opponent-count chase, viewFor redaction). The mechanic, WS flow, per-player timers, internal
 * draw-replay and server-authoritative redaction are unchanged — this is a presentation slot.
 * See docs/MINES.md.
 */
export function MinesHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="mines" gameName="Mines" renderGameArea={MinesPanel} {...props} />;
}
