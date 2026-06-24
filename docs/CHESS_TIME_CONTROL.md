# Chess Time Control — spec (v1)

Turns the `CHESS_TIME_CONTROL_ANALYSIS.md` (#103) into a build authority. Adds **cumulative per-player game clocks** to chess (Bullet 1 min / Blitz 5 min / Rapid 10 min). This is a **functional feature spanning core + protocol + client** — not presentation — so it is specified before any code.

The guiding decision: this is **a second mode of the per-player-timer capability #91 already built**, not a new parallel timer. The core gains one generic notion of "a player's clock," declared in `GameMeta`, with two models — *per-move reset* (existing: Blackjack/Mines) and *cumulative budget* (new: chess) — and never a `if (gameId === 'chess')` branch (invariant #5).

## Invariants preserved

- **#2 server-authoritative.** Clocks are computed and enforced on the server from the `now` the core injects; the client only *displays* counting clocks. A client cannot win or save time by lying.
- **#3 ledger.** A loss on time settles exactly like any other decisive loss — atomic, idempotent, rake once.
- **#5 no game-specific core branch.** The clock is a declared-metadata capability applied generically; chess is merely the only game that declares it today.

## The clock model

Each player has a **total time budget** for the whole game. It ticks down **only while it is that player's turn**, persists across moves (does not reset), and at **0 the player loses on time**. Sudden-death for v1 (no increment), but the field carries an increment so Fischer can be switched on later as config, not a redesign.

Three presets, **declared by the chess module** (so the picker is data-driven, not hard-coded in the client):

| id | label | base | increment (v1) |
|----|-------|------|----------------|
| `bullet1` | Bullet · 1 min | 60 000 ms | 0 |
| `blitz5` | Blitz · 5 min | 300 000 ms | 0 |
| `rapid10` | Rapid · 10 min | 600 000 ms | 0 |

Picker order is **shortest-first (Bullet → Blitz → Rapid)**, each rendered as a **two-line button** (large duration over a small name, e.g. "10 min" / "Rapid"). Default **selection** = `rapid10` (Rapid · 10 min).

## The eight decisions (resolved)

1. **Generic, not chess-specific (Q1) — CONFIRMED.** Declare it in `GameMeta`; apply it through the same per-player-timer subsystem as #91. Concretely, add an optional field, mutually exclusive with `moveTimeoutMs`:
   ```ts
   // GameMeta
   timeControl?: {
     options: { id: string; label: string; baseMs: number; incrementMs: number }[];
     defaultId: string;
   };
   ```
   The core's per-player-timer machinery gains a **cumulative mode**: per-move mode reschedules the full `moveTimeoutMs` each move (existing); cumulative mode schedules the player's *remaining budget* and drains it. One subsystem, two declared models. A game declares `moveTimeoutMs`, or `timeControl`, or neither — never both.
2. **Matchmaking dimension (Q2) — CONFIRMED: pair on (game, stake, time-control).** The FIFO key becomes `${gameId}:${stake}:${timeControlId}`. **Untimed games use the sentinel `none`** (`rps:10:none`), so the 3-part key is uniform and needs no branch. `joinQueue`, the open-challenge entry, and the feed all carry `timeControlId`; the row reads e.g. **"Chess · Blitz 5 min · 10¢"**. ⚠️ **Fragmentation flag:** a third pairing dimension splits the chess pool three ways — at low population this worsens the empty-lobby problem the open-challenges feed and bot crowd exist to fight. Mitigations (all required): keep to **three** presets, **show the control on every challenge row** so a player picks a matching one, and have the **demo bot crowd seed the Default (10-min) control** so at least one live chess control is never empty.
3. **Scope (Q3) — CONFIRMED: chess only.** Coinflip/RPS are instant; Blackjack/Mines use per-move timers. Only chess declares `timeControl`. A "time" chip on other games in the reference UI is cosmetic and dropped.
4. **Increment (Q4) — CONFIRMED: sudden-death for v1.** `incrementMs: 0` on all presets. The field exists so Fischer increment is a later config change, not a schema change.
5. **Timeout resolution (Q5) — CONFIRMED: loss on time = a normal decisive loss.** When the active player's budget hits 0 with no move, the core resolves the match through the module's **forfeit/loss path** (`forfeit(state, flaggedPlayer)` → opponent wins). Settlement is identical to any loss: winner gets `pot − rake`, rake applied once, idempotent. **v1 simplification:** loss-on-time is *always* a loss. The FIDE nuance (a flag is a **draw** if the opponent has insufficient material to mate) is **roadmap**, not v1 — flagged here so it's a conscious omission, and `chess.js` can detect insufficient material when we add it.
6. **Interaction with the per-match deadline (Q6) — CONFIRMED: the cumulative clock governs.** For a clocked game the existing per-move `MATCH_TURN_TIMEOUT_MS` (120 s) is **off** — a 3-minute think in a 10-minute game is legal. The only in-game time limit is the budget. The **socket-close forfeit stays as an abandonment backstop**: a player whose socket closes and does not return within the existing grace is forfeited, so a walk-away doesn't force the opponent to wait out the entire budget. Reconcile with the `usesPlayerTimers` / close-forfeit logic from #91/#94: clock = in-game time; close-forfeit = abandonment.
7. **Reconnect / resume (Q7) — CONFIRMED.** Clocks are authoritative and **a disconnected player's clock keeps draining** (same principle as the per-move timers). `match.resume` returns the authoritative remaining budgets for both players; the client re-renders and resumes ticking the active one. (The close-forfeit backstop in Q6 prevents an indefinite wait.)
8. **Defaults / config (Q8) — CONFIRMED.** The three presets and the default live in the **chess module's `meta.timeControl`** (above), so they're a declared, owner-tunable capability the client reads — not a client constant.

## Mapping to the contract (for the programmer)

No new contract surface beyond the `meta.timeControl` field and the core's cumulative timer mode:

- **State.** Match state carries each player's `remainingMs`, which clock is `active`, and the `activeSince` (`now`) of the current turn. All derived from the injected `ctx.now` — the module **never reads the clock** (determinism rule holds).
- **`applyMove(state, move, ctx)`** — on a legal move by the active player P: drain `P.remainingMs -= (ctx.now - activeSince)`; add `incrementMs` (0 in v1); switch `active` to the opponent; set `activeSince = ctx.now`. Reject if P is flagged.
- **Core timer subsystem (cumulative mode).** Schedule a wake for the active player at `activeSince + remainingMs`. A move before the wake → reschedule for the opponent after the switch. The wake firing (no move) → the active player is flagged → core resolves via the loss-on-time path (Q5). This reuses #91's per-player scheduling; only the scheduled interval differs (remaining budget vs a fixed per-move value).
- **`viewFor`** — both clocks are public (chess is perfect-information); no redaction. The clock adds no hidden state.
- **Determinism.** The flag is a real-time event, so the core records the timeout with its `now` in the match log; a replay feeds the same `now` and reproduces the identical flag and outcome — exactly as per-move timeouts are already recorded.

## Ranking (not in the analysis — Advisor note)

Chess ranks by **ELO** regardless of control. **v1: one chess ELO pool across all three controls** (simplest). Real platforms keep separate rapid/blitz/bullet ratings — recorded as roadmap, not built now.

## Chess draws (boundary with time-loss)

Normal chess draws (stalemate, threefold, 50-move, insufficient material, agreement) are **legitimate terminal `draw` outcomes → refund both, no rake** (the RPS/Coinflip draw policy) — **not** the replay-until-winner policy of Blackjack/Mines. A flag is a *loss*, not a draw (subject only to the roadmap insufficient-material exception in Q5). Full draw detection belongs to the chess-rules spec (`chess.js`); noted here only where it meets the clock.

## Client (display only)

A time-control **picker** (Bullet / Blitz / Rapid, shortest-first, two-line buttons) on the chess hub's challenge-creation step, sourced from `meta.timeControl.options`. **Both players' clocks** rendered, the active one ticking, with a low-time warning under ~10 s. The display animates the server's authoritative `remainingMs`; it never decides anything (invariant #2). Minor client/server drift from latency is acceptable for the demo — the server is truth.

## Sequencing (parallel-safe, per the analysis)

```
parallel:  [GameHub template + RPS]   ‖   [this clock feature: core → protocol/matchmaking → client]
then:      Blackjack hub + Mines hub  (need only the template)
last:      Chess hub                  (needs the template AND this clock — it's what shows the clocks)
```

The clock feature will likely be **two PRs** — (1) core cumulative-timer mode + `meta.timeControl`, (2) protocol/matchmaking key + `joinQueue`/feed carrying `timeControlId` + the client picker/display — to keep each reviewable. The Chess hub is built last because it is the only consumer that surfaces the clocks.
