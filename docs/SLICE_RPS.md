# Slice 1 — Rock-Paper-Scissors, end to end

The goal of this slice is **not** "build RPS." It is to prove the entire platform spine — registration, wallet, matchmaking, two-player session, settlement, leaderboard — using the simplest possible game as the payload. When this slice is done, adding the next game should touch only `packages/games/`.

Do not start a second game until every acceptance criterion below passes.

## Definition of done

A person can open the PWA on a phone, register, and play a real RPS match against a second human on a second device, with money and ranking moving correctly — and a developer can replay that match deterministically from its seed and move list.

## User stories & acceptance criteria

**S1 — Register & wallet**
- A new user registers from the PWA and is granted a starting balance.
- `GET /wallet` returns a balance derived from ledger entries (not a stored number).
- Acceptance: the starting balance equals exactly one `GRANT` entry.

**S2 — Browse & choose**
- `GET /games` returns RPS with its `GameMeta`.
- The PWA lists RPS and lets the user pick it and a stake within `bet.minStake..maxStake`.

**S3 — Place stake & enter lobby**
- `queue.join` escrows the stake (one `BET_ESCROW` debit) and returns `queue.waiting`.
- Escrowing more than the balance is rejected with `error`, no ledger write.
- `queue.leave` before matching refunds the escrow exactly.

**S4 — Match two humans**
- Two clients that `queue.join` RPS at the same stake are paired in arrival order.
- Both receive `match.start` with a redacted starting view (neither sees the other's choice — there is none yet).

**S5 — Play (hidden information honoured)**
- Each client receives `match.your_turn` with the three legal moves.
- A submitted choice is **not** revealed to the opponent until both have chosen — verified by inspecting the actual bytes sent to each client.
- An illegal/duplicate move returns `error` and does not change state.

**S6 — Settle**
- At terminal, the winner receives `SETTLE_WIN` of `pot − rake`; PLATFORM receives `RAKE`; the ledger balances to zero across accounts.
- A draw refunds both stakes per the documented draw policy.
- Re-sending `match.resume` or replaying the settle does **not** create a second payout (idempotency verified by test).

**S7 — Leaderboard & ranking**
- The RPS leaderboard updates per `meta.ranking` (`win_rate` for RPS).
- `GET /leaderboard/rps` reflects the change after the match.

**S8 — Reconnect**
- A client that drops and reconnects mid-match calls `match.resume` and receives the current redacted state; the match continues correctly.

**S9 — Determinism**
- A match's seed + ordered move list replays to the identical final state and outcome. This is an automated test, not a manual check.

## Suggested issue breakdown for the PM

Sequence these so each builds on the last; the contract and shared types come first because everything depends on them.

1. **Repo scaffold** — monorepo (`packages/shared`, `packages/core`, `packages/games`, `apps/server`, `apps/web`), TypeScript config, lint/format, CI that builds and runs tests on PRs.
2. **Shared contract** — implement `game-contract.ts`, protocol envelope, and shared types from `GAME_MODULE_INTERFACE.md` and `PROTOCOL.md`.
3. **Ledger** — append-only store, derived balance, `GRANT`/`BET_ESCROW`/`SETTLE_*`/`RAKE`, idempotent settlement keyed by match. Unit-tested to zero-sum and idempotency per `WALLET_LEDGER.md`.
4. **Identity & sessions** — register/login, token, demo grant on registration.
5. **RPS module** — implement `GameModule` for RPS exactly as in the worked example, including `viewFor` redaction and `forfeit`. Determinism test (S9).
6. **Matchmaking & lobby** — FIFO pairing by `gameId` + stake; escrow on join, refund on leave.
7. **Match orchestration** — wire WS messages to the contract lifecycle; relay redacted state; call settlement at terminal.
8. **Leaderboard** — `win_rate` ranking for RPS; `GET /leaderboard/:gameId`.
9. **PWA client** — register, wallet view, game list, stake + lobby, the RPS play screen, result + updated wallet/leaderboard. Must be usable one-handed on a phone.
10. **Reconnect** — `match.resume` path end to end (S8).
11. **Demo runbook** — `docs/DEMO.md`: how to run two clients locally and walk the full flow.

### Parallel track — minimal admin tooling (build alongside, not after)

A thin slice of `ADMIN.md` pays for itself *during* this slice as test tooling. Prioritise these three; the richer views (full game log, money-won/lost columns) can follow once matches exist to populate them:

- **A1 — admin role + auth gate.** Pre-seeded admin account; `admin`-role check on all `/admin/*` endpoints.
- **A2 — add money.** `POST /admin/players/:id/credit` → one idempotent `ADMIN_CREDIT` entry. Lets you top up wallets to exercise escrow at various balances.
- **A3 — release an alias.** *(Superseded by ADR-011: now a **soft reset** — `POST /admin/players/:id/reset-password` clears the password + re-grants the wallet + keeps standings, refused on active match/escrow, alias re-claimable with a new password. The original slice-1 form was `DELETE /admin/players/:id`.)* See `ADMIN.md`.

## After the slice

Only once S1–S9 pass: add Coinflip (proves a pure-chance, seeded-RNG game and the `net_winnings` ranking through the *same* core, with *no* core changes — that is the real test of the plug-in contract). Then Chess (skill/ELO, external move-validation lib). Baccarat and Blackjack stay blocked on the head-to-head ruleset decision recorded in `CHARTER.md`.
