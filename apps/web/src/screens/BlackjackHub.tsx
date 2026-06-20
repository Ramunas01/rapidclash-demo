import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';
import type { BlackjackView, BlackjackCard, GameView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Per-player move budget (mirrors the module's meta.moveTimeoutMs). Display only —
 *  the server runs the authoritative timer and auto-stands on expiry. */
const MOVE_TIMEOUT_SEC = 10;

/** Blackjack value of a hand: faces = 10, aces 11 then downgraded to 1 to avoid a bust.
 *  Display-only — the server is authoritative for the outcome. */
function handTotal(cards: BlackjackCard[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { aces++; total += 11; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') total += 10;
    else total += Number(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
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

/** Greyed preview shown in Idle/Waiting — two face-down cards, dimmed. */
function BlackjackIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-3">
      <div className="flex gap-2 opacity-40">
        <CardBack />
        <CardBack />
      </div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/**
 * The live Blackjack table (lifts BlackjackPlay). Redaction: own hand in full, but exactly ONE
 * opponent card is shown (a face-down card stands in for the rest) until the terminal reveal.
 * Hit/Stand are gated by your_turn.legalMoves; a 10s display countdown mirrors the server timer.
 * A draw re-deals in the SAME match (round/draws advance) — the panel just renders the new round.
 */
function BlackjackBoard({ playerId, opponentId, gameState, legalMoves, onMove, onForfeit, username }: GameAreaArgs) {
  const view = gameState as BlackjackView | null;
  const isMyTurn = legalMoves.length > 0;

  // Visual per-player countdown: reset to 10s each time it becomes this player's turn
  // (App clears legalMoves on a sent move, so each your_turn re-enters this branch).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!isMyTurn) { setSecondsLeft(null); return; }
    const deadline = Date.now() + MOVE_TIMEOUT_SEC * 1000;
    setSecondsLeft(MOVE_TIMEOUT_SEC);
    const id = setInterval(() => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
    return () => clearInterval(id);
  }, [isMyTurn]);

  const ownCards = (playerId && view?.hands[playerId]?.cards) || [];
  const oppCards = (opponentId && view?.hands[opponentId]?.cards) || [];
  const ownTotal = handTotal(ownCards);
  const isTerminal = Boolean(view?.winner ?? view?.forcedOutcome);
  const busted = ownTotal > 21;
  const waitingOnOpponent = !isMyTurn && !isTerminal && ownCards.length > 0;
  const round = view?.round ?? 0;
  const draws = view?.draws ?? 0;

  let statusText: string;
  if (busted) statusText = 'Bust!';
  else if (isMyTurn) statusText = 'Your turn — hit or stand';
  else if (waitingOnOpponent) statusText = 'Waiting for opponent…';
  else statusText = 'Dealing…';

  return (
    <div className="flex flex-col gap-4" data-testid="hub-board">
      {/* Round / replay note: a draw re-deals within the SAME match (no result yet). */}
      {(round > 0 || draws > 0) && (
        <p data-testid="round-note" className="text-center text-xs text-muted-foreground">
          Round {round + 1}
          {draws > 0 && ` · ${draws} push${draws === 1 ? '' : 'es'} — replaying`}
        </p>
      )}

      {/* Opponent — exactly one card is ever revealed in play (viewFor redaction). */}
      <section data-testid="opp-hand">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Opponent</p>
        <div className="flex gap-2">
          {oppCards.map((c, i) => <PlayingCard key={`opp-${i}`} card={c} />)}
          {/* Hidden remainder while the round is live. */}
          {!isTerminal && <CardBack />}
        </div>
      </section>

      {/* You */}
      <section data-testid="own-hand">
        <p className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>{username ? <>You (<strong className="text-foreground">{username}</strong>)</> : 'You'}</span>
          <span data-testid="own-total" className={cn('font-bold', busted ? 'text-destructive' : 'text-foreground')}>{ownTotal}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {ownCards.map((c, i) => <PlayingCard key={`own-${i}`} card={c} />)}
        </div>
      </section>

      {/* Status + countdown */}
      <div className="flex items-center justify-between text-sm">
        <span data-testid="turn-indicator" className={cn('font-semibold', isMyTurn ? 'text-brand' : 'text-muted-foreground')}>
          {statusText}
        </span>
        {isMyTurn && secondsLeft !== null && (
          <span data-testid="countdown" className={cn('tabular-nums font-bold', secondsLeft <= 3 ? 'text-destructive' : 'text-muted-foreground')}>
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
          className="flex-1 rounded-xl bg-brand py-3 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Hit
        </button>
        <button
          type="button"
          data-testid="stand-btn"
          disabled={!isMyTurn}
          onClick={() => onMove('stand')}
          className="flex-1 rounded-xl bg-surface py-3 text-sm font-bold text-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Stand
        </button>
      </div>

      <p className="text-center text-[11px] text-muted-foreground">
        Closest to 21 without busting wins. You have {MOVE_TIMEOUT_SEC}s per move — time out and you auto-stand.
      </p>

      <button type="button" onClick={onForfeit} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        Resign
      </button>
    </div>
  );
}

/** The Blackjack game-area slot: greyed idle, or the live table in-match. */
function BlackjackPanel(args: GameAreaArgs) {
  return args.phase === 'in-match' ? <BlackjackBoard {...args} /> : <BlackjackIdle phase={args.phase} />;
}

/** Result reveal: the final totals, both hands now revealed by the server at terminal. */
function BlackjackReveal({ gameState, playerId }: { outcome: Outcome; gameState: GameView | null; playerId: string | null }) {
  const view = gameState as BlackjackView | null;
  if (!view || !playerId) return null;
  const opp = view.players.find((p) => p !== playerId);
  const mine = handTotal(view.hands[playerId]?.cards ?? []);
  const theirs = handTotal((opp && view.hands[opp]?.cards) || []);
  return (
    <div className="mb-3 flex items-center justify-center gap-4" data-testid="hub-result-blackjack">
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">You</p>
        <p className="text-2xl font-black tabular-nums text-foreground">{mine}</p>
      </div>
      <span className="text-xs font-black text-muted-foreground">VS</span>
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Opponent</p>
        <p className="text-2xl font-black tabular-nums text-foreground">{theirs}</p>
      </div>
    </div>
  );
}

/**
 * Blackjack Hub = the shared GameHub + a Blackjack play-panel (the table, with one-opponent-card
 * redaction, Hit/Stand gated by legalMoves, and the 10s countdown) and a final-totals reveal.
 * Internal-replay draws loop in the In-match phase; only a decisive match.end shows the overlay.
 * The mechanic / WS flow / redaction are unchanged.
 */
export function BlackjackHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="blackjack"
      gameName="Blackjack"
      renderGameArea={BlackjackPanel}
      renderResultReveal={BlackjackReveal}
      {...props}
    />
  );
}
