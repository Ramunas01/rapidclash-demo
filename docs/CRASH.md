# Crash — PvP v1 (confirmed)

The PvP redefinition of Crash, per the conversion thesis (`CHARTER.md` / `GAME_REDEFINITION.md`). House Crash is solo: a multiplier climbs, you cash out before a random crash, the house pays. Here there is **no house** — two players ride the **same** rocket and the one who holds nerve to the higher altitude *without crashing* wins the other's stake. It is the first redefinition built from scratch following the recipe, and the first **continuous** game (a climbing altitude rather than discrete turns).

## Invariants preserved

- **#1 humans vs humans, never the house.** Both players ride **one shared, seeded crash altitude** — the same risk for both, no operator edge. The platform sets the crash and adjudicates; it never takes a side or pays anyone. This shared-randomness symmetry is exactly what converts a house game into a fair duel (recipe step 2).
- **#2 server-authoritative + redaction.** The crash altitude, the climb, and each player's ejection live on the server. A player's own ejection is theirs; the **opponent's ejection (and any pre-set auto-eject) is hidden until the round is terminal** (`viewFor`). The shared climbing altitude is public.
- **#4 play-money.** Stakes and settlement render in credits.

## Gameplay (v1)

**Stake & pot.** Both players stake equally into a shared pot, awarded to the winner.

**The rocket.** On launch the server fixes a **hidden crash altitude `C`** (seeded random, drawn from a capped range so a round lasts only seconds to a few tens of seconds). A single rocket **climbs**, its altitude rising over time on a deterministic curve, shown live in metres. Both players watch the **same** climb.

**Ejecting.** Each player ejects exactly once, by either:
- a **pre-set auto-eject altitude**, committed before/at launch (the rocket ejects them automatically when the climb reaches it), and/or
- a **live EJECT tap** during the climb.

Whichever comes first fires. A player's eject altitude is **hidden from the opponent** until the round resolves.

**Crash = bust.** If the climb reaches `C` before a player has ejected, that player **crashes** and banks **0**. Ejecting at altitude `A` (with `A < C`) banks `A`.

**Winner.** Higher **banked** altitude wins `pot − rake`:
- one banks, one crashes → the banker wins;
- both bank → higher altitude wins; equal → draw;
- both crash (neither ejected before `C`) → draw.

## The one design decision — why crashing must *bust* you

Your description floated a "safe auto-eject at a max altitude." I'd steer away from that, and it's worth one sentence on why: if reaching the ceiling safely banks you the ceiling, then **holding to the ceiling is always the best move** — both players do it, and every game is a draw. The tension only exists if holding too long can **cost you everything**. So the hidden crash that busts you (banking 0) is not a harsh add-on — it *is* the game. Your "eject before the expected crash" already implies it; this just makes it the rule. The "max altitude" survives as the **cap on how high `C` can be drawn** (bounding the round length), not as a safe landing.

## Draws & disconnect

- **Draw policy:** a draw (equal banks, or both crash) → **refund both, no rake** (the Coinflip/RPS policy — Crash is a fast chance game). *Owner may instead prefer replay-until-decisive like Blackjack/Mines; flagged.*
- **Disconnect:** a dropped player simply never ejects → they ride to `C` and **crash** (bank 0). No special void. Both disconnect → both crash → draw → refund.

## Mapping to the game-module contract

Satisfies the existing `GameModule` contract with **one shared core dependency** (no Crash-specific branch): the round needs **scheduled server-side timers** — a terminal at the crash time, and one per pre-set auto-eject — which is the same **generic per-player-timer / scheduled-event capability** chess and Blackjack/Mines already require. The climb itself needs **no server tick loop**: altitude is a deterministic function of elapsed time, and the server only records *events* (ejects) and fires the scheduled crash. (Consistent with `ARCHITECTURE.md`: "none need a tick loop.")

- **`init(players, rng)`** — draw the hidden crash altitude `C` from the seed (capped range); record `startedAt`; schedule the crash terminal at the time the curve reaches `C`; schedule any pre-set auto-ejects. State holds `C` (hidden), `startedAt`, and per-player `{ autoEjectAt?, bankedAt? }`.
- **`legalMoves(player)`** — `["eject"]` until that player has ejected/crashed, then `[]`. (A pre-set auto-eject is a launch-time setup, not a turn.)
- **`applyMove(player, "eject", ctx)`** — bank `altitude(ctx.now − startedAt)` if that is `< C`, else mark crashed (0). Uses the injected `ctx.now` — the module never reads the clock (determinism holds).
- **`isTerminal`** — true once both players have ejected or crashed. The scheduled crash event forces resolution for anyone still aboard.
- **`outcome`** — higher bank wins; equal or both-crash → draw (refund per policy).
- **`viewFor`** — public: the shared climbing altitude. Hidden until terminal: the crash altitude `C`, and the opponent's auto-eject setting and ejection. (A player sees their own ejection immediately.)
- **`forfeit` (disconnect)** — no eject → crash at `C`; do not void.
- **Determinism** — `C` and the curve derive from the seed; ejections are recorded with `ctx.now`; a replay reproduces the round exactly.

## Fee, ranking, stakes, provably-fair (aligned)

- **Rake:** per-game `GameMeta.rakeRate`; Crash is a chance game → **2.5%** of pot (like Coinflip/RPS), once on the decisive result.
- **Ranking:** `net_winnings` (chance game).
- **Stake range:** the game's `BetRules`.
- **Provably-fair:** seeded-RNG determinism first (aligned with Blackjack/Mines); the published-hash commit-reveal is the same roadmap story.

## Interface (basic is fine)

Per the brief, this needs only enough UI to make the point: a **climbing altitude readout**, an **EJECT** button (and an optional pre-set auto-eject field), and the round result. Reuse the **game-hub template** chrome unchanged — the slot pills (opponent above, you below), the play panel (stake + PLAY + Play-a-Friend), Open Games, related games, footer. The deliverable here is the **fair PvP logic**, not bespoke art — it demonstrates that the house-conversion recipe extends to a real-time game.

## Open decisions for the owner

- **Live-reveal variant (roadmap, not v1):** v1 hides the opponent's eject until terminal — a clean blind nerve duel. A more thrilling variant *reveals* each eject the moment it happens, turning it into a game of chicken (neither wants to eject first and hand the other a target, but holding risks the shared crash). Symmetric and fair, but more to build and prone to both-crash draws — deferred.
- **Draw policy:** refund (recommended) vs replay-until-decisive.
- **Crash distribution & cap:** the shape and ceiling of `C` (tunes round length and how often both crash) — a config value, owner-tunable.
