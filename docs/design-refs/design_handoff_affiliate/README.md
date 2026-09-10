# Handoff: RapidClash Affiliate Program

## Overview
The **Affiliate Program** section of the RapidClash mobile app (iOS-sized, 390 x 844 viewport inside a 437 x 893 device frame). Reached from Account → "Affiliate program" or from the Menu → EARN → "Affiliate program".

One screen with a horizontally scrollable tab rail and five sub-pages:

1. **OVERVIEW** — pitch, referral link/code, commission structure, onboarding steps, player benefits, partnership and materials entry points
2. **REFERRED USERS** — table of referred players (currently empty state)
3. **CAMPAIGNS** — create and manage tracking campaigns; each expands to stats, link and code
4. **EARNINGS** — total claimed / total claimable, and claim history
5. **MATERIAL** — **not designed yet** (renders empty; see Open items)

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing the intended look and behavior. They are **not production code to copy directly**.

The task is to **recreate these designs in the target codebase's existing environment** (React, React Native, Vue, SwiftUI, native, etc.) using its established components, styling approach, and state patterns. If the project has no environment yet, choose the most appropriate framework and implement the designs there.

`Affiliate Page.dc.html` opens directly in any browser (double-click it) on the Affiliate section. It is a prototype built on a small custom template runtime (`support.js`), where:
- `<sc-if value="{{ x }}">` is a conditional block
- `<sc-for list="{{ items }}" as="item">` is a list loop
- `{{ name }}` holes are values returned by `renderVals()` in the script block at the bottom of the file
- All styling is **inline** on the elements, so every measurement, color and font is visible where it is used

Read the markup for exact values; read `renderVals()` for state and behavior.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, transitions and interaction behavior. All numbers, usernames, codes and amounts are placeholder data and must come from the real API.

---

## Design Tokens

| Token | Dark (default) | Light |
| --- | --- | --- |
| `--rc-bg` | `#0B0B0B` | `#FFFFFF` |
| `--rc-surface` (cards, rows) | `#1A1A2E` | `#E9E9F0` |
| `--rc-sunken` (wells, disabled buttons) | `#0B0B0B` | `#D3D3DD` |
| `--rc-island` (header balance pill) | `#1A1930` | `#E4E4EE` |
| `--rc-text` | `#FFFFFF` | `#0B0B0B` |
| `--rc-muted` | `#83838F` | `#6E6E7A` |
| `--rc-green` (values, headlines in rows) | `#34D399` | `#0B8F5A` |
| `--rc-danger` | `#F0556B` | `#C42B41` |

Fixed brand values:
- Purple primary `#8B45F0`; ramp `#A870F0`, `#7C3AED`, `#6D28D9`, `#5B21B6`; light purples `#EDEAFB`, `#D8D3E8`, `#C9BEFA`, `#BFB8D6`
- Purple glow on primary buttons: `box-shadow: 0 0 14px 2px rgba(139,69,240,0.24)`
- Error red `#F04444`

### Typography
- **Display / labels:** Arial (Helvetica fallback), bold or 900
- **Numerals, codes, links:** `'Space Grotesk'` 700
- **Body:** `'Inter Tight'` 400–600

| Role | Spec |
| --- | --- |
| Page title (AFFILIATE PROGRAM) | 19px bold, letter-spacing 0.6px |
| Section headline (CAMPAIGNS, EARNINGS…) | 19px bold, letter-spacing 0.6px, with a 26px purple icon on the left |
| Row headline (green) | 25px, weight 900, letter-spacing 0.9px, `--rc-green`, uppercase |
| Micro label (COMMISSION EARNED, SIGNUPS…) | 10px bold, letter-spacing 1px, `--rc-text` |
| Table column header | 10px bold, letter-spacing 1.2px, `--rc-text` |
| Tab pill label | 12px bold, letter-spacing 0.8px |
| Button label | 12–13px bold, letter-spacing 0.8–1px |
| Body copy | 15px / 22px, `text-align: justify`, `text-wrap: pretty` |
| Amount (large) | 24px Space Grotesk 700, letter-spacing -0.4px |

### Spacing & shape
- Screen side padding 16px; tables bleed to the screen edge with `margin: 0 -16px`
- Section gap 24px; label-to-content 11–13px
- Radii: expandable rows 34px, cards 26px, groups 20–22px, pills/buttons 999px
- Expandable row: 22px 18px padding, 16px gap, 84px art on the left, content column, 13px triangle on the right
- Buttons: 44–50px tall, radius 999px, 20–24px side padding
- Striped tables: 54px rows, 2px gaps, first/last corners 20px, interior 6px; 42px header row with 10px bottom padding

### Motion
- Row expand: `grid-template-rows: 0fr → 1fr`, 330ms `cubic-bezier(0.22,0.61,0.36,1)`; body opacity 260ms ease
- Triangle: `rotate(0deg) → rotate(90deg)`, 300ms same easing
- Tab rail auto-centering: `scrollTo({ behavior: 'smooth' })` on the tapped pill, clamped at both ends
- Create-campaign sheet: `translateY(104%) → translateY(0)`, 440ms same easing; scrim opacity 320ms ease
- Toast: opacity + `translateY(22px → 0)`, auto-dismiss

---

## Shared chrome

**Header row:** 38px circular back button (`--rc-surface`, left triangle in `--rc-text`) + "AFFILIATE PROGRAM" 19px bold.

**Tab rail:** horizontal scroller, 9px gaps, pills `padding: 11px 16px`, radius 999px. Active pill `#8B45F0` with white label; inactive `--rc-surface` with `--rc-text` label. Edge gradient fades (38px left, 54px right) appear only when there is more content in that direction. Tapping a pill smooth-scrolls the rail so that pill is centered — a half-cut pill becomes fully visible.

**Expandable row pattern** (used across sub-pages): `--rc-surface`, radius 34px, `overflow: hidden`. Header is the tap target: 84px faceted purple SVG art, a content column, and a 13px `--rc-muted` triangle that rotates 90° when open. Body slides open below via the `0fr → 1fr` grid animation.

**Icon style:** all art is inline SVG in a flat faceted style — a purple base (`#8B45F0`), a lighter top-left facet (`#A870F0`), pale lavender details (`#EDEAFB`, `#D8D3E8`) and 2–3 white four-point sparkles. Headline icons (26px) are strictly flat, single-color `#8B45F0` with details knocked out in `--rc-bg` — no depth, no highlights.

---

## Sub-pages

### 1. OVERVIEW

1. **Hero** — `assets/affiliate-megaphone.png` (max 340px wide, nudged `left:-14px; top:-16px`), overlapped by the headline block (`margin-top:-34px`) with a purple flag icon and the program pitch.
2. **Referral link + code** — pill fields on `--rc-surface` with a horizontally scrollable value and a purple COPY button carrying the copy-paste icon; both trigger the "COPIED TO CLIPBOARD" toast. Code shown in the prototype: `KAI-9F2C`.
3. **COMMISSION STRUCTURE** — headline with a purple percent icon, then one expandable row: 84px faceted shield-with-bolt art, green "NO NEGATIVE CARRYOVER". Body: intro line, the formula `(Rake % × wagered × Commission rate) / 2` in a `--rc-bg` well (radius 20px, centered, Space Grotesk 700, `--rc-green`), and the no-negative-carryover explanation.
4. **VIP-style commission table** — tier rows (Bronze → Diamond) with wagered range and rate, striped, horizontally scrollable.
5. **HOW TO GET STARTED** — three independent pill rows (headline + triangle only). Tapping one expands its explanation; all three can stay open at once.
6. **WHAT YOUR PLAYERS GET** — thicker expandable row: 84px gift-box art, green "WELCOME BENEFITS", triangle. Body explains the player-side bonus.
7. **BECOME A PARTNER** — headline with a purple rounded-star icon; expandable row with the 84px faceted star (upright, ten shaded facets from pale lavender top-left to deep purple bottom-right, three sparkles), green "HAVE A BIG / REACH?" and a purple CONTACT US pill. Body: "If you're a content creator or professional affiliate with a large audience, we'll make a tailored partnership program for you. Contact our affiliate team to find out more."
8. **PROMOTIONAL MATERIALS** — headline with the flat purple screen-panel icon; expandable row with the 84px screen-panel art (wide flat panel, lighter top-left facet, five pale content bars, three sparkles), green "READY TO / SHARE" and a purple GET MATERIALS pill. Body: "Our team has put together banners, logos and game artwork - everything you need, ready to use across all socials and streams."
9. **Money graphic** — `assets/affiliate-money-sm.png`, 130% width, centered and clipped.

### 2. REFERRED USERS

Headline "REFERRED USERS" with the purple two-people icon, then a table that bleeds edge-to-edge and scrolls horizontally:

| Column | Width |
| --- | --- |
| USERNAME | 150px (18px left padding) |
| REGISTERED | 110px, centered |
| CAMPAIGN | 110px, centered |
| WAGERED | 100px, centered |
| COMMISSION EARNED | 160px, centered (18px right padding) |

Five 54px striped placeholder rows; the empty state "No referred users" (14px, weight 600, `--rc-text`) is centered against the **phone width**, not the wide table, so it stays readable while the table scrolls.

### 3. CAMPAIGNS

- Headline "CAMPAIGNS" with the flat purple screen-panel icon.
- **CREATE CAMPAIGN** button — full width, 48px, `#8B45F0`, radius 999px, purple glow.
- **Campaign cards** — `--rc-surface`, radius 26px. Header (17px 18px padding): campaign name 15px bold + short link 12px `--rc-muted` on the left; "COMMISSION EARNED" micro-label with the RC coin glyph and the amount in `--rc-green` (15px Space Grotesk 700); triangle on the right. Prototype data: `bobbylee` / code `KAI-9F2C` (matches the overview) and `winorgohome` / code `winorgohome`.
- **Expanded body** — 1px `--rc-bg` divider, then SIGNUPS and COMMISSION RATE (17px Space Grotesk 700; rate in `--rc-green`) side by side, then REFERRAL LINK and REFERRAL CODE rows: 44px `--rc-bg` pill with a horizontally scrollable value + a purple COPY button with the copy-paste icon. Copy fires the "COPIED TO CLIPBOARD" toast and does not toggle the card.
- **Create-campaign sheet** — slides up from **below the bottom nav pill**, so the nav stays visible and untinted. 64% screen height, `--rc-surface`, radius `34px 34px 52px 52px`, top shadow, 56x5px drag handle, "CREATE CAMPAIGN" 24px bold, a campaign-name input (50px, radius 999px, `--rc-bg`), a read-only auto-generated CODE (CAMPAIGN ID) field, and a submit button pinned near the bottom. The submit button is `--rc-sunken` with a `--rc-muted` label until a name is entered, then `#8B45F0` with white. Dismisses on scrim tap, handle tap, or any bottom-nav tap. Submitting closes the sheet and shows the "CAMPAIGN CREATED" toast.
- **Validation** — focusing the name field and blurring it empty applies a 1.5px `#F04444` border and shows "Campaign name is required" (12.5px, weight 700) below; typing clears it.

### 4. EARNINGS

- Headline "EARNINGS" with a flat purple wallet icon.
- **TOTAL CLAIMED card** — `--rc-surface`, radius 26px, 20px 18px padding: 56px faceted safe art (squared body, lighter top-left facet, recessed door, pale dial with spokes, handle), micro-label, then the RC coin (19px) + amount 24px Space Grotesk 700 in `--rc-text`.
- **TOTAL CLAIMABLE card** — same anatomy with a 56px messy coin-stack (three coin cylinders at slight angles plus one coin standing on edge, its face split diagonally into two lavender shades), the amount in `--rc-green`, and a CLAIM button on the right (44px pill; `--rc-sunken` with a `--rc-muted` label while the balance is 0.00, purple when claimable).
- **CLAIM HISTORY** — headline with the flat purple notebook icon (cover, spine, three knocked-out lines), then a striped table with DATE / AMOUNT / STATUS (34% / 34% / 32%) and the empty state "No claims yet".

### 5. MATERIAL

**Not designed.** The tab exists in the rail and renders nothing. Do not implement it from guesswork — see Open items.

---

## Interactions & Behavior

- **Tabs:** `affTab` drives which sub-page renders; default `'OVERVIEW'`. Tapping a pill also smooth-centers it in the rail.
- **Expandable rows:** independent booleans, so multiple rows can be open at once. Height animates via `grid-template-rows`, content fades in.
- **Copy actions:** every COPY button writes to the clipboard and shows the purple toast pill; `stopPropagation` keeps card toggles from firing.
- **Create campaign:** opens the bottom sheet with a freshly generated code; validation on blur; submit closes and toasts.
- **Nav:** any bottom-nav tap closes the create sheet and the menu overlay; the Account nav item stays purple while the Affiliate section is showing.
- **Tables:** horizontal scroll only; empty-state text is positioned against the viewport so it never drifts off-screen.

## State Management

| State | Type | Purpose |
| --- | --- | --- |
| `view` | string | `'affiliates'` while this section shows |
| `affTab` | `'OVERVIEW' \| 'REFERRED USERS' \| 'CAMPAIGNS' \| 'EARNINGS' \| 'MATERIAL'` | active sub-page |
| `affLeftFade`, `affRightFade` | 0/1 | tab-rail edge gradients |
| `commissionOpen`, `playersOpen`, `partnerOpen`, `promoOpen`, `step1/2/3Open` | boolean | expandable rows |
| `campOpen` | `{ [index]: boolean }` | per-campaign expansion |
| `createOpen` | boolean | create-campaign sheet |
| `newCampName`, `newCampCode` | string | sheet form values |
| `campNameTouched`, `campNameError` | boolean | blur validation |
| `toast`, `toastMsg` | boolean, string | confirmation pill |
| `light` | boolean | theme tokens |

**Data to fetch:** affiliate profile (referral code + link), commission tier table, referred users (paginated: username, registration date, campaign, wagered, commission earned), campaigns (name, code, signups, rate, commission earned), earnings totals and claim history. **Mutations:** create campaign, claim commission.

## Assets

- `affiliate-megaphone.png` — overview hero
- `affiliate-money-sm.png` — overview closing graphic
- `rapidclash-logo-white-crop.png`, `rapidclash-logo-dark-crop.png` — header/footer logo (theme-swapped)
- `bolt-purple.png` — footer 18+ mark
- `iphone-frame.png` — device bezel, presentation only; **not part of the app UI**
- remaining files in `assets/` belong to the surrounding screens included in the prototype

Every icon (faceted 84px/56px art, headline icons, RC coin, copy glyph, triangles) is **inline SVG** in the markup — copy them as-is. Fonts load from Google Fonts: Space Grotesk and Inter Tight.

## Screenshots

`screenshots/` holds reference captures (device frame included, dark theme):

- `overview-01-hero.png`, `overview-02-how-to-start.png`, `overview-03-players-get.png`, `overview-04-partner-materials.png`
- `referred-users.png`
- `campaigns-01-list.png`, `campaigns-02-expanded.png`, `campaigns-03-create-sheet.png`
- `earnings-01-totals.png`, `earnings-02-claim-history.png`
- `material-empty.png` — documents the undesigned MATERIAL tab

## Files

- `Affiliate Page.dc.html` — the prototype; opens on the Affiliate section. Sub-pages are the blocks under `{{ affOverview }}`, `{{ affReferred }}`, `{{ affCampaigns }}`, `{{ affEarnings }}`; behavior is in the `<script>` block at the bottom.
- `support.js`, `image-slot.js` — prototype runtime, not part of the implementation.
- `assets/` — images listed above.

## Open items
- **MATERIAL sub-page** has no design yet; the tab renders empty. The overview's GET MATERIALS button is the intended entry point.
- Commission rate in the campaign cards is shown as 20% placeholder; wire it to the real tier rate.
- CLAIM has no confirmation flow designed — currently a disabled-looking button at 0.00.

## Note on scope
This file also contains the Games, Rewards, Account, Preferences and Menu screens because the shell and navigation are shared. Implement only the Affiliate section unless told otherwise.
