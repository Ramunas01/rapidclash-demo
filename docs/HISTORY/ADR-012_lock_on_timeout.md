# ADR-012 — "Lock, no move" primitive for the game-module timer contract

**Status: Accepted (Owner, 2026-09-11).** No changes requested to the design below. On open question 1 (does this need to generalize beyond Mines): Owner's ruling is no — the demo isn't expected to live long enough to add more games, so the design is not over-built for hypothetical future modules beyond what's proposed. Proceeding per the sequencing in "Once approved" below: (1) this contract addition on its own, reviewed and merged first; (2) T7's Mines-specific rewrite on top of it.

*Proposed by PM. Triggered by T7 (Mines engine rewrite to the new Designer-approved 5×5 ruleset — see `docs/NEW_DESIGN_MIGRATION.md` § "Canonical new Mines ruleset"). Flagged by Advisor as core-adjacent and fairness-sensitive, so it gets its own review pass before the Mines-specific implementation lands on top of it.*

## Problem

The new Mines ruleset removes early resolution: both players play their own round (tap until a mine, the clock, or all 22 safe tiles) to completion **independently**, then compare. Rule 10 is explicit: *"Remove the 4s auto-reveal entirely... nothing happens until the clock. Nothing in the engine may assume a minimum number of reveals per round."* The 30-second round clock is a cap on an idle/disconnected player, not a mechanic — when it expires, that player's round simply **ends with whatever gems they already have**, no reveal, no injected tap.

The core's per-player timer machinery (`packages/core/src/matchmaking.ts`) has exactly three modes today, and all three assume a move happens on expiry:

1. **`usesPlayerTimers`** (`meta.moveTimeoutMs` + `timeoutMove`) — today's Mines/Blackjack model. Resets on every move; `timeoutMove` **must** return a currently-legal `Move`, which `applyMove` then validates against `legalMoves`.
2. **`usesTimeControl`** (`meta.timeControl`) — Chess's cumulative flag-fall clock.
3. **`usesScheduledDeadlines`** (`scheduledDeadlines()` + `timeoutMove`) — Crash's absolute per-player auto-fire time. Same `timeoutMove`-must-return-a-legal-move constraint as mode 1, just with the deadline computed differently.

None of the three can express "the clock hit zero, lock this player, no move happened." Forcing it through `timeoutMove` (e.g. having Mines return some sentinel/no-op `Move`) would mean either (a) `applyMove` treats a no-op as a legal move, which pollutes `legalMoves`'s meaning and the `move_made`-style event contract for every reader of this module, or (b) `legalMoves` reports moves that aren't real, which every future maintainer of `mines.ts` has to know is a lie. Both are the kind of special-case `GAME_MODULE_INTERFACE.md` explicitly warns against ("a signal to evolve the contract deliberately, not to special-case the core").

**Six other modules share this same file** (Blackjack, Coinflip, Limbo, Keno, Roulette, RPS use `usesPlayerTimers`; Crash uses `usesScheduledDeadlines`) — any change here needs to be strictly additive and provably inert for all of them.

## Proposed design

Add one new optional module method, reusing the **existing** `scheduledDeadlines()` declaration mechanism (already generic, already used by Crash) rather than inventing a fourth parallel scheduling path:

```typescript
// packages/shared/src/game-contract.ts — additive, all fields optional

export interface GameModule {
  // ...unchanged...

  /** Alternative to `timeoutMove` for modules using `scheduledDeadlines`: when a
   *  player's declared deadline passes and the module implements this, the core
   *  calls it INSTEAD of timeoutMove+applyMove — no Move is synthesized or
   *  validated against legalMoves. Use when a timeout should silently end a
   *  player's turn/round with no action taken (as opposed to auto-acting for
   *  them). Must produce a state where this player's legalMoves is empty (so
   *  the sweep doesn't re-fire on them), and behaves exactly like applyMove
   *  otherwise: emits its own events (subject to the same redaction rule — see
   *  GAME_MODULE_INTERFACE.md's "nothing secret in an event"), and the core
   *  checks isTerminal/settles on the returned state same as any other apply. */
  lockOnTimeout?(state: GameState, playerId: PlayerId, now: number): ApplyResult;
}
```

**Core change**, `packages/core/src/matchmaking.ts`:

- `usesScheduledDeadlines` widens to accept either hook: `typeof mod.scheduledDeadlines === 'function' && (typeof mod.timeoutMove === 'function' || typeof mod.lockOnTimeout === 'function')`.
- In the sweep loop that currently does `mod.timeoutMove!(state, p, rng)` → `applyMove(...)`: if `mod.lockOnTimeout` is defined, call `mod.lockOnTimeout(match.state, p, now)` directly and use its returned `ApplyResult` in place of `applyMove`'s result (skipping `legalMoves` validation — there is no Move to validate). Everything downstream — `isTerminal` check, `settleMatch`, building the broadcast entry — is unchanged, because it already only depends on `ApplyResult` + `terminal`, not on how the state was produced. **`TimedOutMove`'s shape does not need to change.** The gateway already documents itself as move-agnostic here ("broadcasts it like any other move: relay state + events, then match.end if terminal, else match.your_turn").
- No change to modes 1 or 2, no change to any of the six modules that don't declare `lockOnTimeout`. `usesScheduledDeadlines(mod)` stays `false` unless a module explicitly opts into scheduled deadlines at all — Crash keeps using `timeoutMove` exactly as today, since it never sets `lockOnTimeout`.

**What Mines does with this** (implementation detail, for T7 itself, not this ADR): `scheduledDeadlines()` returns `{ [playerId]: matchStartedAt + 30_000 }` for each player who hasn't locked yet (mirrors Crash's existing pattern of gating on `legalMoves(state, p).length > 0`, which the core sweep already re-checks anyway). `lockOnTimeout(state, playerId, now)` sets `board.locked = true` at the player's current score and pushes the module's own existing `player_locked` event (`{playerId, reason: 'timeout', score}`) — this is the same internal lock/event Mines already uses today for a mine-bust or a perfect clear, just reached from the clock instead of a tap.

## Why not the alternatives

- **Force it through `timeoutMove`/`applyMove` with a sentinel move** — rejected above: corrupts the meaning of `legalMoves`/`Move` for this module and anyone reading it later.
- **A Mines-only branch in `matchmaking.ts`** — rejected outright; `GAME_MODULE_INTERFACE.md`'s stated purpose is exactly to prevent this ("Adding a game means implementing this interface... It must require zero changes to the core").
- **A brand-new 4th timer mode with its own deadline-declaration method** — considered, but `scheduledDeadlines()` already does exactly what Mines needs (per-player absolute deadline, re-checked against live `legalMoves` each sweep); duplicating it for one extra field would be the abstraction `GAME_MODULE_INTERFACE.md` warns against evolving carelessly. Reusing it and only replacing the *action-on-expiry* half is the smaller diff.

## Blast radius

Purely additive to the shared contract (`GameModule`/`GameMeta` types) and to one conditional inside `matchmaking.ts`'s existing sweep function. Every one of the six other modules sharing this file is unaffected: none declares `lockOnTimeout`, so `usesScheduledDeadlines`'s widened check still resolves through their existing `timeoutMove` path unchanged, and the sweep's new branch is simply never taken for them. No gateway change. No change to any other module's tests.

## Open questions for Owner sign-off

1. **Does this generalize correctly, or is there a Mines-specific wrinkle I'm not seeing?** (e.g., does any other planned future game need "lock, no move" behavior, which would argue for naming/shaping this more generally now rather than after a second user shows up?)
2. **Is reusing the `player_locked` event name/shape (already Mines' own internal convention) the right call, or should a timeout-induced lock be visibly distinguished from a bust/clear lock in the event payload** (`reason: 'timeout'` vs `'bust'`/`'cleared'` is already proposed above — confirming that's sufficient, not asking for more).
3. Any objection to doing this as one ADR + one core PR (contract + `matchmaking.ts` change, reviewed and merged on its own, with the existing 27 Mines tests untouched since Mines hasn't switched to it yet) **before** T7's Mines-specific rewrite lands on top of it? (This is Advisor's suggested sequencing — flagging it here explicitly since it affects how the work gets split into PRs.)

Once approved, T7 proceeds in two PRs: (1) this contract addition, standalone, reviewed on its own; (2) the Mines `decide()`/`resolve()`/`board.ts` rewrite to the new ruleset, built on top of an already-merged (1).
