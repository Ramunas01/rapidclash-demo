# Demo Runbook — RapidClash RPS (Slice 1)

This runbook walks the **full Charter experience** end to end: two humans register, fund a
play-money wallet, pick Rock-Paper-Scissors, stake, get matched, play, settle (pot − rake),
and watch the leaderboard move — and shows a developer how to replay a match
deterministically. It ends with a hand-tickable **S1–S9 checklist** (the
[Slice 1 acceptance criteria](SLICE_RPS.md)).

The platform **never plays the house** ([Charter](CHARTER.md) invariant #1): the demo is two
genuine clients connecting through the same API. There is no bot baked into the core.

> **Status — this demo runs end to end today.** The server, the WebSocket gateway, and the
> Vite dev proxy all work out of the box: the `/ws` gateway is registered correctly (#28), and
> a Vite dev proxy plus `GET /wallet` / `GET /matches/:id` ship in the client and server (#29).
> The full two-client walkthrough below was run against the real server + Vite proxy on
> 2026-06-14; every S1–S9 box is ticked from that run.

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

### Resetting the demo (and freeing aliases)

The runbook assumes **no prior state**, and **wipe-and-restart is the canonical reset** — there is no account-removal flow by design. To clear all players, wallets, and matches (and free any taken alias for re-use), stop the server, delete the single SQLite DB file, and restart; the `admin` account **re-seeds automatically** on startup:

```bash
# stop the server, then:
rm -f rapidclash.db        # or whatever DB_PATH points at
# restart the server → fresh state, admin re-seeded
```

The admin **add-money** endpoint plus this **full reset** are the entire operator-tooling story for the demo (see `ADMIN.md`) — no per-account deletion is needed or scoped.

## 3. Build

```bash
export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
pnpm run build && pnpm run lint && pnpm run test
```

Expected: build and lint clean, **129/129 tests** green across 16 files. The suite covers the
spine (identity, ledger, RPS module, matchmaking, leaderboard, web client) **and** the live
server: `apps/server/src/ws/gateway.test.ts` drives the real WebSocket gateway over a real
socket (matchmaking → play → settle → reconnect/resume), and the RPS determinism test covers S9.

## 4. Start the server

```bash
export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
rm -f rapidclash.db
JWT_SECRET=dev-demo-secret ADMIN_PASSWORD=admin-dev FEE_RATE=0.05 \
  pnpm --filter @rapidclash/server start
# → [server] listening on http://0.0.0.0:3000
```

(Equivalently, `cd apps/server && DB_PATH=../../rapidclash.db PORT=3000 node dist/index.js`
after a build — the `start` script is just `node dist/index.js`.)

Quick smoke test (no browser needed):

```bash
curl -s localhost:3000/games | head -c 300
# → [{"id":"rps","displayName":"Rock Paper Scissors",...,"bet":{"minStake":1,"maxStake":100,...}}]
```

## 5. Start the two web clients

The Vite dev server ships a **dev proxy** (`apps/web/vite.config.ts`, added in #29) that
forwards the REST paths (`/auth`, `/wallet`, `/games`, `/leaderboard`, `/matches`, `/admin`) and
the **`/ws` upgrade** to `http://localhost:3000`. So the PWA stays **same-origin** and reaches
the API/WS **out of the box** — no CORS setup and no `VITE_*` variables needed for local play.

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

On each device open `http://<your-lan-ip>:5173`. Because the proxy runs inside the Vite dev
server (on the host), it forwards `/auth`, `/ws`, … to the host's own `:3000` — so as long as
the server runs on the **same machine** as Vite, two LAN devices work with no extra config.

> Only if you run the API on a **different host** than Vite do you need to point the client at
> it explicitly, before `pnpm … dev`:
> ```bash
> export VITE_API_URL="http://<api-host>:3000"
> export VITE_WS_URL="ws://<api-host>:3000"
> ```
> The client reads `VITE_API_URL` for REST (`apps/web/src/api.ts`) and `VITE_WS_URL` for the
> WebSocket (`apps/web/src/ws.ts`); both default to same-origin (i.e. the proxy).

---

## 5b. Mobile access (phone + PWA install)

Two ways to reach the demo from a phone. **The tunnel is recommended** — installing the PWA
(Add to Home Screen / service worker) requires **HTTPS**, which a tunnel provides and plain-HTTP
LAN does not.

### (a) HTTPS tunnel — recommended

A Cloudflare *quick tunnel* gives a public HTTPS URL with no account/login:

```bash
cloudflared tunnel --url http://localhost:5173 --no-autoupdate
# → prints https://<random>.trycloudflare.com  (regenerated each run)
```

Vite must accept the tunnel hostname — set `server.allowedHosts` in `apps/web/vite.config.ts`:

```ts
server: {
  allowedHosts: true,           // or ['.trycloudflare.com']
  proxy: { /* … existing /auth, /ws, … */ },
}
```

Open the `https://…trycloudflare.com` URL on the phone → **Add to Home Screen** (iOS Safari) or
**Install app** (Android Chrome). Because the tunnel points at the Vite dev server, the same
single origin carries REST **and** the `/ws` WebSocket — a phone player can match a desktop player
for a real two-device human match.

### (b) LAN (no HTTPS — page works, PWA install does not)

WSL2 uses NAT, so the WSL IP is **not** directly reachable from other LAN devices. Bridge it from
the Windows host:

- **Windows 11 — mirrored networking:** add to `%UserProfile%\.wslconfig`:
  ```ini
  [wsl2]
  networkingMode=mirrored
  ```
  then `wsl --shutdown` and restart. WSL services are now reachable on the host's LAN IP. Open
  Windows Firewall for ports `5173` (and `3000` if the API isn't behind the proxy).
- **Windows 10 — portproxy:** forward the host port to WSL:
  ```powershell
  netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0 \
    connectport=5173 connectaddress=<wsl-ip>
  ```
  add an inbound firewall rule for `5173`, then open `http://<windows-lan-ip>:5173` on the phone.

> **PWA caveat:** service workers / install prompts need a secure context (HTTPS or `localhost`).
> Over plain-HTTP LAN the app runs as a normal web page but will **not** install as a PWA — use the
> tunnel (a) for the installable experience.

---

## 6. The walkthrough — the Charter's 8-step experience

Do this with **two players** (A and B) side by side. Each PWA screen maps to one Charter step.

| # | Charter step | What each player does | What proves it |
|---|--------------|-----------------------|----------------|
| 1 | **Register / sign in** | On the **Auth** screen, each registers a unique alias + password. | Lands on the **Wallet** screen with **1000 credits** — the new-account demo grant. |
| 2 | **See wallet balance** | Read the balance on the **Wallet** screen. | Shows `1000 credits`, fetched from `GET /wallet` (derived from the ledger, not a stored number). |
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

Every box below was **verified end to end on 2026-06-14 against the real running server + the
Vite dev proxy** (two WebSocket clients driven through `:5173`, the same path a browser uses),
except S9 which is an automated test. The observed values are quoted inline.

- [x] **S1 — Register & wallet.** Register a new player → balance is **1000** (exactly one
  `GRANT` ledger entry). `GET /wallet` is implemented (#29) and **ledger-derived** (not a stored
  number). **Verified:** `POST /auth/register` → `balance:1000`; `GET /wallet` →
  `{"balance":1000,"entries":["GRANT:1000"]}` (exactly one GRANT); no token → `401`.
- [x] **S2 — Browse & choose.** `GET /games` returns RPS with its `GameMeta`; the PWA lists it
  and accepts a stake in **1–100**. **Verified:** `GET /games` → `rps` with `bet [1, 100]`.
- [x] **S3 — Place stake & lobby.** `queue.join` escrows the stake (one `BET_ESCROW` debit) and
  returns `queue.waiting`; an invalid stake is rejected with `error` and **no match/ledger write**;
  `queue.leave` refunds exactly. **Verified:** A's `queue.join` → `queue.waiting`; an
  out-of-range `queue.join` → `error` and no match formed. (The insufficient-balance escrow guard
  and `queue.leave` refund are covered by the `matchmaking` unit tests — a fresh 1000-credit
  account can't legally stake above the 100 max, so over-balance is exercised at the unit level.)
- [x] **S4 — Match two humans.** Two clients that `queue.join` RPS at the same stake are paired
  in arrival order; both receive `match.start` with a **redacted** starting view (no opponent
  choice yet). **Verified:** two `match.start` envelopes, `state.choices` `{}` (empty).
- [x] **S5 — Play (hidden info).** Each client gets `match.your_turn` with the three legal
  moves; a submitted choice is **not** revealed to the opponent until both have chosen; an
  illegal/duplicate move returns `error`, no state change. **Verified:** after A played `rock`,
  B's redacted view contained **no** entry for A's choice — confirmed both on the WS
  `match.state` and via `GET /matches/:id` (viewFor-redacted, #29); A saw its own `rock`; a
  duplicate move returned `ILLEGAL_MOVE`. The PWA renders **🤫** for the opponent until terminal
  (`apps/web/src/screens/Play.tsx`, backed by `Play.test.tsx`).
- [x] **S6 — Settle.** Winner gets `SETTLE_WIN` of `pot − rake`; `PLATFORM` gets `RAKE`; ledger
  is zero-sum; a **draw refunds** both; replaying the settle does **not** double-pay.
  **Verified:** stake 10 each → `match.end` outcome `win`, winner `delta +9` / `newBalance 1009`,
  loser `990`; `PLATFORM` holds the `1` rake (1009 + 990 + 1 = 2000 = two 1000 grants). Draw
  refund + settle idempotency also covered by `ledger` and `gateway` tests.
- [x] **S7 — Leaderboard & ranking.** The RPS leaderboard updates per `win_rate`;
  `GET /leaderboard/rps` reflects the change after the match. **Verified:** post-match
  `GET /leaderboard/rps` → winner rank 1 (`wins 1`, `winRate 1`), loser rank 2 (`winRate 0`).
  - *Minor:* `displayName` is currently the `playerId` (placeholder for an alias lookup) — a
    cosmetic follow-up, does not block the demo.
- [x] **S8 — Reconnect.** A client that drops mid-match calls `match.resume` and receives the
  current redacted state; the match continues. A terminal `match.resume` returns `match.end` with
  the already-settled outcome and **no second payout**. Implemented and tested in #28
  (`apps/server/src/ws/gateway.test.ts`: "disconnect mid-move → reconnect → resume returns
  redacted state; match completes", and "terminal-resume … NO duplicate payout"). **Verified
  live:** B disconnected mid-match, reconnected through the proxy, sent `match.resume` → received
  the current redacted `match.state`, then completed the match normally; a terminal `match.resume`
  by A returned `match.end` with the balance **unchanged** (1009 → 1009, no double-pay).
  **In the browser:** **reload** one player's tab mid-match (F5) → it auto-resumes. The client
  persists `currentMatchId` to `sessionStorage` and re-sends `match.resume` on the new socket's
  `onopen` (`apps/web/src/ws.ts`, `App.tsx`). Note `sessionStorage` is **per-tab and clears when
  the tab is closed**, so use *reload*, not close-and-reopen.
- [x] **S9 — Determinism.** A match's seed + ordered move list replays to the identical final
  state and outcome (automated test). **Verified:** `pnpm exec vitest run packages/games/rps` →
  27 tests pass, including the `determinism (S9)` block. See §9.

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
- **WebSocket won't connect / REST calls fail from `:5173`:** make sure the **server is running
  on `:3000`** and that you're loading the app through the **Vite dev server** (`:5173`) so the
  proxy applies (`apps/web/vite.config.ts`). If you run the API on another host, set
  `VITE_API_URL` / `VITE_WS_URL` (see §5).
- **Mid-match reload doesn't resume:** that uses `sessionStorage`, which is per-tab. Use the
  tab's **reload** (not close-and-reopen, which clears it).

---

## Appendix — fast verification without a browser

When you just need to confirm the spine works (e.g. in CI or after a change), you don't have to
click through two browsers:

- **Automated:** `pnpm run test` (129/129). `apps/server/src/ws/gateway.test.ts` drives the
  **real** WS gateway over a real socket (S3–S8: matchmaking, play, settle, disconnect →
  reconnect → `match.resume`, terminal-resume idempotency); the RPS determinism test covers S9.
- **Live curl smoke** (server running on `:3000`):
  ```bash
  TOK=$(curl -s -X POST localhost:3000/auth/register -H 'Content-Type: application/json' \
    -d '{"username":"smoke","password":"pw"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
  curl -s localhost:3000/wallet -H "Authorization: Bearer $TOK"   # {"balance":1000,"entries":[{"type":"GRANT","amount":1000,...}]}
  curl -s localhost:3000/games                                    # RPS GameMeta
  curl -s localhost:3000/leaderboard/rps                          # [] on a fresh DB
  ```
- **Two-client WS flow:** point two WebSocket clients at `ws://localhost:5173/ws?token=…`
  (through the Vite proxy, the same path the browser uses) and drive `queue.join` → `move.make`
  → `match.end`. This is exactly how the S1–S9 results in §8 were produced against the real
  running stack.
