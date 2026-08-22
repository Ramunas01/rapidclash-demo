import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { rpsModule, PICK_WINDOW_MS } from '@rapidclash/game-rps';
import { createServices, buildApp } from '../server.js';

interface MatchDetailBody {
  matchId: string;
  gameId: string;
  players: string[];
  status: 'in_progress' | 'completed';
  state: { players: [string, string]; choices: Record<string, string> };
  outcome?: { type: string; winner?: string };
  settlement?: { delta: number; newBalance: number };
}

const STAKE = 10;

describe('GET /matches/:id', () => {
  let app: FastifyInstance;
  let services: ReturnType<typeof createServices>;
  let p1: { token: string; id: string };
  let p2: { token: string; id: string };
  let outsider: { token: string };
  let matchId: string;

  async function register(username: string): Promise<{ token: string; id: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, password: 'pw' },
    });
    const body = res.json<{ token: string; playerId: string }>();
    return { token: body.token, id: body.playerId };
  }

  beforeEach(async () => {
    const db = new Database(':memory:');
    services = createServices(db, [rpsModule]);
    app = buildApp(services, [rpsModule], { seedAdmin: false });

    p1 = await register('alice');
    p2 = await register('bob');
    outsider = await register('carol');

    // Pair p1 and p2 into an active RPS match.
    const waiting = services.matchmaking.joinQueue(p1.id, 'rps', STAKE);
    matchId = waiting.matchId;
    services.matchmaking.joinQueue(p2.id, 'rps', STAKE);
  });

  afterEach(async () => {
    await app.close();
  });

  it('in-progress: opponent does NOT see the concealed move (viewFor redaction / S5)', async () => {
    // p1 plays 'rock'; p2 has not chosen yet.
    services.matchmaking.applyMove(matchId, p1.id, 'rock', Date.now());

    const asOpponent = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}`,
      headers: { authorization: `Bearer ${p2.token}` },
    });
    expect(asOpponent.statusCode).toBe(200);
    const oppBody = asOpponent.json<MatchDetailBody>();
    expect(oppBody.status).toBe('in_progress');
    // The opponent's concealed move must not be on the wire.
    expect(oppBody.state.choices[p1.id]).toBeUndefined();

    // The mover sees their own choice.
    const asMover = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}`,
      headers: { authorization: `Bearer ${p1.token}` },
    });
    const moverBody = asMover.json<MatchDetailBody>();
    expect(moverBody.state.choices[p1.id]).toBe('rock');
    expect(moverBody.state.choices[p2.id]).toBeUndefined();
  });

  it('completed: returns the terminal outcome and the viewer settlement', async () => {
    // Timer-only-resolve (#164): both provisional throws land inside the window (mutable, no early
    // resolve); the round locks + resolves ONLY when the window closes. The generic move-timer sweep
    // past `windowEndsAt` locks both current throws, resolves (rock beats scissors → p1), and settles
    // internally (rake sourced from rps module meta, 2.5%) — so no separate settleMatch call.
    services.matchmaking.applyMove(matchId, p1.id, 'rock', Date.now());
    services.matchmaking.applyMove(matchId, p2.id, 'scissors', Date.now());
    services.matchmaking.sweepTimedOutMoves(Date.now() + PICK_WINDOW_MS + 1);

    const res = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}`,
      headers: { authorization: `Bearer ${p1.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<MatchDetailBody>();
    expect(body.status).toBe('completed');
    expect(body.outcome).toEqual({ type: 'win', winner: p1.id });
    // rock beats scissors → p1 wins. pot 20, rake round(20*0.025)=1, winner net +9.
    expect(body.settlement?.delta).toBe(STAKE - 1);
    // At terminal both choices are revealed.
    expect(body.state.choices[p1.id]).toBe('rock');
    expect(body.state.choices[p2.id]).toBe('scissors');
  });

  it('returns 403 for an authenticated non-participant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}`,
      headers: { authorization: `Bearer ${outsider.token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for an unknown match id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/matches/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${p1.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: `/matches/${matchId}` });
    expect(res.statusCode).toBe(401);
  });
});

interface RecentMatchesBody {
  matches: Array<{
    matchId: string;
    gameId: string;
    opponentId: string;
    opponentDisplayName: string;
    opponentAvatarId: string;
    outcome: 'win' | 'loss' | 'draw';
    delta: number;
    settledAt: string;
  }>;
  limit: number;
  offset: number;
  total: number;
}

describe('GET /matches/recent', () => {
  let app: FastifyInstance;
  let services: ReturnType<typeof createServices>;
  let p1: { token: string; id: string };
  let p2: { token: string; id: string };
  let outsider: { token: string; id: string };

  async function register(username: string): Promise<{ token: string; id: string }> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, password: 'pw' },
    });
    const body = res.json<{ token: string; playerId: string }>();
    return { token: body.token, id: body.playerId };
  }

  /** Play one RPS match end-to-end to a real, settled result (rock beats scissors — the
   *  first-named player always wins), so match_results + the ledger are both populated the
   *  same way a real match settles. */
  async function playMatch(
    winner: { token: string; id: string },
    loser: { token: string; id: string },
  ): Promise<string> {
    const waiting = services.matchmaking.joinQueue(winner.id, 'rps', STAKE);
    services.matchmaking.joinQueue(loser.id, 'rps', STAKE);
    services.matchmaking.applyMove(waiting.matchId, winner.id, 'rock', Date.now());
    services.matchmaking.applyMove(waiting.matchId, loser.id, 'scissors', Date.now());
    services.matchmaking.sweepTimedOutMoves(Date.now() + PICK_WINDOW_MS + 1);
    return waiting.matchId;
  }

  beforeEach(async () => {
    const db = new Database(':memory:');
    services = createServices(db, [rpsModule]);
    app = buildApp(services, [rpsModule], { seedAdmin: false });

    p1 = await register('alice');
    p2 = await register('bob');
    outsider = await register('carol');
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 without a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: '/matches/recent' });
    expect(res.statusCode).toBe(401);
  });

  it('a player only ever sees matches they were actually in, never another player\'s', async () => {
    const matchId = await playMatch(p1, p2);
    // A second match between p2 and an outsider — p1 has nothing to do with it.
    await playMatch(p2, outsider);

    const res = await app.inject({
      method: 'GET',
      url: '/matches/recent',
      headers: { authorization: `Bearer ${p1.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<RecentMatchesBody>();
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].matchId).toBe(matchId);
    expect(body.matches[0].opponentId).toBe(p2.id);
    expect(body.total).toBe(1);
  });

  it('is strictly scoped to the caller: no playerId param lets a player query someone else', async () => {
    await playMatch(p1, p2);

    // The outsider has no matches at all — confirms the endpoint always reads
    // request.player!.id and can never be pointed at p1's history.
    const res = await app.inject({
      method: 'GET',
      url: '/matches/recent',
      headers: { authorization: `Bearer ${outsider.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<RecentMatchesBody>().matches).toEqual([]);
  });

  it('reports outcome from the viewer\'s own perspective and the ledger-accurate net delta', async () => {
    await playMatch(p1, p2);
    // pot 20, rake round(20*0.025)=1 (rps module fee), winner net +9, loser net −10.

    const winnerRes = await app.inject({
      method: 'GET',
      url: '/matches/recent',
      headers: { authorization: `Bearer ${p1.token}` },
    });
    const winnerBody = winnerRes.json<RecentMatchesBody>();
    expect(winnerBody.matches[0].outcome).toBe('win');
    expect(winnerBody.matches[0].delta).toBe(STAKE - 1);

    const loserRes = await app.inject({
      method: 'GET',
      url: '/matches/recent',
      headers: { authorization: `Bearer ${p2.token}` },
    });
    const loserBody = loserRes.json<RecentMatchesBody>();
    expect(loserBody.matches[0].outcome).toBe('loss');
    expect(loserBody.matches[0].delta).toBe(-STAKE);
  });

  it('paginates via ?limit=&?offset=, newest-settled-first', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await playMatch(p1, p2));
      await new Promise((r) => setTimeout(r, 5));
    }

    const page1 = await app.inject({
      method: 'GET',
      url: '/matches/recent?limit=2&offset=0',
      headers: { authorization: `Bearer ${p1.token}` },
    });
    const body1 = page1.json<RecentMatchesBody>();
    expect(body1.matches.map((m) => m.matchId)).toEqual([ids[2], ids[1]]);
    expect(body1.total).toBe(3);

    const page2 = await app.inject({
      method: 'GET',
      url: '/matches/recent?limit=2&offset=2',
      headers: { authorization: `Bearer ${p1.token}` },
    });
    const body2 = page2.json<RecentMatchesBody>();
    expect(body2.matches.map((m) => m.matchId)).toEqual([ids[0]]);
  });

  it('caps an oversized ?limit= rather than letting it force a full scan', async () => {
    await playMatch(p1, p2);

    const res = await app.inject({
      method: 'GET',
      url: '/matches/recent?limit=999999',
      headers: { authorization: `Bearer ${p1.token}` },
    });
    expect(res.json<RecentMatchesBody>().limit).toBeLessThanOrEqual(50);
  });

  it('defaults to limit 10 when no query params are given', async () => {
    await playMatch(p1, p2);

    const res = await app.inject({
      method: 'GET',
      url: '/matches/recent',
      headers: { authorization: `Bearer ${p1.token}` },
    });
    expect(res.json<RecentMatchesBody>().limit).toBe(10);
  });

  it('excludes a void (refunded) match from the list and from total', async () => {
    // Force a void by having p1 leave the queue before pairing (escrow refunded, no match_id
    // ever created) is not a match_results row at all — instead, exercise void the same way
    // match-history.test.ts does: record it directly via the core service, alongside one real
    // played match, and confirm only the real one surfaces.
    const waiting = services.matchmaking.joinQueue(p1.id, 'rps', STAKE);
    services.matchmaking.joinQueue(p2.id, 'rps', STAKE);
    services.ledger.settle(waiting.matchId, 'void', undefined, STAKE * 2, 0);
    services.matchHistory.recordResult(
      waiting.matchId,
      'rps',
      [p1.id, p2.id],
      'void',
      undefined,
      STAKE,
    );
    const realMatchId = await playMatch(p1, p2);

    const res = await app.inject({
      method: 'GET',
      url: '/matches/recent',
      headers: { authorization: `Bearer ${p1.token}` },
    });
    const body = res.json<RecentMatchesBody>();
    expect(body.matches.map((m) => m.matchId)).toEqual([realMatchId]);
    expect(body.total).toBe(1);
  });
});
