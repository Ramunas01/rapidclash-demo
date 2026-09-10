import { describe, it, expect } from 'vitest';
import { HUB_BODY, HUB_FIXED_TOP, HUB_SHELL, HUB_SHELL_GUEST, hubBodyPadding, hubShellClass } from '../components/hub-chrome/layout.js';

// Issue #288: HUB_BODY's ~112px bottom padding exists ONLY to clear the fixed HubToolbar bottom
// nav — but that toolbar is hidden in guest mode (`{!isGuest && <HubToolbar .../>}`,
// GameHub.tsx), so applying the padding unconditionally left the guest hub with 112px of pure
// dead space (measured in PR #287: 832px total height, 720px useful content).

describe('hubBodyPadding', () => {
  it('returns the exact HUB_BODY string, unchanged, for a non-guest — pixel-identical to before the fix', () => {
    expect(hubBodyPadding(false)).toBe(HUB_BODY);
    expect(hubBodyPadding(undefined)).toBe(HUB_BODY);
  });

  it('returns no padding at all for a guest — the toolbar it exists to clear is never rendered there', () => {
    expect(hubBodyPadding(true)).toBe('');
  });

  it("HUB_BODY's bottom clearance is exactly 112px (7rem at the standard 16px root font-size) — matches PR #287's real-browser measurement of the guest hub's dead space (832px total minus 720px useful content)", () => {
    expect(HUB_BODY).toBe('pb-[calc(7rem_+_env(safe-area-inset-bottom))]');
    const ROOT_FONT_SIZE_PX = 16;
    const REM_COMPONENT = 7;
    expect(REM_COMPONENT * ROOT_FONT_SIZE_PX).toBe(112);
  });
});

// Issue #292 / SEAM-001: the guest surface is embedded via iframe by a separate marketing site
// sizing its desktop handset-mockup cutout to a real device viewport. Post-#288, the guest hub's
// real content settles at 720px, leaving a gap at the bottom of whatever taller viewport the
// embedding page allocates — `min-h-[100dvh]` alone doesn't close it (see HUB_SHELL_GUEST's
// jsdoc in layout.ts for why: `dvh`'s dynamic-recompute channel is wired around top-level UA
// chrome an iframe doesn't have, where static `vh`/`lvh` reliably resolves to the iframe's own
// viewport box regardless of nesting).
// Issue #446: MenuOverlay is a `fixed inset-0` layer outside normal document flow, so it can't
// inherit the free spacing an in-flow hub screen gets automatically beneath the sticky HubRibbon
// — it previously hardcoded a flat `pt-[130px]` transcribed from the design mock's own coordinate
// space rather than derived from HubRibbon's real rendered height, and never accounted for
// env(safe-area-inset-top) the way HUB_BODY already does for the opposite edge.
describe('HUB_FIXED_TOP', () => {
  it("is exactly HubRibbon's real rendered height (60px, confirmed live via Playwright/Chromium — see layout.ts's jsdoc) plus env(safe-area-inset-top), mirroring HUB_BODY's own calc() pattern", () => {
    expect(HUB_FIXED_TOP).toBe('pt-[calc(60px_+_env(safe-area-inset-top))]');
  });

  it('is a calc() expression, not a flat literal — must track a real safe-area inset, not a fixed value transcribed from a mock', () => {
    expect(HUB_FIXED_TOP).toMatch(/calc\(/);
    expect(HUB_FIXED_TOP).toContain('env(safe-area-inset-top)');
    expect(HUB_FIXED_TOP).not.toBe('pt-[130px]');
  });
});

describe('hubShellClass', () => {
  it('returns the exact HUB_SHELL string, unchanged, for a non-guest — pixel-identical to before the fix', () => {
    expect(hubShellClass(false)).toBe(HUB_SHELL);
    expect(hubShellClass(undefined)).toBe(HUB_SHELL);
  });

  it('returns the HUB_SHELL_GUEST variant for a guest', () => {
    expect(hubShellClass(true)).toBe(HUB_SHELL_GUEST);
  });

  it('HUB_SHELL_GUEST differs from HUB_SHELL ONLY in the viewport-height unit (dvh → vh) — nothing else about the guest shell changes', () => {
    // Issue #491: bg-background/text-foreground → bg-[var(--rc-bg)]/text-[var(--rc-text)] (the
    // shadcn tokens carried no light override; the --rc-* set does). See layout.ts's own doc
    // comment above HUB_SHELL for why this shared shell needed the same token swap the three
    // per-screen light-threading tickets gave their own content.
    expect(HUB_SHELL).toBe('relative min-h-[100dvh] bg-[var(--rc-bg)] text-[var(--rc-text)]');
    expect(HUB_SHELL_GUEST).toBe('relative min-h-[100vh] bg-[var(--rc-bg)] text-[var(--rc-text)]');
    expect(HUB_SHELL_GUEST.replace('100vh', '100dvh')).toBe(HUB_SHELL);
  });
});
