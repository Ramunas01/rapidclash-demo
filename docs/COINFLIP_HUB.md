# Coinflip Hub — one-screen compact Coinflip

**Status:** spec for the hub screen, revised after Advisor review (2026-06-19). This is the
**build authority** — we are building from this written spec + supplied asset images (no full
design mock), so anything ambiguous here will surface as rework. Flag corrections on the PR.

## Purpose

The product team's new designer produced a **compact, single-screen Coinflip**: instead of
walking through four screens (`stake-entry → lobby → coinflip-play → result`), the player
goes from the game list straight into **one scrollable screen** where the whole Coinflip
experience happens in place. The player should *feel* like they never left one screen.

This is a **presentation-layer re-shape of Coinflip only.** It does **not** change the money
model, the protocol, the game module, or server authority. It reuses the existing REST + WS
data exactly as the four screens do today — only the layout and navigation collapse.

## Decisions locked

- **Coinflip only.** RPS and Chess keep their existing multi-screen flow. Selecting **Coinflip**
  from the game list routes to the hub; other games are unchanged.
- **Chrome is hub-local for now.** The sticky top ribbon + bottom toolbar live on the hub
  screen, **not** promoted to a global app shell yet (later step once proven). Build them so
  promotion is easy.
- **Build from this spec + the supplied mock/assets.** A full-screen mock now exists (see Visual
  reference & required sanitization); lift its layout but apply the mandatory sanitizations.
  Expect a round of owner eyeball corrections on spacing/hierarchy.
- **Credits `¢`** notation ships first as its own foundation PR (`format.ts`); the hub consumes
  `formatCredits` everywhere it shows money. See `DEMO_PRESENTATION.md` → Credits display.

## Visual reference & required sanitization

A full-screen mock of the hub ships at **`apps/web/src/assets/coinflip/Coinflip-mock-with-bet-placed.png`**
— use it as the **layout / spacing / hierarchy reference**. Other supplied assets: logo
(`assets/brand/RapidClash_main_logo.02b204a9.png`), nav icons (`assets/icons/nav/nav-{menu,games,account,rewards,chat}.png`),
banners (`assets/banners/banner-Bring-the-rival.png`, `banner-Bottom-static.png`).

**The mock is a real-money-gambling design — lift the visuals, NOT the framing.** These
sanitizations are mandatory (re-skin principle + `CHARTER.md`), not optional polish:

- **Currency → `¢` integer credits.** The mock shows `$` (`$128.76`, `$10 LIMIT`, `$` bet chips).
  Render integer credits with `formatCredits` (no `$`, no decimal cents).
- **Related games (§5): drop the house-edge tiles.** The mock's tiles are **Blackjack, Limbo 500x,
  Crash** — **forbidden by the PvP-only corollary to invariant #1** (`CHARTER.md`). Do **not**
  reproduce them. The ribbon is data-driven from `/games` (registered PvP games only); roadmap /
  coming-soon tiles may be **any PvP-redefined game** (shown coming-soon until it has a confirmed
  two-player spec), **never a house-form route**.
- **No gambling-trope framing.** Drop "provably fair", "500x"/multiplier copy, and any crypto /
  real-money cues. This is a play-money investor demo.
- **Social links out of scope.** The mock's Discord / Telegram buttons + footer socials are not
  built — omit or render as inert placeholders.
- **Labels (resolved, owner 2026-06-19).** **Green "PLAY" button posts your own challenge**
  (`joinQueue`); **resting-challenge rows each say "JOIN"** (`takeChallenge`). Section header
  "OPEN BETS" (mock) or "open challenges" — keep one consistently.

## Invariants preserved (non-negotiable — `CHARTER.md`)

- **#1 humans vs humans, never the house.** "Join" still pairs the player with another human
  (or a clearly-labelled `🤖` demo client through the same API). No house, no bot baked in.
  **Corollary (related games, §5):** the roster never surfaces house-edge games — see Product
  integrity below.
- **#2 server-authoritative + redaction.** The client sends *intent*, receives *state*. The
  coin result and the opponent's choice arrive **only at `match.end`** (`viewFor` hides them);
  the in-place game area must not reveal either before then.
- **#4 play-money.** Amounts render as `¢` (never `$`). The `$` in the designer's bet-amount
  art is replaced by `¢`.

## Layout

Three bands. The **top ribbon** and **bottom toolbar** are **stationary** (sticky); the
**body** scrolls between them. Scroll order revised per Advisor Q3 (enabler before enabled —
bet precedes Join):

```
┌────────────────────────────────────────────┐
│ [RapidClash logo]            [👛 1,250¢ ]   │  ← sticky top ribbon
├────────────────────────────────────────────┤
│                                            ▲ │
│   1  Coinflip game area (coin + H/T)        │ │
│   ┌─ "stake & play" block ───────────────┐  │ │
│   │ 2  BET AMOUNT selector               │  │ │  scrollable body
│   │ 3  PLAY button (green)               │  │ │
│   └──────────────────────────────────────┘  │ │
│   4  Open Games (cross-game ticker, #114)  │ │
│   5  Related games (whole roster, #114)    │ │
│   6  "Bring the rival" banner              │ │
│   (Recent Clashes REMOVED — #114)          │ │
│   8  Footer banner                         │ ▼ │
├────────────────────────────────────────────┤
│ [menu] [games] [account] [rewards*] [chat*]│  ← sticky bottom toolbar (* = coming soon)
└────────────────────────────────────────────┘
```

## Sticky top ribbon

- **Logo** (left) — `apps/web/src/assets/brand/` (owner supplies). Links to the game list.
- **Wallet chip** (right) — live balance via `api.wallet(token)`, shown with `formatCredits`
  (e.g. `1,250¢`). Tapping opens the wallet/account view (`Wallet.tsx`, same target as the
  `account` toolbar icon). Updates live after every `match.end` settlement. This chip is where
  the new `¢` balance is most visible — make it real, not decorative.
- Stationary across body scroll.

## Body sections (scroll order, top → bottom)

> **Superseded by the shared `GameHub` template (#114).** Three of the sections below were generalised when the game-hub frame revision lifted Coinflip's hub into the shared template that every game now inherits (`apps/web/src/screens/GameHub.tsx` + `components/hub-shared/`):
> - **§4 Open challenges → cross-game "Open Games" ticker.** No longer Coinflip-only; it's the Home page's round-robin ticker showing resting challenges across *all* games, and tapping a non-Coinflip row routes to that game's hub. (Real feed only — no fabricated rows.)
> - **§5 Related games → the whole roster, coming-soon included.** No longer "PvP-only / registered games only"; the rail now shows every game incl. dimmed, inert coming-soon tiles (consistent with the roster). The *playable* set is still exactly `/games`; a coming-soon tile is never a playable house-form route (Product integrity, below, still holds for *playability* — only the *display* widened).
> - **§7 Recent Clashes → removed from the hub.** The leaderboard lives only in `profile-hub` now.
>
> §2+§3 are also merged into one rounded "play panel" with an inert **Play a Friend** button, and the "max ¢"/"select a bet" copy is dropped (enable-on-bet behaviour kept). The table below documents Coinflip's original intent; where it conflicts with the above, the template wins.
>
> **Further template patterns (blackjack-arena-polish, every hub inherits):**
> - **Opponent slot states** (§1 pill above the board): *idle* → a neutral **"Opponent"** placeholder; *waiting* → the **"Searching…"** beat with a decorative online-name scan (`DEMO_PRESENTATION.md` — real online players only, never fabricated, just "Searching…" when the feed is empty), held by a small **dwell floor** so a match never snaps in at zero delay; *in-match/result* → the **real opponent's name in bright white**, carried by `MatchStartPayload.opponentName` (server-authoritative, on **both** the PLAY and JOIN paths; re-sent on `match.resume` so it survives reconnect). The alias is a public name (the same one the open-challenge feed shows) — not hidden game state, so invariant #2 redaction is intact. Never an `opponentId`, never a cycled name.
> - **In-match play panel (item 7):** the play panel stays mounted during a match — PLAY reads **"Playing…"** (disabled) and BET AMOUNT + Play-a-Friend stay **visible but disabled** (not removed).
> - **Per-game slot controls:** a hub may inject in-match controls into the player's **own** slot pill via `renderSlotControls` (Blackjack puts Hit/Stand there). On-table rules prompts are dropped (no "your turn"/rules blurb on the arena).

| # | Section | What it shows / does | Data source (real) | Reuses |
|---|---------|----------------------|--------------------|--------|
| 1 | **Coinflip game area** (hero) | Coin image + heads/tails choice; the visual anchor at the top, **greyed/inactive in Idle**. When a match starts it activates; on `your_turn` the H/T choices enable; player taps a side → `ws.makeMove(side)`. Opponent's choice + flip stay hidden until `match.end`. The **result is presented as a brief self-dismissing overlay** (see Result, below), not buried in place. | `match.start` / `match.state` / `match.your_turn` / `match.end`; `CoinflipView` (`{players, choices, result?, forcedOutcome?}`) | `CoinflipPlay.tsx`, `Result.tsx` |
| 2 | **BET AMOUNT selector** | Six presets: `1¢ 5¢ 10¢ 25¢ 50¢ 100¢` (within Coinflip's 1–100 stake range). Selecting one **arms** that stake and enables the Join button (3). Sits directly above Join as one "stake & play" block. Art at `apps/web/src/assets/coinflip/` (the piece that used `$` → render `¢`). | local selection (stake) | `StakeEntry.tsx` |
| 3 | **PLAY button** (green) | Labelled **"PLAY"** (per mock). The "post and play" action. **Inactive until a bet (2) is selected.** Pressing it posts the armed stake as an open challenge — `ws.joinQueue('coinflip', stake)` — and the player enters **Waiting** in place. (Resting-challenge rows in §4 use **"JOIN"**.) | `queue.join` → `queue.waiting` | `StakeEntry.tsx` + `Lobby.tsx` |
| 4 | **Open Games** (cross-game ticker) | **Superseded by #114:** the Home page's round-robin ticker of resting challenges across **all** games (not Coinflip-only), under the play panel. Owner name, **stake in `¢`**, countdown, **JOIN** per row; a non-Coinflip row routes to that game's hub. Tapping **takes the owner's stake** (see Precedence). Real feed + bot-crowd seed; logged-out teaser. | cross-game `challenges` feed; `OpenChallenge` | `components/hub-shared/OpenGames.tsx` |
| 5 | **Related games** | ~~A ribbon of registered-PvP tiles only.~~ **Superseded by #114:** the rail shows the **whole roster, coming-soon included** (dimmed/inert), grey card removed, larger cards (3rd peeks). The *playable* set is still `/games`; coming-soon tiles are never a playable house-form route. | `api.games(token)` + static coming-soon tiles | `components/hub-shared/` |
| 6 | **"Bring the rival" banner** | Static banner image for now. *(Later: this should become a real "challenge a friend / send a match link" invite — the most honest cold-start primitive we have. Static is fine until then.)* | static asset → `apps/web/src/assets/banners/` | — |
| ~~7~~ | ~~**RECENT CLASHES**~~ | **Removed from the hub by #114** — the leaderboard now lives only in `profile-hub`. (The "RECENT CLASHES" label, not "crashes", is retained there.) | — | — |
| 8 | **Footer banner** | Static picture for now; later replaced by text + links. | static asset → `apps/web/src/assets/banners/` | — |

## Sticky bottom toolbar

Five icons (owner supplies art at `apps/web/src/assets/icons/nav/`, or standard `lucide-react`
glyphs where they match). Stationary across body scroll. **Three of the five point at screens
that already exist — wire those live; only `rewards`/`chat` are reserved.**

| Icon | Target | State |
|------|--------|-------|
| **menu** | `game-list` | **Live** (`setScreen('game-list')`). |
| **games** | `game-list` | **Live**. |
| **account** | `Wallet.tsx` | **Live** — balance + ledger in `¢`; the most worthwhile one to make real. Same target as the top wallet chip. |
| **rewards** | — (no screen) | **Reserved** — render as a visibly **inactive "coming soon"** (dimmed + tag), **not** a live-looking button that silently no-ops. |
| **chat** | — (no screen) | **Reserved** — same inactive "coming soon" treatment. |

## Interaction / state model

A small state machine over the existing WS events (no route navigation):

1. **Idle** — body interactive; game area (1) greyed. Player either selects a **bet** (2) which
   enables **Join** (3), or taps **join** on a resting challenge (4).
2. **Waiting** — after pressing Join (3): the player's own challenge rests with escrow held;
   `queue.waiting` drives a countdown; they can **cancel/re-post**. **One commitment at a time:**
   while Waiting, the join actions on other challenges (4) are **disabled** — the player must
   cancel their own resting bet before joining someone else's, so they can never double-commit
   into two matches. (Joining a challenge from Idle (4) skips straight to step 3.)
3. **In match** — `match.start` activates the game area (1); `your_turn` enables H/T; the player
   chooses → `ws.makeMove`. Opponent choice + flip remain hidden.
4. **Result** — `match.end`: a **brief, self-dismissing overlay** (within the hub, no navigation)
   reveals the coin + outcome, animates win/lose/draw with confetti on a win, and shows the `¢`
   settlement delta; the wallet chip updates. The overlay guarantees the payoff lands **wherever
   the player has scrolled** (a match can resolve while they're down at open-challenges or recent
   clashes — in-place resolution would fire off-screen and be missed). It then dismisses back to
   **Idle**. *(Acceptable lighter alternative if we ever drop the overlay: auto-scroll back to the
   game area on `match.end` and resolve in place — solves the same scroll problem, less cleanly.)*

Reconnect/resume (`match.resume`) and the server-authoritative move/challenge timeouts behave
exactly as today — the hub is a re-layout, not new match logic.

### Bet-vs-join precedence

If a player has armed a bet (2) and instead taps a resting challenge (4), **taking the challenge
wins** — but it matches the **owner's** stake, not the player's armed amount:

- The armed amount is **superseded** by the challenge's stake.
- The row must show that stake so the tap is informed consent — e.g. **`200¢ · JOIN`**.
- **Balance-check before claiming:** if the player can't cover the owner's stake, refuse clearly
  (don't silently fail). No extra confirm dialog is needed as long as the stake is on the row.

## Product integrity — no house-only games in the roster

The **PvP-only corollary to invariant #1** (`CHARTER.md`). The related-games ribbon (5) is data-driven from `/games`, which is
safe (only registered PvP games come back). But the **tile-art pack from the mock includes
house-edge multiplier games — Limbo, Crash, Keno, Hilo — which have no human opponent and cannot
exist on a "never the house" platform in that form.** They may appear only as dimmed, non-playable
**coming-soon** tiles — never as a playable **house-form route**, and never in the live
related-games ribbon (which stays registered-PvP only). Roadmap/"coming soon" tiles may be **any
PvP-redefined game** (coming-soon until it has a confirmed two-player spec — see
`GAME_REDEFINITION.md`), **never a house-form route**. Do not let the multiplier framing (500x,
etc.) drift back in via the asset pack.

*(Now recorded as the PvP-only corollary to invariant #1 in `CHARTER.md` — so it governs every
future game decision, not just this hub.)*

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
- Real `rewards` / `chat` features (reserved "coming soon" only).
- A real "challenge a friend / match link" invite (§6 stays a static banner for now; flagged as a
  worthwhile near-term feature).
- The other games' screens.

## Resolved decisions (Advisor review, 2026-06-19)

- **Q1 toolbar:** `menu`/`games`/`account` wired live (screens exist); `rewards`/`chat` reserved
  as visibly-inactive "coming soon".
- **Q2 result:** brief self-dismissing overlay (not pure in-place), so the payoff lands wherever
  the player is scrolled.
- **Q3 scroll order:** reordered so the enabler precedes the enabled — game area → **bet → Join**
  (one "stake & play" block) → open challenges → related → rival banner → ~~recent clashes →~~ footer.
  (#114: recent clashes removed; "Open Games" is now the cross-game ticker.)
- **Q4 precedence:** taking a challenge supersedes an armed bet and uses the **owner's** stake;
  show the stake on the row; balance-check before claiming.
- **+ One commitment at a time:** join disabled while Waiting on your own resting bet.
- **+ No house-only games** ever *playable* in the roster/related-games (Limbo/Crash/Keno/Hilo never a house-form route). **#114:** they may now *appear* in the related rail as dimmed, inert **coming-soon** tiles (display only — never playable), consistent with the roster.
