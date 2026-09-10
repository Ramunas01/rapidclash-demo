# Handoff: RapidClash Account & Preferences

## Overview
Two screens of the RapidClash mobile app (iOS-sized, 390 x 844 viewport inside a 437 x 893 device frame):

1. **Account** — profile summary, VIP progress, recent games history with pagination, and grouped settings rows.
2. **Preferences** — a sub-page reached from the Account screen's "Preferences" row: theme choice, sound, tipping, currency, privacy, marketing toggles.

Both screens share the app shell: fixed top header (logo + balance island), scrollable body, and a floating bottom navigation pill.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing the intended look and behavior. They are **not production code to copy directly**.

The task is to **recreate these designs in the target codebase's existing environment** (React, React Native, Vue, SwiftUI, native, etc.) using its established components, styling approach, and state patterns. If the project has no environment yet, choose the most appropriate framework and implement the designs there.

`Account Page.dc.html` opens directly in any browser (double-click it). It is a prototype built on a small custom template runtime (`support.js`), where:
- `<sc-if value="{{ x }}">` is a conditional block
- `<sc-for list="{{ items }}" as="item">` is a list loop
- `{{ name }}` holes are values returned by `renderVals()` in the script block at the bottom of the file
- All styling is **inline** on the elements, so every measurement, color, and font is visible where it is used — nothing hides in a stylesheet

Read the markup for exact values; read `renderVals()` for state and behavior.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, transitions, and interaction behavior. Recreate pixel-perfectly using the codebase's own primitives. Content is placeholder data (usernames, amounts, dates) and should come from real APIs.

---

## Design Tokens

Theme is switchable; tokens are CSS custom properties set on the app root from the logic class.

| Token | Dark (default) | Light |
| --- | --- | --- |
| `--rc-bg` | `#0B0B0B` | `#FFFFFF` |
| `--rc-surface` (cards, rows) | `#1A1A2E` | `#E9E9F0` |
| `--rc-sunken` (tracks, wells) | `#0B0B0B` | `#D3D3DD` |
| `--rc-island` (header balance pill) | `#1A1930` | `#E4E4EE` |
| `--rc-text` | `#FFFFFF` | `#0B0B0B` |
| `--rc-muted` | `#83838F` | `#6E6E7A` |
| `--rc-green` (values, positive) | `#34D399` | `#0B8F5A` |
| `--rc-danger` (log out) | `#F0556B` | `#C42B41` |

Fixed brand values (same in both themes):

- Purple primary: `#8B45F0`; darker `#7C3AED`, `#6D28D9`, `#5B21B6`; lighter `#A870F0`, `#C9BEFA`, `#D8D3E8`, `#EDEAFB`
- Purple glow: `box-shadow: 0 0 12px 2px rgba(139,69,240,0.55)` (progress bar), `0 0 14px 2px rgba(139,69,240,0.24)` (buttons)
- VIP tier colors — Bronze `#C46B34`/`#E08A5A`, Silver `#9BA2AE`/`#C9CDD6`, Gold `#D9A21F`/`#F2C744`, Emerald `#0F9D58`, Diamond `#2FB6DE`/`#5CD3F0`

### Typography
- **Display / labels:** Arial (Helvetica fallback), `font-weight: bold` or `900`
- **Numerals and values:** `'Space Grotesk'` (Google Fonts), weight 700
- **Body text:** `'Inter Tight'` (Google Fonts), weight 400–600

Scale used on these screens:

| Role | Size / line-height / tracking |
| --- | --- |
| Page headline (ACCOUNT, PREFERENCES) | 19px bold, letter-spacing 0.6px, uppercase |
| Section label (APPEARANCE, TIPPING) | 12px bold, letter-spacing 1.4px, uppercase |
| Card headline (@username) | 20px bold, letter-spacing 0.4px |
| XP value | 22px, Space Grotesk 700 |
| Row label | 14px, weight 600 |
| Row value / amount | 15–17px, Space Grotesk 700 |
| Helper text under groups | 12.5px / 19px, `--rc-muted`, `text-wrap: pretty` |
| Micro label (VIEW MORE, COPY) | 10–12px bold, letter-spacing 0.8–1.2px, uppercase |

### Spacing & shape
- Screen side padding: 16px
- Section gap: 22–26px; inner gap between grouped elements: 11px
- Radii: cards 20–22px, banners 24px, large rows 26–34px, pills/toggles 999px, game thumbnails 8px
- Row heights: settings row 42px, toggle row 56px, radio row 50px, recent-game row 74px, buttons 44–50px
- Striped tables: 2px gaps between rows, first/last row corners 20px, interior corners 6px

### Motion
- Expand/collapse: `max-height` or `grid-template-rows: 0fr → 1fr`, 320–520ms `cubic-bezier(0.22, 0.61, 0.36, 1)`
- Fade: opacity 260–380ms ease
- Toggle knob: `margin-left` 200ms `cubic-bezier(0.4, 0, 0.2, 1)`
- Chevron/triangle rotate: `rotate(0deg) → rotate(90deg)`, 300ms `cubic-bezier(0.22, 0.61, 0.36, 1)`
- Bottom sheet: `translateY(104%) → translateY(0)`, 440ms `cubic-bezier(0.22, 0.61, 0.36, 1)`, scrim opacity 320ms

---

## Screens

### 1. Account

**Purpose:** the player's home for identity, history, and settings entry points.

**Layout:** single scrolling column, 16px side margins, content starts under the fixed 64px-top header and ends above the floating nav pill (bottom padding ~130px).

Order of blocks:

Corrected 2026-08-23: the earlier text here listed a "Bring a rival" banner as block 1. Confirmed against `Account Page.dc.html` (the approved prototype, authoritative over this description) that the banner markup lives only in that file's `isGames` and `isRewards` blocks — it is never rendered inside `isAccount`. Manager confirmed: no banner on this screen. This was a documentation error in this README, not a deviation in the shipped code's prior removal.

1. **"ACCOUNT" headline** — 19px bold.
2. **Profile card** — `--rc-surface`, radius 22px, padding 18px 16px 20px.
   - Row: 44px circular avatar (`assets/avatar-3.jpg`, cover), username 20px bold, right side "XP:" 22px bold + value 22px Space Grotesk 700 in `--rc-green`.
   - "YOUR VIP PROGRESS" 12px bold + percentage 15px green, right-aligned.
   - Progress track: 8px tall, radius 999px, `--rc-sunken`; fill `#8B45F0` at the current percent with the purple glow shadow.
   - Below: current tier name + tier gem SVG on the left, next tier + gem on the right (12px bold, letter-spacing 1.2px, 15px icons).
3. **RECENT GAMES** — 26px purple headline icon + 19px label.
   - Rows 74px tall, alternating `--rc-surface` / transparent, 2px gaps, first/last corners 26px. Each row: 38 x 52px game art (radius 8px), game name 14px bold, "VS" 11px + opponent tier gem (13px) + opponent name 12px bold, right column with RC coin glyph + amount (17px Space Grotesk 700; green when won, `--rc-muted` when lost) and timestamp 11px muted.
   - Collapsed state clips the list with `max-height` and a bottom gradient fade (76px, `--rc-bg` → transparent) plus a "VIEW MORE" pill (`--rc-surface`, radius 999px, padding 8px 14px) bottom-right.
   - Expanded state reveals numbered page pills (34px tall, active = `#8B45F0`) and a "VIEW LESS" pill.
4. **CONTROLS** — 26px purple gear icon + 19px label. One `--rc-surface` group, radius 20px, `overflow: hidden`, containing 42px rows: *Account details*, *Verification*, *Security*, *Preferences* (navigates to the Preferences screen). Each row: 19px muted icon, 14px/600 label, 8 x 12px right-pointing triangle in `--rc-muted`.
5. **Affiliate program** — standalone 48px row, radius 20px, same anatomy; navigates to the Affiliate section.
6. **Second group** — *Responsible gaming*, *Blocked players*, *Help & support* (42px rows, radius 20px).
7. **LOG OUT** — right-aligned pill, `--rc-surface`, radius 999px, padding 10px 20px, label 12px bold in `--rc-danger`.

### 2. Preferences

**Purpose:** account-level settings.

**Layout:** header row with a 38px circular back button (`--rc-surface`, left-pointing triangle in `--rc-text`) + "PREFERENCES" 19px bold. Then sections, each: 12px/1.4px-tracked uppercase label, a `--rc-surface` group (radius 20px, `overflow: hidden`), and optional 12.5px muted helper text below.

| Section | Controls |
| --- | --- |
| APPEARANCE | Two 50px radio rows, *Dark* and *Light*. Radio = 22px `--rc-sunken` circle containing a 12px dot; selected dot is `#8B45F0` with a purple glow, unselected is transparent. Switching swaps every theme token live. |
| SOUND EFFECTS | *Game sounds* toggle. Helper: "Controls in-game audio. Volume follows your device settings." |
| TIPPING | *Accept tips/rain* toggle + helper; *Disable tips/rain notifications* toggle + helper. |
| CURRENCY | *Show credits in cash value* toggle; *Select currency* row showing the active code in green with a rotating triangle that expands a 4-column grid of currency pills (40px tall, radius 999px, active = `#8B45F0`). The select row is dimmed and non-interactive while the cash toggle is off. Helper text about estimation. |
| PRIVACY | *Stealth mode* toggle. Helper: "Keeps your username private across the platform." |
| MARKETING | *Receive marketing offers* toggle. |

**Toggle anatomy:** 46 x 26px track, radius 999px, 3px padding; knob 20px white circle; on-track `#8B45F0`, off-track `--rc-sunken`; knob animates via `margin-left` (0 → 20px).

**Row anatomy:** 56px tall, 18px side padding, 12px gap, 19px muted icon, 14px/600 label filling the row, control on the right.

---

## Interactions & Behavior

- **Navigation:** bottom pill has Menu / Games / Account / Rewards. The Account item stays purple while any of the account, preferences, or affiliate views is showing. Switching views resets the scroll container to top and closes any open overlay.
- **Preferences entry/exit:** the Preferences row pushes the prefs view; the back button returns to Account.
- **Recent games:** VIEW MORE expands the list (max-height animation) and reveals pagination; VIEW LESS collapses it. Page pills switch the visible slice.
- **Theme:** picking Dark/Light rewrites all tokens on the app root — no page reload; every screen reflects it immediately.
- **Currency:** the select row only responds when "Show credits in cash value" is on (opacity and cursor communicate the disabled state). Picking a currency closes the grid and updates the row value.
- **Toast:** copy/confirm actions show a purple pill toast that fades in (opacity 0 → 1, translateY 22px → 0) and auto-dismisses.
- **Bottom sheets** (pattern used elsewhere in the app, e.g. Create Campaign): slide up from below the nav pill so the nav stays visible and untinted; scrim behind the sheet; tapping the scrim, the drag handle, or any nav item closes it. Required text fields validate on blur: 1.5px `#F04444` border plus a 12.5px error message below.

## State Management

State needed for these two screens:

| State | Type | Purpose |
| --- | --- | --- |
| `view` | `'account' \| 'prefs' \| ...` | which screen is showing |
| `light` | boolean | theme selection, drives all tokens |
| `gamesExpanded` | boolean | recent-games collapsed/expanded |
| `gamesPage` | number | recent-games pagination index |
| `gameSound`, `tips`, `tipNotifs`, `cash`, `publicStats`, `marketing` | boolean | preference toggles |
| `currency` | string | selected currency code |
| `currencyOpen` | boolean | currency grid expanded |
| `toast`, `toastMsg` | boolean, string | transient confirmation pill |

Data to fetch in a real implementation: profile (username, avatar, XP, VIP tier + progress percentage), recent games (art, game name, opponent + tier, amount, win/loss, timestamp) with pagination, and persisted preference values.

## Assets

All in `assets/`, referenced relatively from the HTML:

- `avatar-3.jpg` — profile avatar (placeholder)
- `game-mines.png`, `game-crash.png`, `game-dice.png`, `game-coinflip.png`, `game-blackjack.png`, `game-chess.png` — recent-games artwork
- `rival-bg-live.png`, `trophy-coins.png`, `arrow-right-bold.png` — "Bring a rival" banner
- `rapidclash-logo-white-crop.png`, `rapidclash-logo-dark-crop.png` — header logo (theme-swapped)
- `bolt-purple.png` — footer mark
- `iphone-frame.png` — device bezel used for presentation only; **not part of the app UI**

All icons (settings glyphs, tier gems, RC coin, section headline icons) are **inline SVG** in the markup — copy them from the HTML as-is. Fonts load from Google Fonts: Space Grotesk and Inter Tight.

## Screenshots

`screenshots/` holds reference captures of the prototype (device frame included, dark theme):

- `account-01-top.png` — Account: header, profile card, start of recent games
- `account-02-recent-games.png` — Account: recent-games list with the VIEW MORE fade
- `account-03-bottom.png` — Account: CONTROLS groups and LOG OUT
- `prefs-01-top.png` — Preferences: appearance radios and sound toggle
- `prefs-02-tipping-currency.png` — Preferences: tipping and currency sections
- `prefs-03-bottom.png` — Preferences: privacy and marketing sections

## Files

- `Account Page.dc.html` — the prototype; opens on the Account screen. Contains the full app (other screens included) so navigation works end to end. Markup for the two screens sits inside `<sc-if value="{{ isAccount }}">` and `<sc-if value="{{ isPrefs }}">`; behavior is in the `<script>` block at the bottom.
- `support.js`, `image-slot.js` — runtime needed for the prototype to render. Not part of the implementation.
- `assets/` — images listed above.

## Note on scope
This file also contains the Games, Rewards, Menu, and Affiliate screens because the shell and navigation are shared. Implement only Account and Preferences unless told otherwise — the rest is context for how the shell behaves.
