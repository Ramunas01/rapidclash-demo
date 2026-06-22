# Game Redefinition — converting the house canon to PvP

The thesis (`CHARTER.md`): the house-game canon can be **refactored into player-versus-player games**, so players win and lose to each other instead of to a house that wrote the odds in its favour. This doc is the backlog of that conversion — the method, and a provisional direction for each game — so the work is recorded and tractable, not hand-waved.

**The hard rule (invariant #1):** a house game is **never offered in its house form**. It is a dimmed "coming soon" tile until it has a *confirmed* two-player spec (like `MINES.md` / `BLACKJACK.md`) and is registered; only then is it playable. The set of playable games is always exactly what `/games` returns.

## The conversion recipe

What turns a house game into a fair duel — abstracted from how Coinflip, Blackjack, and Mines were done:

1. **Symmetric stakes into one pot.** Both players commit equally; the winner takes `pot − rake`. No asymmetric "house edge."
2. **Replace the house's edge with a symmetric contest.** The structural advantage that made it a house game is removed by applying the **same seeded randomness to both players** (identical board, shared draw, same curve) or by **rotating any advantaged role** so it nets out. Neither player occupies the operator's seat.
3. **Hidden choices are simultaneous and secret, or roles alternate.** No first-mover or banker edge; choices are revealed only at terminal (`viewFor`).
4. **Server-authoritative + deterministic.** All randomness is seeded and recorded; the match replays identically, so the fairness is auditable (the honest "provably fair by design" story — no blockchain needed).
5. **Decisive result → winner takes pot − rake; draws refund** (or replay, per the game). Rake is per-game (`GameMeta.rakeRate`), applied once on the decisive result.
6. **Ranking by declared type** — `net_winnings` for chance games, ELO for skill — never a per-game core branch (ADR-007).

If a candidate game cannot be made fair under this recipe, that is a finding worth surfacing, not a reason to ship the house form.

## Status

| Game | House mechanic (what makes it "house") | Redefinition status |
|------|----------------------------------------|---------------------|
| Blackjack | Player vs dealer to 21 | **Confirmed** — `BLACKJACK.md` |
| Mines | Solo reveal-and-cash-out vs the system | **Confirmed** — `MINES.md` |
| Baccarat | Player backs a hand vs the banker | Seed below — to confirm |
| Crash | Multiplier rises, cash out before a random crash | Seed below — to confirm |
| Limbo | Pick a target multiplier; instant RNG pays if cleared | Seed below — to confirm |
| Keno | Pick spots; RNG draws; matches pay | Seed below — to confirm |
| Hilo | Guess the next card higher/lower | Seed below — to confirm |
| Dice | Roll over/under a chosen line | Seed below — to confirm |
| Roulette | Bet on a wheel against the house | Seed below — to confirm (hardest) |

## Provisional redefinition seeds

**Illustrative directions, not commitments** — each becomes real only as its own confirmed spec. They exist to show the conversion is thinkable for every game (including the ones that "sound impossible") and to give designers something concrete.

- **Baccarat** — players **alternate the Banker role** each round (or each backs a hand and the standard draw rules decide); the loser's stake transfers; rotation neutralises any banker advantage.
- **Crash** — both watch the **same seeded rising multiplier**; each secretly sets a cash-out point; the higher cash-out *reached before the crash* wins; both caught by the crash → draw. A pure nerve duel.
- **Limbo** — both secretly commit a **target multiplier** against one **shared seeded draw**; if the draw clears both, the braver (higher) target wins; if it clears one, that player wins; if neither, the safer (lower) target wins. Bravery vs caution, head to head.
- **Keno** — both pick the same count of spots on one grid; **one shared seeded draw**; more matches wins; tie → draw.
- **Hilo** — a **shared seeded deck**; both call higher/lower simultaneously each step; the longer correct streak (or more correct over N steps) wins.
- **Dice** — both call over/under and a line on **one shared seeded roll**, resolved against each other; or "closest to a target without going over." 
- **Roulette** (hardest) — a head-to-head over **one shared seeded spin**: each claims a section/colour and the pot transfers to whoever's claim lands; overlapping/!both-miss cases → refund. Needs the most care; flagged as the marquee "impossible" conversion the thesis is really about.

## Process

Each game leaves "coming soon" only when: (1) it has a confirmed spec in this `docs/` set following the recipe, (2) it's implemented as a plug-in module (no core branch), and (3) it's registered so `/games` returns it. Until then it is a dimmed tile that sells the roadmap. Advisor drafts each spec on request; suggested order by tractability: Keno, Hilo, Crash, Limbo, Dice, Baccarat, Roulette.
