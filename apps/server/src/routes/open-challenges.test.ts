import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { rpsModule } from '@rapidclash/game-rps';
import { chessModule } from '@rapidclash/game-chess';
import { createServices, buildApp, type AppServices } from '../server.js';
import type { PublicOpenChallenge } from '@rapidclash/shared';

// The public cross-game snapshot powering the logged-out Home ticker. Rest/margin are zeroed
// via env so a freshly-posted bet is immediately eligible to read (defaults are 5s/3s).
describe('GET /open-challenges (public cross-game snapshot)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['CHALLENGE_MIN_REST_MS', 'CHALLENGE_SAFE_MARGIN_MS']) savedEnv[k] = process.env[k];
    process.env.CHALLENGE_MIN_REST_MS = '0';
    process.env.CHALLENGE_SAFE_MARGIN_MS = '0';

    const db = new Database(':memory:');
    // Two games so the snapshot proves it spans games (gameId carried per row).
    services = createServices(db, [rpsModule, chessModule]);
    app = buildApp(services, [rpsModule, chessModule], { seedAdmin: false });
  });

  afterEach(async () => {
    await app.close();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const reg = async (username: string) => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { username, password: 'pw' } });
    return res.json<{ token: string; playerId: string }>();
  };

  it('returns 200 with NO auth, and an array (empty when nothing is resting)', async () => {
    const res = await app.inject({ method: 'GET', url: '/open-challenges' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('exposes resting challenges across games with gameId + the alias authed users see', async () => {
    const alice = await reg('alice');
    const bob = await reg('bob');
    // Resting bets in two different games.
    services.matchmaking.joinQueue(alice.playerId, 'rps', 10);
    services.matchmaking.joinQueue(bob.playerId, 'chess', 25); // clocked → control resolves to a default

    const res = await app.inject({ method: 'GET', url: '/open-challenges' }); // no token
    expect(res.statusCode).toBe(200);
    const rows = res.json<PublicOpenChallenge[]>();

    const rps = rows.find((r) => r.gameId === 'rps');
    expect(rps).toBeDefined();
    expect(rps!.ownerName).toBe('alice'); // real alias, same as the authed WS feed
    expect(rps!.stake).toBe(10);
    expect(rps!.timeControlId).toBe('none'); // untimed game
    expect(typeof rps!.expiresAt).toBe('number');
    expect(typeof rps!.matchId).toBe('string');

    const chess = rows.find((r) => r.gameId === 'chess');
    expect(chess).toBeDefined();
    expect(chess!.ownerName).toBe('bob');
    expect(chess!.stake).toBe(25);
    expect(chess!.timeControlId).not.toBe('none'); // a clocked game carries its control
  });

  it('is unfiltered (no viewer): the public snapshot shows every resting bet', async () => {
    // The authed per-game feed hides the viewer's own bet; the public read has no viewer,
    // so a single resting challenge is visible to anyone (the logged-out ticker).
    const carol = await reg('carol');
    services.matchmaking.joinQueue(carol.playerId, 'rps', 5);

    const rows = (await app.inject({ method: 'GET', url: '/open-challenges' })).json<PublicOpenChallenge[]>();
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerName).toBe('carol');
  });
});
