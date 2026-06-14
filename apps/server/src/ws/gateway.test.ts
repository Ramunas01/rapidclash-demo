import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import { rpsModule } from '@rapidclash/game-rps';
import { PLATFORM_ACCOUNT } from '@rapidclash/core';
import type { Envelope, MatchStartPayload } from '@rapidclash/shared';

// ─── Test harness ──────────────────────────────────────────────────────────────
//
// S8 (Reconnect): drive the real WS gateway over a real socket. We register two
// players, pair them into an RPS match, then disconnect one mid-move, reconnect, and
// `match.resume`. The redacted view and idempotent settlement are the heart of the
// charter invariants (#2 server-authoritative redaction, #3 no double-pay).

const STAKE = 10;
const FEE_RATE = 0.05; // server default when FEE_RATE env is unset

/** Buffers every envelope a socket receives and lets a test await the next of a type. */
class SocketRecorder {
  readonly received: Envelope[] = [];
  private waiters: Array<{ type: string; resolve: (e: Envelope) => void }> = [];

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

  /** Resolve with the next (or already-buffered) envelope of `type`. */
  waitFor(type: string, timeoutMs = 2000): Promise<Envelope> {
    const buffered = this.received.find(
      (e) => e.type === type && !this.consumed.has(e),
    );
    if (buffered) {
      this.consumed.add(buffered);
      return Promise.resolve(buffered);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `Timed out waiting for "${type}"; received: [${this.received.map((e) => e.type).join(', ')}]`,
            ),
          ),
        timeoutMs,
      );
      this.waiters.push({
        type,
        resolve: (e) => {
          clearTimeout(timer);
          this.consumed.add(e);
          resolve(e);
        },
      });
    });
  }

  private consumed = new WeakSet<Envelope>();

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

describe('S8 — WS reconnect / match.resume', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  let bobId: string;
  const sockets: SocketRecorder[] = [];

  beforeEach(async () => {
    const db = new Database(':memory:');
    services = createServices(db, [rpsModule]);
    app = buildApp(services, [rpsModule], { seedAdmin: false });

    const reg = async (username: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username, password: 'pw' },
      });
      return res.json<{ token: string; playerId: string }>();
    };

    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;

    const a = await reg('alice');
    aliceToken = a.token;
    aliceId = a.playerId;
    const b = await reg('bob');
    bobToken = b.token;
    bobId = b.playerId;
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await app.close();
  });

  /** Pair alice + bob into an RPS match and return the shared matchId. */
  async function startMatch(alice: SocketRecorder, bob: SocketRecorder): Promise<string> {
    alice.send('queue.join', { gameId: 'rps', stake: STAKE });
    await alice.waitFor('queue.waiting');
    bob.send('queue.join', { gameId: 'rps', stake: STAKE });
    const aStart = await alice.waitFor('match.start');
    await bob.waitFor('match.start');
    await alice.waitFor('match.your_turn');
    await bob.waitFor('match.your_turn');
    // match.start carries the id in its payload (not at the envelope level).
    return (aStart.payload as MatchStartPayload).matchId;
  }

  it('disconnect mid-move → reconnect → resume returns redacted state; match completes', async () => {
    const alice = await openSocket(port, aliceToken);
    const bob = await openSocket(port, bobToken);
    sockets.push(alice, bob);

    const matchId = await startMatch(alice, bob);

    // Alice moves first, then drops before bob responds.
    alice.send('move.make', { move: 'rock' }, matchId);
    const stateAfterMove = await alice.waitFor('match.state');
    const ownChoices = (stateAfterMove.payload as { state: { choices: Record<string, string> } })
      .state.choices;
    expect(ownChoices[aliceId]).toBe('rock');

    // Hard disconnect (JS context survives in real life; here we drop the socket).
    alice.close();
    sockets.splice(sockets.indexOf(alice), 1);

    // Reconnect with the same bearer token and resume.
    const alice2 = await openSocket(port, aliceToken);
    sockets.push(alice2);
    alice2.send('match.resume', { matchId });

    const resumed = await alice2.waitFor('match.state');
    const resumedChoices = (resumed.payload as {
      state: { choices: Record<string, string> };
    }).state.choices;

    // S8 + invariant #2: own move is present, opponent's concealed move is NOT.
    expect(resumedChoices[aliceId]).toBe('rock');
    expect(bobId in resumedChoices).toBe(false);
    // Already moved this round → no fresh your_turn for alice.
    expect(resumed.matchId).toBe(matchId);

    // The match continues correctly: bob moves, both see match.end.
    bob.send('move.make', { move: 'scissors' }, matchId);
    const aliceEnd = await alice2.waitFor('match.end');
    const bobEnd = await bob.waitFor('match.end');

    const aliceOutcome = (aliceEnd.payload as { outcome: { type: string; winner?: string } }).outcome;
    expect(aliceOutcome).toEqual({ type: 'win', winner: aliceId }); // rock beats scissors
    const aliceSettle = (aliceEnd.payload as { settlement: { delta: number } }).settlement;
    const rake = Math.round(STAKE * 2 * FEE_RATE);
    expect(aliceSettle.delta).toBe(STAKE - rake);
    expect((bobEnd.payload as { settlement: { delta: number } }).settlement.delta).toBe(-STAKE);
  });

  it('terminal-resume returns match.end with the settled outcome and NO duplicate payout', async () => {
    const alice = await openSocket(port, aliceToken);
    const bob = await openSocket(port, bobToken);
    sockets.push(alice, bob);

    const matchId = await startMatch(alice, bob);

    alice.send('move.make', { move: 'rock' }, matchId);
    bob.send('move.make', { move: 'scissors' }, matchId);
    await alice.waitFor('match.end');
    await bob.waitFor('match.end');

    // Snapshot the ledger after settlement.
    const balBefore = {
      alice: services.ledger.getBalance(aliceId),
      bob: services.ledger.getBalance(bobId),
      platform: services.ledger.getBalance(PLATFORM_ACCOUNT),
    };
    const entriesBefore =
      services.ledger.getEntries(aliceId).length +
      services.ledger.getEntries(bobId).length +
      services.ledger.getEntries(PLATFORM_ACCOUNT).length;

    // Resume the already-terminal match repeatedly — must be a pure idempotent read.
    for (let i = 0; i < 3; i++) {
      alice.send('match.resume', { matchId });
      const end = await alice.waitFor('match.end');
      expect((end.payload as { outcome: { type: string; winner?: string } }).outcome).toEqual({
        type: 'win',
        winner: aliceId,
      });
    }

    // A reconnect-then-resume must also not re-settle.
    const alice2 = await openSocket(port, aliceToken);
    sockets.push(alice2);
    alice2.send('match.resume', { matchId });
    await alice2.waitFor('match.end');

    const entriesAfter =
      services.ledger.getEntries(aliceId).length +
      services.ledger.getEntries(bobId).length +
      services.ledger.getEntries(PLATFORM_ACCOUNT).length;

    // Invariant #3: no second payout — balances and ledger entry count are unchanged.
    expect(services.ledger.getBalance(aliceId)).toBe(balBefore.alice);
    expect(services.ledger.getBalance(bobId)).toBe(balBefore.bob);
    expect(services.ledger.getBalance(PLATFORM_ACCOUNT)).toBe(balBefore.platform);
    expect(entriesAfter).toBe(entriesBefore);
  });

  it('resume by a non-player is rejected and never leaks state', async () => {
    const alice = await openSocket(port, aliceToken);
    const bob = await openSocket(port, bobToken);
    sockets.push(alice, bob);
    const matchId = await startMatch(alice, bob);

    // Register a third player with a valid token who is NOT in the match.
    const eveReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username: 'eve', password: 'pw' },
    });
    const eve = await openSocket(port, eveReg.json<{ token: string }>().token);
    sockets.push(eve);

    eve.send('match.resume', { matchId });
    const err = await eve.waitFor('error');
    expect((err.payload as { code: string }).code).toBe('FORBIDDEN');
  });
});
