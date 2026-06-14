# Demo Runbook — RapidClash RPS (Slice 1)

This runbook walks the **full Charter experience** end to end: two humans register, fund a
play-money wallet, pick Rock-Paper-Scissors, stake, get matched, play, settle (pot − rake),
and watch the leaderboard move — and shows a developer how to replay a match
deterministically. It ends with a hand-tickable **S1–S9 checklist** (the
[Slice 1 acceptance criteria](SLICE_RPS.md)).

The platform **never plays the house** ([Charter](CHARTER.md) invariant #1): the demo is two
genuine clients connecting through the same API. There is no bot baked into the core.

---

## ⚠️ Read first — two known blockers for the live browser demo

As of 2026-06-14, running the **two-browser** walkthrough against the shipping server hits two
defects in production code. Both are **small code fixes that belong in a Programmer PR, not in
this docs PR** (this PR changes `docs/` only — see [Working Agreement](WORKING_AGREEMENT.md)).
They are filed in the PR description for issue #11. Until they land, use the
[headless spine verification](#appendix--headless-verification-of-the-spine-works-today) at the
bottom, which exercises the **same** server core + WS gateway and passes today.

| # | Blocker | Effect | One-line fix (Programmer's domain) |
|---|---------|--------|-------------------------------------|
| **B1** | `apps/server/src/server.ts` calls `app.register(FastifyWs)` **without `await`**, then registers the `/ws` route synchronously. `@fastify/websocket`'s `onRoute` hook isn't active yet, so `/ws` is served as a **plain HTTP route** and the handler receives `(request, reply)` instead of `(connection, request)`. | **Every WebSocket connection 500s** (`Cannot read properties of undefined (reading 'token')`). Blocks S3–S8 against the running server. | `await app.register(FastifyWs)` before registering the gateway route (or register the gateway inside a plugin that depends on it). |
| **B2** | The server has **no CORS** and serves **no static assets**; the Vite dev server has **no proxy**. | A browser on `http://localhost:5173` (Vite) **cannot reach** the API/WS on `:3000` cross-origin — `/auth/*` REST is CORS-blocked. | Add a Vite dev proxy in `apps/web/vite.config.ts` (recommended — keeps it same-origin), **or** register `@fastify/cors`, **or** have the server serve the built PWA. |

> **B1 will most likely be fixed under issue #10**, which adds the first real WS gateway
> integration test (`apps/server/src/ws/gateway.test.ts`) driving `buildApp` over a live
> socket — that test fails to open a socket until B1 is fixed. Per the PM plan, **#10 merges
> before #11**, so re-run the browser walkthrough after #10 lands. Neither blocker is caught
> by the current suite because no test exercises the real HTTP/WS server end to end (the core,
> RPS module, and web WS client are each tested in isolation).

Everything that does **not** depend on B1/B2 — S1, S2, S7 (REST), S9 (determinism), and the
admin tooling — runs against the real server today and is marked **✅ verified** below.

---

## 1. Prerequisites

- **Node.js 20+** and **pnpm 9+** ([install](https://pnpm.io/installation)). On the demo
  machine, put Node on the path first:
  ```bash
  export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
  node -v   # v20.20.2
  pnpm -v   # 9.15.9
  ```
- **Two independent browser sessions** for the two players. Any of:
  - two browser **profiles** (e.g. Chrome default + a second profile), or
  - one normal window + one **incognito/private** window (separate `localStorage`), or
  - **two devices on the same LAN** (phones/laptops) — closest to the real mobile demo.

  The app stores the session token in `localStorage` per origin, so two players **must** be in
  two separate browser sessions, not two tabs of the same profile.

## 2. One-time setup

```bash
git clone https://github.com/Ramunas01/rapidclash-demo.git
cd rapidclash-demo
pnpm install
```

### Environment variables

The server reads these (see `.env.example`). For a local demo, sensible values:

| Var | Purpose | Demo value |
|-----|---------|------------|
| `JWT_SECRET` | Signs session tokens. Falls back to an insecure dev default with a warning. | `dev-demo-secret` |
| `ADMIN_PASSWORD` | Password for the pre-seeded `admin` account. Defaults to `admin-dev` (with a warning). | `admin-dev` |
| `FEE_RATE` | Platform rake taken from the pot at settlement. Default `0.05` (5%). | `0.05` |
| `PORT` | Server port. Default `3000`. | `3000` |
| `HOST` | Bind address. Default `0.0.0.0` (needed for LAN devices). | `0.0.0.0` |
| `DB_PATH` | SQLite file. Default `rapidclash.db`. | `rapidclash.db` |

A **pre-seeded `admin` account** is created on every startup (username `admin`, password
`$ADMIN_PASSWORD`). You do not register it.

### Start from a fresh database

The runbook assumes **no prior state**. The DB is a single SQLite file — delete it to reset:

```bash
rm -f rapidclash.db        # or whatever DB_PATH points at
```

## 3. Build

```bash
export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
pnpm run build && pnpm run lint && pnpm run test
```

Expected: build and lint clean, **115/115 tests** green across 13 files. (This is the spine —
identity, ledger, RPS module, matchmaking, leaderboard, and the web client — all unit/component
tested.)

## 4. Start the server

```bash
export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
rm -f rapidclash.db
JWT_SECRET=dev-demo-secret ADMIN_PASSWORD=admin-dev FEE_RATE=0.05 \
  pnpm --filter @rapidclash/server start
# → [server] listening on http://0.0.0.0:3000
```

Quick smoke test (no browser needed):

```bash
curl -s localhost:3000/games | head -c 300
# → [{"id":"rps","displayName":"Rock Paper Scissors",...,"bet":{"minStake":1,"maxStake":100,...}}]
```

## 5. Start the two web clients

> Requires **B2** fixed (cross-origin from Vite to the server). With the recommended Vite
> proxy fix, the client is same-origin and needs no `VITE_*` vars. Without it, point the client
> at the server explicitly **and** enable CORS on the server.

**Two profiles on one machine:**

```bash
export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
pnpm --filter @rapidclash/web dev      # Vite dev server → http://localhost:5173
```

Open `http://localhost:5173` in **two separate browser sessions** (Player A and Player B).

**Two devices on the same LAN:**

```bash
pnpm --filter @rapidclash/web dev -- --host   # expose Vite on your LAN IP
```

On each device open `http://<your-lan-ip>:5173`. The client must know where the API/WS live —
either via the Vite proxy (recommended) or by setting, before `pnpm ... dev`:

```bash
export VITE_API_URL="http://<your-lan-ip>:3000"
export VITE_WS_URL="ws://<your-lan-ip>:3000"
```

The client reads `VITE_API_URL` for REST (`apps/web/src/api.ts`) and `VITE_WS_URL` for the
WebSocket (`apps/web/src/ws.ts`); both default to same-origin.

---

## 6. The walkthrough — the Charter's 8-step experience

Do this with **two players** (A and B) side by side. Each PWA screen maps to one Charter step.

| # | Charter step | What each player does | What proves it |
|---|--------------|-----------------------|----------------|
| 1 | **Register / sign in** | On the **Auth** screen, each registers a unique alias + password. | Lands on the **Wallet** screen with **1000 credits** — the new-account demo grant. |
| 2 | **See wallet balance** | Read the balance on the **Wallet** screen. | Shows `1000 credits`. (Balance is derived from the ledger, not a stored number — see S1 note.) |
| 3 | **Browse & pick a game** | Tap **Play** → **Game list** → choose **Rock Paper Scissors**. | RPS appears with its `GameMeta` (stake range 1–100). |
| 4 | **Place a stake** | On **Stake entry**, set a stake within **1–100** (e.g. both pick **10**) and confirm. | Stake is escrowed; player moves to the **Lobby**. |
| 5 | **Lobby / wait** | The **first** player to join sees "waiting for an opponent". | `queue.waiting`. The lobby holds until a second human joins the **same game at the same stake**. |
| 6 | **Match** | When the **second** player joins at the same stake, both are paired. Each taps Rock, Paper, or Scissors on the **Play** screen. | Both get `match.start`. The opponent's choice shows as **🤫** until both have chosen — hidden information is honoured (S5). |
| 7 | **Win / lose / draw + settlement** | Both choices in → the **Result** screen shows the outcome and the wallet delta. | Winner gets **pot − rake**; loser is down their stake; a draw refunds both. With stake 10 each: pot 20, rake `round(20×0.05)=1`, winner **+9 net** (→ 1009), loser **−10** (→ 990), platform **+1**. |
| 8 | **Leaderboard moves** | From Result, tap **Leaderboard**. | The RPS leaderboard reflects the new result (winner's `win_rate` rises). |

Play **two or three** matches (swap who wins, force a draw by both choosing the same move) so
the leaderboard and wallets visibly move.

### Settlement arithmetic (for any stake `s`)

- pot = `2s`; rake = `round(2s × FEE_RATE)`; winner receives `2s − rake`.
- Winner net P&L = `(2s − rake) − s = s − rake`; loser net = `−s`; platform = `rake`.
- **Draw / void**: each player's own stake is refunded, **no rake**.
- The ledger is **zero-sum** across player + platform accounts (Charter invariant #3).

---

## 7. Optional — admin tooling for demo prep

Use the pre-seeded **admin** account to top up a wallet so you can exercise different stakes
(e.g. give a player 100 to bet near the max). Add-money is a single idempotent `ADMIN_CREDIT`
ledger entry — never a direct balance edit (see [ADMIN.md](ADMIN.md)).

```bash
# 1. Log in as admin → get a token
ADMIN_TOKEN=$(curl -s -X POST localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin-dev"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# 2. Credit a player by their playerId (from their register/login response)
curl -s -X POST "localhost:3000/admin/players/<PLAYER_ID>/credit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"amount":500,"idempotencyKey":"demo-topup-1"}'
# → {"type":"ADMIN_CREDIT","amount":500,...}

# Re-sending the SAME idempotencyKey credits once (returns the same entry) — safe to retry.
```

A non-admin token is refused (`HTTP 403`) on any `/admin/*` route.

---

## 8. S1–S9 acceptance checklist

Tick each box by doing the action and observing the result. **Status** marks what was verified
while writing this runbook (against the real server core / WS gateway code and the test suite)
vs. what is pending. See the [blockers](#️-read-first--two-known-blockers-for-the-live-browser-demo)
for why some live-server steps are gated on a code fix.

- [ ] **S1 — Register & wallet.** Register a new player → balance is **1000** (exactly one
  `GRANT` ledger entry). **Status: ✅ verified** (`POST /auth/register` returns `balance:1000`;
  balance is derived via `ledger.getBalance`).
  - ⚠️ **Bug:** `GET /wallet` (listed in [PROTOCOL.md](PROTOCOL.md) and S1) is **not registered
    on the server — returns 404**. The PWA's Wallet screen calls it (`api.wallet`), so the
    **"Recent transactions"** panel stays empty and the ledger-derived balance can't be read via
    the documented endpoint. Balance still **displays** because it's seeded from the
    register/login and `match.end` payloads. *Note for a Programmer PR, not fixed here.*
- [ ] **S2 — Browse & choose.** `GET /games` returns RPS with its `GameMeta`; the PWA lists it
  and accepts a stake in **1–100**. **Status: ✅ verified** (`GET /games` returns the exact meta).
- [ ] **S3 — Place stake & lobby.** `queue.join` escrows the stake (one `BET_ESCROW` debit) and
  returns `queue.waiting`; escrowing **more than balance** is rejected with `error` and **no
  ledger write**; `queue.leave` refunds exactly. **Status: ✅ verified** — waiting + over-balance
  rejection confirmed live through the gateway; escrow/leave/refund covered by `matchmaking`
  unit tests. *(Live via the corrected-registration harness; see B1.)*
- [ ] **S4 — Match two humans.** Two clients that `queue.join` RPS at the same stake are paired
  in arrival order; both receive `match.start` with a **redacted** starting view (no opponent
  choice yet). **Status: ✅ verified** (both `match.start`, `state.choices` empty).
- [ ] **S5 — Play (hidden info).** Each client gets `match.your_turn` with the three legal
  moves; a submitted choice is **not** revealed to the opponent until both have chosen
  (verified on the wire); an illegal/duplicate move returns `error`, no state change.
  **Status: ✅ verified** — after A played `rock`, B's `match.state` contained **no** entry for
  A's choice; a duplicate move returned `ILLEGAL_MOVE`. PWA renders 🤫 until terminal (S5 test).
- [ ] **S6 — Settle.** Winner gets `SETTLE_WIN` of `pot − rake`; `PLATFORM` gets `RAKE`; ledger
  is zero-sum; a **draw refunds** both; replaying the settle (`match.resume` after terminal)
  does **not** double-pay. **Status: ✅ verified** — stake 10: winner→1009, loser→990,
  PLATFORM→1 (sum 2000 = two 1000 grants); terminal `match.resume` returned `match.end` with the
  balance **unchanged** (idempotent). Draw refund + idempotency also covered by `ledger` tests.
- [ ] **S7 — Leaderboard & ranking.** RPS leaderboard updates per `win_rate`;
  `GET /leaderboard/rps` reflects the change after the match. **Status: ✅ verified** (winner
  rank 1, `winRate 1`, after a match).
  - *Minor:* `displayName` is currently the `playerId` (placeholder) and `GET /matches/:id`
    (in PROTOCOL.md) is not implemented (404). Neither blocks the demo; note for follow-up.
- [ ] **S8 — Reconnect.** A client that drops mid-match calls `match.resume` and receives the
  current redacted state; the match continues. **Status: ⏳ pending #10 — verify once #10
  merges.** Terminal-resume idempotency (no double-pay) is already verified (see S6); the
  full mid-match reconnect + the page-reload `currentMatchId` persistence are the body of
  issue #10. **In the browser:** with B1 fixed, close/kill one player's tab mid-match, reopen
  `http://localhost:5173`, and confirm the match resumes to the same redacted state. Do not
  sign S8 off from this runbook alone — the PM confirms it after #10 lands.
- [ ] **S9 — Determinism.** A match's seed + ordered move list replays to the identical final
  state and outcome (automated test). **Status: ✅ verified** — see §9.

## 9. Determinism replay (S9)

S9 is an **automated** check, not a manual one. The determinism suite lives in
`packages/games/rps/src/rps.test.ts` (the `determinism (S9)` block): it runs each match from a
fresh `init(players, rng)` plus an **ordered move list** and asserts the resulting state and
outcome are **byte-identical** across replays.

```bash
export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
pnpm exec vitest run packages/games/rps
# → packages/games/rps/src/rps.test.ts (27 tests) passed — includes the S9 replays
```

**How a developer replays one match by hand** (seed + move list → outcome). RPS is a game of
no chance, so its `Rng` (carried by the contract for games that need it, e.g. Coinflip later) is
a no-op stub — for RPS the replay is fully determined by the **ordered moves**:

```bash
node --input-type=module -e '
import { rpsModule } from "./packages/games/rps/dist/index.js";
const players = ["player-1", "player-2"];
const rng = { next: () => 0, int: () => 0 };          // the "seed"
const moves = [["player-1","paper"], ["player-2","rock"]];  // the ordered move list
let s = rpsModule.init(players, rng);
for (const [pid, move] of moves) s = rpsModule.applyMove(s, move, { playerId: pid, now: 0 }).state;
console.log("final state:", JSON.stringify(s));
console.log("outcome:", JSON.stringify(rpsModule.outcome(s)));
// Re-running this command yields byte-identical output every time.
'
```

(Requires `pnpm run build` first so `packages/games/rps/dist` exists.)

---

## Troubleshooting

- **Reset to a clean demo:** stop the server, `rm -f rapidclash.db`, restart. The admin account
  is re-seeded automatically; all players/matches/ledger are gone.
- **`JWT_SECRET`/`ADMIN_PASSWORD` warnings on startup:** expected when unset (insecure dev
  defaults). Set them to silence the warnings.
- **Two players keep matching as the same account:** they're sharing one browser session. Use
  two profiles / an incognito window / two devices (token lives in `localStorage` per origin).
- **WebSocket connection fails / 500 on `/ws`:** that's **blocker B1** — fix the server WS
  registration (see the table at the top). Until then, use the headless verification below.
- **Browser can't reach the API from `:5173`:** that's **blocker B2** (CORS / no proxy).

---

## Appendix — headless verification of the spine (works today)

This drives the **real** server core (`createServices` → identity, ledger, matchmaking,
leaderboard) and the **real** WS gateway (`registerWsGateway`) over a live socket, with the WS
plugin registered in the correct order (the **B1** one-line fix applied **in the harness only**,
so the production source is untouched). It proves S1–S7 and the S8 terminal-resume idempotency
exactly as the browser flow would, and is what was used to mark the ✅ items above.

The match it runs: two players register (1000 each) → both `queue.join` RPS at stake 10 →
A plays `rock`, B plays `scissors` → A wins → settlement winner 1009 / loser 990 / PLATFORM 1
(zero-sum) → terminal `match.resume` returns `match.end` with no double-pay → leaderboard shows
the winner at rank 1. An over-balance `queue.join` is rejected with `error` and no ledger write.

> Once **B1** is fixed in the server, this same flow runs against `pnpm --filter
> @rapidclash/server start` and the two-browser walkthrough in §5–6, with **no harness needed**.
> The reusable, supported version of this check is the WS gateway integration test being added
> under issue #10 (`apps/server/src/ws/gateway.test.ts`).
