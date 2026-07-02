import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import { rpsModule } from '@rapidclash/game-rps';
import { PLATFORM_ACCOUNT, GRANT_AMOUNT } from '@rapidclash/core';
import type { Envelope, MatchStartPayload } from '@rapidclash/shared';

// ─── Test harness ──────────────────────────────────────────────────────────────
//
// S8 (Reconnect): drive the real WS gateway over a real socket. We register two
// players, pair them into an RPS match, then disconnect one mid-move, reconnect, and
// `match.resume`. The redacted view and idempotent settlement are the heart of the
// charter invariants (#2 server-authoritative redaction, #3 no double-pay).

const STAKE = 10;
// Rake is declared per game in the module meta (rps = 2.5%) and applied generically by the core.
const FEE_RATE = rpsModule.meta.rakeRate;

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
  let prevWindow: string | undefined;

  beforeEach(async () => {
    // Fast pick window (#164 timer-only-resolve) so the sweep closes the round within the test's
    // wait budget instead of the real 10s. Generous enough (1.5s) to outlast the reconnect + the
    // opponent's move in the mid-move-disconnect case before both throws lock at the window close.
    prevWindow = process.env.RC_PICK_WINDOW_MS;
    process.env.RC_PICK_WINDOW_MS = '1500';

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
    if (prevWindow === undefined) delete process.env.RC_PICK_WINDOW_MS;
    else process.env.RC_PICK_WINDOW_MS = prevWindow;
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

    // The match continues correctly: bob picks, then the round resolves at the pick-window close
    // (timer-only-resolve #164 — NOT on bob's move). Both provisional throws lock at the window:
    // alice's rock (preserved across her disconnect) beats bob's scissors.
    bob.send('move.make', { move: 'scissors' }, matchId);
    const aliceEnd = await alice2.waitFor('match.end', 5000);
    const bobEnd = await bob.waitFor('match.end', 5000);

    const aliceOutcome = (aliceEnd.payload as { outcome: { type: string; winner?: string } }).outcome;
    expect(aliceOutcome).toEqual({ type: 'win', winner: aliceId }); // rock beats scissors
    const aliceSettle = (aliceEnd.payload as { settlement: { delta: number } }).settlement;
    const rake = Math.round(STAKE * 2 * FEE_RATE);
    expect(aliceSettle.delta).toBe(STAKE - rake);
    expect((bobEnd.payload as { settlement: { delta: number } }).settlement.delta).toBe(-STAKE);
  }, 15000);

  it('terminal-resume returns match.end with the settled outcome and NO duplicate payout', async () => {
    const alice = await openSocket(port, aliceToken);
    const bob = await openSocket(port, bobToken);
    sockets.push(alice, bob);

    const matchId = await startMatch(alice, bob);

    // Both pick real throws; the round resolves at the pick-window close (timer-only-resolve #164),
    // rock beats scissors → alice wins.
    alice.send('move.make', { move: 'rock' }, matchId);
    bob.send('move.make', { move: 'scissors' }, matchId);
    await alice.waitFor('match.end', 5000);
    await bob.waitFor('match.end', 5000);

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
  }, 15000);

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

// ─── #31 — server-authoritative move timeout (socket stays OPEN) ─────────────────
//
// The socket-close forfeit (S8 above) can't help a client that is stuck but still
// CONNECTED. This drives the real gateway, pairs two players, lets one pick and the
// other go silent (sockets stay open), and asserts the periodic sweep closes the pick
// window and pushes match.end to BOTH — with the stake settled, never orphaned. Under
// timer-only-resolve (#164) the silent player auto-picks at the window; the invariant
// under test is escrow safety on a stuck match, not a silence-forfeit.

describe('#31 — stuck-but-connected match resolves via the timeout sweep', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  let aliceToken: string;
  let aliceId: string;
  let bobToken: string;
  let bobId: string;
  const sockets: SocketRecorder[] = [];
  let prevWindow: string | undefined;

  beforeEach(async () => {
    // Short pick window (#164 timer-only-resolve) so the (1s) sweep closes the stuck round quickly;
    // 300ms is well past the sub-100ms it takes the mover to act, so the mover's throw is a real
    // provisional pick and only the silent player rides to the seeded auto-pick at the window close.
    prevWindow = process.env.RC_PICK_WINDOW_MS;
    process.env.RC_PICK_WINDOW_MS = '300';

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
    if (prevWindow === undefined) delete process.env.RC_PICK_WINDOW_MS;
    else process.env.RC_PICK_WINDOW_MS = prevWindow;
  });

  async function startMatch(alice: SocketRecorder, bob: SocketRecorder): Promise<string> {
    alice.send('queue.join', { gameId: 'rps', stake: STAKE });
    await alice.waitFor('queue.waiting');
    bob.send('queue.join', { gameId: 'rps', stake: STAKE });
    const aStart = await alice.waitFor('match.start');
    await bob.waitFor('match.start');
    await alice.waitFor('match.your_turn');
    await bob.waitFor('match.your_turn');
    return (aStart.payload as MatchStartPayload).matchId;
  }

  it('one player picked, the other is silent → the window closes, both get match.end, no orphaned escrow', async () => {
    const alice = await openSocket(port, aliceToken);
    const bob = await openSocket(port, bobToken);
    sockets.push(alice, bob);

    const matchId = await startMatch(alice, bob);

    // bob picks; alice stays CONNECTED but never picks (the close-forfeit never fires — rps rides the
    // scheduled window sweep, not a disconnect). Timer-only-resolve (#164): a silent CONNECTED player
    // is NOT a forfeit — at the window close her pick auto-fills (seeded) and both throws lock together.
    bob.send('move.make', { move: 'rock' }, matchId);
    await bob.waitFor('match.state');

    // The window-close sweep resolves it server-side and pushes match.end to BOTH open sockets.
    const bobEnd = await bob.waitFor('match.end', 8000);
    const aliceEnd = await alice.waitFor('match.end', 8000);

    // The exact winner depends on alice's seeded auto-pick (and any tie-replays), but the match MUST
    // settle terminally, identically for both, with no orphaned escrow: a decisive win (rake once) or
    // a void at the replay cap (both refunded).
    const outcome = (bobEnd.payload as { outcome: { type: string } }).outcome;
    expect(['win', 'void']).toContain(outcome.type);
    expect((aliceEnd.payload as { outcome: unknown }).outcome).toEqual(outcome);

    // Stake settled, nothing left escrowed: balances + rake reconstruct both grants.
    const total =
      services.ledger.getBalance(aliceId) +
      services.ledger.getBalance(bobId) +
      services.ledger.getBalance(PLATFORM_ACCOUNT);
    expect(total).toBe(GRANT_AMOUNT * 2);
  }, 20000);
});
