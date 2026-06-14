# RapidClash (demo)

A demonstration of an online, **human-versus-human** gaming platform. Players register, hold a play-money wallet, choose a game, place a stake, wait in a lobby for another human to join, play, and see their wallet and ranking move with the result. No real currency. No playing against the house.

This repository is the single source of truth for a small team of humans and AI assistants. Read the docs in this order before doing any work.

## Start here

1. [`docs/CHARTER.md`](docs/CHARTER.md) — what we are building and the non-negotiable rules.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — stack, system shape, cloud target, and decision log.
3. [`docs/GAME_MODULE_INTERFACE.md`](docs/GAME_MODULE_INTERFACE.md) — the plug-in contract every game satisfies. **The keystone document.**
4. [`docs/WALLET_LEDGER.md`](docs/WALLET_LEDGER.md) — how money is held and settled.
5. [`docs/PROTOCOL.md`](docs/PROTOCOL.md) — client ↔ server messages.
6. [`docs/SLICE_RPS.md`](docs/SLICE_RPS.md) — the first thing we build, end to end.
7. [`docs/ADMIN.md`](docs/ADMIN.md) — the operator/admin interface (visibility + demo testing tools).
8. [`docs/WORKING_AGREEMENT.md`](docs/WORKING_AGREEMENT.md) — how the team collaborates through GitHub.

## Team

| Role | Who | Owns |
|------|-----|------|
| Advisor | Claude (chat) | Specs, ADRs, the `docs/` directory |
| Project Manager | WSL AI agent | Roadmap, issues, acceptance criteria, PR review gate |
| Programmer | Claude Code (WSL) | Implementation under `apps/` and `packages/` |
| Owner | Ramunas | Direction, the final merge button, anything ambiguous |

## Build order (do not deviate)

Build **one full vertical slice first** — Rock-Paper-Scissors all the way from registration to settled wallet and updated leaderboard — before adding any second game. Then add games in rising complexity: Coinflip → Baccarat → Blackjack → Chess. Breadth before the skewer is complete is the failure mode we are explicitly avoiding.

## Repository layout (target)

```
rapidclash-demo/
├── README.md
├── CODEOWNERS
├── docs/                     # specs & decision records (Advisor)
├── packages/
│   ├── shared/               # types shared by client & server: protocol, game state
│   ├── core/                 # identity, wallet/ledger, matchmaking, sessions, settlement
│   └── games/                # one folder per game module, each satisfying the contract
│       └── rps/
├── apps/
│   ├── server/               # Node WebSocket + REST host
│   └── web/                  # React PWA client (player UI + role-gated admin views)
└── infra/                    # deployment config (added when we go to cloud)
```
