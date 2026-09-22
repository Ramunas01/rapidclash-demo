import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import { rpsModule } from '@rapidclash/game-rps';
import type { Envelope, MatchEndPayload } from '@rapidclash/shared';

// ACTIVE INCIDENT (ticket 2026-09-22#7): a reconnecting playerId used to silently overwrite
// `connections.set(playerId, socket)` without ever closing the OLD socket — it stayed open but
// unreachable by anything iterating `connections.values()` (the heartbeat included), sitting
// occupied for up to Cloud Run's full 3600s cap instead of being freed within one heartbeat
// interval. Confirmed live via a real gcloud 429 spike, accelerating, right after 2026-09-22#5's
// open-tab-auto-reload-on-deploy change started producing exactly this reconnect pattern at scale.
//
// Proves both halves of the fix: (1) the previous socket for a playerId is now actually
// terminate()'d on reconnect — the literal leak — and (2) that termination is ordered so the OLD
// socket's own `close` handler sees itself as stale (the map already points at the NEW socket) and
// skips every cleanup path meant for the live connection — no incorrect forfeit, no torn-down
// match state.

const STAKE = 10;

function openSocket(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  return new Promise((resolve, reject) => { ws.once('open', () => resolve(ws)); ws.once('error', reject); });
}

class Recorder {
  readonly received: Envelope[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw: Buffer) => this.received.push(JSON.parse(raw.toString()) as Envelope));
  }
  waitFor(type: string, timeoutMs = 2000): Promise<Envelope> {
    const found = this.received.find((e) => e.type === type);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const iv = setInterval(() => {
        const e = this.received.find((x) => x.type === type);
        if (e) { clearInterval(iv); resolve(e); }
        else if (Date.now() - started > timeoutMs) { clearInterval(iv); reject(new Error(`timeout ${type}`)); }
      }, 5);
    });
  }
  has(type: string): boolean { return this.received.some((e) => e.type === type); }
  send(type: string, payload: unknown, matchId?: string): void {
    this.ws.send(JSON.stringify({ type, payload, ...(matchId ? { matchId } : {}) }));
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('WS reconnect socket leak (ticket 2026-09-22#7)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  const sockets: WebSocket[] = [];
  let savedForfeit: string | undefined;
  let savedWindow: string | undefined;

  beforeEach(async () => {
    savedForfeit = process.env.FORFEIT_DELAY_MS;
    process.env.FORFEIT_DELAY_MS = '50'; // tiny so a wrongly-scheduled forfeit would fire fast
    savedWindow = process.env.RC_PICK_WINDOW_MS;
    // Comfortably longer than the 250ms no-forfeit check below (so the round genuinely hasn't
    // resolved yet at that point), short enough to keep the test fast overall.
    process.env.RC_PICK_WINDOW_MS = '600';

    const db = new Database(':memory:');
    services = createServices(db, [rpsModule]);
    app = buildApp(services, [rpsModule], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    for (const s of sockets) if (s.readyState === WebSocket.OPEN) s.close();
    sockets.length = 0;
    await app.close();
    if (savedForfeit === undefined) delete process.env.FORFEIT_DELAY_MS; else process.env.FORFEIT_DELAY_MS = savedForfeit;
    if (savedWindow === undefined) delete process.env.RC_PICK_WINDOW_MS; else process.env.RC_PICK_WINDOW_MS = savedWindow;
  });

  async function register(username: string): Promise<{ token: string; playerId: string }> {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, password: 'pw' } });
    return res.json<{ token: string; playerId: string }>();
  }

  it('reconnecting with the same token terminates the previous socket — it no longer sits open forever', async () => {
    const { token } = await register('leak_alice');
    const oldSocket = await openSocket(port, token);
    sockets.push(oldSocket);
    const closed = new Promise<void>((resolve) => oldSocket.once('close', () => resolve()));

    // A second connection for the SAME player, WITHOUT the client ever closing the first — the
    // exact race this ticket's own reconnect-burst diagnosis describes.
    const newSocket = await openSocket(port, token);
    sockets.push(newSocket);

    // Before the fix, `oldSocket` never closed at all — it sat open, invisible to the heartbeat,
    // for up to Cloud Run's 3600s cap. Now it must close promptly, well inside one test tick.
    await Promise.race([
      closed,
      delay(500).then(() => { throw new Error('the previous socket was never terminated — the leak is back'); }),
    ]);
    expect(oldSocket.readyState).not.toBe(WebSocket.OPEN);
    expect(newSocket.readyState).toBe(WebSocket.OPEN); // the new connection is unaffected
  });

  it('the terminated previous socket is treated as a stale close — no incorrect forfeit, the live match on the new socket is untouched', async () => {
    const alice = await register('leak_bob_a');
    const bob = await register('leak_bob_opp');

    const aliceOld = await openSocket(port, alice.token);
    const bobWs = await openSocket(port, bob.token);
    sockets.push(aliceOld, bobWs);
    const aliceOldRec = new Recorder(aliceOld);
    const bobRec = new Recorder(bobWs);

    aliceOldRec.send('queue.join', { gameId: 'rps', stake: STAKE });
    await aliceOldRec.waitFor('queue.waiting');
    bobRec.send('queue.join', { gameId: 'rps', stake: STAKE });
    const aStart = await aliceOldRec.waitFor('match.start');
    await bobRec.waitFor('match.start');
    const matchId = (aStart.payload as { matchId: string }).matchId;

    // Alice reconnects mid-match WITHOUT her old socket ever closing client-side — same race as
    // the first test, but now with a live match on the line. If the stale-close guard were broken,
    // aliceOld's forced close would incorrectly run the close-forfeit path against the live match.
    const aliceNew = await openSocket(port, alice.token);
    sockets.push(aliceNew);
    const aliceNewRec = new Recorder(aliceNew);

    // Well past FORFEIT_DELAY_MS (50ms) — if the old socket's close wrongly forfeited, bob would
    // have match.end with a win by now.
    await delay(250);
    expect(bobRec.has('match.end')).toBe(false);

    // The live match is still fully playable via the NEW socket — proves connections/state for
    // alice weren't torn down by the stale close either.
    aliceNewRec.send('move.make', { move: 'rock' }, matchId);
    bobRec.send('move.make', { move: 'scissors' }, matchId);
    const end = (await bobRec.waitFor('match.end', 3000)).payload as MatchEndPayload;
    expect(end.outcome).toEqual({ type: 'win', winner: alice.playerId });
  });
});
