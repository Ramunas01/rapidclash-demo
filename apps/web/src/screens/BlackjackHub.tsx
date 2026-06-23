import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
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

/** Item 5 — hand-total label above a hand. With an ace, show BOTH interpretations while both
 *  are ≤ 21 (e.g. A+3 → "4, 14"); collapse to a single value when there is no ace or the high
 *  reading would bust. Computed from the VISIBLE cards only — redaction-safe for the opponent. */
function totalLabel(cards: BlackjackCard[]): string {
  let low = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { aces++; low += 1; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') low += 10;
    else low += Number(c.rank);
  }
  const high = low + 10; // promoting exactly one ace from 1 → 11
  if (aces > 0 && high <= 21) return `${low}, ${high}`;
  return String(low);
}

const isRed = (suit: string) => suit === '♥' || suit === '♦';

/** A face-up card. Slides in from the player's deck (right) and flips to its value on mount —
 *  so a Hit animates a draw, an opponent reveal animates at the terminal. */
function PlayingCard({ card, index }: { card: BlackjackCard; index: number }) {
  return (
    <motion.div
      data-testid="card"
      initial={{ x: 44, opacity: 0, rotateY: 90 }}
      animate={{ x: 0, opacity: 1, rotateY: 0 }}
      transition={{ duration: 0.45, ease: 'easeOut', delay: index * 0.05 }}
      style={{ marginLeft: index === 0 ? 0 : -22 }}
      className={cn(
        'relative flex h-20 w-14 flex-col items-center justify-center rounded-lg border border-black/10 bg-white font-bold shadow-lg',
        isRed(card.suit) ? 'text-red-600' : 'text-gray-900',
      )}
    >
      <span className="text-lg leading-none">{card.rank}</span>
      <span className="text-2xl leading-none">{card.suit}</span>
    </motion.div>
  );
}

/** A face-down card — the hidden remainder of the opponent's hand (viewFor redaction). When the
 *  opponent is acting it pulses gently to signal activity (no value ever revealed pre-terminal). */
function CardBack({ index = 0, active = false }: { index?: number; active?: boolean }) {
  return (
    <motion.div
      data-testid="card-back"
      aria-label="Hidden card"
      initial={{ x: 44, opacity: 0 }}
      animate={active ? { x: 0, opacity: 1, y: [0, -4, 0] } : { x: 0, opacity: 1 }}
      transition={active ? { x: { duration: 0.4 }, opacity: { duration: 0.4 }, y: { duration: 1.1, repeat: Infinity } } : { duration: 0.4 }}
      style={{ marginLeft: index === 0 ? 0 : -22 }}
      className="flex h-20 w-14 items-center justify-center rounded-lg border border-white/15 bg-gradient-to-br from-purple-600 to-indigo-900 text-2xl text-white/30 shadow-lg"
    >
      ✦
    </motion.div>
  );
}

/** Item 1 — a partially-visible card deck on the table's right edge (one per player; mirrors the
 *  two independent decks). A blue back peeks out behind a white card, clipped by the table edge —
 *  "ready to be drawn" to the centre. Decorative (no `card` testid). */
function DeckStack({ className }: { className?: string }) {
  return (
    <div className={cn('pointer-events-none absolute flex', className)} aria-hidden="true">
      <div className="h-[68px] w-12 rounded-lg border border-white/10 bg-gradient-to-br from-purple-600 to-indigo-900 shadow-lg" />
      <div className="-ml-7 h-[68px] w-12 rounded-lg border border-black/10 bg-white shadow-lg" />
    </div>
  );
}

/** Item 4 — the per-player move timer: the seconds count inside a tick-mark ring, parked on the
 *  table's left edge. The existing 10s display countdown, restyled (server timer is authoritative). */
function RingTimer({ seconds }: { seconds: number }) {
  const low = seconds <= 3;
  return (
    <div data-testid="countdown" className="relative grid h-14 w-14 place-items-center">
      <svg width="56" height="56" viewBox="0 0 56 56" className={low ? 'text-destructive' : 'text-brand'}>
        <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="2 4.6" strokeLinecap="round" opacity="0.85" />
      </svg>
      <span className={cn('absolute text-lg font-bold tabular-nums', low ? 'text-destructive' : 'text-foreground')}>{seconds}</span>
    </div>
  );
}

/** The table surface shared by idle and in-match: a greyish (not green) elevated panel matching
 *  the other surfaces, with a deck parked on the right edge of each player's zone. */
function TableSurface({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="hub-board"
      className="relative flex min-h-[280px] flex-col items-stretch justify-between overflow-hidden rounded-2xl bg-surface p-[18px]"
    >
      <DeckStack className="right-[-26px] top-7" />
      <DeckStack className="bottom-7 right-[-26px]" />
      {children}
    </div>
  );
}

/** Idle/Waiting table (item 1): the greyish surface with the two right-edge decks and the centred
 *  prompt. Rules + redaction untouched — empty-table presentation only. */
function BlackjackIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <TableSurface>
      <div className="flex flex-1 items-center justify-center">
        <span className="relative z-[1] text-sm font-semibold text-muted-foreground">
          {phase === 'waiting' ? 'Waiting for an opponent…' : 'Place your bet and play'}
        </span>
      </div>
    </TableSurface>
  );
}

/**
 * The live Blackjack table (item 3/8). Redaction: own hand in full, exactly ONE opponent card
 * shown (a face-down card stands in for the rest) until the terminal reveal. Cards are centred
 * and overlap to save space; ownership reads from table side + visibility (no name labels — the
 * slot pills carry the usernames). Totals sit above each hand. Hit/Stand live in the player's
 * slot pill (rendered by the template), not on the table.
 */
function BlackjackBoard({ playerId, opponentId, gameState, legalMoves }: GameAreaArgs) {
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
  const isTerminal = Boolean(view?.winner ?? view?.forcedOutcome);
  const waitingOnOpponent = !isMyTurn && !isTerminal && ownCards.length > 0;
  const round = view?.round ?? 0;
  const draws = view?.draws ?? 0;

  return (
    <TableSurface>
      {/* Round / replay note: a draw re-deals within the SAME match (no result yet). */}
      {(round > 0 || draws > 0) && (
        <p data-testid="round-note" className="relative z-[1] text-center text-xs text-muted-foreground">
          Round {round + 1}
          {draws > 0 && ` · ${draws} push${draws === 1 ? '' : 'es'} — replaying`}
        </p>
      )}

      {/* Left-edge move timer (only on this player's turn). */}
      {isMyTurn && secondsLeft !== null && (
        <div className="absolute left-3 top-1/2 z-[2] -translate-y-1/2">
          <RingTimer seconds={secondsLeft} />
        </div>
      )}

      {/* Opponent hand — centred; exactly one card is ever revealed in play (viewFor redaction). */}
      <section data-testid="opp-hand" className="relative z-[1] flex flex-1 flex-col items-center justify-center gap-2">
        <HandTotalPill label={totalLabel(oppCards)} testid="opp-total" />
        <div className="flex items-end justify-center">
          {oppCards.map((c, i) => <PlayingCard key={`opp-${i}`} card={c} index={i} />)}
          {!isTerminal && <CardBack index={oppCards.length} active={waitingOnOpponent} />}
        </div>
      </section>

      {/* Own hand — centred, full. */}
      <section data-testid="own-hand" className="relative z-[1] flex flex-1 flex-col items-center justify-center gap-2">
        <HandTotalPill label={totalLabel(ownCards)} testid="own-total" />
        <div className="flex items-end justify-center">
          {ownCards.map((c, i) => <PlayingCard key={`own-${i}`} card={c} index={i} />)}
        </div>
      </section>
    </TableSurface>
  );
}

/** Item 5 — the small total chip floating above a hand. */
function HandTotalPill({ label, testid }: { label: string; testid?: string }) {
  return (
    <span
      data-testid={testid}
      className="rounded-full bg-background/85 px-3 py-1 text-[13px] font-extrabold tabular-nums text-foreground shadow ring-1 ring-white/10"
    >
      {label}
    </span>
  );
}

/** Item 6 — Hit / Stand, rendered into the player's OWN slot pill by the template. Gated by the
 *  server-issued legalMoves; fades in on your turn (the post-reveal linger). No Resign control —
 *  the server's disconnect → auto-stand path (BLACKJACK.md) is untouched. */
function BlackjackSlotControls({ legalMoves, onMove }: GameAreaArgs) {
  const isMyTurn = legalMoves.length > 0;
  return (
    <motion.span
      key={isMyTurn ? 'turn' : 'wait'}
      initial={{ opacity: 0 }}
      animate={{ opacity: isMyTurn ? 1 : 0.45 }}
      transition={{ duration: isMyTurn ? 0.9 : 0.2 }}
      className="flex items-center gap-2"
    >
      <button
        type="button"
        data-testid="hit-btn"
        disabled={!isMyTurn}
        onClick={() => onMove('hit')}
        className="rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        Hit
      </button>
      <button
        type="button"
        data-testid="stand-btn"
        disabled={!isMyTurn}
        onClick={() => onMove('stand')}
        className="rounded-full bg-background px-4 py-1.5 text-sm font-bold text-foreground transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        Stand
      </button>
    </motion.span>
  );
}

/** The Blackjack game-area slot: the greyish table for both states — empty (idle/waiting) or the
 *  live hands (in-match). The table IS the surface (no extra grey frame). */
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
 * Blackjack Hub = the shared GameHub + a Blackjack play-panel (the greyish table with
 * one-opponent-card redaction, centred overlapping hands, dual-ace totals and the left-edge 10s
 * ring timer), Hit/Stand lifted into the player's slot pill, and a final-totals reveal.
 * Internal-replay draws loop in the In-match phase; only a decisive match.end shows the overlay.
 * The mechanic / WS flow / redaction are unchanged.
 */
export function BlackjackHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="blackjack"
      gameName="Blackjack"
      renderGameArea={BlackjackPanel}
      renderSlotControls={BlackjackSlotControls}
      renderResultReveal={BlackjackReveal}
      {...props}
    />
  );
}
