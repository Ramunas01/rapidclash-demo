# Coder → PM (append-only; newest on top)

### 2026-08-13#4 — Games-page Open Games carousel, real data — PR #310 (issue #305)            [OPEN]
From: Coder   Re: PM dispatch (games-and-rewards.md §A)

Shipped, **PR #310** (`feature/305-games-carousel`, isolated worktree at `.wt/305-games-carousel`). Client-only, not owner-gated. Sanity-checked `git worktree list` before starting — no overlap with the concurrent #304 (asset-only, already merged as #308) or #306 (server-only) worktrees.

**Where this lives — a judgment call, not the dispatch's literal hint.** The dispatch flagged `GameListScreen` (`apps/web/src/screens/GameList.tsx`, from the #281 discussion) as the likely target. Checked it directly first, per the brief: it carries no `HubRibbon`/`HubToolbar` at all (its own header/back-button instead), isn't reachable from the bottom nav (only Leaderboard-back / Result "Play Again"), and has no Open Games feed to begin with. `HomeHubScreen` (`apps/web/src/screens/HomeHub.tsx`) is the screen the bottom-nav "Games" item actually lands on (`HubToolbar`'s `onGames={onHome}`), already carries the design's wallet-chip-header/toolbar shell, and already had `OpenGamesTicker`/`PublicOpenGamesTicker` wired to real data — confirmed against `HUB_TRANSITION.md`'s own hub-mapping table, which names "Home hub" as the target collapsing `game-list` + `open-challenges`. Built the new carousel there, replacing that ticker section (a strict superset — OPEN GAMES stays real/live; the new widget just adds the tab bar + race/rank placeholders around it). Flagging this since it's a real interpretation call, not a rubber-stamped hint.

**Motion — verbatim.** New `apps/web/src/components/hub-shared/GamesCarousel.tsx`, `useOpenGamesCarousel` hook transcribes `componentDidMount`/`tick()`/`make()` unchanged: 1900ms `setInterval`, `ROW=76`, `VISIBLE=11`, two-`requestAnimationFrame` slide-in (`offset:-ROW,dur:'0ms'` → next frame `offset:0,dur:'620ms'`). Runs for the whole component lifetime once real data exists, regardless of the active tab — matches `componentDidMount`, not gated on `tab===0`.

**Real data — reused, not rebuilt.** `make()`'s synthetic `POOL`/`STAKES` replaced with real challenge rows. Extracted 3 small, behavior-identical pieces out of `OpenGames.tsx` (`OpenGamesTicker`/`PublicOpenGamesTicker` unaffected, still pass their own pre-existing suite unmodified): `mergeChallengesByGame` (the exact WS-feed merge/sort those components already did inline), `insufficientBalanceNotice` (the exact JOIN affordability rule/copy), `PUBLIC_POLL_MS` (the exact logged-out poll cadence). Game art via the existing `TILE_ART` map, not the design's own `IMGS` (which points at design-tool paths this app doesn't have). Confirmed the design's `MODES` array is genuinely dead (grepped the decoded template) — nothing wired for it.

**Tabs.** `TABS = ['OPEN GAMES', '24H RACE', 'WEEKLY RACE', 'RANK']` reproduced verbatim; only tab 0 is real. 24H RACE / WEEKLY RACE / RANK render the design's own placeholder arrays (`RACE_24H`/`RACE_WEEK`/`RANKS`, transcribed verbatim) via `boardRows()`/`raceClock()` — tab-switching + `VIEW MORE` (10→20→30) work, zero backend, per the Owner decision in `games-and-rewards.md`.

**Judgment calls (documented in the component's file header too, so they survive the gitignored design-ref worktree disappearing):**
1. Real empty state — the design's `POOL` is always non-empty; a real feed can genuinely be empty. Added a plain empty message; the tick interval doesn't run while the pool is empty.
2. Eager initial seed — fills the 11-row window the instant real data first arrives, instead of waiting up to `VISIBLE * TICK_MS` (~21s) for `tick()` to fill it one row at a time (the design's synthetic POOL is always instantly full; a real WS/poll feed isn't).
3. Real `LIVE` count, not the design's synthetic `20 + ((liveCount+3)%17)` cycle — fabricating a number felt wrong on the one page whose entire point is real data.
4. Race/rank avatars — the design's `assets/avatar-N.jpg` paths were never part of the 20 images actually exported (cross-checked against #304's own asset audit). Reused the existing derived-color `Avatar` component instead of inventing placeholder art.
5. No `¢` on stake/prize/XP numerals — matches the design's plain-numeral-beside-RC-icon presentation rather than this app's usual `formatCredits`. The RC glyph is itself unambiguous play-money framing (no `$`), so not a CHARTER breach, just a presentation choice that reads differently from the rest of the app — flagging it since it's the one place this component doesn't match sitewide convention.
6. Real `<button>`s, not the design's `<div>`/`<span>` — matches this codebase's existing precedent for every other design-transcribed *functional* control (`HomeHub.tsx`'s `CategoryTabs`/`GridControls`), unlike Bring-a-Rival's deliberately non-focusable marketing CTA (issue #301, a different kind of control).
7. Row/JOIN testids keyed by a synthetic `uid`, not `matchId` — with fewer than 11 real open challenges the same challenge legitimately repeats in the rolling window (`make()` wraps via modulo, exactly like the design's own POOL wrap-around), so a `matchId`-keyed testid would collide. Added `data-match-id` for real-id lookups instead.

**Tests.** New `apps/web/src/test/GamesCarousel.test.tsx`, 17 tests: tab bar + switching, real-data rendering both signed-in (WS aggregate) and logged-out (public poll), JOIN (affordable / unaffordable / logged-out auth-wall capture), the real empty state, the exact 1900ms/`ROW=76`/620ms motion sequence via fake timers + stubbed `requestAnimationFrame`, the ticker continuing to run while a different tab is active, and the static race/rank tabs (placeholder content, `VIEW MORE` stepping/capping at 30, board-limit reset on tab pick, zero backend calls asserted directly). `apps/web/src/test/HomeHub.test.tsx` and `apps/web/src/test/App.test.tsx` updated wherever they asserted the old ticker's testids (`home-ticker`/`home-row-*`/`home-join-*`) to the new ones (`games-carousel`, `data-match-id` lookups) — same assertions, new selectors. `apps/web/src/test/OpenGames.test.tsx` untouched and still green, confirming the extraction didn't change `OpenGamesTicker`/`PublicOpenGamesTicker` behavior.

**Results:** full suite `npx vitest run` — **95 files / 1172 tests green** (ran twice to confirm; one run had a single unrelated `App.test.tsx` timing flake in a pre-existing search-deadline test, confirmed not a regression — reran it in isolation 3x, all green, consistent with this repo's documented parallel-run-flake pattern, e.g. PR #199's report). `tsc -b` clean; `eslint --ext .ts,.tsx packages apps` clean. Pushed; CI (`build-and-test`) confirmed on the PR.

Ask: PR review — #310, against issue #305's acceptance criteria (itemized in the PR description, including the two judgment calls the Advisor should pixel-diff against: the widget's placement decision, and the `¢`-less stake presentation).

### 2026-08-13#3 — Games/Rewards (B): Rewards backend — PR #309 (issue #306)            [OPEN]
From: Coder   Re: PM dispatch (2026-08-13)

Shipped, isolated worktree at `.wt/306-rewards-backend`, branch `feature/306-rewards-backend`. Server/core only (`packages/core`, `packages/shared`, `apps/server`) — no `App.tsx` touch, so this ran safely alongside the concurrent Games-carousel (#305) and asset-commit (#304/#308) work. **Blocks #307** (Rewards frontend) — now unblocked.

**Schema — own `rewards` table, not columns on `accounts`.** Keyed by `account_id`, same "each module owns one table" pattern as `ledger.ts`/`identity.ts`. `CREATE TABLE IF NOT EXISTS` alone is snapshot-safe here — the issue's `identity.ts` `ALTER TABLE` pattern exists specifically for adding a column to a table an *old snapshot already has*; a brand-new table has no such predecessor. **Two columns added beyond the issue's literal 5-column list, flagged per the dispatch's own "flag it clearly rather than guessing" instruction**: `notional_rake_monthly` (the player's own running monthly notional-rake sum — required because the monthly volume-bonus formula needs it and a match's ledger `RAKE` entry only ever lands on the *winner's* side, so the loser's contribution can't be reconstructed from the ledger after the fact) and `claim_seq` (a monotonic per-account counter for the claim endpoint's idempotency key).

**Accrual hook.** New `onPlayerSettled` option on `Matchmaking`, fired inside `settleMatch`'s existing per-player loop exactly where the issue's line anchors pointed — storage-agnostic (same shape as the existing `onSettled`), reuses the existing `completed.get(matchId)` idempotency guard, no second guard added. Wired to the REAL matchmaking instance only; confirmed guest's separate ephemeral matchmaking instance (`apps/server/src/guest/index.ts`) is untouched, so guest sessions never accrue rewards — same isolation boundary as guest's own ledger (test coverage for this specifically).

**The math, verified against a dedicated non-retroactive-crossing test:** `notionalRake = min(stake,100)×feeRate + max(stake-100,0)×feeRate×0.25`, `xpGained = round(40×notionalRake)`, `rakebackGained = round(stake×feeRate×currentTierRate)` (undiminished), tier rate read from `xp_lifetime` *before* the match's XP lands.

**VIP tier rakeback percentages weren't in the issue text itself** (it gave thresholds but only called out Unranked 0%/Wood 1%) — found and transcribed from the gitignored design export's actual `VIP_ROWS` data (decoded the `__bundler/template` JSON blob in `design-ref/games-and-rewards/RapidClash - Games and Rewards.html`, since the doc said "I already decoded and extracted both" but the committed spec doc only quoted the row it needed for the worked example): Wood 1%, Bronze 4%, Silver 7%, Gold 10%, Emerald 15%, Diamond 20%. Now committed in `docs/PROTOCOL.md`'s new Rewards section so this fact survives the worktree/gitignored file disappearing, per `WORKING_AGREEMENT.md`'s rule.

**Monthly close** runs both lazily (on an account's own next accrual/read/claim — self-healing) and via an hourly `setInterval` sweep in `apps/server/src/index.ts` (no existing cron in this repo), so a dormant account still gets its bonus without needing to play again — dedicated test for this.

**Claim endpoint** (`GET /rewards`, `POST /rewards/claim`, pattern-matched off `wallet.ts`): atomic zero-then-credit in one `db.transaction()`, new `REWARD_CLAIM` ledger type, rate-limited via the already-present `@fastify/rate-limit` (confirmed, not re-added). Idempotency verified two ways: a unit-level double-tap test and an HTTP-level test firing two real concurrent (`Promise.all`) requests — exactly one credits, the other returns `credited: 0`.

**Mechanical, unavoidable client touch (not a scope violation):** extending `LedgerEntryType` with `REWARD_CLAIM` broke `apps/web/src/screens/{Wallet,ProfileHub}.tsx`'s exhaustive `Record<LedgerEntryType, ...>` icon maps (tsc caught it immediately) — added one map entry to each (`Trophy` icon, distinct from `ADMIN_CREDIT`'s `Sparkles`), no `App.tsx` touch, no behavior change beyond satisfying the exhaustiveness check.

**Verification:** `tsc -b` clean, `eslint` clean. Full suite is 1192 tests; this PR's own surface (`rewards.test.ts` 24, `rewards-settlement.test.ts` 6 running the real `settleMatch` pipeline, `apps/server/src/routes/rewards.test.ts` 7) passes 100% reliably every run, isolated, plus the existing `ledger`/`matchmaking`/`ephemeral-ledger`/`wallet`/`guest-auth` suites unaffected. Local full-suite runs were noisy under genuine concurrent-agent CPU contention (confirmed via `ps`: a live agent in `.wt/305-games-carousel` plus an orphaned 28+-minute zombie from a finished `.wt/304-games-rewards-assets` run) — each run's one flaky failure was a different, unrelated `apps/web` test (never anything this PR touches) that reproduced green in isolation. CI (dedicated runner, no contention) is the authoritative signal — confirmed green before this entry: PR #309.

Ask: PR review — #309, against the issue's 5 acceptance criteria (all itemized with test references in the PR description). One flagged judgment call to sanity-check: the two added schema columns beyond the issue's literal list (reasoning above + in the PR description) — didn't stall for a synchronous answer since the reasoning was load-bearing and documented, but wanted it visible rather than silently done.

### 2026-08-13#2 — Games/Rewards (D): commit design assets — PR #308 (issue #304)            [OPEN]
From: Coder   Re: PM dispatch (2026-08-13)

Shipped, isolated worktree at `.wt/304-games-rewards-assets`, branch `feature/304-games-rewards-assets`. Asset-only, no logic/component changes — exactly as scoped, unblocks nothing further needed for #307 to wire these in later.

Copied the 3 non-duplicate images from the gitignored design export (`design-ref/games-and-rewards/assets/`) into `apps/web/src/assets/games-and-rewards/`, byte-for-byte (checksum-verified against source), with descriptive names replacing the raw GUIDs:

- `d9cb6623-...png` → `wordmark-logo.png` (RapidClash wordmark, 140px display size)
- `ae7b64bb-...jpg` → `avatar-placeholder.jpg` (header avatar placeholder, 44px circular)
- `aab93c4b-...png` → `nav-icon-small.png` (small 28px icon)

Confirmed the three exclusions per the issue: skipped the phone-frame chrome overlay (`201c22f3-...`), and did not re-extract the three assets byte-identical to the already-committed Bring-a-Rival banner set from PR #302 (verified via `md5sum` cross-check, not just taking the issue's word for it — all three still match). No `.bin` files touched.

Files are plain committed assets, not yet imported anywhere (correctly out of scope — issue #307 wires them in once #306's backend is ready).

**Verification:** full suite **94 files / 1155 tests** green, `tsc -b` clean, `eslint` clean. (Fresh worktree needed `pnpm install` first — no `node_modules` shipped with `git worktree add`, unlike a branch checkout in the same working directory.)

Ask: PR review — #308, against the issue's asset list (all 3 copied, all exclusions verified).

### 2026-08-13#1 — Bring a Rival: Designer banner replacement — PR #302 (issue #301)            [OPEN]
From: Coder   Re: PM dispatch (2026-08-13)

Shipped, **PR #302** (`feature/301-bring-a-rival-banner`, isolated worktree at `.wt/301-bring-a-rival-banner`). Client-only, not owner-gated — both open questions (accessibility, missing assets) were already resolved by the Owner before dispatch, not re-litigated here.

Cross-checked the real Designer export (`docs/design-refs/rival/RapidClash bring a rival banner.zip`, extracted) against the spec doc's transcribed markup — matched exactly except the intentional `id="bring-a-rival-cta"` hook, as expected. Copied the markup byte-for-byte into `BringARival.tsx` (`apps/web/src/components/hub-shared/BringARival.tsx`, the single shared component, both call sites unchanged). Only diffs from the export: asset URLs → imported ES modules, `.rc-banner-wrap` width `390px`→`100%`, and the id hook. `trophy-coins.png` recompressed 787KB→16KB (spec asked under 60KB), visually identical at the 134px display size.

**Accessibility — shipped verbatim as Owner-confirmed**: plain non-focusable `<div>`, no `role`/`tabIndex`/keyboard handling, with a code comment recording the decision so it isn't silently "fixed" later without another sign-off.

**Copy-link + toast**: `navigator.clipboard.writeText('https://rapidclash.com')` called synchronously (no prior `await` — Safari requires the call stay in the same tick as the user gesture), try/catch fallback. Built a small purpose-built toast (local state + `framer-motion`'s `AnimatePresence`) rather than wiring the repo's unused shadcn Toast scaffold, whose shape doesn't match this spec. Positioned above `HubToolbar`'s nav using its own `env(safe-area-inset-bottom)` pattern, so it never collides with the bottom nav.

**Tests**: `HomeHub.test.tsx:142-165` rewrote its token-only/no-hardcoded-hex assertions (which broke on purpose against the export's required inline hex, per the issue's own expectation) into a new 5-test block covering: new copy renders and old copy is fully gone, CTA is a plain non-focusable div, tap copies + shows success toast, clipboard-unavailable fallback toast, second tap resets rather than stacks.

**Verification:** full suite **94 files / 1155 tests** green, `tsc -b` clean, `eslint` clean, CI (`build-and-test`) confirmed green on the PR.

Ask: PR review — #302, against the issue's acceptance criteria (all met, itemized in the PR description).

### 2026-08-07#6 — DemoGuest: Blackjack Demo-Opponent — PR #298 (issue #297)            [OPEN]
From: Coder   Re: your dispatch (2026-08-07)

Shipped, **PR #298** (`feature/297-blackjack-demo-opponent`, isolated worktree at `.wt/297-blackjack-demo-opponent`). One PR for both server and client halves, per the issue's own scoping note — unlike Chess's #278/#279 split, the client side here is small since `GuestGamePicker.tsx` (#279) already reads `GUEST_CURATED_GAMES` generically and `GameHub.tsx`'s guest-chrome gates already generalize with no code change.

**Server: bot pool.** `DEMO_BOT_BLACKJACK_IDS`, pool of 3 (Owner-confirmed to match Chess's pool size). Reused Chess's exact "at most one idle pool bot rests at a time, re-rest synchronously the instant one is taken" self-pairing guard rather than re-deriving it — new `blackjackBotMatch` tracking map, own branch in `ensureDemoBotResting`/`onDemoBotMatched`, same mechanism.

**Server: hit/stand heuristic.** `selectBlackjackMove`, issue-locked probability table keyed to the hand's best (soft-if-present-else-hard) value: ≤14→100%, 15→90%, 16→80%, 17→50%, 18→20%, ≥19→0%. Same pluggable-`random()` pattern as `selectChessMove`. Reused `handValue`/`Card` by exporting them from `@rapidclash/game-blackjack`'s public entry rather than re-deriving ace-downgrade logic in `apps/server`.

**The architecturally interesting part — concurrent, not turn-based, needed zero new scheduling code.** Blackjack's bot decisions are self-triggered (both players act on their own hand independently), unlike Chess's opponent-triggered ones. Traced `maybeScheduleGuestBotMove` closely: it's already fully generic — checks `mod.legalMoves(...).length > 0`, already called both right after every match forms and after every non-terminal `broadcastMoveResult` regardless of who moved. Since Blackjack's round is dealt by `init` at match formation, a hit/stand always broadcasts (even mid-round, empty `events` per redaction), and an internal draw's `new_round` re-deal is itself just another non-terminal broadcast — the existing hook already satisfies "trigger on match creation, after each bot hit, after each replay re-deal" with no behavioral change, just updated doc comments stating the generalization explicitly.

**Forcing a genuine draw/replay in a live-WS test (flagging the technique, not a new ambiguity).** The issue's test list asks for an internal draw/replay to re-trigger the bot's next-round loop under live WS. Deck seed comes from `node:crypto`'s `randomBytes`, the heuristic from `Math.random` — neither injectable through `createServices`/`buildApp`'s public surface. Used a partial `vi.mock('node:crypto', ...)` (forwards to the real impl except one pinned `randomBytes` call) plus a `Math.random` spy installed *before* `createServices()` (the heuristic closes over `Math.random` at construction — spying after is a no-op), with an offline-search-derived seed (`cryptoSeed=4`) landing both hands on 16 round 0. Asserts the actual `new_round` event, then a further unsolicited `match.state` for round 1 proving the self-trigger fired the redeal alone.

**A wrong assumption caught building the forfeit-mid-think test:** Blackjack opts into the core's per-player move timer (`meta.moveTimeoutMs`), so the gateway deliberately does *not* arm the ordinary close-forfeit timer for it (an absent player auto-stands via the #91 move-timer sweep instead). Chess's version of this test close-forfeits normally; Blackjack's had to send the explicit `match.forfeit` message instead — the real client's own forfeit action, unconditional regardless of a game's timer opt-in.

**Client:** `GUEST_CURATED_GAMES` gains `'blackjack'`, new `GUEST_BLACKJACK_STAKE = 100` (matches `bet.maxStake`, same reasoning as the other two stake constants), both in `packages/shared/src/guest.ts`. `App.tsx`'s `handleGuestSelectGame` pre-arms the fixed stake (no time-control equivalent — Blackjack has none). Verified rather than assumed: `GuestGamePicker.tsx` needed no change (new unmocked `GuestPickerBlackjack.test.tsx` against the real, now-3-game `GUEST_CURATED_GAMES`, same "no more mocking a constant that's real" bar #281 held Chess to), and `GameHub.tsx`'s guest-chrome gates generalize (new `BlackjackHub.test.tsx` block mirroring Coinflip's/Chess's).

**Verification:** full suite **94 files / 1150 tests** green, `tsc -b` clean, `eslint` clean. Pushed and confirmed CI green against the PR's actual HEAD SHA (`5118c36`) — `build-and-test` passed, 3m34s: https://github.com/Ramunas01/rapidclash-demo/actions/runs/31212812558

Ask: PR review — #298, against the issue's server/heuristic/client/test asks (all met, itemized in the PR description). No new design ambiguity hit — this was issue-locked pool size and heuristic table, not re-litigated. Will clean up the worktree/branch after merge per the working rules.

### 2026-08-07#5 — SEAM-001 guest min-height gap fixed — PR #296 (issue #292)            [OPEN]
From: Coder   Re: your dispatch (2026-08-07)

Shipped, **PR #296** (`feature/292-guest-min-height`, isolated worktree at `.wt/292-guest-min-height`). Client-only, not owner-gated, didn't touch `App.tsx`.

**Root-caused before changing anything, per the issue's own explicit ask.** `HUB_SHELL` already carries `min-h-[100dvh]` — the issue's own framing is right that this "should" already fill the guest surface's container, but doesn't when that container is a nested iframe. `dvh` is a *dynamic* unit: the CSS Values and Units spec defines it as continuously re-resolving against a UA interface (address bar, etc.) "dynamically expanding and retracting" — chrome that exists only at the outermost/top-level browsing context. A nested iframe has no independent chrome of its own for that recompute channel to observe, so implementations vary in how (or whether) they keep `dvh` live for a context with no chrome to track — in practice it can resolve once at initial layout and then not track the iframe's real allocated box. Plain `vh` (currently defined to equal `lvh`, the large/stable viewport height, per MDN) is a static "how tall is my own viewport" read with no such dependency, and a nested browsing context's own viewport is its own content box — a static unit resolves against that correctly regardless of nesting depth.

**Could not verify this live** — same environment constraint #286/#290 already hit and documented (no headless browser/Playwright available here, checked again). Grounded the conclusion in the CSS spec / MDN semantics instead (`WebSearch`/`WebFetch` against MDN's viewport-units doc and a spec-adjacent article, both confirming the `vh`≡`lvh`-is-static / `dvh`-is-dynamic distinction, plus the well-known "plain `vh` inside an iframe resolves to the iframe's own height, not the parent's" behavior), and said so explicitly in the PR rather than claiming a live measurement.

**Fix:** added `HUB_SHELL_GUEST` in `layout.ts` — byte-identical to `HUB_SHELL` except `dvh`→`vh` — and `hubShellClass(isGuest)`, mirroring #290's `hubBodyPadding(isGuest)` shape exactly (non-guest/`undefined` returns the bare `HUB_SHELL` constant unchanged; guest returns the `vh` variant). `GameHub.tsx` is the only guest-facing screen and the only call site touched.

**Regression guard verified against real DOM, not assumed:** new `CoinflipHub.test.tsx` block renders the actual `CoinflipHubScreen` and asserts the shell `<div>`'s `className` string directly — non-guest is `'relative min-h-[100dvh] bg-background text-foreground'` (unchanged), guest is `'relative min-h-[100vh] bg-background text-foreground'` (the fix). `layout.test.ts` gained a matching unit-level block for `hubShellClass` itself, including an explicit check that the guest/non-guest strings differ *only* in the `dvh`/`vh` token.

**Verification:** full suite **90 files / 1123 tests** green, `tsc -b` clean, `eslint` clean. Pushed and confirmed CI: `build-and-test` passed, 3m27s — https://github.com/Ramunas01/rapidclash-demo/actions/runs/31205666304/job/92955945348

Ask: PR review — #296, against the issue's 4 acceptance criteria (all met; the root-cause one grounded in spec/MDN reasoning rather than a live iframe measurement, per the environment constraint flagged above and already precedented in #286/#290). Per the issue's own follow-up note, posting confirmation into the cross-advisor-comms log so Advisor-Landing can lock the cutout dimensions is explicitly not mine to do — leaving that to the PM. Will clean up the worktree/branch after merge per the working rules.

### 2026-08-07#4 — PR #281 (issue #279) rebased onto #278, mock removed, real verification done            [OPEN]
From: Coder   Re: your dispatch (2026-08-07)

Rebased **PR #281** (`feature/279-guest-game-picker`, isolated worktree at `.wt/279-guest-game-picker`, already existed and was reused per the dispatch — not a new worktree) onto current `main`. It predated #278 merging (opened 2026-08-06T19:06:40Z from a `main` before #278/PR #282 landed at 19:21:49Z) — confirmed with `git merge-base --is-ancestor origin/feature/278-chess-demo-bot origin/feature/279-guest-game-picker` returning false, and no CI had ever run on the branch.

**Rebase conflicts, both resolved as clean additive merges (not real logic conflicts):**
- `App.tsx`'s `Screen` union + switch — main had since gained `'guest-loading'` (#284's `?mode=guest` URL entry, merged as PR #286 after this PR opened) alongside this PR's own `'guest-picker'`. Both screens are real and needed; kept both, both imports (`api.js` + `GuestGamePicker.js`).
- `docs/COMMS/CODER_TO_PM.md` — pure ordering (this PR's own original status entry vs. #278's, both independently labeled `2026-08-06#7`); renumbered this PR's to `#8`, kept both, changed nothing else (append-only, not deleting history).
- `GameHub.tsx` auto-merged with no conflict.

**Removed the mock, verified for real (the dispatch's core ask):** with #278 in, `GUEST_CURATED_GAMES` is now genuinely `['coinflip', 'chess']` on `packages/shared` — deleted the `vi.mock('@rapidclash/shared', ...)` from `GuestPickerChess.test.tsx`; it now runs against the real constant. Also switched `App.tsx` off its pre-#278 workaround (a local `GUEST_CHESS_TIME_CONTROL = 'blitz5'` duplicate and reusing `GUEST_COINFLIP_STAKE` for chess) onto the real `GUEST_CHESS_STAKE`/`GUEST_CHESS_TIME_CONTROL` `packages/shared` now exports. This matters beyond tidiness: those are the **exact same symbols** `apps/server/src/guest/chess-demo-bot.gateway.test.ts` (#278, unchanged, still green) already exercises live — a real WS `queue.join` pairing against a real pooled Demo-Opponent, a real delayed opening move, `viewFor` redaction confirmed unchanged, 3 concurrent guests with no cross-contamination, forfeit-during-think cancellation. Client and server now provably send/expect identical stake + time-control values, closing the specific drift risk the original PR flagged when it kept the constant local specifically to avoid colliding with #278 before #278 existed. I did not build a new client+server end-to-end harness (no such pattern exists anywhere in this repo — every "live" test is server-side against a real WS gateway with the payload constructed directly, not driven by an actual rendered client — and per #286/#290's own reports, no real browser/Playwright is available in this environment to drive the real React client against a live server). Flagging this reasoning explicitly in case it's not sufficient: happy to revisit if a real browser becomes available.

**Also fixed 3 tests broken by the rebase itself** (pre-#279 direct-jump-to-hub assumptions, correctly superseded now that guest entry lands on the picker first): `GuestPicker.test.tsx`'s stale "today just Coinflip" tile-count assertion (now asserts both real tiles), one `App.test.tsx` guest-entry helper (#283's test), and two `GuestUrlEntry.test.tsx` tests (#284) that all expected `hub-guest-badge` immediately after guest-auth — updated each to go through the picker first, matching the actual current flow. These aren't new behavior, just tests catching up to two other PRs' assumptions that this rebase collided with.

**Verification:** full suite **90 files / 1118 tests** green, `tsc -b` clean, `eslint` clean. Pushed (`git push --force-with-lease`, history rewritten by the rebase) and confirmed CI actually ran and passed this time — `build-and-test` green: https://github.com/Ramunas01/rapidclash-demo/actions/runs/31201692415 (Build/Lint/Test all green, ~3m20s).

Updated PR #281's description in place (`gh pr edit` hit a known GH CLI bug — GraphQL error on a deprecated Projects-Classic field — worked around via `gh api repos/.../pulls/281 -X PATCH` directly): added an "Update" section up top explaining the rebase + real verification, corrected the acceptance-criteria/test-plan bullets that referenced the mock, and added a new explicit acceptance-criteria line for the real chess-bot pairing proof.

No new design ambiguity hit — this was rebase-and-verify work against an already-approved design; didn't invent anything new to flag for a human decision.

Ask: PR review — #281, now genuinely current and CI-verified against the real #278. Will clean up the worktree/branch after merge per the working rules.

### 2026-08-07#3 — Guest-mode ~112px dead space trimmed — PR #290 (issue #288)            [OPEN]
From: Coder   Re: your dispatch (2026-08-07)

Shipped, **PR #290** (`feature/288-guest-dead-space-trim`, isolated worktree at `.wt/288-guest-dead-space-trim`). Client-only, not owner-gated, didn't touch `App.tsx`.

Confirmed the diagnosis in the issue: `HUB_BODY` (`layout.ts`) reserves ~112px (`7rem`) for the fixed `HubToolbar`, applied unconditionally in `GameHub.tsx` even though `{!isGuest && <HubToolbar .../>}` already hides that toolbar for guests. Added `hubBodyPadding(isGuest)` — non-guest returns the bare `HUB_BODY` constant unchanged (byte-identical, not just visually equivalent), guest returns `''`. Only `GameHub.tsx` needed touching; `HomeHub.tsx`/`ProfileHub.tsx` also import `HUB_BODY` directly but neither is ever guest-facing and both always render their toolbar, so left as-is.

**Flagging one thing rather than quietly working around it:** the issue's acceptance criteria ask to verify the guest height drop "via a real measurement... not just 'the class changed'" — same bar PR #287 met with an actual headless-Chromium run. I don't have a browser available in this environment (checked for `google-chrome`/`chromium`/Playwright/Puppeteer — none installed, and this repo has no such dependency), so I couldn't reproduce that live measurement myself. Instead I grounded the claim arithmetically: `HUB_BODY`'s class is `7rem` = exactly 112px at the standard 16px root font-size, matching PR #287's own measured 832−720=112 exactly, and it's the sole contributor to that gap (nothing else in `HUB_SHELL`/`HUB_BODY` changed). Regression tests assert on the actual rendered DOM class string (this codebase's established pattern — see `HubRibbon.test.tsx`'s existing `className.toContain(...)` checks — jsdom has no layout engine, so no test here asserts on computed pixel values either). Said this plainly in the PR rather than claiming a live measurement I didn't perform. If a real browser should be available for tickets like this going forward, worth deciding whether to add Playwright as a dev dependency — didn't want to make that call unilaterally for one ticket.

**Verified both directions of the fix actually matter**, not just "the test passes": reverted only the `GameHub.tsx` change (helper left in place) and reran — the guest-mode test failed with the padding class still present. Restored, green again.

**Verification:** full suite **87 files / 1103 tests** green (4 new tests: 3 in a new `layout.test.ts`, 1 new block in `CoinflipHub.test.tsx`), `tsc -b` clean, `eslint` clean.

Ask: PR review — #290, against the 3 acceptance criteria in the issue (2 fully met; the height-drop one met via arithmetic grounding rather than a live measurement, flagged explicitly above — let me know if that's insufficient and I'll revisit with a real browser if one's available). Per the issue's own follow-up note, once this merges I'll report the settled 720px guest height into `PM_TO_ADVISOR.md` for the Advisor's SEAM-001 work. Will clean up the worktree/branch after merge per the working rules.

### 2026-08-07#2 — Guest-mode embed entry point: ?mode=guest URL route — PR #286 (issue #284)            [OPEN]
From: Coder   Re: your dispatch (2026-08-07)

Shipped, **PR #286** (`feature/284-guest-mode-url-entry`, isolated worktree at `.wt/284-guest-mode-url-entry`). Read `docs/GUEST_MODE_CONTRACT.md` v0.2 §1 first.

**Concurrency check (as instructed):** #279/PR #281 is still OPEN, touches the exact same `App.tsx` guest-entry area (`handleGuestSuccess` and its neighborhood). Branched from current `main` (does not include #281's unmerged changes) — whichever of #281/#284 merges second eats a rebase. Kept the collision risk as low as I could by calling `handleGuestSuccess` by reference rather than editing its internals, so this PR shouldn't need to change regardless of what #281 does inside that function. Also spotted `.wt/283-guest-stuck-hub-fix` (same guest area) but it's clean, zero divergent commits — nothing actually in flight there.

**What shipped:** `isGuestModeUrl()` reads `?mode=guest` off `window.location.search` (no dedicated route — this app has no client router). New `'guest-loading'` screen + the initial `screen` state checks the URL **synchronously before first paint**, not just reactively, so an embed never flashes Home while the guest-auth call is in flight. A ref-guarded mount effect calls `api.guestAuth()` then feeds the result straight into the existing `handleGuestSuccess`, unchanged. Guarded against React 18 StrictMode's dev double-invoke (this app wraps `<App/>` in `<StrictMode>` — without the guard it'd mint two guest sessions per load, hitting #270's rate limit needlessly). Skipped entirely when a real session is already persisted, so a shared guest link can't hijack a signed-in visitor. A failed mint falls back to Home instead of a stuck blank screen.

**Judgment call — config params:** kept `games`/`credits`/`chrome` solely on the existing postMessage `config` channel (#271), did not also parse them from the URL. The postMessage channel validates the sender's origin against the CSP allowlist; a query string has no equivalent trust boundary. Also nothing client- or server-side varies its behavior off these today (curated set/stake/credits are fixed constants) — URL parsing for them would be unused plumbing right now.

**Acceptance criteria — one is only partially met, flagging clearly:** built the real app (`vite build`) and ran it through the actual Fastify server, then `curl`'d `/?mode=guest` — confirmed `content-security-policy: frame-ancestors https://rapidclash.com https://staging.rapidclash.com` on the real built artifact, not just a unit test. **Could not do a live-browser iframe check** — downloaded a headless Chromium via Playwright fine, but it wouldn't launch (missing OS shared libs, `libnspr4.so` etc.) and installing them needs `apt-get`/root, which needs interactive `sudo` this sandbox doesn't have. Separately, even with a working browser I have no way to serve a test page from the actual `rapidclash.com`/`staging.rapidclash.com` origins to test the real positive case — and per the issue's own note, there's no staging deployment yet either, so that exact scenario can't be fully exercised from any dev box today. **Ask: someone with real browser access (or root) should do a quick manual iframe check post-deploy** — embed the deployed `/?mode=guest` from an allowed origin and confirm it renders; confirm a disallowed origin gets blocked. Everything else is covered by a new jsdom test file (`GuestUrlEntry.test.tsx`, 5 tests) exercising the real `App` component end-to-end.

**Verification:** full suite **86 files / 1096 tests** green, `tsc -b` clean, `eslint` clean.

Ask: PR review — #286, with the iframe-verification caveat above front and center.

### 2026-08-07#1 — Guest stuck-hub bug fixed, PR #285 (issue #283)            [OPEN]
From: Coder   Re: your dispatch (2026-08-07)

Shipped, **PR #285** (`feature/283-guest-stuck-hub-fix`, isolated worktree at `.wt/283-guest-stuck-hub-fix`). Client-only, not owner-gated. Checked #279/PR #281 first per the dispatch: still open/unmerged, touches the same `App.tsx`/`GameHub.tsx` area — no actual collision, since #281 hasn't landed, this fix targets the current direct-jump-to-Coinflip flow still on `main`.

**Exact trigger, found by exercising every clickable element reachable from the guest Coinflip hub (acceptance criterion 1):** `GameHub.tsx`'s related-games rail, footer, and bottom nav were all already correctly gated on `isGuest` — none of those were it. It was `HubRibbon`'s top-left logo button — rendered unconditionally, the one piece of hub chrome NOT gated. Tap it → `onLogo` → `App.tsx`'s `goToHome()` → the full, unrestricted Home hub (never passed `isGuest`, no concept of guest mode). Its game grid routes through the ordinary `handleSelectGame`, which explicitly sets `prearmStake` to `undefined` ("normal selection: no pre-armed bet") — landing a guest on e.g. chess-hub with `isGuest` still `true` (never resets mid-session, so `betLocked=true`) but nothing ever pre-arming a stake for that game. PLAY permanently fails "Select a bet amount to play" — exactly the reported dead end.

**Fix at the source:** `HubRibbon.tsx` renders the logo as a plain, non-interactive image for a guest — no `<button>`, no `onClick`. Mirrors the EXISTING `isGuest` pattern already on the same component (the non-tappable "Demo" badge instead of the live Wallet chip) — not a new mechanism.

**Defense-in-depth (issue's explicit ask #3):** a new `App.tsx` guard, independent of the specific trigger — whenever `isGuest` is true and the current screen is a hub for a game outside `GUEST_CURATED_GAMES`, snap back to the guest's curated entry point. Wrote this against the DATA-DRIVEN constant (not a hardcoded screen check), so it doesn't need touching again once #281's picker adds chess to the curated set.

**Verified the two layers are genuinely independent**, not "the same fix asserted twice": temporarily reverted ONLY the `HubRibbon` change (guard left in place) — both its own test and the App-level regression test failed with the exact pre-fix button back in the DOM. Restored it, then separately short-circuited ONLY the `App.tsx` guard (fix left in place) — the defense-in-depth test (which injects a WS `match.start` for an uncurated game, a different code path than the ribbon click) timed out waiting for the snap-back. Restored, full pair green again. This is the "prove the fix" half of acceptance criterion 4, done for both layers separately.

**Note left in the PR for whoever picks up #279/PR #281 next**, per the dispatch's own ask: its picker + `handleGuestSelectGame` should be the only way a guest ever changes games — this fix + guard close the stray path independently of that PR landing, no coordination needed, but worth a sanity check once #281 merges that the guard's `GUEST_CURATED_GAMES` check still lines up with the picker's routing.

**Verification:** full suite **85 files / 1093 tests** green (4 new tests: 1 in `HubRibbon.test.tsx`, a new describe block in `App.test.tsx`), `tsc -b` clean, `eslint` clean.

Ask: PR review — #285, against the 4 acceptance criteria in the issue (all met, itemized in the PR description). Will clean up the worktree/branch after merge per the working rules.

### 2026-08-06#7 — DemoGuest PR 3a (server): Chess Demo-Opponent — PR #282 (issue #278)            [OPEN]
From: Coder   Re: your dispatch (2026-08-06)

Shipped, **PR #282** (`feature/278-chess-demo-bot`, isolated worktree at `.wt/278-chess-demo-bot`). Server-only, not owner-gated (no protocol change), didn't touch `App.tsx`. Read `guest/index.ts` in full and the issue's architecture reasoning before starting, per the dispatch.

Generalized `onDemoBotMatched`/`ensureDemoBotResting` to dispatch on `MatchRecord.gameId` — Coinflip's branch is byte-for-byte its old logic, just wrapped. Added the chess pool (`demo-bot:chess:0..2`), the capture-value + 50/50-gate heuristic (`selectChessMove`), and the 1-5s thinking delay.

**Two bugs caught while implementing, neither in the dispatch itself:**
1. **Pool self-pairing.** Resting all 3 chess bot identities simultaneously lets the core's ordinary FIFO queue match them against EACH OTHER — any two distinct playerIds resting at the same `(gameId, stake, timeControlId)` key pair up, and the pool shares one key by design (so a human's single fixed-stake join can reach any of them). Caught this empirically: `sweepExpired` returned 2 entries where I expected 4, because two bots had already self-paired into a fake "match" at startup, consuming each other's queue slots. Fixed by only ever resting ONE pool bot at a time — the instant it's taken, `onDemoBotMatched` marks it busy and calls `ensureDemoBotResting()` again synchronously (mirrors Coinflip's own immediate re-rest), so the next idle sibling is resting well before any other guest's WS message can be processed. Still get 3 concurrent guest games; they just never observe 3 simultaneously-resting bots.
2. **Ephemeral-ledger idempotency collision.** `EphemeralLedger.adminCredit`'s idempotency key dedups by the key string ALONE, not key+account. The original Coinflip code's literal `'demo-bot:init'` only ever had one caller, so this never mattered; reusing it across the new pool would have silently left 3 of 4 bots at 0 balance (only the first credit call would have landed). Fixed with a per-bot key. Flagging this since it's a real footgun for the ledger's dedup contract that's easy to hit again — worth a Advisor/PM note if any future work adds more `adminCredit` call sites for the same conceptual account family.

**Heuristic (issue §3), chose the no-new-dependency approach:** score each candidate by a speculative `chessModule.applyMove` (pure, never touches the real match) and diff the opponent's material parsed straight from the resulting FEN — no `chess.js` added as a direct `apps/server` dependency. `packages/games/chess/src/index.ts` now also exports the `ChessMove` type (previously only `chessModule` itself), needed to type the heuristic.

**Thinking delay (issue §4):** since submission can't be synchronous, `gateway.ts` schedules it via a new `pendingBotMoves` map — same cancelable-timer pattern as the existing `pendingForfeits`/`pendingGuestEvictions`. Cancelled at every point a chess match can end while a bot is "thinking": explicit forfeit, socket-close forfeit, draw acceptance, and both sweep resolution loops (stale-match and timed-out-move/flag-on-time).

**Test coverage**, one file per concern in `apps/server/src/guest/`:
- `chess-bot-heuristic.test.ts` — seeded-random statistical proof the capture-value move is played roughly half the time (not ~0% or ~100%), a spy on `chessModule.applyMove` proving the full evaluation runs every call regardless of gate outcome, the sole-legal-move override, and tie-breaking variety.
- `chess-bot-pool.test.ts` — core-level: no self-pairing, 3 concurrent matches with 3 distinct opponents and no cross-contamination, a 4th guest rests in FIFO and pairs once a slot frees, pool idempotency.
- `chess-demo-bot.gateway.test.ts` — live WS: bot's delayed opening move arrives and broadcasts correctly, `viewFor` genuinely unchanged (compared against the live gateway, not assumed), 3 concurrent live sockets never cross-receive each other's `match.state`, and a forfeit mid-"think" settles cleanly with the bot's now-stale pending move never re-applying (verified by advancing real time PAST the bot's original delay window after the forfeit and confirming the settlement is unchanged). `GUEST_BOT_THINK_MIN_MS`/`MAX_MS` env-tunable (same pattern as `RC_PICK_WINDOW_MS`) so these don't wait out real 1-5s delays — **note for future coders**: I originally made these module-top-level constants and they silently ignored `beforeEach`'s env override because Node caches the module after first import; moved the read inside `createGuestServices()` itself, matching how `forfeitDelayMs` is already read inside `registerWsGateway` rather than at `gateway.ts`'s module scope.
- Updated 3 pre-existing assertions in `guest.test.ts` that hardcoded "exactly 1 resting bot total" — now legitimately 2 (Coinflip's + the chess pool's one resting slot), not a regression.

**Verification:** full suite **85 files / 1090 tests** green, `tsc -b` clean, `eslint` clean.

Ask: PR review — #282, against the 9 acceptance criteria in the issue (all met, itemized in the PR description). Will clean up the worktree/branch after merge per the working rules.

### 2026-08-06#8 — DemoGuest PR 3b: guest game picker (Coinflip/Chess) + chess-hub guest wiring — PR #281 (issue #279)            [OPEN]
From: Coder   Re: your dispatch (2026-08-06)

Shipped, **PR #281** (`feature/279-guest-game-picker`, isolated worktree at `.wt/279-guest-game-picker`). Confirmed no other agent/worktree was touching `App.tsx` before starting.

**Flag, please read first: #278 is NOT actually merged.** Your dispatch said it "should already be merged to main by the time you start" — checked (`gh issue view 278`), it's still **OPEN**, no PR filed for it at all. `GUEST_CURATED_GAMES` on `main` is still coinflip-only and there's no chess bot pool in `apps/server/src/guest/index.ts`. Per the issue's own scoping note ("the picker UI and routing logic can be built and unit-tested independently"), I proceeded rather than blocking — but I could not do a real end-to-end pairing test against a live chess bot. To still verify the chess-specific wiring genuinely works (not just "looks like it should"), I added a dedicated test file that mocks `GUEST_CURATED_GAMES` to include `'chess'` ahead of time and drives the full flow through the real `App` component — picker shows both tiles, picking Chess sends the correct `queue.join` payload, a simulated chess win fires `firstWin`. This should be re-verified against the real thing once #278 actually ships. **You may want to check with whoever's picking up #278** — it hasn't been dispatched yet as far as I can tell from the issue tracker.

**What shipped:** replaced the guest-auth-success direct jump into the Coinflip hub with a new minimal picker (`GuestGamePicker`, new file), data-driven off `GUEST_CURATED_GAMES` — never hardcodes the game list. **Judgment call — new component vs. gating `GameListScreen`:** checked first as asked; gating the real screen would mean stripping out its `/games` roster fetch, full-roster "coming soon" tiles, and marketing hero/back-button — more invasive than a small new component reusing the same `TILE_ART`/`titleCase` primitive `GameHub`'s `RelatedRail` already uses.

**A real bug found while verifying (not assuming) the guest chrome gates generalize to chess:** they do — confirmed directly against `ChessHubScreen` with a new test block mirroring `CoinflipHub.test.tsx`'s existing guest-chrome coverage. But a DIFFERENT thing broke: `GameHub.tsx` skips the `/games` roster fetch entirely for guest sessions (comment: "coinflip has no time control") — true for Coinflip, false the instant a curated game *does* have one. Without a fix, a guest on the chess hub would have `selectedControl` stuck at `undefined` forever, and PLAY would silently omit `timeControlId` altogether — never `'blitz5'`. Fixed by adding `initialTimeControl?: string` to `GameHubScreenProps` (mirrors the existing `initialStake`) — this is exactly the mechanism `ADVISOR_TO_PM.md` 2026-07-12#7 flagged as a possible future need ("we'd add an `initialTimeControl` prop mirroring `initialStake`" if the hub ever needed to pre-arm a control on a fresh mount). Seeded `selectedControl` from it, guarded the roster-sync effect to non-guest sessions, and changed PLAY's send condition to "is a control actually armed" instead of "did the full picker descriptor load" — behavior-identical for every existing game/session.

**A second bug this ticket's own change would have introduced:** the `ready`/`requestFullscreen` postMessage effect (#271) gated on `screen === 'coinflip-hub'` specifically — dead the moment guest entry lands on the picker first instead. Broadened it to fire on `isGuest` alone (the picker is already "the guest surface mounted and interactive"); both emit calls are self-guarded to fire at most once regardless.

**Stake constant:** reused `GUEST_COINFLIP_STAKE` for chess's pre-armed stake rather than adding a new one — chess's own `maxStake` is also 100, and #278's spec never defines a second guest stake, only the time control. Kept `GUEST_CHESS_TIME_CONTROL = 'blitz5'` local to `App.tsx`, not `packages/shared` — #279's own scope note is client-only files, and #278 owns `GUEST_CURATED_GAMES`/shared guest constants server-side; avoids a same-file collision once #278 lands.

**Verification:** full suite **85 files / 1091 tests** green (was 81/1073 before #277 — some of that growth is #276/#277 landing since, this PR adds 4 new test files + one block), `tsc -b` clean, `eslint` clean.

Ask: PR review — #281. Separately: can you confirm #278's dispatch status? It's referenced as a hard dependency by #279 but doesn't appear to be in flight anywhere I can see.

### 2026-08-06#6 — DemoGuest PR 2: postMessage Events emitter + framability CSP — PR #277 (issue #271)            [OPEN]
From: Coder   Re: your dispatch (2026-08-06)

Shipped, **PR #277** (`feature/271-guest-events-csp`, isolated worktree at `.wt/271-guest-events-csp`). Read `docs/GUEST_MODE_CONTRACT.md` v0.2 §§3/5 and the full issue spec before starting.

**Issue #270 check (as instructed):** still open at dispatch time, with uncommitted in-progress work sitting in `.wt/270-guest-rate-limit` touching `server.ts`. Branched from the `main` I had (`d9ff82d`) and didn't touch that worktree. #270 has since opened as **PR #276** but is still unmerged — my branch is current with `main` as of PR #277; will rebase if #276 lands first (both touch `server.ts`'s top-level app setup, but in non-overlapping spots — the CSP hook is a new `onSend` block before route registration, #276's rate-limiter is scoped to the guest-auth route registration — so I'd expect a clean rebase, not a real conflict).

**Part A — CSP:** app-wide `onSend` hook on `server.ts` sets `Content-Security-Policy: frame-ancestors <allowlist>`; confirmed (again) no `X-Frame-Options` exists anywhere. **Judgment call — app-wide, per the issue's recommendation:** single-entry-point SPA, no same-origin sensitive data an embed could exploit differently than normal browsing, real users still hit the normal login wall regardless of framing.

**Part B — Events emitter:** new `apps/web/src/guest/events.ts`. Outbound `ready`/`resize`/`requestFullscreen`/`firstWin`, inbound `config` (origin-validated but not consumed into behavior yet — reads as a separate future slice, flagging rather than guessing at scope). New shared constant `EMBED_ALLOWED_ORIGINS` (`packages/shared/src/guest.ts`) is the single allowlist both the CSP header and the client's origin check read from, so neither can drift from the other.

**Judgment call — requestFullscreen trigger:** fires once, automatically, on mobile guest entry — no manual "enlarge" affordance exists in the UI, and the contract's "mobile: step into the app" phrasing reads as automatic. Detected via `matchMedia('(pointer: coarse)')`, not viewport width — the guest surface is narrow/portrait on desktop too (§3's phone-mockup shell), so width can't distinguish the two contexts from inside the frame.

**Security (the load-bearing part) — built exactly per the issue's spelled-out pattern, no improvising:** every inbound `message` validates `event.origin` against `EMBED_ALLOWED_ORIGINS` before acting; unrecognized origins are ignored outright. No outbound `postMessage` ever uses `targetOrigin: '*'` — the target origin is captured from the **first validated inbound message** (any type, not just `config`) and reused for the rest of the session; if none ever arrives, falls back to `document.referrer`'s origin **only if it also passes the same allowlist check**; if neither validates, outbound events just don't send. `firstWin` carries no payload at all (no PII, nothing non-PII worth sending either).

Not owner-gated — no wire-protocol/REST change, this is browser-level messaging only.

**Tests:** `apps/server/src/csp.test.ts` (header present app-wide including an unrelated route, contains every allowlisted origin, `X-Frame-Options` never sent) + `apps/web/src/test/guestEvents.test.ts` (13 tests — origin allow/reject, malformed envelopes ignored, capture-from-first-validated-message, referrer fallback valid + invalid, **every emitted event type asserted to never use `'*'`**, one-shot guards on `ready`/`requestFullscreen`/`firstWin`, `resize` confirmed NOT one-shot).

**Verification:** full suite **81 files / 1073 tests** green, `tsc -b` clean, `eslint` clean.

Ask: PR review — #277. Flagging the `config` inbound handler is validated but not wired to any behavior change (games/credits/chrome) — say if you want that in this PR or a follow-up; I read it as out of scope per the issue's acceptance criteria.

### 2026-08-06#5 — Guest-session rate limit shipped, PR #276 (issue #270)            [OPEN]
From: Coder   Re: issue #270 (GUEST_MODE_CONTRACT.md v0.2 §9 "Abuse guard")

Shipped, **PR #276** (`feature/270-guest-rate-limit`, isolated worktree at `.wt/270-guest-rate-limit`). Server-only, not owner-gated (no protocol/contract change), didn't touch `App.tsx`.

Added `@fastify/rate-limit@^8.1.1` — the last major targeting `fastify-plugin ^4.0.0`, matching this repo's Fastify v4 (checked `package.json`/`server.ts` first, confirmed no existing rate-limit infra as the dispatch said). Registered `global: false` in `server.ts` so it's inert everywhere except a route that opts in; the cap itself lives in `guest-auth.ts`'s route `config`.

**Cap chosen: 5 sessions/minute/IP.** A "handful" per the issue's own suggested starting point — comfortably covers a real visitor clicking "Play as guest" once or reloading a few times, but a scripted loop hits 429 on the 6th request within the window.

**Bug caught while wiring this up, not in the dispatch:** `registerGuestAuthRoutes(app, ...)` was a direct, synchronous `app.post()` call — same pattern as every other route. That runs *before* avvio boots the rate-limit plugin and attaches its `onRoute` hook, so the route's `config.rateLimit` silently never applied (verified empirically: no `x-ratelimit-*` headers, no 429 after 10 rapid requests). This is the exact timing issue the existing `/ws` registration already works around (see its comment in `server.ts`) — wrapped `registerGuestAuthRoutes` in the same nested-plugin trick so it defers into avvio's boot queue after the hook is attached. Confirmed fixed by hand before writing the regression test: requests 1–5 → 201 with descending `x-ratelimit-remaining`, request 6+ → 429.

Client (`apps/web/src/api.ts`) needed no change: checked `req()`'s existing error-surfacing first per the dispatch's ask — it already does `throw new Error(err.error ?? ...)`, and the plugin's default 429 body (`{ error: 'Too Many Requests', ... }`) surfaces through that as a reasonably clear message.

**Test coverage** (new `apps/server/src/routes/guest-auth.test.ts`): a 6-request burst gets 429 on the 6th (not 201), with a non-empty `error` in the body; 5 requests at the cap all succeed; a 10-request burst against `/open-challenges` (no rate-limit config) is completely unaffected, proving the scoping. Also checked `guest.gateway.test.ts` for regressions — no existing test mints more than 2 guest sessions, so the cap doesn't collide with anything there.

**Verification:** full suite **80 files / 1060 tests** green, `tsc -b` clean, `eslint` clean. Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first, per the working rules.

Ask: PR review — #276, against the 5 acceptance criteria in the issue (all met, itemized in the PR description). Will clean up the worktree/branch after merge per the working rules.

### 2026-08-06#4 — Demo-Opponent permanent lockout after idle TTL — fixed, PR #274 (issue #267)            [OPEN]
From: Coder   Re: your bug report (2026-08-06)

Shipped, **PR #274** (`fix/demo-bot-queue-expiry`, isolated worktree). Root cause confirmed exactly as you diagnosed: `restDemoBot()` used the ordinary `joinQueue`, so the bot's resting entry got the same `CHALLENGE_TTL_MS` (90s) as any real bet; `gateway.ts:168-169`'s periodic sweep already ran `sweepExpired()` against the guest instance (needed for Coinflip's own pick-window resolution — unrelated to this bug but the same code path); `onDemoBotMatched` was the only re-post hook and can never fire with no bot to pair against. Confirmed the permanent-lockout mechanism, not just the symptom.

Fix as specified: renamed `restDemoBot` → `ensureDemoBotResting`, added it to the `GuestServices` interface, call it once per sweep tick in `gateway.ts` right after `runSweeps(guest.matchmaking, true)` (same try/catch, keeping it inside the guest-sweep failure domain from the #268 review fix).

**Regression tests, both layers:**
- Core-level (`guest.test.ts`) — injectable clock + short `ttlMs`, the exact `open-challenges.test.ts` pattern you pointed at. Reproduces the expiry + lockout, proves the self-heal, and additionally proves a guest already stuck resting when the bot reappears gets matched immediately via the ordinary FIFO path (no special-case code needed for that).
- Live WS-level (`guest.gateway.test.ts`) — real wall-clock idle time past a short `CHALLENGE_TTL_MS` override, then proves the REAL periodic sweep timer (not a manual call) self-heals it before any guest attempts to join. **Verified this test actually catches the regression**: temporarily deleted the `ensureDemoBotResting()` line from `gateway.ts`, re-ran it, watched it time out waiting for `match.start` — the exact experience a stuck production user would have — then restored the fix.

**Verification:** full suite **79 files / 1057 tests** green, `tsc -b` clean, `eslint` clean.

Housekeeping: deleted the merged `fix/guest-auth-empty-body` remote branch (PR #273) per the working rules.

Ask: PR review — #274.

### 2026-08-06#3 — Production "Bad request" on "Play as guest" — fixed, PR #273 (issue #267)            [OPEN]
From: Coder   Re: your urgent bug report (2026-08-06)

Shipped, **PR #273** (`fix/guest-auth-empty-body`, isolated worktree at `.wt/fix-guest-auth-empty-body`). Small, single-concern, not owner-gated (no contract change — the wire shape is unchanged, just now actually well-formed).

Root cause confirmed exactly as diagnosed: `api.ts`'s `req()` always sets `Content-Type: application/json`; `guestAuth()` was the only body-less `POST` in the client, so a real `fetch()` sent that header over a zero-length body — Fastify's default JSON parser 400s on that (`FST_ERR_CTP_EMPTY_JSON_BODY`). Applied the fix as specified: `guestAuth()` now sends an explicit `{}`.

Before writing the regression test, verified empirically against the real route (not assumed): `app.inject({ method: 'POST', url: '/auth/guest', headers: { 'content-type': 'application/json' } })` with no payload reproduces the exact 400 today, confirming both the diagnosis and that `mintGuest()`'s existing bare `app.inject` (no header, no payload) genuinely never touches this path — matches your explanation of the test gap precisely.

**One thing surfaced while adding the test that's worth flagging:** a literal "empty body" `app.inject` call (matching the OLD broken client exactly) still 400s at the Fastify layer regardless of the client fix — inject bypasses `api.ts` entirely, so it can't be made to pass by a client-side change alone. I added that as a separate *characterization* test (asserting 400, documenting why the client must always send a real body) rather than trying to force it to assert success, and added the actual proof-of-fix as a second test using the fixed client's real request shape (header + `{}` body → 201). Also added a client-layer test on `AuthModal.tsx` itself — asserts the real `fetch()` call carries a parseable body — and manually confirmed it fails against the pre-fix code (reverted `api.ts` locally, watched it fail, restored the fix) before finalizing, so the regression coverage is proven, not assumed.

**Verification:** full suite **79 files / 1051 tests** green, `tsc -b` clean, `eslint` clean.

Housekeeping: also deleted the stale `feature/267-demoguest-coinflip` remote branch (PR #268 had merged but the branch wasn't cleaned up) per the working rules.

Ask: PR review — #273. Small enough that a quick pass should cover it; happy to also merge+deploy myself if you'd rather not round-trip for something this size, just say so.

### 2026-08-06#2 — PR #268: both review findings fixed + a mirror-image leak caught while fixing #1            [OPEN]
From: Coder   Re: your PR #268 review comment (2026-08-06)

Pushed `6111c64`. Both required/should-fix items addressed, plus one related leak I found while fixing #1 that your review didn't name but shares the same root cause.

**1. Real Open Games feed leak — fixed.** `challengeSubscribers`/`pushChallengesUpdate` (`gateway.ts`) is one module-scope channel shared by every connection. Guarded every call site behind `!isGuest`: both `queue.join` branches (waiting + matched/taken), `queue.leave`, `challenge.take`, the socket-close queue-abandon path (a 5th site your line numbers didn't name — same bug class, now covered), and the sweep's expiry push (`runSweeps` now takes an `isGuestMm` flag so `sweepExpired`'s push is guarded too — reachable if a guest's own resting entry ever TTL-expires).

**Also found while fixing #1 (not in your review — flagging explicitly):** the mirror image. `challenges.subscribe` was registering a guest's socket into that SAME shared subscriber set — so a guest who subscribed would have started receiving REAL players' Open Games activity, not just leaking guest activity outward. Guarded `challenges.subscribe`/`unsubscribe`'s shared-map access the same way; a guest still gets back its own (guest-scoped) `challenges.list` snapshot, it just never joins the shared broadcast set.

**Test added, per your ask + the two related scenarios:** `guest.gateway.test.ts` gained three — (a) a real socket subscribed to `challenges.subscribe('coinflip')` receives zero `challenges.update` across a full guest match (your exact ask), (b) the off-stake/tampered-join scenario you named explicitly (a guest joining at `GUEST_COINFLIP_STAKE - 1` rests instead of matching — proves the "hits the waiting branch" path you flagged is now safe), (c) the mirror-image case — a guest subscriber sees zero events from a real player's activity.

**2. Sweep failure isolation — fixed.** `runSweeps(matchmaking, false)` and `runSweeps(guest.matchmaking, true)` are each in their own try/catch inside the `setInterval` callback now, logged via `console.error` on failure. A fault in either sweep skips that instance for the tick (next tick retries) instead of throwing out of the timer callback and crashing the process.

**Verification:** full suite **79 files / 1048 tests** green (11 → 18 tests in `guest.gateway.test.ts`), `tsc -b` clean, `eslint` clean.

Ask: re-review #268.

### 2026-08-06#1 — DemoGuest PR 1 shipped: guest session + ephemeral ledger + Coinflip Demo-Opponent (issue #267)            [OPEN]
From: Coder   Re: issue #267 / PM_TO_ADVISOR.md 2026-08-06#3

Shipped, **PR #268** (`feature/267-demoguest-coinflip`, isolated worktree at `.wt/267-demoguest-coinflip` per the branch-before-edit/worktree-isolation rules). **⚠️ Owner-gated — touches `PROTOCOL.md`** (new `POST /auth/guest` endpoint). Spans server + client; the `App.tsx` collision zone was touched but no other agent was active there this session.

Verified the dispatch's architecture claims against the actual code before building (`ledger.ts:18`'s `Ledger` interface, `matchmaking.ts:302`'s `createMatchmaking` factory, `matchmaking.ts:402-488`'s PlayerId-agnostic pairing, `identity.ts:128`'s pure `signToken`) — all held up exactly as described. Also checked CHARTER.md's new "Guest mode" subsection is real and board-approved (not a fabricated carve-out) before treating the bot-opponent requirement as legitimate — it is (PR #266, merged).

**What shipped** (packages/core, apps/server/src/guest/, apps/server/src/ws/gateway.ts, apps/server/src/routes/guest-auth.ts, apps/web AuthModal.tsx/App.tsx/GameHub.tsx/HubRibbon.tsx — full breakdown in the PR description):
- A second, in-memory `Ledger` (`createEphemeralLedger`) and a second, isolated `Matchmaking` instance registered with only `[coinflipModule]`, no `matchHistory` — a guest match structurally cannot reach the real ledger, real `/wallet`, or the real leaderboard.
- `identity.ts` gained a `'guest'` role + `signGuestToken` (pure, no DB write, verifiable by the SAME `verifyToken` every existing call site uses — no parallel auth path).
- A permanently-resting Demo-Opponent (`demo-bot:coinflip`) that pairs a guest instantly via the ordinary FIFO queue — zero new pairing logic in `matchmaking.ts` itself, exactly as the dispatch predicted.
- **Load-bearing fix caught during implementation:** the WS gateway's periodic sweep (`sweepExpired`/`sweepStaleMatches`/`sweepTimedOutMoves`) was previously hardwired to the one real `Matchmaking` instance. Coinflip's pick window resolves ONLY through that sweep (`scheduledDeadlines`/`timeoutMove`, not "both chosen") — without also sweeping the guest instance, a guest's round would form correctly but then **never resolve**. Refactored the sweep body into a shared `runSweeps(mm)` called for both instances.

**Two judgment calls, flagged per the dispatch's explicit asks:**
1. **Guest stake fixed at `GUEST_COINFLIP_STAKE = 100`, not the dispatch's literal "300¢".** Verified against `coinflip.ts`'s own `meta.bet.maxStake: 100` — a bot resting at 300 would throw `RangeError` on `joinQueue` (300 is the wallet *starting stack*, not a valid per-match stake). Guest mode has no stake picker at all: every round is the one fixed stake the bot rests at (so PLAY always pairs instantly regardless of anything a picker might otherwise offer) — `PlayPanel` gained a `betLocked` prop for this, gated on `isGuest`.
2. **Session lifetime** (left open in `GUEST_MODE_STRATEGY.md` §8): a guest's ephemeral-ledger entries are evicted `forfeitDelayMs` (default 60s — same grace window as the existing close-forfeit timer) after its WS closes, cancelled on a reconnect within that window. Deliberately not a durable/queryable cleanup system per §7.

**Watch-out from the dispatch, addressed:** every `identity.getUsername` call site in the gateway now routes through a single `resolveUsername(id)` that special-cases the bot/guest ids first — the real `identity`/accounts table is never asked about a guest id.

**Verification:** full suite **79 files / 1045 tests** green (`packages/core/src/ephemeral-ledger.test.ts` 18 new, `identity.test.ts` +2, `apps/server/src/guest/` two new files — 7 core-level + 15 live-WS-gateway tests covering instant pairing, redaction, two-concurrent-guest isolation, ephemeral-only settlement, real-matchmaking non-leakage, and the eviction/reconnect-cancel policy — plus client-side `AuthModal`/`HubRibbon`/`CoinflipHub` guest-chrome tests). `tsc -b` clean, `eslint` clean. Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first, per the working rules.

Ask: PR review — #268, against the 11 acceptance criteria in the issue (all met, itemized in the PR description). Owner gate applies to the `PROTOCOL.md`/contract-touching part specifically. Will clean up the worktree/branch after merge per the working rules.


### 2026-08-05#2 — Coinflip: remove captions + hoist one persistent coin + one-time intro animation (issue #262)            [OPEN]
From: Coder   Re: issue #262 / ADVISOR_TO_PM.md 2026-07-12#14 / PM_TO_ADVISOR.md 2026-08-05#2 (PM's sanity-check + approvals)

(Flagging a relay gap, matching the pattern already noted elsewhere in this mailbox: neither `ADVISOR_TO_PM.md 2026-07-12#14` nor `PM_TO_ADVISOR.md 2026-08-05#2` are actually present in those files as of this branch — grepped both, no match. The full spec landed intact on the GitHub issue body itself (`gh issue view 262`), which is what this PR was built against; nothing here depended on the missing mailbox entries.)

Shipped, **PR #264** (`feature/262-coinflip-cleanup-intro`). Client-only, `apps/web/src/screens/CoinflipHub.tsx` + `apps/web/src/components/coin/Coin.tsx` (+ their tests). Not the `App.tsx`/`GameHub.tsx` collision zone — worked alone, parallel-safe with the concurrent Open Games ticker agent (issue #259/PR #261, disjoint files, confirmed no overlap).

**Part 1 (captions):** deleted `CoinflipIdle`'s `<p>{phase==='waiting' ? 'Finding a rival…' : 'Place your bet and play.'}</p>` entirely. `CoinflipBoard` already had none.

**Part 2 (hoist):** merged `CoinflipIdle`/`CoinflipBoard` into one `CoinflipPanel` that renders exactly ONE `<Coin>` for every phase (idle/waiting/in-match/result), inside a single fixed-`min-h-[260px]` `items-center justify-center` box. The countdown ring stays `absolute … -translate-y-1/2` (unchanged, non-displacing) and only shows during the live pick window (`live && !revealing`); pick pills stay in the existing slot-aside mechanism, untouched. The per-phase hooks (countdown tick, scroll-into-view) that used to live only inside `CoinflipBoard` are now unconditional (hook-rules) but no-op outside their phase. Net effect: identical panel dimensions and coin centre across every phase, and the coin's Three.js scene is built once per hub mount — never rebuilt on a phase transition, only on true hub mount/unmount. Regression test proves it via DOM-node identity (`hub-board`/`coin-face` are the SAME element across idle→waiting→in-match→result).

**Part 3 (intro, `Coin.tsx`):** new opt-in `intro` prop. Reuses the existing `mesh.rotation.y` + rAF render loop (no new visual path, no lit/unlit/geometry change) — `planIntro()`/`introRotationAt()` are pure, unit-tested functions (mirrors the existing `planFlip`/`easeOutCubic` split) describing three chained segments: tease 0→~0.7rad (~40°) easeOut ~0.35s → return ~0.7rad→0 easeInOut ~0.3s → full 2π spin easeInOut ~0.7s (its own natural deceleration into the landing is the spec's "slight end deceleration") — total 1350ms, inside the ~1.3–1.5s window. Fires once, mount-only (`[]`-deps effect), while resting; declared AFTER the existing flip/reset effect on purpose — that effect's mount-time `!flipping` branch unconditionally cancels `rafRef`, so declaring the intro effect first would let it win the mount race and immediately get its own just-started loop killed. A match starting mid-intro (`face` → a value) is handled in the flip effect: if `introRef.current.active`, cancel its rAF, snap `rotation.y = 0` instantly, *then* proceed with the normal flip (`from` reads the now-snapped 0) — never both loops running at once. Unmount cancels via the intro effect's own cleanup. Skipped entirely under `prefers-reduced-motion` (reused the existing `prefersReducedMotion()` helper, not duplicated).

**Judgment call — test timing.** The obvious approach (reuse the existing self-chaining fake-clock helper + `waitFor`) is racy for the intro specifically: its rAF loop re-schedules via real `setTimeout(...,0)` so fast that the whole ~1.35s sequence can complete in real wall-clock microseconds, before any `waitFor` poll observes an intermediate frame (confirmed empirically — the first version of these tests flaked exactly this way). Added a second helper, `installManualAnimationClock()`, that parks each `requestAnimationFrame` callback instead of auto-invoking it, so tests drive frames one at a time via `clock.advance(ms)` (wrapped in `act()`, since the callback can call `setDisplayFace` outside React's own event scope) — fully deterministic, no `waitFor`/timeouts needed for the intro tests. `three-stub.ts` gained a `capturedMeshes` export (same pattern as `capturedMaterials`) so tests can read `mesh.rotation.y` directly.

**Verification:** full `npx vitest run` **1005/1005 passing** (2 unrelated pre-existing failures — `identity.test.ts`/`auth.test.ts` avatar-persistence tests — confirmed present on bare `main` before this branch via `git stash`, and confirmed flaky/order-dependent since they pass clean in the full-suite run; untouched by this change). `tsc -b` clean, `eslint` clean, `prettier --write` applied to the two touched source/test files. Also fixed two now-stale caption assertions this change broke: `CoinflipHub.test.tsx`'s idle no-pills test and `App.test.tsx`'s leave/re-enter idle test both asserted the old caption text — updated to assert the board carries no text. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first; ran directly in-repo here since no worktree isolation was needed — no other agent touched these files.)

Ask: PR review — #264. Not owner-gated (client-only, no protocol/contract touch); all nine acceptance criteria met per the PR description. User-facing → left for Owner review + merge + deploy.

### 2026-08-05#1 — Open Games ticker: flat panel + zebra pills + stepped top-down motion (issue #259)            [OPEN]
From: Coder   Re: issue #259 / ADVISOR_TO_PM.md 2026-07-12#13 / PM_TO_ADVISOR.md 2026-08-05#1 (Owner-confirmed: N=5, static-backdrop zebra, one PR)

Shipped, **PR #261** (`feature/259-open-games-ticker-redesign`). Client-only, `apps/web/src/components/hub-shared/OpenGames.tsx` (+ its test) + a small dead-CSS cleanup in `index.css`. Not a collision-zone file — worked alone.

**Part 1 (flat panel):** `TickerBody`/`EmptyTicker` drop `bg-surface` + the inset shadow + `rounded-[14px]`; `TickerRow` drops `border-t border-brand/40`. Rows sit flat on `#0B0B0B`; `TickerBody` keeps `overflow-hidden`.

**Part 2 (zebra):** new `ZebraBackdrop` — 5 fixed, flush slots painted once behind the row content, never re-rendered. Even slots (0,2,4) get `rounded-full bg-surface`; odd transparent. **Judgment call:** used the `bg-surface` token (`--rc-surface`, resolves to exactly `#1a1a2e`) instead of a new hardcoded hex — same value the spec asked for, but tokenized per the CHARTER invariant. Row padding (`px-6`) is identical regardless of the slot behind it.

**Part 3 (stepped motion — the real work):** deleted the old continuous marquee entirely (`.rc-ticker-anim`/`@keyframes rc-ticker-scroll` in `index.css`, now dead — removed; the duplicated `aria-hidden` clone-row mechanism in the component, also removed). New `useSteppedTicker` shift-register: each step renders a 6-row wrapper `[incoming, ...visible]`, starts it at `translateY(-64px)`, flips to `translateY(0)` on the next frame (CSS `transition`) over `TICKER_STEP_MS`, then commits `visible = [incoming, ...visible.slice(0,4)]` and holds 800ms. Newest enters top, oldest exits bottom (inverted from the old marquee's direction — confirmed by reading `rc-ticker-scroll`'s `translateY(0)→-50%`). **Every row rendered mid-slide is a real `TickerRow` keyed by `matchId`, its own `onClick` closing over its own challenge** — the wrapper transforms, the rows never get recycled/swapped — so a tap mid-slide always fires the pressed row's own `matchId` (verified by two dedicated tests: tapping the incoming row and tapping the outgoing bottom row, both mid-transition). Live-set reconciliation (WS opens/closes) is buffered via a ref and applied only when `startStep` reads the live pool at a hold boundary — a step already in flight finishes on the data it started with; an update that lands mid-slide is picked up at the *next* hold, not before (dedicated test: g2 taken + g7 opened mid-slide, screen unchanged until the following hold). ≤5 rows render statically (zebra still applies); `prefers-reduced-motion` shows a static 5-row snapshot, never slides. Window height is a constant `5×64=320px` regardless of row count or animation state.

**Step-duration derivation (judgment call):** the old marquee's duration was a flat 22s regardless of row count, so its *effective* px/s varied with list length — there's no single "the" old speed to read off literally. Used the boundary row count that used to trigger the animation (one row above the old 5-row threshold, i.e. 6) as the reference: `22000ms / 6 ≈ 3667ms` per row-height (the row height itself cancels out of that ratio, so it's independent of the old rows' actual — variable — height). Documented in a code comment (`OLD_MARQUEE_LOOP_MS`/`OLD_MARQUEE_REFERENCE_ROWS`).

**Other judgment calls:** ticker window always reserves the full 320px even with 1-4 real open games (previously it was `maxHeight` and shrank to content) — needed for "no layout shift" as the live count fluctuates, and keeps the 5-slot zebra meaningful. `prefers-reduced-motion` "static snapshot" read as "no motion," not "frozen forever" — it still mirrors the live feed reactively, just never slides.

**Verification:** full `npx vitest run` **76 files / 993 tests** green; `pnpm run build` (`tsc -b`) clean; `pnpm run lint` clean; `apps/web` production `vite build` clean (pre-existing chunk-size warning only, unrelated). `OpenGames.test.tsx` rewritten (20 tests): flat panel, static zebra backdrop (incl. DOM-node identity stability across a step — proves zero flicker), static-when-≤5, full step lifecycle (hold → slide-start → transition-flip → mid-slide → commit) with exact pixel/timing assertions, tap-correctness mid-slide (incoming + outgoing rows), live-set-reconciliation timing, `prefers-reduced-motion`, plus the pre-existing header-leading/stake-formatting/affordability/oldest-first-ordering/public-ticker regression coverage carried forward. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #261. Not owner-gated (client-only, no protocol/contract touch); all nine acceptance criteria met per the PR description. User-facing → left for Owner review + merge + deploy.

### 2026-07-20#2 — Avatar sub-split (ii): Account picker + avatarId persistence (ADVISOR_TO_PM.md 2026-07-12#12 ii)            [OPEN — owner-gated contract/docs]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-12#12 sub-split (ii)

Shipped, **PR #256** (`feat/avatar-picker-persistence`). Full-stack: shared + server + client + PROTOCOL. Owner-gated (touches `protocol.ts` + `docs/PROTOCOL.md`).

**Shared:** `AvatarId` + `AVATAR_IDS` canonical in `protocol.ts`; `avatarId` added to `AuthResponse` + `LeaderboardEntryBase`; `SetAvatarBody`/`SetAvatarResponse`. `Avatar.tsx` now imports `AvatarId` from shared.
**Server:** snapshot-safe idempotent migration (`PRAGMA table_info(accounts)` gate → `ALTER TABLE accounts ADD COLUMN avatar_id TEXT NOT NULL DEFAULT 'default'`); `getAvatarId`/`setAvatarId`; register/login SELECT + return `avatarId`; `POST /auth/avatar` (`requireAuth`, `isAvatarId`-validated → 400, sets ONLY `request.player.id` — can't set others', 401 unauth); leaderboard entries carry per-player `avatarId`.
**Client:** `rc_avatarId` localStorage in lockstep with `rc_username` (read on boot via `loadAuth`, set from `AuthResponse`, updated on picker save, cleared on logout); threaded into own game bar + Account header; `api.setAvatar`; `AvatarPicker` overlay (`bg-surface`, default+4 presets via shared Avatar, `ring-[3px] ring-brand` selection, `bg-brand` Save); leaderboard rows use `entry.avatarId`.
**PROTOCOL.md:** documented the field additions + endpoint + presets-only + opponent-avatar-never-in-match.

**REDACTION (verified):** `avatarId` added to EXACTLY `AuthResponse` (own) + `LeaderboardEntryBase` (public). Grepped ws/, matches.ts, matchmaking.ts, game-contract.ts → ZERO `avatarId`/`avatar_id`. Opponent bar renders neutral `<Avatar avatarId="default">` no username; client test asserts opponent stays neutral even when own avatar is a preset.

**Judgment calls:** did NOT add avatarId to `AdminPlayerSummary` (admin-only, not public); threaded `AuthResponse.avatarId` as a 5th arg through `onLogin`/`onSuccess` (minimal blast radius, all call sites updated); no prettier (baseline mismatch).

**Verification:** full `npx vitest run` **76 files / 979 tests**; server (identity migration-idempotency + pre-column-snapshot default, auth set/echo/400/401, leaderboard avatarId), client (picker flow, opponent-redaction); `tsc -b` + eslint (21 files) clean. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #256. Owner-gated (contract + PROTOCOL.md); PM-reviewed against acceptance (all met, redaction verified). Left for Owner merge + deploy. Completes the avatar system (i + ii).

### 2026-07-20#1 — Avatar sub-split (i): shared Avatar + per-user light disc, default everywhere (ADVISOR_TO_PM.md 2026-07-12#12 i)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-12#12 sub-split (i)

Shipped, **PR #254** (`feat/avatar-shared-component`). Client-only, no server/protocol change. Collision-zone GameHub touched.

**New `components/hub-shared/Avatar.tsx`:** `AvatarId = 'default'|'boy-light'|'girl-light'|'boy-brown'|'boy-dark'`; props `{avatarId?, username?, size?, className?}`. djb2 hash → disc `hsl(hue,55%,90%)` (per-user LIGHT, not stored); default glyph darkened `hsl(hue,45%,40%)` (never white); NEUTRAL (no username) → fixed disc `hsl(230,10%,88%)` + slate glyph `#3c4054`; presets mapped to the 4 PNGs (inert this PR). `PersonGlyph` relocated out of GameHub into Avatar (colour-accepting).

**Wired (all surfaces the Advisor listed):** GameHub OWN slot → `Avatar username={ownUsername}`; GameHub OPPONENT slot → neutral `Avatar` (no username, no avatar — **redaction guard**, opponent text label unchanged public-alias seam); ProfileHub header; main Leaderboard rows (`entry.displayName`); ProfileLeaderboard rows (`e.displayName`, same public leaderboard source — added on PM follow-up since the first pass missed it). Removed `initialsOf`/`gradientFor`/`AVATAR_GRADIENTS`/initials circle.

**Consequence flagged:** the leaderboard podium (top-3) gold/silver/bronze AVATAR tint is gone — replaced by per-username discs (required by "one avatar per user"); rank medals/numbers unaffected.

**Assets + licence:** 4 PNGs + `CREDITS.md` (licence **PENDING**) committed. Presets not surfaced to users in (i) — picker is (ii); licence must be filled before (ii) deploys.

**Verification:** full `npx vitest run` **76 files / 958 tests**; new `Avatar.test.tsx` (deterministic light disc, darkened non-white default glyph, preset img, neutral mode) + extended ProfileHub test; `tsc -b` + eslint clean. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #254. Collision-zone GameHub; PM-reviewed against acceptance (all surfaces wired, redaction guarded, non-gated behavior intact). User-facing → left for Owner review + merge + deploy. Default-glyph = same-hue-darker (Owner may veto to slate). (ii) picker+persistence + licence follow.

### 2026-07-16#4 — Blackjack: gate result bar + outlines + balance on reveal-complete (ADVISOR_TO_PM.md 2026-07-12#10)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-12#10

Shipped, **PR #252** (`fix/blackjack-reveal-gate`). Reveal collision zone: `GameHub.tsx` (shared) + `BlackjackHub.tsx` + test. No protocol/module/App.tsx change. **Balance-hold INCLUDED (came out clean).**

**One signal:** board computes `revealComplete`; gates on-board outlines AND (via opt-in `onRevealComplete()` → `gateResultOnReveal` seam) the hub bar + ribbon balance. `revealMs = nHits===0 ? CARD_ANIM_MS(550) : HIT_DEAL_START_S*1000(450) + (nHits-1)*DEAL_STAGGER_S*1000(220) + CARD_ANIM_MS(550)` — matches Advisor (550 / 1000 / 1220 / 1440). Extracted the hardcoded `0.55` into single-source `CARD_ANIM_S`; removed the now-unused `FRAME_DELAY_MS` + the board's local `useDelayedFlag`.

**Hook-safe bar gate:** `useDelayedFlag(...)` still called unconditionally (→ `ownBarVerdictBeat`); final lit = `gateResultOnReveal ? (phase==='result' && revealDone) : ownBarVerdictBeat`.

**Balance-hold:** when gated, ribbon holds pre-settlement value until `revealDone` then applies `balance`, via a `holdBalance` flag **constant-false for non-gated games** → their balance path byte-identical to old `setLiveBalance(balance)`.

**Judgment call (nice catch):** fires `onRevealComplete` only on a DECISIVE terminal (not a push), so a push mid-match can't leave `revealDone` stale-true into the next match-end (no one-frame bar flash).

**Regression guard:** only Blackjack passes `gateResultOnReveal`; full suite (Coinflip/RPS/Crash/Dice/etc.) green; #226 remount-continuity + count-hidden redaction kept green.

**Tests:** (a) 3-hit slow reveal — bar neutral until ~1440ms then bar+outlines together; (b) stand-pat — fires ~550ms after flip; (c) balance holds `1,000¢` until reveal-complete then `1,019¢`. Push-frame tests updated to `waitFor` the outline.

**Verification:** `BlackjackHub.test.tsx` 41/41; full `npx vitest run` **75 files / 951 tests**; `tsc -b` + eslint clean. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #252. Shared collision-zone file; PM-reviewed against acceptance (all met, non-gated unchanged by construction + suite). User-facing → left for Owner merge + deploy.

### 2026-07-16#3 — Heading icons nudged up 3px (ALL GAMES bolt + OPEN GAMES LIVE badge) (ADVISOR_TO_PM.md 2026-07-12#9)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-12#9

Shipped, **PR #250** (`fix/heading-icon-nudge`). Presentation-only, CSS classes only, 4 files. Additive to the earlier `leading-none` (kept).
- `HomeHub.tsx:147` — bolt `<img>`: `h-5 w-5 object-contain` → `h-5 w-5 -translate-y-[3px] object-contain`.
- `OpenGames.tsx:73` — LIVE badge `<span>`: added `-translate-y-[3px]`.
- Tests: `HomeHub.test.tsx` asserts the bolt img (scoped via `heading.parentElement?.querySelector('img[aria-hidden="true"]')`) carries `-translate-y-[3px]`; `OpenGames.test.tsx` asserts the LIVE badge (`getByText('Live')` → outer span) carries it. Existing assertions kept.

**Verification:** targeted `HomeHub`+`OpenGames` 28/28; full `npx vitest run` **75 files / 948 tests**; `tsc -b` + eslint clean. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #250. Presentation-only; PM-reviewed against acceptance. User-facing → left for Owner merge + deploy + live tune (bump to 4px if it still reads low).

### 2026-07-16#2 — Combined auth: AuthModal restyle + remove auto-resume (ADVISOR_TO_PM.md 2026-07-12#4 + #5)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-12#4 (restyle) + #5 (resume removal)

Shipped, **PR #247** (`feat/auth-restyle-no-resume`). 4 files: `AuthModal.tsx`, `App.tsx`, + both tests. User-facing behavior + presentation.

**Restyle (AuthModal.tsx):** panel `bg-card`+`border` → `bg-surface`, no rim (scrim kept); Swords removed + header hardcoded "Create an account or Login"; `title` prop dropped; subheadline deleted; tray `bg-surface` → `bg-background` (Designer C); tab "Register" → "Sign up" (state `'register'`/testid unchanged); submit gradient → `bg-brand hover:bg-brand/90` (shadow kept); disclaimer `text-muted-foreground` → `text-foreground`, copy `Play-money demo credits only, no real-money wagering.` (middot removed).

**Resume removal (App.tsx):** deleted the `onStatus('connected')` resume block (re-subscribe kept); `handleAuthSuccess` now pre-arms `setPrearmStake(intent.stake)` (feeds `initialStake` ≈1052) + keeps chess `setPendingTimeControl`, clears `pendingResumeRef`, fires nothing; deleted the `CHALLENGE_TAKEN`+`joinFallbackRef` onError fallback (general `CHALLENGE_TAKEN/SELF_TAKE/INSUFFICIENT_BALANCE` notice kept); `joinFallbackRef`/`authTitle`/`setAuthTitle`/`title`-param on `openAuth` (4 call sites) all removed (grep-clean); `wsEpoch` kept; comments updated.

**Confirmations:** (1) NO `joinQueue`/`takeChallenge` fires on connect post-sign-in (both App tests assert zero send calls); (2) hub lands with stake armed (`hub-play` enabled); (3) `joinFallbackRef`/`authTitle`/`title`/`Swords` grep-clean; (4) `wsEpoch` retained.

**Judgment calls:** applied `setPrearmStake` to BOTH play and join intents (JOIN lands armed → post-your-own, matching the Designer-approved behavior). **Chess time-control flag:** `setPendingTimeControl` is NOT a ChessHub prop — ChessHub owns its picker locally and sends the control via `onPlay`. So the captured control is NOT pre-selected after sign-in; the picker opens at its default and PLAY sends whatever it shows (stake IS armed). Pre-existing wiring, unchanged — flagged for the Advisor as a possible small follow-up.

**Verification:** targeted AuthModal+App 22/22; full `npx vitest run` **75 files / 948 tests**; `tsc -b` + eslint clean. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #247. PM-reviewed against acceptance (all met). User-facing → left for Owner merge + deploy.

### 2026-07-16#1 — Navbar Menu → reserved/greyed like Rewards/Chat (ADVISOR_TO_PM.md 2026-07-12#6 / decision B)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-12#6

Shipped, **PR #246** (`fix/navbar-menu-reserved`). Cosmetic client, 2 files (`HubToolbar.tsx` + test).
- Menu item → `<ToolbarItem label="Menu" comingSoon icon={ICON_MENU} />` (dropped `active`/`onClick`); routes through the existing `comingSoon` branch → non-button `<div>`, `opacity-40`, `aria-disabled`, no action, identical to Rewards/Chat.
- `active?: 'menu' | 'games' | 'account'` → `'games' | 'account'`; `onGames`/`onAccount` kept. Doc comment updated ("games/account wired; menu/rewards/chat reserved") + the stale `onGames` JSDoc.
- Caller check (step 4): `grep` for `active="menu"` found only the definition line itself — no external caller; `tsc -b` confirms (would've errored otherwise).
- Test: Menu now asserts reserved (`div`, `aria-disabled`, `opacity-40`); added a guard that Games/Account stay live buttons firing `onGames`/`onAccount`.

**Verification:** targeted `HubToolbar.test.tsx` 5/5; full `npx vitest run` **75 files / 946 tests**; `tsc -b` + eslint clean. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #246. Cosmetic; PM-reviewed against acceptance (all met). User-facing → left for Owner merge + deploy.

### 2026-07-14#2 — Heading alignment: leading-none on ALL GAMES + OPEN GAMES/LIVE (ADVISOR_TO_PM.md 2026-07-12#3 pts 1-2)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-12#3 (#1 + #2 only)

Shipped, **PR #243** (`fix/heading-leading-none`). Presentation-only, CSS classes only, 4 files. #3 (navbar Menu) untouched — deferred to product decision.
- `HomeHub.tsx:148` — category `<h2>` (`CAT_TITLE[cat]`): added `leading-none` (fixes ALL GAMES/ORIGINALS/CLASSICS/EVENTS at once).
- `components/hub-shared/OpenGames.tsx` `TickerHeader` — added `leading-none` to the "Open Games" `<h2>` AND the LIVE badge `<span>` (dot span / `items-center` / gaps unchanged).
- Tests: `HomeHub.test.tsx` asserts the category heading carries `leading-none` (selected via `findByRole('heading',{name:'All Games'})` — default cat, same h2 renders all); `OpenGames.test.tsx` asserts both the "Open Games" heading and the LIVE badge (`getByText('Live')` → outer span) carry `leading-none`, badge still `items-center`.

**Verification:** targeted `HomeHub`+`OpenGames` tests 28/28; full `npx vitest run` **75 files / 944 tests**; `tsc -b` + eslint clean. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #243. Presentation-only; PM-reviewed against acceptance (all met). User-facing → left for Owner merge + deploy.

### 2026-07-14#1 — Events card: new (wider) Dice Rush asset + rounded-[18px] to match hero (ADVISOR_TO_PM.md 2026-07-12#2)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-12#2

Shipped, **PR #241** (`feat/events-card-radius`). Presentation-only, 3 files.
- **Asset:** `apps/web/src/assets/events/dice-rush.webp` swapped to the Owner's new version — `git show --stat`: `Bin 101450 → 88526 bytes` (the wider 1569×848). Same path/filename, no import change. (Copied the Owner's uncommitted working-tree version into the isolated worktree first.)
- **`HomeHub.tsx` (EventsBanner img):** `className="block h-auto w-full"` → `"block h-auto w-full rounded-[18px]"`. No `overflow-hidden` (radius clips the replaced `<img>` directly, same as `HeroCarousel`'s hero imgs). `px-4` wrapper / `data-testid` / `h-auto` / `alt` unchanged.
- **`HomeHub.test.tsx`:** added `expect(events.className).toContain('rounded-[18px]')` to the Dice Rush test; all existing assertions kept.

**Verification:** targeted `HomeHub.test.tsx` 21/21; full `npx vitest run` **75 files / 942 tests**; `tsc -b` + eslint clean. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #241. Presentation-only; PM-reviewed against acceptance (all met). User-facing → left for Owner merge + deploy.

### 2026-07-13#2 — Blackjack: revert honest-reveal (#222), keep #226 — opponent count hidden again (ADVISOR_TO_PM.md 2026-07-12#1)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-12#1

Shipped, **PR #239** (`revert/blackjack-honest-reveal`). Revert of #222 (`85f5921`) across module+client+docs+tests; #226 (`e76088b`, GameHub) untouched. 6 files, +78/−266.

`git revert --no-commit 85f5921` applied. The only conflict was in **`docs/COMMS/CODER_TO_PM.md`** (append-only log #222 had appended to) — resolved by keeping HEAD (a log entry isn't reverted; the doc stays out of the diff). The four source files + `blackjack.test.ts` reverted cleanly; `BlackjackHub.test.tsx` auto-merged (the Advisor expected it to conflict — it didn't); **`GameHub.tsx` not touched.**

**Acceptance 1–5 all confirmed:**
1. `blackjack.ts` viewFor in-play opponent = `{ cards: slice(0,1), done: false }`, NO `handSize`; field removed from `Hand`; comments reverted. Data absent, not hidden.
2. `App.tsx` `BlackjackHand.handSize?` removed.
3. `BlackjackHub.tsx` single `OppHoleCard` (never changes on hits) + hole-flip-then-`oppCards.slice(2)` deal-in restored; `OppBackCard`/`oppCount`/`oppHandSize`/`useRef(revealed)`/`flipDelay`/`initial rotateY` removed; hole-under-first z-order restored.
4. Score bubble totals the redacted one-card hand only (length-1 in play); no full-hand total path in play.
5. `docs/BLACKJACK.md` reverted (invariant #2, actions/timer, viewFor bullet, reveal-choreography+stacking, one-continuous-scene). Owner-gated redaction doc.

**Payload-level module assertions added** (revert left a gap — the Advisor's explicit ask): `expect(oppHand.handSize).toBeUndefined()` + `expect(Object.keys(oppHand).sort()).toEqual(['cards','done'])`; and after-hit invariance — `viewFor(A).hands[B]` identical before vs after B hits (`expect(after).toEqual(before)`, still one card, no handSize).

**#226 kept & passing:** its decisive-terminal continuity test retained; minimal edits inside it (removed a now-dead `handSize:2` fixture that would be a tsc excess-property error; fixed a stale comment). Assertions unchanged.

**Verification:** `blackjack.test.ts` 36/36; `BlackjackHub.test.tsx` 38/38 (incl. #226 continuity); full `npx vitest run` **75 files / 942 tests**; `tsc -b` + eslint clean. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #239. PM-reviewed against acceptance (all met). Touches docs/BLACKJACK.md + is user-facing → left for Owner merge + deploy.

### 2026-07-13#1 — Events card: swap built "Coin Flip Showdown" markup for baked Dice Rush image (ADVISOR_TO_PM.md 2026-07-11#6)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-11#6

Shipped, **PR #237** (`feat/events-dice-rush-card`) — presentation-only, 3 files: `apps/web/src/screens/HomeHub.tsx`, `apps/web/src/test/HomeHub.test.tsx`, + new `apps/web/src/assets/events/dice-rush.webp` (added, `Bin 0 → 101450 bytes`, copied unmodified from the untracked main-checkout drop).

**HomeHub.tsx:** line-17 import swapped `boltDecor` → `diceRush`; `EventsBanner` body replaced with the single `<img>` exactly per spec (`px-4` wrapper kept, `data-testid="home-events"` on the img, `block h-auto w-full`, no `object-cover`). `boltDecor` grep showed only import + the one EventsBanner usage → safe to remove (clean eslint after confirms no dead import).
**HomeHub.test.tsx:** test renamed to the Dice Rush card; removed the two now-false text assertions (`Coin Flip Showdown`, `1 September 2026`); added `tagName==='IMG'` + `src` truthy/`/dice-rush/i` + `alt` `/Dice Rush/i`; kept grid-replacement + no-`$`/no-"prize pool" guards.
**jsdom src:** a throwaway probe confirmed vitest resolves the webp import to a path carrying the filename (`…/dice-rush.webp`), so the `/dice-rush/i` src assertion actually fires; `alt` is the fallback. Probe deleted.

**Verification:** targeted `HomeHub.test.tsx` 21/21; full `npx vitest run` **75 files / 947 tests**; `npx tsc -b` clean; eslint clean on both changed files. (Fresh worktree → `pnpm install --frozen-lockfile` + `pnpm run build` first.)

Ask: PR review — #237. Presentation-only; PM-reviewed against acceptance criteria (all met). User-facing → left for Owner merge + deploy.

### 2026-07-12#1 — Bot-crowd: env-gated Demo takers — allowlist + stake + taker-only roster (ADVISOR_TO_PM.md 2026-07-11#5)            [MERGED]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-11#5

Shipped, **PR #234** (`feat/bot-crowd-demo-takers`) — tools-only, `tools/bot-crowd/src/config.ts` + `bot.ts`, not shipped to Cloud Run. Merged → `main` (`a8e7f91`).

**config.ts:** hoisted `const takerOnlyGames = (process.env.TAKER_ONLY_GAMES ?? '').split(',')…` ABOVE ROSTER (next to `STAKE_SET`/`HUMAN_RESERVED_STAKE`); made ROSTER conditional reading that local const (`takerOnlyGames.length ? takerOnlyGames.map(g => ({ name: `${BOT_PREFIX}${g}-taker`, gameId:g, stake:1, policy:'taker' as const, ...(g==='chess'?{timeControlId:'rapid10'}:{}) })) : [ …26 bots unchanged… ]`); added `takerAllowNames`, `takerStake: num('TAKER_STAKE',0)`, and `takerOnlyGames` to the `config` object.
**bot.ts `tryTake()`:** extended the `.find` predicate with `(config.takerStake === 0 || c.stake === config.takerStake) && (allow.length === 0 || allow.includes(c.ownerName))`; kept the `BOT_PREFIX`/`HUMAN_RESERVED_STAKE` guards.

**Ordering deviation (PM-directed, spec was inverted):** referenced a hoisted local const instead of `config.takerOnlyGames` inside ROSTER — `config` is declared after ROSTER, so the spec's version would TDZ at load. Called out in the PR body.
**Judgment call:** used `${BOT_PREFIX}${g}-taker` not a literal `🤖` — single source of truth for the ADR-010 label, renders identically (verified `🤖coinflip-taker`).

**Verification:** `pnpm --filter @rapidclash/bot-crowd typecheck` clean; root `npx tsc -b` clean. By-hand roster smoke (tools has no test glob): WITH `TAKER_ONLY_GAMES=coinflip,blackjack,chess` → exactly 3 takers @1¢, chess carrying `rapid10`, module loads with NO ReferenceError (proves the TDZ fix); NO env → full 26-bot roster, `takerStake 0 / takerAllowNames [] / takerOnlyGames []` → predicate identical to today. (Ran `pnpm install --frozen-lockfile` + built `@rapidclash/shared` dist in the fresh worktree first — stale-dist convention, no source drift.)

Ask: none — PM-reviewed against acceptance criteria (all met), merged. Owner stands up the plan-B host on-demand via the run invocation in Advisor #5.

### 2026-07-11#7 — Header: align logo to content grid — drop leftover -ml-3 (ADVISOR_TO_PM.md 2026-07-11#4)            [OPEN]
From: Coder (recorded by PM)   Re: ADVISOR_TO_PM.md 2026-07-11#4

Shipped, branch `fix/header-logo-grid-align`. **PR #232.** Client-only, one component + its test. Confirmed the target line first (`grep -n "ml-3"` showed `HubRibbon.tsx:34` `className="-ml-3 flex items-center"`) — matches the Advisor's diagnosis, no re-diagnosis needed.

**Diff (+17/−1):**
- `apps/web/src/components/hub-chrome/HubRibbon.tsx:34` — logo button `className="-ml-3 flex items-center"` → `className="flex items-center"`. `h-8` and everything else unchanged; wallet/auth pill untouched (it has no offset of its own).
- `apps/web/src/test/HubRibbon.test.tsx` — new `describe('… logo aligned to the content grid (Advisor #4)')` block: (1) logo button className has no `-ml-3` and does have `flex items-center`; (2) inner row keeps `px-4`. All existing assertions (h-8, bg-background, pb-4, safe-area inset) untouched.

**Verification (all clean):** targeted `HubRibbon.test.tsx` 7/7 (5 pre-existing + 2 new); full `npx vitest run` **75 files / 947 tests** all pass; `npx tsc -b` exit 0; `eslint` clean on changed files.

**Judgment call:** the isolated worktree started with empty `node_modules`/no built `dist` — bootstrapped with `pnpm install --frozen-lockfile` + `pnpm run build` (per the "dist is gitignored, CI rebuilds" convention). No lockfile or source drift resulted.

Ask: PR review — #232. Implementation-only; PM-reviewed against acceptance criteria (all met), awaiting Owner merge + next deploy.

### 2026-07-11#6 — Coinflip coin: flat/unlit render, exact colours, upright bolt (ADVISOR_TO_PM.md 2026-07-11#3)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-11#3

Shipped, branch `fix/coinflip-coin-flat-unlit`. **PR #229.** Client-only visual fix in `apps/web/src/components/coin/Coin.tsx` (+ `index.css`, `Coin.test.tsx`, `three-stub.ts`). Motion/geometry untouched (`planFlip`, `easeOutCubic`, turn count, duration range, `rotateX`, camera) — materials/lights/glow/blur/bolt-orientation only.

**What changed:**
- `edgeMat`/`headsMat`/`tailsMat`: `MeshStandardMaterial` (with `metalness`/`roughness`) → `MeshBasicMaterial` (unlit). `SceneRefs` type updated.
- Removed the scene's `AmbientLight` + two `DirectionalLight`s (key + brand-purple rim) and the now-unused `brandHex` read.
- Removed `coin-glow` from the wrapper `<div>`'s className and deleted the now-orphaned `.coin-glow` utility from `index.css` (confirmed `Coin.tsx` was its only consumer).
- Removed the per-frame `canvas.style.filter = blur(...)` logic, both `'none'` resets, and the `transition: 'filter .05s linear'` inline style — plus the `lastFrameRef`/speed-calc code that only existed to drive it.

**Colour-space guard — verified necessary, not just defensive.** Read `three@0.185.1`'s actual installed source: `renderer.outputColorSpace` defaults to `SRGBColorSpace` already (confirmed at `WebGLRenderer`'s constructor), and `THREE.Color` (used for `edgeMat.color`) round-trips through that correctly on its own. But a hand-built `CanvasTexture` (used for `headsMat.map`/`tailsMat.map`) defaults to **`NoColorSpace`** — three's own doc comment says plainly "Most `map` textures set `texture.colorSpace = SRGBColorSpace`", i.e. it's the caller's job, not automatic. Without it, the canvas's sRGB pixels would be treated as already-linear and re-encoded on output, landing off the exact `--coin-heads-face`/`--coin-tails-face` hex. Added `texture.colorSpace = THREE.SRGBColorSpace` explicitly in `makeCapTexture` — this was a real fix, not belt-and-suspenders.

**Bolt-orientation fix — confidence: high, verified numerically, not guessed.** No visual render harness exists here, so instead of eyeballing a rotation I wrote a standalone script against the real installed `three` package (pure geometry/UV/camera-projection math, no WebGL/mocking needed) to compute exactly where canvas-drawn points land on screen for both caps:
1. Read `CylinderGeometry.generateCap()`'s actual source: top cap UV is `u=z/(2r)+0.5, v=x/(2r)+0.5`; the bottom cap flips the `v` sign via its own `sign=-1`.
2. Composed that with the single `geometry.rotateX(π/2)` (unchanged) and the real camera (`fov 17`, `position (0.35,0.35,8)`, `lookAt(0,0,0)`) via `THREE.Vector3.project()`.
3. Projected four asymmetric points off the real `BOLT_PATH` (top tip, bottom tip, far-left, far-right — a lightning bolt isn't symmetric, so these disambiguate both rotation direction and mirroring) through: (a) no fix, which reproduced the reported "sideways" bug; (b) `ctx.rotate(-π/2)` on the **heads** cap (`rotation.y=0`) — lands upright, correctly handed; (c) the **same** `-π/2` on the **tails** cap at `rotation.y=π` (the orientation tails actually faces the camera) — lands at **identical** screen coordinates to heads, also upright and correctly handed, **no mirror needed**; (d) as a control, added a hypothetical `ctx.scale(-1,1)` mirror to tails "to be safe" — this reproduced a backwards bolt, confirming a mirror would have been a regression, not a fix.

Why heads and tails don't need different transforms despite facing opposite directions: `CylinderGeometry`'s own cap generator already bakes a sign flip into the bottom cap's `v` formula (for it facing -Y instead of +Y in the geometry's rest frame), and that flip exactly cancels the flip animation's own 180°-around-Y rotation that brings tails to face the camera. By the time tails is actually visible, its screen mapping is identical to heads'. This is a specific, verified cancellation for this exact geometry, not an assumed general rule. `makeCapTexture` still takes a `side: 'heads' | 'tails'` param (tags the texture's `.name`, keeps call sites self-documenting, leaves a hook if a future geometry change ever does need to diverge) — but today both branches use the identical rotation, no mirror.

**Tests:** `three-stub.ts` renamed `MeshStandardMaterial` → `MeshBasicMaterial` (constructor type drops `metalness`/`roughness` so a stray prop at a call site is now a compile error); added `sceneAdded` (records every `Scene#add` call so tests can assert "no lights" without a Scene handle) and the real `SRGBColorSpace` string constant; `CanvasTexture` now tracks `.name`/`.colorSpace`. `Coin.test.tsx`: material assertions → `MeshBasicMaterial`; added tests for no lights in the scene, cap textures declaring `srgb` colour space, no `coin-glow` in the wrapper className, and no `blur()` filter ever appearing on the canvas across a full flip (previously asserted blur *did* appear — inverted). `planFlip`/`easeOutCubic`/turn-count/landing tests unchanged, still pass.

**Verification:** `pnpm exec vitest run apps/web/src/test/Coin.test.tsx` (20/20), `.../CoinflipHub.test.tsx` (33/33), full `pnpm test` from repo root (75 files / 945 tests, all passing), `npx tsc -b apps/web` clean, `eslint`/`prettier` clean on changed files. (Note: `pnpm --filter web exec vitest run <file>` intermittently mis-resolves config/setup in this environment and gave false failures on unrelated files that also fail identically on unmodified `main` — the real signal is `pnpm test` from repo root, which is green.)

Ask: none — FYI, ticket closed pending review.

### 2026-07-11#5 — GameHub: fixed the one-render idle flicker at decisive reveal (ADVISOR_TO_PM.md 2026-07-11#2)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-11#2

Shipped in one PR, branch `fix/gamehub-phase-bridge-flicker`. **PR #226.** Shared/core file (`GameHub.tsx`'s `phase` derivation) — flagged for careful review in the PR description per the brief.

**Root cause, re-verified myself against the code (not just trusted the ticket):** `phase` was derived directly from `overlay`/`resultPending`, both only set by the `[currentMatchId, lastOutcome, lastSettlement, gameState, holdResultMs]` effect, which fires one render *after* `currentMatchId` first flips to `null` (effects run post-commit). On that gap render both are stale/falsy, so the formula fell through to `'idle'` — unmounting any board that only mounts on `'in-match'`/`'result'` (Blackjack's), so every card (own included) replayed its mount animation instead of transitioning in place.

**App-render timing premise — confirmed, no discrepancy found.** Read `App.tsx`'s `onMatchEnd` handler directly: it calls `setLastOutcome`, `setLastSettlement`, `setBalance`, and `setCurrentMatchId(null)` all synchronously in one handler invocation, so React batches them into one render — `lastOutcome`/`lastSettlement` are already fresh on the exact render `currentMatchId` goes null. Matches the PM's independent verification exactly. **No `App.tsx` change made.**

**Fix (`GameHub.tsx`):** bridged the gap off `lastOutcome`/`lastSettlement` (ordinary props, not effect-derived):
```ts
const hasFreshResult = lastOutcome != null && lastSettlement != null;
const phase: Phase = overlay ? 'result'
  : resultPending ? 'in-match'
  : (currentMatchId && !holdSearch) ? 'in-match'
  : (currentMatchId || waiting) ? 'waiting'
  : hasFreshResult ? (holdResultMs && holdResultMs > 0 ? 'in-match' : 'result')
  : 'idle';
```
Only fires in the exact one-render window (all four earlier signals falsy AND a fresh result exists); the instant the effect catches up, the earlier branches take over and this stops competing.

**Dismiss path traced, not assumed:** `dismissResult` (GameHub) + `onResultDismiss` → App's `handleHubResultDismiss` clears `lastOutcome`/`lastSettlement` in the same batch → `hasFreshResult` correctly goes false → phase falls to `'idle'` normally. For opt-out games (Blackjack, `suppressResultOverlay`), the result phase persists until a new match starts (earlier `currentMatchId` branch wins) or `resetRoundState` wipes the result on the next PLAY/leave (round-scoped-state invariant) — consistent either way.

**Open Games `joinDisabled` (`phase === 'in-match' || 'waiting'`) — reasoned through, no regression:** for non-`holdResultMs` games the bridge resolves straight to `'result'` on the gap render (same as the post-effect render, just one render earlier) — `joinDisabled` unaffected. For `holdResultMs` games (Coinflip/Baccarat/Dice) the bridge now reads `'in-match'` on that gap render instead of a stray `'idle'` blip — this actually *closes* a related latent gap (Open Games briefly allowing a join mid-reveal), not a new one. No other hub's phase-dependent logic is reachable by the new branch since it only supersedes the previous `'idle'` fallback.

**Test (regression guard):** extended `BlackjackHub.test.tsx` (the shared vehicle already used for the push-path "key continuity" test) with a new test exercising the REAL decisive-terminal flow — `currentMatchId` genuinely transitions from `'m1'` to `null` in the same rerender that delivers `lastOutcome`/`lastSettlement` (the existing push-path and honest-reveal tests all deliberately hold `currentMatchId` constant, so none of them hit this bug). Asserts both the own-hand and opponent-hand first cards keep exact DOM identity (`toBe`) across the transition. **Verified the guard property directly**: `git stash`'d the `GameHub.tsx` fix, reran the new test — failed, specifically on the own-card identity check (matching the bug's "even your own cards fly in" tell); reapplied the fix — passed. No stash artifacts left behind.

Results: `npx vitest run apps/web/src/test/BlackjackHub.test.tsx` — 42/42 passing; full `npx vitest run` — **75 files / 942 tests passing**; `npx tsc -b` clean; `npx eslint --ext .ts,.tsx packages apps` clean.

Ask: PR review — #226, `fix(hub): bridge GameHub's one-render idle flicker at decisive reveal (Advisor #2, shared)`. Shared collision-zone file; please review the phase-formula diff carefully as flagged.

### 2026-07-11#4 — Blackjack: honest reveal — face-down backs in play, flip in place (Advisor #1)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-11#1

Shipped in one PR spanning module + client + docs, branch `feat/blackjack-honest-reveal`. **PR #222.**

**Process note first:** the ticket told me to read `ADVISOR_TO_PM.md` 2026-07-11#1 in full as "the complete authoritative spec." That exact dated entry is **not present** in `ADVISOR_TO_PM.md` on `main` as of this PR (latest entry there is 2026-07-10#4; a repo-wide grep for "2026-07-11" and "blackjack" turned up nothing in that file). The full spec text was supplied directly in my task brief instead, so I implemented from that (it read as complete and internally consistent — exact code snippets, done-when criteria, verbatim doc text). Flagging so the Advisor/PM can reconcile — either the doc entry still needs to land, or this was dispatched before the doc commit landed.

1. **`packages/games/blackjack/src/blackjack.ts`** — added `Hand.handSize?: number`, set only on `viewFor`'s in-play OPPONENT branch (`{ cards: cards.slice(0,1), done: false, handSize: cards.length }`); own-hand and terminal branches leave it unset. Updated the two now-stale comments (`applyMove`: "broadcast nothing" → "nothing about VALUES/status; size is the one exception"; `viewFor`: "hit count hidden" → "size surfaced, values/status/seed still hidden"). Verified `apps/server/src/ws/gateway.ts`'s `move.make` handler (not assumed) — it already loops both players and sends each `mod.viewFor(result.state, pid)` on every move, so the new field reaches both clients with zero protocol/gateway change.
2. **`apps/web/src/App.tsx`** — mirrored `BlackjackHand.handSize?: number`.
3. **`apps/web/src/screens/BlackjackHub.tsx`** — generalized the hardcoded single `OppHoleCard` (always index 1) into `OppBackCard`, rendered `oppCount - 1` times (`oppCount` = `handSize` in play, `oppCards.length` once revealed — see judgment call below). Deleted the old `{revealed && oppCards.slice(2).map(...)}` fly-in branch outright. Retired the old "hole card sits under the first card" z-order exception — every slot (hidden or revealed) now uses the same ascending `CARD_Z_BASE + index` fan.
4. **The subtle bit (Part 2 point 5):** distinguishing "a back already on the table, now flipping in place" from "a slot that only exists in the terminal frame" (the one atomic resolving/busting hit, never broadcast live). Solved with a ref captured once at mount — `useRef(revealed)` only reads its argument on first render, so it's the exact signal for "was this slot ever rendered face-down before." A slot minted already-revealed gets a `0.5s` delay before its flip starts (so its entrance slide visibly lands first) and an explicit `initial={{ rotateY: 180 }}` on the flip element — I'd verified empirically in jsdom that omitting `initial` makes a fresh mount render **already at the open target with no transform at all** on its first paint, i.e. already face-up, which is exactly the bug being fixed. A slot that was already a back during play keeps `flipDelay=0` and flips immediately on the same re-render (no remount, same key).
5. **`docs/BLACKJACK.md`** — updated invariant #2, the actions/timer line, the `viewFor` mapping bullet, the reveal-choreography paragraph + its stacking note, and the "one continuous scene" acceptance paragraph, all per the Advisor's supplied wording (adapted lightly for fit). **`docs/SCREENS.md`** — checked; it only cross-references `BLACKJACK.md` by name with no choreography detail of its own, so no change needed there (per the ticket's own fallback instruction).
6. **Tests** — `blackjack.test.ts`: new cases proving in-play `handSize` equals the true count while `cards.length===1`/`done===false`/no `seed`; a hit bumps `handSize` without exposing the new value; terminal reveal unchanged. `BlackjackHub.test.tsx`: slot count matches `handSize`; a hit adds exactly one new back (not a value); a back already on the table survives the reveal as the literal same DOM node (proves the fly-in path is gone); a terminal-only slot slides in closed then flips — verified this last one against real jsdom `style.transform` output (not just code inspection), timed so an already-open interpolation is distinguishable from a still-closed one; replaced the now-false "sits under" z-order test with one asserting the new standard-ascending order.

**Judgment calls:**
- `oppCount`'s literal spec formula (`handSize ?? oppCards.length`) assumes `handSize` is absent at both terminal *and* push — true at terminal, false at push (the live `view` during a push hold is already the freshly re-dealt NEXT round, which itself carries a `handSize` — for the wrong round). Fixed by branching explicitly on `revealed` first.
- Found a **pre-existing, unrelated GameHub quirk** while writing the identity-continuity tests: transitioning `currentMatchId` from a match id straight to `null` in the same render as delivering `lastOutcome`/`lastSettlement` causes one intermediate `phase:'idle'` render (the result overlay is set one tick later via an effect), which unmounts/remounts the whole board. Not something this ticket should fix (out of scope), but it means any test (or real flow) asserting DOM-identity continuity across a decisive terminal reveal needs to keep `currentMatchId` constant through that transition, exactly like the pre-existing "key continuity" push test already does. Flagging in case it bites a future ticket.
- Noticed `apps/web/src/screens/BlackjackPlay.tsx` (+ its test) still exists and still does the old single-hole-card redaction, but it's dead — `blackjack` is in `HUB_GAMES` so it always routes to `BlackjackHubScreen`, never the generic `'play'` screen (same situation as the already-removed `CoinflipPlayScreen`). Left untouched, out of scope; candidate for its own small cleanup PR.

Results: `npx vitest run packages/games/blackjack/src/blackjack.test.ts` — 37/37 passing; `npx vitest run apps/web/src/test/BlackjackHub.test.tsx` — 41/41 passing; full `npx vitest run` — **75 files / 941 tests passing**; `npx tsc -b` clean; `npm run lint` clean.

Ask: PR review — #222, `feat(blackjack): honest reveal — face-down backs in play, flip in place (Advisor #1)`. Also please reconcile the missing `ADVISOR_TO_PM.md` 2026-07-11#1 entry (see process note above).

### 2026-07-11#3 — Coinflip coin: −10% so it clears the countdown ring (ADVISOR_TO_PM.md #4)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-10#4

Shipped in one PR, branch `fix/coinflip-coin-ring-clearance`. **PR #219.** Genuine single-constant one-liner, verified against the actual code first: `CoinflipHub.tsx`'s `COIN_SIZE_PX` was `240`, and `CountdownRing` is indeed pinned `absolute left-3` on the board — confirms the Advisor's overlap diagnosis on narrow phone-width boards.

1. **`CoinflipHub.tsx`** — `COIN_SIZE_PX` `240` → **`216`** (the Owner's ~10%). Also extended the existing history comment above the constant with a short "RING-CLEARANCE FIX" note (same style as the prior #212/#215 regression comments already there) so the rationale for 216 stays documented alongside the earlier 420→240 history; the constant itself is the only functional change.
2. Left everything else exactly as-is per the brief: `min-h-[260px]`, `fov 17` in `Coin.tsx`, `shrink-0`, colours/glow/material de-dull untouched.

Grepped `Coin.test.tsx`/`CoinflipHub.test.tsx` first — no test asserted the old `240` value, so no test changes were needed.

Results: `npm run test` — **75 files / 935 tests passing**; `npx tsc -b` clean; `npx eslint --ext .ts,.tsx packages apps` clean.

Note on process: while working, a concurrent branch switch + fast-forward pull landed in this same working directory between my `checkout -b` and my `commit`, which briefly put my commit directly on local `main` (not pushed). Caught it before pushing — reset local `main` back to `origin/main` and moved the commit onto `fix/coinflip-coin-ring-clearance` before pushing/opening the PR. Final state: `main` untouched relative to `origin/main`; the fix lives only on the feature branch.

Ask: PR review — #219, `fix(coinflip): coin size -10% for pick-ring clearance (Advisor #4)`.

### 2026-07-11#2 — RECOVERED: header logo step-down + solid full-width bg + below-header gap (Advisor #7)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-09#7

Shipped in one PR, branch `fix/header-logo-bg-gap`, client-only, one component + its test. **PR #217.**

This ticket had already been implemented by a prior Programmer agent whose process was killed/crashed before it could commit or open a PR — the work survived only as uncommitted changes sitting in its worktree (`.claude/worktrees/agent-a63cedeb87a1ad50a`). I was spawned to recover and ship it, not to redo it from scratch.

1. **Verified the recovered diff against the spec** line-by-line before touching anything: `HubRibbon.tsx`'s `<img>` `h-10`→`h-8`; the header restructured into an outer full-width `<header className="sticky top-0 z-20 w-full bg-background pt-[env(safe-area-inset-top)]">` wrapping an inner `<div className="mx-auto flex w-full max-w-md items-center justify-between px-4 pb-4">` row; `pb-4` added on that inner row. This matches the Advisor's spec's illustrative code block exactly (including using `pb-4`, not the alternative `pb-6`). No corrections needed — the crashed agent's work was complete and correct.
2. **`HubRibbon.test.tsx`** was already updated to match by the same agent: logo asserts `h-8` (not `h-10`/`h-24`); a new describe block asserts the outer header carries `bg-background`/`w-full` and does NOT carry `bg-transparent`/`max-w-md`; the inner row asserts `max-w-md` and `pb-4`. Left as-is.
3. **Staleness**: the worktree's branch was 9 commits behind `origin/main` (dead agent started before several coinflip-coin and snapshot-fix PRs landed). Fast-forward merged `origin/main` in — no conflicts, since nothing that landed in between touches `HubRibbon.tsx` or its test.

Results: `npx tsc -b` clean; `npx eslint --ext .ts,.tsx packages apps` clean; full suite `npx vitest run` — **75 files / 935 tests passing** (including `HubRibbon.test.tsx`, 5/5). No scope creep — only `HubRibbon.tsx` + `HubRibbon.test.tsx` touched, plus the routine merge-in of `main`.

Ask: PR review — #217, `fix(hub): header logo step-down + solid full-width bg + below-header gap (Advisor #7)`.

### 2026-07-11#1 — REGRESSION FIX: coinflip oversized coin box — portrait blowup + ellipse (ADVISOR_TO_PM.md #3)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-10#3

Shipped in one PR, branch `fix/coinflip-coin-size-regression`. **PR #215.** Sizing only — verified against the actual deployed-broken code first (per the "reproduce before changing behaviour" rule): #212 did set `COIN_SIZE_PX = 420` + both containers to `min-h-[440px]`, and `Coin.tsx`'s wrapper `<div>` does size both width AND height to `size` via `style={{ width: size, height: size }}` — confirmed the Advisor's diagnosis exactly (420px coin box > ~390px phone panel width → flexbox shrinks the box's width but not its height → non-square box → the fixed-aspect-1 `PerspectiveCamera(17, 1, ...)` render stretches into a vertical ellipse; the 420-tall box + `min-h-[440px]` also pushed PLAY/bet controls off-screen on a phone viewport).

1. **`CoinflipHub.tsx`** — `COIN_SIZE_PX` `420`→**`240`**. Left `fov 17` in `Coin.tsx` completely untouched (that framing is correct, from #212) — at the same ~90% canvas-fill ratio, 240px renders a visible coin of roughly ~215-220px: well within the ~390px panel width (so the box can never be squeezed non-square) and much bigger than the pre-#212 ~93px original complaint, while keeping the board compact enough that header + both player bars + coin + PLAY + bet row fit one phone screen.
2. Both `min-h-[440px]` occurrences (`CoinflipIdle` hero, `CoinflipBoard` in-match) → **`min-h-[260px]`**, restoring an honest floor for the new 240px size (both containers still `flex … items-center justify-center`, no `overflow-hidden`, so this is a floor not a ceiling as before).
3. **`Coin.tsx`** — wrapper `<div>` className `cn('coin-glow block', className)` → `cn('coin-glow block shrink-0', className)`. Belt-and-suspenders per spec: prevents flexbox from ever shrinking the box's width independently of its height again, so the render can't go non-square even if `COIN_SIZE_PX` is bumped again later. Not strictly load-bearing at 240 (already narrower than the panel) but cheap insurance against this exact bug class.

Diff is exactly these three lines (two `CoinflipHub.tsx` values, one `Coin.tsx` class) — nothing else touched. `CylinderGeometry`, `rotateX`, `planFlip`/`easeOutCubic`, the flip animation, camera `fov`, `metalness`/`roughness`, `.coin-glow` gradient, and all color tokens from #212 are unchanged.

Grepped `Coin.test.tsx`/`CoinflipHub.test.tsx` first — no test asserted the old `COIN_SIZE_PX`, the old `min-h-[440px]`, or the wrapper's className, so nothing needed updating.

Results: `npx vitest run` — **75 files / 932 tests passing**; `npx tsc -b` clean; `eslint --ext .ts,.tsx packages apps` clean; `cd apps/web && npx vite build` succeeds (same pre-existing >500kB chunk warning, unrelated). No headless-browser screenshot verification possible in this sandbox (no Chromium deps — same known limitation as prior coin tickets); verified the fix structurally instead (traced the flex/box-sizing chain by hand against the actual JSX/CSS).

Ask: PR review — #215, `fix(coinflip): coin size regression — portrait blowup + ellipse (Advisor #3)`.

### 2026-07-10#4 — Coinflip coin polish v2: exact tails hex + real size + de-dull (Designer, ADVISOR_TO_PM.md #2)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-10#2

Shipped in one PR, branch `fix/coinflip-coin-polish-v2`. **PR #212.** Camera framing + material params + one CSS token + a size number — no `CylinderGeometry`, `rotateX`, `planFlip`/`easeOutCubic`, turn counts, duration, or vertical-axis change, as scoped.

1. **Tails hex, exact.** `apps/web/src/index.css` — both `:root` and `.dark`: `--coin-tails-face` `#5956f6`→`#556ef6` (the Designer's exact spec), `--coin-tails-mark` retuned darker `#5351e2`→`#3f52d6`. This deliberately DE-COUPLES `--coin-tails-face` from `--card-back`, which stays `#5956f6` — did not "fix" it back to match, per the spec's explicit call. `--coin-heads-face`/`--coin-heads-mark`/`--coin-edge` untouched. Updated the token comment.
2. **Real size — two coupled levers, `Coin.tsx`.** Camera `fov` `30`→`17` (same `z=8`, same `(0.35, 0.35)` tilt — a telephoto zoom, not a geometry/perspective change) so the coin fills ~90% of its canvas instead of ~47%. Synced the `readColorToken` fallback hexes (`--coin-tails-face`→`#556EF6`, `--coin-tails-mark`→`#3F52D6`) so no-CSS/test environments match. Then `CoinflipHub.tsx`: `COIN_SIZE_PX` `200`→**`420`** — paired with the fov drop, a 420px canvas renders a VISIBLE coin of ~378-385px, landing on the Designer's ~385px target.
3. **De-dull.** Cap materials (`headsMat`/`tailsMat`) `metalness` `0.55`/`0.6`→**`0.15`** (both), `roughness`→**`0.4`** (both, up from 0.34/0.3) — the flat orange/blue now reads vivid instead of muted/dark (a metallic surface with no environment map renders dull, which was the root cause). Left the edge material closer to where it was (`metalness` `0.5`→`0.45`, barely moved) so the curved rim still catches the light band, per the spec's "touch metallic" instruction. Did NOT add an environment map/reflective sheen — spec explicitly flagged that as optional/Designer's-call-only and out of this ticket's "done when."
4. **Glow halo.** Added a `.coin-glow` utility class (`index.css`, `@layer utilities`) on the coin's wrapper `<div data-testid="coin-face">` — a CSS `radial-gradient` using `color-mix(in srgb, var(--coin-heads-face) 28%, transparent) 0%, transparent 70%`, zero 3D/render cost (shows through the canvas's already-transparent clear colour). **Judgment call**: checked for precedent first — every existing `radial-gradient` glow in this codebase (`Wallet.tsx`, `ChessPlay.tsx`, `Auth.tsx`, etc.) uses a hardcoded `rgba(...)` literal, none combine a CSS custom property with alpha. Since `--coin-heads-face` is a raw hex literal (not an HSL triple like most other tokens — see `--card-back` for the same pattern), I used `color-mix()` rather than the spec's illustrative `hsl(var(...)/a)` idiom — CSS-native, no JS hex-parsing needed, token stays the single source of truth.
5. **Container floor.** Bumped both coin containers' `min-h-[200px]`→`min-h-[440px]` in `CoinflipHub.tsx`. Verified empirically (read the actual JSX/classNames, not assumed) that neither container nor its `rounded-2xl bg-surface p-4` parent has `overflow-hidden` or a fixed height — a taller child was never going to clip, flex just grows to fit — but the stale 200px number no longer reflected an honest floor for the new 420px size, so updated it anyway.

No test asserted the old tails hex, fov, metalness, `COIN_SIZE_PX`, or the old `min-h-[200px]` — grepped `Coin.test.tsx`/`CoinflipHub.test.tsx` to confirm before editing; nothing needed updating.

Results: `npx vitest run` — **75 files / 932 tests passing**; `npx tsc -b` clean; `eslint --ext .ts,.tsx packages apps` clean; `vite build` succeeds (same pre-existing >500kB chunk warning, unrelated). No headless-browser screenshot verification possible in this sandbox (no working Chromium deps — a known prior limitation, not fixed here, out of this ticket's scope).

Ask: PR review — #212, `fix(coinflip): coin polish v2 — exact tails hex, real size, de-dull (Designer)`.

### 2026-07-10#3 — Coinflip coin: reverted to orange/blue + bigger size (Designer, ADVISOR_TO_PM.md #5)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-09#5

Shipped in one PR, branch `fix/coinflip-coin-orange-blue-size`. **PR #209.** Pure tokens + fallback-constants + a size prop — no Three.js geometry/material/lighting/flip change, as scoped.

1. **Tokens.** `apps/web/src/index.css` — both the `:root` and `.dark` coin blocks (previously identical) reverted gold/silver → orange/blue: `--coin-heads-face` `#e8b84b`→`#f2a63b`, `--coin-heads-mark` `#b8923d`→`#c8761f`, `--coin-tails-face` `#c9cdd6`→`#5956f6` (now the same hex as `--card-back`, so the coin and card backs share one blue token value — not a shared variable, just the same literal, matching the existing pattern where both are defined independently), `--coin-tails-mark` `#9ca1ac`→`#5351e2`, `--coin-edge` `#b9905a`→`#ed742f`. The shared single-edge-colour judgment call from #204 (one `--coin-edge` regardless of face, since the cylinder physically has one continuous side surface) carries forward unchanged — this ticket only swapped the hex values, not the token shape. Comment block updated to describe orange/blue instead of gold/silver.
2. **`Coin.tsx`.** Synced the five `readColorToken(name, fallback)` fallback hex literals to the new orange/blue values. Left the local variable names (`goldHex`, `silverHex`, etc.) as-is — ticket scoped this to "fallback string literals only," and renaming would have touched more of the file than asked; flagging in case the Advisor wants a follow-up rename for naming hygiene, but the fallbacks are dead code in the running app (real CSS always loads) so it's cosmetic either way.
3. **`CoinflipHub.tsx`.** Added `COIN_SIZE_PX = 200` (a local const, same pattern as `PICK_SECONDS`/`HOLD_RESULT_MS`) and passed it to both `<Coin />` call sites (`CoinflipIdle` hero, `CoinflipBoard` in-match), replacing the implicit `size=128` default. Chose 200 per the spec's own suggestion (~half the `max-w-md` panel width, ~448px). Verified both containers: `min-h-[200px]` is a floor, not a fixed height, and both already `flex … items-center justify-center`, so the larger coin doesn't clip and stays centered — no layout edit needed beyond the two `size=` props.

**Verification note:** attempted a live-render screenshot (built + ran the server + `vite` dev server, tried to drive headless Chromium via Playwright) to visually confirm the new colours/size in the browser, but the sandbox has no system `libnspr4`/`libnss3` and no root/sudo to install them (`apt-get install` fails: dpkg lock permission denied) — genuinely blocked at the environment level, not something in this ticket's scope to fix. Fell back to the full automated test suite instead, which does exercise the changed code paths directly (`Coin.test.tsx` renders the real component and asserts on its materials/geometry/disposal; `CoinflipHub.test.tsx` renders both `<Coin>` call sites through the hub). Flagging for the Advisor/Owner in case a `/run-skill-generator` pass to fix the Chromium deps is worth doing for future visual-diff tickets.

Results: `npx vitest run` — **75 files / 928 tests passing**; `npx tsc -b` clean; `eslint --ext .ts,.tsx packages apps` clean. No existing test asserted the old hex values or the old default `size=128`, so nothing needed updating for that (grepped `Coin.test.tsx` and `CoinflipHub.test.tsx` to confirm — neither hardcodes the coin's hex or default size).

Ask: PR review — #209, `fix(coinflip): revert coin to orange/blue + larger size (Designer)`.

### 2026-07-10#2 — INCIDENT FIX: atomic SQLite snapshot via backup-to-temp-file (ADR-011)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-09#6

Shipped in one PR, branch `fix/atomic-snapshot-upload`, server-only. **PR #207.**

Root cause confirmed against the actual code (matching the Advisor's diagnosis): `apps/server/src/persistence/snapshot.ts`'s `doUpload()` called `gcs.bucket(bucket).upload(opts.dbPath, ...)` directly against the **live** SQLite file while the event loop kept serving other requests — including settlement writes — during the upload's network I/O. `--max-instances=1` rules out concurrent writers, not a write landing mid-upload; the header comment's claim that "a plain file copy ... is consistent between transactions" was false, and that false assumption is what tore the file in the production incident.

1. **`snapshot.ts:doUpload()`** — now snapshots the live DB into a fixed-name temp file (`${dbPath}.snapshot-tmp`) via a newly-injected `snapshot(dest): Promise<void>` option *before* ever touching GCS, uploads that temp file (never `opts.dbPath` directly), then unlinks it in a `finally` — cleanup runs whether the snapshot step, the upload, both, or neither failed. `restore()` and the debounce/coalescing logic in `schedule()`/`runUpload()` are untouched, per the ticket's scope.
2. **Mechanism: `db.backup()`, not `VACUUM INTO`** — per the spec's stated preference. Verified directly against the installed package (`node_modules/better-sqlite3/lib/methods/backup.js` + `@types/better-sqlite3`): `Database.prototype.backup(destinationFile, options?): Promise<BackupMetadata>` copies pages under the engine's own locking (safe under concurrent writes on the live handle) and only needs the destination directory to exist (always true — same directory as `dbPath`). Wired in cleanly as a single injected closure, so there was no reason to fall back to `VACUUM INTO`.
3. **`SnapshotterOptions`** gained one new optional field, `snapshot?: (dest: string) => Promise<void>`, documented as production-wired to `db.backup(dest)`. The disabled (`GCS_BUCKET` unset) no-op path is completely untouched — still zero `better-sqlite3`/GCS calls.
4. **`index.ts` wiring wrinkle** (the one non-trivial part, exactly as the ticket flagged): `createSnapshotter(...)` is still constructed — and `restore()` still called — *before* `db` exists, since restore has to land the file on disk first. Rather than add a second-phase setter/`attachDb` method to the `Snapshotter` interface, I wired `snapshot` as a closure over a `let db: Database.Database` binding declared just above the `createSnapshotter(...)` call and assigned right after `restore()` resolves: `snapshot: async (dest) => { await db.backup(dest); }`. This is safe because `snapshot` is only ever invoked from `doUpload()`, which only runs after a debounced `trigger()` following a settlement — i.e. well after `db` is assigned a few lines down — so there's no window where the closure could read `db` before it's set. Judgment call: this is a smaller diff than adding an `attachDb()`/setter method to the `Snapshotter` interface and needed no change to the interface's public shape beyond the one new `snapshot` field the spec already asked for. Needed one `eslint-disable-next-line prefer-const` on the `let db` declaration since ESLint can't see the split declare-then-assign is intentional.
5. **Header comment** — replaced the false "a plain file copy ... is consistent between transactions" line with an accurate description of the torn-file failure mode and why the atomic temp-file step now exists.
6. **Tests** (`snapshot.test.ts`) — kept the existing `mockStorage()`/`storageFactory` idiom; added a matching `mockSnapshot()` helper and threaded a `snapshot` mock through every existing enabled-path test (debounce, coalescing, re-arm, flush, real-settlement wiring via `createServices`), updated the upload-args assertion to expect the temp path instead of the live `dbPath`, and mocked `node:fs/promises`'s `unlink` to assert cleanup. Added a new describe block, `snapshotter — atomic snapshot-to-temp-file upload (incident fix, ADR-011)`, covering: `snapshot()` called with the temp path before the GCS upload and the live path is never the upload target; temp file unlinked after a successful upload; temp file unlinked even when the GCS upload itself fails (existing "failed upload must not crash the server" contract preserved); GCS upload never called when the snapshot-to-temp-file step itself fails.

Results: `snapshot.test.ts` 16/16 passing; full suite `npx vitest run` — **75 files / 932 tests passing**; `tsc -b` clean; `eslint --ext .ts,.tsx apps/server/src` clean.

No deviations from the ticket's scope — only `snapshot.ts`, `snapshot.test.ts`, and the minimal wiring in `index.ts` touched; `restore()` untouched; ADR-011_persistence.md untouched (implementation-only per the Advisor). Ops insurance item from the Advisor's message (enable GCS object versioning on `rapidclash-snapshots-847070222251`) is a `gcloud` action for the Owner/PM, not code — flagging here so it isn't dropped.

Ask: PR review — #207, `fix(server): atomic SQLite snapshot via backup-to-temp-file (ADR-011 incident fix)`.

### 2026-07-10#1 — Coinflip coin rebuild: 3D cylinder, vertical flip, gold/silver (COINFLIP_COIN.md)            [OPEN]
From: Coder   Re: docs/COINFLIP_COIN.md (Owner-approved all 3 flags, 2026-07-09)

Shipped in one PR, branch `feat/coinflip-3d-coin`. **PR #204.**

Replaces the flat `scaleX`-squash SVG coin with a real Three.js cylinder spinning on the **vertical (Y) axis**, landing on the server-decided face — matches the geometry/materials/lighting/flip math from the approved reference prototype (`docs/design-refs/coinflip/coinflip-prototype-vertical.html`). Purely presentational (CHARTER invariant #2 untouched) — server still decides the outcome via the `face` prop.

1. **Component.** `apps/web/src/components/coin/FlatCoin.tsx` → renamed `Coin.tsx` (export `FlatCoin` → `Coin`, spec explicitly allowed this). `CylinderGeometry(1, 1, 0.26, 96)` rotated onto its side, materials `[edge, headsCap, tailsCap]`, ambient + white key + brand-purple rim lighting (`--brand-purple` token read via `getComputedStyle`, never hardcoded), tone-on-tone `BOLT_PATH` stamped on each cap via a small offscreen-canvas texture (`Path2D` fill), 5–7 turn ease-out-cubic flip (random turn count + random ~1.8–2.4s duration per flip) with CSS `blur()` motion tracking scaled to angular velocity, `prefers-reduced-motion` short single-turn settle, full WebGL disposal (geometry/materials/textures/renderer) on unmount. Flip math split into pure, directly-testable `planFlip`/`easeOutCubic` exports.
2. **Tokens.** `apps/web/src/index.css` — `--coin-heads-face`/`--coin-tails-face` orange/blue → gold `#e8b84b`/silver `#c9cdd6`; `-mark` (tone-on-tone bolt) re-tuned to match. **Judgment call**: the old per-face `-edge` tokens collapse into one shared `--coin-edge` — a real cylinder has exactly ONE continuous side surface, so it physically cannot show two different edge colours without recolouring mid-spin (the spec forbids that). The H/T pick pills in `CoinflipHub.tsx` read `.face` off the same tokens, so they picked up gold/silver automatically — no pill-specific edit needed.
3. **`CoinflipHub.tsx`.** Import/JSX rename only (`FlatCoin`→`Coin`, 3 lines), plus **`HOLD_RESULT_MS` 1500→2600** (judgment call, explicitly flagged by the spec doc itself as something to "verify... may need a small bump" — with the flip now running up to ~2.4s the win/lose bar would otherwise light before the coin visually lands). Left the shared, cross-game `DRAW_REMATCH_HOLD_MS` (2000ms, `GameHub.tsx`) untouched — it's generic core-hub timing used by every game, and bumping it just for coinflip felt like exactly the "leak a per-game concern into core" the module-interface doc warns against; the same-side-draw flip may occasionally finish its visual settle a beat after the shared amber outline clears (minor, accepted).
4. **Dependency.** `three@^0.185.1` + `@types/three` added to `apps/web/package.json` (pnpm install run, lockfile updated).
5. **Tests** — the trickiest part, per the ticket: jsdom has no real WebGL context, so `THREE.WebGLRenderer` throws under test. Added `apps/web/src/test/three-stub.ts`, a hand-rolled `three` replacement (`vi.mock('three', ...)`, same pattern as the existing `canvas-confetti` mock) that runs the component's real logic (materials/geometry construction, rotation, disposal) against plain JS objects instead of a GPU. Rewrote `FlatCoin.test.tsx` → `Coin.test.tsx`: resting state (perfect circle, no running render loop), cylinder/material structure, token resolution (mocked `getComputedStyle` proves colours are read at runtime, never hardcoded), full disposal on unmount, and — via a controllable fake `requestAnimationFrame`/`performance.now()` clock local to that file — the full flip (lands on the correct face, motion blur tracks speed, never recolours across two different flips, reduced motion). Turn-count variance / exact landing angle / ease-out shape are unit-tested directly against the pure `planFlip`/`easeOutCubic` exports, no live Three.js needed for that layer. `CoinflipHub.test.tsx` / `App.test.tsx` / `auto-searching.app.test.tsx` (the three places that render the Coinflip hub through jsdom) now mock `three` and force `prefers-reduced-motion` so the coin settles fast wherever it renders in those broader suites.

Two debugging-worthy findings that shaped the fix (worth flagging for anyone touching rAF-driven animation under jsdom again): jsdom's real `requestAnimationFrame` callback timestamp is **not consistent with `performance.now()`** (can even run behind it) — `Coin.tsx`'s tick loop now reads `performance.now()` itself rather than trusting the callback argument, which is more correct in general, not just for tests. And once **any** test in a file toggles `vi.useFakeTimers()`/`vi.useRealTimers()`, jsdom's native `requestAnimationFrame` silently stops invoking its callback at all for the rest of that file — would have hung any later real-timer flip forever. Fixed by having each affected test file stub its own tiny `setTimeout`-based `requestAnimationFrame`/`cancelAnimationFrame` per test, sidestepping jsdom's implementation entirely.

Results: full suite `npx vitest run` — **928/928 passing across 75 files** (re-ran 3x to confirm no flakiness); `tsc -b` clean; `eslint --ext .ts,.tsx packages apps` clean; `vite build` (apps/web) succeeds (main chunk grows to ~325 KB gzip, consistent with the Owner-approved three.js bump). Also confirmed the tile thumbnail (`assets/games/coinflip.webp`) is a plain static `<img>` import in `tiles.ts`/`GameList.tsx` — never touches `Coin`, no live-WebGL-in-the-tile risk.

Ask: PR review — #204, `feat(coinflip): 3D cylinder coin — vertical-axis flip, gold/silver (COINFLIP_COIN.md)`.

### 2026-07-09#4 — Header logo height: tight-cropped wordmark + h-24→h-10 (Advisor #2)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-09#2

Shipped in one PR, branch `fix/header-logo-height`, client-only, one component + one asset. **PR #199.**

Root cause (confirmed against the code, matching the Advisor's diagnosis): no doubled safe-area, no extra top padding to remove — `HubRibbon.tsx`'s header already has a single `pt-[env(safe-area-inset-top)]` and `layout.ts`/`HUB_BODY` has no top pad. The actual cause was the logo asset: `<img class="h-24 …">` = a 96px box, but the wordmark webp had ~61% vertical transparent padding baked in, so most of the box was empty space above the visible mark.

1. **Asset.** `apps/web/src/assets/brand/rapidclash-wordmark.webp` replaced with the Owner-approved tight-cropped version — verified actual dimensions via `PIL.Image.open(...).size` = **(473, 109)**, matching the spec exactly. Committed alongside the code change (was staged uncommitted on disk).
2. **Code.** `HubRibbon.tsx:28` — `<img>` class `h-24` → `h-10`. Header box shrinks 96px → 40px; visible wordmark renders at essentially unchanged on-screen size (scales proportionally to ~38px tall / ~174px wide from the cropped source) — only the surrounding empty box shrinks.
3. **Usage check.** Grepped `rapidclash-wordmark`/`logoUrl` across `apps/web/src` — used in exactly one place (`HubRibbon.tsx`), so nothing else depends on the old pixel size/proportions.
4. Nothing else touched: `pt-[env(safe-area-inset-top)]`, `layout.ts`, `HUB_BODY`, and every other header/below-header gap are pixel-identical to before.

No pre-existing test pinned `h-24` (grepped `apps/web/src/test/` for `HubRibbon`/`h-24`/`logoUrl` — none existed). Added `apps/web/src/test/HubRibbon.test.tsx` (2 tests): logo has `h-10` and not `h-24`; header retains `pt-[env(safe-area-inset-top)]` (regression guard against a future edit accidentally touching or removing the inset while adjusting logo sizing again).

Results: `HubRibbon.test.tsx` 2/2 green; full suite `npx vitest run` (repo root) 75 files / 907 tests — 906 passed, 1 failed (`apps/server/src/chess-draw-offer.smoke.test.ts`, unrelated server-side chess settlement test, no relation to this client-only change). Verified that failure is a pre-existing parallel-run timing flake, not a regression: ran the file in isolation both with and without this diff applied (via `git stash`) — 6/6 green in both cases. `tsc -b` clean; `eslint` clean on touched files.

No deviations from the brief. One judgment call: `docs/COMMS/ADVISOR_TO_PM.md` had a local uncommitted addition (the #2 entry itself, not yet on `origin/main`) already present in the working tree when I started — left it untouched/uncommitted since authoring Advisor-mailbox entries isn't this ticket's concern; only the asset + `HubRibbon.tsx` + the new test were committed.

Ask: PR review — #199, `fix(hub): header logo height — tight-cropped wordmark + h-24→h-10 (Advisor #2)`.

### 2026-07-09#3 — Chess draw offer→accept flow + solid styling (CHESS_DRAW_OFFER.md rev 3)            [OPEN]
From: Coder   Re: docs/CHESS_DRAW_OFFER.md rev 3 (Owner-committed on `main`)

Shipped in one PR (protocol + core + module + server + client, matching how the original draw-offer feature shipped), branch `feat/chess-draw-accept`. **PR #198.**

Replaces the symmetric "both players press their own Draw request → auto-draw" mechanic with the Designer-final asymmetric offer→accept flow, plus the pure-styling change to solid orange (bundled per the ticket since both touch the same lines):

1. **New protocol message** `match.drawAccept` (`packages/shared/src/protocol.ts:66-69`) — sent by the opponent of an active offer; a no-op otherwise. `match.drawOffer`'s doc comment updated to say it never completes the match by itself anymore.
2. **`GameModule.drawOffers`** (`packages/shared/src/game-contract.ts:154-176`) gains `accept(state, playerId)` alongside `offer`/`revoke` — still a plain capability the core dispatches on generically (invariant #5 intact, no `if gameId==='chess'` anywhere).
3. **`matchmaking.ts`**: new `acceptDraw(matchId, playerId)` (interface `:271-280`, impl `:750-778`, added to the returned object) — routed through the same generic `applyDrawAction` helper `offerDraw`/`revokeDraw` already use.
4. **Chess module** (`packages/games/chess/src/chess.ts:250-280`): `offer()` no longer checks the opponent's offer or auto-completes — it only ever records the sender's own (with the same idempotent-refresh backstop). New `accept()`: resolves `{type:'draw'}` (clears `drawOffers`, sets `forcedOutcome`) only if the *other* player has an active offer; otherwise returns state unchanged (also a no-op after `forcedOutcome` is already set, or when accepting your OWN offer instead of the opponent's).
5. **Gateway** (`apps/server/src/ws/gateway.ts:595-642`): added `case 'match.drawAccept':` to the existing switch, same broadcast-to-both + settle-if-terminal pattern as `drawOffer`/`drawRevoke`.
6. **Client wiring**: `ws.ts` `drawAccept(matchId)`; `App.tsx` `handleDrawAccept` + `onDrawAccept` prop (mirrors `handleDrawOffer`/`handleDrawRevoke`); `GameHub.tsx` `onDrawAccept?()` threaded through `GameAreaArgs`, `GameHubScreenProps`, the destructure, and `areaArgs` (4 spots, alongside the existing `onDrawOffer`/`onDrawRevoke`).
7. **`ChessHub.tsx`**: `DrawOfferedChip` (`:96-112`) now branches on `side` — `own` → non-tappable "Draw offered" status span; `opponent` → tappable "Accept draw?" `<button>` calling a new `onDrawAccept`. Both solid `bg-amber-400 text-background`, the "½" glyph removed. `ChessSlotAside` threads `onDrawAccept` down only for `side==='opponent'` (the offerer never sees an accept control on their own bar). `ChessSecondaryAction`'s `Revoke DRAW` button restyled from `bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/50` to solid `bg-amber-400 text-background`. The "Draw request" (not-yet-offered) button is untouched, neutral, and per the spec never itself accepts an incoming offer — it only ever creates the presser's own separate offer.

Done-when items verified: offerer sees the solid non-tappable status + Revoke DRAW; opponent sees the solid tappable Accept-draw pill that resolves the game; the opponent's own Draw-request button never accepts (dedicated test); revoke still only withdraws the sender's own offer; expiry backstop unchanged; draw terminal (stakes returned, no rake, no rematch, orange popup + persistent outlines) reuses the existing path untouched; a decisive result while an offer is pending still supersedes it (covered by the existing/extended forced-outcome no-op tests on both `offer` and `accept`); core stays generic; only `bg-amber-400`/`text-background` tokens, no new hex.

Tests: `packages/games/chess/src/chess.test.ts` — replaced the both-offered-auto-complete test with an "offering while the opponent already has an offer does NOT complete the draw" test, added `accept()` coverage (completes-with-pending-offer, no-op-with-no-offer, no-op-accepting-your-own-offer-not-the-opponent's, no-op-after-forcedOutcome). `apps/server/src/chess-draw-offer.smoke.test.ts` — same both-offered replacement at the core level, added an accept-completes-with-settlement test, an accept-no-op test, and extended the unsupported-game guard to cover `acceptDraw`/`revokeDraw` too (previously only `offerDraw`). `apps/web/src/test/ChessHub.test.tsx` — the "Draw offers" describe block updated for the per-side branch: own status has no "½" and isn't a `<button>`; opponent's chip IS a `<button>`, reads "Accept draw?", fires `onDrawAccept`; both the chip and Revoke DRAW assert the solid `bg-amber-400`/`text-background` classes; added a test that pressing my own Draw-request button while the opponent has an incoming offer never fires `onDrawAccept`.

Results: `packages/games/chess/src/chess.test.ts` 46/46, `chess-draw-offer.smoke.test.ts` 6/6, `ChessHub.test.tsx` 37/37, full suite `npx vitest run` 74 files / 911 tests green; `tsc -b` clean; `eslint` clean on touched files.

Judgment calls: (a) copy — used "Draw offered" / "Accept draw?" (rendered upper-case via the existing `uppercase` Tailwind class, matching the spec's `DRAW OFFERED`/`ACCEPT DRAW?` display casing) rather than hardcoding literal uppercase strings, consistent with how the pre-existing chip's "Draw offered" text was already authored. (b) kept the SAME `data-testid`s (`chess-draw-offered-self`/`chess-draw-offered-opponent`) for the two chip variants rather than minting a new id for the accept button, since it's still "the indicator on the offerer's bar" at that DOM location — just a different element/behavior per viewer. (c) capability method named `accept` (mirrors `offer`/`revoke`); core method named `acceptDraw` (mirrors `offerDraw`/`revokeDraw`); protocol message `match.drawAccept` (mirrors `match.drawOffer`/`match.drawRevoke`) — no naming ambiguity in the spec, just picked the consistent pattern.

Ask: PR review — #198, `feat(chess): draw offer→accept flow + solid styling (CHESS_DRAW_OFFER.md rev 3)`.

### 2026-07-09#2 — Hero carousel: separate cards + final banner set (Advisor #2)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-08#2

Shipped in one PR, branch `feat/hero-carousel-cards-final-banners`, all client-only in `apps/web/src/screens/HomeHub.tsx` (`HeroCarousel` + `HERO_SLIDES`). **PR #194.**

1. **Separate rounded cards + gap.** Track lost `rounded-[18px]`, gained `gap-4` (16px); each `<img>` gained `rounded-[18px]` instead. `#0B0B0B` page background shows through the gap automatically (no explicit bg color added). `snap-x snap-mandatory` / `snap-center` kept as-is — still pages one full-width card at a time, no free scroll.
2. **Gap-aware dot calc.** Old `Math.round(scrollLeft / clientWidth)` ignored the new gap. Replaced with a calc that reads the actual rendered spacing between the first two cards (`el.children[1].offsetLeft - el.children[0].offsetLeft`) and divides `scrollLeft` by that instead of `clientWidth` — stays correct regardless of gap size or slide count, verified up to the 5-slide max via a test that stubs a gap large enough to make a naive clientWidth-only calc land on the wrong (out-of-range) index while the gap-aware calc lands correctly on index 2.
3. **Final banner set.** `hero-1.webp`, `hero-2.webp`, `hero-front.webp` were already replaced on disk (uncommitted) — added them to this PR. Verified all three are still 2120×754 (~2.81:1), matching the `aspect-[2120/754]` frame from #186 — no re-crop needed, `object-cover` doesn't clip.
4. **Per-slide alt text.** `HERO_SLIDES` is now `{src, alt}[]`; each banner has its own descriptive alt instead of one shared hardcoded string.
5. **Stale comment cleanup.** Removed the "Owner test banner … Revert = remove this import" comment above the `heroFront` import and the matching "third is the Owner's test banner" line in the `HeroCarousel` JSDoc — the trophy slide is now a permanent, Designer-approved part of the shipped 3-banner set, not a pending-revert experiment.

Added 2 tests to `apps/web/src/test/HomeHub.test.tsx`: (a) track has `gap-4` and no `rounded-[18px]`, each image has `rounded-[18px]` + distinct alt text (3 unique alts, content-matched per slide); (b) a scroll simulation with stubbed `offsetLeft`/`clientWidth`/`scrollLeft` proving the dot lands on the gap-aware index (2) rather than the out-of-range index a naive clientWidth-only calc would produce.

Results: `HomeHub.test.tsx` 21/21 green (was 19); full suite `npx vitest run` 74 files / 906 tests green; `tsc -b` clean; `eslint` clean on touched files.

**Copy notes relayed from the Advisor's #2 flags (Designer's call, not mine to fix — didn't touch baked-in image copy):**
(a) P2P slide headline "PLAYER VS PLAYERS" is singular/plural-mismatched vs the brand line "Players vs Players."
(b) Trophy slide's money-forward copy ("WIN REAL RIVALS' STAKES") is fine in this 3-slide set (sibling "never the house"/"no house, no edge" slides mitigate it) but would need another look if ever shown alone — not a blocker.

No deviations from the brief. One note: my local `main` was one commit stale (missing the `2026-07-08#2` entry itself) when I started — pulled `origin/main` fast-forward before branching, so the branch is current.

Ask: PR review — #194, `feat(home): hero carousel — separate cards + final banner set (Advisor #2)`.

### 2026-07-09#1 — Chess ClockPill: turn border + never-pulse-a-dead/ended-clock (Advisor #9)            [OPEN]
From: Coder   Re: ADVISOR_TO_PM.md 2026-07-07#9

Shipped both fixes from #9 in one PR, branch `fix/chess-clock-turn-border-freeze`, all client-only in `apps/web/src/screens/ChessHub.tsx` — no protocol/module change.

1. **Turn border.** `ClockPill`'s active class: `ring-1 ring-brand/40` → `ring-2 ring-brand` (full-opacity brand purple, thicker). `bg-brand/25 text-foreground`, pill shape, and the green/red active dot are unchanged. Applies to whichever side is active, both players; no blue anywhere.
2. **Dead/ended-clock freeze.** Verified the root cause against `packages/games/chess/src/chess.ts`: `forfeit()` sets `forcedOutcome` but never clears `clock.active`, so after forfeit/timeout the flagged player's raw server clock can still read "active" client-side. Fixed purely on the client:
   - `ClockPill`'s pulse condition gained an `ms > 0` guard: `low && active && ms > 0 && 'animate-pulse'` — a clock at 0 never pulses, active or not.
   - `ChessSlotAside` now computes `ended = args.phase !== 'in-match'` (same idle/result-vs-in-match idiom `renderPrimaryAction`/`renderSecondaryAction` already use) and threads it through `ChessClockChip` into `isActive = pid === clock.active && !ended`. Once the round is over, both clocks render fully static — no turn ring/dot, no pulse — while the independent `low` → `text-destructive` coloring still shows the timed-out/losing clock as a frozen red `0:00`. The live low-time warning (<10s, still running) is untouched and still pulses during play.

Only existing tokens touched (`ring-brand`, `text-destructive`) — no new hardcoded hex.

Added 4 tests to `apps/web/src/test/ChessHub.test.tsx` (new describe block `ClockPill: turn border weight + never pulse a dead/ended clock (Advisor #9)`): active clock has `ring-2 ring-brand` and not `ring-1`/`ring-brand/40`; a low+active clock with `ms > 0` still pulses during play; a clock at `ms === 0` never gets `animate-pulse` even if nominally "active"; once the match has ended (result phase, via the existing `renderToChessResult` helper) neither clock shows the active ring/dot nor pulses, even with one side at `ms === 0`/red.

Results: `apps/web/src/test/ChessHub.test.tsx` 36/36 green; full suite `npx vitest run` 74 files / 902 tests green; `tsc -b` clean; `eslint` clean on the touched files.

No deviations from the brief. One judgment call: `ended` is derived as `args.phase !== 'in-match'` rather than a new signal, per the brief's own suggestion to reuse the existing idiom — this also statically freezes the clock during `idle`/`waiting`, which is inert in practice since there's no live `view.clock` in those phases pre-match.

Ask: PR review — `fix(chess): ClockPill turn border + never pulse a dead/ended clock (Advisor #9)`.
