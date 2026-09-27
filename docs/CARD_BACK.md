# Card back & deck — shared visual

The card back and deck are a **single shared component** reused by **every** card game — never a bespoke back. Built as SVG/CSS (flat fill + white frame + one bolt path + offset stack), so it stays crisp through the flip/deal animations at any size. No raster assets.

## Component
`apps/web/src/components/cards/CardBack.tsx` — exports:
- **`CardBack`** — the back face (white card + blue panel + bolt watermark).
- **`DeckPile`** — the stacked deck (top back + peeking white edges).
- **`BOLT_PATH`** — the RapidClash lightning-bolt SVG path, reused for the watermark.

Use these everywhere a card back or deck is shown.

## Colours — tokens (one source of truth)
| Token | Value | Role |
|---|---|---|
| `--card-back` | **`#4F4CEA`** | flat blue-violet inset panel — the exact brand-bolt colour, matching RPS/the coin (ticket 2026-09-27#4/D66; was `#5956F6`, documented at the time as deliberately distinct from the theme purple `#8140e2` for colour variance — that rationale is superseded by this ticket) |
| `--card-back-mark` | **`#4340D8`** | the bolt watermark — tone-on-tone, a few shades darker than the panel, subtle |
| (frame) | **`#FFFFFF`** | thick, even white border — the white *is* the card; the blue panel insets on it with a slightly smaller radius |

## Back
White card (outer radius matching the card faces, soft drop shadow) + a **flat** `#4F4CEA` panel + the RapidClash **bolt** (`BOLT_PATH`, the real 351×374 brand mark as of ticket 2026-09-27#4/D66 — same path `Coin.tsx`'s coin caps and `RpsHub.tsx`'s redacted-throw icon both draw) in `#4340D8`, **centred and upright** (no rotation), scaled WIDTH-driven to 74% of the panel (not height-driven — the old height-driven sizing against a square viewBox genuinely overflowed a non-square panel like Blackjack's own portrait hole card; the inner panel now also carries `overflow:hidden` as a safety net).

## Deck
Top card is the back; **4–5 thin white card edges** peek out below, slightly offset downward (the ridged "pile" look); consistent rounded corners; one soft drop shadow under the whole stack. Deals originate from the pile; the sliding card uses the same back.

## Reuse rule
Every card game uses `CardBack` / `DeckPile` — never its own back. **Blackjack** (opponent hole card, deck piles, deal animations) and **Baccarat** (the face-down hand placeholders) both use it; **Hilo** and any future card game inherit the same assets.

> **Note — Blackjack Play (`BlackjackPlay.tsx`) is the retired v1 screen** (the `PlayScreen` flow, not the live hub). It still has a local gradient `CardBack`; it is not on the live path (the hubs are), so it's left as-is. Migrate it only if that screen is ever revived.
