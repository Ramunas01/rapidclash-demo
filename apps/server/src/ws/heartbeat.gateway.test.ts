import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';

// Ticket 2026-09-21#9 (D36): a dead-without-clean-close mobile connection could otherwise sit
// occupying a Cloud Run concurrency slot for up to the platform's own 3600s hard cap. Proves the
// new heartbeat's two halves: a healthy connection (answering pong automatically, as every real
// client does — the `ws` protocol handles this at the transport level, not the application) never
// gets terminated across many ticks; a connection that stops answering (simulated via the `ws`
// client's own `autoPong: false` option, which suppresses that automatic protocol-level reply —
// the cleanest way to simulate "still TCP-connected but not actually responsive" without needing
// to fake a real network blip) gets terminated within two ticks, which fires the server's EXISTING
// `close` handler (proven via the same close-forfeit mechanism disconnect-forfeit.gateway.test.ts
// already exercises for a clean close) — no separate cleanup path to verify.

function openSocket(port: number, token: string, opts: { autoPong?: boolean } = {}): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`, opts);
  return new Promise((resolve, reject) => { ws.once('open', () => resolve(ws)); ws.once('error', reject); });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('WS heartbeat (ticket 2026-09-21#9/D36)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  const sockets: WebSocket[] = [];
  let savedHeartbeat: string | undefined;

  beforeEach(async () => {
    savedHeartbeat = process.env.HEARTBEAT_INTERVAL_MS;
    process.env.HEARTBEAT_INTERVAL_MS = '40'; // tiny so the test never waits the real 30s

    const db = new Database(':memory:');
    services = createServices(db, []);
    app = buildApp(services, [], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    for (const s of sockets) if (s.readyState === WebSocket.OPEN) s.close();
    sockets.length = 0;
    await app.close();
    if (savedHeartbeat === undefined) delete process.env.HEARTBEAT_INTERVAL_MS;
    else process.env.HEARTBEAT_INTERVAL_MS = savedHeartbeat;
  });

  async function register(username: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, password: 'pw' } });
    return res.json<{ token: string }>().token;
  }

  it('a healthy connection (normal auto-pong) survives many heartbeat ticks without being terminated', async () => {
    const ws = await openSocket(port, await register('hb_alive'));
    sockets.push(ws);
    let closed = false;
    ws.once('close', () => { closed = true; });

    // Several heartbeat intervals' worth — the normal client keeps auto-answering every ping.
    await delay(250);
    expect(closed).toBe(false);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('a connection that stops answering pings (autoPong disabled) gets terminated within two heartbeat ticks', async () => {
    const ws = await openSocket(port, await register('hb_dead'), { autoPong: false });
    sockets.push(ws);
    const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));

    // Confirms the server IS actually pinging this socket (not just waiting it out blind).
    const gotPing = new Promise<void>((resolve) => ws.once('ping', () => resolve()));
    await gotPing;

    // Tick 1: marked not-alive, pinged (no pong answers, since autoPong is off).
    // Tick 2: still not-alive from tick 1 → terminate() → fires the server's existing close path.
    await Promise.race([closed, delay(500).then(() => { throw new Error('socket was never terminated'); })]);
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
