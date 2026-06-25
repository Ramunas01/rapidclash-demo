# Roulette — PvP v1 (confirmed)

The PvP redefinition of roulette, per the conversion thesis (`CHARTER.md` / `GAME_REDEFINITION.md`) — and the **marquee "sounds impossible" conversion**, now confirmed. Based on the owner-supplied spec, aligned to the platform invariants. Two players bet on **one shared spin** of a **zeroless 36-pocket wheel**; the larger chip stack after the spin wins the pot. Removing the green zero deletes the house edge *by construction* — paid odds equal true odds exactly — which makes this the most literal expression of invariant #1.

## Invariants preserved

- **#1 humans vs humans, never the house.** Zeroless wheel → no house pocket, no edge; one shared spin, perfectly symmetric outcomes. The platform escrows, spins, resolves, and rakes — but is never a counterparty.
- **#2 server-authoritative + redaction.** Allocations are **hidden** from the opponent until both lock; the spin and resolution are server-side; the client only renders. No last-mover advantage is possible (an allocation is never transmitted before both are locked).
- **#3 append-only ledger.** Stake escrowed; winner gets `pot − rake`; draws/replays take no rake; idempotent. **Chips never touch the ledger** (see "Two currencies").
- **#4 no real currency — CORRECTION to the source doc.** The source repeatedly says "real-money pot/stake"; on this platform the pot and stake are **play-money credits**, full stop (invariant #4). The "chips" are an internal scoring comparator, unrelated to the credit stake.
- **#5 games are plug-ins.** A `roulette` module, no core branch; `net_winnings` ranking; `rakeRate` 2.5%.

## Two currencies (read this first)

- **Stake / pot** — **play-money credits**, escrowed, the thing actually won; settled through the ledger exactly as in every other game.
- **Chips** — **internal scoring units** (each player starts with 1,000), the comparator that decides who wins the pot. Chips are game state only; they never enter the wallet or ledger.

## The wheel

36 pockets numbered 1–36, **no zero / no double-zero**, 18 red / 18 black (standard distribution). The green zero is the sole source of house edge on a normal wheel; removing it makes paid odds = true odds exactly.

## Bet set (v1) and payouts

Exotic bets (splits, corners, streets) are deferred. Payouts are **recomputed for the 36-pocket wheel** (they differ from a 37-pocket European wheel):

| Bet | Covers | Pays (return multiple on win) |
|-----|--------|-------------------------------|
| Red / Black | 18 | 2× (1:1) |
| Odd / Even | 18 | 2× (1:1) |
| High (19–36) / Low (1–18) | 18 | 2× (1:1) |
| Dozens (1–12, 13–24, 25–36) | 12 | 3× (2:1) |
| Columns (1st / 2nd / 3rd) | 12 | 3× (2:1) |
| Straight-up (single number) | 1 | 36× (35:1) |

Score **total return** (stake + winnings) on a winning bet, **0** on a loss. Because every bet's coverage-fraction × payout = 1.00, **every bet type has identical expected value per chip** — strategies differ only in **variance**, which is what makes it a contest of nerve, not a solved optimum.

## The full-stack rule (the key mechanic — mandatory, server-enforced)

The **entire stack must be allocated before every spin**; no chips held in reserve. Validation: the sum of placed chips must equal the starting stack exactly before a LOCK is accepted. Why it's non-negotiable: the wheel is zeroless, so every bet is break-even in expectation. If chips could be held back, the optimal play is to wager the minimum and bank the rest — both rational players do so, variance collapses, and nearly every round pushes. Forcing the full stack into play guarantees real variance and a decisive result. (This is roulette's analog of Mines' *no cash-out* and Crash's *bust-on-crash* — the single rule that prevents a degenerate equilibrium.)

## Round flow / state machine

**WAITING** (match formed, escrow locked, 1,000 chips credited each) → **BETTING** (~30 s; each player allocates their full stack, **hidden** from the opponent; free to move chips until lock or expiry) → **LOCK** (allocation frozen; timeout handling below) → **REVEAL + SPIN** (both allocations revealed to both, then one shared seeded spin) → **RESOLVE** (winning bets pay at the ratios above; losing bets pay 0; final stacks computed) → **SETTLE** (higher final stack wins `pot − rake`; equal → **REPLAY**). 

## Draws & replay

Equal final stacks — including **both busted to zero** — → **instant replay** (fresh seed, stacks reset to 1,000, escrow held, **no rake**), the same policy as Blackjack/Mines. **Safety cap: 10 consecutive replays → void + refund both** (no rake), so a match can't loop forever.

## Timeout & disconnect (resolved)

- **(a) Incomplete allocation at the 30 s expiry → auto-spread the unallocated remainder evenly across the even-money bets (red/black)** — deterministic, gentle, and keeps the round alive (the source's recommended option (i)). Owner-tunable.
- **Disconnect during betting** = a player who never locks → the same auto-spread applies and the round proceeds; **no void**. Both disconnect → auto-spread both, resolve; equal → replay (subject to the 10-replay cap).

## Open decisions

- **(b) Chip denomination — recommend a unit that divides 1,000 evenly, e.g. 10-chip increments** (100 placeable units). Owner-tunable; affects only UI granularity.
- **(c) Same-bet collisions** (both betting the same number/area) are **allowed and self-resolving** — no special handling.

## Mapping to the game-module contract

A `roulette` module, no core branch (invariant #5):

- **`init(players, rng)`** — credit 1,000 chips each; enter BETTING with a 30 s deadline; fix the spin pocket from the seed (hidden until REVEAL).
- **`legalMoves(player)`** — while BETTING and unlocked: allocate/adjust chips and `lock`; otherwise `[]`.
- **`applyMove(player, allocation+lock, ctx)`** — validate the **full-stack** rule (sum == 1,000), or apply the auto-spread on timeout; record the allocation (kept hidden). When both are locked (or both timed out) → reveal, apply the seeded pocket, resolve stacks.
- **`isTerminal`** — true only on a **decisive** (unequal) result; an equal result is **not** terminal — the match re-deals a fresh round within the same escrow (internal replay, like Blackjack/Mines).
- **`outcome`** — higher stack → `win`; equal → `draw` (loops to replay under the policy above).
- **`viewFor`** — hides the opponent's allocation until both have locked, and the spin pocket until SPIN; reveals both afterwards. This is what makes hidden simultaneous betting fair (no last-mover advantage).
- **`forfeit` (disconnect in betting)** — auto-spread and proceed; never void.
- **Determinism** — the pocket derives from the seed; allocations and the auto-spread are deterministic; a replay reproduces the round exactly.
- **Chips stay inside the module.** The core settles only the play-money pot per the `win` / `draw` / `void` outcome — it never sees chips.
- **Shared timer capability** — the 30 s betting deadline reuses the generic scheduled-timer infra (chess / Crash / Blackjack / Mines), not a roulette-specific timer.

## Fee, ranking, stakes, provably-fair (aligned)

- **Rake:** `GameMeta.rakeRate` = **2.5%** of pot, on the decisive result only; none on a replay.
- **Ranking:** `net_winnings` (chance game).
- **Stake range:** the game's `BetRules` (play-money credits).
- **Provably-fair — CORRECTION/alignment:** v1 ships on **seeded-RNG determinism** (aligned with Blackjack/Mines). The full server-seed + client-seed + nonce reveal scheme the source describes is the same **roadmap** story, not v1.

## Interface (basic is fine)

A betting board for the reduced bet set, a chip-allocation control with a clear **"full stack allocated"** validation/indicator, a lock button, the spin, and the result. Reuse the **game-hub template** chrome (slot pills, play panel, open games, related, footer). The deliverable is the **fair zeroless logic + the full-stack rule**, not bespoke wheel art.
