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

Instances: `game-hub:coinflip`, `:rps`, `:blackjack`, `:mines`, `:chess`. Same regions, per-game arena.

| Region | Purpose | Data source (real) |
|--------|---------|--------------------|
| `game-hub/arena` | The play surface (coin / cards / board / RPS); opponent info hidden until `match.end` | `match.start/state/your_turn/end`; per-game redacted view |
| `game-hub/stake` | Bet-amount selector (arms the stake) | local selection |
| `game-hub/play` | The green **PLAY** button (post a challenge) | `ws.joinQueue` |
| `game-hub/challenges` | This game's open challenges; rows say **JOIN** | `ws.subscribeChallenges` → `OpenChallenge[]` |
| `game-hub/related` | Related-games rail (**PvP games only**) | `api.games` |
| `game-hub/result` | Brief self-dismissing result overlay (lands wherever scrolled) | `match.end` |

**States** (in place, over WS events — no navigation): `idle` (browse, arena greyed) → `waiting` (own challenge resting; joining others disabled) → `in-match` (`match.start` activates the arena) → `result` (overlay, wallet updates) → back to `idle`. For internal-replay games (Blackjack/Mines draws), the replay loops in place; only the decisive result shows the overlay. See `COINFLIP_HUB.md` for the reference instance.

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
- **Originals** — all PvP games (live + coming-soon) *except* chess; the platform's signature, all "redesigned for two players."
- **Classics** — traditional games: Chess today, more later.
- **Events** — a Coin Flip **tournament announcement** banner (1 Sept 2026), framed as an invitation; play-money, no prize/real-money copy.

**Controls** (design fidelity > exact behavior, client-side over the tile list): **Find** (looking-glass → text field → substring filter), **Filter** (Card-games / Table-games / Logic-games), **Sort** (A–Z / Z–A / by popularity; popularity = a simple demo metric).

**Roster.** Live PvP: **RPS, Coinflip, Chess, Blackjack, Mines**. **Coming soon — PvP redefinition pending** (dimmed, non-playable tiles): **Baccarat, Limbo, Crash, Keno, Hilo, Dice, Roulette**. Per the conversion thesis (`CHARTER.md` / `GAME_REDEFINITION.md`), the whole house canon is a redefinition target — each becomes playable only once it has a confirmed two-player spec; none is ever shown in house form. Playable tiles are data-driven from `/games`; coming-soon tiles are static art, subtly dimmed (no verbose text).

## How to request a change

Designers: reference the **`hub/region`** (and `@ state` if it differs by state) + a Figma frame link + a one-line note of what changes and any new assets. The PM turns that into an issue against the named region; Claude Code restyles it; the owner reviews against the frame. No "which screen do you mean" ambiguity.
