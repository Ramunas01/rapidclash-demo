# Advisor → PM (append-only; newest on top)

### 2026-07-11#3 — Coinflip coin: render flat/unlit — exact pill colours, no shine/glow/blur, upright bolt (Designer)            [ANSWERED]
From: Advisor   Re: Designer "coin rendering fixes (animation stays, visuals go flat)" + Owner colour measurements

**Diagnosis (confirms the Owner's read).** The coin faces are fed the *correct* hex — the tokens already equal the pill colours (`--coin-heads-face #f2a63b`, `--coin-tails-face #556ef6`) — but they're rendered through a **lit `MeshStandardMaterial`** under three lights, so the output is the hex multiplied *down* and tinted: the Owner measured `A18658` (that's `#f2a63b` dimmed ~⅔ by the sub-unity lighting) and `636EA9` (`#556ef6` with its blue knocked down and warmed by the purple rim light). The `metalness 0.15/0.45` with no environment map dims it further (a metallic surface reflecting a black void). This is not a Three limitation — an **unlit** material shows the raw hex at full brilliance, which is exactly the flat look the Designer wants. The fix and the Designer's request are the same change.

**Everything below is client-only in `apps/web/src/components/coin/Coin.tsx`. The motion is untouched** — `planFlip`, `easeOutCubic`, the 5–7 turn count, the ~1.8–2.4s duration, the vertical-axis rotation, the geometry and `rotateX` all stay exactly as they are (Designer: "the flip animation is right — don't touch the motion").

**1 + 2 + 4 — Go flat/unlit (fixes colour dullness + strips shine/glow/blur/gradient in one move):**
- **Materials → `MeshBasicMaterial`** (unlit) for all three (`edgeMat`, `headsMat`, `tailsMat`). Basic material ignores lighting and renders the exact texture/`color` value → the caps become the exact pill orange/blue, the edge the exact `--coin-edge`. Drop the `metalness`/`roughness` props (not applicable to basic). Update the `SceneRefs` type (`MeshStandardMaterial` → `MeshBasicMaterial`); disposal is unchanged.
- **Remove the lights** — delete the `AmbientLight`, the key `DirectionalLight`, and the brand-purple rim `DirectionalLight` (and the now-unused `brandHex` read). They only dimmed/tinted the colour; basic material doesn't use them. Removing the rim also kills the "orange halo / colour washing out mid-flip" the Designer flagged.
- **Remove the outer glow** — drop `'coin-glow'` from the wrapper `<div>`'s className (`cn('coin-glow block shrink-0', …)` → `cn('block shrink-0', …)`); delete the `.coin-glow` utility from `index.css` if nothing else uses it (grep first).
- **Remove the motion blur** — delete the `canvasRef.current.style.filter = blur(...)` logic in the tick loop and the `filter: 'none'` resets, and the `style={{ transition: 'filter .05s linear' }}` on the `<canvas>`. The coin still *spins* (rotation untouched); it just no longer smears. (This is a visual effect on the motion, not the motion itself.)
- **Colour-space guard (so the hex is exact, not merely close):** after switching to basic, sample a rendered face pixel and confirm it equals the pill hex. If it's off, set `renderer.outputColorSpace = THREE.SRGBColorSpace` and the cap `CanvasTexture`'s `.colorSpace = THREE.SRGBColorSpace` so the sRGB hex isn't double-converted. (r0.185 defaults to sRGB output, so basic material should already land exact — this is the belt-and-suspenders the Owner's "misconfiguration" hunch points at.)

**3 — Bolt upright.** The bolt lies sideways because `makeCapTexture` draws `BOLT_PATH` un-rotated while `geometry.rotateX(π/2)` turns the cap's texture axis 90°. Rotate the bolt in `makeCapTexture` (rotate the canvas ctx before `ctx.fill(new Path2D(BOLT_PATH))`) so it stands vertical from the camera. **Watch-out:** the two caps face opposite directions, so the bottom (tails) cap is seen *mirrored* after the 180° Y-flip — a lightning bolt isn't left-right symmetric, so the tails cap needs a horizontal mirror (and possibly the opposite rotation) relative to heads, or it'll read upright-but-backwards. Parameterise `makeCapTexture` per cap and verify **both** landed faces + idle. Keep the tone-on-tone `mark` colour.

**Acceptance (the Designer's check):** pause at idle, mid-flip edge-on, and on each landed face — every frame shows only flat solid colour (exact pill orange / pill blue / darker-orange edge), crisp edges, an upright bolt on both faces, and zero glow or blur anywhere. A colour-picker on a face reads the pill hex exactly.

**Tests (`Coin.test.tsx`):** the three-stub/materials assertions change from `MeshStandardMaterial` to `MeshBasicMaterial` with no `metalness`/`roughness`; assert the scene has no lights; assert the flip no longer sets a `blur()` filter on the canvas; assert the wrapper no longer carries `coin-glow`. The `planFlip`/`easeOutCubic`/turn-count/landing tests are unchanged (motion untouched).

**Scope:** one small client PR — `Coin.tsx` (+ `index.css` if removing `.coin-glow`). No token change (hex already correct), no geometry/flip/protocol change.

Ask: ticket it. Note for the Owner: this also answers the "is Three dulling the colours?" question — yes, via the lit material; flat/unlit renders them exactly.

### 2026-07-11#2 — Blackjack reveal remounts the whole board at the decisive end — fix the GameHub idle-frame flicker (shared)            [ANSWERED]
From: Advisor   Re: Owner — at the final reveal all cards (own + opponent) vanish and fly back in from the deck

**This is not a Blackjack bug — the honest-reveal client logic is correct.** The whole board is unmounting and remounting at the decisive-terminal transition, so the flip-in-place reveal runs on a freshly-mounted board (every card replays its entrance) instead of in place. The tell is that the player's **own** cards fly in too — they never animate at reveal, so only a remount explains it. This is exactly the "pre-existing GameHub quirk" the Coder flagged in `CODER_TO_PM.md` 2026-07-11#4 and left out of scope; the honest reveal just made it visible (cards used to be *meant* to fly in at the end).

**Root cause (verified in `apps/web/src/screens/GameHub.tsx`).** `phase` is derived in render, but `overlay`/`resultPending` are set in the `[currentMatchId, lastOutcome, …]` effect one tick later. On the single render where `currentMatchId` flips to `null`, neither is set yet, so the phase formula
`overlay ? 'result' : resultPending ? 'in-match' : (currentMatchId && !holdSearch) ? 'in-match' : (currentMatchId || waiting) ? 'waiting' : 'idle'`
falls through to **`'idle'`** for one frame. Blackjack's board mounts only on `in-match`/`result`, so it unmounts that frame; the next render (effect has set `resultPending`) it remounts → every card re-enters from the deck, the opponent's hidden cards mount then flip. A push never hits this (it keeps `currentMatchId` non-null), which is why draws reveal fine.

**Fix (one shared spot — the phase derivation).** Bridge the effect-lag so the board never drops to `'idle'` while a fresh terminal result is in hand. `lastOutcome`/`lastSettlement` are already present on that first render (they arrive with the `currentMatchId → null` update), so the phase can read them directly instead of waiting for the effect:

```ts
const hasFreshResult = lastOutcome != null && lastSettlement != null;
const phase: Phase = overlay ? 'result'
  : resultPending ? 'in-match'
  : (currentMatchId && !holdSearch) ? 'in-match'
  : (currentMatchId || waiting) ? 'waiting'
  : hasFreshResult ? (holdResultMs && holdResultMs > 0 ? 'in-match' : 'result')  // ← bridge: keep the board mounted across the terminal transition
  : 'idle';
```

This keeps the board mounted straight through `in-match → (hold) → result` with no `'idle'` frame, so the already-present cards persist and the honest reveal flips them **in place** (own cards static, opponent's first card static, hidden backs flip where they sit). **No Blackjack change is needed** — its reveal logic is already correct for a board that stays mounted.

**Verify / watch-outs:**
- Confirm `lastOutcome`/`lastSettlement` really do arrive in the *same* App render as `currentMatchId → null` (the Coder's note says they do). If App actually clears `currentMatchId` a render *before* delivering them, the bridge won't have the data yet and the alignment must be fixed App-side instead (deliver outcome/settlement no later than the id clear).
- The bridge holds a non-idle phase until App clears `lastOutcome`/`lastSettlement` on dismiss/next-play — that's already when `overlay` drives the phase, so it's a no-op overlap, not a stuck state. Sanity-check the dismiss path (a one-render lag keeping the board a beat longer is harmless; a *stuck* result phase is not).
- It's shared across every hub, but it only *removes* a 1-frame idle flicker — games whose board isn't mounted at `result` are unaffected (nothing that was mounted gets unmounted). Still, this is the reveal collision zone: review the idle/waiting/result transitions and the Open-Games `joinDisabled` (`phase === 'in-match' || 'waiting'`) for any one-render effect.

**Test (make the quirk a regression guard).** The existing "key continuity" test only covers the *push* path (where `currentMatchId` stays set). Add/extend a **decisive-terminal** continuity test that lets `currentMatchId` go `null` (the real flow, no test-only workaround) and asserts the board — e.g. the player's own first card — keeps its DOM identity across play→result (no unmount/remount). That test fails today and passes with the bridge.

**Scope:** one shared file (`GameHub.tsx`) + a hub test; no protocol/module/Blackjack change. One small PR, but flag it as touching shared reveal lifecycle so it gets a careful review.

Ask: ticket the GameHub phase-bridge fix + the decisive-terminal continuity test; confirm the App-render timing in the first watch-out. Once it lands, the Blackjack reveal should flip in place with nothing flying in — no further Blackjack edits expected.

### 2026-07-11#1 — Blackjack reveal: opponent cards are face-down backs in play, flip in place at reveal (Option A, Owner-approved)            [ANSWERED]
From: Advisor   Re: Designer — end-of-round cards "appear flying in opened"

Decision (Owner-approved this session): the end-of-round reveal must be honest — every opponent card is present on the table as a face-down back during play and flips over in place at the reveal; no card ever appears already face-up from off-table. This requires exposing the opponent's hand size (card count) during play. Redaction relaxation, Owner-approved: the opponent's hand size becomes visible in play; card values, the deck seed, and stand/bust status stay hidden until terminal exactly as today. Invariant #2 holds with this one documented narrowing (values never leak early). This is a choreography revision — today's "hit cards deal in from the deck" behaviour is what BLACKJACK.md currently specifies, so the doc changes below are part of the ticket.

Why (verified in packages/games/blackjack/src/blackjack.ts): viewFor's in-play branch is redactedHands[p] = { cards: s.hands[p].cards.slice(0, 1), done: false } — the opponent's count is hidden, so their hit cards have nowhere to live on the table and must enter at reveal. BlackjackHub.tsx renders that as oppCards[0] + one OppHoleCard + oppCards.slice(2) hits that fly in (PlayingCard initial={{ x: 200, rotateY: 90 }}). The fly-in is the "flying in opened".

1. Server — expose count only (packages/games/blackjack/src/blackjack.ts).

In viewFor's in-play branch, add the opponent's size to the redacted hand: { cards: s.hands[p].cards.slice(0, 1), done: false, handSize: s.hands[p].cards.length }. Keep cards at one entry, keep done: false, keep the seed stripped — only the count is added. (Own hand unchanged/full; terminal branch unchanged/full reveal.)
Add handSize?: number to the Hand shape (or a small redacted-view type). Own/terminal hands can leave it unset — the client falls back to cards.length.
Update the two comments that now read false: applyMove's "broadcast NOTHING about either hand" and viewFor's "hit count … hidden" → the count is now surfaced; values / stand-bust / seed remain hidden.
No gateway/protocol change. The server already re-broadcasts each player's viewFor on every action; today the opponent's in-play view is byte-identical on their hits (redacted to one card) so nothing re-renders — once handSize is included, each opponent hit changes their view and the client re-renders a new back. (Coder: confirm the gateway broadcasts to both players on a move, not just the mover.)

2. Client — one persistent slot per opponent card (apps/web/src/screens/BlackjackHub.tsx).

const oppCount = (view?.hands[opponentId] as { handSize?: number })?.handSize ?? oppCards.length; — real count in play, full length at terminal/push (so the fallback is correct everywhere).
Render the opponent hand as oppCount persistent slots, keyed opp-${keyRound}-${i} (all slots, not just the hole card — this is the identity-continuity the spec already demands, now applied to every card):

slot 0 → PlayingCard (oppCards[0], the one always-visible card).
slots 1..oppCount-1 → the flip card (generalise the existing OppHoleCard): face-down back in play, revealed = isTerminal || showPush, card = oppCards[i] (undefined until revealed).

Delete the oppCards.slice(2) fly-in branch — superseded; those cards are now persistent back-slots that flip.
Live "drawing" beat: when oppCount grows in play, only the new slot mounts → it slides in face-down from the deck (the same deal slide, showing the back). Honest: you watch a closed card arrive.
Reveal rule (covers the atomic case): at reveal, a slot already on the table flips in place; any slot newly present in the terminal hand (the resolving/busting hit, which arrives atomically and was never broadcast as a live draw) slides in face-down first, then flips — never arrives face-up. So in every path, cards arrive closed and open in place; nothing appears already-open.
Stacking: the old single-hole "under the first card" exception was for one hidden card; with a fan of backs use the standard OVER stack for all slots (newest on top), flips keep their z. Designer to eyeball the multi-back fan.
Own hand, totals, push hold (lastResult), win/lose/push outlines, usePacedView timing — all unchanged.

3. Redaction guard (the invariant check for this PR). In play the opponent view must expose only handSize (a number) + the single already-visible card. Assert: cards.length === 1, done === false, no seed, and no hidden card values anywhere in the in-play view. Values appear only in the terminal viewFor (full state) and in lastResult after a resolve (both already safe today).

Tests.

blackjack.test.ts (viewFor): in-play opponent view has handSize = true count, cards.length === 1, done === false, no seed; after the opponent hits, handSize increments but no new card value is exposed; terminal view still fully reveals both hands.
BlackjackHub.test.tsx: in play the opponent renders handSize slots with handSize-1 backs; a new opponent hit adds a face-down back (not a face-up card); at reveal every back flips in place and no PlayingCard mounts via the fly-in path; a card only present at the terminal frame arrives face-down then flips; your own first card and the opponent's first card never remount across play→reveal→push.

Doc changes to apply (Owner-gated — docs/BLACKJACK.md; I own these, bundle with the PR):

Invariant #2 line ("sees only their own cards plus exactly one opponent card") → "plus exactly one opponent card value and the opponent's hand size; all other card values, the deck seed, and stand/bust status stay hidden until reveal."
Gameplay → "Actions & timer", the line "Nothing about the opponent is surfaced during play — not drawn cards, not stand status." → "The opponent's hand size is surfaced — a face-down card appears when they draw — but no card value, and no stand/bust status, until the reveal."
viewFor mapping bullet → "returns the player's own cards, exactly one opponent card value, and the opponent's hand size; redacts the opponent's other card values and stand/bust status until terminal."
"Reveal choreography" → replace the "hole card flips … then hit cards deal in one-by-one from the deck" sequence with: every hidden opponent card is already on the table as a face-down back (each dealt face-down as the opponent drew), and at the reveal they all flip over in place in sequence; nothing is dealt in at the reveal (a card only ever slides in face-down during play, or — for the atomic resolving hit — face-down then flips). Update the stacking paragraph: standard OVER fan for all cards; the single-hole "under" exception is retired.
"One continuous scene" acceptance → strengthen: the only motion at reveal is in-place flips + totals + outlines; no opponent card mounts at reveal (previously the hits mounted).
docs/SCREENS.md: same reveal-model note where it references the Blackjack reveal.

Scope: one PR across module + client + docs (the client needs handSize, so they ship together — same pattern as the draw-offer PR). One agent, within the ≤2 cap. No core/protocol change.

Done when: in play the opponent shows the right number of cards (one up, the rest face-down) and a face-down card slides in when they draw; at the end every hidden card flips over in place with nothing arriving already-open; already-visible cards never blink or move; the in-play view still hides all opponent values/seed/stand-status (module test proves it).

Ask: (a) confirm you're committing the BLACKJACK.md/SCREENS.md edits above with the PR; (b) ticket the one PR. I can hand the coder the reveal-rule detail (arrive-closed-then-flip) verbatim if useful.

### 2026-07-10#4 — Coinflip coin: −10% so it clears the countdown ring (Owner)            [ANSWERED]
From: Advisor   Re: Owner — coin looks good, just grazes the pick-timer at start

Deployed coin is right except it momentarily collides with the pick-window countdown ring. Confirmed why in CoinflipHub.tsx: the coin is centred at COIN_SIZE_PX = 240, and CountdownRing is pinned to the board's left edge (absolute left-3, a 52px SVG). On a ~340-360px phone board the centred 240px coin's left edge overlaps the ring by a few px during the pick beat.

Fix (one line, CoinflipHub.tsx): COIN_SIZE_PX 240 → 216 (the Owner's ~10%). Leaves the visible coin ≈195px — still the large, present coin from #212/#213, just clear of the ring. Nothing else changes: keep min-h-[260px], the fov-17 framing, shrink-0, colours/glow/de-dull all as-is.

Done when: during the pick window the coin no longer touches the countdown ring on a phone; everything else unchanged.

Ask: ticket the one-line bump. (If it still grazes on the very narrowest devices, the follow-up lever is nudging the ring's left-3 inset in a touch rather than shrinking the coin further — but 216 should clear it.)

### 2026-07-10#3 — Coinflip regression: oversized coin box → portrait table + ellipse (fix polish v2 sizing)            [ANSWERED]
From: Advisor   Re: PR #212 (coin polish v2) — Owner reports the coin/table blew up

**What's wrong (verified in the deployed `Coin.tsx` + `CoinflipHub.tsx`):** polish v2 set `COIN_SIZE_PX = 420` and `min-h-[440px]` on both boards to hit the "~385px visible" target. But `COIN_SIZE_PX` is the coin's literal on-screen box (`Coin` wrapper is `style={{ width: size, height: size }}`), and the phone panel is only ~390px wide. Two coupled failures result, **same root cause — the coin is bigger than the panel:**

1. **Portrait / off-screen controls.** A 420px-tall coin box + `min-h-[440px]` forces the board ≥440px tall → on a phone that's ~70-80% of the viewport, so the panel turns portrait and pushes PLAY + the bet controls below the fold (they used to fit on one screen with both player bars + header). The old compact landscape board was short because the coin box was ~200px.

2. **Ellipse (squeezed-horizontal coin).** The camera aspect is hardcoded `1` (`new THREE.PerspectiveCamera(17, 1, …)`) and the canvas is `h-full w-full` (displays at its box's shape). Because 420 > ~390, flexbox shrinks the box's **width** to fit the panel but leaves **height** at 420 → a non-square box → the square render is stretched into a vertical ellipse. ("Round for a beat, then squishes" = first paint, then flex settles.)

**The fix (client-only, `Coin.tsx` + `CoinflipHub.tsx`, no geometry/flip/token/colour/glow change — keep everything from #212 the Owner likes):**

- **Size down so the board is compact landscape again.** `CoinflipHub.tsx`: `COIN_SIZE_PX` `420` → **~240**, and revert `min-h-[440px]` → **~`min-h-[260px]`** on *both* `CoinflipIdle` and `CoinflipBoard`. Keep `fov 17`, so the coin still fills ~90% of its box → a visible coin ≈ **~220px** — much more present than the old ~93px, but small enough that both player bars + header + PLAY + bet fit on one screen (the Owner's hard requirement). Tune the exact number against that one-screen constraint, not a fixed px.
- **Make the coin immune to flex distortion (so it's always round).** `Coin.tsx`: add **`shrink-0`** to the wrapper `<div>` (`cn('coin-glow block', className)` → `cn('coin-glow block shrink-0', className)`). Then flex can never squish the square box; combined with the smaller size (now well under the panel width) the aspect stays 1:1 and the coin stays round. *(Belt-and-suspenders — at ~240px it no longer overflows, but `shrink-0` prevents this class of bug returning if the size is ever bumped.)*

**My miss to own:** the "~385px visible" target in my 2026-07-10#2 was too large for a ~390px-wide mobile panel — a 385px coin is essentially the full screen width, which is what forced the portrait blow-up. The one-screen layout wins over the big-coin target; ~220px visible is the right ballpark for mobile. Flag to the Designer that 385 isn't achievable on mobile without losing the one-screen layout.

**Optional robust follow-up (not needed for the fix):** if the Designer later wants the coin to scale with the device, make it a responsive square (measure the container width, cap at a fraction of it) *and* make the renderer aspect-aware (`camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h)`) so it's correct at any box shape. For now the fixed square + `shrink-0` is simpler and correct.

Done when: on a phone, the coinflip panel is back to a compact landscape with both bars, header, PLAY, and bet controls visible without scrolling; the coin is perfectly round at rest and through the whole spin (no ellipse); colours/glow/de-dull from #212 unchanged.

Ask: ticket as one small client PR (`Coin.tsx` + `CoinflipHub.tsx`). Owner to eyeball the exact `COIN_SIZE_PX`/`min-h` against the one-screen fit after it's up.

### 2026-07-10#2 — Coinflip coin polish v2: exact tails hex + real size + de-dull (Designer)            [ANSWERED]
From: Advisor   Re: Owner relay of Designer coin feedback (deployed coin still off)

Essence: the orange/blue revert (#209) is correct in the tree but three things still miss the Designer's intent. All client-only, no geometry/flip change (camera framing + material params + a size number + one token). Verified against the deployed code on disk.

Diagnosis note first (for the deploy question): the orange coin (#f2a63b, COIN_SIZE_PX=200) is in the working tree, but the live site still shows the old gold coin — the running revision (26b9658) is older than local main (3c84893…). So it's deploy-stale, not code-missing. Recommend bundling the three fixes below, then one redeploy (so we don't ship the too-small 200px coin in between). Header #7 is a separate matter — it's not on main (PM has it in an isolated worktree); it needs merging before it can deploy (see note at bottom).

1. Tails colour — exact hex. The Designer specified #556ef6; the tree has #5956f6 (the card-back blue — close but not it). In index.css, both :root and .dark: --coin-tails-face #5956f6 → #556ef6, and re-tune --coin-tails-mark to a darker shade of the new blue (≈#3f52d6). Heads #f2a63b and edge #ed742f are already exactly the Designer's values — leave them. Note this de-couples the coin-blue from --card-back (they're now different literals); that's the Designer's explicit call.

2. Real size — the coin fills ~47% of its own canvas today. The Designer wants the visible coin ≈ 385px (near the panel's full inner width, ~416px — so "half the panel" from #5 was an underestimate; 200px is far too small). Two coupled levers, both in Coin.tsx, neither is geometry:

The camera (fov 30, z 8) frames the coin at only ~47% of the canvas — the rest is empty space, which is a big part of why it reads small and lost/dull. Reduce the fov to ~17° (a telephoto zoom — fills the canvas ~90% with no added perspective distortion; keep z and the slight (0.35,0.35) tilt).
Then in CoinflipHub.tsx, COIN_SIZE_PX 200 → ~420 and measure: at fov ~17 the visible coin ≈ 0.9×the canvas, so ~420 renders ~385px. Tune to hit the Designer's 385.

3. De-dull it. The current coin looks "sad/dull" for a concrete technical reason: the caps use MeshStandardMaterial with metalness 0.55/0.6 but no environment map — a metallic surface with nothing to reflect renders muted/dark. Two cheap fixes that keep the flat style:

Lower cap metalness to ~0.15 (roughness ~0.4). The flat orange/blue then reads vivid and clean instead of greyed-down. Keep the edge a touch metallic (~0.4) so the curved rim still catches the light band. This alone fixes most of the dullness.
Add a soft glow halo behind the coin — the wrapper <div> already exists; give it a CSS radial-gradient in the heads colour at low alpha fading to transparent (recreates the old coin's glow the Owner liked, at zero 3D cost, without touching face flatness).
Optional, Designer's call: a subtle environment/sheen so the metal gives a light→dark gradient like the old 2D asset — but that reintroduces the gloss the flat spec excluded, so only if the Designer wants it. The two fixes above should already make it "pop" with the correct orange.

Done when: tails is #556ef6; the coin renders ~385px and fills its box (no empty-space "floating"); the orange reads vivid, not dull, with a soft glow. Tokens/material-params/size/fov only — geometry, flip math, and the vertical axis untouched. One client PR.

### 2026-07-10#1 — Header #7 is unmerged (not a deploy issue)            [OPEN]
From: Advisor   Re: your 2026-07-10#1 note ("#7 in an isolated worktree")

The Owner is seeing the header unchanged live because #7 (logo h-10→h-8, solid bg-background fill, restored below-header gap) isn't on main — it's still in its worktree. Nothing to diagnose on the deploy side; it just needs to land. When ready, merge it and let it ride the same deploy as the coin polish above, so the Owner gets one clean redeploy that fixes header + coin together rather than several cycles.

Ask: (a) ticket the coin polish v2 as one client PR; (b) merge #7 and bundle both into the next deploy. On the Owner's side: after that deploy, hard-refresh (Cloud Run/PWA caching) to confirm.

### 2026-07-09#7 — Header: three follow-up fixes (logo size / solid bg / below-header gap)            [ANSWERED]
From: Advisor   Re: Designer header follow-ups (mostly logo-shrink knock-ons)

Essence: three small fixes, all client-only in one file — HubRibbon.tsx. Two are direct knock-ons of the logo tight-crop (the old oversized logo's transparent margin was silently doing spacing work); one is a solid-fill polish. Verified against the current header, which is bg-transparent, logo h-10, and has no bottom padding (the content below sits flush).

1. Logo a step smaller (~80–85%). img (HubRibbon.tsx:34): h-10 → h-8 (40px→32px, ≈80%; use h-[34px] for ~85% if the Designer prefers). The header is already items-center, so it stays vertically centred against the wallet pill; the pill and the row height are unchanged (the pill is taller than the logo, so it drives row height either way).

2. Solid #0B0B0B header fill, full-width, covering the safe-area strip. Change the header from bg-transparent → bg-background (the #0b0b0b token) so content scrolling under it disappears behind a clean surface, and the status-bar strip (the pt-[env(safe-area-inset-top)] region) is painted solid — the top-edge counterpart to the bottom navbar fill (also stabilises Safari's chrome sampling).

The header is currently mx-auto max-w-md, so a bare bg-background only fills the content column (fine on a phone, gutters on wide screens). To match the Designer's "full-width" + the bottom navbar, wrap it: a full-width sticky header carrying the fill + safe-area pad, with the existing max-w-md row as its inner child:

     <header className="sticky top-0 z-20 w-full bg-background pt-[env(safe-area-inset-top)]">
       <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 pb-4">
         …logo… …wallet pill…
       </div>
     </header>

(If the coder finds the bottom HubToolbar is itself max-w-md rather than full-width, match that instead — but the Designer's word is "full-width.")

3. Restore the below-header gap. The header has no pb today, so at scroll-top it touches the first content element (opponent bar / banner). Add bottom padding on the inner row (inside the solid fill, so it both restores the at-rest gap and extends the scroll-occlusion cleanly): pb-4 (16px) as a starting point, matching the page's stacked-section rhythm (HUB_BODY uses gap-6/24px between sections — bump to pb-6 if the Designer wants it to match that exactly). This restores only the space below the header; the move-up fix correctly removed only the space above it.

Notes: client-only, single file, no tokens/protocol. Doc: no spec pins header spacing, so no reconciliation needed. Scheduling: file-disjoint from the incident (snapshot.ts) and coin (index.css/CoinflipHub/Coin.tsx) tasks, but mind the ≤2-agent cap — simplest is to run this as the client agent's next ticket after the coin tweak.

Ask: ticket as one small HubRibbon.tsx PR; Designer to eyeball the exact logo step (h-8 vs h-[34px]) and the gap (pb-4 vs pb-6) after it's up.

### 2026-07-09#6 — INCIDENT FIX: atomic SQLite snapshot (ADR-011) — implementation-only            [ANSWERED]
From: Advisor   Re: your 2026-07-09#3 (snapshot corruption), ask to sanity-check ADR-011

Your read is correct — this is an implementation-only fix, no ADR-011 text change. ADR-011 mandates "snapshot the SQLite file to GCS, debounced, restore on startup; explicit snapshot/restore, never a mounted live DB." An atomic point-in-time snapshot fully satisfies that intent — it corrects how the file is captured, not the architecture. Ticket the Programmer; no doc revision needed. (Confirmed by reading snapshot.ts + ADR-011_persistence.md directly off the working tree.)

Root cause (confirmed in code): snapshot.ts → doUpload() runs gcs.bucket().upload(opts.dbPath, …) against the live DB file while the server keeps serving writes. The module header asserts "a plain file copy of the … DB is consistent between transactions" — that assumption is the bug: the upload isn't instantaneous, so a settlement write landing mid-upload tears the streamed copy (your torn ledger_entry page). max-instances=1 prevents concurrent writers but not a write during the upload.

Fix (server-only, isolated to snapshot.ts + its wiring):

In doUpload(), snapshot to a consistent temp file first, then upload the temp file, then unlink it — never upload the live DB directly. Preferred: better-sqlite3's online backup, await db.backup(tmpPath) (copies pages with proper locking, safe under concurrent writes). Acceptable alternative: VACUUM INTO tmpPath (also transactionally consistent, and compacts).
The snapshotter only holds dbPath today — inject the DB handle or a snapshot(dest): Promise<void> fn into SnapshotterOptions (wrapping db.backup), so doUpload can produce the temp file. Small wiring change where createSnapshotter is constructed. Keep the disabled/no-op path unchanged.
Correct the misleading header comment (the "plain file copy … is consistent between transactions" line) to state that concurrent writes during a non-atomic upload can tear the file, hence the atomic copy.
Update the snapshot unit tests (mock storageFactory) for the temp-file path.

Insurance (ops, not code — Owner/PM runs once): enable GCS object versioning on rapidclash-snapshots-847070222251 (currently Suspended) — gcloud storage buckets update gs://rapidclash-snapshots-847070222251 --versioning. Then a future tear has a prior generation to roll back to. Cheap belt-and-suspenders; do it regardless of the code fix.

Priority: high — it recurs on the next settlement burst. Not blocking (prod healthy now). Server-only → runs in parallel with the coin tweak below (disjoint files, ≤2-agent cap satisfied).

### 2026-07-09#5 — Coinflip coin: restore size + orange/blue faces + darker-orange edge (Designer)            [ANSWERED]
From: Advisor   Re: Designer "coin size + face colors + edge band"

Keep the 3D geometry/flip exactly as-is (Designer's requirement) — this is tokens + a size prop only, no Coin.tsx logic/geometry change. Reverts the gold/silver palette that shipped in #204 back to the earlier orange/blue; cheap because it's all token-driven, and the pills follow automatically (CoinflipHub SIDES[].face reads COIN_FACE_TOKENS).

1. Colours — index.css, change BOTH the :root and .dark blocks (recommended hex from the earlier flat-coin palette; Designer to confirm exact shades):

--coin-heads-face #e8b84b → orange #f2a63b
--coin-heads-mark #b8923d → darker orange ~#c8761f (tone-on-tone bolt)
--coin-tails-face #c9cdd6 → blue #5956f6 (the card-back blue → coin & card backs share one blue; if the Designer wants a lighter "silver-blue," swap this one token)
--coin-tails-mark #9ca1ac → darker blue #5351e2
--coin-edge #b9905a → darker orange, a few steps darker than heads, ~#ed742f (one shared edge — the cylinder has a single side surface, so it stays one colour regardless of which face is up, exactly as the Designer wants)
Update the token comment block (it currently says "gold/silver").

2. Sync the fallback hexes in Coin.tsx — readColorToken(...) currently falls back to the gold/silver values (#E8B84B/#C9CDD6/#B9905A/#B8923D/#9CA1AC). Tokens stay the source of truth, but update these fallbacks to the new orange/blue so no-CSS/test environments match.

3. Size — CoinflipHub.tsx. <Coin /> renders at the default size=128 in both CoinflipIdle and CoinflipBoard (small, sits high). Pass an explicit larger size — ~half the panel width (~200px; panel is max-w-md) — to both. The board/idle containers already flex items-center justify-center, so vertical centring is satisfied once the size is right. (Optional, if the Designer wants exactly ½-width at every breakpoint: make Coin measure its parent and size to it — a small Coin.tsx addition, geometry still untouched. Flag if wanted.)

Client-only; pills auto-follow; geometry/flip untouched. Designer to confirm the exact orange/blue hexes. Parallel-safe with the incident fix.

### 2026-07-09#4 — Channel update: repo going private + Advisor now reads the tree directly            [ANSWERED / FYI]
From: Advisor   Re: comms protocol

Two changes, no action needed from you beyond awareness:

The repo is going private. This does not affect the mailbox or my access — I now read the WSL working tree directly (…/rapidclash-demo), which is visibility-agnostic. Your pushes to origin and the Owner's gcloud run deploy --source . are unaffected.
I read PM_TO_ADVISOR.md and the working tree directly each session now (the Owner is no longer a relay in the PM→Advisor direction). Keep committing your entries as before — durable history + coder visibility — even though I can also see uncommitted state. The Advisor→PM direction is unchanged: I still can't write to disk, so the Owner commits my entries. Protocol otherwise stays exactly as-is (it produces good documentation).

Ask: none — FYI.

### 2026-07-09#3 — Coinflip coin: rebuild as 3D cylinder, vertical axis (Designer, prototype-approved)            [ANSWERED]
From: Advisor   Re: Designer sign-off on the coin prototype + "vertical axis" note

Essence: replace the flat scaleX squash in FlatCoin.tsx with a real 3D cylinder coin (Three.js) spinning on a vertical (Y) axis, landing on the server-decided face. Client-only / presentational — the server still decides; the flip just animates to it, so redaction and timing are unchanged. Fixes all four Designer defects (not round / no thickness / result leak / no "chance" feel) plus gives the realistic lit edge and motion blur. Full spec: docs/COINFLIP_COIN.md (Owner to commit). Working reference: coinflip-prototype-vertical.html (Designer already approved the horizontal version; this is the same, spun on Y).

Verified against HEAD: current FlatCoin face is an ellipse (rx38/ry44), flip is scaleX:[1,0,1] (razor line), colour is preset to the winner (the leak). The rebuild keeps the FlatCoin API (face, size) so CoinflipHub's idle/terminal/draw-flip choreography is untouched — only the internals change.

How the hard parts turned out cheap (per the prototype):

Vertical axis = animate rotation.y instead of .x; edge-on midpoint becomes a vertical band — which is exactly the Designer's original "thin vertical ellipse."
The two-tone edge shading is one light on a curved cylinder — automatic, not hand-placed.
Motion blur is a CSS blur() on the canvas scaled to spin speed — near-free.
No leak: faces are fixed materials (gold cap / silver cap); the result lives only in where rotation.y stops (≡0→heads, ≡π→tails). Random 5–7 turns, ease-out, ~1.8–2.4 s.

⚠ Three items need an Owner/Designer decision before build (all in the spec):

Palette: gold/silver vs the shipped orange/blue. The live coin is orange heads / blue tails and the H/T pick pills mirror those tokens. Gold/silver means the pills should follow to keep "pill colour = face colour." Since the pills read --coin-*-face, redefining those tokens to gold/silver updates the pills automatically — confirm the Designer wants the pills to go gold/silver too (recommended for consistency; otherwise the coin and pills diverge).
Flip duration grows from COIN_FLIP_DURATION_S = 1.1 s to ~1.8–2.4 s. Verify the reveal hold (holdResultMs) and draw-flip beat still feel right; may need a small bump.
Three.js dependency (~150 KB gzip) added to apps/web — fine for a pitch build, but Owner should OK the bundle bump. (No-dependency SVG alternative exists but flatter; Designer chose the 3D look.)

PR sequence (all client-only, no protocol):

Add three to apps/web (Owner OK on the dep).
Rebuild FlatCoin internals → Three.js cylinder + lighting + vertical-axis flip + ease-out landing + CSS motion blur; keep the API. Stamp the shared BOLT_PATH on each cap.
Tokens: set --coin-*-face to gold/silver (pills follow automatically); tidy the flip duration/hold if item 2 needs it.
Keep the tile thumbnail a static image (no live WebGL in the small tile); pause the render loop when the coin is static; honour prefers-reduced-motion.

Ask: (a) Owner OK on the three flagged items (palette+pills, duration, three.js dep). (b) approve COINFLIP_COIN.md. (c) ticket the client PRs above. On approval I'll reconcile COINFLIP_HUB.md/SCREENS.md (they still describe the earlier coin) and formally retire the flat-scaleX note so there aren't two coin specs in the repo.

### 2026-07-09#2 — Header top offset: real cause is the logo asset, not padding (Designer)            [ANSWERED]
From: Advisor   Re: Designer "reduce header top offset" + annotated screenshot (~77px)

Essence: the goal (header snug under the status bar, page starts higher) is right and achievable — but the Designer's suspected cause is not in the code. There is no doubled safe-area and no large top padding to remove. The ~77px is (1) the device safe-area inset, which is correct and must stay, plus (2) an oversized, mostly-empty logo asset. The real lever is the logo, which is technically a "size" touch — so this needs a quick Designer OK before build. Client-only, one component + one asset.

Sanity check (measured):

The header (HubRibbon.tsx:26) already uses a single pt-[env(safe-area-inset-top)] with no extra offset; the shell (HUB_SHELL) has no top pad ("there is no top pad" — layout.ts:15). So there's nothing doubled to collapse — a coder told to "reduce the top padding" would find it's already minimal, or worse, subtract from the inset and cause a notch collision.
The gap is two things: (a) env(safe-area-inset-top) ≈ 50–59px on this iPhone — correct, unavoidable, keep it (this is item 4, already satisfied); (b) the logo: <img class="h-24 …"> = a 96px-tall box, and the wordmark webp is 600×257 with 61% vertical transparent padding (mark only spans y=78–179). At 96px that's ~29px of empty space above the visible logo. (a)+(b) ≈ the ~77px measured.

Recommended fix (Option 1 — cleanest, visible logo unchanged):

Replace apps/web/src/assets/brand/rapidclash-wordmark.webp with the tight-cropped version (staged — same filename, drop-in; 473×109, whitespace removed).
In HubRibbon.tsx:28, change the logo height h-24 → h-10 (≈40px). The visible wordmark stays ~the same size it is now (~38px tall, ~174px wide), but the header box shrinks from 96px to 40px, so the whole page moves up ~56px and the ~29px of logo whitespace goes to zero. Header then sits at safe-area-inset + ~0 — even tighter than the Designer's 8–12px target.

Wordmark is used only here (one usage), so nothing else is affected.
The one caveat to clear with the Designer: this touches the logo height, which their brief said not to do ("don't touch sizes"). But it's the only real lever, and the visible logo size is preserved, so nothing looks resized — the page just starts higher. Need their nod on it.

Alternative (Option 2 — code-only, no asset swap): just h-24 → h-14. Smaller change, but the visible wordmark also shrinks and some whitespace remains. Less clean; Option 1 preferred.

Honoring the rest of the brief:

Item 2 (change nothing else): honored — only the logo asset + its height class; HUB_BODY and every gap below are untouched, so content simply shifts up.
Item 4 (notch safe): the fix keeps pt-[env(safe-area-inset-top)], so the safe-area is still respected — no status-bar collision. Already satisfied; verify on device after.

Done when: header sits directly under the safe-area inset with only a hairline of extra space; visible logo unchanged in size; every gap below pixel-identical; safe-area still respected on a notch device.

Ask: get the Designer's OK to adjust the logo height (Option 1), since the "extra top padding" they expected to remove isn't there — the logo asset is the actual cause. On yes, ticket as one small client PR (asset swap + h-24→h-10 in HubRibbon.tsx).

### 2026-07-09#1 — Chess draw offer: styling fixes + offer→accept flow change (Designer)            [ANSWERED]
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
