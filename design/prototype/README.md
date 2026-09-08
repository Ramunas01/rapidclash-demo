# RapidClash — Full Spec export

## What's here

| Path | What it is |
| --- | --- |
| `RapidClash Full Spec.html` | The whole prototype in one file — every screen, all style and script blocks intact. Opens in any browser by double-click. |
| `support.js`, `image-slot.js` | Runtime the file loads. Keep them next to the HTML. |
| `assets/` | Every image, avatar and sound the prototype uses. |
| `screenshots/` | Captured states, listed below. |

Keep the folder structure as-is — the HTML loads `support.js` and `assets/` by relative
path. A fully inlined single file was not possible: base64-ing all 119 assets plus the
audio pushes it past the 30 MB export ceiling.

## Reading the file

It is one HTML document. Markup at the top, logic in the `<script>` block at the bottom.

- `{{ name }}` — a value returned by `renderVals()` in that script block
- `<sc-if value="{{ x }}">` — conditional render
- `<sc-for list="{{ xs }}" as="x">` — loop
- All styling is inline, so every colour, size and spacing value sits on the element
  that uses it

Navigation is one `view` string (`games`, `rps`, `mines`, `dice`, `rewards`, `account`,
`prefs`, `affiliates`) plus overlay flags (`menuOpen`, `chatOpen`, `authOpen`,
`sortOpen`, `curOpen`, `createOpen`).

## Screenshots

| File | State |
| --- | --- |
| `01-games-originals.png` | Games list, ORIGINALS category — banner, category rail, filter pills, section title |
| `02-chance-games.png` | Games list with CHANCE GAMES selected |
| `03-search-open.png` | Search expanded — SORT and RANDOM collapsed, Cancel visible |
| `04-sort-sheet.png` | Sort sheet open over the games list |
| `05-rewards.png` | Rewards / VIP program, signed out |
| `06-account-login-sheet.png` | Account tapped while signed out — login sheet |
| `07-menu.png` | Menu overlay |
| `09-account-signed-in.png` | Account, signed in — XP, VIP progress, recent games |

Not captured: the three match screens (Rock-Paper-Scissors, Mines, Dice), chat, the
currency picker, preferences and affiliate. They are all reachable in the HTML file —
open it and click through.
