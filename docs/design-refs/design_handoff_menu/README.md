# Handoff: RapidClash Menu

## Overview
The **Menu** screen of the RapidClash mobile app (iOS-sized, 390 x 844 viewport inside a 437 x 893 device frame).

The Menu is not a routed page — it is a **full-screen overlay** opened from the "Menu" item in the floating bottom navigation pill. It reveals with a circular clip-path expanding from the nav item, covers the app behind it, and dismisses when Menu is tapped again or any other nav item is chosen. It is a directory of the whole platform, grouped into six labelled sections of tappable rows.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing the intended look and behavior. They are **not production code to copy directly**.

The task is to **recreate this design in the target codebase's existing environment** (React, React Native, Vue, SwiftUI, native, etc.) using its established components, styling approach, and state patterns. If the project has no environment yet, choose the most appropriate framework and implement the design there.

`Menu Page.dc.html` opens directly in any browser (double-click it) with the menu overlay already showing. It is a prototype built on a small custom template runtime (`support.js`), where:
- `<sc-if value="{{ x }}">` is a conditional block
- `<sc-for list="{{ items }}" as="item">` is a list loop
- `{{ name }}` holes are values returned by `renderVals()` in the script block at the bottom of the file
- All styling is **inline** on the elements, so every measurement, color, and font is visible where it is used — nothing hides in a stylesheet

Read the markup for exact values; read `renderVals()` for state and behavior.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, transitions, and interaction behavior. Recreate pixel-perfectly using the codebase's own primitives.

---

## Design Tokens

Theme is switchable (set in Account → Preferences); tokens are CSS custom properties on the app root.

| Token | Dark (default) | Light |
| --- | --- | --- |
| `--rc-bg` | `#0B0B0B` | `#FFFFFF` |
| `--rc-surface` (row groups) | `#1A1A2E` | `#E9E9F0` |
| `--rc-sunken` | `#0B0B0B` | `#D3D3DD` |
| `--rc-island` (header balance pill) | `#1A1930` | `#E4E4EE` |
| `--rc-text` | `#FFFFFF` | `#0B0B0B` |
| `--rc-muted` (icons, chevrons, fine print) | `#83838F` | `#6E6E7A` |
| `--rc-green` | `#34D399` | `#0B8F5A` |

Fixed brand values:
- Purple primary `#8B45F0`; social button glow `box-shadow: 0 0 14px 2px rgba(139,69,240,0.28), 0 0 4px rgba(139,69,240,0.22)`
- Nav active color `#8B45F0`, inactive `--rc-muted`

### Typography
- **Display / labels:** Arial (Helvetica fallback), bold
- **Numerals:** `'Space Grotesk'` 700
- **Body:** `'Inter Tight'` 400–600

| Role | Spec |
| --- | --- |
| Screen headline (MENU) | 19px bold, letter-spacing 0.6px |
| Section label (GAMES, EARN, COMPETE…) | 12px bold, letter-spacing 1.4px, uppercase |
| Row label | 14px, weight 600, `--rc-text` |
| Footer column heading | 15px bold, letter-spacing 1.4px, `#8B45F0` |
| Footer link | 14px, `--rc-text` |
| Footer fine print | 12.5px / 19px, `--rc-muted`, `text-wrap: pretty` |
| "JOIN THE COMMUNITY" | 20px bold, letter-spacing 1px |
| 18+ mark | 26px Space Grotesk 700, `--rc-muted` |

### Spacing & shape
- Overlay content: 390px wide, padding `130px 16px 184px` (clears the fixed header and the floating nav pill)
- Section gap 26px; label-to-group gap 11px
- Row group: `--rc-surface`, radius 20px, `overflow: hidden` (rows share one rounded container, no dividers)
- Row: 56px tall, 18px side padding, 12px gap — 19px icon, label filling the row, 8 x 12px right triangle
- Social buttons: 46px circles, `#8B45F0`, 14px gap
- Footer link grid: 2 columns, gap `26px 12px`

### Motion
- Overlay reveal: `clip-path: circle(0px at 55px 797px) → circle(1000px at 55px 797px)`, 480ms `cubic-bezier(0.22, 0.61, 0.36, 1)` — the origin is the Menu nav item, so the panel grows out of the button it was tapped from. Closing runs the same transition in reverse. `pointer-events` toggles with the state.

---

## Screen: Menu

**Purpose:** navigate anywhere in the platform, and reach community, legal, and support material.

**Layout:** full-bleed overlay on `--rc-bg`, its own vertical scroll container. Fixed app header (logo + balance island + WALLET pill) and the floating bottom nav pill stay above the overlay and remain visible.

Order of blocks:

1. **"MENU" headline** — 19px bold.
2. **GAMES** group — *RapidClash Originals* (bolt icon), *Card games* (spade), *Chance games* (dice-face), *Skill games* (target).
3. **EARN** group — *Affiliate program* (two people, navigates to the Affiliate section and closes the menu), *Rewards/VIP* (gift box, navigates to Rewards and closes the menu).
4. **COMPETE** group — *24H race* (stopwatch), *Weekly race* (calendar), *Leaderboards* (bar chart), *Tournaments* (trophy).
5. **PLATFORM** group — *How it works* (info), *Provably fair* (shield-check), *Fees & rake* (link), *Game rules* (document).
6. **SUPPORT** group — *Help center* (question mark), *Contact us* (speech bubble), *Responsible gaming* (shield with bolt).
7. **Footer block** — sits on `--rc-surface` with a gradient transition from the page background above it:
   - RapidClash logo, 140px wide (white or dark asset depending on theme)
   - "JOIN THE COMMUNITY" + four 46px purple circular social buttons (Discord, X, Telegram, Instagram) with the purple glow
   - Four-column-in-two-rows link grid: PLATFORM (Games, Tournaments, Rewards/VIP, Leaderboards), FAIRNESS (How it works, Provably fair, Fees & rake, Game rules), SUPPORT (Help center, Contact us, Responsible gaming, Complaint form), LEGAL (Terms of Service, Privacy Policy, AML Policy, Responsible Gaming Policy)
   - Disclaimer: "RapidClash is a play-money demo for players aged 18 and over. Credits have no real-world value. Play responsibly, set limits, and take breaks."
   - Copyright: "© 2026 RapidClash. All rights reserved." / "Players vs Players, Never the House."
   - Purple bolt mark (`assets/bolt-purple.png`, 28px) + "18+"

Every row and footer link is `cursor: pointer`. In the prototype only *Affiliate program*, *Rewards/VIP*, *Games* and *Rewards/VIP* (footer) navigate; the rest are placeholders for real routes.

## Interactions & Behavior

- **Open:** tapping Menu in the bottom nav sets `menuOpen` and runs the circular clip-path reveal; the Menu nav icon turns `#8B45F0`.
- **Close:** tapping Menu again, or any other nav item, clears `menuOpen`. Choosing a destination row also closes the menu and resets the destination view's scroll to top.
- **Scroll:** the overlay scrolls independently of the page beneath it; the header and nav pill are fixed above it.
- **Rows:** whole row is the hit target (56px tall, meets touch minimums). No hover states are specified for touch; add the codebase's standard pressed state.

## State Management

| State | Type | Purpose |
| --- | --- | --- |
| `menuOpen` | boolean | overlay visibility, drives clip-path + pointer-events + nav highlight |
| `view` | string | destination screen when a row navigates |
| `light` | boolean | theme, drives all tokens (set in Preferences) |

No data fetching is required for this screen — the row set is static app navigation. Real implementations should drive the group/row lists from a config so routes and labels live in one place.

## Assets

- `rapidclash-logo-white-crop.png`, `rapidclash-logo-dark-crop.png` — footer and header logo (theme-swapped, 140px wide)
- `bolt-purple.png` — footer 18+ mark
- `iphone-frame.png` — device bezel used for presentation only; **not part of the app UI**
- other files in `assets/` belong to the surrounding screens included in the prototype

All row icons, social glyphs, and the RC coin are **inline SVG** in the markup — copy them from the HTML as-is. Fonts load from Google Fonts: Space Grotesk and Inter Tight.

## Screenshots

`screenshots/` holds reference captures of the prototype (device frame included, dark theme):

- `menu-01-games.png` — headline and GAMES group
- `menu-02-earn-compete.png` — EARN and start of COMPETE
- `menu-03-compete-platform.png` — COMPETE and PLATFORM groups
- `menu-04-fairness.png` — PLATFORM / fairness rows
- `menu-05-support.png` — SUPPORT group and footer block

## Files

- `Menu Page.dc.html` — the prototype; opens with the menu overlay showing. Contains the full app so navigation works end to end. The menu markup is the block with `clip-path:{{ menuClip }}`; behavior is in the `<script>` block at the bottom.
- `support.js`, `image-slot.js` — runtime needed for the prototype to render. Not part of the implementation.
- `assets/` — images listed above.

## Note on scope
This file also contains the Games, Rewards, Account, Preferences, and Affiliate screens because the shell and navigation are shared. Implement only the Menu overlay unless told otherwise — the rest is context for how the shell behaves.
