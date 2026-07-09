# Advisor → PM (append-only; newest on top)

### 2026-07-09#1 — Chess draw offer: styling fixes + offer→accept flow change (Designer)            [OPEN, NEEDS-OWNER for the flow part]
From: Advisor   Re: Designer draw-offer feedback + 2 screenshots

Essence: two categories. (A) Pure styling — solid orange, drop the "½" — client-only, ship now. (B) A mechanic change — acceptance moves from "opponent presses their own Draw button" to a dedicated ACCEPT DRAW? pill in the opponent's view; needs a new drawAccept protocol message → owner-gated. Spec rewritten to match: docs/CHESS_DRAW_OFFER.md (revision 3 — replaces the symmetric version that shipped; Owner to commit).

Verified against the deployed code (HEAD 7570c6e): the live UI is the symmetric build — DrawOfferedChip (ChessHub.tsx:96) shows the same "½ Draw offered" to both viewers; there is no drawAccept (App.tsx has handleDrawOffer/handleDrawRevoke only).

(A) STYLING — client-only, ship now. No protocol.

DRAW OFFERED pill (DrawOfferedChip, ChessHub.tsx:100): bg-amber-400/15 … text-amber-400 ring-1 ring-amber-400/40 → bg-amber-400 text-background (solid, dark text), drop the ring, and remove the <span>½</span> so it reads just DRAW OFFERED.
Revoke DRAW button (ChessSecondaryAction, :363): bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/50 … → bg-amber-400 text-background (solid, dark text).
Result: both go from translucent/outlined to solid orange with dark text. Tune text-background (#0B0B0B) vs text-[#0B0B0B] — same thing; use the token.

(This is valid on its own even before the flow change — it just recolors the existing elements. The opponent's pill becomes ACCEPT DRAW? in (B).)

(B) FLOW — offer→accept. Owner-gated (new protocol message). Full detail in the spec.
Deployed mechanic = symmetric (opponent completes by pressing their own Draw button; server draws when both have offered). Designer-final = asymmetric:

Offerer bar (own view) → DRAW OFFERED (status, non-tappable).
Same bar in the opponent's view → ACCEPT DRAW? (the accept button). Opponent taps it → draw. The opponent's own Draw request button no longer accepts.
Revoke + expiry unchanged.

The good news: DrawOfferedChip already takes a side prop that exactly encodes viewer-vs-offerer — side==='own' is the offerer's own bar, side==='opponent' is the opponent viewing it. So the client change is: branch DrawOfferedChip on side (own → DRAW OFFERED status span; opponent → ACCEPT DRAW? button → onDrawAccept), thread a new onDrawAccept through GameHub (:52-53/412) + handleDrawAccept/ws.drawAccept in App.tsx (:919-926).
Server/protocol: add match.drawAccept; drop the "both-offered auto-draw" rule — completion is drawAccept only. drawOffers view state and expiry stay.

Redaction: unchanged — the offer is public; the only per-viewer difference is which control is actionable (DRAW OFFERED vs ACCEPT DRAW?). Terminal reuses the existing chess draw (orange popup + orange bar outlines, refund, no rematch).

PR sequence: (1) styling PR now (client-only). (2) Owner approves rewritten CHESS_DRAW_OFFER.md + the drawAccept addition. (3) protocol PR (owner-gated). (4) server/module PR (accept-completes; drop both-offered). (5) client PR (DrawOfferedChip per-side + onDrawAccept).

Ask: (a) ship the styling now. (b) Owner approves the revised spec + drawAccept protocol message before the flow PRs. One open UX nicety noted in the spec: whether to disable the opponent's Draw request button while an incoming offer is pending (recommend leaving it enabled). On approval I'll reconcile CHESS_TIME_CONTROL.md/SCREENS.md to the accept model.

### 2026-07-08#2 — Hero carousel: separate cards + final banner set (Designer)            [ANSWERED]
From: Advisor   Re: Designer carousel-behavior spec + 3 banner assets (P2P / provably-fair / trophy)

Essence: two client-only, cosmetic pieces in HomeHub.tsx HeroCarousel, no logic. (a) Make the carousel page as separate rounded cards with a gap instead of one continuous strip. (b) Swap in the Designer's final 3-banner set — already delivered as drop-in webp (below). One small hero PR. All investor-demo chrome (the Owner notes these are for investors, not real players).

Good news on the earlier #6 dependency: all three assets are 2120×754 (2.81:1) — exactly the aspect-[2120/754] frame PR #186 already shipped — so no re-crop needed; object-cover won't clip them.

1. Separate-card carousel (verified against current code, post-#186):
Current track: flex snap-x snap-mandatory overflow-x-auto rounded-[18px]; each slide aspect-[2120/754] w-full shrink-0 snap-center object-cover. Radius is on the container, slides touch edge-to-edge, no gap. Three edits make it page card-by-card:

Radius per card: remove rounded-[18px] from the track; add rounded-[18px] to each <img> (all four corners on every card, including inner edges).
Gap: add gap-4 (16px, or gap-3=12px — Designer said 12–16) to the flex track. The section sits on the page background, so #0B0B0B shows through the gap automatically.
Snap paging: keep snap-x snap-mandatory on the track + snap-center per slide (already there) — with full-width slides + gap this pages one card at a time, the neighbor peeking mid-swipe, snapping centered to the px-4 padding at rest. No free scroll.
⚠ Dots index calc: Math.round(el.scrollLeft / el.clientWidth) ignores the new gap; each page now advances by clientWidth + gap. Fine for 3 slides but drifts as slides grow. Make it gap-aware (e.g. round scrollLeft / (firstSlide.offsetWidth + gap), or read the nearest child's offsetLeft) so the active dot stays correct up to the 5-slide max. Dots otherwise unchanged (one per card).

2. Final banner assets (drop-in — no code change):
HERO_SLIDES = [hero1, hero2, heroFront] already loads three files. Replace the three files in apps/web/src/assets/banners/ with the Designer's set (converted to webp, staged for you):

hero-1.webp ← P2P "PLAYER VS PLAYERS / NEVER THE HOUSE"
hero-2.webp ← provably-fair "NO HOUSE. NO EDGE. / REAL OPPONENTS ONLY…"
hero-front.webp ← trophy "WIN REAL RIVALS' STAKES"

Same filenames ⇒ no import/array change. Resulting slide order = Never-the-House → No-House-No-Edge → Win-Real-Rivals — a clean thesis→fairness→compete arc; reorder HERO_SLIDES if the Designer wants otherwise.

Copy / a11y flags (Designer's call, not blockers):

"PLAYER VS PLAYERS" (P2P slide) is singular/plural-mismatched vs the brand line "Players vs Players." Recommend "PLAYERS VS PLAYERS." Quick fix on her side.
Money-framing on the trophy slide ("WIN REAL … STAKES") — I flagged this hard in #6. In this trio it's well mitigated: two sibling slides say "NEVER THE HOUSE" and "NO HOUSE. NO EDGE.", so "real rivals" clearly reads as human opponents, and the set as a whole nails the play-money/no-house thesis. For an investor audience that model-clarity is exactly what you want, so the set works. Residual: the trophy slide leans money-forward in isolation — only relevant if it's ever shown alone. Deferring to Owner/Designer; noting, not blocking.
Per-slide alt text (optional a11y): all three slides share one hardcoded alt. With distinct banners, give each its own alt (small array) so screen readers describe the right slide.

(FYI: the two .heic reference/current files didn't render on my side, but the Designer's written behavior spec is complete and matches the current code, so no blocker.)

Ask: ticket as one small client PR in HomeHub.tsx (carousel behavior + drop-in assets + gap-aware dot calc), independent/parallel-safe. Pass the two copy notes ("PLAYERS VS PLAYERS"; money-framing already-mitigated-FYI) back to the Designer.

### 2026-07-07#9 — Chess timer: turn border + timeout freeze (corrects #5's #1, completes the batch)            [ANSWERED]
From: Advisor   Re: Owner's clarification of #5 items 1 & 2 + turn-indicator image

Both are small client-only edits in one component — ClockPill (ChessHub.tsx:46-64). Together with RESIGN + DRAW (#8), this closes out the 2026-07-07#5 chess batch. Ticket these two with the RESIGN client work as one PR (same file/area, all client-only).

1. Turn indicator — corrected. It is NOT "blue → purple"; there is no blue. As I flagged in #5, the active clock already uses brand purple — but only a faint ring-1 ring-brand/40 (1px, 40%), which is the "not strong enough" the Owner describes. The real ask (per the image: thick violet border around 0:46 on the right) is to thicken that existing brand ring into a prominent turn border on the active player's clock.

Edit ClockPill active class (:57): bg-brand/25 text-foreground ring-1 ring-brand/40 → ring-2 ring-brand (full-opacity brand purple; tune ring-2 vs ring-[3px] to match the image). Keeps the rounded-md pill shape.
Applies to whichever side is active → both players get it on their turn. Static border (the original "flickering/pulsing" wording is superseded by the Owner's "thick border" — static; if a subtle pulse is later wanted it's one class).
No recolor, no blue anywhere — just border weight. Keep the existing green/red active dot.

2. Timeout / end-of-match freeze — confirmed. The Owner sees the losing red clock pulsate at the result; it must be a still image. Current low && active && 'animate-pulse' (:60) keeps pulsing a dead/low clock.

Never pulse a dead clock: gate it — low && active && ms > 0 && 'animate-pulse'.
Freeze on match end: when the match has ended (key off the view's terminal/result, or clock.active == null), render both clocks static — no pulse, no active-turn animation — with the timed-out/losing clock showing a static red 0:00 held through the result display. (ChessClockChip/ChessSlotAside can pass an ended flag down from the view it already reads.)
Keep the live low-time warning pulse during play (under 10 s, clock still running) — the Owner only objected to the ended/dead clock pulsing, not the live warning.

Done when:

Active player's clock shows a thick brand-purple border on their turn (both players); no blue.
A dead/ended clock is static red 0:00 with no pulse/animation, held through the result; live low-time warning still pulses during play.
Tokens only (ring-brand, text-destructive); no hardcoded hex. ChessHub tests green (update any assertion pinning ring-1/ring-brand/40 or expecting a pulsing ended clock).

Ask: fold #1+#2 into the RESIGN client PR (PR A) — all ChessHub.tsx/primary-button, client-only, no protocol. That fully specs the #5 batch: #1 & #2 here, #3 RESIGN in #8, #4 DRAW in #8 + CHESS_DRAW_OFFER.md (still owner-gated, awaiting approval + the auto-expiry answer).

### 2026-07-07#8 — Chess RESIGN + DRAW: corrected specs (supersede #5-resign and #7)            [ANSWERED]
From: Advisor   Re: Owner's Designer-approved corrections

Two corrections after the Owner re-checked with the Designer. Both supersede earlier entries. Verified at HEAD 6fc013b: renderPrimaryAction exists (@140/463, returns a node so it can hold local state); renderSecondaryAction does not exist; forfeit intact (protocol.ts:54).


RESIGN — corrected. Client-only, no server change. (Supersedes the #5 resign item — the confirm is now on the button itself, not a bar pill.)

Resign already exists as forfeit. Implement entirely on the primary-action button via renderPrimaryAction — no bar pill, renderSlotAside not involved. Three states on that one button:


PLAY (idle) → RESIGN (active match).
Tap RESIGN → the same button turns red, label Confirm resign.
Tap Confirm resign → calls the existing forfeit (loss, standard result flow: popup + red bar outline per the chess result spec).
If Confirm resign is not pressed within ~3 seconds, the button reverts to RESIGN.


One accidental tap never resigns — only the deliberate second tap on the red Confirm resign does; the 3 s timeout auto-cancels an accidental first tap. The chess-supplied node manages its own two-step state + timer locally (no server/protocol change). Self-contained; sequence alone (primary-action/play-panel surface, adjacent to the App.tsx collision zone). Ready to ticket now.

Done when: PLAY→RESIGN in-match only; tapping RESIGN shows red Confirm resign; confirming forfeits via the existing path; no confirm within ~3 s reverts to RESIGN; idle/result show PLAY. ChessHub/forfeit tests green.


DRAW — corrected to the symmetric mechanic (Designer-blessed). Full spec rewritten: docs/CHESS_DRAW_OFFER.md (Owner to commit). This replaces #7's two-tap propose→accept entirely — ignore #7's spec.

Mechanic: Play a Friend → Draw request in-match; pressing it offers immediately and the button becomes Revoke DRAW; a "Draw offered" indicator shows on the offerer's bar on both screens. Pressing your own Draw request while the opponent's offer is pending completes the draw (both-offered = draw). Revoke withdraws your own offer.


No confirm step (unlike Resign) — and that's correct: an accidental single Draw tap is harmless (an offer alone can't end the game, needs the opponent's matching offer, and is revocable). Resign forfeits on one tap, so it needs the confirm; draw doesn't. The asymmetry is intentional.
Still a NEW feature / owner-gated: adds match.drawOffer + match.drawRevoke, a public drawOffer view field, and a chess capability flag → protocol change. Needs a new renderSecondaryAction GameHub hook (Play-a-Friend override). Core stays generic; chess opts in.
Reuse: existing chess draw terminal (refund / no rake / no rematch / amber-orange result — chessResultLine 'Draw', suppressResultOverlay). Indicator reuses the draw amber (slotReveal.tsx:48).
⚠ One open question: the corrected description adds explicit Revoke but drops the earlier auto-expiry-after-2-moves. Recommend keeping a backstop expiry (offer lapses after N of the offerer's own moves) plus manual Revoke, so a forgotten offer doesn't linger. Confirm: keep the backstop (and pin N), or manual Revoke only?


Build order: spec (Owner) → protocol PR (owner-gated) → server/module PR → client PR (renderSecondaryAction + button toggle + indicator + --draw token). Full detail, state table, edge cases, and acceptance criteria are in CHESS_DRAW_OFFER.md.


Ask: (a) ticket RESIGN now (client-only, ready). (b) Owner approves the rewritten CHESS_DRAW_OFFER.md + protocol addition, and answers the one auto-expiry question, before the DRAW protocol PR. (c) The still-clear #2 timeout-freeze can also proceed. On DRAW approval I'll reconcile CHESS_TIME_CONTROL.md/SCREENS.md.

### 2026-07-07#7 — Chess draw offer: full spec ready (supersedes #5's sketch)            [SUPERSEDED by #8 — do not act]
From: Advisor   Re: Owner's detailed draw-request clarification + illustration

**Essence:** the Owner's clarification is a **materially different mechanic** than the Designer's original prose. Original (my #5) = symmetric "both press their Draw button once." Actual = a **two-tap propose→accept**: each side arms with the button, then commits on a yellow `DRAW?` pill in their own bar; nothing transmits until a pill is tapped. I've written the whole thing up as **`docs/CHESS_DRAW_OFFER.md`** (Owner to paste/commit) — state table, protocol, server, client, tokens, edge cases, acceptance criteria. **This spec is authoritative; ignore the #5 draw sketch.**

**Verified against code (spec is accurate to it):**
- `renderSecondaryAction` does **not** exist — only `renderPrimaryAction` (`GameHub.tsx:140/463`). The Play-a-Friend→Propose-a-Draw override is a genuinely new hook (spec'd).
- Draw result already uses **amber** (`ring-amber-400`, `slotReveal.tsx:48`); resign/loss uses `--destructive` red. So the yellow `DRAW?` pill reuses the draw hue — one amber, two fills (pending outline → committed white-on-amber). No new hue, tokenize the amber.
- Terminal reuses the existing chess draw (refund / no rake / no rematch / amber-orange result) — **reuse, don't reimplement.**

**Owner-gated:** this adds protocol messages (`match.drawPropose`, `match.drawAccept`) + a `drawOffer` view field + a chess capability flag → contract change, needs Owner approval before the protocol PR. Core stays generic (no `if gameId==='chess'`); chess opts in via capability.

**Four things to pin before build (in the spec as open items):**
1. **Expiry = the receiver's 2 own plies** since the offer went live (server-counted). Confirm that's the intended "2 moves" (not 2 plies total, not the proposer's moves).
2. **Proposer-armed cleanup:** the pre-send armed state is client-local — recommend it auto-clears on the proposer's next move or after a few seconds (like the resign pill) so it can't stick. Confirm.
3. **Offer vs turn:** may a draw be proposed on either player's turn (recommended), or only after the proposer's own move?
4. **Simultaneous double-propose** resolves to a draw (both committed) — confirm.

**Build order (one concern each):** spec (owner) → protocol PR (owner-gated) → server/module PR (offer state + ply-count expiry + accept→existing draw settlement) → client PR (`renderSecondaryAction` + button states + bar pill + `--draw` token). None of this blocks the earlier chess client tickets (#2 timeout-freeze, #3 resign) — those can still proceed independently.

Ask: (a) Owner approves `CHESS_DRAW_OFFER.md` + the protocol addition; (b) answer the four pin questions (defaults recommended in the spec). Once approved I'll also reconcile `CHESS_TIME_CONTROL.md`/`SCREENS.md` to reference the draw-offer states. The Owner noted more illustration items are coming separately — I'll spec those as they arrive.

### 2026-07-07#6 — Front page: banner height + Filter/Sort backgrounds (Designer)            [OPEN]
From: Advisor   Re: Designer request + 3 attachments (incl. a banner asset)

Essence: two small cosmetic changes, both client-only in `apps/web/src/screens/HomeHub.tsx`, no logic, parallel-safe. But one of the three attachments is a banner image the brief doesn't mention, carrying a charter-invariant concern to route past Owner/Designer.

⚠ Flag — the `RapidClash_front_banner.png` asset (WIN REAL RIVALS' STAKES / BEAT PLAYERS. TAKE THE PRIZE.):
- Not in the written brief (which is only banner height + filter/sort backgrounds). It's 2120×754 (2.81:1) — exactly the new target ratio — suggesting a re-cropped hero. But its copy differs from the on-thesis hero ("Players vs Players, Never the House"). Confirm its role: replace hero-1, add as a new slide, or just a ratio reference?
- Money-framing (invariant #4). "WIN REAL … STAKES" + a trophy overflowing with gold coins reads toward real-money gambling. Charitably it means "real (human) rivals" (on-thesis), but scans as "real money stakes," and gold-jackpot imagery is house/casino framing — the opposite of "never the house." Recommend: keep the "Players vs Players, Never the House" framing; if adopted, revise the copy so it can't read as real-money and reconsider the jackpot imagery. Owner/Designer call — surfacing per role, not blocking. (If adopted → runtime asset in apps/web/src/assets/banners/, webp, cropped 2.8:1.)

Verified pointers:
1. Banner height. HeroCarousel img (HomeHub.tsx:~216) has no explicit height (intrinsic ~2:1). Add `aspect-[2120/754]` (≈2.8:1, in her 2.6–2.8 range) + keep object-cover. One class on that img covers both slides. Surrounding spacing (px-4 pt-2, dots mt-3) untouched → content below moves up. ⚠ object-cover at 2.8:1 crops the current ~2:1 hero-*.webp top/bottom (props/headline may clip) — BOTH assets need a designer re-crop to 2.8:1. CSS can ship now; final look depends on the re-crop.
2. Filter/Sort navy pill. ControlMenu button (~350) is pill-shaped + padded but has no background. Search circle + input use bg-surface, h-11. Add `bg-surface` (+ optional hover) → search + Filter + Sort read as a consistent row of three navy h-11 controls.

Done when: hero ~2.8:1 both slides, margins/gaps/dots visually unchanged, swipe + dots work; Filter + Sort on a bg-surface navy pill matching search (one row); only tokens/existing utilities (bg-surface, aspect-[…]), no new hex; HomeHub.test green.

Ask: (a) one small client PR in HomeHub.tsx (both changes). (b) Owner/Designer decision on the WIN REAL RIVALS' STAKES asset — role + money-framing/imagery concern; and confirm both hero-*.webp will be re-cropped to 2.8:1.

### 2026-07-07#4 — Coinflip flat-coin redesign + panel border removal (Designer)            [ANSWERED]
From: Advisor   Re: Designer request + 3 reference images

Essence: two parts. (1) Replace the photorealistic gold/silver coin with a flat vector SVG coin — orange heads / blue-violet tails, tone-on-tone bolt, an offset edge-band as the only depth cue — across all states (idle, in-play, flip, result, tile) and mirror the colors onto the H/T pick pills. (2) Remove the grey border on the coin panel (borderless navy, like Bring-a-Rival). Part 2 is trivial; Part 1 is a real reskin — it replaces the flip mechanism (a framer rotateY 3D spin → flat geometry), so it's a new shared SVG component, not a color swap. Timing/flow do not change (timer-only resolve, terminal-only reveal, draw-flip all stay exactly as specced — reskin only).

Reference images: committed under `docs/design-refs/coinflip/` (docs-side, not runtime assets): `coin-heads-face-ref.png`, `coin-midflip-ref.png`, `coinflip-current-panel.png`. For feel/proportion; the exact hex below lets the coder build from spec alone.

Sanity check — verified, four flags:
1. ⚠ Two divergent coins exist. The Designer's screenshot is the hub arena coin in CoinflipHub.tsx (Coin, COIN_GOLD/COIN_SILVER, COIN_GLOW, framer rotateY:1440) + SidePill (pills reuse the same gradients). But CoinflipPlay.tsx is a second, older coin (amber/indigo gradients, "H"/"T", hardcoded bg-[#0b0e18]), still wired at App.tsx:11 + :1053 (phase 'play'). Per COINFLIP_HUB.md the hub replaced the old flow — CoinflipPlay is very likely a dead path. Confirm whether coinflip ever reaches phase 'play'. If dead → delete it (+ import + App branch). If reachable → it needs the same flat coin. Don't leave two coins.
2. "blue-grey" wording vs the reference. The Designer wrote tails = "blue-grey," but the reference tails is a saturated blue-violet #556ef6 ≈ our --card-back (#5956F6). Recommend tails face = the existing --card-back token so the coin and card backs share one brand blue. Confirm with Designer.
3. Bolt treatment. Doc says "match the card backs." Card backs use darker-shade tone-on-tone (--card-back-mark on --card-back), not a stark cutout → coin bolt = a darker shade of each face color. (The midflip ref shows a near-#0B0B0B dark bolt reading like a cutout; the written rule governs → tone-on-tone. Confirm if Designer wants the starker cutout instead.)
4. Doc reconciliation (Advisor's job, not the coder's): SCREENS.md ("Coinflip's gold coin") + COINFLIP_HUB.md ("solid gold with a glow") will contradict; I'll produce those edits once PR A lands.

Exact palette (sampled from refs) → tokens, no hardcoded hex:
- Heads face #f2a63b; heads edge band #ed742f (darker/burnt orange); heads bolt = darker-orange tone-on-tone (~#c8761f, tune).
- Tails face = --card-back #5956F6 (ref #556ef6); tails edge = darker blue-violet (--card-back-mark #5351E2 or a touch darker, tune); tails bolt = darker-blue tone-on-tone.
- Suggested tokens: --coin-heads-face/-edge/-mark, --coin-tails-face/-edge/-mark in index.css.

Bolt reuse: CardBack.tsx already exports BOLT_PATH (viewBox 0 0 24 24). Reuse that ONE path for the coin — one mark on card backs + both coin faces.

PR A — flat coin + hub reskin + panel border (one agent, self-contained in coinflip screens + a new component):
- New shared components/coin/FlatCoin.tsx (SVG, like CardBack): props face + a flip driver. Flat fills only — face disc + offset edge-band ellipse + BOLT_PATH in the tone-on-tone mark color. No gradient/glow/shadow/ring.
- CoinflipHub.tsx: replace Coin internals with FlatCoin; delete COIN_GOLD/COIN_SILVER/COIN_GLOW + the border-white/20 inner ring; repoint SidePill + SIDES fills to the new face tokens.
- Panel border: CoinflipPanel — remove border border-border, keep bg-surface.
- Flip (flat): replace rotateY 3D spin with geometry — animate face scaleX 1 → 0 (disc squashes to a thin vertical ellipse where the edge-band shows), swap face color + bolt at the midpoint (scaleX≈0), then scaleX 0 → 1 into the opposite face. Bolt scales with the face. Keep the current trigger/duration/re-key (terminal + draw-flip) — frames only.
- Idle/tile: idle hub coin = flat heads face (no glow). Tile art → flat heads face; render FlatCoin heads, or export a flat PNG if the tile grid needs a raster.

PR B — resolve CoinflipPlay.tsx (separate; touches App.tsx collision zone → sequence alone): confirm reachability (flag 1). If dead: remove CoinflipPlay.tsx + App.tsx:11 import + the :1053 branch. If reachable: swap its coin to FlatCoin, drop bg-[#0b0e18].

Done when: one flat SVG coin everywhere (idle, pick, flip, result, tile), no gradient/glow/shadow, depth only from the edge band; heads orange / tails card-back-blue; H/T pills match one-to-one; bolt tone-on-tone reusing BOLT_PATH; flip is pure width-geometry, timer-only resolve + terminal-only reveal + draw-flip unchanged, opponent pick hidden until terminal (redaction intact); coin panel borderless on bg-surface; only tokens (no new hex); CoinflipHub.test/CoinflipPlay.test/visuals green.

Ask: (a) PR A to one agent now (self-contained, parallel-safe); (b) confirm phase-'play' reachability before PR B; (c) confirm with Designer — tails = card-back blue? bolt = tone-on-tone (not cutout)? I'll ship the SCREENS.md/COINFLIP_HUB.md reconciliation once PR A lands.

### 2026-07-07#3 — Footer + Bring-a-Rival restyle (Designer)            [ANSWERED]
From: Advisor   Re: Designer request — footer area + Bring a Rival

Essence: cosmetic-only restyle — four small changes making the footer/Bring-a-Rival match the site's borderless-navy + white-text + brand-purple-accent theme. No logic, no wire/redaction/money surface touched. Two shared files (`BringARival.tsx`, `HubFooter.tsx`) + one test. Independent of the Open Games ticket (#2) — different files — so this can run on the second agent concurrently, or queue behind it.

Sanity check: all four claims verified against code. Three notes:

1. Use `text-foreground` for every "→ white" (it's #f4f4f5, the exact token the "Bring a Rival" heading already uses) — keeps it tokenized and pixel-matched to the heading, not a raw `text-white`.
2. Part of claim #3 is already done: "See how it works" is already `text-brand` (purple) — no change needed there; flagging so it doesn't look like the ticket missed it.
3. The X→"Twitter" relabel is a deliberate logo/label mismatch (keep the X glyph, label reads "Twitter") — implement as asked, don't "correct" it back. It also moves a test-id (see below).

Changes — `apps/web/src/components/hub-shared/BringARival.tsx`:
1. Line 10: delete `border border-border` (keep `bg-surface` — it's already the navy panel). Borderless.
2. Line 15: description `text-muted-foreground` → `text-foreground` (white). Heading and button unchanged.

Changes — `apps/web/src/components/hub-shared/HubFooter.tsx`:
3. Line 9 (SOCIALS): `label: 'X'` → `label: 'Twitter'`; keep the X-logo icon as-is. ⚠ The test-id is derived from the label (`home-social-${label.toLowerCase()}`), so this becomes `home-social-twitter` — update `apps/web/src/test/HomeHub.test.tsx:123` (`home-social-x` → `home-social-twitter`).
4. Line 42 `<b>`: `text-foreground` → `text-brand` (purple lead-in "Provably fair, by design.").
5. Line 41 `<p>` base class: `text-muted-foreground` → `text-foreground` (the body sentence goes white; the `<b>` and the link keep their own colors). Line 43 link span stays `text-brand` — no change.
6. Line 49 footer links: `text-muted-foreground` → `text-foreground` (all seven white).

Out of scope (leave as-is): the 18+ and copyright lines (`text-[#5b5b63]`, lines 55/60) — Designer didn't ask to touch them. (Separately, they're hardcoded hex that should someday be tokens — not this ticket.)

Done when:
- Bring a Rival has no rim; description is white and matches the heading; button unchanged.
- Middle social button reads [X logo] Twitter; Discord/Telegram unchanged; HomeHub.test.tsx updated to `home-social-twitter` and green.
- Provably-fair lead-in is brand purple, the body sentence is white, "See how it works" stays purple.
- All seven footer links are white.
- Only token classes used (`text-foreground`, `text-brand`); no new hardcoded hex; navy panels stay `bg-surface`. Full test suite passes.

Ask: ticket to an agent as an independent unit (safe to parallel with #2). No decision needed from Owner/Designer — purely cosmetic.

### 2026-07-07#2 — Open Games list restyle (recessed navy panel)            [ANSWERED]
From: Advisor   Re: Designer request — Open Games list

Sanity-check result: all three claims verified against the code, premise is correct. The one file to touch is `apps/web/src/components/hub-shared/OpenGames.tsx` — specifically the shared `TickerBody`, `EmptyTicker`, and `TickerRow`. Because both `OpenGamesTicker` (signed-in) and `PublicOpenGamesTicker` (logged-out) render through these, one edit covers the Home hub and every game hub, both states. No doc pins this styling — no spec edit needed. Self-contained file, not the App.tsx collision zone → good for a standalone/second agent.

Two corrections to the brief before implementing (charter: tokens, not hardcoded values):

1. The navy the Designer wants already exists as a token: the PLAY/bet/Play-a-Friend container (`GameHub.tsx:715`) uses `bg-surface` → `--rc-surface #1a1a2e`. The list must use that same token, not a new navy hex. (Its current grey is `bg-card #151515`.)
2. The inset shadow must use the background token, not literal `#0B0B0B`. `#0b0b0b` is `--background`.
3. The current row divider `border-[#1e1e1e]` is a hardcoded hex matching no token — this ticket fixes that latent violation while recoloring.

Changes (file `apps/web/src/components/hub-shared/OpenGames.tsx`):

1. Panel color — `TickerBody` (line 60) and `EmptyTicker` (line 82): replace `bg-card` → `bg-surface`. Identical navy to the PLAY panel.
2. Remove rim, add recessed inset — same two elements: delete `border border-border`; keep `overflow-hidden rounded-[14px]`; add a background-token inset shadow, e.g. Tailwind `shadow-[inset_0_0_24px_8px_hsl(var(--background))]`. Tune blur/spread to taste — the visual target is edges melting into the page background, no hard boundary. (Overlay-gradient-frame is an acceptable alternative technique; must resolve to the `--background` token.)
3. Purple row separators — `TickerRow` (line 27): replace `border-[#1e1e1e]` → the brand purple token `border-brand` (`--brand-purple #8140e2`). Recommend starting at reduced opacity (`border-brand/40`) and tuning — a full-strength hairline reads too hot. Keep `border-t` and `first:border-t-0`.

Done when:

- List background is `bg-surface`, pixel-identical to `hub-section-play`; no visible border/rim on the list or the empty state; a soft inset shadow reads as recessed, edges fading into `#0b0b0b`.
- Row dividers are brand-purple hairlines via token (opacity-tuned), no hardcoded hex; first row has no top divider.
- No hardcoded colors introduced anywhere in the change (`bg-surface`, `hsl(var(--background))`, `border-brand` only).
- Verified on Home hub + one game hub, signed-in and logged-out; ¢ stake formatting and `text-success` unaffected (no $/USDT).
- `OpenChallengesList.test` and the `*Hub.test` suite pass; update any assertion that pins the old `bg-card`/`border-border`/`#1e1e1e` classes.

Ask: ticket this to one agent (single file, no collision zone). Confirm the divider opacity with the Designer if /40 looks off.

### 2026-07-07#1 — Worktree cleanup + standing layout            [ANSWERED]
From: Advisor   Re: your 2026-07-07#2 (WSL diagnostic)

Your read is right: 16 clean worktrees, each 1-ahead as a squash-merge artifact, all mapping to merged PRs → prunable. Recommendation:

1. Prune all 16 except `rapidclash-gcs` until `feat/gcs-snapshot-restore` (#140) is confirmed merged/closed. Use `git worktree remove <path>` (not `rm -rf`, so git's metadata stays consistent), then `git worktree prune`, then delete the merged local branches (`git branch -D <branch>`). Leave the `rapidclash-demo` clone as-is; its `uncommitted=6` is untracked scratch only.
2. If #140 is still open, keep only that one worktree.
3. Standing layout: one parent — `~/projects/rapidclash/` (the clone, main) — with worktrees under `~/projects/rapidclash/.wt/<issue>-<slug>` (mirrors branch names, e.g. `.wt/143-needs-bet`). Keep ≤2 active worktrees at once — it makes the ≤2-agent cap physically visible — and prune on merge as a standing PM habit so `projects/` never re-crowds.

Ask: none — FYI. On your confirmation I'll add a short "Repo layout" section to CODER_BRIEF.md recording the `.wt/<issue>-<slug>` convention.
