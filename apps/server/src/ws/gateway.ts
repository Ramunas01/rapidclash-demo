import type { FastifyInstance } from 'fastify';
import type { SocketStream } from '@fastify/websocket';
import type { Identity, Matchmaking } from '@rapidclash/core';
import { IllegalMove } from '@rapidclash/shared';
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
} from '@rapidclash/shared';
import type { GameModule } from '@rapidclash/shared';

// Convenience alias for the underlying ws WebSocket instance type.
type WsSocket = SocketStream['socket'];

// Track connected players so we can push to the waiter when a match forms.
const connections = new Map<string, WsSocket>();

// Reverse-lookup: which matchId is a player currently in?
const playerMatch = new Map<string, string>();

// Pending forfeit timers: set on disconnect, cancelled on reconnect/resume.
const pendingForfeits = new Map<string, ReturnType<typeof setTimeout>>();

const FORFEIT_DELAY_MS = 60_000;

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
): void {
  const moduleByGame = new Map<string, GameModule>(gameModules.map((m) => [m.meta.id, m]));
  const feeRate = parseFloat(process.env.FEE_RATE ?? '0.05');

  app.get(
    '/ws',
    { websocket: true },
    (connection: SocketStream, request) => {
      const socket = connection.socket;

      // Authenticate via query param ?token=...
      const token = (request.query as Record<string, string>).token;
      let playerId: string;
      try {
        const payload = identity.verifyToken(token ?? '');
        playerId = payload.sub;
      } catch {
        sendError(socket, 'UNAUTHORIZED', 'Invalid or missing token');
        socket.close(4001, 'Unauthorized');
        return;
      }

      connections.set(playerId, socket);

      // Cancel any pending forfeit for this player (reconnect before timer fired)
      const existingTimer = pendingForfeits.get(playerId);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
        pendingForfeits.delete(playerId);
      }

      // Per-connection queue state for leaveQueue support
      let queuedGameId: string | null = null;
      let queuedStake: number | null = null;

      socket.on('close', () => {
        // A fast reconnect may have already registered a newer socket for this player
        // (the close event for the old socket can fire *after* the new one connects).
        // If so, this is a stale close — must not clear the live connection or forfeit.
        if (connections.get(playerId) !== socket) return;
        connections.delete(playerId);

        const matchId = playerMatch.get(playerId);
        if (matchId && matchmaking.getActiveMatch(matchId)) {
          // Start forfeit timer — if the player doesn't reconnect within 60 s, they forfeit.
          const handle = setTimeout(() => {
            pendingForfeits.delete(playerId);
            const match = matchmaking.getActiveMatch(matchId);
            if (!match) return; // already settled by the other path

            try {
              const settled = matchmaking.forfeitMatch(matchId, playerId);
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
          }, FORFEIT_DELAY_MS);
          pendingForfeits.set(playerId, handle);
        }
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
              const { gameId, stake } = msg.payload as QueueJoinPayload;
              const result = matchmaking.joinQueue(playerId, gameId, stake);

              if (result.status === 'waiting') {
                queuedGameId = gameId;
                queuedStake = stake;
                send<QueueWaitingPayload>(socket, 'queue.waiting', { gameId, since: result.since });
              } else {
                // Match formed — send match.start to both players.
                const mod = moduleByGame.get(gameId);
                queuedGameId = null;
                queuedStake = null;

                // Register reverse-lookups for both players.
                playerMatch.set(playerId, result.matchId);
                playerMatch.set(result.opponentId, result.matchId);

                // Current player (joiner)
                const joinerState = mod
                  ? mod.viewFor(result.initialState, playerId)
                  : result.initialState;
                send<MatchStartPayload>(socket, 'match.start', {
                  matchId: result.matchId,
                  opponent: result.opponentId,
                  state: joinerState,
                });

                // Waiting player
                const waiterSocket = connections.get(result.opponentId);
                if (waiterSocket && waiterSocket.readyState === 1 /* OPEN */) {
                  const waiterState = mod
                    ? mod.viewFor(result.initialState, result.opponentId)
                    : result.initialState;
                  send<MatchStartPayload>(waiterSocket, 'match.start', {
                    matchId: result.matchId,
                    opponent: playerId,
                    state: waiterState,
                  });
                }

                // Send initial your_turn to whoever has legal moves.
                if (mod) {
                  for (const [pid, pSocket] of [
                    [playerId, socket],
                    [result.opponentId, connections.get(result.opponentId)],
                  ] as [string, WsSocket | undefined][]) {
                    const lm = mod.legalMoves(result.initialState, pid);
                    if (lm.length > 0 && pSocket?.readyState === 1) {
                      send<MatchYourTurnPayload>(pSocket, 'match.your_turn', { legalMoves: lm }, result.matchId);
                    }
                  }
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
              matchmaking.leaveQueue(playerId, gameId, stake);
              queuedGameId = null;
              queuedStake = null;
              send(socket, 'queue.left', { gameId });
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

              const activeMatch = matchmaking.getActiveMatch(matchId);
              if (activeMatch) {
                if (!activeMatch.players.includes(playerId)) {
                  sendError(socket, 'FORBIDDEN', 'You are not a player in this match');
                  break;
                }
                const mod = moduleByGame.get(activeMatch.gameId);
                const state = mod ? mod.viewFor(activeMatch.state, playerId) : activeMatch.state;
                send<MatchStatePayload>(socket, 'match.state', { state, events: [] }, matchId);

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
              const completedMatch = matchmaking.getCompletedMatch(matchId);
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

              const match = matchmaking.getActiveMatch(matchId);
              if (!match) {
                sendError(socket, 'MATCH_NOT_FOUND', `No active match "${matchId}"`);
                break;
              }

              const mod = moduleByGame.get(match.gameId)!;

              let result;
              try {
                result = matchmaking.applyMove(matchId, playerId, move, Date.now());
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
                const settled = matchmaking.settleMatch(matchId, feeRate);
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

              const match = matchmaking.getActiveMatch(matchId);
              if (!match) {
                sendError(socket, 'MATCH_NOT_FOUND', `No active match "${matchId}"`);
                break;
              }

              const settled = matchmaking.forfeitMatch(matchId, playerId);

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
