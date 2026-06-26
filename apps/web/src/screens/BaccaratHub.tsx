import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';
import type { BaccaratView, BaccaratHand, BaccaratCard, GameView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

const HOLD_MS = 2200;
const isRed = (suit: string) => suit === '♥' || suit === '♦';

function DiceIdleLike({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div data-testid="hub-board" className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-6 text-center">
      <span className="text-5xl" aria-hidden="true">🃏</span>
      <p className="text-sm font-semibold text-muted-foreground">
        {phase === 'waiting' ? 'Finding a rival…' : 'Place your bet and deal'}
      </p>
    </div>
  );
}

function PlayingCard({ card }: { card?: BaccaratCard }) {
  if (!card) {
    return <div data-testid="card-back" className="flex h-16 w-11 items-center justify-center rounded-md border border-white/15 bg-gradient-to-br from-purple-700 to-indigo-900 text-xl text-white/30 shadow">✦</div>;
  }
  return (
    <div data-testid="card" className={cn('flex h-16 w-11 flex-col items-center justify-center rounded-md border border-black/10 bg-white font-bold shadow', isRed(card.suit) ? 'text-red-600' : 'text-gray-900')}>
      <span className="text-base leading-none">{card.rank}</span>
      <span className="text-lg leading-none">{card.suit}</span>
    </div>
  );
}

/** One player's hand: its cards (or face-down placeholders while hidden) + its last-digit total. */
function HandRow({ label, hand, hidden, win }: { label: string; hand?: BaccaratHand; hidden?: boolean; win?: boolean }) {
  const cards = hand?.cards ?? [];
  const placeholders = hidden ? [undefined, undefined] : [];
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-xl border p-3', win ? 'border-success/50 bg-success/10' : 'border-border bg-surface/60')}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
        {hand?.natural && <span className="rounded-full bg-amber-400/20 px-1.5 text-[9px] font-black uppercase text-amber-400">Natural</span>}
        {!hidden && hand && <span className={cn('ml-1 text-sm font-black tabular-nums', win ? 'text-success' : 'text-foreground')}>{hand.total}</span>}
      </div>
      <div className="flex gap-1.5">
        {(hidden ? placeholders : cards).map((c, i) => <PlayingCard key={i} card={c} />)}
      </div>
    </div>
  );
}

/** The live Baccarat area: each player IS their own hand, dealt by authentic rules from their own
 *  shoe; higher last-digit total (closest to 9) wins. The player watches their OWN hand; the
 *  opponent's hand is hidden until the simultaneous reveal (server redaction). No decisions. */
function BaccaratBoard({ gameState, legalMoves, onMove, playerId, opponentId }: GameAreaArgs) {
  const view = gameState as BaccaratView | null;
  const me = playerId, opp = opponentId;
  const result = view?.result;
  const myHand = (me && (result?.hands?.[me] ?? view?.hands?.[me])) || undefined;
  const oppHand = (opp && result?.hands?.[opp]) || undefined; // opponent only at terminal
  const resolved = Boolean(result);

  const canReveal = legalMoves.includes('reveal');
  useEffect(() => { if (canReveal) onMove('reveal'); }, [canReveal, onMove]);

  const meTotal = myHand?.total, oppTotal = oppHand?.total;
  const meWon = resolved && meTotal != null && oppTotal != null && meTotal > oppTotal;
  const oppWon = resolved && meTotal != null && oppTotal != null && oppTotal > meTotal;

  return (
    <div data-testid="hub-board" className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-5">
      <HandRow label="Opponent" hand={oppHand} hidden={!resolved} win={oppWon} />
      <p data-testid="bac-status" className="text-xs font-medium text-muted-foreground">
        {resolved ? (meWon ? 'You won — closer to 9!' : oppWon ? 'Opponent was closer to 9' : 'Tie') : 'Dealing…'}
      </p>
      <HandRow label="You" hand={myHand} win={meWon} />
    </div>
  );
}

function BaccaratPanel(args: GameAreaArgs) {
  return args.phase === 'in-match' ? <BaccaratBoard {...args} /> : <DiceIdleLike phase={args.phase} />;
}

/** Result reveal: both final totals (closest to 9 wins). */
function BaccaratReveal({ gameState, playerId }: { outcome: Outcome; gameState: GameView | null; playerId: string | null }) {
  const view = gameState as BaccaratView | null;
  if (!view?.result || !playerId) return null;
  const opp = view.players.find((p) => p !== playerId);
  const mine = view.result.hands[playerId];
  const theirs = opp ? view.result.hands[opp] : undefined;
  return (
    <div className="mb-3 flex items-center justify-center gap-4" data-testid="hub-result-baccarat">
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">You</p>
        <p className="text-2xl font-black tabular-nums text-foreground">{mine?.total ?? '—'}</p>
      </div>
      <span className="text-xs font-black text-muted-foreground">VS</span>
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Opponent</p>
        <p className="text-2xl font-black tabular-nums text-foreground">{theirs?.total ?? '—'}</p>
      </div>
    </div>
  );
}

/**
 * Baccarat Hub = the shared GameHub + the independent-roll area dressed as baccarat: each player is
 * their own hand, dealt by authentic third-card rules from their own shoe; the higher last-digit
 * total (closest to 9) wins. No Player/Banker/Tie bet, no commission, no decisions. The deal, the
 * shoes and the opponent's hand are server-authoritative and hidden until the reveal. See docs/BACCARAT.md.
 */
export function BaccaratHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="baccarat" gameName="Baccarat" renderGameArea={BaccaratPanel} renderResultReveal={BaccaratReveal} holdResultMs={HOLD_MS} {...props} />;
}
