# Wallet & Ledger

The wallet is **never a mutable number**. It is the running total of an append-only ledger of transactions. This is the single most important correctness decision in the platform — even with play money — because it makes every balance explainable, every settlement reproducible, and reconnects safe.

## Model

One append-only table. Nothing is ever updated or deleted.

```
ledger_entry
  id              uuid        primary key
  account_id      string      the player (or the PLATFORM account for rake)
  match_id        string?     null for grants
  type            string      see below
  amount          integer     signed minor units; credit > 0, debit < 0
  idempotency_key string      unique; replaying the same key is a no-op
  created_at      timestamp
```

**Balance is derived:** `balance(account) = sum(amount where account_id = account)`. Cache it if needed, but the ledger is the truth.

Use integer minor units (e.g. credits, not floats) throughout. No floating-point money, ever.

### Entry types

| type | amount | meaning |
|------|--------|---------|
| `GRANT` | + | starting play-money given to a new account |
| `ADMIN_CREDIT` | + | play-money added to a wallet by the operator (see `ADMIN.md`) |
| `BET_ESCROW` | − | stake moved out of the player's wallet into the match pot |
| `SETTLE_WIN` | + | pot (minus rake) credited to the winner |
| `SETTLE_REFUND` | + | stake returned (draw split or voided match) |
| `RAKE` | + (to PLATFORM) | the platform fee, credited to the platform account |

The pot is the sum of the two `BET_ESCROW` debits. At settlement it is fully accounted for: winner credit + rake = pot, to the unit. The ledger always balances to zero across all accounts.

## Bet lifecycle

1. **Commit** — player places a stake. One `BET_ESCROW` debit per player as they join the match. A player cannot escrow more than their balance (checked against the derived balance).
2. **Hold** — both stakes now sit in the pot, out of both wallets, for the match duration.
3. **Settle** — exactly one of:
   - **Win:** `SETTLE_WIN` to the winner for `pot − rake`; `RAKE` to PLATFORM for `rake`.
   - **Draw:** `SETTLE_REFUND` of each player's own stake back in full. **No rake on a draw** (confirmed policy). The fee rate is the single config value; the draw rule lives next to it.
   - **Void:** `SETTLE_REFUND` of each stake in full, no rake.

`rake = round(pot * feeRate)`. The fee rate lives in one config value. Rounding policy (favour the player or the platform on the half-unit) is decided once and documented next to that config.

## Idempotency & reconnect safety

Every settlement is one database transaction, keyed by `match_id`. Before writing, the core checks whether a settlement already exists for that match; if so it does nothing and returns the existing result. Therefore:

- A client reconnecting and re-requesting the result never causes a second payout.
- A retried server operation after a crash mid-settle is safe to replay.
- A double "place bet" tap escrows once (the escrow entry is keyed by `match_id + account_id`).

This idempotency is not optional polish — it is the property that lets the demo survive the flaky-mobile-network reality of being shown on a phone.

## What may write to the ledger

Only the core's settlement, escrow, and grant functions — including the operator **add-money** function, which writes a single `ADMIN_CREDIT` entry through the core (see `ADMIN.md`). Game modules return relative outcomes (`win` / `draw` / `void`); they never compute amounts, see balances, or write entries. REST and WS handlers call the core; they do not write the ledger directly. This keeps every money mutation in one auditable place.

## The one sanctioned exception: account removal

Append-only governs *normal operation* — money is never mutated in place while the platform runs. The admin **remove-account** function is the single deliberate exception: an out-of-band operator reset that removes a player's record and their own ledger entries to free an alias for re-testing. It is reachable only through the admin interface, never from player or game code, and it refuses to run on an account with an active match or escrowed stake. See `ADMIN.md` for the full rules and the open `needs-owner` decision on whether opponents' match history is retained or cascade-purged.
