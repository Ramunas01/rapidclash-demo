# Ships Battle — PvP skill game (confirmed)

A natively-two-player **skill** game: each player hides a fleet on a 10×10 sea, the two take turns shooting, and the first to sink the opponent's whole fleet wins. Like Chess, it is inherently PvP — **not** a house-game redefinition — and joins the **Classics** group, ranked by ELO.

> **Naming:** "Battleship" is a Hasbro trademark — the product name is **Ships Battle** (or Sea Battle / Naval Clash), never "Battleship".

## Invariants preserved

- **#1 humans vs humans, never the house.** Inherently two-player; the platform only deals turns and adjudicates hits.
- **#2 server-authoritative + redaction (critical).** Both fleets live on the server. A player is only ever sent: their own board (their ships + the opponent's shots on it), and the opponent's board **as the squares that player has probed** (their hits/misses) plus revealed sunk ships and halos. The opponent's un-probed squares and un-sunk ships are **never** transmitted.
- **#4 play-money.** Stake and pot in credits.
- **#5 games are plug-ins.** A `ships-battle` module; no core branch.

## The fleet

15 ships, 35 squares: **1×(5), 2×(4), 3×(3), 4×(2), 5×(1)**. Each ship is an **edge-connected polyomino** of its size (free shapes — a size-5 may be any pentomino; sizes 1–2 are trivial). **No two distinct ships touch** — not by edge *or* corner (no ship square is in the 8-neighbourhood of another ship's square). The no-touch rule is what makes the **sink → halo reveal** honest: a sunk ship's surrounding squares are provably empty, so the server auto-marks them as known-misses for the shooter.

**The skill is two variables:** the **shape** of each ship (from size 3 up) and the **distribution** across the board, played against an opponent who cannot assume straight ships; offence adds a search-strategy layer.

## Fleet building — the connected-cell builder

The placement UI is an incremental "grow the ship" builder over the 10×10 grid. It expresses any polyomino with one gesture (tap connected cells) and **doubles as the auto-placer**. Ships are built **largest first**: the 5, then the two 4s, the three 3s, the four 2s, the five 1s.

**Cell states (colour = state):**

| State | Colour | Meaning |
|-------|--------|---------|
| Eligible | grey-greenish | a valid next square for the current ship — a start cell, or a frontier cell extending the current shape |
| Selected | green | a square of the current, not-yet-locked ship (tap again to remove it) |
| Inert | grey | an empty cell not currently eligible; tapping it is rejected (beep) |
| Ship | white | a locked ship square |
| Halo | black | the buffer around a locked ship — permanently blocked (this is what enforces no-touch) |

**Interaction:**
- At ship-start, every legal empty cell is **grey-greenish** (you choose where the ship begins).
- Tap an eligible cell → it turns **green** (added to the current ship). The frontier instantly recomputes: edge-adjacent legal cells become grey-greenish; cells no longer adjacent revert to grey.
- Tap a green cell → it is **removed** (back toward eligible); the frontier recomputes (it may shrink). This is the only "edit" — there is no editing a *locked* ship.
- When the current ship reaches its required size it **auto-locks**: green → white, its 8-neighbour halo → black, and the next ship's start cells (all remaining legal cells) → grey-greenish.
- Tapping grey or black → rejected (beep).

**Hold-to-randomize.** Press-and-hold an eligible cell and the RNG completes the current ship for you — a random eligible start, random frontier growth, then lock. Holding through can auto-fill the whole fleet. This is the **same routine the server uses to auto-place** (pick a random eligible cell → grow randomly along the frontier → lock → repeat for each remaining ship), so the human builder and the auto-placer are one mechanism.

**Dead-end handling.** The frontier is pruned so the **current ship** can always reach its size (a cheap local check — never offer a start/extension from which the ship can't be completed). A player can still, in principle, box out the *whole remaining fleet* (the five single-square ships at the end are the tight case, each needing a clear 8-neighbourhood); that is resolved by the **auto-fill escape** (hold-to-randomize, or an "auto-place rest" action) and by the **placement timeout** (server auto-completes a valid fleet). Full whole-fleet frontier-pruning is a later polish, not v1.

The builder is client-side UX; the **server validates and records the final locked fleet** (any valid fleet is accepted regardless of how it was built — see validation). Only the *timeout* auto-placement is server-side and seeded.

## Round flow / state machine

- **PLACEMENT** — both players build their fleet **simultaneously and hidden** (~60 s timer, tunable). Same hidden-simultaneous-setup pattern as Roulette's betting phase.
- **SHOOTING** — players alternate; on your turn you fire at **one un-probed square** of the opponent's board (~20 s per-shot timer, tunable). The server returns **hit** or **miss**; a hit completing a ship → **sink** → reveal the ship outline + auto-mark its halo as known-misses for you; then check terminal. **One shot per turn** (a hit does not grant an extra shot).
- **TERMINAL** — the instant a player's last ship is sunk, the shooter who sank it **wins**. Turns alternate, so there is no simultaneous win and **no draw** outcome. First shooter is chosen by seeded coin-flip (the minor first-move edge is accepted, like chess's white).

## Placement validation (server-side, non-negotiable)

A locked fleet is accepted only if: counts by size are exactly {1:5, 2:4, 3:3, 4:2, 5:1}; each ship is an **edge-connected** polyomino of its size; **no two distinct ships are 8-adjacent**; all squares are on the board. Anything else is rejected (invariant #2). The same validator backs auto-placement.

## Timeout & disconnect

- **Placement timeout (~60 s)** → server **auto-completes a valid fleet** (seeded; the builder routine driven by RNG) and locks it.
- **Shooting-turn timeout (~20 s)** → **auto-fire a random un-probed square** (keep the game moving). The per-move timer reuses the **generic per-player-timer capability** (chess / Crash / Mines).
- **Disconnect** → continue auto-firing each turn; a socket closed past a grace is **forfeited** so the opponent isn't made to wait out a whole game. No void once shooting has begun; abandon during placement → void/refund.

## Mapping to the game-module contract

A `ships-battle` module, no core branch:

- **`init(players, rng)`** — empty boards; enter PLACEMENT with the timer. `rng` is used only for auto-placement, auto-fire, and the first-shooter coin-flip.
- **`legalMoves(state, player)`** — PLACEMENT & unlocked: build/lock the fleet. SHOOTING & your turn: any un-probed opponent square. Else `[]`.
- **`applyMove`** — PLACEMENT: validate + record the locked fleet (hidden). SHOOTING: resolve hit/miss, detect sink → reveal ship + halo, detect all-sunk → terminal; pass the turn.
- **`isTerminal`** — one player's whole fleet is sunk.
- **`outcome`** — `win` for the sinker; **no `draw`**; `void` only if abandoned in placement.
- **`viewFor`** — own board in full; the opponent's board only as this player's probed squares + revealed sinks/halos. Never the opponent's hidden ships. This redaction is the game's integrity.
- **`forfeit`** — disconnect → auto-fire, then forfeit after grace.
- **Determinism** — shot *results* are fully determined by the (recorded) placements; the only RNG is auto-place / auto-fire / first-shooter, all seeded → replays are exact.

## Fee, ranking, stakes

- **Ranking:** `elo` (skill game, like Chess) — noisier than chess, so ratings converge slower, but ELO still applies.
- **Rake:** `GameMeta.rakeRate` = **10%** (the skill-game rate, matching Chess).
- **Stake range:** the game's `BetRules`.

## Interface

Beyond the placement builder above (the one genuinely new piece), the play view is two boards — your own (ships + incoming shots) and the opponent's probe grid (your hits/misses + revealed sinks) — plus the slot pills, the turn timer, and the standard game-hub chrome. No bespoke art needed beyond the grid.
