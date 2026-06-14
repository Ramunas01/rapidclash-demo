# Game Module Interface — the plug-in contract

This is the keystone of the whole system. A game is a **pure, server-side, deterministic state machine**. The core engine knows nothing about a game's internals — only the contract below. Adding a game means implementing this interface and registering it. It must require **zero changes to the core**.

If a future game cannot be expressed through this contract, that is a signal to evolve the contract deliberately (via an ADR), not to special-case the core.

## The contract

```typescript
// packages/shared/src/game-contract.ts

export type PlayerId = string;

/** Opaque to the core. Must be JSON-serializable. */
export type GameState = unknown;
export type Move = unknown;

/** Injected by the core. Seeded server-side and recorded with the match,
 *  so a match is fully reproducible. Modules MUST use this and never
 *  Math.random, Date.now, or any other ambient nondeterminism. */
export interface Rng {
  /** uniform float in [0, 1) */
  next(): number;
  /** integer in [min, max] inclusive */
  int(min: number, max: number): number;
}

export type RankingType =
  | { kind: "elo"; k: number }      // skill games, e.g. chess
  | { kind: "glicko" }
  | { kind: "net_winnings" }         // chance games, e.g. coinflip
  | { kind: "win_rate" };

export interface BetRules {
  minStake: number;
  maxStake: number;
  /** both players commit an equal stake into escrow (true for all demo games) */
  symmetricStake: boolean;
}

export interface GameMeta {
  id: string;                 // "rps", "coinflip", "chess", ...
  displayName: string;
  minPlayers: number;         // 2 for every demo game
  maxPlayers: number;
  ranking: RankingType;
  bet: BetRules;
  averageDurationSec: number; // UX/matchmaking hint
}

export interface MoveContext {
  playerId: PlayerId;
  now: number;                // server time in ms, passed in — do not read the clock yourself
}

export interface GameEvent {
  type: string;               // e.g. "move_made", "round_revealed"
  payload: unknown;           // already safe to broadcast to both players
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];        // the core relays these to clients
}

/** Outcome is expressed RELATIVE to the pot. The core applies the fee and
 *  writes the ledger. A module never sees or touches a wallet. */
export type Outcome =
  | { type: "win"; winner: PlayerId }
  | { type: "draw" }          // pot split, fee may or may not apply (core policy)
  | { type: "void" };         // refund both in full, no fee (e.g. abandoned)

export interface GameModule {
  meta: GameMeta;

  /** Build the starting state for these players using the injected rng. */
  init(players: PlayerId[], rng: Rng): GameState;

  /** Moves this player may legally make right now. Empty = not their turn / nothing to do. */
  legalMoves(state: GameState, playerId: PlayerId): Move[];

  /** Apply a move. Must reject anything not in legalMoves (throw IllegalMove). */
  applyMove(state: GameState, move: Move, ctx: MoveContext): ApplyResult;

  /** Is the match over? */
  isTerminal(state: GameState): boolean;

  /** Final result. Only defined when isTerminal(state) is true. */
  outcome(state: GameState): Outcome;

  /** Per-player redacted view. The opponent's hidden information
   *  (concealed RPS move, face-down cards) MUST be stripped here so it
   *  never leaves the server. Default for perfect-information games
   *  (chess): return state unchanged. */
  viewFor(state: GameState, playerId: PlayerId): GameState;

  /** What happens if a player abandons/times out mid-match. The core calls
   *  this to get a terminal state; typically the remaining player wins,
   *  or void if it was pre-first-move. */
  forfeit(state: GameState, quitter: PlayerId): GameState;
}
```

## Lifecycle, as the core drives it

1. Two players are matched and both stakes are escrowed (core).
2. `init(players, rng)` → starting state. The seed is stored with the match.
3. Loop: client sends a move → core checks it is in `legalMoves` → `applyMove` → broadcast `events` and the per-player `viewFor` states → check `isTerminal`.
4. On terminal: `outcome(state)` → core settles the pot (winner credit minus fee, or split, or refund) as one idempotent ledger transaction → core updates the leaderboard using `meta.ranking`.
5. On disconnect/timeout: `forfeit(state, quitter)` → settle as above.

## Determinism rule (do not skip)

Two replays of the same match — same seed, same ordered moves — must produce byte-identical states and the same outcome. This is enforceable in tests and is the property that makes a chance game auditable and a malicious client pointless. Any module reaching for `Math.random` or `Date.now` breaks it and will fail review.

## Worked example — RPS

- `meta`: `{ id: "rps", minPlayers: 2, maxPlayers: 2, ranking: { kind: "win_rate" }, bet: { minStake: 1, maxStake: 100, symmetricStake: true }, averageDurationSec: 10 }`
- `init`: state `{ choices: {} }` — empty, both players yet to choose.
- `legalMoves`: if this player has not chosen, return `["rock","paper","scissors"]`; else `[]`.
- `applyMove`: record the choice. Emit a `move_made` event that says *that* a player moved, **not what they chose**.
- `viewFor`: until both have chosen, redact the other player's choice entirely; at terminal, reveal both.
- `isTerminal`: both players have chosen.
- `outcome`: standard RPS resolution; equal choices → `draw`.
- `forfeit`: if the other player had already chosen, they win; otherwise `void`.

RPS exercises every part of the contract — hidden information, redacted views, draw handling, forfeit — which is exactly why it is the first slice.
