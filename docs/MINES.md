# Mines — PvP v1 (confirmed)

The confirmed two-player Mines. Mines is normally a house game (solo: reveal tiles, cash out vs the system), so this is its **PvP redefinition** — the form invariant #1's corollary requires before a house-style game can join the roster.

## Invariants preserved

- **#1 humans vs humans, never the house.** Two players race on identical boards; the platform deals and adjudicates but never plays a side. This redefinition is what lets a normally-house game onto the PvP roster.
- **#2 server-authoritative + redaction.** The board, mine positions, timers, and outcome live on the server. A player sees only their own board; the opponent's board is hidden until reveal (`viewFor`).
- **#4 play-money.** Stakes and settlement render in `¢`.

## Gameplay (v1)

**Board.** An 8×8 grid (64 squares) with 7 randomly placed mines (set by MINE_COUNT in board.ts; configurable). The two players play **two separate instances of the *same* board** — an identical mine layout for each — so the contest is a pure, equal-chance race with no layout-luck asymmetry.

**Stake & pot.** Both players press play; each stake locks into a shared pot, awarded to the winner. Rake is taken once, on the decisive result.

**Play.** Both players play **simultaneously**, each on their own instance, each with their own move timer:
- A player uncovers one covered square at a time.
- Each safe square uncovered adds to that player's count and resets their timer.
- Uncovering a mine → **bust**: that player's board locks and is revealed in shaded colour. No further moves.
- There is **no cash-out** — a player keeps uncovering until they bust or until they clear all 57 safe squares.
- **Clearing all 57 safe squares** also locks the board, at the maximum score, *without* a forced bust (a perfect run is not punished).

**Move timer.** 5 seconds per move (configurable later), shown as a corner countdown. On expiry, the server **auto-reveals a random covered square** for that player (the game is never frozen waiting on an absent player — trust the RNG, not a held breath). An auto-revealed square can itself be a mine, exactly like a manual pick.

**Reveal & win.** The winner is whoever uncovers **more safe squares** (pot − rake); equal counts → draw. The match does **not** wait for both players to exhaust the board — it ends the instant the outcome is mathematically decided (see *Match resolution & timing*).

### Match resolution & timing

A player's score is final only once they **lock** (bust or clear), so the contest can be settled well before either board is exhausted:

- Nothing is decided until **at least one** player has locked — an unlocked player's score can still rise or bust, so there is no fixed target yet.
- Once a player locks with score **S**, the other races against **S**: the moment they reach **S + 1** they have won (irreversibly — their score cannot fall, so they need not keep playing); the moment they **lock at ≤ S** the locked player wins (or it is a draw at equal scores).
- So a fast player who busts at 10 waits only until the opponent reaches **11** (opponent wins) **or busts** (compare) — **never** until the opponent clears the whole board.

The wait is bounded and cannot be stalled: the 5-second auto-reveal forces the slower player to make a move (and risk a mine) at least every 5 seconds, so the match always progresses to resolution. To keep the wait *engaging*, a **locked player is shown the opponent's live safe-count** climbing toward their score — the chase becomes the drama, and a locked player has no move left to exploit.

**Draws — RESOLVED (aligned with Blackjack).** A tie in safe-counts → **instant replay** on a fresh board with a new seed, repeating until someone wins, pot carried over untouched, rake once on the decisive result. **Safety cap: 10 consecutive draws → void + refund both** (no rake).

**Disconnect.** A dropped player is simply a player whose every move times out — the server keeps **auto-revealing random squares** on their behalf until they lock (bust or clear). No special void. (If both players disconnect, resolve normally; apply the same draw safety-cap as Blackjack so a both-absent draw can't replay forever.)

## Mapping to the game-module contract

Satisfies the existing `GameModule` contract — **with one shared caveat:** the concurrent **per-player timers** need the same *generic* per-player-timer core capability identified for Blackjack (the core today has only a single per-match deadline, not per-player clocks). That is a game-agnostic core addition, not a Mines-specific branch. Otherwise no core change:

- **`init(players, rng)`** — generate **one** board (7 mines on 64 squares) from the seed; give **both** players that identical layout, each with their own uncovered-set and lock-state; start both 5s timers. (Provably-fair commit-reveal optional — see below.)
- **Concurrent play, not turn-based.** Both act simultaneously on their own instance. `legalMoves(player)` = that player's still-covered squares while unlocked, else `[]`. `applyMove` uncovers a square for one player independently; the server runs the two per-player timers and applies a random covered square on timeout.
- **`isTerminal`** — true as soon as the outcome is **decided**, not only when both boards are exhausted: once one player is locked with score S, terminal when the other reaches S+1 (they win) or locks at ≤ S. If neither is locked, not terminal (no fixed target yet). The server re-evaluates this after **every** move, so `match.end` may fire mid-play for the player who just crossed the line. Under the replay draw-policy, false after a *drawn* round so the match re-deals within the same escrow.
- **`outcome`** — higher safe-count wins. A tie is a draw; under the replay policy that loops a new round rather than returning a contract-level `draw`.
- **`viewFor`** — returns the player's own board (their uncovered squares; their mines only once they bust); the opponent's *board* is always hidden. The opponent's running safe-**count** is hidden while a player is still active, but **revealed once that player has locked** (busted/cleared), turning the wait for resolution into a visible chase. Revealing only the count, only to a locked player, leaks nothing exploitable — they have no move left.
- **`forfeit` (disconnect)** — continue auto-revealing for the dropped player until they lock; do not void.
- **Determinism** — the identical board derives from the seed and replays exactly.

## Fee, ranking, stakes, provably-fair (aligned with Blackjack)

- **Rake — per-game rate, declared in `GameMeta.rakeRate`** (the model is per-game now, not platform-wide — see the per-game-rake change). Mines is a chance game → **2.5%** of pot, like Coinflip/RPS; applied once on the decisive result, never a Mines hard-code.
- **Ranking:** `net_winnings` (chance game, like Coinflip). Owner to confirm.
- **Stake range:** follows the game's `BetRules` meta.
- **Provably-fair — seeded-RNG first (aligned with Blackjack).** v1 uses the seeded-RNG board determinism. Real commit-reveal (publish the board-seed hash pre-deal, reveal post) is roadmap/design intent, not built — kept consistent with Blackjack.

## Edges (shared with Blackjack)

- **Unbounded draws** under the replay policy — **cap at 10** consecutive draws → void + refund both (same as Blackjack).
- **Both players disconnect** — resolve via auto-reveal; don't loop a both-absent draw forever.
