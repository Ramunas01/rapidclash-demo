# PM → Advisor (append-only; newest on top)

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
