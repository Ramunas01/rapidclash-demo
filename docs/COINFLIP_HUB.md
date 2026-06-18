# Coinflip Hub — one-screen compact Coinflip

**Status:** PM draft for owner + Advisor review. This is the **build authority** for the
hub screen — we are building from this written spec + supplied asset images (no full
design mock), so anything ambiguous here will surface as rework. Flag corrections on the PR.

## Purpose

The product team's new designer produced a **compact, single-screen Coinflip**: instead of
walking through four screens (`stake-entry → lobby → coinflip-play → result`), the player
goes from the game list straight into **one scrollable screen** where the whole Coinflip
experience happens in place. The player should *feel* like they never left one screen.

This is a **presentation-layer re-shape of Coinflip only.** It does **not** change the money
model, the protocol, the game module, or server authority. It reuses the existing REST + WS
data exactly as the four screens do today — only the layout and navigation collapse.

## Decisions locked (2026-06-19)

- **Coinflip only.** RPS and Chess keep their existing multi-screen flow. Selecting **Coinflip**
  from the game list routes to the hub; other games are unchanged.
- **Chrome is hub-local for now.** The sticky top ribbon + bottom toolbar live on the hub
  screen, **not** promoted to a global app shell yet (that's a later step once the pattern
  is proven). Build them so promotion is easy.
- **Build from spec + assets** (no full mock). Expect a round of owner eyeball corrections on
  spacing/hierarchy.
- **Credits `¢`** notation ships first as its own foundation PR (`format.ts`); the hub consumes
  `formatCredits` everywhere it shows money. See `DEMO_PRESENTATION.md` → Credits display.

## Invariants preserved (non-negotiable — `CHARTER.md`)

- **#1 humans vs humans, never the house.** "Join" still pairs the player with another human
  (or a clearly-labelled `🤖` demo client through the same API). No house, no bot baked in.
- **#2 server-authoritative + redaction.** The client sends *intent*, receives *state*. The
  coin result and the opponent's choice arrive **only at `match.end`** (`viewFor` hides them);
  the in-place game area must not reveal either before then.
- **#4 play-money.** Amounts render as `¢` (never `$`). The `$` in the designer's bet-amount
  art is replaced by `¢`.

## Layout

Three bands. The **top ribbon** and **bottom toolbar** are **stationary** (sticky); the
**body** scrolls between them.

```
┌────────────────────────────────────────────┐
│ [RapidClash logo]            [👛 1,250¢ ]   │  ← sticky top ribbon
├────────────────────────────────────────────┤
│                                            ▲ │
│   ① Coinflip game area (coin + H/T)        │ │
│   ② Join button (green)                    │ │
│   ③ BET AMOUNT selector                    │ │
│   ④ Open challenges ("players waiting")    │ │  scrollable body
│   ⑤ Related games                          │ │
│   ⑥ "Bring the rival" banner               │ │
│   ⑦ RECENT CLASHES (leaderboard)           │ │
│   ⑧ Footer banner                          │ ▼ │
├────────────────────────────────────────────┤
│  [menu] [games] [account] [rewards] [chat] │  ← sticky bottom toolbar
└────────────────────────────────────────────┘
```

## Sticky top ribbon

- **Logo** (left) — `apps/web/src/assets/brand/` (owner supplies). Links to the game list (or
  the hub home; see toolbar `menu` below).
- **Wallet button** (right) — current balance via `api.wallet(token)`, shown with
  `formatCredits` (e.g. `1,250¢`). Tapping opens the wallet/account view. Updates live after
  every `match.end` settlement.
- Stationary across body scroll.

## Body sections (scroll order, top → bottom)

| # | Section | What it shows / does | Data source (real) | Reuses |
|---|---------|----------------------|--------------------|--------|
| ① | **Coinflip game area** | Coin image + heads/tails choice. **Inactive/greyed until a match is live.** When `match.start` fires, it activates; on `your_turn` the H/T choices enable; player taps a side → `ws.makeMove(side)`. Opponent's choice + flip stay hidden until `match.end`, then the **result resolves in place** (win/lose/draw + the `¢` settlement delta, confetti on win). Returns to idle for the next round. | `match.start` / `match.state` / `match.your_turn` / `match.end`; `CoinflipView` (`{players, choices, result?, forcedOutcome?}`) | `CoinflipPlay.tsx`, `Result.tsx` |
| ② | **Join button** (green) | The player's own "post and play" action. **Inactive until a bet amount is selected** (③). Pressing it posts the player's stake as an open challenge — `ws.joinQueue('coinflip', stake)` — and the player waits in place (challenge rests on the feed for others). | `queue.join` → `queue.waiting` | `StakeEntry.tsx` + `Lobby.tsx` |
| ③ | **BET AMOUNT selector** | Six presets: `1¢ 5¢ 10¢ 25¢ 50¢ 100¢` (within Coinflip's 1–100 stake range). Selecting one sets the active stake and enables ②. Art at `apps/web/src/assets/coinflip/` (the piece that used `$` → render `¢`). | local selection (stake) | `StakeEntry.tsx` |
| ④ | **Open challenges** ("players waiting") | List of other players' resting Coinflip challenges: owner name, stake (`¢`), countdown, and a **join** button each → `ws.takeChallenge(matchId)`, which starts a match in place (activates ①). This is the headline lobby — bias the UI toward making these obvious. | `ws.subscribeChallenges('coinflip')` → `challenges.list` / `challenges.update`; `OpenChallenge` | `OpenChallengesList.tsx` |
| ⑤ | **Related games** | A ribbon of tiles linking to other games (tap → that game). Data-driven from `/games`; reuse the tile art. | `api.games(token)` | `GameList.tsx` tiles |
| ⑥ | **"Bring the rival" banner** | Static banner image (momentarily; later may carry an invite/share action). | static asset → `apps/web/src/assets/banners/` | — |
| ⑦ | **RECENT CLASHES** | The Coinflip leaderboard contents, embedded. (Label is **"RECENT CLASHES"**, not "crashes" — see Copy.) | `api` `GET /leaderboard/coinflip`; `net_winnings` entries (can be negative, rendered `¢`) | `Leaderboard.tsx` |
| ⑧ | **Footer banner** | Static picture for now; later replaced by text + links. | static asset → `apps/web/src/assets/banners/` | — |

## Sticky bottom toolbar

Five icons (owner supplies art at `apps/web/src/assets/icons/nav/`, or standard `lucide-react`
glyphs where they match). Stationary across body scroll.

| Icon | Target | Notes |
|------|--------|-------|
| **menu** | hub/home | ⚠ Decision: what is "main menu"? Proposed: the game list (no separate home screen exists). |
| **games** | game list | `setScreen('game-list')`. |
| **account** | wallet/profile | the existing `Wallet.tsx` (balance + ledger). |
| **rewards** | — | ⚠ No backing screen exists. Proposed for the demo: a visible-but-inert tile or a "coming soon" placeholder. |
| **chat** | — | ⚠ Out of scope (no chat). Proposed: visible-but-inert / "coming soon" placeholder. |

## Interaction / state model

The hub is a small state machine over the existing WS events (no route navigation):

1. **Idle** — body interactive; game area ① greyed. Player either selects a **bet** (③) which
   enables **Join** (②), or taps **join** on a resting challenge (④).
2. **Waiting** — after pressing Join (②): the player's challenge rests; `queue.waiting` drives a
   countdown; they can cancel/re-post. (Joining someone else's challenge (④) skips straight to
   step 3.)
3. **In match** — `match.start` activates the game area ①; `your_turn` enables H/T; the player
   chooses → `ws.makeMove`. Opponent choice + flip remain hidden.
4. **Result** — `match.end`: reveal coin + outcome in place, animate win/lose/draw, show the
   `¢` settlement delta, update the wallet ribbon. Then return to **Idle**.

Reconnect/resume (`match.resume`) and the server-authoritative move/challenge timeouts behave
exactly as today — the hub is a re-layout, not new match logic.

## Assets the owner provides

| Asset | Path |
|-------|------|
| RapidClash logo | `apps/web/src/assets/brand/` |
| Bottom nav icons (menu/games/account/rewards/chat) | `apps/web/src/assets/icons/nav/` |
| Coin image (if not already present) | `apps/web/src/assets/coinflip/` |
| BET AMOUNT selector art (replaces the `$` one) | `apps/web/src/assets/coinflip/` |
| "Bring the rival" banner | `apps/web/src/assets/banners/` |
| Footer banner | `apps/web/src/assets/banners/` |

(All tracked, embeddable assets live under `apps/web/src/assets/`. A full-screen reference mock,
if one ever exists, goes in the gitignored `design-ref/`.)

## Copy

- **"RECENT CLASHES"** — not "crashes" (fits RapidClash; "crashes" reads like crash-gambling /
  real money, which we avoid).
- All money in `¢` (`formatCredits`); never `$`. Body sentences may use the word `credits`.

## Out of scope

- Any server, protocol, schema, or `coinflip` game-module change.
- Promoting the chrome to a global app shell (later).
- Real `rewards` / `chat` features (placeholders only).
- The other games' screens.

## Open questions (for owner / Advisor)

1. **Toolbar targets** — confirm `menu` and `account` destinations; confirm `rewards`/`chat` are
   inert placeholders for the demo.
2. **Result presentation** — resolve in place within the game area (assumed here), or a brief
   overlay over the hub? Either keeps confetti-on-win.
3. **Scroll order** — the order above is inferred; confirm or reorder sections.
4. **Bet vs. join precedence** — if a player has selected a bet (②-armed) and instead taps a
   resting challenge (④), we take the challenge (④ wins). Confirm.
