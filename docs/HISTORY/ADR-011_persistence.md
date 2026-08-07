# ADR-011 — Durable demo persistence (SQLite→GCS snapshot) + password-clear soft reset

*Proposed by Advisor, owner-approved direction (GCS snapshot; hashed passwords; password-clear reset that keeps standings, resets wallet; accumulation is fine).* Fold the paragraph below into `ARCHITECTURE.md` after ADR-010; the reset model + doc-impact list drive the build and the follow-up doc reconciliations.

## ADR-011 paragraph (for `ARCHITECTURE.md`)

**ADR-011 — Durable demo persistence via periodic SQLite→GCS snapshot; no Postgres yet.** Accepted. The demo needs a small amount of state (~10–100 kB: accounts, hashed credentials, standings) to survive Cloud Run instance recycle/redeploy, which ADR-009's local SQLite does not. Rather than pull the scale-phase Cloud SQL forward, the server **snapshots the SQLite file to a Cloud Storage bucket** — debounced, on each settlement/standings write — and **restores it on startup** when present. This keeps the file-backed schema and all queries unchanged (consistent with the documented "start file-backed, migrate to Postgres later" plan), stays on the native GCP platform, and is effectively free at this size. `max-instances=1` means a single writer, so there is no concurrency concern. SQLite-over-GCSFuse is explicitly rejected (network-filesystem locking/corruption risk); the durable path is explicit snapshot/restore, never a mounted live DB. **Passwords are stored only as salted hashes** (bcrypt/argon2), never plaintext. Reset model: see below.

## Reset model — two tiers (replaces the admin "remove account" convenience)

Because aliases and standings now persist, "reset" splits in two:

- **Soft reset = clear an alias's password.** Clears `passwordHash`, **preserves the alias and its standings**, and **automatically resets that account's wallet to the starting demo grant** (no separate admin action). An alias with a cleared password is **claimable**: a demo-team member re-registers it by **setting a new password**, keeping their leaderboard position and starting fresh financially. This *replaces* the old "remove account to free the alias" convenience — the account is never destroyed; only the password is released.
- **Hard reset = full database wipe** (unchanged canonical reset) — clears everything including the durable snapshot, for a true clean slate.

**Build-critical decoupling:** the wallet reset must **not** touch standings. Standings (ELO / net-winnings) therefore persist **independently of the wallet** — a separate stored aggregate, or preserved match-history rows the leaderboard reads from — so clearing/re-granting the wallet leaves the leaderboard position intact. The wallet reset itself is the existing sanctioned append-only exception (clear that one account's wallet ledger and re-seed the grant, or post a compensating entry), scoped to a single account and reachable only via the admin/reset path. Guard unchanged: refuse the soft reset on an account with an active match or escrowed stake (never strand money in a pot).

## Doc impact (Advisor reconciles after this lands)
- **ADMIN.md** — replace "Remove account" with **"Reset password (soft reset)"**: clears `passwordHash`, resets the wallet to the grant, preserves alias + standings; same active-match/escrow guard. Full wipe stays the canonical hard reset.
- **WALLET_LEDGER.md** — the append-only wallet-reset exception is now triggered by the password-reset soft reset (single-account clear + re-grant); note that standings live outside the wallet and survive it.
- **CHARTER.md** — admin line "free a single alias by removing its record" → "release an alias by clearing its password (soft reset: wallet re-granted, standings kept)"; still no user-facing deletion flow.
- **DEMO.md** — add the soft reset to the runbook beside the wipe.
