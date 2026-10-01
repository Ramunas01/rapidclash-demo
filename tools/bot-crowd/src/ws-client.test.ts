// Production incident 2026-10-01: a Cloud Run container restart dropped every bot's connection
// without ever delivering a close/error event (no FIN/RST reached the bot-crowd process), so
// `ws-client.ts`'s existing on('close') reconnect never fired — bots sat silently dead against a
// socket that still looked OPEN. Fix mirrors the server's own D36 ping/pong heartbeat
// (apps/server/src/ws/gateway.ts) symmetrically on the client: ping every tick, terminate() if the
// PREVIOUS ping went unanswered. These tests exercise that heartbeat in isolation, with a fake
// `ws`-compatible socket standing in for a real TCP connection — no live server needed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const instances: MockSocket[] = [];

class MockSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockSocket.OPEN;
  pingCalls = 0;
  terminateCalls = 0;
  closeCalls = 0;
  sent: string[] = [];

  constructor(public url: string) {
    super();
    instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  ping() {
    this.pingCalls++;
  }

  terminate() {
    this.terminateCalls++;
    this.readyState = MockSocket.CLOSED;
    this.emit('close');
  }

  close() {
    this.closeCalls++;
    this.readyState = MockSocket.CLOSED;
    this.emit('close');
  }
}

vi.mock('ws', () => ({ default: MockSocket }));

const { BotWsClient } = await import('./ws-client.js');

function latestSocket(): MockSocket {
  return instances[instances.length - 1];
}

describe('BotWsClient — client-side heartbeat (production incident 2026-10-01)', () => {
  beforeEach(() => {
    instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pings on the configured cadence once open, and does not terminate while pongs keep arriving', () => {
    const client = new BotWsClient('ws://test', {}, 2000, 1000);
    client.connect('tok');
    latestSocket().emit('open');

    vi.advanceTimersByTime(1000);
    expect(latestSocket().pingCalls).toBe(1);
    latestSocket().emit('pong');

    vi.advanceTimersByTime(1000);
    expect(latestSocket().pingCalls).toBe(2);
    expect(latestSocket().terminateCalls).toBe(0);
  });

  it('terminates a socket that never answers a ping, then reconnects via the existing close handler', () => {
    const client = new BotWsClient('ws://test', {}, 500, 1000);
    client.connect('tok');
    const first = latestSocket();
    first.emit('open');

    vi.advanceTimersByTime(1000); // first ping sent, no pong follows
    expect(first.pingCalls).toBe(1);
    expect(first.terminateCalls).toBe(0);

    vi.advanceTimersByTime(1000); // second tick: previous ping unanswered -> terminate()
    expect(first.terminateCalls).toBe(1);

    vi.advanceTimersByTime(500); // reconnectDelayMs elapses
    expect(instances.length).toBe(2); // a fresh connect() ran
  });

  it('stops the heartbeat timer on an ordinary close, so it does not keep pinging a dead/replaced socket', () => {
    const client = new BotWsClient('ws://test', {}, 10_000, 1000);
    client.connect('tok');
    const first = latestSocket();
    first.emit('open');
    first.emit('close'); // e.g. a clean server-initiated close

    vi.advanceTimersByTime(5000);
    expect(first.pingCalls).toBe(0); // heartbeat for the OLD socket never fired after close
  });

  it('disconnect() stops the heartbeat so a deliberately-closed bot never self-terminates later', () => {
    const client = new BotWsClient('ws://test', {}, 10_000, 1000);
    client.connect('tok');
    const first = latestSocket();
    first.emit('open');
    client.disconnect();

    vi.advanceTimersByTime(5000);
    expect(first.pingCalls).toBe(0);
  });
});
