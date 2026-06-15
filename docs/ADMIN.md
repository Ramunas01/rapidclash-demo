# Admin / Operator Interface

A privileged, role-gated area for the platform operator. It exists for two reasons: **visibility** into what is happening across the platform, and **demo testing convenience** (top up a wallet, reset an alias). It is not a player surface.

Like the player-facing numbers, everything here is **derived from the ledger and match records** — there are no separate counters that could drift out of sync with the money.

## Access

The admin area is gated by an `admin` role on the account (see `role` in identity). A normal player token cannot reach any admin endpoint. For the demo, one pre-seeded admin account is enough; do not expose admin registration to the public.

## Views

### Players overview

A table of all registered players. Every column is computed from existing data — none of it is stored redundantly.

| Column | How it is computed |
|--------|--------------------|
| Alias | account record |
| Games played | count of terminal matches the player was in (excludes `void`) |
| Games won | matches whose outcome was `win` with this player as winner |
| Games lost | matches whose outcome was `win` with the opponent as winner |
| Games drawn | matches whose outcome was `draw` |
| Money won | sum of positive per-match P&L (see below) |
| Money lost | sum of the absolute value of negative per-match P&L |
| Wallet balance | derived balance = sum of all the player's ledger entries |

**Per-match P&L** for a player = (all ledger credits to that player for that `match_id`) − (all ledger debits from that player for that `match_id`). A win yields `+(opponent_stake − rake)`; a loss yields `−stake`; a draw yields `0` (stake refunded, no rake). This definition is exact and reconciles to the wallet by construction.

### Player game log

Selecting a player shows their match history, newest first:

| Timestamp | Opponent | Result | Amount (Δ) | Wallet balance after |
|-----------|----------|--------|-----------|----------------------|
| match end time | opponent's alias (snapshot at match time) | won / lost / drawn | signed per-match P&L | running balance up to and including that match's settlement |

The "wallet balance after" column is the running total of ledger entries ordered by time, so the log always ties out to the current balance at the bottom.

## Functions

### Add money

Credit play-money to a player's wallet. Implemented as a single `ADMIN_CREDIT` ledger entry (positive amount), keyed by an idempotency key so a double-submit credits once. Because it is a ledger entry, the new balance is automatically correct and the top-up shows up in audit. No balance field is ever edited directly.

### Remove account

A **basic, best-effort convenience** so the operator can re-register the **same alias** during testing. It is **refused** if the account has an active match or any stake in escrow (a reset must never strand money in a pot); otherwise it removes the player's own record and ledger entries and frees the alias for reuse. It is the one sanctioned, out-of-band exception to the append-only rule in `WALLET_LEDGER.md` — reachable only through this admin function, never from any player or game code path.

For a full reset, prefer wiping the database (below) — that is the canonical reset and needs no per-account logic.

### Resetting demo data

The **canonical reset** is to wipe the database and restart: stop the server, delete the SQLite DB file (`DB_PATH`), and start it again. All players, wallets, and matches are cleared and the `admin` account **re-seeds automatically** on startup (via `ensureAdmin`). Add-money plus this full reset are the entire operator-reset story; no per-account deletion beyond the convenience above is needed or scoped.

## What this interface must not do

- It does not let the operator influence a live match outcome, set RNG seeds, or act as a player. Visibility and account/wallet management only.
- It does not bypass the ledger. Add-money is a ledger entry; balances are always derived.
