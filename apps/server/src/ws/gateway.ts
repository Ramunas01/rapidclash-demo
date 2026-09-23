import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import type Database from 'better-sqlite3';
import type { Identity, Ledger, Matchmaking, JoinMatched, MatchRecord, ChatTransport } from '@rapidclash/core';
import {
  ChallengeError,
  usesPlayerTimers,
  usesScheduledDeadlines,
  createChatTransport,
  CHAT_MAX_MESSAGE_LENGTH,
} from '@rapidclash/core';
import { IllegalMove, isDemoBotId } from '@rapidclash/shared';
import type { GuestServices } from '../guest/index.js';
import { createTierResolver } from '../tier.js';
import type {
  Envelope,
  QueueJoinPayload,
  QueueLeavePayload,
  MatchResumePayload,
  MoveMakePayload,
  QueueWaitingPayload,
  MatchStartPayload,
  MatchStatePayload,
  MatchYourTurnPayload,
  MatchEndPayload,
  ErrorPayload,
  ChallengeSubscribePayload,
  ChallengeTakePayload,
  ChallengesListPayload,
  ChallengesUpdatePayload,
  ChallengeExpiredPayload,
  OpenChallenge,
  ApplyResult,
  ChatSendPayload,
  ChatMessagePayload,
  ChatHistoryPayload,
} from '@rapidclash/shared';
import type { GameModule } from '@rapidclash/shared';

// Convenience alias for the underlying ws WebSocket instance type.
type WsSocket = SocketStream['socket'];

// Track connected players so we can push to the waiter when a match forms.
const connections = new Map<string, WsSocket>();

// Ticket 2026-09-21#9 (D36): whether each live socket has answered a `pong` since its last
// `ping` — the standard `ws` library heartbeat idiom, detecting a connection that died WITHOUT a
// clean close (common on mobile: lost signal, backgrounding, network switch), which the existing
// `close` handler below has no way to know about on its own. A `WeakMap` (not a plain `Map`) so a
// closed/replaced socket's entry is garbage-collected automatically, never needing its own
// cleanup — nothing else here reads this after a socket stops being connections' current value
// for its player. See `heartbeatTimer` below for how this is set/consumed.
const socketAlive = new WeakMap<WsSocket, boolean>();

// Reverse-lookup: which matchId is a player currently in?
const playerMatch = new Map<string, string>();

// Open-challenge feed subscribers, keyed by gameId → set of sockets.
const challengeSubscribers = new Map<string, Set<WsSocket>>();

// Chat (issue #439/ticket 2026-09-11#7a) subscriber set — a flat Set, not a Map keyed by room
// like challengeSubscribers above, because chat is general-only for V1 (one global room, no
// per-game keying, per the Advisor/PM decision this ticket builds on).
const chatSubscribers = new Set<WsSocket>();

// Pending forfeit timers: set on disconnect, cancelled on reconnect/resume.
const pendingForfeits = new Map<string, ReturnType<typeof setTimeout>>();

// Guest session cleanup (issue #267 — session lifetime policy, GUEST_MODE_STRATEGY.md §8): a
// guest's ephemeral-ledger entries are evicted `forfeitDelayMs` after their WS closes, same grace
// window as the real forfeit timer, so a brief network blip doesn't wipe a live guest's balance
// mid-match. Cancelled on reconnect, mirroring `pendingForfeits`. A SEPARATE map/timer from
// `pendingForfeits` because Coinflip is a scheduled-deadline game (`usesScheduledDeadlines`) and
// so never arms a close-forfeit timer at all (see the close handler below) — eviction must not
// depend on that branch running. Deliberately NOT a durable/queryable cleanup system (per
// GUEST_MODE_STRATEGY.md §7's "don't over-build") — just a bound on in-memory growth.
const pendingGuestEvictions = new Map<string, ReturnType<typeof setTimeout>>();

// A demo bot's delayed "thinking" move (issue #278), keyed by matchId — at most one pending
// move per match. For turn-based games (Chess) that's because the game itself strictly
// alternates; for concurrent games (Blackjack, issue #297) it's because the bot only ever decides
// its OWN next action once its previous one has resolved — never two decisions in flight for the
// same bot at once, regardless of what the human opponent is doing on their own hand at the same
// time. Scheduled by `maybeScheduleGuestBotMove` once the bot has a legal move (a "turn" for
// Chess, a live not-yet-done hand for Blackjack); cancelled by `cancelPendingBotMove` wherever a
// match can end out from under it (forfeit, draw acceptance, a sweep resolving it) so a "thinking"
// bot never applies a move to — or crashes trying to broadcast for — a match that's already gone.
const pendingBotMoves = new Map<string, ReturnType<typeof setTimeout>>();

// Issue #352 (guest bot economy 3/5): a bot-taker's delayed claim of a guest's own resting stake,
// keyed by matchId — at most one pending take per resting bet. Cancelled wherever that resting
// bet can disappear out from under it before the timer fires (the guest cancels via queue.leave,
// or abandons it via socket close) so a stale timer never fires a `takeChallenge` against a
// matchId that's already been refunded and forgotten — mirrors `pendingForfeits`/
// `pendingGuestEvictions`/`pendingBotMoves`'s own cancelable-timer pattern. Even an un-cancelled
// fire is harmless by construction (`guest.takeGuestStake` swallows a gone-challenge
// `ChallengeError` and no-ops), so this is hygiene, not a correctness requirement.
const pendingGuestBotTakes = new Map<string, ReturnType<typeof setTimeout>>();

const DEFAULT_FORFEIT_DELAY_MS = 60_000;
const SWEEP_INTERVAL_MS = (() => {
  const n = parseInt(process.env.CHALLENGE_SWEEP_MS ?? '', 10);
  return Number.isFinite(n) ? n : 1_000;
})();
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
// Ticket 2026-09-24#1: how long a fully-refunded ledger_entry group must sit before it's
// pruned, and how often the sweep runs. Defaults chosen so a resting bot's own recent
// post→expire→refund cycle (ADR-010) stays visible in a fresh wallet-history read for a
// couple of days, while the sweep itself checks hourly (cheap no-op once the backlog is
// clear — see cleanupSettled's own doc comment for why a bigger backlog still can't block a
// live request even on an hourly cadence).
const DEFAULT_LEDGER_CLEANUP_RETENTION_DAYS = 2;
const DEFAULT_LEDGER_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function send<T>(socket: WsSocket, type: string, payload: T, matchId?: string): void {
  const env: Envelope<T> = { type, payload, ...(matchId ? { matchId } : {}) };
  socket.send(JSON.stringify(env));
}

function sendError(socket: WsSocket, code: string, message: string): void {
  send<ErrorPayload>(socket, 'error', { code, message });
}

/** Cancel a demo bot's pending delayed move for `matchId`, if one is scheduled — a no-op
 *  otherwise. Call this wherever a match can end while a bot is still "thinking" (issue #278). */
function cancelPendingBotMove(matchId: string): void {
  const pending = pendingBotMoves.get(matchId);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingBotMoves.delete(matchId);
  }
}

/** Cancel a bot-taker's pending delayed claim for `matchId`, if one is scheduled — a no-op
 *  otherwise (issue #352). Call wherever a guest's own resting bet can disappear before the
 *  timer fires: they cancel it (`queue.leave`) or abandon it (socket close). */
function cancelPendingGuestBotTake(matchId: string): void {
  const pending = pendingGuestBotTakes.get(matchId);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingGuestBotTakes.delete(matchId);
  }
}

export function registerWsGateway(
  app: FastifyInstance,
  identity: Identity,
  matchmaking: Matchmaking,
  gameModules: GameModule[],
  /** The shared server DB — a read-only VIP-tier lookup backing chat's `resolveTier` (see
   *  below); every other handler in this file still reaches persistence exclusively through
   *  `identity`/`matchmaking`/`guest`/`ledger`. */
  db: Database.Database,
  /** Guest mode's isolated world (issue #267) — a second Matchmaking + its own ledger, wired in
   *  by `server.ts`. Optional so existing call sites (and tests) that don't care about guest
   *  mode need no change; a guest token then simply falls back to the real matchmaking below. */
  guest?: GuestServices,
  /** Ticket 2026-09-24#1: the REAL ledger instance (same one `matchmaking` writes through),
   *  needed here for the periodic `cleanupSettled` sweep — never the guest world's ephemeral
   *  ledger (that one's `cleanupSettled` is a documented no-op; guest data is already bounded
   *  by per-session eviction). Optional so an existing call site/test omitting it simply never
   *  arms the cleanup timer, same "byte-identical no-op elsewhere" shape as `guest` above. */
  ledger?: Ledger,
  /** Called after a cleanup pass that ACTUALLY deleted rows — same debounced-snapshot-trigger
   *  hook `AppOptions.onWrite` already wires up for registration/admin-credit/reward-claim
   *  (issue #378); a pass that deletes nothing never calls this (no DB write happened). */
  onWrite?: () => void,
): void {
  const moduleByGame = new Map<string, GameModule>(gameModules.map((m) => [m.meta.id, m]));

  // Read at registration so tests (and ops) can tune it via env; defaults to 60s.
  const forfeitDelayMs = (() => {
    const n = parseInt(process.env.FORFEIT_DELAY_MS ?? '', 10);
    return Number.isFinite(n) ? n : DEFAULT_FORFEIT_DELAY_MS;
  })();

  // Ticket 2026-09-21#9 (D36): read at registration, same pattern/reason as forfeitDelayMs above
  // (NOT a module-level const — those are frozen at import time, before any test's `beforeEach`
  // env-var override could ever take effect). Defaults to the standard ws-library heartbeat
  // cadence, deliberately its own, much longer interval than SWEEP_INTERVAL_MS above (that one
  // drives matchmaking sweeps, not connection liveness, and defaults to 1s — far too tight to
  // ping every live socket on). 30s means a dead connection is detected and its concurrency slot
  // freed within ~30-60s, instead of sitting occupied for up to Cloud Run's own 3600s hard cap.
  const heartbeatIntervalMs = (() => {
    const n = parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? '', 10);
    return Number.isFinite(n) ? n : DEFAULT_HEARTBEAT_INTERVAL_MS;
  })();

  // Ticket 2026-09-24#1: read at registration, same pattern/reason as forfeitDelayMs/
  // heartbeatIntervalMs above.
  const ledgerCleanupRetentionDays = (() => {
    const n = parseInt(process.env.LEDGER_CLEANUP_RETENTION_DAYS ?? '', 10);
    return Number.isFinite(n) ? n : DEFAULT_LEDGER_CLEANUP_RETENTION_DAYS;
  })();
  const ledgerCleanupIntervalMs = (() => {
    const n = parseInt(process.env.LEDGER_CLEANUP_INTERVAL_MS ?? '', 10);
    return Number.isFinite(n) ? n : DEFAULT_LEDGER_CLEANUP_INTERVAL_MS;
  })();

  // Issue #352: how long a guest's own resting stake sits before a bot-taker claims it —
  // deliberately not instant (an immediate claim would read as scripted, not "a person was
  // found"), but short enough to still feel always-on. Sits comfortably inside the client's own
  // "Searching…" minimum-dwell floor (DEMO_PRESENTATION.md: 2-4s) without needing to match it
  // exactly — the dwell is a client-side floor, not a server contract; "Searching…" simply
  // continues however long this actually takes. Env-overridable exactly like
  // GUEST_BOT_THINK_MIN_MS/MAX_MS (guest/index.ts) so tests don't wait out real seconds.
  const guestTakeMinMs = (() => {
    const n = parseInt(process.env.GUEST_BOT_TAKE_MIN_MS ?? '', 10);
    return Number.isFinite(n) ? n : 1_000;
  })();
  const guestTakeMaxMs = (() => {
    const n = parseInt(process.env.GUEST_BOT_TAKE_MAX_MS ?? '', 10);
    return Number.isFinite(n) ? n : 3_000;
  })();

  // Chat kill switch (issue #439/ticket 2026-09-11#7a), read once at registration exactly like
  // FORFEIT_DELAY_MS/GUEST_BOT_TAKE_MIN_MS/MAX_MS above — a plain boot-time env var, enforced
  // server-side, matching the existing idiom exactly (not a client-bundled flag, and not a
  // live-flippable-without-restart mechanism — the Advisor/PM decision this ticket builds on
  // settled for the second, precedent-matching reading). DEFAULT DISABLED: a forgotten/missing
  // env var must fail CLOSED (chat off), not open, on a fresh deploy — the literal string
  // 'true' is the only way to turn it on.
  const chatEnabled = process.env.CHAT_ENABLED === 'true';

  /** Resolve a display name for ANY id — bot/guest first (never a DB lookup), else the real
   *  identity layer. The single replacement for every `identity.getUsername(...)` call site
   *  below, so the real identity layer is never asked about a guest or bot id (issue #267's
   *  explicit watch-out: `getUsername`/`getAvatarId` against the real accounts table have no row
   *  for a guest id). Safe for real ids too — they never match `guest.usernameFor`. */
  function resolveUsername(id: string): string {
    return guest?.usernameFor(id) ?? identity.getUsername(id) ?? id;
  }

  /** Read-only VIP-tier lookup for ANY playerId, backing chat's `resolveTier` AND (ticket
   *  2026-09-13#6 item 3) the open-challenges feed's `ownerTier` (`openChallengeOf` below).
   *  Deliberately NOT `Rewards.getSnapshot` (the route-layer API `apps/server/src/routes/
   *  rewards.ts` uses): that call INSERTs a fresh all-zero row for every never-before-seen
   *  account, and both chat and the open-challenges feed see guest/bot ids constantly — using it
   *  here would silently leak ephemeral guest identities into the durable `rewards` table.
   *  Extracted to `../tier.js` so `createServices` can hand the exact same resolver to the real
   *  `Matchmaking` instance's `lookupTier` option, rather than a second, potentially-drifting
   *  copy of this logic. */
  const resolveTier = createTierResolver(db);

  // One global, in-memory chat transport (issue #439/ticket 2026-09-11#7a) — created exactly
  // once here, since `registerWsGateway` itself only ever runs once per `buildApp()` call (see
  // `chat-transport.ts`'s own doc comment on the "call exactly once" contract). No per-room
  // keying: general-only room for V1.
  const chatTransport: ChatTransport = createChatTransport({ resolveUsername, resolveTier });

  /** Push an incremental feed update to every socket subscribed to this game (OC8). */
  function pushChallengesUpdate(gameId: string, update: ChallengesUpdatePayload): void {
    const subs = challengeSubscribers.get(gameId);
    if (!subs) return;
    for (const s of subs) {
      if (s.readyState === 1) send<ChallengesUpdatePayload>(s, 'challenges.update', update);
    }
  }

  /** Broadcast one newly-sent chat message to every subscribed socket — same shape as
   *  `pushChallengesUpdate` above (a Set of subscriber sockets + a loop checking `readyState
   *  === 1` before sending), per the ticket's explicit instruction to reuse that exact pattern
   *  rather than invent a new fan-out mechanism. */
  function pushChatMessage(update: ChatMessagePayload): void {
    for (const s of chatSubscribers) {
      if (s.readyState === 1) send<ChatMessagePayload>(s, 'chat.message', update);
    }
  }

  /** Build the wire shape for a newly-rested challenge (owner name + tier resolved once, here). */
  function openChallengeOf(
    matchId: string,
    ownerId: string,
    stake: number,
    openedAt: number,
    expiresAt: number,
    timeControlId: string,
  ): OpenChallenge {
    return {
      matchId,
      ownerName: resolveUsername(ownerId),
      ownerTier: resolveTier(ownerId),
      stake,
      openedAt,
      expiresAt,
      timeControlId,
    };
  }

  /**
   * Deliver match.start (per-player redacted) + initial match.your_turn to both players
   * of a freshly-formed match. Shared by the typed-amount FIFO path, challenge.take, and (issue
   * #352) a server-scheduled bot-taker claiming a guest's own resting stake.
   *
   * `curId`'s socket is looked up fresh from `connections` (not passed in) and guarded by
   * `readyState`, exactly like `oppId`'s below — issue #352's bot-taker path calls this from a
   * `setTimeout` callback with no live request-scoped socket in hand at all (a minted bot
   * identity never has one), so this can no longer assume the caller's own connection is the
   * "current" one still open. Harmless for the two existing synchronous call sites too: the
   * socket they already had in hand IS what this now re-fetches, since it's the one connection
   * currently processing that exact message.
   *
   * `stake` (ticket 2026-09-18#2 item 4): `JoinMatched` doesn't carry it (unlike `opponentName`,
   * which is resolvable from just an id), so every caller passes it in explicitly — each already
   * has it in scope (a literal from the request payload, a `MatchRecord` lookup, or a function
   * parameter).
   */
  function deliverMatchStart(curId: string, result: JoinMatched, gameId: string, stake: number): void {
    const mod = moduleByGame.get(gameId);
    playerMatch.set(curId, result.matchId);
    playerMatch.set(result.opponentId, result.matchId);

    // Each player gets the OTHER's public alias (already shown in the open-challenge feed — not
    // hidden game state). Falls back to the opaque id only if a name can't be resolved.
    const curSocket = connections.get(curId);
    if (curSocket && curSocket.readyState === 1) {
      const curState = mod ? mod.viewFor(result.initialState, curId) : result.initialState;
      send<MatchStartPayload>(curSocket, 'match.start', {
        matchId: result.matchId,
        opponent: result.opponentId,
        opponentName: resolveUsername(result.opponentId),
        gameId,
        state: curState,
        serverNow: Date.now(), // lets the client align its clock to server-authoritative timers
        stake,
      });
    }

    const oppSocket = connections.get(result.opponentId);
    if (oppSocket && oppSocket.readyState === 1) {
      const oppState = mod ? mod.viewFor(result.initialState, result.opponentId) : result.initialState;
      send<MatchStartPayload>(oppSocket, 'match.start', {
        matchId: result.matchId,
        opponent: curId,
        opponentName: resolveUsername(curId),
        gameId,
        state: oppState,
        serverNow: Date.now(),
        stake,
      });
    }

    if (mod) {
      for (const [pid, pSocket] of [
        [curId, curSocket],
        [result.opponentId, oppSocket],
      ] as [string, WsSocket | undefined][]) {
        const lm = mod.legalMoves(result.initialState, pid);
        if (lm.length > 0 && pSocket?.readyState === 1) {
          send<MatchYourTurnPayload>(pSocket, 'match.your_turn', { legalMoves: lm }, result.matchId);
        }
      }
    }
  }

  /**
   * Broadcast an already-applied move's result to both players — redacted match.state, then
   * either match.end (terminal, already settled) or match.your_turn to whoever still has legal
   * moves. Shared by the human `move.make` handler and a demo bot's delayed submission (issue
   * #278, below): same broadcast contract regardless of who moved. After a non-terminal move,
   * also checks whether it's now a demo bot's turn and schedules its delayed response.
   */
  function broadcastMoveResult(
    mm: Matchmaking,
    matchId: string,
    match: MatchRecord,
    mod: GameModule,
    result: ApplyResult,
  ): void {
    for (const pid of match.players) {
      const s = connections.get(pid);
      if (s?.readyState === 1) {
        const viewState = mod.viewFor(result.state, pid);
        send<MatchStatePayload>(s, 'match.state', { state: viewState, events: result.events }, matchId);
      }
    }

    if (mod.isTerminal(result.state)) {
      const settled = mm.settleMatch(matchId);
      cancelPendingBotMove(matchId);
      for (const pid of match.players) {
        playerMatch.delete(pid);
        const s = connections.get(pid);
        if (s?.readyState === 1) {
          send<MatchEndPayload>(
            s,
            'match.end',
            { outcome: settled.outcome, settlement: settled.settlement[pid] },
            matchId,
          );
        }
      }
    } else {
      for (const pid of match.players) {
        const lm = mod.legalMoves(result.state, pid);
        if (lm.length > 0) {
          const s = connections.get(pid);
          if (s?.readyState === 1) {
            send<MatchYourTurnPayload>(s, 'match.your_turn', { legalMoves: lm }, matchId);
          }
        }
      }
      maybeScheduleGuestBotMove(matchId);
    }
  }

  /**
   * If a demo bot in `matchId` currently has a legal move (issue #278 for Chess — turn-based, "the
   * bot's turn"; issue #297 for Blackjack — concurrent, "the bot's own hand is still live"), pick
   * its move (the heuristic runs synchronously, right now — only the SUBMISSION is delayed) and
   * schedule it via `setTimeout`. A no-op for a real match, a match with no bot player, one
   * already settled, or one where a bot move is already pending. Called generically after EVERY
   * non-terminal move broadcast (any player's, bot or human) and once right after a match forms —
   * for Blackjack this alone satisfies its self-triggered decision loop with no extra hook: the
   * bot's first decision fires off the match-formation call (the round is already dealt by
   * `init`), each subsequent one fires off the bot's own just-broadcast hit (if not busted/done),
   * and a draw-replay's fresh `new_round` re-deal is itself a non-terminal broadcast that re-fires
   * it too. The timer is cancellable (`pendingBotMoves`/`cancelPendingBotMove`) so a match ending
   * while the bot is "thinking" never applies a move to, or crashes broadcasting for, a match
   * that's gone.
   */
  function maybeScheduleGuestBotMove(matchId: string): void {
    if (!guest) return;
    const match = guest.matchmaking.getActiveMatch(matchId);
    if (!match) return;
    const mod = moduleByGame.get(match.gameId);
    if (!mod) return;
    const botId = match.players.find(isDemoBotId);
    if (botId === undefined) return;
    if (mod.legalMoves(match.state, botId).length === 0) return; // bot has nothing to act on right now
    if (pendingBotMoves.has(matchId)) return; // already scheduled

    const picked = guest.selectBotMove(match.gameId, match.state, botId, Date.now());
    if (!picked) return;
    const { move, delayMs } = picked;

    const handle = setTimeout(() => {
      pendingBotMoves.delete(matchId);
      const liveMatch = guest.matchmaking.getActiveMatch(matchId);
      if (!liveMatch) return; // the match ended while the bot was "thinking" — nothing to submit

      let result: ApplyResult;
      try {
        result = guest.matchmaking.applyMove(matchId, botId, move, Date.now());
      } catch {
        // Defensive: the move became illegal between selection and submission. Can't happen in a
        // strictly-alternating turn-based game (Chess) with no other actor able to move mid-
        // "think"; can't happen in Blackjack either — a human's own hit/stand never touches the
        // bot's independent hand, so the bot's own legalMoves can't have changed out from under
        // it. Still, a misbehaving module here must not crash the timer callback.
        return;
      }
      broadcastMoveResult(guest.matchmaking, matchId, liveMatch, mod, result);
    }, delayMs);
    pendingBotMoves.set(matchId, handle);
  }

  /**
   * Issue #352 (guest bot economy 3/5, §C): schedule a bot-taker to claim a guest's own just-
   * posted resting stake after a short human-ish delay — the mirror image of
   * `maybeScheduleGuestBotMove` above (a bot's delayed MOVE inside an existing match) for the
   * opposite direction: a bot's delayed CLAIM of a match that doesn't exist yet. Called once,
   * right where `queue.join`'s "waiting" branch below learns a guest's stake found nobody resting
   * — the exact dispatch point the ticket asked to find by tracing the join path, mirroring how
   * `onDemoBotMatched` is invoked from the "matched" branch next to it.
   *
   * The reserved-stake rule (`GUEST_HUMAN_RESERVED_STAKE`) is NOT re-checked here — it's enforced
   * inside `guest.takeGuestStake` itself, the single source of truth, so scheduling a take for a
   * reserved stake is harmless (the timer fires, `takeGuestStake` refuses, nothing happens) rather
   * than a second place this rule could drift from the first.
   *
   * Self-heals like every other timer in this file: if the resting bet is gone by the time this
   * fires (a real human already took/cancelled it, it expired, or this exact timer was itself
   * cancelled — see `cancelPendingGuestBotTake`), `takeGuestStake` returns undefined and this is a
   * harmless no-op.
   */
  function maybeScheduleGuestBotTake(matchId: string, gameId: string, stake: number): void {
    if (!guest) return;
    const delayMs = guestTakeMinMs + Math.random() * (guestTakeMaxMs - guestTakeMinMs);
    const handle = setTimeout(() => {
      pendingGuestBotTakes.delete(matchId);
      const result = guest.takeGuestStake(matchId, gameId, stake);
      if (!result) return; // nothing to claim anymore, or the stake was reserved — no-op

      // `JoinMatched.opponentId` is the GUEST here (the resting side `takeChallenge` claims) —
      // it never carries the taker's OWN id, so find the freshly-minted bot id the same generic
      // way `onDemoBotMatched` already does (issue #351's own pattern, flagged for reuse here:
      // don't assume a well-known constant). `deliverMatchStart`'s `curId` must be the BOT's id
      // (distinct from `result.opponentId`, the guest) — passing the guest for both would collapse
      // "opponent" onto the guest's own id and misfire the reveal.
      const formed = guest.matchmaking.getActiveMatch(result.matchId);
      const botId = formed?.players.find(isDemoBotId);
      if (botId === undefined) return; // defensive: can't happen, takeChallenge only just formed this match

      // Same post-match bookkeeping as any other bot pairing (Coinflip submits its pick
      // immediately and re-rests its lane; Chess/Blackjack mark their matched pool bot busy) —
      // `onDemoBotMatched` dispatches generically on `MatchRecord.gameId` via `isDemoBotId` and
      // has no idea (or need to know) the bot arrived by TAKING rather than being taken.
      guest.onDemoBotMatched(result.matchId, Date.now());
      // Deliver match.start + your_turn exactly like the synchronous queue.join/challenge.take
      // paths do, reusing the same function now that it looks up sockets fresh rather than
      // assuming a request-scoped one (see its doc comment). The bot has no socket, so its own
      // send is a harmless no-op; the guest's live socket gets the honest reveal right here, not
      // a moment before.
      deliverMatchStart(botId, result, gameId, stake);
      // Blackjack's first decision is self-triggered off match formation (see
      // `maybeScheduleGuestBotMove`'s own doc comment); Chess is a harmless no-op here since the
      // guest — not the bot — is players[0] and so owes the first move, not the taker.
      maybeScheduleGuestBotMove(result.matchId);
    }, delayMs);
    pendingGuestBotTakes.set(matchId, handle);
  }

  // Server-authoritative expiry sweep: refund (in core) + notify owner & subscribers (OC6).
  // Factored so it can run against BOTH the real Matchmaking and (if guest mode is wired) the
  // guest one — critical for guest mode, not cosmetic: Coinflip's pick window resolves ONLY via
  // the timed-out-move sweep (`scheduledDeadlines` + `timeoutMove`), so without also sweeping
  // `guest.matchmaking` here, a guest's round would never lock/resolve past the 10s window.
  function runSweeps(mm: Matchmaking, isGuestMm: boolean): void {
    const expired = mm.sweepExpired(Date.now());
    for (const ex of expired) {
      if (isGuestMm) cancelPendingGuestBotTake(ex.matchId); // #352: nothing left here to claim
      const ownerSocket = connections.get(ex.ownerId);
      if (ownerSocket?.readyState === 1) {
        send<ChallengeExpiredPayload>(ownerSocket, 'challenge.expired', { matchId: ex.matchId });
      }
      // The guest instance's queue reuses real gameId strings (e.g. "coinflip") — never publish
      // its activity into the real, shared challenge-feed channel (see the pushChallengesUpdate
      // guards in the message handler below for the full rationale).
      if (!isGuestMm) {
        pushChallengesUpdate(ex.gameId, {
          gameId: ex.gameId,
          removed: { matchId: ex.matchId, reason: 'expired' },
        });
      }
    }

    // Server-authoritative move-timeout sweep (#31): resolve matches stuck past their
    // deadline even while the socket stays OPEN. Core has already settled each (void →
    // both refunded, or forfeit → non-responder loses), so no escrow is orphaned — we
    // only push match.end and clean up. Complements the socket-close forfeit below.
    const stale = mm.sweepStaleMatches(Date.now());
    for (const r of stale) {
      cancelPendingBotMove(r.matchId); // #278: a "thinking" bot must not move into a dead match
      for (const pid of r.players) {
        playerMatch.delete(pid);
        // A close-forfeit timer may also be pending for this player — cancel it so the
        // already-settled match isn't processed twice.
        const pending = pendingForfeits.get(pid);
        if (pending !== undefined) {
          clearTimeout(pending);
          pendingForfeits.delete(pid);
        }
        const s = connections.get(pid);
        if (s?.readyState === 1) {
          send<MatchEndPayload>(
            s,
            'match.end',
            { outcome: r.outcome, settlement: r.settlement[pid] },
            r.matchId,
          );
        }
      }
    }

    // Per-player move-timer sweep: for opt-in games, the core injects each expired player's
    // declared auto-move (Blackjack auto-stand, Mines auto-reveal) through the normal
    // applyMove path. Broadcast each like a real move — redacted match.state + events, then
    // match.end if it ended (already settled) or match.your_turn to whoever still has moves.
    const timedOut = mm.sweepTimedOutMoves(Date.now());
    for (const t of timedOut) {
      const mod = moduleByGame.get(t.gameId);
      for (const pid of t.players) {
        const s = connections.get(pid);
        if (s?.readyState !== 1) continue;
        const viewState = mod ? mod.viewFor(t.state, pid) : t.state;
        send<MatchStatePayload>(s, 'match.state', { state: viewState, events: t.events }, t.matchId);
      }
      if (t.terminal) {
        cancelPendingBotMove(t.matchId); // #278: covers chess's flag-on-time (cumulative clock) path
        for (const pid of t.players) {
          playerMatch.delete(pid);
          const pending = pendingForfeits.get(pid);
          if (pending !== undefined) {
            clearTimeout(pending);
            pendingForfeits.delete(pid);
          }
          const s = connections.get(pid);
          if (s?.readyState === 1) {
            send<MatchEndPayload>(
              s,
              'match.end',
              { outcome: t.outcome!, settlement: t.settlement![pid] },
              t.matchId,
            );
          }
        }
      } else if (mod) {
        for (const pid of t.players) {
          const lm = mod.legalMoves(t.state, pid);
          const s = connections.get(pid);
          if (lm.length > 0 && s?.readyState === 1) {
            send<MatchYourTurnPayload>(s, 'match.your_turn', { legalMoves: lm }, t.matchId);
          }
        }
      }
    }
  }

  const sweepTimer = setInterval(() => {
    // Each instance's sweep is isolated in its own try/catch: an uncaught exception inside a
    // setInterval callback crashes the whole process (Node's default), which would let a fault
    // in the newer, less-proven guest/Demo-Opponent path take the real platform's sweep down
    // with it. A fault here is logged and skipped for this tick; the next tick tries again.
    try {
      runSweeps(matchmaking, false);
    } catch (err) {
      console.error('[gateway] real matchmaking sweep failed', err);
    }
    if (guest) {
      try {
        runSweeps(guest.matchmaking, true);
        // Re-assert the Demo-Opponent's resting presence every tick, independent of match
        // activity. Its resting entry is an ordinary joinQueue bet with the same TTL as any real
        // one — sweepExpired just above can remove it after ~90s idle, and (before this call
        // existed) the only re-posting hook was onDemoBotMatched, which can never fire once the
        // bot is absent (no guest can pair with a bot that isn't resting) — a permanent lockout.
        // This makes any expiry-driven removal self-heal within one sweep tick instead.
        guest.ensureDemoBotResting();
      } catch (err) {
        console.error('[gateway] guest matchmaking sweep failed', err);
      }
    }
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive on the sweeper alone; clear it on shutdown (tests).
  sweepTimer.unref?.();
  app.addHook('onClose', async () => clearInterval(sweepTimer));

  // Ticket 2026-09-21#9 (D36): the WS heartbeat. Same per-tick try/catch isolation shape as
  // sweepTimer above (a fault here must not crash the whole process) and iterates the SAME
  // `connections` Map every other liveness/broadcast path in this file already uses. A socket
  // still marked NOT-alive from the PREVIOUS tick never answered its last ping — genuinely dead
  // (common on mobile: lost signal, backgrounding, network switch) — `terminate()` it; this fires
  // the connection's own existing `close` handler below (a forced close still emits `close` on a
  // `ws` socket), so every existing cleanup path (feed/chat unsubscribe, forfeit/guest-eviction
  // timers, queue refund) runs verbatim — no new cleanup logic needed. Otherwise, mark it
  // not-alive and ping it; a `pong` reply (wired at connection time below) marks it alive again
  // before the NEXT tick — so a socket only gets terminated after missing exactly one full
  // heartbeat interval's response, never on the very first tick after it connects.
  const heartbeatTimer = setInterval(() => {
    for (const socket of connections.values()) {
      try {
        if (socketAlive.get(socket) === false) {
          socket.terminate();
          continue;
        }
        socketAlive.set(socket, false);
        socket.ping();
      } catch (err) {
        console.error('[gateway] heartbeat tick failed for a socket', err);
      }
    }
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();
  app.addHook('onClose', async () => clearInterval(heartbeatTimer));

  // Ticket 2026-09-24#1: periodic ledger cleanup. Deliberately its OWN independent timer, NOT
  // triggered off bet-placement/settlement activity — that would recreate the exact
  // 2026-09-22#7 incident shape (a heavy DB op running inline with a live request) instead of
  // avoiding it. `cleanupSettled` itself is already batched/yielding (see its own doc comment
  // in ledger.ts), so even the very first, backlog-clearing pass never blocks the event loop
  // for longer than one batch's worth of work at a time. Runs once immediately at registration
  // (this is how an existing backlog gets cleared — not a separate manual step, same "run once
  // at boot, then on the interval" shape as index.ts's rewardsMonthCloseTimer) and then on
  // ledgerCleanupIntervalMs. `ledger` is optional (mirrors `guest` above) so a call site/test
  // that omits it simply never arms this — no behavior change for anything that doesn't pass it.
  async function runLedgerCleanup(): Promise<void> {
    if (!ledger) return;
    try {
      const { matchesDeleted, rowsDeleted } = await ledger.cleanupSettled(ledgerCleanupRetentionDays);
      if (rowsDeleted > 0) {
        console.log(`[gateway] ledger cleanup: pruned ${matchesDeleted} match(es), ${rowsDeleted} row(s)`);
        onWrite?.();
      }
    } catch (err) {
      console.error('[gateway] ledger cleanup pass failed', err);
    }
  }
  void runLedgerCleanup();
  const ledgerCleanupTimer = setInterval(() => void runLedgerCleanup(), ledgerCleanupIntervalMs);
  ledgerCleanupTimer.unref?.();
  app.addHook('onClose', async () => clearInterval(ledgerCleanupTimer));

  app.get(
    '/ws',
    { websocket: true },
    (connection: SocketStream, request) => {
      const socket = connection.socket;

      // Authenticate via query param ?token=...
      const token = (request.query as Record<string, string>).token;
      let playerId: string;
      let isGuest: boolean;
      try {
        const payload = identity.verifyToken(token ?? '');
        playerId = payload.sub;
        isGuest = payload.role === 'guest';
      } catch {
        sendError(socket, 'UNAUTHORIZED', 'Invalid or missing token');
        socket.close(4001, 'Unauthorized');
        return;
      }

      // A guest connection is dispatched against the ISOLATED guest Matchmaking (issue #267) —
      // own queues/active-matches/ledger, never the real one. Falls back to the real matchmaking
      // if guest mode isn't wired in (keeps every existing non-guest call site unchanged).
      const mm: Matchmaking = isGuest && guest ? guest.matchmaking : matchmaking;

      // Ticket 2026-09-22#7: ACTIVE INCIDENT — a reconnecting playerId used to silently overwrite
      // the map entry, leaving the OLD socket connected but unreachable by anything that iterates
      // `connections.values()` (the heartbeat above included) — instead of the heartbeat freeing it
      // within one interval as its own design intent states, it sat occupied for up to Cloud Run's
      // full 3600s timeout. Explicitly terminate() the previous socket, AFTER the map is updated —
      // this fires the SAME `close` handler below via `ws`'s own forced-close behavior, but by then
      // `connections.get(playerId)` already points at the NEW socket, so the stale-close guard at
      // that handler's own `if (connections.get(playerId) !== socket) return;` line correctly
      // treats it as stale and skips every cleanup path meant for the live connection — reusing the
      // exact terminate()-triggers-close pattern the heartbeat itself already relies on.
      const previousSocket = connections.get(playerId);
      connections.set(playerId, socket);
      if (previousSocket) previousSocket.terminate();

      // Ticket 2026-09-21#9 (D36): start alive (the heartbeat only ever pings an ALREADY-alive
      // socket, so a freshly-connected one must default true — never wait a full interval before
      // it's even eligible to be pinged) — `heartbeatTimer` above flips this false right before
      // each ping; a `pong` reply flips it back true before the next tick.
      socketAlive.set(socket, true);
      socket.on('pong', () => socketAlive.set(socket, true));

      // Cancel any pending forfeit for this player (reconnect before timer fired)
      const existingTimer = pendingForfeits.get(playerId);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
        pendingForfeits.delete(playerId);
      }

      // Cancel any pending guest-ledger eviction (a genuine reconnect within the grace window).
      const existingEviction = pendingGuestEvictions.get(playerId);
      if (existingEviction !== undefined) {
        clearTimeout(existingEviction);
        pendingGuestEvictions.delete(playerId);
      }

      // Per-connection queue state for leaveQueue support
      let queuedGameId: string | null = null;
      let queuedStake: number | null = null;
      // Issue #352: tracks the resting bet's own matchId so a scheduled bot-taker claim can be
      // cancelled the moment this connection's own queue entry stops existing (leave, or an
      // abandoned-on-close queue). Only ever set for a guest connection's own resting bet — see
      // the queue.join handler below.
      let queuedMatchId: string | null = null;

      socket.on('close', () => {
        // Drop this socket from every challenge feed it was subscribed to (this is
        // always safe — it targets this exact socket, not the player's live one).
        for (const subs of challengeSubscribers.values()) subs.delete(socket);
        // Same for chat (issue #439/ticket 2026-09-11#7a) — always safe for the same reason.
        chatSubscribers.delete(socket);

        // A fast reconnect may have already registered a newer socket for this player
        // (the close event for the old socket can fire *after* the new one connects).
        // If so, this is a stale close — must not clear the live connection or forfeit.
        if (connections.get(playerId) !== socket) return;
        connections.delete(playerId);

        // Guest session cleanup (see pendingGuestEvictions above): scheduled unconditionally on
        // every genuine close, independent of match/queue state below — Coinflip's own
        // scheduled-deadline sweep resolves any live round well within this grace window anyway.
        if (isGuest && guest) {
          const evictHandle = setTimeout(() => {
            pendingGuestEvictions.delete(playerId);
            guest.ledger.evict(playerId);
          }, forfeitDelayMs);
          pendingGuestEvictions.set(playerId, evictHandle);
        }

        // #152: an interrupted search still resting in the queue is abandoned on a genuine
        // socket close — dequeue it and REFUND the escrow (never strand a stake). This sits
        // AFTER the stale-close guard above, so a fast reconnect (a newer socket already the
        // live connection) skips it and the in-flight search survives on the new socket.
        // queuedGameId/queuedStake track THIS socket's own join and are cleared once a match
        // forms; if the player was matched via the other side's socket they're stale here, but
        // leaveQueue then throws (player not queued) BEFORE any refund — caught, no double-spend.
        if (queuedGameId !== null && queuedStake !== null) {
          const g = queuedGameId;
          const s = queuedStake;
          queuedGameId = null;
          queuedStake = null;
          if (queuedMatchId !== null) {
            cancelPendingGuestBotTake(queuedMatchId);
            queuedMatchId = null;
          }
          try {
            const refund = mm.leaveQueue(playerId, g, s);
            // Guest activity must never publish into the real, shared challenge-feed channel
            // (see the pushChallengesUpdate guards below for the full rationale).
            if (refund.matchId && !isGuest) {
              pushChallengesUpdate(g, { gameId: g, removed: { matchId: refund.matchId, reason: 'cancelled' } });
            }
          } catch {
            // Already dequeued (matched / cancelled / TTL-swept) — nothing to refund.
          }
        }

        const matchId = playerMatch.get(playerId);
        if (!matchId) return;
        const closedMatch = mm.getActiveMatch(matchId);
        if (!closedMatch) return;

        // Opt-in per-player-timer games (Mines, Blackjack) must NOT close-forfeit: an absent
        // player is auto-acted to a lock by the #91 move-timer sweep (sweepTimedOutMoves),
        // which can take longer than the forfeit delay on a slow board (Mines: many 5s
        // reveals). Starting the timer would wrongly end the match mid-game. The absent
        // player's clock keeps firing server-side, so the game still progresses to a result.
        // Generic predicate — no gameId branch. Covers both the per-move auto-act (Mines/
        // Blackjack via meta.moveTimeoutMs) and the absolute scheduled auto-act (Crash: an absent
        // player simply rides to the scheduled crash and busts via the same sweep).
        const closedMod = moduleByGame.get(closedMatch.gameId);
        if (closedMod && (usesPlayerTimers(closedMod) || usesScheduledDeadlines(closedMod))) return;

        // Start forfeit timer — if the player doesn't reconnect in time, they forfeit.
        const handle = setTimeout(() => {
          pendingForfeits.delete(playerId);
          const match = mm.getActiveMatch(matchId);
          if (!match) return; // already settled by the other path

          try {
            const settled = mm.forfeitMatch(matchId, playerId);
            cancelPendingBotMove(matchId); // #278: a "thinking" bot must not move into a dead match
            for (const pid of match.players) {
              playerMatch.delete(pid);
              const s = connections.get(pid);
              if (s?.readyState === 1) {
                send<MatchEndPayload>(
                  s,
                  'match.end',
                  { outcome: settled.outcome, settlement: settled.settlement[pid] },
                  matchId,
                );
              }
            }
          } catch {
            // Match already settled — nothing to do.
          }
        }, forfeitDelayMs);
        pendingForfeits.set(playerId, handle);
      });

      socket.on('message', (raw: Buffer) => {
        let msg: Envelope;
        try {
          msg = JSON.parse(raw.toString()) as Envelope;
        } catch {
          sendError(socket, 'BAD_MESSAGE', 'Message must be valid JSON');
          return;
        }

        try {
          switch (msg.type) {
            case 'queue.join': {
              const { gameId, stake, timeControlId } = msg.payload as QueueJoinPayload;
              const result = mm.joinQueue(playerId, gameId, stake, timeControlId);

              if (result.status === 'waiting') {
                queuedGameId = gameId;
                queuedStake = stake;
                queuedMatchId = result.matchId;
                send<QueueWaitingPayload>(socket, 'queue.waiting', {
                  gameId,
                  matchId: result.matchId,
                  since: result.since,
                  expiresAt: result.expiresAt, // OC7
                });
                // A new resting bet appeared — announce it to the feed (OC8) with its resolved
                // control. NEVER for a guest: the guest queue reuses real gameId strings (e.g.
                // "coinflip"), and `challengeSubscribers`/`pushChallengesUpdate` are a SINGLE
                // shared channel for every connection, real and guest alike — a guest connection
                // has no legitimate reason to touch it (a tampered/off-stake guest join would
                // otherwise publish a phantom entry into the real Open Games list).
                if (!isGuest) {
                  pushChallengesUpdate(gameId, {
                    gameId,
                    added: openChallengeOf(result.matchId, playerId, stake, result.since, result.expiresAt, result.timeControlId),
                  });
                } else if (guest) {
                  // Issue #352: nobody was resting at this stake, so the GUEST is now the resting
                  // side — schedule a bot-taker to claim it after a short delay. The reserved
                  // stake (GUEST_HUMAN_RESERVED_STAKE) is refused inside `takeGuestStake` itself,
                  // not re-checked here.
                  maybeScheduleGuestBotTake(result.matchId, gameId, stake);
                }
              } else {
                // Match formed via the FIFO path — the waiter's resting bet is consumed.
                queuedGameId = null;
                queuedStake = null;
                queuedMatchId = null;
                // The guest was paired against a resting Demo-Opponent (issue #267, generalized
                // per-game by issue #278): dispatches on the matched game internally — Coinflip
                // submits its pick immediately through the normal applyMove path (viewFor
                // redaction holds automatically, not via new code) and re-posts so the NEXT guest
                // pairs instantly too; Chess just marks the matched pool bot busy.
                if (guest && isDemoBotId(result.opponentId)) {
                  guest.onDemoBotMatched(result.matchId, Date.now());
                }
                deliverMatchStart(playerId, result, gameId, stake);
                // Chess: the just-matched bot may owe the first move (it always plays the side
                // that was already resting, i.e. players[0] — see matchmaking.ts's joinQueue).
                // Coinflip: already picked above, so this is a harmless no-op (no legal moves left).
                if (guest) maybeScheduleGuestBotMove(result.matchId);
                if (!isGuest) {
                  pushChallengesUpdate(gameId, {
                    gameId,
                    removed: { matchId: result.matchId, reason: 'taken' },
                  });
                }
              }
              break;
            }

            case 'queue.leave': {
              const { gameId } = msg.payload as QueueLeavePayload;
              const stake = queuedStake;
              if (stake === null || queuedGameId !== gameId) {
                sendError(socket, 'NOT_IN_QUEUE', `Not in queue for game "${gameId}"`);
                break;
              }
              const refund = mm.leaveQueue(playerId, gameId, stake);
              queuedGameId = null;
              queuedStake = null;
              if (queuedMatchId !== null) {
                cancelPendingGuestBotTake(queuedMatchId); // #352: don't claim a bet the guest just cancelled
                queuedMatchId = null;
              }
              send(socket, 'queue.left', { gameId });
              // The owner cancelled — drop it from the feed (OC8). Never for a guest (see above).
              if (refund.matchId && !isGuest) {
                pushChallengesUpdate(gameId, {
                  gameId,
                  removed: { matchId: refund.matchId, reason: 'cancelled' },
                });
              }
              break;
            }

            case 'challenges.subscribe': {
              const { gameId } = msg.payload as ChallengeSubscribePayload;
              // A guest is never registered into the shared, real subscriber set — the mirror
              // image of the pushChallengesUpdate guards above: without this, a guest socket
              // would start receiving REAL players' Open Games activity too. Still answers with
              // its own (guest-scoped, isolated) snapshot, same as any subscribe.
              if (!isGuest) {
                let subs = challengeSubscribers.get(gameId);
                if (!subs) {
                  subs = new Set();
                  challengeSubscribers.set(gameId, subs);
                }
                subs.add(socket);
              }
              const { entries, more } = mm.listOpenChallenges(gameId, playerId, Date.now());
              send<ChallengesListPayload>(socket, 'challenges.list', { gameId, entries, more });
              break;
            }

            case 'challenges.unsubscribe': {
              const { gameId } = msg.payload as ChallengeSubscribePayload;
              if (!isGuest) challengeSubscribers.get(gameId)?.delete(socket);
              break;
            }

            // Chat (issue #439/ticket 2026-09-11#7a) — general-only room, V1. Open to both real
            // and guest connections alike (unlike the open-challenges feed above, there is no
            // "must not leak guest activity into a real channel" concern here: chat is one
            // shared room by design, not a per-mode economic feed). `chat.subscribe`/reading is
            // deliberately NOT gated by `chatEnabled` — only `chat.send` is (see below) — so a
            // freshly-opened chat sheet can always subscribe and see the (possibly empty)
            // history; when the kill switch is off nothing can ever have been sent, so history
            // is trivially always empty in that state anyway. Stated explicitly per the ticket's
            // ask to document which side(s) of chat the kill switch gates.
            case 'chat.subscribe': {
              chatSubscribers.add(socket);
              send<ChatHistoryPayload>(socket, 'chat.history', { messages: chatTransport.history() });
              break;
            }

            case 'chat.send': {
              if (!chatEnabled) {
                sendError(socket, 'CHAT_DISABLED', 'Chat is currently disabled');
                break;
              }
              // Every connection reaching this handler has already been authenticated by the
              // token check at connection time (see the top of this handler) — `playerId` is
              // never empty here. This check is defense in depth, not a real gap: it guards
              // against `playerId` somehow being falsy without crashing the connection, exactly
              // as the ticket asks ("send a clear error, don't crash the connection").
              if (!playerId) {
                sendError(socket, 'UNAUTHORIZED', 'You must be signed in to send a chat message');
                break;
              }
              const { text } = msg.payload as ChatSendPayload;
              if (typeof text !== 'string' || text.trim().length === 0) {
                sendError(socket, 'CHAT_EMPTY', 'Chat message text must not be empty');
                break;
              }
              if (text.length > CHAT_MAX_MESSAGE_LENGTH) {
                sendError(socket, 'CHAT_TOO_LONG', `Chat message text must be at most ${CHAT_MAX_MESSAGE_LENGTH} characters`);
                break;
              }
              // senderId is the ONLY thing the client's payload can influence — name/tier are
              // resolved server-side inside chatTransport.send from `playerId` (the
              // authenticated connection's own id), never from `msg.payload`. This is the
              // trust-boundary guarantee the ticket calls out explicitly: the client cannot
              // spoof its own name or tier because ChatSendPayload carries nothing but `text`.
              const message = chatTransport.send(playerId, text);
              pushChatMessage({ message });
              break;
            }

            case 'challenge.take': {
              const { matchId } = msg.payload as ChallengeTakePayload;
              let result: JoinMatched;
              try {
                result = mm.takeChallenge(playerId, matchId);
              } catch (err) {
                if (err instanceof ChallengeError) {
                  sendError(socket, err.code, err.message);
                  break;
                }
                throw err;
              }
              const match = mm.getActiveMatch(result.matchId);
              const gameId = match?.gameId ?? '';
              queuedGameId = null;
              queuedStake = null;
              // Same bot dispatch as queue.join above, and the feed-removal guard below: all
              // unreachable today (the curated client never calls challenge.take), but the guest
              // matchmaking instance still answers this message type, so guard it like every
              // other site.
              if (guest && isDemoBotId(result.opponentId)) {
                guest.onDemoBotMatched(result.matchId, Date.now());
              }
              // Ticket 2026-09-18#2 item 4: `match?.stake` rather than a client-supplied value —
              // a JOIN can only ever succeed at the exact stake already publicly listed, so this
              // is the server's own authoritative record, not an echo of anything the taker sent.
              deliverMatchStart(playerId, result, gameId, match?.stake ?? 0);
              if (guest) maybeScheduleGuestBotMove(result.matchId);
              // The claimed bet leaves the feed (OC8). Never for a guest (see above).
              if (!isGuest) {
                pushChallengesUpdate(gameId, {
                  gameId,
                  removed: { matchId: result.matchId, reason: 'taken' },
                });
              }
              break;
            }

            case 'match.resume': {
              const { matchId } = msg.payload as MatchResumePayload;

              // Cancel any pending forfeit when the player actively resumes.
              const pending = pendingForfeits.get(playerId);
              if (pending !== undefined) {
                clearTimeout(pending);
                pendingForfeits.delete(playerId);
              }

              const activeMatch = mm.getActiveMatch(matchId);
              if (activeMatch) {
                if (!activeMatch.players.includes(playerId)) {
                  sendError(socket, 'FORBIDDEN', 'You are not a player in this match');
                  break;
                }
                const mod = moduleByGame.get(activeMatch.gameId);
                const state = mod ? mod.viewFor(activeMatch.state, playerId) : activeMatch.state;
                // Re-send the opponent's alias so the real name survives a reconnect/reload.
                const oppId = activeMatch.players.find((p) => p !== playerId);
                send<MatchStatePayload>(
                  socket,
                  'match.state',
                  {
                    state, events: [],
                    opponentName: oppId ? resolveUsername(oppId) : undefined,
                    serverNow: Date.now(),
                    // Ticket 2026-09-18#2 item 4: same reasoning as opponentName above — survives
                    // a reconnect/reload for a JOIN-initiator too, not just the initial match.start.
                    stake: activeMatch.stake,
                  },
                  matchId,
                );

                if (mod) {
                  const lm = mod.legalMoves(activeMatch.state, playerId);
                  if (lm.length > 0) {
                    send<MatchYourTurnPayload>(socket, 'match.your_turn', { legalMoves: lm }, matchId);
                  }
                }
                // Restore reverse-lookup in case this is a genuine reconnect.
                playerMatch.set(playerId, matchId);
                break;
              }

              // Not active — check completed (idempotency path, no second ledger write).
              const completedMatch = mm.getCompletedMatch(matchId);
              if (completedMatch) {
                if (!completedMatch.players.includes(playerId)) {
                  sendError(socket, 'FORBIDDEN', 'You are not a player in this match');
                  break;
                }
                const playerSettlement = completedMatch.settlement[playerId];
                send<MatchEndPayload>(
                  socket,
                  'match.end',
                  { outcome: completedMatch.outcome, settlement: playerSettlement },
                  matchId,
                );
                break;
              }

              sendError(socket, 'MATCH_NOT_FOUND', `No match found for "${matchId}"`);
              break;
            }

            case 'move.make': {
              const { move } = msg.payload as MoveMakePayload;
              const matchId = playerMatch.get(playerId);
              if (!matchId) {
                sendError(socket, 'NOT_IN_MATCH', 'You are not in an active match');
                break;
              }

              const match = mm.getActiveMatch(matchId);
              if (!match) {
                sendError(socket, 'MATCH_NOT_FOUND', `No active match "${matchId}"`);
                break;
              }

              const mod = moduleByGame.get(match.gameId)!;

              let result;
              try {
                result = mm.applyMove(matchId, playerId, move, Date.now());
              } catch (err) {
                if (err instanceof IllegalMove) {
                  sendError(socket, 'ILLEGAL_MOVE', err.message);
                  break;
                }
                throw err;
              }

              // Broadcast per-player redacted match.state to both players; settle + match.end if
              // terminal, else match.your_turn (and maybe schedule a demo bot's next move — #278).
              broadcastMoveResult(mm, matchId, match, mod, result);
              break;
            }

            case 'match.forfeit': {
              const matchId = playerMatch.get(playerId);
              if (!matchId) {
                sendError(socket, 'NOT_IN_MATCH', 'You are not in an active match');
                break;
              }

              const match = mm.getActiveMatch(matchId);
              if (!match) {
                sendError(socket, 'MATCH_NOT_FOUND', `No active match "${matchId}"`);
                break;
              }

              const settled = mm.forfeitMatch(matchId, playerId);
              cancelPendingBotMove(matchId); // #278: a "thinking" bot must not move into a dead match

              for (const pid of match.players) {
                playerMatch.delete(pid);
                const s = connections.get(pid);
                if (s?.readyState === 1) {
                  send<MatchEndPayload>(
                    s,
                    'match.end',
                    { outcome: settled.outcome, settlement: settled.settlement[pid] },
                    matchId,
                  );
                }
              }
              break;
            }

            case 'match.drawOffer':
            case 'match.drawRevoke':
            case 'match.drawAccept': {
              const matchId = playerMatch.get(playerId);
              if (!matchId) {
                sendError(socket, 'NOT_IN_MATCH', 'You are not in an active match');
                break;
              }
              const match = mm.getActiveMatch(matchId);
              if (!match) {
                sendError(socket, 'MATCH_NOT_FOUND', `No active match "${matchId}"`);
                break;
              }
              const mod = moduleByGame.get(match.gameId)!;
              if (!mod.drawOffers) {
                sendError(socket, 'UNSUPPORTED', `${match.gameId} does not support draw offers`);
                break;
              }

              // Record / accept / revoke the offer (server-authoritative). Not a move — turn,
              // clock and deadlines are untouched. The offer state is public; viewFor exposes it.
              // Asymmetric (CHESS_DRAW_OFFER.md rev 3): only drawAccept can complete the match.
              const result =
                msg.type === 'match.drawOffer'
                  ? mm.offerDraw(matchId, playerId)
                  : msg.type === 'match.drawRevoke'
                    ? mm.revokeDraw(matchId, playerId)
                    : mm.acceptDraw(matchId, playerId);

              // Broadcast the updated (redacted) state to BOTH players so the "Draw offered" /
              // "Accept draw?" indicator appears/clears on both screens.
              for (const pid of match.players) {
                const s = connections.get(pid);
                if (s?.readyState === 1) {
                  send<MatchStatePayload>(s, 'match.state', { state: mod.viewFor(result.state, pid), events: result.events }, matchId);
                }
              }

              // An accepted offer completed the match → settle + push match.end, reusing the
              // existing draw settlement (stakes returned, no rake, no rematch).
              if (mod.isTerminal(result.state)) {
                const settled = mm.settleMatch(matchId);
                cancelPendingBotMove(matchId); // #278: a drawAccept can end a match a bot was "thinking" in
                for (const pid of match.players) {
                  playerMatch.delete(pid);
                  const s = connections.get(pid);
                  if (s?.readyState === 1) {
                    send<MatchEndPayload>(s, 'match.end', { outcome: settled.outcome, settlement: settled.settlement[pid] }, matchId);
                  }
                }
              }
              break;
            }

            default:
              sendError(socket, 'UNKNOWN_TYPE', `Unknown message type "${msg.type}"`);
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : 'Internal error';
          sendError(socket, 'ERROR', message);
        }
      });
    },
  );
}
