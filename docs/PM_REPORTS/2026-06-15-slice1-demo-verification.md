# PM Report — 2026-06-15 — Slice 1 local demo verification & mobile access

Prepared for the Advisor's "test, verify, prepare mobile access, then stop and report" request.
The owner ran the full demo locally and on a phone; below are the live URLs, credentials, the
S1–S9 evidence, mobile-access setup, and findings. **The S1–S9 gate is NOT signed off until the
owner confirms — do not scope Coinflip until then.**

## 1. Running the stack (services bound to 0.0.0.0)

```
export PATH="/home/ramunas/.nvm/versions/node/v20.20.2/bin:$PATH"
pnpm install && pnpm run build
# Server (Fastify, HOST defaults to 0.0.0.0):
cd apps/server && DB_PATH=/tmp/rc-demo.db PORT=3000 HOST=0.0.0.0 \
  JWT_SECRET=<secret> ADMIN_PASSWORD=<adminpw> node dist/index.js
# Web (Vite dev, proxy → :3000), bound to 0.0.0.0:
cd apps/web && pnpm exec vite --host 0.0.0.0 --port 5173
```

**Local URLs**
- Desktop (Windows browser → WSL2 localhost forwarding): `http://localhost:5173`
- Health checks: `http://localhost:3000/games` (API), `http://localhost:5173/games` (through the proxy)
- WSL2 internal IP this session: `172.27.145.115` (not directly LAN-reachable — see §5)

## 2. Single-origin dev setup + env vars

The PWA is **same-origin**: the Vite dev proxy (`apps/web/vite.config.ts`) forwards REST (`/auth`,
`/wallet`, `/games`, `/leaderboard`, `/matches`, `/admin`) and the `/ws` upgrade (`ws:true`) to the
server on `:3000`. One URL/tunnel therefore covers REST + WebSocket.

Client base-URL env vars (both default to **same-origin**, so unset is correct behind the proxy):
- `VITE_API_URL` — REST base (`apps/web/src/api.ts`); default `''` (same origin).
- `VITE_WS_URL` — WebSocket base (`apps/web/src/ws.ts`); default `ws(s)://<host>` (same origin).

Server env: `PORT` (3000), `HOST` (0.0.0.0), `DB_PATH` (sqlite file), `JWT_SECRET`, `ADMIN_PASSWORD`,
`FEE_RATE` (default `0.05`).

## 3. Seeded admin (+ creating test players)

The server auto-seeds the **admin** account on startup (`ensureAdmin`, username `admin`, password from
`ADMIN_PASSWORD`). Demo credentials used this session:

```
Admin:   admin / RapidClash2026!
```

Test players are created by registering through the UI (or `POST /auth/register`). Live admin action
verified: `POST /admin/players/:id/credit {amount, idempotencyKey}` added 500 credits to a player and
showed up immediately in their Wallet as `ADMIN_CREDIT`. **Admin scope note:** only the role-gate
(403 for non-admin) and add-money are implemented; `GET /admin/players`, `/log`, and account-delete
are `"Not implemented"` stubs (deferred per the slice plan — A3 et al.).

## 4. Two-client recipe (mapped to S1–S8) — also in `docs/DEMO.md` §7

1. Open `http://localhost:5173` in two browser profiles (or one + incognito) — **S1** register, **S2** see RPS.
2. Each: pick RPS, stake the **same** amount, Join Lobby — **S3** escrow/lobby.
3. They pair → both reach Play — **S4** match two humans.
4. Each picks a move; opponent stays hidden (🤫) until both move — **S5** hidden info.
5. Result + wallet delta; leaderboard moves — **S6** settle, **S7** leaderboard.
6. Reload one tab mid-match → it auto-resumes (sessionStorage `currentMatchId`) — **S8** reconnect.

One player per device/profile; if a tab idles and its socket drops, **leave & re-join** (see finding #30).

## 5. Mobile access

**(a) HTTPS tunnel — RECOMMENDED (needed for PWA install).** A quick Cloudflare tunnel gives an HTTPS
URL with no account:
```
cloudflared tunnel --url http://localhost:5173 --no-autoupdate
```
Requires `server.allowedHosts: true` (or `['.trycloudflare.com']`) in `apps/web/vite.config.ts` so Vite
accepts the tunnel hostname. Open the printed `https://<random>.trycloudflare.com` on the phone; install
via **Add to Home Screen** (iOS Safari) / **Install app** (Android Chrome). Verified this session:
phone PWA → real two-device human match vs the PC. (The tunnel hostname regenerates each run.)

**(b) LAN.** WSL2 uses NAT, so the WSL IP isn't LAN-reachable directly:
- **Win11 — mirrored networking:** add to `%UserProfile%\.wslconfig` → `[wsl2]` `networkingMode=mirrored`,
  `wsl --shutdown`, restart. Then the Windows host IP reaches WSL services. Open Windows Firewall for 3000/5173.
- **Win10 — portproxy:** `netsh interface portproxy add v4tov4 listenport=5173 listenaddress=0.0.0.0
  connectport=5173 connectaddress=<wsl-ip>` (repeat for 3000 if not using the proxy), plus an inbound
  firewall rule. Phone uses `http://<windows-LAN-ip>:5173`.
- **Caveat:** PWA install + service worker require **HTTPS** (or localhost). Plain-HTTP LAN works as a web
  page but won't install as a PWA — prefer the tunnel for the installable experience.

## 6. S1–S9 evidence

| # | Criterion | How verified | Status |
|---|-----------|--------------|--------|
| S1 | Register & wallet | **Live:** register → balance 1000; `GET /wallet` → `{balance:1000, entries:[GRANT:1000]}` (ledger-derived, one GRANT). Auto: `Wallet.test.tsx`, auth/ledger unit tests. | ✅ |
| S2 | Browse & choose | **Live:** `GET /games` → RPS `GameMeta` (stake 1–100, `win_rate`). Auto: `games.test.ts`. | ✅ |
| S3 | Stake & lobby | **Live (ledger):** `BET_ESCROW` on join; a stake-10 join-then-leave produced an exact `-10/+10` refund pair. Auto: matchmaking unit tests. | ✅ |
| S4 | Match two humans | **Live:** phone vs PC paired at equal stake → both to Play. Auto: `gateway.test.ts`. | ✅ |
| S5 | Play, hidden info | **Live:** opponent shows 🤫 until terminal; `GET /matches/:id` redacts in-progress. **CI (green):** `Play.test.tsx` "does NOT show opponent choice before terminal" + `gateway.test.ts` "resume returns redacted state (own present, opponent concealed)". | ✅ |
| S6 | Settle | **Live:** stake-100 match → winner `SETTLE_WIN +190` (pot 200 − rake 10), loser −100, `PLATFORM RAKE +10`; ledger zero-sum (total 3000 = 3 grants). Auto: ledger idempotency + `gateway.test.ts` terminal no-double-pay. | ✅ |
| S7 | Leaderboard | **Live:** `GET /leaderboard/rps` + UI shows the winner ranked by `win_rate`. Auto: leaderboard tests. | ✅ |
| S8 | Reconnect | **Live:** mid-match tab reload auto-resumes. **CI (green):** `gateway.test.ts` disconnect→reconnect→resume + terminal-resume no double-pay. | ✅ |
| S9 | Determinism | **CI (green, automated only):** `rps.test.ts` `describe('determinism (S9)')` — byte-identical replay + all six win/loss combos stable. | ✅ |

CI `build-and-test` is **green on `main` HEAD** (129/129 tests, 16 files). The two the owner can't fully
eyeball — **S5 redaction** and **S9 determinism** — are explicitly confirmed green above.

## 7. Findings from the live demo (filed; non-blocking for the gate)

- **#30** — idle client doesn't auto-reconnect a dropped WS → `queue.join`/moves silently dropped (user stuck "waiting"). Hit after the dev server restarted.
- **#31** — no turn timeout → a stuck/stale client leaves the opponent waiting forever (forfeit only fires on socket *close*); abandoned/in-memory matches can orphan escrow.
- Both are unhappy-path robustness gaps; S1–S9 pass under clean conditions. Recommend addressing before unattended/public demos.

## 8. Stop & report

Hands-on demo verified end-to-end (incl. a real two-device human match with correct rake/settlement and
leaderboard).

**✅ GATE SIGNED OFF — the owner confirmed S1–S9 on 2026-06-15. Slice 1 is officially DONE.** Mobile-access
docs landed in `docs/DEMO.md` (#32). Coinflip is now **unblocked** as Slice 2's first issue — it proves the
plug-in contract + `net_winnings` ranking through the *same* core with **no core changes** (`docs/SLICE_RPS.md`,
"After the slice"). Robustness follow-ups #30/#31 remain open and are recommended (not required) before
unattended/public demos.
