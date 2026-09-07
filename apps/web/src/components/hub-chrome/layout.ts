/**
 * Shared layout for a hub on BODY scroll (#142). The shell no longer owns a fixed-height
 * inner scroll surface — the document body scrolls, which is what lets iOS Safari collapse and
 * return its toolbar. HubRibbon is `position: sticky; top: 0` (in-flow at the top, so it owns
 * the top clearance); HubToolbar stays `position: fixed` at the bottom. Content runs
 * top-to-bottom and slides behind the transparent bars (matching the design frame).
 *
 *   <div className={HUB_SHELL}>
 *     <HubRibbon … />                                  // sticky top (in-flow)
 *     <main data-testid="…"><div className={cn('…', HUB_BODY)}>…</div></main>
 *     <HubToolbar … />                                 // fixed bottom
 *   </div>
 *
 * HUB_BODY pads the content so the last item clears the fixed toolbar (the nav pill ~84px +
 * the bottom safe-area) and nothing is ever hidden behind it. There is no top pad: the
 * sticky ribbon is in-flow, so it already reserves the ~96px wordmark band itself.
 */
export const HUB_SHELL = 'relative min-h-[100dvh] bg-background text-foreground';
export const HUB_BODY = 'pb-[calc(7rem_+_env(safe-area-inset-bottom))]';

/**
 * Top clearance for a `fixed inset-0` hub screen (e.g. `MenuOverlay`) that sits outside normal
 * document flow and so can't inherit the free spacing an in-flow screen gets automatically
 * beneath the sticky `HubRibbon` (see `HUB_BODY`'s own note above for the bottom-clearance
 * equivalent). `60px` is `HubRibbon`'s own real rendered height before any safe-area inset —
 * confirmed live (issue #446) by rendering `HubRibbon` in a real Chromium instance (Playwright,
 * 390x844 viewport) and reading `getBoundingClientRect().height` on its `<header>`: exactly 60px
 * with `env(safe-area-inset-top)` at 0. That matches the box model directly: the header itself
 * carries no fixed padding beyond `pt-[env(safe-area-inset-top)]`; its inner row has no top
 * padding, `pb-4` (16px) on the bottom, and its tallest child is the wallet chip (`py-1.5` wrapping
 * the "Wallet" pill's own `py-2` + text-xs line-height, ≈44px) — 44px content + 16px `pb-4` = 60px.
 * `env(safe-area-inset-top)` is added on top, mirroring exactly how `HUB_BODY` adds
 * `env(safe-area-inset-bottom)` for the opposite edge. Use this instead of a flat literal so a
 * future fixed-overlay screen doesn't drift out of sync with `HubRibbon` the way `MenuOverlay` did.
 */
export const HUB_FIXED_TOP = 'pt-[calc(60px_+_env(safe-area-inset-top))]';

/**
 * Guest variant of `HUB_SHELL` (issue #292 / SEAM-001): `min-h-[100vh]` instead of
 * `min-h-[100dvh]`. Only the unit differs — everything else is byte-identical to `HUB_SHELL`, so
 * the non-guest hub (which keeps using the plain constant) is provably unaffected.
 *
 * Why `dvh` doesn't already cover this — the guest surface is loaded in an iframe embedded by a
 * separate marketing site (`rapidclash-landing`), sized to a real device viewport for a
 * handset-mockup cutout. `HUB_SHELL` already had `min-h-[100dvh]` before this fix, which on the
 * face of it should fill "the viewport" regardless of nesting — but `dvh` and `vh` are NOT the
 * same kind of quantity, and the difference is what leaves a gap here:
 *   - `vh` (and the `lvh` it's currently defined to equal per the CSS Values and Units spec) is a
 *     static read of "how tall is my own viewport" — computed once against the current browsing
 *     context's viewport, with no ongoing tracking machinery required. A nested browsing context
 *     (an iframe) has its own viewport equal to its content box, and a static unit resolves
 *     against THAT box correctly and unambiguously.
 *   - `dvh` is explicitly a *dynamic* quantity: the spec defines it as continuously
 *     re-resolving in response to a UA interface (address bar, etc.) "dynamically expanding and
 *     retracting." That UA chrome exists only at the outermost/top-level browsing context — an
 *     iframe has no independent browser chrome of its own to show or hide. Implementations vary
 *     in how (or whether) they wire up `dvh`'s live-recompute channel for a nested context that
 *     has no such chrome to observe, so in practice `dvh` inside an iframe is the more
 *     failure-prone unit — it can resolve once at initial layout and then not track the iframe's
 *     actual allocated box the way a plain, static `vh`/`lvh` read reliably does.
 * No headless browser was available in this environment to reproduce the gap live (see PR #290's
 * same caveat) — this is grounded in the CSS Values and Units spec / MDN's viewport-unit
 * semantics, not a captured screenshot. Use `hubShellClass(isGuest)` below rather than reaching
 * for either constant directly.
 */
export const HUB_SHELL_GUEST = 'relative min-h-[100vh] bg-background text-foreground';

/**
 * Picks the guest or non-guest `HUB_SHELL` variant (see `HUB_SHELL_GUEST` above for why guest
 * needs `vh` instead of `dvh`). Mirrors `hubBodyPadding`'s isGuest-branch shape — non-guest (or
 * `undefined`) returns the bare `HUB_SHELL` constant unchanged, so that path is byte-identical to
 * before this fix.
 */
export function hubShellClass(isGuest?: boolean): string {
  return isGuest ? HUB_SHELL_GUEST : HUB_SHELL;
}

/**
 * `HUB_BODY`'s ~112px clearance exists ONLY to keep content from hiding behind the fixed
 * `HubToolbar` — guest mode never renders that toolbar (`GameHub.tsx`: `{!isGuest &&
 * <HubToolbar .../>}`), so reserving space for it there is pure dead space (issue #288: measured
 * at 832px total guest hub height, 112px of which was this). Use this wherever a hub screen can
 * be guest-facing (today, just `GameHub.tsx`) instead of the bare `HUB_BODY` constant. Screens
 * that can never render for a guest (Home, Profile) keep using `HUB_BODY` directly — the
 * toolbar's always there for them, so the clearance is never dead space.
 */
export function hubBodyPadding(isGuest?: boolean): string {
  return isGuest ? '' : HUB_BODY;
}
