import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ShipsBattleView, ShipsBoardView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

// ── Geometry mirror (display/UX only; the SERVER validates every move + adjudicates) ───────────
const DIM = 10;
const CELLS = DIM * DIM;
const SHIP_SIZES = [5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1];
const PLACEMENT_SECONDS = 60;
const SHOT_SECONDS = 20;

const rowOf = (i: number) => Math.floor(i / DIM);
const colOf = (i: number) => i % DIM;
const ix = (r: number, c: number) => r * DIM + c;
const onBoard = (r: number, c: number) => r >= 0 && r < DIM && c >= 0 && c < DIM;
function edgeN(i: number): number[] {
  const r = rowOf(i), c = colOf(i), out: number[] = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (onBoard(r + dr, c + dc)) out.push(ix(r + dr, c + dc));
  return out;
}
function eightN(i: number): number[] {
  const r = rowOf(i), c = colOf(i), out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && onBoard(r + dr, c + dc)) out.push(ix(r + dr, c + dc));
  return out;
}

/** A 1Hz local clock for the cosmetic countdowns (the server runs the authoritative timer). */
function useTick(active: boolean): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return n;
}

type ShipsMove = { t: 'add'; c: number } | { t: 'remove'; c: number } | { t: 'auto' } | { t: 'fire'; c: number };

/** Greyed 10×10 preview shown before a match activates. */
function ShipsIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-3 py-1" data-testid="hub-board">
      <div aria-hidden className="grid grid-cols-10 gap-0.5 rounded-xl border border-border bg-surface/40 p-2 opacity-50">
        {Array.from({ length: CELLS }, (_, i) => <div key={i} className="aspect-square w-6 rounded-[3px] bg-sky-950/60" />)}
      </div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/** A single grid cell button. */
function Cell({ i, className, onClick, label, disabled, testid }: { i: number; className: string; onClick?: () => void; label?: string; disabled?: boolean; testid?: string }) {
  return (
    <button
      type="button"
      data-testid={testid}
      disabled={disabled}
      onClick={onClick}
      aria-label={`cell ${rowOf(i)},${colOf(i)}`}
      className={cn('flex aspect-square w-6 items-center justify-center rounded-[3px] text-[10px] font-black transition-transform active:scale-90 disabled:cursor-default', className)}
    >
      {label}
    </button>
  );
}

/**
 * PLACEMENT builder (the connected-cell grow-the-ship UX). Cell colour = state: locked Ship (white),
 * current Selected (green), Eligible frontier/start (grey-greenish), Halo (dark, blocked), Inert
 * (grey). Eligibility mirrors the server's frontier rules; the server validates each tap. Build
 * largest-first; the current ship auto-locks at its size. Auto-place fills the rest (seeded server-side).
 */
function Builder({ board, send, secondsLeft }: { board: ShipsBoardView; send: (m: ShipsMove) => void; secondsLeft: number }) {
  const locked = new Set(board.ships.flat());
  const current = new Set(board.current);
  const halo = new Set<number>();
  for (const ship of board.ships) for (const c of ship) for (const n of eightN(c)) if (!locked.has(n)) halo.add(n);

  // Eligible = start cells (current empty) or frontier cells (extending the current ship).
  const eligible = new Set<number>();
  if (board.current.length === 0) {
    for (let i = 0; i < CELLS; i++) if (!locked.has(i) && !halo.has(i)) eligible.add(i);
  } else {
    for (const c of board.current) for (const n of edgeN(c)) if (!current.has(n) && !locked.has(n) && !halo.has(n)) eligible.add(n);
  }

  const shipsDone = board.ships.length;
  const targetSize = SHIP_SIZES[shipsDone] ?? 0;

  const cellClass = (i: number) =>
    locked.has(i) ? 'bg-white text-zinc-900'
      : current.has(i) ? 'bg-emerald-500 text-white ring-2 ring-emerald-300'
      : eligible.has(i) ? 'bg-emerald-800/50 hover:bg-emerald-700/60'
      : halo.has(i) ? 'bg-zinc-900'
      : 'bg-sky-950/70';

  return (
    <div className="flex flex-col items-center gap-3" data-testid="hub-board">
      <div className="flex w-full items-center justify-between text-xs">
        <span data-testid="sb-progress" className="font-bold text-foreground">
          Building ship {Math.min(shipsDone + 1, 15)}/15 · size {targetSize || '—'}
        </span>
        <span data-testid="sb-timer" className={cn('rounded-full border px-2 py-0.5 font-bold tabular-nums', secondsLeft <= 10 ? 'border-destructive/50 text-destructive' : 'border-border text-muted-foreground')}>
          {secondsLeft}s
        </span>
      </div>
      <div className="grid grid-cols-10 gap-0.5 rounded-xl border border-border bg-surface/40 p-2">
        {Array.from({ length: CELLS }, (_, i) => (
          <Cell
            key={i}
            i={i}
            testid={`sb-cell-${i}`}
            className={cellClass(i)}
            disabled={!current.has(i) && !eligible.has(i)}
            onClick={() => (current.has(i) ? send({ t: 'remove', c: i }) : eligible.has(i) ? send({ t: 'add', c: i }) : undefined)}
          />
        ))}
      </div>
      <button
        type="button"
        data-testid="sb-auto"
        onClick={() => send({ t: 'auto' })}
        className="w-full max-w-xs rounded-xl bg-brand py-2.5 text-sm font-black uppercase tracking-wide text-white transition-colors hover:brightness-110"
      >
        Auto-place fleet
      </button>
    </div>
  );
}

/** A read-only board render — my own (ships + incoming shots) or the opponent probe grid. */
function BoardGrid({ board, mode, canFire, onFire, testid }: {
  board: ShipsBoardView; mode: 'own' | 'probe'; canFire?: boolean; onFire?: (c: number) => void; testid: string;
}) {
  const shipCells = new Set(board.ships.flat()); // own: my fleet; probe: revealed SUNK ships only
  const cellClass = (i: number) => {
    const shot = board.shots[i];
    if (mode === 'own') {
      if (shipCells.has(i)) return shot === 'hit' ? 'bg-red-600 text-white' : 'bg-slate-300 text-zinc-900';
      return shot === 'miss' ? 'bg-sky-800 text-sky-300' : 'bg-sky-950/70';
    }
    // probe grid: my hits/misses + revealed sunk ships
    if (shipCells.has(i)) return 'bg-red-700 text-white'; // a sunk ship cell
    if (shot === 'hit') return 'bg-red-600 text-white';
    if (shot === 'miss') return 'bg-sky-800 text-sky-400';
    return 'bg-sky-950/70 hover:bg-sky-900/80';
  };
  const label = (i: number) => {
    const shot = board.shots[i];
    if (mode === 'probe' && shipCells.has(i)) return '✕';
    if (shot === 'hit') return '✕';
    if (shot === 'miss') return '·';
    return '';
  };
  return (
    <div data-testid={testid} className="grid grid-cols-10 gap-0.5 rounded-xl border border-border bg-surface/40 p-2">
      {Array.from({ length: CELLS }, (_, i) => {
        const probeable = mode === 'probe' && canFire && board.shots[i] === undefined && !shipCells.has(i);
        return (
          <Cell
            key={i}
            i={i}
            testid={mode === 'probe' ? `sb-probe-${i}` : `sb-own-${i}`}
            className={cellClass(i)}
            label={label(i)}
            disabled={!probeable}
            onClick={probeable ? () => onFire?.(i) : undefined}
          />
        );
      })}
    </div>
  );
}

/** The live Ships Battle area: PLACEMENT builder → SHOOTING two-boards. */
function ShipsBattleBoard({ gameState, onMove, playerId, opponentId, serverClockOffset = 0 }: GameAreaArgs) {
  const view = gameState as ShipsBattleView | null;
  const send = onMove as unknown as (m: ShipsMove) => void;
  const me = playerId, opp = opponentId;
  const tick = useTick(true);
  if (!view || !me || !opp) return <div data-testid="hub-board" />;
  const myBoard = view.boards[me];
  const oppBoard = view.boards[opp];
  const now = tick + serverClockOffset;

  if (view.phase === 'placement') {
    if (!myBoard || !myBoard.placementDone) {
      const left = Math.max(0, Math.ceil((view.placementStartedAt + PLACEMENT_SECONDS * 1000 - now) / 1000));
      return myBoard ? <Builder board={myBoard} send={send} secondsLeft={left} /> : <div data-testid="hub-board" />;
    }
    return (
      <div className="flex flex-col items-center gap-3" data-testid="hub-board">
        <p data-testid="sb-ready" className="text-sm font-bold text-success">✓ Fleet ready</p>
        <p className="text-xs text-muted-foreground">Waiting for your opponent to place…</p>
        <BoardGrid board={myBoard} mode="own" testid="sb-own-grid" />
      </div>
    );
  }

  // Shooting.
  const myTurn = view.turn === me;
  const shotLeft = Math.max(0, Math.ceil((view.turnStartedAt + SHOT_SECONDS * 1000 - now) / 1000));
  return (
    <div className="flex flex-col items-center gap-3" data-testid="hub-board">
      <div className="flex w-full items-center justify-between text-xs">
        <span data-testid="sb-turn" className={cn('font-bold', myTurn ? 'text-brand' : 'text-muted-foreground')}>
          {myTurn ? 'Your shot — fire at their sea' : "Opponent's turn…"}
        </span>
        {myTurn && (
          <span data-testid="sb-timer" className={cn('rounded-full border px-2 py-0.5 font-bold tabular-nums', shotLeft <= 5 ? 'border-destructive/50 text-destructive' : 'border-border text-muted-foreground')}>
            {shotLeft}s
          </span>
        )}
      </div>
      <p className="self-start text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Enemy waters</p>
      <BoardGrid board={oppBoard} mode="probe" canFire={myTurn} onFire={(c) => send({ t: 'fire', c })} testid="sb-probe-grid" />
      <p className="self-start text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Your fleet</p>
      <BoardGrid board={myBoard} mode="own" testid="sb-own-grid" />
    </div>
  );
}

function ShipsBattlePanel(args: GameAreaArgs) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      {args.phase === 'in-match' ? <ShipsBattleBoard {...args} /> : <ShipsIdle phase={args.phase} />}
    </div>
  );
}

/**
 * Ships Battle Hub = the shared GameHub + the two-phase play area: the connected-cell PLACEMENT
 * builder (largest-first, frontier-highlighted, auto-place), then alternating SHOOTING over two
 * boards (your probe grid of the enemy + your own fleet under incoming fire). The validator, the
 * hit/miss/sink+halo adjudication, the redaction (you never see an un-sunk enemy ship), the seeded
 * auto-place/auto-fire and the per-player timers are all server-authoritative. See docs/SHIPS_BATTLE.md.
 */
export function ShipsBattleHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="ships-battle" gameName="Ships Battle" renderGameArea={ShipsBattlePanel} {...props} />;
}
