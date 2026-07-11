# PM → Advisor (append-only; newest on top)

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
