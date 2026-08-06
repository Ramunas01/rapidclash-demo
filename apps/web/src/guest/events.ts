// apps/web/src/guest/events.ts
// Versioned postMessage protocol across the guest iframe boundary (GUEST_MODE_CONTRACT.md §5,
// issue #271). Envelope: `{ v: 1, type, payload? }`.
//
// SECURITY — this is the load-bearing part of the ticket, not incidental:
// - Every inbound `message` is validated against EMBED_ALLOWED_ORIGINS before it's acted on.
//   Anything from an unrecognized origin is ignored, never processed.
// - No outbound `postMessage` ever uses `targetOrigin: '*'`. Since this is a single-page app
//   with no server-rendered "who embedded me" signal, the safe pattern is: capture the origin
//   of the first VALIDATED inbound message and reuse that captured origin for every outbound
//   send for the rest of the session. If no inbound message ever arrives, fall back to
//   `document.referrer`'s origin ONLY if it also passes the same allowlist check. If neither
//   source yields an allowed origin, outbound events simply don't send — never a silent '*'.
import { EMBED_ALLOWED_ORIGINS } from '@rapidclash/shared';

export interface EventEnvelope<T = unknown> {
  v: 1;
  type: string;
  payload?: T;
}

export interface GuestConfigPayload {
  games?: string[];
  credits?: number;
  chrome?: string;
}

function isAllowedOrigin(origin: string): boolean {
  return EMBED_ALLOWED_ORIGINS.includes(origin);
}

// Module-level singleton state — one guest session per page load (a reload drops guest state
// by design, GUEST_MODE_CONTRACT.md, so re-initializing on module (re)load is correct, not a leak).
let capturedTargetOrigin: string | null = null;
let messageHandler: ((event: MessageEvent) => void) | null = null;
let readyFired = false;
let fullscreenRequested = false;
let firstWinFired = false;

/** Attach the inbound listener and resolve a fallback target origin from `document.referrer` if
 *  no inbound message has captured one yet. Call once, early (guest surface mount). Returns a
 *  cleanup function. Safe to call more than once — a second call is a no-op. */
export function initGuestEvents(onConfig?: (payload: GuestConfigPayload) => void): () => void {
  if (messageHandler) return () => {};

  messageHandler = (event: MessageEvent) => {
    if (!isAllowedOrigin(event.origin)) return; // reject anything from an unrecognized origin
    if (capturedTargetOrigin === null) capturedTargetOrigin = event.origin;

    const data = event.data as EventEnvelope<GuestConfigPayload> | undefined;
    if (!data || data.v !== 1 || data.type !== 'config') return;
    onConfig?.(data.payload ?? {});
  };
  window.addEventListener('message', messageHandler);

  if (capturedTargetOrigin === null && document.referrer) {
    try {
      const referrerOrigin = new URL(document.referrer).origin;
      if (isAllowedOrigin(referrerOrigin)) capturedTargetOrigin = referrerOrigin;
    } catch {
      // malformed/opaque referrer — leave uncaptured, try again on the next inbound message
    }
  }

  return () => {
    if (messageHandler) window.removeEventListener('message', messageHandler);
    messageHandler = null;
  };
}

function send(type: string, payload?: unknown): void {
  if (capturedTargetOrigin === null) return; // never fall back to '*' — just don't send yet
  const envelope: EventEnvelope = payload === undefined ? { v: 1, type } : { v: 1, type, payload };
  window.parent.postMessage(envelope, capturedTargetOrigin);
}

/** Fires once, after the guest surface has mounted and is interactive. */
export function emitReady(): void {
  if (readyFired) return;
  readyFired = true;
  send('ready');
}

/** Fires on genuine content-height changes (drive this from a ResizeObserver on the app root,
 *  not on every render — the caller owns "genuine"). */
export function emitResize(height: number): void {
  send('resize', { height });
}

/** Judgment call (flagged per issue #271): fired once, automatically, on mobile guest entry —
 *  no manual "enlarge" affordance exists in the UI yet, and the contract's intent ("mobile: step
 *  into the app") reads as an automatic transition, not a UI feature we'd need to design/build
 *  for this ticket. `isMobile` is provided by the caller (coarse-pointer heuristic — see
 *  App.tsx wiring) so this module stays testable without touching `matchMedia` directly. */
export function emitRequestFullscreenOnMobileEntry(isMobile: boolean): void {
  if (fullscreenRequested || !isMobile) return;
  fullscreenRequested = true;
  send('requestFullscreen');
}

/** Fires exactly once per guest session, the first time a guest's Coinflip round resolves as a
 *  win. No payload — the contract requires zero PII, and there's nothing non-PII worth sending. */
export function emitFirstWin(): void {
  if (firstWinFired) return;
  firstWinFired = true;
  send('firstWin');
}

/** Test-only: reset module-level singleton state between tests. */
export function __resetGuestEventsForTest(): void {
  if (messageHandler) window.removeEventListener('message', messageHandler);
  messageHandler = null;
  capturedTargetOrigin = null;
  readyFired = false;
  fullscreenRequested = false;
  firstWinFired = false;
}
