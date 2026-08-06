import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { GUEST_COINFLIP_STAKE, DEMO_BOT_COINFLIP_ID } from '@rapidclash/shared';
import type { Envelope, MatchStartPayload, MatchEndPayload, AuthResponse } from '@rapidclash/shared';
import { createServices, buildApp, type AppServices } from '../server.js';

// Live-socket integration test for issue #267 (DemoGuest PR 1): a guest mints a session via
// POST /auth/guest, connects the SAME /ws endpoint as any real player, presses PLAY, and is
// paired against the permanently-resting Demo-Opponent — through the exact same WS protocol and
// core matchmaking/redaction machinery a real match uses, per CHARTER.md's guest-mode exception.

/** Minimal envelope recorder, mirrors gateway.test.ts's SocketRecorder. */
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
        w.resolve(env);
      }
    });
  }

  waitFor(type: string, timeoutMs = 3000): Promise<Envelope> {
    const buffered = this.received.find((e) => e.type === type && !this.consumed.has(e));
    if (buffered) {
      this.consumed.add(buffered);
      return Promise.resolve(buffered);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for "${type}"; received: [${this.received.map((e) => e.type).join(', ')}]`)),
        timeoutMs,
      );
      this.waiters.push({ type, resolve: (e) => { clearTimeout(timer); this.consumed.add(e); resolve(e); } });
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

describe('guest mode over the real WS gateway (issue #267)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  const sockets: SocketRecorder[] = [];
  let prevWindow: string | undefined;

  beforeEach(async () => {
    // Fast pick window so Coinflip's scheduled-deadline resolution lands within the test's wait
    // budget instead of the real 10s (mirrors coinflip-timeout tests). The gateway's sweep
    // interval defaults to 1s (module-scoped at import time, not overridable per-test) — the
    // 5000ms waitFor budgets below comfortably absorb a 300ms window + up to ~1s sweep latency.
    prevWindow = process.env.RC_PICK_WINDOW_MS;
    process.env.RC_PICK_WINDOW_MS = '300';

    const db = new Database(':memory:');
    services = createServices(db, [coinflipModule]);
    app = buildApp(services, [coinflipModule], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await app.close();
    if (prevWindow === undefined) delete process.env.RC_PICK_WINDOW_MS;
    else process.env.RC_PICK_WINDOW_MS = prevWindow;
  });

  async function mintGuest(): Promise<AuthResponse> {
    const res = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(res.statusCode).toBe(201);
    return res.json<AuthResponse>();
  }

  it('POST /auth/guest mints an isolated session — no account, no email, no password, unique id', async () => {
    const a = await mintGuest();
    const b = await mintGuest();
    expect(a.isGuest).toBe(true);
    expect(a.playerId).not.toBe(b.playerId);
    expect(a.balance).toBe(GUEST_COINFLIP_STAKE * 3); // 300¢ / 100 per round
    expect(a.avatarId).toBe('default');
  });

  it('regression: the real request shape the client actually sends (Content-Type: application/json + a body) succeeds', async () => {
    // A production bug: apps/web/src/api.ts's `req()` helper always sets Content-Type:
    // application/json, but `guestAuth()` used to call it with NO body argument — a real
    // `fetch()` then sends that header with a zero-length body, which Fastify's default JSON
    // parser rejects (`FST_ERR_CTP_EMPTY_JSON_BODY`, 400). `mintGuest()`'s bare `app.inject({
    // method: 'POST', url: '/auth/guest' })` above never caught this: inject only sets the
    // json content-type header when a payload is actually given, so it never exercised the
    // failing path. This mirrors the FIXED client's exact request shape — a real, if empty, JSON
    // body (`{}`) alongside the header — which the route (never reads request.body) accepts.
    const res = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<AuthResponse>();
    expect(body.isGuest).toBe(true);
  });

  it("characterizes the underlying Fastify constraint: Content-Type: application/json with a TRULY EMPTY body still 400s (why the client must always send a real body, not rely on the server tolerating omission)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/guest',
      headers: { 'content-type': 'application/json' },
      // No `payload` at all — the exact shape the OLD, broken guestAuth() produced over a real
      // fetch(). This is Fastify's own default JSON body-parser behavior, not something this
      // route added — documented here so a future refactor that drops the client's `{}` body
      // has a test that explains WHY it would reintroduce the production bug.
    });
    expect(res.statusCode).toBe(400);
  });

  it('PLAY pairs the guest against the Demo-Opponent instantly — no waiting screen', async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'coinflip', stake: GUEST_COINFLIP_STAKE });
    const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;

    expect(start.opponent).toBe(DEMO_BOT_COINFLIP_ID);
    expect(start.opponentName).toBe('Demo Opponent 🤖'); // honestly labelled, never disguised
  });

  it("the Demo-Opponent's pick stays redacted until reveal — the guest sees no more than a real client would", async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'coinflip', stake: GUEST_COINFLIP_STAKE });
    const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;
    const preTerminal = start.state as { choices?: Record<string, string>; seed?: number };
    // The bot already applied its move server-side (onDemoBotMatched), yet the guest's OWN
    // redacted view carries neither the bot's choice nor the seed pre-terminal.
    expect(preTerminal.choices?.[DEMO_BOT_COINFLIP_ID]).toBeUndefined();
    expect(preTerminal.seed).toBe(0);

    const end = (await sock.waitFor('match.end', 5000)).payload as MatchEndPayload;
    expect(['win', 'draw', 'void']).toContain(end.outcome.type);
  });

  it('a full guest round settles only in the ephemeral ledger — never the real ledger/wallet', async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'coinflip', stake: GUEST_COINFLIP_STAKE });
    await sock.waitFor('match.start');
    await sock.waitFor('match.end', 5000);

    // The real ledger (services.ledger, SQLite-backed) never saw this guest id.
    expect(services.ledger.getBalance(guest.playerId)).toBe(0);
    expect(services.ledger.accountExists(guest.playerId)).toBe(false);
    // The ephemeral ledger DID settle it.
    expect(services.guest.ledger.accountExists(guest.playerId)).toBe(true);
  });

  it('two concurrent guest sessions are fully isolated: separate balances, separate matches, no cross-visibility', async () => {
    const guestA = await mintGuest();
    const guestB = await mintGuest();
    expect(guestA.playerId).not.toBe(guestB.playerId);

    const sockA = await openSocket(port, guestA.token);
    const sockB = await openSocket(port, guestB.token);
    sockets.push(sockA, sockB);

    sockA.send('queue.join', { gameId: 'coinflip', stake: GUEST_COINFLIP_STAKE });
    const startA = (await sockA.waitFor('match.start')).payload as MatchStartPayload;

    sockB.send('queue.join', { gameId: 'coinflip', stake: GUEST_COINFLIP_STAKE });
    const startB = (await sockB.waitFor('match.start')).payload as MatchStartPayload;

    // Each is paired with the (perpetually-resting) bot, but in DIFFERENT matches.
    expect(startA.opponent).toBe(DEMO_BOT_COINFLIP_ID);
    expect(startB.opponent).toBe(DEMO_BOT_COINFLIP_ID);
    expect(startA.matchId).not.toBe(startB.matchId);

    // Balances are independently tracked (both escrowed the same stake out of the same starting
    // stack, but keyed separately — neither's escrow touched the other's balance).
    expect(services.guest.ledger.getBalance(guestA.playerId)).toBe(guestA.balance - GUEST_COINFLIP_STAKE);
    expect(services.guest.ledger.getBalance(guestB.playerId)).toBe(guestB.balance - GUEST_COINFLIP_STAKE);
  });

  it('a guest match never appears in the real /games matchmaking or leaderboard writes', async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'coinflip', stake: GUEST_COINFLIP_STAKE });
    const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;
    await sock.waitFor('match.end', 5000);

    // The REAL matchmaking instance never saw this matchId — it lives only in the guest one.
    expect(services.matchmaking.getActiveMatch(start.matchId)).toBeUndefined();
    expect(services.matchmaking.getCompletedMatch(start.matchId)).toBeUndefined();
  });

  it('a real subscriber to the shared Open Games channel receives ZERO events from a guest match (PM review #268)', async () => {
    // A real player, subscribed to the REAL coinflip feed — the exact channel a guest's queue
    // activity must never touch, since challengeSubscribers/pushChallengesUpdate are one shared,
    // module-scope channel for every connection, real and guest alike.
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'realplayer', password: 'pw' } });
    const real = reg.json<AuthResponse>();
    const realSock = await openSocket(port, real.token);
    sockets.push(realSock);
    realSock.send('challenges.subscribe', { gameId: 'coinflip' });
    await realSock.waitFor('challenges.list'); // confirms the subscription round-trip completed

    const guest = await mintGuest();
    const guestSock = await openSocket(port, guest.token);
    sockets.push(guestSock);
    guestSock.send('queue.join', { gameId: 'coinflip', stake: GUEST_COINFLIP_STAKE });
    await guestSock.waitFor('match.start');
    await guestSock.waitFor('match.end', 5000); // give the whole round + its sweep-driven resolve time to fire any leak

    const leaked = realSock.received.filter((e) => e.type === 'challenges.update');
    expect(leaked).toEqual([]);
  });

  it('an off-stake guest join (the exact tamper scenario flagged in review) rests without leaking a phantom entry into the real feed', async () => {
    // A guest whose join stake does NOT match GUEST_COINFLIP_STAKE never finds the bot resting
    // (it only rests at the one fixed stake) — it hits the 'waiting' branch instead of matching.
    // Server-side nothing enforces the fixed stake (the client just always sends it); this proves
    // the tampered/off-stake path is still safe.
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'realplayer2', password: 'pw' } });
    const real = reg.json<AuthResponse>();
    const realSock = await openSocket(port, real.token);
    sockets.push(realSock);
    realSock.send('challenges.subscribe', { gameId: 'coinflip' });
    await realSock.waitFor('challenges.list');

    const guest = await mintGuest();
    const guestSock = await openSocket(port, guest.token);
    sockets.push(guestSock);
    const offStake = GUEST_COINFLIP_STAKE - 1;
    guestSock.send('queue.join', { gameId: 'coinflip', stake: offStake });
    const waiting = (await guestSock.waitFor('queue.waiting')).payload as { gameId: string };
    expect(waiting.gameId).toBe('coinflip'); // confirms it actually rested (not matched)

    await new Promise((r) => setTimeout(r, 300)); // let any leak arrive
    expect(realSock.received.filter((e) => e.type === 'challenges.update')).toEqual([]);
  });

  it('a guest subscribed to challenges.subscribe never receives REAL players’ Open Games activity (mirror-image leak)', async () => {
    const guest = await mintGuest();
    const guestSock = await openSocket(port, guest.token);
    sockets.push(guestSock);
    guestSock.send('challenges.subscribe', { gameId: 'coinflip' });
    await guestSock.waitFor('challenges.list');

    // A real player posts a resting bet on the SAME gameId string.
    const regA = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'realA', password: 'pw' } });
    const realA = regA.json<AuthResponse>();
    const realSockA = await openSocket(port, realA.token);
    sockets.push(realSockA);
    realSockA.send('queue.join', { gameId: 'coinflip', stake: 5 });
    await realSockA.waitFor('queue.waiting'); // rests — announced via pushChallengesUpdate

    await new Promise((r) => setTimeout(r, 300));
    expect(guestSock.received.filter((e) => e.type === 'challenges.update')).toEqual([]);
  });
});

describe('guest session cleanup on WS disconnect (issue #267 §"session lifetime")', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  let prevDelay: string | undefined;

  beforeEach(async () => {
    // forfeitDelayMs is read fresh inside registerWsGateway at buildApp time (unlike the
    // module-scoped sweep interval), so overriding it per-describe-block here is safe.
    prevDelay = process.env.FORFEIT_DELAY_MS;
    process.env.FORFEIT_DELAY_MS = '150';

    const db = new Database(':memory:');
    services = createServices(db, [coinflipModule]);
    app = buildApp(services, [coinflipModule], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await app.close();
    if (prevDelay === undefined) delete process.env.FORFEIT_DELAY_MS;
    else process.env.FORFEIT_DELAY_MS = prevDelay;
  });

  async function mintGuest(): Promise<AuthResponse> {
    const res = await app.inject({ method: 'POST', url: '/auth/guest' });
    return res.json<AuthResponse>();
  }

  it('evicts the ephemeral-ledger entries forfeitDelayMs after the WS closes', async () => {
    const guest = await mintGuest();
    expect(services.guest.ledger.accountExists(guest.playerId)).toBe(true);

    const sock = await openSocket(port, guest.token);
    sock.close();

    await new Promise((r) => setTimeout(r, 400)); // well past the 150ms delay
    expect(services.guest.ledger.accountExists(guest.playerId)).toBe(false);
    expect(services.guest.ledger.getBalance(guest.playerId)).toBe(0);
  });

  it('a reconnect within the grace window cancels the eviction — balance survives past the original deadline', async () => {
    const guest = await mintGuest();
    const sock1 = await openSocket(port, guest.token);
    sock1.close(); // schedules an eviction at +150ms

    await new Promise((r) => setTimeout(r, 50)); // well before that timer fires
    const sock2 = await openSocket(port, guest.token); // reconnect with the SAME token → cancels it

    await new Promise((r) => setTimeout(r, 200)); // now ~250ms since sock1's close — past its ORIGINAL deadline
    expect(services.guest.ledger.accountExists(guest.playerId)).toBe(true); // survived — the timer was cancelled, not just delayed

    sock2.close(); // schedules a fresh eviction at +150ms from THIS close
    await new Promise((r) => setTimeout(r, 400));
    expect(services.guest.ledger.accountExists(guest.playerId)).toBe(false); // this one is genuinely done
  });
});
