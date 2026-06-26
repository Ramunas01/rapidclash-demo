# Game Redefinition — converting the house canon to PvP

The thesis (`CHARTER.md`): the house-game canon can be **refactored into player-versus-player games**, so players win and lose to each other instead of to a house that wrote the odds in its favour. This doc is the backlog of that conversion — the method, and a provisional direction for each game — so the work is recorded and tractable, not hand-waved.

**The hard rule (invariant #1):** a house game is **never offered in its house form**. It is a dimmed "coming soon" tile until it has a *confirmed* two-player spec (like `MINES.md` / `BLACKJACK.md`) and is registered; only then is it playable. The set of playable games is always exactly what `/games` returns.

## The conversion recipe

What turns a house game into a fair duel — abstracted from how Coinflip, Blackjack, and Mines were done:

1. **Symmetric stakes into one pot.** Both players commit equally; the winner takes `pot − rake`. No asymmetric "house edge."
2. **Replace the house's edge with a symmetric contest.** The structural advantage that made it a house game is removed by one of three symmetry mechanisms (all fair): **(a) shared-event** — the *same* seeded randomness drives both players (identical board, one shared draw/spin/curve/roll); **(b) independent-roll** — each player draws from the *same distribution* under a *separate* seed, so identical odds make P(A>B)=P(B>A) (statistical symmetry); or **(c) rotated role** — any advantaged seat alternates so it nets out. Neither player occupies the operator's seat.
3. **Hidden choices are simultaneous and secret, or roles alternate.** No first-mover or banker edge; choices are revealed only at terminal (`viewFor`).
4. **Server-authoritative + deterministic.** All randomness is seeded and recorded; the match replays identically, so the fairness is auditable (the honest "provably fair by design" story — no blockchain needed).
5. **Decisive result → winner takes pot − rake; draws refund** (or replay, per the game). Rake is per-game (`GameMeta.rakeRate`), applied once on the decisive result.
6. **Ranking by declared type** — `net_winnings` for chance games, ELO for skill — never a per-game core branch (ADR-007).

If a candidate game cannot be made fair under this recipe, that is a finding worth surfacing, not a reason to ship the house form.

**Symmetry taxonomy (for the PM/programmer).** Every confirmed game is one of two randomness families — both fair, but they differ in implementation (seed count, redaction, replay record):
- **Shared-event** (one seed drives both): Crash, Roulette, Keno, Limbo, Hilo. The redaction hides each player's *choices/progress*, not the shared event (which is revealed to both at terminal). Record one seed.
- **Independent-roll** (one seed per player, identical distribution): Dice, Baccarat. There are no choices to hide; redaction simply withholds each player's *result* until the simultaneous reveal. Record **both** seeds.

(Blackjack and Mines are the earlier shared-event conversions — two decks from the match seed / identical mine boards.)

## Status

| Game | House mechanic (what makes it "house") | Redefinition status |
|------|----------------------------------------|---------------------|
| Blackjack | Player vs dealer to 21 | **Confirmed** — `BLACKJACK.md` |
| Mines | Solo reveal-and-cash-out vs the system | **Confirmed** — `MINES.md` |
| Baccarat | Player backs a hand vs the banker | **Confirmed** — `BACCARAT.md` |
| Crash | Multiplier rises, cash out before a random crash | **Confirmed** — `CRASH.md` |
| Limbo | Pick a target multiplier; instant RNG pays if cleared | **Confirmed** — `LIMBO.md` |
| Keno | Pick spots; RNG draws; matches pay | **Confirmed** — `KENO.md` |
| Hilo | Guess the next card higher/lower | **Confirmed** — `HILO.md` |
| Dice | Roll over/under a chosen line | **Confirmed** — `DICE.md` |
| Roulette | Bet on a wheel against the house | **Confirmed** — `ROULETTE.md` |

## Provisional redefinition seeds

**Illustrative directions, not commitments** — each becomes real only as its own confirmed spec. They exist to show the conversion is thinkable for every game (including the ones that "sound impossible") and to give designers something concrete.

- **Baccarat** — *confirmed, see `BACCARAT.md`.* **No Banker, no sides, no commission** — each player simply **is their own hand**, dealt from an **independent shoe** by authentic third-card rules; higher last-digit total (closest to 9) wins. Removing the side bet removes the banker edge that commission exists to offset. *Independent-roll* symmetry (like Dice).
- **Crash** — *confirmed, see `CRASH.md`.* Both ride **one shared seeded hidden crash altitude**; each ejects (pre-set auto-eject and/or a live tap); the higher altitude banked before the crash wins; reaching the crash unejected **busts** (banks 0); both crash → draw. A pure nerve duel.
- **Limbo** — *confirmed, see `LIMBO.md`.* Both secretly commit a **target multiplier** against one **shared seeded roll** `R=1/u` (zero edge: survival(t)=1/t); `R`≥both → higher target wins; `R` between → lower (surviving) wins; `R`<both or equal targets → push + replay. Bravery vs caution, head to head.
- **Keno** — *confirmed, see `KENO.md`.* Both pick **8** spots on a **1–40** pool (hidden, 20 s, auto-fill on timeout); **one shared seeded draw of 10**; more matches wins; equal → replay.
- **Hilo** — *confirmed, see `HILO.md`.* A **shared seeded sequence** run by both, each seeing only their own progress; call hi/lo per card, wrong → bust, same rank counts correct; longest correct streak under a **shared 30 s cap** wins; equal → replay.
- **Dice** — *confirmed, see `DICE.md`.* Each player gets **one independent seeded roll** `0.00–99.99` (separate seeds); higher wins; exact tie → replay. No target, no line — *independent-roll* symmetry, the taxonomy partner of Baccarat.
- **Roulette** — *confirmed, see `ROULETTE.md`.* The marquee "impossible" conversion, done: a **zeroless 36-pocket wheel** (removing the green zero deletes the house edge by construction), one shared seeded spin, both players secretly allocate their **full** chip stack across the bet set, higher resulting stack wins. The full-stack rule prevents min-bet stalling.

## Process

Each game leaves "coming soon" only when: (1) it has a confirmed spec in this `docs/` set following the recipe, (2) it's implemented as a plug-in module (no core branch), and (3) it's registered so `/games` returns it. Until then it is a dimmed tile that sells the roadmap.

**Backlog status: COMPLETE.** As of this batch every house game in the canon — Blackjack, Mines, Baccarat, Crash, Limbo, Keno, Hilo, Dice, Roulette — has a confirmed PvP spec. The "impossible" conversion is done across the board; the remaining work is implementation and registration, not design. This is a headline for the pitch: *the entire house-game canon, redefined as human-vs-human, with the house edge removed by construction in each one.*
