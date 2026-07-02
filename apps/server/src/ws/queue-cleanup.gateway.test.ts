import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import { rpsModule } from '@rapidclash/game-rps';
import type { Envelope, QueueWaitingPayload } from '@rapidclash/shared';

// #152 — an interrupted search (player resting in the queue) must be dequeued AND its escrow
// refunded when the socket genuinely closes, without a fast reconnect killing a live search.

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
      this.waiters.push({ type, resolve: (e) => { clearTimeout(timer); resolve(e); } });
    });
  }
  /** Assert a message type has NOT arrived within a short window. */
  async expectSilence(type: string, windowMs = 250): Promise<void> {
    const seen = this.received.some((e) => e.type === type && !this.consumed.has(e));
    if (seen) throw new Error(`Expected no "${type}" but one was already received`);
    await new Promise((r) => setTimeout(r, windowMs));
    const late = this.received.some((e) => e.type === type && !this.consumed.has(e));
    if (late) throw new Error(`Expected no "${type}" within ${windowMs}ms but one arrived`);
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

/** Wait until the server-side connection for a token's player is torn down (close handled). */
function tick(ms = 60): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('#152 — interrupted-search queue cleanup on socket close', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  const sockets: SocketRecorder[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const k of ['CHALLENGE_MIN_REST_MS', 'CHALLENGE_SAFE_MARGIN_MS', 'CHALLENGE_TTL_MS', 'CHALLENGE_SWEEP_MS']) {
      savedEnv[k] = process.env[k];
    }
    // Big TTL so the *only* dequeue under test is the socket-close path, not expiry.
    process.env.CHALLENGE_MIN_REST_MS = '0';
    process.env.CHALLENGE_SAFE_MARGIN_MS = '0';
    process.env.CHALLENGE_TTL_MS = '60000';
    process.env.CHALLENGE_SWEEP_MS = '30';

    const db = new Database(':memory:');
    services = createServices(db, [rpsModule]);
    app = buildApp(services, [rpsModule], { seedAdmin: false });
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

  it('closing the socket while resting dequeues the player AND refunds the escrow', async () => {
    const alice = await openSocket(port, aliceToken);
    sockets.push(alice);
    const start = services.ledger.getBalance(aliceId);

    alice.send('queue.join', { gameId: 'rps', stake: 10 });
    await alice.waitFor('queue.waiting');
    expect(services.ledger.getBalance(aliceId)).toBe(start - 10); // escrowed while resting

    alice.close();
    await tick();

    // Escrow refunded on close — never stranded.
    expect(services.ledger.getBalance(aliceId)).toBe(start);

    // And the entry is gone: a later joiner does NOT pair with the ghost — bob rests instead.
    const bob = await openSocket(port, bobToken);
    sockets.push(bob);
    bob.send('queue.join', { gameId: 'rps', stake: 10 });
    const bobMsg = await bob.waitFor('queue.waiting');
    expect((bobMsg.payload as QueueWaitingPayload).matchId).toBeTruthy();
    await bob.expectSilence('match.start');
  });

  it('a fast reconnect (newer socket live) does NOT dequeue the in-flight search', async () => {
    const alice1 = await openSocket(port, aliceToken);
    sockets.push(alice1);
    const start = services.ledger.getBalance(aliceId);
    alice1.send('queue.join', { gameId: 'rps', stake: 10 });
    await alice1.waitFor('queue.waiting');

    // Reconnect BEFORE closing the old socket: the newer socket becomes the live connection,
    // so the old socket's close is stale and must not tear down the still-live search.
    const alice2 = await openSocket(port, aliceToken);
    sockets.push(alice2);
    await tick();
    alice1.close();
    await tick();

    // Still escrowed → still queued: the transient reconnect preserved the search.
    expect(services.ledger.getBalance(aliceId)).toBe(start - 10);

    // Proof it's still live: bob pairs with alice's surviving resting bet.
    const bob = await openSocket(port, bobToken);
    sockets.push(bob);
    bob.send('queue.join', { gameId: 'rps', stake: 10 });
    await bob.waitFor('match.start');
    await alice2.waitFor('match.start');
  });
});
