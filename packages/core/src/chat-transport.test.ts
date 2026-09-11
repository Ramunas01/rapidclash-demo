import { describe, beforeEach, it, expect } from 'vitest';
import { createChatTransport, CHAT_HISTORY_CAP, CHAT_MAX_MESSAGE_LENGTH, type ChatTransport } from './chat-transport.js';
import type { VipTier } from '@rapidclash/shared';

// Mirrors ephemeral-ledger.test.ts's structure: one `createX()` factory under test, exercised
// through its public interface only. `resolveUsername`/`resolveTier` are mocked here exactly as
// the ticket asks — this test proves ChatTransport calls them correctly, not that the REAL
// resolveUsername/tierForXp are correct (those are covered by their own modules' tests).

describe('chat transport', () => {
  let names: Record<string, string>;
  let tiers: Record<string, VipTier>;
  let transport: ChatTransport;

  beforeEach(() => {
    names = { alice: 'Alice', bob: 'Bob' };
    tiers = { alice: 'Gold', bob: 'Unranked' };
    transport = createChatTransport({
      resolveUsername: (id) => names[id] ?? id,
      resolveTier: (id) => tiers[id] ?? 'Unranked',
    });
  });

  it('send resolves name/tier from the injected lookups, never from the caller', () => {
    const msg = transport.send('alice', 'hello');
    expect(msg.name).toBe('Alice');
    expect(msg.tier).toBe('Gold');
    expect(msg.text).toBe('hello');
    expect(typeof msg.id).toBe('string');
    expect(msg.id.length).toBeGreaterThan(0);
    expect(typeof msg.createdAt).toBe('number');
  });

  it('two different senders get two different names/tiers on the same shared instance', () => {
    const a = transport.send('alice', 'hi');
    const b = transport.send('bob', 'yo');
    expect(a.name).toBe('Alice');
    expect(a.tier).toBe('Gold');
    expect(b.name).toBe('Bob');
    expect(b.tier).toBe('Unranked');
  });

  it('send stores text verbatim — no trimming, no mention parsing', () => {
    const msg = transport.send('alice', '  hey @bob  check this  ');
    expect(msg.text).toBe('  hey @bob  check this  ');
  });

  it('history returns every sent message, oldest first', () => {
    transport.send('alice', 'first');
    transport.send('bob', 'second');
    const hist = transport.history();
    expect(hist).toHaveLength(2);
    expect(hist[0].text).toBe('first');
    expect(hist[1].text).toBe('second');
  });

  it('history returns a fresh copy each call — callers cannot mutate internal state', () => {
    transport.send('alice', 'first');
    const hist = transport.history();
    hist.push({ id: 'x', name: 'x', tier: 'Unranked', text: 'x', createdAt: 0 });
    expect(transport.history()).toHaveLength(1);
  });

  it(`history is capped at CHAT_HISTORY_CAP (${CHAT_HISTORY_CAP}) — oldest entries drop off the front`, () => {
    for (let i = 0; i < CHAT_HISTORY_CAP + 10; i++) {
      transport.send('alice', `msg-${i}`);
    }
    const hist = transport.history();
    expect(hist).toHaveLength(CHAT_HISTORY_CAP);
    // The oldest 10 (msg-0..msg-9) should have been dropped; the backlog now starts at msg-10.
    expect(hist[0].text).toBe('msg-10');
    expect(hist[hist.length - 1].text).toBe(`msg-${CHAT_HISTORY_CAP + 9}`);
  });

  it('rejects an empty senderId (defense in depth for the auth requirement)', () => {
    expect(() => transport.send('', 'hello')).toThrow();
  });

  it('rejects empty text', () => {
    expect(() => transport.send('alice', '')).toThrow();
  });

  it('rejects whitespace-only text', () => {
    expect(() => transport.send('alice', '   ')).toThrow();
  });

  it(`rejects text over CHAT_MAX_MESSAGE_LENGTH (${CHAT_MAX_MESSAGE_LENGTH}) chars`, () => {
    const tooLong = 'a'.repeat(CHAT_MAX_MESSAGE_LENGTH + 1);
    expect(() => transport.send('alice', tooLong)).toThrow();
  });

  it(`accepts text at exactly CHAT_MAX_MESSAGE_LENGTH (${CHAT_MAX_MESSAGE_LENGTH}) chars`, () => {
    const exact = 'a'.repeat(CHAT_MAX_MESSAGE_LENGTH);
    expect(() => transport.send('alice', exact)).not.toThrow();
  });

  it('a rejected send does not get stored in history', () => {
    expect(() => transport.send('alice', '')).toThrow();
    expect(transport.history()).toHaveLength(0);
  });

  it('supports an injectable clock for deterministic createdAt', () => {
    const custom = createChatTransport({
      resolveUsername: () => 'X',
      resolveTier: () => 'Unranked',
      nowFn: () => 12345,
    });
    const msg = custom.send('x', 'hi');
    expect(msg.createdAt).toBe(12345);
  });
});
