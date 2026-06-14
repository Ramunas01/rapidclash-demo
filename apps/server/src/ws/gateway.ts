import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { Identity } from '@rapidclash/core';
import type { Matchmaking } from '@rapidclash/core';
import type {
  Envelope,
  QueueJoinPayload,
  QueueLeavePayload,
  MatchResumePayload,
  QueueWaitingPayload,
  MatchStartPayload,
  ErrorPayload,
} from '@rapidclash/shared';
import type { GameModule } from '@rapidclash/shared';

// Track connected players so we can push to the waiter when a match forms.
const connections = new Map<string, WebSocket>();

function send<T>(socket: WebSocket, type: string, payload: T, matchId?: string): void {
  const env: Envelope<T> = { type, payload, ...(matchId ? { matchId } : {}) };
  socket.send(JSON.stringify(env));
}

function sendError(socket: WebSocket, code: string, message: string): void {
  send<ErrorPayload>(socket, 'error', { code, message });
}

export function registerWsGateway(
  app: FastifyInstance,
  identity: Identity,
  matchmaking: Matchmaking,
  gameModules: GameModule[],
): void {
  const moduleByGame = new Map<string, GameModule>(gameModules.map((m) => [m.meta.id, m]));

  app.get(
    '/ws',
    { websocket: true },
    (socket: WebSocket, request) => {
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

      // Per-connection queue state for leaveQueue support
      let queuedGameId: string | null = null;
      let queuedStake: number | null = null;

      socket.on('close', () => {
        connections.delete(playerId);
      });

      socket.on('message', (raw: Buffer | string) => {
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
              const match = matchmaking.getActiveMatch(matchId);
              if (!match) {
                sendError(socket, 'MATCH_NOT_FOUND', `No active match "${matchId}"`);
                break;
              }
              if (!match.players.includes(playerId)) {
                sendError(socket, 'FORBIDDEN', 'You are not a player in this match');
                break;
              }
              const mod = moduleByGame.get(match.gameId);
              const state = mod ? mod.viewFor(match.state, playerId) : match.state;
              send(socket, 'match.state', { state, events: [] }, matchId);
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
