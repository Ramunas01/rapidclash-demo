# bot-crowd

A small, standalone harness of **clearly-labelled (`🤖`) automated clients** that
populate the **open-challenges feed** during a demo, so a presenter or investor
can immediately press **JOIN** and play a real, settling match instead of staring
at an empty lobby.

## ⚠ Demo-only — the hard boundary (ADR-010)

> A platform-operated bot that players bet against would, with real value, be
> *the house wearing a robot costume* — breaking the Charter's invariant #1
> ("humans vs humans, never the house") and triggering gambling regulation.

These bots are **never** a production liquidity mechanism. They are honest because:

- Each bot is an **ordinary client** on the same public REST + WebSocket API as any
  human — there is **no "play the house" path** in the core, and the server cannot
  tell `🤖R2-D2` from a person. Invariant #1 stays *mechanically* true.
- Every bot is **`🤖`-prefixed** and visible as such in the feed. The honesty
  depends on the label — don't remove it.
- The harness lives **outside** the deployed app (`tools/bot-crowd/`) and is **not**
  shipped to Cloud Run (the Docker image only deploys `@rapidclash/server`).

See `docs/DEMO_PRESENTATION.md` → "Bot crowd" and ADR-010 in `docs/ARCHITECTURE.md`.

## What it does

Per bot: `POST /auth/register` (the signup grant funds it; tops up via the admin
credit endpoint if it runs low), opens a WebSocket, then runs its policy:

- **`rester` (most bots) — post-and-wait.** `queue.join(gameId, stake)` to rest as
  an open challenge a human can JOIN; on `match.your_turn` reply with a random legal
  move from the server-provided `legalMoves` (works uniformly for RPS / Coinflip /
  Chess); on `match.end` re-post after a short delay; on `challenge.expired` re-post.
- **`taker` (one bot) — light background motion.** Subscribes to the feed and
  `challenge.take`s a peer bot's challenge **scoped to its own `(gameId, stake)`
  lane only**, so it never claims the distinct-stake challenges left open for the
  human.

The default roster is 7 bots; lanes are kept at distinct stakes so each rester
stays a stable, joinable challenge, with one `rps @ 3` pair (`🤖Sparks` rests,
`🤖Bolt` takes) providing visible motion:

| Bot       | Game     | Stake | Policy |
| --------- | -------- | ----: | ------ |
| 🤖C-3PO   | coinflip |     5 | rester |
| 🤖R2-D2   | coinflip |    10 | rester |
| 🤖BB-8    | rps      |     5 | rester |
| 🤖K-2SO   | rps      |    10 | rester |
| 🤖Chewie  | chess    |     5 | rester |
| 🤖Sparks  | rps      |     3 | rester |
| 🤖Bolt    | rps      |     3 | taker  |

(Edit `ROSTER` in `src/config.ts` to change it. Keep it ~5–10 bots — the demo runs
on a single `max-instances=1` instance, so don't flood it.)

## Gated mode (`TAKER_ONLY_GAMES`)

Setting `TAKER_ONLY_GAMES` (comma-separated game ids, e.g.
`TAKER_ONLY_GAMES=coinflip,blackjack,chess`) swaps `ROSTER` for a curated, on-duty
crowd covering only the listed games — this is what `docs/DEMO_TAKER_VM_SETUP.md`'s
always-on VM runs, on the **real ledger**, for a reserved investor-demo account
(never the general 26-bot roster's games). Per listed game:

- **1 taker**, gated by `TAKER_ALLOW_NAMES` — claims *any* stake an allow-listed
  human posts (optionally narrowed to one exact stake via `TAKER_STAKE`), except
  `TAKER_EXCLUDE_STAKE` (issue #362) — one reserved stake the taker never claims,
  so two allow-listed reserved accounts can deliberately pair with each other
  there. This is the only gated part.
- **A resting pool** at each of `GATED_RESTER_STAKES`'s stakes (`src/config.ts`) —
  several `🤖<game>-rest-<stake>` identities, one per stake, all policy `rester`.
  These are **not** allowlist-gated: a resting bot-waiter is already safe for any
  real player to see and JOIN (same ADR-010 reasoning as the general roster's
  default resters — it risks its own real funded balance either way). Gating only
  matters for *taking*, never resting.

Real credits are at stake here (this mode runs against the real ledger, not an
isolated one), so `GATED_RESTER_STAKES` is kept deliberately modest — see its doc
comment in `src/config.ts`.

## Run

From the repo root (the workspace install provides `tsx` and the shared types):

```bash
pnpm install
# point at a running server (defaults to http://localhost:3000)
pnpm --filter @rapidclash/bot-crowd start
```

or from this directory: `pnpm start`. Stop with **Ctrl-C** (resting challenges are
cleared on shutdown).

You'll need a server running. Locally:

```bash
pnpm run build && node apps/server/dist/index.js   # serves on :3000
```

Then open the web app, go to a game's lobby, and you should see the `🤖` open
challenges — press JOIN on one to play it to settlement.

## Environment variables

| Var                     | Default                 | Meaning                                                        |
| ----------------------- | ----------------------- | ------------------------------------------------------------- |
| `SERVER_URL`            | `http://localhost:3000` | REST + WS origin. Set to the live `https://…run.app` for demos. |
| `ADMIN_USERNAME`        | `admin`                 | Admin account for top-ups.                                     |
| `ADMIN_PASSWORD`        | `admin-dev`             | Admin password. If login fails, bots just run on the grant.    |
| `BOT_PASSWORD`          | `bot-crowd-demo`        | Shared password for the bot accounts (usernames are distinct). |
| `BOT_START_STAGGER_MS`  | `700`                   | Delay between bringing each bot online.                        |
| `BOT_REPOST_DELAY_MS`   | `4000`                  | Pause before a rester re-posts after a match.                  |
| `BOT_MOVE_DELAY_MS`     | `700`                   | "Thinking" pause before replying a move.                       |
| `BOT_RECONNECT_DELAY_MS`| `2000`                  | Delay before reconnecting a dropped socket.                    |
| `BOT_LOW_BALANCE_FACTOR`| `5`                     | Top up when `balance < stake × factor`.                       |
| `BOT_TOPUP_AMOUNT`      | `500`                   | Credits added per top-up.                                      |
| `TAKER_ONLY_GAMES`      | *(unset)*               | Comma-separated game ids → gated mode (see above). Unset = full general roster. |
| `TAKER_ALLOW_NAMES`     | *(unset)*               | Comma-separated human owner names a gated taker will claim. Empty = any human. Resters are never gated by this. |
| `TAKER_STAKE`           | `0`                     | Gated taker claims only this stake. `0` = any non-reserved stake. |
| `TAKER_EXCLUDE_STAKE`   | `0`                     | Gated taker never claims this stake (issue #362). `0` = none excluded. |

> The `SERVER_URL` must reach the server's WebSocket too; the WS URL is derived from
> it (`http→ws`, `https→wss`, same host/path) + `/ws`.

## Tests

This package's tests are **not** part of the root `pnpm -w run test` suite (see
"Not shipped" below — `tools/*` sits outside the root test globs same as it sits
outside the root build). Run them from here instead:

```bash
pnpm --filter @rapidclash/bot-crowd test
# or, from this directory:
pnpm test
```

## Not shipped

`tools/*` is a workspace member for dependency resolution only. It is **not** in the
root `tsc -b` build, **not** in the test globs, and the production Docker image
deploys `@rapidclash/server` exclusively — so this harness can never reach Cloud Run.
