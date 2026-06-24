import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { BlackjackView, BlackjackCard } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Per-player move budget (mirrors the module's meta.moveTimeoutMs). Display only —
 *  the server runs the authoritative timer and auto-stands on expiry. */
const MOVE_TIMEOUT_SEC = 10;

/** Horizontal distance a dealt card travels from its right-edge deck to its centred hand slot.
 *  Sized from the deck position (board ≈ max-w-md minus padding, half-width ≈ 190px) so a draw
 *  reads as a real slide across the felt rather than a card that just blinks into place. */
const CARD_TRAVEL_PX = 200;

/** Presentation pacing (item: human timing). The terminal frame is held this long behind the
 *  pre-terminal one so the opponent's face-down "drawing" beat lingers before the reveal lands. */
const TERMINAL_HOLD_MS = 1100;

/** Opening-deal stagger (s) between each dealt card, so the four initial cards arrive one-by-one
 *  (player, opponent, player, opponent) rather than snapping in together. */
const DEAL_STAGGER_S = 0.22;

/** Delay (ms) from the terminal reveal to the win/lose card frame — a beat after the cards land,
 *  per the designer ("~0.5s after all cards are revealed"). Covers the ~0.55s flip + a short hold. */
const FRAME_DELAY_MS = 1000;

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

/** A face-up card. Travels the full distance from the player's right-edge deck to its centred hand
 *  slot and flips to its value on arrival — so a Hit (and the opening deal, staggered via `delay`)
 *  animates a real draw across the felt, and an opponent reveal animates the same way at the
 *  terminal. Only newly-dealt indices mount (the earlier cards keep their keys), so just the
 *  freshly-drawn card makes the trip. At terminal a `frame` rings the player's own cards green
 *  (won) or red (lost) — driven strictly by the server outcome. */
function PlayingCard({ card, index, delay = 0, frame = null }: { card: BlackjackCard; index: number; delay?: number; frame?: 'win' | 'lose' | null }) {
  return (
    <motion.div
      data-testid="card"
      initial={{ x: CARD_TRAVEL_PX, y: -12, opacity: 0, rotateY: 90 }}
      animate={{ x: 0, y: 0, opacity: 1, rotateY: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
      style={{ marginLeft: index === 0 ? 0 : -22 }}
      className={cn(
        'relative flex h-20 w-14 flex-col items-center justify-center rounded-lg border border-black/10 bg-white font-bold shadow-lg transition-shadow duration-300',
        isRed(card.suit) ? 'text-red-600' : 'text-gray-900',
        frame === 'win' && 'ring-[3px] ring-success shadow-[0_0_14px_rgba(34,197,94,0.55)]',
        frame === 'lose' && 'ring-[3px] ring-destructive shadow-[0_0_14px_rgba(239,68,68,0.5)]',
      )}
    >
      <span className="text-lg leading-none">{card.rank}</span>
      <span className="text-2xl leading-none">{card.suit}</span>
    </motion.div>
  );
}

/** A face-down card — the hidden remainder of the opponent's hand (viewFor redaction). When the
 *  opponent is acting it pulses gently to signal activity (no value ever revealed pre-terminal). */
function CardBack({ index = 0, active = false, delay = 0 }: { index?: number; active?: boolean; delay?: number }) {
  return (
    <motion.div
      data-testid="card-back"
      aria-label="Hidden card"
      initial={{ x: CARD_TRAVEL_PX, opacity: 0 }}
      animate={active ? { x: 0, opacity: 1, y: [0, -4, 0] } : { x: 0, opacity: 1 }}
      transition={active
        ? { x: { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }, opacity: { duration: 0.5, delay }, y: { duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: delay + 0.5 } }
        : { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
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

/** Whether a view is the server's terminal frame (a decided winner / forced outcome). */
const isTerminalView = (v: BlackjackView | null) => Boolean(v?.winner ?? v?.forcedOutcome);

/**
 * Presentation-only pacing layer. The server can flood the client with successive states
 * back-to-back (your hit → the bot resolving → the terminal reveal), which otherwise renders
 * "in an instant". This buffers the displayed frame so the TERMINAL reveal is held a beat behind
 * the pre-terminal one — the opponent's face-down card lingers ("drawing…") before the hands are
 * shown. Everything else (your own hits, turn flips, internal re-deals) passes straight through so
 * the board stays responsive; the card-travel animation is the beat for those. Never reorders or
 * drops a state, never reveals a value early (the held frame is the pre-terminal, redacted one).
 */
function usePacedView(incoming: BlackjackView | null, gapMs: number): BlackjackView | null {
  const [shown, setShown] = useState<BlackjackView | null>(incoming);
  const shownRef = useRef<BlackjackView | null>(incoming);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    const current = shownRef.current;
    if (incoming === current) return;
    const apply = (v: BlackjackView | null) => { shownRef.current = v; setShown(v); };
    // First frame, or a reset to idle → show at once (no pre-terminal frame to linger on).
    if (current == null || incoming == null) {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      apply(incoming);
      return;
    }
    // Crossing into the terminal frame → hold the (redacted) pre-terminal one a beat first.
    if (isTerminalView(incoming) && !isTerminalView(current)) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { timer.current = null; apply(incoming); }, gapMs);
      return;
    }
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    apply(incoming);
  }, [incoming, gapMs]);

  return shown;
}

/** Returns false, then true `delayMs` after `active` becomes true; resets when `active` goes false.
 *  Used to hold the win/lose card frame a beat after the terminal cards land. */
function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) { setOn(false); return; }
    const id = setTimeout(() => setOn(true), delayMs);
    return () => clearTimeout(id);
  }, [active, delayMs]);
  return on;
}

/**
 * The live Blackjack table (item 3/8) — also the persistent post-match table in the result phase.
 * Redaction: own hand in full, exactly ONE opponent card shown (a face-down card stands in for the
 * rest) until the terminal reveal. Cards are centred and overlap; ownership reads from table side +
 * visibility (no name labels — the slot pills carry the usernames). Totals sit above each hand. At
 * the decisive end the cards stay on the table and a green/red frame (server outcome only) rings
 * the player's own cards a beat after the reveal; it persists until a new game starts.
 */
function BlackjackBoard({ playerId, opponentId, gameState, legalMoves, phase, outcome }: GameAreaArgs) {
  // Pace the server's frames so the terminal reveal doesn't snap in instantly (presentation only —
  // the live gameState/legalMoves still drive turn state; this only spaces the displayed cards).
  const view = usePacedView(gameState as BlackjackView | null, TERMINAL_HOLD_MS);
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

  // Opening deal (item 4): the four initial cards arrive one-by-one — own[0], opp[0], own[1],
  // opp-hidden — via a per-card stagger. Only the opening frame staggers; a later Hit / the
  // terminal reveal mount alone with no delay (deal order is meaningless then).
  const opening = !isTerminal && ownCards.length === 2 && oppCards.length === 1;
  const ownDeal = (i: number) => (opening && i < 2 ? (i === 0 ? 0 : 2) * DEAL_STAGGER_S : 0);
  const oppDeal = (i: number) => (opening && i === 0 ? 1 * DEAL_STAGGER_S : 0);
  const backDeal = opening ? 3 * DEAL_STAGGER_S : 0;

  // Win/lose card frame (item: result on the board, no pop-up). Driven strictly by the server's
  // match.end outcome; non win/lose terminals (draw/void) get no frame. Held a beat after reveal.
  const frameKind: 'win' | 'lose' | null =
    outcome && outcome.type !== 'draw' && outcome.type !== 'void'
      ? (outcome.winner === playerId ? 'win' : 'lose')
      : null;
  const ownFrame = useDelayedFlag(phase === 'result' && isTerminal && frameKind != null, FRAME_DELAY_MS) ? frameKind : null;

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

      {/* Opponent hand — centred; exactly one card is ever revealed in play (viewFor redaction).
          Keys carry the round so a re-deal re-mounts (re-animates) the opening deal. */}
      <section data-testid="opp-hand" className="relative z-[1] flex flex-1 flex-col items-center justify-center gap-2">
        <HandTotalPill label={totalLabel(oppCards)} testid="opp-total" />
        <div className="flex items-end justify-center">
          {oppCards.map((c, i) => <PlayingCard key={`opp-${round}-${i}`} card={c} index={i} delay={oppDeal(i)} />)}
          {!isTerminal && <CardBack index={oppCards.length} active={waitingOnOpponent} delay={backDeal} />}
        </div>
      </section>

      {/* Own hand — centred, full. At the decisive end each card is ringed by the win/lose frame. */}
      <section data-testid="own-hand" className="relative z-[1] flex flex-1 flex-col items-center justify-center gap-2">
        <HandTotalPill label={totalLabel(ownCards)} testid="own-total" />
        <div className="flex items-end justify-center">
          {ownCards.map((c, i) => <PlayingCard key={`own-${round}-${i}`} card={c} index={i} delay={ownDeal(i)} frame={ownFrame} />)}
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

/** The Blackjack game-area slot: the greyish table. Empty in idle/waiting; the live hands in-match;
 *  and — because Blackjack opts out of the result pop-up — the SAME board persists in the result
 *  phase so the final cards (with their win/lose frames) stay on the table. */
function BlackjackPanel(args: GameAreaArgs) {
  return args.phase === 'in-match' || args.phase === 'result' ? <BlackjackBoard {...args} /> : <BlackjackIdle phase={args.phase} />;
}

/**
 * Blackjack Hub = the shared GameHub + a Blackjack play-panel (the greyish table with
 * one-opponent-card redaction, centred overlapping hands, dual-ace totals and the left-edge 10s
 * ring timer) and Hit/Stand in the player's slot pill. Blackjack opts OUT of the shared result
 * pop-up: at the decisive end the final cards stay on the table and a green/red frame (server
 * outcome only) rings the player's own cards, persisting until a new game starts or the player
 * leaves. Internal-replay draws loop in the In-match phase. The mechanic / WS flow / redaction
 * are unchanged.
 */
export function BlackjackHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="blackjack"
      gameName="Blackjack"
      renderGameArea={BlackjackPanel}
      renderSlotAside={(args, side) => (side === 'own' && args.phase === 'in-match' ? <BlackjackSlotControls {...args} /> : null)}
      suppressResultOverlay
      {...props}
    />
  );
}
