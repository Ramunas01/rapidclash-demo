# Chess Time Control — Analysis & open questions (PM → Advisor)

Stakeholders want **chess time controls**: a per-player game clock, selectable — **default 10 min, Blitz 5 min, Bullet 1 min**. We don't have this. This doc analyzes the gap and surfaces the decisions an Advisor spec (`CHESS_TIME_CONTROL.md`) needs to settle **before** any code. **This is a functional feature (core + protocol + client), not presentation** — so it must not be improvised.

## What "10 / 5 / 1 min" means

A **cumulative chess clock**: each player has a total time budget for the whole game; it ticks down **only on that player's turn**, accumulates across moves, and at **0 the player loses on time**. This is the standard chess model (Bullet ≈ 1 min, Blitz ≈ 3–5 min).

**It is NOT the timer we already have.** The `#91` capability (`meta.moveTimeoutMs` + `timeoutMove`) is a **per-move** timer that **resets every move** (Blackjack 10s/move auto-stand, Mines 5s/move auto-reveal). A cumulative clock is a different mechanism: a per-player running budget, not a per-move reset.

## Current state (what's there to build on)

- **Chess has no clock.** It relies on the generic per-match move deadline `MATCH_TURN_TIMEOUT_MS` (default 120s, `matchmaking.ts:232`) — a single per-move deadline whose timeout makes the laggard forfeit (`sweepStaleMatches`). There is no per-player time budget.
- **Matchmaking pairs on `(gameId, stake)`** — FIFO queue keyed `${gameId}:${stake}` (`matchmaking.ts:248`). `joinQueue(playerId, gameId, stake)`; the WS client is `joinQueue(gameId, stake)`. The open-challenge feed carries `gameId` + `stake`.
- **Server is authoritative for all timing** (invariant #2) — clocks live on the server; the client only displays.

## Why this spans three layers

1. **Core — a per-player cumulative clock.** New server-side capability: track each player's remaining budget, decrement the active player's clock during their turn, and on expiry resolve the match as a **loss on time** for that player. Recommend it be a **generic** capability declared in `GameMeta` (e.g. a clock/time-control field), applied generically — **no `if (gameId === 'chess')`** (invariant #5), exactly as `#91` generalized per-move timers.
2. **Protocol / matchmaking — time control is a per-match parameter.** The chosen control (10/5/1) is picked at challenge creation and becomes a **third matchmaking dimension**: players must pair on **(game, stake, time-control)**, so the FIFO key, `joinQueue`, the open-challenge entry, and the feed all need to carry it (a "Chess · 5 min · 10¢" challenge). This is a protocol + matchmaking change.
3. **Client — picker + display.** A time-control selector (Default / Blitz / Bullet) on the chess hub's challenge-creation step, and **both players' clocks** rendered counting down (active clock ticks). Display only; the server enforces.

## Open questions for the spec (PM recommendations in **bold**)

1. **Generic vs chess-specific clock.** Make the cumulative clock a **generic core capability declared in `GameMeta`** (so it could later apply to any turn-based game), not a chess branch? **Recommend: generic** (invariant #5), even though chess is the only consumer now.
2. **Matchmaking dimension.** Confirm players pair on **(game, stake, time-control)** — the FIFO key extends to `${gameId}:${stake}:${timeControl}`, and the open-challenge feed/queue/`joinQueue` carry the control. **Recommend: yes** (otherwise a Bullet player could be matched into a 10-min game).
3. **Scope — which games get a time control?** Cumulative clocks only make sense for **chess** (Coinflip/RPS are instant; Blackjack/Mines already use per-move timers). The reference UI may show a "time" chip on every game, but the 10/5/1 values are chess. **Recommend: chess-only for cumulative clocks for now;** revisit if another long turn-based game lands.
4. **Increment?** 10/5/1 as **sudden-death** (no increment), or with a Fischer increment (e.g. +2s/move)? **Recommend: sudden-death for v1** (simplest); add increment later if wanted.
5. **Timeout resolution.** Clock at 0 → that player **loses on time** (maps to the chess module's forfeit/loss path), server-enforced and idempotent like all settlement. Confirm the rake/settlement treats a time-loss as a normal loss.
6. **Interaction with the existing per-match deadline.** Does the cumulative clock **replace** chess's current `MATCH_TURN_TIMEOUT_MS` move deadline, or coexist? **Recommend: for clocked games the cumulative clock governs;** keep the per-match deadline only as a disconnect backstop (and reconcile with the `usesPlayerTimers`/close-forfeit logic from #91/#94).
7. **Reconnect/resume.** On `match.resume`, the server replays the authoritative remaining clocks (a disconnected player's clock keeps running — same principle as our other timers). Confirm.
8. **Defaults / config.** Default control = 10 min; the three presets named Default/Blitz/Bullet. Owner-tunable? Stored where (a `GameMeta` field, or a fixed enum)?

## Invariants to preserve

- **#2 server-authoritative** — clocks computed and enforced server-side; the client display is advisory only.
- **#5 no game-specific core branch** — the clock is a declared-metadata capability, applied generically.
- **#3 ledger** — a loss-on-time settles exactly like any loss (atomic, idempotent, rake applied once).

## Sequencing (parallel-safe)

This (core + protocol + client) and the **`GameHub` template + RPS** (pure `apps/web` presentation) touch different code, so they **run in parallel**. But the **Chess hub** (the per-game hub instance) needs **both** the template **and** this clock feature — so:

```
parallel:  [GameHub template + RPS]   ‖   [chess time-control spec → build]
then:      Blackjack hub + Mines hub  (ready once the template lands)
last:      Chess hub                  (needs template + clock; shows the clocks)
```
