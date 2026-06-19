# Blackjack — PvP v1 (confirmed)

The confirmed head-to-head, no-house Blackjack. This **supersedes** the provisional "Blackjack duel" note in `CHARTER.md`'s open-spec section — Blackjack is now a defined game, the duel-redefined form required by invariant #1 (PvP-only roster). Baccarat remains the one open house-banked redefinition.

## Invariants preserved

- **#1 humans vs humans, never the house.** Two players, symmetric stakes, no dealer. Each plays their *own* hand; the platform never takes a side. This *is* the PvP redefinition that lets a house-banked classic onto the roster.
- **#2 server-authoritative + redaction.** Decks, draws, timers, and outcome live on the server. A player ever sees only their own cards plus exactly one opponent card; everything else is hidden until reveal (`viewFor`).
- **#4 play-money.** All amounts render in `¢` (the spec's `$` examples are play-money illustrations).

## Gameplay (v1)

**Stake & pot.** Both players press play; each stake locks into a shared pot, awarded to the winner. Escrow stays locked through any replays (see Draws); **rake is taken once, on the decisive result only** — never per replay round.

**Decks & deal.** Two *independent* decks, one per player — so play is non-interactive (no shared shoe, no draw-order contention). Each deck is shuffled from a **provably-fair commit-reveal**: the server publishes a hash of the round's seed *before* the deal and reveals the seed *after*, so each player can verify their own card sequence. Each player is dealt 2 cards from their own deck, and sees **both of their own cards and exactly one of the opponent's** — symmetric, and the only opponent information ever shown.

**Actions & timer.** Hit or Stand only (no double, split, or insurance). On the deal a **10-second timer** starts for both players simultaneously; each Hit resets that player's timer; expiry → auto-stand on current total. Bust (>21) locks the hand. Ace is 1 or 11, auto-downgraded to avoid a needless bust. Nothing about the opponent is surfaced during play — not drawn cards, not stand status.

**Reveal & win matrix.** Hands are revealed once both players have stood, busted, or timed out:
- one busts, the other doesn't → the non-buster wins;
- both stand ≤21 with different totals → higher total wins;
- equal totals (21 = 21; a natural counts as plain 21, no bonus) → draw;
- both bust → draw.

**Draws → replay.** Any draw triggers an **instant replay**, repeating until one player wins. Each replay round uses two fresh decks with a *new* commit-reveal (new seed + hash published at the round's start, revealed at its end), so every round is independently verifiable and decks never run low on a long chain. The pot carries over untouched; rake is still only applied at the eventual decisive result.

**Disconnect.** A dropped player is treated as **auto-stand on their current total** at timeout (not an instant forfeit); the reveal then proceeds normally.

**Settlement.** The winner receives **pot − rake**. Rake is the platform fee applied once on the decisive result (see the fee note below).

## Mapping to the game-module contract

Blackjack satisfies the existing `GameModule` contract — no core change — with these specifics for the programmer:

- **`init(players, rng)`** — for the round, derive each player's deck from the round seed via commit-reveal (publish hash now, reveal seed at round end). Deal 2 cards per player from their own deck. Start both 10s timers.
- **Concurrent play, not turn-based.** Both players act simultaneously against their own hand. `legalMoves` for a player is `["hit","stand"]` until they bust/stand/time-out, then `[]`. `applyMove` handles each player's hit/stand independently; the server runs the two per-player timers and auto-stands on expiry.
- **`isTerminal`** — false while either player is still acting **and** false after a *drawn* round (the match re-deals a fresh round instead). True only when a round produces a decisive winner.
- **`outcome`** — only ever returns `win` at the contract level. **Internal draws are not contract-`draw`** — they loop into a new round within the same match and the same escrow. (This is why Blackjack does *not* use the RPS/Coinflip "draw → refund, no rake" policy: a Blackjack draw replays rather than refunds.)
- **`viewFor`** — returns the player's own two-plus cards and exactly one opponent card; redacts the opponent's other card, all opponent hits, and the opponent's stand/bust status until terminal reveal.
- **`forfeit` (disconnect)** — convert the dropped player to auto-stand on their current total and resolve, rather than voiding.
- **Determinism / verifiability** — the round replays identically from its revealed seed; the commit-reveal adds *client-visible* pre-commitment on top of that.

## Fee, ranking, stakes — to confirm with the owner

- **Rake rate — RESOLVED (owner 2026-06-19): 2%, platform-wide.** A single canonical rate in the fee config (`WALLET_LEDGER.md`); Blackjack uses it like every other game (never a Blackjack constant). ⚠️ **The code currently defaults to 5%** (`matchmaking.ts` `FEE_RATE` `0.05`) — a separate small change aligns the default to `0.02` (+ updates the affected settlement tests and docs). This changes settlement for **all** games, not just Blackjack.
- **Ranking:** unspecified. Blackjack is chance-dominant with light skill; `net_winnings` (like the other chance games) is the natural fit. Owner to confirm vs `win_rate`.
- **Stake range:** follows the game's `BetRules` meta; default to the same range as the other games unless the owner sets otherwise.

## Edges — RESOLVED (owner 2026-06-19)

- **Provably-fair scope → seeded-RNG first.** v1 ships on the contract's existing deterministic seeded RNG (replayable/verifiable internally). Real commit-reveal (pre-deal hash, post-deal seed reveal, client "verify" UI) is **roadmap/design intent**, not built for v1 — present it as the "provably fair by design" direction, the honest non-blockchain answer to the mock's on-chain claim. Generalizing a commit-reveal trust story to Coinflip/RPS is deferred with it. **Programmer note:** treat the spec's commit-reveal language as the target design, but implement the seeded-RNG shuffle now (decks derived deterministically from the round seed).
- **Unbounded draws → cap at 10 replays.** After **10** consecutive drawn rounds, **void and refund both** (no rake); a match can never loop forever.
- **Both players disconnect → void.** If both drop and the auto-stand resolve is a draw, **void/refund** rather than replaying with no one present.
