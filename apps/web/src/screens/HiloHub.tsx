import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { HiloView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

type HiloMove = { t: 'hi' } | { t: 'lo' };

const rankLabel = (r: number) => (r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r));
const isRedSuit = (s: string) => s === '♥' || s === '♦';

function HiloIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-6">
      <div aria-hidden className="flex h-24 w-16 items-center justify-center rounded-xl border-2 border-border bg-surface/40 text-3xl font-black text-muted-foreground/50">?</div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/** A playing card face. */
function CardFace({ rank, suit, dim }: { rank: number; suit: string; dim?: boolean }) {
  return (
    <div
      data-testid="hilo-card"
      className={cn('flex h-24 w-16 flex-col items-center justify-center rounded-xl border-2 border-border bg-white shadow-lg', dim && 'opacity-60')}
    >
      <span className={cn('text-3xl font-black leading-none', isRedSuit(suit) ? 'text-red-600' : 'text-gray-900')}>{rankLabel(rank)}</span>
      <span className={cn('text-2xl leading-none', isRedSuit(suit) ? 'text-red-600' : 'text-gray-900')}>{suit}</span>
    </div>
  );
}

/**
 * The live Hilo board. The player faces their own current card and calls hi/lo for the next; a
 * correct call (or an equal rank) extends the streak, a wrong call busts. A shared 30 s clock caps
 * the round. Redaction: only my own card + streak are ever shown; the opponent's progress is hidden.
 */
function HiloBoard({ playerId, gameState, onMove, serverClockOffset = 0 }: GameAreaArgs) {
  const view = gameState as HiloView | null;
  const send = onMove as unknown as (m: HiloMove) => void;

  const me = playerId ? view?.progress?.[playerId] : undefined;
  const streak = me?.position ?? 0;
  const busted = me?.busted ?? false;
  const frozen = me?.frozen ?? false;
  const finished = busted || frozen;
  const card = me?.card;
  const endsAt = view?.endsAt ?? 0;

  // Shared match-clock countdown (server-authoritative; serverClockOffset aligns the client clock).
  const [now, setNow] = useState(() => Date.now() + serverClockOffset);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + serverClockOffset), 250);
    return () => clearInterval(id);
  }, [serverClockOffset]);
  const secondsLeft = endsAt > 0 ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : null;

  return (
    <div className="flex flex-col items-center gap-4" data-testid="hub-board">
      <div className="flex w-full items-center justify-between text-xs">
        <span data-testid="streak" className="font-bold text-foreground">Streak <strong className="text-brand">{streak}</strong></span>
        {secondsLeft !== null && (
          <span
            data-testid="match-timer"
            className={cn('flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-bold tabular-nums', secondsLeft <= 5 ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'border-border bg-surface text-muted-foreground')}
          >
            {secondsLeft}s
          </span>
        )}
      </div>

      {finished ? (
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          {me?.bustCard && <CardFace rank={me.bustCard.rank} suit={me.bustCard.suit} dim />}
          <span data-testid="finished-banner" className={cn('text-sm font-bold', busted ? 'text-destructive' : 'text-brand')}>
            {busted ? `Busted at ${streak}` : `Time! Frozen at ${streak}`}
          </span>
          <span className="text-xs text-muted-foreground">Waiting for your opponent…</span>
        </div>
      ) : card ? (
        <>
          <CardFace rank={card.rank} suit={card.suit} />
          <p className="text-xs text-muted-foreground">Will the next card be higher or lower? (a tie counts as correct)</p>
          <div className="grid w-full grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="hi-btn"
              onClick={() => send({ t: 'hi' })}
              className="rounded-xl bg-success py-3 text-base font-black uppercase tracking-wide text-white transition-transform hover:brightness-110 active:scale-95"
            >
              ▲ Higher
            </button>
            <button
              type="button"
              data-testid="lo-btn"
              onClick={() => send({ t: 'lo' })}
              className="rounded-xl bg-destructive py-3 text-base font-black uppercase tracking-wide text-white transition-transform hover:brightness-110 active:scale-95"
            >
              ▼ Lower
            </button>
          </div>
        </>
      ) : (
        <p className="py-6 text-xs text-muted-foreground">Dealing…</p>
      )}
    </div>
  );
}

function HiloPanel(args: GameAreaArgs) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {args.phase === 'in-match' ? <HiloBoard {...args} /> : <HiloIdle phase={args.phase} />}
    </div>
  );
}

/**
 * Hilo Hub = the shared GameHub + a Hilo play-panel (own card, Higher/Lower calls, streak, the
 * shared 30s match clock). Both players run the SAME seeded sequence, each seeing only their own
 * progress; the longer correct streak wins. Server-authoritative redaction (opponent progress
 * hidden, future cards never sent ahead), the shared-deadline timer, and the internal replay are
 * unchanged. See docs/HILO.md.
 */
export function HiloHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="hilo" gameName="Hilo" renderGameArea={HiloPanel} {...props} />;
}
