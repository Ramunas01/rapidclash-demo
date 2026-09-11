import { randomUUID } from 'node:crypto';
import type { ChatMessage, VipTier } from '@rapidclash/shared';

// Re-export so callers can `import { type ChatMessage } from '@rapidclash/core'` without also
// reaching into `@rapidclash/shared` directly — same convenience `LedgerEntry` gets via
// `ledger.ts`'s own re-export of shared types.
export type { ChatMessage };

/** Bounded backlog size (issue #439/ticket 2026-09-11#7a) — oldest entries drop off the front
 *  once this is exceeded, so a long-running demo's memory doesn't grow unboundedly. Mirrors the
 *  spirit of the prototype's own small seeded backlog (`CHAT_SEED`, 4 entries) without literally
 *  copying that number; 50 is a deliberately-picked, generously-sized round number for a single
 *  general room, not a load-bearing constant. */
export const CHAT_HISTORY_CAP = 50;

/** Server-side hard limit on a single sent message's length (the prototype's own send-time
 *  limit, `Full Spec.html:3481`) — distinct from the client's 400-char draft-typing cap, which
 *  is a client-only UX concern (ticket (b)), not enforced here. */
export const CHAT_MAX_MESSAGE_LENGTH = 160;

export interface ChatTransport {
  /** Validates, stores, and returns one new message from `senderId`. Throws (never silently
   *  drops) on an empty senderId (defense in depth — every real caller is already
   *  authenticated by the time it reaches here, see gateway.ts's `chat.send` handler) or on
   *  text that's empty/whitespace-only/over `CHAT_MAX_MESSAGE_LENGTH`. `name`/`tier` are
   *  resolved from `senderId` via the injected `resolveUsername`/`resolveTier` — the caller
   *  supplies ONLY `senderId` and `text`, never a name or tier, so there is no code path by
   *  which a client-supplied identity can reach a stored message. */
  send(senderId: string, text: string): ChatMessage;
  /** The current bounded backlog, oldest first — a fresh copy each call (callers must not be
   *  able to mutate internal state through the returned array). */
  history(): ChatMessage[];
}

export interface ChatTransportDeps {
  /** Resolve a display name for `senderId` — pass `gateway.ts`'s existing `resolveUsername`
   *  (guest/bot first, then the real identity layer) so guest and bot senders resolve exactly
   *  like every other id-to-name lookup in the gateway. */
  resolveUsername: (senderId: string) => string;
  /** Resolve `senderId`'s current VIP tier — pass a function wrapping `tierForXp` (this
   *  package's own `rewards.ts`) plus however the caller looks up `senderId`'s
   *  `xp_lifetime`. Kept as an injected function (not a direct DB dependency of this module) so
   *  `chat-transport.ts` stays a plain in-memory transport, same spirit as `EphemeralLedger` not
   *  knowing about SQLite. */
  resolveTier: (senderId: string) => VipTier;
  /** Injectable clock, defaults to `Date.now` — same convenience `createRewards` offers via its
   *  own `nowFn` param, useful for deterministic tests. */
  nowFn?: () => number;
}

/**
 * One global, in-memory, ephemeral chat transport (issue #439/ticket 2026-09-11#7a) — gone on
 * process restart, no persistence, no moderation, no per-room keying (general-only room for V1,
 * per the Advisor/PM decision this ticket builds on). Same "plain interface + one in-memory
 * implementation" shape convention as `createEphemeralLedger` (`ephemeral-ledger.ts`), but
 * simpler: there's only ever one logical room, so no per-key map is needed at all — unlike
 * `EphemeralLedger`'s per-`accountId` map, this is just one bounded array.
 *
 * Call this exactly ONCE per server process (mirrors "one shared instance" in
 * `ephemeral-ledger.ts`'s own doc comment) — `apps/server/src/ws/gateway.ts` does so inside
 * `registerWsGateway`, which itself only ever runs once per `buildApp()` call.
 */
export function createChatTransport(deps: ChatTransportDeps): ChatTransport {
  const { resolveUsername, resolveTier, nowFn = () => Date.now() } = deps;

  const messages: ChatMessage[] = [];

  function send(senderId: string, text: string): ChatMessage {
    // Defense in depth: every real gateway caller has already authenticated the connection
    // before this can be reached (see gateway.ts's chat.send handler), but this transport must
    // not silently accept an unattributed message even if called some other way (e.g. a future
    // test or caller that skips the gateway).
    if (!senderId) throw new Error('senderId is required (sender must be authenticated)');
    if (text.trim().length === 0) throw new RangeError('Chat message text must not be empty');
    if (text.length > CHAT_MAX_MESSAGE_LENGTH) {
      throw new RangeError(`Chat message text must be at most ${CHAT_MAX_MESSAGE_LENGTH} characters`);
    }

    const message: ChatMessage = {
      id: randomUUID(),
      name: resolveUsername(senderId),
      tier: resolveTier(senderId),
      text, // relayed verbatim — no trimming/mutation, see ChatMessage's doc comment
      createdAt: nowFn(),
    };

    messages.push(message);
    if (messages.length > CHAT_HISTORY_CAP) messages.shift(); // oldest drops off the front

    return message;
  }

  function history(): ChatMessage[] {
    return [...messages];
  }

  return { send, history };
}
