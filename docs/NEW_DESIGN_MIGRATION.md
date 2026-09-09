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
| Chat nav item (permanently inert placeholder) | `chatOpen` | ❌ none | **Resolved — ready to ticket** | Full UI/interactions built for real (sending, @mentions, channel switching, half-height mode, VIP colours, seeded backlog); transport stays local-only (no cross-device delivery, gone on refresh) behind a swappable `ChatTransport` interface — same pattern as `EphemeralLedger extends Ledger`. Server-checked kill switch (not a client-bundled env var — see `docs/COMMS/from-advisor/chat-local-transport.md`). Deliberate pre-seed scoping (avoids moderation/GDPR load and a real collusion-channel risk in a PvP money game) — not a placeholder shortcut. |
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

## Migration plan — phased order of work (Designer-set, 2026-09-09)

Supersedes the loose "sizing candidates" list. Phases 1→3 are sequential; Phase 4 runs alongside 2.

### Phase 1 — Land the prototype as committed source of truth — **DONE (PR #458, `68fb896`)**
- `design/prototype/` is on `main`: 131 files, `assets/export/` with its 14 webp tiles, `RapidClash Full Spec.html` + runtime. Plain commit, ~37.7 MB (git-lfs offered, not taken).
- **Remaining:** asset triage — delete the ~61 unreferenced exploration PNGs, decide git-lfs-or-drop for the ~1.5 MB masters now that `assets/export/`'s webp tiles are what ship. Mechanical follow-up PR, no blocking decisions.

### Phase 2 — Playwright screenshot-diff harness — **PR #459 READY FOR PM REVIEW**
- `tools/design-fidelity/` — demo/dev-only package, ADR-010 carve-out like `bot-crowd`.
- **Working & proven end-to-end:** hermetic prototype render (the spec HTML doesn't run standalone — its dc-runtime pulls React 18.3.1 from unpkg; the harness serves it from the workspace); light theme via initial-state injection (the "System" option is cosmetic, value not persisted); `capture-prototype` → 16 committed references, chrome-clipped (fake status bar + fake URL bar removed); `capture-app --url` → the running app, both themes; `diff` → pixelmatch %, diff images, `report.json`. `games-originals` scores ~80% dark / ~40% light vs the current HomeHub.
- **Follow-up PR (Designer answers, `TO-designer-harness-and-hero.md`, 2026-09-09):**
  - **Fidelity gate = ≤ 0.5% differing pixels**, AND a human looks at the diff image for anything > 0 (200 wrong pixels in the wrong place passes a % gate and still looks broken). pixelmatch AA tolerance stays 0.1. *Engine noise is not a concern* — the harness renders prototype and app in the same Chromium/fonts/rasteriser, so every diff is real.
  - **Kill the real noise sources before comparing, both sides:** inject CSS disabling all transitions/animations; pin every random or time-based value (die spin, nav pop, seeded opponent data, clocks) to a constant.
  - **Mask deliberately-carried-over regions** out of the diff — first one is the games-hero **banner** (Q5: keep production's carousel as-is). Per-screen mask rects.
  - **Canonical viewport = 390 × 840** (not 844). The `#__df_screen` inner box is 390×840; the 437×893 wrapper only holds `assets/iphone-frame.png` and is irrelevant. Content column 390, 16px page margins (build fluid, not a hardcoded 358).
  - **1:1 means the whole scrollable page, captured in viewport-sized frames at defined scroll offsets** — not one tall screenshot (the header + bottom nav are fixed overlays; the scroll container carries 118px top / 184px bottom padding). Diff frame-by-frame.
  - CI: `pnpm exec playwright install chromium` if ever run in CI (nothing runs it today).

### Phase 3 — Games page hero rebuild — **UNBLOCKED, ready to ticket** (Designer answered 2026-09-09)
- Scope: category rail, filter pills (SEARCH / SORT / RANDOM), section title. **NOT the banner** — see below.
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
- **Shared chrome + light theme rollout** platform-wide (`light-theme-rollout.md`) — the single biggest item; likely its own iteration. Carries the 6 chrome-only hubs and the interim Coinflip/Blackjack/Chess dark-region override with it.
- **Chat** — full UI + `ChatTransport` local impl + server-checked kill switch (`chat-local-transport.md`).
- **Auth modal** replacement — `referral` field stays cosmetic/session-local (resolved).
- **Races (24h / Weekly) + Leaderboards tab** — genuine new feature work (time-windowed leaderboard logic), sized separately from the lobby/stake-entry/play/result → single-screen-with-phases collapse.
- **lobby / stake-entry / play / result → one screen, internal phases** — real architectural simplification (`App.tsx:1292-1317` today).

## Status snapshot (2026-09-09)

- Merged: prototype export (#458), Ships Battle removal (#457), deploy record (#456), migration tracker + PM brief (#460), PM role acknowledgment (#461), currency-skin note (#462).
- **Phase 1 — DONE.** Search/Sort, content corrections, currency skin, and all 6 Designer harness/hero questions — RESOLVED. Nothing blocked on the Designer.
- **Phase 2 — PR #459 READY for PM review + merge** (foundation + proven pipeline). Harness refinements from the Designer answers (0.5% gate, animation/randomness killing, region masking, 390×840, scroll-frame capture) = a follow-up PR, Advisor-owned.
- **Phase 3 — Games hero — UNBLOCKED, ticket next** (Advisor writes it → PM runs it).
- **Process:** Advisor now works in a git worktree (`worktree-advisor-migration`), PM keeps the primary checkout — no more shared-checkout collisions.
- **Pending mechanical:** prototype asset triage (~61 unreferenced PNGs).
