**To the Designer — Mines rules 5 / 7 / 9: the differences from today's 8×8 engine, in one place**

Read the new rules and cross-checked them against the live engine (`packages/games/mines/src/mines.ts`). Beyond the two named changes (board 8×8/7 → 5×5/3, and removing the auto-reveal), here's where rules 5, 7, 9 diverge from how the live game resolves today.

---

**Rule 5 — bust keeps your gems.** No difference. Today's engine already locks a busted player at their current safe-tile count and never zeroes them; a mine is simply not added to the score. Rule 5 is how it already works.

---

**Rule 7 — "only a mine or the clock ends a round."** Three real differences today:

1. **There's a third round-end condition today: clearing the board.** If a player reveals every safe tile, the engine locks them at max score ("perfect run"), same as a bust-lock but without the mine. On 8×8 (57 safe tiles) this almost never happens. On 5×5 (22 safe tiles, 30-second clock) a fast player will clear regularly. Under rule 7 as written, clearing all 22 is *not* a round-end — the player would have to keep tapping (every remaining tile is a mine) or wait out the clock. **Which do you want:** auto-lock the moment someone reaches 22, or no special handling (they sit at 22 until a mine-tap or the clock)?

2. **The match can resolve early today, before the clock.** If one player is locked (busted or cleared) at score S and the *other* player's live gem count climbs past S, the match ends that instant — it does not wait for the round clock, because the outcome can no longer change. Your rules (and the prototype, which just compares both final scores at `startMinesResult`) read as: both players play to their own independent end (mine or clock), *then* scores are compared. **Confirm you want early resolution removed** — i.e. a round always runs until both players have ended, even when one has mathematically already won.

3. **The opponent's gem count is visible mid-round today.** Once either player locks, the engine reveals the opponent's running count to the other — so you either race a known target ("they busted at 9, I need 10") or watch them chase your locked score. The prototype hides the opponent's count entirely until the round ends. **Confirm the opponent's gem count should stay hidden until both players finish** (no visible target, no chase).

Differences 2 and 3 are really the same question: **is Mines a real-time race with visible opponent progress, or two parallel solo runs compared at the end?** Today it's the former; your rules and the prototype read as the latter. This is the biggest call in here.

---

**Rule 9 — draw → rematch, pot carries.** No difference in the mechanism — today's engine already replays a drawn round in the same escrow with a fresh seeded board and the same two players, paying out nothing on the draw. One addition to know about:

- **There's a safety cap: after 10 consecutive exact-score draws, the match voids and both players are refunded (no rake).** Rule 9 as written implies unlimited rematches. Ten identical-score draws in a row is effectively unreachable, so the cap is a backstop, not a gameplay rule — but flagging it since you asked for rule 9 specifically. **Keep the cap at 10, raise it, or remove it entirely?**

---

**One consequence of removing the auto-reveal, worth surfacing.** The "4-second auto-reveal" in the old version is, in the real engine, a per-player move timer that's also doing a second job: **it's the disconnect handler.** A dropped player's tiles keep getting auto-revealed until they lock, so a disconnect never voids the match. Remove the auto-reveal and a disconnected player simply stops tapping and gets locked at their current gems when the 30-second clock ends — which is clean and matches rule 6. **Just confirming that's the intended disconnect behavior:** no void, no special handling, a dropped player keeps whatever they'd collected.

(Also, mechanically: "remove the auto-reveal" means replacing the per-move timers with the single 30-second round clock — a change to how time works in the round, not just deleting a timer. Noting it so the scope is clear.)

---

Nothing else in rules 5/7/9 differs. Once you've answered the questions above (the three under rule 7, the cap under rule 9, and the disconnect confirmation), the engine change is well-defined and we can ticket it.
