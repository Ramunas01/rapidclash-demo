import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsClient, hasStoredMatch, type WsMsgHandler } from '../ws.js';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }

  simulateOpen() { this.readyState = 1; this.onopen?.(); }
  simulateMessage(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  simulateClose() { this.readyState = 3; this.onclose?.(); }
}

describe('WsClient message router', () => {
  let mockWs: MockWebSocket;
  let handlers: Required<WsMsgHandler>;

  beforeEach(() => {
    handlers = {
      onQueueWaiting: vi.fn(),
      onMatchStart: vi.fn(),
      onMatchState: vi.fn(),
      onMatchYourTurn: vi.fn(),
      onMatchEnd: vi.fn(),
      onChallengesList: vi.fn(),
      onChallengesUpdate: vi.fn(),
      onChallengeExpired: vi.fn(),
      onError: vi.fn(),
    };

    const MockWsConstructor = vi.fn().mockImplementation((url: string) => {
      mockWs = new MockWebSocket(url);
      return mockWs;
    });
    // Expose WebSocket static constants so WsClient checks work
    const MockWsWithConstants = Object.assign(MockWsConstructor, {
      OPEN: 1,
      CONNECTING: 0,
      CLOSING: 2,
      CLOSED: 3,
    });
    vi.stubGlobal('WebSocket', MockWsWithConstants);
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' });
  });

  function makeClient() {
    const client = new WsClient('test-token', handlers);
    client.connect();
    mockWs.simulateOpen();
    return client;
  }

  it('routes queue.waiting to onQueueWaiting', () => {
    makeClient();
    mockWs.simulateMessage({ type: 'queue.waiting', payload: { gameId: 'rps', since: 100 } });
    expect(handlers.onQueueWaiting).toHaveBeenCalledWith({ gameId: 'rps', since: 100 });
  });

  it('routes match.start to onMatchStart and stores matchId', () => {
    makeClient();
    mockWs.simulateMessage({ type: 'match.start', matchId: 'm1', payload: { matchId: 'm1', opponent: 'bob', state: {} } });
    expect(handlers.onMatchStart).toHaveBeenCalledWith({ matchId: 'm1', opponent: 'bob', state: {} }, 'm1');
  });

  it('routes match.state to onMatchState', () => {
    makeClient();
    mockWs.simulateMessage({ type: 'match.state', matchId: 'm1', payload: { state: { choices: {} }, events: [] } });
    expect(handlers.onMatchState).toHaveBeenCalledWith({ state: { choices: {} }, events: [] }, 'm1');
  });

  it('routes match.your_turn to onMatchYourTurn', () => {
    makeClient();
    mockWs.simulateMessage({ type: 'match.your_turn', matchId: 'm1', payload: { legalMoves: ['rock', 'paper', 'scissors'] } });
    expect(handlers.onMatchYourTurn).toHaveBeenCalledWith({ legalMoves: ['rock', 'paper', 'scissors'] }, 'm1');
  });

  it('routes match.end to onMatchEnd and clears currentMatchId', () => {
    makeClient();
    mockWs.simulateMessage({ type: 'match.start', matchId: 'm1', payload: { matchId: 'm1', opponent: 'bob', state: {} } });
    mockWs.simulateMessage({ type: 'match.end', matchId: 'm1', payload: { outcome: { type: 'win', winner: 'alice' }, settlement: { delta: 90, newBalance: 1090 } } });
    expect(handlers.onMatchEnd).toHaveBeenCalledWith({ outcome: { type: 'win', winner: 'alice' }, settlement: { delta: 90, newBalance: 1090 } }, 'm1');
  });

  it('routes error to onError', () => {
    makeClient();
    mockWs.simulateMessage({ type: 'error', payload: { code: 'ILLEGAL_MOVE', message: 'already moved' } });
    expect(handlers.onError).toHaveBeenCalledWith({ code: 'ILLEGAL_MOVE', message: 'already moved' });
  });

  it('routes the open-challenge messages to their handlers', () => {
    makeClient();
    const list = { gameId: 'rps', entries: [], more: 0 };
    mockWs.simulateMessage({ type: 'challenges.list', payload: list });
    expect(handlers.onChallengesList).toHaveBeenCalledWith(list);

    const update = { gameId: 'rps', removed: { matchId: 'm1', reason: 'taken' } };
    mockWs.simulateMessage({ type: 'challenges.update', payload: update });
    expect(handlers.onChallengesUpdate).toHaveBeenCalledWith(update);

    mockWs.simulateMessage({ type: 'challenge.expired', payload: { matchId: 'm9' } });
    expect(handlers.onChallengeExpired).toHaveBeenCalledWith({ matchId: 'm9' });
  });

  it('subscribeChallenges / takeChallenge emit the right envelopes', () => {
    const client = makeClient();
    client.subscribeChallenges('coinflip');
    client.takeChallenge('m-7');
    const types = mockWs.sent.map((s) => (JSON.parse(s) as { type: string }).type);
    expect(types).toEqual(['challenges.subscribe', 'challenge.take']);
    const take = JSON.parse(mockWs.sent[1]) as { payload: { matchId: string } };
    expect(take.payload.matchId).toBe('m-7');
  });

  it('send emits a properly formed envelope', () => {
    const client = makeClient();
    client.send('queue.join', { gameId: 'rps', stake: 10 });
    expect(mockWs.sent).toHaveLength(1);
    const parsed = JSON.parse(mockWs.sent[0]) as { type: string; payload: unknown };
    expect(parsed.type).toBe('queue.join');
    expect((parsed.payload as { gameId: string }).gameId).toBe('rps');
  });
});

// S8 — currentMatchId survives a full page reload (not just a transient socket drop).
describe('WsClient match persistence (page-reload resume)', () => {
  let mockWs: MockWebSocket;

  beforeEach(() => {
    sessionStorage.clear();
    const MockWsConstructor = vi.fn().mockImplementation((url: string) => {
      mockWs = new MockWebSocket(url);
      return mockWs;
    });
    vi.stubGlobal(
      'WebSocket',
      Object.assign(MockWsConstructor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }),
    );
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' });
  });

  it('persists currentMatchId to sessionStorage on match.start and clears it on match.end', () => {
    const client = new WsClient('tok', {});
    client.connect();
    mockWs.simulateOpen();

    // The real server sends the id ONLY in the payload on match.start (no envelope matchId).
    mockWs.simulateMessage({ type: 'match.start', payload: { matchId: 'm-42', opponent: 'bob', state: {} } });
    expect(sessionStorage.getItem('rc_currentMatchId')).toBe('m-42');
    expect(hasStoredMatch()).toBe(true);

    mockWs.simulateMessage({ type: 'match.end', matchId: 'm-42', payload: { outcome: { type: 'draw' }, settlement: { delta: 0, newBalance: 1000 } } });
    expect(sessionStorage.getItem('rc_currentMatchId')).toBeNull();
    expect(hasStoredMatch()).toBe(false);
  });

  it('a fresh client seeded from storage auto-resumes that match on connect (reload path)', () => {
    // Simulate a prior session having stored a match, then the page reloading.
    sessionStorage.setItem('rc_currentMatchId', 'm-99');

    const client = new WsClient('tok', {});
    client.connect();
    mockWs.simulateOpen();

    // On (re)connect the client must auto-send match.resume for the persisted match.
    expect(mockWs.sent).toHaveLength(1);
    const env = JSON.parse(mockWs.sent[0]) as { type: string; payload: { matchId: string } };
    expect(env.type).toBe('match.resume');
    expect(env.payload.matchId).toBe('m-99');
  });
});
