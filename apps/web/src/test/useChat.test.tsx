// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { WsClient } from '../ws.js';
import { useChat, CHAT_DRAFT_MAX_LENGTH, CHAT_SEND_MAX_LENGTH } from '../components/hub-chrome/useChat.js';

// Same MockWebSocket shape as ws.test.ts — constructing a real WsClient here (rather than mocking
// getActiveWsClient) exercises useChat.ts against the real singleton wiring end-to-end: the
// WsClient constructor registers itself as the active client (see ws.ts), which is exactly what
// useChat.ts's openChat()/send() rely on via getActiveWsClient().
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

let mockWs: MockWebSocket;

function connectRealClient(): WsClient {
  const client = new WsClient('tok', {});
  client.connect();
  mockWs.simulateOpen();
  return client;
}

beforeEach(() => {
  const MockWsConstructor = vi.fn().mockImplementation((url: string) => {
    mockWs = new MockWebSocket(url);
    return mockWs;
  });
  vi.stubGlobal('WebSocket', Object.assign(MockWsConstructor, { OPEN: 1, CONNECTING: 0, CLOSING: 2, CLOSED: 3 }));
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:3000' });
});

describe('useChat (ticket 2026-09-11#7b)', () => {
  it('does not subscribe on mount — only the first time openChat() is called (lazy)', () => {
    connectRealClient();
    const { result } = renderHook(() => useChat());
    expect(result.current.open).toBe(false);
    expect(mockWs.sent).toHaveLength(0);

    act(() => result.current.openChat());
    expect(result.current.open).toBe(true);
    const types = mockWs.sent.map((s) => (JSON.parse(s) as { type: string }).type);
    expect(types).toEqual(['chat.subscribe']);
  });

  it('re-opening after close does not re-subscribe (subscribe is once-per-hook-instance)', () => {
    connectRealClient();
    const { result } = renderHook(() => useChat());
    act(() => result.current.openChat());
    act(() => result.current.close());
    act(() => result.current.openChat());
    const types = mockWs.sent.map((s) => (JSON.parse(s) as { type: string }).type);
    expect(types).toEqual(['chat.subscribe']); // still just the one
  });

  it('seeds messages from chat.history and appends on each chat.message broadcast', () => {
    connectRealClient();
    const { result } = renderHook(() => useChat());
    act(() => result.current.openChat());

    const seed = [{ id: '1', name: 'alice', tier: 'Gold', text: 'hi', createdAt: 1 }];
    act(() => mockWs.simulateMessage({ type: 'chat.history', payload: { messages: seed } }));
    expect(result.current.messages).toEqual(seed);

    const next = { id: '2', name: 'bob', tier: 'Unranked', text: 'yo', createdAt: 2 };
    act(() => mockWs.simulateMessage({ type: 'chat.message', payload: { message: next } }));
    expect(result.current.messages).toEqual([...seed, next]);
  });

  it('send() rejects empty/whitespace-only text without touching the wire', () => {
    connectRealClient();
    const { result } = renderHook(() => useChat());
    act(() => result.current.openChat());
    mockWs.sent = [];

    let ok = true;
    act(() => { ok = result.current.send('   '); });
    expect(ok).toBe(false);
    expect(mockWs.sent).toHaveLength(0);
  });

  it(`send() actively BLOCKS text over ${CHAT_SEND_MAX_LENGTH} chars — not just a warning, the send never reaches the wire`, () => {
    connectRealClient();
    const { result } = renderHook(() => useChat());
    act(() => result.current.openChat());
    mockWs.sent = [];

    const tooLong = 'x'.repeat(CHAT_SEND_MAX_LENGTH + 1);
    let ok = true;
    act(() => { ok = result.current.send(tooLong); });
    expect(ok).toBe(false);
    expect(mockWs.sent).toHaveLength(0); // nothing sent — a real block, not a silent server-side failure
  });

  it(`send() allows exactly ${CHAT_SEND_MAX_LENGTH} chars and delivers it over the wire`, () => {
    connectRealClient();
    const { result } = renderHook(() => useChat());
    act(() => result.current.openChat());
    mockWs.sent = [];

    const atLimit = 'x'.repeat(CHAT_SEND_MAX_LENGTH);
    let ok = false;
    act(() => { ok = result.current.send(atLimit); });
    expect(ok).toBe(true);
    const env = JSON.parse(mockWs.sent[0]) as { type: string; payload: { text: string } };
    expect(env.type).toBe('chat.send');
    expect(env.payload.text).toBe(atLimit);
  });

  it('draft cap constant matches the prototype\'s own .slice(0, 400) (Full Spec.html:4091)', () => {
    expect(CHAT_DRAFT_MAX_LENGTH).toBe(400);
  });

  it('send limit constant matches the server\'s hard rejection limit (160, Full Spec.html:3481)', () => {
    expect(CHAT_SEND_MAX_LENGTH).toBe(160);
  });

  it('toggleExpanded flips expanded; close() resets both open and expanded', () => {
    connectRealClient();
    const { result } = renderHook(() => useChat());
    act(() => result.current.openChat());
    act(() => result.current.toggleExpanded());
    expect(result.current.expanded).toBe(true);
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(result.current.expanded).toBe(false);
  });
});
