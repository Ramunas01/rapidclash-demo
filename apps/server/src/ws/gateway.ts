import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import type { Identity, Matchmaking, JoinMatched } from '@rapidclash/core';
import { ChallengeError, usesPlayerTimers, usesScheduledDeadlines } from '@rapidclash/core';
import { IllegalMove, DEMO_BOT_COINFLIP_ID } from '@rapidclash/shared';
import type { GuestServices } from '../guest/index.js';
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
} from '@rapidclash/shared';
import type { GameModule } from '@rapidclash/shared';

// Convenience alias for the underlying ws WebSocket instance type.
type WsSocket = SocketStream['socket'];

// Track connected players so we can push to the waiter when a match forms.
const connections = new Map<string, WsSocket>();

// Reverse-lookup: which matchId is a player currently in?
const playerMatch = new Map<string, string>();

// Open-challenge feed subscribers, keyed by gameId → set of sockets.
const challengeSubscribers = new Map<string, Set<WsSocket>>();

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

const DEFAULT_FORFEIT_DELAY_MS = 60_000;
const SWEEP_INTERVAL_MS = (() => {
  const n = parseInt(process.env.CHALLENGE_SWEEP_MS ?? '', 10);
  return Number.isFinite(n) ? n : 1_000;
})();

function send<T>(socket: WsSocket, type: string, payload: T, matchId?: string): void {
  const env: Envelope<T> = { type, payload, ...(matchId ? { matchId } : {}) };
  socket.send(JSON.stringify(env));
}

function sendError(socket: WsSocket, code: string, message: string): void {
  send<ErrorPayload>(socket, 'error', { code, message });
}

export function registerWsGateway(
  app: FastifyInstance,
  identity: Identity,
  matchmaking: Matchmaking,
  gameModules: GameModule[],
  /** Guest mode's isolated world (issue #267) — a second Matchmaking + its own ledger, wired in
   *  by `server.ts`. Optional so existing call sites (and tests) that don't care about guest
   *  mode need no change; a guest token then simply falls back to the real matchmaking below. */
  guest?: GuestServices,
): void {
  const moduleByGame = new Map<string, GameModule>(gameModules.map((m) => [m.meta.id, m]));

  // Read at registration so tests (and ops) can tune it via env; defaults to 60s.
  const forfeitDelayMs = (() => {
    const n = parseInt(process.env.FORFEIT_DELAY_MS ?? '', 10);
    return Number.isFinite(n) ? n : DEFAULT_FORFEIT_DELAY_MS;
  })();

  /** Resolve a display name for ANY id — bot/guest first (never a DB lookup), else the real
   *  identity layer. The single replacement for every `identity.getUsername(...)` call site
   *  below, so the real identity layer is never asked about a guest or bot id (issue #267's
   *  explicit watch-out: `getUsername`/`getAvatarId` against the real accounts table have no row
   *  for a guest id). Safe for real ids too — they never match `guest.usernameFor`. */
  function resolveUsername(id: string): string {
    return guest?.usernameFor(id) ?? identity.getUsername(id) ?? id;
  }

  /** Push an incremental feed update to every socket subscribed to this game (OC8). */
  function pushChallengesUpdate(gameId: string, update: ChallengesUpdatePayload): void {
    const subs = challengeSubscribers.get(gameId);
    if (!subs) return;
    for (const s of subs) {
      if (s.readyState === 1) send<ChallengesUpdatePayload>(s, 'challenges.update', update);
    }
  }

  /** Build the wire shape for a newly-rested challenge (owner name resolved once, here). */
  function openChallengeOf(
    matchId: string,
    ownerId: string,
    stake: number,
    openedAt: number,
    expiresAt: number,
    timeControlId: string,
  ): OpenChallenge {
    return { matchId, ownerName: resolveUsername(ownerId), stake, openedAt, expiresAt, timeControlId };
  }

  /**
   * Deliver match.start (per-player redacted) + initial match.your_turn to both players
   * of a freshly-formed match. Shared by the typed-amount FIFO path and challenge.take.
   */
  function deliverMatchStart(curId: string, curSocket: WsSocket, result: JoinMatched, gameId: string): void {
    const mod = moduleByGame.get(gameId);
    playerMatch.set(curId, result.matchId);
    playerMatch.set(result.opponentId, result.matchId);

    // Each player gets the OTHER's public alias (already shown in the open-challenge feed — not
    // hidden game state). Falls back to the opaque id only if a name can't be resolved.
    const curState = mod ? mod.viewFor(result.initialState, curId) : result.initialState;
    send<MatchStartPayload>(curSocket, 'match.start', {
      matchId: result.matchId,
      opponent: result.opponentId,
      opponentName: resolveUsername(result.opponentId),
      gameId,
      state: curState,
      serverNow: Date.now(), // lets the client align its clock to server-authoritative timers
    });

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
      });
    }

    if (mod) {
      for (const [pid, pSocket] of [
        [curId, curSocket],
        [result.opponentId, connections.get(result.opponentId)],
      ] as [string, WsSocket | undefined][]) {
        const lm = mod.legalMoves(result.initialState, pid);
        if (lm.length > 0 && pSocket?.readyState === 1) {
          send<MatchYourTurnPayload>(pSocket, 'match.your_turn', { legalMoves: lm }, result.matchId);
        }
      }
    }
  }

  // Server-authoritative expiry sweep: refund (in core) + notify owner & subscribers (OC6).
  // Factored so it can run against BOTH the real Matchmaking and (if guest mode is wired) the
  // guest one — critical for guest mode, not cosmetic: Coinflip's pick window resolves ONLY via
  // the timed-out-move sweep (`scheduledDeadlines` + `timeoutMove`), so without also sweeping
  // `guest.matchmaking` here, a guest's round would never lock/resolve past the 10s window.
  function runSweeps(mm: Matchmaking): void {
    const expired = mm.sweepExpired(Date.now());
    for (const ex of expired) {
      const ownerSocket = connections.get(ex.ownerId);
      if (ownerSocket?.readyState === 1) {
        send<ChallengeExpiredPayload>(ownerSocket, 'challenge.expired', { matchId: ex.matchId });
      }
      pushChallengesUpdate(ex.gameId, {
        gameId: ex.gameId,
        removed: { matchId: ex.matchId, reason: 'expired' },
      });
    }

    // Server-authoritative move-timeout sweep (#31): resolve matches stuck past their
    // deadline even while the socket stays OPEN. Core has already settled each (void →
    // both refunded, or forfeit → non-responder loses), so no escrow is orphaned — we
    // only push match.end and clean up. Complements the socket-close forfeit below.
    const stale = mm.sweepStaleMatches(Date.now());
    for (const r of stale) {
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
    runSweeps(matchmaking);
    if (guest) runSweeps(guest.matchmaking);
  }, SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive on the sweeper alone; clear it on shutdown (tests).
  sweepTimer.unref?.();
  app.addHook('onClose', async () => clearInterval(sweepTimer));

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

      connections.set(playerId, socket);

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

      socket.on('close', () => {
        // Drop this socket from every challenge feed it was subscribed to (this is
        // always safe — it targets this exact socket, not the player's live one).
        for (const subs of challengeSubscribers.values()) subs.delete(socket);

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
          try {
            const refund = mm.leaveQueue(playerId, g, s);
            if (refund.matchId) {
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
                send<QueueWaitingPayload>(socket, 'queue.waiting', {
                  gameId,
                  matchId: result.matchId,
                  since: result.since,
                  expiresAt: result.expiresAt, // OC7
                });
                // A new resting bet appeared — announce it to the feed (OC8) with its resolved control.
                pushChallengesUpdate(gameId, {
                  gameId,
                  added: openChallengeOf(result.matchId, playerId, stake, result.since, result.expiresAt, result.timeControlId),
                });
              } else {
                // Match formed via the FIFO path — the waiter's resting bet is consumed.
                queuedGameId = null;
                queuedStake = null;
                // The guest was paired against the permanently-resting Demo-Opponent (issue
                // #267): submit its pick through the normal applyMove path — viewFor redaction
                // holds automatically, not via new code — then re-post it so the NEXT guest
                // pairs instantly too.
                if (guest && result.opponentId === DEMO_BOT_COINFLIP_ID) {
                  guest.onDemoBotMatched(result.matchId, Date.now());
                }
                deliverMatchStart(playerId, socket, result, gameId);
                pushChallengesUpdate(gameId, {
                  gameId,
                  removed: { matchId: result.matchId, reason: 'taken' },
                });
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
              send(socket, 'queue.left', { gameId });
              // The owner cancelled — drop it from the feed (OC8).
              if (refund.matchId) {
                pushChallengesUpdate(gameId, {
                  gameId,
                  removed: { matchId: refund.matchId, reason: 'cancelled' },
                });
              }
              break;
            }

            case 'challenges.subscribe': {
              const { gameId } = msg.payload as ChallengeSubscribePayload;
              let subs = challengeSubscribers.get(gameId);
              if (!subs) {
                subs = new Set();
                challengeSubscribers.set(gameId, subs);
              }
              subs.add(socket);
              const { entries, more } = mm.listOpenChallenges(gameId, playerId, Date.now());
              send<ChallengesListPayload>(socket, 'challenges.list', { gameId, entries, more });
              break;
            }

            case 'challenges.unsubscribe': {
              const { gameId } = msg.payload as ChallengeSubscribePayload;
              challengeSubscribers.get(gameId)?.delete(socket);
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
              deliverMatchStart(playerId, socket, result, gameId);
              // The claimed bet leaves the feed (OC8).
              pushChallengesUpdate(gameId, {
                gameId,
                removed: { matchId: result.matchId, reason: 'taken' },
              });
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
                  { state, events: [], opponentName: oppId ? resolveUsername(oppId) : undefined, serverNow: Date.now() },
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

              // Broadcast per-player redacted match.state to both players.
              for (const pid of match.players) {
                const s = connections.get(pid);
                if (s?.readyState === 1) {
                  const viewState = mod.viewFor(result.state, pid);
                  send<MatchStatePayload>(s, 'match.state', { state: viewState, events: result.events }, matchId);
                }
              }

              if (mod.isTerminal(result.state)) {
                // Settle and send match.end to both players.
                const settled = mm.settleMatch(matchId);
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
                // Send match.your_turn to each player who has legal moves.
                for (const pid of match.players) {
                  const lm = mod.legalMoves(result.state, pid);
                  if (lm.length > 0) {
                    const s = connections.get(pid);
                    if (s?.readyState === 1) {
                      send<MatchYourTurnPayload>(s, 'match.your_turn', { legalMoves: lm }, matchId);
                    }
                  }
                }
              }
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
