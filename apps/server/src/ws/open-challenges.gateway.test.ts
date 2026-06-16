import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import { rpsModule } from '@rapidclash/game-rps';
import { chessModule } from '@rapidclash/game-chess';
import type {
  Envelope,
  ChallengesListPayload,
  ChallengesUpdatePayload,
  QueueWaitingPayload,
  MatchStartPayload,
} from '@rapidclash/shared';

// Drive the real WS gateway over real sockets to exercise the open-challenge feed.
// Rest/margin are zeroed and the TTL/sweep shrunk via env so eligibility & expiry are
// observable within a test (the defaults are 5s/3s/90s).

class SocketRecorder {
  readonly received: Envelope[] = [];
  private waiters: Array<{ type: string; resolve: (e: Envelope) => void }> = [];
  private consumed = new WeakSet<Envelope>();

  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw: Buffer) => {
      const env = JSON.parse(raw.toString()) as Envelope;
      this.received.push(env);
      const idx = this.waiters.findIndex((w) => w.type === env.type);
      if (idx !== -1) {
        const [w] = this.waiters.splice(idx, 1);
        this.consumed.add(env);
        w.resolve(env);
      }
    });
  }

  waitFor(type: string, timeoutMs = 2000): Promise<Envelope> {
    const buffered = this.received.find((e) => e.type === type && !this.consumed.has(e));
    if (buffered) {
      this.consumed.add(buffered);
      return Promise.resolve(buffered);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for "${type}"; got [${this.received.map((e) => e.type).join(', ')}]`)),
        timeoutMs,
      );
      this.waiters.push({
        type,
        resolve: (e) => {
          clearTimeout(timer);
          resolve(e);
        },
      });
    });
  }

  send(type: string, payload: unknown, matchId?: string): void {
    this.ws.send(JSON.stringify({ type, payload, ...(matchId ? { matchId } : {}) }));
  }

  close(): void {
    this.ws.removeAllListeners();
    if (this.ws.readyState === WebSocket.OPEN) this.ws.close();
  }
}

function openSocket(port: number, token: string): Promise<SocketRecorder> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  const rec = new SocketRecorder(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(rec));
    ws.once('error', reject);
  });
}

describe('OC8 — open-challenges feed over the WS gateway', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  const sockets: SocketRecorder[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    // Shrink the timing knobs so the feed is observable in-test.
    for (const k of ['CHALLENGE_MIN_REST_MS', 'CHALLENGE_SAFE_MARGIN_MS', 'CHALLENGE_TTL_MS', 'CHALLENGE_SWEEP_MS']) {
      savedEnv[k] = process.env[k];
    }
    process.env.CHALLENGE_MIN_REST_MS = '0';
    process.env.CHALLENGE_SAFE_MARGIN_MS = '0';
    process.env.CHALLENGE_TTL_MS = '150';
    process.env.CHALLENGE_SWEEP_MS = '30';

    const db = new Database(':memory:');
    // Register a second game (chess) so gameId assertions prove match.start carries
    // the *queued* game, not a hardcoded/default value.
    services = createServices(db, [rpsModule, chessModule]);
    app = buildApp(services, [rpsModule, chessModule], { seedAdmin: false });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;

    const reg = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, password: 'pw' } });
      return res.json<{ token: string; playerId: string }>();
    };
    const a = await reg('alice');
    aliceToken = a.token;
    aliceId = a.playerId;
    bobToken = (await reg('bob')).token;
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await app.close();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('OC7: queue.waiting carries expiresAt', async () => {
    const alice = await openSocket(port, aliceToken);
    sockets.push(alice);
    alice.send('queue.join', { gameId: 'rps', stake: 10 });
    const waiting = (await alice.waitFor('queue.waiting')).payload as QueueWaitingPayload;
    expect(waiting.expiresAt).toBeGreaterThan(waiting.since);
  });

  it('subscribe returns a list; a new bet pushes challenges.update {added}', async () => {
    const bob = await openSocket(port, bobToken);
    sockets.push(bob);
    bob.send('challenges.subscribe', { gameId: 'rps' });
    const list = (await bob.waitFor('challenges.list')).payload as ChallengesListPayload;
    expect(list.gameId).toBe('rps');
    expect(list.entries).toEqual([]);

    // Alice posts a resting bet → bob's feed gets an `added`.
    const alice = await openSocket(port, aliceToken);
    sockets.push(alice);
    alice.send('queue.join', { gameId: 'rps', stake: 10 });
    const upd = (await bob.waitFor('challenges.update')).payload as ChallengesUpdatePayload;
    expect(upd.added).toBeTruthy();
    expect(upd.added!.ownerName).toBe('alice'); // username-joined
    expect(upd.added!.stake).toBe(10);
  });

  it('challenge.take forms exactly one match and pushes {removed: taken} to subscribers', async () => {
    const carol = await openSocket(port, (await registerExtra(app, 'carol')).token);
    sockets.push(carol);
    carol.send('challenges.subscribe', { gameId: 'rps' });
    await carol.waitFor('challenges.list');

    const alice = await openSocket(port, aliceToken);
    const bob = await openSocket(port, bobToken);
    sockets.push(alice, bob);

    alice.send('queue.join', { gameId: 'rps', stake: 10 });
    const waiting = (await alice.waitFor('queue.waiting')).payload as QueueWaitingPayload;
    const matchId = waiting.matchId;
    await carol.waitFor('challenges.update'); // the `added`

    bob.send('challenge.take', { matchId });
    const bobStart = (await bob.waitFor('match.start')).payload as MatchStartPayload;
    const aliceStart = (await alice.waitFor('match.start')).payload as MatchStartPayload;
    // Exactly one match, the owner's canonical matchId, each sees the other as opponent.
    expect(bobStart.matchId).toBe(matchId);
    expect(aliceStart.matchId).toBe(matchId);
    expect(bobStart.opponent).toBe(aliceId); // bob's opponent is alice
    // Both sides are told the authoritative game to render (the queued game).
    expect(bobStart.gameId).toBe('rps');
    expect(aliceStart.gameId).toBe('rps');
    await bob.waitFor('match.your_turn');

    const removed = (await carol.waitFor('challenges.update')).payload as ChallengesUpdatePayload;
    expect(removed.removed).toEqual({ matchId, reason: 'taken' });
  });

  it('match.start carries the queued gameId on BOTH the FIFO and challenge.take paths', async () => {
    // FIFO path: both players queue for chess; the auto-match fires match.start.
    const alice = await openSocket(port, aliceToken);
    const bob = await openSocket(port, bobToken);
    sockets.push(alice, bob);

    alice.send('queue.join', { gameId: 'chess', stake: 10 });
    await alice.waitFor('queue.waiting');
    bob.send('queue.join', { gameId: 'chess', stake: 10 });
    const fifoAlice = (await alice.waitFor('match.start')).payload as MatchStartPayload;
    const fifoBob = (await bob.waitFor('match.start')).payload as MatchStartPayload;
    expect(fifoAlice.gameId).toBe('chess');
    expect(fifoBob.gameId).toBe('chess');

    // challenge.take path: a fresh resting chess bet, taken from the lobby. This is the
    // bug's path — the taker (dave) must be told gameId 'chess', not the default.
    const carol = await openSocket(port, (await registerExtra(app, 'carol')).token);
    const dave = await openSocket(port, (await registerExtra(app, 'dave')).token);
    sockets.push(carol, dave);

    carol.send('queue.join', { gameId: 'chess', stake: 10 });
    const restingId = ((await carol.waitFor('queue.waiting')).payload as QueueWaitingPayload).matchId;
    dave.send('challenge.take', { matchId: restingId });
    const takeDave = (await dave.waitFor('match.start')).payload as MatchStartPayload;
    const takeCarol = (await carol.waitFor('match.start')).payload as MatchStartPayload;
    expect(takeDave.gameId).toBe('chess');
    expect(takeCarol.gameId).toBe('chess');
  });

  it('SELF_TAKE: an owner taking their own challenge is rejected', async () => {
    const alice = await openSocket(port, aliceToken);
    sockets.push(alice);
    alice.send('queue.join', { gameId: 'rps', stake: 10 });
    const matchId = ((await alice.waitFor('queue.waiting')).payload as QueueWaitingPayload).matchId;
    alice.send('challenge.take', { matchId });
    const err = (await alice.waitFor('error')).payload as { code: string };
    expect(err.code).toBe('SELF_TAKE');
  });

  it('queue.leave pushes {removed: cancelled}', async () => {
    const bob = await openSocket(port, bobToken);
    sockets.push(bob);
    bob.send('challenges.subscribe', { gameId: 'rps' });
    await bob.waitFor('challenges.list');

    const alice = await openSocket(port, aliceToken);
    sockets.push(alice);
    alice.send('queue.join', { gameId: 'rps', stake: 10 });
    const matchId = ((await alice.waitFor('queue.waiting')).payload as QueueWaitingPayload).matchId;
    await bob.waitFor('challenges.update'); // added

    alice.send('queue.leave', { gameId: 'rps' });
    const removed = (await bob.waitFor('challenges.update')).payload as ChallengesUpdatePayload;
    expect(removed.removed).toEqual({ matchId, reason: 'cancelled' });
  });

  it('OC6: expiry sweep pushes challenge.expired to the owner and {removed: expired} to subscribers', async () => {
    const bob = await openSocket(port, bobToken);
    sockets.push(bob);
    bob.send('challenges.subscribe', { gameId: 'rps' });
    await bob.waitFor('challenges.list');

    const alice = await openSocket(port, aliceToken);
    sockets.push(alice);
    alice.send('queue.join', { gameId: 'rps', stake: 10 });
    const matchId = ((await alice.waitFor('queue.waiting')).payload as QueueWaitingPayload).matchId;
    await bob.waitFor('challenges.update'); // added

    // TTL is 150ms, sweep every 30ms — the bet expires on its own.
    const expired = (await alice.waitFor('challenge.expired', 3000)).payload as { matchId: string };
    expect(expired.matchId).toBe(matchId);
    const removed = (await bob.waitFor('challenges.update')).payload as ChallengesUpdatePayload;
    expect(removed.removed).toEqual({ matchId, reason: 'expired' });

    // Escrow refunded by the sweep — alice is whole again (1000 grant).
    expect(services.ledger.getBalance(aliceId)).toBe(1000);
  });
});

async function registerExtra(app: FastifyInstance, username: string) {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, password: 'pw' } });
  return res.json<{ token: string; playerId: string }>();
}
