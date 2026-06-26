# Hilo — PvP redefinition (confirmed)

The house Hilo (call the next card higher or lower; the house pays a multiplier) reshaped into a **symmetric streak race**: both players run the **same seeded card sequence**, each sees only their own progress, and the longer correct run wins. No house, no payout curve — just two people reading the same cards.

**Symmetry type:** *shared-event* — one seeded sequence dealt identically to both (like Mines' identical boards). Distinct from the independent-roll games (Dice, Baccarat).

## Invariants preserved
- **#1 humans vs humans.** Both face the identical card stream; the platform only compares streaks.
- **#2 server-authoritative + redaction.** The sequence and both players' progress live on the server; each player is sent only their own position/streak — never the opponent's. Future cards are never sent ahead of the call.
- **#4 play-money.** Stake/pot in credits.
- **#5 plug-in module**, no core branch.

## Gameplay
- One **shared seeded card sequence**. Both players start at the first card; each sees only their own card and progress.
- On each card a player calls **Hi** or **Lo** for the *next* card. Correct → advance to the next card, streak +1. Wrong → **bust** (streak frozen at its value).
- **Same rank counts as correct** regardless of the call — a tie never busts you.
- A **shared 30 s match clock** (tunable) is an anti-stall cap: when it hits 0 the round ends and every un-busted streak freezes where it is.
- **Win:** the higher correct streak takes the pot.

## Draw → replay
Equal streaks — both reaching the same count, or both busting at the same count — is a **draw → instant replay** with a fresh sequence. Replays carry no rake; a **10-replay safety cap** then voids to a refund (shared convention).

## Contract mapping
- **meta:** `id:"hilo"`, `ranking:"net_winnings"`, `rakeRate:0.025`, symmetric stake, `avgDurationSec≈30`.
- **init(players, rng):** draw the card sequence from the seed; both players at position 0; start the 30 s shared match clock.
- **legalMoves(state, player):** `["hi","lo"]` while not busted, sequence remaining, and clock > 0; else `[]`.
- **applyMove:** compare the next card; correct (or equal rank) → advance + streak++; wrong → bust at current streak.
- **isTerminal:** both busted, OR clock = 0, OR sequence exhausted.
- **outcome:** higher streak `win`; equal → `draw` (→ replay).
- **viewFor:** own card + own streak only; opponent's progress hidden until terminal; unrevealed future cards never sent.
- **Timer:** the shared 30 s match clock reuses the generic timer capability (here as a single match deadline rather than a per-move timer).
- **Determinism:** sequence is a pure function of the seed → replays are exact.

> The deck should be long enough that the 30 s cap, not exhaustion, is the usual terminator (a full 52-card shuffle is ample). Light skill (basic high/low probability) sits on top of chance — ranks by net winnings like the other chance games.
