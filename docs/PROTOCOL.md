# Protocol

Two channels. REST for request/response actions that are not part of live play; WebSocket for the match itself, where the server must push state to clients.

The message and payload types live in `packages/shared` and are imported by both client and server — they are defined once, never duplicated.

## REST

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/auth/register` | create account, grant starting play-money, return session token (+ own `avatarId`) |
| `POST` | `/auth/login` | return session token (+ own `avatarId`) |
| `POST` | `/auth/guest` | mint an anonymous, ephemeral guest session (CHARTER.md's guest-mode exception) — no body, no account/email/password. Returns the same `AuthResponse` shape with `isGuest: true`. See "Guest mode" below. |
| `POST` | `/auth/avatar` | set the authenticated player's OWN avatar (presets-only). Body `{ avatarId }`; `avatarId` is validated against the preset enum (any other value → `400`). The id is taken from the verified token — a user can only set their own avatar. Returns `{ avatarId }` on success. |
| `GET`  | `/wallet` | derived balance + recent ledger entries for the player |
| `GET`  | `/games` | list of available games with their `GameMeta` (stakes, ranking type, etc.) |
| `GET`  | `/leaderboard/:gameId` | ranked standings for a game (each entry carries the player's public `avatarId`) |
| `GET`  | `/matches/:id` | result/history of a finished match (read-only, idempotent) |
| `GET`  | `/rewards` | derived `RewardsSnapshot` — XP (lifetime + this month), VIP tier + rakeback rate, next tier, lifetime wagered, claimable balance |
| `POST` | `/rewards/claim` | claim the player's whole `claimable_balance` into their wallet as one `REWARD_CLAIM` ledger entry. No body. Idempotent — a repeat/double-tap call after the balance is already zero returns `{ credited: 0, newClaimableBalance: 0 }`, not an error. Rate-limited (10/minute/player). |

Auth token is sent as a bearer header and also used to authenticate the WS connection on open.

### Avatars (`avatarId`)

Each account stores an `avatarId` — one of a fixed set of **presets** (`'default' | 'boy-light' | 'girl-light' | 'boy-brown' | 'boy-dark'`). It is a plain string id; there is **no file upload / no image storage** — the client bundles the preset assets and maps the id to one. A new account is `'default'`; the column is added by a snapshot-safe, idempotent migration so a restored old snapshot's rows read `'default'`.

`avatarId` surfaces in exactly two places:

- **`AuthResponse`** (`/auth/register`, `/auth/login`) — the player's OWN avatar, for their own session only. The client persists it (localStorage) alongside the username and renders it on their own game bar + Account header.
- **`LeaderboardEntry`** (`/leaderboard/:gameId`) — public standings, so each row's avatar is public information.

**Redaction (Charter #2):** an in-match **opponent's** `avatarId` is NEVER placed on any channel. It is not in `match.start`, `match.state`, or any opponent payload — the opponent bar stays a neutral silhouette. Only the player's own session (`AuthResponse`) and the public leaderboard carry `avatarId`.

### Admin (privileged — requires the `admin` role)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/admin/players` | players overview: per-player games played/won/lost/drawn, money won/lost, wallet balance (all derived) |
| `GET`  | `/admin/players/:id/log` | a player's match log: timestamp, opponent, result, signed amount, running balance |
| `POST` | `/admin/players/:id/credit` | add play-money (`{ amount, idempotencyKey }` → one `ADMIN_CREDIT` entry) |
| `POST` | `/admin/players/:id/reset-password` | **soft reset** — clear the account's password, re-grant its wallet to the starting amount, keep its alias and standings; refused if the account has an active match or escrowed stake. The alias is then re-claimable by registering a new password. |

These reject any non-admin token. See `ADMIN.md` for the derivations and the soft-reset rules (and ADR-011 for the two-tier reset model).

### Rewards (issue #306)

Server-side only (§4 of the written Rewards/VIP spec): the client never computes or submits an XP/rakeback/bonus figure, only reads `GET /rewards` and calls `POST /rewards/claim`. Own table (`rewards`, keyed by `account_id`) in `packages/core/src/rewards.ts` — not columns bolted onto `accounts` — mirroring how `ledger.ts`/`identity.ts` each own a single table.

Accrual hooks into `matchmaking.ts`'s `settleMatch` via a new `onPlayerSettled` option (storage-agnostic seam, same shape as the existing `onSettled`), firing once per player per real settlement. `wagered_lifetime` accrues on every outcome; XP + rakeback accrue **only** on a decisive `'win'`, for **both** players (winner and loser), each computed independently from their own stake:

```
notionalRake     = min(stake,100)×feeRate + max(stake-100,0)×feeRate×0.25
xpGained         = round(40 × notionalRake)
rakebackGained   = round(stake × feeRate × currentTierRate)   // undiminished — diminishing is XP-only
```

`currentTierRate` is read from `xp_lifetime` **before** this match's XP is added — a tier-up never retroactively applies its new rate to the match that caused the crossing.

VIP tier is a pure function of `xp_lifetime` (derived, never stored — same pattern as `net_winnings`, ADR-007). Source: the design file's `VIP_ROWS` (design-ref/ — gitignored; transcribed here per the "commit every gitignored fact you depend on" rule):

| Tier | XP required | Rakeback |
|------|------------:|---------:|
| Unranked | 0 | 0% |
| Wood | 500 | 1% |
| Bronze | 5,000 | 4% |
| Silver | 25,000 | 7% |
| Gold | 125,000 | 10% |
| Emerald | 475,000 | 15% |
| Diamond | 1,500,000 | 20% |

Monthly volume bonus (Emerald/Diamond only, closed-month `xp_monthly` threshold, highest cleared pays, not cumulative): Emerald 50,000→3%, 120,000→5%; Diamond 120,000→5%, 300,000→8%. `bonus = round(thatMonth'sPlayerNotionalRakeSum × bonus%)`, credited to `claimable_balance`. `xp_monthly` resets 00:00 UTC on the 1st via `Rewards.closeElapsedMonths()`, both lazily (on the account's own next accrual/read/claim) and via an hourly `setInterval` sweep in `apps/server/src/index.ts` (no existing cron in this repo) so a dormant account still gets its bonus credited without needing to play again. The player's own per-month notional-rake sum (`notional_rake_monthly`) is an addition beyond the issue's literal 5-column schema list — required because a match's rake ledger entry (`ledger.ts`) only ever lands on the winner's side, so there is no way to reconstruct the loser's monthly notional-rake contribution from the ledger after the fact.

`POST /rewards/claim` atomically zeros `claimable_balance` and writes one `REWARD_CLAIM` ledger entry for the full amount, in a single `db.transaction()` (mirrors `ledger.ts`'s `settle()`). Idempotent by construction — a claim with nothing left to claim (balance already 0) is a no-op, no ledger write; a deterministic per-account claim-sequence idempotency key on the `REWARD_CLAIM` entry is defense-in-depth on top of that. Guest sessions (issue #267) are never wired to Rewards — guest matches accrue no XP/rakeback, same isolation boundary as guest's ledger.

## WebSocket

One connection per logged-in client. The match flow runs over it. All messages share an envelope:

```typescript
interface Envelope<T = unknown> {
  type: string;
  matchId?: string;
  payload: T;
}
```

### Client → server

| type | payload | meaning |
|------|---------|---------|
| `queue.join` | `{ gameId, stake }` | enter matchmaking for a game at a stake (escrow happens here). **Typed-amount path: behaves exactly as before** — FIFO auto-match against the oldest resting bet at that stake, else rest as a new open challenge. |
| `queue.leave` | `{ gameId }` | leave the lobby before matched (refund escrow) |
| `challenges.subscribe` | `{ gameId }` | start receiving the open-challenges feed for a game (on opening the stake screen) |
| `challenges.unsubscribe` | `{ gameId }` | stop receiving the feed (on leaving the screen) |
| `challenge.take` | `{ matchId }` | claim a specific resting bet by id. Escrow is **conditional on winning the claim**; a failed claim charges nothing |
| `move.make` | `{ move }` | submit a move in the current match |
| `match.resume` | `{ matchId }` | after reconnect, ask for current redacted state |
| `match.forfeit` | `{}` | concede / leave an in-progress match |

### Server → client

| type | payload | meaning |
|------|---------|---------|
| `queue.waiting` | `{ gameId, since, expiresAt }` | you are in the lobby; no opponent yet. `expiresAt` lets your own lobby show a countdown ("expires in 0:48, auto-refunds — no need to cancel") |
| `challenges.list` | `{ gameId, entries: [{ matchId, ownerName, stake, openedAt, expiresAt }] }` | the current visible open challenges (sent on subscribe) |
| `challenges.update` | `{ gameId, added?: Entry, removed?: { matchId, reason } }` | incremental feed change; `reason` ∈ `taken` \| `expired` \| `cancelled` |
| `challenge.expired` | `{ matchId }` | your resting bet expired unmatched; escrow refunded. Client offers a one-tap re-post |
| `match.start` | `{ matchId, opponent, state }` | matched; here is your redacted starting view |
| `match.state` | `{ state, events }` | updated redacted view + events to animate |
| `match.your_turn` | `{ legalMoves }` | it is your turn; here are your legal moves |
| `match.end` | `{ outcome, settlement }` | terminal; result + what changed in your wallet |
| `error` | `{ code, message }` | illegal move, insufficient balance, challenge already taken/expired, etc. |

### Rules the protocol enforces

- The server only ever sends a player their own `viewFor` state. The opponent's hidden information is never on the wire.
- `move.make` is validated against the server's `legalMoves` before `applyMove`; an illegal or out-of-turn move returns `error`, never mutates state.
- `match.resume` is safe to call any number of times; it reads state, never advances it.
- `queue.join` is the escrow point. If matchmaking fails or the player leaves the lobby, the escrow is refunded via the ledger. A player who is matched is committed.
- `challenge.take` is an **atomic claim**: the server transitions the target challenge from open to matched and binds it to exactly one taker. Concurrent takers of the same challenge produce exactly one match; every loser is refused with no escrow written. A player cannot take their own challenge, and a taker with insufficient balance is refused before any escrow.
- Challenge expiry is **server-authoritative**. The server holds `expiresAt`, sweeps expired challenges, and refunds the owner's escrow (idempotently). Client countdowns are cosmetic — they animate the server's `expiresAt` and never decide anything.

## Matchmaking & lobby

Players who `queue.join` for the same `gameId` at a compatible `stake` are paired in arrival order (FIFO is enough for the demo). While waiting, the client shows the lobby state from `queue.waiting`. The instant a second human (or the through-the-front-door demo client) joins the same queue, the core creates the match, escrows are already held, and both clients receive `match.start`.

No special opponent type exists at this layer. A demo opponent is just another authenticated client that sent `queue.join`.

## Guest mode (issue #267)

`POST /auth/guest` is the entry point for CHARTER.md's documented guest-mode exception (the anonymous, curated preview — see `GUEST_MODE_STRATEGY.md`/`GUEST_MODE_CONTRACT.md`). A guest session is isolated from the real platform **by construction**, not by a runtime flag:

- **Session.** `signGuestToken` (a pure `jwt.sign`, no DB write) mints a token for a fresh `guest:${randomUUID()}` id — no `accounts` row, no email, no password. The token's `role` claim is `'guest'`.
- **Wallet.** A guest's balance lives in a second, in-memory `Ledger` implementation (`createEphemeralLedger`) — never the real SQLite-backed one. It is gone on process restart by design, and evicted early: the WS gateway drops a guest's entries `forfeitDelayMs` after its socket closes (cancelled on a reconnect within that window), bounding memory without a durable cleanup system.
- **Matchmaking.** A second `Matchmaking` instance, backed by the ephemeral ledger and registered with only the curated game set (`coinflip` for this PR) — own queues, own active-match table, no `matchHistory` (so a guest match never reaches the real leaderboard). The SAME `/ws` connection and message types (`queue.join`, `move.make`, …) are used; the gateway dispatches per-connection to the guest instance when the verified token's role is `'guest'`.
- **Opponent.** A permanently-resting Demo-Opponent (`demo-bot:coinflip`) plays every guest instantly — `queue.join`'s ordinary FIFO pairing does the work, no bot-specific core code. Fixed stake: guest Coinflip has no bet picker: every round is `GUEST_COINFLIP_STAKE` (`@rapidclash/shared`), the one stake the bot rests at.
- **Redaction.** Unchanged — the bot's pick goes through the normal `applyMove`/`viewFor` path, so it stays hidden from the guest exactly like a real opponent's would.
