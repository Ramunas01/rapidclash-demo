# Protocol

Two channels. REST for request/response actions that are not part of live play; WebSocket for the match itself, where the server must push state to clients.

The message and payload types live in `packages/shared` and are imported by both client and server — they are defined once, never duplicated.

## REST

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/auth/register` | create account, grant starting play-money, return session token |
| `POST` | `/auth/login` | return session token |
| `GET`  | `/wallet` | derived balance + recent ledger entries for the player |
| `GET`  | `/games` | list of available games with their `GameMeta` (stakes, ranking type, etc.) |
| `GET`  | `/leaderboard/:gameId` | ranked standings for a game |
| `GET`  | `/matches/:id` | result/history of a finished match (read-only, idempotent) |

Auth token is sent as a bearer header and also used to authenticate the WS connection on open.

### Admin (privileged — requires the `admin` role)

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/admin/players` | players overview: per-player games played/won/lost/drawn, money won/lost, wallet balance (all derived) |
| `GET`  | `/admin/players/:id/log` | a player's match log: timestamp, opponent, result, signed amount, running balance |
| `POST` | `/admin/players/:id/credit` | add play-money (`{ amount, idempotencyKey }` → one `ADMIN_CREDIT` entry) |
| `DELETE` | `/admin/players/:id` | remove account and free its alias; refused if the account has an active match or escrowed stake |

These reject any non-admin token. See `ADMIN.md` for the derivations and the account-removal rules.

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
| `queue.join` | `{ gameId, stake }` | enter matchmaking for a game at a stake (escrow happens here) |
| `queue.leave` | `{ gameId }` | leave the lobby before matched (refund escrow) |
| `move.make` | `{ move }` | submit a move in the current match |
| `match.resume` | `{ matchId }` | after reconnect, ask for current redacted state |
| `match.forfeit` | `{}` | concede / leave an in-progress match |

### Server → client

| type | payload | meaning |
|------|---------|---------|
| `queue.waiting` | `{ gameId, since }` | you are in the lobby; no opponent yet |
| `match.start` | `{ matchId, opponent, state }` | matched; here is your redacted starting view |
| `match.state` | `{ state, events }` | updated redacted view + events to animate |
| `match.your_turn` | `{ legalMoves }` | it is your turn; here are your legal moves |
| `match.end` | `{ outcome, settlement }` | terminal; result + what changed in your wallet |
| `error` | `{ code, message }` | illegal move, insufficient balance, etc. |

### Rules the protocol enforces

- The server only ever sends a player their own `viewFor` state. The opponent's hidden information is never on the wire.
- `move.make` is validated against the server's `legalMoves` before `applyMove`; an illegal or out-of-turn move returns `error`, never mutates state.
- `match.resume` is safe to call any number of times; it reads state, never advances it.
- `queue.join` is the escrow point. If matchmaking fails or the player leaves the lobby, the escrow is refunded via the ledger. A player who is matched is committed.

## Matchmaking & lobby

Players who `queue.join` for the same `gameId` at a compatible `stake` are paired in arrival order (FIFO is enough for the demo). While waiting, the client shows the lobby state from `queue.waiting`. The instant a second human (or the through-the-front-door demo client) joins the same queue, the core creates the match, escrows are already held, and both clients receive `match.start`.

No special opponent type exists at this layer. A demo opponent is just another authenticated client that sent `queue.join`.
