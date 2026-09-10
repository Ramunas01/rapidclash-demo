# Handoff: RapidClash Bottom Navigation Bar

## Overview
The **floating bottom navigation bar** of the RapidClash mobile app — a rounded pill that sits above the content, stays fixed while the page scrolls, and is present on every screen (Games, Rewards, Account, Preferences, Affiliate, and behind the Menu overlay).

It has five items: **Menu**, **Games**, **Account**, **Rewards**, **Chat** (Chat is a disabled placeholder). Around it sits a small stack of layers that hide content passing underneath and blend the pill into the page — that stack is the part most easily missed when reimplementing.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing the intended look and behavior. They are **not production code to copy directly**.

Recreate the design in the target codebase's existing environment (React, React Native, Vue, SwiftUI, native, etc.) using its own components and patterns. If no environment exists yet, choose the most appropriate framework.

`Navbar.dc.html` opens directly in any browser. It is a prototype on a small template runtime (`support.js`): `<sc-if>` = conditional, `<sc-for>` = loop, `{{ name }}` = value from `renderVals()` in the script block at the bottom. All styling is **inline**, so every value is visible where it is used.

## Fidelity
**High-fidelity.** Final geometry, colors, shadows and states.

---

## Anatomy

All layers are absolutely positioned inside the 390 x 844 app viewport, measured from the bottom. Stacking order matters — list is bottom-most first.

| # | Layer | Geometry | Style | Purpose |
| --- | --- | --- | --- | --- |
| 1 | Scroll fade | `bottom: 105px`, full width, height 62px, `z-index: 7`, `pointer-events: none` | `linear-gradient(to top, var(--rc-bg) 0%, transparent 100%)` | content dissolves into the background as it scrolls under the bar |
| 2 | Solid mask | `bottom: 64px`, full width, height 41px, `z-index: 7` | `background: var(--rc-bg)` | opaque band beneath the pill so nothing shows between pill and browser chrome |
| 3 | **Nav pill** | `bottom: 74px`, `left/right: 14px`, `z-index: 7` | `background: var(--rc-surface)`; `border-radius: 26px`; `padding: 12px 6px`; `box-shadow: 0 -6px 18px rgba(0,0,0,0.45), 0 -1px 0 rgba(255,255,255,0.06)` | the bar itself |
| 4 | Toast slot | `bottom: 164px`, centered, `z-index: 9`, `pointer-events: none` | purple pill `#8B45F0`, radius 999px, `padding: 11px 20px`, `box-shadow: 0 8px 20px rgba(0,0,0,0.4)` | confirmation messages appear directly above the bar |
| 5 | Browser chrome strip | `bottom: 0`, height 64px, `z-index: 8` | `#0A0A0C` with a `#1C1C1F` 38px address pill | **prototype dressing only** — mimics the mobile browser UI; do not implement |

### The shadow treatment (the recent change)
```css
box-shadow:
  0 -6px 18px rgba(0, 0, 0, 0.45),   /* upward cast shadow, lifts the pill off the content */
  0 -1px 0 rgba(255, 255, 255, 0.06); /* 1px top highlight, defines the edge */
```
Both offsets are **negative on Y** — the light reads as coming from below the screen, so the shadow falls upward onto the content behind. Combined with layers 1 and 2, the pill looks like it floats above the page rather than sitting in a docked tab bar.

### Item anatomy
Each of the five items: `flex: 1 1 0`, column layout, `align-items: center`, `gap: 6px`, `cursor: pointer`.
- Icon: 24 x 24 inline SVG, `fill` bound to that item's state color
- Label: Arial bold, 12px, `letter-spacing: 0.6px`, same color as the icon
- The "Rewards" label carries `margin-left: 3px` to optically center it under its off-axis gift icon
- Full item height (icon + gap + label + pill padding) is ~62px, so every hit target clears the 44px minimum

### Icons
- **Menu** — three 17 x 3.1px rounded bars (rx 1.55) at y 5.6 / 10.5 / 15.4
- **Games** — RapidClash bolt mark (large inline path, viewBox `0 0 351 374`)
- **Account** — 4r circle at (12, 7.5) plus a shoulders path
- **Rewards** — gift box with a bow rotated `-9deg` around (12, 8)
- **Chat** — speech bubble, permanently `--rc-muted`

---

## Design Tokens

| Token | Dark (default) | Light |
| --- | --- | --- |
| `--rc-bg` (fade + mask) | `#0B0B0B` | `#FFFFFF` |
| `--rc-surface` (pill) | `#1A1A2E` | `#E9E9F0` |
| `--rc-muted` (inactive item) | `#83838F` | `#6E6E7A` |

- Active item color: `#8B45F0` (fixed in both themes)
- Toast background: `#8B45F0`, label white, 12px bold, `letter-spacing: 0.8px`

The pill's shadow values do **not** change between themes.

## States & Behavior

| Item | Active when | Action |
| --- | --- | --- |
| Menu | the menu overlay is open | toggles the overlay; also closes any open bottom sheet |
| Games | `view === 'games'` | navigates and resets scroll to top |
| Account | `view` is `'account'`, `'prefs'` **or** `'affiliates'` | navigates to Account |
| Rewards | `view === 'rewards'` | navigates |
| Chat | never | inert placeholder, always `--rc-muted` |

Notes:
- Account stays highlighted across its whole branch (Account → Preferences → Affiliate), so the user never loses their place.
- Any nav tap closes the Menu overlay and the create-campaign sheet.
- The pill sits **above** overlays that slide up from the bottom (bottom sheets stop below it) but **below** the Menu overlay's circular reveal, whose clip-path originates at `(55px, 797px)` — the Menu item itself.
- Navigating resets the scroll container to top.

**Toast:** shown for copy/confirm actions. Fades in (opacity 0 → 1, 220ms ease) while translating `22px → 0` (260ms `cubic-bezier(0.22, 1, 0.36, 1)`), then auto-dismisses.

## State Management

| State | Type | Purpose |
| --- | --- | --- |
| `view` | string | which screen is showing, drives item colors |
| `menuOpen` | boolean | Menu overlay + Menu item highlight |
| `createOpen` | boolean | bottom sheet; force-closed by any nav tap |
| `toast`, `toastMsg` | boolean, string | toast pill above the bar |
| `light` | boolean | theme tokens |

## Implementation notes

- In a real app, replace layer 5 (the fake browser chrome) with the platform's safe-area inset and anchor the pill to `env(safe-area-inset-bottom) + 10px`.
- Keep layers 1 and 2: without the gradient fade, content collides hard with the pill's top edge; without the solid mask, content shows through beneath it.
- The pill spans the full width minus 14px per side — it is not a floating island with equal margins on all sides.

## Files

- `Navbar.dc.html` — the full app prototype; the nav bar is the block at `bottom: 74px` near the end of the template, with its companion layers immediately above it. Colors come from `navMenuColor`, `navGamesColor`, `navAccountColor`, `navRewardsColor` in `renderVals()`.
- `support.js`, `image-slot.js` — prototype runtime, not part of the implementation.
- `assets/` — images used by the surrounding screens; the nav bar itself uses only inline SVG.

## Screenshots

`screenshots/` shows the bar in its four active states (device frame included, dark theme), with the app shifted up so the bar and its shadow are in frame:

- `nav-01-games-active.png`
- `nav-02-menu-active.png`
- `nav-03-account-active.png`
- `nav-04-rewards-active.png`
