# Screens

The canonical, named inventory of every screen — the shared vocabulary between designers and developers. A design change request names a screen here; an implementation PR targets the same name. Screen IDs match the `Screen` states in `apps/web/src/App.tsx`, so a name in Figma maps to exactly one place in code.

> **v1 vs v2.** The multi-screen layout below is **v1** — the recoverable fallback draft (preserved at tag `ui-v1-multiscreen` / branch `ui/v1-multiscreen-archive`). The target is **v2**: compact functionality **hubs** that regroup these screens onto a few surfaces with in-place state transitions. See `HUB_TRANSITION.md`. v1 is never deleted, just superseded.

## Flow

```
auth ──login──▶ wallet ──▶ game-list ──pick game──▶ stake-entry ──▶ lobby ──match found──▶ play / coinflip-play ──match end──▶ result ──▶ game-list
                                                       │  (open-challenges feed lives here)
                                                       └─ tap a challenge ──▶ (matched immediately)
   leaderboard is reachable from nav (wallet / game-list).
```

## Inventory

| ID | Name | Purpose | Key data shown | Status |
|----|------|---------|----------------|--------|
| `auth` | Sign in / Register | Enter the platform | alias, (play-money) starting balance on register | Functional; design refinement open |
| `wallet` | Wallet / Home | Landing after login; balance + recent activity | balance, recent ledger entries (play-money) | Functional; design refinement open |
| `game-list` | Game List | Choose a game; show the platform's breadth | live games (RPS, Coinflip) + coming-soon tiles | Functional; **tiles are prime design real-estate** |
| `stake-entry` | Stake Entry | Set a stake **and** see open challenges to join | stake input; open-challenges feed (owner, stake, countdown) | Functional; design refinement open |
| `open-challenges` | Open Challenges (embedded in `stake-entry`) | The "find a live opponent now" list | per-challenge owner, stake, expiry countdown | Functional; design refinement open |
| `lobby` | Lobby / Waiting | Wait for an opponent; show own bet's countdown | own stake, expiry countdown, "auto-refunds" copy | Functional; design refinement open |
| `play` | Play — RPS | Rock-Paper-Scissors match | own choice, opponent revealed only at end | Functional; design refinement open |
| `coinflip-play` | Play — Coinflip | Coinflip match (both players choose a side) | own side choice; flip/result only at end | Functional; design refinement open |
| `result` | Result | Win / lose / draw + wallet delta | outcome, settlement amount, confetti on win | Functional; design refinement open |
| `leaderboard` | Leaderboard | Rankings per game | per-game standings (`win_rate` or `net_winnings`) | Functional; design refinement open |

## Coming-soon tiles (design-only for the demo)

Shown on `game-list` as polished, non-playable tiles — they sell the roadmap to investors. Designers can produce all of these as art **now**, independent of engineering:

`Chess`, `Baccarat`, `Blackjack`, `Dice`, `Mines`, `Poker`, `Roulette`.

Two of these have engineering implications worth knowing:
- **Chess** — standard rules, so design (board, pieces, move/capture animations) can proceed in full now; engineering builds the logic in parallel.
- **Blackjack** — its head-to-head, no-house ruleset is **not yet decided** (open spec in `CHARTER.md`). Until that's settled, Blackjack is a coming-soon tile only — its play screen can't be designed in earnest because the mechanic determines the layout.

## How to request a change

Designers: reference the screen **ID** above + a link to the Figma frame + a one-line note of what changes (and any new assets). The PM turns that into an issue against the named screen; Claude Code re-skins it; the owner reviews the result against the Figma frame. No "which screen do you mean" ambiguity.
