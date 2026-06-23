# Demo Presentation Aids

Three tools that make the demo *feel* alive without faking anything: the credits display convention, the bot crowd, and the matchmaking "Searching…" reassurance. All are presentation-layer — none changes the money model or the core.

## Credits display

The unit is **credits** (play-money). To keep the UI compact and on-brand — and to drop the misleading `$` from the design mock, which read as real money — credits get a short display form.

This is a **display/formatting decision only**. The ledger, protocol, schema, and stored values all stay plain integer credits (`format.ts` + UI labels are the only things that change). Swapping the symbol is a one-line change in the formatter, so the choice below is fully reversible.

**Compactification ladder** — the symbol used beside numbers (e.g. `320¢`):

1. **`¢`** — *first attempt.* Compact and gives the "¢redits" wordmark. Caveats that may sink it: `¢` is technically the US-cent sign (a mild real-money / dollar implication), the glyph aligns inconsistently across fonts, and **it is not on a standard keyboard** (designers can't easily type it in mockups). **Test it in the app's actual font first.**
2. **`⚡`** — fallback. The brand bolt, unambiguously *not* a currency, reinforces identity (`320 ⚡`).
3. **`¤`** — fallback. The generic currency-placeholder sign; neutral, no specific-currency implication.
4. **`🪙`** — fallback. Coin emoji; playful, clearly not real money (watch cross-platform emoji rendering).

If the symbol is awkward to author, the plain word **`credits`** is always acceptable — it is the canonical form anyway (below). Design mockups that show `$` are illustrative; production renders credits, never `$`/`USDT`.

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
- **Spread across the games shown in the home-hub ticker** (not just Coinflip), and seed each timed-Chess control's default, so every surfaced game has live activity.
- Keep it small (≈5–10 bots, modest activity). The demo runs on a single Cloud Run instance (`max-instances=1`), so don't flood it.

**Guardrails:**
- **Demo-only**, always (ADR-010). Never a production liquidity mechanism.
- Bots are always 🤖-prefixed and visible as such — the honesty depends on the label.
- Optional: exclude 🤖-prefixed accounts from the *displayed* leaderboard (their matches settle normally; this is cosmetic).

## Matchmaking reassurance — the "Searching…" moment

A short, honest visualization shown in a game hub's **opponent slot** between pressing PLAY and the match starting, so pairing *feels* like meeting a real person. It is presentation-only — it sits on top of the real `queue.join` / `queue.waiting` / `match.start` flow and changes no matchmaking logic. A **game-hub template pattern** (every game hub, not one game).

**Why it exists.** A real human handshake is never instantaneous. When matchmaking pairs two players — or, in a demo, a `🤖` bot is already resting — the match can form with near-zero delay, which reads as fake. A brief "Searching…" beat reassures the player that a *person* was found.

**Behaviour:**
- The opponent slot shows **"Searching…"** with a brief, decorative one-line **name scan** — roughly **3–4 names per second**, fast enough to feel like scanning, slow enough to catch a fragment. Names come from currently-online players (e.g. the Open Games list), **regardless of game**.
- **Minimum dwell:** hold the search for ~**2–4 seconds even when a match is already available**, so a match never snaps in with zero delay. The dwell is a *floor*, not a cap — if a real opponent takes longer to arrive, "Searching…" simply continues until `match.start`.
- If there are no online players to scan, show **just "Searching…"** — no fabricated names.
- On `match.start`, the opponent slot shows the **real opponent's name in bright white**, replacing the grey placeholder.

**Honesty guardrails (the line that keeps it honest):**
- The scanned names are a *scanning-online-players* flourish, **not** a candidate list. The opponent actually selected is **always** the real `match.start` opponent — never one of the cycled names fabricated into a match.
- The dwell adds a small *presentation* delay only; it never invents an opponent and never blocks a real human from being paired.
- In a demo, the **bot crowd** above is what makes the search resolve to a genuine, settling `🤖` opponent within the dwell window — the honest way to avoid an empty wait.
