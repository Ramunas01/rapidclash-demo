# PM Report — 2026-06-15 — Project COMPLETE

RapidClash is feature-complete, deployed to a public URL, and polished. Every planned issue is closed;
the board is empty except one tracked test-robustness follow-up.

**Live:** `https://rapidclash-847070222251.us-central1.run.app` · **Admin:** `admin` / (Secret Manager `admin-password`).

## What was built (the whole arc)
- **Slice 1 — RPS, end to end.** Register, append-only ledger wallet, FIFO matchmaking + escrow, two-player RPS with server-side redaction, atomic idempotent settlement (pot − rake), win-rate leaderboard, reconnect (`match.resume`), deterministic replay. Owner-signed-off against S1–S9.
- **Slice 2 — second game + the plug-in proof.** Coinflip (seeded flip, hidden until terminal, `net_winnings`) through the **same core with zero game-specific branches**; the leaderboard generalized to rank by each module's declared `RankingType` (ADR-007); an **open-challenges lobby** (visible order book with atomic claim + 90s server-authoritative TTL, ADR-008); usernames surfaced on leaderboards + the player's own alias.
- **Deployment.** One Cloud Run service serves API + WebSocket + the built PWA on a single origin (ADR-009); HTTPS ⇒ installable PWA, no tunnel. `--max-instances 1` (in-memory match state + local SQLite); `--min-instances 0` when idle (free).
- **Polish.** Mobile stake input (#33), own alias (#34), idle WS auto-reconnect + visible status (#30), server-authoritative match turn-timeout with no orphaned escrow (#31).

## Charter invariants — held throughout
#1 humans-vs-humans · #2 server-authoritative + `viewFor` redaction · #3 append-only idempotent ledger (zero-sum, no double-pay) · #4 play-money only · #5 games as plug-ins (no game-specific core code — the leaderboard generalization is generic-by-`RankingType`, ADR-007).

## Quality / CI
- **CI green on `main`**; the suite is **231 tests** across packages/core, packages/games, apps/server (incl. real-socket gateway integration tests) and apps/web (jsdom/RTL).
- **One tracked follow-up — #57:** the #31 timeout-sweep gateway test (real `setInterval` + real WebSocket) fails on the local **WSL2** dev box but passes in CI; it's a test-environment fragility, not a product bug (the sweep is CI-proven and reviewed-correct). Suggested fix: drive the sweep deterministically in tests. Low priority.

## Decisions of record (ADRs 1–9)
TS monorepo; server-authoritative seeded RNG; append-only idempotent ledger; games as plug-ins; single Cloud Run instance (demo) with Redis/Postgres deferred; WS in-match + REST elsewhere; **ADR-007** generic ranking; **ADR-008** open-challenges; **ADR-009** single-origin Cloud Run deploy. See `docs/ARCHITECTURE.md` + `DEPLOY.md` + `SLICE_*.md`.

## Operate it
- **Deploy / redeploy:** `docs/DEPLOY.md` (hardened with the IAM grants + troubleshooting that the first real deploy needed). Use `--min-instances 0` for free idle; **always keep `--max-instances 1`**.
- **Cost:** scales to zero when idle; warm to `--min-instances 1` a few minutes before a demo (avoids cold start).
- **Reset:** redeploy/recycle — SQLite is ephemeral; the admin re-seeds via `ensureAdmin` (no per-account deletion; see `ADMIN.md`).

## Lessons (for the next slice / contributor)
- **Green CI ≠ working demo, and green-in-isolation ≠ green-combined.** Real-server smoke tests caught three deploy-blocking bugs behind passing unit CI; parallel-merged PRs surfaced a combined-state failure (a built `apps/web/dist` flipping on static serving; the #57 WSL timer flake). Verify the real path; re-run the *full* suite after parallel merges.
- **Deploy gotchas are now documented** (DEPLOY.md §1/§5b): the compute-SA build roles, and pinning `packageManager` for the corepack Docker build (which then required dropping the CI `pnpm/action-setup` version).

## Deferred (not built — by design)
- More games: Coinflip proved the contract; **Chess** (ELO + external move-validation) and the redefined **Blackjack/Baccarat** head-to-head rulesets remain (CHARTER open spec).
- Opponent's alias on the Play screen (needs `match.start` to carry it) — minor follow-up.
- Scale phase (ADR-005): Cloud SQL + Redis + `--max-instances > 1`; and CI/CD auto-deploy (DEPLOY.md §6). Not needed for the demo.

**Status: shipped. The demo does everything the Charter asked, on a phone, on a public URL.**
