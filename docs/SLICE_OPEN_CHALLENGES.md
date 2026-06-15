# Slice — Open-Challenges Lobby

A visible, tappable list of resting bets on the stake screen, so a player who arrives to an "empty" platform can still find a match instantly instead of waiting alone. It is game-agnostic (lives in core matchmaking) and lifts every game at once. Decided across issues #36 follow-up discussion; recorded as ADR-008.

This is **additive**. It changes no invariant and no money flow. The typed-amount path stays exactly as previously designed.

## Goal

On the stake screen, below the amount entry, show up to 5–10 of the longest-waiting open challenges for this game — each with the owner's name, the stake, and a live countdown. One tap claims it and goes straight into a match. If nothing is eligible to show, the list is simply absent.

## Behaviour

### Two ways to start a match (both unchanged in spirit)

- **Type an amount (the previous design, untouched):** `queue.join { gameId, stake }`. If a resting bet exists at that stake, the server FIFO-matches the oldest one; otherwise the player rests as a new open challenge. A player who ignores the list gets exactly the old behaviour.
- **Tap a challenge (the new overlay):** `challenge.take { matchId }` claims that specific resting bet. Escrow is conditional on winning the claim.

Because matching is oldest-first and the list is ordered oldest-first, the two paths agree: tapping the top of the list picks the same bet the typed-amount FIFO path would.

### What the list shows

- Only challenges that have **rested ≥ 5s** (the "too fast to read" threshold) **and** still have a safe margin before expiry (so a tap won't routinely land on something that just expired).
- The viewer's **own** challenges are excluded.
- Ordered **longest-waiting first** (these are closest to expiring and most in need of a taker).
- Capped at 5–10 entries, **no scrolling**. If more exist, a quiet "+N more waiting" line, not a scrollbar.
- Each row: owner name, stake, and a countdown that ticks down the server's `expiresAt`. Updates to the set itself are event-driven via `challenges.update`; the countdown is client-side animation only.

### The owner's view while waiting

The owner's `waiting` event carries `expiresAt`. Their lobby shows their own countdown with reassuring copy — "Your challenge expires in 0:48 and auto-refunds; no need to cancel." On expiry they receive `challenge.expired`, their escrow is refunded, and the client offers a one-tap **re-post** rather than dropping them out of the flow. Manual cancel (`queue.leave`) remains available throughout.

### Expiry & priority

A uniform platform TTL applies to every resting bet (proposed default **60s**, a single config value — owner-tunable). The server sweeps expired challenges and refunds escrow idempotently. Because the TTL is uniform, oldest-first FIFO **is** soonest-to-expire-first — no separate priority queue. (Only if per-bet custom durations are ever introduced would the sort key change to `expiresAt`; deferred.)

## Acceptance criteria

- **OC1 — regression:** the typed-amount path matches exactly as before (FIFO oldest-at-stake, else rest). No change to existing RPS flow.
- **OC2 — feed contents:** the list shows only entries rested ≥5s with a safe expiry margin, excludes the viewer's own, is ordered longest-waiting first, and is capped with no scroll.
- **OC3 — atomic claim (headline):** two players claiming the same challenge concurrently produce exactly one match; the loser is refused with **no escrow written**. Verified by a concurrency test.
- **OC4 — no self-take:** a player cannot claim their own challenge (excluded from the list and rejected server-side).
- **OC5 — balance check:** a taker with insufficient balance is refused before any escrow.
- **OC6 — expiry sweep:** a challenge past its TTL is removed, the owner's escrow is refunded exactly once (idempotent), and `challenge.expired` is pushed.
- **OC7 — owner countdown:** `waiting` carries `expiresAt`; the owner's lobby shows a correct countdown and the auto-refund reassurance.
- **OC8 — event-driven feed:** `challenges.list`/`challenges.update` reflect add/take/expire/cancel; no polling; the countdown is the only timer running client-side.
- **OC9 — priority equivalence:** under the uniform TTL, the entry the list/FIFO selects first is the soonest to expire (test guards against accidental divergence).

## Core changes (additive)

- Add `expiresAt` to queue entries and a sweeper that refunds on expiry.
- Add `takeChallenge(playerId, matchId)` — atomic specific-claim, escrow on success only.
- Add `listOpenChallenges(gameId, viewerId)` — eligible, capped, ordered, username-joined, self-excluded.
- Leave `joinQueue(gameId, stake)` and `leaveQueue` as they are.
- Username lookup needed here also resolves the leaderboard `displayName` placeholder — do it once, share it.

## Sequencing

Independent of Coinflip; do it after the Coinflip module (#35) lands. This is the single largest improvement to how the demo *feels*, and being in matchmaking it benefits all games.
