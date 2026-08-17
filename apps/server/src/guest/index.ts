import { randomUUID } from 'node:crypto';
import {
  createEphemeralLedger,
  createMatchmaking,
  type EphemeralLedger,
  type Matchmaking,
} from '@rapidclash/core';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { chessModule, type ChessMove } from '@rapidclash/game-chess';
import { blackjackModule, handValue, type Card } from '@rapidclash/game-blackjack';
import type { GameState, Move } from '@rapidclash/shared';
import {
  GUEST_ID_PREFIX,
  GUEST_CURATED_GAMES,
  GUEST_CHESS_TIME_CONTROL,
  GUEST_BOT_STAKE_LANES,
  isDemoBotId,
} from '@rapidclash/shared';

/** A notional balance for the Demo-Opponent(s) — large enough that they can escrow into an
 *  unbounded number of concurrent guest matches without ever needing a top-up. Granted once at
 *  startup into the SAME ephemeral ledger every guest session uses (issue #267 architecture:
 *  `createMatchmaking(ephemeralLedger, …)` is a second, fully separate Matchmaking instance —
 *  the bots' balance here can never be confused with or leak into the real ledger). */
const DEMO_BOT_NOTIONAL_BALANCE = 1_000_000_000;

/**
 * Issue #351 (guest bot economy, part 2/5 of `docs/COMMS/from-advisor/guest-mode-bot-economy.md`
 * §B) — multi-stake bot-waiter pools. Before this, each curated game kept exactly ONE resting
 * identity (Coinflip) or ONE pool of identities (Chess/Blackjack) at exactly ONE fixed stake
 * (`GUEST_COINFLIP_STAKE`/`GUEST_CHESS_STAKE`/`GUEST_BLACKJACK_STAKE`, all 100), because the
 * core's FIFO matchmaking pairs on the exact key `(gameId, stake, timeControlId)` — one identity
 * can only ever rest at one stake. #350 introduced `GUEST_BOT_STAKE_LANES`, a small fixed set of
 * stakes per curated game; this generalizes "one identity/pool per game" into "one identity/pool
 * PER STAKE LANE per game", so a guest sees several live, pairable stakes instead of one.
 *
 * DECISION (issue #351's own acceptance criteria: "don't leave a dangling old-style single-stake
 * bot alongside the new pools for the same game") — SUPERSEDE, not coexist. The old fixed-100
 * identities/pools below are gone; `GUEST_COINFLIP_STAKE`/`GUEST_CHESS_STAKE`/
 * `GUEST_BLACKJACK_STAKE` (still defined in `packages/shared/src/guest.ts` — out of this file's
 * scope to remove) are no longer read by this module at all. A guest posting the old fixed 100
 * stake will NOT find a bot resting until the client-side issue #353 (unlock the guest bet
 * control) also ships and stops pre-arming that old value — that's an accepted, PM-sequenced
 * transition window (see docs/COMMS/CODER_TO_PM.md), not an oversight.
 *
 * Pool SIZE per lane: Coinflip keeps its original shape (a single identity, no pool) — a round
 * resolves the instant both sides pick, so the bot is never "mid-match" for any observable
 * duration, at any stake; one identity per lane suffices exactly as one identity sufficed for the
 * whole game before. Chess and Blackjack keep their original POOL of 3 (issues #278/#297) —
 * unchanged size, but now instantiated independently per stake lane rather than once for the
 * whole game, so the existing "3 concurrent guest games" capacity is preserved PER STAKE rather
 * than regressing to 1 concurrent game per stake. This read wasn't 100% unambiguous from the
 * issue text alone (which gives only a Coinflip-shaped example, "mint one bot identity per stake
 * lane") — flagged explicitly in `docs/COMMS/CODER_TO_PM.md` rather than silently picked, but
 * this is the interpretation implemented, because the issue's OWN "Key constraint to preserve"
 * only makes sense if a lane can hold >1 identity: "the same reasoning that already prevents two
 * Chess pool bots pairing against each other now needs to hold per-lane" presupposes two Chess
 * pool bots can share a lane.
 */
const CHESS_POOL_SIZE = 3;
const BLACKJACK_POOL_SIZE = 3;

function mintPoolIds(gameId: 'coinflip' | 'chess' | 'blackjack', stake: number, size: number): readonly string[] {
  return Array.from({ length: size }, (_, i) => `demo-bot:${gameId}:${stake}:${i}`);
}

/** Coinflip: one identity per stake lane (`demo-bot:coinflip:<stake>:0`) — keyed by stake for
 *  direct lookup, since (unlike Chess/Blackjack) there's never more than one per lane to search
 *  among. The trailing `:0` is kept purely for naming symmetry with the pools below. */
const DEMO_BOT_COINFLIP_IDS: Readonly<Record<number, string>> = Object.fromEntries(
  GUEST_BOT_STAKE_LANES.coinflip.map((stake) => [stake, mintPoolIds('coinflip', stake, 1)[0]] as const),
);

/**
 * A small pool of independent Chess bot identities PER STAKE LANE (issue #278's pool pattern,
 * generalized by #351). Coinflip's single per-lane identity (above) works because a round
 * resolves the instant both sides pick — the bot is never "mid-match" for any observable
 * duration. Chess runs for minutes across many moves; reusing one identity across two concurrent
 * guests (even at different stakes) would collide in the gateway's playerId → matchId reverse
 * lookup (one entry per player), silently misrouting the first guest's moves/responses into the
 * second guest's match — so every lane needs its OWN independent pool. Three independent
 * identities per lane ⇒ 3 concurrent guest chess games AT THAT STAKE; a 4th same-stake guest
 * genuinely waits in the FIFO queue like any other unmatched bet, until a slot frees.
 */
const DEMO_BOT_CHESS_IDS: Readonly<Record<number, readonly string[]>> = Object.fromEntries(
  GUEST_BOT_STAKE_LANES.chess.map((stake) => [stake, mintPoolIds('chess', stake, CHESS_POOL_SIZE)] as const),
);

/**
 * A small pool of independent Blackjack bot identities PER STAKE LANE (issue #297's pool
 * pattern, generalized by #351), same reasoning as `DEMO_BOT_CHESS_IDS`: a Blackjack match has a
 * 10s per-decision timer, reveal choreography, and possible draw-replays (up to 10), so it's
 * mid-match for real time — unlike Coinflip, which resolves the instant both sides pick. Pool
 * size 3 per lane (unchanged from #297's original, Owner-confirmed size).
 */
const DEMO_BOT_BLACKJACK_IDS: Readonly<Record<number, readonly string[]>> = Object.fromEntries(
  GUEST_BOT_STAKE_LANES.blackjack.map((stake) => [stake, mintPoolIds('blackjack', stake, BLACKJACK_POOL_SIZE)] as const),
);

/** Read once per `createGuestServices()` call (NOT a module-top-level constant — `process.env`
 *  must be re-read fresh each time, the same reason `forfeitDelayMs` is computed inside
 *  `registerWsGateway` rather than at gateway.ts's module scope: a top-level constant bakes in
 *  whatever the env held at first import and ignores every later test's override). */
function intEnv(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Standard capture values (pawn/knight/bishop/rook/queen); a king is never captured. */
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** The chosen move to submit, and how long to wait before actually submitting it (issue #278
 *  §4's "thinking" delay). Submission itself is the caller's job (gateway.ts owns the
 *  setTimeout/broadcast machinery — see its `maybeScheduleGuestBotMove`); this is pure. */
export interface SelectedBotMove {
  move: Move;
  delayMs: number;
}

/** Sum of one side's piece values on a FEN's piece-placement field (the part before the first
 *  space) — used to diff a candidate move's effect on the OPPONENT's material (issue #278 §3's
 *  "recommended implementation": no chess.js dependency needed in apps/server, just parse the
 *  FEN chess.js itself already hands back via `ChessMove` state's `fen` field). */
function materialOn(fen: string, side: 'w' | 'b'): number {
  const placement = fen.split(' ')[0];
  let total = 0;
  for (const ch of placement) {
    if (ch === '/' || (ch >= '0' && ch <= '9')) continue;
    const isWhite = ch === ch.toUpperCase();
    if (isWhite === (side === 'w')) total += PIECE_VALUE[ch.toLowerCase()] ?? 0;
  }
  return total;
}

/**
 * Chess move-selection heuristic (issue #278 §3, Owner's explicit spec), pure and
 * fully deterministic given `random`:
 *   1-2. Enumerate every legal move; score each by the value of what it captures — evaluated by
 *        speculatively calling `chessModule.applyMove` for EVERY candidate (a pure function; it
 *        never touches the real match) and diffing the opponent's total material before/after.
 *        This full evaluation always runs, every move, regardless of what the gate below does.
 *   3. The highest-scoring move wins; ties (including "nothing captures, everything scores 0")
 *      broken by a uniform random pick among the tied top-scorers.
 *   4. 50/50 gate: half the time play the step-3 move: half the time play a uniformly random
 *      OTHER legal move instead — unless step-3's move is the bot's only legal move, in which
 *      case it's played regardless.
 * `random` defaults to `Math.random`; tests inject a seeded source for deterministic, repeatable
 * trials (real randomness can't be asserted on directly — see the acceptance criteria).
 */
export function selectChessMove(
  state: GameState,
  botId: string,
  now: number,
  random: () => number = Math.random,
): ChessMove {
  const s = state as { players: [string, string]; fen: string };
  const legal = chessModule.legalMoves(state, botId) as ChessMove[];
  if (legal.length === 0) {
    throw new Error(`selectChessMove called for ${botId}, who has no legal move`);
  }

  const botSide: 'w' | 'b' = s.players[0] === botId ? 'w' : 'b';
  const oppSide: 'w' | 'b' = botSide === 'w' ? 'b' : 'w';
  const oppMaterialBefore = materialOn(s.fen, oppSide);

  // Steps 1-2: full evaluation, unconditionally, before the gate below ever runs.
  let bestScore = -Infinity;
  let best: ChessMove[] = [];
  for (const move of legal) {
    const speculative = chessModule.applyMove(state, move, { playerId: botId, now });
    const newFen = (speculative.state as { fen: string }).fen;
    const captured = oppMaterialBefore - materialOn(newFen, oppSide);
    if (captured > bestScore) {
      bestScore = captured;
      best = [move];
    } else if (captured === bestScore) {
      best.push(move);
    }
  }

  // Step 3: tie-break uniformly among the top scorers.
  const step3Move = best.length === 1 ? best[0] : best[Math.floor(random() * best.length)];

  // Step 4: the 50/50 gate — skipped only when step3Move is the bot's sole legal move.
  if (legal.length === 1) return step3Move;
  const playStep3 = random() < 0.5;
  if (playStep3) return step3Move;

  const step3Key = JSON.stringify(step3Move);
  const others = legal.filter((m) => JSON.stringify(m) !== step3Key);
  return others.length === 1 ? others[0] : others[Math.floor(random() * others.length)];
}

/**
 * P(hit) keyed to the hand's BEST value (issue #297, Owner-specified table — deliberately NOT a
 * flat "stand on 17" rule). "Best" is exactly `handValue`'s soft-if-it-exists-else-hard total, the
 * same value `BLACKJACK.md`'s own display logic computes — reused here, not re-derived.
 */
function hitProbability(best: number): number {
  if (best <= 14) return 1;
  if (best === 15) return 0.9;
  if (best === 16) return 0.8;
  if (best === 17) return 0.5;
  if (best === 18) return 0.2;
  return 0; // >= 19
}

/**
 * Blackjack hit/stand heuristic (issue #297, Owner's explicit spec): sample once per decision
 * point against `hitProbability` of the bot's own hand's best value. Pure and deterministic given
 * `random` (defaults to `Math.random`; tests inject a seeded source — same pluggable-random
 * pattern as `selectChessMove` above, for repeatable statistical trials).
 */
export function selectBlackjackMove(
  state: GameState,
  botId: string,
  random: () => number = Math.random,
): 'hit' | 'stand' {
  const legal = blackjackModule.legalMoves(state, botId);
  if (legal.length === 0) {
    throw new Error(`selectBlackjackMove called for ${botId}, who has no legal move`);
  }
  const s = state as { hands: Record<string, { cards: Card[]; done: boolean }> };
  const best = handValue(s.hands[botId].cards);
  return random() < hitProbability(best) ? 'hit' : 'stand';
}

export function isGuestId(id: string): boolean {
  return id.startsWith(GUEST_ID_PREFIX);
}

export function mintGuestId(): string {
  return `${GUEST_ID_PREFIX}${randomUUID()}`;
}

export interface GuestServices {
  ledger: EphemeralLedger;
  matchmaking: Matchmaking;
  /** Resolve a display name for a guest/bot id; undefined for anything else (the caller falls
   *  back to the real identity.getUsername — this never answers for a non-guest, non-bot id, so
   *  the real identity layer is never asked about a guest id in the first place). */
  usernameFor(id: string): string | undefined;
  /** Call once right after a guest's `queue.join`/`challenge.take` matches them against a
   *  resting Demo-Opponent (any curated game — dispatches on `MatchRecord.gameId`, issue #278).
   *  Coinflip: submits the bot's pick immediately through the normal `GameModule` contract (redaction
   *  holds automatically), then re-posts the bot so the next guest pairs instantly — unchanged
   *  from issue #267. Chess and Blackjack: only mark the matched pool identity busy — their moves
   *  are delayed ("thinking" time) and need the gateway's WS broadcast machinery to reach the
   *  human the moment they're submitted, so the actual move is selected/scheduled by the gateway
   *  via `selectBotMove` below, not submitted here. Blackjack additionally never needs an
   *  opponent-move trigger at all (issue #297 — concurrent, not turn-based): the gateway's
   *  generic post-match-formation + post-broadcast scheduling already fires the bot's first (and
   *  every subsequent) decision purely off its own `legalMoves`, with no bespoke hook here. */
  onDemoBotMatched(matchId: string, now: number): void;
  /** Idempotent: (re-)post every currently-free Demo-Opponent into its resting queue slot, ACROSS
   *  EVERY STAKE LANE (issue #351). Coinflip: one identity per lane, unconditionally re-posted
   *  every call — unchanged reasoning from issue #267/#274, just repeated per lane. Chess and
   *  Blackjack: loop their own pool PER LANE — a pool identity re-rests only once its current
   *  match has actually ended (checked via `matchmaking.getActiveMatch`, never blindly), so a
   *  mid-game bot is never double-queued into a second concurrent match (the exact collision
   *  issue #278 exists to prevent, issue #297 reuses verbatim for Blackjack, and issue #351
   *  enforces independently per stake lane). Called once at startup, after every
   *  `onDemoBotMatched`, AND once per gateway sweep tick (self-heals a TTL-expiry-driven removal
   *  — see issue #274). */
  ensureDemoBotResting(): void;
  /** Chess and Blackjack today (issues #278/#297): given an active match's raw state and the id
   *  of the pool bot due to act, run that game's heuristic and pick a 1-5s "thinking" delay.
   *  Returns undefined for any game with no bot move-selection logic (defensive — the gateway
   *  only calls this once it has confirmed `botId` actually has a legal move). Pure: no timer, no
   *  submission, no broadcast — the gateway owns all of that (mirrors its existing
   *  `pendingForfeits`/`pendingGuestEvictions` cancelable-timer pattern). */
  selectBotMove(gameId: string, state: GameState, botId: string, now: number): SelectedBotMove | undefined;
}

export function createGuestServices(
  opts: { now?: () => number; ttlMs?: number; random?: () => number } = {},
): GuestServices {
  const ledger = createEphemeralLedger();
  // The idempotency key must be UNIQUE PER ACCOUNT: the ephemeral ledger dedups by that key
  // alone (not key+account), so reusing one literal string across multiple bot ids would credit
  // only the first and silently no-op the rest. Every minted identity across every stake lane
  // needs its own grant (issue #351 — one per Coinflip lane, `CHESS_POOL_SIZE`/
  // `BLACKJACK_POOL_SIZE` per Chess/Blackjack lane).
  for (const botId of Object.values(DEMO_BOT_COINFLIP_IDS)) {
    ledger.adminCredit(botId, DEMO_BOT_NOTIONAL_BALANCE, `demo-bot:init:${botId}`);
  }
  for (const botId of Object.values(DEMO_BOT_CHESS_IDS).flat()) {
    ledger.adminCredit(botId, DEMO_BOT_NOTIONAL_BALANCE, `demo-bot:init:${botId}`);
  }
  for (const botId of Object.values(DEMO_BOT_BLACKJACK_IDS).flat()) {
    ledger.adminCredit(botId, DEMO_BOT_NOTIONAL_BALANCE, `demo-bot:init:${botId}`);
  }

  const random = opts.random ?? Math.random;
  // Issue #278 §4's "thinking" delay bounds — env-overridable so a live WS-gateway test isn't
  // forced to wait out real seconds, same pattern as `RC_PICK_WINDOW_MS`/`FORFEIT_DELAY_MS`.
  const thinkMsMin = intEnv('GUEST_BOT_THINK_MIN_MS', 1_000);
  const thinkMsMax = intEnv('GUEST_BOT_THINK_MAX_MS', 5_000);

  function usernameFor(id: string): string | undefined {
    if (isDemoBotId(id)) return 'Demo Opponent 🤖';
    if (isGuestId(id)) return 'Guest';
    return undefined;
  }

  // A SEPARATE Matchmaking instance (own queues/active-matches, own ledger) — isolated from the
  // real one by construction, per issue #267. Only the curated game set is registered, so a
  // guest can never join-queue for anything outside GUEST_CURATED_GAMES. No matchHistory →
  // guest matches never write to the real leaderboard/standings.
  const matchmaking = createMatchmaking(ledger, [coinflipModule, chessModule, blackjackModule], undefined, {
    lookupUsername: usernameFor,
    now: opts.now,
    ttlMs: opts.ttlMs,
  });

  // Tracks which chess pool identity is busy in which match, so `ensureDemoBotResting` never
  // re-queues one still mid-game (issue #278's central concurrency invariant). ONE map across ALL
  // stake lanes (not one map per lane) — every minted id across every lane is already globally
  // unique (`demo-bot:chess:<stake>:<i>`), and `ensureDemoBotResting` below only ever looks up a
  // given lane's OWN ids within it, so sharing the map costs nothing and avoids a map-of-maps.
  // Cleared lazily — the next `ensureDemoBotResting` call notices (via `getActiveMatch`) that a
  // tracked match has actually ended and frees the slot, same self-healing sweep-tick pattern as
  // issue #274.
  const chessBotMatch = new Map<string, string>();

  // Same tracking, own pool (issue #297) — kept as a SEPARATE map from `chessBotMatch` rather than
  // one keyed by botId across both games: the two pools' ids never collide (`demo-bot:chess:...`
  // vs `demo-bot:blackjack:...`), but keeping them apart mirrors the pattern issue #278
  // established and avoids one game's free-slot sweep accidentally touching the other's
  // bookkeeping.
  const blackjackBotMatch = new Map<string, string>();

  function ensureDemoBotResting(): void {
    // Coinflip: one identity per stake lane, always (re-)posted unconditionally — joinQueue is
    // idempotent for a player already resting at this exact key (it returns the existing entry
    // rather than duplicating), and a round resolves the instant both sides pick so there's never
    // a "busy" state to track, exactly as issue #267/#274 established for the single pre-#351
    // identity — just repeated once per lane instead of once for the whole game.
    for (const [stake, botId] of Object.entries(DEMO_BOT_COINFLIP_IDS)) {
      matchmaking.joinQueue(botId, 'coinflip', Number(stake));
    }

    // Free any chess pool slot whose tracked match has actually ended (across every lane at once
    // — matchId lookup doesn't care which stake the freed bot rests at).
    for (const [botId, matchId] of [...chessBotMatch]) {
      if (!matchmaking.getActiveMatch(matchId)) chessBotMatch.delete(botId);
    }
    // AT MOST ONE chess pool bot ever rests PER STAKE LANE at a time — this is load-bearing, not
    // an optimization, and it's now enforced independently for EVERY lane (issue #351's "Key
    // constraint to preserve"). The core's ordinary FIFO pairing matches ANY two distinct
    // playerIds resting at the same (gameId, stake, timeControlId) key; if two pool bots in the
    // SAME lane rested simultaneously they'd pair against EACH OTHER the instant the second one
    // joined (a bot must never play another bot) — different lanes can never pair with each other
    // regardless (stake is part of the exact key), but within one lane the invariant still has to
    // be enforced explicitly. Posting only the first idle sibling per lane — and re-calling this
    // function SYNCHRONOUSLY the instant one is taken (see `onDemoBotMatched` below, mirroring
    // Coinflip's own immediate re-rest) — means the next idle bot is resting well before any other
    // guest's WS message can possibly be processed, so up to `CHESS_POOL_SIZE` guests still pair
    // concurrently AT EACH stake. This call (also made every sweep tick) doubles as the
    // TTL-expiry self-heal backstop, same mechanism as issue #274.
    for (const [stake, ids] of Object.entries(DEMO_BOT_CHESS_IDS)) {
      const nextToRest = ids.find((id) => !chessBotMatch.has(id));
      if (nextToRest !== undefined) {
        matchmaking.joinQueue(nextToRest, 'chess', Number(stake), GUEST_CHESS_TIME_CONTROL);
      }
    }

    // Same "at most one idle pool bot rests per lane at a time" invariant, own pool (issue #297)
    // — see the chess block above for the full rationale (self-pairing avoidance + immediate
    // re-rest), now per stake lane exactly like chess.
    for (const [botId, matchId] of [...blackjackBotMatch]) {
      if (!matchmaking.getActiveMatch(matchId)) blackjackBotMatch.delete(botId);
    }
    for (const [stake, ids] of Object.entries(DEMO_BOT_BLACKJACK_IDS)) {
      const nextToRest = ids.find((id) => !blackjackBotMatch.has(id));
      if (nextToRest !== undefined) {
        // No time-control equivalent for Blackjack — same queue-key shape as Coinflip, just at
        // this lane's own fixed stake.
        matchmaking.joinQueue(nextToRest, 'blackjack', Number(stake));
      }
    }
  }

  function onDemoBotMatched(matchId: string, now: number): void {
    const match = matchmaking.getActiveMatch(matchId);
    if (!match) return;

    if (match.gameId === 'coinflip') {
      // Which of the 4 (one per lane) Coinflip identities matched depends on which stake the
      // guest posted — no longer a single well-known id, so find it the same way Chess/Blackjack
      // already do below.
      const botId = match.players.find(isDemoBotId);
      if (botId !== undefined) {
        const legal = coinflipModule.legalMoves(match.state, botId) as Array<'heads' | 'tails'>;
        if (legal.length > 0) {
          const pick = legal[Math.floor(Math.random() * legal.length)];
          matchmaking.applyMove(matchId, botId, pick, now);
        }
      }
      ensureDemoBotResting(); // keep exactly one resting entry per lane so the NEXT guest pairs instantly too
      return;
    }

    if (match.gameId === 'chess') {
      const botId = match.players.find(isDemoBotId);
      if (botId !== undefined) {
        chessBotMatch.set(botId, matchId);
        ensureDemoBotResting(); // immediately post the next idle sibling — see its comment above
      }
      // No move submitted here — the gateway schedules it (with the "thinking" delay) via
      // `selectBotMove` + its own timer, since only it can broadcast the result once submitted.
      return;
    }

    if (match.gameId === 'blackjack') {
      const botId = match.players.find(isDemoBotId);
      if (botId !== undefined) {
        blackjackBotMatch.set(botId, matchId);
        ensureDemoBotResting(); // immediately post the next idle sibling — see its comment above
      }
      // No move submitted here either. Unlike Chess (turn-based — the bot only owes a move once
      // the opponent has moved), Blackjack is concurrent (issue #297, BLACKJACK.md: "both players
      // act on their own hand"): the bot's decision loop is SELF-triggered, not opponent-triggered.
      // No bespoke trigger is needed here because the gateway's existing generic hook already
      // covers it: `maybeScheduleGuestBotMove` runs once right after every match forms (this
      // match's round is already dealt — `blackjackModule.init` deals it) and again after every
      // subsequent non-terminal move broadcast (the bot's own hits included, and every internal
      // draw/replay's fresh `new_round` deal) — it schedules a decision whenever the bot has a
      // legal move and none is already pending. That's exactly "trigger on match creation, then
      // after each of the bot's own hits, then after each replay's re-deal" — issue #297's spec.
    }
  }

  function selectBotMove(gameId: string, state: GameState, botId: string, now: number): SelectedBotMove | undefined {
    if (gameId === 'chess') {
      const move = selectChessMove(state, botId, now, random);
      const delayMs = thinkMsMin + random() * (thinkMsMax - thinkMsMin); // uniform (issue #278 §4)
      return { move, delayMs };
    }
    if (gameId === 'blackjack') {
      const move = selectBlackjackMove(state, botId, random);
      // Same 1-5s "thinking" bounds, reused verbatim (issue #297 — no new env knobs). Each Hit
      // resets the CORE's 10s per-player move timer, so this delay must stay comfortably under
      // it — it already does, at 1-5s.
      const delayMs = thinkMsMin + random() * (thinkMsMax - thinkMsMin);
      return { move, delayMs };
    }
    return undefined;
  }

  ensureDemoBotResting(); // once at startup

  return { ledger, matchmaking, usernameFor, onDemoBotMatched, ensureDemoBotResting, selectBotMove };
}

export { GUEST_ID_PREFIX, GUEST_CURATED_GAMES };
// Per-stake-lane id pools (issue #351) — keyed by stake so tests/callers can look up the exact
// resting identity for a given lane without hardcoding the `demo-bot:<game>:<stake>:<i>` shape.
export { DEMO_BOT_COINFLIP_IDS, DEMO_BOT_CHESS_IDS, DEMO_BOT_BLACKJACK_IDS };
