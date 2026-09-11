import { useEffect, useState, type KeyboardEvent } from 'react';
import type { ChatMessage, VipTier } from '@rapidclash/shared';
import { CHAT_DRAFT_MAX_LENGTH, CHAT_SEND_MAX_LENGTH } from './useChat.js';

interface Props {
  open: boolean;
  /** Half-height (top:52%) vs full-height (top:60px) — `Full Spec.html:4059`. */
  expanded: boolean;
  messages: ChatMessage[];
  onClose(): void;
  onToggleExpanded(): void;
  /** `useChat.ts`'s own `send` — validates (non-empty, ≤160 chars) and returns whether it was
   *  actually sent. The composer clears its local draft only on a truthy return. */
  onSend(text: string): boolean;
}

/* ── @mention regexes (ticket 2026-09-11#7b's own "read this twice" gotcha) ──────────────────
 * TWO DIFFERENT regexes for two different moments — never collapse them into one:
 *  - LIVE (while typing, composer overlay): only commits a mention as a "complete" pill once
 *    followed by whitespace — `Full Spec.html:4074`, verbatim `/(@[A-Za-z0-9_]+(?=\s))/`.
 *  - SENT (already-sent messages): no trailing-space requirement — a sent message's mentions are
 *    already complete — `Full Spec.html:4128`, verbatim `/(@[A-Za-z0-9_]+)/`.
 */
const LIVE_MENTION_RE = /(@[A-Za-z0-9_]+(?=\s))/;
const SENT_MENTION_RE = /(@[A-Za-z0-9_]+)/;

interface TextPart {
  isPill: boolean;
  txt: string;
}

/** Composer-overlay parts (`chatDraftParts`, `Full Spec.html:4074`) — a completed `@mention`
 *  token (>1 char) becomes a pill rendered with its literal `@` text, everything else is plain
 *  text. Uses the LIVE regex. */
function draftParts(text: string): TextPart[] {
  return text
    .split(LIVE_MENTION_RE)
    .filter(Boolean)
    .map((t) => ({ isPill: /^@[A-Za-z0-9_]+$/.test(t) && t.length > 1, txt: t }));
}

/** Sent-message parts (`Full Spec.html:4128`) — uses the SENT regex, and (unlike the draft
 *  overlay) a pill's displayed text drops the `@` and upper-cases the handle:
 *  `t.slice(1).toUpperCase()`, verbatim from the prototype's own `.map`. */
function sentParts(text: string): TextPart[] {
  return text
    .split(SENT_MENTION_RE)
    .filter(Boolean)
    .map((t) => (t.startsWith('@') && t.length > 1 ? { isPill: true, txt: t.slice(1).toUpperCase() } : { isPill: false, txt: t }));
}

/** Name color per VIP tier (`nameColor`, `Full Spec.html:4134`) — only Gold/Emerald/Diamond get
 *  real colors, everything else (Wood/Bronze/Silver/Unranked) falls through to the plain default
 *  text color. The prototype's own ternary also branches on a `m.mod` (moderator) flag first —
 *  omitted here because the server's `ChatMessage` (`packages/shared/src/protocol.ts`) carries no
 *  `mod`/moderator field to reproduce that branch from; only the 3-tier color ternary applies. */
function nameColor(tier: VipTier): string {
  if (tier === 'Gold') return '#F2C744';
  if (tier === 'Emerald') return 'var(--rc-green)';
  if (tier === 'Diamond') return '#5CD3F0';
  return 'var(--rc-text)';
}

const TEXT_FONT = "'Inter Tight', Arial, Helvetica, sans-serif";
const TRANSFORM_TRANSITION =
  'transform 420ms cubic-bezier(0.22,0.61,0.36,1), top 380ms cubic-bezier(0.22,0.61,0.36,1), opacity 260ms ease';

/**
 * The chat bottom sheet (ticket 2026-09-11#7b) — rebuilt against `Full Spec.html`'s chat block
 * (`:2358-2448`). `useChat.ts` owns the cross-cutting subscribe/open/close/half-toggle/send/
 * message-list state; this component only renders it, same split as `useMenuOverlay.ts`/
 * `MenuOverlay.tsx`.
 *
 * **Room scope (2026-09-11#6/#7 decision): general-only for V1.** The prototype's room-switcher
 * pill (`:2364-2380`) toggles between a General/Chess room list via a collapsible chevron; since
 * there's only one room for V1 (no room parameter in the wire protocol at all), this keeps the
 * pill's icon+label chrome for visual fidelity to the citation but drops the chevron/dropdown
 * entirely — there is nothing to switch to. (Stated explicitly in the PR body per the ticket's
 * request.)
 *
 * Always mounted (never conditionally unmounted on `open`), same reasoning as `MenuOverlay`: the
 * 420ms transform transition needs a real "from" frame to animate out of. Inner content
 * (messages/composer) is lazy-mounted only after the first open.
 */
export function ChatSheet({ open, expanded, messages, onClose, onToggleExpanded, onSend }: Props) {
  const [everOpened, setEverOpened] = useState(open);
  useEffect(() => {
    if (open) setEverOpened(true);
  }, [open]);

  const [draft, setDraft] = useState('');

  // The scrim only shows in FULL height mode (`chatScrimOp`, `Full Spec.html:4057-4058`) — half
  // height deliberately leaves the rest of the screen visible/interactive underneath.
  const scrimVisible = open && !expanded;
  const sheetTop = expanded ? '52%' : '60px';
  const sheetPadBottom = expanded ? '140px' : '152px';
  const sheetPadTop = expanded ? '9px' : '14px';
  const pillPad = expanded ? '6px 14px' : '9px 16px';
  const btnH = expanded ? '32px' : '38px';

  const overLimit = draft.length > CHAT_SEND_MAX_LENGTH;

  function commitSend() {
    const ok = onSend(draft);
    if (ok) setDraft('');
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSend();
    }
  }

  function handleDraftChange(value: string) {
    // Draft cap — `Full Spec.html:4091`'s own `.slice(0, 400)`.
    setDraft(value.slice(0, CHAT_DRAFT_MAX_LENGTH));
  }

  return (
    <>
      {/* Backdrop/scrim — `:2360`: z-index 6, rgba(0,0,0,0.55), 320ms ease opacity. */}
      <div
        aria-hidden={!scrimVisible}
        data-testid="chat-scrim"
        onClick={onClose}
        className="fixed inset-0"
        style={{
          zIndex: 6,
          background: 'rgba(0,0,0,0.55)',
          opacity: scrimVisible ? 1 : 0,
          transition: 'opacity 320ms ease',
          pointerEvents: scrimVisible ? 'auto' : 'none',
        }}
      />

      {/* Sheet body — `:2362`. */}
      <div
        data-testid="chat-sheet"
        aria-hidden={!open}
        className="fixed left-3 right-3 bottom-0 flex flex-col"
        style={{
          top: sheetTop,
          zIndex: 7,
          background: 'var(--rc-surface)',
          borderRadius: '34px 34px 0 0',
          boxShadow: '0 18px 44px rgba(0,0,0,0.45)',
          padding: `${sheetPadTop} 12px ${sheetPadBottom} 12px`,
          boxSizing: 'border-box',
          fontFamily: TEXT_FONT,
          transform: open ? 'translateY(0)' : 'translateY(118%)',
          opacity: open ? 1 : 0,
          transition: TRANSFORM_TRANSITION,
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {everOpened && (
          <>
            {/* Header: room pill (general-only, no dropdown — see doc comment above) + half/full
                toggle + close. `:2364-2380`. */}
            <div className="flex flex-none items-center justify-between pr-1.5">
              <div
                className="flex items-center gap-[9px] rounded-full"
                style={{ background: 'var(--rc-island)', padding: pillPad }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="var(--rc-text)" aria-hidden="true">
                  <path d="M5.4 4h13.2A2.4 2.4 0 0 1 21 6.4v7.8a2.4 2.4 0 0 1-2.4 2.4H9.8L5.2 20.4A.7.7 0 0 1 4 19.8V6.4A2.4 2.4 0 0 1 5.4 4z" />
                </svg>
                <span
                  style={{
                    fontFamily: 'Arial, Helvetica, sans-serif',
                    fontSize: '15px',
                    fontWeight: 'bold',
                    letterSpacing: '0.8px',
                    color: 'var(--rc-text)',
                  }}
                >
                  GENERAL CHAT
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  data-testid="chat-half-toggle"
                  aria-label={expanded ? 'Expand chat' : 'Collapse chat'}
                  onClick={onToggleExpanded}
                  className="flex items-center justify-center"
                  style={{ width: '38px', height: btnH }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--rc-text)" strokeWidth={2.8} strokeLinecap="round" aria-hidden="true">
                    <path d="M5 12h14" />
                  </svg>
                </button>
                <button
                  type="button"
                  data-testid="chat-close"
                  aria-label="Close chat"
                  onClick={onClose}
                  className="flex items-center justify-center"
                  style={{ width: '38px', height: btnH }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--rc-text)" strokeWidth={2.8} strokeLinecap="round" aria-hidden="true">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Message list. */}
            <div className="relative mt-2 min-h-0 flex-1">
              <div
                data-testid="chat-messages"
                className="absolute inset-0 flex flex-col gap-[7px] overflow-y-auto px-0 py-1.5"
              >
                {messages.map((m) => (
                  <ChatBubble key={m.id} message={m} />
                ))}
              </div>
            </div>

            {/* Composer — the transparent-textarea-over-styled-overlay trick, `:2427-2428`. */}
            <div
              data-testid="chat-composer-root"
              className="mt-2.5 flex flex-none items-center gap-2.5"
              style={{
                background: 'linear-gradient(rgba(150,150,175,0.16), rgba(150,150,175,0.16)), var(--rc-island)',
                borderRadius: '26px',
                padding: '8px 8px 8px 18px',
                minHeight: '52px',
                boxSizing: 'border-box',
                boxShadow: overLimit ? 'inset 0 0 0 1.5px #FF4D4D' : 'none',
              }}
            >
              <div className="relative min-w-0 flex-1">
                {/* `:2427` — aria-hidden overlay rendering the same text with @mention pills
                    styled in. Must stay pixel-aligned with the real textarea below: same
                    font-family/font-size/line-height/padding. */}
                <div
                  aria-hidden="true"
                  data-testid="chat-composer-overlay"
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                  style={{
                    fontFamily: TEXT_FONT,
                    fontSize: '15px',
                    lineHeight: '22px',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'break-word',
                    color: 'var(--rc-text)',
                  }}
                >
                  {draft.length === 0 ? (
                    <span style={{ color: 'var(--rc-muted)' }}>Your message</span>
                  ) : (
                    draftParts(draft).map((p, i) =>
                      p.isPill ? (
                        <span
                          key={i}
                          style={{ background: 'var(--rc-surface)', borderRadius: '7px', padding: '3px 8px', margin: '0 -8px' }}
                        >
                          {p.txt}
                        </span>
                      ) : (
                        <span key={i}>{p.txt}</span>
                      ),
                    )
                  )}
                </div>
                {/* `:2428` — the real textarea: transparent text, real caret. What's actually
                    focused/typed into. */}
                <textarea
                  rows={1}
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  data-testid="chat-composer-textarea"
                  aria-label="Chat message"
                  className="relative block w-full resize-none overflow-y-auto border-none bg-transparent p-0 outline-none"
                  style={{
                    boxSizing: 'border-box',
                    height: '22px',
                    maxHeight: '112px',
                    fontFamily: TEXT_FONT,
                    fontSize: '15px',
                    lineHeight: '22px',
                    color: 'transparent',
                    caretColor: 'var(--rc-text)',
                  }}
                />
              </div>
              <button
                type="button"
                data-testid="chat-send-button"
                aria-label="Send"
                onClick={commitSend}
                disabled={!draft.trim() || overLimit}
                className="flex flex-none items-center justify-center rounded-full disabled:opacity-40"
                style={{ width: '32px', height: '32px', background: '#8B45F0' }}
              >
                <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5.4v13.2M5.4 12h13.2" />
                </svg>
              </button>
            </div>

            {overLimit && (
              <div
                data-testid="chat-over-limit-warning"
                className="mt-2 flex-none px-[18px]"
                style={{ fontSize: '13px', lineHeight: '18px', color: '#FF4D4D' }}
              >
                Character limit of {CHAT_SEND_MAX_LENGTH} reached ({draft.length})
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const parts = sentParts(message.text);
  return (
    <div
      data-testid={`chat-message-${message.id}`}
      style={{
        background: 'linear-gradient(rgba(139,69,240,0.14), rgba(139,69,240,0.14)), var(--rc-island)',
        borderRadius: '20px',
        padding: '11px 14px',
      }}
    >
      <span style={{ fontSize: '15px', lineHeight: '22px', color: 'var(--rc-text)', overflowWrap: 'break-word' }}>
        <span style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '15px', fontWeight: 'bold', color: nameColor(message.tier) }}>
          {message.name}:
        </span>{' '}
        {parts.map((p, i) =>
          p.isPill ? (
            <span
              key={i}
              style={{
                display: 'inline-block',
                background: 'var(--rc-surface)',
                borderRadius: '7px',
                padding: '2px 8px',
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: '11.5px',
                fontWeight: 'bold',
                letterSpacing: '0.6px',
                color: 'var(--rc-text)',
              }}
            >
              {p.txt}
            </span>
          ) : (
            <span key={i}>{p.txt}</span>
          ),
        )}
      </span>
    </div>
  );
}
