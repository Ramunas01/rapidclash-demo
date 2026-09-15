# New Design Migration — screen inventory & tracking

Living checklist for migrating every current screen to the new design package (`RapidClash Full Spec.html`, Designer handoff, 2026-09-08). Update this file as each row moves from not-started → in progress → built → pixel-verified. This is the coverage tracker; per-screen pixel fidelity is a separate, later concern (see "Two kinds of verification" below).

## Roles & process for this migration (Owner-agreed 2026-09-09)

The Designer team drives the changes — they ship exact values per screen, so there is little to
arbitrate. For this migration the Advisor/PM split collapses into **scoping+sanity vs execution**:

- **Advisor** (owns `docs/`): owns this tracker, pressure-tests each Designer message against the
  real repo, surfaces traps, tees up Owner decisions, defines each phase's ticket precisely, and
  builds the setup-phase tooling (the fidelity harness). Pushes branches for review; does **not**
  merge.
- **PM**: holds the **review gate and the merge button** for screen-rebuild PRs (the normal
  Advisor→push, Owner→merge rule is delegated to the PM here). Runs the parallel execution phase —
  issues, ≤2 coding agents, review against acceptance criteria — once the repetitive rebuilds
  start. Keeps this tracker's status column honest alongside the board. See
  `docs/COMMS/ADVISOR_TO_PM.md` 2026-09-09#1 for the PM's full brief.
- **Owner**: metric/scope decisions, and the trigger to activate the PM.

**Decisions locked 2026-09-09:**
- Merge gate for screen-rebuild PRs → **PM reviews + merges** (CI green, `/code-review` addressed,
  harness fidelity meets the bar, acceptance criteria met, tracker row updated).
- Deploy cadence → **no deploy until the first user-visible change.** Ships Battle removal +
  prototype landing are invisible; they wait. (Deploy triggers the demo-taker bot-crowd restart.)
- Sort · Popularity metric → **all-time settled-match count per game** (confirmed, no rolling window).
- PRs #456 / #457 / #458 were merged directly by the Advisor under Owner direction on 2026-09-09 —
  a one-time exception; the PM holds merge from here.

## Currency presentation (Owner-approved 2026-09-09) — `CHARTER.md` #4

The registered/investor demo drops the `¢` credit glyph and presents a **`$` symbol plus a
cosmetic multi-currency wallet skin** (the prototype's `curOpen` picker — USD + SOL/BTC/USDT/
ETH/LTC/USDC/XRP, with a fiat/crypto display toggle). **This is presentation only:**

- The ledger, protocol, schema and stored values stay **plain integer demo credits** — exactly
  what `apps/web/src/format.ts`'s own header already says. No FX math, no conversion, no rail,
  no cash-out, no real value. The picker just changes which icon/format wraps the same integer;
  per-currency balances are mock display strings (as in the prototype), not derived from one
  number.
- **Stakes are a fixed 6-rung `$` ladder — $1 / $5 / $10 / $25 / $50 / $100** (the prototype's
  `STAKES` set; its bet selector is literally `/ 6`). This replaces today's free-typed stake
  entry (`StakeEntry.tsx`) and is a real matchmaking improvement, not just a reskin — free-typed
  stakes fragment the pairing pool today. **Size it as its own workstream**, with a shared
  `STAKE_LADDER` constant + matchmaking/validation changes, not folded into a screen rebuild.
- **Guest mode is unchanged** — stays `¢` / play-money-framed (a Board condition, `CHARTER.md`
  line 32). `format.ts` / `<Credits>` keep working for the guest surface; the registered app
  gets the `$` skin alongside, not instead.
- The `~8 "no $" tests` (`RouletteHub.test`, `Wallet.test`'s `not.toMatch(/deposit|crypto/)`,
  `ProfileHub.test` "no $ anywhere", …) flip **organically** as the rebuild PRs touch those
  screens — no separate pass.
- Owners are aware of the framing implications of showing a crypto-styled skin externally
  (Owner confirmed 2026-09-09).

## Before anything else — three things to resolve, not work around

1. **DONE — landed on `main`.** `design/prototype/` (131 files: HTML + 119 `assets/` incl. `assets/export/`'s 14 webp tiles + `image-slot.js`/`support.js` + README + 8 screenshots) merged via **PR #458** (2026-09-09, squash `68fb896`). Plain commit, ~37.7 MB — git-lfs was offered and not taken. Asset triage (the ~61 unreferenced exploration PNGs) is a pending mechanical follow-up.
2. **Done.** The re-extracted copy matches the Designer's counts (39MB, `assets/export/` present, `welcome-banner-v2..v6` present). Asset triage (deleting the ~61 unreferenced exploration files) is still open but no longer blocking — see sizing candidates below.
3. **Resolved — not blocked, and the "one representative per shape" theory in the first draft of this doc was wrong.** Per the Designer: `rps`/`mines`/`dice` are the only 3 with new screens because they're the only 3 **not already finished** — Coinflip, Blackjack, and Chess already match the new design and need no screen work. There's no pattern to generalize from the 3 samples to the rest; see the roster/scope section below for the real three-way split.

## Roster change — RESOLVED: Ships Battle removed (Owner-confirmed 2026-09-09)

Owner confirmed the Designer's call: **Ships Battle is removed from the platform entirely** (hub, route, package, assets, spec, bot-crowd entries — all deleted), bringing the roster to 12 games. **DONE — merged via PR #457** (2026-09-09, squash `f1f9acf`). The full pre-removal implementation is preserved at git tag **`archive/ships-battle`** (`git checkout archive/ships-battle -- packages/games/ships-battle …` to restore if ever reinstated). `CHARTER.md`'s roster table and grouping description, `SCREENS.md`, `REPO_MAP.md` all updated in the same PR. Separate work from the rps/mines/dice rebuild.

## The real roster + scope split (Designer-confirmed, supersedes the "10 games blocked" framing above)

**12-game roster**: coinflip, blackjack, chess, mines, rps, crash, dice, roulette, hilo, keno, baccarat, limbo. Work splits three ways, not "3 done + 10 blocked":

| Group | Games | What actually happens |
|---|---|---|
| New screens | rps, mines, dice | Full rebuild from the new design package — the only 3 with new screens because they're the only 3 not already finished. |
| Already done | coinflip, blackjack, chess | No screen work. **One QA check once rps/mines/dice ship**: if the 3 newly-rebuilt games look visibly different from these 3 (built under the old design), that inconsistency becomes its own follow-up ticket — catch it in the same pass, not after the whole migration ships. |
| Chrome-only | crash, roulette, hilo, keno, baccarat, limbo | No hub rebuild. Tiles keep showing in the lobby; these 6 only need to render correctly under the new shared chrome (header, bottom nav, tokens) once that lands platform-wide — a side effect of the shared-component work, not a separate per-game ticket. |

## Categories are many-to-many, not a per-game field — corrects the original open item

Source: `CAT_GAMES` in the prototype, line 2843 — already assigned by design, not ours to invent:

| Category | Games |
|---|---|
| RAPIDCLASH ORIGINALS | all 12 |
| CARD GAMES | blackjack, hilo, baccarat |
| CHANCE GAMES | coinflip, dice, roulette, keno, limbo, mines, crash, baccarat |
| SKILL GAMES | chess, blackjack, hilo, rps |
| EVENTS | empty by design — has its own `catEmpty` state |

Blackjack sits in 3 categories (Originals, Card, Skill); Baccarat in Card + Chance (+ Originals); Hilo in Card + Skill (+ Originals). **Data model: a game needs a set of category tags, not a single category value.** Worth noting this also restructures `CHARTER.md`'s current grouping taxonomy (today: Originals / Classics / Events, three mutually-exclusive tiers, Chess filed under "Classics") into a many-to-many tag system where "Originals" spans the whole roster — the doc will need updating alongside the data model once this ships, or it'll flatly contradict what's live.

## Two UI elements that are fully designed but functionally undefined — RESOLVED (Owner, 2026-09-09)

Confirmed directly from the prototype's script block; behaviour was ours to define and the Owner has now defined it:

- **Search — RESOLVED.** The input, expand animation, and clear-on-close are fully built, but `searchQuery` is never read by `gridGames` in the prototype. **Decision: adopt the Designer's suggested default — substring match on game *name* across all 12 games, ignoring whichever category tab is selected** (typing "chess" surfaces Chess regardless of the active tab). Case-insensitive, matches as-you-type. Empty query → the normal category-filtered grid.
- **Sort — RESOLVED.** `sortBy` has Popularity (default) / Newest / Alphabetical.
  - **Popularity = all-time settled-match count per `gameId`** (Owner-confirmed 2026-09-09 — no rolling window). All bot-crowd play is bot-vs-human by design, so every settled match is real volume; nothing to exclude. Stable, no scheduled recompute. Source: `match-history.ts` leaderboard/aggregate queries.
  - **Newest = order of introduction onto the platform.** A fixed per-game ordinal, not a live date field. Establish the ordering once from each game package's first-landed commit (git history of `packages/games/<name>/`), encode as a static `introOrder` map/array. New games append.
  - **Alphabetical** — by display name, already well-defined.

## Two kinds of verification — don't conflate them

- **Coverage** (this document): have we addressed every screen/state the redesign touches? Answered by the table below, updated by hand as work proceeds.
- **Fidelity** (the Designer's Playwright proposal): once a specific screen is built, is it pixel-correct against the prototype? A separate, mechanical tool, set up once and reused per screen — sized and scheduled as its own line item below, not bundled into the coverage question.

## Screen inventory

| Current screen(s) | New design `view`/state | Screenshot? | Status | Notes |
|---|---|---|---|---|
| `game-list` / `home` (games hub) | `games` (category rail) | ✅ 01, 02 | Not started | Category rail is now ORIGINALS / CARD GAMES / CHANCE GAMES / SKILL GAMES / EVENTS (was ALL GAMES / ORIGINALS / CLASSICS / EVENTS) — many-to-many per game, see the category table above, not a single field. `MenuOverlay.tsx`'s GAMES group already has placeholder rows named exactly "Card games" / "Chance games" / "Skill games" (from the Menu ticket) — this categorization was already anticipated once and left unwired; this is where it gets resolved for real. |
| *(no current equivalent)* | search-open overlay | ✅ 03 | Not started | Net new. Behavior is ours to define — see "fully designed but functionally undefined" above; UI/animation is done, matching is not. |
| *(no current equivalent)* | sort sheet (`sortOpen`) | ✅ 04 | Not started | Net new. Same situation as search — the sheet UI is done, the actual reordering logic isn't, and "Popularity"/"Newest" need a concrete metric decided first. |
| `rewards` (RewardsHub.tsx) | `rewards` | ✅ 05 (signed-out only) | Not started | RewardsHub was already redesigned + rakeback-fixed this cycle — this is a second pass on recently-shipped work. Signed-in state not captured; reachable by click-through per the Designer. |
| `auth` (AuthModal) | `authOpen` (`loggedIn`, `authMode`, email/password/referral fields) | ✅ 06 | Not started | **Resolved: fully replaces the existing modal**, not scoped to one entry point — confirmed the only auth surface in the export. **New scope worth flagging on its own**: the field list includes a `referral` field, not present in today's `AuthModal` — registration capturing a referral code ties directly into Affiliate's attribution story. Worth confirming with the Designer/Owner whether this needs real backend wiring now or can be session-local/cosmetic for now, matching the mock-data approach the rest of Affiliate already uses — don't assume either way. |
| `menu` overlay (MenuOverlay.tsx) | `menuOpen` | ✅ 07 | Not started | Also a second pass on recently-shipped work (built a few tickets ago). |
| `profile` (ProfileHub.tsx) | `account` | ✅ 09 (signed-in) + 06 (signed-out/login sheet) | Not started | Third redesign pass on this screen this cycle (original build → icon fix → this). |
| `preferences` (PreferencesHub.tsx) | `prefs` | ❌ none | Not started | Click-through only per README. **Light-theme token table exists for this screen in the spec — see the standing light-theme question below before starting.** |
| `affiliate` (AffiliateHub.tsx) | `affiliates` | ❌ none | Not started | Click-through only. This screen has had three consecutive correction tickets this cycle already (hero rebuild in progress, invented-tiers removal) — confirm with Designer whether this new pass supersedes or builds on that in-flight work before starting, so it isn't rebuilt twice. |
| Chat nav item (permanently inert placeholder) | `chatOpen` | ❌ none | **Fully scoped 2026-09-11 — `ADVISOR_TO_PM.md` 2026-09-11#6 — two decisions needed before ticketing** | Full UI/interactions built for real (sending, @mentions, channel switching, half-height mode, VIP colours, seeded backlog); transport stays ephemeral (in-memory, gone on server restart — genuine live cross-player messaging, not client-only) behind a swappable `ChatTransport` interface, same pattern as `EphemeralLedger extends Ledger`. Server-checked kill switch (not a client-bundled env var). The original `chat-local-transport.md` this row cited no longer exists on disk (gitignored scratch from an earlier session); 2026-09-11#6 rebuilds the scoping from the prototype source directly and flags the two things that doc apparently already decided but can't be re-verified: room scope (one global room vs. per-game) and exactly what "server-checked" needs to mean. Deliberate pre-seed scoping (avoids moderation/GDPR load and a real collusion-channel risk in a PvP money game) — not a placeholder shortcut. |
| Currency picker (inside Preferences today) | `curOpen` | ❌ none | Not started | **Resolved: real feature, not a placeholder.** `OPEN_CURS`, 7 currencies. |
| Affiliate "Create Campaign" sheet (already built) | `createOpen` | ❌ none | Not started | **Resolved: same sheet, redesigned** — `newCampName`, `submitCampaign`, drag-to-dismiss, "CAMPAIGN CREATED" toast. Matches what's already built; this is a restyle to new tokens, not new logic. |
| `coinflip-hub`, `blackjack-hub`, `chess-hub` | *already matches the new design* | ❌ none | **Done — no work** | Designer-confirmed: these 3 are already finished under the new design. QA note: cross-check these against rps/mines/dice once those ship — a visible mismatch becomes its own follow-up ticket (see roster table above). |
| `crash-hub`, `roulette-hub`, `keno-hub`, `baccarat-hub`, `limbo-hub`, `hilo-hub` | *no hub rebuild — chrome only* | ❌ none | Not started | Tiles stay in the lobby; these 6 hubs get no redesign work of their own, they just need to render correctly once the shared header/bottom-nav/tokens change platform-wide. Track as a side effect of the shared-component work, not separate tickets. |
| `ships-battle-hub` | *removed from the platform* | ❌ none | **DONE** | Merged via PR #457 (2026-09-09). Code archived at tag `archive/ships-battle`. |
| `rps-hub`, `mines-hub`, `dice-hub` | `rps`, `mines`, `dice` | ❌ none (README explicitly lists these as not captured) | Not started | The only 3 games needing a real screen rebuild this round. No screenshots exist despite being named views — reachable by click-through only. |
| `lobby`, `stake-entry`, `play`, `result` | idle → run → done phases, one screen per game | ❌ none | Not started | **Resolved, and confirmed a real change, not already true today**: checked `App.tsx` directly — these are still 4 separately-rendered live screens today (`case 'stake-entry'`, `'lobby'`, `'play'`, `'result'`, `App.tsx:1292-1317`), including a real fallback path (`hubScreenFor(meta.id) ?? 'stake-entry'`) for any game not yet mapped to a hub. The new design genuinely collapses these into one screen with internal phases — a real architectural simplification to build, not a relabeling. |
| `leaderboard` (separate screen) | a tab within each game view: `TABS: Open Games / 24h Race / Weekly Race / Leaderboards` | ❌ none | Not started | **Not just a relabel — 24h Race and Weekly Race are net-new features, not built anywhere today.** These match Menu overlay's existing COMPETE group rows ("24H race," "Weekly race" — currently `action: 'placeholder'`, built speculatively a few tickets ago, never wired). Implementing this tab for real means real time-windowed leaderboard logic, not just moving the existing `leaderboard` screen's content into a tab. Size this on its own — it's materially bigger than folding lobby/stake-entry/play/result together. |
| `wallet` (standalone screen), guest mode (`guest-loading`/`guest-picker`) | *out of scope* | ❌ none | **Resolved: leave both untouched.** Confirmed by the Designer's team: "WALLET" appears once as a bare button label with nothing behind it, "Guest" appears zero times in the export. Neither is part of this redesign — current implementations stay as they are. |

## Standing decision — resolved: light theme is fully in scope, not deferred

Closes the loop every prior ticket (Account, Preferences, Menu) independently deferred. Designer's decision (2026-09-09): **build it, all the way, this round.** Theme model is `dark | light | system` (three values — `PreferencesHub.tsx:23`'s current `'dark' | 'light'` needs a third option, with "system" watching `prefers-color-scheme`). Three values fall outside the documented token table and need adding to it rather than hardcoding: sort-sheet background, theme-button shadows, and the **games-hero carousel inactive dot** (hardcoded `#3B3B47`, dark-only, no light equivalent in the file — Designer Q5, 2026-09-09). Verification: the Playwright harness generates its own light-mode reference screenshots directly from the prototype (which has a working theme picker) rather than waiting on design or relaying phone photos. Coinflip/Blackjack/Chess (already-done, not rebuilt this round) get an explicit interim rule — light everywhere except their player-boxes/board, via one scoped dark-override wrapper, never forked components — with a real light treatment for those three parked as its own follow-up once rps/mines/dice ship. Full detail: `docs/COMMS/from-advisor/light-theme-rollout.md`.

## Stop in-flight design work — RESOLVED (Designer 2026-09-09, `migration-order-of-work.md`)

Directive: halt any of this cycle's screen-correction work that the new package supersedes; keep
only genuine content fixes, drop everything purely visual.

**Reconciled against repo state: nothing is actually in flight.** Every screen-correction ticket
already merged to `main` on 2026-09-07 (#451/#454 Affiliate; #404 Account; #401 Preferences; #446
Menu; Rewards redesign + #435 rakeback). Only open PRs are #456 (deploy record) and #457 (Ships
Battle removal). So there is nothing to stop — the actionable part is extracting the content
corrections below so the rebuild carries them.

### Content corrections — RESOLVED (Designer 2026-09-09, `content-corrections-answer.md`)

**Nothing needs overriding.** The Designer checked all six candidates against
`design/prototype/RapidClash Full Spec.html` — every one is either already correct in the prototype
or superseded by the redesign:

| Candidate | Verdict |
|---|---|
| Affiliate flat 20% / no ladder | Prototype matches our build exactly (hero numeral line 1687, copy line 1694). Build as-is. |
| Affiliate `https://` link prefix | Prototype shows it (line 1699). Our #451 fix agrees. |
| Affiliate stats tiles 18 / 42,910 / 1,284 | Identical in prototype. **Match the mock values exactly** or the pixel diff fails every run. Same for campaign seeds (`bobbylee`/`KAI-9F2C`/0/20%, `winorgohome`/`winorgohome`/0/20%). |
| Affiliate promo/link heading icons (#452) | **Dropped, not carried.** New design has no heading icons — restructured into two plain-text pill rows ("LINK:" / "CODE:" + copy button each). |
| Account / Preferences / Menu content | Our read holds — nothing to carry. |
| Rewards VIP ladder | Build straight from prototype `VIP_TIERS`/`VIP_ROWS`, no override — see canonical table below. |

### ⚠ THE STALE-ARRAY RULE — applies to every screen rebuild, not just Affiliate

`RapidClash Full Spec.html` carries **dead data-layer arrays that nothing renders** but that look
authoritative next to the live values. Known ones:

| Array | Line | What it looks like | Reality |
|---|---|---|---|
| `affiliateTiers` | 4313 (`renderVals()`) | Bronze 0–50K/5% · Silver 50K–250K/8% · Gold 250K–1M/12% · Diamond 1M+/18% | Dead. Not referenced. **Do not build.** (Also ≠ the 20/25/30/35 ladder we deleted in #452 — neither is real.) |
| `affiliateSteps` | 4308 | some step list | Dead. Build the *rendered* "HOW TO GET STARTED": Step 1 Create your campaign / Step 2 Share your link or code / Step 3 Earn on every game. |
| `TIERS` | 2896 | Bronze/Silver/Gold/**Platinum**/Diamond, 5/8/12/15% rakeback | Dead. The real VIP ladder is `VIP_TIERS`/`VIP_ROWS` (below). |

**Rule: if no markup references it, it doesn't exist. Build from what's on screen, not the data
layer. Hit another orphan array — flag it, don't build it.**

### Canonical Rewards VIP ladder (`VIP_TIERS`/`VIP_ROWS`, Designer-verified against live)

| | WOOD | BRONZE | SILVER | GOLD | EMERALD | DIAMOND |
|---|---|---|---|---|---|---|
| XP required | 500 | 5,000 | 25,000 | 125,000 | 475,000 | 1,500,000 |
| Rakeback | 1% | 4% | 7% | 10% | 15% | 20% |

Weekly & 24h races: all six · Exclusive tournaments: Silver+ · Higher stake tables: Gold+ ·
Monthly volume bonus: Emerald+ · Dedicated VIP host: Diamond only.

### Affiliate Overview structural notes for the rebuild ticket (from the Designer answer)
- No card wrapper — hero/link/code sit directly on the page background (already flagged in #448).
- LINK field: `overflow-x:auto` + `white-space:nowrap` in a fixed-height pill (scrolls horizontally, no truncation). CODE row: `text-overflow:ellipsis`. Deliberate difference.
- Campaign-card short link: `rapidclash.com/r/` + first 4 chars of code + ellipsis.

### Canonical new Mines ruleset (Designer, 2026-09-11) — this is a RULES change, not a reskin

The prototype's 5×5 Mines grid is intentional and its engine is built around it (`MINES_TILES` = 25 at proto line 2863, `pickBombs()` draws 3 from 25 at line 2865, gem list caps at 22 at line 3718). Today's 8×8 / 7-mine tuning does **not** carry over. The T6c/engine ticket is built from this list:

1. **Board: 5×5, 25 tiles. 3 mines / round, 22 safe. Random placement each round.**
2. Both players get the identical board — keep the deterministic-seed contract, **parameterised for `(size, mineCount)` instead of hardcoded 8×8 / 7. Generalise the engine, do not fork it.** The prototype's `DEFAULT_BOMBS = [4, 11, 18]` is a placeholder layout, not a rule.
3. **30-second clock per round**, starting when the match begins (proto `minesClock: 30`, line 3328). Replaces today's per-player 5s move timers. **Confirmed by the Designer: this clock is a cap, not a mechanic** — it exists purely to end a round for a player who stops tapping (disconnect/distraction), not to create time pressure. A player tapping normally finishes (mine, clear, or bust) well inside 30s.
4. Tap a tile to reveal. Each safe tile = 1 gem.
5. Hit a mine → your round ends immediately, **you keep every gem collected before it** (already how today's engine works — bust locks at current safe count, never zeroes). **Designer confirmed: no change from today.**
6. Clock runs out → round ends, you keep your gems.
7. **No cash-out / stop button.** Only a mine, the clock, or clearing all 22 ends a round (see the three sub-answers below).
8. Most gems wins the pot.
9. **Equal gems → draw → rematch**: same stakes, new seeded board, same two players, nothing paid on the draw, pot carries into the rematch (already the engine's internal-draw behaviour). **Designer confirmed: keep the existing 10-consecutive-draw void cap exactly as-is** — draws are more reachable on a 22-max board than on 57, but 10-in-a-row still won't happen; it's a backstop, not a rule anyone will hit.
10. **Remove the 4s auto-reveal entirely.** Only a player tap reveals a tile. If they don't tap, nothing happens until the clock. Nothing in the engine may assume a minimum number of reveals per round.
11. Maximum score is 22.

**Designer's framing that governs the whole rewrite:** hitting a mine costs you nothing but the rest of your round — you keep your gems, the round just ends. Tapping therefore always has non-negative expected value (gain a gem, or end with what you already had) and there is never a rational reason to stop or wait. **Optimal play is simply "tap until a mine or 22."** The winner is whoever's tap order survives longer on the same board. **Build the engine on this assumption — nothing should model a player "deciding" whether to continue.**

**All five sub-questions from the rules-diff — ANSWERED 2026-09-11, ticket is now fully unblocked:**
1. **Clearing all 22 safe tiles → auto-lock at 22, same as today's "cleared" behavior.** Once the 22nd safe tile opens, every remaining tile is a mine — nothing left to play, lock immediately. Both players at 22 is a draw (rule 9 applies).
2. + 3. **Remove early resolution entirely. Opponent gems stay hidden until BOTH players' rounds are over** (mine, clock, or 22 — whichever comes first, independently for each player), then compare. This is a genuine reversal of today's engine (which resolves the instant a locked player is passed, and reveals the opponent's live count once either player locks) — not just a view-redaction tweak. **Why:** since every player taps until they bust/finish regardless, early resolution and a visible counter only leak the outcome early — they don't change anyone's play. Hidden-until-the-end also decouples the two players' online timing (useful with low concurrent players): they don't need to be live in the same instant, just both eventually finish.
4. **Keep the 10-draw void cap exactly as-is** (folded into point 9 above).
5. **Disconnect confirmed: no void, no special handling.** A dropped player locks at whatever gems they had when their 30s clock ends — including locking at **zero** if they dropped before tapping anything. Explicitly the right outcome (a disconnect-voids-the-match rule would make disconnecting an escape hatch for whoever's behind).

**Seed-security question raised by the Designer, verified — already satisfied, no code change needed for this part:** since the outcome is now decided purely by which tiles each player taps (no early peek at the opponent, no cash-out), it matters more than before that neither player can see or predict the seed before their own round ends. **Confirmed directly against `mines.ts`:** the non-terminal `viewFor` branch reconstructs `{players, round, draws, boards}` from scratch — it never spreads `state`, so `seed` cannot leak through it; a player's own `mines` array is only attached once THAT player has locked (their round is already over, so it can't help them); the only place `seed` appears is the terminal branch (`{...s, mines: [...]}`), which — once early resolution is removed per point 2/3 above — only fires once **both** players are done. The existing design already gets this right; removing early resolution actually closes the one path that could have exposed it prematurely.

**Real architecture question for whoever implements this — flagged, not solved here, because it touches shared core infrastructure other games depend on:** rule 10 ("no automatic moves… nothing happens until the clock") means Mines can no longer use the core's existing per-player-timer contract (`meta.moveTimeoutMs` + `timeoutMove`) as-is — `timeoutMove` is required to return a legal move on expiry (used today for Mines' own random-reveal, and by Blackjack/Coinflip/Limbo/Keno/Roulette/RPS for their own timeout behavior). Mines' new 30s clock needs to **lock the player with no move injected at all** — there's no existing "lock without a move" primitive in `packages/core/src/matchmaking.ts`'s generic sweep. This needs a small, generic addition to the core timer contract (not a Mines-only branch, per invariant #5) — whoever picks up the engine ticket should propose the mechanism and get it reviewed given how many other games share this file, rather than build it silently inside `mines.ts`.

## Migration plan — phased order of work (Designer-set, 2026-09-09)

Supersedes the loose "sizing candidates" list. Phases 1→3 are sequential; Phase 4 runs alongside 2.

### Phase 1 — Land the prototype as committed source of truth — **DONE (PR #458, `68fb896`)**
- `design/prototype/` is on `main`: 131 files, `assets/export/` with its 14 webp tiles, `RapidClash Full Spec.html` + runtime. Plain commit, ~37.7 MB (git-lfs offered, not taken).
- **Remaining:** asset triage — delete the ~61 unreferenced exploration PNGs, decide git-lfs-or-drop for the ~1.5 MB masters now that `assets/export/`'s webp tiles are what ship. Mechanical follow-up PR, no blocking decisions.

### Phase 2 — Playwright screenshot-diff harness — **MERGED (#459 + #466)**
- `tools/design-fidelity/` — demo/dev-only package, ADR-010 carve-out like `bot-crowd`.
- **#459** (`2d88e54`): hermetic prototype render (dc-runtime pulls React 18.3.1 from unpkg; harness serves it from the workspace); light theme via initial-state injection; `capture-prototype` → 16 committed references, chrome-clipped; `capture-app --url` → the running app; `diff` → pixelmatch %, diff images, `report.json`. Proven end-to-end.
- **#466** (`8795f59`): Designer's harness spec — fidelity gate **≤ 0.5% differing pixels** + a human look at any drift (`diff` prints PASS/FAIL); **freeze layer** (`src/freeze.ts`) pins `Math.random`/`Date.now` and strips all transitions/animations, both sides; **region masking** (`MaskRect`) — `BANNER_MASK` excludes the carried-over carousel from the 4 games screens; viewport **390 × 840**.
- **Still to do — 3rd harness PR (Advisor):** whole-page comparison in **viewport-sized scroll frames** (Designer Q3) — not blocking Games-hero (above the fold); needed before Rewards / Account rebuilds. Also: CI `playwright install chromium` if the harness is ever run in CI.

### Phase 3 — Games page hero rebuild — **MERGED (#468, `15253fe`)**
- Category rail (5 tabs, many-to-many `CATEGORY_GAMES`), SEARCH (cross-category substring), SORT (Popularity / Newest / Alphabetical), RANDOM (1560 ms spin → random among the 6 playable games), section title. Banner untouched. `getPopularity()` added to `match-history.ts` (generic `GROUP BY game_id` aggregate — invariant #5 clean) + `GET /games/popularity`.
- **Merged at fidelity FAIL** on the PM's diff-image review — every failing region is out of scope (shared header/nav chrome, tile art, no light theme, harness alignment). That's *why* shared-chrome + light-theme is next (below), not rps/mines/dice.
- **Follow-ups the harness surfaced** — a "games-grid fidelity" ticket (`ADVISOR_TO_PM.md` 2026-09-10#2, from a direct DOM measurement of the drift):
  1. **Tile aspect ratio** — `HomeHub.tsx:554` uses `aspect-[2/3]` (0.667); the prototype's tile box is `112/158` (0.709). ~12px too tall per tile, compounding down the grid — the dominant "drift grows downward" cause. Fix: `aspect-[112/158]`.
  2. **Default tile order** when Popularity is all-tied → the prototype's `GRID` order (Coinflip first), not the current tie-break (showed Baccarat first).
  3. Rail→pills vertical gap ~15px tighter than the prototype (lower priority, needs a spacing pass).
  - *(A "tile art" flag was retracted — the "100"/"1K" are chips in the Baccarat art; the webp tiles match the prototype PNGs.)*
- Scope was: category rail, filter pills (SEARCH / SORT / RANDOM), section title. NOT the banner.
- **Category rail** — `CAT_GAMES` mapping (many-to-many tags, see the category table above). `MenuOverlay.tsx`'s placeholder "Card games / Chance games / Skill games" rows get wired here.
- **Search / Sort** — behaviour RESOLVED (see "Two UI elements"): name substring across all 12, ignore tab; Popularity = all-time settled-match count; Newest = fixed intro-order ordinal; Alphabetical = display name.
- **RANDOM button** — defined intent, not ours (Designer Q4): `spinRandom` (line 3991) spins the die 1560 ms, then opens a random game's hub. Prototype only picks mines/rps/dice because those are its only views — **real behaviour: random among the six *playable* games (rps, dice, mines, coinflip, blackjack, chess)**, never the six unbuilt ones (dead hub is worse than a smaller pool). Spin keyframe is 1500 ms, nav fires 60 ms after it settles.
- **Banner carousel — DO NOT rebuild** (Designer Q5). The three rotating banners, artwork, rotation and dots are carried over from production unchanged. Harness masks the region. *One thing to do:* the inactive dot is hardcoded `#3B3B47` dark-only with no light value — add a light-theme token for it (rides with the light-theme rollout).

### Phase 4 — Remaining open decisions (parallel with Phase 2)
- **Search matching — RESOLVED** (Owner 2026-09-09): substring match on game name across all 12 games, ignore active tab, case-insensitive, as-you-type. See "Two UI elements" section.
- **Sort metrics — RESOLVED** (Owner 2026-09-09): Popularity = all-time settled-match count per game; Newest = fixed introduction-order ordinal from git history, not a live date field; Alphabetical = by display name. See "Two UI elements" section.
- **Content corrections — RESOLVED** (`content-corrections-answer.md`): nothing to override.
- **Harness + hero questions — ALL 6 ANSWERED** by the Designer 2026-09-09 (`TO-designer-harness-and-hero.md`): harness answers folded into Phase 2; Games-hero answers (RANDOM, banner) folded into Phase 3; rps/mines/dice confirmed final (see below). Nothing left held.

### After the plan — sequenced, not yet scheduled
These are scoped in their own sections/comms docs and sequence *after* the harness exists:
- **rps / mines / dice** full screen rebuilds — the only 3 games needing new screens. **Designer-confirmed final, not sketches (Q6): build them fully, gameplay included.** Each has a real phase machine (mines: idle → match → run → done, with a matchmaking phase), clocks, opponent state, seeded history, outcome logic (`rpsOutcome` win/lose/draw; mines gems/bombs/bust; dice belt animation + roll history) — ~25 state keys across the three. Reference screenshots come from the harness.
- **Currency skin + fixed stake ladder** — `$`/multi-currency wallet skin (cosmetic) + the 6-rung `$1–$100` `STAKE_LADDER` replacing free-typed stake entry. See "Currency presentation" above. The stake-ladder half touches the core/matchmaking, size it separately from the skin.
- **Shared chrome + light theme rollout** platform-wide — **NEXT workstream** (Owner-agreed 2026-09-10: before rps/mines/dice, because it's what fails fidelity on every screen). Sequenced tickets in `ADVISOR_TO_PM.md` 2026-09-10#1:
  - **T1 — Theme foundation**: `dark | light | system` model (`system` → `matchMedia`), app-wide theme provider replacing `PreferencesHub`'s subtree-only one, 3rd Preferences radio, token additions (sort-sheet bg, theme-button shadow, carousel inactive-dot light value). Gates T2–T4.
  - **T2 — Shared chrome**: rebuild `HubRibbon` (header) + `HubToolbar` (bottom nav) to the prototype + light. Highest-leverage lift (renders on every screen). Harness adds the bottom-nav to its compared region here.
  - **T3 — Per-screen light threading**: Account / Preferences / Menu / Rewards / Affiliate + HomeHub — replace each screen's local `RC = {hex}` object with the shared token set. Parallelable with T2.
  - **T4 — Interim dark-override** for Coinflip/Blackjack/Chess: one scoped `--rc-*` override wrapper per hub around the play surface; do not fork components; audit hardcoded hex inside first.
  - **T5 — PARKED**: proper light treatment for those 3, after rps/mines/dice.
  - Carries the 6 chrome-only hubs (crash/roulette/hilo/keno/baccarat/limbo) as a side effect of T2.
- **Chat** — full UI + `ChatTransport` local impl + server-checked kill switch (`chat-local-transport.md`).
- **Auth modal** replacement — `referral` field stays cosmetic/session-local (resolved).
- **Races (24h / Weekly) + Leaderboards tab** — genuine new feature work (time-windowed leaderboard logic), sized separately from the lobby/stake-entry/play/result → single-screen-with-phases collapse.
- **lobby / stake-entry / play / result → one screen, internal phases** — real architectural simplification (`App.tsx:1292-1317` today).

## Status snapshot — 2026-09-15 (D01-D13 shipped/deployed/closed; D14 shipped+deployed; D15 postponed; D16 shipped+deployed live at `rapidclash-00113-2jv`; D17 item 1 shipped+deployed (item 2 needs zero code — Owner kept current behavior on both open questions); Advisor corrected its own overflow-size estimate, live pill-sizing spot-check stays genuinely open) — supersedes all earlier snapshots in this section

**2026-09-15#11 — Advisor correction (informational, nothing to dispatch): re-checked the `2026-09-15#10` item-1 arithmetic more carefully and it doesn't hold up at the size originally claimed.** A faithful static reconstruction of `DiceBoard`'s exact CSS values, measured in real Chromium, showed only ~1.2px of belt-clipping overflow with the status text present — not the ~10px the original source-level estimate claimed (the original math used unmeasured, approximate intrinsic heights for `DiceScaleRow`/the status `<p>`). **The shipped fix (`#605`, removing the status text) is still unambiguously correct** — real leftover copy, zero prototype occurrences, can only help the belt's available space — **but a 1px clip is very unlikely to be the FULL explanation for "plain bars with no numbers."** A more likely secondary contributor, not yet checked: the belt's pills mount via Framer Motion (`initial={{scale:0.45, opacity:0}}`, 460ms animation) — a screenshot caught mid-animation would look exactly like an unlabeled bar, which is normal behavior, not a bug. Couldn't safely stage the actual live 2-player match needed to settle this definitively (would need new WS-protocol scripting, more infrastructure than this single visual-QA point justifies). **The live pill-sizing spot-check PM asked for stays genuinely open** — worth a glance next time anyone's watching a real resolved Dice round, not worth either side building new live-match test infrastructure for right now.

**2026-09-15#10 — NEW, top item. Designer's D17: the Dice result state shows leftover "You rolled higher!" text covering the history belt, plus wrong ring/fill colors on the player bar. Full detail: `ADVISOR_TO_PM.md` 2026-09-15#10.**

- **Item 1 — shipped in `#605`, deployed live at `rapidclash-00113-2jv`.** The result text (`DiceHub.tsx:316-318`) was a real, exact match to Designer's citation (zero occurrences in the prototype). The separate "pills show no numbers" complaint wasn't a missing label — the belt already rendered it correctly — the original theory was a layout overflow the removed text was contributing to. **Advisor later re-checked that arithmetic more carefully and corrected the estimated overflow size downward (~1px measured, not ~10px) — see `2026-09-15#11` above.** The fix itself stands regardless; the live pill-sizing spot-check remains open.
- **Item 2 — needed zero code.** Owner's answers to both open questions (loss-fill: keep ring-only, matching the prototype exactly, no new fill feature; draw ring: keep the shared amber) both landed on "keep current behavior" — nothing to build.
- **Closing ask (harness capture for the result state) — done.** Added a `dice-result` screen definition to the design-fidelity tool, reusing the harness helpers already built for D16, and verified both theme outputs directly.

Deployed live alongside `#602` in the same batch deploy, per Owner's timing call. **Advisor next:** available, no open thread. **PM next:** nothing pending on this ticket.

---

**2026-09-15#9 — shipped in `#602`, merged; not yet deployed (PM held it, checking with Owner on timing — real fix, not urgent-urgent).** Designer's D16: the opponent bar during matchmaking showed the wrong layout (no blur, no scramble, name inline with "Searching…" instead of split right). Full detail: `ADVISOR_TO_PM.md` 2026-09-15#9.

- **All 4 structural complaints confirmed real, in the ONE shared component every game already routes through** (`OpponentSlot`, `GameHub.tsx`) — so "same on rps, mines and dice" is automatic, not something needing separate verification per game.
- **Layout, blur, avatar hashing, and the robot-emoji leak all shipped** — all 4 confirmed real, all fixed in the one shared `OpponentSlot` (`GameHub.tsx`), applying automatically to RPS/Mines/Dice. PM independently re-verified every citation before implementing (the exact layout, the prototype's two-piece split, the hash/`PRESETS` shape, `displayHostName`'s exact regex) — all matched.
- **Avatar hashing (item 3):** `avatarIdForName(name)` added to `Avatar.tsx` — same djb2 hash already used for `discColor`/`glyphColor`, applied to the preset id set instead of a hue. The one genuinely new piece of logic, as expected.
- **Robot-emoji leak (item 4):** `displayHostName` exported from `GamesCarousel.tsx` and reused directly rather than duplicated. One subtlety PM got right that wasn't spelled out in the ticket: the self-comparison (excluding the player's own name from the scan) stays on the RAW `ownerName` — only what actually gets added to the displayed scan set is stripped, so a human player's own username (never bot-prefixed) can't mismatch against a stripped form of itself.
- **Already correct, confirmed, no changes needed:** the muted→bright name-color transition, and no tier icon during search.
- **A new, genuine finding surfaced while implementing item 5's "already correct" claim:** the color-transition LOGIC is right, but the underlying tokens (`text-foreground`/`text-muted-foreground`) have zero light-mode override anywhere in `index.css` — the same broken-token class already fixed this week on `HubToolbar`/`HubRibbon`/`HubFooter`/`GamesCarousel`. PM checked the whole file: **17 occurrences of this exact pattern in `GameHub.tsx`, not just the 2 in `OpponentSlot`** — the file has never had a light-theme pass at all. Deliberately left untouched (out of scope for D16, and too big to fold in casually — same shape/size as the repo-wide hex sweep already flagged from `2026-09-15#2`). **Recorded here as its own open follow-up, no ticket number yet, no timeline pressure.**
- **Closing ask (harness capture for the searching state) shipped alongside the ticket, done, not just requested.** Added a new `rps-searching` screen definition to `tools/design-fidelity/src/screens.ts`, ran the actual capture, and visually verified both theme outputs match Designer's own reference exactly — blurred flickering avatar, blurred scrambling name, "Searching…" alone on the right. One small timing correction found along the way: the search/blur/scramble start synchronously at t=0 on PLAY, not after the ticket's stated 680ms (that 680ms is the first leg of the nested delay before 'found' fires, at 2380ms total).

Deployed live at `rapidclash-00113-2jv` alongside D17's item 1 fix, per Owner's timing call. **Advisor next:** available, no open thread. **PM next:** nothing pending on this ticket.

---

**2026-09-15#8 — NEW, top item, NOT ready to ticket — needs a design decision before any code is written. Designer's D15: the Rakeback CLAIM button looks two-toned (lighter face, darker ledge) when dimmed. Full detail: `ADVISOR_TO_PM.md` 2026-09-15#8.**

- **Designer's specific mechanism claim doesn't match the code.** The described bug (opacity applied to the face only, missing the box-shadow ledge) isn't what's happening — `opacity` is already set once, on the single `<button>` that owns both `background` and `boxShadow`, confirmed unchanged since `#570` (2026-09-13, two days before this report). CSS opacity composites an element's entire rendered box as one group; there's no way for a browser to apply it to a background fill while skipping that same element's own box-shadow. Re-applying "opacity on the outer element" would be a no-op — it's already there.
- **The real mechanism: two intentionally different purples, dimmed together.** The face (`--brand-purple`, `#8B45F0`) and the ledge (`--rc-theme-toggle-active-shadow`, `#5F27B8`) are deliberately different shades — the same lighter-face/darker-ledge 3D-button convention used on JOIN, PLAY, and WALLET elsewhere in the app. The absolute hue gap is identical at full opacity and at 50% — dimming doesn't change it — but it becomes more visually prominent as a "seam" once both colors sit closer to the neutral surface.
- **The Volume Bonus comparison doesn't hold up as a reference.** Confirmed: Volume Bonus's CLAIM is *never* the purple pill — it unconditionally renders the shared, flat, single-hue `LockedClaimRow` in every state (an explicit design decision, issue #435, since Volume Bonus has no independently-claimable balance of its own). It looks uniform because it's structurally a different, single-hue component, not proof the purple button can be made uniform by fixing an opacity bug.
- **No prototype reference exists for this at all.** Checked the prototype's own CLAIM markup (`Full Spec.html:1043`) — it has no `opacity`/disabled treatment whatsoever; the dim-when-unclaimable behavior is this app's own added affordance, with no prototype source of truth to check a fix against.

**Recommending 3 real options rather than guessing at one:** leave as-is (now that the mechanism is understood), give the disabled CLAIM its own flat single-hue treatment (a real visual change), or make face/shadow the same hex specifically in the disabled state (stays purple, removes the seam, cheapest change). **This needs an actual Designer/Owner call, not a unilateral pick** — routed back rather than ticketed. **Update: Owner forwarded the question to Designer directly and asked to keep it postponed — nothing for anyone to build until that answer comes back.**

**Advisor next:** available, no open thread. **PM next:** nothing to do here until Designer answers.

---

**2026-09-15#7 — shipped in `#598`, deployed live at `rapidclash-00112-2z8` (confirmed independently via `gcloud run services describe`, matching PM's report exactly). Bot-crowd restarted, all bots online, `/open-challenges` verified live.** Designer's D14: the Rewards header showed the wallet pill + balance while logged out. Full detail: `ADVISOR_TO_PM.md` 2026-09-15#7.

- **Confirmed real, and the actual cause was neither of Designer's two guesses (no second header, no mock-user leak).** `RewardsHub.tsx:210` never threaded its already-available `loggedIn` prop into its `<HubRibbon>` call — `HubRibbon`'s own `loggedIn = true` default silently rendered the signed-in branch. The rest of the file used `loggedIn` correctly (VIP blur, Rakeback lock, `CardStatusRow`); this one call was the only gap.
- **Fix shipped:** `loggedIn={loggedIn}` added to that call, matching how `HomeHub`/`GameHub` already call the same shared component.
- **The recommended hardening shipped too:** `HubRibbon.tsx:74`'s own default flipped `loggedIn = true` → `loggedIn = false` (fail closed, not fail open). PM independently traced `ProfileHub`/`AffiliateHub`'s own identical gap and confirmed both are structurally auth-only (`ProfileHub`'s `token: string` is non-nullable by type; `AffiliateHub` always shows a real balance unconditionally) — passed `loggedIn` explicitly at both so the default flip doesn't turn their dormant gap into an actual regression. **All 5 `<HubRibbon>` call sites in the app now pass `loggedIn` explicitly** — independently verified via diff, matches PM's report exactly.
- **Closing ask (Games, Menu, Chat) confirmed clean** — no changes needed there.

Deployed at Owner's request. Nothing else pending on this ticket.

---

**D01-D13, the ENTIRE Designer collection, fully shipped AND deployed live at `rapidclash-00111-pvt`; the one remaining open question — item 4's "above" spacing — is CLOSED, Designer confirmed no change needed.**

**The full D01-D13 collection is closed out: every item processed, every real fix merged, and — as of this deploy — every merged fix is confirmed live in production, not sitting in a merged-but-undeployed queue.** `#587` (footer), `#591` (Open Games), and `#593` (Recent Games fade) shipped together in one deploy at Owner's request, revision `rapidclash-00111-pvt` (confirmed independently via `gcloud run services describe`, matching PM's report exactly). Bot-crowd restarted, all bots online, `/open-challenges` verified live, no errors.

**2026-09-15#6 — CLOSED. The last open thread from the whole collection: item 4's "above" spacing question (`2026-09-14#1`) is resolved with no code change.** Owner relayed Designer's answer: "Everything looks fine now." The live-measured 26px gap (vs. the originally-stated 35px target) is acceptable as-is — confirms the 35px figure was itself a screenshot-based overestimate (same class of miscount as items 1+2 in that same ticket, both of which also turned out to already be correct in production). **No further action needed from anyone.** This closes out every single item across the entire D01-D13 Designer package collection — nothing open anywhere.

**2026-09-15#5 — shipped in `#593`, merged and deployed live.** The last package in the collection (D13): Account page's Recent Games fade goes to grey instead of white in light mode. Full detail: `ADVISOR_TO_PM.md` 2026-09-15#5.

- **Confirmed real, and the mechanism is more precise than Designer's own guess:** it's not a hardcoded literal anywhere — `ProfileHub.tsx:599`'s fade is a `color-mix()` gradient built from a token, exactly like the prototype's own construction, just the WRONG token (`--rc-sunken` instead of `--rc-bg`).
- **Why this was invisible until light mode existed:** dark theme's `--rc-bg` and `--rc-sunken` are both `#0b0b0b` — identical values, so the wrong token has been a total no-op in dark mode. Light theme diverges (`--rc-bg: #ffffff` vs `--rc-sunken: #d3d3dd`) — `#d3d3dd` is exactly the grey in Designer's screenshot.
- **One small, functionally-immaterial correction to Designer's own citation:** the prototype's actual final gradient stop is `color-mix(in srgb, var(--rc-bg) 99%, transparent)`, not literally `var(--rc-bg) 100%` as quoted — a 1%-opacity difference, imperceptible, already matched by this file's own stops.
- **Closing ask (check Rewards + elsewhere) run:** only 3 files anywhere use a `linear-gradient(to bottom` fade — this one (the bug), the Footer's (already fixed correctly in `#587`), and Open Games' edge-fade (a different, theme-invariant `mask-image` mechanism, not a token bug). `RewardsHub.tsx` has no collapsed-list/VIEW MORE affordance at all — the ask doesn't apply there.

Fix was one line plus one new object key (`RC.bg`, added to `ProfileHub.tsx`'s token object).

**Advisor next:** available, no open thread — nothing pending on either end. **PM next:** nothing pending.

**2026-09-15#4 — shipped in `#591`, merged and deployed live.** Designer's spec for the Open Games section's light-mode theming — same root-cause class as the Footer ticket (hardcoded `#1A1A2E`/`#FFFFFF` literals instead of `var(--rc-surface)`/`var(--rc-text)`), all in one file (`GamesCarousel.tsx`). PM independently re-verified every citation before implementing — all matched. Full detail: `ADVISOR_TO_PM.md` 2026-09-15#4.

- **Items 1-4 (heading gone, LIVE pill dark, striped rows navy, row text white):** all confirmed exactly as diagnosed, all the same literal-instead-of-token fix. One small correction to Designer's own hex: the game name's literal is `#F2F2F6` (a near-white grey), not literally `#FFFFFF` — same failure mode either way.
- **Item 5 — a real correction, not just confirmation:** Designer's "tier icon missing on striped rows / handle missing on plain rows" was treated as one white-on-light bug; it's actually two different things. The handle half is real (folds into item 4's fix, nothing extra). The tier-icon half doesn't hold up — checked 11 rows directly on the live page: icon presence tracks `ownerTier === 'Unranked'` (renders nothing, by design, already documented from `2026-09-13#7`), completely independent of row striping. What Designer's screenshot caught was a coincidental sample, not a systemic bug — nothing to fix. PM independently confirmed the same finding.
- **Already confirmed correct, no change needed:** tab rail, JOIN buttons, stake amounts (green, theme-invariant), currency icon, and the thumbnail's `#1B1B2E` fallback (Designer's own named exception, confirmed also a deliberate literal in the prototype itself).

Deployed live alongside `#587`/`#593` in the same batch deploy, per Owner's timing call. Nothing else pending on this ticket.

**2026-09-15#3 — RESOLVED, same day. Designer sent "D12," byte-identical to D09/2026-09-14#1 (confirmed via file hash — same screenshots, same text, word-for-word). Investigating why Designer would still be seeing the already-fixed title-row bug surfaced a real deploy gap: `#582` and `#585` were both merged but never deployed — production was still on `rapidclash-00109-9hg`, the revision from the nav double-tap fix, with nothing shipped since.** PM deployed immediately on the finding (`rapidclash-00110-tb4`, confirmed live), restarted the bot-crowd, and independently verified the Pepe asset file is fully deleted with zero remaining references anywhere in the codebase — not just visually replaced. Owner was flagged the moment the gap was found and has since seen it resolved. Item 4's "above" spacing question (2026-09-14#1) was the only piece from this stretch still open at the time — since closed, see `2026-09-15#6` above.

**2026-09-15#2 — shipped in `#587`, merged to `main`.** Designer's spec for the footer's light-mode theming — all 6 numbered items confirmed real, no corrections needed to Designer's own diagnosis anywhere (the cleanest ticket of the batch so far). PM independently re-verified every citation before implementing (gradient rgba values, `--foreground`'s missing light override, `--rc-muted`'s dark-only `#83838F` value, `HubRibbon`'s existing logo-swap pattern) — all matched, nothing to correct. Full detail: `ADVISOR_TO_PM.md` 2026-09-15#2.

- **Items 1, 4, 5, 6 (gradient band, heading, link text, disclaimer/copyright):** all the same shape — a hardcoded literal (`#1A1A2E`/`#FFFFFF`/`text-foreground`/`#83838F`) where a theme token belongs. Item 5 traced precisely: `text-foreground` resolves to a legacy shadcn token (`--foreground`) with **no light-mode override anywhere in `index.css`** — the same bug class already fixed on `HubToolbar`/`HubRibbon` this week. Fixed locally (swapped to `var(--rc-text)`/`var(--rc-muted)` in this one file), not by re-theming the shared `--foreground` token globally, matching established precedent.
- **Item 3 (logo swap):** confirmed, and the dark-mode asset **already existed in the repo, already used correctly in the header** (`HubRibbon.tsx`) — pure copy-the-pattern reuse, zero new assets or logic.
- **Item 2 (footer background):** confirmed already correct, no change needed — Designer's own note said so, verified true.
- **"Also" (Tournaments→Events):** the label fix shipped with the rest; making it an actually-functional link needs new plumbing across 6 different call sites (no callback for it exists anywhere today) — split out and held as its own follow-up, not bundled in.
- **The closing ask (grep the tree for hardcoded hex) is real, and genuinely bigger than this ticket:** ran it — 41 real hits (after excluding legitimate icon-fill false positives) across **15 files**. Some are real bugs, some are deliberate theme-invariants already reasoned about elsewhere (e.g. Dice's own die-cube face colors) — this needs the same file-by-file human triage as the Footer, not a mechanical sweep. Held as its own dedicated follow-up ticket, not silently absorbed into today's fix.

**Both follow-ups (making Events functional; the repo-wide hex sweep) are flagged to Owner as open, non-urgent items — no timeline pressure from either Advisor or PM.**

Deployed live alongside `#591`/`#593` in the same batch deploy, per Owner's timing call. **Advisor next:** available, no open thread. **PM next:** nothing pending on this ticket or anywhere else in the collection — item 4's "above" spacing question is closed, see `2026-09-15#6`.

**2026-09-15#1 — shipped in `#585`, deployed and verified live at `rapidclash-00110-tb4`.** Designer's 3 Rewards fixes (avatar sync, RC→currency-icon, claim-button shift) all landed, plus the HIGH PRIORITY Pepe-image retirement — confirmed genuinely gone (asset deleted, no references left), not just hidden. Two small implementation notes worth keeping: `CurrencyIcon`'s USD face bakes its own `$` glyph as SVG text, so pairing it with a manually-`$`-prefixed span under one shared testid double-renders `$$` — scope separate testids to the amount span alone, matching how `GamesCarousel`/`ProfileHub` already do it. A stale "no `$` leaks into body" test in `RewardsHub.test.tsx` (predating `CHARTER.md` #4's currency-skin approval) was flipped per the already-documented "flip organically" policy. Full detail: `ADVISOR_TO_PM.md` 2026-09-15#1.

**2026-09-14#1 — CLOSED. Items 1-3 + item 4's "below" half shipped in `#582`, deployed and verified live; item 4's "above" half closed with no code change (see `2026-09-15#6`).** Designer's Games-page title-row spec — 2 of 4 claims confirmed already-correct via live measurement (font-size, icon-text gap), item 3's real cause found precisely by PM (a leftover legacy global `h2` CSS rule at `styles.css:57`, not Tailwind's fault), item 4's "below" gap fixed by moving margin from the row onto the grid/empty-states. Item 4's "above" gap sat open pending Designer confirm — PM independently re-ran the same citation check and reached the identical conclusion (the prototype's own source produces exactly 26px here, with no combination of nearby values summing to Designer's stated 35px target). Designer's answer, relayed by Owner: "Everything looks fine now" — the 26px live value is accepted as-is, confirming 35 was itself a screenshot overestimate (same class as items 1+2, both already correct). Full detail: `ADVISOR_TO_PM.md` 2026-09-14#1.

**2026-09-13#9 — shipped in #579/#580, deployed at `rapidclash-00109-9hg`, verified live.** Designer's report that the bottom nav needed a double-tap to activate was a real regression from #569 (2026-09-13#3's own press-feel fix) — `HubToolbar.tsx`'s bar-pop retrigger remounted the entire bar (all 5 buttons) on every `pointerdown` via a `key={pulseKey}` bump, destroying and recreating the exact button a tap landed on before the browser finished delivering that gesture's `click`. Confirmed via the test suite's own comment admitting the remount, with a test that structurally couldn't catch the failure mode it was named for ("remount-safe"). Fixed with a ref + imperative CSS reflow-trick (no state, no remount); PM's implementation also added a reflow-spy test proving the mechanism actually runs, stronger than what was originally sketched. Full detail: `ADVISOR_TO_PM.md` 2026-09-13#9.

**All 8 of the 2026-09-13 Designer packages (D01-D08) are merged to `main`, live in production, and demo-taker's bot-crowd restarted clean (all 32 bots confirmed back online).** PM sanity-checked the live `/open-challenges` feed post-deploy — `ownerTier` still present and correct on every entry. Ticket-by-ticket recap, newest first:

- **2026-09-13#8, shipped in #576.** Account's Recent Games list: empty-state styling fixed to match the Events-empty-state exactly, RC coin swapped for the wallet's currency icon + always-`$` amount (reusing the same global currency singleton #572 built), the opponent-row avatar circle dropped, VIEW MORE got its 3D ledge plus a corrected 520ms collapse transition and a proper opacity-fade (was popping via conditional mount — the 3rd occurrence this week of that pattern), the date format's locale-dependent bug fixed with explicit `en-US`+`hour12`, and game names now read "Rock Paper Scissors" instead of "Rps" via the same `nameByGame` pattern HomeHub/GameHub already use. One reported "bug" (loss-row amount color) was confirmed via direct code read to already be correct, shipped back on 2026-09-07 — flagged rather than silently re-touched; PM independently verified the same and dispatched without a live-page check, judging the source-level proof solid enough.
- **2026-09-13#7, shipped in #577.** Avatar picker rebuilt as an inline account-card strip (floating popup gone). The 10 new `rc-01`-`rc-10` presets (already in the repo) replace the 6 old named presets, retiring a real, previously-flagged licensing risk on 2 of them. Owner's call on the default-avatar conflict: the per-user disc color stays everywhere it's actually rendered (a real, already-shipped identity feature); only the picker's own reset-to-default tile shows the prototype's literal fixed-purple+glyph look, since that's a control affordance, not a rendered identity.
- **2026-09-13#6, shipped in #572.** Open Games tab rail + stake display + host tier icon. Tab rail got its shared track/ledge/press-sink/scroll-to-center, and the edge-fade technique corrected to a `mask-image` (it had been copying the category rail's overlay-div approach instead of its own). Stake display now always shows `$`, with the per-row/per-wallet currency icon reusing the existing `CurrencyIcon` component and a new `theme.ts`-shaped global singleton for the shared wallet-currency state (the same one #575/D08 above reused). Host tier icon: Owner's call (taken directly to them given the ADR-010 conflict) was to follow Designer exactly — tier icon on every host, bots included — while keeping the 🤖 marker fully intact in the underlying `ownerName` data (informed-consent requirement preserved) and stripping it only at render. New server-side `ownerTier` field added via the same `lookupUsername`-injection pattern chat's `resolveTier` already used.
- **2026-09-13#5, shipped in #570.** Rewards' logged-out gate removed; `RewardsHubScreen` made genuinely guest-safe (guarded fetch, explicit Rakeback lock condition instead of the earlier coincidental one), VIP-card blur added, claim-button 3D ledges + 2 new tokens added.
- **2026-09-13#4, shipped in #571.** Login/Signup rebuilt as the prototype's bottom sheet via a new shared `BottomSheet` component, built fresh against the verified spec rather than extracted from the affiliate `CreateCampaignSheet`'s old code (which had 4 real gaps of its own, fixed in the same PR by migrating it onto the new shared component too). Surfaced a real jsdom gap along the way (no native `PointerEvent` support) — fixed with a documented polyfill at the point of use (`apps/web/src/test/setup.ts`).
- **2026-09-13#3, shipped in #569.** Bottom nav's `rcNavBarPop` press feel added to the shared bar.
- **2026-09-13#2, shipped in #565.** Menu's Dark/Light control added; the first-open reveal-animation bug (sliding in from the wrong origin) fixed by reporting the Menu button's real position on mount, not only at click time.
- **2026-09-13#1, shipped in #566.** Games-hero category tiles (background/ledge/press/icon sizing), rail edge fades, and section title (icon + font) all fixed.

**Process notes from today's batch, worth carrying forward:**
- **The "conditionally-mounted overlay/element with nothing to animate from" architecture gap showed up 3 separate times** (Menu overlay #2, Auth sheet #4, Recent Games' VIEW MORE fade #8) — each fixed in its own shape rather than extracted into a shared abstraction (PM's call: one more instance isn't worth it yet). Watch for a 4th; that's the point to reconsider.
- **Two file-collision near-misses this week** (`HubToolbar.tsx` earlier, `ProfileHub.tsx` for D07/D08 today) — both from two D-tickets landing on the same file from a stale base, producing a silent duplicate-declaration merge (caught by `tsc`, not a conflict marker, since the two blocks landed on adjacent lines with no overlapping git context). PM's ask: flag a known file collision when a ticket is FIRST sent, not just discovered after the fact, whenever the Advisor already knows two in-flight D-tickets touch the same file.
- **A minor doc-comment inaccuracy** in D07's own `apps/web/src/lib/rail.ts` (claimed Affiliate tabs also used the shared rail helper — false, only 2 real consumers, not 3) was caught and corrected by PM before merging; confirmed this didn't originate from any Advisor ticket text.

*(D01-D08 batch's own close-out, before #9 was found above: fully shipped and verified, nothing pending at the time.)*

**Still queued from this batch, no scoping started:** the shared PLAY button's own missing `rcNavBarPop` (flagged 2026-09-13#3's survey, high leverage — one fix covers all 12 games — not yet ticketed); a possible "Related games" carousel's press feel (flagged same survey, not confirmed to exist in the app yet). Neither urgent. (See the older 2026-09-12 "Still queued" note below for the rest of the standing backlog.)

**2026-09-12#5 — shipped in #560.** Owner's live post-merge Dice pass (#558) found a real bug that also affected Mines' already-shipped #555 — same root cause, both games; `MinesPanel`/`DicePanel`'s live board was vanishing into the idle preview during the `'result'` phase. Fixed by adopting Coinflip's own `phase === 'in-match' || phase === 'result'` pattern. Also confirmed and fixed: Dice's missing matching-phase table dim, and cube "travel" via an honest position-slide (no fabricated numbers). Mines' live-play HUD text (own/opponent safe-counts, round number, status line, "Resign") was surveyed at Owner's request and categorized — most kept as real functional info with no prototype substitute, "Resign" flagged for an explicit Owner call, nothing dispatched from that survey yet. Full detail: `ADVISOR_TO_PM.md` 2026-09-12#5.

**2026-09-12#3/#4 — Dice vs. prototype, Owner's own analysis pass (first time playing it) — shipped in #558, superseded in part by #5 above.** Audio wired (play/dice-roll/dice-win.mp3 at their real trigger moments), reveal switched from popup to `ownBarResult` (the mechanism now shown by #5 to need the `phase==='result'` panel fix too), idle gauges un-dimmed, redundant idle text removed, panel resized to the prototype's fixed 266px box. History belt and cube colors were already correct pre-#558, no changes needed there. Full detail: `ADVISOR_TO_PM.md` 2026-09-12#3/#4.

**RPS round (2026-09-12#1) — closed out, shipped, confirmed good by Owner.** All 4 findings from Owner's `rapidclash-00102-km6` pass fixed in **#551**: `ownBarResult` removed from RPS (correction to #547 — RPS's real win indication is the card frame color + enlargement, `gameV` structurally excludes it, `Full Spec.html:3519`), z-index + 28% table-dim added during search, card enlargement at reveal (92→124px etc., `rpsExpanded()`), duplicate idle text removed. Owner's item-4 calls: Forfeit restyled smaller/subtler but **keeps its function** (no capability lost), duplicate "Waiting for an opponent…" dropped, "Picked {choice}…" kept as functional copy. Owner tested the deploy directly and confirmed: *"the latest deployment shows the RPS good looking and working as expected"* — forwarding to Designer for review. **RPS is done, no open thread.**

**Standing project stance (unchanged, still governs all of the below):** at this stage, visual/experiential fidelity to the Designer's prototype outweighs correctness. Where matching the prototype means accepting a gap the code was deliberately built to avoid, accept the gap and document why in a code comment rather than silently keeping the safer behavior.

**Merged and live (recap):** 2026-09-11#8's 3 tickets (#541/#542, plus C via #548), 2026-09-11#9's reversal (#543/#544), 2026-09-11#10's 2 items (#546/#547), 2026-09-12#1's RPS fix (#551).

**2026-09-12#2 — NEW: Mines vs. prototype, Owner's own analysis pass (not relayed secondhand) — 3 gaps, one is real feature work, not a tweak. Full detail: `ADVISOR_TO_PM.md` 2026-09-12#2.**

1. **Redundant idle text — clean removal, same pattern as RPS's fix in #551.** `MinesHub.tsx:182-184`'s paragraph ("Waiting for an opponent…" / "Choose a bet and press PLAY, or JOIN an open challenge") has zero prototype equivalent — the `isMines` idle block (`:470-529`) is just the tile grid + clock, no copy at all. Shared PLAY-button label already covers the waiting case.
2. **Board doesn't dim during search — real gap, cheap fix, mechanism already plumbed.** Prototype: `minesBoardOp: rpsMatching || mConverged ? 0.28 : 1` (`:3756`). `MinesPanel` (`MinesHub.tsx:393-399`) applies no opacity at all. `GameHub.tsx` already threads `barSlideActive` through `GameAreaArgs` (`:686`) — Mines just never consumes it. Fix: `opacity: args.barSlideActive ? 0.28 : 1`, same treatment RPS got in #551. Caveat: prototype's condition also covers the post-match `mConverged` phase (item 3), which doesn't exist yet — this fix only gets the search-phase half right until item 3(a) lands.
3. **The reveal is a real, bigger gap — not a broken feature, the default popup is firing because Mines never opted into the (correct, for Mines) shared mechanism.** `MinesHubScreen` wires neither `suppressResultOverlay` nor `ownBarResult`. Unlike RPS, `ownBarResult` **is** the right mechanism here — `gameV = view === 'mines' || isDice` (`:3519`) is the exact gate that turns on the bar win-fill. Three distinct parts:
   - **(a) Bars converge to center post-match — genuinely new `GameHub` plumbing**, not existing today. `mConverged = mActive && !isDice` (`:3524`) drives a *different* shift magnitude (`mRShift` fallback `{o:100,p:-100}`, `:3529`) than the search-phase slide (`mShift`, `{o:123,p:-123}`) — real, distinct values. `GameHub`'s `barSlideActive` (`:615`) only covers `matchForming||searching` today, nothing post-match.
   - **(b) Win/lose/draw frame ring — just wiring the existing, Coinflip-proven mechanism.** `playerBarRing`/`winFillAnim`/`winTextAnim` (`:3787-3789`) map exactly to `GameHub`'s `ownBarResult`/`ownBarVerdict` (`:691-704`). Fix: add `suppressResultOverlay` + `ownBarResult` to `MinesHubScreen`'s `<GameHub>` call, Coinflip's own reference pattern. Correction to Owner's description: the ring is **own-bar only** (`oppBarRing: 'none'` unconditionally, `:3786`) — no symmetric opponent-side ring to build.
   - **(c) Gem-count text above/below the pills — new content, no generic slot exists.** `oppGemText`/`myGemText` (`:467`/`:690`) sit outside the bar box entirely (above opponent's, below own), gated by `mReveal`/`mGrown`. Correction to Owner's description: this text is **always green**, win or lose — the win/lose color-coding lives entirely on the frame ring (b), not this text. `renderSlotAside` renders inside the bar row, not outside it — needs a new prop or slot extension.
   - **Scoping call:** (b) is a same-night wire-up. (a) and (c) are real new features, closer in size to #546's original bar-slide build. Recommend shipping items 1+2+3(b) together (cheap, no new plumbing), scoping (a)+(c) as their own follow-up ticket.

**Advisor next:** available, no open thread — 2026-09-12#2 is dispatched (PM's ticket, items 1+2+3(b), being built/reviewed; 3(a)+3(c) still to be scoped as a follow-up). **PM next:** merge once clean; hold the deploy until Owner is back to confirm.

**Infra note, 2026-09-12 — not a migration item, filed here since it's the nearest live tracker.** Deploying tonight surfaced a real production issue, not a design gap: the Cloud Run service was on the 512Mi default and got OOM-killed repeatedly after the chat/RPS/chess-stakes feature batch grew real per-connection in-memory state, dropping every WebSocket in a loop — looked identical to the already-documented "bot-crowd looks dead" (`DEPLOY.md` §3b) from the outside, but was a different root cause (the whole service flapping, not one stale revision). Fixed live via `rapidclash-00104-djs` (bumped to `--memory 1Gi`); the canonical deploy command and a new `DEPLOY.md` §3c now bake that in and describe how to tell the two apart. **Re-check memory headroom after any future feature batch that adds real per-connection state** — this won't be the last time a feature batch grows what a single connection holds in memory.

**Still queued, no scoping started:** RpsIdle/MinesIdle's own `opacity-50` idle-dim echo (same "invented dimmed-anchor convention" root cause as Dice's item 5, both already shipped) — small standalone follow-up whenever convenient; races/leaderboards (real feature, tabs already show a graceful placeholder toast today); lobby/stake-entry/play/result 4-screen cleanup (confirmed dead code, zero user-visible impact, pure tech debt). None urgent.

**Process:** Advisor → worktree `worktree-advisor-migration`; PM → primary checkout; each coder → its own agent worktree.

**Standing lesson from this session, worth remembering:** several confident-but-wrong-or-nearly-wrong moments tonight (a tile-art misread, the "no design source exists" claim, reading `MinesHub.tsx` on a stale branch, and briefly assuming a GCP-access problem that was actually just a wrong project-name guess) all trace to the same root cause — trusting a quick check instead of looking at the current, real thing. Every one was caught by going one step further and actually looking (a screenshot, a `git log`, the real project list, the real server logs) — the #532 investigation itself is the clean version of that same instinct done right: don't stop at "bots are back," check what's actually happening underneath.
