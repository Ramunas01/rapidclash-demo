# Hub Transition — Analysis (v1 → v2)

Companion to `HUB_TRANSITION.md`. Sources: the Figma Make export (`design-ref/demo-dizainas/`, gitignored) and the v1 app (`apps/web`). **Presentation re-composition only — the functional core is untouched.** This doc confirms the hub mapping, surfaces the three owner decisions, and lists the honesty/data flags. **No hub is built until the owner signs off.**

## 1. Hub inventory (what the export actually contains)

The export is **one ~994-line `src/app/App.tsx`**, almost entirely inline-styled (hardcoded hex), over a CSS-variable theme in `src/styles/theme.css`. Bottom nav drives 5 surfaces; only two have real content:

- **"Games" (default) — the Home hub.** Top bar (logo + balance chip + auth) · promo **hero carousel** (5–6 slides) · category tabs (ALL/ORIGINALS/CLASSICS/EVENTS) · search/filter/sort bar · **"Originals" 12-tile game grid** · "Bring a Rival" invite card · **"Open Games" live ticker** (per-row: tile, game, @user, stake, JOIN) · footer.
- **Game hubs** (Coinflip, Blackjack, Chess, RPS each have one). Coinflip: large coin · result message · **side selector (heads/tails)** · green **PLAY** button · **bet-amount selector** (`$1…$100`) · related-games rail · "Bring a Rival" card · Open Games ticker · footer.
- **Account** — username + logout (minimal).
- **Menu / Rewards / Chat** — nav stubs, no content.

**Theme:** `theme.css` is a clean dark/purple token set — `--primary #8140e2`, `--background #0d0d0d`, `--card #151515`, `--foreground #f4f4f5`, `--destructive #e0556c`, plus inline accents (win `#2bb673`, play-green `#3ddc84`). **But the export applies color via inline hex, not the tokens** — so the lift must re-point inline hex → tokens.

## 2. Screen → hub mapping (refined; data source + v1 reuse)

The first-pass table in `HUB_TRANSITION.md` holds, refined below. **Every data point already exists** in `api.ts`/`ws.ts` + `@rapidclash/shared`; reuse the v1 screen's logic, restyle the surface.

| Target hub | Export sections | v1 screen(s) reused | Data source (real) |
|---|---|---|---|
| **Auth** (gate, not a hub) | top-bar LOG IN / SIGN UP | `Auth.tsx` | `api.register` / `api.login` → `AuthResponse` |
| **Home hub** | logo+wallet ribbon; game grid; Open Games ticker; leaderboard-lite; promo hero | `GameList` (grid) · `OpenChallengesList` (ticker) · `Leaderboard` (lite) · `HubRibbon` (wallet) | `api.games`→`GameMeta[]`; `ws.subscribeChallenges`→`OpenChallenge[]`; `api.leaderboard`; `api.wallet`→`WalletResponse` |
| **Game hub** (one template per game) | coin/board play area · bet selector · PLAY · open-challenges · result | `CoinflipHub` (the built template) · `StakeEntry`+`Lobby`+`{Coinflip,RPS,Chess,Blackjack,Mines}Play`+`Result` | `ws.joinQueue`/`takeChallenge`/`makeMove`/`forfeit`; `match.start/state/your_turn/end`; per-game redacted `*View` |
| **Profile hub** | account (username) + wallet ledger + leaderboard | `Wallet.tsx` (balance+ledger) · `Leaderboard.tsx` | `api.wallet`→`WalletResponse`/`LedgerEntry[]`; `api.leaderboard`→`LeaderboardEntry[]` |

**Bottom nav:** Games→Home hub, Account→Profile hub, wallet chip→wallet view; Rewards/Chat→visibly-inactive "coming soon" (no screens). (Matches the already-built `HubToolbar`.)

## 3. State model per hub (in-place over WS events; redaction preserved)

- **Home hub** — pure section composition; **no route navigation**. The Open Games ticker is the live open-challenges feed (`challenges.list`/`challenges.update`), tap JOIN → `takeChallenge` → enters the relevant Game hub. No hidden info.
- **Game hub** — the proven `COINFLIP_HUB.md` state machine, generalized: **Idle → Waiting → In-match → Result → Idle**, all in place over `match.start/state/your_turn/end`. **Server-authority + redaction unchanged** (opponent's choice/cards/board revealed only at `match.end`, exactly as the v1 play screens do). Internal-replay games (Blackjack/Mines draws) loop in place; only the decisive result shows the overlay.
- **Profile hub** — read-only views (`api.wallet`, `api.leaderboard`); no match state.

## 4. Decision (a) — canonical design system for v2

**Recommendation: adopt the export's token set (`theme.css`) as v2's design system; retire the Base44-derived tokens.** It's the chosen target look (dark, purple `#8140e2`), and running two systems guarantees drift. **The lift must convert the export's inline hex → theme tokens** (the export ships hex inline, not tokenized). Foundation PR: port `theme.css` into `apps/web` (Tailwind theme + CSS vars), keep the existing shadcn primitives, build green with no screen changes — then hubs consume tokens, never raw hex.

## 5. Decision (b) — reconcile the export's Coinflip with `COINFLIP_HUB.md` (#81)

**They conflict on *mechanic*, and our spec wins.** The export's Coinflip is a **house game**: pick a side → **PLAY → instant solo flip → win/lose vs the system**. Our Coinflip (CHARTER, `COINFLIP_HUB.md`, already built in #85/#86) is **PvP both-choose**: post/join a challenge → a second human (or 🤖 bot) joins → both pick a side → a seeded flip decides → `pot − rake`. The export's mechanic would **break invariant #1** (it's the house) and must **not** be lifted.

**Recommendation:** `COINFLIP_HUB.md` stays the **functional authority**; the export contributes only the **visual treatment** (the coin, the palette, the bet-amount selector styling, the layout polish). They don't fork because the export's house mechanic is rejected and the export's generic "Open Games ticker" is replaced by our real open-challenges JOIN list. The already-built `CoinflipHub` is restyled to the export's look — it is not rebuilt.

## 6. Decision (c) — house-only games

The export's grid/ticker presents **Limbo, Crash, Keno, Hilo, Roulette, Dice** as playable-looking tiles (with `$` stakes and a JOIN path). These are **house-edge games with no human opponent** — forbidden by invariant #1's PvP-only corollary; they **cannot be playable**.

**Recommendation: coming-soon-only (no PLAY path), or dropped.** Our roster is **RPS, Coinflip, Chess, Blackjack, Mines** (live PvP) + **Baccarat** (the deferred PvP-redefinition → coming-soon is fine). Render Limbo/Crash/Keno/Hilo/Roulette/Dice — if shown at all — as dimmed "coming soon" tiles with **no** playable route. (Confirm: drop them entirely, or keep as coming-soon for roadmap breadth? And confirm **Dice** — it's house-edge unless we ever PvP-redefine it.)

## 7. Honesty checklist — strip on the way in (invariant #1/#4)

The export is a real-money-crypto-gambling mock. The lift must remove:
- **Currency:** all `$`/`USDT` → **`¢` integer credits** (`formatCredits`). No decimals, no stablecoin.
- **Crypto/real-money framing:** "PROVABLY FAIR / verified ON-CHAIN", "REAL STAKES / NO HOUSE EDGE", "$50,000 PRIZE POOL", "DAILY CASHBACK", "Affiliate program", **18+** — all removed/reframed as a play-money demo.
- **Fake social proof:** the Open Games ticker's invented `@CryptoKing`/`@DiamondVault` rows → **real** open-challenges data (the live feed), never fabricated entries.
- **Social links:** Discord / X / Telegram footer → out of scope.
- **"Bring a Rival" / "WINNER TAKES ALL" / match-link invite** → static banner only (the real invite-link feature isn't built — see §8).
- **Redaction:** preserved in every Game hub (no opponent info before `match.end`).

## 8. Flags — data the core does NOT expose (owner decisions, not improvised data)

- **Cross-game "Open Games" ticker.** `subscribeChallenges` is **per-game**; a single all-games ticker = the client subscribing to each game's feed and merging (feasible, no core change) — or scope the ticker per-hub. *Decision: aggregate client-side, or per-game only?*
- **Category tabs / search / sort** (ALL/ORIGINALS/CLASSICS/EVENTS). `GameMeta` has **no category** field. These would be client-side grouping or cosmetic. *Decision: simplify/drop, or add a category to `GameMeta`?*
- **Player stats** (games played / W-L). No endpoint (we deliberately simplified Profile to wallet + ledger + leaderboard). Keep simplified unless the owner wants a stats endpoint.
- **"Bring a Rival" invite link** (private direct challenge by link) — **not a core feature.** Static banner / coming-soon until built; flagged before as the most honest cold-start primitive.
- **Promo hero carousel / banners** — static content (no data); keep play-money copy only.

## Next (after owner sign-off)

Per `HUB_TRANSITION.md` §Orchestration: **Foundation PR** (adopt the token system, optimize assets into `apps/web/src/assets/`, build green, no hubs) → then **hub-by-hub, one PR each**, starting with the **Coinflip Game hub** (restyle the built `CoinflipHub` to the export look) → **Home hub** → **Profile hub** → remaining game hubs. Early checkpoint: owner eyeballs foundation + first hub on real data before the rest proceeds.
