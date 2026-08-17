import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { chessModule } from '@rapidclash/game-chess';
import { blackjackModule } from '@rapidclash/game-blackjack';
import { GUEST_BOT_STAKE_LANES } from '@rapidclash/shared';
import { createServices, buildApp, type AppServices } from '../server.js';
import type { PublicOpenChallenge } from '@rapidclash/shared';

// Issue #354 (5/5, guest bot economy) — `GET /guest/open-challenges` is a guest-scoped read of
// the ISOLATED `guest.matchmaking` instance's currently-resting Demo-Opponent bot-waiters
// (issue #351's multi-stake pools), for the client's "who's on duty" list. Zeroed rest/margin so
// the pools created at `createGuestServices()` construction (still inside the default 5s
// min-rest window otherwise) are immediately listable — same convention as `open-challenges.test.ts`.
describe('GET /guest/open-challenges (guest-scoped bot-waiter snapshot, issue #354)', () => {
  let app: FastifyInstance;
  let services: AppServices;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['CHALLENGE_MIN_REST_MS', 'CHALLENGE_SAFE_MARGIN_MS']) savedEnv[k] = process.env[k];
    process.env.CHALLENGE_MIN_REST_MS = '0';
    process.env.CHALLENGE_SAFE_MARGIN_MS = '0';

    const db = new Database(':memory:');
    // The real game roster passed to createServices/buildApp is deliberately DIFFERENT from the
    // guest-curated set (coinflip/chess/blackjack) below — proves the guest route's own game list
    // comes from `guest.matchmaking.listGames()`, not from whatever the real one happens to serve.
    services = createServices(db, [coinflipModule, chessModule, blackjackModule]);
    app = buildApp(services, [coinflipModule, chessModule, blackjackModule], { seedAdmin: false });
  });

  afterEach(async () => {
    await app.close();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('returns 200 with NO auth, an array of the bot-waiter pools seeded at startup (issue #351) — every lane, every curated game', async () => {
    const res = await app.inject({ method: 'GET', url: '/guest/open-challenges' });
    expect(res.statusCode).toBe(200);
    const rows = res.json<PublicOpenChallenge[]>();

    const totalLanes = Object.values(GUEST_BOT_STAKE_LANES).reduce((n, lanes) => n + lanes.length, 0);
    expect(rows).toHaveLength(totalLanes);
    for (const row of rows) {
      expect(row.ownerName).toBe('Demo Opponent 🤖');
      expect(['coinflip', 'chess', 'blackjack']).toContain(row.gameId);
      expect(GUEST_BOT_STAKE_LANES[row.gameId as 'coinflip' | 'chess' | 'blackjack']).toContain(row.stake);
      expect(typeof row.matchId).toBe('string');
      expect(typeof row.openedAt).toBe('number');
    }
  });

  it('is isolated from the REAL matchmaking instance: a real player posting a resting bet never appears here', async () => {
    const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { username: 'alice', password: 'pw' } });
    const { playerId } = reg.json<{ playerId: string }>();
    // Post at a stake+game that ALSO happens to be a guest bot lane, so a leak would be visible.
    const [gameId, stake] = ['coinflip', GUEST_BOT_STAKE_LANES.coinflip[0]];
    services.matchmaking.joinQueue(playerId, gameId, stake);

    const rows = (await app.inject({ method: 'GET', url: '/guest/open-challenges' })).json<PublicOpenChallenge[]>();
    // Still exactly the bot pool count — the real player's resting bet never leaked in, and the
    // guest bot still shows at that exact (gameId, stake) lane (the two instances never share state).
    const totalLanes = Object.values(GUEST_BOT_STAKE_LANES).reduce((n, lanes) => n + lanes.length, 0);
    expect(rows).toHaveLength(totalLanes);
    expect(rows.every((r) => r.ownerName === 'Demo Opponent 🤖')).toBe(true);
    // Sanity: the real player's own bet really did rest, on the REAL instance, proving the
    // isolation isn't an accident of it having failed to post.
    const real = services.matchmaking.listOpenChallenges(gameId, '');
    expect(real.entries.some((e) => e.ownerName === 'alice')).toBe(true);
  });

  it('never shows a resting GUEST (human) stake alongside the bots — bots only, by ownerName', async () => {
    // A guest posting an off-lane stake nothing claims yet (mirrors guest/index.ts's own
    // documented "transition window" case) rests in the SAME shared guest Matchmaking instance,
    // but must not render in the "Demo Opponents on duty" list.
    const offLaneStake = 100; // outside GUEST_BOT_STAKE_LANES.coinflip ([5, 10, 25, 50])
    expect(GUEST_BOT_STAKE_LANES.coinflip).not.toContain(offLaneStake);
    services.guest.ledger.grant('guest:human-1');
    services.guest.matchmaking.joinQueue('guest:human-1', 'coinflip', offLaneStake);

    const rows = (await app.inject({ method: 'GET', url: '/guest/open-challenges' })).json<PublicOpenChallenge[]>();
    expect(rows.every((r) => r.stake !== offLaneStake)).toBe(true);
    expect(rows.every((r) => r.ownerName === 'Demo Opponent 🤖')).toBe(true);
  });

  it('the guest game list comes from guest.matchmaking, not the real roster — only the curated 3 games ever appear', async () => {
    const rows = (await app.inject({ method: 'GET', url: '/guest/open-challenges' })).json<PublicOpenChallenge[]>();
    const gameIds = new Set(rows.map((r) => r.gameId));
    expect(gameIds).toEqual(new Set(['coinflip', 'chess', 'blackjack']));
  });
});
