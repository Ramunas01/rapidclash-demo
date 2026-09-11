import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsClient, getActiveWsClient, type ChatMsgHandler } from '../ws.js';

// Mock WebSocket — same shape as ws.test.ts's own MockWebSocket (kept local/duplicated rather
// than imported, since ws.test.ts's version isn't exported and this file wants its own isolated
// set of sockets per test for the multi-client scenario below).
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
}

function stubWs() {
  const sockets: MockWebSocket[] = [];
  const MockWsConstructor = vi.fn().mockImplementation((url: string) => {
    const s = new MockWebSocket(url);
    sockets.push(s);
    return s;
  });
  vi.stubGlobal('WebSocket', Object.assign(MockWsConstructor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }));
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' });
  return sockets;
}

describe('WsClient chat routing (ticket 2026-09-11#7b)', () => {
  let sockets: MockWebSocket[];

  beforeEach(() => {
    sockets = stubWs();
  });

  it('subscribeChat sends chat.subscribe with no payload', () => {
    const client = new WsClient('tok', {});
    client.connect();
    sockets[0].simulateOpen();
    client.subscribeChat();
    const env = JSON.parse(sockets[0].sent[sockets[0].sent.length - 1]) as { type: string; payload: unknown };
    expect(env.type).toBe('chat.subscribe');
    expect(env.payload).toEqual({});
  });

  it('sendChat sends chat.send with the text payload', () => {
    const client = new WsClient('tok', {});
    client.connect();
    sockets[0].simulateOpen();
    client.sendChat('hello @bob');
    const env = JSON.parse(sockets[0].sent[sockets[0].sent.length - 1]) as { type: string; payload: { text: string } };
    expect(env.type).toBe('chat.send');
    expect(env.payload.text).toBe('hello @bob');
  });

  it('routes chat.history to onChatHistory via the dedicated chat handler slot (not the main WsMsgHandler)', () => {
    const client = new WsClient('tok', {});
    client.connect();
    sockets[0].simulateOpen();
    const onChatHistory = vi.fn();
    client.setChatHandlers({ onChatHistory });
    const messages = [{ id: '1', name: 'alice', tier: 'Gold', text: 'hi', createdAt: 100 }];
    sockets[0].simulateMessage({ type: 'chat.history', payload: { messages } });
    expect(onChatHistory).toHaveBeenCalledWith({ messages });
  });

  it('routes chat.message to onChatMessage', () => {
    const client = new WsClient('tok', {});
    client.connect();
    sockets[0].simulateOpen();
    const onChatMessage = vi.fn();
    client.setChatHandlers({ onChatMessage });
    const message = { id: '2', name: 'bob', tier: 'Unranked', text: 'yo', createdAt: 200 };
    sockets[0].simulateMessage({ type: 'chat.message', payload: { message } });
    expect(onChatMessage).toHaveBeenCalledWith({ message });
  });

  it('setting chat handlers does not disturb the main WsMsgHandler set (separate slots)', () => {
    const onError = vi.fn();
    const client = new WsClient('tok', { onError });
    client.connect();
    sockets[0].simulateOpen();
    client.setChatHandlers({ onChatMessage: vi.fn() });
    sockets[0].simulateMessage({ type: 'error', payload: { code: 'X', message: 'y' } });
    expect(onError).toHaveBeenCalledWith({ code: 'X', message: 'y' });
  });

  it('getActiveWsClient() always returns the most recently constructed client', () => {
    const a = new WsClient('tok-a', {});
    expect(getActiveWsClient()).toBe(a);
    const b = new WsClient('tok-b', {});
    expect(getActiveWsClient()).toBe(b);
  });

  it('disconnect() clears the active-client singleton only if it is still the active one', () => {
    const a = new WsClient('tok-a', {});
    const b = new WsClient('tok-b', {});
    expect(getActiveWsClient()).toBe(b);
    a.disconnect(); // a is stale (b superseded it) — must NOT clear the singleton
    expect(getActiveWsClient()).toBe(b);
    b.disconnect();
    expect(getActiveWsClient()).toBeNull();
  });

  // "Done when" — proves a message sent by one client is received by another, mirroring the
  // server PR's own two-socket integration test pattern. This is a client-only PR (no server
  // process to run against), so the "server" here is simulated: each WsClient gets its own mock
  // WebSocket, and a `chat.message` broadcast is fed to BOTH sockets independently (exactly what
  // the real gateway's `pushChatMessage` does to every subscribed socket) — proving the CLIENT'S
  // routing is real per-connection wiring, not an optimistic local echo that only updates the
  // sender's own state.
  it('two independent WsClient instances (two "browser tabs") both receive a message sent by either one', () => {
    const clientA = new WsClient('tok-a', {});
    clientA.connect();
    sockets[0].simulateOpen();
    const clientB = new WsClient('tok-b', {});
    clientB.connect();
    sockets[1].simulateOpen();

    const messagesA: unknown[] = [];
    const messagesB: unknown[] = [];
    const handlersA: ChatMsgHandler = { onChatMessage: (p) => messagesA.push(p.message) };
    const handlersB: ChatMsgHandler = { onChatMessage: (p) => messagesB.push(p.message) };
    clientA.setChatHandlers(handlersA);
    clientB.setChatHandlers(handlersB);

    clientA.subscribeChat();
    clientB.subscribeChat();

    // A sends — the real server would resolve A's own name/tier server-side and broadcast the
    // resulting ChatMessage to every subscribed socket, including B's.
    clientA.sendChat('hello from A');
    const sentEnvelope = JSON.parse(sockets[0].sent[sockets[0].sent.length - 1]) as { payload: { text: string } };
    expect(sentEnvelope.payload.text).toBe('hello from A');

    const broadcast = { id: 'm1', name: 'alice', tier: 'Gold', text: 'hello from A', createdAt: 12345 };
    sockets[0].simulateMessage({ type: 'chat.message', payload: { message: broadcast } }); // echoed to sender
    sockets[1].simulateMessage({ type: 'chat.message', payload: { message: broadcast } }); // delivered to B

    expect(messagesA).toEqual([broadcast]);
    expect(messagesB).toEqual([broadcast]); // B received a message it never sent
  });
});
