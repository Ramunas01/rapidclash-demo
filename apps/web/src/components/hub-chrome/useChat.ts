import { useCallback, useRef, useState } from 'react';
import type { ChatMessage } from '@rapidclash/shared';
import { getActiveWsClient } from '../../ws.js';

/** Client-side draft-typing cap — `Full Spec.html:4091`'s own `onChatDraft` handler:
 *  `this.setState({ chatDraft: el.value.slice(0, 400) }, ...)`. Purely a "stop accumulating
 *  keystrokes" UX limit on the composer's local draft state, independent of (and much higher
 *  than) the server's real send limit below. */
export const CHAT_DRAFT_MAX_LENGTH = 400;

/** The server's hard rejection limit for one sent message — mirrors
 *  `packages/core/src/chat-transport.ts`'s own `CHAT_MAX_MESSAGE_LENGTH` (`Full Spec.html:3481`).
 *  Not imported from `@rapidclash/core` — `apps/web` only depends on `@rapidclash/shared` (see
 *  `apps/web/package.json`), and this ticket is scoped client-only, so the value is mirrored here
 *  as a plain literal rather than adding a new cross-package dependency. Also the prototype's own
 *  over-limit warning-ring threshold (`chatOverRing`, `Full Spec.html:4076-4077`,
 *  `chatOver: (this.state.chatDraft || '').length > 160`) — but where the prototype only shows
 *  that ring and lets the send silently fail server-side (a real UX gap the ticket flags by
 *  name), `send()` below actively refuses to submit past this length instead. */
export const CHAT_SEND_MAX_LENGTH = 160;

export interface UseChatResult {
  /** Sheet open/closed (`chatOpen` in the prototype). */
  open: boolean;
  /** Half-height (top:52%) vs full-height (top:60px) — toggled by the sheet's own chevron
   *  (`chatHalf`/`toggleChatHalf`, `Full Spec.html:4059-4066`). */
  expanded: boolean;
  /** Seeded from the `chat.history` reply, appended to on each `chat.message` broadcast. */
  messages: ChatMessage[];
  /** Opens the sheet. Lazily sends `chat.subscribe` the FIRST time this hook instance opens
   *  (never on plain app mount) — subsequent opens are a no-op subscribe-wise. */
  openChat(): void;
  close(): void;
  toggleExpanded(): void;
  /** Validates (non-empty after trim, ≤ `CHAT_SEND_MAX_LENGTH`) and sends over the shared WS
   *  connection. Returns `false` — and sends nothing — if validation fails or nothing is
   *  connected yet, same boolean-return convention as every other `ws.ts` send wrapper. */
  send(text: string): boolean;
}

/**
 * Chat's cross-cutting state (ticket 2026-09-11#7b) — owns subscribe/open/close/half-toggle/
 * send/message-list state, same "hook owns state, component renders it" split as
 * `useMenuOverlay.ts`/`MenuOverlay.tsx`. Called locally inside whichever hub screen is mounted
 * (same shape as `useMenuOverlay()`), reusing the app's one already-open WebSocket connection via
 * `getActiveWsClient()` (see `ws.ts`) rather than opening a second one.
 */
export function useChat(): UseChatResult {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const subscribedRef = useRef(false);

  const openChat = useCallback(() => {
    setOpen(true);
    if (!subscribedRef.current) {
      const ws = getActiveWsClient();
      if (!ws) return; // not connected yet (shouldn't happen once logged in) — try again next open
      subscribedRef.current = true;
      ws.setChatHandlers({
        onChatHistory(payload) {
          setMessages(payload.messages);
        },
        onChatMessage(payload) {
          setMessages((prev) => [...prev, payload.message]);
        },
      });
      ws.subscribeChat();
    }
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setExpanded(false);
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const send = useCallback((text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > CHAT_SEND_MAX_LENGTH) return false;
    const ws = getActiveWsClient();
    return ws?.sendChat(trimmed) ?? false;
  }, []);

  return { open, expanded, messages, openChat, close, toggleExpanded, send };
}
