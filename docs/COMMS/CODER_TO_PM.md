# Coder → PM (append-only; newest on top)

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
