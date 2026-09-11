// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChatMessage, VipTier } from '@rapidclash/shared';
import { ChatSheet } from '../components/hub-chrome/ChatSheet.js';

function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: '1', name: 'alice', tier: 'Unranked', text: 'hello', createdAt: 0, ...overrides };
}

/** jsdom's CSSOM normalizes an inline hex color to its `rgb(...)` form when read back via
 *  `.style.color` (it does NOT do this for composite values like `background`/`box-shadow`,
 *  which are compared against their literal source strings elsewhere in this file) — these are
 *  simply the rgb equivalents of the tier hex literals cited from `Full Spec.html:4134`. */
const GOLD_RGB = 'rgb(242, 199, 68)'; // #F2C744
const DIAMOND_RGB = 'rgb(92, 211, 240)'; // #5CD3F0

function renderSheet(overrides: Partial<React.ComponentProps<typeof ChatSheet>> = {}) {
  const onClose = vi.fn();
  const onToggleExpanded = vi.fn();
  const onSend = vi.fn().mockReturnValue(true);
  const props = {
    open: true,
    expanded: false,
    messages: [] as ChatMessage[],
    onClose,
    onToggleExpanded,
    onSend,
    ...overrides,
  };
  const utils = render(<ChatSheet {...props} />);
  return { ...utils, onClose, onToggleExpanded, onSend };
}

describe('ChatSheet — sheet shell transforms (Full Spec.html:2358-2363)', () => {
  it('closed: translateY(118%), opacity 0, pointer-events none', () => {
    renderSheet({ open: false });
    const sheet = screen.getByTestId('chat-sheet');
    expect(sheet.style.transform).toBe('translateY(118%)');
    expect(sheet.style.opacity).toBe('0');
    expect(sheet.style.pointerEvents).toBe('none');
  });

  it('open: translateY(0), opacity 1, pointer-events auto', () => {
    renderSheet({ open: true });
    const sheet = screen.getByTestId('chat-sheet');
    expect(sheet.style.transform).toBe('translateY(0)');
    expect(sheet.style.opacity).toBe('1');
    expect(sheet.style.pointerEvents).toBe('auto');
  });

  it('full height: top 60px; half height: top 52%', () => {
    const { rerender } = renderSheet({ open: true, expanded: false });
    expect(screen.getByTestId('chat-sheet').style.top).toBe('60px');
    rerender(
      <ChatSheet open expanded messages={[]} onClose={vi.fn()} onToggleExpanded={vi.fn()} onSend={vi.fn()} />,
    );
    expect(screen.getByTestId('chat-sheet').style.top).toBe('52%');
  });

  it('carries the cited transition timings/easing (420ms transform, 380ms top, 260ms opacity)', () => {
    renderSheet({ open: true });
    const transition = screen.getByTestId('chat-sheet').style.transition;
    expect(transition).toContain('transform 420ms cubic-bezier(0.22,0.61,0.36,1)');
    expect(transition).toContain('top 380ms cubic-bezier(0.22,0.61,0.36,1)');
    expect(transition).toContain('opacity 260ms ease');
  });

  it('shell carries the cited border-radius and box-shadow', () => {
    renderSheet({ open: true });
    const sheet = screen.getByTestId('chat-sheet');
    expect(sheet.style.borderRadius).toBe('34px 34px 0 0');
    expect(sheet.style.boxShadow).toBe('0 18px 44px rgba(0,0,0,0.45)');
  });

  it('scrim is z-index 6, rgba(0,0,0,0.55), shown only in FULL height (not half)', () => {
    renderSheet({ open: true, expanded: false });
    let scrim = screen.getByTestId('chat-scrim');
    expect(scrim.style.zIndex).toBe('6');
    expect(scrim.style.background).toBe('rgba(0, 0, 0, 0.55)');
    expect(scrim.style.opacity).toBe('1');
    expect(scrim.style.pointerEvents).toBe('auto');

    const { unmount } = render(
      <ChatSheet open expanded messages={[]} onClose={vi.fn()} onToggleExpanded={vi.fn()} onSend={vi.fn()} />,
    );
    scrim = screen.getAllByTestId('chat-scrim')[1];
    expect(scrim.style.opacity).toBe('0'); // hidden while half-height
    expect(scrim.style.pointerEvents).toBe('none');
    unmount();
  });

  it('sheet body is z-index 7', () => {
    renderSheet({ open: true });
    expect(screen.getByTestId('chat-sheet').style.zIndex).toBe('7');
  });
});

describe('ChatSheet — close / half-toggle controls', () => {
  it('close button fires onClose', () => {
    const { onClose } = renderSheet({ open: true });
    fireEvent.click(screen.getByTestId('chat-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('half-toggle button fires onToggleExpanded', () => {
    const { onToggleExpanded } = renderSheet({ open: true });
    fireEvent.click(screen.getByTestId('chat-half-toggle'));
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it('clicking the scrim fires onClose', () => {
    const { onClose } = renderSheet({ open: true, expanded: false });
    fireEvent.click(screen.getByTestId('chat-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ChatSheet — name color per VIP tier (Full Spec.html:4134, only Gold/Emerald/Diamond colored)', () => {
  const cases: [VipTier, string | null][] = [
    ['Gold', GOLD_RGB],
    ['Emerald', 'var(--rc-green)'],
    ['Diamond', DIAMOND_RGB],
    ['Wood', null],
    ['Bronze', null],
    ['Silver', null],
    ['Unranked', null],
  ];

  for (const [tier, expected] of cases) {
    it(`${tier} → ${expected ?? 'plain default text color'}`, () => {
      const m = msg({ id: `tier-${tier}`, tier, name: 'Player' });
      renderSheet({ messages: [m] });
      const bubble = screen.getByTestId(`chat-message-${m.id}`);
      const nameSpan = bubble.querySelector('span > span'); // outer text span > name span
      expect(nameSpan?.textContent).toBe('Player:');
      const color = (nameSpan as HTMLElement).style.color;
      if (expected) {
        expect(color).toBe(expected);
      } else {
        expect(color).toBe('var(--rc-text)');
      }
    });
  }
});

describe('ChatSheet — @mention pills: TWO DIFFERENT regexes for two different moments', () => {
  it('SENT-message rendering (Full Spec.html:4128): pill renders WITHOUT a trailing-space requirement, text uppercased and @ stripped', () => {
    const m = msg({ text: 'hey @bob check this out' }); // no trailing space after @bob — still a complete pill
    renderSheet({ messages: [m] });
    const bubble = screen.getByTestId(`chat-message-${m.id}`);
    expect(bubble.textContent).toContain('BOB');
    expect(bubble.textContent).not.toContain('@bob');
  });

  it('SENT-message rendering: a mention at the very end of the message (no trailing space at all) still becomes a pill', () => {
    const m = msg({ text: 'ping @carol' });
    renderSheet({ messages: [m] });
    const bubble = screen.getByTestId(`chat-message-${m.id}`);
    expect(bubble.textContent).toContain('CAROL');
  });

  it('LIVE-typing composer overlay (Full Spec.html:4074): a mention followed by whitespace becomes a pill', () => {
    renderSheet({ open: true });
    const textarea = screen.getByTestId('chat-composer-textarea');
    fireEvent.change(textarea, { target: { value: 'hey @bob check this' } });
    const overlay = screen.getByTestId('chat-composer-overlay');
    // The pill span renders the literal '@bob' token (unlike sent-message rendering, which
    // strips '@' and upper-cases it) — the two regexes/renderers are deliberately different.
    const pillSpans = Array.from(overlay.querySelectorAll('span')).filter((s) => s.textContent === '@bob');
    expect(pillSpans).toHaveLength(1);
  });

  it('LIVE-typing composer overlay: a mention with NO trailing whitespace yet (still being typed) is NOT a pill', () => {
    renderSheet({ open: true });
    const textarea = screen.getByTestId('chat-composer-textarea');
    fireEvent.change(textarea, { target: { value: 'hey @bo' } }); // still typing, no trailing space
    const overlay = screen.getByTestId('chat-composer-overlay');
    const pillSpans = Array.from(overlay.querySelectorAll('span')).filter((s) => s.textContent === '@bo');
    expect(pillSpans).toHaveLength(0); // not committed as a pill yet
    expect(overlay.textContent).toContain('hey @bo'); // still rendered as plain text
  });
});

describe('ChatSheet — char limits: 400-char draft cap, >160 warning ring, and an ACTIVE send block past 160', () => {
  it('typing past 400 chars is truncated client-side (draft cap)', () => {
    renderSheet({ open: true });
    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x'.repeat(500) } });
    expect(textarea.value).toHaveLength(400);
  });

  it('over 160 chars shows the red warning ring + message, and the send button is DISABLED (not just warned)', () => {
    renderSheet({ open: true });
    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x'.repeat(161) } });
    const composerRoot = screen.getByTestId('chat-composer-root');
    expect(composerRoot.style.boxShadow).toBe('inset 0 0 0 1.5px #FF4D4D');
    expect(screen.getByTestId('chat-over-limit-warning').textContent).toBe('Character limit of 160 reached (161)');
    expect(screen.getByTestId('chat-send-button')).toBeDisabled();
  });

  it('at or under 160 chars, no warning ring and the send button is enabled once non-empty', () => {
    renderSheet({ open: true });
    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x'.repeat(160) } });
    expect(screen.queryByTestId('chat-over-limit-warning')).toBeNull();
    expect(screen.getByTestId('chat-send-button')).not.toBeDisabled();
  });

  it('clicking Send while over 160 does nothing (onSend is never even reachable — button disabled)', () => {
    const { onSend } = renderSheet({ open: true });
    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x'.repeat(200) } });
    fireEvent.click(screen.getByTestId('chat-send-button'));
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('ChatSheet — sending', () => {
  it('Enter key sends and clears the draft on success', () => {
    const { onSend } = renderSheet({ open: true });
    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello there' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello there');
    expect(textarea.value).toBe('');
  });

  it('send button click sends the current draft', () => {
    const { onSend } = renderSheet({ open: true });
    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'via button' } });
    fireEvent.click(screen.getByTestId('chat-send-button'));
    expect(onSend).toHaveBeenCalledWith('via button');
  });

  it('draft is NOT cleared if onSend returns false (e.g. validation failed)', () => {
    const onSend = vi.fn().mockReturnValue(false);
    renderSheet({ open: true, onSend });
    const textarea = screen.getByTestId('chat-composer-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'stays' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(textarea.value).toBe('stays');
  });

  it('the send button is disabled when the draft is empty', () => {
    renderSheet({ open: true });
    expect(screen.getByTestId('chat-send-button')).toBeDisabled();
  });
});

describe('ChatSheet — message bubble styling (Full Spec.html:2400)', () => {
  it('carries the cited background gradient, border-radius, and padding', () => {
    const m = msg();
    renderSheet({ messages: [m] });
    const bubble = screen.getByTestId(`chat-message-${m.id}`);
    expect(bubble.style.background).toBe(
      'linear-gradient(rgba(139,69,240,0.14), rgba(139,69,240,0.14)), var(--rc-island)',
    );
    expect(bubble.style.borderRadius).toBe('20px');
    expect(bubble.style.padding).toBe('11px 14px');
  });
});
