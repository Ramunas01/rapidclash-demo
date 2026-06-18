# Architecture

## Stack

TypeScript end to end, in a monorepo.

| Layer | Choice | Why |
|-------|--------|-----|
| Language | TypeScript everywhere | Game-state and protocol types are written once in `packages/shared` and imported by both client and server. In a multiplayer system this single fact removes a whole class of desync and validation bugs. |
| Server | Node, WebSocket for in-match push + REST/HTTP for the rest | All five games are turn-based or instant — none need a tick loop. WS gives us low-latency turn delivery; REST covers auth, wallet reads, leaderboard. |
| Client | React, built as a PWA | Runs in any phone browser, installable, no app store. The owner prioritised user experience over implementation convenience; the PWA path is the fastest route to a credible handset demo. |
| Live state | In-memory for the demo → Redis (Memorystore) later | A single server instance can hold sessions and matchmaking in memory for the demo. Redis is the seam for when we scale past one instance. |
| Durable state | SQLite for the demo → Postgres (Cloud SQL) later | The ledger and match history must outlive a process restart. Start file-backed, migrate to Postgres with the same schema. |

This is a recommendation that the slice will validate. If TypeScript proves a poor fit during the RPS slice, that is the moment to revisit — not after five games exist.

## System shape

```
  Phone browser (React PWA)
        │  REST: register, login, wallet, leaderboard
        │  WS:   join lobby, make move, receive state
        ▼
  ┌─────────────────────────────────────────────┐
  │  Node server (apps/server)                    │
  │                                               │
  │   REST handlers ─┐                            │
  │                  ├─► CORE (packages/core)     │
  │   WS gateway ────┘     • identity / sessions  │
  │                        • wallet + ledger      │
  │                        • matchmaking + lobby  │
  │                        • match orchestration  │
  │                        • settlement           │
  │                        • leaderboard          │
  │                              │                │
  │                              ▼                │
  │                   GAME MODULES (packages/games)│
  │                   each = the plug-in contract  │
  └───────────────┬───────────────────────────────┘
                  ▼
          live state (memory → Redis)
          durable state (SQLite → Postgres)
```

The core orchestrates; game modules decide rules and outcomes; the core never reaches inside a module and a module never touches the wallet. Both rules are enforced by the contract, not by good intentions.

## Core principles (with teeth)

- **Server-authoritative & deterministic.** Game modules receive a seeded RNG from the core and must not call `Math.random` or read the clock directly. Given the same seed and the same moves, a match is fully reproducible — which is what makes a chance game auditable and a cheating client harmless.
- **Hidden information is redacted server-side.** A module exposes a per-player view (`viewFor`) so a client literally never receives the opponent's concealed move or cards. RPS reveals both choices only at terminal.
- **Money moves only through the ledger.** Game modules return *relative* payout instructions ("player X wins the pot", "draw"); the core applies the fee and writes the ledger entries. No other code path may write money.
- **Idempotent settlement.** Every settlement is keyed by match id. Replaying it is a no-op. This is what makes reconnects safe.

## Cloud target (Google Cloud)

**Demo deployment** — a single Cloud Run service that serves the API, the WebSocket, **and** the built PWA on one origin (no Firebase Hosting, no second service for the demo). Live state is in memory; the database is an ephemeral local SQLite file that resets on instance recycle (accepted for the demo — see ADR-009). `min-instances = 1` while demoing keeps WebSocket connections warm; `max-instances = 1` is required, because in-memory state and a local file do not survive scale-out. Cheap and enough to demo.

**Scalable target** — Cloud Run (autoscaled) + Memorystore (Redis) for live session/matchmaking state and pub-sub fan-out across instances, Cloud SQL (Postgres) for the ledger and match history, Firebase Hosting for the PWA. Build toward this shape; do not pay for it during the demo.

> The Cloud Run per-connection WebSocket timeout is capped at 60 minutes (set via `--timeout 3600`). Matches are far shorter and `match.resume` reconnects on timeout, so this is a non-issue. See `DEPLOY.md`.

## Decision log (ADRs)

Each accepted decision is recorded here. New significant decisions are added as a PR to this file, reviewed like code.

- **ADR-001 — TypeScript monorepo.** Accepted. Shared types across client/server outweigh the owner's greater familiarity with Python, since the owner is not coding and UX/correctness is the priority.
- **ADR-002 — Server-authoritative game logic with injected seeded RNG.** Accepted. Required for fairness, auditability, and resistance to client tampering.
- **ADR-003 — Append-only ledger; balance is derived; settlement idempotent.** Accepted. See `WALLET_LEDGER.md`.
- **ADR-004 — Games as plug-in modules behind a fixed contract; no core changes to add a game.** Accepted. See `GAME_MODULE_INTERFACE.md`.
- **ADR-005 — Demo on single Cloud Run instance; Redis + Postgres deferred to scale phase.** Accepted.
- **ADR-006 — WS for in-match traffic, REST for everything else.** Accepted. No game needs a real-time loop.
- **ADR-007 — The core ranks generically by the `RankingType` each module declares.** Accepted (issue #36). Clarifies invariant #5: the prohibition is on *game-specific* core code (`if (gameId === …)`), not on the core acting generically on contract-declared metadata. The leaderboard dispatches on `meta.ranking.kind` — one strategy per kind, no per-game logic. The previous hardcoded `win_rate` was the latent bug (it ignored the module's declared ranking), surfaced by Coinflip; the fix is the core honoring the contract, not a special case.

  **`net_winnings` is defined from the ledger** — the single source of money truth, identical to the per-match P&L in `ADMIN.md`. For a player and a game, sum the player's **signed** ledger amounts over entries whose `match_id` belongs to that game: that set is exactly `BET_ESCROW` (already negative), `SETTLE_WIN`, and `SETTLE_REFUND`. `GRANT`/`ADMIN_CREDIT` are excluded automatically (null `match_id`); `RAKE` is excluded automatically (it lands on the `PLATFORM` account, never a player). Because amounts are already signed, this is a single sum — do **not** subtract escrow a second time. The `PLATFORM` account never appears on a leaderboard. Rake makes a pure-chance leaderboard sum to a net negative across players; that is correct, not a bug.

  Implementation note: the leaderboard return type generalizes beyond `WinRateEntry` to a common shape (`rank`, `playerId`, `displayName`, a sort `score`, and a `kind` tag) with kind-specific detail, since a net_winnings row shows an amount rather than a win rate.
- **ADR-008 — Open-challenges lobby (a visible order book over the existing queue).** Accepted. To counter the empty-lobby "fuzziness" at low player counts, the stake screen shows resting bets a player can take with one tap. This is a **visibility + explicit-claim layer over the existing `(gameId, stake)` queue** — it changes no invariant and no money flow. The typed-amount path is unchanged (FIFO auto-match, as previously designed); the list is purely optional.
  Key properties: claims are **atomic** (concurrent takers → exactly one match, losers uncharged); expiry is **server-authoritative** with a uniform platform TTL and escrow refunded on sweep; the owner's `waiting` event carries `expiresAt` so they see their own countdown. Because the TTL is uniform, **oldest-first FIFO is identical to soonest-to-expire-first**, so no separate priority queue is needed; a separate `expiresAt` sort is only required if per-bet custom durations are ever added (deferred). The feature lives in core matchmaking, so it is generic across all games. See `SLICE_OPEN_CHALLENGES.md`.
  Deferred production risk recorded here: visible usernames plus pick-your-opponent is a collusion / match-fixing surface once real value is involved (and a mild "who's online" disclosure). Acceptable for the demo; flagged for the production phase.
- **ADR-009 — Demo deployment: a single Cloud Run service.** Accepted. Concretises ADR-005 into demo config. **One** Cloud Run service serves the API, the WebSocket, and the built PWA on a single origin (no CORS, no second deploy, Firebase Hosting deferred to the scale phase). Region `us-central1` (free-tier eligible). `--max-instances=1` is mandatory because match sessions live in memory and the database is a local file — neither survives horizontal scale-out; `--min-instances=1` while actively demoing (keeps a WebSocket-warm instance, costs a few $/month, memory-only), `0` otherwise (free, accepts cold-start reconnects). The 60-minute WS request cap is a non-issue — matches are short and `match.resume` already reconnects. **SQLite is ephemeral on Cloud Run** and resets on instance recycle/redeploy; this is accepted for the demo because it aligns with the wipe-to-reset policy (`ADMIN.md`). Durable Cloud SQL (Postgres) and Redis are the scale-phase upgrade, not built now. `ADMIN_PASSWORD` via Secret Manager. A billing **budget alert is mandatory** before first deploy. See `DEPLOY.md`.
- **ADR-010 — The demo bot crowd is a presentation aid, never production liquidity.** Accepted. A small set of clearly-labelled (`🤖`-prefixed) automated clients may run during demos to populate the open-challenges feed, so a presenter/investor can immediately find and play a match. Mechanically they are ordinary clients on the same REST+WS API as any human — there is no "play the bot" path in the core, so invariant #1 ("humans vs humans, never the house") stays mechanically true and **no server change is required**. **Hard boundary:** demo-only. Platform-operated bots that players bet against would, with real value, be the house wearing a robot costume — breaking invariant #1 and triggering gambling regulation. Bots are never a production liquidity mechanism. The harness lives outside the deployed app (e.g. `tools/bot-crowd/`) and is not shipped. See `DEMO_PRESENTATION.md`.
