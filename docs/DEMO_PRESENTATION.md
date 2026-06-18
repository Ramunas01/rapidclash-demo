# Demo Presentation Aids

Two tools that make the demo *feel* alive without faking anything: the credits display convention, and the bot crowd. Both are presentation-layer — neither changes the money model or the core.

## Credits display

The unit is **credits** (play-money). To keep the UI compact and on-brand — and to drop the misleading `$` from the design mock, which read as real money — credits get a short display form.

This is a **display/formatting decision only**. The ledger, protocol, schema, and stored values all stay plain integer credits (`format.ts` + UI labels are the only things that change). Swapping the symbol is a one-line change in the formatter, so the choice below is fully reversible.

**Compactification ladder** — the symbol used beside numbers (e.g. `320¢`):

1. **`¢`** — *first attempt.* Compact and gives the "¢redits" wordmark. Caveats that may sink it: `¢` is technically the US-cent sign (a mild real-money / dollar implication), and the glyph aligns inconsistently across fonts. **Test it in the app's actual font first.**
2. **`⚡`** — fallback. The brand bolt, unambiguously *not* a currency, reinforces identity (`320 ⚡`).
3. **`¤`** — fallback. The generic currency-placeholder sign; neutral, no specific-currency implication.
4. **`🪙`** — fallback. Coin emoji; playful, clearly not real money (watch cross-platform emoji rendering).

**Registers** (so it reads as craft, not a typo):
- `credits` — canonical, used everywhere in **code**, schema, and body copy.
- `¢redits` (or the chosen symbol as a wordmark) — for **labels/headers** only.
- `¢` / chosen symbol — the **inline unit** beside a number (`50¢`), never mid-sentence ("you have 50 ¢redits" looks broken; "your balance: 50¢" is fine).

## Bot crowd

A small set of clearly-labelled automated players that populate the open-challenges feed during a presentation, so a presenter or investor can immediately find and play a real match instead of facing an empty lobby. This is the **honest** cold-start aid — the opposite of a fake scrolling list — because each bot is a genuine, settling opponent, plainly marked.

**Why it needs no server change.** Because the core has no "play the house" path (every opponent connects through the same REST+WS API), a bot is just an ordinary client. The server can't distinguish `🤖R2D2` from a person, so "humans vs humans, never the house" stays mechanically true. See ADR-010 for the hard demo-only boundary.

**Shape (a standalone harness, run from the presenter's PC):**
- Lives outside the deployed app (e.g. `tools/bot-crowd/`); **not** shipped to Cloud Run.
- A roster config: each bot is `{ name (🤖-prefixed), gameId, stake, policy }`. Examples: `🤖c3PO` → 5¢ Coinflip, `🤖R2D2` → 10¢ Coinflip.
- Per bot: `api.register` (gets the signup grant for funding; top up via the admin credit endpoint if it runs low — keep stakes small so the grant lasts), open a WS connection, then loop.
- Behaviour, using the existing `ws` client: **primarily post-and-wait** — `joinQueue(gameId, stake)` to rest as an open challenge so a human can press JOIN — and respond to `match.your_turn` / the choice prompt with a legal move (RPS: any legal move; Coinflip: pick a side). On `challenge.expired`, re-post. Optionally let a few bots `takeChallenge` each other for light background motion, but bias toward leaving joinable challenges open for the human.
- Keep it small (≈5–10 bots, modest activity). The demo runs on a single Cloud Run instance (`max-instances=1`), so don't flood it.

**Guardrails:**
- **Demo-only**, always (ADR-010). Never a production liquidity mechanism.
- Bots are always 🤖-prefixed and visible as such — the honesty depends on the label.
- Optional: exclude 🤖-prefixed accounts from the *displayed* leaderboard (their matches settle normally; this is cosmetic).
