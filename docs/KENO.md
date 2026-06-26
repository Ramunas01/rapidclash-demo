# Keno — PvP redefinition (confirmed)

The house Keno (pick spots, the house draws, a paytable pays your matches) reshaped into a **shared-draw match race**: both players pick spots on the same pool, **one shared draw** falls, and whoever matched more wins. The paytable — the house's edge — is deleted; matches are compared head-to-head instead of paid out.

**Symmetry type:** *shared-event* — one seeded draw scored against both players' picks. Same family as Roulette and Crash.

## Invariants preserved
- **#1 humans vs humans.** One draw, two pick-sets, compared to each other; no paytable.
- **#2 server-authoritative + redaction.** Picks are hidden during selection; the draw is server-side and hidden until reveal.
- **#4 play-money.** Stake/pot in credits.
- **#5 plug-in module**, no core branch.

## Gameplay
- **Pool 1–40.** Each player picks **8** spots.
- **20 s pick timer** (tunable). Hidden picking — neither sees the other's spots during selection. On expiry, any unfilled picks **auto-fill with provably-fair random numbers** to reach 8.
- When the draw starts, **both players' picks are revealed on one shared board**.
- **One shared, provably-fair draw of 10** numbers.
- **Win:** more of your 8 picks matched takes the pot.

## Draw → replay
Equal matches → **instant replay** (fresh draw + pick phase), no rake; **10-replay safety cap** → void/refund.

## Contract mapping
- **meta:** `id:"keno"`, `ranking:"net_winnings"`, `rakeRate:0.025`, symmetric stake, `avgDurationSec≈25`.
- **init(players, rng):** draw the 10 winning numbers from the seed (hidden); start the 20 s pick timer.
- **legalMoves(state, player):** during picking — select/deselect spots (up to 8) and lock; else `[]`.
- **applyMove:** record/lock a player's 8 spots (hidden). When both are locked **or** the timer expires (auto-fill to 8), reveal picks + draw and count matches.
- **isTerminal:** after the reveal/resolve.
- **outcome:** more matches `win`; equal → `draw` (→ replay).
- **viewFor:** a player sees only their own picks until both are locked; the draw is hidden until reveal.
- **Timeout:** unfilled picks auto-fill from the seed (deterministic); reuses the generic timer capability.
- **Determinism:** draw and auto-fills are pure functions of the seed → exact replays.

> 8 picks against a 10-of-40 draw gives ≈ 2 expected matches — enough spread to usually produce a winner, with ties handled by replay.
