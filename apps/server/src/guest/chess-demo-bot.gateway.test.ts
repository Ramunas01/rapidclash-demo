import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { chessModule } from '@rapidclash/game-chess';
import { GUEST_BOT_STAKE_LANES, GUEST_CHESS_TIME_CONTROL } from '@rapidclash/shared';
import type { Envelope, MatchStartPayload, MatchStatePayload, MatchYourTurnPayload, AuthResponse } from '@rapidclash/shared';
import { createServices, buildApp, type AppServices } from '../server.js';

// Live-socket integration tests for issue #278 (DemoGuest PR 3a): a guest mints a session, PLAYs
// chess, and pairs against a pooled Demo-Opponent identity through the exact same WS protocol and
// core matchmaking/redaction machinery a real match uses. GUEST_BOT_THINK_{MIN,MAX}_MS and
// FORFEIT_DELAY_MS are shrunk below (same pattern as guest.gateway.test.ts's RC_PICK_WINDOW_MS)
// so these tests run in real time without waiting out real 1-5s "thinking" delays.
//
// Issue #351 superseded the old single fixed-100 Chess stake with a pool PER stake lane in
// GUEST_BOT_STAKE_LANES.chess — every `queue.join` below now posts one of those configured lanes.
const STAKE = GUEST_BOT_STAKE_LANES.chess[0];

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

describe('chess Demo-Opponent over the real WS gateway (issue #278)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  const sockets: SocketRecorder[] = [];
  let prevThinkMin: string | undefined;
  let prevThinkMax: string | undefined;
  let prevForfeit: string | undefined;

  beforeEach(async () => {
    prevThinkMin = process.env.GUEST_BOT_THINK_MIN_MS;
    prevThinkMax = process.env.GUEST_BOT_THINK_MAX_MS;
    prevForfeit = process.env.FORFEIT_DELAY_MS;
    process.env.GUEST_BOT_THINK_MIN_MS = '100';
    process.env.GUEST_BOT_THINK_MAX_MS = '250';
    process.env.FORFEIT_DELAY_MS = '60000'; // default-ish; overridden per-test where needed

    const db = new Database(':memory:');
    services = createServices(db, [coinflipModule, chessModule]);
    app = buildApp(services, [coinflipModule, chessModule], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await app.close();
    if (prevThinkMin === undefined) delete process.env.GUEST_BOT_THINK_MIN_MS;
    else process.env.GUEST_BOT_THINK_MIN_MS = prevThinkMin;
    if (prevThinkMax === undefined) delete process.env.GUEST_BOT_THINK_MAX_MS;
    else process.env.GUEST_BOT_THINK_MAX_MS = prevThinkMax;
    if (prevForfeit === undefined) delete process.env.FORFEIT_DELAY_MS;
    else process.env.FORFEIT_DELAY_MS = prevForfeit;
  });

  async function mintGuest(): Promise<AuthResponse> {
    const res = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(res.statusCode).toBe(201);
    return res.json<AuthResponse>();
  }

  it('PLAY pairs the guest against a pooled Demo-Opponent — the bot (always seated first, i.e. white) submits its opening move after a delay, then the guest gets match.your_turn', async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'chess', stake: STAKE, timeControlId: GUEST_CHESS_TIME_CONTROL });
    const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;
    expect(start.opponentName).toBe('Demo Opponent 🤖');
    expect(start.opponent.startsWith('demo-bot:chess:')).toBe(true);
    // Nothing has moved yet — the bot's opening move is still "thinking".
    expect((start.state as { history: string[] }).history).toEqual([]);

    // The bot's delayed move arrives as a normal match.state broadcast, well within the shrunk
    // 100-250ms window (generous timeout margin for CI jitter).
    const state = (await sock.waitFor('match.state', 3000)).payload as MatchStatePayload;
    expect((state.state as { history: string[] }).history).toHaveLength(1);

    // Now it's the guest's turn.
    const yourTurn = (await sock.waitFor('match.your_turn')).payload as MatchYourTurnPayload;
    expect(yourTurn.legalMoves.length).toBeGreaterThan(0);
  });

  it("chessModule.viewFor is unchanged for a guest match — same as any real chess match (redaction non-issue confirmed, not assumed)", async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'chess', stake: STAKE, timeControlId: GUEST_CHESS_TIME_CONTROL });
    const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;

    // After a real move has been applied (the bot's opening move), compare the wire state the
    // guest received against the raw match state at that same instant — captured synchronously
    // right after the awaited event, so there's no race with any further mutation (nothing else
    // is pending until the guest's own move).
    const afterMove = (await sock.waitFor('match.state', 3000)).payload as MatchStatePayload;
    const rawAfterMove = services.guest.matchmaking.getActiveMatch(start.matchId)!.state;
    expect(afterMove.state).toEqual(chessModule.viewFor(rawAfterMove, guest.playerId));
  });

  it('3 concurrent guest chess games run without any bot response misrouting between matches', async () => {
    const guests = await Promise.all([mintGuest(), mintGuest(), mintGuest()]);
    const socks = await Promise.all(guests.map((g) => openSocket(port, g.token)));
    sockets.push(...socks);

    const starts: MatchStartPayload[] = [];
    for (const s of socks) {
      s.send('queue.join', { gameId: 'chess', stake: STAKE, timeControlId: GUEST_CHESS_TIME_CONTROL });
      starts.push((await s.waitFor('match.start')).payload as MatchStartPayload);
    }

    // Three distinct matches against three distinct pool identities.
    expect(new Set(starts.map((s) => s.matchId)).size).toBe(3);
    expect(new Set(starts.map((s) => s.opponent)).size).toBe(3);

    // Each guest's own bot moves — and ONLY that guest's socket receives it (the exact
    // misrouting failure mode: a shared identity's response landing on the wrong connection).
    for (let i = 0; i < 3; i++) {
      const state = (await socks[i].waitFor('match.state', 3000)).payload as MatchStatePayload;
      expect((state.state as { history: string[] }).history).toHaveLength(1);
      // The OTHER two sockets must not have received a match.state for THIS matchId.
      for (let j = 0; j < 3; j++) {
        if (j === i) continue;
        expect(socks[j].received.some((e) => e.type === 'match.state' && e.matchId === starts[i].matchId)).toBe(false);
      }
    }

    // A 4th concurrent guest genuinely waits (no pool bot free).
    const guest4 = await mintGuest();
    const sock4 = await openSocket(port, guest4.token);
    sockets.push(sock4);
    sock4.send('queue.join', { gameId: 'chess', stake: STAKE, timeControlId: GUEST_CHESS_TIME_CONTROL });
    const waiting = await sock4.waitFor('queue.waiting', 3000);
    expect(waiting.payload).toBeDefined();
  });

  it('a pending delayed bot move is cancelled cleanly if the match ends first (forfeit) — no orphaned timer, no crash, no move applied to a dead match', async () => {
    // A "thinking" window comfortably longer than the forfeit delay below, so the forfeit always
    // fires first.
    process.env.GUEST_BOT_THINK_MIN_MS = '2000';
    process.env.GUEST_BOT_THINK_MAX_MS = '2000';
    process.env.FORFEIT_DELAY_MS = '200';

    // Rebuild with the new env (registerWsGateway reads FORFEIT_DELAY_MS at registration time).
    await app.close();
    const db = new Database(':memory:');
    services = createServices(db, [coinflipModule, chessModule]);
    app = buildApp(services, [coinflipModule, chessModule], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;

    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);
    sock.send('queue.join', { gameId: 'chess', stake: STAKE, timeControlId: GUEST_CHESS_TIME_CONTROL });
    const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;

    // Disconnect immediately — the bot is still "thinking" its opening move (2s), the forfeit
    // timer (200ms) will fire first.
    sock.close();

    // Wait past the forfeit delay: the match should now be settled (forfeited).
    await new Promise((r) => setTimeout(r, 500));
    expect(services.guest.matchmaking.getActiveMatch(start.matchId)).toBeUndefined();
    const completed = services.guest.matchmaking.getCompletedMatch(start.matchId);
    expect(completed).toBeDefined();
    const forfeitOutcome = completed!.outcome;

    // Wait PAST the bot's original 2s "thinking" window — if its pending move weren't cancelled,
    // it would have fired by now (and would throw or double-settle if it wasn't handled cleanly).
    await new Promise((r) => setTimeout(r, 2200));

    // Still the SAME completed settlement — the bot's delayed move never applied to (and did not
    // re-settle) an already-forfeited match. No crash occurred (the test itself would have thrown
    // via an unhandled rejection / process error otherwise).
    const stillCompleted = services.guest.matchmaking.getCompletedMatch(start.matchId);
    expect(stillCompleted!.outcome).toEqual(forfeitOutcome);
  }, 10000);
});
