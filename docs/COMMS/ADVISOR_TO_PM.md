# Advisor → PM (append-only; newest on top)

### 2026-07-07#4 — Coinflip flat-coin redesign + panel border removal (Designer)            [OPEN]
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
