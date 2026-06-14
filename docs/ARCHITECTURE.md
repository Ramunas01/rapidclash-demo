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

**Demo deployment** — a single Cloud Run service, `min-instances = 1` so WebSocket connections are not dropped by cold starts, holding live state in memory and durable state in a small attached database. Static client on Firebase Hosting. This is cheap and enough to demo.

**Scalable target** — Cloud Run (autoscaled) + Memorystore (Redis) for live session/matchmaking state and pub-sub fan-out across instances, Cloud SQL (Postgres) for the ledger and match history, Firebase Hosting for the PWA. Build toward this shape; do not pay for it during the demo.

> Verify the current Cloud Run per-connection WebSocket timeout when we commit to deploy; it has historically been capped (on the order of tens of minutes), which is fine for these short matches but should be a conscious decision, not a surprise.

## Decision log (ADRs)

Each accepted decision is recorded here. New significant decisions are added as a PR to this file, reviewed like code.

- **ADR-001 — TypeScript monorepo.** Accepted. Shared types across client/server outweigh the owner's greater familiarity with Python, since the owner is not coding and UX/correctness is the priority.
- **ADR-002 — Server-authoritative game logic with injected seeded RNG.** Accepted. Required for fairness, auditability, and resistance to client tampering.
- **ADR-003 — Append-only ledger; balance is derived; settlement idempotent.** Accepted. See `WALLET_LEDGER.md`.
- **ADR-004 — Games as plug-in modules behind a fixed contract; no core changes to add a game.** Accepted. See `GAME_MODULE_INTERFACE.md`.
- **ADR-005 — Demo on single Cloud Run instance; Redis + Postgres deferred to scale phase.** Accepted.
- **ADR-006 — WS for in-match traffic, REST for everything else.** Accepted. No game needs a real-time loop.
