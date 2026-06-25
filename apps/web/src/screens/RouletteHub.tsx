import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { RouletteView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

// ── Wheel presentation constants (cosmetic; the SERVER is authoritative for resolution). ──────
const CHIP_TOTAL = 1000;
const CHIP_DENOMS = [10, 100, 500] as const;
const BETTING_SECONDS = 30;
/** Standard red pockets (the other 18 of 1–36 are black). Mirrors the module's wheel. */
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const isRed = (n: number) => RED.has(n);

const EVEN_MONEY = [
  { id: 'red', label: 'Red' },
  { id: 'black', label: 'Black' },
  { id: 'odd', label: 'Odd' },
  { id: 'even', label: 'Even' },
  { id: 'low', label: '1–18' },
  { id: 'high', label: '19–36' },
];
const DOZENS = [
  { id: 'd1', label: '1st 12' },
  { id: 'd2', label: '2nd 12' },
  { id: 'd3', label: '3rd 12' },
];
const COLUMNS = [
  { id: 'c1', label: 'Col 1' },
  { id: 'c2', label: 'Col 2' },
  { id: 'c3', label: 'Col 3' },
];

/** The roulette moves (mirrors the module's enumerable move set). */
type RouletteMove =
  | { t: 'place'; bet: string; amount: number }
  | { t: 'unplace'; bet: string }
  | { t: 'clear' }
  | { t: 'lock' }
  | { t: 'spread' };

const sumChips = (a?: Record<string, number>): number =>
  a ? Object.values(a).reduce((s, c) => s + c, 0) : 0;

const colourName = (n: number) => (isRed(n) ? 'Red' : 'Black');

/** Greyed preview shown in Idle/Waiting — the visual anchor before a match activates. */
function RouletteIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-1">
      <div aria-hidden className="grid w-full grid-cols-6 gap-1 rounded-xl border border-border bg-surface/40 p-2 opacity-50">
        {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
          <div
            key={n}
            className={cn(
              'flex aspect-square items-center justify-center rounded-md text-[11px] font-bold text-white/80',
              isRed(n) ? 'bg-red-700/70' : 'bg-zinc-800',
            )}
          >
            {n}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/** A small chip-count badge over a bet cell. */
function ChipBadge({ amount }: { amount: number }) {
  if (!amount) return null;
  return (
    <span
      data-testid="bet-chip"
      className="pointer-events-none absolute -right-1 -top-1 min-w-[18px] rounded-full bg-amber-400 px-1 text-center text-[9px] font-black tabular-nums text-black shadow"
    >
      {amount}
    </span>
  );
}

/** A spin-result strip (the public reveal): the pocket + both final stacks. Shown after a round
 *  resolves — for a replay it explains the re-deal; at terminal it sits under the result overlay. */
function SpinResult({ view, playerId, opponentId }: { view: RouletteView; playerId: string | null; opponentId: string | null }) {
  const r = view.lastResult;
  if (!r || playerId == null) return null;
  const mine = r.stacks[playerId] ?? 0;
  const theirs = opponentId ? (r.stacks[opponentId] ?? 0) : 0;
  const tie = mine === theirs;
  return (
    <div data-testid="spin-result" className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface/60 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Spin</span>
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full text-base font-black text-white shadow',
            isRed(r.pocket) ? 'bg-red-600' : 'bg-zinc-900',
          )}
        >
          {r.pocket}
        </span>
        <span className="text-xs text-muted-foreground">{colourName(r.pocket)}</span>
      </div>
      <div className="flex items-center gap-3 text-sm font-bold tabular-nums">
        <span className="text-foreground">You {mine}</span>
        <span className="text-muted-foreground">vs</span>
        <span className="text-foreground">Opp {theirs}</span>
      </div>
      {tie && !view.winner && !view.forcedOutcome && (
        <span data-testid="replay-note" className="text-xs font-medium text-amber-500">
          Tied — replaying (round {(view.round ?? 0) + 1})
        </span>
      )}
    </div>
  );
}

/**
 * The live Roulette table. While betting, the player allocates their full 1,000-chip stack across
 * the reduced bet set (chips are an internal scoring comparator — NOT the credit stake); LOCK is
 * disabled until exactly the full stack is placed (the server-enforced full-stack rule). The
 * opponent's allocation is never shown until both lock (server redaction). After the shared spin
 * the SpinResult strip reveals the pocket + both stacks; an equal result replays in place, a
 * decisive one surfaces the GameHub result overlay.
 */
function RouletteBoard({ playerId, opponentId, gameState, onMove }: GameAreaArgs) {
  const view = gameState as RouletteView | null;
  const send = onMove as unknown as (m: RouletteMove) => void;

  const me = playerId ? view?.bets?.[playerId] : undefined;
  const allocation = me?.allocation ?? {};
  const placed = sumChips(allocation);
  const remaining = CHIP_TOTAL - placed;
  const locked = me?.locked ?? false;
  const full = remaining === 0;

  const [denom, setDenom] = useState<number>(CHIP_DENOMS[0]);

  // Cosmetic 30s betting countdown (server runs the authoritative clock). Reset whenever MY
  // allocation changes or a fresh round begins — mirroring the server's per-move timer refresh.
  const round = view?.round ?? 0;
  const [secondsLeft, setSecondsLeft] = useState(BETTING_SECONDS);
  const resetKey = `${round}:${placed}:${locked}`;
  useEffect(() => {
    setSecondsLeft(BETTING_SECONDS);
    if (locked) return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resetKey, locked]);

  const place = (bet: string) => {
    if (locked || full) return;
    const amount = Math.min(denom, remaining); // clamp so the move is always a legal amount
    send({ t: 'place', bet, amount });
  };
  const unplace = (bet: string) => !locked && send({ t: 'unplace', bet });

  // Locked → a quiet waiting panel (plus the last spin, if any).
  if (locked) {
    return (
      <div className="flex flex-col gap-3" data-testid="hub-board">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface/40 p-5 text-center">
          <span data-testid="locked-banner" className="text-sm font-bold text-brand">
            Locked in {me?.autoSpread ? '(auto-spread)' : ''}
          </span>
          <span className="text-xs text-muted-foreground">Waiting for your opponent to lock…</span>
        </div>
        {view && <SpinResult view={view} playerId={playerId} opponentId={opponentId} />}
      </div>
    );
  }

  const BetCell = ({ id, label, className }: { id: string; label: string; className?: string }) => (
    <button
      type="button"
      data-testid={`bet-${id}`}
      onClick={() => place(id)}
      onContextMenu={(e) => {
        e.preventDefault();
        unplace(id);
      }}
      disabled={full && !allocation[id]}
      title={allocation[id] ? 'Click to add · right-click to remove' : 'Click to place'}
      className={cn(
        'relative flex items-center justify-center rounded-md px-1 py-2 text-xs font-bold text-white transition-transform active:scale-95 disabled:opacity-50',
        allocation[id] ? 'ring-2 ring-amber-400' : '',
        className,
      )}
    >
      {label}
      <ChipBadge amount={allocation[id] ?? 0} />
    </button>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="hub-board">
      {/* Remaining / full-stack indicator (the key UX: you MUST place the whole stack). */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span data-testid="stack-indicator" className={cn('font-bold tabular-nums', full ? 'text-success' : 'text-foreground')}>
            {full ? '✓ Full stack allocated' : `Placed ${placed} / ${CHIP_TOTAL} · ${remaining} left`}
          </span>
          <span
            data-testid="bet-timer"
            className={cn(
              'flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-bold tabular-nums',
              secondsLeft <= 5 ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-border bg-surface text-muted-foreground',
            )}
          >
            {secondsLeft}s
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
          <div className={cn('h-full transition-all', full ? 'bg-success' : 'bg-brand')} style={{ width: `${(placed / CHIP_TOTAL) * 100}%` }} />
        </div>
      </div>

      {/* The 1–36 number grid — each cell is a straight-up bet (36×). */}
      <div className="grid grid-cols-6 gap-1" role="grid" aria-label="Numbers">
        {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
          <BetCell key={n} id={`s${n}`} label={String(n)} className={isRed(n) ? 'bg-red-700 hover:bg-red-600' : 'bg-zinc-800 hover:bg-zinc-700'} />
        ))}
      </div>

      {/* Dozens + Columns (3×). */}
      <div className="grid grid-cols-3 gap-1">
        {DOZENS.map((b) => (
          <BetCell key={b.id} id={b.id} label={b.label} className="bg-emerald-800/70 hover:bg-emerald-700/70" />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1">
        {COLUMNS.map((b) => (
          <BetCell key={b.id} id={b.id} label={b.label} className="bg-emerald-800/70 hover:bg-emerald-700/70" />
        ))}
      </div>

      {/* Even-money bets (2×). */}
      <div className="grid grid-cols-3 gap-1">
        {EVEN_MONEY.map((b) => (
          <BetCell
            key={b.id}
            id={b.id}
            label={b.label}
            className={b.id === 'red' ? 'bg-red-700 hover:bg-red-600' : b.id === 'black' ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-indigo-800/70 hover:bg-indigo-700/70'}
          />
        ))}
      </div>

      {/* Chip tray — pick a denomination, then click a bet to drop it. */}
      <div className="flex items-center justify-center gap-2" role="radiogroup" aria-label="Chip value">
        {CHIP_DENOMS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={denom === d}
            data-testid={`chip-${d}`}
            onClick={() => setDenom(d)}
            className={cn(
              'h-10 w-10 rounded-full border-2 text-xs font-black tabular-nums transition-transform active:scale-95',
              denom === d ? 'border-amber-400 bg-amber-400 text-black' : 'border-border bg-surface text-foreground',
            )}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Actions: LOCK (gated on a full stack), Clear, and Auto-complete (spread the rest). */}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="clear-btn"
          onClick={() => placed > 0 && send({ t: 'clear' })}
          disabled={placed === 0}
          className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-sm font-semibold text-foreground/80 transition-colors hover:brightness-110 disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          data-testid="lock-btn"
          onClick={() => full && send({ t: 'lock' })}
          disabled={!full}
          className={cn(
            'flex-[2] rounded-xl py-2.5 text-sm font-black uppercase tracking-wide text-white transition-colors',
            full ? 'bg-brand hover:brightness-110' : 'cursor-not-allowed bg-brand/40',
          )}
        >
          {full ? 'Lock bets' : `Place ${remaining} more to lock`}
        </button>
      </div>
      <button
        type="button"
        data-testid="auto-btn"
        onClick={() => send({ t: 'spread' })}
        className="text-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        Auto-complete (spread the rest on Red/Black &amp; lock)
      </button>

      {view?.lastResult && <SpinResult view={view} playerId={playerId} opponentId={opponentId} />}
    </div>
  );
}

/** The Roulette game-area slot: greyed idle preview, or the live betting table in-match. */
function RoulettePanel(args: GameAreaArgs) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {args.phase === 'in-match' ? <RouletteBoard {...args} /> : <RouletteIdle phase={args.phase} />}
    </div>
  );
}

/**
 * Roulette Hub = the shared GameHub + a Roulette play-panel (the betting board, chip tray,
 * full-stack indicator, lock, shared spin reveal). Two players bet on ONE zeroless spin; the
 * larger chip stack wins the play-money pot. Chips are internal scoring only — the credit stake
 * is escrowed/settled by the core via the win/draw/void outcome. Server-authoritative redaction,
 * the per-player 30s betting timer, and the internal replay are unchanged. See docs/ROULETTE.md.
 */
export function RouletteHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="roulette" gameName="Roulette" renderGameArea={RoulettePanel} {...props} />;
}
