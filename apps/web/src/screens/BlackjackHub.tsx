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

/** Cards fan with the NEWEST card ON TOP (standard overlapping fan): each card's z-order is fixed
 *  BEFORE its deal animation, ASCENDING with index (`CARD_Z_BASE + index`). The ONE exception is the
 *  opponent's hole card WHILE face-down — it sits UNDER the first card (`CARD_Z_BASE - 1`) so nothing
 *  peeks through; the moment it flips face-up it rejoins the ascending OVER pattern. */
const CARD_Z_BASE = 40;

/** At the terminal reveal the opponent's HIT cards deal in AFTER the hole-card flip (a continuous
 *  scene, not all at once) — the first hit starts at this offset (s); each next one is staggered. */
const HIT_DEAL_START_S = 0.45;

/** Item 5 — the CONVENTIONAL Blackjack hand-value label (soft/hard), never the raw ace combination
 *  ("11, 21" was the bug). Computed from the VISIBLE cards only, so the opponent's total stays
 *  redaction-safe. `final` collapses the ambiguity once the hand is resolved (stand / bust / terminal
 *  reveal). See docs/BLACKJACK.md for the worked examples this implements.
 *
 *  hard = every ace as 1; a soft total exists iff an ace is present and hard + 10 ≤ 21 (only one ace
 *  can ever be 11, so soft is exactly hard + 10); best = soft if it exists, else hard. */
function totalLabel(cards: BlackjackCard[], final = false): string {
  let hard = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 'A') { aces++; hard += 1; }
    else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') hard += 10;
    else hard += Number(c.rank);
  }
  const soft = aces > 0 && hard + 10 <= 21 ? hard + 10 : null;
  const best = soft ?? hard;
  // Soft 21: a two-card 21 is a natural Blackjack → "BJ" (short form, same score-bubble style as the
  // numeric totals; never the wide word "Blackjack"). A 3+ card 21 is just "21".
  if (soft === 21) return cards.length === 2 ? 'BJ' : '21';
  // Dual "hard / soft" ONLY while the hand is live and the ace could still land either way (soft < 21).
  if (!final && soft !== null && soft < 21) return `${hard} / ${soft}`;
  // No live ambiguity (no ace, or the high reading would bust), or the hand is final → single best.
  return String(best);
}

const isRed = (suit: string) => suit === '♥' || suit === '♦';

/** A face-up card. Travels the full distance from the player's right-edge deck to its centred hand
 *  slot and flips to its value on arrival — so a Hit (and the opening deal, staggered via `delay`)
 *  animates a real draw across the felt, and an opponent reveal animates the same way at the
 *  terminal. Only newly-dealt indices mount (the earlier cards keep their keys), so just the
 *  freshly-drawn card makes the trip. At terminal a `frame` rings the player's own cards green
 *  (won) or red (lost) — driven strictly by the server outcome. */
type CardFrame = 'win' | 'lose' | 'bust' | 'draw' | null;
function PlayingCard({ card, index, delay = 0, frame = null }: { card: BlackjackCard; index: number; delay?: number; frame?: CardFrame }) {
  return (
    <motion.div
      data-testid="card"
      initial={{ x: CARD_TRAVEL_PX, y: -12, opacity: 0, rotateY: 90 }}
      animate={{ x: 0, y: 0, opacity: 1, rotateY: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay }}
      style={{ marginLeft: index === 0 ? 0 : -22, zIndex: CARD_Z_BASE + index }}
      className={cn(
        'relative flex h-20 w-14 flex-col items-center justify-center rounded-lg border border-black/10 bg-white font-bold shadow-lg transition-shadow duration-300',
        isRed(card.suit) ? 'text-red-600' : 'text-gray-900',
        frame === 'win' && 'ring-[3px] ring-success shadow-[0_0_14px_rgba(34,197,94,0.55)]',
        // A loss and a bust both read red; a push tie reads orange (the shared draw colour).
        (frame === 'lose' || frame === 'bust') && 'ring-[3px] ring-destructive shadow-[0_0_14px_rgba(239,68,68,0.5)]',
        frame === 'draw' && 'ring-[3px] ring-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.5)]',
      )}
    >
      <span className="text-lg leading-none">{card.rank}</span>
      <span className="text-2xl leading-none">{card.suit}</span>
    </motion.div>
  );
}

/** The opponent's hole card — ONE persistent element that stands in for their hidden card during
 *  play (a face-down back, gently pulsing while they act) and FLIPS in place to its value at the
 *  terminal reveal (a back→face rotateY at its existing position — never an unmount-and-remount, so
 *  the reveal reads as a dealer turning it over, not a screen refresh). Redaction-safe: `card` is
 *  undefined until the server's terminal frame, and the front face is backface-hidden until the flip.
 *  Its testid is `card-back` while hidden and `card` once revealed, so counts stay truthful. */
function OppHoleCard({ card, revealed, index, delay = 0, active = false }: { card?: BlackjackCard; revealed: boolean; index: number; delay?: number; active?: boolean }) {
  const pulsing = active && !revealed;
  return (
    <motion.div
      data-testid={revealed ? 'card' : 'card-back'}
      aria-label={revealed ? undefined : 'Hidden card'}
      initial={{ x: CARD_TRAVEL_PX, opacity: 0 }}
      animate={pulsing ? { x: 0, opacity: 1, y: [0, -4, 0] } : { x: 0, opacity: 1, y: 0 }}
      transition={pulsing
        ? { x: { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }, opacity: { duration: 0.5, delay }, y: { duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: delay + 0.5 } }
        : { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay }}
      // Under the first card WHILE face-down (CARD_Z_BASE - 1, below index 0 — set from the start of
      // the deal, no snap); once revealed it rejoins the ascending OVER fan (CARD_Z_BASE + index).
      style={{ marginLeft: index === 0 ? 0 : -22, zIndex: revealed ? CARD_Z_BASE + index : CARD_Z_BASE - 1, perspective: 600 }}
      className="relative h-20 w-14"
    >
      {/* The flip: rotateY 180 (back faces out) → 0 (face faces out) in place at the reveal. */}
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateY: revealed ? 0 : 180 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Front — the revealed card value (hidden by backface-visibility until the flip lands). */}
        <div
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center rounded-lg border border-black/10 bg-white font-bold shadow-lg',
            card && isRed(card.suit) ? 'text-red-600' : 'text-gray-900',
          )}
          style={{ backfaceVisibility: 'hidden' }}
        >
          {card && (
            <>
              <span className="text-lg leading-none">{card.rank}</span>
              <span className="text-2xl leading-none">{card.suit}</span>
            </>
          )}
        </div>
        {/* Back — the face-down design, pre-rotated so it faces out until the flip. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center rounded-lg border border-white/15 bg-gradient-to-br from-purple-600 to-indigo-900 text-2xl text-white/30 shadow-lg"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          ✦
        </div>
      </motion.div>
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
function BlackjackBoard({ playerId, opponentId, gameState, legalMoves, phase, outcome, drawBeat }: GameAreaArgs) {
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

  const isTerminal = Boolean(view?.winner ?? view?.forcedOutcome);

  // Draws → visible push (BLACKJACK.md). A push is NOT terminal — the server re-deals a fresh round
  // in the same match, so by the time this frame arrives `view.hands` is already the NEW deal. During
  // the shared draw beat (#161) we instead HOLD the just-pushed hands from `lastResult` (both fully
  // revealed) so the push is a visible result, never a silent re-deal. The bars go orange via the
  // shared mechanic (GameHub feeds drawBeat to both slot pills); here we add the red/orange CARDS.
  const lastResult = view?.lastResult;
  const showPush = Boolean(drawBeat && lastResult);
  const ownCards = showPush
    ? (playerId ? lastResult!.hands[playerId]?.cards ?? [] : [])
    : ((playerId && view?.hands[playerId]?.cards) || []);
  const oppCards = showPush
    ? (opponentId ? lastResult!.hands[opponentId]?.cards ?? [] : [])
    : ((opponentId && view?.hands[opponentId]?.cards) || []);

  // A push is exhaustively both-bust (Case 1 → red cards) or equal non-bust totals (Case 2 → orange
  // cards); both hands take the SAME outline. The red card outline keeps its bust meaning even in a
  // push (BLACKJACK.md), so the card-level story stays truthful. Totals are server-authoritative.
  const isBust = (total?: number) => (total ?? 0) > 21;
  const pushFrame: CardFrame = showPush
    ? (isBust(lastResult!.hands[playerId ?? '']?.total) && isBust(lastResult!.hands[opponentId ?? '']?.total) ? 'bust' : 'draw')
    : null;

  const waitingOnOpponent = !isMyTurn && !isTerminal && !showPush && ownCards.length > 0;
  const round = view?.round ?? 0;
  // Own hand is "final" (label collapses to a single best value) once it is done, or at the terminal
  // reveal, or while the pushed hands are held; the opponent's is final only when fully revealed.
  const ownDone = Boolean(playerId && view?.hands[playerId]?.done);
  const ownFinal = isTerminal || showPush || ownDone;
  const oppFinal = isTerminal || showPush;

  // Opening deal (item 4): the four initial cards arrive one-by-one — own[0], opp[0], own[1],
  // opp-hidden — via a per-card stagger. Only the opening frame staggers; a later Hit / the
  // terminal reveal / a held push mount alone with no delay (deal order is meaningless then).
  const opening = !isTerminal && !showPush && ownCards.length === 2 && oppCards.length === 1;
  const ownDeal = (i: number) => (opening && i < 2 ? (i === 0 ? 0 : 2) * DEAL_STAGGER_S : 0);
  const oppDeal = (i: number) => (opening && i === 0 ? 1 * DEAL_STAGGER_S : 0);
  const backDeal = opening ? 3 * DEAL_STAGGER_S : 0;
  // Distinct keys for the held-push cards so they mount/unmount as their own set — the fresh round's
  // cards then re-mount and play their deal animation once the beat ends (no stale in-place swap).
  const ownKey = (i: number) => (showPush ? `push-own-${i}` : `own-${round}-${i}`);
  const oppKey = (i: number) => (showPush ? `push-opp-${i}` : `opp-${round}-${i}`);

  // Win/lose card frame (item: result on the board, no pop-up). Driven strictly by the server's
  // match.end outcome; non win/lose terminals (draw/void) get no frame. Held a beat after reveal.
  const frameKind: 'win' | 'lose' | null =
    outcome && outcome.type !== 'draw' && outcome.type !== 'void'
      ? (outcome.winner === playerId ? 'win' : 'lose')
      : null;
  const ownFrame = useDelayedFlag(phase === 'result' && isTerminal && frameKind != null, FRAME_DELAY_MS) ? frameKind : null;

  return (
    <TableSurface>
      {/* "Push" label: a non-displacing overlay on the RIGHT of the panel, vertically between the two
          hands (BLACKJACK.md). Replaces the old top status line, which reflowed the hands toward the
          middle — nothing about the result may move the card layout. Shows with the push, holds the
          ~2 s draw beat, and is gone the moment the new hands deal (showPush → false). */}
      {showPush && (
        <span
          data-testid="push-label"
          className="pointer-events-none absolute right-5 top-1/2 z-[3] -translate-y-1/2 text-lg font-black uppercase tracking-wider text-amber-400"
        >
          Push
        </span>
      )}

      {/* Left-edge move timer (only on this player's turn). */}
      {isMyTurn && secondsLeft !== null && (
        <div className="absolute left-3 top-1/2 z-[2] -translate-y-1/2">
          <RingTimer seconds={secondsLeft} />
        </div>
      )}

      {/* Opponent hand — centred; exactly one card is revealed in play (viewFor redaction). The
          reveal is CONTINUOUS (no card ever unmounts/blinks): the first card stays, the persistent
          hole card FLIPS in place to its value, then any hit cards deal in one-by-one. On a push both
          hands are held fully-revealed (its own beat). Keys carry the round so a re-deal re-animates. */}
      <section data-testid="opp-hand" className="relative z-[1] flex flex-1 flex-col items-center justify-center gap-2">
        <HandTotalPill label={totalLabel(oppCards, oppFinal)} testid="opp-total" />
        <div className="flex items-end justify-center">
          {showPush ? (
            oppCards.map((c, i) => <PlayingCard key={oppKey(i)} card={c} index={i} delay={oppDeal(i)} frame={pushFrame} />)
          ) : (
            <>
              {oppCards[0] && <PlayingCard key={`opp-${round}-0`} card={oppCards[0]} index={0} delay={oppDeal(0)} />}
              {/* Persistent hole card: face-down in play, flips in place to its value at the reveal. */}
              <OppHoleCard key={`opp-hole-${round}`} index={1} revealed={isTerminal} card={oppCards[1]} active={waitingOnOpponent} delay={backDeal} />
              {/* Opponent hits reveal only at terminal — deal in one-by-one AFTER the hole-card flip. */}
              {isTerminal && oppCards.slice(2).map((c, j) => (
                <PlayingCard key={`opp-hit-${round}-${j}`} card={c} index={j + 2} delay={HIT_DEAL_START_S + j * DEAL_STAGGER_S} />
              ))}
            </>
          )}
        </div>
      </section>

      {/* Own hand — centred, full. At the decisive end each card is ringed by the win/lose frame;
          during a push both hands share the red (bust) / orange (tie) outline. */}
      <section data-testid="own-hand" className="relative z-[1] flex flex-1 flex-col items-center justify-center gap-2">
        <HandTotalPill label={totalLabel(ownCards, ownFinal)} testid="own-total" />
        <div className="flex items-end justify-center">
          {ownCards.map((c, i) => <PlayingCard key={ownKey(i)} card={c} index={i} delay={ownDeal(i)} frame={pushFrame ?? ownFrame} />)}
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
      // The bar speaks ONLY on decided rounds: a win plays the shared win animation, a loss shows a
      // red outline (BLACKJACK.md). ownBarResult drives that at the result phase.
      ownBarResult
      // …and a push shows NOTHING on the bars — the cards + orange "Push" label carry the draw. Opt out
      // of the shared orange draw-bar (the board still gets drawBeat via areaArgs).
      suppressDrawBar
      {...props}
    />
  );
}
