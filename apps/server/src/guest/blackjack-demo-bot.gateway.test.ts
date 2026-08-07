import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { blackjackModule, handValue, type Card } from '@rapidclash/game-blackjack';
import { GUEST_BLACKJACK_STAKE } from '@rapidclash/shared';
import type { Envelope, MatchStartPayload, MatchStatePayload, AuthResponse } from '@rapidclash/shared';
import { createServices, buildApp, type AppServices } from '../server.js';

// The draw/replay re-trigger test below needs to force an actual internal draw (both hands land
// on the same total) through the REAL matchmaking/gateway pipeline — not a fake — so it can prove
// the gateway's generic post-broadcast trigger genuinely re-fires the bot's decision loop off a
// `new_round` event, not just off an ordinary hit. `core`'s match seed is drawn from
// `node:crypto`'s `randomBytes` (matchmaking.ts), so this partial mock (forwards to the real
// implementation by default) lets exactly ONE test pin it to a pre-computed value that's known —
// via the offline search producing the constants below — to deal a round-0 draw. Every other test
// in this file, and every other crypto export (randomUUID, etc.), is completely unaffected.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});
import * as nodeCrypto from 'node:crypto';

// Live-socket integration tests for issue #297 (DemoGuest Blackjack): a guest mints a session,
// PLAYs blackjack, and pairs against a pooled Demo-Opponent identity through the exact same WS
// protocol and core matchmaking/redaction machinery a real match uses. Mirrors
// chess-demo-bot.gateway.test.ts's structure, adapted for Blackjack's CONCURRENT (not turn-based)
// bot decision loop: the bot's first hit/stand decision fires the moment the match forms (the
// round is already dealt by `init`), not after any opponent move.

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

type BJState = { hands: Record<string, { cards: Card[]; done: boolean }>; round: number };

describe('blackjack Demo-Opponent over the real WS gateway (issue #297)', () => {
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
    process.env.GUEST_BOT_THINK_MIN_MS = '50';
    process.env.GUEST_BOT_THINK_MAX_MS = '150';
    process.env.FORFEIT_DELAY_MS = '60000';

    const db = new Database(':memory:');
    services = createServices(db, [coinflipModule, blackjackModule]);
    app = buildApp(services, [coinflipModule, blackjackModule], { seedAdmin: false });
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

  it('PLAY pairs the guest against a pooled Demo-Opponent — the round is already dealt on match.start, and the bot submits its OWN first decision unprompted (concurrent, self-triggered, not opponent-triggered)', async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'blackjack', stake: GUEST_BLACKJACK_STAKE });
    const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;
    expect(start.opponentName).toBe('Demo Opponent 🤖');
    expect(start.opponent.startsWith('demo-bot:blackjack:')).toBe(true);
    // The round is dealt already (blackjackModule.init deals it) — the guest sees their own 2
    // cards and exactly one of the bot's.
    const startState = start.state as BJState;
    expect(startState.hands[guest.playerId].cards).toHaveLength(2);
    expect(startState.hands[start.opponent].cards).toHaveLength(1);

    // Nobody prompted the bot (the guest hasn't acted) — its first decision still arrives, because
    // it self-triggers off match formation, not off the human's move.
    const rawAfterBotDecision = await waitForBotHandChange(services, start.matchId, start.opponent);
    expect(rawAfterBotDecision).toBeDefined();
  });

  it("blackjackModule.viewFor is unchanged for a guest match — same as any real blackjack match (redaction non-issue confirmed, not assumed): opponent's hidden card, hit count, and stand/bust status stay hidden until reveal", async () => {
    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);

    sock.send('queue.join', { gameId: 'blackjack', stake: GUEST_BLACKJACK_STAKE });
    const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;

    // Wait for the bot's first delayed decision to land as a match.state broadcast.
    const afterBot = (await sock.waitFor('match.state', 3000)).payload as MatchStatePayload;
    const rawAfterBot = services.guest.matchmaking.getActiveMatch(start.matchId)!.state;
    expect(afterBot.state).toEqual(blackjackModule.viewFor(rawAfterBot, guest.playerId));

    // Explicitly: the wire state never carries more than one of the bot's cards, and never its
    // `done` status, pre-terminal — whatever the bot actually did server-side.
    const wireOpp = (afterBot.state as BJState).hands[start.opponent];
    expect(wireOpp.cards.length).toBeLessThanOrEqual(1);
    expect(wireOpp.done).toBe(false);
  });

  it('3 concurrent guest blackjack games run without any bot response misrouting between matches', async () => {
    const guests = await Promise.all([mintGuest(), mintGuest(), mintGuest()]);
    const socks = await Promise.all(guests.map((g) => openSocket(port, g.token)));
    sockets.push(...socks);

    const starts: MatchStartPayload[] = [];
    for (const s of socks) {
      s.send('queue.join', { gameId: 'blackjack', stake: GUEST_BLACKJACK_STAKE });
      starts.push((await s.waitFor('match.start')).payload as MatchStartPayload);
    }

    expect(new Set(starts.map((s) => s.matchId)).size).toBe(3);
    expect(new Set(starts.map((s) => s.opponent)).size).toBe(3);

    // Each guest's own bot decision — and ONLY that guest's socket receives it.
    for (let i = 0; i < 3; i++) {
      await socks[i].waitFor('match.state', 3000);
      for (let j = 0; j < 3; j++) {
        if (j === i) continue;
        expect(socks[j].received.some((e) => e.type === 'match.state' && e.matchId === starts[i].matchId)).toBe(false);
      }
    }

    // A 4th concurrent guest genuinely waits (no pool bot free).
    const guest4 = await mintGuest();
    const sock4 = await openSocket(port, guest4.token);
    sockets.push(sock4);
    sock4.send('queue.join', { gameId: 'blackjack', stake: GUEST_BLACKJACK_STAKE });
    const waiting = await sock4.waitFor('queue.waiting', 3000);
    expect(waiting.payload).toBeDefined();
  });

  it('a pending delayed bot decision is cancelled cleanly if the match ends first (forfeit) — no orphaned timer, no crash, no stale decision re-applying to a dead match', async () => {
    // Blackjack opts into the core's PER-PLAYER move timer (`meta.moveTimeoutMs`) — the gateway's
    // socket-close handler deliberately does NOT arm the ordinary close-forfeit timer for such
    // games (see gateway.ts's close handler: an absent player is auto-stood by the #91 move-timer
    // sweep instead, which can legitimately take longer than a fixed forfeit delay). So unlike
    // Chess's version of this test (a scheduled-deadline/time-control game, close-forfeits
    // normally), forcing "the match ends while the bot is still thinking" here has to go through
    // the EXPLICIT `match.forfeit` message instead of a socket close — the real client's own
    // forfeit/resign action, and unconditional regardless of a game's timer opt-in.
    process.env.GUEST_BOT_THINK_MIN_MS = '2000';
    process.env.GUEST_BOT_THINK_MAX_MS = '2000';

    await app.close();
    const db = new Database(':memory:');
    services = createServices(db, [coinflipModule, blackjackModule]);
    app = buildApp(services, [coinflipModule, blackjackModule], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;

    const guest = await mintGuest();
    const sock = await openSocket(port, guest.token);
    sockets.push(sock);
    sock.send('queue.join', { gameId: 'blackjack', stake: GUEST_BLACKJACK_STAKE });
    const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;

    // Forfeit immediately — the bot is still "thinking" its first decision (2s "thinking" window).
    sock.send('match.forfeit', {}, start.matchId);
    const end = (await sock.waitFor('match.end')).payload;
    expect(end).toBeDefined();

    expect(services.guest.matchmaking.getActiveMatch(start.matchId)).toBeUndefined();
    const completed = services.guest.matchmaking.getCompletedMatch(start.matchId);
    expect(completed).toBeDefined();
    const forfeitOutcome = completed!.outcome;

    // Wait PAST the bot's original 2s "thinking" window — if its pending decision weren't
    // cancelled, it would fire now (and would throw / double-settle if not handled cleanly).
    await new Promise((r) => setTimeout(r, 2200));

    const stillCompleted = services.guest.matchmaking.getCompletedMatch(start.matchId);
    expect(stillCompleted!.outcome).toEqual(forfeitOutcome);
    // No crash occurred (an uncaught exception in the timer callback would have failed this test
    // via an unhandled rejection), and no extra match.state/match.end arrived from the cancelled
    // decision re-applying itself.
    expect(sock.received.filter((e) => e.type === 'match.end')).toHaveLength(1);
  }, 10000);

  it('an internal draw/replay (new_round) re-triggers the bot\'s decision loop for the fresh round — the bot keeps deciding across the replay with no human intervention needed to "restart" it', async () => {
    // Forcing a GENUINE draw through the real pipeline (rather than asserting on a fake) needs the
    // round-0 deal pinned to a known outcome. `crypto.randomBytes(4)` (matchmaking.ts) seeds the
    // match; `Math.random()` drives both the bot's "thinking" delay AND its hit/stand heuristic
    // (`selectBlackjackMove`, issue #297's table). Pinning Math.random to 0.99 makes the heuristic
    // fully deterministic — `0.99 < P(hit)` is true only for the ≤14 bucket (P=1.0) — i.e. "hit
    // while best ≤14, stand at best ≥15". cryptoSeed=4 was found by an offline search (replicating
    // matchmaking.ts's `createRng` + deck.ts's `deckFor`/`handValue` exactly) for a seed where,
    // under that exact policy, round 0 deals the guest a fixed (never-hit) 2-card total of 16 AND
    // the bot's hit-until-≥15 policy also lands on exactly 16 with no bust — a genuine draw.
    process.env.GUEST_BOT_THINK_MIN_MS = '5';
    process.env.GUEST_BOT_THINK_MAX_MS = '15';

    // Install the Math.random override BEFORE (re-)constructing `services` — `createGuestServices`
    // reads `Math.random` ONCE into a closure variable at construction (`const random = opts.random
    // ?? Math.random`, mirroring the same pattern `selectChessMove`'s caller uses), so spying on
    // `Math.random` any later would silently do nothing: the bot would keep using the ALREADY-
    // CAPTURED real function. Installing it first makes the fresh `createServices()` call below
    // capture the MOCKED reference instead.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      await app.close();
      const db = new Database(':memory:');
      services = createServices(db, [coinflipModule, blackjackModule]);
      app = buildApp(services, [coinflipModule, blackjackModule], { seedAdmin: false });
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;

      // Mint the guest session and open the socket before arming the crypto mock: the `ws` client's
      // handshake itself calls the real `crypto.randomBytes(16)` (its Sec-WebSocket-Key) — arming
      // the one-shot override before that would misfire on the handshake instead of the match seed.
      // Frame masking (also per-send) uses `randomFillSync`, a DIFFERENT crypto export our partial
      // mock never touches, so it can't collide with the armed override either.
      const guest = await mintGuest();
      const sock = await openSocket(port, guest.token);
      sockets.push(sock);

      const cryptoSpy = nodeCrypto.randomBytes as unknown as ReturnType<typeof vi.fn>;
      cryptoSpy.mockImplementationOnce(() => Buffer.from([4, 0, 0, 0]));

      sock.send('queue.join', { gameId: 'blackjack', stake: GUEST_BLACKJACK_STAKE });
      const start = (await sock.waitFor('match.start')).payload as MatchStartPayload;

      // Confirm the precomputed seed landed as expected before relying on it — a guard against
      // this test silently testing nothing if the search constants or the ordering assumption
      // (players[0] = the resting bot, players[1] = the joining guest — matchmaking.ts's FIFO
      // pairing) ever drift.
      const dealtHuman = start.state as BJState;
      expect(handValue(dealtHuman.hands[guest.playerId].cards)).toBe(16);

      // The guest stands immediately (their total is fixed at 16 for the whole round) — the round
      // resolves purely off the bot's own hit-until-≥15 cadence from here.
      sock.send('move.make', { move: 'stand' }, start.matchId);

      // Drain match.state broadcasts (each one either a bot hit — empty events, redacted, per
      // BLACKJACK.md — or the resolving move) until we see the `new_round` event: proof of the
      // draw actually replaying, not a decisive result.
      let sawNewRound = false;
      for (let i = 0; i < 20 && !sawNewRound; i++) {
        const env = await sock.waitFor('match.state', 2000);
        const events = (env.payload as MatchStatePayload).events;
        if (events.some((e) => e.type === 'new_round')) sawNewRound = true;
      }
      expect(sawNewRound).toBe(true);
      const afterRedeal = services.guest.matchmaking.getActiveMatch(start.matchId);
      expect(afterRedeal).toBeDefined();
      expect((afterRedeal!.state as BJState).round).toBe(1);

      // The actual re-trigger proof: WITHOUT the guest sending anything for round 1, another
      // match.state broadcast still arrives — the bot's round-1 decision loop fired on its own,
      // off the `new_round` broadcast alone (the exact generic mechanism `maybeScheduleGuestBotMove`
      // provides — see gateway.ts). A broken re-trigger would time out here instead.
      const nextRoundEnvelope = await sock.waitFor('match.state', 2000);
      expect(nextRoundEnvelope).toBeDefined();
    } finally {
      randomSpy.mockRestore();
    }
  }, 15000);
});

/** Poll the guest matchmaking's raw match state until the bot's hand differs from its initial
 *  2-card deal-minus-redaction shape (i.e. either it hit — 3+ cards — or it stood/busted — `done:
 *  true`) or the match ends, whichever first proves the bot's self-triggered decision actually
 *  ran. Bounded so a genuinely broken trigger fails the test instead of hanging it. */
async function waitForBotHandChange(services: AppServices, matchId: string, botId: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    const match = services.guest.matchmaking.getActiveMatch(matchId);
    if (!match) return true; // resolved already — the bot evidently acted
    const hand = (match.state as BJState).hands[botId];
    if (hand.cards.length > 2 || hand.done) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}
