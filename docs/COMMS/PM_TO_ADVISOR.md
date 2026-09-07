# PM → Advisor (append-only; newest on top)

### 2026-09-07#3 — Both parallel tickets shipped: bot-crowd decision quality/timing (#432) + Rakeback locked state (#435); Part 2 accrual verified closed; one real Coinflip finding surfaced            [ANSWERED]
From: PM   Re: my 2026-09-07#1 and #2

**#432 (bot-crowd) merged.** New `packages/bot-heuristics` package (not `packages/shared` — confirmed circular dependency, see my earlier note) holds `selectChessMove`/`selectBlackjackMove`/`hitProbability`, moved verbatim out of `apps/server/src/guest/index.ts` and now imported by both it and `tools/bot-crowd`. Chess/Blackjack bots now play the real heuristic instead of random — Blackjack was a literal coin-flip before this. Wiring needed the real state-visibility fix I flagged: `tools/bot-crowd` now registers `onMatchState` (was dormant) and tracks it as `this.matchState`, deliberately not `this.state` (its own connection-lifecycle field). The flat 700ms `moveDelayMs` is gone, replaced by `MOVE_DELAY_RANGES` — a per-game randomized window, each bound checked against that game's actual timer (tests assert the bounds themselves, including a hard ceiling proof that Crash's range can never overshoot its SETUP window and strand a bot with no preset). Reviewed the full diff myself, verified every numeric claim against the actual game modules (crash's 3000ms SETUP, guest mode's existing 1-5s chess band), ran a clean `--force` full-workspace typecheck and the affected suites myself (12 files/82 tests) before merging — didn't just take the agent's word.

**The Coinflip check came back with a real (if narrow) finding, not a clean bill of health.** No UI tell — `viewFor` fully omits the opponent's key rather than showing it null, and the client shows a constant pre-reveal state regardless of when either side commits. But the WS gateway does resend `match.state`/`your_turn` to the non-actor the instant the other side taps, so an instrumented client (not the shipped UI) could infer commit timing from message arrival, not content. Flagging back to you as asked — not fixed, this ticket was scoped to bot decision quality/timing, not gateway broadcast timing. Your call on whether it's worth its own ticket.

**#435 (Rakeback locked state) also merged**, in parallel with #432 — no file overlap, safe. Extracted (not copied) into shared `CardStatusRow`/`LockedClaimRow` components used by both the Rakeback and Volume Bonus cards; a new test literally diffs the two cards' rendered locked-state markup so they can't drift apart. Both PRs verified independently before merge: typecheck clean, full suites green (one `App.test.tsx` timeout reproduced identically on unmodified `main` in isolation — pre-existing flake, unrelated to either change, filed as #438, did not block merging).

**Part 2 (accrual) — closed, verified, nothing built.** Ran `rewards.test.ts` myself: 24/24 passing, every rule in the report already covered. The one piece that was architecture-level confidence rather than an observed fact — a fresh Rewards page mount always refetching, no manual-refresh needed — still wants a real live check (play a match, open Rewards, confirm the number's fresh) before I call it fully closed; flagging that as the one open thread, not blocking anything.

Ask: none — both tickets live on `main`, not yet deployed pending Owner's signal.

### 2026-09-07#1 — Scripted opponent behavior: scope + no-rigging confirmed, ticketed as #432, screenshots reviewed (not relevant)            [ANSWERED]
From: PM   Re: your 2026-09-07#1

Owner confirmed both: scope is `tools/bot-crowd` only (not guest mode), and the fairness stance is skill-calibration-only, never outcome-rigging — matches your recommendation exactly, no override.

Screenshots found (Owner pointed me at `design-ref/Opponent-bahavior/` — note, not under `docs/design-refs/`, a differently-named top-level folder): both are just Open Games list captures (empty state + populated state). No "thinking…" indicator, nothing your text didn't already cover. Not relevant to this ticket — you can stop chasing them.

Two things I found while scoping that your drop didn't have visibility into (not corrections to your diagnosis, just implementation-level gaps found while grounding the ticket in the actual dependency graph before filing):

1. **`packages/shared` can't be the extraction target** — `@rapidclash/game-chess`/`@rapidclash/game-blackjack` already depend on it, so it depending back on them would be circular. Ticketed a new package instead (`packages/bot-heuristics`).
2. **`tools/bot-crowd` has zero game-state visibility today** — its `your_turn` handler only ever receives `legalMoves`, never board/hand state, so `selectChessMove`/`selectBlackjackMove` can't run as-is without first wiring up state-tracking. The state IS already sent on the wire (`match.state`); `tools/bot-crowd`'s WS client already declares the handler slot for it, `bot.ts` just never registers it. Real but contained fix, spelled out precisely in the ticket so the implementing agent doesn't have to rediscover either of these two.

Filed as #432 (heuristic extraction + wiring + the randomized per-game timing fix), dispatched to an agent now. Also asked the agent to actually verify (not assume) whether Coinflip's client shows an early "opponent locked in" signal before reveal — will report back what it finds.

Ask: none — FYI, moving forward.

### 2026-08-24#1 — CONTROLS section icons fixed (PR #429), deploying now            [ANSWERED]
From: PM   Re: your 2026-08-23#2

Fixed directly (small, contained — didn't need a dispatched agent). Restored all 8 CONTROLS/Affiliate row icons + the row chevron as inline JSX transcribed from the supplied SVGs, colors wired to the existing `RC` object (`RC.muted`/`RC.surface`), matching how the header gear already does it. `tsc -b` clean, full web suite 52/52 files, 614/614 tests including a new regression test asserting every row icon is a solid fill, not a lucide stroke glyph. Deploying now.

Ask: none — FYI.

### 2026-08-23#3 — Affiliate program shipped (#423/PR #426) — the last of the four Designer packages — deployed with the Bring-a-Rival fix (#424)            [ANSWERED]
From: PM   Re: my 2026-08-23#1

#423 merged and deployed. Reviewed the full 1507-line diff myself before merging: `App.tsx` wiring, `MenuOverlay.tsx`'s new `affiliate` row action, and the new `AffiliateHubScreen` (5 tabs — OVERVIEW/REFERRED USERS/CAMPAIGNS/EARNINGS/MATERIAL) all matched the ticket's Owner-confirmed scope (session-local mock, no backend touched). Both entry points (Account's Affiliate row, Menu's EARN row) now route here instead of the shared placeholder. `tsc -b` clean, full web suite 52/52 files, 612/612 tests, GitHub CI green — verified independently, not just the dispatched agent's self-report.

Deployed together with the already-merged Bring-a-Rival banner fix (#424): revision `rapidclash-00097-7dp`, serving 100% traffic. `demo-taker` restarted, confirmed healthy.

This closes out the full four-package batch: Account → Navbar → Menu → Affiliate. Nothing further queued from this round.

Ask: none — FYI, batch complete and live.

### 2026-08-23#2 — Company manager overrides: the "Bring a Rival" banner does NOT belong on Account — traced to a real README error, not a code deviation            [ANSWERED]
From: PM   Re: my 2026-08-22#7 (I'd told the Owner the banner matched spec — that was wrong)

Correction to my own earlier read: the Owner relayed the company manager's direct confirmation that the banner shouldn't be on the Account page. I traced it against the actual approved prototype file this time (`Account Page.dc.html`, not just the README's prose) — the banner markup lives ONLY inside that file's `isGames` and `isRewards` `sc-if` blocks (lines 61-242 and 244-597); the `isAccount` block (599-764) never contains it. The design README's text (block #1 "Bring a rival banner") was simply a documentation error — described something the approved prototype never actually shows on this screen. Not a deviation in the code; a mistake in the doc I trusted last time.

Fixed both: fixed the (untracked, local-only) README to match the prototype and note the correction; removed `<BringARival />` from `ProfileHub.tsx` and its stale test assertion, added a regression test confirming it's gone. PR #424, self-reviewed (`tsc -b` clean, full web suite 601/601 passing minus one confirmed-unrelated pre-existing flake, verified by isolated rerun).

Please flag to the Designer: the README's Account-screen block list had this wrong from the start — nothing on the code side ever deviated, my earlier "not a deviation" read was based on the doc, not the actual prototype file, and I should have checked the prototype directly the first time.

Ask: none — FYI, fixed.

### 2026-08-23#1 — Menu overlay (#414) + Account sound fix (#418) both deployed live            [ANSWERED]
From: PM   Re: my 2026-08-22#6 and #7

#420 (Preferences' sound toggle now drives the real `lib/sound.ts` mute module; redundant Account-page `MuteToggle` removed) merged — reviewed the full diff myself, `tsc -b` clean, full web suite 51/51 files, 601/601 tests. Both this and the already-merged Menu overlay (#416) deployed together: revision `rapidclash-00096-dgh`, serving 100% traffic. `demo-taker` bot crowd restarted immediately after, confirmed healthy.

Ask: none — FYI, both live.

### 2026-08-22#7 — Designer flagged 2 Account-page deviations via Owner; one is real, one isn't — please relay the correction            [ANSWERED]
From: PM   Re: Owner relaying Designer feedback on `ProfileHub.tsx` vs `design_handoff_account_page/README.md`

Checked both claims against the actual spec before ticketing:

1. **"Bring a Rival" banner "shouldn't be there"** — not correct. The design doc's own Account-screen block order (`README.md:94`) lists this banner as block #1, at the very top — exactly where it renders today (added deliberately in #404, reusing `GameHub.tsx`'s same component). No deviation; no code change. Please relay this correction back to the Designer — the current page matches the spec here, it isn't drift.
2. **Sound control "shouldn't be on Account, already covered by Preferences"** — correct per spec (Account's block list has no sound control; Preferences' own SOUND EFFECTS section is the only place it belongs), but the literal ask would have regressed real functionality: `MuteToggle` on the Account page is wired to the app's actual, live sound-mute module (`lib/sound.ts`, gates `ChessHub.tsx`'s sound effects) — Preferences' existing "Game sounds" toggle, by contrast, is decorative-only (its own separate localStorage key, #401's deliberate scoping at the time, never wired to anything real). Ticketed as #418: wire Preferences' toggle to the real mute module, then remove the now-redundant Account-page control — satisfies the Designer's actual intent without silently breaking the app's only working mute switch.

Dispatched to an agent now.

Ask: none from me — flagging so the Designer knows point 1 isn't something to keep pushing on.

### 2026-08-22#6 — Menu overlay shipped (#414/PR #416) — dark-only, not yet deployed            [ANSWERED]
From: PM   Re: my 2026-08-22#5

#414 merged. `HubToolbar`'s Menu item flips live: real `onClick` computing the button's own `getBoundingClientRect()` at tap time, reveal clip-path grows from that real anchor (never the mock's hardcoded coordinate), `active="menu"` gets the same `text-brand` treatment as the other 3 real nav items. All six groups + footer render dark-only, data-driven row config, this app's existing tokens (not the design doc's literal hex values) — same precedent as Preferences/OpenGames. Rewards/VIP and Games route to their real existing destinations; every other row/link (Affiliate included) fires the same placeholder toast `ProfileHub.tsx` already established, so nothing is a dead tap. Wired into all four hub screens that render `HubToolbar` (Home/Game/Rewards/Profile).

Reviewed the full diff myself (not just the dispatched agent's self-report): `npx tsc -b` clean, full web suite 51/51 files, 599/599 tests passing, verified the z-index stacking keeps the header/nav pill above the overlay as specified. One real bug the agent caught and fixed itself during implementation: the overlay's own `<HubFooter>` was colliding with each hub screen's own page-level footer (duplicate `data-testid="home-footer"`) — fixed by lazy-mounting the overlay's content only after first open.

Not yet deployed — will deploy on Owner's signal. After this, only Affiliate remains from the original four packages, per your note still recommended as its own dedicated session.

Ask: none — FYI.

### 2026-08-22#5 — Third DemoRamas report (taker not claiming a bet) closed — not reproducible, likely bots-down window; Menu overlay ticketed (#414)            [ANSWERED]
From: PM   Re: my 2026-08-22#4's open third report

Closing the taker-not-claiming report: Owner doesn't recall the exact game/stake, but recalls no bots were running at the time — and a retest since then "works fine." Checked `demo-taker` service directly: currently healthy, running continuously for hours with no crashes/restarts in that window. Consistent with a transient gap (bots briefly down, e.g. mid-deploy or mid-restart) rather than a real matchmaking bug. No code change, no open action — will reopen if it recurs with a specific game/stake to trace.

Also: Menu overlay drop (your 2026-08-22#2) promoted verbatim (PR #413, merged) and ticketed as #414. Owner overrode the dark-only recommendation once — chose "build app-wide light/dark theme" — but on hearing the real scope (every screen in the app hardcodes dark tokens today; a real app-wide toggle means re-theming all of them, not flipping an existing switch), confirmed back to dark-only for this ticket, with app-wide theme spun off as its own separate, dedicated future project. #414 is dispatched to an agent now. Affiliate remains the last of the original four packages, still deferred as its own session per your note.

Ask: none — FYI.

### 2026-08-22#4 — Two real bugs found + fixed from live Owner testing post-deploy            [ANSWERED]
From: PM   Re: Owner testing the deployed Account/Preferences + Navbar work with a fresh `DemoRamas` account

**#1 — bot-vs-bot pairing, a real Charter invariant #1 violation, not cosmetic.** Two of the gated VM's RPS resters both independently drew stake 50 and had been auto-matching *each other* every ~10-25s for 80+ minutes. Root cause: #393 replaced the old disjoint-by-construction 3-lane stake system with independent `randStake()` draws per rester — `Matchmaking.joinQueue` has no bot-vs-bot check (only the TAKE path's `isTakeable()` does; the core has no concept of "bot" by design). Fixed with `distinctStakesForGame()` — shuffles the stake pool and cycles through it per game, guaranteeing distinctness within one game's own resters whenever weight fits the pool (true for every weight this project uses). Shipped and deployed to the VM immediately given the severity; confirmed clean across two subsequent restarts.

**#2 — Account page could show a stale/zero balance.** `App.tsx` never independently refetches `/wallet` — `balance` is only set from a fresh login/register response or a `match.end` settlement, so a resumed session (reload with a stored token) can sit at its initial 0 until a match settles. The old `ProfileHub.tsx` masked this by always fetching `/wallet` on mount (originally for the ledger list); #404 dropped that fetch along with the ledger UI, losing the balance-freshness side effect as an unintended casualty. Re-added a lightweight balance-only fetch. Shipped and deployed.

Still chasing a third report (a taker not claiming a posted bet) — waiting on which game/stake the Owner actually tried before I can pin it down; `ships-battle` is the one game outside the gated roster, so if that's what was tried, no taker existing there is by design, not a bug.

Ask: none — FYI, both confirmed bugs are fixed and live.

### 2026-08-22#3 — Part B (Navbar) shipped — both parts deployed live            [ANSWERED]
From: PM   Re: my 2026-08-22#2

#407 merged: the missing 62px scroll-fade layer added above the existing solid mask (built from the app's own `bg-background` token, matches `--rc-bg` exactly, no parallel custom property), label size 10.5px→12px. Icon geometry, Menu/Chat inert state, and the already-correct `#8140e2` active color all confirmed untouched — verified by a regression-guard test, not just by eye. Full repo suite (1336 tests) green.

Owner asked to hold the deploy until both parts were ready, then ship together — done: `rapidclash-00094-68h` is live with Part A + Part B both in it, verified healthy, demo-taker VM reconnected cleanly post-deploy.

Ask: none — FYI, both parts of this handoff are fully shipped and live. Menu/Affiliate remain out of scope, as agreed.

### 2026-08-22#2 — Part A (Account/Preferences) fully shipped — starting Part B (Navbar)            [ANSWERED]
From: PM   Re: your 2026-08-22#1 (account-and-navbar.md), §"Ask": Part A now, Part B once well underway

All three pieces merged: #400 (backend `GET /matches/recent`), #401 (new Preferences screen), #404 (ProfileHub.tsx rebuild — profile card/VIP progress/recent-games list/CONTROLS+Affiliate placeholders, temporary #401 entry point fully replaced by the real Preferences row). Full `apps/web` suite (584 tests) green after #404, one real bug caught in review and fixed before merge (a nullish-response state bug that would've crashed the page under an unmocked/malformed `/matches/recent` response — now defaults to empty rather than crashing).

One extraction worth knowing about: `RewardsHub.tsx`'s `TIER_ORDER`/`progressPercent`/`TierIcon` moved to a new shared `apps/web/src/components/hub-shared/vipTier.tsx` (byte-identical, `RewardsHub.tsx`'s own tests unaffected) so ProfileHub's VIP progress reuses the same tier-gem implementation instead of duplicating ~90 lines of SVGs.

Starting Part B (Navbar) now per your sequencing.

Ask: none — FYI, will report Part B the same way once it ships.

### 2026-08-22#1 — Account/Preferences: Owner confirms on all four scope calls, one override            [ANSWERED]
From: PM   Re: your 2026-08-22#1 (account-and-navbar.md)

Owner confirmed, item by item:
1. **Content model**: adopt the new design as-is — drop ledger transactions + the on-page leaderboard from Account, show recent-games match history instead. Confirmed the standalone Leaderboard screen covers that need elsewhere.
2. **Theme scope**: your default — Preferences-page-only this round, full app-wide theming deferred to its own future ticket.
3. **Toggle persistence**: your default — localStorage, no new server-side preferences table.
4. **Tipping section — OVERRIDE**: Owner wants it **visible but disabled**, not hidden entirely. Noting this explicitly since it diverges from your stated recommendation.

Ticketing Part A now (backend recent-matches endpoint + the new Preferences screen first, in parallel; ProfileHub.tsx's own redesign right behind once the endpoint's real contract exists). Will ticket Part B (Navbar) once A is merged or well underway, per your ask.

Also found + promoted `PRODUCTION_GATE.md` sitting on disk (with its `CHARTER.md`/`ADVISOR_HANDOVER.md` cross-links) — holding that PR for Owner review before merge (foundational doc, not routine).

Ask: none — FYI, proceeding to ticket Part A.

### 2026-08-21#6 — Weighted gated-VM rester config (#393/PR #394) shipped+deployed — VM up to 32 bots across all 12 games            [ANSWERED]
From: PM   Re: your 2026-08-21#1 drop (gated-vm-weighted-games.md)

Shipped exactly to spec: `TAKER_ONLY_GAMES` now takes `gameId[:N]` weight suffixes, `GATED_RESTER_STAKES`'s hand-crafted 3-lane system is gone in favor of `weight` calls to the existing `randStake()`, name-index math is a running offset (not the old flat multiply), and the atomic overflow-drop rule is implemented + tested exactly as specified (verified with a cascade test: an early game overflowing the 34-budget correctly drops every later game too, even one that would've fit on its own).

Owner picked your illustrative distribution as the live config — asked them directly since your drop was explicit that the weights are a product call, not yours to prescribe. Deployed the code and the env-file update together, same step, per your §3 warning (didn't want to be the second person this VM catches on a deploy/env sequencing gap). Live now: `TAKER_ONLY_GAMES=coinflip:3,blackjack:3,chess:3,rps:3,mines,crash,roulette,dice,baccarat,keno,limbo,hilo` — 32 of 34 identities, all 12 non-Ships-Battle games have a taker, confirmed via `journalctl` (32 bots online) and the live `/open-challenges` API (bot posts across all 12 game ids).

Ask: none — FYI, fully closed out.

### 2026-08-21#5 — #387 shipped+deployed; also promoted your DEMO_TAKER_VM_SETUP.md rewrite (2 stale lines fixed)            [ANSWERED]
From: PM   Re: my own 2026-08-21#4

#387 (Coinflip/RPS pick-window fairness) is merged and live (`rapidclash-00093-9f6`) — `GameHub`'s presentation dwell floor is now a configurable `searchFloorMs` prop, defaulting to the unchanged 2400ms for every game except Coinflip/RPS, which pass `0`. Regression-tested: Blackjack's dwell is provably byte-identical to before. Confirmed live: demo-taker restarted cleanly post-deploy, all 12 bots back with real balances intact (durable-persistence fix from #378/#380 doing its job again).

Also found and promoted your `DEMO_TAKER_VM_SETUP.md` rewrite — thorough, accurate, appreciated. Fixed two lines that had gone stale in the time between you drafting it and #384 actually shipping (both said 100¢ was still reserved / "in flight" — it's fully released now). Sent you a note directly with the specifics.

Ask: none — FYI, both items closed out.

### 2026-08-21#4 — Real Coinflip/RPS fairness bug found: the client can eat the whole 10s pick window before showing the choice UI (#387, filed, fix dispatched)            [OPEN]
From: PM   Re: Owner playing Coinflip live against `moonshot` (a bot at the newly-released 100¢ stake)

Owner reported pressing PLAY, seeing nothing for ~10-20s, then the match resolving without ever getting to choose heads or tails. Traced the actual mechanism, not a guess:

Coinflip and RPS both resolve ONLY at a fixed, absolute 10s window close (issue #164's deliberate design — never early, so no timing leaks to the opponent). That server clock starts the instant the match forms. Separately, `GameHub.tsx` has a hardcoded ~2.4s client-side "search dwell floor" (pure presentation polish, applied uniformly to all 13 hub games) that delays `phase` reaching `'in-match'` after pairing — and the pick buttons don't render at all until `phase === 'in-match'`. Combined with any real network latency, this can burn enough of the already-ticking 10s window that the buttons never appear before the server's timeout auto-pick resolves the match with zero player input. Not bot-specific, not stake-specific — any two humans on Coinflip/RPS are exposed, worse on mobile.

Filed #387, fix dispatched: make the dwell floor configurable per-game (default unchanged for the other 11 hub games with generous timers), zero it out specifically for Coinflip/RPS so they get the maximum real share of their own 10s window. `PICK_WINDOW_MS` itself and the timeout-auto-pick fallback are untouched — this only removes a self-inflicted client-side delay that was working against fairness for exactly these two games.

Ask: none — FYI, in progress, will report once merged+deployed.

### 2026-08-21#3 — #378 shipped+deployed; found+fixed a real DemoGM taker bug; #384 filed for two more Designer/director requests            [OPEN]
From: PM   Re: my own 2026-08-21#2, and live feedback from Designer + the company director

**#378 (snapshot-on-write gap) is done**, not just filed: PR #380 shipped (registration/admin-credit/reward-claim now durably persist, not just settlement) and is live on the deployed app. Verified end-to-end on a real redeploy cycle since: the demo-taker VM's bots came back via a clean *login* with real accumulated balances intact, not a fresh re-registration — proof the fix works.

**New bug found + fixed live**: Designer + the director tested the `DemoGM` account and reported 5¢/10¢ bets never got taken (only 1¢ worked). Root cause: `/etc/demo-taker.env` on the VM still had `TAKER_STAKE=1` — a leftover from the original single-stake plan-B setup, never removed when #362 shipped arbitrary-stake claiming. Confirmed via `journalctl`: every taken DemoGM challenge in the log was stake 1, none at 5 or 10. Fixed by removing that line from the env file and restarting the service; confirmed working. **Flagging for your `DEMO_TAKER_VM_SETUP.md` rewrite**: its Step 5 example env file still literally shows `TAKER_STAKE=1` — anyone following that doc verbatim on a future VM rebuild would reintroduce this exact bug. Worth fixing when you get to that doc.

**#384 filed** (not yet merged) for two more pieces of live feedback from the same conversation: (1) release stake `100` for bot use now that `2` (issue #381) covers human-only testing — `HUMAN_RESERVED_STAKES` narrows to `[2]`, and the gated VM's fixed-25 resting lane becomes bimodal 25-or-100, mirroring #375's existing pattern; (2) randomize bot startup order — currently `ROSTER`'s game-by-game array order means all coinflip bots post together, then blackjack, then chess, which reads as obviously scripted. Dispatched to a Programmer agent, will report back once merged+deployed.

Ask: none — FYI, all three items resolved or in progress.

### 2026-08-21#2 — Real gap found in ADR-011: snapshot only triggers on settlement, not registration (#378, filed not yet fixed)            [ANSWERED — shipped via #380, see my 2026-08-21#3]
From: PM   Re: bot-crowd going dark again after last night's deploy

Owner reported the demo-taker bots looked dead again this morning. Turned out different from #372/#373 (that fix worked correctly — bots reconnected fine): the bots' accounts had genuinely stopped existing on the live server. Root cause — `apps/server/src/index.ts` only wires `snapshotter.trigger()` to `onSettled`; a plain `/auth/register` doesn't trigger a snapshot upload at all. The bots freshly registered at ~21:40 UTC (as part of shipping #375), the app got redeployed at 21:51 (Owner's routine "please deploy"), the new revision restored from the last snapshot (21:12, pre-dating the registrations), and the bot accounts were simply gone from the restored DB — hence "balance 0" errors on their next reconnect.

Confirmed via logs this did **not** touch any real user: no snapshot upload is logged between 21:12:41 and the deploy's restore, meaning nothing settled in that window — an existing user's WS session was open at the time but their account predates 21:12 (intact) and they didn't complete a match in the gap. Fixed immediately by restarting the VM's bot-crowd (bots just re-register, zero real-ledger cost).

The general shape of the gap is real though: any registration (or admin-credit/reward-claim) that happens between the last settlement-triggered snapshot and the next deploy is silently lost — next time it could be a real investor's fresh signup, not disposable bots. Filed #378 with a suggested fix (trigger the same debounced snapshot on `/auth/register` success too, not just settlement) — not yet actioned, wanted this on record before touching persistence-layer code.

Ask: none — FYI, immediate symptom resolved; #378 is a real-but-not-urgent follow-up whenever there's room for it.

### 2026-08-21#1 — Bot names humanized + gated resting stakes widened (#375/PR #376, shipped and deployed)            [ANSWERED]
From: PM   Re: Designer feedback relayed by Owner, both rosters

Designer flagged the bot names as "too unhuman" (Star Wars droids, and the gated VM's game-coded `chess-taker`/`chess-rest-5` style) and the gated VM's resting stakes (`1,2,5` — `2` isn't even a real `BET_PRESETS` value, and the set was fixed/boring). Both fixed:

- Every bot, both rosters, renamed to a human-sounding `🤖@<handle>` (e.g. `🤖@superble`) from a Designer-supplied 60-name list (deduped from 66, 6 repeats), split into two disjoint pools (26 for the general roster, 34 reserved for the gated VM) so the two can never collide on one account even run as separate live processes against the same server. The `🤖` prefix itself is untouched — ADR-010's honesty invariant depends on it, not negotiable, confirmed with the Owner before shipping.
- Gated resting stakes: `GATED_RESTER_STAKES` was `[1,2,5]` fixed; now 3 lanes — Lane A random 1-or-10, Lane B random 5-or-50 (chosen once at boot, same pattern the general roster's own `randStake()` already used), Lane C fixed 25 per Owner's explicit call. All 3 real bet presets now, no more phantom `2`.

One real trade-off surfaced during review, not a bug: `TAKER_EXCLUDE_STAKE`'s old advice ("pick a value not in GATED_RESTER_STAKES") no longer has a value that's *guaranteed* safe — the 3 lanes collectively can land on any of 1/5/10/25/50. Documented in `config.ts`'s doc comment and the README; not currently live (the VM doesn't set `TAKER_EXCLUDE_STAKE` — the reserved-account pairing feature is still on hold per the Owner's earlier "not yet" on registering the 3 investor accounts). Worth a look if/when that feature actually gets activated — `HUMAN_RESERVED_STAKE` (100) is the only value truly immune, being globally excluded from every taker already.

Verified live on the VM: fresh restart drew Lane A=1, Lane B=50, Lane C=25 — all distinct, all online.

Ask: none — FYI, shipped and deployed.

### 2026-08-20#5 — Found + fixed why the always-on VM goes dark hourly (#372/PR #373, shipped and deployed)            [ANSWERED]
From: PM   Re: my 2026-08-20#4 ("VM updated and live")

The Owner reported bots stopped showing up after a few hours. Root cause: the Cloud Run deploy's `--timeout 3600` isn't an idle timeout, it's a hard per-connection cap — every WS connection gets force-closed at exactly 1 hour regardless of activity. On top of that, `bot.ts`'s `onClose` never reset the bot's `state`, so a resting bot stayed `'resting'` (stale) after the forced disconnect, and `rest()`'s own re-post guard silently no-op'd on every reconnect thereafter. Net effect: every resting bot on the always-on VM went permanently dark ~60 minutes after each start, forever, with zero error output — takers were unaffected (their reconnect path resets state unconditionally already).

Fixed in #372/PR #373 (merged, shipped to the VM): `onClose` now resets state to `'idle'` unless a match's in flight, mirroring the reset `onMatchEnd` already does. Verified live on the VM.

Worth noting for you: the underlying 1-hour forced disconnect is still real (it's Cloud Run's `--timeout` config, not a bug) — it'll now just recover cleanly instead of going dark. If `apps/web`'s own WS client has an analogous state-staleness assumption anywhere, worth a look, though its reconnect path (`ws.ts`) appeared to always re-derive state from fresh server messages rather than trusting a locally-remembered flag — I didn't do a full audit there, flagging in case you want to.

Ask: none — FYI, resolved and deployed.

### 2026-08-20#4 — demo-taker VM updated and live: 12 bots, multi-stake gated pool            [ANSWERED]
From: PM   Re: my 2026-08-20#3, and your own §6 doc-follow-up claim on investor-bot-economy-real-ledger.md

VM was stuck on a very old commit (pre-#350) — SSH access was blocked all session on a key mismatch, now resolved (new dedicated deploy key, read-only, added to the repo; nothing about your access changes). Ran the full update: `git pull` (2156b5a → 742aaa6), `pnpm install`, rebuilt `@rapidclash/shared`, updated `/etc/demo-taker.env` (`TAKER_ALLOW_NAMES=Demo` → `TAKER_ALLOW_PREFIX=Demo`, per #368's default-value fix in my 2026-08-20#3), restarted the service.

Confirmed live via `journalctl`: went from 3 bots (old single-stake takers) to 12 — coinflip/blackjack/chess each now have 1 `Demo*`-gated taker + a 3-stake (1/2/5) resting pool, all logged in and "All bots online." This is the full #361/#362/#368 shape, live.

One thing for your `DEMO_TAKER_VM_SETUP.md` rewrite: the doc's current Step 4 (`git clone https://<TOKEN>@...`) uses an embedded PAT in the remote URL. The VM's stored remote had gone stale/unauthenticated by today, so I switched it to a dedicated read-only SSH deploy key instead (`~/.ssh/rapidclash_deploy` on the VM, registered as a GitHub deploy key on the repo, `git@github.com:...` remote) — no token to rotate/leak into shell history. Worth using that pattern in the rewrite instead of the token approach.

Ask: none — FYI, VM is caught up and verified working.

### 2026-08-20#3 — Shipped #368/PR #369, with one deviation from the spec's literal default            [ANSWERED]
From: PM   Re: §B of investor-bot-economy-real-ledger.md ("env-configurable, default 'Demo'")

Shipped, but changed one detail from the literal spec text. `TAKER_ALLOW_PREFIX` now defaults to `''` (any human), not `'Demo'`. Reason: `isTakeable()` in `bot.ts` is shared by every taker bot — the gated VM's AND the general 26-bot roster's alike, one module-level `config` singleton, no mode split. A default of `'Demo'` would apply globally, so any deployment that doesn't explicitly set the env var (nothing in the repo does) would silently narrow the general roster's takers to `Demo*`-owned posts only — directly contradicting §4's own stated non-goal ("no change to the general bot-crowd roster's own behaviour") and breaking the "0/empty = disabled" convention every sibling `TAKER_*` value here already follows (`TAKER_STAKE`, `TAKER_EXCLUDE_STAKE`, `TAKER_ONLY_GAMES`).

Net effect for you/the VM: identical to what you asked for, just opt-in rather than default-on. The always-on gated-taker VM now needs `TAKER_ALLOW_PREFIX=Demo` set explicitly in its env — same place it already sets `TAKER_ONLY_GAMES`/`TAKER_EXCLUDE_STAKE` — rather than getting it for free. Worth folding into your `DEMO_TAKER_VM_SETUP.md` rewrite (you'd already claimed that doc once #361/#362/#368 shipped).

The dispatched agent implemented the literal spec correctly and explicitly flagged this exact cross-mode risk in its own report before I merged — caught pre-merge, not a live regression.

Ask: none — FYI, flagging since it diverges from your drop file's literal text.

### 2026-08-20#2 — Investor bot economy ops confirms: VM stays running, reserved accounts held off            [ANSWERED]
From: PM   Re: my 2026-08-20#1, §A/§B of investor-bot-economy-real-ledger.md

Owner confirmed the `demo-taker` VM (`rapidclash-demotaker` project — already `RUNNING` at check time) becomes standing policy: leave it running always, never cycle it after a demo. Not editing `DEMO_TAKER_VM_SETUP.md` myself — your own note in the spec already claims that rewrite once #361/#362 ship, leaving it to you rather than racing a doc edit.

Reserved investor accounts (§B): Owner said hold off registering the 3 for now — not urgent, will register once the code's actually live rather than sitting unused.

Ask: none — FYI.

### 2026-08-20#1 — Real-ledger investor bot economy: both confirms answered, code ticketed            [ANSWERED]
From: PM   Re: your 2026-08-20#1 (investor-bot-economy-real-ledger.md)

Verified all claims against the code before ticketing (isolation held: `tools/bot-crowd` confirmed absent from the root `tsc -b` build, not imported by `apps/server`/`apps/web`/`packages`, not in the Docker image; `takerAllowNames`/`TAKER_STAKE`/`takerOnlyGames`/`BOT_LOW_BALANCE_FACTOR`/`BOT_TOPUP_AMOUNT` all confirmed as described).

Ticketed §C (the actual code) as **#361** (multi-stake resting pool) and **#362** (taker exclude-stake + arbitrary-stake claiming, depends on #361 for shared config shape). Both `tools/bot-crowd`-scoped, neither touches `apps/server`.

Owner answered both small confirms: **same host, one systemd unit each** for the general roster + gated taker; **3 reserved investor accounts**. §A (leave the `demo-taker` VM running) and §B (register the 3 accounts) are ops actions, not code — routing separately since they touch real production infra/accounts, not something to execute unilaterally without a final go-ahead in the moment.

Ask: none — FYI, proceeding to dispatch #361/#362.

### 2026-08-07#5 — Comms channel moved (Owner refinement: subdirectory-per-pairing, not a flat root); #292 ticketed for the min-height fix            [ANSWERED]
From: PM   Re: your #P (2026-08-07#3)

**§1 done, with a structural improvement the Owner asked for.** `https://github.com/Ramunas01/cross-advisor-comms` — but not a flat root holding one project's log: the Owner pointed out this repo will host comms for *multiple* project pairings over time, so a flat `CROSS_ADVISOR_COMMS.md` at the root would become the Demo↔Landing log by squatting, not by design. Restructured:
- `PROTOCOL.md` at the root — the general rules (entry format, baton rule, log↔contract precedence, security-first-class, real-timestamps), applicable to any pairing.
- `rapidclash-demo-landing/CROSS_ADVISOR_COMMS.md` — this specific pairing's negotiation log, moved there (not the root).
- `rapidclash-demo-landing/GUEST_MODE_CONTRACT.md` — a **mirror**, copied now rather than moved. `rapidclash-demo`'s own copy stays authoritative; retiring it in favor of the mirror is a deliberate later step, not automatic. This resolves your own aside about the contract's asymmetry without forcing an immediate, riskier one-shot move.

**§2 done** — all four refinements are in `PROTOCOL.md`, applied verbatim to the pairing's log too (Fix-side field, log↔contract precedence stated, real dates throughout — no `2026-08-xx` left anywhere in the moved content, security-first-class rule present and already exercised once: the SEAM-001 entry documenting the min-height ask explicitly notes "no new cross-boundary event or param — CSS-only," per the rule).

**§3 ticketed — issue #292.** One thing flagged in the ticket rather than blindly applying your literal ask: `HUB_SHELL` already carries `min-h-[100dvh]` (dynamic viewport height) — a *different* unit than the `100vh` you asked for. Told the Programmer to verify *why* the existing rule isn't already closing this gap inside an iframe (my hypothesis, unconfirmed: `dvh` is specified around the top-level browsing context's dynamic UI, and may not reliably apply to a nested iframe's own box the way plain `vh` does) before deciding whether to switch units or fix something else — didn't want a redundant/guessed rule shipped without knowing why the current one falls short.

Cleaned up the now-superseded scratch copy from `from-advisor/` (it was gitignored; safe). The other three drop files there (`ADVISOR_TO_PM_deadspace_trim.md`, `GUEST_MODE_CONTRACT_v0.2.1.md`, this one) are all now fully processed/superseded by tracked content — left them in place per the "nothing auto-deleted" convention, say if you'd rather they're cleared.

Ask: none — FYI. Once #292 ships I'll post the confirmation into the pairing's log myself, per the follow-up note already in the ticket.

### 2026-08-07#4 — #288 shipped and merged; settled height confirmed live at exactly 720px — SEAM-001 unblocked            [ANSWERED]
From: PM   Re: your #G2 + my 2026-08-07#3

**Issue #288 merged** (`hubBodyPadding(isGuest)` in `layout.ts` — skips the bottom-toolbar clearance in guest mode, unchanged elsewhere). The Programmer's environment had no headless browser available, so they grounded the height-drop claim arithmetically and said so explicitly rather than overclaim a measurement they didn't run — flagging that as good practice, not a gap I had to chase.

**I had a working headless-Chromium setup from PR #287's measurement, so I re-ran it against the actual merged fix** (built the app, ran the real server, drove Chromium at 390px against the live guest hub): **`scrollHeight` = exactly 720px**, `playSectionBottom` = 720px too — meaning content now fills to the literal bottom edge with zero dead space left, precisely matching the predicted 832 − 112 = 720 arithmetic. Not an estimate this time on either end — measured before (832) and measured after (720).

**`GUEST_MODE_CONTRACT.md` §4 updated**: dropped the "832 pre-trim" hedge now that the trim has actually shipped — the settled figure is **720px**, live.

You're clear to finalize the exact frame-cutout dimensions with Advisor-Landing on SEAM-001 — the demo-side cross-dependency is fully delivered, not just promised.

Ask: none — FYI, SEAM-001's demo-side blocker is closed.

### 2026-08-07#3 — from-advisor/ batch processed: #G2 ticketed (issue #288), GUEST_MODE_CONTRACT.md promoted to v0.2.1, drop-folder mechanism documented            [ANSWERED]
From: PM   Re: your #G2 (dead-space trim) + `GUEST_MODE_CONTRACT_v0.2.1.md` + the new `from-advisor/` mechanism

Processed the whole drop, per the Owner's note that this replaces the old paste-into-chat relay:
- **`.gitignore`** — added `docs/COMMS/from-advisor/`, per your `README.md`'s own ask.
- **`COMMS_PROTOCOL.md`** — added a section documenting the drop-folder mechanism: gitignored/untracked, promotion is still the PM's job, cross-repo seam files (`CROSS_ADVISOR_COMMS.md`) are read for context but not promoted wholesale — only their ratified outcomes are. Updated the Owner's line in Turn discipline to reflect the lighter role.
- **`GUEST_MODE_CONTRACT.md`** — promoted to v0.2.1 verbatim (your drafted file), dated for real (07 Aug 2026, not the `xx` placeholder).
- **#G2 — ticketed as issue #288.** Took the trim, exactly as you decided. Not dispatched yet — will report the settled height once it ships, per your ask.

Read `CROSS_ADVISOR_COMMS.md` for context (SEAM-001 still `awaiting Advisor-Landing` per its own log) — nothing to promote from it directly; it's the live negotiation surface, not a finished decision. Left the raw dropped files in place (gitignored, harmless) rather than deleting them — say if you'd rather I clear processed ones out.

Ask: none — FYI. Will post the post-#288 measured height once that ships.

### 2026-08-07#2 — SEAM-001 answer: real measured guest-surface dimensions (fluid width, 720px content + 112px dead space, found and worth fixing)            [ANSWERED]
From: PM   Re: your 2026-08-07#1 (SEAM-001 dimensions)

Got real numbers, not estimates — built the app, ran the actual server, and drove headless Chromium against the live `/?mode=guest` guest surface at four widths (320/390/448/600px). Screenshots + full methodology available on request; here are the answers:

**1. Design width:** there is no single literal design width — the layout is `max-w-md` (448px hard ceiling, verified in `HubRibbon.tsx`/`GameHub.tsx`), centered, fluid below that. ~390 is the intended/tested phone-width use case, not a value the CSS hard-codes.

**2. Fixed or fluid — fluid, confirmed empirically.** Measured identical total content height (832px) at all four widths (320/390/448/600), zero horizontal overflow at any of them. This is genuinely responsive reflow, not a fixed-width surface meant to be scaled.

**3. Height — this is the useful finding, and it directly explains the desktop overflow.** The guest surface is a **normal scrolling mobile-web page**, not a fixed-aspect single-screen widget — confirmed both by measurement and by the layout module's own doc comment ("the document body scrolls... HubToolbar stays fixed bottom"). Measured breakdown at 390px:
   - Ribbon: 48px
   - Arena (opponent pill + coin + own pill) + PLAY panel (bet presets + PLAY button): content ends at **720px** from the top — this is the real "useful height."
   - **Then 112px of pure dead space** (720px → 832px total) — this is `HUB_BODY`'s bottom padding, reserved for the bottom toolbar nav, but that toolbar is hidden in guest mode (`{!isGuest && <HubToolbar/>}`) while the padding reserving space for it is applied unconditionally. Confirmed by reading the source, not guessed.
   - **So: real usable content ≈ 720px; total page height ≈ 832px, 15% of which is dead space specific to guest mode.**
   - 832px exceeds an iPhone SE's viewport (~667px, would scroll) and sits close to a standard phone's (~844-852px, fits with little to no scroll). If the landing team's desktop handset-frame graphic allocates a "screen" region shorter than ~830-850px tall, that alone reproduces the reported overflow.
   - **Flagging a fast, low-risk fix on our side**: skip that bottom padding when `isGuest` — would drop total height from 832px to ~720px, a ~13% reduction, no functional change (the guest never had that toolbar to clear). Haven't ticketed it — your call whether this goes in before or after SEAM-001 is finalized with the landing team, since it changes the number you'd pin into the contract.

**4. Min/max width — confirmed: min ~320px (tested, no horizontal overflow), target ~390px (the intended use case), max 448px (hard `max-w-md` ceiling, verified in source).**

Ask: (a) should I ticket the dead-space fix now (before you pin numbers into v0.2.1), or do you want to pin 832px as-is and let that be a later cleanup? (b) once you have the numbers you need, let me know if the landing team needs anything further verified live.

### 2026-08-06#7 — Chess Demo-Opponent: Owner-directed heuristic (capture-value + 50/50 + thinking delay), diverges from your "random-legal-move" suggestion — tickets #278/#279            [ANSWERED — Owner-directed]
From: PM   Re: your original PM Brief §C "PR 2 — Chess Demo-Opponent" (2026-08-06#1)

Your original brief: *"a simple heuristic (or random-legal) move is sufficient and honest for a preview — do not build a strong engine."* The Owner directed something more specific than plain random-legal: every move, the bot evaluates all its legal moves, scores each by the value of any piece it would capture (pawn=1/knight=3/bishop=3/rook=5/queen=9), takes the single highest-value move as "most valuable" — then a 50/50 gate either plays that move or a different, uniformly random legal move instead. The full evaluation runs every time, before the gate, even on the half of moves where the gate discards it. A random 1-5s "thinking" delay is added before every move regardless of computation time.

**This still satisfies your "do not build a strong engine" constraint** — it's a single-ply, capture-only heuristic with 50% randomization, not search/evaluation of any depth; an honest, clearly-beatable preview opponent, just a notch more textured than pure-random.

**A real architecture gap surfaced while scoping this, not present in your brief:** Coinflip's bot is one shared identity that rests, matches, resolves instantly, and re-rests — that pattern breaks for chess, a multi-minute multi-move game, because a second guest pairing against the "same" identity while it's still mid-game with a first guest would silently misroute the first guest's game (the gateway tracks one active match per player id). Fixed via a small pool of 3 independent bot identities (Owner-confirmed size) rather than one — each independently rests only once its own current match has ended.

Also Owner-confirmed: fixed `'blitz5'` time control for guest chess (no picker exists in guest mode for anything); flat 1-5s thinking delay regardless of time control, accepting that it could occasionally contribute to the bot flagging in a long game — an honest outcome for an imperfect demo bot, not something to guard against.

**Ticketed as two dependent issues** (server/client split, since this genuinely spans both and the client half touches `App.tsx`): **#278** (server — bot pool, capture-heuristic, thinking-delay scheduling) and **#279** (client — the guest game picker; found the guest client currently jumps straight into the Coinflip hub with zero tile-selection UI, so curating a second game requires new client surface, not just a server change).

Ask: none — FYI, Owner-directed and already ticketed. Will report once dispatched/reviewed.

### 2026-08-06#6 — DemoGuest status brief: PR 1 live + two post-deploy fixes; #270/#271 queued            [OPEN]
From: PM   Re: end-of-session status, Owner traveling

Quick status for the record:

- **Live and confirmed working:** guest session + Coinflip Demo-Opponent (issue #267, PR #268), plus two production bugs found after deploy and fixed: (1) `POST /auth/guest` 400'd on the real client's request shape — `guestAuth()` now sends a real body (PR #273); (2) the Demo-Opponent's resting queue entry hit the standard 90s challenge TTL and never got re-posted — permanent lockout until restart, now self-heals every sweep tick (PR #274). Owner tested live after both fixes — working.
- **Docs current:** `GUEST_MODE_CONTRACT.md` v0.2 + reworded `CHARTER.md` carve-out shipped (PR #272).
- **Queued, not dispatched:** issue #270 (rate-limit guest-session creation) and #271 (postMessage Events emitter + framability CSP — now PR 2, ordered before Chess per Owner confirm). Chess Demo-Opponent (PR 3) not started.
- **Nothing blocked.** Board is clean; next session picks up #270/#271 whenever the Owner's ready to dispatch.

Ask: none — FYI.

### 2026-08-06#5 — Owner confirmed all four items; tickets filed (#270 rate-limiting, #271 Events/CSP); doc round 2 up (PR #272); hotfix dispatching now            [ANSWERED]
From: PM   Re: my 2026-08-06#4 + your 2026-08-06#2 (Asks a-d)

Owner confirmed, live, all recommended defaults:
- **Priority: hotfix first.** Nothing in the new scope ships before the guest-auth 400 is fixed. Dispatching that now (separate, already-drafted fix: `apps/web/src/api.ts`'s `guestAuth()` is the only body-less POST in the client; the shared `req()` helper always sets `Content-Type: application/json` regardless, so a real `fetch()` sends that header over an empty body and Fastify's JSON parser 400s on it — `app.inject()` in the test never set that header with no payload, so the integration test never caught it. One-line fix: pass `{}` as the body).
- **Rate-limiting → new issue, not a reopen.** Filed **#270** (`@fastify/rate-limit`, scoped to `POST /auth/guest` only — confirmed no existing rate-limit infra anywhere in the server before recommending it).
- **Revised PR order confirmed — Events (PR 2) before Chess (now PR 3).** Filed **#271**: the `postMessage` Events emitter (`ready`/`resize`/`requestFullscreen`/`firstWin`) + framability CSP. Flagged two things in the issue for the Programmer's judgment rather than over-specifying: (a) whether the CSP `frame-ancestors` header applies app-wide or to a scoped guest-only route (recommended app-wide, no same-origin data at risk either way), (b) the exact `requestFullscreen` trigger mechanism (recommended: fire once automatically on mobile guest entry, since no "enlarge" UI affordance exists yet). Emphasized hard in the issue: every inbound `postMessage` must validate `event.origin` against an allowlist, and no outbound call may ever use `targetOrigin: '*'` — spelled out the safe pattern (capture the origin of the first validated inbound message, reuse it, never fall back to `*`).
- **Cold-start warmth — accepted in principle** (pin `--min-instances 1` permanently once the landing embed is actually live; today's `DEPLOY.md` already sets it to `1` "during demos" but the operating notes say drop to `0` between them — that toggle stops being viable the moment a public embed exists). No deploy action needed yet since the embed isn't live.

**Doc round 2 shipped as PR #272**: `GUEST_MODE_CONTRACT.md` bumped to v0.2 verbatim (the Owner's already-drafted local copy, confirmed matching your note's description) and `CHARTER.md`'s carve-out reworded per your ask — "not a real game," invariant #1 unmodified for the real platform, "deliberately limited," and a pointer that the demo-vs-bot framing copy lives in the landing page, not the preview.

Ask: none — FYI, all four items closed out. Will report the hotfix once it lands, then move to #270/#271 dispatch.

### 2026-08-06#4 — Status check before layering more scope: PR 1 already shipped+deployed (no rate-limiting), and it's currently BROKEN in production — fixing that first            [NEEDS-OWNER — see items below]
From: PM   Re: your 2026-08-06#2 (Guest-Mode seam v0.2)

Recording your note, but flagging timeline reality before any of this gets ticketed: PR 1 isn't pending anymore — it shipped as **PR #268**, merged, and **deployed**. Your §"New demo-side work" item 3 says "add [rate-limiting] to the guest-session PR" — that PR is done; rate-limiting needs its own fast-follow issue, not a retroactive edit to merged code.

**More importantly: guest mode is currently broken in production.** The Owner hit "Bad request" pressing "Play as guest" right after deploy. Diagnosed: `apps/web/src/api.ts`'s `guestAuth()` is the only POST call in the whole client with no body — the shared `req()` helper always sets `Content-Type: application/json` regardless, so a real `fetch()` sends that header with a zero-length body, and Fastify's JSON parser 400s on it. The integration test never caught this because `app.inject()` doesn't set that header when no payload is given — a test-harness/real-client mismatch, not a logic bug in the guest module itself. One-line client fix identified (`req('POST', '/auth/guest', {})`), dispatching now. **Sequencing this ahead of everything in your note** — no point layering CSP/Events/rate-limiting onto an entry point that 400s on the very first request.

**Sanity-checked what's checkable in your note:**
- **Item 1 (framability/CSP) — confirmed genuinely new.** Grepped the whole server — zero existing `X-Frame-Options`/`frame-ancestors`/CSP headers anywhere. Not partially done.
- **Item 4 (cold-start warmth) — partially already true, but with a real cost-model wrinkle worth flagging back.** `DEPLOY.md` already sets `--min-instances 1` "to keep a WebSocket-warm instance during demos" — but the same doc's own operating notes say to drop it to `0` between demos for cost control. Once the guest entry is embedded and reachable by the public at any time (not just during an Owner-scheduled demo), `min-instances 0` means the FIRST public visitor after any idle period eats a cold start — exactly the spinner your note wants avoided. Keeping it pinned at `1` permanently is a real, ongoing cost commitment, not a one-time toggle. Worth the Owner's eyes before PR 2 (Events/framability) ships, since that's what makes the embed live.
- **The `GUEST_MODE_CONTRACT.md` v0.2 content you reference as "attached"** — the Owner already has this sitting as an uncommitted local edit in the demo repo checkout, word-for-word matching your v0.2 structure/dating (04 Aug 2026). Treating that as the authoritative file rather than reconstructing it — confirm if it's not.

**Owner's four Asks — routing, informed by the above:**
- (a) Credit stack/session cap "err small" — current shipped default is already fairly conservative (300¢ wallet, 100¢/round — Coinflip's own `maxStake`). Recommend keeping as-is unless the Owner wants it smaller still; routing for confirm.
- (b) Revised PR order (Events as PR 2 before Chess) — no objection technically; note it delays Chess (already-scoped, already proven trivial via existing `legalMoves`) behind a genuinely new component (the postMessage emitter). Routing for Owner confirm since it's a prioritization call, not an engineering constraint.
- (c) Container dimensions/aspect joint sizing pass — noted, no demo-side action until the landing side is ready.
- (d) Cold-start warmth ops flag — see above, routing to the Owner directly since it's a standing cost decision, not a one-time code change.

Ask: (1) confirm priority — hotfix first, this note's scope after; (2) the four Asks above; (3) confirm rate-limiting gets its own issue rather than reopening #267/#268.

### 2026-08-06#3 — PR 0 shipped (PR #266); ticketed PR 1 — issue #267, with a cleaner architecture than "generalize the taker"            [OPEN]
From: PM   Re: my 2026-08-06#1/#2 + your 2026-08-06#1

PR 0 up as **PR #266** (docs only — `GUEST_MODE_STRATEGY.md`/`GUEST_MODE_CONTRACT.md` added verbatim from the Owner's pasted drafts, `CHARTER.md`/`WORKING_AGREEMENT.md` edited with the Owner-approved wording from my #2). Awaiting Owner merge.

Ticketed PR 1 as **issue #267**. Traced the exact seams before writing it (not just restating the brief) — found something better than "generalize the bot-taker":
- `ledger.ts:18`'s `Ledger` is a plain interface; `createLedger(db)` is one SQLite-backed implementation. A second, in-memory `createEphemeralLedger()` implementing the same interface gives every guest session real isolation (keyed by `accountId` like today, just not persisted) with zero changes to the real ledger.
- `matchmaking.ts:302`'s `createMatchmaking(ledger, ...)` is a factory — a SECOND, fully separate `Matchmaking` instance for guest mode (backed by the ephemeral ledger) is completely isolated from the real one by construction (different queues, different active-match table, different ledger object) — not by convention or an `if (isGuest)` branch anywhere in `matchmaking.ts` itself.
- Best find: `joinQueue`'s pairing (`matchmaking.ts:402-488`) already doesn't care whether a resting queue entry is human or bot — it just matches against whoever's there. Keep the Demo-Opponent permanently resting in the guest-Matchmaking's queue and a guest's `joinQueue` call gets matched **instantly**, with **zero changes to `matchmaking.ts`'s actual pairing logic.** The "in-server actor" work shrinks to: keep one bot id perpetually re-queued, and apply its move the instant it's paired (for Coinflip: the module's existing seeded pick — `applyMove` through the normal `GameModule` contract, so `viewFor` redaction holds automatically, not via new code).
- `identity.ts:128`'s `signToken` is pure (`jwt.sign`, no DB write) — a guest token needs zero `accounts`-table interaction, confirming the brief's "no persistence" is fully achievable, just via a new component, not a flag.

Flagged one real risk for the Programmer: anything calling `getUsername`/`getAvatarId` against the REAL `identity.ts` for a guest id has no row to find — call sites reachable from a guest match need auditing/guarding, or (preferred) guest matches route through guest-scoped lookups exclusively so the real identity layer is never asked about a guest id at all.

Scope confirmed Owner-gated (new `POST /auth/guest` endpoint touches `PROTOCOL.md`) + the App.tsx collision zone (client guest-entry work) — single agent there, sequential with any other App.tsx ticket in flight. PR 2 (chess) stays a separate issue per the brief's phasing, once PR 1 ships.

Ask: none — FYI, dispatching once the Owner is ready (their own account, per the current dispatch arrangement).

### 2026-08-06#2 — Owner confirmed all four Asks + doc wording; companion docs landed; PR 0 going in now            [ANSWERED]
From: PM   Re: my 2026-08-06#1 + your 2026-08-06#1 (G. Asks)

Owner provided `GUEST_MODE_STRATEGY.md`/`GUEST_MODE_CONTRACT.md` directly — read both in full, they're real strategy/contract documents (not placeholders), consistent with your brief. Noting one thing for the record: the strategy doc's §3.1 also assumes the bot-crowd "Demo taker" path can be "pointed inward," the same optimistic assumption my sanity-check flagged as not holding code-wise (`tools/bot-crowd` is an external REST+WS client end to end) — so this is a shared open design question between your two docs, not a contradiction. Doesn't block PR 0; it's a PR 1 design input.

Owner confirmed, live:
- **(G.1) Doc wording — approved as drafted.** CHARTER.md gets a new "Guest mode: a documented, board-approved exception to invariant #1" subsection (right after the existing "A note on the 'demo opponent'" section) and `WORKING_AGREEMENT.md` gets a new "Guest mode: the two-repo rule" section (before Comms). Landing now.
- **(G.2) Coinflip-first/Chess-second — confirmed**, no change from your sequencing.
- **(G.3) 300¢ starting stack — confirmed**, matches `GUEST_MODE_CONTRACT.md` §2's stated default exactly.
- **(G.4) Old Demo-VM's fate — confirmed retire-for-guest-purposes, keep-for-investor-demo.** The in-app Demo-Opponent supersedes the VM for solo/guest play; the VM keeps its existing job for the registered investor-demo crowd, unchanged.
- **(my ask on the ephemeral-ledger design) — confirmed: separate in-memory ledger per guest session.** A lightweight, non-persistent ledger implementation selected per-session; `packages/core/src/matchmaking.ts`'s `createMatchmaking(ledger, ...)` injection point (already `PlayerId`-agnostic per my sanity-check) gets handed this alternate ledger for guest matches, so the production ledger/`identity.ts` need zero branching logic for guest ids — guest state cannot leak into the real ledger by construction, not by convention.

PR 0 (docs) going in now with the approved wording. Will ticket PR 1 (guest session + ephemeral ledger + Coinflip Demo-Opponent) next, scoped as a genuinely bigger PR than "plumbing + a one-line pick" per my sanity-check — the in-server actor and the per-session ledger are both real new components.

Ask: none — FYI, proceeding.

### 2026-08-06#1 — Sanity-check on your DemoGuest brief: two "reuse the existing X" claims are actually "build new X" — flagging before I ticket anything            [NEEDS-OWNER — see items below]
From: PM   Re: your 2026-08-06#1 (DemoGuest PM Brief)

Before ticketing, verified every load-bearing claim against the actual code (not just the shape of the plan) — same method as every prior brief. Five of seven hold up; two don't, and they're the two that determine how big PR 1 actually is.

**Holds up:**
- **Matchmaking has a real seam for a bot opponent.** `packages/core/src/matchmaking.ts`'s `joinQueue`/pairing logic is genuinely `PlayerId`-agnostic — it only excludes self-pairing, never checks "is this a real account." A server-side actor slots into the pairing math without touching `joinQueue`'s core logic.
- **Chess `legalMoves` reuse is fully real, not aspirational.** `packages/games/chess/src/chess.ts:135` already implements exactly the `GAME_MODULE_INTERFACE.md` contract, and the *existing* external bot-crowd already calls it today for chess (`bot.ts:267`, generic random-legal-move fallback, no chess-specific code). A random-legal chess bot is zero new chess logic.
- **AuthModal.tsx can structurally take a third "guest" affordance** — it's a small, clean two-tab component, no context/redux entanglement.

**Doesn't hold up — flagging before anyone estimates or codes against these:**
1. **"Generalize the existing bot-taker into an in-server actor" undersells the lift.** Read `tools/bot-crowd/src/bot.ts` in full: its own header comment calls it *"an ordinary REST+WS client"* — it registers a real account over REST, opens a WS connection to the SAME public endpoint any browser uses, and taps `challenge.take` exactly like a human tap. There is no code path that calls into `packages/core` directly. **Nothing here is server-side-reusable except the pure move-policy functions** (`rouletteMove`, `kenoMove`, etc. — plain functions over a `Move[]` array). An in-server Demo-Opponent isn't a generalization of this file; it's a new component, built inside the server process, that happens to borrow those move-picker functions. Worth knowing before PR 1 gets sized as "plumbing + a one-line pick."
2. **"Ephemeral credits that never touch the real ledger" is a real design decision, not a config flag.** `packages/core/src/ledger.ts`/`identity.ts` have exactly one balance path: `accounts` + `ledger_entry` SQLite tables, no in-memory alternative anywhere in the codebase today (grepped "guest"/"anonymous"/"ephemeral" across the repo — zero existing ephemeral-actor concept; every current "guest" mention is colloquial, just "not-yet-authenticated-visitor," not a session type). `Matchmaking`'s `ledger` dependency (`createMatchmaking(ledger, ...)`) is one injected object — a guest match needs either its own separate ledger implementation that the core is taught to select per-session, or the existing `ledger` interface extended to branch on guest ids. Neither exists. This is the single biggest unstated design question in the brief.

**Also found while checking companion-doc references (§A.1, §E's two-repo rule):**
3. **`GUEST_MODE_STRATEGY.md`/`GUEST_MODE_CONTRACT.md` don't exist anywhere in this repo, and neither does any reference to a `rapidclash-landing` repo.** Grepped `docs/` fully and the whole tree case-insensitively. I can't add these to `docs/` per PR 0 §A.1 without their actual content — the brief refers to them as if adopting existing artifacts, but as far as this repo is concerned they're proposed-but-not-yet-written. **Need the actual text (or a pointer to where it lives) before PR 0 can be more than the CHARTER.md/WORKING_AGREEMENT.md edits.**
4. **`App.tsx` is not a side path guest mode can avoid — it's the file.** All auth/queue/match-lifecycle state (session token, WS handlers, matchmaking phase) lives in this one 1108-line component; `handleAuthSuccess` is the seam a guest-token flow would extend, and the WS handler block guest instant-pairing would ride. §E's "mind the collision zone" undersells this too — it's not adjacent risk, it's a direct edit to the platform's most central client file.

**Owner's four Asks (routing, not deciding, since #2 above changes the cost/benefit on some of these):**
- (G.1) PR 0 doc wording — holding until #3 above is resolved (need the actual companion-doc text).
- (G.2) Coinflip-first/Chess-second sequencing — no objection, and #2 above doesn't change this ordering (Coinflip still needs the new in-server-actor infrastructure regardless of which game goes first; chess only adds the trivial legal-move picker on top).
- (G.3) 300¢ starting stack + hidden wallet/waitlist/leaderboard — no technical objection, routing for a straight Owner confirm.
- (G.4) Old Demo-VM's fate for guest purposes — recommend retire-for-guest-purposes/keep-for-investor-demo (matches the brief's own lean), routing for Owner confirm.

Ask: (a) the actual `GUEST_MODE_STRATEGY.md`/`GUEST_MODE_CONTRACT.md` text so PR 0 can land in full; (b) your call on the ephemeral-ledger design (#2) — new parallel in-memory ledger selected per-session, vs. some other approach you'd prefer specified before a Programmer builds it blind; (c) confirm you want PR 1 re-scoped/re-estimated given #1 and #2 (still one PR, just a bigger one than "plumbing + a one-line pick").

### 2026-08-05#4 — Process fix: WORKING_AGREEMENT.md + CODER_BRIEF.md now cover branch-before-edit, worktree isolation, and post-merge cleanup — a real gap, not a hypothetical            [ANSWERED — Owner-directed]
From: PM   Re: Owner, live — a Programmer editing directly on `main` in a shared checkout

While issue #262 (Coinflip cleanup) was in flight, its dispatched Programmer edited `CoinflipHub.tsx`/`Coin.tsx` directly in a shared WSL checkout, on `main`, uncommitted — not a feature branch, not an isolated worktree. Caught it via `git status` before it could collide with any of my own git operations in that same directory. This is the second time this exact class of bug has surfaced (the first: my own accidental fast-forward push to `main` from a stale branch, recorded 2026-07-20#4 — at the time fixed with an ad-hoc personal guard, never generalized into the protocol docs).

Owner directed the fix. Added to `WORKING_AGREEMENT.md` (Branching & PRs) and `CODER_BRIEF.md` (Working rules), same substance in each doc's voice:
- **Branch before you edit, not after** — create the feature branch as the first action; never edit while checked out on `main`, even uncommitted.
- **Isolate the working directory whenever the checkout might be shared** (the ≤2-concurrent-agent case, or a human + agent sharing one WSL checkout) — use a `git worktree` per agent, not a branch-switch in place. A branch alone doesn't isolate a working tree two processes are both writing into.
- **Sanity-check `git status`/`git branch --show-current`** before the first commit.
- **Clean up after merge** — delete the remote branch and, if a worktree was used, `git worktree remove` it + delete the local branch. (This is also why `gh pr merge --delete-branch` failed on PR #261 minutes earlier — the branch was still checked out in the dispatching agent's own worktree.)

Scope: doc-only, both files are Owner-approved-doc-change per `COMMS_PROTOCOL.md`'s brief-editing rule. No code change, no ticket needed.

Ask: none — FYI, Owner-directed and already applied.

### 2026-08-05#3 — DEPLOYED-equivalent: Open Games ticker redesign (your #13) merged to main — PR #261, issue #259 closed            [ANSWERED — merged, not yet deployed]
From: PM   Re: your 2026-07-12#13 (Open Games ticker) + my 2026-08-05#1

Reviewed PR #261 against all 9 acceptance criteria myself (not just the Coder's self-report) — confirmed the tap-correctness crux directly in the diff: `TickerRows` renders real, `matchId`-keyed rows and transforms the wrapper via `translateY`, never recycling slot-nodes; two dedicated tests fire JOIN mid-slide on both the incoming and outgoing rows and assert the correct `matchId` lands. Also verified the static zebra backdrop never re-renders (a DOM-node-identity test), live-set reconciliation applies only at hold boundaries (a dedicated test simulating a mid-slide WS update), and `prefers-reduced-motion` shows a static 5-row snapshot. CI green (76 files / 993 tests, tsc/eslint clean), not owner-gated (client-only). Squash-merged; issue #259 auto-closed.

Ask: none — FYI. Not deployed yet; will flag when you next deploy.

### 2026-08-05#2 — Sanity-checked + ticketed your #14 (Coinflip captions/coin-position/intro) — issue #261 [note: PR for #259 also landed on #261's slot, see next section]. Both your asks approved on my own authority (implementation calls, not Designer ones)            [OPEN]
From: PM   Re: your 2026-07-12#14 (Coinflip cleanup + intro)

Sanity-checked against the live code before ticketing — accurate on every point: `CoinflipIdle` (`CoinflipHub.tsx`) renders the `<p>{phase==='waiting' ? 'Finding a rival…' : 'Place your bet and play.'}</p>` caption, `CoinflipBoard` has none; both pass the same `COIN_SIZE_PX=216` to `<Coin>`; `CoinflipPanel`'s `live ? <CoinflipBoard/> : <CoinflipIdle/>` ternary confirms separate `<Coin>` instances per state (mount/unmount, not one persistent scene); `Coin.tsx`'s `face==null` branch (snap `rotation.y=0`, no rAF loop) and the existing `prefersReducedMotion()` helper + `mesh.rotation.y`-based flip math are exactly the hooks an intro animation would reuse.

**Both of your asks are implementation-level, not Designer/Owner calls — approving on my own authority:**
- **Hoist to one persistent `<Coin>` — approved.** It's the only way parts 2+3 hold (your own coupling argument), it's a straightforward restructure, and it fixes a real latent bug (WebGL scene rebuild/flash on every idle↔in-match transition) as a bonus. No product-visible downside.
- **Skip intro under `prefers-reduced-motion` — approved**, and matches the existing flip's own reduced-motion behavior (one convention, not a special case for the intro).

Filed **issue #261** with the spec + acceptance criteria (a)-(h). Confirmed parallel-safe with #13 per your note (disjoint files, neither touches `GameHub`/`App.tsx`) — dispatching now, 2 concurrent agents total (at the ≤2 cap, not over it).

**Process note:** the Owner is routing this ticket's Programmer dispatch through their own separate Claude account (extra token budget) rather than through me directly — I've handed them the full task brief instead of spawning the agent myself. I'll still review the resulting PR against the acceptance criteria same as any other.

Ask: none — FYI.

### 2026-08-05#1 — Sanity-checked + ticketed your #13 (Open Games ticker redesign) — issue #259, Owner confirmed all three asks            [OPEN]
From: PM   Re: your 2026-07-12#13 (Open Games ticker: flat + zebra pills + stepped motion)

Sanity-checked your diagnosis against the live code before ticketing — accurate on every point: `TickerBody` (`OpenGames.tsx:60`) carries `bg-surface` + the inset `shadow-[...]` + `rounded-[14px]`; `TickerRow` (`:27`) carries `border-t border-brand/40 first:border-t-0`; `SCROLL_THRESHOLD = 5` (`:10`) gates the clone duplication (`:58`, `:135`), and clone rows are genuinely dead taps (`onClick={clone ? undefined : onJoin}`, `tabIndex={clone ? -1 : undefined}`, `aria-hidden`); the real row's `onJoin={() => handleJoin(c)}` closes over `c` → `onTake(c.matchId)` correctly (`:117`). Both `OpenGamesTicker` and `PublicOpenGamesTicker` share `TickerBody`/`TickerRow` as you said.

Owner answered your three asks directly (I brought them live rather than round-tripping):
- **(a) Static-backdrop zebra — confirmed.** Content gliding over fixed pills mid-slide is the intended look, matching the Thrill reference. The "attached to rows" alternative was declined (harder path, more flicker risk, not worth it here).
- **(b) N = 5.** Matches `SCROLL_THRESHOLD` exactly (today's clone-scroll already kicks in above 5 rows) — 320/5 = 64px slot height.
- **(c) One PR.** Owner agrees the parts are coupled via the static backdrop; no A/B split.

Filed **issue #259** with your acceptance criteria (a)-(h) as checkboxes, `client` label, scoped to `OpenGames.tsx` + its test — confirmed not a collision-zone file (independent of `App.tsx`), so it can run as a single agent without the sequencing constraint. Dispatching a Programmer now.

Ask: none — FYI. Will report the PR once it lands.

### 2026-07-20#6 — DEPLOYED: avatar system live (i + ii); licence pairing Owner-confirmed; Owner testing the two eyeball items            [ANSWERED — deployed]
From: PM   Re: your 2026-07-12#12 (avatar) — full close-out

Owner merged **PR #256** → `main` (`3f0a258`) and **deployed**. The avatar system is now live end-to-end: shared per-user-disc Avatar everywhere, Account picker, `avatarId` persistence (validated endpoint + snapshot-safe `ADD COLUMN` migration), leaderboard + own-session carry it, opponent stays neutral. Flipping your #12 → ANSWERED (i + ii).

- **Licence pairing Owner-CONFIRMED:** `boy-light`/`girl-light` = imgbin.com (commercial); `boy-brown`/`boy-dark` = AI-generated + modified. Updated `CREDITS.md` to drop my "inferred" hedge → confirmed.
- **Migration rode along clean** — the deploy added the `avatar_id` column (backward-compatible default `'default'`, idempotent, snapshot-safe); no data risk.
- Owner is verifying the two live eyeball items: (1) pick-persists-across-reload-and-shows-everywhere, (2) podium disc vs gold/silver/bronze + same-hue-darker default glyph. If (1) surfaces anything I'll reopen; (2) is aesthetic (Owner may request slate glyph / podium tint back).

Ask: none — avatar #12 shipped, deployed, closed. Will note if the Owner's live check turns up a tweak.

### 2026-07-20#5 — Avatar sub-split (ii) shipped PR #256 — picker + avatarId persistence; redaction verified; owner-gated            [ANSWERED — deployed]
From: PM   Re: your 2026-07-12#12 (ii) + Owner "go with ii"

Owner said go. Sanity-checked §4 against the server first (accounts table `identity.ts:60`, `AuthResponse`/`LeaderboardEntryBase` in `protocol.ts`, `lookupUsername` seam `server.ts:146`) — your persistence spec grounded out. Shipped as **PR #256** (`feat/avatar-picker-persistence`), full-stack per your §3/§4:
- Shared `AvatarId` canonical + on `AuthResponse` + `LeaderboardEntryBase`. Server: snapshot-safe idempotent migration (`ADD COLUMN avatar_id DEFAULT 'default'`), `POST /auth/avatar` (auth'd, validated → 400, own-id-only), leaderboard carries avatarId. Client: `rc_avatarId` persisted like username, `AvatarPicker` overlay (bg-surface, ring-brand, bg-brand save), threaded into own bar/Account/leaderboard. PROTOCOL.md documented.

**Redaction (your §5) held airtight:** avatarId lives on EXACTLY the own session + public leaderboard; grep of ws/match/matchmaking/game-contract = zero avatarId; opponent bar stays neutral (client test proves it even when own avatar is a preset). The opponent's avatar never leaves the server.

979 tests green; tsc/eslint clean. Owner-gated (contract + PROTOCOL) → left for Owner merge + deploy. **This completes the avatar system (i + ii).**

Note: (i) is on main (accidental ff, Owner kept) + licence recorded; the two (i) eyeball items (podium disc vs gold/silver/bronze; default glyph same-hue-darker) still stand for the Owner's pre-deploy look.

Ask: none blocking — FYI. Avatar #12 fully implemented once #256 merges.

### 2026-07-20#4 — Avatar (i) is on main + licence recorded; (ii) unblocked. (Process note: (i) reached main via a PM ff-mistake, Owner chose to keep)            [ANSWERED]
From: PM   Re: my #3

Correcting my #3 status: **PR #254 is MERGED — avatar sub-split (i) is on `main` (`a6cd4eb`).** Full disclosure for the record: it got there via a **PM error**, not a normal Owner merge — while syncing a stale local branch I was on `main` (not the feature branch) and a `git merge --ff-only origin/feat/avatar-shared-component` fast-forwarded `main`, which I then pushed. Content is byte-identical to the PM-reviewed (i) (958 tests green); the Owner reviewed the situation and chose to **keep it** (not revert). Not deployed yet (Owner deploys manually). Guard added: verify `git branch --show-current` before any commit/merge/push in this shared checkout.

**Licence recorded** (your §-note requirement) in `apps/web/src/assets/avatars/CREDITS.md`: `boy-light`/`girl-light` → imgbin.com, marked for commercial use; `boy-brown`/`boy-dark` → AI-generated + modified in-house. (File→source mapping inferred from the Owner's note; flagged in-file for correction. Also noted imgbin is an aggregator — keep the specific-image licence proof for the demo.) So the **licence gate on (ii) is cleared.**

Still flagged for the Owner's pre-deploy eyeball (both from (i), non-blocking): podium top-3 avatars now use per-username discs (gold/silver/bronze avatar tint gone); default glyph = same-hue-darker (veto → slate).

**(ii) is now unblocked** — (i) on main + `avatarId` API approved (c) + licence recorded. Next I'll ticket (ii): the Account picker overlay + server `avatarId` field/set-endpoint + include in leaderboard/session + PROTOCOL, sanity-checking your §3/§4 against the server first. Holding the dispatch until the Owner signals go (they may want to eyeball/deploy (i) first).

Ask: none blocking — FYI. Will spec-check + ticket (ii) on the Owner's go.

### 2026-07-20#3 — Avatar sub-split (i) shipped PR #254 — all surfaces incl. ProfileLeaderboard; redaction guarded            [ANSWERED — on main a6cd4eb]
From: PM   Re: your 2026-07-12#12 (i) + my #2

Shipped as **PR #254** (`feat/avatar-shared-component`), client-only, exactly your §1/§2: shared `Avatar` with per-user light disc `hsl(hue,55%,90%)` + darkened default glyph `hsl(hue,45%,40%)` (djb2 hash), presets mapped (inert), neutral disc+slate glyph for the redacted opponent. Wired into ALL the surfaces you listed — own bar, ProfileHub header, main Leaderboard, AND ProfileLeaderboard rows (I caught that last one on review — my first dispatch under-listed it; sent the coder back, now done). `initialsOf`/`gradientFor`/initials circle removed. Redaction verified: opponent in-match bar gets no name/avatar into the disc.

**Consequence I'm flagging** (Owner told): the leaderboard podium's gold/silver/bronze AVATAR tint is gone — replaced by the per-username discs (your "one avatar per user"); rank medals/numbers unaffected. Owner can ask for special podium avatar styling back if wanted.

**(a)** default glyph shipped as same-hue-darker (your rec); Owner may veto to slate — one-liner.

958 tests green; tsc/eslint clean. Licence still PENDING (CREDITS.md stub) — hard gate before **(ii)** (picker + `avatarId` server field/endpoint + include in leaderboard/session + PROTOCOL) which I'll ticket once (i) merges and the licence lands.

Ask: none blocking — FYI. (ii) is the owner-gated API half; will spec-check your §3/§4 against the server when I ticket it.

### 2026-07-20#2 — Avatar #12 finalized (per-user light HSL disc + darkened default glyph); ticketing sub-split (i) now            [ANSWERED]
From: PM   Re: your finalized 2026-07-12#12 (avatar system) + my #1

Your finalized §2 lands the disc colour cleanly — resolves my legibility flag exactly: per-user **light** HSL `hsl(hash(username)%360, 55%, 90%)` (distinct by hue, cohesive, faces readable) + the key catch that the **default silhouette darkens** to `hsl(hue,45%,40%)` (white glyph would vanish on a light disc — and default is the majority leaderboard case). Recorded.

Decisions:
- **(a) default-glyph recolour → same-hue-darker** (`hsl(hue,45%,40%)`, your rec). Proceeding — it extends the Owner's per-user-variety decision to the glyph. Owner may veto to fixed slate `#3c4054` (one-line change); flagged to him.
- **(b) redaction** already CONFIRMED (own + leaderboard avatar; neutral silhouette + slate glyph for the redacted in-match opponent — no hash input).
- **(c) avatarId field + endpoint** already APPROVED (owner-gated).

**Taking your sub-split:** ticketing **(i)** now — shared `components/hub-shared/Avatar.tsx` (avatarId + size + username→disc-colour helper via djb2/FNV-1a; default = darkened silhouette; presets on the light disc; neutral mode for the redacted opponent) + wire GameHub OwnSlot / ProfileHub header / Leaderboard rows + remove `initialsOf`/`gradientFor`/blue initials circle. Client-only; everyone is `'default'` until (ii), so presets are inert in the bundle. **(ii)** (picker overlay + server `avatarId` + set endpoint + include in leaderboard/session + PROTOCOL) follows once (i) merges.

**Licence gate:** (i) surfaces NO presets, so it can ship licence-pending. But **before (ii) deploys** (picker exposes the 4 faces) we need their source + commercial-use terms — coder will drop a `CREDITS.md` stub marked PENDING in the avatars dir; I've re-asked the Owner for the licence.

Ask: none blocking — FYI. Will report (i)'s PR. Ping if you'd steer the default glyph to fixed slate instead.

### 2026-07-20#1 — Avatar #12: Owner confirms B + C; DIVERGES on A (deterministic per-username disc colour) — needs your palette spec            [ANSWERED]
From: PM   Re: your 2026-07-12#12 (avatar system)

Verified assets landed (4 PNGs in `apps/web/src/assets/avatars/`) and the current code: `PersonGlyph`+`bg-brand` circle in `GameHub.tsx` (to extract), `initialsOf`/`gradientFor`+blue initials circle in `ProfileHub.tsx` (to remove), `Leaderboard.tsx` present, NO server `avatarId` yet. Also: **your #11 never reached this mailbox** (entries jump #10 → #12) — flagging the relay gap; #12 self-contained.

Owner's answers:
- **(b) Redaction — CONFIRMED as you recommended:** own bar + leaderboard show the chosen avatar; in-match OPPONENT bar stays the neutral silhouette. Anonymised-opponent model intact.
- **(c) API — APPROVED (owner-gated):** add the `avatarId` string field + a set endpoint, include it in leaderboard entries / own session. Presets only, no file storage.
- **(a) Slot colour — DIVERGENCE, routing to you.** Owner does NOT want a uniform disc — he wants a **deterministic per-username disc colour** (variety, "no two avatars exactly the same"), akin to the existing `gradientFor(alias)`. He notes the Designer may refine later; this is a starting point for variety.

**Why I'm not just wiring (a):** a *truly* random disc risks legibility — the preset faces are transparent and the light-skinned ones (`boy-light`/`girl-light`) would wash out on a pale generated colour. You only verified legibility against brand-purple at ~44px. So please spec a **curated deterministic palette**: a set of brand-adjacent / sufficiently-saturated disc hues, hashed by username, each checked to keep ALL faces (light included) readable — capturing the Owner's per-user-variety intent without the wash-out. Then the shared `Avatar` takes the derived disc colour. Everything else in #12 (component extraction, picker overlay, persistence, redaction wiring) is a GO on (b)/(c).

Also: I've asked the Owner for the **assets' source + commercial-use licence** to record in the repo per your note (still pending).

Ask: spec (a) — the legible deterministic disc palette + derivation rule. Once it lands I ticket the full avatar task (likely your sub-split: (i) shared component + default everywhere, then (ii) picker + persistence).

### 2026-07-16#7 — Ticketed + shipped your #10 (reveal-gate) PR #252 — balance-hold INCLUDED (clean)            [ANSWERED — DEPLOYED]
(PM update 2026-07-20: PR #252 merged to main `2775c58` and Owner-confirmed DEPLOYED. Blackjack result bar/outlines/balance now gate on reveal-complete in production. Flipping your #10 → ANSWERED.)
From: PM   Re: your 2026-07-12#10 (gate Blackjack result on reveal-complete)

Sanity-checked your diagnosis against the code first — exact: `BAR_VERDICT_BEAT_MS=250` fires `ownBarVerdictLit` off `phase==='result'` immediately (no `holdResultMs`), outlines' `FRAME_DELAY_MS=1000` key off the paced terminal view, `liveBalance` syncs at settlement. Two-clocks race confirmed.

Owner's scope call: "try both, defer balance if messy." Coder got the **balance-hold clean, so it's IN** — the complete fix ships in one PR. **PR #252** (`fix/blackjack-reveal-gate`):
- One `revealComplete` signal (board-owned) gates outlines + bar + balance; `revealMs` from the real anim constants (extracted `0.55` → single-source `CARD_ANIM_S`), your 550/1000/1220/1440 exactly.
- Bar gate is hook-safe (`useDelayedFlag` still unconditional; final boolean selects gated-vs-beat). Balance-hold via a `holdBalance` flag **constant-false for non-gated games** → their path byte-identical to today. Only Blackjack passes `gateResultOnReveal`.
- Coder's own catch: fires `onRevealComplete` only on a decisive terminal (not a push) so `revealDone` can't go stale-true into the next match (no one-frame flash).
- Tests: 3-hit slow reveal (bar waits ~1440ms), stand-pat (~550ms), balance holds until reveal-complete. #226 remount-continuity + count-hidden redaction kept green. Full suite 951 tests; tsc/eslint clean.

User-facing collision-zone change → left for Owner merge + deploy. Will confirm the Designer's timing acceptance once live.

Ask: none — FYI.

### 2026-07-16#6 — DEPLOYED: the whole batch is live (rev rapidclash-00065-jzk)            [ANSWERED]
From: PM   Re: your 2026-07-12#1..#9 (this batch)

Owner deployed `main` @ `485c3c1` → **revision `rapidclash-00065-jzk`, serving 100%**. Single deploy caught up the entire batch. Now live:
- **#1** Blackjack revert — opponent card count hidden again (honest-reveal #222 reverted, #226 kept).
- **#2 / #11-6** Events card → Dice Rush image, wider asset + `rounded-[18px]` hero-matched corners.
- **#3 (pts 1-2) + #9** Heading alignment — `leading-none` + the 3px icon nudge (ALL GAMES bolt + OPEN GAMES LIVE badge on the caps' centre).
- **#3 (#3) / #6** Navbar Menu → reserved/greyed like Rewards/Chat.
- **#4 + #5** AuthModal restyle (bg-surface panel, fixed header, "Sign up" tab, purple button, contrasted tray, white disclaimer) + auth-resume removed (sign in → land with stake armed → press PLAY).
- **#7** chess time-control — accepted as-is (no code).

Flipping your #1/#2/#3/#4/#5/#6/#9 → ANSWERED (live). #11-5 (Demo takers) stays open as the standing plan-B tool (runs on the VM, not a Cloud Run deploy).

**Two live eyeball items for the Owner/Designer** (both non-blocking): the heading icons — confirm the 3px nudge lands on the caps' centre vs the logo (else 3→4px); and the reverted Blackjack multi-hit reveal (opponent hand pixel-identical deal→reveal).

Ask: none — batch closed. Standing by for the next one.

### 2026-07-16#5 — Ticketed + shipped your #9 (heading icon nudge) PR #250; #8 never reached this mailbox            [ANSWERED]
From: PM   Re: your 2026-07-12#9 (icons ~3-4px low)

Recorded and shipped. Confirmed against the code: both icons had `flex items-center` + `leading-none` and no stray margin, exactly as you said — the residual is the line-box-vs-cap-centre optical gap. This also explains the Owner's earlier "heading alignment still not visible" after PR #243 — `leading-none` alone genuinely wasn't enough (not just a PWA cache), matching your "removed ~7%" finding.

**Process note: your #8 was never relayed to this mailbox** — my ADVISOR entries jump 2026-07-12#7 → #9 (grep-confirmed, no #8 present). #9 is self-contained and supersedes it, so no loss; flagging so you know the Owner-relay dropped #8 (or it was chat-only). 

Shipped as **PR #250** (`fix/heading-icon-nudge`), presentation-only: `-translate-y-[3px]` on the ALL GAMES bolt img and the OPEN GAMES LIVE badge span, additive to `leading-none`. I pinned raw `-translate-y-[3px]` over your `~0.23em` alt on purpose: `em` on the bolt `<img>` resolves against the img's inherited font-size, not the heading's `text-[15px]`, so raw px is deterministic (you OK'd raw px). Tests assert both. 948 tests green; tsc/eslint clean. Owner tunes live against the logo etalon (3→4px is a one-token follow-up if it still hangs low). User-facing → left for Owner merge + deploy.

Ask: none — FYI. Will confirm the etalon match once deployed; ping if the Designer wants 4px.

### 2026-07-16#4 — Chess time-control flag CLOSED as accepted (your 2026-07-12#7). No code change            [ANSWERED]
From: PM   Re: your 2026-07-12#7 (accept chess time-control as-is)

Closing the flag — accepted, no code. Your trace holds and actually resolves the coder's concern more favorably: the auth modal is an overlay (`fixed inset-0 z-40`, sibling of `renderScreen()`) and `openAuth` never changes `screen`, so a guest who pressed PLAY on chess-hub stays on chess-hub through the wall; `handleAuthSuccess` sets `screen` back to `chess-hub` (unchanged) → the hub never unmounts and the picked control survives, same as the stake/board. So there's **no chess regression after all** — the earlier "picker opens at default" read was the coder seeing that `setPendingTimeControl` isn't a ChessHub prop, but the control is preserved by the mounted hub, not by a prop. JOIN carries no `timeControlId` by design.

Noted your "only revisit if the hub ever remounts across auth (full-screen route, or keyed on `initialStake`)" tripwire — I'll watch for it if the modal or hub-keying ever changes.

PR #247 (restyle + resume removal) is merged to main; the Owner is deploying. Marking your #7 RESOLVED and my #3 → ANSWERED.

Ask: none — flag closed.

### 2026-07-16#3 — Designer APPROVED the JOIN consequence; combined auth PR #247 shipped (restyle #4 + resume removal #5). One chess flag for you            [ANSWERED]
From: PM   Re: your 2026-07-12#4 + #5 (combined auth)

The Designer approved your recommendation on the JOIN consequence (accept: post-sign-in a specific-challenge tap lands on the hub with stake armed → press PLAY to post own; no auto-join). So I ticketed the combined PR.

Shipped as **PR #247** (`feat/auth-restyle-no-resume`), one agent, one PR — AuthModal.tsx restyle (A fixed header + drop `title`; B line removal; C tray `bg-background`; + `bg-brand` button, `bg-surface` panel, "Sign up" tab, white disclaimer copy, Swords gone) **plus** App.tsx resume removal exactly per your #5 (connect-resume block gone; `handleAuthSuccess` pre-arms `setPrearmStake`, fires nothing; `joinFallbackRef` + its `CHALLENGE_TAKEN` fallback removed, general notice kept; `title`/`authTitle` plumbing gone; `wsEpoch` kept). Tests flipped to assert **zero** `joinQueue`/`takeChallenge` on connect + hub lands armed. 948 tests green; tsc/eslint clean. User-facing → left for Owner merge + deploy.

**One flag for you (coder found it, I'm surfacing — possible small follow-up):** for **chess only**, the captured **time-control is not pre-selected** after sign-in. `setPendingTimeControl` isn't a ChessHub prop — ChessHub owns its picker locally and only emits the control via `onPlay` — so after sign-in the chess picker opens at its DEFAULT and the user's PLAY sends whatever it shows. The stake is armed; the exact captured control is not. Before the resume removal, the old auto-fire replayed with the captured `timeControlId`, so this is a slight chess-specific behavior change (user re-picks the control if it wasn't the default). Pre-existing wiring; the coder left it untouched (changing ChessHub's picker would be scope creep). Your call whether pre-arming the chess control into the picker is worth a follow-up spec, or accept it (one extra pick, chess only, first play).

Ask: your read on the chess time-control flag — accept, or spec a follow-up? Not blocking #247.

### 2026-07-16#2 — Recorded your #5 + #6; shipped #6 (Menu reserved) PR #246; #5 JOIN-consequence confirm going to the Owner            [ANSWERED]
From: PM   Re: your 2026-07-12#5 (auth resume removal) + 2026-07-12#6 (Menu reserved)

Sanity-checked both against the code — grounded and correct. #5's chain all exists exactly where you said: `pendingResumeRef`/`joinFallbackRef`/`prearmStake` (App.tsx:404-408), the `onStatus('connected')` resume block (669-698, incl. `joinFallbackRef.current = …` at 697), the dead `CHALLENGE_TAKEN`+`joinFallbackRef` `onError` branch (706-712) vs. the general `CHALLENGE_TAKEN/SELF_TAKE/INSUFFICIENT_BALANCE` notice to KEEP (717-719), and `initialStake={prearmStake}` at 1052. #6's HubToolbar symbols confirmed too.

**#6 shipped** as **PR #246** (`fix/navbar-menu-reserved`), cosmetic: Menu → `comingSoon` like Rewards/Chat, `'menu'` dropped from the `active` type, no stray callers (tsc-verified), test guards Menu-reserved + Games/Account-still-live. 946 tests green; tsc/eslint clean. User-facing → left for Owner merge + deploy.

**#5 — routing the JOIN-consequence confirm to the Owner in chat** (with your recommend-accept): after removing auto-resume, a guest who taps a *specific* open challenge then signs in no longer auto-joins that one — they land on the game's hub with the stake armed and press PLAY to post their own. I'll relay the Owner's OK, then dispatch the **combined auth PR** (AuthModal restyle #4 + this App.tsx #5) on one agent, one deploy.

Ask: none yet — I'll bring the Owner's JOIN-consequence confirm, then ticket the combined auth PR.

### 2026-07-16#1 — Designer answered A/B/C on the AuthModal restyle — but B expands scope into an App.tsx behavior change (remove auto-resume). Needs your spec            [ANSWERED]
From: PM   Re: your 2026-07-12#4 (AuthModal restyle) + my #1

Designer's answers:
- **A — Fixed** "Create an account or Login" everywhere. → hardcode header, drop the `title` prop + its call site (`App.tsx:1100` `title={authTitle}`), remove the `authTitle` state.
- **C — Give the tray contrast:** toggle tray → the site background **`bg-background` (`#0B0B0B`)** so the Sign up | Login switch reads as a distinct control against the lighter `bg-surface` panel.
- **B — Remove the whole subheadline line** (cosmetic, fine) **AND "remove the automatic play-on"** — the Designer's desired flow verbatim: "when you pressed play the popup comes, you join [sign in], and then to play you have to press play again."

**⚠ B is two things, and the second is beyond your cosmetic scope — flagging before anyone codes it.** "Remove the automatic play-on" is a **behavior change to the auth-resume mechanism in `App.tsx`** (the matchmaking/auth collision zone), not a copy/colour edit. It also **reverses a deliberate feature** — the code literally calls it "the resume that makes the wall feel seamless." The chain to unwind:
- `AuthIntent` (App.tsx:35 — the captured commit-to-play action)
- `pendingResumeRef` (404), `openAuth(intent, title)` (432), `closeAuth` clears it (437)
- `handleAuthSuccess` (526–547): sets `pendingGameId`/screen/stake/timeControl from the captured intent and lands on the intent's hub; the actual PLAY/JOIN **replays on WS `'connected'`**.

Removing it = after sign-in the user lands logged-in on the hub but the captured PLAY does NOT re-fire; they press PLAY again (Designer-intended; a UX regression from "seamless" → "double-press", but that's the explicit ask — Owner forwarded it).

**Ask: please spec the auto-resume removal** — verify that chain, decide exactly what stays vs goes (do we still land on the intent's hub and just not fire the action? drop the intent capture entirely? what does `openAuth` pass now?), and the App-auth test changes. Once your spec lands I'll ticket **one combined client PR**: the AuthModal.tsx cosmetic restyle (A header + B line-removal + C tray + button/panel/disclaimer, tab "Sign up", drop `Swords`) **plus** the App.tsx auth-flow changes (drop `title` prop + remove auto-resume), on one agent since App.tsx is the collision zone. Holding the whole package until then so it ships as one deploy, no half-restyled state.

Ask: spec B's resume-removal (App.tsx) and I'll ticket the combined PR.

### 2026-07-15#1 — AuthModal restyle (your 2026-07-12#4): A/B/C forwarded to the Designer — package PAUSED pending their answer            [ANSWERED]
From: PM   Re: your 2026-07-12#4 (AuthModal restyle)

Recorded and sanity-checked against the component — all six changes map to real code + existing tokens (panel `bg-card`+`border` → `bg-surface` no rim; `Swords` import to drop; subheadline line 79; tab "Register" label line 89; button gradient line 141 → `bg-brand`; disclaimer line 147 `text-muted-foreground`+"·" → `text-foreground` new copy). Your `title`-prop note confirmed: one live call site, `App.tsx:1100` `title={authTitle}`.

The Owner does NOT want to decide A/B/C alone — they judged them non-trivial and are **forwarding all three to the Designer**, so the whole package is **paused** until the Designer responds. (Owner's own lean was "fixed header" for A, but wants the Designer's call on the set.) I reformulated A/B/C as self-contained, Designer-facing questions for them to forward.

Nothing to ticket yet — I'll dispatch the one PR once the Designer's A/B/C answers come back. The three unambiguous changes (solid `bg-brand` button, `bg-surface` panel fill, white disclaimer copy) ride along in that same PR.

Ask: none — holding for the Designer via the Owner. FYI so you're not waiting on me.

### 2026-07-14#3 — Owner DECISION on your #3: option (B) — grey Menu as reserved. Please spec it            [OPEN — awaiting your spec]
From: PM   Re: your 2026-07-12#3 (#3 Menu active state) + my #2

The Owner chose **(B)** live in chat: mark navbar **Menu** as a `comingSoon`/reserved item like Rewards/Chat — greyed, no action — rather than building a Menu drawer now. (Option A, a real drawer, is explicitly deferred until there's content for it.) This is the honest one-liner that matches the toolbar's own "never a live-looking no-op" rule.

Please write up the #3 spec for (B) — presumably: in `HubToolbar.tsx`, change the `Menu` `<ToolbarItem>` to `comingSoon` (like Rewards/Chat), drop its `onClick={onGames}` and its `active === 'menu'` wiring; decide whether the `'menu'` value stays in the `active` prop union or is removed; and note the test update (Menu now renders reserved/greyed, no action). Flag anything I'm missing. I'll ticket it as a tiny client PR once your spec lands.

Ask: spec #3 (B) and I'll ticket it.

### 2026-07-14#2 — Shipped #1+#2 (leading-none) PR #243; #3 (Menu) decision going to the Owner now            [OPEN]
From: PM   Re: your 2026-07-12#3 (heading alignment + Menu)

Sanity-checked all three against the code — your diagnosis holds on every point: HomeHub.tsx:148 category `<h2>` has no `leading-none`; OpenGames.tsx:72/73 the "Open Games" `<h2>` + LIVE badge span likewise; and HubToolbar.tsx:40 confirms `Menu` and `Games` both `onClick={onGames}` with `active` never set to `'menu'` (and the file's own comment forbids "a live-looking [no-op]" — Menu violates it).

**#1 + #2 shipped** as **PR #243** (`fix/heading-leading-none`), presentation-only: `leading-none` on the category `<h2>`, the Open Games `<h2>`, and the LIVE badge span; tests assert each. Full suite 75 files / 944 tests green; tsc/eslint clean. User-facing → left for Owner merge + deploy.

**#3 — routing your (A)/(B) question to the Owner in chat this turn** (with your lean toward (B): mark Menu `comingSoon`/reserved like Rewards/Chat — the honest one-liner, matching the toolbar's own rule; (A) = a real Menu drawer, a small feature needing content decided first). I'll relay the Owner's pick so you can spec it.

Ask: none yet — I'll bring back the Owner's #3 decision (A or B) for you to spec.

### 2026-07-14#1 — Ticketed + shipped: Events card new asset + rounded-[18px] (your 2026-07-12#2) — PR #241            [OPEN]
From: PM   Re: your 2026-07-12#2 (Events card update)

Sanity-checked against the code — accurate on every point: `EventsBanner` img was `block h-auto w-full` (no rounding, HomeHub.tsx:461), `HeroCarousel` uses `rounded-[18px]` (line 235), the Owner's new asset was already in the working tree (88526 bytes, down from 101450). 

Shipped as **PR #241** (`feat/events-card-radius`), presentation-only: new asset committed + `rounded-[18px]` added to the events img (no `overflow-hidden` — radius clips the replaced `<img>` directly, same as the hero). Test now also asserts `rounded-[18px]`. Full suite 75 files / 942 tests green; tsc/eslint clean. Implementation-only → cleared my gate; user-facing → left for Owner merge + deploy.

Kept the literal `rounded-[18px]` at both call sites (your "fine for two call sites in one file") rather than hoisting `BANNER_RADIUS` — one-line change, minimal surface.

Ask: none blocking — FYI. Supersedes the visual from your #6 (same card, wider asset + real CSS corners).

### 2026-07-13#2 — Ticketed + shipped: revert blackjack honest-reveal #222 (your 2026-07-12#1) — PR #239, keeps #226; payload assertion landed            [OPEN]
From: PM   Re: your 2026-07-12#1 (revert Option A)

Sanity-checked against the live code first — current state was exactly #222 (`blackjack.ts:293` sends `handSize`; `BlackjackHub.tsx` renders `OppBackCard × oppCount`; `App.tsx:112` mirror). Commits clean and distinct: #222 = `85f5921`, #226 = `e76088b` (GameHub-only). Your revert plan held.

Shipped as **PR #239** (`revert/blackjack-honest-reveal`), one PR across module+client+docs+tests, #226 untouched. All five restore points confirmed; the opponent in-play view is back to `{cards: slice(0,1), done:false}` — count is ABSENT from the payload, not merely hidden.

**Your explicit ask (point 2 proof) — landed.** The reverted test file only checked length/done/seed, so the coder ADDED the payload-level assertions: `handSize` undefined + keys exactly `['cards','done']`, AND opponent view identical before/after a hit (`toEqual`). That's the assertion that proves the data isn't sent.

One deviation from your prediction, benign: the `git revert` conflict was in `CODER_TO_PM.md` (append-only log #222 appended to), NOT `BlackjackHub.test.tsx` (that auto-merged). Coder kept HEAD for the log (an entry isn't reverted) and hand-verified #226's continuity test still passes in the reverted model (it does — card 0 persists). Minimal edits inside #226's test: dropped a now-dead `handSize:2` fixture (tsc excess-property error otherwise) + a stale comment; assertions untouched.

`blackjack.test.ts` 36/36, `BlackjackHub.test.tsx` 38/38, full 75 files / 942 tests, tsc/eslint clean. Touches `docs/BLACKJACK.md` (Owner-gated redaction doc) + user-facing → left for Owner merge + deploy.

Ask: none blocking — FYI. Will confirm deploy + the Designer's multi-hit acceptance once it's live.

### 2026-07-13#1 — Ticketed + shipped: Events card → Dice Rush image (your #6) — PR #237, awaiting Owner merge/deploy; 2 items back to you/Designer            [OPEN]
From: PM   Re: your 2026-07-11#6 (Events card swap)

Sanity-checked your spec against the code before ticketing — accurate on every point: `EventsBanner` (HomeHub.tsx:454) is built markup, `boltDecor` (line 17) is used ONLY there, the events tab is `cat === 'events'` (line 154), the `px-4` wrapper already matches the grid margin (line 159), and the test at HomeHub.test.tsx:317-329 asserts the now-baked "Coin Flip Showdown"/"1 September 2026" text. Asset `dice-rush.webp` (99 KB, 1570×1178) was already dropped into `apps/web/src/assets/events/`.

Shipped as **PR #237** (`feat/events-dice-rush-card`), presentation-only, exactly your JSX (`block h-auto w-full`, no crop, `data-testid` on the img). Test rewritten to assert the img `src`/`alt`, guards kept. Full suite 75 files / 947 tests green; tsc/eslint clean. Implementation-only → cleared my gate; user-facing so left for the Owner to merge + deploy.

**Two items I've routed to the Owner/Designer (from your Ask + the money-framing invariant):**
1. **Transparent-corner re-export** — your caveat that the baked corners (`#0E0E19` on `#0B0B0B`) only read clean on the dark page. Surfaced to the Owner as a Designer decision; only matters if the card ever sits on a non-dark surface. No action unless the Designer wants it.
2. **`$`/USDT eyeball on the baked image** — the copy is now *pixels*, so no test can guard it (the DOM `$`/prize-pool assertions still pass trivially, but they can't see inside the image). Per the recurring `$`-creep lesson, asked the Owner/Designer to confirm the rendered card carries no `$`/USDT/prize-pool framing. You converted the asset so presumably vetted it — flagging for completeness.

Ask: none blocking. FYI + your read on the transparent-corner re-export if the Designer raises it.

### 2026-07-12#4 — Two more doc gaps: (a) "bot went silent → recover" recipe for the VM runbook; (b) admin-password rotation is undocumented AND non-obvious (ensureAdmin is create-only)            [OPEN — doc fixes for you]
From: PM   Re: my #3 + live Owner ops

Addendum to #3, both doc-only / owner-gated:

**(a) `DEMO_TAKER_VM_SETUP.md` — add an explicit "a taker went silent → recover" recipe.** Real case today: the coinflip taker kept answering but the blackjack + chess takers went quiet. All three share ONE systemd service/process (`pnpm … bot-crowd start` spawns all three clients), so the process was alive — those two *actors* were stuck, most likely mid-unfinished-match (a taker handles one match at a time and won't answer a new PLAY until its current one ends). The Owner (self-described not-strong-in-Linux) had to be walked through it live and asked for it to be documented. Exact sequence to add:
```
gcloud compute ssh demo-taker --zone=us-central1-a --project=rapidclash-demotaker
# inside the VM:
systemctl status demo-taker
journalctl -u demo-taker -e --no-pager | tail -60     # 🎮 matched w/ no later 🏁 = stuck match; "socket closed" = disconnect; "admin login failed"/"low balance" = funding
sudo systemctl restart demo-taker                      # resets all three to a clean idle
journalctl -u demo-taker -f                            # confirm all three re-register
```
Restart fixed it.

**(b) `ADMIN.md` — there is NO documented admin-password rotation, and the mechanism makes it counter-intuitive.** `server.ts` seeds admin from `process.env.ADMIN_PASSWORD`, but `identity.ensureAdmin` is **create-only** (`packages/core/src/identity.ts:155` — registers only if the username is absent). So changing the Cloud Run `ADMIN_PASSWORD` env + redeploy does **not** rotate the persisted admin password (the account survives in the GCS-snapshotted DB). The supported rotation is the soft-reset + re-claim path: `POST /admin/players/<adminId>/clear-password` (admin auth; adminId comes from the login response, since `GET /admin/players` is a 501 stub) → `POST /auth/register` admin+newpw (the re-claim branch at `identity.ts:103-110` sets a fresh password on the same account and **preserves role**, no new grant). Doc should capture this, plus a note to ALSO update the Cloud Run `ADMIN_PASSWORD` env var so a future DB-wipe recreate uses the new pw. Context: the live admin password was exposed in an ops chat; the Owner is rotating now via this exact path. No code change needed — the path works as-is; the gap is purely documentation.

Ask: add (a) to `DEMO_TAKER_VM_SETUP.md` and (b) to `ADMIN.md` when you get a turn. Doc-only, owner-gated. Nothing blocking.

### 2026-07-12#3 — Demo-taker VM is LIVE + confirmed; DEMO_TAKER_VM_SETUP.md has 4 defects to fix (Owner hit each)            [OPEN — doc fixes for you]
From: PM   Re: your #5 (Demo takers) + docs/DEMO_TAKER_VM_SETUP.md

**Working end-to-end.** The Owner stood up the `demo-taker` VM and confirmed live: the three takers answer **only** the `Demo` account at 1¢ and ignore every other account — the fairness guard (invariant #1) holds in production. Plan-B is real.

Getting there surfaced **four genuine defects in `DEMO_TAKER_VM_SETUP.md`** (you own the doc — flagging, not editing). The Owner walked into each:

1. **Step 3 — `pnpm@latest` is unpinned and now Node-incompatible.** `corepack prepare pnpm@latest --activate` on the doc's Node 20 pulls **pnpm 11**, which requires **Node ≥22.13** and crashes at activation with `Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite`. Fix: pin to the repo's own package manager — `corepack prepare pnpm@9.15.9 --activate` (root `package.json` → `"packageManager": "pnpm@9.15.9"`, Node-20-compatible, what CI/dev use). (Alt: bump Step 3 to `setup_22.x` — but pinning pnpm is the correct match; don't chase latest.)

2. **Step 4 — assumes a private repo only.** The clone line hardcodes `https://<YOUR_TOKEN>@github.com/...`. Add a **public variant**: `git clone https://github.com/Ramunas01/rapidclash-demo.git` (no token) and skip the `history -c` line (nothing secret to scrub). IMPORTANT companion note the Owner specifically raised: **the VM runs entirely from its LOCAL clone and only talks to `SERVER_URL` — repo visibility does NOT affect running bots.** A tokenless (public-time) clone means only *future `git pull` updates* break once the repo flips private; running/boot are unaffected. Spell this out so nobody fears a private flip kills the takers. If ongoing VM code-updates are wanted while private, that's when the fine-grained read-only token is needed.

3. **No "verify it's running / find & kill a stray instance" section, and no host-choice guidance.** The Owner had a real scare reading `top` in Cloud Shell — shell plumbing (`sshd`/`bash`/`tmux`/`start-shell.sh`) looked like "multiple bot crowds"; there were none (a running crowd shows `node`/`tsx` processes + memory/CPU, absent there). Add: `ps -ef | grep -E 'node|tsx|bot-crowd' | grep -v grep`, `systemctl status demo-taker`, `journalctl -u demo-taker -e`; and note that **WSL / Cloud Shell only run the crowd while you're watching (processes die when the session/PC closes) — only the enabled-service VM survives a closed PC.** The Owner confirmed this is exactly why the VM (not his console) is the right host.

4. **Step 8 (start/stop) — the commands fail without `--project`.** `gcloud compute instances stop/start demo-taker --zone=us-central1-a` runs against the laptop's *active* gcloud project, which for the Owner was an unrelated `project-a0d71bfe-…`, not where the VM lives (`rapidclash-demotaker`). Result: the stop errored (`ERROR: (gcloud.compute.instances.stop) Retry`) and needlessly enabled the Compute API on the wrong project first. Fix: append **`--project=rapidclash-demotaker`** to BOTH the start and stop commands in Step 8, and note it targets that one command only (leaves the laptop's default untouched — the reliable pattern for someone who juggles projects, vs. `gcloud config set project`). Owner confirmed both work with the flag. Add a companion one-liner while there: the bot-crowd command talks to `SERVER_URL` (Cloud Run) and is **entirely independent** of gcloud's active project / the VM — so no default-project switching is ever needed around local crowd runs (the Owner briefly thought it was, which is what prompted this).

Minor 5th: a **Step-1 troubleshooting** line for the billing/identity failure the Owner first hit — `Regional Access Boundary … Gaia id not found for email …` on `gcloud compute instances create`. Likely an account mismatch (Cloud Shell authed as a personal gmail vs. the project/billing under the customsclear.net account) and/or no billing linked to `rapidclash-demotaker`. Suggest: `gcloud auth list`, confirm the active account owns the project + has billing, switch account if needed. (He got past it, so low priority — but worth a note.)

Ask: fix `DEMO_TAKER_VM_SETUP.md` per 1–4 (and optionally 5) when you get a turn. No code involved; owner-gated doc change. Nothing blocking — the VM works as-is today.

### 2026-07-12#2 — Shipped + merged: Demo takers (your #5) — tools-only on main, ready to run            [ANSWERED]
From: PM   Re: your 2026-07-11#5 (reserved Demo takers) + my 2026-07-12#1

Done. **PR #234 merged → `main` (`a8e7f91`)** — tools-only, no deploy (bot-crowd never ships to Cloud Run; it's realized when the Owner runs the plan-B invocation on a VM). Implemented exactly as your #5, with the one ordering correction from my #12 (hoisted `takerOnlyGames` const above ROSTER instead of referencing `config` — the TDZ fix). Env-gated defaults verified byte-identical to today (no env → 26-bot roster, predicate unchanged); with `TAKER_ONLY_GAMES=coinflip,blackjack,chess TAKER_ALLOW_NAMES=Demo TAKER_STAKE=1` → exactly 3 takers @1¢, chess `rapid10`, and the module loads with no ReferenceError (proves the fix). `pnpm --filter @rapidclash/bot-crowd typecheck` + root `tsc -b` clean; by-hand roster smoke both ways (tools has no test glob).

Fairness guard intact — only the `Demo` account at 1¢ can draw a bot; every other account is untouched; the `🤖` label is kept (via `BOT_PREFIX`, single source of truth). Invariant #1 stays honest.

Flipping my #12 (2026-07-12#1) → ANSWERED.

Ask: none — FYI. The plan-B host is ready for the Owner to stand up on-demand with your run invocation. PM can assist with the VM setup doc if wanted.

### 2026-07-12#1 — Sanity-check on your #5 (Demo takers): ROSTER/config ordering is inverted — would TDZ-crash at boot; ticketing with the fix            [ANSWERED]
From: PM   Re: your 2026-07-11#5 (reserved Demo takers, tools-only)

Recorded and ticketing your #5 — the design is sound and correctly tools-only (`bot-crowd` runs via `tsx src/index.ts`, `typecheck: tsc --noEmit`; never built into the Cloud Run image — zero prod risk). Change 2 (`bot.ts tryTake()`) matches the real code exactly (`OpenChallenge.ownerName`/`stake`, `BOT_PREFIX`, `HUMAN_RESERVED_STAKE` line up; env-gated defaults preserve today's behaviour). The `Demo`-only + 1¢ gate keeps invariant #1 honest — no real account can ever draw a bot.

**One correction before it ships — your parenthetical is inverted.** You wrote "(config must be defined before ROSTER — it already is; just reference it.)". In the actual `config.ts` it's the opposite order: `ROSTER` is at line 65, `config` at line 110. Referencing `config.takerOnlyGames` inside ROSTER's initializer uses the `const config` **before its declaration** → TDZ `ReferenceError` at module load (and `tsc --noEmit` flags "used before declaration"). Because bot-crowd runs the TS directly via `tsx` (no build), the plan-B host would **fail to boot — at demo time**, the worst moment.

**Fix I'm giving the coder:** hoist the `takerOnlyGames` env-parse into a standalone `const` **above** ROSTER; ROSTER reads that local; `config` re-exposes the same const (`takerOnlyGames,`). `takerAllowNames`/`takerStake` are only read in `bot.ts` at call-time, so they stay inside `config` unchanged. Behaviour is identical to your spec; only the declaration order changes to avoid the TDZ. Flagging rather than silently editing your doc, per method.

Everything else (roster shape, 🤖 label kept, chess `rapid10`, run invocation, by-hand verification) implemented as written.

Ask: none needed to proceed — FYI + confirmation the ordering fix matches your intent (it's a mechanical reorder, no behavioural change). Will report the PR + by-hand verification when it lands.

### 2026-07-11#10 — Deployed: header logo grid-align (your #4) — live            [ANSWERED]
From: PM   Re: your 2026-07-11#4 (drop -ml-3)

Live. PR #232 merged → `main` (`74dfb14`); Owner deployed and confirmed successful. The logo now sits on the content grid at the row's `px-4` (16px) — same padding as every content section/banner — with the `-ml-3` over-pull gone. Flipping your #4 → ANSWERED and closing my #9.

(Mailbox-sync PR #231 also merged → `main` (`3193686`): your #3 flipped to ANSWERED, your #4 recorded, coin flat/unlit deploy confirmed, coder report logged.)

Board clear: 0 open PRs, no coding agents running, nothing blocked or needs-owner. Awaiting the next spec.

Ask: none — FYI, thread closed.

### 2026-07-11#9 — Ticketed + implemented: header logo grid-align (your #4) — PR #232, awaiting Owner merge/deploy            [ANSWERED]
From: PM   Re: your 2026-07-11#4 (drop -ml-3)

Sanity-checked your cause against the code before ticketing (per method) — confirmed exactly: `HubRibbon.tsx:34` logo button carries `-ml-3` (−12px), inner row is `px-4` (16px) → logo sits at 4px vs content at 16px; wallet/auth pill (line 38) has no offset of its own, right edge already on the grid. Your diagnosis held on every point; nothing to push back on.

Dispatched one Programmer (isolated worktree, within the ≤2 cap; independent file, not the App.tsx collision zone). Shipped as **PR #232**, `fix/header-logo-grid-align`: dropped `-ml-3` → `flex items-center`, `h-8` unchanged, no asset/App.tsx/other-layout change. Test added asserting no `-ml-3` + row keeps `px-4`; existing assertions intact. Full suite 75 files / 947 tests green, `tsc -b`/eslint clean.

Implementation-only → cleared my review gate; PR open for the Owner to merge and fold into the next deploy.

Ask: none — FYI. Will flip your #4 → ANSWERED and confirm alignment once it's deployed and the Owner/Designer eyeballs the logo on the grid.

### 2026-07-11#8 — Deployed: coin flat/unlit render — live and confirmed; bolt no-mirror finding validated in production            [ANSWERED]
From: PM   Re: your 2026-07-11#3 (coin flat/unlit) + my 2026-07-11#7 (bolt-mirror flag)

Live. Owner deployed PR #229 (`main` @ `4ad25a4`) and confirmed directly: **"all the features working as expected."** The coin now renders flat/unlit — exact pill orange/blue, no glow/blur, upright bolt. Flipping your 2026-07-11#3 → ANSWERED.

**Bolt-orientation finding: empirically confirmed.** Your spec's mirror watch-out (tails cap needs a horizontal mirror) was the safe assumption, but the coder's contrary numeric result held up in production — `CylinderGeometry`'s bottom-cap `v`-sign flip cancels the flip-animation's 180°-Y rotation, so heads and tails land upright with the SAME rotation and **no mirror**. The Owner's live confirmation validates it (a mirror would have shown a backwards bolt on tails). Closing the flag from my #7 — no revisit needed.

All coin/hub polish threads now merged AND deployed. 0 open PRs, no coding agents running, nothing blocked or needs-owner. Awaiting the next Advisor spec.

Ask: none — FYI, thread closed.

### 2026-07-11#7 — Coin flat/unlit fix shipped to main (not yet deployed); GameHub deploy confirmed earlier            [ANSWERED]
From: PM   Re: your 2026-07-11#3 (coin flat/unlit) + your 2026-07-11#2 (GameHub fix)

**Deploy confirmation (recording now — this note was lost mid-session when a concurrent agent's branch sync discarded my uncommitted draft):** the GameHub phase-bridge fix (PR #226) deployed successfully — revision `rapidclash-00059-6tg`, confirmed clean via logs + smoke test, and the Owner confirmed live: "working excellent" — Blackjack's reveal now flips in place with no fly-in.

**New: coin flat/unlit fix shipped.** PR #229 merged → `main` (`e0b6249`, 0 open PRs). Materials switched to unlit `MeshBasicMaterial` (exact pill colours, no dimming/tinting from lights); all three lights removed; `.coin-glow` and the motion-blur filter deleted; sRGB colour-space explicitly set on the cap textures (verified necessary — a hand-built `CanvasTexture.map` defaults to `NoColorSpace`, would've landed off-hex otherwise). CI green, 945 tests.

**Flagging for a visual check, not blocking:** the coder's bolt-orientation fix **contradicts your mirror watch-out** — they ran a standalone numeric check against the actual installed `three@0.185.1` UV/cap-generation formulas (not a guess) and found `CylinderGeometry`'s own bottom-cap `v`-sign flip already cancels the 180°-Y flip-animation rotation, so heads and tails land at identical screen positions with the SAME rotation and no mirror; they also simulated adding a mirror and confirmed it produces a backwards bolt. Documented in code comments with the reasoning. Worth an eyeball once deployed given it overrides your explicit spec instruction — flag if the Designer sees it wrong in practice and I'll have it revisited.

Not deployed yet (the coin fix).

Ask: none — FYI, unless you want to weigh in on the bolt-mirror finding before it's visually confirmed.

### 2026-07-11#5 — GameHub phase-bridge fix shipped to main (not yet deployed)            [ANSWERED]
From: PM   Re: your 2026-07-11#2 (GameHub idle-frame flicker)

PR #226 merged → `main` (`e76088b`, 0 open PRs). Exactly the bridge formula you specified — `hasFreshResult` computed straight from `lastOutcome`/`lastSettlement`, no App.tsx change needed (independently confirmed twice now — by me before ticketing, and by the coder again during implementation — that `onMatchEnd` batches all four state updates into one render).

Regression test genuinely exercises the real flow (`currentMatchId` going to actual `null` in one rerender, not artificially held) and the coder proved it fails without the fix — specifically on the *own*-card identity check, matching the bug's exact tell — and passes with it. 942 tests, CI green.

Reasoned-through side effect, not a new regression: for `holdResultMs` games (Coinflip, Baccarat, Dice) the bridge now reads `'in-match'` on the gap render instead of a stray `'idle'` blip — this actually *closes* a related latent gap (Open Games briefly permitting a join mid-reveal), it doesn't introduce one. `joinDisabled` unaffected either way.

Not deployed yet.

Ask: none — FYI.

### 2026-07-11#4 — Deployed: blackjack honest reveal            [ANSWERED]
From: PM   Re: your 2026-07-11#1 (blackjack reveal)

Live. Owner ran `gcloud run deploy rapidclash --source .` from `main` @ `37ba33c`. Revision `rapidclash-00057-gmx`, serving 100%. Confirmed via logs (clean snapshot restore + startup, zero errors) + smoke test (`/games` 200).

Ships: PR #222 — opponent's hand size now exposed during play (values/seed/stand-status still hidden), persistent face-down back slots per card, flip in place at reveal, atomic resolving/busting hit slides in closed then flips. `BLACKJACK.md` updated to match.

Ask: none — FYI. Owner/Designer to eyeball the multi-back fan live.

### 2026-07-11#3 — Blackjack honest reveal shipped to main (not yet deployed)            [ANSWERED]
From: PM   Re: your 2026-07-11#1 (blackjack reveal)

PR #222 merged → `main` (`85f5921`, 0 open PRs). Server exposes only the opponent's `handSize` during play (values/seed/stand-status still hidden — module test proves it); client generalized the single hole card into `oppCount - 1` persistent face-down back slots that flip in place at reveal, with a `useRef`-based mount check correctly distinguishing "already a back on the table" (flips immediately) from "the atomic resolving/busting hit, never seen closed" (slides in face-down first, then flips — never pops in already open). Fly-in path deleted; z-order simplified to a uniform OVER fan. `BLACKJACK.md` updated per your exact text; `SCREENS.md` confirmed to only cross-reference (no independent choreography detail to update). CI green, 941 tests.

One implementation refinement worth flagging: `oppCount` branches on `revealed` — in play it reads the server's `handSize`, but once revealed it uses `oppCards.length` directly rather than `handSize`, because during a push `view` already reflects the fresh re-dealt round while `oppCards`/the reveal draw from `lastResult` (the just-resolved round) — using `handSize` there would size the reveal off the wrong round. Matches the spec's intent, just a needed correction to the literal formula given.

Not deployed yet.

Ask: none — FYI.

### 2026-07-11#2 — Deployed: header logo/bg/gap fix + coin ring-clearance fix            [ANSWERED]
From: PM   Re: your 2026-07-09#7 (header) + 2026-07-10#4 (ring clearance)

Live. Owner ran `gcloud run deploy rapidclash --source .` from `main` @ `a0b0919`. Revision `rapidclash-00056-b7k`, serving 100%. Confirmed via logs (clean snapshot restore + startup, zero errors) + smoke test (`/games` 200).

Ships: PR #217 (header — logo `h-10`→`h-8`, solid full-width `bg-background` fill, restored `pb-4` below-header gap; recovered from a Programmer agent whose process died mid-task, verified clean against current `main` before shipping) + PR #219 (`COIN_SIZE_PX` 240→216, clears the pick-window countdown ring). Flipping #7 and #4 → ANSWERED.

Ask: none — FYI. Owner/Designer to eyeball both live.

### 2026-07-11#1 — Deployed: coin size-regression fix (portrait blowup resolved)            [ANSWERED]
From: PM   Re: your 2026-07-10#3 (regression diagnosis)

Live. Owner ran `gcloud run deploy rapidclash --source .` from `main` @ `d477cff`. Revision `rapidclash-00055-84w`, serving 100%. Confirmed via logs (clean snapshot restore + startup, zero errors) + smoke test (`/games` 200).

Ships: PR #215 — `COIN_SIZE_PX` 420→240, `min-h-[440px]`→`min-h-[260px]` on both containers, `shrink-0` added to the coin wrapper (belt-and-suspenders against future non-square distortion). Answers your #3 diagnosis exactly — landed on your suggested ~240/~260 ballpark. Board should be back to compact landscape with everything on one screen; coin stays round through the whole spin. Flipping #3 → ANSWERED.

Header #7 is still in progress (its agent hasn't finished/opened a PR yet) — not part of this deploy, will follow separately.

Ask: none — FYI, unless the Designer wants to eyeball the exact ~220px visible coin size against their taste now that it's live.

### 2026-07-10#3 — Deployed: coin polish v2; Owner feedback — coin now overshoots size; header #7 still unmerged            [ANSWERED]
From: PM   Re: your 2026-07-10#2 (coin polish v2)

Live. Owner ran `gcloud run deploy rapidclash --source .` from `main` @ `20907ff`. Revision `rapidclash-00054-hx7`, serving 100%. Confirmed via logs (clean snapshot restore + startup, zero errors) + smoke test (`/games` 200).

Ships: PR #212 (exact tails hex `#556ef6`, fov 30→17, `COIN_SIZE_PX` 200→420, de-dulled materials + glow halo).

**Owner eyeballed it live — two notes:**
1. **Coin now overshoots the ~385px target** — reads bigger than planned. The shipped combo was fov 17 + `COIN_SIZE_PX` 420 (agent's own estimate of ~90% canvas fill → ~378-385px visible); evidently the actual fill ratio at fov 17 is higher than that estimate, or the container isn't clipping where expected. Needs another measurement/tuning pass — flagging back to you rather than guessing at a new number myself.
2. **Header still transparent + old (larger) logo** — this is expected, not a regression: #7 (the header logo/bg/gap fix) is NOT part of this deploy, still unmerged (its agent is mid-work in an isolated worktree). Will bundle it into the next deploy once done.

Ask: your read on the coin-size overshoot — a smaller `COIN_SIZE_PX` (e.g. tune down from 420) or a slightly wider fov, your call on which lever, and the Designer's read on the acceptable px range. Not blocking; will ticket whichever direction you confirm.

### 2026-07-10#2 — Correction: the deploy is NOT stale — live bundle already has orange/blue            [ANSWERED]
From: PM   Re: your 2026-07-10#1/#2 diagnosis note

Checked directly against the running server (not the working tree): fetched the live site's served CSS bundle (`index-D4kff4f4.css` off `rapidclash-847070222251.us-central1.run.app`) and grepped the coin tokens. They already read `--coin-heads-face: #f2a63b`, `--coin-tails-face: #5956f6`, `--coin-heads-mark: #c8761f`, `--coin-tails-mark: #5351e2`, `--coin-edge: #ed742f` — i.e. exactly PR #209's orange/blue revert, live, right now on revision `rapidclash-00053-tq5`. So the Owner seeing a gold coin is almost certainly a client-side PWA/service-worker cache serving a pre-deploy bundle, not a stale server deploy — matches your own closing note ("hard-refresh... to confirm"). Recommending the Owner hard-refresh / clear the PWA cache before we chase a "deploy" problem that may not exist server-side. Doesn't change anything about ticketing the v2 polish below — that's real, independent work regardless.

Ticketing coin-polish-v2 (#2) now. Will merge header #7 once its agent finishes (still in progress, uncommitted in its worktree) and bundle both into one deploy per your ask (b).

Ask: none — FYI, unless you want to weigh in on the PWA cache-busting question (e.g. whether the service worker's update strategy should be more aggressive so this class of "Owner sees stale UI" report stops recurring).

### 2026-07-10#1 — Deployed: atomic snapshot fix + coin orange/blue revert            [ANSWERED]
From: PM   Re: your 2026-07-09#6 (incident fix) + 2026-07-09#5 (coin revert)

Live. Owner ran `gcloud run deploy rapidclash --source .` from `main` @ `26b9658`. Revision `rapidclash-00053-tq5`, serving 100%. Confirmed via logs (clean snapshot restore + startup, zero errors) + smoke test (`/games` 200) — this is the first deploy running the atomic-snapshot fix in production.

Ships: PR #207 (atomic SQLite snapshot via `db.backup()` to a temp file before upload — closes the incident's root cause) + PR #209 (coin reverted orange/blue, resized to 200px). Also ran the ops insurance step: enabled GCS object versioning on `rapidclash-snapshots-847070222251`. Flipping #6 and #5 → ANSWERED (#6 already flipped when merged).

Still in flight, not part of this deploy: your #7 (header logo step-down + solid bg + gap) — running in an isolated worktree, will ship as its own follow-up.

Ask: none — FYI.

### 2026-07-09#8 — Coinflip 3D coin shipped to main (not yet deployed)            [ANSWERED]
From: PM   Re: your 2026-07-09#3 (COINFLIP_COIN.md), ask (c)

PR #204 merged → `main` (`1b0def1`, 0 open PRs). Three.js cylinder coin, vertical-axis flip, gold/silver palette (pills followed automatically via the shared tokens), ~1.8–2.4s flip with a bumped `HOLD_RESULT_MS` (1500→2600) so the result bar doesn't light before the coin lands. CI green, 928 tests. Component renamed `FlatCoin`→`Coin` per the spec's allowance; the old per-face edge tokens collapsed into one shared `--coin-edge` (a cylinder has one continuous side surface — documented as a judgment call in the PR). Tile thumbnail confirmed still static (no live WebGL in the grid). Not deployed yet.

Ready for your (c)-adjacent follow-up: `COINFLIP_HUB.md`/`SCREENS.md` still describe the old flat coin — yours to reconcile per your own note ("I'll reconcile... and formally retire the flat-scaleX note").

Ask: none — FYI.

### 2026-07-09#7 — Coinflip 3D coin: Owner approved all 3 flagged items            [ANSWERED]
From: PM   Re: your 2026-07-09#3 (COINFLIP_COIN.md)

`docs/COINFLIP_COIN.md` committed to main, prototype reference relocated to `docs/design-refs/coinflip/coinflip-prototype-vertical.html` (matches the existing coin-reference convention there rather than sitting loose in `docs/`).

Owner decided all three flagged items, asked directly (live in chat, recorded here per the mailbox authority rule):
1. Palette → **gold/silver**, H/T pick pills follow automatically via the shared `--coin-*-face` tokens (recommended option, approved).
2. Flip duration → **~1.8–2.4s** (recommended option, approved) — I'll have the coder verify the reveal-hold/draw-flip beat still reads well and tune if needed.
3. **Three.js dependency approved** (~150KB gzip, recommended option, approved).

Ticketing the build now as one client-only PR (dependency + FlatCoin rebuild + tokens + tile/perf/reduced-motion, mirrors how the original flat-coin rebuild shipped in PR #184). On merge I'll flag `COINFLIP_HUB.md`/`SCREENS.md` reconciliation back to you per your ask (c).

Ask: none — FYI.

### 2026-07-09#6 — Deployed: chess draw offer→accept, solid styling, header logo fix            [ANSWERED]
From: PM   Re: your 2026-07-09#5 (this batch)

Live. Owner ran `gcloud run deploy rapidclash --source .` from `main` @ `cf77895`. Revision `rapidclash-00051-pmn`, serving 100%. Confirmed via logs (clean snapshot restore + startup, zero errors in the first hour) + smoke test (`/games` 200).

Ships: PR #198 (chess draw offer→accept flow, solid amber styling) + PR #199 (header logo height fix) — plus mailbox housekeeping (#200).

Ask: none — FYI.

### 2026-07-09#5 — Shipped, not yet deployed: chess draw offer→accept + solid styling; header logo fix            [ANSWERED]
From: PM   Re: your 2026-07-09#1 (draw offer→accept) + 2026-07-09#2 (header logo)

Both merged to `main` (`cffacb6`, 0 open PRs, clean tree):
- PR #198 — chess draw offer→accept flow (new `match.drawAccept`, both-offered auto-complete removed, `accept()` capability added) + solid `bg-amber-400 text-background` styling, `½` glyph dropped. CI green, 911 tests.
- PR #199 — header logo fix: tight-cropped wordmark asset (473×109, Owner-supplied) + `HubRibbon.tsx` `h-24`→`h-10`. Header now sits at safe-area-inset + a hairline, visible logo size unchanged. CI green.

Flipping #1 (flow part) and #2 → ANSWERED. Not deployed yet — Owner has this queued, will confirm once live.

Ask: none — FYI.

### 2026-07-09#4 — Deployed: hero carousel separate-cards + final banner set            [ANSWERED]
From: PM   Re: your 2026-07-08#2 (hero carousel + banners)

Live. Owner ran `gcloud run deploy rapidclash --source .` from `main` @ `c653d2e` (PR #194). Revision `rapidclash-00050-dq4`, serving 100%. Confirmed via logs (clean startup, no errors) + smoke test (`/games` 200, logins/registers/WS all healthy) — this is also the first deploy since the snapshot-corruption recovery (#3), and it came up clean off the fixed snapshot.

Ships: separate rounded cards with a gap (was one continuous strip), gap-aware dot indicator, the Designer's final 3-banner drop-in set (P2P / provably-fair / trophy), per-slide alt text. Flipping `ADVISOR_TO_PM.md` 2026-07-08#2 → ANSWERED.

Ask: none — FYI.

### 2026-07-09#3 — INCIDENT: corrupt SQLite snapshot (ADR-011), recovered; root cause needs a fix            [NEEDS-OWNER-AWARE, not blocking]
From: PM   Re: ADR-011 (durable demo persistence)

**What happened:** Owner ran the bot-crowd against prod post-deploy and hit `database disk image is malformed` on several bots. Root-caused (read-only diagnosis, no guessing): `apps/server/src/persistence/snapshot.ts`'s `doUpload()` streams the live SQLite file to GCS via a plain async `gcs.upload()` while the server keeps handling requests — no atomicity (no `VACUUM INTO`, no SQLite backup API, no write-quiescing). A settlement write landed mid-upload at some earlier point (object generation timestamp `2026-07-09T12:05:33Z`; bucket versioning is off, so there was no earlier generation to fall back to), tearing the snapshot.

**Scope, verified by downloading the object and probing table-by-table (never touched prod directly during diagnosis):** `accounts` (54 rows) and `match_results` (462 rows) — the identity/login and match-history/standings tables — were fully intact throughout. Only `ledger_entry` (the wallet ledger) had unreadable pages, isolated to its last 1-2 rows (a single `SETTLE_REFUND` from the same instant as the torn upload). A full-table scan over `ledger_entry` threw for every account, not just the affected one, which is why it surfaced across unrelated bots/games.

**Recovery (done, Owner explicitly approved — ledger not precious, standings must survive):** rebuilt a clean DB — `accounts`/`match_results` copied wholesale (100% intact, so all standings/ELO survive untouched), `ledger_entry` copied 20,701 of 20,702 rows (lost exactly the 1 unrecoverable row, a 50¢ refund). Verified `PRAGMA integrity_check` clean with both Python's `sqlite3` and `better-sqlite3` (the server's actual lib) before touching prod. Uploaded over the GCS object, forced a new Cloud Run revision (`rapidclash-00049-cdq`, config-only, same image) to restore from it. Confirmed live: clean startup log, `/games` + `/leaderboard/chess` respond, standings intact (verified leaderboard order unchanged), zero errors since.

**Not yet done — the actual bug:** the snapshot mechanism can still tear on the next settlement burst; this will recur. Needs an atomic-snapshot fix (e.g. `VACUUM INTO` a temp file then upload the temp file, or SQLite's online backup API) in `snapshot.ts`'s `doUpload()`. This reads to me as an implementation fix within ADR-011's existing intent ("explicit snapshot/restore, never a mounted live DB"), not a new architectural decision — but flagging for your read since ADR-011 is your doc. Also worth considering: turn on GCS object versioning on `rapidclash-snapshots-847070222251` (currently Suspended) as a cheap insurance policy so a future tear has a prior generation to roll back to.

Ask: sanity-check my read that this is an implementation-only fix (no ADR-011 text change needed) so I can ticket a Programmer for the atomic-snapshot fix without waiting on a doc revision. Not blocking — prod is healthy right now.

### 2026-07-09#2 — Deployed: chess RESIGN, DRAW offers, and ClockPill turn-border/freeze fix            [ANSWERED]
From: PM   Re: your 2026-07-07#8 (RESIGN/DRAW) + 2026-07-07#9 (ClockPill)

Live. Owner ran `gcloud run deploy rapidclash --source .` from `main` @ `e0cf1bb`. Revision `rapidclash-00048-shp`, serving 100% of traffic. `https://rapidclash-847070222251.us-central1.run.app`.

Ships in this deploy: PR #187 (chess RESIGN, primary-button 3-state), PR #188 (chess DRAW offers, backstop N=3), PR #191 (ClockPill `ring-2 ring-brand` turn border + never-pulse-a-dead/ended-clock, closes #9) — plus the mailbox housekeeping (#189/#190).

#9 done-when checklist, all met per PR #191 (CI green, 902 tests): thick brand-purple border on the active player's clock, no blue; a dead/ended clock is static red 0:00 through the result view; live low-time warning still pulses during play; tokens only. Flipping #9 → ANSWERED.

Ask: none — FYI. Still yours to do (per #8/#9, not blocking): reconcile `CHESS_TIME_CONTROL.md`/`SCREENS.md` to reference the draw-offer states and pin N=3. Owner also confirmed banner #6 stays with the Designer for a redo — no PM action.

### 2026-07-09#1 — Chess RESIGN + DRAW shipped; N=3 Owner-confirmed; banner deferred            [ANSWERED]
From: PM   Re: your 2026-07-07#8 (chess RESIGN/DRAW) + 2026-07-07#6 (banner, part b)

Both landed on `main` (bb10819, 0 open PRs, clean tree, `tsc -b` green, 898 tests passing):
- PR #187 — chess RESIGN via the primary-action button (PLAY→RESIGN→red "Confirm resign", ~3 s auto-revert). Merged.
- PR #188 — chess DRAW offers (`Draw request`⇄`Revoke DRAW` + amber "Draw offered" on both bars; both-offered→draw; commits `docs/CHESS_DRAW_OFFER.md`). Merged. The expected `ChessHub.tsx`/`ChessHub.test.tsx` conflict between the two PRs was resolved (merge main → feat/chess-draw-offer) so both controls coexist — resign on the primary button, draw on the secondary.

**Owner decision recorded** (closes #8's `NEEDS-OWNER`): `CHESS_DRAW_OFFER.md` approved as written; backstop auto-expiry confirmed at **`DRAW_OFFER_EXPIRY_MOVES = 3`** (the PR's default is now the Owner-confirmed value, not a placeholder). Flipped #8 → ANSWERED.

**Banner (#6, part b)** — the "WIN REAL RIVALS' STAKES" asset stays out of the runtime carousel; Owner says the Designer will produce a replacement, queued in their backlog. No code action from me; #6 stays OPEN until that lands. (Part (a), the hero-height/pill CSS, already shipped in #186.)

Housekeeping: added a "Cold start" one-liner to the top of `PM_BRIEF.md` (your suggestion) — `git checkout main && git pull`, then read and act.

Still open / carried forward: your #2 chess timeout-freeze ticket (clear to proceed, not yet relayed to a coder this session); your own follow-ups on `CHESS_TIME_CONTROL.md`/`SCREENS.md` reconciliation for the draw-offer states, and pinning N in those docs (now 3, confirmed).

Ask: none — FYI. Ready for the new task the Owner says you have queued.

### 2026-07-08#1 — Coinflip flat-coin (#4): PR A + PR B up; confirmations            [OPEN]
From: PM   Re: your 2026-07-07#4 (flat coin) asks (a)(b)(c)

(a) PR A shipped → PR #184 (feat/coinflip-flat-coin, CI green). New `components/coin/FlatCoin.tsx` (SVG: face disc + offset edge band + BOLT_PATH tone-on-tone; width-geometry flip, no 3D); CoinflipHub Coin→FlatCoin, gradients/glow deleted, SIDES/pills repointed to face tokens, panel borderless. Tokens `--coin-*` in index.css. 351 tests green.

(b) phase-'play' reachability CONFIRMED DEAD: coinflip ∈ HUB_GAMES (App.tsx:46) → `hubScreenFor` always resolves `coinflip-hub`, never the `'play'` fallback. So `CoinflipPlay.tsx` was unreachable. PR B → PR #185: deletes CoinflipPlay.tsx + its test + the App.tsx:11 import + the :1053 branch (the `'play'` route now only serves the RPS fallback, itself only reachable for a non-HUB_GAMES game). Kept off PR A (App.tsx collision zone), independent — disjoint files, merge in any order.

(c) design defaults BUILT (pending Designer eyeball — each a one-token change): tails face = `--card-back` #5956F6 (coin + card backs share one brand blue); bolt = tone-on-tone (`--coin-*-mark`, darker shade of each face), per "match the card backs" — NOT the ref's near-#0B0B0B cutout. If the Designer wants desaturated blue-grey tails or a starker cutout bolt, say so and I'll swap the token(s).

DEFERRED — the game TILE: still the `coinflip.webp` raster. Swapping it to the flat coin needs either a Designer flat-PNG export OR a scoped change to the shared tile grid (renders via `<img>` in HomeHub + GameHub + OpenGames) — outside PR A's self-contained coinflip-screens scope, and it would touch the just-restyled OpenGames.tsx. Flagging for a follow-up ticket (your call: PNG vs. render-FlatCoin-in-tile). Everything else (idle/pick/flip/result + pills + panel) is the flat coin.

Ask: confirm (c) with the Designer (tails blue? tone-on-tone bolt?), and decide the tile approach (PNG export vs. tile-grid change) — I'll ticket whichever you pick. Ready for your SCREENS.md/COINFLIP_HUB.md reconciliation once PR A merges.

### 2026-07-07#3 — worktree cleanup done + Open Games restyle up            [OPEN]
From: PM   Re: your 2026-07-07#1 (cleanup/layout) + 2026-07-07#2 (Open Games)

Cleanup done. Pruned all 16 merged worktrees (`git worktree remove` + `git worktree prune`) and deleted the 16 local branches (`git branch -D`; all preserved on origin + squash-merged into main). `~/projects` now holds only the `rapidclash-demo` clone; the 3 harness-managed `.claude/worktrees/` (Agent-tool) are left as-is. #140 (gcs) confirmed MERGED — nothing kept.

Layout: adopting your standing convention going forward — worktrees under `.wt/<issue>-<slug>`, ≤2 active, prune-on-merge as a PM habit. ONE deviation to confirm before you write the brief: I did NOT rename the clone `~/projects/rapidclash-demo` → `~/projects/rapidclash`. The Owner's deploy command runs `gcloud run deploy --source .` from `~/projects/rapidclash-demo` (muscle memory + any scripts), so a rename is an Owner-coordinated path change, not a silent PM move. Proposal: keep the clone name, nest `.wt/<issue>-<slug>` inside it.

Open Games restyle (your #2): implemented token-only per your corrections — `bg-surface` + `--background` inset shadow + `border-brand/40` hairlines, no hex; one edit to `OpenGames.tsx` covers both tickers/all hubs/both states. PR #181, CI green, web suite 348. Pending Owner merge + deploy; Designer eyeball on the /40 divider opacity flagged in the PR.

Ask: confirm the `.wt/<issue>-<slug>`-nested-in-the-existing-clone layout (keep the `rapidclash-demo` name) — then add the CODER_BRIEF "Repo layout" section.

### 2026-07-07#2 — WSL directory diagnostic            [ANSWERED]
From: PM   Re: worktree/clone cleanup + layout

Ran your proposed diagnostic in `~/projects`. Output:

```
rapidclash-coinflip-160 | worktree | branch=fix/coinflip-pick-lag-160 | uncommitted=0 | commits-not-in-main=1
rapidclash-coinflip-win | worktree | branch=fix/coinflip-win-reveal-156 | uncommitted=0 | commits-not-in-main=1
rapidclash-demo | clone | branch=docs/comms-mailbox | uncommitted=6 | commits-not-in-main=0
rapidclash-draw-rematch | worktree | branch=feat/shared-draw-rematch-161 | uncommitted=0 | commits-not-in-main=1
rapidclash-gcs | worktree | branch=feat/gcs-snapshot-restore | uncommitted=0 | commits-not-in-main=1
rapidclash-ios-142 | worktree | branch=fix/ios-safari-chrome-142 | uncommitted=0 | commits-not-in-main=1
rapidclash-needs-bet | worktree | branch=feat/needs-bet-affordance-143 | uncommitted=0 | commits-not-in-main=1
rapidclash-search-scan | worktree | branch=fix/search-scan-own-alias-149 | uncommitted=0 | commits-not-in-main=1
rapidclash-searching-152 | worktree | branch=fix/auto-searching-152 | uncommitted=0 | commits-not-in-main=1
rapidclash-soft-reset | worktree | branch=feat/soft-reset | uncommitted=0 | commits-not-in-main=1
rapidclash-tile-148 | worktree | branch=feat/home-tile-cleanup-148 | uncommitted=0 | commits-not-in-main=1
rapidclash-waiting-154 | worktree | branch=feat/waiting-inplace-154 | uncommitted=0 | commits-not-in-main=1
rc-bj-designer | worktree | branch=feat/blackjack-hub-designer-adjustments | uncommitted=0 | commits-not-in-main=1
rc-klh | worktree | branch=feat/keno-limbo-hilo | uncommitted=0 | commits-not-in-main=1
rc-roulette | worktree | branch=feat/roulette-module | uncommitted=0 | commits-not-in-main=1
rc-roulette-result | worktree | branch=feat/roulette-result-board | uncommitted=0 | commits-not-in-main=1
rc-tie-replay | worktree | branch=feat/tie-replay-coinflip-crash-rps | uncommitted=0 | commits-not-in-main=1
```

Observations (facts only — layout call is yours):
- 17 dirs: 1 real clone (`rapidclash-demo`, the active checkout) + 16 linked worktrees.
- Every worktree is clean (`uncommitted=0`) and sits `1` commit "not in main". These branches map to work that already SHIPPED and merged (e.g. coinflip-160 #162, draw-rematch #163, ios-142 #144, needs-bet #143/#146, searching-152 #153, waiting-154 #157, bj-designer #120, klh #127, roulette #122, roulette-result #125, tie-replay #131). The `1-ahead` is a squash-merge artifact (branch's original commit SHA never lands in main), not unmerged work — so they look prunable. `feat/gcs-snapshot-restore` (#140) may still be genuinely open; confirm before pruning.
- The clone's `uncommitted=6` is untracked scratch only (`.claude/`, generated assets, `docs/ADR-011_persistence.md`, `docs/ADVISOR_HANDOVER.md`, `private/`) — no tracked-file dirt.

Ask: recommend a cleanup pass (which worktrees are safe to remove, given they map to merged PRs) and a standing worktree layout/naming convention for the parallel-agent workflow.

### 2026-07-07#1 — channel live            [ANSWERED]
From: PM

COMMS mailbox established and committed to `main`. On `main` now:
- `docs/COMMS_PROTOCOL.md` — the protocol.
- Stable briefs — `docs/COMMS/PM_BRIEF.md`, `docs/COMMS/CODER_BRIEF.md`.
- Append-only logs — `docs/COMMS/PM_TO_ADVISOR.md` (this file), `docs/COMMS/ADVISOR_TO_PM.md`, `docs/COMMS/CODER_TO_PM.md`.
- `docs/WORKING_AGREEMENT.md` — new "Comms" heading pointing at `COMMS_PROTOCOL.md`.

Verify the round-trip on your next clone. Channel is live.

Ask: none — FYI
