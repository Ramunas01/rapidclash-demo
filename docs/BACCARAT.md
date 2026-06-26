# Baccarat — PvP redefinition (confirmed)

The house Baccarat (bet Player / Banker / Tie; the Banker's structural edge is clawed back by a 5% commission) reshaped so there are **no sides and no commission**: **each player simply *is* their own hand**, both dealt by authentic baccarat rules, and the higher total wins. With no Banker to back and no house to take commission, the edge the commission exists to offset never appears.

**Symmetry type:** *independent-roll* — each player draws from their **own** shoe (own seed), like Dice. Fairness is **statistical symmetry** (identical rules + identical distributions), which also removes any "who was dealt first" question. Distinct from the shared-event games (Crash, Keno, Roulette, Limbo, Hilo).

## Invariants preserved
- **#1 humans vs humans.** Two symmetric hands compared to each other — explicitly **no Player/Banker/Tie betting**, because backing a side would reintroduce the Banker edge that commission normally offsets, and there is no house to take that commission. Each player is their own hand; no sides, no commission anywhere.
- **#2 server-authoritative + redaction.** Both shoes are server-side; each player watches only their own hand resolve; the opponent's hand is hidden until terminal.
- **#4 play-money.** Stake/pot in credits.
- **#5 plug-in module**, no core branch.

## Gameplay
- Each player is dealt a hand from an **independent shoe**, scored by **authentic baccarat rules**: 10s and faces = 0, ace = 1, the total is the **last digit** (closest to 9 wins), and the **standard third-card rules apply automatically**.
- **No decisions** — the draw is entirely rule-determined, exactly like real baccarat. Players watch their hand resolve.
- **Win:** higher final total (closest to 9) takes the pot.

## Draw → replay
Equal totals → **instant replay** (fresh independent shoes), no rake; **10-replay safety cap** → void/refund.

## Contract mapping
- **meta:** `id:"baccarat"`, `ranking:"net_winnings"`, `rakeRate:0.025`, symmetric stake, `avgDurationSec≈5`.
- **init(players, rng):** deal each player a hand from its **own seed**, apply the third-card rules deterministically, compute both last-digit totals. No decision phase.
- **legalMoves:** `[]` — there are no choices (a `"deal"`/reveal commit per player at most).
- **applyMove / resolve:** compare totals (closest to 9).
- **isTerminal:** immediately once both hands have resolved.
- **outcome:** higher total `win`; equal → `draw` (→ replay).
- **viewFor:** each player sees their own hand resolve; the opponent's hand is sent only at the simultaneous reveal.
- **Timer:** none needed (no decisions; the hands resolve automatically once dealt).
- **Determinism:** each hand is a pure function of its own shoe seed → exact replays; separate seeds — record both.

> Mechanically this is Dice wearing baccarat's clothes: the third-card rules give authentic feel, but the outcome is a rule-determined draw with no decisions. The deliberate omission of the Player/Banker/Tie bet is the whole point — it is what keeps the conversion house-free.
