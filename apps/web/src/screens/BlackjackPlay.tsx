import { useEffect, useState } from 'react';
import { Spade } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BlackjackView, BlackjackCard } from '../App.js';

interface Props {
  playerId: string;
  /** The signed-in player's own alias (#34); null only on a legacy session. */
  username: string | null;
  opponentId: string;
  gameState: BlackjackView | null;
  /** Server-issued legal actions ('hit' | 'stand'). Empty unless it is this player's turn. */
  legalMoves: string[];
  onMove(move: string): void;
  onForfeit(): void;
}

/** Per-player move budget (mirrors the module's meta.moveTimeoutMs). Display only —
 *  the server runs the authoritative timer and auto-stands on expiry. */
const MOVE_TIMEOUT_SEC = 10;

/** Blackjack value of a hand: faces = 10, aces 11 then downgraded to 1 to avoid a bust.
 *  Display-only — the server is authoritative for the outcome. */
function handTotal(cards: BlackjackCard[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') {
      aces++;
      total += 11;
    } else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') {
      total += 10;
    } else {
      total += Number(c.rank);
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

const isRed = (suit: string) => suit === '♥' || suit === '♦';

function PlayingCard({ card }: { card: BlackjackCard }) {
  return (
    <div
      data-testid="card"
      className={cn(
        'flex h-20 w-14 flex-col items-center justify-center rounded-lg border border-black/10 bg-white font-bold shadow-md',
        isRed(card.suit) ? 'text-red-600' : 'text-gray-900',
      )}
    >
      <span className="text-lg leading-none">{card.rank}</span>
      <span className="text-2xl leading-none">{card.suit}</span>
    </div>
  );
}

function CardBack() {
  return (
    <div
      data-testid="card-back"
      aria-label="Hidden card"
      className="flex h-20 w-14 items-center justify-center rounded-lg border border-white/15 bg-gradient-to-br from-purple-700 to-indigo-900 text-2xl text-white/30 shadow-md"
    >
      ✦
    </div>
  );
}

export function BlackjackPlayScreen({
  playerId,
  username,
  opponentId,
  gameState,
  legalMoves,
  onMove,
  onForfeit,
}: Props) {
  const isMyTurn = legalMoves.length > 0;

  // Visual per-player countdown: reset to 10s each time it becomes this player's turn
  // (App clears legalMoves on a sent move, so each your_turn re-enters this branch).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!isMyTurn) {
      setSecondsLeft(null);
      return;
    }
    const deadline = Date.now() + MOVE_TIMEOUT_SEC * 1000;
    setSecondsLeft(MOVE_TIMEOUT_SEC);
    const id = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [isMyTurn]);

  const ownHand = gameState?.hands[playerId];
  const oppHand = gameState ? gameState.hands[opponentId] : undefined;
  const ownCards = ownHand?.cards ?? [];
  const oppCards = oppHand?.cards ?? [];
  const ownTotal = handTotal(ownCards);
  const isTerminal = Boolean(gameState?.winner ?? gameState?.forcedOutcome);
  const busted = ownTotal > 21;
  // I'm done (stood/busted) but the round isn't over → waiting on the opponent.
  const waitingOnOpponent = !isMyTurn && !isTerminal && ownCards.length > 0;

  const round = gameState?.round ?? 0;
  const draws = gameState?.draws ?? 0;

  let statusText: string;
  if (busted) statusText = 'Bust!';
  else if (isMyTurn) statusText = 'Your turn — hit or stand';
  else if (waitingOnOpponent) statusText = 'Waiting for opponent…';
  else statusText = 'Dealing…';

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0e18] text-white">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-6">
        <h1 className="mb-2 flex items-center justify-center gap-2 text-xl font-bold">
          <Spade className="h-5 w-5 text-brand" />
          Blackjack
        </h1>

        {/* Round / replay note: a draw re-deals within the SAME match (no result yet). */}
        {(round > 0 || draws > 0) && (
          <p data-testid="round-note" className="mb-3 text-center text-xs text-white/40">
            Round {round + 1}
            {draws > 0 && ` · ${draws} push${draws === 1 ? '' : 'es'} — replaying`}
          </p>
        )}

        {/* Opponent — exactly one card is ever revealed in play (viewFor redaction). */}
        <section className="mb-6" data-testid="opp-hand">
          <p className="mb-2 text-xs font-medium text-white/50">
            Opponent <span className="text-white/30">({opponentId.slice(0, 8)})</span>
          </p>
          <div className="flex gap-2">
            {oppCards.map((c, i) => (
              <PlayingCard key={`opp-${i}`} card={c} />
            ))}
            {/* Hidden remainder while the round is live. */}
            {!isTerminal && <CardBack />}
          </div>
        </section>

        {/* You */}
        <section className="mb-6" data-testid="own-hand">
          <p className="mb-2 flex items-center justify-between text-xs font-medium text-white/50">
            <span>
              {username ? (
                <>
                  You (<strong className="text-white">{username}</strong>)
                </>
              ) : (
                'You'
              )}
            </span>
            <span data-testid="own-total" className={cn('font-bold', busted ? 'text-red-400' : 'text-white')}>
              {ownTotal}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {ownCards.map((c, i) => (
              <PlayingCard key={`own-${i}`} card={c} />
            ))}
          </div>
        </section>

        {/* Status + countdown */}
        <div className="mb-4 flex items-center justify-between text-sm">
          <span
            data-testid="turn-indicator"
            className={cn('font-semibold', isMyTurn ? 'text-brand' : 'text-white/50')}
          >
            {statusText}
          </span>
          {isMyTurn && secondsLeft !== null && (
            <span
              data-testid="countdown"
              className={cn('tabular-nums font-bold', secondsLeft <= 3 ? 'text-red-400' : 'text-white/70')}
            >
              {secondsLeft}s
            </span>
          )}
        </div>

        {/* Actions — gated by server legalMoves. */}
        <div className="flex gap-3">
          <button
            type="button"
            data-testid="hit-btn"
            disabled={!isMyTurn}
            onClick={() => onMove('hit')}
            className="flex-1 rounded-xl bg-brand py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Hit
          </button>
          <button
            type="button"
            data-testid="stand-btn"
            disabled={!isMyTurn}
            onClick={() => onMove('stand')}
            className="flex-1 rounded-xl border border-white/15 bg-white/[0.06] py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Stand
          </button>
        </div>

        <p className="mt-4 text-center text-xs text-white/40">
          Closest to 21 without busting wins. You have {MOVE_TIMEOUT_SEC}s per move — time out and you auto-stand.
        </p>

        <button
          type="button"
          onClick={onForfeit}
          className="mt-auto pt-6 text-sm font-medium text-white/40 transition-colors hover:text-white/70"
        >
          Resign
        </button>
      </div>
    </div>
  );
}
