# Limbo — PvP redefinition (confirmed)

The house Limbo (pick a target multiplier; an instant RNG pays the target if the roll clears it, at house-edged odds) reshaped into a **nerve duel**: both players secretly pick a target, **one shared roll** falls, and the bravery-vs-caution result decides it. The payout curve is set to **zero house edge** by construction, so the "odds" are true — the contest is purely between the two targets.

**Symmetry type:** *shared-event* — one seeded roll `R` measured against both targets. Same family as Crash, Keno, Roulette, Hilo.

## Invariants preserved
- **#1 humans vs humans.** One shared roll; the two targets are judged against each other, not against a paytable.
- **#2 server-authoritative + redaction.** Targets are hidden + simultaneous; `R` is server-side and hidden until reveal.
- **#4 play-money.** Stake/pot in credits.
- **#5 plug-in module**, no core branch.

## Gameplay
- Both players **secretly choose a target multiplier**, hidden + simultaneous. **10 s timer** (tunable); on timeout a **provably-fair random target is auto-assigned**.
- **Zero-edge distribution:** `R = 1/u` with `u` uniform on `(0,1)`, so the survival probability of a target `t` is **exactly `1/t`** (no house margin). **Min target 1.10×** (tunable), **cap 1,000,000×** (format/safety only).
- **One shared, provably-fair roll `R`.** The multiplier is literal — display the target as a real multiplier.
- **Resolution:**
  - `R ≥ both targets` → the **higher** target wins (bravery rewarded when both clear).
  - `R` **between** the two → the **lower (surviving)** target wins.
  - `R <` both targets, **or** equal targets → **push → replay**.

## Draw → replay
Both bust (`R` below both) or identical targets → **instant replay**, no rake; **10-replay safety cap** → void/refund.

## Contract mapping
- **meta:** `id:"limbo"`, `ranking:"net_winnings"`, `rakeRate:0.025`, symmetric stake, `avgDurationSec≈12`.
- **init(players, rng):** draw `R = 1/u` from the seed (hidden); start the 10 s pick timer.
- **legalMoves(state, player):** choose a target in `[1.10, 1,000,000]` until locked/timeout; else `[]`.
- **applyMove:** record a target (hidden). When both are locked **or** the timer expires (auto-assign a seeded random target) → reveal both + `R` and resolve.
- **isTerminal:** after resolve.
- **outcome:** per the resolution rules; both-bust or equal-targets → `draw` (→ replay).
- **viewFor:** a player's own target only until reveal; `R` hidden until reveal.
- **Timeout:** auto-assigned target is drawn from the seed (deterministic); reuses the generic timer capability.
- **Determinism:** `R` and any auto-targets are pure functions of the seed → exact replays.

> The zero-edge construction (`survival(t)=1/t`) is what lets the two targets be compared as a fair nerve contest: a higher target is rarer to clear but beats a lower one when it does. That trade-off — not a paytable — is the entire game.
