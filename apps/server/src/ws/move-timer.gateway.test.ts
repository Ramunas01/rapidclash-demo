import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import type { ApplyResult, GameModule, PlayerId, Outcome, Envelope, MatchEndPayload, MatchYourTurnPayload } from '@rapidclash/shared';

// Drives the real WS gateway to prove the per-player move-timer sweep injects a module's
// declared auto-move and broadcasts it (match.state → match.end) without any socket message.

interface StandState {
  players: [PlayerId, PlayerId];
  stood: Record<PlayerId, boolean>;
}

/** Tiny opt-in module: each player may only 'stand'; on a 30ms per-player timeout the core
 *  auto-injects 'stand'. Both stood → terminal, players[0] wins (exercises settlement). */
const standModule: GameModule = {
  meta: {
    id: 'standgame', displayName: 'Stand Game', minPlayers: 2, maxPlayers: 2,
    ranking: { kind: 'win_rate' }, bet: { minStake: 1, maxStake: 100, symmetricStake: true },
    averageDurationSec: 5, rakeRate: 0.025, moveTimeoutMs: 30,
  },
  init: (players) => ({ players: [players[0], players[1]], stood: { [players[0]]: false, [players[1]]: false } } as StandState),
  legalMoves: (state, p) => ((state as StandState).stood[p] ? [] : ['stand']),
  applyMove: (state, _move, ctx): ApplyResult => {
    const s = state as StandState;
    return { state: { ...s, stood: { ...s.stood, [ctx.playerId]: true } }, events: [] };
  },
  isTerminal: (state) => (state as StandState).players.every((p) => (state as StandState).stood[p]),
  outcome: (state): Outcome => ({ type: 'win', winner: (state as StandState).players[0] }),
  viewFor: (state) => state,
  forfeit: (state) => state,
  timeoutMove: () => 'stand',
};

class Recorder {
  readonly received: Envelope[] = [];
  private waiters: Array<{ type: string; resolve: (e: Envelope) => void }> = [];
  private consumed = new WeakSet<Envelope>();
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw: Buffer) => {
      const env = JSON.parse(raw.toString()) as Envelope;
      this.received.push(env);
      const i = this.waiters.findIndex((w) => w.type === env.type);
      if (i !== -1) { const [w] = this.waiters.splice(i, 1); this.consumed.add(env); w.resolve(env); }
    });
  }
  waitFor(type: string, timeoutMs = 2000): Promise<Envelope> {
    const buf = this.received.find((e) => e.type === type && !this.consumed.has(e));
    if (buf) { this.consumed.add(buf); return Promise.resolve(buf); }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout ${type}; got [${this.received.map((e) => e.type).join(',')}]`)), timeoutMs);
      this.waiters.push({ type, resolve: (e) => { clearTimeout(t); resolve(e); } });
    });
  }
  send(type: string, payload: unknown): void { this.ws.send(JSON.stringify({ type, payload })); }
  close(): void { this.ws.removeAllListeners(); if (this.ws.readyState === WebSocket.OPEN) this.ws.close(); }
}

function openSocket(port: number, token: string): Promise<Recorder> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  const rec = new Recorder(ws);
  return new Promise((resolve, reject) => { ws.once('open', () => resolve(rec)); ws.once('error', reject); });
}

describe('per-player move-timer sweep over the WS gateway', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  const sockets: Recorder[] = [];
  let savedSweep: string | undefined;

  beforeEach(async () => {
    savedSweep = process.env.CHALLENGE_SWEEP_MS;
    process.env.CHALLENGE_SWEEP_MS = '15'; // run the sweeper fast so 30ms timers resolve in-test

    const db = new Database(':memory:');
    services = createServices(db, [standModule]);
    app = buildApp(services, [standModule], { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await app.close();
    if (savedSweep === undefined) delete process.env.CHALLENGE_SWEEP_MS;
    else process.env.CHALLENGE_SWEEP_MS = savedSweep;
  });

  async function register(username: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, password: 'pw' } });
    return res.json<{ token: string }>().token;
  }

  it('auto-injects the declared move on per-player timeout and settles → match.end to both', async () => {
    const alice = await openSocket(port, await register('alice'));
    const bob = await openSocket(port, await register('bob'));
    sockets.push(alice, bob);

    alice.send('queue.join', { gameId: 'standgame', stake: 10 });
    bob.send('queue.join', { gameId: 'standgame', stake: 10 });
    await alice.waitFor('match.start');
    await bob.waitFor('match.start');
    // Both players have a legal move ('stand') and neither sends it — the per-player timers fire.
    await alice.waitFor('match.your_turn');

    const aEnd = (await alice.waitFor('match.end')).payload as MatchEndPayload;
    const bEnd = (await bob.waitFor('match.end')).payload as MatchEndPayload;
    expect(aEnd.outcome).toEqual({ type: 'win', winner: expect.any(String) });
    // players[0] (alice, the FIFO waiter) wins; rake = round(20*0.025)=1 → +9 / −10.
    expect(aEnd.settlement.delta).toBe(9);
    expect(bEnd.settlement.delta).toBe(-10);

    // The auto-moves came from the timer, not from any client send.
    const sent = alice.received.some((e) => e.type === 'match.your_turn');
    expect(sent).toBe(true);
  });

  it('a real move (stand) is accepted; the other player auto-stands on timeout → match.end', async () => {
    const alice = await openSocket(port, await register('alice2'));
    const bob = await openSocket(port, await register('bob2'));
    sockets.push(alice, bob);

    alice.send('queue.join', { gameId: 'standgame', stake: 10 });
    bob.send('queue.join', { gameId: 'standgame', stake: 10 });
    const start = (await alice.waitFor('match.start')).payload as { matchId: string };
    await bob.waitFor('match.start');
    await alice.waitFor('match.your_turn');

    // Alice stands for real; bob never does → bob auto-stands on timeout, match ends.
    alice.ws.send(JSON.stringify({ type: 'move.make', payload: { move: 'stand' }, matchId: start.matchId }));

    const aEnd = (await alice.waitFor('match.end', 3000)).payload as MatchEndPayload;
    expect(aEnd.outcome.type).toBe('win');
    // Sanity: your_turn was delivered (legalMoves drove the timer).
    const yt = alice.received.find((e) => e.type === 'match.your_turn');
    expect((yt?.payload as MatchYourTurnPayload).legalMoves).toContain('stand');
  });
});
