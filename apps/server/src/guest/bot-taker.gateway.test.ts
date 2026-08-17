import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { chessModule } from '@rapidclash/game-chess';
import { blackjackModule } from '@rapidclash/game-blackjack';
import { GUEST_HUMAN_RESERVED_STAKE, isDemoBotId } from '@rapidclash/shared';
import type { Envelope, MatchStartPayload, QueueWaitingPayload, AuthResponse } from '@rapidclash/shared';
import { createServices, buildApp, type AppServices } from '../server.js';

// Live-socket integration tests for issue #352 (guest bot economy 3/5, §C): a guest posts a stake
// with nobody resting, and a server-scheduled bot-taker claims it after a short delay — the mirror
// image of guest.gateway.test.ts's bot-WAITER coverage (a bot already resting, the guest claims
// IT). GUEST_BOT_TAKE_{MIN,MAX}_MS are shrunk below (same pattern as the chess/blackjack demo-bot
// gateway tests' GUEST_BOT_THINK_{MIN,MAX}_MS) so these tests run in real time without waiting out
// the real 1-3s default claim delay.
//
// An off-lane stake — deliberately NOT one of GUEST_BOT_STAKE_LANES, so no bot-waiter rests there
// and a queue.join always lands on 'waiting', giving the bot-taker something to claim.
const OFF_LANE_STAKE = 42;

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

describe('guest bot-taker over the real WS gateway (issue #352)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  const sockets: SocketRecorder[] = [];
  let prevTakeMin: string | undefined;
  let prevTakeMax: string | undefined;
  let prevWindow: string | undefined;

  beforeEach(async () => {
    prevTakeMin = process.env.GUEST_BOT_TAKE_MIN_MS;
    prevTakeMax = process.env.GUEST_BOT_TAKE_MAX_MS;
    prevWindow = process.env.RC_PICK_WINDOW_MS;
    process.env.GUEST_BOT_TAKE_MIN_MS = '50';
    process.env.GUEST_BOT_TAKE_MAX_MS = '150';
    // Coinflip is a scheduled-deadline game (`usesScheduledDeadlines`): it only resolves once the
    // pick window's sweep fires, not synchronously on the second pick — shrink it so the
    // end-to-end test below doesn't wait out the real ~10s default (mirrors guest.gateway.test.ts).
    process.env.RC_PICK_WINDOW_MS = '300';

    const db = new Database(':memory:');
    services = createServices(db, [coinflipModule, chessModule, blackjackModule]);
    app = buildApp(services, [coinflipModule, chessModule, blackjackModule], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await app.close();
    if (prevTakeMin === undefined) delete process.env.GUEST_BOT_TAKE_MIN_MS;
    else process.env.GUEST_BOT_TAKE_MIN_MS = prevTakeMin;
    if (prevTakeMax === undefined) delete process.env.GUEST_BOT_TAKE_MAX_MS;
    else process.env.GUEST_BOT_TAKE_MAX_MS = prevTakeMax;
    if (prevWindow === undefined) delete process.env.RC_PICK_WINDOW_MS;
    else process.env.RC_PICK_WINDOW_MS = prevWindow;
  });

  async function mintGuest(): Promise<AuthResponse> {
    const res = await app.inject({ method: 'POST', url: '/auth/guest' });
    expect(res.statusCode).toBe(201);
    return res.json<AuthResponse>();
  }

  it('a guest posting an off-lane, non-reserved stake rests first (queue.waiting), then gets claimed by a bot-taker within the delay window', async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'coinflip', stake: OFF_LANE_STAKE });

    // The "Searching…" pattern: rests first — no opponent info at all yet, nothing pre-announced.
    const waiting = (await sock.waitFor('queue.waiting')).payload as QueueWaitingPayload;
    expect(waiting.gameId).toBe('coinflip');
    expect(Object.keys(waiting)).not.toContain('opponent');
    expect(Object.keys(waiting)).not.toContain('opponentName');

    // The claim arrives within the shrunk 50-150ms window (generous margin for CI jitter) — the
    // honest reveal happens exactly here, not a moment before.
    const start = (await sock.waitFor('match.start', 3000)).payload as MatchStartPayload;
    expect(start.matchId).toBe(waiting.matchId); // the SAME resting bet was claimed, not a new one
    expect(isDemoBotId(start.opponent)).toBe(true);
    expect(start.opponent.startsWith('demo-bot:coinflip:taker:')).toBe(true);
    expect(start.opponentName).toBe('Demo Opponent 🤖'); // reused verbatim, no new copy
  });

  it('GUEST_HUMAN_RESERVED_STAKE (1) is never claimed by any bot — the guest stays resting indefinitely, well past the claim window', async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'coinflip', stake: GUEST_HUMAN_RESERVED_STAKE });
    await sock.waitFor('queue.waiting');

    // Wait well past the shrunk 50-150ms take window (and then some) — no match.start ever
    // arrives, proving the reservation is enforced in the matching logic, not just documented.
    await new Promise((r) => setTimeout(r, 500));
    expect(sock.received.some((e) => e.type === 'match.start')).toBe(false);

    // The bet is still genuinely open — a real second human COULD still take it (that's the
    // whole point of the reservation), it's simply never auto-claimed by a bot.
    const { entries } = services.guest.matchmaking.listOpenChallenges('coinflip', 'nobody', Date.now() + 6_000);
    expect(entries.some((e) => e.stake === GUEST_HUMAN_RESERVED_STAKE)).toBe(true);
  });

  it('a guest who cancels (queue.leave) before the delay fires is never matched — the scheduled take is cancelled, not just ignored', async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'coinflip', stake: OFF_LANE_STAKE });
    await sock.waitFor('queue.waiting');
    sock.send('queue.leave', { gameId: 'coinflip' });
    await sock.waitFor('queue.left');

    // Wait well past the claim window — no match.start, and the guest's balance was refunded
    // (not left escrowed under a bet nobody will ever claim now).
    await new Promise((r) => setTimeout(r, 500));
    expect(sock.received.some((e) => e.type === 'match.start')).toBe(false);
    expect(services.guest.ledger.getBalance(guest.playerId)).toBe(guest.balance);
  });

  it('concurrent guests posting different off-lane stakes are ALL claimed, each against its own distinct bot identity, in distinct matches', async () => {
    const guests = await Promise.all([mintGuest(), mintGuest(), mintGuest()]);
    const socks = await Promise.all(guests.map((g) => openSocket(port, g.token)));
    sockets.push(...socks);

    const stakes = [41, 42, 43];
    socks.forEach((s, i) => s.send('queue.join', { gameId: 'coinflip', stake: stakes[i] }));
    for (const s of socks) await s.waitFor('queue.waiting');

    const starts = await Promise.all(socks.map((s) => s.waitFor('match.start', 3000).then((e) => e.payload as MatchStartPayload)));

    for (const start of starts) {
      expect(isDemoBotId(start.opponent)).toBe(true);
      expect(start.opponentName).toBe('Demo Opponent 🤖');
    }
    // Every guest was claimed against its OWN bot identity and its OWN match — no sharing.
    expect(new Set(starts.map((s) => s.opponent)).size).toBe(3);
    expect(new Set(starts.map((s) => s.matchId)).size).toBe(3);
  });

  it('a bot-taken match plays out normally end to end (redaction holds, settlement lands in the ephemeral ledger)', async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'coinflip', stake: OFF_LANE_STAKE });
    const start = (await sock.waitFor('match.start', 3000)).payload as MatchStartPayload;

    // The bot already applied its own pick server-side (onDemoBotMatched, reused verbatim) but
    // it's redacted from the guest's own view pre-terminal, exactly like the bot-WAITER path.
    const preTerminal = start.state as { choices?: Record<string, string> };
    expect(preTerminal.choices && Object.keys(preTerminal.choices).some(isDemoBotId)).toBeFalsy();

    // Coinflip resolves ONLY at the (shrunk) pick-window's scheduled deadline, never on "both
    // chosen" (coinflip.ts's own #164 invariant) — same shape as guest.gateway.test.ts's own
    // bot-WAITER equivalent, which likewise never calls move.make and just waits out match.end.
    const end = await sock.waitFor('match.end', 5000);
    expect(['win', 'draw', 'void']).toContain((end.payload as { outcome: { type: string } }).outcome.type);

    // Settled only in the isolated ephemeral ledger — never the real one (same invariant every
    // other guest test in this directory checks).
    expect(services.ledger.accountExists(guest.playerId)).toBe(false);
    expect(services.guest.ledger.accountExists(guest.playerId)).toBe(true);
  });
});
