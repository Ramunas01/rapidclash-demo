# Screens — the hub vocabulary (v2)

The canonical, named inventory of every **hub**, its **regions**, and its **states** — the shared vocabulary between designers and developers. A design request names something here; an implementation PR targets the same name. IDs match the surfaces and state machine in `apps/web` (the `CoinflipHub` template + `hub-chrome`), so a name in Figma maps to exactly one place in code.

> **v1 vs v2.** The old flat multi-screen layout is **v1** — the recoverable fallback draft at tag `ui-v1-multiscreen` / branch `ui/v1-multiscreen-archive`. **v2** (below) regroups those screens into compact **hubs** with in-place state transitions. See `HUB_TRANSITION.md` and `HUB_TRANSITION_ANALYSIS.md`. v1 is never deleted, just superseded.

## Three levels of vocabulary

- **Hub** — a top-level surface a player lives on (`home-hub`, `game-hub`, `profile-hub`). The thing a designer composes.
- **Region** — a named area inside a hub (`home-hub/grid`, `game-hub/arena`). The thing a design request actually changes. Written `hub/region`.
- **State** — an in-place phase of the `game-hub` lifecycle (`idle`, `waiting`, `in-match`, `result`). No route navigation between them. Written `region @ state` when a region looks different per state — e.g. `game-hub:coinflip/arena @ in-match`.

`auth-gate` is the one exception — an **interstitial**, not a hub: a register/login step that intercepts the *commit-to-play* action when logged out, then resumes the intent (see Flow).

## Flow

```
Entry (anyone, logged out)
      │
      ▼
  home-hub ──tap a tile──▶ game-hub ──PLAY / JOIN──▶ [auth-gate if logged out] ──resume──▶ game-hub @ in-match ──▶ @ result
      │                     (browse · pick stake)        (register / login)                                          │
      └──nav: account──▶ profile-hub (auth-gated)                                                        result → idle (next round)
```

The wall falls at the **commit to play** (`PLAY`/`JOIN`), never at the door. Browsing tiles, opening a game hub, seeing the board/coin, and picking a stake are all open to a logged-out visitor. Logged-in players pass straight through `auth-gate`. See the deferred-auth decision in `HUB_TRANSITION.md`.

## Hub inventory

### `home-hub` — the landing (default route for everyone)

| Region | Purpose | Data source (real) |
|--------|---------|--------------------|
| `home-hub/ribbon` | Logo + wallet chip (or **Sign in** when logged out — never a fake balance) | `api.wallet` when authed |
| `home-hub/hero` | Promo carousel — static, play-money copy only | static assets |
| `home-hub/grid` | Game tiles + group tabs (All/Originals/Classics/Events) + Find/Filter/Sort — **the prime design real-estate** | `api.games` → `GameMeta[]` (public) |
| `home-hub/ticker` | "Open Games" live feed; tap JOIN → that game's hub | open-challenges feed (authed); teaser when logged out |
| `home-hub/leaders` | Leaderboard-lite | `GET /leaderboard/:gameId` (public) |
| `home-hub/footer` | Footer | static |
| `home-hub/nav` | Bottom toolbar: menu, games, account → `profile-hub`; rewards*/chat* = inactive "coming soon" | — |

### `game-hub` — one template, one instance per game

Instances (one per registered game, **all live**): `game-hub:coinflip`, `:rps`, `:chess`, `:blackjack`, `:mines`, `:crash`, `:roulette`, `:dice`, `:baccarat`, `:keno`, `:limbo`, `:hilo`, `:ships-battle`. Same regions, per-game arena. (`ships-battle` is route-reachable but kept off the home grid until it has tile art — `HIDDEN_ON_HOME`, #148.)

| Region | Purpose | Data source (real) |
|--------|---------|--------------------|
| `game-hub/arena` | The play surface (coin / cards / board / RPS); opponent info hidden until `match.end` | `match.start/state/your_turn/end`; per-game redacted view |
| `game-hub/stake` | Bet-amount selector (arms the stake) | local selection |
| `game-hub/play` | The **PLAY** button (purple; post a challenge), in the unified play panel with the inert **Play a Friend** (#114/#115) | `ws.joinQueue` |
| `game-hub/challenges` | **Cross-game "Open Games" ticker** (#114) — resting challenges across all games; rows say **JOIN** and route to that game's hub | cross-game `challenges` feed → `OpenChallenge[]` |
| `game-hub/related` | Related-games rail (**whole roster**, data-driven from `/games`; any future pre-spec game would show as a dimmed coming-soon tile via the same mechanism) | `api.games` (+ static coming-soon fallback, currently empty) |
| `game-hub/result` | Brief self-dismissing result overlay (lands wherever scrolled); some hubs override with an in-bar/pill reveal — Coinflip's bar fill+outline, Crash's pill outline (see those hub docs) | `match.end` |

**States** (in place, over WS events — no navigation): `idle` (browse, arena greyed) → `waiting` (opponent search) → `in-match` (`match.start` activates the arena) → `result` (overlay, wallet updates) → back to `idle`. For internal-replay games (Blackjack/Mines draws), the replay loops in place; only the decisive result shows the overlay. See `COINFLIP_HUB.md` for the reference instance.

**`waiting` shows the "Searching…" reassurance** (template pattern — every game hub; full spec in `DEMO_PRESENTATION.md`): the opponent slot reads *Searching…* with a brief decorative name-scan, **holds for a minimum dwell (~2–4 s) even when a real opponent is already waiting** so a match never snaps in with jarring zero delay, then shows the **real `match.start` opponent's name in bright white**. The scanned names are decorative; the opponent is always the real match — never a fabricated name.

**Animation honours redaction** (template rule for hidden-info hubs): during `in-match`, an opponent's move animates with **face-down / hidden** representations; the opponent's concealed cards, choices, and true total reveal **only at the terminal `match.end`** (`viewFor`). An on-table opponent total shows the *visible-card* value until then — never the hidden total.

**`PLAY` requires an armed stake — guide, don't disable** (template rule for every game hub): the **PLAY** button (`game-hub/play`) stays **enabled** with no stake selected; pressing it does **not** post a challenge but **scrolls `game-hub/stake` into view** (smooth — offset clear of the fixed footer + `env(safe-area-inset-bottom)` so it lands above the bottom nav, not behind it) and marks the stake region with a **red "needs-bet" frame**, paired with a short text hint ("Select a bet amount to play") and an `aria-live` announcement (never colour alone). Arming a stake (`onArm`) **clears the frame**; the player then presses PLAY themselves (no auto-submit). This **replaces** the earlier *disable-PLAY-until-armed* behaviour in `GameHub.tsx`, which dead-ended silently. The same guard applies to **Play a Friend** when that path requires a stake. (Insufficient balance *for* an armed stake is a separate validation — see `OpenGames.tsx` — not this rule.)

**`waiting` transforms the controls in place — no separate block, no layout shift** (template rule for every game hub): on PLAY, the controls section (`game-hub/play` + `game-hub/stake` + Play-a-Friend) stays mounted — same components, size, positions. The **PLAY button transforms in place** into a non-tappable *WAITING FOR AN OPPONENT · {countdown}*; **Play a Friend transforms into an active *Cancel*** (the one live control; aborts matchmaking via the reliable `leaveQueue`, reverting both buttons and re-enabling the bet row); the **bet row dims + inert** (the same freeze used during a match). **No separate waiting panel** — the opponent pill's *Searching…* and the arena's *Finding a rival…* are the only cues. On search **expiry** (no opponent — the common case when no bot crowd is present), revert to idle PLAY + re-enabled bet + a brief "No opponent found — try again" (confirm copy with the designer). Zero mount/unmount across `idle → waiting → in-match`.

**Draw → auto-rematch is one shared flow for the fast/chance games** (the universal tie rule's UX): the game's own **resolution animation still plays** (Coinflip's flip, Crash's crash, Dice's rolls; never skipped) → the draw is shown as a **full result state (orange)** → **~2 s hold** → an **automatic rematch** against the **same opponent, same bet**, no confirmation (state resets, pick/timer restarts). Built **once** and reused; the only per-game part is the pre-result resolution animation. Honours the **10-replay safety cap** (then void/refund) and **escrow carryover** (stakes stay escrowed across rematches; settle once, when decisive). See `COINFLIP_HUB.md` for the reference instance. **Exception — skill games do NOT auto-rematch:** a **Chess** draw (stalemate, threefold, 50-move, insufficient material, agreement) **refunds both, no rake** → post-game idle on the frozen final position (see `CHESS_TIME_CONTROL.md`); it still shows the orange result + persistent bar outline, just no replay.

**Idle hub shows the game at rest — never blank** (template rule for every game hub): the game area is **never empty**. With no active match it shows the game in its **resting/preview state** — Crash's chart frozen at 0 m, Coinflip's gold coin, Chess's full **starting position** (white at the player's bottom) — **static** (no interaction). This is the idle landing *and* the searching state. It composes with the round-scoped rule below: the preview shows when there is no round data; a finished round's frozen state persists instead.

**Round-scoped state — persists in the idle result view, cleared as one unit on PLAY or leave** (template rule for every game hub): the **opponent identity, both players' picks/moves, the board/hand position, and result states** belong to one round. They **persist** in the **post-round idle view** (a finished game stays on screen — Chess's frozen final position, the last pick pills, the result outline) so the player reads the outcome, then are **destroyed as one unit** by exactly two events: pressing **PLAY** (a new search) or **leaving the page** — never piecemeal (the bug was the opponent name clearing while the pick pills survived). `App.tsx`'s `resetRoundState` wipes `gameState` + `opponentId` + `opponentName` + outcome together, and each hub's local round state (e.g. Coinflip's `optimisticPick`) clears when `gameState` does. So a fresh visit or a new PLAY lands on the clean idle preview (rule above); a finished game left idle keeps its final state.

The shared part is the **invariant** — *orange = draw, ~2 s hold, auto-rematch, escrow carryover, 10-cap*; the **surface is medium-appropriate**: bar-only games (Coinflip, Crash) put the orange on the **player bar**; card games (Blackjack) put orange (tie) / red (both-bust) on the **cards** plus an orange **"Push" label**, and **show nothing on the bars** (the bar speaks only on decided rounds — see `BLACKJACK.md`). Same semantics and timing, game-appropriate surface — don't force an orange bar onto a game whose cards already carry the outcome.

### `profile-hub` — account (auth-gated)

| Region | Purpose | Data source (real) |
|--------|---------|--------------------|
| `profile-hub/account` | Alias + logout | `AuthResponse` |
| `profile-hub/wallet` | Balance + ledger (`¢`) | `api.wallet` → `WalletResponse` / `LedgerEntry[]` |
| `profile-hub/leaders` | Leaderboard | `GET /leaderboard/:gameId` |

### `auth-gate` — interstitial (not a hub)

Register/login step over the current hub, triggered by `PLAY`/`JOIN`/account when logged out. Captures the intended action (`{gameId, stake}` or a challenge `matchId`), then on success **resumes** it — a new registrant gets the 1000-`¢` grant and lands ready to play. If the tapped challenge is gone by then, drop into that `game-hub` with the stake pre-armed (don't error).

## `home-hub/grid` — taxonomy, controls, roster

**Group tabs** switch what the grid shows:
- **All** — every tile.
- **Originals** — all PvP games (all live) *except* chess; the platform's signature, all "redesigned for two players."
- **Classics** — traditional games: Chess today, more later.
- **Events** — a Coin Flip **tournament announcement** banner (1 Sept 2026), framed as an invitation; play-money, no prize/real-money copy.

**Controls** (design fidelity > exact behavior, client-side over the tile list): **Find** (looking-glass → text field → substring filter), **Filter** (Card-games / Table-games / Logic-games), **Sort** (A–Z / Z–A / by popularity; popularity = a simple demo metric).

**Roster.** Live PvP (all registered in `/games`, data-driven tiles): **RPS, Coinflip, Chess, Blackjack, Mines, Crash, Roulette, Dice, Baccarat, Keno, Limbo, Hilo** — 12 on the home grid — **plus Ships Battle** (live + route-reachable but `HIDDEN_ON_HOME` until it has tile art, #148), for **13 registered games total**. **No "coming soon" tiles remain**: the whole house canon has been redefined into two-player form and shipped. The `COMING_SOON` list in `tiles.ts` (`baccarat, keno, hilo, dice, roulette`) is now **vestigial** — every entry is registered, so `HomeHub` filters it against the live set and auto-promotes them, rendering **zero** coming-soon tiles. Per the conversion thesis (`CHARTER.md` / `GAME_REDEFINITION.md`), each became playable only once it had a confirmed two-player spec; none is ever shown in house form. Should a future game ship pre-spec, it would render as a dimmed static coming-soon tile via that same mechanism.

## How to request a change

Designers: reference the **`hub/region`** (and `@ state` if it differs by state) + a Figma frame link + a one-line note of what changes and any new assets. The PM turns that into an issue against the named region; Claude Code restyles it; the owner reviews against the frame. No "which screen do you mean" ambiguity.
