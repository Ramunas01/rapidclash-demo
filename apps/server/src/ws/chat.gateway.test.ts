import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import { rpsModule } from '@rapidclash/game-rps';
import type { Envelope, ChatHistoryPayload, ChatMessagePayload, ErrorPayload } from '@rapidclash/shared';

// Drive the real WS gateway over real sockets to exercise chat (issue #439/ticket
// 2026-09-11#7a) — same SocketRecorder/openSocket harness as open-challenges.gateway.test.ts,
// mirrored here rather than imported (each gateway test file owns its own copy of this small
// harness, matching the existing convention across the *.gateway.test.ts files in this dir).

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

describe('chat over the WS gateway (issue #439/ticket 2026-09-11#7a)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  let aliceToken: string;
  let bobToken: string;
  const sockets: SocketRecorder[] = [];
  const savedChatEnabled = process.env.CHAT_ENABLED;

  async function start(): Promise<void> {
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
    aliceToken = (await reg('alice')).token;
    bobToken = (await reg('bob')).token;
  }

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await app.close();
    if (savedChatEnabled === undefined) delete process.env.CHAT_ENABLED;
    else process.env.CHAT_ENABLED = savedChatEnabled;
  });

  describe('kill switch ON (CHAT_ENABLED=true)', () => {
    beforeEach(async () => {
      process.env.CHAT_ENABLED = 'true';
      await start();
    });

    it('chat.subscribe immediately replies with chat.history (empty on a fresh server)', async () => {
      const alice = await openSocket(port, aliceToken);
      sockets.push(alice);
      alice.send('chat.subscribe', {});
      const hist = (await alice.waitFor('chat.history')).payload as ChatHistoryPayload;
      expect(hist.messages).toEqual([]);
    });

    it('two connected sockets BOTH receive a message sent by either one', async () => {
      const alice = await openSocket(port, aliceToken);
      const bob = await openSocket(port, bobToken);
      sockets.push(alice, bob);

      alice.send('chat.subscribe', {});
      bob.send('chat.subscribe', {});
      await alice.waitFor('chat.history');
      await bob.waitFor('chat.history');

      // Alice sends; both Alice and Bob (every subscribed socket, including the sender) get it.
      alice.send('chat.send', { text: 'hi from alice' });
      const aliceSeesOwn = (await alice.waitFor('chat.message')).payload as ChatMessagePayload;
      const bobSeesAlice = (await bob.waitFor('chat.message')).payload as ChatMessagePayload;
      expect(aliceSeesOwn.message.text).toBe('hi from alice');
      expect(aliceSeesOwn.message.name).toBe('alice');
      expect(bobSeesAlice.message.text).toBe('hi from alice');
      expect(bobSeesAlice.message.name).toBe('alice');

      // Bob replies; both get that one too — proves the channel is bidirectional, not a fluke
      // of send-order.
      bob.send('chat.send', { text: 'hi from bob' });
      const aliceSeesBob = (await alice.waitFor('chat.message')).payload as ChatMessagePayload;
      const bobSeesOwn = (await bob.waitFor('chat.message')).payload as ChatMessagePayload;
      expect(aliceSeesBob.message.text).toBe('hi from bob');
      expect(aliceSeesBob.message.name).toBe('bob');
      expect(bobSeesOwn.message.text).toBe('hi from bob');
    });

    it('the server resolves name server-side — a client cannot supply its own name/tier in the send payload', async () => {
      const alice = await openSocket(port, aliceToken);
      sockets.push(alice);
      alice.send('chat.subscribe', {});
      await alice.waitFor('chat.history');

      // Attempt to smuggle a name/tier through the payload — the wire type (ChatSendPayload)
      // only declares `text`, but nothing stops a raw/hand-crafted client from sending extra
      // JSON fields; the server must ignore them entirely.
      alice.send('chat.send', { text: 'spoof attempt', name: 'TOTALLY NOT ALICE', tier: 'Diamond' });
      const msg = (await alice.waitFor('chat.message')).payload as ChatMessagePayload;
      expect(msg.message.name).toBe('alice'); // resolved server-side from the authenticated token
      expect(msg.message.name).not.toBe('TOTALLY NOT ALICE');
      expect(msg.message.tier).toBe('Unranked'); // fresh account, 0 XP — not the smuggled 'Diamond'
    });

    it('rejects empty text with a clear error, connection stays open', async () => {
      const alice = await openSocket(port, aliceToken);
      sockets.push(alice);
      alice.send('chat.subscribe', {});
      await alice.waitFor('chat.history');

      alice.send('chat.send', { text: '' });
      const err = (await alice.waitFor('error')).payload as ErrorPayload;
      expect(err.code).toBe('CHAT_EMPTY');
      expect(alice.ws.readyState).toBe(WebSocket.OPEN);

      // Connection still works after the rejection.
      alice.send('chat.send', { text: 'still alive' });
      const msg = (await alice.waitFor('chat.message')).payload as ChatMessagePayload;
      expect(msg.message.text).toBe('still alive');
    });

    it('rejects text over 160 chars with a clear error, connection stays open', async () => {
      const alice = await openSocket(port, aliceToken);
      sockets.push(alice);
      alice.send('chat.subscribe', {});
      await alice.waitFor('chat.history');

      alice.send('chat.send', { text: 'a'.repeat(161) });
      const err = (await alice.waitFor('error')).payload as ErrorPayload;
      expect(err.code).toBe('CHAT_TOO_LONG');
      expect(alice.ws.readyState).toBe(WebSocket.OPEN);
    });

    it('a message sent AFTER subscribe.history is delivered to a socket that subscribed later too (backlog via chat.history)', async () => {
      const alice = await openSocket(port, aliceToken);
      sockets.push(alice);
      alice.send('chat.subscribe', {});
      await alice.waitFor('chat.history');
      alice.send('chat.send', { text: 'earlier message' });
      await alice.waitFor('chat.message');

      // Bob connects and subscribes AFTER alice's message was sent — his chat.history reply
      // must include it (a freshly-opened chat sheet isn't empty).
      const bob = await openSocket(port, bobToken);
      sockets.push(bob);
      bob.send('chat.subscribe', {});
      const hist = (await bob.waitFor('chat.history')).payload as ChatHistoryPayload;
      expect(hist.messages.some((m) => m.text === 'earlier message')).toBe(true);
    });
  });

  describe('kill switch OFF (default / unset)', () => {
    beforeEach(async () => {
      delete process.env.CHAT_ENABLED;
      await start();
    });

    it('chat.subscribe still works (reading is not gated) but chat.send is rejected, and the connection does not crash', async () => {
      const alice = await openSocket(port, aliceToken);
      sockets.push(alice);

      alice.send('chat.subscribe', {});
      const hist = (await alice.waitFor('chat.history')).payload as ChatHistoryPayload;
      expect(hist.messages).toEqual([]);

      alice.send('chat.send', { text: 'should be rejected' });
      const err = (await alice.waitFor('error')).payload as ErrorPayload;
      expect(err.code).toBe('CHAT_DISABLED');

      // The connection must survive the rejection — prove it's still usable for something else
      // entirely (an unrelated message type round-trips normally).
      expect(alice.ws.readyState).toBe(WebSocket.OPEN);
      alice.send('challenges.subscribe', { gameId: 'rps' });
      const list = await alice.waitFor('challenges.list');
      expect(list.type).toBe('challenges.list');
    });

    it('an explicit CHAT_ENABLED=false also fails closed (not just an unset var)', async () => {
      await app.close();
      process.env.CHAT_ENABLED = 'false';
      await start();

      const alice = await openSocket(port, aliceToken);
      sockets.push(alice);
      alice.send('chat.send', { text: 'nope' });
      const err = (await alice.waitFor('error')).payload as ErrorPayload;
      expect(err.code).toBe('CHAT_DISABLED');
    });
  });
});
