# Dice — PvP redefinition (confirmed)

The house Dice (roll over/under a chosen line; the house pays at adjusted odds) reduced to its honest core: **two independent rolls, higher wins.** No target, no over/under, no payout line — the line is exactly where the house edge used to hide, so it is gone.

**Symmetry type:** *independent-roll* — each player gets their **own** seeded roll from the **same** distribution (separate seeds). The fairness here is **statistical symmetry** (identical distributions ⇒ P(A>B)=P(B>A)), not a shared event. This is the cleanest expression of "never the house," and it is the taxonomy partner of Baccarat. Distinct from the shared-event games (Crash, Keno, Roulette, Limbo, Hilo).

## Invariants preserved
- **#1 humans vs humans.** Two symmetric draws compared to each other; no house line to beat.
- **#2 server-authoritative + redaction.** Both rolls are drawn server-side and hidden until the reveal.
- **#4 play-money.** Stake/pot in credits.
- **#5 plug-in module**, no core branch.

## Gameplay
- Each player gets **one independent, provably-fair roll**, `0.00–99.99`.
- Both roll once; **higher number wins** the pot. No decisions, no target.
- An **exact tie** (equal to two decimals, ≈ 1 in 10,000) is a **draw → replay**.

## Draw → replay
Exact tie → **instant replay** (fresh independent rolls), no rake; **10-replay safety cap** → void/refund.

## Contract mapping
- **meta:** `id:"dice"`, `ranking:"net_winnings"`, `rakeRate:0.025`, symmetric stake, `avgDurationSec≈5`.
- **init(players, rng):** draw `rollA` and `rollB` from **separate seeds**; no decision phase.
- **legalMoves:** a single `"reveal"` commit per player (or auto-resolve once both have entered); otherwise `[]` — there are no in-game choices.
- **applyMove / resolve:** compare the two rolls; higher wins.
- **isTerminal:** immediately once both rolls are drawn.
- **outcome:** higher roll `win`; exact tie → `draw` (→ replay).
- **viewFor:** neither roll is sent until the simultaneous reveal at terminal.
- **Timer:** none needed (no decisions).
- **Determinism:** each roll is a pure function of its own seed → exact replays; separate seeds are the point — record both.

> This is deliberately the simplest game in the canon: pure chance, no skill, the bare "two fair draws, higher wins." It earns its place by being the most literal proof of the thesis — and as the reference implementation of the independent-roll pattern that Baccarat then dresses up.
