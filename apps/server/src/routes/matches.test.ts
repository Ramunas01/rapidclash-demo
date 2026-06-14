import { describe, beforeEach, afterEach, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { rpsModule } from '@rapidclash/game-rps';
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
    services.matchmaking.applyMove(matchId, p1.id, 'rock', Date.now());
    services.matchmaking.applyMove(matchId, p2.id, 'scissors', Date.now());
    services.matchmaking.settleMatch(matchId, 0.05);

    const res = await app.inject({
      method: 'GET',
      url: `/matches/${matchId}`,
      headers: { authorization: `Bearer ${p1.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<MatchDetailBody>();
    expect(body.status).toBe('completed');
    expect(body.outcome).toEqual({ type: 'win', winner: p1.id });
    // rock beats scissors → p1 wins. pot 20, rake round(20*0.05)=1, winner net +9.
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
