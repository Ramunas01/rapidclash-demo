import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { createServices, buildApp, type AppServices } from '../server.js';
import type { ApplyResult, GameModule, PlayerId, Outcome, Envelope, MatchEndPayload } from '@rapidclash/shared';

// Proves the socket-close forfeit is suppressed for opt-in per-player-timer games (Mines,
// Blackjack): an absent player is auto-acted to a lock by the move-timer sweep instead, so a
// slow board never trips the close-forfeit. A non-opt-in game still close-forfeits as before.

interface NoopState {
  players: [PlayerId, PlayerId];
  done: boolean;
}

/** A never-ending game: both players always have the same single legal move and applying it
 *  changes nothing, so isTerminal stays false. `forfeit` is the ONLY way it can end — which
 *  lets us observe whether the close-forfeit path ran. */
function noopModule(optInTimer: boolean): GameModule {
  return {
    meta: {
      id: optInTimer ? 'noop-timed' : 'noop-plain',
      displayName: 'Noop',
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'win_rate' },
      bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      averageDurationSec: 5,
      rakeRate: 0,
      ...(optInTimer ? { moveTimeoutMs: 40 } : {}),
    },
    init: (players) => ({ players: [players[0], players[1]], done: false }) as NoopState,
    legalMoves: (state, p) => ((state as NoopState).done ? [] : [`noop:${p}`]),
    applyMove: (state): ApplyResult => ({ state, events: [] }), // no-op → never terminal
    isTerminal: (state) => (state as NoopState).done,
    outcome: (state): Outcome => ({ type: 'win', winner: (state as NoopState).players[0] }),
    viewFor: (state) => state,
    // forfeit ends it (the quitter loses → players[0]/[1] win as appropriate). Marked done.
    forfeit: (state, quitter): NoopState => {
      const s = state as NoopState;
      const winner = s.players.find((p) => p !== quitter)!;
      return { ...s, done: true, players: s.players, winner } as NoopState & { winner: PlayerId };
    },
    ...(optInTimer ? { timeoutMove: (_s: unknown, p: PlayerId) => `noop:${p}` } : {}),
  } as GameModule;
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
  send(type: string, payload: unknown): void { this.ws.send(JSON.stringify({ type, payload })); }
  close(): void { this.ws.removeAllListeners(); if (this.ws.readyState === WebSocket.OPEN) this.ws.close(); }
}

function openSocket(port: number, token: string): Promise<Recorder> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(token)}`);
  const rec = new Recorder(ws);
  return new Promise((resolve, reject) => { ws.once('open', () => resolve(rec)); ws.once('error', reject); });
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('socket-close forfeit vs opt-in per-player timers', () => {
  let app: FastifyInstance;
  let services: AppServices;
  let port: number;
  const sockets: Recorder[] = [];
  let savedForfeit: string | undefined;
  let savedSweep: string | undefined;

  const modules = [noopModule(true), noopModule(false)];

  beforeEach(async () => {
    savedForfeit = process.env.FORFEIT_DELAY_MS;
    savedSweep = process.env.CHALLENGE_SWEEP_MS;
    process.env.FORFEIT_DELAY_MS = '50'; // tiny so the test never waits the real 60s
    process.env.CHALLENGE_SWEEP_MS = '15';

    const db = new Database(':memory:');
    services = createServices(db, modules);
    app = buildApp(services, modules, { seedAdmin: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    await app.close();
    if (savedForfeit === undefined) delete process.env.FORFEIT_DELAY_MS; else process.env.FORFEIT_DELAY_MS = savedForfeit;
    if (savedSweep === undefined) delete process.env.CHALLENGE_SWEEP_MS; else process.env.CHALLENGE_SWEEP_MS = savedSweep;
  });

  async function register(username: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, password: 'pw' } });
    return res.json<{ token: string }>().token;
  }

  async function matchTwo(gameId: string, names: [string, string]): Promise<[Recorder, Recorder]> {
    const a = await openSocket(port, await register(names[0]));
    const b = await openSocket(port, await register(names[1]));
    sockets.push(a, b);
    a.send('queue.join', { gameId, stake: 10 });
    await a.waitFor('queue.waiting');
    b.send('queue.join', { gameId, stake: 10 });
    await a.waitFor('match.start');
    await b.waitFor('match.start');
    return [a, b];
  }

  it('opt-in timer game: a disconnect does NOT close-forfeit (the move-timer keeps the absent player going)', async () => {
    const [a, b] = await matchTwo('noop-timed', ['t_alice', 't_bob']);
    // Bob drops. With the fix, NO 50ms close-forfeit is scheduled; the absent player's
    // per-player clock keeps firing (auto-noop), so the never-ending match stays active.
    b.close();
    await delay(250); // well past FORFEIT_DELAY_MS (50ms) and several sweep cycles
    expect(a.has('match.end')).toBe(false); // the present player was NOT handed a forfeit win
  });

  it('non-opt-in game: a disconnect still close-forfeits the absent player (unchanged behaviour)', async () => {
    const [a, b] = await matchTwo('noop-plain', ['p_alice', 'p_bob']);
    b.close();
    // The 50ms close-forfeit fires → the present player (alice) gets match.end with a win.
    const end = (await a.waitFor('match.end', 2000)).payload as MatchEndPayload;
    expect(end.outcome).toEqual({ type: 'win', winner: expect.any(String) });
  });
});
