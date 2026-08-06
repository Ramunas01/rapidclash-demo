// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EMBED_ALLOWED_ORIGINS } from '@rapidclash/shared';

const ALLOWED_ORIGIN = EMBED_ALLOWED_ORIGINS[0];
const OTHER_ALLOWED_ORIGIN = EMBED_ALLOWED_ORIGINS[1];
const UNKNOWN_ORIGIN = 'https://evil.example.com';

function postMessageSpy() {
  const spy = vi.fn();
  vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage: spy } as unknown as Window);
  return spy;
}

/** Import a FRESH copy of the module — its target-origin/one-shot flags are module singletons. */
async function freshEvents() {
  vi.resetModules();
  return import('../guest/events.js');
}

function dispatchInbound(origin: string, data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

beforeEach(() => {
  Object.defineProperty(document, 'referrer', { value: '', configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('guest/events — inbound origin validation', () => {
  it('ignores a message from an origin not on the allowlist — never processed', async () => {
    const events = await freshEvents();
    const onConfig = vi.fn();
    events.initGuestEvents(onConfig);

    dispatchInbound(UNKNOWN_ORIGIN, { v: 1, type: 'config', payload: { chrome: 'embed' } });
    expect(onConfig).not.toHaveBeenCalled();
  });

  it('accepts a message from an allowlisted origin', async () => {
    const events = await freshEvents();
    const onConfig = vi.fn();
    events.initGuestEvents(onConfig);

    dispatchInbound(ALLOWED_ORIGIN, { v: 1, type: 'config', payload: { chrome: 'embed' } });
    expect(onConfig).toHaveBeenCalledWith({ chrome: 'embed' });
  });

  it('ignores a malformed/unversioned envelope even from an allowlisted origin', async () => {
    const events = await freshEvents();
    const onConfig = vi.fn();
    events.initGuestEvents(onConfig);

    dispatchInbound(ALLOWED_ORIGIN, { type: 'config' }); // no v: 1
    dispatchInbound(ALLOWED_ORIGIN, 'not an envelope');
    expect(onConfig).not.toHaveBeenCalled();
  });
});

describe('guest/events — outbound targetOrigin, never *', () => {
  it('sends nothing until a validated inbound message (or referrer) has captured a target origin', async () => {
    const events = await freshEvents();
    const spy = postMessageSpy();

    events.emitReady();
    expect(spy).not.toHaveBeenCalled();
  });

  it('captures the origin from the first VALIDATED inbound message, then reuses it for outbound sends', async () => {
    const events = await freshEvents();
    const spy = postMessageSpy();
    events.initGuestEvents();

    dispatchInbound(ALLOWED_ORIGIN, { v: 1, type: 'config' });
    events.emitReady();

    expect(spy).toHaveBeenCalledTimes(1);
    const [envelope, targetOrigin] = spy.mock.calls[0];
    expect(targetOrigin).toBe(ALLOWED_ORIGIN);
    expect(targetOrigin).not.toBe('*');
    expect(envelope).toEqual({ v: 1, type: 'ready' });
  });

  it('an unrecognized-origin message never becomes the captured target origin', async () => {
    const events = await freshEvents();
    const spy = postMessageSpy();
    events.initGuestEvents();

    dispatchInbound(UNKNOWN_ORIGIN, { v: 1, type: 'config' });
    events.emitReady();
    expect(spy).not.toHaveBeenCalled(); // still no validated origin — nothing sent, never '*'

    dispatchInbound(ALLOWED_ORIGIN, { v: 1, type: 'config' });
    events.emitResize(400);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(ALLOWED_ORIGIN);
  });

  it('falls back to document.referrer only if its origin is also on the allowlist', async () => {
    Object.defineProperty(document, 'referrer', { value: `${OTHER_ALLOWED_ORIGIN}/some/page`, configurable: true });
    const events = await freshEvents();
    const spy = postMessageSpy();
    events.initGuestEvents();

    events.emitReady();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(OTHER_ALLOWED_ORIGIN);
  });

  it('an unrecognized referrer origin is never used as a fallback target', async () => {
    Object.defineProperty(document, 'referrer', { value: `${UNKNOWN_ORIGIN}/some/page`, configurable: true });
    const events = await freshEvents();
    const spy = postMessageSpy();
    events.initGuestEvents();

    events.emitReady();
    expect(spy).not.toHaveBeenCalled();
  });

  it('no call anywhere ever uses "*" as targetOrigin, across every emitted event type', async () => {
    const events = await freshEvents();
    const spy = postMessageSpy();
    events.initGuestEvents();
    dispatchInbound(ALLOWED_ORIGIN, { v: 1, type: 'config' });

    events.emitReady();
    events.emitResize(123);
    events.emitRequestFullscreenOnMobileEntry(true);
    events.emitFirstWin();

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect(call[1]).not.toBe('*');
      expect(call[1]).toBe(ALLOWED_ORIGIN);
    }
  });
});

describe('guest/events — one-shot event guards', () => {
  it('ready fires at most once per session even if called repeatedly', async () => {
    const events = await freshEvents();
    const spy = postMessageSpy();
    events.initGuestEvents();
    dispatchInbound(ALLOWED_ORIGIN, { v: 1, type: 'config' });

    events.emitReady();
    events.emitReady();
    events.emitReady();
    expect(spy.mock.calls.filter(([env]) => (env as { type: string }).type === 'ready')).toHaveLength(1);
  });

  it('firstWin fires at most once per session, carries no payload (no PII)', async () => {
    const events = await freshEvents();
    const spy = postMessageSpy();
    events.initGuestEvents();
    dispatchInbound(ALLOWED_ORIGIN, { v: 1, type: 'config' });

    events.emitFirstWin();
    events.emitFirstWin();
    const wins = spy.mock.calls.filter(([env]) => (env as { type: string }).type === 'firstWin');
    expect(wins).toHaveLength(1);
    expect(wins[0][0]).toEqual({ v: 1, type: 'firstWin' });
  });

  it('requestFullscreen only fires when isMobile is true, and only once', async () => {
    const events = await freshEvents();
    const spy = postMessageSpy();
    events.initGuestEvents();
    dispatchInbound(ALLOWED_ORIGIN, { v: 1, type: 'config' });

    events.emitRequestFullscreenOnMobileEntry(false);
    expect(spy).not.toHaveBeenCalled();

    events.emitRequestFullscreenOnMobileEntry(true);
    events.emitRequestFullscreenOnMobileEntry(true);
    const fs = spy.mock.calls.filter(([env]) => (env as { type: string }).type === 'requestFullscreen');
    expect(fs).toHaveLength(1);
  });

  it('resize is NOT one-shot — it fires on every call (genuine height changes)', async () => {
    const events = await freshEvents();
    const spy = postMessageSpy();
    events.initGuestEvents();
    dispatchInbound(ALLOWED_ORIGIN, { v: 1, type: 'config' });

    events.emitResize(300);
    events.emitResize(450);
    const resizes = spy.mock.calls.filter(([env]) => (env as { type: string }).type === 'resize');
    expect(resizes).toHaveLength(2);
    expect(resizes[1][0]).toEqual({ v: 1, type: 'resize', payload: { height: 450 } });
  });
});
