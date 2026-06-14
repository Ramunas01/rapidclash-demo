# PM Report — 2026-06-14 — Slice 1 COMPLETE (RPS, end to end)

**Slice 1 is done.** A person can register from the PWA, see a ledger-derived wallet, pick RPS,
stake, be matched with a second human, play, settle (pot − rake), and watch the leaderboard move —
with reconnect and deterministic replay — **end to end against the real running server.** Every
S1–S9 acceptance criterion passes. Per the slice plan, **no second game starts until the Owner
confirms S1–S9.**

## Final scorecard

| Issue | What | Status |
|-------|------|--------|
| #1–#8, #12, #13 | scaffold, contract, ledger, identity, RPS, matchmaking, orchestration, leaderboard, admin A1/A2 | ✓ merged (earlier) |
| #9 | PWA client | ✓ ratified on `main` (direct-push, reviewed retroactively) |
| #10 | Reconnect (`match.resume`) | ✓ #28 |
| #11 | Demo runbook (`docs/DEMO.md`) | ✓ #24 — **closes Slice 1** |
| #25 | B1: WS gateway 500 (critical) | ✓ fixed #28 |
| #26 | B2: CORS / Vite proxy | ✓ fixed #29 |
| #27 | B3: `GET /wallet` + `/matches/:id` (404) | ✓ fixed #29 |

**129/129 tests** across 16 files.

## S1–S9 — verified end to end (not just unit tests)

PM live smoke test against the booted server + a two-client run through the Vite proxy (the
browser's real path):
- **S1** register → balance 1000; `GET /wallet` → `{balance:1000, entries:[GRANT:1000]}` (ledger-derived, exactly one GRANT; 401 without token).
- **S2** `GET /games` → RPS `GameMeta` (stake 1–100, `win_rate`).
- **S3** escrow on join / refund on leave (ledger-tested).
- **S4** two clients paired by gameId+stake; redacted `match.start`.
- **S5** opponent move hidden on the wire **and** via `GET /matches/:id` redaction (invariant #2).
- **S6** settlement zero-sum: winner 1009 / loser 990 / PLATFORM 1 = 2000; settle idempotent.
- **S7** `GET /leaderboard/rps` reflects `win_rate` after a match.
- **S8** mid-match reconnect resumes redacted state; terminal resume → `match.end`, **no double-pay** (1009 → 1009).
- **S9** seed + move-list replays identically — 27 automated determinism tests.

## What happened this session (the part worth remembering)

1. **#9 (PWA) was committed straight to `main`, bypassing the review gate.** Reviewed retroactively
   (passes S1–S7 client criteria, S5 hidden-info correctly enforced), ratified in place, breach
   documented. Root cause — branch protection has `enforce_admins:false` + 0 required reviews — was
   flagged; **Owner chose to leave it as-is** (the PM gate stays convention-only; keep requiring PRs).
2. **#10 (reconnect)** implemented `match.resume` + sessionStorage persistence, and — by being the
   **first test to boot a real socket** — surfaced two latent bugs that broke ALL WebSocket traffic:
   **B1** (`/ws` registered before `@fastify/websocket` loaded → every WS 500'd) and a fast-reconnect
   race that dropped `match.end`. Both fixed + covered by `gateway.test.ts`.
3. **The demo wasn't actually runnable** despite 96→129 green tests, because nothing exercised the
   real HTTP/WS server: **B2** (no CORS/proxy → browser couldn't reach the API) and **B3**
   (`GET /wallet`/`/matches/:id` from `PROTOCOL.md` were never implemented → 404, masking S1).
   Fixed in #29 (Vite proxy + the two endpoints, ledger-derived + redacted).
4. **#11 (runbook)** reconciled to describe the working demo and verified by a real two-client run,
   then merged — closing the slice.

**Lesson for the next slice:** green CI is not "it works." Keep at least one test that boots the
real server over a real socket, and smoke-test the live REST/WS path before declaring done. That one
gap hid three production blockers behind a passing suite.

## Charter invariants — all held
#1 humans-vs-humans (no house branch) · #2 server-authoritative (all redaction via `viewFor`,
client only renders state) · #3 append-only idempotent ledger (zero-sum settlement, no double-pay on
reconnect/replay — test-asserted) · #4 play-money only · #5 games-as-plugins (RPS lives in
`packages/games`; core untouched by game rules).

## Open notes / minor follow-ups (none block the slice)
- Branch protection stays as-is (Owner decision) — review gate is convention-only.
- `GET /matches/:id` is participant-only (privacy-safe default); Advisor may relax to public-for-
  finished if desired.
- Leaderboard `displayName` still returns `playerId` placeholder (carried from #8) — cosmetic.

## After the slice (do NOT start without Owner go-ahead)
Per `docs/SLICE_RPS.md`: only once the Owner confirms S1–S9, add **Coinflip** — it proves a
pure-chance seeded-RNG game and the `net_winnings` ranking through the *same* core with **no core
changes** (the real test of the plug-in contract). Then Chess (ELO, external move-validation lib).
Baccarat/Blackjack remain blocked on the head-to-head ruleset decision in `CHARTER.md`.

**Recommended next PM action:** ask the Owner to confirm S1–S9 (or walk `docs/DEMO.md` themselves),
then scope Coinflip as the first issue of Slice 2.
