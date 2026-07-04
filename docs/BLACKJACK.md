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

**Hand-value display (soft/hard).** The label shows the *conventional* total, never raw ace combinations ("11, 21" is the current bug). Compute: **hard** = sum with every ace as 1; a **soft** total exists iff the hand has an ace and `hard + 10 ≤ 21` (soft = hard + 10 — only one ace can be 11, so it's always exactly +10, however many aces are held); **best** = soft if it exists, else hard. Label rules:
- Show **both** as `hard / soft` (e.g. "7 / 17") **only** while the hand is **live** (player can still act), an ace is present, a soft total exists, and **soft < 21** — the one case where the ace genuinely could land either way.
- Soft **= 21** → show just **"21"**; on the initial two-card hand that is **Blackjack** → show **"BJ"** — the short form, in the **same score-bubble style as the numeric totals** (never the full word "Blackjack", which renders as a wide pill).
- No valid soft (soft would exceed 21) → show the **hard** total only (A+6+9 → "16", never "16 / 26"); a value above 21 is never offered as an option.
- Hand **final** (stand / bust / round resolved) → collapse to the single **best** value (A+6 standing → "17", not "7 / 17"); the ambiguity is resolved, so the display resolves with it.
- **Bust** (hard > 21, no ace relief) → show the hard total (e.g. "23") in the bust state.

Computed from **visible cards only**, so the opponent's label stays redaction-safe pre-terminal. (Server `handValue` already computes the best value for resolution — this is the display layer only.) Test examples: A+J → BJ · A+6 → 7 / 17 (live) · A+6+4 → 21 · A+6+9 → 16 · A+A → 2 / 12 · A+A+9 → 21 · 9+9 → 18 · stand on A+7 → 18 · 10+9+5 → 24 (bust).

**Reveal & win matrix.** Hands are revealed once both players have stood, busted, or timed out:
- one busts, the other doesn't → the non-buster wins;
- both stand ≤21 with different totals → higher total wins;
- equal totals (21 = 21; a natural counts as plain 21, no bonus) → draw;
- both bust → draw.

**Result display (final).** Every outcome shows a **full result state** — all cards stay visible, outlined, and **in place**; nothing skips, moves, or reflows the card layout. Two layers: **card outlines** tell each hand's fate; the **player bar speaks *only on decided rounds*.**

**Reveal choreography (continuous, in place — never a re-render).** The reveal is one continuous scene; **no card ever leaves the screen** (no unmount, blink, or reflow of the existing cards). Sequence: round ends → the opponent's **hidden hole card flips over in place** (a back→face flip at its existing position — not an unmount-and-remount) → the opponent's **hit cards deal in one-by-one from the deck** (the same sliding deal animation used during the round, in sequence, never all at once) → **totals update** → the **result state** shows (outlines / win animation / "Push" label, below). The player should read it as a dealer turning over a hand, not a screen refresh. *(Card stacking: a card's final z-order is set **before** its deal animation begins — the opponent's hole card travels and lands **underneath** the first card throughout, never on top then snapping under.)*

- **Win.** Your cards get a **green** outline; your **bar plays the shared win animation** — 0.5 s fill-in (green, "You Win", username stays visible) → 2 s hold → 0.5 s fade-out to a **persistent green outline**. Same component as Coinflip (`COINFLIP_HUB.md`).
- **Loss.** Your cards get a **red** outline; your **bar shows a red outline only** — minimal, no fill, no text.
- **Push — equal totals (no bust).** Both players' cards get an **orange** outline; **neither bar shows anything.**
- **Push — both busted.** Both players' cards get a **red** outline (bust); **neither bar shows anything.**

**The "Push" label.** Remove the old status line ("Round 2 · 1 push — replaying") above the opponent's cards — it reflows the hand toward the middle, and **nothing about the result may move the card layout.** Instead, on any push, show the single word **"Push" in orange** as an **overlay** on the **right of the panel, vertically between the two hands** (the empty area right of the cards); it must not displace any element. It appears with the result state, holds for the ~2 s, and disappears when the new hands begin dealing.

**One-line rule:** *bars speak only on decided rounds (green win animation / red loss outline); a push shows only on the cards + the orange "Push" label on the right, and the round auto-replays after ~2 s.*

The push holds ~2 s (same weight as a win/loss reveal), then the next round deals via the **universal draw mechanic** (2 s hold → auto-rematch, same opponent, same escrow/bet). **Blackjack's draw surface is cards + "Push" label, NOT an orange bar** — a deliberate deviation from the bar-based draw treatment (Coinflip/Crash), because Blackjack's cards already carry the outcome; see the reconciliation in `SCREENS.md`. Bust totals display **as-is** (e.g. "28"); the over-21 display prohibition applies only to soft-total *options* on live ace hands, never to a final bust total. A player must never have to infer a push from cards suddenly changing.

Any draw thus repeats until one player wins. Each replay round uses two fresh decks with a *new* commit-reveal (new seed + hash published at the round's start, revealed at its end), so every round is independently verifiable and decks never run low on a long chain. The pot carries over untouched; rake is applied only at the eventual decisive result; 10-draw cap → void/refund.

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

- **Rake — RESOLVED (stakeholders 2026-06-19): per-game rate, declared in `GameMeta`.** Rake is **a % of the pot** (sum of both stakes) at a rate **declared per game** (not a single platform-wide constant, and never a Blackjack hard-code): **Blackjack 2.5%**, like RPS and Coinflip; **Chess 10%**. The core reads the match's game `meta.rakeRate` and applies it generically (invariant #5); Blackjack just declares `0.025`. ⚠️ Delivered by a **separate per-game-rake change** (the code currently uses one `FEE_RATE` default of `0.05`); Blackjack inherits that mechanism.
- **Ranking:** unspecified. Blackjack is chance-dominant with light skill; `net_winnings` (like the other chance games) is the natural fit. Owner to confirm vs `win_rate`.
- **Stake range:** follows the game's `BetRules` meta; default to the same range as the other games unless the owner sets otherwise.

## Edges — RESOLVED (owner 2026-06-19)

- **Provably-fair scope → seeded-RNG first.** v1 ships on the contract's existing deterministic seeded RNG (replayable/verifiable internally). Real commit-reveal (pre-deal hash, post-deal seed reveal, client "verify" UI) is **roadmap/design intent**, not built for v1 — present it as the "provably fair by design" direction, the honest non-blockchain answer to the mock's on-chain claim. Generalizing a commit-reveal trust story to Coinflip/RPS is deferred with it. **Programmer note:** treat the spec's commit-reveal language as the target design, but implement the seeded-RNG shuffle now (decks derived deterministically from the round seed).
- **Unbounded draws → cap at 10 replays.** After **10** consecutive drawn rounds, **void and refund both** (no rake); a match can never loop forever.
- **Both players disconnect → void.** If both drop and the auto-stand resolve is a draw, **void/refund** rather than replaying with no one present.
