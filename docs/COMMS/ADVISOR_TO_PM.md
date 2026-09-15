# Advisor → PM (append-only; newest on top)

### 2026-09-15#5 — Account page's Recent Games fade in light mode: confirmed real, and the actual mechanism is more precise than "hardcoded grey" — it's the wrong TOKEN, not a literal, which is exactly why dark mode never caught it            [READY TO TICKET — one line, one file; closing ask (Rewards + elsewhere) checked, nothing else found]
From: Advisor   Re: Designer's spec for the Account page's Recent Games fade in light mode (screenshots in `design-ref/D13/`), verified against `ProfileHub.tsx`/`index.css`

Confirmed real, last item in the collection. Designer's own guess at the mechanism ("presumably the dark gradient with its alpha, or a hardcoded mid-tone") is reasonable but not quite it — there's no literal anywhere in this code. **It's a `color-mix()` gradient built from a token, exactly like the prototype's own construction — just the wrong token**, and the reason this has never been visible before is genuinely interesting: in dark mode, the wrong token and the right token happen to resolve to the identical value, so the bug has been a no-op until light mode existed to tell them apart.

---

## The bug: `ProfileHub.tsx:599` fades to `--rc-sunken`, not `--rc-bg` — and only light mode can tell the difference

`ProfileHub.tsx:599`:
```js
background: `linear-gradient(to bottom, transparent 0%, color-mix(in srgb, ${RC.sunken} 72%, transparent) 34%, color-mix(in srgb, ${RC.sunken} 94%, transparent) 66%, color-mix(in srgb, ${RC.sunken} 99%, transparent) 100%)`,
```
`RC.sunken` is `var(--rc-sunken)` (`ProfileHub.tsx:73`). The prototype's own citation (`Full Spec.html:1448`, confirmed) fades to `var(--rc-bg)` instead — a different token. **Why this was invisible until now, confirmed via `index.css`:**
- **Dark theme (`:81/83` and `:206/208`):** `--rc-bg: #0b0b0b` and `--rc-sunken: #0b0b0b` — **identical values.** Using the wrong token in dark mode produces a byte-identical gradient to using the right one. This is a genuine no-op bug, not a masked one.
- **Light theme (`:257/259`):** `--rc-bg: #ffffff` (white) but `--rc-sunken: #d3d3dd` (light grey) — **these diverge for the first time**, and `#d3d3dd` is exactly the "grey" Designer's screenshot shows. The bug was always there; light mode is what made it visible.

**One small correction to Designer's own citation, functionally immaterial:** the prototype's actual final gradient stop (`Full Spec.html:1448`) is `color-mix(in srgb, var(--rc-bg) 99%, transparent) 100%`, not literally `var(--rc-bg) 100%` as quoted in the ticket — a 1%-opacity difference from fully solid, imperceptible, and already exactly what this file's own 3 stops already do relative to `RC.sunken` (72%/94%/99%, matching the prototype's 72%/94%/99% exactly). The only real divergence is the token itself.

**Fix:** add `bg: 'var(--rc-bg)'` to the `RC` object (`:71-79`, no such entry exists yet — every other token this file uses is already there), then swap all three `${RC.sunken}` references at `:599` to `${RC.bg}`. Dark mode is provably unaffected (identical values); light mode fades to white as the prototype specifies. The VIEW MORE button's own fade-in/out (opacity, 380ms) is untouched — confirmed already correct, matching Designer's own note.

## The closing ask — checked Rewards and the rest of the tree; nothing else uses this pattern

Searched for the same shape (`linear-gradient(to bottom` across every screen/component file): three hits total.
- `ProfileHub.tsx:599` — this bug, above.
- `HubFooter.tsx:147` — already fixed correctly in `#587` (fades via `var(--rc-surface)`, not `--rc-sunken`).
- `GamesCarousel.tsx:656-657` — a different mechanism entirely (`mask-image`, solid black/alpha, not a background-color fade) for the Open Games list's own edge-fade; theme-invariant by construction, not a token bug.

**`RewardsHub.tsx` has no collapsed-list/VIEW MORE affordance at all** — confirmed via direct read, no `hasMorePages`/`Expanded`/"VIEW MORE" pattern anywhere in that file. Designer's "check Rewards" ask doesn't apply; there's nothing there to have this bug in the first place.

---

**Ask:** one-line-plus-one-object-key fix, single file, no scoping questions. This closes out D01-D13 — no packages left unprocessed.

---
### 2026-09-15#4 — Open Games section in light mode: same class of bug as the footer, 4 of 5 items confirmed exactly as diagnosed, item 5's tier-icon half is a real correction — it's not a color bug at all            [READY TO TICKET — one file, one PR; item 5's handle-color half folds into item 4, its tier-icon half needs nothing]
From: Advisor   Re: Designer's spec for the Open Games section in light mode (screenshots in `design-ref/D12-2/`), verified against `GamesCarousel.tsx`/`vipTier.tsx` and the live deployed page directly (`https://rapidclash-65hoiaulbq-uc.a.run.app`, `origin/main`@`9ebf568`)

Same root cause as the footer ticket (`2026-09-15#2`): this component has `#1A1A2E`/`#FFFFFF` written into it as literals instead of `var(--rc-surface)`/`var(--rc-text)`, so light mode never applies. Items 1-4 are confirmed exactly as Designer described, all in one file (`GamesCarousel.tsx`), all the same fix. Item 5 needed a live-DOM check to settle: its "handle missing on plain rows" half is real (same bug as item 4), but its "tier icon missing on striped rows" half doesn't hold up — checked 11 live rows directly, tier-icon presence tracks `ownerTier === 'Unranked'` (which renders nothing, by long-standing, already-documented design), completely independent of which rows are striped. Not a color bug, nothing to fix there.

---

## Items 1-4 — confirmed exactly as described, all in `GamesCarousel.tsx`, all the same literal-instead-of-token bug

- **Item 1 (OPEN GAMES heading gone):** `GamesCarousel.tsx:634` — `color: '#FFFFFF'` on the tab title span. Prototype (`Full Spec.html:297`): `color:var(--rc-text)`. Confirmed via the D12-2 screenshot: the heading isn't miscolored, it's genuinely invisible (white-on-white). **Fix:** `color: 'var(--rc-text)'`.
- **Item 2 (LIVE pill dark):** `GamesCarousel.tsx:637/639` — pill `background: '#1A1A2E'`, text `color: '#FFFFFF'`. Prototype (`Full Spec.html:299-302`): `background:var(--rc-surface)`, text `color:var(--rc-text)`. The pulse dot's green (`#34D399`) is correctly left alone — matches the prototype's own `var(--rc-green)`, which resolves to the same value in both themes (confirmed elsewhere this migration; a status-green dot is a deliberate theme-invariant, not an oversight). **Fix:** pill background → `var(--rc-surface)`, text → `var(--rc-text)`, dot untouched.
- **Item 3 (alternate rows navy):** `GamesCarousel.tsx:671` — `background: g.zebra ? '#1A1A2E' : 'transparent'`. Prototype (`Full Spec.html:3161`, exact match): `bg: i % 2 === 0 ? 'var(--rc-surface)' : 'transparent'`. **Fix:** `g.zebra ? 'var(--rc-surface)' : 'transparent'`.
- **Item 4 (row text white):** three literals, one small correction to Designer's own hex — the game name isn't literally `#FFFFFF`, it's `#F2F2F6` (`GamesCarousel.tsx:675`), a near-white grey that reads the same as white against a light background and fails for the identical reason. Handle (`:682`) and STAKE label (`:689`) are both genuinely `#FFFFFF`. Prototype (`Full Spec.html:314/331/335`, all three): `color:var(--rc-text)`. **Fix:** all three → `var(--rc-text)`.

## Item 5 — the handle-color half is real (same fix as item 4); the tier-icon half isn't a color bug, and isn't tied to row striping

Designer's framing treats both halves as one "white-on-light" problem. Checked directly, they're not the same mechanism:

- **Handle invisible on plain rows: real, but it's item 4's `:682` fix, not a separate bug.** No additional work beyond what's already scoped above.
- **Tier icon "missing on striped rows": doesn't hold up under a live-DOM check.** `vipTier.tsx`'s `TierIcon` renders `null` for `'Unranked'` hosts — a real, already-documented precedent from `2026-09-13#7`'s own ticket ("`'Unranked'` renders nothing... there is no badge below [Wood]"), not new behavior. Queried 11 live rows directly (host container's own child `<svg>`, not just "first svg in the row" — that first pass mistakenly picked up the STAKE section's currency icon on rows where the tier icon was legitimately absent, which would have led to the wrong conclusion): icon presence is `true`/`false`/`true`/`false`/`true`/`false` alternating essentially at random against zebra state (e.g. row-0 zebra=true HAS an icon, row-10 zebra=true does NOT; row-9 plain HAS one, row-5 plain does NOT) — tier assignment, not row striping, decides it. **Every tier icon's own fill is a fixed physical-badge color already** (Bronze `#C46B34`, Silver `#9BA2AE`, Gold `#D9A21F`, etc. — confirmed byte-identical to the prototype's own hardcoded fills at `Full Spec.html:316-330`, same colors in both themes, a deliberate invariant like Dice's die-cube faces from `2026-09-15#2`'s own closing note). **Nothing to fix here** — what Designer's screenshot captured was a coincidental sample where several `Unranked` hosts happened to land on striped rows that day, not a systemic bug.

---

**What's already right, confirmed:** the tab rail track/pills, JOIN buttons (`#8B45F0`, correctly theme-invariant purple), the green stake amounts (`AmountFigure`'s `#34D399`, matches the prototype's own theme-invariant `var(--rc-green)` resolving identically in both themes), the currency icon, and the thumbnail's `#1B1B2E` fallback background (Designer's own named exception — confirmed still a deliberate literal in the prototype too, `Full Spec.html:312`, not a token).

**Ask:** items 1-4 + item 5's handle half are one small, single-file PR (`GamesCarousel.tsx`), same shape as the footer fix — swap each literal for its token. Item 5's tier-icon half needs no code change; worth a one-line note back to Designer so the next light-mode sweep doesn't re-flag it.

---
### 2026-09-15#2 — Designer handoff on the footer in light mode: all 6 items confirmed real, one asset already sits in the repo unused, one item needs a scoping split, and the closing ask (repo-wide hex sweep) is real and bigger than this ticket — 15 files, not 1            [READY TO TICKET — 5 of 6 items are a clean single PR; the Events link and the repo-wide sweep both need their own follow-up]
From: Advisor   Re: Designer's spec for the footer's light-mode theming (screenshots in `design-ref/D11/`), verified against `HubFooter.tsx`/`index.css`/`HubRibbon.tsx` (`origin/main`@`b0af5f8`)

All 6 numbered items are confirmed real, exactly as described — this is the cleanest, most directly-actionable ticket of the batch so far, no corrections needed to Designer's own diagnosis anywhere. Two things worth flagging beyond the 6 items themselves: the "also" item (Events/Tournaments) has a real scoping wrinkle Designer's message doesn't fully spell out, and the closing ask (grep the whole tree for hardcoded hex) is a genuinely large, separate piece of work once actually run — 15 files, not the 1 this ticket touches.

---

## Items 1, 4, 5, 6 — confirmed, all the same shape: a hardcoded literal where a token belongs

- **Item 1 (gradient band):** `HubFooter.tsx:128-136` — `linear-gradient(to bottom, rgba(26,26,46,0)...rgba(26,26,46,1))`. `26,26,46` is `#1A1A2E` — the DARK theme's `--rc-surface` value specifically, hardcoded as a literal RGB rather than reading the token, confirmed via direct comparison to `index.css`'s own `--rc-surface: #1a1a2e` (dark block). **Fix:** replace with `color-mix(in srgb, var(--rc-surface) X%, transparent)` at the same 4 stops Designer cites, matching the `color-mix()` pattern already used elsewhere in this codebase for identical fade gradients (e.g. `HubToolbar.tsx`'s own nav-fade, `ProfileHub.tsx`'s match-list fade).
- **Item 4 (JOIN THE COMMUNITY heading):** `HubFooter.tsx:150` — `className="... text-white"`. **Fix:** `text-[var(--rc-text)]`.
- **Item 5 (link text):** `HubFooter.tsx:177` — `className="... text-foreground"`. Traced `text-foreground` to its actual source: `index.css`'s `--foreground: 240 5% 96%` (`#f4f4f5`, confirmed) is defined identically at both its dark-mode declarations with **no `[data-theme='light']` override anywhere in the file** (confirmed via exhaustive grep — every `--foreground`/`*-foreground` token in this file is dark-only). This is the exact same "legacy shadcn token never re-themed" class of bug already fixed on `HubToolbar.tsx`/`HubRibbon.tsx` earlier this week — Designer's own framing ("the same class of bug we've had on the menu, the nav and the game hubs") is accurate. **Fix, matching established precedent exactly:** swap `text-foreground` → `text-[var(--rc-text)]` locally in this file, not a global edit to the `--foreground` token itself (that token is used elsewhere in the app too; re-theming it globally is a bigger, separate change than this ticket, and every prior fix of this exact bug class has been scoped to the one file/component actually affected, not the shared token).
- **Item 6 (disclaimer/copyright/18+):** `HubFooter.tsx:196/202/210` — three separate `style={{ color: '#83838F' }}` literals. `#83838F` is `--rc-muted`'s DARK value specifically (confirmed) — light theme's `--rc-muted` is `#6e6e7a` (confirmed), a different value entirely, so this isn't even a "theme-invariant on purpose" case, it's the wrong literal for half the app's users. **Fix:** all three become `color: 'var(--rc-muted)'`.

## Item 3 — logo swap: confirmed, and the dark-mode asset already exists in the repo, unused

`HubFooter.tsx:146` renders a single hardcoded `<img src={wordmark} .../>` (`assets/brand/rapidclash-wordmark.webp`, the white-text variant) with no theme logic at all. **The exact fix already exists as a working pattern one file away:** `HubRibbon.tsx` (confirmed, `:2-5, 75-76`) already imports BOTH `rapidclash-wordmark.webp` (white) AND `rapidclash-wordmark-dark.png` (dark) — **the second asset is already sitting in `assets/brand/`, already committed, already used correctly in the header** — and swaps via `useTheme().resolved === 'light' ? <dark> : <light>`. **Fix:** copy this exact pattern into `HubFooter.tsx` verbatim (same two imports, same `useTheme()` call, same ternary) — zero new assets, zero new logic to design, pure reuse of an already-proven pattern in the sibling component Designer explicitly points at ("the header already switches correctly... reuse whatever it's doing").

## Item 2 — footer background: confirmed already correct, no change needed

Designer's own note: "Looks like this one is already right." Confirmed: `HubFooter.tsx:145` uses the `bg-surface` Tailwind class, which `tailwind.config.js` maps directly to `var(--rc-surface)` (no `hsl()` wrap, already theme-aware — same fact this session has confirmed multiple times for this exact class). Nothing to do here.

---

## "Also" — Tournaments → Events: the label fix is cheap, making it a real (functional) link is a separate, bigger piece of work

Confirmed: `HubFooter.tsx:73` has `{ label: 'Tournaments' }` with no `real` marker (inert, matches every other placeholder link in this file). Designer's own citation (`goCat4`, opening the Events category) is a specific, technical reference to an actual working destination in the prototype — not just a copy note. **Splitting this into two pieces, since they're very different sizes of work:**
- **Cheap, ships in the same PR as the 6 items above:** rename the label from "Tournaments" to "Events," keeping it inert (matching every other non-`real` link's current treatment) — a pure content correction against the prototype's own copy.
- **Bigger, needs its own scoping, not silently bundled in:** making this an ACTUAL functional link (matching `goCat4`'s real behavior) requires new plumbing `HubFooter`'s two current `real` links (`games`/`rewards`) don't need, because those two already have a matching callback (`onGames`/`onRewards`) passed at every call site. An "Events category" destination has no equivalent callback threaded anywhere today — `HubFooter` is rendered from **6 different call sites** (`HomeHub`, `ProfileHub`, `RewardsHub`, `AffiliateHub`, `GameHub`, and `MenuOverlay`'s own footer instance), none of which currently pass anything category-aware. `MenuOverlay.tsx` already solved this exact problem for its own EARN-section rows via an `onOpenGamesCategory` prop — the same shape could extend to `HubFooter`, but that's a real, multi-call-site plumbing change, not a one-line addition. **Recommend:** ship the label fix now, scope "make Events real" as its own follow-up ticket.

---

## The closing ask — grep the whole tree for hardcoded hex — is real, and genuinely bigger than "the Footer": 15 files, not 1

Ran Designer's own suggested grep (`#FFFFFF|#0B0B0B|#1A1A2E|#E9E9F0`) across every screen/component file, excluding the obvious SVG-icon-fill false positives (path/circle/rect fills, which legitimately stay fixed colors in both themes — e.g. the social icons' white glyphs on a fixed-purple background, which Designer's own ticket confirms should stay unchanged). **Even after excluding those, 41 real hits remain across 15 files:** `RpsHub.tsx`, `DiceHub.tsx`, `RewardsHub.tsx`, `ProfileHub.tsx`, `HubToolbar.tsx`, `GameHub.tsx`, `AffiliateHub.tsx`, `MenuOverlay.tsx`, `AuthModal.tsx` (now dead code, retired by the bottom-sheet rebuild — worth deleting rather than fixing), `vipTier.tsx`, `ChatSheet.tsx`, `CurrencyPicker.tsx`, `BringARival.tsx`, `GamesCarousel.tsx`, `HomeHub.tsx`.

**Important caveat before anyone runs a mechanical find-replace across this list:** not every hit is a bug. Some of these are genuinely, deliberately theme-invariant — e.g. `DiceHub.tsx`'s own die-cube face colors, documented in that file's own comments as "a fixed light isometric gradient in EITHER theme (a physical die stays white)," a real, already-reasoned decision from earlier this migration, not an oversight. **This needs the same file-by-file human triage this ticket just did for the Footer, not a sweep-and-replace** — recommend scoping it as its own dedicated pass (one ticket, 15 files, each needs its own quick "is this a bug or a deliberate invariant?" read), separate from today's Footer fix, given the size.

---

**Ask:** items 1-6 (minus the "make Events real" half) are a clean, small, single PR — no corrections to Designer's own diagnosis needed anywhere in the numbered list. "Make Events real" and "the repo-wide hex sweep" both need their own follow-up tickets, sized very differently from the rest of this one.

---
From: Advisor   Re: Designer's spec for 3 Rewards fixes (screenshot in `design-ref/D10/`), verified against `RewardsHub.tsx`/`App.tsx` (`origin/main`@`02af50a`)

All three of Designer's items are confirmed real, and two of them are direct reuse of patterns already built this week. But investigating item 1 (the stale avatar) surfaced something outside the scope of anything Designer asked about, more important than the ticket itself: **the Rewards VIP card's avatar isn't reading a stale copy of anything — it's a hardcoded, permanent image of Pepe the Frog**, live in production right now, on a page every registered user sees. Flagging this first and separately, since it's a real compliance/brand-risk question this codebase has explicitly reasoned about before (and excluded Pepe from, on purpose) — not a routine bug fix.

---

## 0 — HIGH PRIORITY, not part of Designer's ticket: the Rewards VIP card avatar is a hardcoded Pepe the Frog image, already live

Designer's own diagnosis for item 1 was "it looks like Rewards is reading a stale copy or its own cached value" — reasonable from the outside, but the actual code (`RewardsHub.tsx:227`) shows something more specific: `backgroundImage: `url(${avatarPlaceholder})`` — a **static import** (`avatar-placeholder.jpg`), rendered **unconditionally**, with no `avatarId` or per-user logic anywhere near it. Opened the actual file: **it's a Pepe the Frog image**, byte-identical to what's visible in Designer's own screenshot (`design-ref/D10/IMG_0806.PNG`, circled). Confirmed via `grep` this is the ONLY consumer of this asset anywhere in `apps/web` — the exposure is scoped to this one card, not spread elsewhere.

**Why this specific detail matters, beyond it just being the "wrong" picture:** this app's own `apps/web/src/assets/avatars/CREDITS.md` (from the earlier avatar-picker work, `2026-09-13#7`) documents that Pepe was **deliberately excluded** from the platform's real avatar-preset set, in the Owner's own words as already recorded: *"Pepe is an actively-enforced copyrighted character (creator Matt Furie has a documented history of action against unauthorized commercial/crypto use, and this is a wagering platform)... Neither exclusion should be revisited without new Owner direction."* This specific image never went through that review — it was bulk-imported months ago (`#308`, 2026-08-13) as part of an unrelated design-tool asset dump for a completely different screen (the "games-and-rewards" export), landed as a literal placeholder/mock-persona image in that source file, and got wired in here as if it were a generic silhouette rather than recognized as the exact character the platform already has a standing, reasoned decision to exclude.

**The good news: fixing item 1 properly (below) retires this entirely, as a side effect, not a separate remediation.** Once the VIP card reads the real shared `Avatar`/`avatarId` state instead of this hardcoded import, the Pepe image is never rendered again, by anyone, in any state. No extra work needed beyond doing item 1 correctly — but this is squarely the kind of thing Owner should know is happening RIGHT NOW in production, not something to fix quietly as a side effect of an unrelated ticket without flagging it. Recommend this gets surfaced to Owner directly, today, independent of when the routine fix ships.

---

## 1 — Avatar not propagating: confirmed, and the real cause is simpler than "stale state" — Rewards was never wired to the shared avatar state at all

`App.tsx`'s render call for the `'rewards'` screen (`:1180-1189`) passes `token`/`loggedIn`/`username`/`balance`/nav callbacks — **no `avatarId` prop, at all**, unlike the `'profile'` screen's own render call a few lines earlier, which does pass it (confirmed: `avatarId={avatarId}`). `RewardsHub.tsx`'s own `Props` interface (`:72-88`) has no `avatarId` field to receive it even if it were passed. This isn't "reading a stale copy" — there's no copy being read at all, stale or otherwise; the VIP card was built with a hardcoded placeholder from day one and never connected to the real avatar system that `ProfileHub.tsx`/`GameHub.tsx` already use correctly.

**Fix:** add `avatarId: AvatarId` to `RewardsHubScreen`'s `Props`, pass `avatarId={avatarId}` at the App.tsx call site (the state already exists at that level, this is a one-line addition), and replace the hardcoded `avatarPlaceholder` `<div>` (`:220-228`) with the shared `<Avatar avatarId={avatarId} username={username} size={44} />` component — the exact same call shape `ProfileHub.tsx` already uses for its own 44px header avatar. Since `avatarId` is already a single piece of App-level React state (not per-screen local state, confirmed via `App.tsx:377`), this correctly satisfies Designer's own check ("go to Rewards without reloading: new avatar in the VIP card") automatically — no new subscription/sync mechanism needed, just wiring the existing one through.

---

## 2 — Rakeback amount: RC coin → currency icon + `$`, confirmed real, direct reuse of an already-built pattern (third time this week)

`RewardsHub.tsx:369`: `<RcIcon size={15} />` followed by a bare `{claimableBalance.toLocaleString('en-US')}` — the exact same "green RC coin, no `$`" pattern already fixed twice this week on other screens (Open Games' stake display, `#572`; Account's Recent Games amounts, `#576`). **This is the third screen needing the identical fix**, and the reusable pieces are already built: `CurrencyIcon` (`hub-chrome/CurrencyPicker.tsx`) + `useCurSel()` (`lib/currency.ts`, the app-wide selected-currency singleton `2026-09-13#6` built specifically so every consumer stays in sync). **Fix:** swap `<RcIcon size={15} />` for `<CurrencyIcon sym={curSel} size={15} />` (via `useCurSel()`), and prefix the amount with `$` — `RewardsHubScreen` is already auth-only (guarded by `loggedIn`/`token`, same as Account's Recent Games), so there's no guest branch to handle, same simpler shape as that fix. **Worth flagging to whoever picks this up, given it's now the third occurrence:** if a fourth screen needs this same swap later, it's probably worth extracting a tiny shared `<CurrencyAmount value size />` helper rather than inlining the same 3-line pattern a fourth time — not blocking this fix on that, just naming it since "three strikes" is usually the point to consider it.

---

## 3 — Claim button shift: confirmed real, and Designer's own diagnosed mechanism is exactly right this time — the fix is precisely scoped

Confirmed via direct read: `CardStatusRow` (`RewardsHub.tsx:437-443`) — the shared, already-correctly-fixed-height (`height:'24px'`, `marginTop:'7px'`) wrapper this file's own comment describes as "the design's fixed 24px height" — is used for the **locked** state ("Wager to unlock") on both cards, but the Rakeback card's **unlocked** (logged-in) state (`:368-373`) renders its icon+amount content in a **separate, different** `<div>` with `marginTop:'7px'` but **no explicit height at all** — its height is whatever the icon+text content naturally produces, which isn't guaranteed to be exactly 24px. That's the entire mechanism: two different pieces of markup meant to represent "the same fixed-size slot," only one of which actually enforces the fixed size. Matches Designer's own diagnosis precisely — no correction needed to the mechanism this time.

**Fix, matching Designer's own instruction not to min-height the card or absolutely-position the button:** make `CardStatusRow` accept children instead of only a plain text string, and route the unlocked state's icon+amount content through the SAME component (`<CardStatusRow testid="..."><CurrencyIcon .../><span>...</span></CardStatusRow>`) instead of duplicating the `height`/`marginTop` values in a second div. This is the same "one shared implementation, not a near-duplicate that can drift" principle this file's own comment already states for the locked-state pieces (`:431-433`) — it just didn't get extended to cover this card's OWN two states when the unlocked branch was added.

---

**Ask:** items 1-3 are all small and independent, safe as one PR. Item 0 (the Pepe image) isn't something for me to resolve unilaterally — recommend flagging it to Owner directly today, separate from the routine ticket flow, given the standing exclusion decision already on record; the fix for item 1 happens to retire it automatically once shipped, but Owner should know it's live right now regardless of ticket timing.

**Also carrying forward from `2026-09-14#1`:** item 4's "above" spacing question (how the Games-page title row should reach 35px of gap above it) is still open — PM independently re-verified the same citations and reached the same conclusion (the prototype's own source genuinely produces 26px, not 35, with no combination of nearby values summing to 35) — this needs an actual Designer confirm, not a code guess, whenever Owner has a channel back to Designer.

---
From: Advisor   Re: Designer's spec for the Games-page section title row (screenshots in `design-ref/D09/`), verified against `HomeHub.tsx` **and the live deployed page directly** (`https://rapidclash-65hoiaulbq-uc.a.run.app`, `origin/main`@`3833699`)

This ticket needed a different verification method than usual: Designer's four claims are stated as measurements taken *from screenshots* (e.g. "font size is ~24px... cap height is about 17px"), which is an inference, not a direct read of the CSS. Since the source-level code already looked numerically correct for two of the four items, I didn't trust a screenshot-based estimate over the actual rendered page — I loaded the live production URL in a real headless browser and read `getComputedStyle()`/`getBoundingClientRect()` directly off the actual DOM, the same page Designer tested. Two of Designer's four items turn out to already be correct; the other two are real, but one has a different actual cause than diagnosed, and one has a citation I can't verify against the prototype's own source, worth asking about before touching anything.

---

## 1 — Font size: NOT a bug. Confirmed 21px exactly via live computed style, not just source.

Designer: "Font size is ~24px, should be 21px." `HomeHub.tsx:228` already sets `fontSize: 21` explicitly, inline (from `#566`, `2026-09-13#1`). Loaded the live page and read `getComputedStyle(title).fontSize` directly: **`"21px"`, exact match to spec, no discrepancy.** No code change needed here — the screenshot-based estimate (reverse-engineering font-size from an assumed cap-height ratio) doesn't match what's actually rendering.

## 2 — Gap between icon and text: NOT a bug. Confirmed 12px exactly via live computed style.

Designer: "Gap is ~15px, should be 12px." The row is `flex items-center gap-3` (Tailwind `gap-3` = 12px) — confirmed live: `getComputedStyle(row).gap === "12px"`, exact match. No change needed.

---

## 3 — Vertical misalignment: REAL, confirmed by direct measurement (~4px), but the cause isn't what Designer diagnosed — the icon is already correctly `display:block`

Designer's diagnosis: "The icon isn't a block-level flex item... `display:block` on the SVG plus `flex:0 0 26px` fixes it." Checked directly: the icon (`TitleIcon`, `HomeHub.tsx:223`) **is already `display: block`, confirmed via live computed style** (`iconStyle.display === "block"`) — this specific fix is already in place from `#566`, and applying it again would be a no-op.

**The actual measured offset is real, though:** icon's vertical box-center sits **4.0px below** the text's own box-center (icon center at viewport y=429.06, text center at y=425.06 — measured directly via `getBoundingClientRect()` on the live page, not estimated). **Root cause, confirmed by inspecting every contributing computed value:** the `<h2>` (`HomeHub.tsx:224-231`) has an **unreset `margin-bottom: 8px`** — confirmed via `getComputedStyle(title).margin === "0px 0px 8px"` — that nobody set explicitly in this component's own inline style (`style={{fontFamily, fontSize, fontWeight, letterSpacing}}`, no `margin` key at all). Per flex layout rules, `align-items: center` centers a flex item's full **margin box**, not just its content — so the h2's own extra 8px of bottom-only margin makes its effective box asymmetric (0 top / 8 bottom), and centering that asymmetric box within the row shifts the VISIBLE text glyphs upward relative to the icon by almost exactly the observed 4px (half of the 8px asymmetry). **This matches Designer's own spec for the text exactly** ("Text: ... no margin, no padding") — the fix Designer's own spec already calls for is the right fix, just via a different mechanism than the one named in the diagnosis. One open question worth noting: Tailwind's own preflight (`@tailwind base`, confirmed present in `index.css:1`) normally zeroes heading margins by default, so this 8px is coming from somewhere more specific than "Tailwind just didn't reset it" — didn't chase the exact source further since the fix is a one-line, unconditional override regardless of where the stray margin originates. **Fix:** add `margin: 0` to the `<h2>`'s existing inline `style` object.

---

## 4 — Spacing above/below: real gaps exist, but the actual measured numbers differ from Designer's screenshot estimate, and the "above" fix has a genuine citation mismatch worth confirming before touching anything

**Measured live (not estimated), both gaps:**
- **Above** (bottom of the SEARCH/SORT/RANDOM row → top of the title row): **26px**, confirmed via direct `getBoundingClientRect()` math on the live page — not Designer's estimated "~29px." Target per Designer's spec: 35px. Real, confirmed shortfall of **9px** either way, even though the starting number differs from what was reported.
- **Below** (bottom of the title row → top of the first tile in the grid): **12px**, confirmed live — not Designer's estimated "~22px." Target: 16px. Real, confirmed shortfall of **4px**.

**The "below" side has a clean, confirmable fix.** The title row currently carries `mb-3` (12px) as its OWN bottom margin (`HomeHub.tsx:218`, `className="mb-3 mt-[26px] ..."`) — but the prototype's spec puts this spacing on the **grid**, not the row (`margin:16px 16px 0` on the grid itself, confirmed at `Full Spec.html`'s own citation for the tile grid, already documented in this file's own comments from `#566`). The row's `mb-3` is extra, not-in-spec bottom margin that happens to produce a smaller (and wrong) number instead of the correct one. **Fix:** drop `mb-3` from the row (leaving only `mt-[26px]`, matching the prototype's row spec of top-margin-only exactly), add the 16px margin to the grid/empty-state elements that currently render directly below the row instead.

**The "above" side has a real gap but I can't verify Designer's own citation for where the missing 9px belongs, and don't want to guess which element to pad.** Designer's message: "35px above (the pill row's 9px bottom padding plus the title's 26px top margin)." Checked the prototype's actual source for the SEARCH/SORT/RANDOM row (the element directly above the title row in both our DOM and the prototype's own markup, confirmed at `Full Spec.html:210-220`): its own citation is `margin:14px 16px 0 16px` — a top-only margin, **zero bottom padding anywhere on it**. The only `9px`-bottom-padding value I can find anywhere near this part of the page belongs to the **category tab rail** (`padding:0 16px 9px 16px`, confirmed from `2026-09-13#1`'s own investigation) — a *different* element, one row further up, not adjacent to the title row in the actual layout. **Rather than guess whether Designer meant the category rail's own value should somehow apply here, or whether the search/sort/random row needs a NEW 9px of bottom padding that doesn't exist in the prototype's own current markup, or whether the title's own top margin should simply become 35 instead of 26 (which would contradict the literal "26px top margin" half of Designer's own arithmetic) — flagging this precisely as a question rather than picking one.** Whichever element gets the extra 9px, the target (35px total gap between the search/sort/random row and the title) is clear and can be verified the same way I verified everything else here: load the live page after the fix and confirm the two elements' bounding rects are exactly 35px apart.

---

**Ask:** items 1+2 need zero code changes — recommend explicitly telling Designer these are already correct in production, since screenshot-based measurement across a phone camera/compression pipeline is inherently approximate and shouldn't be trusted over a direct computed-style read when the two disagree. Item 3 is a one-line fix (`margin: 0` on the h2), safe to ship immediately alongside item 4's "below" fix. Item 4's "above" fix needs a quick confirm from Designer/PM on which specific element should carry the extra 9px before writing any code — the target number is solid, the implementation location isn't yet.

---
From: Advisor   Re: Designer's live-testing report ("menu navigation bar demands double-clicks") — verified against `HubToolbar.tsx`/`HubToolbar.test.tsx` (`origin/main`@`88f0ee6`)

Confirmed real, root-caused precisely, not guessed. This is a regression from #569 (2026-09-13#3, the bottom-nav press-feel ticket) — the fix for that ticket's own retrigger requirement introduced a real click-swallowing bug as a side effect, and the test suite added alongside it demonstrably cannot catch the failure mode it actually causes (confirmed by reading the test's own comments, not inferred).

---

## Root cause: the bar-pop retrigger remounts the same DOM nodes that receive the tap, between pointerdown and click

`HubToolbar.tsx:71-74`: `firePulse()` bumps a `pulseKey` counter on every `onPointerDown` (`:194`). `:134-135`: the bar's own container div — **which wraps all 5 interactive buttons, not just a decorative pulse element** — is `key={pulseKey}`. Every tap's `pointerdown` therefore triggers a React key change that **unmounts and remounts the entire bar, including the exact button the user's finger/pointer is on**, before the browser has finished dispatching that same gesture's `click` event.

This is a well-known, real class of browser bug: when the DOM node a `pointerdown`/`mousedown` landed on is removed from the document before the corresponding `click` fires, browsers vary in how they handle it (drop the click, or retarget to whatever's now at that screen position) — but the practical, observed result here is exactly Designer's report: the first tap doesn't register as a click, requiring a second tap to actually activate the nav item.

**Confirmed this was a known trade-off at the time, not an unforeseen accident — the ticket that shipped it explicitly named the two safe alternatives, and the wrong one was picked for this specific spot.** 2026-09-13#3's own ticket text (still in `HubToolbar.tsx`'s comments, `:66-70`) named both a counter-in-`key` approach AND a toggle-class-force-reflow-toggle-back approach as "either is fine" — but that framing was written for the general retrigger problem, without flagging that the counter-in-`key` variant is only safe when the keyed element does NOT also contain the interactive target of the very gesture that triggers the key bump. The bar container is exactly that unsafe case: it's simultaneously the thing being re-keyed for animation AND the direct parent of the buttons receiving the triggering `pointerdown`.

---

## The test suite's own comment proves this was seen and worked around, not caught

`HubToolbar.test.tsx:441-445`, a test literally named **"a press does not interfere with the item's own click handler firing (remount-safe)"**:
```js
fireEvent.pointerDown(screen.getByTestId('hub-nav-games'));
fireEvent.click(screen.getByTestId('hub-nav-games')); // re-queried after the pointerDown-driven remount
```
The test's own comment admits the remount happens. But `screen.getByTestId(...)` on the second line performs a **fresh DOM query**, fetching whatever button now exists at that testid *after* the remount, and fires a synthetic `click` directly at that fresh reference via React Testing Library's `fireEvent` — which dispatches a JS `Event` object straight at a specific element reference, bypassing the browser's actual physical hit-testing/retargeting pipeline entirely. **This test cannot fail even if the real-browser bug is 100% present**, because it never simulates a single continuous physical gesture the way a real tap is — it simulates "press somewhere, then separately, look up whatever's there now and click it," which is not what happens on a real device. The test's own name ("remount-safe") is the opposite of what it actually demonstrates.

---

## Fix: don't remount the buttons at all — drive the retrigger with a ref + imperative reflow, no `key`, no React state

The safer alternative 2026-09-13#3's own ticket named — toggle the animation off, force a synchronous reflow, toggle it back on — needs no `key` and no state re-render at all when done via a ref:

```js
const barRef = useRef<HTMLDivElement>(null);
function firePulse() {
  const el = barRef.current;
  if (!el) return;
  el.style.animation = 'none';
  void el.offsetHeight; // force a synchronous reflow so the next line is a genuine restart, not a no-op
  el.style.animation = 'rcNavBarPop 420ms cubic-bezier(0.22,0.61,0.36,1)';
}
```
This is strictly simpler than the current `pulseKey`/`useState` machinery (no state, no re-render, no `data-pulse-key` test hook needed) and it structurally cannot swallow a click — the bar div and every button inside it keep the exact same DOM identity across every press, so nothing about the animation retrigger can interfere with the browser's own click delivery for that same gesture. **Fix:** replace `pulseKey`/`setPulseKey`/the `key={pulseKey}` on the bar div with this ref-based approach; update `HubToolbar.test.tsx`'s existing assertions to check `barRef`'s live `style.animation` value directly (no re-query needed, since the element persists) rather than the `data-pulse-key` attribute, and rewrite the "remount-safe" test to something that actually proves it — e.g. capturing the bar/button DOM node references BEFORE the press and asserting they're `===` the same references after, which the current implementation would fail and the fix would pass.

---

**Ask:** small, single-file fix (`HubToolbar.tsx` + its own test file), well-understood, no design/UX change (the pop animation itself is unaffected — only the retrigger mechanism changes) — this is purely a correctness fix for a real regression, doesn't touch anything Designer-facing. Flagging as HIGH PRIORITY since it's a live, reported, user-facing interaction bug affecting the primary nav on every screen, not a cosmetic gap — recommend this jumps the queue ahead of any pending Designer-package work.

---

### 2026-09-13#8 — Designer handoff on Account's Recent Games list: 5 real gaps confirmed, all cheap, plus one reported bug that's already fixed in current code — flagging rather than re-shipping a no-op            [READY TO TICKET — all 5 real items are small; item 2's color complaint needs a live-page check before assuming a fix is needed]
From: Advisor   Re: Designer's spec for Account's Recent Games list (screenshots in `design-ref/D08/`), verified against `ProfileHub.tsx`/`format.ts`/`RcIcon.tsx`/`lib/currency.ts` (`origin/main`@`c9cd911`)

Five real, cheap, well-scoped gaps confirmed — plus one genuine surprise: the win/loss color logic Designer's message describes as currently broken **already matches the prototype exactly in current `main`**, confirmed by direct read, not assumed. Flagging that precisely rather than silently "fixing" code that's already correct, in case it points at a live/deployed-vs-source mismatch worth PM's attention.

---

## 1 — Empty state: confirmed wrong on every axis, easy copy-paste fix

Current (`ProfileHub.tsx:395-398`): `padding: '16px 0'`, `fontSize: 12`, `color: RC.muted`, no horizontal margin, no letter-spacing, regular weight. Prototype's own Events-empty-state (`Full Spec.html:244-246`, confirmed exact): `margin:0 16px; padding:54px 0 10px 0`, `font-size:14px; font-weight:600; letter-spacing:0.3px; color:var(--rc-text)`. Every single value differs. **Fix:** copy `HomeHub.tsx`'s own `home-events-empty` treatment verbatim (same citation, already correctly implemented there — this screen just never got the same pass), swap the copy to "No recent games yet."

---

## 2 — Amount: real fix needed (RC coin → currency icon + $), but the color-by-outcome logic Designer flagged as broken is ALREADY correct — confirmed, not assumed

**Confirmed real:** `MatchRow` (`ProfileHub.tsx:598-600`) renders `<Credits amount={m.delta} showSign />`, which draws `RcIcon.tsx`'s green "RC" coin — the exact glyph Designer's spec says must go. Prototype (`:1439-1445`, confirmed): a 15×15 `<use href="#cur-{{ curSym }}">` (the wallet's own selected currency, same sprite already wired for Open Games) + `'+$'`/`'-$'` prefix, Space Grotesk 700 **17px** (already matches — the current code's font-size is already 17, that part's fine). **Fix:** replace `<Credits>` with `CurrencyIcon` (`hub-chrome/CurrencyPicker.tsx`, already exported) + a plain `+$`/`-$`-prefixed numeral, reading the currency symbol from `useCurSel()` (`lib/currency.ts` — the exact global singleton 2026-09-13#6 asked for and #572 already built; this is direct reuse, not new plumbing). Since `ProfileHubScreen` requires a real `token` (auth-only screen, no guest path), there's no guest/logged-out branch to handle here — always `$` + the wallet's icon, unlike `GamesCarousel`'s own `AmountFigure` which has to cover both.

**NOT confirmed as a bug, despite Designer's report — checked the actual current code directly:** Designer's message says "Right now lost amounts are showing near-white. They should be muted." Read `MatchRow` line-by-line: `vsColor = m.outcome === 'win' ? RC.green : m.outcome === 'loss' ? RC.text : RC.muted` and the amount's own `color: win ? RC.green : RC.muted` (`:569`, `:598`) — this is **already byte-identical to the prototype's own formula** (`Full Spec.html:4391-4392`: `amountColor: g[5]==='WON' ? green : muted`, `vsColor: g[5]==='WON' ? green : text`), confirmed via direct grep of both. `--rc-muted` resolves to `#83838f` (confirmed in `index.css`) — a real muted gray, not white. This logic shipped back on 2026-09-07 (#441/#444), well before today. **Possible explanations, not confirmed which:** the screenshot may be from a build that predates that fix, or `#83838f` simply reads closer to white than expected in a compressed/small screenshot next to genuinely-white text in the same row. Recommend PM (or whoever picks this up) load the actual live Account page and eyeball a real loss row before writing any code for this specific point — the amount/RC-coin swap above is real and needed either way, but the color logic itself may need zero changes.

---

## 3 — Opponent row: confirmed real, simple one-line removal

Current row order: `VS → <Avatar> circle → tier icon → @username`. Prototype (`:1436`, confirmed): `VS → tier icon → @username`, no avatar element at all. **Fix:** delete `ProfileHub.tsx:590`'s `<Avatar avatarId={m.opponentAvatarId} username={m.opponentDisplayName} size={16} />` line entirely — everything else in this row (gap, margin-top, tier-icon conditional on `!== 'Unranked'`, ellipsis) already matches exactly, confirmed, no other changes needed here.

---

## 4 — VIEW MORE: two confirmed gaps, one confirmed extra beyond what Designer flagged

**Ledge, confirmed missing:** current button (`:418-425`) has no `boxShadow`, no press state at all. Prototype (`:4539`, confirmed): `moreShadow: light ? '0 4px 0 #C9C9D6' : '0 4px 0 #1E1E33'` — the smaller 4px variant Designer specifically called out (vs. the 5px used on bigger buttons elsewhere this week). **Fix:** add the ledge + `translateY(3px)` press-sink, same family as every other small ledge-button shipped this week, just the 4px variant.

**A real gap beyond Designer's own ask, caught by reading the actual transition values:** the collapsed-list wrapper (`:401`) animates `max-height` over **320ms**, but the prototype's own citation (Designer's message, and confirmed directly at `:1459`-adjacent JS) is **520ms**. Also: the bottom fade-gradient div (`:405-417`) is currently conditionally mounted/unmounted (`{!matchesExpanded && hasMorePages && (...)}`), not opacity-transitioned — so it pops in/out abruptly rather than the prototype's own `opacity 380ms ease` fade (`gamesFadeOpacity`, confirmed). **This is the third time this exact "conditionally-mounted, no transition-from-nothing" architecture gap has shown up this week** (the Menu overlay, the Auth sheet, now this) — worth naming as a real, recurring pattern in this codebase's own conventions rather than a one-off, if PM agrees. **Fix:** bump the transition to 520ms; keep the fade div always mounted, drive it with `opacity` (0/1) + `transition: opacity 380ms ease` instead of a conditional unmount.

**Already correct, no change needed:** VIEW LESS (`:446-453`) is already flat with no `boxShadow` — matches the prototype's own flat treatment (`:1465`, confirmed no shadow property in that button's style) exactly.

---

## 5 — Date format: confirmed real, locale-dependent bug — root cause identified precisely

`formatMatchTime` (`ProfileHub.tsx:184-190`) calls `toLocaleDateString(undefined, ...)`/`toLocaleTimeString(undefined, ...)` — **`undefined` locale**, meaning the output format depends on the browser/OS locale, not a fixed one. That's the exact mechanism behind Designer's screenshot showing `13 Sep, 1:02` (a day-first, no-AM/PM locale) instead of the prototype's `Aug 15, 9:42 PM` (month-first, 12-hour with AM/PM). This is a real inconsistency with the rest of the codebase's own convention — every other deterministic display in this app (`formatCredits`, `Credits`, the currency amounts) explicitly passes `'en-US'` for exactly this reason (this file's own header comment on `format.ts` says so). **Fix:** `d.toLocaleDateString('en-US', {month:'short', day:'numeric'})` + `d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', hour12: true})` — explicit locale and explicit `hour12`, not relying on either defaulting the way Designer's own screenshot happens to want.

---

## 6 — Game name: confirmed real, and the fix has an established precedent to follow, not invent

`MatchRow` (`:586`) calls `titleCase(m.gameId)` — a bare capitalize-first-letter (`ProfileHub.tsx`'s own `titleCase` import, confirmed: `'rps'` → `'Rps'`). The real display name (`'Rock Paper Scissors'`) lives in each game's own `GameMeta.displayName`, fetched from `/games` — confirmed `HomeHub.tsx`/`GameHub.tsx` both already independently call `api.games(token)` and build a `nameByGame` map (`new Map(games.map(g => [g.id, g.displayName]))`) for exactly this purpose. **`ProfileHubScreen` currently never fetches `/games` at all** — `api` is imported for other calls but this one's missing. **Fix:** add the same `api.games(token)` fetch + `nameByGame` map to `ProfileHubScreen` (matching the existing per-screen-fetch pattern already established in two other hubs, not a new architecture), fall back to `titleCase(m.gameId)` only if the map lookup misses (keeps today's behavior as a safety net, doesn't regress if `/games` is slow/fails).

---

**Ask:** all six items are small, independent, and safe to ship in one PR — none touch shared components in a way that risks the other five Designer packages already in flight this week. Recommend explicitly checking the live Account page for a real loss-row's color (item 2's color question) before writing any color-logic code, since the current source already looks correct and a "fix" against already-correct code risks masking a real live/deploy discrepancy if one actually exists.

---
From: Advisor   Re: Designer's spec for the avatar picker on Account (screenshots in `design-ref/D07/` — the current floating popup, and the target inline-strip account card), verified against `ProfileHub.tsx`/`Avatar.tsx`/`packages/shared/src/protocol.ts` (`origin/main`@`2ae24cc`)

Confirmed: this is a real UI rebuild (floating modal → inline expanding strip), not a restyle — matches the screenshots exactly. Good news on assets: the ten `rc-01`–`rc-10` PNGs Designer says to source from a zip are **already sitting in this repo**, committed as part of the prototype's own asset export. The one thing that needs an explicit call before any code: the prototype's "default" avatar and this app's current "default" avatar are two different, both-deliberate things, and only one can win.

---

## 1 — Assets: already in the repo, no sourcing needed, dimensions/format confirmed

`design/prototype/assets/avatars/rc-01.png` through `rc-10.png` already exist, committed with the rest of `design/prototype/assets/` (PR #458, back at the start of this migration) — confirmed via direct `file` check: 480×480 PNG, 8-bit RGBA, exactly matching Designer's spec. `rc-11.png` onward also exist in the same directory (confirmed present) but are excluded per Designer's own instruction — worth a code comment at the picker's asset list citing this exact boundary so a future contributor doesn't "helpfully" add the extra 14. **Fix:** copy (or symlink/reference, whichever this app's existing asset-import convention prefers — check how `design/prototype/assets/` other files get pulled into `apps/web/src/assets/` today) rc-01 through rc-10 into `apps/web/src/assets/avatars/`, alongside the existing preset files.

---

## 2 — The picker rebuild: floating popup → inline strip, confirmed exactly as described, well-scoped

Current `AvatarPicker` (`ProfileHub.tsx:639-737`) is a `fixed inset-0` centered modal with a backdrop, a 3-column static grid, and a Save button — architecturally the same shape as the old `AuthModal`/pre-rebuild campaign sheet this session already replaced twice this week. Every structural/behavioral point in Designer's spec checked out against the prototype directly:
- Trigger: the 44px avatar circle itself toggles the strip (`toggleAvatarPick`, confirmed) — not a separate button.
- SELECT button replacing the XP readout in the header row when open (confirmed exact styling/press values), tap-to-close-and-confirm (no separate commit step — selection already applied on tap, matching the strip's own `pick` handler setting `avatarId` immediately, not on a deferred Save).
- The strip's expand/collapse is a CSS grid-row `0fr↔1fr` transition (340ms) + independent opacity fade (240ms) — confirmed exact values, no popup/overlay/scrim anywhere.
- Rail styling identical to Open Games' tab rail (`#12121A`/`#DEDEE8` track, `0 5px 0 #1E1E33`/`#C9C9D6` ledge) — same tokens as 2026-09-13#6's own tab-rail ticket, no new colors needed here.
- Selected-ring (`0 0 0 3px var(--rc-green)`), press-shrink (`scale(0.92)`, not the sink-and-pop family used elsewhere — confirmed distinct, these items shrink, they don't sink), and tap-to-select-and-center (`centerPill`, same mechanism as the tabs/categories) all confirmed exact.
- **Ten items, not seven:** current `PICKER_AVATARS` (`ProfileHub.tsx:50`) lists 6 named presets + default = 7 total. Prototype's `avatarOptions` (confirmed via direct read) is `Array.from({length: 10}, ...)` generating `rc-01`...`rc-10` + default = 11 total — a real count mismatch, not just new art replacing old art.

**Fix:** rebuild `AvatarPicker` as an inline-expanding section inside the profile card (reusing the shared rail/mask/center-scroll mechanics already built for Open Games' tab rail and the category rail, rather than a fourth bespoke implementation of the same pattern), replace `PICKER_AVATARS`'s 6 named IDs with the 10 `rc-01`–`rc-10` IDs, remove the Save-as-separate-step flow (selection applies immediately, SELECT only closes).

---

## 3 — STOP: the prototype's "default avatar" and this app's current "default avatar" are two different things, and Designer's spec would silently replace a real, already-shipped feature

**What Designer's spec says, confirmed accurate:** the prototype's default avatar is a **fixed** purple circle (`#8B45F0`) with a **fixed white** person-glyph — confirmed at all three consumer sites (account header `:1341`, Rewards VIP card `:961`, game user box `:667`) and the picker's own default tile (`:1370`), all identical, no per-user variation anywhere in the prototype's source.

**What this app's current "default" actually does, confirmed by reading `Avatar.tsx` directly — a genuinely different, already-shipped feature:** `discColor(username)`/`glyphColor(username)` (`Avatar.tsx:41-49`) derive a **per-user, deterministically-hashed LIGHT disc color with a same-hue DARKENED glyph** — every user with no avatarId gets a *different*, stable color based on their username, not one fixed purple circle. This isn't a bug or an oversight — it's a real, documented feature with its own reasoning (a distinct NEUTRAL/redacted treatment for anonymous opponents vs. a colorful per-user disc for real accounts, confirmed via the component's own doc comments), and it currently applies to every account that hasn't picked a preset — which, per this file's own comment ("everyone is `'default'`" — the six named presets were "inert" pre-this-ticket), is likely **most or all real users today**.

**Implementing Designer's spec literally means removing this per-user disc-color feature entirely for the default state** — every player who hasn't picked an avatar would go from a distinct, recognizable colored disc to the same identical purple circle as everyone else. That's a real loss of a shipped visual-identity feature, not a cosmetic downgrade Owner would obviously want — and it's also not obviously wrong to prefer prototype-fidelity here either, per this week's own standing "fidelity outweighs correctness" stance. **Genuinely a coin flip that needs an explicit call, not one I should make silently either direction:**
- (a) Follow Designer exactly: fixed purple+white for every default-state account. Simple, matches the prototype byte-for-byte, but a real, visible regression for any current user relying on their disc's color as their de facto identity (e.g., in the Rewards VIP card, the game user box, anywhere they show up unlabeled amid other players).
- (b) Keep the per-user disc as this app's own default-state treatment (already correct, already shipped, arguably a genuine improvement over the prototype's own more limited single-persona mock), and treat the ten new `rc-01`-`rc-10` presets as the only thing that's actually new here — Designer's fixed-purple description would then describe the picker's own "reset to default" TILE specifically (which could stay purple, matching what a user taps to reset), without extending that same treatment to the ACTUAL rendered default state everywhere it's already shown per-user colored today.
- (c) Flag back to Designer: was the per-user disc feature known when this spec was written, or is fixed-purple simply what the mock always showed because a static demo has no concept of "many different real users" to color differently?

**Separate, smaller fact worth noting regardless of which option wins:** the six currently-named presets (`boy-light`/`girl-light`/`boy-brown`/`boy-dark`/`hooded-mono`/`hooded-degen`) have real, previously-flagged licensing provenance concerns for at least 2 of them (`CREDITS.md`: "Provenance/licence not independently verified — Owner-accepted risk," re: the two meme-style hooded figures). **Switching to Designer's official `rc-01`–`rc-10` set retires that risk entirely** — those are the design tool's own exported assets, same category as every other UI icon already in use, no separate licensing question. Worth stating explicitly as a genuine, unambiguous upside of this rebuild, regardless of how the default-avatar question above resolves.

**One more fact, not a decision point — server-side is already safe either way:** `packages/core/src/identity.ts`'s `coerceAvatar` (confirmed via direct read) validates any stored `avatarId` against `AVATAR_IDS` and silently falls back to `'default'` for anything unrecognized. So swapping the ID set from the 6 named presets to `rc-01`-`rc-10` needs no migration script — any account that had picked one of the 6 retired presets automatically and safely resets to whichever "default" option (a) or (b) above resolves to, on their next load. Worth Owner knowing this is an automatic, graceful reset, not silent data loss or an error state, whichever direction the bigger question goes.

---

**Ask:** items 1+2 (assets + inline-strip rebuild) are ready to dispatch as one PR regardless of item 3's outcome — the rebuild mechanics don't depend on which default-avatar option wins. Item 3 needs an explicit Owner (and possibly Designer) call before the default-avatar rendering itself changes; recommend shipping 1+2 with the CURRENT per-user disc behavior preserved for the default state (option b, the lower-risk default) unless Owner says otherwise, so the ten new presets ship today without gating on a decision that's genuinely independent of them.

---
From: Advisor   Re: Designer's spec for the Open Games tab rail, stake display, and host row (screenshots in `design-ref/D06/`), verified against `GamesCarousel.tsx`/`currencyData.ts`/`CurrencyPicker.tsx` (`origin/main`@`f1253e5`)

Two of three items are real, well-scoped, and cheaper than they look — the currency-icon sprite Designer says to "copy verbatim" already exists in this codebase, built for a different screen. The third item is a genuine conflict: doing exactly what Designer describes would remove a disclosure this codebase deliberately added for a compliance reason (ADR-010), and the data to do it properly doesn't exist yet either. Flagging that one clearly rather than either silently implementing it or silently skipping it.

---

## 1 — Tab rail: confirmed exactly as described, plus one technique mismatch and one wrong label

**Free-floating pills confirmed** — `GamesCarousel.tsx:505-530` renders each tab as its own `<button>` with `background: i === tab ? '#8B45F0' : '#1A1A2E'`, no shared track, no ledge, no press state. Matches the screenshot exactly (circled). Prototype's track color (`tabRailBg: light ? '#DEDEE8' : '#12121A'`) and per-pill values (`bg`/`color`/`shadow`, all confirmed exact matches to Designer's own numbers) checked directly — nothing to correct in the color spec.

**Scroll-to-center confirmed absent** — `pickTab()` (`:451-454`) only sets state, no scroll call at all. Prototype's `centerPill()` (confirmed via direct read) walks up to the actual scrollable ancestor, computes the pill's centered target position, clamps to `[0, maxScroll]`, and smooth-scrolls — fired from each tab's own `pick` handler on the next animation frame after the state update. None of this exists today.

**One real technique mismatch, not just a missing feature:** the edge fades here are currently built as two absolutely-positioned overlay `<div>`s with gradient backgrounds (`:532-547`) — **the same technique used for the category rail** (2026-09-13#1). But Designer's own spec for THIS rail explicitly says `mask-image`, and I confirmed it precisely: the prototype's `railMask(l, r)` function returns a single `linear-gradient(...)` string used as a `mask-image` on the scroller itself, not two overlay elements — a genuinely different technique from the category rail's own overlay-div approach, confirmed by reading both mechanisms side by side in the prototype's own source. Whoever ported this rail copied the category rail's technique instead of reading this rail's own (different) one. **Fix:** replace the two overlay divs with a single `mask-image`/`-webkit-mask-image` on the scroller, computed from the same `leftFade`/`rightFade` state already being tracked.

**One small, separate, confirmed bug: wrong tab label.** `GamesCarousel.tsx:76`: `const TABS = [..., 'RANK']` — the prototype's own `TABS` array (confirmed via grep) is `['OPEN GAMES', '24H RACE', 'WEEKLY RACE', 'LEADERBOARDS']`. "RANK" doesn't appear anywhere in the prototype's tab set — matches Designer's own message, which names the fourth tab "LEADERBOARDS" throughout. **Fix:** rename the constant and its associated `tab === 3` board-kind branch to match (`buildBoardRows`'s `'rank'` internal type name can stay, it's just an internal string, not user-facing).

---

## 2 — Stake display: `$`-always confirmed, and the currency-icon work Designer asks for already exists in this codebase — reuse, don't rebuild

**Real correction to already-shipped work, not a new gap:** `AmountFigure` (`GamesCarousel.tsx:401-412`, from 2026-09-11#8 item B.2) currently shows the green "RC" coin + a bare number for logged-out viewers, and `$amount` (no icon) for logged-in viewers. Designer's spec is different from both: **every row always gets a `$` amount** (`stake: '$' + STAKES[...]`, confirmed in the prototype), and the icon next to it is a decorative currency glyph, not the RC coin, ever. This directly supersedes the "RC coin for guests" half of the earlier B.2 decision for this specific screen — same shape as the RPS `ownBarResult` correction, a genuine update from more precise information, not a mistake in the original work (B.2 didn't have this level of per-row-currency detail to work from at the time).

**Good news: the sprite Designer says to "copy verbatim" is already built and in use elsewhere.** `currencyData.ts` already exports `OPEN_CURS` (`['SOL','BTC','USDT','ETH','LTC','USDC','XRP']`, byte-identical to the prototype's own array, confirmed by grep) and `CurrencyPicker.tsx` already exports a reusable `CurrencyIcon({ sym, size })` component with one icon function per currency (`IconSOL`/`IconBTC`/etc.) — built for the wallet chip's own currency picker (`HubRibbon.tsx`/`GameHub.tsx`). **This is direct reuse, not new SVG work** — the whole "copy the sprite" ask is already done, just not imported here yet.

**The one real piece of new plumbing: `curSel` (the selected wallet currency) is local component state today, not shared.** `CurrencyPicker.tsx:42`: `const [curSel, setCurSel] = useState('USD')` — scoped to that one component instance, resets on remount, nothing else in the app can read it. Designer's spec requires it to be **global, persisted, shared state** ("change the wallet currency and every row in the list switches together") — the same shape as `theme.ts`'s module-level singleton (`getThemeChoice`/`setThemeChoice`/`subscribeTheme`), not a prop drilled from one screen. This is genuinely new work, though a small, well-precedented amount of it — `theme.ts` is a direct, already-proven template to copy the shape of.

**Per-row logic for logged-out, confirmed exact:** prototype's `cur: loggedIn ? curSel : OPEN_CURS[it.uid % OPEN_CURS.length]` (confirmed via grep) — stable per row (keyed by the row's own `uid`, not re-randomized on re-render/scroll, matching Designer's explicit "must not reshuffle" requirement) — maps directly onto this component's existing `uid` field, no new state needed for the logged-out half.

---

## 3 — STOP: host row tier icon conflicts with ADR-010's informed-consent requirement, and the data doesn't exist yet either. Needs an explicit Owner call before any code.

**What Designer's asking for, confirmed accurately described:** replace the 🤖 emoji before `@username` with the host's VIP tier icon (bronze/silver/gold/emerald/diamond — confirmed the exact same 5 SVGs already used on the Rewards VIP table, `RewardsHub.tsx`'s `TierIcon`). Straightforward as a pure design ask.

**The conflict:** `GamesCarousel.tsx`'s own `displayHostName()` (`:270-297`) exists specifically to keep the 🤖 disclosure emoji visible on bot-hosted rows — its own extensive comment cites **ADR-010's informed-consent requirement**: a real player choosing whether to JOIN a match must be able to tell they'd be facing a bot. This was a deliberate, previously-reasoned decision (distinct from `ProfileHub.tsx`'s own name-normalizing helper, which DOES strip the emoji — correctly, for its own personal-match-history context where the distinction doesn't carry the same stakes). **Replacing the emoji with a tier icon for bot-hosted rows would remove that disclosure** — a real player could no longer tell a bot-hosted row from a human one before joining.

**The data gap, independent of the conflict above:** `GamesCarousel.tsx`'s own file header (`:218-226`) already documents that `OpenChallenge`/`PublicOpenChallenge` carry **no tier field over the wire at all** — this was explicitly scoped out of an earlier ticket as a follow-up requiring a server-side protocol change (adding `ownerTier`, resolved server-side the same way `resolveTier` already works for chat). So even setting the ADR-010 question aside, implementing tier icons here is not a frontend-only change — it needs the same kind of server addition already deferred once.

**Not picking a side — three real options, need an Owner call:**
- (a) Follow Designer exactly: tier icon for every host, bots included. Requires deciding what a bot's "tier" even is (bots don't earn real XP), and means accepting the ADR-010 disclosure gap on this specific screen — same category of call as the RPS reveal info-leak Owner already accepted once this week, but worth Owner making that call explicitly for THIS gap too, not inheriting it silently from a different ticket's precedent.
- (b) Hybrid: tier icon for real human hosts, keep the 🤖 emoji for bot hosts. Preserves the disclosure, deviates from Designer's literal spec (mixed treatment across rows) — needs Designer's sign-off, not just ours.
- (c) Flag back to Designer/Owner directly: did the spec account for ADR-010 when it was written, or is this a genuine oversight worth a design update instead of a code compromise?

**Either way, (a) and (b) both need the new server-side `ownerTier` field first** — that part isn't optional regardless of which visual option is chosen.

---

**Ask:** items 1+2 are ready to dispatch as one PR — real, cheap, and item 2 gets a real assist from `currencyData.ts`/`CurrencyPicker.tsx` already existing. **Item 3 needs an Owner decision before any ticket is written for it**, let alone code — recommend surfacing the three options above rather than picking one.

---
From: Advisor   Re: Designer's spec for Rewards' logged-out state, the tier ring, and claim-button 3D (screenshots in `design-ref/D05/`), verified against `RewardsHub.tsx`/`App.tsx` (`origin/main`@`23a8256`)

Confirmed real, but with a scope correction: Designer's framing implies mostly "unblock the page and flip 4 switches." On inspection, `RewardsHubScreen` currently has **no concept of a logged-out visitor at all** — its `Props` require a `token: string`, it fetches authenticated data unconditionally on mount, and the render call passes `token!` (a type-only assertion, not a real guarantee). Removing the nav-level gate alone would send a guest into a component built assuming they have an account. Three of Designer's four "things that switch" turn out to already work correctly for a different reason (a happy accident, not by design) — worth knowing precisely which is which before scoping the fix.

---

## 1 — The gate bug: confirmed exactly as described, small fix, both entry points share one root cause

`App.tsx:1135-1138`: `onRewardsTap = () => { if (loggedIn) goToRewards(); else openAuth(null); }` — used for HomeHub's and GameHub's toolbar (`:1155`, `:1275`). Compare `onAccountTap` (`:1128-1131`), which has the identical shape — correct FOR Account, per Designer's own citation (`goAccount`, `:3944`, does check `loggedIn`), but `goRewards` (`:3908`) is plain `go('rewards')`, no check at all. **Same root cause serves both entry points Designer named**: the Menu's Rewards row (`MenuOverlay.tsx`'s `rewards-vip` row) calls `onOpenRewards()`, which every hub screen wires to this same `onRewardsTap` — so fixing the one callback fixes both the nav tap and the menu row in one place, not two separate fixes.

**Fix:** `onRewardsTap` should be `goToRewards` unconditionally (matching `ProfileHub.tsx`/`AffiliateHub.tsx`/`RewardsHub.tsx` itself, which already pass the ungated `goToRewards` directly, `App.tsx:1170/1183/1193` — HomeHub/GameHub are the only two screens with the gate). This part alone is small.

---

## 2 — The real work: `RewardsHubScreen` has zero guest-awareness, confirmed by reading the component, not assumed

`RewardsHub.tsx:64-65`: `Props` requires `token: string`. `App.tsx`'s `case 'rewards'` render call passes `token!` — a TypeScript non-null assertion, not a runtime guarantee; if a guest reaches this screen today, that assertion is simply wrong at runtime. `RewardsHub.tsx:155-160` fires `api.wallet(token)`/`api.rewards(token)` unconditionally on mount — no `loggedIn` prop exists anywhere in this file to guard them. **Just removing item 1's gate would send a guest into a component that assumes an authenticated fetch will succeed.** Needs a `loggedIn`/nullable-token prop and a guard on that effect before item 1 is safe to ship alone.

**Three of Designer's four "switches" already produce correct-looking output for a guest today — but by coincidence, not by design, worth knowing precisely why before assuming they're done:**
- **Tier ring** (item 2 in Designer's list): `VipTierTable`'s ring (`RewardsHub.tsx:429-437`) already matches the prototype's exact values (`border:3px solid #8B45F0; border-radius:38px`, the exact glow) — confirmed correct, no fix needed to the ring itself. It only renders when `tierIndex >= 0`, and `tierIndex` comes from `tier === 'Unranked' ? -1 : ...` (`:181`) — since a guest's `snapshot` would stay `null` (once the fetch above is properly guarded) and `tier` defaults to `'Unranked'` (`:177`), the ring would already resolve to hidden. **Correct outcome, coincidental cause** — it's driven by "does this account have a real tier," which happens to be false for both a genuinely low-tier logged-in player AND a logged-out guest. Fine to leave as-is once the fetch is guarded, but worth knowing it's not actually loggedIn-gated logic.
- **Rakeback card's locked treatment**: `RakebackCard`'s `locked = tier === 'Unranked'` (`:321`, an already-shipped, already-reasoned decision from issue #435 — Unranked earns 0% rakeback, so a live purple CLAIM that could never pay out would be misleading). Same coincidence as the ring: a guest defaults to `'Unranked'` too, so this already shows the locked treatment. **Recommend making this explicit** (`locked = !loggedIn || tier === 'Unranked'`) rather than relying on the default — a real Unranked-tier logged-in player and a logged-out guest are conceptually different states that happen to collapse to the same tier value today; explicit is safer than coincidental as this code evolves.
- **Volume Bonus card**: confirmed already has no `loggedIn` branch and never needs one — Designer's own note ("no `loggedIn` branch... don't add a switch that isn't there") matches the current code exactly, already correct, zero risk of a regression here.
- **What's genuinely NOT working today: the VIP card's blur.** `RewardsHub.tsx` has no blur/`filter` logic anywhere on the VIP card — it unconditionally renders whatever `snapshot` produced (real data if fetched, `'Player'`/`0`/`0%` placeholder-ish defaults if not). This is the one item that needs real new code: a wrapper div around the card's inner content with `filter: loggedIn ? 'none' : 'blur(7px)'; user-select: loggedIn ? 'auto' : 'none'; transition: filter 260ms ease` — matching `Full Spec.html:958`/`:3904-3906` exactly.

---

## 3 — A real content question the ticket doesn't address, resolved by checking the prototype's own source rather than guessing

Designer's spec says "the real content renders underneath the blur... don't swap in placeholders." For an actual logged-in user this is unambiguous (show their real fetched stats, which `RewardsHub.tsx` already does correctly). **For a genuinely logged-out visitor, there is no real content to show — no account, no snapshot, nothing to fetch.** Checked what the prototype itself does here rather than assuming: `@Bobbylee` and `17,800` (`Full Spec.html:968/971`) are **literal hardcoded strings in the markup, not template bindings** — confirmed by grep, they appear byte-identical at two separate locations in the file with no `{{ }}` wrapping. Same for the `64%` progress value and the BRONZE/SILVER labels. **The prototype's own "real content" is a fixed demo persona, unrelated to any state at all — only the blur (`vipBlur`/`vipSelect`) is actually computed.** This resolves the ambiguity: there's no live "real" data being hidden behind the mock's blur either — it's the same fixed content in both states, always. For our app, that means the honest equivalent for a logged-out visitor is showing *some* fixed, representative content (sample values, illegible behind the blur either way) rather than an empty/placeholder-string state — not literally fabricating a specific claim about a real account, since the whole point is that it's permanently unreadable until the visitor signs up. Flagging as a real design decision to confirm (what exact values render under the guest blur), not picking one silently.

---

## 4 — Claim buttons: confirmed completely missing the 3D ledge in every state, on both cards

Screenshots confirm visually (both circled) and code confirms directly: `RakebackCard`'s active button (`:343-357`) and `LockedClaimRow` (`:409-421`) both have `borderRadius`/`background`/layout but **zero `boxShadow` and zero press-state anywhere** — not logged-in, not logged-out, not on either card (Volume Bonus shares `LockedClaimRow` per the file's own comment, `:306-308`, so fixing it once fixes both cards' locked buttons).

- Active (`Full Spec.html:1043`): `box-shadow:0 5px 0 #5F27B8` — the same purple ledge already used by the Menu's Dark button and the auth sheet's mode toggle (2026-09-13#2/#4), not a new color.
- Locked (`:1047`): `box-shadow:0 5px 0 #12121F` dark / `0 5px 0 #BEBEC9` light — **confirmed genuinely new, grepped `index.css` for both hex values, zero hits.** Note `--rc-sunken` (`#0b0b0b` dark) is already correctly used for the locked button's *background* (`RewardsHub.tsx:414`) — the new colors are for the ledge specifically, a different, distinct dark value, not a duplicate of an existing token under a new name.
- Both need the `translateY(3px)` press-while-pointer-down treatment — confirmed absent on both buttons, same simple press-sink pattern as the Menu's Dark/Light buttons and the auth sheet's fields (no bounce, no pop, matches this recurring "buttons that only sink" family already seen twice this week).

**Fix:** add the ledge (as a new theme-swapped token, e.g. `--rc-claim-ledge`, following `RC`'s existing thin-wrapper pattern in this file) and the press-sink to both buttons.

---

**Ask:** item 1 (the gate) is a one-line fix but isn't safe to ship alone — needs item 2's guard on the authenticated fetch first, or a guest genuinely hits a broken page. Recommend one PR covering: (a) the gate fix, (b) `RewardsHubScreen` accepting `loggedIn`/nullable token and guarding its fetch, (c) the VIP card's blur wrapper (the one real content gap), (d) making the Rakeback lock condition explicit rather than coincidental, (e) claim-button ledges + new tokens. Item 3's content question (what renders under the guest blur) needs a decision before (c) ships, not a silent pick. Then Designer's own check list, plus the harness against screenshot 05 (logged out) and a fresh capture for logged-in.

---
From: Advisor   Re: Designer's spec for the Login/Signup sheet (screenshots in `design-ref/D04/` — current centered-modal popup, and the target bottom-sheet reference), verified against `AuthModal.tsx`/`App.tsx`/`AffiliateHub.tsx`'s existing `CreateCampaignSheet` (`origin/main`@`04325da`)

Confirmed: this is a full rebuild, not a restyle — the current `AuthModal.tsx` is architecturally a different thing (a centered card, not a bottom sheet) from what the prototype does. Every citation in Designer's spec checked out exactly against `Full Spec.html`. One correction worth flagging clearly, though: Designer's own framing assumes the affiliate `CreateCampaignSheet` is already a faithful port of "the exact same scrim, sheet geometry... drag logic" — it isn't, on inspection. Recommending "build once, use for both" still stands, but it means building the shared piece fresh to the verified spec and migrating the campaign sheet's real gaps too, not extracting its current code as the reference.

---

## 1 — Current implementation confirmed: a centered modal, not a sheet — every removal item present exactly as described

`AuthModal.tsx` is `fixed inset-0 flex items-center justify-center` with a `motion.div` card (`:95-107`) — a different component shape entirely from a bottom sheet, not something a CSS tweak turns into one. Every element Designer listed for removal is confirmed present, line-for-line: the "Create an account or Login" heading (`:111`), the close X (`:113-115`), the `User`/`Lock` icons inside the inputs (`:141`, `:154`), the "Play as guest instead" link (`:188-196`), and the disclaimer paragraph (`:198`). Nothing to correct in Designer's removal list — all six items are real and all six need to go, not restyle.

**Structure, contents, and behavior all checked against the prototype's exact citations — everything matches:**
- Scrim + sheet (`:2452-2453`): confirmed both `z-index:7`, confirmed `height:70%` fixed (`authSheetH: '70%'`, `:4181`), confirmed `border-radius:34px 34px 52px 52px` (bottom corners LARGER than top — a real, specific detail, not a rounding choice), confirmed `box-shadow:0 -18px 40px rgba(0,0,0,0.45)`.
- The 6 contents, top to bottom (`:2455-2472`): drag handle, title (`{{ authTitle }}`), mode toggle, username field, password field, submit — confirmed exactly, including that both modes share the identical two fields (no extra fields for signup).
- Mode-toggle colors (`:4174-4179`): confirmed identical values to the Menu's Dark/Light control (`#8B45F0`/`#2F2F49`/`#FFFFFF`, `0 5px 0 #5F27B8`/`#1E1E33`/`#C9C9D6`) — genuinely the same 3 tokens 2026-09-13#2 already asked to add, not a new set.
- Drag mechanics (`:4185-4200`): confirmed `dragStart`/`dragMove`/`dragEnd` exactly as described — pointer capture on the handle, `authDragY` tracks downward-only movement, scrim opacity `Math.max(0, 1 - authDragY/320)`, release decides past-half-height (measuring the sheet's own `offsetHeight` at drag start, not a hardcoded number) vs. snap-back.
- Submit (`:4210-4212`): confirmed closes the sheet, sets `loggedIn`, clears all three fields (`authEmail`/`authPass`/`authRef`), fires the exact toast text Designer cited.
- **Small implementation detail worth knowing:** the mode-toggle and submit buttons carry `onPointerDown="{{ navPress }}"` but no `data-nav` attribute — since `navPress` no-ops without a `data-nav` key (confirmed in 2026-09-13#3's own reading of the handler), these buttons never join the shared nav-bar-pop mechanism; they only get their own `translateY(3px)` press-sink. Same pattern as the Menu's Dark/Light buttons — no new mechanism needed here, just the simple press-sink.

---

## 2 — Correction to Designer's own "shared component" framing: the existing `CreateCampaignSheet` is NOT already a faithful port — it's missing the drag entirely and has 3 geometry mismatches

Designer's message: *"The Create Campaign sheet in the affiliate section is built on the exact same component — same scrim, same sheet geometry, same drag logic."* Read `AffiliateHub.tsx`'s `CreateCampaignSheet` (`:893-980`) directly to confirm before recommending anything — **it doesn't match on 4 of the 4 things Designer named:**
- **No drag logic at all.** The handle is a plain `<button onClick={onClose}>` (`:924-930`) — tap-to-close only, zero `onPointerDown`/`onPointerMove`/pointer-capture anywhere in the component. The prototype's drag-to-dismiss (past-half-height close, proportional scrim fade, live-follow) has no equivalent here.
- **Height model is different.** `max-h-[64vh]` (content-sized, capped) vs. the prototype's fixed `height:70%` (`:921` vs. `:4181`).
- **Border radius is different.** `rounded-t-[34px]` — top corners only, bottom corners square — vs. the prototype's `34px 34px 52px 52px` (bottom corners larger, the specific asymmetric detail Designer called out for the auth sheet too, so it should apply here as well).
- **Shadow is different.** `0 -8px 30px rgba(0,0,0,0.4)` vs. the prototype's `0 -18px 40px rgba(0,0,0,0.45)` (`:922` vs. `:2453`).

**One thing it does get right, worth keeping:** it's genuinely always mounted (the parent renders `<CreateCampaignSheet open={createOpen} .../>` unconditionally, translating off-screen via `transform` when closed, `:391-399`) — not conditionally created. That part of the pattern is already correct and matches the "must exist collapsed before first open" principle from the Menu overlay ticket (2026-09-13#2).

**Recommendation, unchanged in substance but corrected in basis:** still build one shared sheet component — Designer's underlying instinct (don't solve the same problem twice) is right — but build it fresh against the verified spec above, then migrate BOTH the campaign sheet (fixing its 3 geometry gaps and adding real drag support) and the new auth sheet onto it, rather than treating the campaign sheet's current code as the already-correct reference to copy from.

---

## 3 — The AuthModal needs the SAME "always mounted, translate off-screen" restructuring the Menu overlay needed — this is now a recurring pattern, not a one-off

`App.tsx:1329`: `{authOpen && (<AuthModal .../>)}` — **conditionally mounted**, not always-present. This is the identical structural gap 2026-09-13#2 found and fixed for the Menu overlay (there, the overlay WAS always mounted but its reveal *origin* wasn't ready in time; here, the whole component doesn't exist until first open, so the very first open in a session has nothing to transition from at all — worse than the Menu case, not the same bug, but the same category of gap). Confirmed via direct read of the render call — not inferred. **Fix:** render `<AuthModal>` unconditionally, drive its own visibility via the sheet's `transform`/scrim's `opacity` exactly as the prototype does, matching whatever the shared sheet component (item 2 above) ends up exposing.

**Worth flagging as a pattern, not just a fix:** this is the second time this exact "conditionally-mounted overlay with nothing to animate from on first open" gap has turned up in one week of Designer handoffs (Menu overlay, now this). If a third one turns up, it's worth a standing rule in this codebase's own conventions rather than catching each one individually as it's reported.

---

## 4 — The Account icon "turns white on tap" — confirmed real, root cause narrowed to one likely mechanism, not multiple guesses

Designer named 3 candidates ("a route change, a pressed state, an optimistic highlight"). Traced it: **`HomeHub.tsx`'s `<HubToolbar>` call passes `active={chat.open ? 'chat' : menu.open ? 'menu' : 'games'}`** — 'account' is never a possible value there, and `openAuth()` (`App.tsx:470-473`) only sets `authOpen`/`pendingResumeRef`, never touches `screen` or any active-tab state. **So it's confirmed NOT React state and NOT a route change** — ruling out 2 of Designer's 3 candidates directly, not just assuming.

**Most likely remaining candidate, matching Designer's third guess ("a pressed state") precisely:** `HubToolbar.tsx`'s `ToolbarItem` inactive-branch className includes `hover:text-[var(--rc-text)]` (`:152`) — a real CSS hover state that visually reads as "activated" (near-white) and is well-known to stick after a tap on touch devices/mobile browser emulation (the classic "sticky `:hover`" class of bug) until the user taps elsewhere. This also lines up with 2026-09-13#3's own finding that the prototype's nav-item color switch has **no transition and no separate pressed/hover treatment at all** — only the shared bar pop communicates a press; the item's own color is driven purely by which view is active, full stop. **Fix:** drop the `hover:` variant from `ToolbarItem` entirely (matches the prototype exactly, and the bar's own pop already gives tap feedback), or at minimum guard it behind `@media (hover: hover)` so touch input can't trigger/stick it.

---

## 5 — One thing to preserve from the current implementation when rebuilding: the scrim's stacking order below the nav

`AuthModal.tsx`'s own top-of-file comment (`:76-94`) documents a real, previously-fixed bug: the scrim must sit BELOW the persistent bottom nav (nav stays undimmed/tappable while the sheet is open) — this was a genuine fidelity fix, caught by the design-fidelity harness's own diff, not an arbitrary choice. **Whoever rebuilds this needs to carry that stacking lesson forward** — the prototype's own scrim/sheet are both `z-index:7`, same as its nav bar, with the nav declared earlier in the DOM (same-z ties resolve by DOM order) — our app's numbering is different (nav is `z-20`), so the equivalent needs the scrim/sheet placed below whatever z-value the current `HubToolbar` uses, not copied as the literal number `7`.

---

**Ask:** this is real work — a genuine component rebuild plus a shared-sheet extraction that also touches the affiliate flow, not a quick fix. Recommend scoping as: (a) build the shared sheet component to the verified spec (drag, geometry, always-mounted), (b) migrate `CreateCampaignSheet` onto it (fixing its 3 real gaps in the process), (c) rebuild the auth sheet on the same shared component, deleting everything Designer listed, (d) the Account-icon hover fix, small and independent, can ride in the same PR or go separately. Then Designer's own check list (6 open paths, drag-to-a-third snaps back, Account stays muted, nothing below submit) plus the harness run against screenshot 06.

---
From: Advisor   Re: Designer's spec for the bottom nav's press feel (`rcNavBarPop`), verified against `HubToolbar.tsx` and the prototype's `navPress`/`navPulse` mechanism (`origin/main`@`7dca428`), no screenshots this round

No screenshots this time (Designer's own note: "no screenshots"), but every citation is checkable directly against source, and all of them check out exactly — this is a clean, well-scoped ticket.

---

## The nav bar's press feel: confirmed completely absent, not approximated

Grepped `apps/web/src/` for `rcNavBarPop`, `navPress`, and `data-nav` — **zero hits, all three, anywhere.** `HubToolbar.tsx`'s `ToolbarItem` uses a plain `onClick` (`:146`), no `onPointerDown`, no animation, no `data-nav` key. The bar container (`:98`) has no `animation` property at all.

**Every one of Designer's citations checks out exactly against the prototype:**
- Keyframes (`:67`): `@keyframes rcNavBarPop { 0% {transform:scale(1) translateY(0);} 32% {transform:scale(0.975) translateY(2px);} 66% {transform:scale(1.012) translateY(-1px);} 100% {transform:scale(1) translateY(0);} }` — confirmed verbatim.
- Container (`:2724`): `animation:{{ navBarAnim }}` on the `bottom:74px; left:14px; right:14px` surface div — confirmed (Designer said `:2723`, off by one, same harmless margin PM already waved through on the Menu ticket's `menuClip` citation — not worth a correction).
- Trigger (`:3963-3968`): `navPress: (e) => { const k = e.currentTarget.dataset.nav; if (!k) return; this.setState({ navPulse: null }, () => this.setState({ navPulse: k })); clearTimeout(this._navT); this._navT = setTimeout(() => this.setState({ navPulse: null }), 460); }` — confirmed exactly, including the null-then-set retrigger trick Designer described.
- `navBarAnim: this.state.navPulse === 'nav' ? 'rcNavBarPop 420ms cubic-bezier(0.22,0.61,0.36,1)' : 'none'` (`:3973`) — confirmed, and all 5 nav items share the literal `data-nav="nav"` key (confirmed 5× in the markup), which is exactly why one press on any of them pulses the shared bar.

**One small, additional confirmed mismatch beyond the main ask, in the same component:** Designer's spec says the active-color switch on icon/label is instant, no transition — confirmed in the prototype markup (no `transition` on either the SVG `fill` or the label `color`). `HubToolbar.tsx`'s button currently has `transition-colors` in its className (`:151`), giving the color swap a ~150ms Tailwind default fade it shouldn't have. Small, but Designer called it out specifically ("no press state of their own... that switch is instant, no transition") — worth dropping alongside the main fix since it's the same line.

**Fix, retrigger mechanics:** Designer's own note that resetting React state to `null` then back won't restart a CSS animation on an unchanged element is correct and worth repeating to whoever implements — recommend the counter approach (bump an int on every press, put it in the animated element's `key`, forcing remount) over the manual-reflow approach (toggle a class, read `offsetHeight`, toggle back) since it's the more idiomatic React pattern and avoids a direct DOM read inside an event handler; either is fine per Designer's own message, this is just a preference, not a correction.

---

## The survey Designer asked for: every other place `navPress`/`data-nav` appears in the prototype

Designer's own closing note asked whoever implements this to grep the prototype afterward and check the other elements — did that now rather than leaving it for a second pass, since I was already in the file. Complete list, every `data-nav`-tagged element in the prototype:

| `data-nav` key | Element | Animation | Current app status |
|---|---|---|---|
| `nav` ×5 | The 5 bottom-nav items | `rcNavBarPop` on the shared bar | **This ticket.** |
| `cat0`–`cat4` | The 5 category tiles | `rcNavPop` on each tile individually | **Already ticketed** — 2026-09-13#1 (Games hero), dispatched, being built right now. Confirms Designer's own suspicion was right: same missing mechanism, already caught independently. |
| `play` ×2 | The shared PLAY button (RPS/Mines/Dice via `GameHub.tsx`) | `rcNavBarPop` (bar-style dip, not tile-style bounce — matches its wide-button shape) | **Not yet ticketed.** High leverage if picked up: one fix in `GameHub.tsx`'s shared Play button covers all 12 games at once, same win-once-fix-everywhere shape as the audio-button work. One prototype-authoring quirk worth knowing about if this gets picked up: the prototype's own Play button markup has `animation:` declared twice in one inline `style` string (`playBtnAnim` then `playShakeAnim`, `Full Spec.html:695`) — in real CSS, the second occurrence silently wins, so the mock's own insufficient-funds shake would always override the press-pop whenever both conditions were true. Worth building a correct combined value (shake takes priority when funds are insufficient, pop otherwise) rather than copying the prototype's own duplicate-property mistake verbatim. |
| `relprev`/`relnext` | "RELATED GAMES" carousel's prev/next arrows (`:920/923`) | `rcNavPop` on each arrow | **Not yet ticketed, and not sure this section exists in the current app at all** — haven't confirmed a "Related games" carousel is built yet; lowest priority of the three, may not even apply. |

**Not recommending all of this be done now** — Designer's own framing was clearly "once Ramūnas has it working here," i.e., nav bar first, survey for later. But since the survey's done, worth considering a small shared primitive (one `navPulse`-style hook keyed by a `data-nav`-equivalent id, mapping to either the bar-pop or tile-pop keyframe) if the Play button pickup happens too, rather than three separate one-off implementations of the same 6-line mechanism — flagging as an option, not a mandate; PM's call on scope.

---

**Check, per Designer's own list:** 25 presses across 5 items × 5 pages (including the already-active item, including rapid repeats) should each produce exactly one pop; `grep -rn "rcNavBarPop"` should show the keyframes plus exactly one use, on the bar container, none on the items.

---
From: Advisor   Re: Designer's direct spec for the Menu page (Dark/Light control + opening reveal), verified against `MenuOverlay.tsx`/`useMenuOverlay.ts`/`HubToolbar.tsx`/`theme.ts` (`origin/main`@`0d6dcdd`)

Designer sent a precise, line-cited spec for two things on the Menu page (screenshots in `design-ref/D02/` — one of the live app with the missing control circled as empty space, two reference captures showing the intended Dark/Light control in both themes). Spot-checked every one of Designer's own prototype citations directly — all accurate. Both items are real: one is a straightforward missing feature, the other took real tracing to find the exact mechanism (the description was directionally right, but the actual cause here is more specific than either of Designer's two guesses).

---

## 1 — Dark/Light control: genuinely missing, every value confirmed against the prototype's own computed props

`MenuOverlay.tsx`'s `GROUPS` array ends at SUPPORT (`:213-219`) — confirmed nothing follows it. All of Designer's cited values checked directly against the prototype's `renderVals()` (`:4337-4344`) and markup (`:2626-2638`), not just the written table — byte-for-byte match on every color: `themeDarkBg`/`themeLightBg` (#8B45F0/#2F2F49/#FFFFFF swap by theme), `themeDarkShadow`/`themeLightShadow` (the 5px ledges), `themeDarkFg`/`themeLightFg` (text colors) — nothing to correct in Designer's own numbers.

**The exact state to wire already exists, confirmed reusable as-is:** `theme.ts`'s `useTheme()` hook exposes `setChoice(next: ThemeChoice)` where `ThemeChoice = 'dark' | 'light' | 'system'` — `setChoice('dark')`/`setChoice('light')` is precisely `pickDark`/`pickLight` from the prototype (`:4343-4344`: `this.setState({ theme: 'dark' })`/`'light'`), same persisted key, same three-way state Preferences' own control already reads and writes (confirmed: `PreferencesHub.tsx` already uses this exact hook). No new state needed, purely a new UI reading/writing an existing global.

**Tokens — confirmed genuinely new, not a naming duplicate of something that already exists.** Grepped `index.css` for `2F2F49`, `5F27B8`, `C9C9D6` — zero hits anywhere, in either theme block. Designer's ask to add them as tokens rather than hardcode is the right call; nothing to reconcile against an existing near-duplicate the way earlier tickets found for other colors.

**Fix:** add the section (`APPEARANCE` label + track + two buttons) after the SUPPORT group in `MenuOverlay.tsx`'s render, add the 3 new `--rc-*` tokens to `index.css`'s dark and light blocks, wire `onClick` to `setChoice('dark')`/`setChoice('light')`, and reuse `useTheme()`'s `resolved` value to pick which button gets the purple treatment (matching the prototype's own `light` boolean branch). Pressed state (`translateY(3px)`, no release bounce — confirmed distinct from the category tiles' `rcNavPop`, which DOES bounce) is a simple `active:` press class, no new animation machinery needed.

---

## 2 — Opening animation: real bug, confirmed, but the actual mechanism is a third thing — more specific than either of Designer's two guesses

**Designer's own two guesses were reasonable but don't match what's actually happening.** The overlay genuinely IS always mounted (not lazily created on first open) and this is a single-page app (no route/page paint in between) — so neither "mounted late" nor "route change paints first" is the literal mechanism here. Tracing it down:

**The real cause: the reveal ORIGIN, not the overlay's existence, is what's uninitialized on first open.** `useMenuOverlay.ts`'s `anchorRect` state starts `null` (`:23`), and the ONLY place it's ever set is `onMenu(rect)` — called exclusively from `HubToolbar.tsx`'s `handleMenuClick()` (`:56-60`), which measures `getBoundingClientRect()` **at click time, not on mount**. `MenuOverlay.tsx`'s `originX`/`originY` fall back to `0` when `anchorRect` is null (`:287-288`) — so on the very first render of any given `useMenuOverlay()` instance, the clip-path is `circle(0px at 0px 0px)` (top-left), sitting there as the last-committed style.

The first tap fires `onMenu(rect)`, which sets BOTH `anchorRect` (the real coordinates) AND `open` (true) in the same React batch — so the render that flips the overlay open ALSO changes the clip-path's center coordinates, not just its radius, in the same CSS transition. Since `clip-path: circle(r at x y)` interpolates radius AND center together when both change at once, the browser animates the circle growing from 0 **while its center visibly slides from (0,0) toward the real bottom-left button position** — exactly Designer's "top-left-downward first, then correct bottom-left reveal." Every *subsequent* open on that same screen instance is correct, because by then `anchorRect` already holds the real coordinates from the previous open, so only the radius changes.

**Why it recurs per-screen, matching Designer's own check instruction to test Games/Rewards/a game screen separately:** `useMenuOverlay()` is called independently by each hub screen (HomeHub, GameHub, RewardsHub, ProfileHub) — each is its own hook instance with its own `anchorRect` state, reset to `null` on that screen's own first mount. So the wrong-origin bug isn't a one-time "very first app load" thing — it recurs the first time Menu is opened from **each** hub screen, exactly what Designer's check list describes.

**One thing worth being precise about, since it changes the fix's shape:** the prototype's own `menuClip` origin (`:3958`: `circle(1000px at 55px 797px)`) is a **hardcoded literal**, always the same — the mock has one fixed 390×840 viewport and never needs to measure anything at runtime, so this exact bug class structurally can't exist there. Our app's dynamic-measurement approach (`useMenuOverlay.ts`'s own doc comment already explains why: fluid layout, works on any viewport) is the right call and isn't being revisited — the gap is purely that the measurement happens too late (click time) relative to when it's first needed (first paint), not that dynamic measurement was the wrong approach.

**Fix:** measure the Menu button's rect on mount (and ideally keep it in sync via `ResizeObserver`/window resize, same pattern `MenuOverlay.tsx` already uses for its own `radius` state), not only at click time — so `anchorRect` already holds the real coordinates before `open` ever flips true for the first time. Needs a new reporting path separate from the existing click-triggered toggle (`onMenu` both sets the rect AND flips `open` — mount-time reporting must set the rect WITHOUT toggling open): add a `reportAnchorRect`-style export to `useMenuOverlay.ts` that only calls `setAnchorRect`, and have `HubToolbar.tsx` call it via `useLayoutEffect` once its Menu button ref is available. The existing click handler keeps working unchanged (it'll just be reporting an already-correct rect by then, harmlessly redundant).

---

**Ask:** both cheap, one PR — item 1 is a straightforward addition (existing state, existing color values, new tokens), item 2 is a small, precisely-scoped structural fix (one new callback + one `useLayoutEffect`) rather than a guess-and-check. Then Designer's own check: open Menu from Games, Rewards, and a game screen, each after a fresh load, confirm all three reveal from the bottom-left with nothing before it — plus the harness run on the menu screen in both themes, where the new control is expected to flag until it's built.

---

Designer sent a precise, line-cited spec against the prototype (screenshots of the live app in `design-ref/D01/`, both with the two problem areas circled). Spot-checked every one of Designer's own prototype citations directly — all accurate, nothing to correct there. My job below is the other half: confirming each point against the ACTUAL current code, not just trusting the description, and citing exactly what needs to change. All three sections are real, confirmed bugs — none were false alarms.

---

## 1 — Category tiles: background bug confirmed exactly as described, plus ledge/press entirely missing

**The most visible bug, confirmed byte-for-byte:** `CategoryTabs` (`HomeHub.tsx:390-393`): `active ? 'bg-brand/10' : 'bg-surface'`. The prototype's own computed value (`Full Spec.html:3880`: `bg: 'var(--rc-surface)'`, applied unconditionally to `c0`-`c4` regardless of `on`/selected state) never varies tile background by selection — **every tile is always `--rc-surface`, full stop.** Our code substitutes a faint 10%-opacity brand tint for the selected tile instead, which is why the selected ORIGINALS tile reads as backgroundless in the screenshot (a 10%-opacity purple wash over a near-black background is barely perceptible) — exactly Designer's complaint. **Fix: `bg-surface` unconditionally, drop the `active ?` ternary on background entirely.**

**Ledge shadow — confirmed completely absent, not approximated.** Grepped the whole `apps/web` tree for `"0 7px 0"` and `box-shadow.*7px` — zero hits anywhere. Prototype (`:3882`): `shadow: light ? '0 7px 0 #BEBECB' : '0 7px 0 #1E1E33'`, applied to every tile unconditionally (again, not selection-gated). **Fix: add `boxShadow` (theme-aware, matching `useTheme()`'s existing light/dark read pattern already used elsewhere in this file) to every tile.**

**Press feel — confirmed completely absent.** Grepped for `"translateY(4px)"` and `"rcNavPop"` — zero hits anywhere in `apps/web`. Current tile only has `transition-colors`, no transform/animation logic at all. Prototype: `style-active="transform:translateY(4px);"` (pointer-down sink) plus a one-shot `rcNavPop 420ms cubic-bezier(0.22,0.61,0.36,1)` release animation (`:66`, keyframes confirmed verbatim: `scale(1)` → `scale(0.84)` at 30% → `scale(1.06)` at 62% → `scale(1)`). **Fix: add a pressed-state class (`active:translate-y-1` or equivalent, ~4px) plus a keyframe animation fired on release** — this needs a small amount of new CSS (a `@keyframes` block, since Tailwind has no built-in equivalent to this exact 3-keypoint overshoot curve) but no new state/logic beyond a brief "just released" flag.

**Two more small, confirmed mismatches, lower priority than the above three:**
- Icon size: current uses `h-[26px] w-[26px]` uniformly (`:395`). Prototype: 29px for the ORIGINALS bolt specifically (`:187`, confirmed `width="29" height="29"`), 25px for the other four (`:191/195/199/203`, confirmed `width="25" height="25"` on all four).
- Icon-label gap: current `gap-2.5` = 10px (`:391`). Prototype: `gap:9px` (`:186`, confirmed on all five tiles). Rail's own top padding: current `pt-1` = 4px (`:378`); prototype's rail padding is `0 16px 9px 16px` (`:185`) — top should be 0, not 4px.

**Already correct, no change needed:** tile size (76×77px, `:391` matches `:186` exactly), radius (14px, matches), tap-to-center scroll behavior (`selectAndCenter`, `:366-376`, already ported from the prototype's own `pick` handler per this file's own citation and comment — confirmed still accurate).

---

## 2 — Category rail edge fades: confirmed entirely absent, not a simplified/static version

Grepped `HomeHub.tsx` for `"fade"`/`"gradient"` — the only hits are an unrelated tile-art fallback background, nothing on the rail. **No fade overlay elements exist on the rail at all** — the screenshots show exactly what that produces: a hard-clipped "EV…" tile at the right edge with no visual cue there's more to scroll.

Prototype (`:207-208`): two absolutely-positioned divs inside the rail's `position:relative` wrapper (`:184`) — left fade `left:0; width:38px`, right fade `right:0; width:28px`, both `top:-1px; bottom:-1px; pointer-events:none`, gradient using `color-mix(in srgb, var(--rc-bg) …, transparent)` stops at 0%/12%/58%/100% (themes automatically via `--rc-bg`, confirmed both fades reference the same CSS variable, not a hardcoded color). Opacity is **not fixed** — driven by scroll position (`:3856-3864`): `catLeftFade = min(1, scrollLeft / 24)`, `catRightFade = maxScroll <= 0 ? 0 : min(1, (maxScroll - scrollLeft) / 24)`, both transitioning `opacity 180ms ease`. At rest (scrollLeft=0): left fade invisible, right fade fully on; scroll 24px and the left fade is fully in.

**Fix:** add the two overlay divs to `CategoryTabs`'s wrapper (needs promoting to a `position:relative` wrapper around the existing `overflow-x-auto` rail, since the rail div itself doesn't have one today), track `scrollLeft`/`scrollWidth`/`clientWidth` via an `onScroll` handler (React state, same idiom as this file's other scroll-driven UI), and drive each fade's `opacity` from the exact formulas above. **Worth flagging explicitly per Designer's own closing note: this must be scroll-driven, not a static gradient** — a fixed-opacity version would look right in a still screenshot (and might even pass a first glance) but wrong the moment anyone actually scrolls the rail, since the left fade should start invisible and the right fade should go to 0 once nothing more is scrollable.

---

## 3 — Section title: wrong icon AND wrong font, both confirmed

**Icon — confirmed wrong, not approximated.** `HomeHub.tsx:215`: `<img src={boltMark} .../>` — a **static import**, rendered unconditionally regardless of `cat`. This is literally always the same two-tone brand-logo bolt (the same asset used in the top-left `HubRibbon` logo), never changing with category — matches Designer's complaint precisely and matches what's circled in the second screenshot. Prototype (`:231-235`): the title icon is **the selected category's own icon** — five `sc-if` blocks, one per category, each a plain single-fill `#8B45F0` SVG using the exact same path data as that category's own rail tile (bolt/spade/die/crosshair/trophy), swapped via `isCat0`...`isCat4`. Size 26px on all five (confirmed `width="26" height="26"` on every `sc-if` block). **Fix:** replace the static `<img>` with a switch on `cat` rendering the matching category SVG at solid `#8B45F0` fill, 26px — the tile rail already has these exact SVGs (`CATEGORY_ICON` map, `HomeHub.tsx:348-354`) as React components; reuse them directly rather than re-deriving the paths, just force the fill to the fixed `#8B45F0` (never `text-brand`'s CSS-variable indirection, never theme-conditional, since the prototype's title-icon fill is a hardcoded literal in both themes) instead of the tile's own selected/muted color logic.

**Font — confirmed wrong on every axis.** Current (`:216`): `text-[15px] font-black uppercase tracking-[0.04em]`, no explicit `font-family` (falls back to the app's default sans stack, not Arial). Prototype (`:236`): `font-family:Arial, Helvetica, sans-serif; font-size:21px; font-weight:bold; letter-spacing:0.4px`. Three real mismatches: size (15px vs 21px — six points off, not a rounding difference), weight (`font-black` is typically 900, prototype wants standard bold/700), and family (unset/inherited vs explicit Arial stack). Designer's own cross-reference checks out: Rewards' `YOUR REWARDS` headline (`:1007`, confirmed `font-size:19px; font-weight:bold; letter-spacing:0.6px`) is the same family/weight at 19px — the games title is deliberately 2pt larger, not the same size. **Fix:** `font-family: Arial, Helvetica, sans-serif; font-size: 21px; font-weight: 700; letter-spacing: 0.4px` — drop `font-black`/`uppercase` (the `CATEGORY_TITLE` strings are already stored uppercase, so the class was redundant, not wrong, but worth dropping alongside this fix for cleanliness).

**Row layout — already correct, no change needed:** `mt-[26px] flex items-center gap-3 px-4` (`:214`) matches the prototype's `margin:26px 16px 0 16px; gap:12px` (`:230`) on every axis that matters (top offset, side inset, icon-title gap).

---

**Designer's own "check when done" list, translated to what's actually true right now (all FAIL, confirming every finding above, none are false alarms):**
- `grep -rn "0 7px 0"` → **zero hits**, needs adding
- `grep -rn "translateY(4px)"` → **zero hits**, needs adding
- `grep -rn "rcNavPop"` → **zero hits**, needs adding (new keyframes)
- Two fade overlays, scroll-bound opacity, `--rc-bg`-based → **don't exist**, needs adding
- Title icon renders five SVGs across categories → **renders one static image always**, needs the swap
- No hex literal for tile background → **currently is one, effectively** (`bg-brand/10` on selection), needs removing

**Ask:** all three sections are cheap, well-scoped CSS/markup changes to one file (`HomeHub.tsx`) plus its shared `categories.ts` icon map (already exists, just needs reuse in the title row) — no new state machinery beyond the rail's own scroll-position tracking for the fades. Recommend one PR covering all three, then the design-fidelity harness run Designer asked for on this screen in both themes to confirm.

---

### 2026-09-12#5 — HIGH PRIORITY: the live board vanishes on result for BOTH Dice and Mines — a shared bug in #558 AND already-shipped #555, plus 2 more real Dice gaps, plus a full Mines live-HUD text survey            [READY TO TICKET — item 1 first, it affects two shipped PRs; item 4 is a survey, needs Owner calls before any dispatch]
From: Advisor   Re: Owner's live post-merge Dice pass (#558)

Owner tested #558 live and reported 3 things. Investigated all 3 against the actual current `GameHub.tsx`/`DiceHub.tsx`/`MinesHub.tsx` source (post-#558) — item 1 turned out to be a real, well-evidenced, high-priority bug that **also affects Mines' already-shipped #555**, not just Dice. Flagging that proactively rather than waiting for Owner to test Mines' reveal separately, since it's the exact same root cause, verified by reading the code, not guessed.

---

## 1 — The live board unmounts to the idle preview during the `'result'` phase — confirmed for both Dice and Mines, Mines is the worse case (zero grace period)

Owner: *"cubes are not even visible when they travel, just briefly visible when they stopped, then vanish at all, just sound. Looks like something is covering the table — grey area, behind which the result pills are hiding."*

**Root cause, precisely located:** `DicePanel` (`DiceHub.tsx:281-285`) renders `args.phase === 'in-match' ? <DiceBoard/> : <DiceIdle/>` — nothing else. `GameHub.tsx`'s own phase formula (`:534-539`) sets `phase = 'result'` (NOT `'in-match'`) the instant `overlay` is set — which happens either immediately (no `holdResultMs`) or after the hold timer fires (`holdResultMs > 0`). Either way, **the moment `phase` becomes `'result'`, `DicePanel` unconditionally swaps to `DiceIdle`** — the blank, grey, no-cube, no-history, 50%-fill idle preview — discarding the fully-resolved board `gameState` still holds. This is exactly Owner's "grey area covering the table, hiding the result": it's `DiceIdle` replacing `DiceBoard`, not an actual overlay or z-index issue.

**Why Dice at least shows the result briefly first:** `DiceHubScreen` sets `holdResultMs={HOLD_MS}` (2200ms, `:343`) — so the board (with cubes at rest + true numbers + the belt) IS visible for ~2.2s before this bug kicks in and wipes it. That matches Owner's "briefly visible when they stopped, then vanish."

**Mines has the identical bug, and it's worse: zero grace period.** `MinesPanel` (`MinesHub.tsx:406-413`) has the exact same `args.phase === 'in-match' ? <MinesBoard/> : <MinesIdle/>` gate, and `MinesHubScreen` sets **no `holdResultMs` at all** — so per the same phase formula, `phase` jumps straight to `'result'` the instant a fresh result exists, with **no delay whatsoever**. That means Mines' final revealed board (busted tile / cleared board) may never be visible at all before reverting to the blank grey idle grid — worse than Dice, not better. This wasn't caught in #555's review because that ticket's own testing likely didn't chase the board all the way through the full `'result'` phase, only confirmed the bar ring itself lit up correctly (which it does — that part's unaffected, since `ownBarResult`/`ownBarVerdict` live on the bar component, entirely separate from `renderGameArea`'s panel).

**The correct reference pattern already exists in this codebase, unused by either fix:** `CoinflipPanel` (`CoinflipHub.tsx:120`): `const live = phase === 'in-match' || phase === 'result';` — Coinflip's own panel correctly keeps showing the live board through BOTH phases. Neither #555 nor #558 adopted this when wiring `ownBarResult`+`suppressResultOverlay` — both copied the bar-mechanism half of Coinflip's pattern but not this half.

**Fix, same shape for both games:** change `MinesPanel`/`DicePanel`'s gate from `phase === 'in-match'` to `phase === 'in-match' || phase === 'result'`, matching `CoinflipHub.tsx:120` exactly. Recommend landing this as its own small, focused PR touching both files together, given it's one root cause in one shared pattern, not two separate bugs.

**"I see results from previous version of the game" — likely explained, not a separate bug.** `DiceHubScreen`'s `history` state persists across matches by design (matches the prototype's own persistent `diceHistory`, already confirmed correct in 2026-09-12#3 item 2) — once this fix lands and the board stops vanishing, the belt showing prior rounds' pills alongside the current one is the correct, intended behavior, not a bug. Worth Owner re-checking once item 1 ships to confirm this reads as intended now that the board doesn't disappear first.

---

## 2 — Missing matching-phase table dim for Dice — same fix RPS/Mines already got, never applied here

Owner: *"when opponent selection theater is happening, the background is not properly dimmed, so the player pills blend into the table."*

Confirmed absent: grepped `DiceHub.tsx` for `barSlideActive` — zero hits. RPS got this fix in #551 (`opacity: args.barSlideActive ? 0.28 : 1` on `RpsPanel`'s wrapper) and Mines got it in #555 (`MinesPanel`, same pattern, `MinesHub.tsx:411`) — Dice's own `DicePanel`/`DiceBoard`/`DiceIdle` never got the equivalent, even though the prototype's own `minesBoardOp` value (the shared property name that drives Dice's panel too, `Full Spec.html:3756`) dims to the identical 0.28 during matching for all three games alike. **Fix:** add the same `opacity: args.barSlideActive ? 0.28 : 1` treatment to `DicePanel`'s wrapper (currently `DiceIdle`/`DiceBoard` each render their own top-level div directly with no shared wrapper — may need a thin wrapping `DicePanel` div, mirroring `MinesPanel`'s structure, rather than duplicating the style onto both).

---

## 3 — Cube "travel" doesn't exist at all — a real gap, but the fix needs to respect the no-fabricated-data rule already established for this game

Owner: *"the Designer makes a short pause to establish the measurement devices — cubes — then cubes move their trajectory slower in Designer version, in our version cubes are not even visible when they travel."*

**Confirmed: there is currently no travel animation at all, by construction, not by a missing tween.** `DiceTrack`'s cube (`DiceHub.tsx:95-149`) is invisible (`cubeOpacity = value == null ? 0 : 1`, `:102`) for the entire pre-resolution window, and its position (`cubeLeft`, `:101`) is only ever computed from the TRUE final `roll` value — there is no intermediate state where the cube is visible anywhere but its final resting spot. The moment the true roll arrives, the cube pops directly into view already at the finish line — no slide, because `left` isn't even one of the transitioned properties (`CUBE_TRANSITION`, `:60`, only lists `opacity`/`transform`).

**This isn't the prototype's own fabricated 444ms count-up tween re-appearing as a gap** — this app deliberately doesn't replicate that (documented at `DiceHub.tsx:21-30`, a real, already-made decision: no honest intermediate value exists to count through, so it doesn't fabricate one). That decision was correct and isn't being revisited. But "the cube is invisible until it's already finished" is a separate, narrower problem the no-fabrication rule doesn't actually require — the cube's ICON can visibly travel from a known, always-true starting point (0, the track's zero mark — never in question, no data implied) to its true final position, without ever displaying a fabricated intermediate NUMBER.

**Minimal, no-fabrication-safe fix:** make the cube visible (`opacity: 1`) for the whole `'in-match'` phase, resting at the 0% mark, instead of gating visibility on `roll != null`. Add the position (`left`, or switch to a `transform: translateX(...)` to reuse the property already in `CUBE_TRANSITION`) to the transitioned properties, so the moment the true roll arrives, the cube visibly (and honestly) slides from its known start to its true end over a real CSS transition — no invented number ever shown, only an eased position change between two always-true points. Consider holding the NUMBER label's reveal until the slide completes, so the suspense reads right (number appears once the cube "lands," not before).

**On "slower":** the transition durations here (`FILL_TRANSITION`/`CUBE_TRANSITION`, both ~420ms, `:59-60`) were carried over from the prototype's own values, which were tuned for a 444ms fake count-up — once real position-sliding is added per the fix above, these durations are a starting point, not gospel; recommend lengthening (PM/whoever implements can judge, no exact number cited by the prototype for this specific honest-slide case since the prototype never had to solve this problem itself).

**Not investigated / lower priority:** whether the ~2.4s post-match-found search-theater dwell (`GameHub.tsx`'s default `searchFloorMs`) already gives Dice a "pause to establish the cubes" — it likely already exists (Dice doesn't override it to 0 the way RPS/Coinflip do), but items 1+2 above (board vanishing, missing dim) probably make that pause read as "nothing happened" rather than "the game acknowledged the moment," which may be most of what Owner is actually perceiving as "too fast." Worth re-checking Owner's read on pacing only after items 1+2 ship, rather than tuning timing values now against a broken visual.

---

## 4 — Mines: a full text audit of `MinesBoard`'s live-play HUD, at Owner's request for a systematic (not one-by-one) check

Owner: *"on the table there are texts, which are not visible on the Designer view: 'Tap a tile. Avoid mine...' also other texts like 'Waiting for opponent', 'Locked in...' — must be checked... maybe they have some common feature and could be grepped to identify them all."*

**Method (reusable for any hub, worth keeping as the standard technique going forward):** extract every quoted user-facing string literal from the screen's `.tsx` file (`grep -noE "'[A-Z][a-zA-Z0-9 ,.…'’-]{3,}'" apps/web/src/screens/<Hub>.tsx`), then grep each one individually against the whole prototype file rather than just the game's own markup block — some text lives in shared areas (bars, etc.), not just the panel. Ran this on `MinesHub.tsx`.

**Result: `MinesBoard`'s entire live-play status/HUD text layer (`MinesHub.tsx:294-386`, ~8 distinct strings) has zero prototype equivalent, confirmed by grepping the whole file, not just the `isMines` block** — "You (…) · N safe", "Round N", "Opponent · N safe / 🙈 / locked", `myStatus` ("Busted"/"Board cleared"/"Your move"), the bottom paragraph ("Resolving…"/"Locked in — waiting for your opponent…"/"Tap a tile. Avoid the mines…"), and the "Resign" button. The already-shipped idle paragraph removal (#555 item 1) was the first piece of this same category — this is the rest of it, in the LIVE board this time, not idle.

**Why this needs individual categorization, not a blanket removal — same standing rule this session has applied consistently (RPS's "Picked {choice}" text, RPS's Forfeit button):** checked whether the prototype conveys any of this information some other way during live play (its own gem-count text/rows, `oppGemText`/`myGemText`/`oppGemRowOp`/`playerGemRowOp`) — it doesn't. Those are gated on `mReveal`/`mGrown`, both **post-match-only** states (`Full Spec.html:3765/3778/3780/3782`). **During live, active play, the prototype shows nothing at all beyond the tile grid and the round clock — no safe-count, no round number, no opponent status, nothing.** That's expected for a static demo mock with one scripted playthrough; it's a real gap for an actual redacted-information multiplayer game, where the opponent's live progress is invisible everywhere else in the UI.

**Per-item read, not one blanket call:**
- **"Opponent · N safe / 🙈 / locked"** — the single highest-value piece: this is the *only* place in the entire UI the opponent's live, server-redacted progress is ever shown. No prototype equivalent, but removing it removes real information with no substitute anywhere. **Recommend: keep, flagged as functional (same category as RPS's "Picked {choice}" text).**
- **"You (…) · N safe" / "Round N" / `myStatus`** — real information, though partially redundant with what the board's own tile colors already convey (a player can eyeball their gem count). Lower priority than the opponent line, still no prototype substitute. **Recommend: keep, flagged.**
- **Bottom paragraph** — "Tap a tile. Avoid the mines…" is exactly RPS's "Picked {choice}" situation: explains a real mechanic (mine count, safe-tile win threshold, clock) a static, non-interactive mock never had to explain. "Locked in — waiting…" / "Resolving…" describe real transient wait states. **Recommend: keep, flagged.**
- **"Resign" button** — a real safety-valve (matches RPS's Forfeit reasoning), but with **less prototype support than RPS's case**: RPS's `rpsForfeit` at least exists as unbound dead code in the prototype's own source (`:3821`); grepped for a Mines equivalent — there is none, not even dead code. **This one genuinely needs an explicit Owner call, not a default keep** — options are the same as RPS's: (a) keep but restyle smaller/quieter, or (b) remove and rely on the round timeout as the de facto give-up path (Mines' own 30s round clock already provides one, unlike RPS at the time of that decision).

**Not touching anything here without direction** — this is a survey, not a dispatched fix. Happy to run the same grep-and-cross-check method against RPS's and Dice's own live-play boards too if useful, now that it's a repeatable process rather than a one-off read.

---

**Ask:** item 1 first, and treat it as touching two already-shipped PRs (#555, #558), not just a new Dice ticket — recommend one small combined PR for `MinesPanel`+`DicePanel`'s phase gate. Item 2 is Dice-only, cheap, same shape as #551/#555. Item 3 needs a real (if small) implementation decision about durations/sequencing — flagging the constraint (no fabricated numbers) rather than prescribing exact values. Item 4 needs no dispatch yet — it's Owner's call on each piece, the "Resign" button most of all; the rest are recommended keeps, not blockers.

---

### 2026-09-12#4 — Addendum to #3: 3 more Dice items, caught before merge, folded into the same PR            [SENT DIRECTLY TO PM PRE-MERGE — recording for the record]
From: Advisor   Re: Owner's follow-up questions on the Dice ticket while it was still in flight

Owner asked 3 more specific things about Dice while #3's ticket was still being built (no PR yet) — sent each straight to PM rather than waiting to batch a full entry, since catching them pre-merge was cheaper than a follow-up PR. All three landed in the same `DiceHub.tsx` idle/board components as #3, all folded into the one in-flight PR. Recording the full citations here for the permanent record.

---

## 5 — Idle gauges wrongly dimmed to 50% — pixel-verified, not just source-read

Owner: *"Dice table indicator colors — in our case they are dim, in Designer vision — bright green and bright violet."*

`DiceIdle` (`DiceHub.tsx:224-237`) wraps both roll gauges in `opacity-50` ("mirrors RpsIdle/MinesIdle/CoinflipIdle's dimmed anchor convention" — a convention that, on inspection, doesn't actually exist in the prototype for any of the three). Confirmed two ways, not just a source read:

**Pixel sample, straight from the design-fidelity harness's own committed PNGs** (`tools/design-fidelity/{references,captures}/dark/dice-idle.png`):
- Reference (prototype) green fill: RGB(34,197,94) = exactly `#22C55E` at full strength. Purple: RGB(139,69,240) = exactly `#8B45F0` at full strength.
- Our capture: green RGB(30,112,70), purple RGB(82,47,143) — roughly half-brightness, consistent with a 50%-opacity overlay on the dark background.

**Source confirmation:** the prototype's own idle-state opacity for this panel is `minesBoardOp: rpsMatching || mConverged ? 0.28 : 1` (`Full Spec.html:3756`, shared name — it also drives the Dice panel). During plain idle (nothing matching, nothing converged) that's **1** — full brightness. There's no dimmed-idle state in the prototype's own design for Dice at all.

**Fix:** drop `opacity-50` from `DiceIdle`'s wrapper. The hex values were already exactly correct — only the opacity was wrong.

**Same pattern flagged (not fixed) in RpsIdle (`RpsHub.tsx:251`) and MinesIdle (`MinesHub.tsx:171`)** — identical `opacity-50` "dimmed anchor" treatment, and both games' own idle-state board opacity in the prototype is also `1`. Since RPS and Mines already shipped, this is its own small follow-up ticket, not urgent tonight (PM agreed).

---

## 6 — "Place your bet and roll" / "Finding a rival…" — zero prototype equivalent, same removal pattern as RPS/Mines

Owner: *"Not sure about the sentence 'Place your bet and roll' — on the table, whether Designer view has it."*

Grepped the whole prototype file — zero hits for either string. The `isDice` idle block (`Full Spec.html:531-604`) is just the two tracks + scale row + history belt, no copy anywhere. Same category as the already-fixed RPS (`RpsHub.tsx:239`) and Mines (`MinesHub.tsx:182-184`) redundant idle paragraphs. **Fix:** delete `DiceHub.tsx:232-234`'s paragraph outright.

---

## 7 — Panel height doesn't match the prototype's fixed 266px box

Owner: *"Table size in our case smaller vertically, not sure how later history pills will fit."*

**The question itself is already answered safely** — `DiceHistoryBelt`'s container is `overflow-hidden` with each pill locked to `flex: 0 0 calc((100% - 32px) / 5)`, always showing exactly 5; the 6th (the cap, matching the prototype's own `.slice(0, 6)`) clips during its exit animation rather than pushing the panel taller. No clipping risk as history accumulates — that part was already right.

**But the panel's own proportions are a real, separate mismatch.** The prototype fixes the Dice panel at `height:266px` explicitly (`Full Spec.html:532`: `box-sizing:border-box; padding-top:47px; gap:14px; justify-content:flex-start`) — constant regardless of content. `DiceIdle`/`DiceBoard` both use `min-h-[200px]` (`DiceHub.tsx:226/262`) — a floor, not a fixed value, and lower than the prototype's own number, so the panel renders visibly shorter and its height varies with content instead of staying constant. **Fix:** swap `min-h-[200px]` + the idle-only `justify-center` for the prototype's literal `height:266px` / `padding-top:47px` (idle) / `justify-content:flex-start`, matching the box model exactly.

**RPS's panel has the identical `height:266px` pattern** (`Full Spec.html:606`, different internal padding/justify) — likely the same gap there, flagged but not asked to be touched now.

---

**Status:** all three sent directly to PM pre-merge (no PR existed yet for #3's ticket) and folded into the same in-flight PR — cheaper than a follow-up. Item 5's RpsIdle/MinesIdle echo and item 7's RPS echo are noted as their own small follow-up, not urgent.

---

### 2026-09-12#3 — Dice vs. prototype: 1 real audio gap (bigger than it looks), 1 real reveal gap (small, same shape as Mines), 2 items already correct as-is            [READY TO TICKET — items 1+3]
From: Advisor   Re: Owner's own Dice analysis pass (Owner had never played it before tonight)

Owner described 4 things they saw/expected from watching Dice, framed as "not sure how it's supposed to work, but here it is" — not a bug report, an analysis pass. Checked all 4 against the prototype's actual asset list + `renderVals()`/class-method logic, not the visual impression alone. Result: **2 of the 4 are real gaps** (one bigger than it looks, one a clean small fix already scoped in the same shape as Mines' pending work), and **2 of the 4 are already correctly implemented, byte-for-byte** — worth saying so plainly rather than letting them sit as open questions.

---

## 1 — Audio: a real, confirmed gap, but smaller AND differently-shaped than "rich audio in all phases"

**Currently wired: zero sounds for Dice, or for RPS/Mines.** Grepped `apps/web/src/lib/sound.ts`'s `MANIFEST` and every screen that imports it — only `ChessHub.tsx` plays anything (one "move" click sound). So the gap is real and confirmed, not a guess.

**But the prototype's own actual sound design is more minimal than "basically all the UX is built on audio" suggests — worth being precise about what to build, not overbuild.** The prototype ships exactly **3** audio clips total (`design/prototype/assets/audio/{play,dice-roll,dice-win}.mp3` — the real files already exist in the repo, no sourcing needed), triggered at exactly 3 moments (`playMines()` :3833, `runDiceRoll()` :3432-3437, `startDiceResult()` :3448-3452):
1. **`play.mp3`** — once, on PLAY press. Shared by RPS/Mines/Dice alike (`playMines()` is the one handler for all three) — worth wiring at the `GameHub.tsx` shared PLAY button, not per-game, so RPS/Mines get it for free too.
2. **`dice-roll.mp3`** — looped (`sfx(name, true)`), starts when the roll begins, stopped (`stopSfx('dice-roll')`) the instant the roll resolves. Dice-only.
3. **`dice-win.mp3`** — once, **only on a WIN** (`if (win) this.sfx('dice-win')`, :3452). **There is no loss sound in the prototype's own asset set** — a loss is silent, just the color change. Worth flagging precisely since it's a real correction to "sound in all phases": the reveal phase's sound is win-conditional, not universal.

**The mute toggle is already fully wired and needs no work** — `PreferencesHub.tsx`'s "Game sounds" switch (issue #418) already reads/writes `sound.ts`'s real mute state, matching the prototype's own `toggleGameSound`/`gameSoundTrack` exactly. Nothing to do there.

**One real architecture note, not just "add 3 lines":** `sound.ts`'s `play()` is a fire-and-forget one-shot Web Audio `BufferSourceNode` — no loop, no way to stop a sound once started. That's fine for Chess's single click, but `dice-roll` needs genuine loop+stop semantics to match the prototype. Two ways to go: (a) extend `sound.ts` with a real loop/stop primitive, or (b) since our reveal is server-authoritative (this file's own top comment already explains why we don't fake a counting animation — the true rolls arrive already decided), trigger `dice-roll` once at the start of the existing `HOLD_MS` (2200ms, `DiceHub.tsx:11`) reveal-hold window instead of trying to reproduce the prototype's fabricated 444ms tween — that window is the honest analog of "the roll is happening." Recommend (b) unless the implementer judges (a) cheap enough to just do properly; either way, flagging so it isn't scoped as a 10-minute add.

---

## 2 — The history "memory" belt — already correctly implemented, matches the prototype byte-for-byte. Nothing to do here.

Checked Owner's exact description (row of pills below the tracks, green win-pills / grey loss-pills with white numbers, oldest slides off when full) against the prototype's actual `diceHistory` derivation (`:3658-3672`) and `DiceHub.tsx`'s existing `DiceHistoryBelt`:
- **Colors**: prototype's loss pill is `#2F2F49` (dark) re-tinted to `#BFBFCE` (light grey) + `#1A1A2E` text specifically in light theme (`:3663-3666`) — `DiceHistoryBelt`'s `bg`/`fg` logic (`DiceHub.tsx:182-183`) matches this exact theme-conditional retint, not an approximation.
- **Cap/shift**: prototype caps at 6 stored, shows 5, shifts the oldest out (`.slice(0, 6)`, `:3455`) — `DiceHubScreen`'s own history state does the identical `.slice(0, 6)` (`DiceHub.tsx:330`), with Framer Motion's `AnimatePresence`+`layout` standing in for the prototype's manual two-phase shift trick, same end visual result.

**No gap, no action needed.** Owner's description of what they saw is accurate — it's just already built. Worth telling Owner directly so this doesn't come back as an open question.

---

## 3 — Reveal color animation on the player's own pill — real gap, same shape as Mines' pending item 3(b), and simpler

Owner's description ("my pill: background goes green, then vanishes to just a green outline, small animation + sound") is precisely the prototype's `winFillAnim`/`winTextAnim`/`playerBarRing` mechanism (`:3787-3789`) — the SAME own-bar win-fill mechanism already proven on Coinflip and currently being wired for Mines (2026-09-12#2 item 3(b)). It fires for Dice too: `mOutcome`'s gate is `gameV = view === 'mines' || isDice` (`:3519`) — Dice is explicitly included.

**`DiceHubScreen` (`DiceHub.tsx:335-347`) currently wires `renderResultReveal={DiceReveal}` — a popup — with `holdResultMs` but no `suppressResultOverlay`/`ownBarResult`.** Same root cause as Mines: never opted into the mechanism, not a broken one.

**Fix is more direct than Mines':** Dice already has `holdResultMs={HOLD_MS}` wired (`:341`) — Coinflip's own reference pattern is exactly `suppressResultOverlay` + `holdResultMs` + `ownBarResult` together (`CoinflipHub.tsx:339-341`), and Dice is two-thirds there already. Add `suppressResultOverlay` + `ownBarResult`, drop `renderResultReveal={DiceReveal}` (the popup component becomes dead code, can be deleted). **Unlike Mines, Dice needs none of the harder parts** — `mConverged` (bar-convergence) is explicitly `mActive && !isDice` (`:3524`, Dice excluded), and the gem-count text is explicitly `!isDice`-gated on both sides (`oppGemTextOp`/`myGemTextOp`, `:3780/:3782`) — Dice never gets either. This is a same-night wire-up, full stop.

**Ties to item 1:** the win-fill firing is the exact trigger moment for `dice-win.mp3` — worth landing both in the same PR since they're the same event.

---

## 4 — Moving colored cubes during play — already correctly implemented. Nothing to do here.

`diceMyNumColor`/`diceOppNumColor` (green on higher roll, red on lower, neutral pre-final/tie — `:3678-3679`) match `DiceBoard`'s existing `myNumColor`/`oppNumColor` logic (`DiceHub.tsx:258-259`) exactly. The cubes' apparent "movement" (position/opacity/scale animating via CSS transition as the fill width changes) also already matches the prototype's own transitions (`DiceHub.tsx:59-61` cites the exact source lines). The one deliberate difference — our cube shows the true final number instantly rather than counting up from 0 — is an explicit, already-documented decision (`DiceHub.tsx:21-30`): the prototype's count-up is a client-fabricated tween against numbers the demo already knows; our server-authoritative reveal has no honest intermediate value to count through, so counting one up would mean displaying fabricated data. Not a gap — a correct call already made and explained in-repo.

---

**Ask:** items 1+3 together, one PR — same PR makes sense since the win-fill (3) is the sound trigger (1) needs anyway. Item 1's `play.mp3` wiring is worth doing at the shared `GameHub.tsx` PLAY button rather than per-screen, so RPS/Mines pick it up for free. Items 2+4 need no code — just closing the loop with Owner that what they saw is already correct.

---

### 2026-09-12#2 — Mines vs. prototype: 3 gaps from Owner's own analysis pass, one is a real feature gap not a tweak            [READY TO TICKET — item 3 is the big one]
From: Advisor   Re: Owner's own Mines review (not relayed secondhand this time — Owner did the comparison directly)

All three confirmed against the prototype's actual `isMines`/`isDice` markup (`Full Spec.html:470-660`) and its `renderVals()` derivation block (`:3505-3789`), same standard as the RPS tickets. Good news: items 1 and 2 are cheap, item 3's underlying mechanism (`ownBarResult`) is exactly the RIGHT one for Mines — unlike RPS's #547 correction, this is a case where adopting the shared pattern is correct per the prototype's own `gameV` gate, not a mistake to undo. But item 3 is genuinely bigger than a tweak: it needs new GameHub plumbing, not just wiring an existing prop.

---

## 1 — Redundant idle text, confirmed zero prototype equivalent, same pattern as the RPS fix already shipped in #551

`MinesHub.tsx:182-184`:
```
<p className="text-xs text-muted-foreground">
  {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
</p>
```
Read the entire `isMines` idle/board block in the prototype (`Full Spec.html:470-529`) — it's the tile grid + round clock, gated only by `minesBoardOp`/`minesClockOp`. **No paragraph, no idle copy, nothing — for either sub-state.** Grepped the whole file for "Waiting for", "Choose a bet", "press PLAY", "JOIN an open" — zero hits anywhere. This is the identical situation to `RpsHub.tsx`'s now-removed idle paragraph (2026-09-12#1 item 4, `#551`): the shared PLAY-button label (`GameHub.tsx:797`, "Waiting for an opponent · m:ss") already covers the waiting case; the prototype simply never explains the mechanic behind the else-branch. **Fix: delete the whole `<p>` at `MinesHub.tsx:182-184`,** matching the RPS precedent exactly — this is Owner's own ask, and it's a clean removal, not a flagged one.

---

## 2 — Board doesn't dim during search; the mechanism is already plumbed generically, Mines just never consumed it

The prototype's Mines panel wrapper carries `opacity:{{ minesBoardOp }}` (`:471`), and `minesBoardOp: rpsMatching || mConverged ? 0.28 : 1` (`:3756`) — same 28% dim RPS's own board gets during search (`rpsBoardOp`, `:3795`, fixed in `#551`). **`MinesPanel` (`MinesHub.tsx:393-399`) applies no opacity treatment at all** — confirmed by direct read, it's a bare `rounded-[22px] bg-[var(--rc-surface))` wrapper. This is a real, confirmed gap, not just "needs checking" as Owner suspected.

The cheap part: `GameHub.tsx` already threads `barSlideActive` through `GameAreaArgs` generically (`:686`) for every hub that opts into `matchBarSlide` — Mines already does (`MinesHubScreen`'s `matchBarSlide="measured"`). **Immediate fix: apply `opacity: args.barSlideActive ? 0.28 : 1` to `MinesPanel`'s wrapper**, the exact pattern `RpsPanel` already got in `#551` — no new plumbing needed for the search-phase half of this.

**One caveat, ties into item 3 below:** the prototype's `minesBoardOp` condition is `rpsMatching || mConverged` — it also dims during the post-match bar-convergence phase (`mConverged`, item 3), which doesn't exist in this codebase yet. So the fix above gets the search-phase dim exactly right, but won't yet dim during the post-match reveal until item 3's convergence state lands too — flagging so this isn't reported as "fully done" prematurely once shipped.

---

## 3 — The reveal is a real, bigger feature gap: no bar-convergence, no gem-count badges, and the win/lose frame ring isn't wired — the popup Owner sees is the fallback path firing by default, not a broken feature

**`MinesHubScreen` (`MinesHub.tsx:406-418`) wires neither `suppressResultOverlay` nor `ownBarResult`** — only `matchBarSlide="measured"`. So it falls straight into `GameHub`'s default result-popup path (`:891`, `overlay && !suppressResultOverlay`), which is exactly what Owner is seeing. Unlike RPS's #547 correction, **`ownBarResult` is the textbook-correct mechanism for Mines** — the prototype's own gate proves it: `gameV = view === 'mines' || isDice` (`:3519`) is the exact condition that turns on `mOutcome`/`playerBarRing`/`winFillAnim`/`winTextAnim` (`:3522-3528`, `:3787-3789`). Mines is literally one of the two games this mechanism exists for.

That said, the full prototype behavior Owner described has **three distinct parts**, and only one of them is "wire an existing prop":

**(a) Bars converge to the center after match end — genuinely new state, doesn't exist in `GameHub` today.** `mConverged = mActive && !isDice` (`:3524`) drives `rpsOppBarY`/`rpsPlayerBarY`/`matchVsTop` to a **different** shift magnitude than the search-phase slide: `mRShift` (fallback `{o:100, p:-100, vs:193}`, `:3529`) vs. the search-phase `mShift` (`{o:123, p:-123, vs:193}`, `:3520`) — real, distinct numbers, not the same motion reused. `GameHub.tsx`'s current `barSlideActive` (`:615`) is `matchForming || searching` only — there's no post-match "converged" phase at all yet. This needs new plumbing: a second bar-slide state (probably `matchBarSlide`'s measured-mode logic re-run against a "result" phase trigger) that only fires for Mines, not Dice (`!isDice` in the gate) — Dice's own result stays put and just recolors its number in-bar (`diceMyNumColor`/`diceOppNumColor`, `:3678-3679`), it never converges.

**(b) The win/lose/draw frame ring — this part IS just wiring the existing, Coinflip-proven mechanism.** `playerBarRing` (`:3787`: inset 2px green/red/orange for win/draw/lose) + the win-fill/"you won" flash (`winFillAnim`/`winTextAnim`, `:3788-3789`) map exactly to `GameHub.tsx`'s `ownBarResult`/`ownBarVerdict` (`:691-704`), already proven on Coinflip. **Fix: add `suppressResultOverlay` + `ownBarResult` to `MinesHubScreen`'s `<GameHub>` call**, same reference pattern as `CoinflipHub.tsx`. One correction to Owner's own description worth flagging precisely: the prototype's ring is **own-bar only** — `oppBarRing: 'none'` unconditionally (`:3786`), the opponent's pill never gets a colored frame, only the player's own does (matches what Owner described — "frames my pill" — just confirming there's no symmetric opponent-side ring to also build).

**(c) Gem-count text above/below the pills — new content, no generic slot for it exists yet.** `oppGemText`/`myGemText` (`:467`/`:690`) sit **outside** the bar's own box — `bottom: calc(100% + 6px)` for the opponent (text sits above their pill) and `top: calc(100% + 6px)` for the player (text sits below their own pill) — gated by `oppGemTextOp`/`myGemTextOp` (`mReveal`/`mGrown`-driven, `:3780/:3782`) and always colored `var(--rc-green)` (`:3779/:3781`) — **one correction to Owner's description here too: the gem-count text is always green, win or lose; the outcome color-coding lives entirely on the bar's frame ring (part b), not on this text.** `renderSlotAside` (used for Chess's clock) renders content *inside* the bar row, not positioned absolutely above/below it — this needs either a new prop or an extension of the existing slot API to place content outside the bar box.

**Net scoping call: (b) is a same-night wire-up, matching Coinflip's own pattern exactly. (a) and (c) are real new features** — new `GameHub` plumbing for a post-match bar-converge state, and a new content-slot API for above/below-bar text — closer in size to #546's original bar-slide work than to a copy-paste fix. Recommend shipping (b) + item 1 + item 2 together first (all cheap, all real, no new plumbing), and scoping (a)+(c) as their own follow-up ticket once agreed — rather than blocking the easy wins on the bigger build.

**Not in Owner's ask, flagging only for completeness:** the prototype also shows gem icons growing *inside* the player's own pill live during play (`minesGems`/`playGemStripOp`, the sc-for list around `:672`) — distinct from the post-match summary text in (c). Owner's description ("fills them with relevant number of gems") matches the post-match TEXT badge, not this in-play icon row. Not recommending scope creep into this unless Owner specifically wants it — noting it exists in case it comes up later.

---

**Ask:** items 1+2 are cheap, ship together (matches items already fixed on RPS in #551, same code shapes). Item 3(b) (the frame ring) can ride along in the same PR — it's just adding two props. Item 3(a)+(c) (bar convergence + gem badges) need their own ticket — real feature work, not a same-night fix.

---

### 2026-09-12#1 — 4 more RPS gaps from Owner's latest live pass — item 3 is a real correction to #547            [READY TO TICKET — item 3 first, it's the most important]
From: Advisor   Re: your 4 questions on Owner's rapidclash-00102-km6 pass

All four confirmed against the real `prototype's `renderVals()` computed-value logic (not just markup), which is where the answers actually live for all four of these — cheap surface reads would have missed every one. One process note: I caught myself mid-investigation reading `RpsHub.tsx` on a stale local branch that predated #546/#547/#548 and almost drew wrong conclusions from it (specifically, almost reported `ownBarResult`/`suppressResultOverlay` as never wired, which is false on real `main`) — caught it via `git log` before writing anything down, same standing lesson as earlier tonight.

---

## 3 FIRST — `ownBarResult` (#547) is the wrong mechanism for RPS. Real correction, not new information the earlier review missed.

**The prototype's `renderVals()` proves this precisely.** The bar-level win-fill/"you won" text mechanism (`winFillAnim`/`winTextAnim`/`playerBarRing`) is driven by `mOutcome`, and `mOutcome`'s own definition gates it entirely on `gameV`:
```
const gameV = view === 'mines' || isDice;              // :3519
const mResult = gameV && mr != null;                    // :3522
const mOutcome = (mResult && (mr === 'final' || mr === 'closed')) ? (myG > oppG ? 'win' : ...) : null;  // :3528
```
**`gameV` is `mines`/`dice` only — `view === 'rps'` is never included.** `mOutcome` is `null` for every RPS state, unconditionally. This isn't an edge case or something that might not apply — the prototype's own source structurally cannot produce a bar-level win-fill for RPS. `ownBarResult` (`RpsHub.tsx`, wired in #547 mirroring `CoinflipHub.tsx:339-341`'s reference pattern) borrows a mechanism that, per the prototype's own logic, is exclusive to Mines/Dice.

**RPS's actual, already-implemented win indication is the card frame color, confirmed correct since T6b (#509), untouched by any of this:**
```
rpsOut = rpsPhase === 'done' ? this.rpsOutcome() : null;                                    // :3532
rpsLeftFrame:  rpsOut==='win' ? '#34D399' : rpsOut==='lose' ? '#F04438' : rpsOut==='draw' ? '#F79009' : '#FFFFFF';  // :3810
rpsRightFrame: rpsOut === 'draw' ? '#F79009' : '#FFFFFF';                                     // :3811
```
The player's own card frame turns green/red/orange; the opponent's card frame **only ever turns orange on a draw, never green or red** (matches what the PM independently confirmed against this exact line while reviewing T6b, 2026-09-11#1). This, combined with the card **enlarging** at the same moment (item 2 below, `rpsExpanded()`), is the complete, real win-indication moment in the prototype — a bigger, differently-colored card. There is no bar treatment layered on top of it, ever, for RPS.

**Fix:** remove `ownBarResult` from `RpsHub.tsx`'s `<GameHub>` call. Keep `suppressResultOverlay` — that part's still correct, the in-place reveal itself was the right call, just not paired with the bar mechanism. `FRAME_WIN`/`FRAME_LOSE`/`FRAME_DRAW` and the `myFrame`/`oppFrame` logic already in the codebase (pre-#547, from T6b) need no changes — they're already correct.

**Please add a code comment at the `ownBarResult` removal site citing this exact `gameV` gate** (`Full Spec.html:3519`) so nobody re-adds it later assuming RPS should match Coinflip's pattern — it structurally doesn't, per the prototype's own source, not by omission.

---

## 1 — Real z-index bug (confirmed via CSS stacking rules against the actual DOM), plus a missing dim treatment

**Z-index:** `GameHub.tsx`'s `OpponentSlot`/`OwnSlot` (`:911`, `:959`) apply `barShiftY` as a plain `style={{ transform: ... }}` (no `z-index` anywhere in either component). A `transform` creates a stacking context but defaults to `z-index: auto` — meaning paint order among such siblings still follows DOM order. In the arena JSX (`:722-733`), `OpponentSlot` is mounted BEFORE `renderGameArea(areaArgs)` (the RPS card block) — so when the slide-to-center motion moves `OpponentSlot` down to overlap the RPS card visually, the card (later in DOM, same auto-z stacking level) paints on top of it. **This exactly matches Owner's observation.**

The prototype avoids this by giving its bars an explicit stacking order: `data-rc-oppbar`/`data-rc-playerbar` are `position:relative; z-index:3` (`Full Spec.html:436`, `:660`) — explicitly above both the VS label (`z-index:2`, `:432`) and the un-indexed card block. **Fix:** give `OpponentSlot`/`OwnSlot` an explicit `z-[3]` (or equivalent) whenever `barShiftY != null`, matching the prototype's own value exactly.

**Table dimming — genuinely missing, confirmed absent, not just under-implemented:** the prototype fades the RPS card block to 28% opacity during the slide (`rpsBoardOp: rpsMatching ? 0.28 : 1`, `Full Spec.html:3795`) — this is precisely why the sliding bars stand out against it; there's no separate treatment on the bars themselves, the "table" recedes instead. Grepped the current codebase for any equivalent — only a stale comment references `rpsBoardOp` (`RpsHub.tsx:193`), no real implementation exists. **Fix:** apply `opacity: 0.28` (transitioned) to RPS's card wrapper while `barSlideActive` is true (the flag already exists, `GameHub.tsx:584`).

---

## 2 — Card enlargement at reveal is real and precisely quantified, confirmed missing entirely

`rpsExpanded()` (`Full Spec.html:3263-3265`, true during phases `reveal`/`flip`/`done`) drives real, hardcoded transitions, not a metaphorical "bigger":
| | small (default) | big (`rpsExpanded()`) |
|---|---|---|
| card width (`rpsCardW`) | 92px | **124px** |
| card height (`rpsCardH`) | 130px | **176px** |
| gap between cards (`rpsGap`) | 36px | **12px** |
| VS column width (`rpsVsW`) | 56px | **38px** |
| picker area height (`rpsChoicesH`) | 180px | **0px** (collapses) |
| picker area opacity (`rpsChoicesOp`) | 0.7–1 | **0** |
| icon scale inside the picked card | 1 | **1.6** |

(all from `Full Spec.html:3804-3814`, `:3252` for the icon scale — `rpsChoice()`'s `scale: on ? (big ? 1.6 : 1) : 0.4`)

**Current app hardcodes the small values as fixed constants, no expanded state exists at all:** `CARD_W = 92`, `CARD_H = 130`, `CARD_GAP = 36` (`RpsHub.tsx:29/31/33`), and the picker area only ever gets `opacity-70` + `disabled` at terminal (`:459`, `:469`) — it stays fully laid out and visible, never collapsing. **Fix:** derive `CARD_W`/`CARD_H`/`rpsGap`/`rpsVsW` from `terminal` (already computed, `:299`) the same way the prototype derives them from `rpsExpanded()`, animate via the existing transition durations (620ms cubic-bezier, cited above alongside each value), and replace the picker's `opacity-70`+`disabled` treatment with a genuine height-collapse + fade-to-0 (`max-height` + `opacity`, matching `rpsChoicesH`/`rpsChoicesOp` exactly) once `terminal` is true.

---

## 4 — Three text strings, three different verdicts, confirmed individually against the prototype's actual source

- **"Waiting for an opponent…" (`RpsHub.tsx:239`, RpsIdle's own paragraph) — genuinely extraneous, real duplicate, safe to remove.** Grepped the entire prototype: it has exactly ONE "waiting" text anywhere for this state — the opponent bar's own "Searching..." span (`Full Spec.html:462`, gated by `rpsSearchOp`). The current app shows THREE things simultaneously during search: the bar's own "Searching…" (already correct, matches), `GameHub.tsx`'s shared PLAY-button label ("Waiting for an opponent · m:ss", `:766` — shared plumbing every game uses, keep it), AND this RpsIdle-specific extra paragraph (`:239`), which is the genuinely redundant one — the prototype never has this third copy. **Remove `RpsHub.tsx:239`'s paragraph specifically; leave `GameHub.tsx`'s shared countdown label alone.**
- **"Picked {choice} — tap another to change, or wait for the timer" (`RpsHub.tsx:487`) — has zero prototype equivalent, confirmed via grep (no "Picked" anywhere in `Full Spec.html`).** This is real, useful UX copy explaining a mechanic (freely-changeable pick until the window closes) the prototype's own mock never had to explain because it's a static, non-interactive demo. Recommend keeping it — it's not decorative, it prevents real player confusion about whether tapping again does anything — but flagging since it's a genuine addition beyond the prototype's own text, not hidden functionality Owner might want removed on sight. Your/Owner's call given the "visual fidelity first" stance, but this one crosses into "explains real interactive behavior a static mock never needed to."
- **"Forfeit" (visible button, `RpsHub.tsx:492-493`) — a real, more nuanced case, don't just delete it.** The prototype's own `renderVals()` DOES compute a forfeit handler (`rpsForfeit: () => {...}`, `Full Spec.html:3821`) — but grepped every other line in the file, and it's never bound to any visible element (`onClick="{{ rpsForfeit }}"` appears nowhere). So the underlying capability exists in the prototype's own dead code (same category as `DEFAULT_BOMBS` and the other stale-array precedents this tracker already documents), but there's no visible "Forfeit" button anywhere in the actual rendered UI. **This needs an explicit Owner call, not a silent removal:** forfeiting is a real safety-valve (a player stuck in a bad match can leave rather than being forced to keep tapping) — removing the visible affordance without also confirming there's still SOME way to functionally forfeit would be removing real capability, not just a cosmetic mismatch. Options: (a) keep the button but restyle it to something less prominent, matching the prototype's evident intent of not surfacing it as a first-class action; (b) remove it entirely and rely on inaction (auto-throw at window expiry, already the existing behavior) as the de facto "give up" path. Flagging both, not picking one.

---

**Ask:** item 3 first (it's undoing something already shipped, highest priority to get right before more work builds on the wrong mechanism). Items 1 and 2 are independent of each other and of item 3, can go in any order or combine into one PR (both touch `RpsHub.tsx` + `GameHub.tsx`'s shared arena). Item 4's three strings need three separate calls, not one blanket "remove all UI text Owner didn't recognize" — one's a clean removal, one's a keep-with-flag, one needs an actual Owner decision before any code changes.

### 2026-09-11#10 — Owner's live post-deploy pass: two more real gaps, both traced to root cause            [READY TO TICKET — item 2 is lower-risk than it sounds, see below]
From: Advisor   Re: your two questions from Owner's live anonymous-browser test

Both confirmed real, both traced to exact prototype source and exact current-code gaps. Good instinct asking before dispatching — the second one in particular reads as "build new UI" from the description but is actually "wire into UI that already exists and already works elsewhere in this codebase," which changes the right approach.

---

## 1 — Bar slide-to-center-and-back IS shared across RPS/Mines/Dice, and it's missing from all three, not just RPS

**Confirmed:** `Full Spec.html:3753-3754` — `rpsOppBarY`/`rpsPlayerBarY`, the `translateY` values applied to the opponent/player bars (`:436`, `:660`). Their derivation (`:3517-3530`) is explicitly shared: `rpsMatching = (view === 'rps' || view === 'mines' || view === 'dice') && (rpsMatch === 'searching' || rpsMatch === 'found')`. While `rpsMatching` is true, the bars translate toward the vertical center (where the VS label lives); once the phase moves past `found` (into `split`/`run`), they translate back to `0px`. This is exactly the motion Owner described — slide to center, hold, slide back — and it's real, present in the prototype source, for all three games sharing this phase machine.

**One implementation detail worth flagging precisely, not glossed over:** the *magnitude* isn't the same fixed number for all three. RPS's fallback is a flat `123px`/`-123px` (`:3754`, the `!gameV` branch). Mines/Dice instead use `mShift`/`minesShift` — a value computed live via `getBoundingClientRect()` on the actual rendered bars at match start (confirmed in `startDice()`, which measures `[data-rc-gamewrap]`/`[data-rc-oppbar]`/`[data-rc-playerbar]` and derives the shift from real element positions, not a hardcoded constant). **Don't hardcode ±123px for Mines/Dice too** — that number is RPS's fallback for when a live measurement isn't available, not the prototype's real Mines/Dice value.

**This should be scoped like T5** — a `GameHub.tsx`-level addition (or a shared hook alongside the existing `matchForming`/VS-label machinery), not an RPS-only ticket, since the prototype treats it as one shared mechanism across three games. T5 evidently only ported the VS-label fade-in and missed this bar-slide motion entirely — worth a quick look at whether T5's original ticket ever mentioned it (it wasn't in my original T5 scoping, so likely an honest miss, not a deliberate cut).

---

## 2 — The reveal genuinely is in-place in the prototype, AND this codebase already has the exact mechanism for it — RPS just never adopted it

**Confirmed: the prototype has NO separate full-screen result modal anywhere for these games.** Grepped for one — doesn't exist. Win/lose communication is entirely in-place: a green fill + "you won" text (`:662-663`) that fades in on the player's OWN bar only (`data-rc-playerbar`, opponent bar gets no equivalent — confirmed by reading both bar blocks side by side), plus the opponent's reveal card 3D-flipping in place, same DOM node throughout, never remounted.

**The important discovery:** this exact pattern — bar-level win-fill + "You Win" text alongside the username, opt-in, no popup — already exists in `GameHub.tsx` today, byte-for-byte matching the prototype's own mechanism, and is already used by Coinflip/Chess/Blackjack:
- `suppressResultOverlay` (`GameHub.tsx:248`, doc comment just above) — "the hub never renders the ResultOverlay; it instead holds the result phase open with the board mounted... so the game presents the result on the board itself." This is precisely "no separate window."
- `ownBarResult` (`:260`, doc comment just above) — "bar-level result coloring on the own slot (Coinflip-style)... a transient green fill + 'You Win' alongside the username... eases out into that green outline." This is precisely the prototype's `winFillAnim`/`winTextAnim`.
- `CoinflipHub.tsx:339-341` wires all three (`suppressResultOverlay`, `holdResultMs={HOLD_RESULT_MS}`, `ownBarResult`) together — the working reference implementation.
- **`RpsHub.tsx` currently wires NEITHER** (`:476-477` — only `renderGameArea`/`renderResultReveal`, the default-overlay path). RPS was simply never migrated onto the pattern the codebase already built and proved out for Coinflip.

**Practical effect on scope:** this is not new plumbing to invent — it's adopting an existing, working, already-tested mechanism. The remaining work is moving `RpsReveal`'s existing flip-card component (`RpsRevealFlipCard`, already built, already citing the prototype's exact 820ms flip timing) from being mounted only inside the ResultOverlay into being part of `RpsBoard`'s persistent render — gated on the terminal outcome, which `areaArgs.outcome` already carries into `renderGameArea` today, no new data plumbing needed there either.

**Distinct from, and additive to, Gap C's existing ticket (2026-09-11#8/C) — don't conflate them:** Gap C is about *what* renders in the unrevealed state (the solid `#4F4CEA` blue-bolt card instead of the 🤫 emoji placeholder) — still fully correct and necessary on its own. This item is about *where/how* the transition into the revealed state happens (in-place vs. a separate overlay) — orthogonal, both need to land for full fidelity, but they can ship as one PR or two, coder's call.

---

**Ask:** item 1 — scope as a `GameHub.tsx`/shared addition covering RPS+Mines+Dice together (matches the prototype's own shared mechanism), not RPS-only. Item 2 — RPS-specific, follow `CoinflipHub.tsx`'s exact prop wiring as the reference implementation; lower risk than the initial description suggested since nothing new needs to be built, only wired up and the existing reveal card relocated. Neither is urgent tonight per Owner's own framing — whenever convenient.

### 2026-09-11#9 — RPS: Owner-directed reversal — restore the prototype's opponent-search theater and per-round reveal, deliberately reintroducing a known info-leak            [READY TO TICKET — read the rationale before touching this]

From: Advisor   Re: 2026-09-11#8's behavioral-difference follow-up; Owner's explicit call on visual-fidelity-over-correctness at this stage

**Read this framing before dispatching — it changes how the diff should be reviewed, not just what changes.** Owner compared RPS's actual match flow (not just the idle screen) against the prototype and found two behavioral differences from what the app currently does *on purpose*, for real, previously-good reasons. Owner's explicit direction: **at this stage, visual/experiential fidelity to the Designer's vision outweighs correctness** — the near-term goal is persuading investors the team can execute a compelling vision (this demo is never going to be the production build; delivery constraints belong to a future platform). Where matching the prototype exactly would require accepting a real gap the current code was deliberately built to avoid, **accept the gap and document it in a code comment explaining why**, rather than silently preserving the safer-but-less-satisfying current behavior.

This is a genuine, deliberate reversal of a design decision made earlier tonight — not new information the original decision missed. Treat the PR that implements this as reintroducing a known, accepted risk, not as "fixing a bug."

---

## 1 — Restore the ~3.8s opponent-search sequence for RPS

**Current, deliberate behavior (T5, tonight):** RPS passes `searchFloorMs={0}` to `GameHub`, so `matchForming`'s VS-label beat structurally never arms — the picker appears the instant a match forms. This was a real, reasoned trade-off (RPS's whole round is a short, fixed pick window; burning ~4s of it on search theater was judged not worth it).

**Owner's direction: reverse this for RPS specifically.** Restore something matching the prototype's own timing, cited exactly (`startRps()`, `Full Spec.html:3291-3313`):
- **t=0 → ~2.4s ("searching")**: opponent name field cycles through random names every 70ms (a slot-machine scramble). Prototype pool: `RPS_NAMES`.
- **~2.4s → ~3.16s ("found")**: name settles on a real pick, holds still.
- **~3.16s → ~3.8s ("split")**: transition beat (this is the same `rpsMatch === 'split'` moment T5's shared VS-label keys off — the two are related but this ticket is specifically about RPS's own dwell floor being restored, not re-touching the shared `GameHub.tsx` VS-label mechanism itself).
- **~3.8s**: picker becomes active.

**Mechanism:** give RPS a non-zero `searchFloorMs` (matching this ~3.8s total, or close — exact number isn't sacred, matching the *feel* is the point) instead of `0`. Confirm with whoever picks this up whether restoring the floor alone reproduces the full sequence or whether some of the name-cycling visual needs its own client-side treatment beyond what the floor mechanism already drives for other games.

**Related open question, not decided here: does this apply to Coinflip too?** Coinflip shares the exact same `searchFloorMs={0}` exception from the same T5 PR, same reasoning. Owner's comparison was RPS-only tonight. Flag to Owner whether Coinflip should get the same reversal for consistency, or stay as-is — don't silently extend this ticket's scope to Coinflip without asking, and don't silently leave it inconsistent either.

---

## 2 — Reveal the opponent's actual throw on every round, including ties — a real, deliberate redaction rollback

**Current, deliberate behavior:** `packages/games/rps/src/rps.ts`'s `viewFor` (`:216-225`) redacts the opponent's choice on every non-terminal state — and a tie is explicitly non-terminal (`resolve()`, `:100-116`: "Tie → not terminal: replay"). Worse for this purpose: `resolve()`'s tie branch clears `s.choices = {}` (`:114`) as part of dealing the next round, so the tied throw isn't just hidden, it's **gone from state entirely** by the time any client could read it — this was built so a player could never retroactively see a past round's throw and pattern-read the opponent's future picks.

**Prototype's actual behavior** (`Full Spec.html:3084-3099`): the opponent's card flips to reveal their real throw on **every** round — win, lose, or tie — via `rpsPhase: 'flip'`. Only on a tie does it then hold the revealed cards for 1.5s before auto-dealing a fresh round. The player always sees what was thrown.

**Owner's direction: implement the prototype's version, accepting the information a player gains round-to-round as an intentional, documented risk** — this is exactly the "produce the leaky code, comment why" case from the framing above.

**Why this needs a protocol change, not a redaction-flag flip:** because `s.choices` is wiped before the next `viewFor` call, there's no state left to stop redacting — a tie's throws only exist in memory for the instant `resolve()` runs. The fix has to capture them into the event itself, before they're cleared:

- `resolve()`'s tie branch (`:100-116`) currently emits `{ type: 'new_round', payload: { round, replays } }` with no choice data. Add the two throws to this payload — capture `{ ...s.choices }` **before** the `s.choices = {}` reset two lines later (`:114`), e.g. `payload: { round: s.round, replays: s.replays, revealedChoices: { ...beforeReset } }`.
- Per `GAME_MODULE_INTERFACE.md`'s "nothing secret in an event" rule, an event that includes a field is broadcast unredacted to both players by design — this is the intentional exception, so **the code needs a comment at this exact spot** stating plainly why: something to the effect of *"Deliberately reveals both throws to both players on a tied round — a real info-leak a strategic player could exploit round-to-round. Owner-approved 2026-09-11: this is an investor-demo build, not the production implementation: visual/experiential fidelity to the Designer's prototype outweighs this correctness concern at this stage. Do not treat this as an oversight; do not silently "fix" it back to redacted without Owner sign-off."*
- Client side (`RpsHub.tsx`): `RpsBoard`'s opponent card currently only ever shows the redacted 🤫 tile pre-terminal (`:198-201`'s own doc comment: "the opponent's card stays the redacted 🤫 tile for the whole window"). Wire it to consume the new `revealedChoices` field on a `new_round` event: flip to the real throw (reuse `RpsRevealFlipCard`'s existing 820ms flip, already citing the prototype's own timing exactly), hold ~1.5s (matching the prototype's hold), then reset to the redacted tile as the new round's window opens.

**Scope:** `packages/games/rps/src/rps.ts` (the event payload + its test coverage — existing redaction tests will need updating to assert the choices ARE present on `new_round`, a real, deliberate flip of an existing assertion, not a broken test to "fix") + `RpsHub.tsx` (`RpsBoard`'s tie-handling). Mechanic (win/lose/tie rules, the pick-window model) is completely unchanged — this is redaction-policy and visual-timing only.

---

**Ask:** two tickets (search-theater timing is independent of the reveal-on-tie change, can ship separately or together, coder's call). Both are Owner-directed reversals of decisions made earlier tonight — cite this mailbox entry in both PRs so a future reviewer doesn't mistake either for a regression. The code-comment requirement in item 2 is not optional — this is exactly the kind of change that looks like a bug to anyone who doesn't already have this context.

### 2026-09-11#8 — Owner's manual side-by-side found 3 real gap clusters, two of them platform-wide            [READY TO TICKET — all three]
From: Advisor   Re: Owner directly comparing the live RPS screen against the prototype, screen-by-screen

Owner did a manual visual pass on RPS specifically and found 9 concrete discrepancies. Verified every one against current `main` (not stale production) before writing this — all 9 are real and still present. Two of the three root causes turned out to be **shared components used by all 12 games**, not RPS-specific, so this is a higher-leverage find than it first looked.

---

## A — `GameHub.tsx`'s bet/play panel is missing several real prototype elements (affects all 12 games)

Confirmed against `Full Spec.html:695-745` (the bet-panel block) vs. `GameHub.tsx`'s current `hub-section-bet`/`hub-play`/`hub-play-friend`:

1. **Missing the currency-name + live-bet-value row** entirely. Prototype (`:703-709`): a row above the bet track showing the currency icon + `{{curSym}} (democash)` on the left, and a second icon + the currently-armed stake in green `${{betValue}}` on the right. `GameHub.tsx` has no equivalent — today's "BET AMOUNT" label is the closest thing, and it's just a plain caption, not this two-sided row.
2. **Bet-amount presets should be one shared pill/ribbon with a sliding indicator, not 6 individually-boxed buttons.** Prototype (`:709-719`): one `border-radius:999px` track (`betTrackBg`, light `#D7D7E2`/dark `#12121A`) containing a `position:absolute` purple pill (`betIndLeft`) that slides to the selected value (`transition:left 420ms cubic-bezier(...)`), with plain green (`c.color`) text values sitting on top of it — no per-button border/background. Current `GameHub.tsx` renders each preset as its own separately-styled `<button className="rounded-lg ... bg-background">` — a materially different, boxier look.
3. **Both `PLAY` and `Play a Friend` are missing the prototype's drop-shadow.** Prototype: `playBtnShadow: '0 5px 0 #5F27B8'` (a flat 5px darker-purple ledge beneath the button, the chunky "pressable" look), released on press via `style-active="transform:translateY(3px)"`. Current `hub-play`/`hub-play-friend` buttons in `GameHub.tsx` (lines ~932-951, ~1062-1073) are flat `bg-brand` pills with zero shadow.
4. **"PROVABLY FAIR BY DESIGN" + shield-check icon is completely missing.** Prototype (`:729-745`): sits directly below "Play a Friend," a small badge (11px bold caption + an SVG shield-with-checkmark icon, colors `provablyFg` light `#0B0B0B`/dark `#FFFFFF`). Confirmed via grep: this string does not exist anywhere in `apps/web/src`.

**Scope:** all four live in `GameHub.tsx`'s shared bet/play section — one PR fixes this for every game at once, not a per-game ticket.

---

## B — `GamesCarousel.tsx`'s "OPEN GAMES" / live ticker has a real bug + a currency-skin gap (affects all 12 game hubs + HomeHub + ProfileHub)

Confirmed by reading the component directly, not inferring from the screenshot:

1. **Real bug: usernames render with a doubled "@@".** `GamesCarousel.tsx:275` builds the row as `` `@${row.c.ownerName}` `` — but bot-crowd's own usernames already embed an "@" by construction (`BOT_PREFIX = '🤖'`, names built as `` `${BOT_PREFIX}@sweeper` `` → the stored name is literally `"🤖@sweeper"`). Prepending another "@" produces `"@🤖@sweeper"` — the doubled "@@" Owner saw. **Fix is NOT a blind reuse of `ProfileHub.tsx`'s existing `normalizeOpponentName`** (`:190-196`) — that helper strips the 🤖 prefix too, and its own doc comment explains why that's fine *there* but not here: "ADR-010's informed-consent labeling targets the lobby/open-challenges feed" — i.e. this exact feed is required to keep showing the bot disclosure. The correct fix here is narrower: strip only a leading `@` before prepending one, keep the 🤖 emoji intact — `` `@${row.c.ownerName.replace(/^@/, '')}` ``.
2. **Still shows the old `RcIcon` (green coin) instead of the `$` skin.** Three separate spots in `GamesCarousel.tsx` — `:567`, `:616`, `:625` (grep for `RcIcon size={15}` to catch all three; this component appears to render more than one carousel variant) — none touched by T9 (T9 only updated `GameHub.tsx`'s bet-preset buttons). Same fix shape as T9, applied to all three.
3. **No VIP-tier/level badge next to the username at all** — confirmed by reading the full row JSX (`:551-575`): a tile-art thumbnail, game name, host name, stake, JOIN button — no tier icon anywhere in the markup. This isn't a partially-implemented badge, it's not implemented. Real net-new small addition if wanted (reuse `tierForXp`, same as the chat ticket did), not a bug fix — flagging as a separate, lower-priority line item within this ticket rather than blocking the other two fixes on it.

**Scope:** `GamesCarousel.tsx`, shared by `GameHub.tsx` + `HomeHub.tsx` + `DiceHub.tsx` + `ProfileHub.tsx` (confirmed via grep) — one PR, wide reach.

---

## C — RPS-specific: placeholder emoji were never swapped for the real vector art

`RpsHub.tsx:9-12` (`RPS_CHOICES`) uses plain Unicode emoji (✊/✋/✌️) for the picker, and the opponent's redacted-state icon is the 🤫 emoji (`:343+`) — both stand-ins for the prototype's actual bespoke flat-vector purple hand illustrations (`Full Spec.html:611-613`, `:646-653`) and its solid-blue-fill-with-a-bolt-icon reveal card (`background:#4F4CEA`, exact citation `Full Spec.html:628`). This reads as a fidelity shortcut taken during T6b's original build, not a functional bug — the mechanic is unaffected, only the art.

Also confirmed: the idle-state copy "Choose a bet and press PLAY, or JOIN an open challenge" (`RpsHub.tsx`'s `RpsIdle`) has no equivalent in the prototype's own idle state at all — the prototype's vertical space there is empty/compact instead. Minor, but easy to fix alongside the icon swap.

**Scope:** `RpsHub.tsx` only.

---

**Ask:** three tickets, A and B are the higher-leverage ones (platform-wide, not per-game) — worth prioritizing over C. All three are visual/asset-level, no engine/mechanic risk, straightforward citations, no open decisions needed from you or the Owner this time.

### 2026-09-11#7 — Chat, split into two tickets per your decisions            [READY TO TICKET — (a) needs T7-level care]
From: Advisor   Re: your two decisions on 2026-09-11#6 (general-only room, boot-time env var kill switch)

Both decisions make sense and I agree with your reasoning on neither needing Owner escalation. Tickets below build on them directly — `general`-only room (no room parameter needed in the wire protocol for V1), kill switch as a plain boot-time env var enforced server-side.

---

## (a) Server: `ChatTransport` + new WS message types — the new surface, treat with care

**Data model — `packages/core/src/chat-transport.ts` (new), same shape convention as `EphemeralLedger extends Ledger` (`packages/core/src/ephemeral-ledger.ts`):**

```ts
export interface ChatMessage {
  id: string;           // randomUUID(), for React keys / future de-dup
  name: string;          // resolveUsername(senderId) at send time — the server attaches this,
                          // the client NEVER supplies its own name (prevents spoofing)
  tier: VipTier;          // tierForXp(...).tier at send time — server-computed, see below
  text: string;           // sent verbatim; @mention parsing into pills is a CLIENT rendering
                          // concern only (see ticket (b)) — server relays plain text, does not
                          // parse or validate mentions
  createdAt: number;      // Date.now() at send time
}

export interface ChatTransport {
  send(senderId: string, text: string): ChatMessage;   // validates + stores + returns the entry
  history(): ChatMessage[];                              // bounded backlog for a newly-subscribing client
}
```

- **One global instance, no per-room keying** (per your room-scope decision) — simpler than `EphemeralLedger`'s per-`accountId` map, since there's only ever one logical chat here for V1.
- **Bounded history, not unbounded** — cap at a fixed count (e.g. 50; pick a number and document it, exact value isn't load-bearing) so memory doesn't grow unboundedly over a long-running demo. Oldest entries drop off the front once the cap is hit. Mirrors the spirit of the prototype's own small seeded backlog (`CHAT_SEED`, 4 entries) without literally copying that number.
- **Sender identity is resolved SERVER-SIDE from the authenticated connection's playerId, never trusted from the client payload** — reuse `resolveUsername` (`apps/server/src/ws/gateway.ts:150`, already the single correct way to resolve any id: guest/bot first, then the real identity layer) and `tierForXp` (`packages/core/src/rewards.ts:39`, already exported specifically "for the frontend ticket... and for tests" per its own doc comment — this is exactly that kind of consumer).
- **Real tier-mapping gap in the prototype, worth citing exactly rather than silently resolving:** the canonical VIP ladder (this doc's own § "Canonical Rewards VIP ladder") has 6 ranked tiers — Wood/Bronze/Silver/Gold/Emerald/Diamond — plus Unranked below Wood. The prototype's own chat color ternary (`Full Spec.html:4134`, verbatim): `m.mod ? '#8B45F0' : m.tier === 'gold' ? '#F2C744' : m.tier === 'emerald' ? 'var(--rc-green)' : m.tier === 'diamond' ? '#5CD3F0' : 'var(--rc-text)'`. Only **Gold, Emerald, and Diamond** get real colors — **Wood, Bronze, Silver, and Unranked all fall through to the plain default text color.** This is a real fact about the prototype's own source, not something to "fix" — implement exactly this ternary (3 colored tiers, everything else plain), don't invent colors for the 3 tiers it left uncolored.
- **Server-checked kill switch, per your decision:** one new env var (e.g. `CHAT_ENABLED`, default depends on what's safer — recommend defaulting DISABLED unless explicitly turned on, so a forgotten env var fails closed, not open, on a fresh deploy), parsed once at boot exactly like `CHALLENGE_SWEEP_MS`/`FORFEIT_DELAY_MS`/`GUEST_BOT_TAKE_MIN_MS` already are (`gateway.ts:77,125,137,141` — same idiom, one more constant). Checked inside the `chat.send` handler (reject with a clear error code if disabled) — reading is unaffected either way, or gate that too, coder's call, but state which explicitly in the PR.

**WS wire protocol — `packages/shared/src/protocol.ts`, same naming/interface convention as `QueueJoinPayload`/`ChallengeSubscribePayload`/etc. (`:30,40,74,85,91,115,124,131`):**

```ts
export interface ChatSendPayload { text: string; }               // client → server
export interface ChatMessagePayload { message: ChatMessage; }     // server → client, broadcast
export interface ChatHistoryPayload { messages: ChatMessage[]; }  // server → client, on subscribe
```

`chat.subscribe` (client → server, no payload needed — there's only one room) triggers an immediate `chat.history` reply (so a freshly-opened chat sheet isn't empty), then adds the socket to a broadcast set. `chat.send` (client → server, `ChatSendPayload`) validates (non-empty, ≤160 chars — the prototype's own send-time limit, `Full Spec.html:3481`, distinct from the 400-char draft-typing cap which is a client-only UX detail, not a server rule), rejects if the kill switch is off or the sender isn't authenticated, then calls `ChatTransport.send` and broadcasts the result as `chat.message` to every subscribed socket.

**Server fan-out — follow `pushChallengesUpdate`'s exact existing pattern** (`gateway.ts:154-161`, a `Set<Socket>`/`Map` of subscribers + a loop checking `readyState === 1` before sending) — a `chatSubscribers: Set<WebSocket>` and a `pushChatMessage` function shaped identically. Don't invent a new fan-out mechanism; this one's already proven in this file for exactly this kind of "broadcast to everyone watching" need.

**No persistence, no moderation, no mention validation** — all explicitly out of scope per 2026-09-11#6, restated here so it isn't quietly added back in during implementation.

**Done when:** `chat.subscribe`/`chat.send`/`chat.message`/`chat.history` all wired through the gateway's existing message-handling switch; `ChatTransport` unit-tested in isolation (send validates length/auth, history respects the cap, tier/name resolution is correct) the same way `ephemeral-ledger.test.ts` tests `EphemeralLedger`; an integration test proves two connected sockets both receive a message sent by either one; kill-switch-off rejects sends with a clear error and doesn't crash the connection; full existing suite stays green (nothing here touches any existing message type).

**Ask:** treat this like T7 — one agent, not parallelized with anything else touching `apps/server/src/ws/gateway.ts` or `packages/shared/src/protocol.ts`, reviewed carefully given it's new server surface with real (if narrow) trust-boundary implications (never let the client supply its own name/tier).

---

## (b) Client: the chat sheet UI — standalone once (a)'s interface is agreed, can build against a mock

**Component: `apps/web/src/components/hub-chrome/ChatSheet.tsx`** (new) + a `useChat` hook (new, `hub-chrome/useChat.ts`) owning subscribe/send/message-list state — same "hook owns cross-cutting state, component renders it" split as `useMenuOverlay.ts`/`MenuOverlay.tsx`.

**Exact citations, `Full Spec.html`:**
- Sheet shell, scrim, slide transform: `:2360` (backdrop `z-index:6`, `rgba(0,0,0,0.55)`), `:2362` (sheet body `z-index:7`, `border-radius:34px 34px 0 0`, `box-shadow:0 18px 44px rgba(0,0,0,0.45)`), full-height top `60px` vs half-height top `52%` (`chatTop`, `:4059`), transform `translateY(118%)` closed → `translateY(0)` open (`chatY`, `:3981`) — 420ms cubic-bezier for the transform, 380ms for `top`, 260ms for opacity (`:2362`'s own `transition` value).
- Room-switcher pill + collapse chevron: `:2364-2380` (only render `general`'s row per the room-scope decision — the switcher chrome can stay in the markup for a future per-game room, or be dropped entirely for V1; your call, cite which in the PR).
- Half/full toggle icon + close button: `:2372-2378`.
- Message bubble: `:2400` (`background:linear-gradient(rgba(139,69,240,0.14), rgba(139,69,240,0.14)), var(--rc-island); border-radius:20px; padding:11px 14px`), name color per the tier mapping the server now attaches (`nameColor`, `:4134` — the exact 3-tier ternary is cited in full in ticket (a) above; the client just needs to reproduce it, not re-derive it).
- Composer — the transparent-textarea-over-styled-overlay trick, cite verbatim, this is the trickiest part to get right: `:2427` (the `aria-hidden` overlay div rendering styled text incl. @mention pills) sits behind `:2428` (the real `<textarea>`, `color:transparent`, `caret-color:var(--rc-text)`) — both must stay pixel-aligned (same font/line-height/padding) since the overlay is purely decorative and the real textarea is what's actually focused/typed into. @mention pill detection: `/(@[A-Za-z0-9_]+(?=\s))/` while typing (`:4074`, requires trailing whitespace to commit a mention) vs `/(@[A-Za-z0-9_]+)/` for rendering sent messages (`:4128`, no trailing-space requirement — a sent message's mentions are already complete). Two different regexes for two different moments — don't collapse them into one.
- Send: Enter key (`:4101`) or the send button (`:2430`). Draft cap 400 chars stored (`:4091`, `.slice(0, 400)`), over-limit visual ring at >160 chars (`chatOverRing`, `:4076-4077`) — this is a CLIENT-side warning distinct from the server's hard 160-char send limit in ticket (a); the UI should stop the user before they hit the server's rejection, not just show a ring and let the send fail.

**Wiring:** `useChat` calls `chat.subscribe` on mount (sheet first opened), holds the message list (seeded from the `chat.history` reply, appended to on each `chat.message` broadcast), exposes `send(text)` which validates client-side (empty/length) before emitting `chat.send`. `HubToolbar.tsx`'s existing `comingSoon` Chat nav item (`:97`) loses that flag and gets a real `onClick` wired to open the sheet — same shape as how `useMenuOverlay`'s `onMenu` plugs into `HubToolbar`'s Menu button today.

**Done when:** sheet opens/closes/half-toggles matching the cited transforms in both themes; sent messages appear for the sender and (once (a) is live) any other connected client; @mention pills render correctly in both the composer overlay and sent messages using the two distinct regexes; the char-limit UX matches the cited values; existing `HubToolbar.test.tsx`'s "Chat is comingSoon" assertion (if one exists — check) is updated to reflect it's now live.

---

**Sequencing, matching what you said:** (a) alone first, ≤2-agent cap respected by not running anything else against `gateway.ts`/`protocol.ts` at the same time. (b) once (a)'s message/payload shapes are stable — (b) can be built against a hand-rolled mock `ChatTransport`-shaped object in the meantime if you want to parallelize the UI work before (a) merges, but the wire-protocol interfaces above should be treated as the contract both sides build to, not re-derived independently.

### 2026-09-11#6 — Chat: full scope — this is the biggest item on the remaining roadmap, treat accordingly            [SCOPED — two real decisions needed, not ready to ticket as one PR]
From: Advisor   Re: tracker's "After shared-chrome: chat" line; the screen-inventory table's Chat row

**Sizing this honestly up front:** this is materially bigger than everything scoped tonight, including the currency picker. It's a real, new, server-touching feature (client UI + a server-side WS transport + a kill switch), not a reskin or a self-contained client component. Recommend NOT dispatching this as one PR — split per the "V1 scope" section below, and treat the server-side piece with T7-level care (new WS message types, a new server-side broadcast path — genuinely new surface, not editing an existing one).

The tracker's screen-inventory table (row: "Chat nav item") already had real prior scoping recorded — the underlying scratch doc it cites (`docs/COMMS/from-advisor/chat-local-transport.md`) no longer exists on disk (gitignored, written in an earlier session's worktree, never committed — same category as other from-advisor scratch this session has found gone). Rebuilt the reasoning from the prototype source directly rather than relying on the missing file.

## What's actually there — confirmed by reading the prototype's chat state machine directly

Full sheet UI, not a stub: a bottom sheet with **full-height and half-height modes** (`chatHalf`, toggle icon `Full Spec.html:2372`), a **room switcher** (`chatRoom`, defaulting to `'general'`; only two rooms are actually seeded — `'general'` and `'chess'`, `:4049-4052`, `:4127`), a **scrollable message list** with VIP-tier-colored names (`nameColor`, `:4133` — bronze/silver/gold/emerald/diamond, matching the tracker's own canonical VIP ladder tiers exactly, plus a purple `mod` badge color) and **@mention rendering** as pill tokens (`:4128-4129`), and a **send composer** with a genuinely clever technique worth citing precisely: the real `<textarea>` has `color:transparent` and sits directly on top of an `aria-hidden` overlay div rendering the same text with @mentions styled as pills (`:2427-2428`) — a "rich-text-look, plain-text-input" trick, not a rich text editor. Draft cap 400 chars, soft-limit ring warning at 160 (`:4075-4077`). Enter sends (`:4101`).

## Two real decisions, not mine to make, before this is ticket-ready

**1. Room/channel scope — the mock only proves `general` + `chess`, not a general mechanism.** Is this meant to be one global "General" room only (simplest, matches the default state, avoids inventing scope the mock doesn't show), or a room-per-active-game pattern (12 rooms, only "chess" happens to be the one example actually seeded in the mock)? The mock gives no evidence either way beyond the one example — this needs an explicit call, not an assumption. Recommend starting with `general` only for V1 and treating per-game rooms as a stretch/follow-up, but flagging rather than deciding since it changes the data model shape.

**2. What "server-checked kill switch" actually means — two readings, matters for how much new infra this needs.** The tracker's own phrasing ("not a client-bundled env var") is explicit about *not* wanting a build-time client flag a technical user could bypass by inspecting the bundle — that part's clear. What's not clear: does it need to be flippable **live, without a redeploy** (a genuinely new piece of infra — nothing in this codebase does that today; every existing `process.env.X` read in `gateway.ts`, e.g. `CHALLENGE_SWEEP_MS`, is parsed once at boot), or is "server-checked" satisfied by a plain env var read at boot and enforced on every relevant WS handler server-side (matches existing precedent exactly, zero new infra, just needs a restart to flip)? Recommend the second (matches precedent, ships faster) unless there's a specific "kill it mid-demo without restarting the server" requirement driving the "not client-bundled" wording — Owner's call if that requirement is real.

## Architecture, decided (not a decision point — this part follows existing precedent directly)

- **This has to be real, live, cross-player messaging, not fake/client-only** — the tracker explicitly worries about "a real collusion-channel risk in a PvP money game." That risk only exists if two actual paired opponents can exchange actual real-time messages. So "local-only" in the tracker's phrasing means **ephemeral (in-memory, not persisted to durable storage, gone on server restart)**, not "never leaves the browser." This is architecturally identical to the guest ledger's existing pattern.
- **Follow the `EphemeralLedger extends Ledger` precedent exactly** (`packages/core/src/ephemeral-ledger.ts`): define a plain `ChatTransport` interface (send/subscribe/room-history shape), one in-memory implementation backing it, gone on restart, one shared instance keyed by room (mirrors `EphemeralLedger`'s per-`accountId` keying). No new persistence layer, no database migration.
- **New WS message types, following `gateway.ts`'s existing `case 'namespace.verb':` convention** (`queue.join`, `move.make`, etc., `apps/server/src/ws/gateway.ts:672+`) — something like `chat.subscribe` / `chat.send`, broadcast to every connected client in that room. This is genuinely new server surface (a new fan-out broadcast path), not editing an existing handler — size it accordingly, don't underestimate it as "just another WS case."
- **VIP tier → name color**: reuse the canonical `VIP_TIERS`/`VIP_ROWS` data already in this doc (§ "Canonical Rewards VIP ladder") rather than inventing a second tier list — the prototype's bronze/silver/gold/emerald/diamond color mapping should map onto the same six tiers RewardsHub already renders.

## Explicitly deferred, not part of any V1 scope

Moderation, persistence, real identity verification for mentions (@name only needs to render as a pill, not resolve to a real user record), rate limiting beyond the existing WS connection-level protections. The tracker's own reasoning for keeping this pre-seed-scoped (avoiding moderation/GDPR load) stands — don't let a V1 ticket quietly grow to include any of this.

**Ask:** this needs your/Owner's call on the two decisions above before it's ticket-ready. Once decided, split into at minimum: (a) the `ChatTransport` + WS message types (server, new surface, extra care), (b) the client chat sheet UI (can build against a mocked transport in parallel once (a)'s interface is agreed, doesn't need to wait for (a) to merge). Given the size, this alone is probably a multi-PR body of work, not a single ticket like T5-T9.

### 2026-09-11#5 — Currency picker: component boundaries, file plan, one real open decision, full test plan            [READY TO TICKET — one decision needed first, see below]
From: Advisor   Re: your ask to go one level deeper on 2026-09-11#4's currency picker

Read the full picker source this time, not just the summary I gave last round — a few more details showed up (two toggle switches at the bottom I hadn't cited before: "Display in Fiat" and "Hide zero balances", both fully wired, not dead state). Citations below are exact.

## Component boundaries — decided, with reasoning

**One new self-contained component, no new props on `HubRibbon`.** Checked all 5 call sites of `<HubRibbon>` (HomeHub/ProfileHub/GameHub/AffiliateHub/RewardsHub) — none need to know about picker state, so it stays entirely internal to the chrome layer:

- **`apps/web/src/components/hub-chrome/CurrencyPicker.tsx`** (new) — owns `open`/`query`/`curSel`/`fiatOn`/`hideZero` state locally (`useState`, no shared hook needed — unlike Menu's `useMenuOverlay`, only one screen-position ever renders this, so there's nothing to share). Exports one component, rendered from inside `HubRibbon.tsx`.
- **`apps/web/src/components/hub-chrome/currencyData.ts`** (new) — the mock data as plain exported constants (`CUR_BAL`, `CUR_CRYPTO`, `CUR_NAME`, `OPEN_CURS`), literal copies of the prototype's own values (below) — not derived from the real `balance` prop, never will be, that's the Owner-approved design.
- **Currency SVG icons** — inline functions inside `CurrencyPicker.tsx`, one per coin, same placement convention `HubRibbon.tsx`'s own `UsdBadge()` already set (a hand-written inline SVG per symbol, not a spritesheet). Ported directly from the prototype's `<symbol id="cur-*">` defs, line ~104.
- **`HubRibbon.tsx` changes:** split the current single wallet-chip `<button>` into two adjacent buttons inside the same outer pill — confirmed via the prototype's own structure (`Full Spec.html:2233` `toggleCur` is scoped to only the currency-icon+balance div; the purple WALLET sub-pill at `:2237-2240` is a separate sibling element, untouched by `toggleCur`). So: left button (currency icon + balance) opens `CurrencyPicker`; right button (purple WALLET pill) keeps calling `onWallet`, completely unchanged. Wrap the pair in `position:relative` so the picker panel (`position:absolute; top:calc(100%+8px)`, prototype `:2247`) anchors correctly.
- **Not using shadcn's `popover.tsx`/`dropdown-menu.tsx`/`switch.tsx`** — confirmed via grep that none of the three are used anywhere else in the app (scaffolded, never adopted). The codebase's actual convention for this exact shape (a full-screen backdrop + a positioned panel, e.g. `HomeHub.tsx`'s `SortSheet`) is hand-rolled: a `fixed inset-0` backdrop div (click → close) + the panel absolutely positioned relative to its trigger. Following that same idiom keeps this consistent with the rest of the codebase rather than introducing an unused library for the first time.

## Exact citations for the panel content (`Full Spec.html:2242-2320`)

- **Search row** (`:2244-2248`): `curSearchBg` (light `#E7E7EE`/dark `#12121F`), placeholder "Search", filters case-insensitively by symbol OR full name (`CUR_NAME`, below) as a substring — not just symbol.
- **"Cash" section header + USD row** (`:2249-2258`): USD is always its own labeled group, never mixed into "Cryptocurrency".
- **"Cryptocurrency" section header + 7 rows** (`:2259-2300`), `OPEN_CURS = ['SOL','BTC','USDT','ETH','LTC','USDC','XRP']` (prototype line 2855) — note this is NOT alphabetical, it's the prototype's own literal order, keep it.
- **Row visibility logic** (`:3586-3592`, exact): a row shows if it matches the search query AND (it's the currently-selected currency OR "hide zero" is off OR its balance isn't exactly the string `'$0.00'`) — i.e. the selected currency is never hidden even if zero and hide-zero is on, and zero-balance filtering only applies to unselected rows.
- **Two footer toggle rows** (`:2309-2319`) — "Display in Fiat" and "Hide zero balances", each a hand-rolled 40×22px pill switch (not shadcn's `Switch`): on = `#8B45F0` track, off = light `#C9C9D6`/dark `#12121F`; a white 16px knob translating `0→18px`. One small shared `ToggleSwitch` sub-component for both, since they're pixel-identical apart from state.
- **Mock data, literal, port exactly** (`:3583-3584`, `CUR_BAL`/`CUR_CRYPTO`): `{USD:'$119.20', BTC:'$0.00', ETH:'$0.00', USDT:'$837', USDC:'$0.00', SOL:'$1,642', LTC:'$0.00', XRP:'$0.00'}` (fiat mode) / `{USD:'119.20', BTC:'0.00000000', ETH:'0.00000000', USDT:'837.0', USDC:'0.00000000', SOL:'10.6483', LTC:'0.00000000', XRP:'0.00000000'}` (crypto mode) — `CUR_NAME` for search: `{USD:'US Dollar', BTC:'Bitcoin', ETH:'Ethereum', USDT:'Tether', USDC:'USD Coin', SOL:'Solana', LTC:'Litecoin', XRP:'XRP Ripple'}`.
- **The trigger badge itself changes with selection** (`:2234`, `curSym`): picking a currency in the panel swaps BOTH the collapsed trigger's icon AND its displayed value to that currency's mock balance — it does not stay on the real integer balance once a non-default currency is picked. USD is a special case even within this: selecting it always shows `CUR_BAL.USD` regardless of the fiat/crypto toggle (a dollar has no separate "crypto" unit).

## One real decision I'm not making myself — needs your or the Owner's call before implementation starts

**The prototype's own default selected currency is SOL, not USD** (`const curSel = this.state.curSel || 'SOL'`, line 3579) — meaning out of the box, before a user ever opens the picker, the prototype's trigger shows a mock SOL balance (`$1,642`), NOT the real balance. Today's app (post-T9) always shows the real integer balance with a `$` format. Defaulting to SOL would mean the wallet chip **never shows the real balance by default** for a freshly-registered user — only after they explicitly pick USD in the picker. Two options, genuinely a product call, not an engineering one:
- **(a) Default `curSel` to `'USD'`** — trigger keeps showing the real balance out of the box (matches today's behavior exactly), the picker is purely additive; SOL/BTC/etc. only ever show once a user deliberately explores the picker.
- **(b) Default to `'SOL'`**, matching the prototype's literal source exactly — the investor-demo skin is "on" from first paint, at the cost of the real balance not being the first thing shown.
Recommend (a) for the reason above (least surprise, doesn't silently change what a signed-in user's balance chip shows today) — flagging (b) as the literal-fidelity option since "build from rendered markup" has been the standing rule all session. Your/Owner's call.

## Test plan

- Trigger renders the decided default currency's icon+balance; WALLET sub-pill unaffected, still calls `onWallet` directly (split didn't break it).
- Tapping the currency+balance side opens the panel; tapping the backdrop or picking any currency closes it.
- All 8 rows present in `OPEN_CURS` order (not alphabetical), correct icons, correct section headers (Cash vs Cryptocurrency).
- Search filters by symbol AND name, case-insensitive substring — verify a name-only match (e.g. "dollar" finding USD) works, not just symbol matches.
- Hide-zero-balances toggle hides `$0.00` rows EXCEPT the currently-selected one, even if it's also zero — this exact exception is easy to get wrong, worth its own test.
- Fiat/crypto toggle swaps every row's displayed value between `CUR_BAL`/`CUR_CRYPTO`; USD row stays on `CUR_BAL.USD` regardless of the toggle.
- Picking a currency updates the trigger's icon + value AND closes the panel in one action.
- **Invariant test, most important:** the real integer `balance` prop / actual credits ledger is never read, written, or altered by anything in this component regardless of picker state — this is cosmetic-only per Charter #4, and a test should assert nothing here ever touches real balance data.
- `isGuest` path completely unaffected — guest mode's "Demo" badge branch never renders `CurrencyPicker` at all (already true structurally, just confirm no regression).
- Both themes: track colors from `light: '#DEDEE8'`-style pairs correctly reference the theme's active mode.

### 2026-09-11#4 — Mines idle-state polish (small) + currency-picker dropdown (real feature, not small) — both scoped            [READY TO TICKET]
From: Advisor   Re: your post-deploy flag on the two deferred items

Congratulations on the deploy — good milestone, and good judgment holding these two back rather than rushing them into that window. Scoped both now against current `main` (post-#524).

---

## Mines idle-state polish — small, same file T8 already touched

**Confirmed by reading the prototype's own tile-computation code directly:** the prototype does NOT have a separate idle-state design for the Mines board — `minesTiles: MINES_TILES.map(...)` (`Full Spec.html`, near line 3684) is the SAME function that renders the live in-match board; before a match starts it's just every tile in its default covered state (`open: false`), same colors T8 already ported (`MINES_TILE_COVERED`/`MINES_BOARD_BG`). There is no idle-specific mock to cite beyond what's already in `MinesHub.tsx`.

**Scope:** `MinesIdle` (`MinesHub.tsx:160-176`) currently renders plain `border-border bg-background` divs — swap for T8's own `MINES_TILE_COVERED`/`MINES_BOARD_BG` constants and the card/board radii T8 already established, so the idle preview is visually the live board's covered state, dimmed (`opacity-50`, unchanged), rather than a separate generic gray grid. Should be almost entirely reusing what's already in the file — no new prototype investigation needed, this is "finish applying T8's own values everywhere T8 touched," not new scope.

**Done when:** idle preview uses the same tile colors/radii as the live board (dimmed); no new hex/colors introduced beyond what T8 already defined; existing MinesHub tests updated only if they assert on the old idle classnames.

---

## Currency-picker dropdown — a real, bounded feature, bigger than T9 was

**Flagging the size honestly up front:** this is not a small follow-up like T9 (T9 swapped an icon on an existing button). This is a genuine dropdown component that doesn't exist in the app at all today — search input, two grouped sections, 8 currency rows with mock balances, open/close animation, backdrop click-away. Confirmed by reading the prototype's actual state/markup, not guessing:

- **Trigger:** the existing wallet chip (`HubRibbon.tsx`'s `hub-wallet-chip` button) currently only calls `onWallet` (opens the Wallet screen). Prototype (`Full Spec.html:2233`, `toggleCur`) opens an inline dropdown panel instead — `onWallet` needs to stay reachable some other way (the WALLET sub-pill half of the same chip, most likely — the prototype's own layout already separates the currency-symbol/balance half from the purple WALLET sub-pill, `:2231-2241`) since both actions need to exist.
- **Panel** (`:2242-2296`): a search input (`curQuery`/`onCurQuery`, placeholder "Search"), a "Cash" section header + one USD row, a "Cryptocurrency" section header + rows for BTC/USDT/USDC/SOL/ETH/LTC/XRP (`OPEN_CURS`, prototype line 2855) — each row: coin icon (already have all 8 as SVG `<symbol>`s in the prototype, lines ~104), name, and a mock balance. Open/close via `curOpen` boolean, animated (`opacity 220ms ease, transform 280ms cubic-bezier(0.22,0.61,0.36,1)`, translateY+scale), closes on an outside-click backdrop (`closeCur`).
- **Mock balances are hardcoded per-currency strings in the prototype** (`CUR_BAL`/`CUR_CRYPTO` objects, near line ~3592) — e.g. `SOL: '$1,642'`/`'10.6483'` — NOT derived from the real integer credit balance. Per the tracker's existing "Currency presentation" section (already Owner-approved 2026-09-09): this is correct and intentional, not something to fix — "per-currency balances are mock display strings (as in the prototype), not derived from one number." Whoever implements this should reuse a literal copy of the prototype's own mock numbers, not invent new ones.
- **Also present in the prototype but explicitly a judgment call for whoever scopes the ticket further, not decided here:** a fiat/crypto display toggle (`curFiat`) that swaps between `CUR_BAL` (dollar strings) and `CUR_CRYPTO` (native-unit strings) for the same currency. Could ship in the same PR or be split into its own smaller follow-up — flagging rather than pre-deciding since it's a discrete, separable piece.

**Deliberately not scoping the exact component boundaries/file split here** — that's real implementation-design work (new component vs. extending `HubRibbon.tsx` inline, where the mock-balance data lives) that deserves the same "cite real prototype values, don't freehand" ticket-writing pass T6a/T6b/T8 got, and I'd rather hand you accurate raw material than a rushed file-by-file plan. Let me know if you want me to go one level deeper (component boundaries, exact test plan) before dispatching, or if your usual ticket-authoring pass from here is enough given the citations above.

**Priority note, not a directive:** this is cosmetic-only (Charter #4's approved investor-demo skin) and was correctly deprioritized once during the deploy push — nothing about it is more urgent now that the deploy has landed. Sequence it wherever makes sense relative to whatever's next on the roadmap (chat, races/leaderboards, the lobby-collapse), your call.

### 2026-09-11#3 — T8 (Mines visual rebuild) + T9 (GameHub $ skin gap) — both ready            [READY TO TICKET]
From: Advisor   Re: your flag on the Mines visual follow-up; Owner's ~6h-to-deploy target

Both scoped from the actual current code on `main` (post-T7/#517), not the PR description — I hit a real "reading a stale checkout" moment while starting this and caught it via `git log` before writing anything wrong, worth mentioning only because it's exactly the kind of check that's mattered all session.

---

## T8 — Mines visual rebuild (board is right-sized, needs the real prototype treatment)

**Current state, verified directly against `apps/web/src/screens/MinesHub.tsx` on `main`:** T7's minimum fix already has the right board size (`BOARD_SIZE = 25`, `grid-cols-5`) and the file is honest about what's missing — its own comments say this is NOT the full visual rebuild and the 30s round clock isn't surfaced to the client yet. Two concrete gaps, both small:

**1. Tile visuals.** Today: generic lucide-react `Gem`/`Bomb` icons on a plain color/border scheme. Prototype (`Full Spec.html:470-518`, the `isMines` block): hand-drawn SVGs — a green faceted gem (lines ~505-516, halo + solid variants) and a red spiky mine icon with a glow halo (lines ~475-503, halo + solid variants), inside `border-radius:9px` tiles on a `grid-template-columns:repeat(5,1fr); gap:8px` grid, wrapped in a `border-radius:16px` inner board on a `border-radius:22px` card (`minesCardBg`: light `#E9E9F0`/dark `#1A1A2E`; `minesBoardBg`: light `#DEDEE8`/dark `#12121F`, lines 3720-3721). Swap the two lucide icons for the real SVGs, apply the real container radii/colors — the covered/safe/mine/busted cell *logic* in `MinesBoard`/`cellKind()` doesn't change, only what renders inside each state.

**2. The 30s round clock isn't shown at all.** Prototype (`Full Spec.html:520-524`): a `{{minesClock}}s` label (13px, Space Grotesk bold) above a 5px-tall rounded progress track (`minesTimerTrack`: light `#DEDEE8`/dark `#12121F`) filled `#8B45F0` purple, width = `(clock/30)*100%`, animating via `transition:width 1000ms linear`. **This needs one small, safe data-plumbing change first:** `packages/games/mines/src/mines.ts`'s non-terminal `viewFor` branch (around line 288) does not currently include `roundStartedAt` in its returned object — confirmed by reading the function directly. Adding it is safe: it's pure per-round timing metadata, reveals no mine position or score, and the field already exists on `MinesState` server-side (stamped by `launch`, re-stamped by `redeal`) — this is a one-field addition to an existing Mines-only function, not a core/contract change (no ADR needed, unlike T7). Once exposed, the client computes `secondsLeft = 30 - (Date.now() - roundStartedAt) / 1000` locally and ticks it down, same pattern any other client-side deadline countdown in this codebase already uses.

**Not in scope:** the idle-state dimmed preview (`MinesIdle`) can stay generic gray squares for now — lower priority, same treatment T6a/T6b's idle states got initially before #512 caught RPS's gap; fine to follow up separately if it matters after a look.

**Done when:** tile SVGs and colors match the prototype citations above in both themes; the round clock displays and counts down accurately from server-authoritative `roundStartedAt` (not a client-guessed value); existing Mines test suite (50 tests, post-T7) untouched except for the new `viewFor` field and whatever new tests cover the clock display; harness `mines-idle` fixture can stay as-is (idle state unchanged) but consider adding an in-match capture if the harness can reach one now.

---

## T9 — GameHub's bet-amount display still shows the RC coin icon, not `$`, for registered users

**Found via my own harness diff tonight** (the `rps-idle`/`dice-idle`/`mines-idle` screens I added in #513): the prototype's bet-amount row shows green `$1 $5 $10 $25 $50 $100` pills; the app's dark capture showed `RC 1`/`RC 5`/… — a real, visible fidelity gap in the single most-common per-game screen every player sees.

**Root cause, verified directly:** `apps/web/src/screens/GameHub.tsx`'s bet-preset buttons (`BET_PRESETS = [1, 5, 10, 25, 50, 100]` — already the exact right ladder, nothing to change there) render each value via `<Credits amount={v} />` (`components/hub-shared/RcIcon.tsx`). That component's own doc comment is explicit: *"Decorative only... play-money framing, **never `$`/crypto**."* This predates the Owner's 2026-09-09 Charter #4 amendment approving a cosmetic `$` skin for registered users. T2 (#489) already worked around this exact conflict once — `HubRibbon.tsx`'s wallet chip renders its own inline `$…` text rather than using `<Credits>`, specifically because `<Credits>` can't do it. `GameHub.tsx`'s bet buttons never got the same treatment.

**Scope, deliberately narrow — read this before touching anything:** `<Credits>` is used in **9 files** (`Wallet.tsx`, `ProfileHub.tsx`, `OpenChallengesList.tsx`, `GameHub.tsx`, `Result.tsx`, `Leaderboard.tsx`, `HubRibbon.tsx` — already has its own workaround — `GuestBotWaiters.tsx`, plus `StakeEntry.tsx`/`Lobby.tsx` which read as dead/unreachable code, worth a coder double-checking before assuming). Only `GameHub.tsx` and `HubRibbon.tsx` currently have `isGuest` threaded through as a prop — the other 5 live files don't, so making this "everywhere" tonight means also plumbing a new prop through 5 files with zero prior precedent, which is real, unscoped work I'm not willing to rush given the deploy clock. **This ticket is `GameHub.tsx` only** — mirror `HubRibbon.tsx`'s own precedent (an inline `$`-formatted display, gated on `!isGuest`, bypassing `<Credits>` entirely for this one call site — don't touch the shared component or its "never $" contract in this ticket). A sitewide `<Credits>` policy change (if ever wanted) is separate, larger, future work — note it as a candidate follow-up, don't scope it now.

**Done when:** `GameHub.tsx`'s bet-amount label and the 6 preset buttons show `$`-formatted values for registered (non-guest) users, unchanged (`<Credits>`/RC icon) for guests; the "BET AMOUNT" armed-stake readout above the buttons gets the same treatment; harness fidelity on `mines-idle`/`rps-idle`/`dice-idle` improves (re-run `capture-app`+`diff` after, don't just assume); no other file touched; any existing "no $" test that happens to cover `GameHub.tsx` specifically is expected to flip (per the currency-presentation section's own "flips organically" plan) — anything covering the 5 untouched files must stay green.

---

**Sequencing suggestion given the ~6h deploy target:** T9 is smaller and more isolated (one file, no data-plumbing) — good candidate to land first/fastest. T8 has one small cross-package step (the `viewFor` field) before the visual work, but is still same-day-sized. Both are independent of #497/#501/T4+sweep — happy to have all five running in whatever parallelization the ≤2-agent cap allows.

### 2026-09-11#2 — T7 (Mines engine rewrite) — Designer answered everything, ticket is READY            [READY TO TICKET — flag as higher-care than a normal ticket]
From: Advisor   Re: 2026-09-11#1's T7 hold; the rules-5/7/9 diff sent to the Designer

Designer answered all five sub-questions plus a security question Advisor hadn't even asked. Full canonical spec + every answer is in `NEW_DESIGN_MIGRATION.md` § "Canonical new Mines ruleset" — read that in full before ticketing, this summary is not a substitute. **T7 is no longer blocked.**

**The governing idea, worth internalizing before writing code:** hitting a mine costs nothing but the rest of your round — you keep your gems either way. So tapping always has non-negative expected value and there's never a reason to stop. Optimal play is "tap until a mine or 22." **Nothing in the implementation should model a player weighing whether to continue** — that's not how this game works anymore.

**What changes from today's engine (`packages/games/mines/src/{board,mines}.ts`):**
- Board: 8×8/7-mine → 5×5/3-mine, **parameterised** `(size, mineCount)`, not forked.
- Clearing all 22 safe tiles → auto-lock at 22 (same as today's "cleared" lock). Both at 22 = draw.
- **Remove early resolution.** Today, the match ends the instant a locked player is mathematically passed by the other. Designer wants this gone — both players play their own round (mine/clock/22) to completion, independently, THEN compare. This is a real rewrite of `decide()`/`resolve()`, not a tweak.
- **Hide the opponent's gem count for the whole round**, not just until either player locks (today's behavior). Reveal only once both are done. `viewFor`'s `revealOppCount` logic needs to change accordingly.
- **Remove the 4s auto-reveal / 5s-per-move timer entirely**, replace with a single 30s round clock that's explicitly a cap, not a mechanic (times out a disconnected/idle player, nothing else).
- 10-consecutive-draw void cap: **keep exactly as-is**, no change.
- Disconnect: **confirmed** — lock at whatever gems they had (including zero) when the clock ends, no void, no special handling.
- Seed security: **Advisor verified this is already correct, no change needed** — `viewFor`'s non-terminal branch never spreads `state` (no `seed` leak), and a player's own `mines` array is only attached once THEY lock. The only seed-reveal path is the terminal branch, which — once early resolution is removed — only fires once both are done. Removing early resolution incidentally closes the one path that could have exposed it early.

**Real open architecture question, not solved here — flag for whoever picks this up, don't let it get quietly hacked into `mines.ts`:** rule 10 means Mines can't use the core's existing per-player-timer contract (`meta.moveTimeoutMs` + `timeoutMove`, `packages/core/src/matchmaking.ts`) as-is — `timeoutMove` must always return a legal move on expiry, but Mines' new clock needs to **lock the player with no move injected at all**. Blackjack/Coinflip/Limbo/Keno/Roulette/RPS all share this same core timer file. Whoever implements T7 needs to propose a small, generic addition to the core contract (a "lock, no move" primitive) — not a Mines-only branch (invariant #5) — and that addition should get its own careful review given how many other games it touches.

**Ask:** ticket this with extra care relative to a normal screen-rebuild PR — it's a core-adjacent change (touches shared matchmaking timer infrastructure, not just `packages/games/mines/`) and a fairness-sensitive one (seed/redaction logic). Suggest: one agent, not parallelized with anything else touching `packages/core/`; acceptance criteria should include re-running the full existing Mines test suite plus new tests for no-early-resolution and hidden-count behavior; and the core-timer-contract proposal should be reviewed on its own before the Mines-specific implementation lands on top of it, rather than approved as one big diff.

### 2026-09-11#1 — rps/mines/dice rebuild — full scoping, one Owner question, rest ready            [READY TO TICKET except T7]
From: Advisor   Re: the retracted "no design source" claim; tracker's "After T4+sweep: rps/mines/dice"

Full retraction context is in the tracker's Status snapshot — short version: the design material was in `Full Spec.html` the whole time (`openGame(k)` → `view: 'mines'|'rps'|'dice'`, driven by clicking the actual `[data-rc-grid]` tiles, which is why an earlier text-based check missed it). Scoped properly this time by reading the actual game-engine code on both sides, not visual impression. One real open question below (T7) needs the Designer; everything else is ready.

**Good news first:** the current app is architecturally much further along than "full rebuild" suggested. All game hubs already share one `GameHub.tsx` (1162 lines) with `idle | waiting | in-match | result` phases, a name-cycling search animation (`useNameScan`), and a win-fill celebration (`useWinReveal`) — the same *concepts* the prototype uses, just styled differently. This isn't a rebuild from nothing; it's a reskin of a mature system plus one small shared addition (T5) and three per-game visual/board areas (T6a/b/c).

---

## T5 — Shared "VS" match-found transition (`GameHub.tsx`)

**What's actually missing**, verified against the real transition point in code, not guessed: `GameHub.tsx:497`'s `matchForming = phase === 'waiting' && currentMatchId != null` is exactly the moment a match has been assigned but play hasn't started — the prototype's `openGame`/`startDice` flow shows a floating "VS" label (`matchVsLabel`/`rpsMatchVsOp`/`matchVsTop`, `Full Spec.html:432-433`) centered between the two bars for this same window, then fades as the game area activates. The current app has no equivalent — it goes straight from "Searching…" to the frozen pre-match state with no reveal beat.

**Scope:** add the VS-label overlay to `GameHub.tsx`, gated on `matchForming`, positioned between `OpponentSlot` (`:718`) and `OwnSlot` (`:759`) matching the prototype's absolute-position/fade-in treatment (lines cited above). This benefits every game hub that uses `GameHub`, not just these three — one shared addition, not three separate ones.

**Done when:** the VS label appears during the `matchForming` window on at least Mines/RPS/Dice, fades correctly into `in-match`, existing `GameHub.test`/hub-specific tests still pass, no regression to Coinflip/Blackjack/Chess's own transition.

---

## T6a — Dice visual rebuild (mechanic unchanged — confirmed identical)

**Confirmed, not assumed:** `packages/games/dice/src/dice.ts`'s own doc comment: independent seeded rolls 0.00–99.99 per player, higher wins, exact tie → instant reroll, deliberately no target/line (human-vs-human, never-the-house). The prototype's `startDiceResult()` (`Full Spec.html`, near `startDice`) does the identical `win = my > opp` comparison. **The mechanic does not change — this is visual only.**

**Scope — `apps/web/src/screens/DiceHub.tsx`:** replace the current plain "place your bet and roll" idle state + result display with the prototype's dual roll-gauge treatment (`isDice` block, `Full Spec.html:531-603`): two horizontal pill tracks (opponent's above, player's below), each filling 0→rolled-value with an animated cube icon riding the fill edge, a 0/25/50/75/100 scale between them, and a history "belt" of the last 5 results sliding in from the right (`diceHistory`, :594-598). Pull exact colors/timings/easings from that block directly, cite line numbers in the PR — same convention as T1/T2.

**Done when:** roll animation and history belt match the prototype in both themes; the underlying `rollFor`/`resolve` engine is untouched; existing Dice tests (mechanic + redaction) still pass; harness diff improves once wired up.

---

## T6b — RPS visual rebuild (pick-window model unchanged — confirmed by design, not incidental)

**Confirmed:** `packages/games/rps/src/rps.ts`'s doc comment: a FIXED 10s pick window, resolves ONLY at expiry (never on "both chosen"), specifically to avoid a timing side-channel — a real fairness decision, not a stub. The prototype's simplified demo uses a 7s cosmetic countdown with an instant reroll on a tie (`rpsClock: 7`) — consistent in *shape* (timed window, tie-replay) but the prototype is a design mock, not an authoritative engine spec. **Keep the current 10s/resolve-at-expiry model; take the prototype for the visual treatment only**, per the standing "build from rendered markup, not the prototype's data layer" rule.

**Scope — `apps/web/src/screens/RpsHub.tsx`:** rebuild the picker + reveal to match the prototype's `isRps` block (`Full Spec.html:605-658`): two square avatar-style cards either side of a "VS" + digit-flip countdown, a 3D card-flip reveal (`rpsFlipRot`) showing the resolved rock/paper/scissors icon, and the 3-icon picker row below (`rpsRock`/`rpsPaper`/`rpsScissors`, :644-654). This card-flip area is RPS-specific gameplay UI (distinct from T5's shared VS-label, which is the brief pre-match beat) — don't conflate the two.

**Done when:** picker + flip-reveal match the prototype in both themes; pick window stays 10s, resolve-at-expiry; existing RPS engine tests untouched and still passing.

---

## T7 — Mines engine: Designer answered (5×5 is a rules change) — still not a ticket, blocked on 5 sub-questions

**UPDATE 2026-09-11:** Designer confirmed the 5×5 is intentional and it's a real rules change. Full canonical ruleset is in `NEW_DESIGN_MIGRATION.md` § "Canonical new Mines ruleset (Designer, 2026-09-11)" — read that, not this paragraph, when T7 is eventually ticketed. Headline: 5×5 / 25 / 3 mines / 22 safe, 30s round clock replacing per-move timers, remove the 4s auto-reveal entirely, generalise the seeded engine to `(size, mineCount)` params (don't fork), draw→rematch and bust-keeps-gems both already match today's engine.

Designer asked for a diff-list (rules 5/7/9 vs. today's engine) before we touch code — Advisor produced it, Owner is relaying. **T7 stays un-ticketed until the Designer answers the 5 open sub-questions in that list** (clearing auto-lock; early-resolution vs. play-to-clock; opponent-count visibility; draw-cap; disconnect). The Mines *visual* can ride with T6a/T6b; the *engine* waits.

Not blocking T5/T6a/T6b — independent files, ready now.

**Ask: ticket T5 first (small, shared, unblocks nothing else but touches the file everything else reads), then T6a/T6b in parallel (different files, no collision). Hold T7 until the Designer answers the sub-questions.**
From: Advisor   Re: tracker's "T4" placeholder + the `--brand-purple`/header-padding notes from T2 (#489)

Neither of these blocks or is blocked by T3b heavy (#498) — different files, pick up whenever there's spare capacity. Both are small; I did the investigation so the tickets are precise rather than "go look into it."

---

## T4 — Pin Coinflip/Blackjack/Chess to dark, interim (until they get an actual light design)

**Why:** these 3 already match the new design and need no screen work (per the roster split above) — but "no screen work" was never verified against the *light* theme, because T1–T3 gave the shadcn base tokens (`--background`, `--foreground`, `--card`, …) no light override at all (only the `--rc-*` set got one). That means these 3 screens are *already* frozen dark almost everywhere, by accident — except where they use one of the few tokens that DID get a light value.

**Confirmed concrete bug:** `ChessHub.tsx` uses `bg-success` in two places — the active-turn clock dot (line 61) and the full-screen win-result flash (line 345, the prominent one). `bg-success` → `--rc-success` → aliased to `--rc-green` (T3a, #487), which **does** have a light override (`#0B8F5A` vs dark `#34D399`). So a light-mode user who wins a chess match gets a result screen that's dark everywhere *except* the win-flash, which shifts to the light-mode green — a real, visible, half-adjusted look. CoinflipHub and BlackjackHub currently use **zero** `--rc-*`/`-success` tokens (checked directly), so they're not broken today, but nothing stops a future PR from introducing the same accidental drift.

**Scope:**
- Wrap each of the three hub screens' root render output in a scope that pins every token they read back to its dark value, regardless of the app-wide theme choice. `index.css` already has exactly this mechanism sitting unused: `.dark { … }` (line ~134) is a **complete** mirror of `:root`'s dark values (both the shadcn base tokens and every `--rc-*` token) — the app is dark-first and has never toggled it. Wrapping each hub's root in `<div className="dark">` should be enough to make the whole subtree immune to `data-theme='light'` on `<html>` (CSS custom properties resolve to the nearest ancestor definition, so the wrapper's own `.dark` values win over the inherited light ones for everything nested inside it).
- Verify this doesn't collide with Tailwind's `darkMode: ['class']` config if either hub uses any `dark:`-prefixed variant class anywhere (a quick grep first) — the app is described as not using that mechanism today, but confirm before relying on it.
- Fixes the ChessHub `bg-success` bug as a side effect; no separate patch needed for it.

**Done when:** ChessHub's win-flash and clock dot stay the dark green in both themes; Coinflip/Blackjack/Chess render pixel-identical to today when the app is in dark mode (regression check); a manual light-mode pass through all three confirms nothing shifts; tests updated if any assert on theme tokens in these files.

---

## Token + chrome-geometry reconciliation sweep

Two small, unrelated, both-already-diagnosed drifts, worth doing together since they're both "pick one canonical value and update everywhere" like T3a was for `--rc-success`.

**1. `--brand-purple` (`#8140e2`) vs the prototype's actual accent purple (`#8B45F0`).** The app's nav-active/accent purple is a pre-existing value that predates this migration; the prototype's own accent (`Full Spec.html`, e.g. line 178's active-category dot, line 62's link color) is a different, slightly brighter purple. `--brand-purple` is the single source (`index.css:230`, mapped to Tailwind's `brand` color at `tailwind.config.js:17`), so every `bg-brand`/`text-brand`/`border-brand`/`ring-brand` call site updates from one line change. Two derived values also need updating to match: `--rc-theme-btn-shadow` and `--rc-nav-active-glow` (`index.css:178-179`) both hardcode `rgba(129, 64, 226, …)` — that's `#8140e2` in decimal; recompute for `#8B45F0` (`rgb(139, 69, 240)`) so the glow color still matches the purple it's glowing around.

**2. HubRibbon `pb-4` (16px) vs the prototype's real spacing.** Flagged in T2's own doc comment (`HubRibbon.tsx:38-41`): `layout.ts`'s `HUB_FIXED_TOP` hardcodes HubRibbon's real rendered height as a measured-live-via-Playwright 60px constant; changing `pb-4` without re-measuring would silently invalidate every screen that depends on `HUB_FIXED_TOP` for its top clearance (`MenuOverlay.tsx` today, likely more as T3b heavy lands). **Do this measurement-first, not value-first:** re-measure HubRibbon's actual rendered height live (same Playwright technique used to get the original 60px), compare against the prototype's equivalent spacing, and only then decide whether `pb-4` needs to change and update `HUB_FIXED_TOP` (and `layout.test.ts`'s assertion on its literal string) to match in the same PR. Don't change one without the other.

**Done when:** `--brand-purple` matches the prototype's accent exactly (spot-check against `Full Spec.html`'s own hex, not the RGB-decimal glow math secondhand); the two glow tokens are recomputed, not left stale; `HUB_FIXED_TOP` and `HubRibbon`'s padding agree with each other and with a fresh live measurement (not just the old comment); full suite green.

---

### 2026-09-10#3 — Shared-chrome T2 + light-threading T3 — full tickets            [READY TO TICKET]
From: Advisor   Re: T1 (#472/#478) merged; `light-theme-rollout.md`; my 2026-09-10#1 sketch

T1 is on `main`, so T2 and T3 are unblocked. They touch different files (chrome components vs screen bodies) so they can run in parallel within the ≤2-agent cap. Thanks for catching the `--rc-success`/`--rc-green` thing during T1 — it's T3a below.

---

## T2 — Shared chrome: `HubRibbon` (header) + `HubToolbar` (bottom nav) → new design + light

**Why highest-leverage:** both render on every hub screen, so this lifts fidelity platform-wide in one PR, and it carries the 6 chrome-only hubs (crash/roulette/hilo/keno/baccarat/limbo) as a side effect.

**Scope — `apps/web/src/components/hub-chrome/HubRibbon.tsx` + `HubToolbar.tsx`** (+ `layout.ts` if shared spacing needs a token):
- Rebuild both to match `design/prototype/RapidClash Full Spec.html` — pull every pixel/type/spacing value from that file directly, cite line numbers in the PR.
  - Header: RapidClash wordmark + `LOGIN`/`SIGNUP` pill (signed out) / balance chip + `WALLET` (signed in). The `$`/currency skin is Owner-approved — don't reject `$`.
  - Bottom nav: the `Menu / Games / Account / Rewards / Chat` pill.
- Thread the shared `--rc-*` tokens (from T1) through both; no hex literals, no per-component `RC` objects. Verify light renders.

**Harness:** `region.ts` currently *excludes* the bottom-nav from the compared region. Coordinate with me — I'll land a small harness PR alongside T2 that adds the nav back to the comparison (and, if the header rebuild shifts its geometry, re-anchors). Don't block T2 on it.

**Done when:** header + nav match the prototype in both themes (harness `diff` on the games screens, human-clean on the header/nav region); every hub screen still renders (signed in + out); `HubRibbon.test`/`HubToolbar.test` + any hub-screen tests updated; full suite green.

---

## T3 — Light-mode threading through the dark-only screens

Each screen below is dark-only today with embedded hex / a local `RC` object. Replace with the shared token set (T1). **No new visual design** — make light work off the tokens. Sizes (raw hex-literal counts, rough): RewardsHub ~99, AffiliateHub ~56, ProfileHub ~30, HomeHub ~13, PreferencesHub ~12, MenuOverlay ~8.

**T3a — `--rc-success` → `--rc-green` reconciliation (do first, blocks the screens below that use `text-success`).**
- The app's `--rc-success` (`#2bb673`, `index.css:57`) and the prototype's `--rc-green` (`#34D399`) fill the same win/success role. `text-success`/`bg-success`/`border-success` appear across ~13 files.
- Pick the prototype's value as canonical (`#34D399` dark; T1 already added `--rc-green`'s light value). Either alias `--rc-success` → `--rc-green` in `index.css` (one line, keeps call sites) **or** sweep `*-success` → `*-green` and delete `--rc-success`. Coder's call, but decide it explicitly, don't leave both.
- Small, shared, one agent.

**T3b — per-screen threading.** Split by size:
- **Group 1** (lighter): `PreferencesHub` + `MenuOverlay` + `HomeHub` + `ProfileHub`.
- **Group 2** (heavier): `RewardsHub` + `AffiliateHub`. Rewards: the canonical VIP ladder + row rules are in `content-corrections-answer.md` (WOOD→DIAMOND, 500→1.5M XP, 1%→20% rakeback) — light threading must not alter those values, just the surface/text/token colours around them.
- Each screen has a committed light reference in the harness already — verify against it.

**Done when:** every screen renders correctly in light off the shared tokens; no local `RC` hex object or bare `#hex` for themeable colour remains in the six files; `--rc-success`/`--rc-green` reconciled to one; harness light-mode fidelity on these screens improves substantially (won't hit the gate — the header/nav in T2 and residual anchoring are separate); tests updated; full suite green.

---

Ask: ticket T2 + T3a now (parallel-safe — different files). T3b groups follow once T3a lands. T4 (Coinflip/Blackjack/Chess dark-region override) after T3b. rps/mines/dice after the whole block.

### 2026-09-10#2 — Games-hero vertical drift = 3 real fidelity gaps, not a harness artifact            [READY TO TICKET — small]
From: Advisor   Re: the "~20-30px cumulative vertical drift" the harness shows on the games screens (#470/#474)

Measured the DOM directly, prototype vs the running app, both in the games-originals state, anchored on the category rail. The drift is **real fidelity signal — do not "fix" it in the harness** (per-section anchoring would just hide it). Three concrete causes:

**1. Game-tile aspect ratio — the dominant one.** `apps/web/src/screens/HomeHub.tsx:554` renders each tile as `aspect-[2/3]` (0.667). The prototype's tile container is `aspect-ratio: 112 / 158` (0.709) — `RapidClash Full Spec.html:241` and `:931`. The tile art PNGs are 2:3, so the prototype cover-crops them into the slightly-wider box. Each app tile is **~12px too tall** at the current width → it compounds down the 4-row grid, which is exactly why the drift *grows* toward the bottom of the capture. **Fix: `aspect-[112/158]`.** Pre-existing since #113, not a #465 regression — but a genuine migration gap. Tiny change; verify the art still reads well cover-cropped.

**2. Default tile sort order** (already logged in 2026-09-10#1): fresh/quiet DB → Popularity counts all tie → grid shows Baccarat first; should fall back to the prototype's `GRID` order (`cf,bj,ch,mn,rp,cr,di,ro,hi,ke,ba,li` → Coinflip first).

**3. Category-rail → SORT/RANDOM row gap** is ~15px tighter in the app. Both sides nominally use ~14px margins (`HomeHub.tsx:403` `mt-3.5`; prototype `:211` `margin:14px`), so the extra prototype space is coming from somewhere else — the rail's own `pt-1` (`:318`), the pill row's height, or a wrapper margin. Needs a line-by-line spacing pass of `HomeHub.tsx` lines ~318 and ~403 against the prototype's category-rail block. Least certain of the three; lowest priority.

Ask: fold #1 and #2 into one small "games-grid fidelity" ticket (both are `HomeHub`/tiles, no collision-zone risk); #3 can ride along or wait. All three are independent of the T1–T5 shared-chrome sequence.

### 2026-09-10#1 — Shared chrome + light-theme rollout — the next (biggest) workstream            [READY TO TICKET, sequenced]
From: Advisor   Re: Owner call to do this before rps/mines/dice; `light-theme-rollout.md`; the games-hero harness diff (#470)

**Why this next, not rps/mines/dice** (Owner-agreed 2026-09-10): the games-hero rebuild passed review but fails fidelity on every screen/theme — and the re-aligned harness diff (#470) shows the failing pixels are almost entirely *shared*: the header + bottom-nav styling, the page tokens, and the total absence of a light theme. Those are platform-wide, not per-screen. Fixing them lifts fidelity on every screen at once and makes rps/mines/dice measurable when they come. Full detail: `docs/NEW_DESIGN_MIGRATION.md` → "Shared chrome + light theme rollout".

**Sequenced tickets — 1 gates the rest:**

**T1 — Theme foundation** (small, self-contained, blocks T2–T4).
- Theme model becomes `dark | light | system` (three values). `system` watches `prefers-color-scheme` via `matchMedia`. `PreferencesHub.tsx:228-243` currently renders exactly two radios → add the third.
- A theme provider that stamps the choice on the document root (`data-theme` attr or equivalent) and flips the `--rc-*` token block. `PreferencesHub.tsx:23`'s `ThemeChoice` is the only theming that exists today and it re-themes only its own subtree — replace it with an app-wide one.
- Token additions (Designer, `light-theme-rollout.md`): sort-sheet background (`#D3D3DD` light / `#1A1A2E` dark), theme-button shadows, and the **games-hero carousel inactive dot** (`#3B3B47`, dark-only today, no light value — pick one, add to the token set). All join the `--rc-*` set, no hex literals in components.
- Harness: `capture-prototype`'s light references already exist; this ticket makes `capture-app --url` produce a real light capture instead of a dark one.

**T2 — Shared chrome to the new design + light: `HubRibbon` (header) + `HubToolbar` (bottom nav).** Depends on T1.
- Rebuild both to match `design/prototype/RapidClash Full Spec.html` — pull exact values from that file. Thread light tokens through both.
- They render on every screen, so this is the single highest-leverage fidelity lift. One agent; shared components, adjacent to `App.tsx` but *not* the matchmaking collision zone.
- Harness: unmask/add the bottom-nav to the compared region as part of this (coordinate with me — `region.ts` currently excludes it).

**T3 — Per-screen light threading: Account (`ProfileHub`), Preferences, Menu (`MenuOverlay`), Rewards (`RewardsHub`), Affiliate (`AffiliateHub`), plus the rebuilt HomeHub.** Depends on T1. Can run parallel with T2 (different files).
- Each of these is dark-only today with a local `RC = { surface: '#1A1A2E', … }` hex object. Replace with the shared token set. No new visual design — just make light work off the tokens.
- Verify each against its already-captured light reference in the harness.
- Splittable into two agents (Account+Prefs+Menu / Rewards+Affiliate+HomeHub) if you want the parallelism; the ≤2 cap and the App.tsx zone still bind.

**T4 — Interim dark-override for Coinflip / Blackjack / Chess.** Depends on T1 + T3.
- These 3 are "already done, not rebuilt this round." Holding pattern per `light-theme-rollout.md`: everything on the page follows light **except** the player-boxes and the play surface (coin area / blackjack felt / chessboard), which stay pinned dark via **one** scoped `--rc-*` variable-override wrapper per hub. **Do not fork the components.** Audit for hardcoded hex inside the pinned regions first — anything reading a token follows the override; a literal hex inverts and goes unreadable.
- A hard edge between the light page and the dark board is expected and fine.

**T5 — PARKED, not started:** proper light treatment for Coinflip/Blackjack/Chess, picked up only after rps/mines/dice ship. Log it, don't lose it.

**One games-hero (#465) follow-up the harness surfaced — small, fold into a #465 cleanup pass or a quick ticket:**
1. **Default tile sort order.** With Popularity counts all-equal (fresh/quiet DB — the normal demo state), the grid should fall back to the prototype's `GRID` order (`cf,bj,ch,mn,rp,cr,di,ro,hi,ke,ba,li`). The capture showed Baccarat first — the current tie-break doesn't match.

*(Retracted 2026-09-10: an earlier draft flagged a "tile art" difference — that was a misread of the diff image. The "100"/"1K" are poker chips painted into the Baccarat art; the app's webp tiles are the same images as the prototype's PNGs. The tile red in the diff was the vertical-alignment residual plus the sort-order mismatch above, not an art difference. No Designer question needed.)*

Ask: ticket T1 now; T2 + T3 once T1 is on `main`; T4 after T3. The #465 follow-up is independent and small. rps/mines/dice come after this whole block.

### 2026-09-09#3 — Games-page hero rebuild — first migration screen ticket            [READY TO TICKET]
From: Advisor   Re: Phase 3, `NEW_DESIGN_MIGRATION.md`; Designer answers `TO-designer-harness-and-hero.md` 2026-09-09

**This is the first screen-rebuild ticket. Start it once PR #459 (harness) is merged** — the coder needs `capture-prototype` / `diff` to measure against. My harness-refinement PR (0.5% gate, animation/randomness killing, banner masking, 390×840, scroll-frames) runs in parallel and should land before this ticket closes; coordinate timing with me.

**Scope: the games-page hero on `HomeHub.tsx` — everything above the game grid EXCEPT the banner.**

Rebuild from `design/prototype/RapidClash Full Spec.html` — pull every pixel/type/spacing value from that file directly, do not transcribe from screenshots or this ticket. 390px content column, 16px page margins, build fluid (no hardcoded 358).

**In scope:**

1. **Category rail** — five tabs: `ORIGINALS / CARD GAMES / CHANCE GAMES / SKILL GAMES / EVENTS`. Membership is many-to-many per `CAT_GAMES` (prototype line ~2843; also in the tracker's category table). **Data model: a game carries a *set* of category tags, not one value.** Client-side static map keyed by gameId (`apps/web`) — categories are presentation taxonomy, not core (invariant #5 unaffected). `EVENTS` is empty by design and has its own empty state (`catEmpty` in the prototype). `MenuOverlay.tsx`'s existing placeholder "Card games / Chance games / Skill games" rows get wired to open this view filtered.

2. **SEARCH** — the magnifier expands to an input (animation already designed). Behaviour (Owner-resolved): case-insensitive **substring match on game display name across all 12 games, ignoring the active category tab**, as-you-type. Empty query → the normal category-filtered grid. `searchQuery` filters nothing in the prototype — that logic is ours to add.

3. **SORT** — the sort sheet (`sortOpen`), three options:
   - **Popularity** (default) = all-time settled-match count per `gameId` (source: `match-history.ts` aggregate; every settled match counts — no bot-vs-bot exists).
   - **Newest** = a fixed per-game introduction-order ordinal. Establish it once from each game package's first-landed commit (`git log` on `packages/games/<name>/`), encode as a static `introOrder` map. Not a live date field.
   - **Alphabetical** = by display name.
   The sheet UI is built; the reorder logic is ours.

4. **RANDOM** — defined intent (Designer Q4), not "ours": `spinRandom` (prototype line 3991) spins the die **1560 ms**, then opens a random game's hub. The prototype only picks mines/rps/dice (its only views) — **real behaviour: uniform random among the six *playable* games — `rps`, `dice`, `mines`, `coinflip`, `blackjack`, `chess`.** Never the six unbuilt ones. The die-spin keyframe is 1500 ms; navigation fires 60 ms after it settles.

5. **Section title** — "RAPIDCLASH ORIGINALS" (or the active category's title).

**Explicitly out of scope:**

- **The banner carousel.** Designer Q5: the three rotating banners, artwork, rotation and dots are carried over from production unchanged — do not restyle or rebuild. The harness masks that region. *(One tiny follow-up, NOT this ticket: the inactive dot `#3B3B47` has no light-theme value — that's logged against the light-theme rollout.)*
- The game grid/tiles themselves (unchanged).
- Any hub screen.

**Currency note:** the `$`/crypto skin is Owner-approved (`CHARTER.md` #4, tracker "Currency presentation") — do not reject `$` in this screen. `¢` is guest-mode only now.

**Done when:** category rail + search + sort + random all functional per the above; harness `diff` for `games-originals`, `games-chance`, `search-open`, `sort-sheet` at ≤ 0.5% differing pixels (banner masked), both themes, diff images clean on human review; `HomeHub.test.tsx` updated; full suite green; no hardcoded hex, no `$`-rejection, redaction/humans-play-humans untouched.

Ask: ticket as one PR against `HomeHub.tsx` (+ a new client-side categories module + `MenuOverlay.tsx` wiring). One agent — this is `HomeHub`, adjacent to but not inside the `App.tsx` matchmaking collision zone. Hold until #459 is on `main`.

### 2026-09-09#2 — Currency skin: don't bounce `$` on rebuild PRs            [FYI]
From: Advisor   Re: `CHARTER.md` #4 amendment (PR #462, merged)

Heads-up before the first rebuild PR: the registered/investor demo now uses a cosmetic `$` + multi-currency wallet skin over the same integer credits (Owner-approved 2026-09-09). **Do not bounce a rebuild PR for showing `$` instead of `¢`** — that's the intended design now. Guest mode stays `¢`. The stale "`¢` only, reject `$`" line in your merge-gate checklist (2026-09-09#1 item 6) is fixed in #462. Full context: tracker → "Currency presentation". The fixed `$1/$5/$10/$25/$50/$100` stake ladder that replaces free-typed entry is a **separate** workstream (touches core/matchmaking) — not part of any screen rebuild.

### 2026-09-09#1 — Design migration: your role, the merge gate, and the activation trigger            [ACTION NEEDED — see Ask]
From: Advisor   Re: Owner-agreed role model for the old→new design migration (2026-09-09)

**Read `docs/NEW_DESIGN_MIGRATION.md` first — it is the canonical tracker for this whole effort.** This entry is the operating agreement around it.

**What the migration is.** The Designer team shipped a full-spec prototype (`design/prototype/RapidClash Full Spec.html`, on `main` as of PR #458) that defines exact values for every screen. Because the spec is precise, there is little to arbitrate — the work is mostly execution. The Owner has agreed to collapse the Advisor/PM split for this migration along a **scoping+sanity vs execution** line:

- **Advisor** owns `docs/`, owns the migration tracker, pressure-tests each Designer message against the real repo (this has already caught: the Affiliate correction tickets were already merged not in-flight; the prototype doesn't render standalone; three stale data-layer arrays that look authoritative; `18cf9a3` sitting unpushed), tees up Owner decisions, writes each phase's ticket precisely, and builds the setup-phase tooling. Advisor pushes branches, does **not** merge.
- **You (PM)** hold the **review gate AND the merge button for screen-rebuild PRs** — the Owner has delegated the merge here rather than gating every rebuild on himself. You run the parallel execution phase (issues, ≤2 coding agents per the hard cap, review against acceptance criteria) once the repetitive rebuilds start. You keep the tracker's status column honest alongside the board.
- **Owner** makes metric/scope calls and pulls the trigger to activate you.

**What already happened (so you're not surprised).** On 2026-09-09 the Advisor merged three PRs directly under explicit Owner direction: #456 (deploy-record docs), #457 (Ships Battle removed from the platform entirely — 12-game roster now; full pre-removal code archived at git tag `archive/ships-battle`; `CHARTER.md`/`SCREENS.md`/`REPO_MAP.md` updated), #458 (prototype export landed at `design/prototype/`). That direct-merge was a one-time exception. **From here, you hold merge on migration PRs.**

**Open now:** PR **#459** (draft) — `tools/design-fidelity/`, the screenshot-diff fidelity harness (Phase 2). Demo/dev-only, ADR-010 carve-out like `bot-crowd`. Foundation works (hermetic prototype render, 16 references capture in both themes, pixelmatch diff). Advisor is finishing the clip refinement + app-side capture + one worked screen before marking it ready.

**Merge-gate checklist for a screen-rebuild PR** (enforce all):
1. CI green (build + tests).
2. `/code-review` run and its findings addressed or explicitly waived.
3. Harness fidelity meets the bar for every screen the PR touches, **both themes** — the exact bar (a % threshold vs. eyeball-the-diff) is a question out to the Designer right now (`docs/COMMS/from-advisor/TO-designer-harness-and-hero.md` Q1); until answered, treat it as "diff image reviewed by a human, no obvious drift."
4. Matches the acceptance criteria in the ticket.
5. **The stale-array rule** held: built from rendered markup, not the prototype's data layer. `affiliateTiers` (line 4313), `affiliateSteps` (4308), `TIERS` (2896) are dead — must not appear in the rebuild.
6. Recurring invariants intact: tokens not hardcoded hex, server-authoritative redaction unaffected, humans-play-humans, no payment-rail / cash-out / real-value framing. **Currency: the registered demo uses a cosmetic `$`/multi-currency wallet skin over the same integer credits (Owner-approved 2026-09-09) — do NOT bounce a rebuild PR for showing `$` instead of `¢`.** Guest mode stays `¢`. (`CHARTER.md` #4, `NEW_DESIGN_MIGRATION.md` → "Currency presentation".)
7. The screen's row in `NEW_DESIGN_MIGRATION.md` moved to its new status.

**Your activation trigger — two events:**
1. Advisor marks PR #459 ready → you review + merge it (it's tooling, not a screen, but it's the gate everything downstream leans on).
2. Advisor writes the first screen-rebuild ticket (earliest is the Games-page hero, Phase 3) → from that point you run the rebuild phase.

**Held pending Designer answers** (`TO-designer-harness-and-hero.md`): don't ticket the Games hero rebuild until Q4/Q5 (RANDOM button, banner carousel) are back; don't ticket rps/mines/dice until Q6 (are those screens final in the prototype) is back.

**Note on the comms drop folder.** `docs/COMMS/from-advisor/` is gitignored. The migration tracker points at several files there for full detail (`migration-order-of-work.md`, `content-corrections-answer.md`, `light-theme-rollout.md`, `chat-local-transport.md`). If you work from a clean clone you won't have them — the tracker embeds the load-bearing decisions inline, but flag it in `PM_TO_ADVISOR.md` if you hit a pointer you can't follow and the Advisor will promote that doc into tracked `docs/COMMS/`.

Ask:
1. Acknowledge this model in `PM_TO_ADVISOR.md`. If you judge the merge-gate-for-rebuilds change durable enough, fold a short version into `PM_BRIEF.md` (it says to overwrite in place on scope changes).
2. Stand by. Nothing to ticket yet — the Advisor will flag PR #459 ready and post the first rebuild ticket here.
3. When you do get PR #459: it adds four npm deps (`playwright-core`, `pixelmatch`, `pngjs`, `tsx`) under a new `tools/` package that CI's build/lint/test don't touch — the review is "does it typecheck, is it sound," not "does CI exercise it" (it doesn't, same as `bot-crowd`).

### 2026-09-07#6 — Affiliate Overview: remove invented Commission Tiers section, restore 3 icon/artwork faults            [ANSWERED]
From: Advisor   Re: same design file as the last two Affiliate tickets, cross-checked against `design-ref/Affiliate2/` (new screenshots, current-vs-goal)

Dropped via `docs/COMMS/from-advisor/affiliate-remove-invented-tiers.md` (promote verbatim). All four items confirmed precisely — no ambiguity on any of them.

**Commission Tiers — confirmed invented, not in the design file.** Unlike the stats section from the last ticket (a real documentation gap — the original handoff's README simply never described it), this Commission Tiers table is genuinely invented from nothing. Not in the README, not in the design file, and it reuses the real VIP tier names (Bronze/Silver/Gold/Diamond) for a completely unrelated, made-up commission scheme — worth that distinction since it changes the fix from "build what was missed" to "just delete it."

**Icon fixes**: didn't just take the report's word for "check every heading/row pair" — traced all four pairs in the code by function name. Three are already correctly built as separate components (Commission Structure, What Your Players Get, Become a Partner all use genuinely distinct heading-vs-row icons). Only Promotional Materials is a real duplication — literally the same `ScreenPanelIcon` function called twice at different sizes, not two assets. Also caught a third, related usage of that same icon (the Campaigns tab's own heading) that isn't technically in scope of this report's test but is worth a quick Designer call now that Promotional Materials is getting its own dedicated icon — flagged rather than silently changed.

Shield and star fixes are straightforward — confirmed both faults visually against the goal screenshots, recommending wholesale SVG replacement from the design file rather than patching, per the report's own instruction.

Ask: ticket all four as one small pass over `AffiliateHub.tsx` — a deletion (Commission Tiers) plus three icon swaps (shield, star, promo heading).

### 2026-09-07#5 — Affiliate Overview: rebuild hero + stats from the design file            [ANSWERED]
From: Advisor   Re: fourth package from the original four-Designer-package batch, `docs/design-refs/design_handoff_affiliate/` — still on disk

Dropped via `docs/COMMS/from-advisor/affiliate-hero-rebuild.md` (promote verbatim). New screenshots at `design-ref/Affiliate/` (repo-root, gitignored) were the deciding evidence — `IMG_1061.PNG` is current production, the other three are the goal, side by side. They confirm every item in the report exactly: the card wrapper, the completely missing hero art, the sentence-case headline, the missing stats section. No ambiguity left on any of those.

One thing already correct, worth not touching: traced the copy handler directly — it already reconstructs the full `https://rapidclash.com/r/<code>` URL independently, rather than reading from the (correctly, by-design) truncated display text. That acceptance criterion should already pass.

One real bug the report's text never mentioned, found only by comparing the screenshots pixel-by-pixel: the displayed link value is missing its `https://` prefix — a different string from what's actually being copied. Small, easy to miss precisely because the copy behavior already looks right.

One documentation gap worth flagging separately, not blocking this: the original handoff's `README.md` never mentions a stats section anywhere in its own Overview summary — so anyone rebuilding carefully from that doc alone, without opening the `.dc.html` itself, would still have missed it. Not anyone's fault; worth a note for whoever next touches that README.

For all the exact pixel/type values, pointed the ticket at the `.dc.html` file directly rather than transcribing numbers secondhand — that's exactly the kind of drift that caused this rebuild request in the first place.

Ask: ticket as a rebuild of `OverviewTab`'s hero + new stats section, `AffiliateHub.tsx` only.

### 2026-09-07#4 — Menu overlay: navbar backdrop hidden + top padding disconnected from header height            [ANSWERED]
From: Advisor   Re: Designer report + `design-ref/Menu-page/menuIMG_1059.PNG` (same gitignored repo-root `design-ref/` folder as the last two reports)

Dropped via `docs/COMMS/from-advisor/menu-page-padding-navbar.md` (promote verbatim). Both bugs trace to the same underlying cause — values never adjusted when the Menu overlay shipped a few tickets back (#414/#416).

**Navbar backdrop (confident root cause, not a restyle).** `HubToolbar`'s two backdrop layers (the gradient fade + solid fill behind the nav pill) sit at `z-[15]`. The Menu overlay's own full-screen wrapper sits at `z-[18]` — right between the backdrop (15) and the pill itself (20). So the overlay's opaque background paints directly over the backdrop, hiding it, while the pill stays visible above the overlay (same reason the header stays visible — it's `z-20` too). Two layers that should've been bumped to match the pill's z-index when the overlay was introduced, weren't. Compounding it, the overlay's own content uses a flat 24px bottom padding instead of the ~112px `HUB_BODY` clearance every other hub screen imports — so its own last rows scroll up behind the pill instead of stopping short of it.

**Top padding — flagged rather than guessed.** The Account page has no top-padding value to copy — its gap is just what falls out of normal document flow beneath the sticky header, since Account's content lives in normal page flow and Menu's doesn't (it's a fixed `inset-0` overlay, outside that flow, needing its own padding to clear the same header). The current 130px reads like a literal transcribed from the design mock's own coordinate space rather than derived from the header's real height. Recommended measuring the header's actual rendered height live and using that, rather than trusting either the mock's number or guessing a new one.

Also did the requested housekeeping — graduated the Recent Games list ticket to the drop-folder's own `HISTORY/` since it's delivered.

Ask: ticket both parts together (same root-cause category, same file mostly).

### 2026-09-07#3 — Recent Games list: zebra rows, tier icon, result-coloured VS, @ prefix            [ANSWERED]
From: Advisor   Re: Designer report + `design-ref/Recent-Games-List/` (note: singular `design-ref/` at repo root, a different gitignored folder than the tracked `docs/design-refs/` bundles)

Dropped via `docs/COMMS/from-advisor/recent-games-zebra.md` (promote verbatim). Both reference images reviewed directly; they confirm the report precisely — zebra rows with tight/zero gaps, a small tier icon before the username, no avatars/robot glyphs.

Three of the four changes are pure frontend. One needs a real, small backend addition:

1. **Zebra rows** — `GamesCarousel.tsx:553` has the exact spec (74px height, `#1A1A2E`/transparent alternating, 26px/0px radius). Current Recent Games rows (`ProfileHub.tsx:519-524`) use a different, also-legitimate convention (2px gaps, position-based rounding, from the account-page handoff) — this is a deliberate swap, not a bug fix. On "confirm exactly `#1A1A2E`": the code is already that literal value byte-for-byte; if a sampled screenshot disagrees, suspect the reference `.jpg`'s compression before the hex.
2. **Tier icon** — the 🤖 glyph isn't a separate element, it's baked into the stored bot username string, rendered as plain text. Stripping it and always adding `@` are the same one-line normalize helper. Flagged (not blocked) for an explicit yes rather than a silent change: this touches ADR-010's bot-honesty labeling, though only on a personal, retrospective match-history row, not the lobby where informed consent is load-bearing.
3. **The real gap** — `RecentMatchEntry` has no `opponentTier` field today; `MatchRow`'s own comment already says so ("dropped rather than fabricated") from when the feature first shipped. Closing it needs one small server-side addition (reusing the existing `tierForXp`) plus a shared-type change — genuinely new work, not styling.
4. **VS colour** — trivial, outcome already reaches the client, the span is just hardcoded grey today. Open question flagged, not guessed: neither the report nor the reference images say what colour a draw should be.

Also did the requested housekeeping: confirmed the two Rewards-page screenshots (found in this same `design-ref/` folder — different path than checked last time) show exactly the bug already fixed in the shipped Rakeback ticket, nothing missed. Graduated both prior tickets to the drop-folder's own `HISTORY/` as shipped-not-yet-deployed.

Ask: ticket both (backend unblocks the icon rendering but not the rest of the frontend work — parallel, wired together at the end).

### 2026-09-07#2 — Rewards page: Rakeback locked state (real fix) + accrual (already built)            [ANSWERED]
From: Advisor   Re: Designer report, docs/design-refs/Rewards-page not found on disk (flagged, not blocking this time)

Dropped via `docs/COMMS/from-advisor/rewards-rakeback.md` (promote verbatim). Part 1: `RewardsHub.tsx`'s Rakeback card never gates on tier — confirmed exactly as reported. Fix is copy-paste-grade: `VolumeBonusCard` in the same file already has the identical locked pattern to reuse; recommend extracting it into one shared component so the two cards can't drift.

Part 2: checked `packages/core/src/rewards.ts` + `rewards.test.ts` against every rule in the report — formula, win/loss accrual (both players get the match-level outcome, not their individual result — matmaking.ts:842-844), draws/void accrue nothing, tier frozen pre-match, Unranked = 0%, instant no-batching accrual, claim semantics, no expiry. All already implemented and tested, several tests using near-identical wording to the report. No new backend code needed — recommend running the existing suite plus one live "play a match, check the Rewards page" pass, and report back closed rather than build anything.

Ask: ticket Part 1. Verify-and-close Part 2.

### 2026-09-07#1 — Scripted opponent behavior: bot-crowd decision quality + timing            [ANSWERED]
From: Advisor   Re: Designer report relayed by Owner; 2 screenshots mentioned, never arrived — flagged separately

Dropped via `docs/COMMS/from-advisor/scripted-opponent-behavior.md` (promote verbatim). Scoped to `tools/bot-crowd` only, not guest mode (the XP/recent-games tell in the report rules guest mode out — its ledger is isolated and never wired to Rewards). Chess and Blackjack already have working heuristics sitting in `apps/server/src/guest/index.ts` (Guest Mode's Demo Opponent) — just need extracting to somewhere both that and the external `tools/bot-crowd` process can import; no new chess engine, no Designer-proposed Chess omission needed. Mines/Hilo's cash-out ask is a mechanic that doesn't exist in this project's redefinitions (verified against both docs and the actual `legalMoves`) — current bot play already matches the correct strategy, no change needed. Biggest generally-useful fix: replace the single fixed 700ms move-delay constant (used for every game today) with a randomized, per-game-scaled range — that's the one thing currently too-fast-to-be-human everywhere, not per-game. Explicit recommendation against any outcome-rigging mechanic for the "no bias" ask — fairness should come from bot skill calibration plus the already-fair RNG, never from treating a specific player's account differently.

Ask: confirm scope + the no-rigging stance, then ticket the 4 items in the drop file. Chase the 2 missing screenshots in parallel, not blocking.

Let me know once the screenshots are placed somewhere I can reach, and I'll fold in whatever they show before this goes further.

### 2026-08-23#2 — CONTROLS section icons — restore the design file's SVGs            [OPEN — small, contained fix]
From: Advisor   Re: Designer report (docs/design-refs/Problem1), verified against the shipped code

Dropped via `docs/COMMS/from-advisor/controls-icons-fix.md` (promote verbatim). Diagnosis confirmed exactly: `ProfileHub.tsx`'s CONTROLS rows use lucide-react outline icons (IdCard/ShieldCheck/Lock/HeartHandshake/UserX/HelpCircle/Settings/Handshake) plus lucide's ChevronRight for every row's arrow — all stroke glyphs, all "reasonable semantic matches," exactly the failure mode the Designer named.

Two corrections to the report itself, not the diagnosis: (1) the CONTROLS header gear needs no change — it's already hand-built inline SVG, pixel-identical to the supplied `controls-header-gear.svg`, never substituted. Scope is 8 row icons + the chevron, not all 10 nominally listed. (2) The "must render correctly in light mode" acceptance criterion doesn't apply — this screen is deliberately dark-only today (`ProfileHub.tsx:59-65`'s own comment), same still-open app-wide-theming question already flagged on the Account and Menu tickets, not something to resolve inside this bug fix.

Wiring note: transcribe the supplied SVGs as inline JSX with colors from the existing `RC` JS object (`RC.muted`/`RC.surface`/`RC.sunken`/`RC.purple` — already the exact hex values the SVGs fall back to), not new CSS custom properties — matches how the header gear already does it, and avoids the "third palette" this file's own comment explicitly warns against.

Ask: ticket as a straightforward one-file bug fix.

Summary: confirmed the Designer's diagnosis is exactly right, scoped it down from "10 files" to the 9 that actually need changing, and steered the color-wiring and the light-mode expectation to match how this screen is actually built rather than passing the report through as literal instructions.

### 2026-08-23#1 — Affiliate — last of the four Designer packages            [OPEN — one decision needs your read before ticketing]
From: Advisor   Re: Menu (#413-#417) confirmed shipped; this closes the batch

Dropped via `docs/COMMS/from-advisor/affiliate.md` (promote verbatim). Read the handoff directly, not a summary — unlike Account/Navbar/Menu, there's genuinely no existing backend to point at here (confirmed by grep, still zero hits for affiliate/referral anywhere in apps/server or packages/core), and the Designer's own doc leaves the claim-confirmation flow and the MATERIAL tab explicitly undesigned.

Recommendation stated plainly in the doc: build the whole section as session-local client state — a client-side-minted referral code, campaigns created into local state (not a database), a static commission-tier table, a seeded mock claimable balance so CLAIM is actually pressable — genuinely interactive (real clipboard copy, real form validation, real toasts) but nothing persisted or server-computed. This matches the Owner's static-over-dynamic guidance from earlier this week better than inventing a referral/campaign data model the Designer hasn't finished specifying. If a real backend is actually wanted instead, that's a materially bigger ticket, not a variant of this one — flag back if so.

Two items shipped exactly as the Designer's own doc says to: Referred Users' empty state (that's the designed default, not a placeholder), and MATERIAL tab left genuinely empty (explicitly "do not implement from guesswork").

Ask: confirm the mock-vs-real call, then ticket. This is the last of the four packages from this batch.

### 2026-08-22#2 — Menu overlay — next in the sequence, last item blocked on Navbar            [OPEN — ready to ticket]
From: Advisor   Re: Account/Navbar shipped, Menu overlay next in the agreed sequence

Dropped via `docs/COMMS/from-advisor/menu-overlay.md` (promote verbatim). Source: `docs/design-refs/design_handoff_menu/` (`README.md` + `screenshots/`). Recreate in the codebase's existing React/Tailwind primitives, not the `.dc.html` prototype's markup — same instruction as the last two handoffs.

This closes the loop the Navbar ticket deliberately left open: `HubToolbar.tsx`'s Menu item is still `comingSoon` (correctly — the overlay didn't exist yet). This ticket includes flipping it live: real `onClick` opening the overlay, and the active-highlight treatment the design specifies ("the Menu nav icon turns `#8B45F0`" while open) — the same `active`-prop pattern the other three real nav items already use.

Scope is smaller than the row count suggests, matching the prototype's own behavior, not a cut corner. The README says so explicitly: "In the prototype only Affiliate program, Rewards/VIP, Games and Rewards/VIP (footer) navigate; the rest are placeholders for real routes." Recommend matching that exactly this round:
- Rewards/VIP (EARN group + footer link) → wire to the existing `onOpenRewards` callback, same one every other hub screen already uses.
- Games (footer link) → wire to the existing `onOpenGameList` callback, same pattern.
- Affiliate program (EARN group) → route to the same lightweight placeholder screen the Account-page ticket already introduced for its own Affiliate row — one shared placeholder destination, not a new one per package.
- Every other row (GAMES group's 4, COMPETE's 4, PLATFORM's 4, SUPPORT's 3, and the footer link-grid entries beyond Games/Rewards) — placeholder, matching the reference prototype. Real routes are their own future tickets as those screens get built.

Implementation notes: data-driven row config per the handoff's own recommendation (one source of truth per group's `{icon, label, route}` list, not hand-coded JSX per row). Overlay reveal origin: the design's `clip-path: circle(0px at 55px 797px) → circle(1000px at 55px 797px)` is the mock's fixed viewport coordinate for the Menu button's position — compute the real origin from the actual button's runtime position (`getBoundingClientRect()` on the Menu nav item), don't hardcode that literal coordinate. Row icons are inline SVG in the source markup, copy as-is; the Menu nav icon itself is already shipped (`HubToolbar.tsx`'s `ICON_MENU`), unrelated to these new row icons.

One open flag, don't decide silently: Menu's own doc says "Theme is switchable (set in Account → Preferences)," same assumption Account's Preferences screen made — and that ticket deliberately scoped the Light theme to the Preferences page only, not app-wide (no live app-wide theme-swap exists in the codebase yet). Two packages now assume this exists. Recommend: build Menu dark-only for now too, consistent with that same scoping call, and treat a real app-wide light theme as its own future ticket if actually wanted — flagging rather than deciding, since this now affects more than one screen.

Small, unblocking nudge, not a blocker: PLATFORM's "Provably fair" row is the same messaging point raised when this handoff was first reviewed — a positioning suggestion for the Designer, not a compliance issue.

Ask: this is the last item blocked on Navbar — nothing else depends on it shipping. After this, only Affiliate remains from the original four packages, still recommended as its own dedicated session per the open data-model decisions noted earlier.

### 2026-08-22#1 — Account/Preferences first, Navbar second — Designer handoffs            [OPEN — ready to ticket, in this order]
From: Advisor   Re: Owner's sequencing call — Account+Preferences today, Menu/Affiliate deferred

Dropped via `docs/COMMS/from-advisor/account-and-navbar.md` (promote verbatim). Two things worth knowing before ticketing Part A: this is a **redesign of the live, tested `ProfileHub.tsx`**, not a new screen — and the new design drops the current ledger-transaction list + leaderboard section in favor of a recent-games match history, which needs one new small per-player endpoint (checked: doesn't exist today, only `GET /matches/:id` for a single match). VIP progress is closer to free than "reuse an endpoint" — the screen already fetches `/rewards` for `wageredLifetime`; it's just reading more fields off a response already in hand. Three Preferences scope defaults stated explicitly (light theme scoped to the page only, not app-wide; localStorage not a new server table for toggles; Tipping cut this round) — override any of them if the Owner disagrees, don't silently keep going past the noted default.

Part B (Navbar) corrects an earlier draft finding: Menu/Chat already exist today as intentional `comingSoon` disabled placeholders (`HubToolbar.tsx:42,46`), not a missing slot — verified directly against the shipped file. Keep Menu inert this round (the code's own stated principle: never a live-looking button with no destination); flip it live in the same change as the Menu package itself, next round. Also flagged: use the already-resolved `#8140e2` active-color token, not the design doc's stale `#8B45F0` literal (same conflict already fixed for the footer this week).

Ask: ticket Part A now; Part B once A is merged or well underway.

Summary: Part A (Account/Preferences) is scoped to ship today, Part B (Navbar) right behind it — both with precise file:line grounding against the actual shipped code, not just the design docs. Menu and Affiliate stay out of this prompt per the agreed order.

### 2026-08-21#1 — Gated VM: weighted per-game rester config, hard-capped at the existing 34-name pool            [OWNER-APPROVED — ready to ticket]
From: Advisor   Dropped via `docs/COMMS/from-advisor/gated-vm-weighted-games.md` (promoted verbatim)

**Status: OWNER-APPROVED — ready to ticket.** Replaces both earlier ideas (uniform lane-count change, separate "spare seats" vector) with one mechanism. `GATED_ROSTER_NAMES` stays at 34 — Owner explicitly confirmed no padding, that number is fixed as-is.

## 1. Why

Designer wants visual variety across all 12 currently-displayed games (every game gets at least one taker so any game an investor tries gets a match, plus at least one resting bot-waiter for visible variety), with some games allowed extra presence beyond the baseline. Doing this as two coordinated parameters (a game list + a separate distribution vector) is more moving parts than needed — fold it into the one parameter already there.

## 2. What changes — all in `tools/bot-crowd/src/config.ts`

### A. `TAKER_ONLY_GAMES` grows an optional weight suffix
`gameId[:N]` — `N` omitted defaults to `1`. Example: `TAKER_ONLY_GAMES=coinflip:3,blackjack:3,chess:3,rps:3,mines,crash,roulette,dice,baccarat,keno,limbo,hilo` (the un-suffixed entries are weight 1). Each game still gets exactly **one taker** regardless of weight — weight controls **rester count only**.

### B. Resters generated via the existing `randStake()` helper, looped
Replace `GATED_RESTER_STAKES`'s three hand-crafted named lanes (`GATED_RESTER_LANE_A/B/C`) with: for each game, call the general roster's own `randStake()` (already filters `HUMAN_RESERVED_STAKES`) once per requested rester. Net simpler than what's there today — no bespoke lane logic to maintain, and stake variety scales naturally with weight instead of being fixed at 3 flavors.

### C. Name-index math: running offset, not a flat multiply
Today's `base = gi * identitiesPerGame` assumes every game costs the same number of identities. With variable weights it needs a running sum of `(1 taker + previous games' resters)` instead. Contained change, same function.

### D. Overflow policy — exact rule, so nobody has to improvise it mid-review
Process `TAKER_ONLY_GAMES` **in list order**. For each game, its full block (1 taker + its N resters) is allocated **atomically** against the remaining `GATED_ROSTER_NAMES` budget. **The moment a game's whole block doesn't fit in what's left, drop that game and every game after it in the list — entirely, not partially.** No error, no startup failure, no validation prompt — silent by design, per the Owner's explicit call. Do emit one informational log line at startup naming which game(s), if any, got dropped and why (budget, not a bug) — purely for whoever's debugging "why did I only see 10 games," not a blocker.

Rule of thumb this produces: **earlier entries in the list are guaranteed; later entries are only as safe as the budget** — put the games you most need on-screen first.

### E. `GATED_ROSTER_NAMES` — no change
Stays at its current 34 entries. Not a scope item here.

## 3. Deployment-sequencing warning — read before merging

**The live VM's current env is `TAKER_ONLY_GAMES=coinflip,blackjack,chess` — no suffixes.** Under the new default-weight-1 semantics, deploying this code *without* also updating that env file will silently shrink those three games from their current 3 resters each down to 1 — a real regression on what's already live, not just a no-op for new games. **The env file update and the code deploy must land together**, not code-first-then-env-later. Flagging this explicitly because it's exactly the kind of gap that bit this VM once already (the `TAKER_STAKE=1` leftover).

## 4. Illustrative example only — not a mandated distribution

One valid assignment matching the "12 taker + 12 baseline rester + flexible extra" shape discussed, shown only to demonstrate the mechanism — **the actual weights are the Owner's/Designer's call once this ships**, not mine to prescribe:

```
TAKER_ONLY_GAMES=coinflip:3,blackjack:3,chess:3,rps:3,mines,crash,roulette,dice,baccarat,keno,limbo,hilo
```
12 takers + (4×3 + 8×1) = 12 + 20 = **32 identities**, 2 under the 34 cap — room to bump two more games by one each if the full budget should be used. Exact numbers, and which games get the extra presence, are a product call for whenever the Owner/Designer actually sets this.

## 5. Suggested test coverage (small, targeted)
- Weights summing exactly to 34 → every game's full block allocated, nothing dropped.
- Weights summing over 34 → correct atomic drop of the trailing game(s), never a partial (taker-less rester or rester-less taker) block.
- A bare `gameId` (no suffix) → weight 1, matching today's minimum.

## Ask

Ticket the above (§2 A-D is the code; §3 is a same-PR ops step, not a follow-up). Small, contained — similar size to the earlier multi-stake resting-pool work (#365).

### 2026-08-20#2 — Investor bot economy refinement: prefix-gating replaces the reserved-account pool            [OPEN — supersedes #362's shipped taker gating]
From: Advisor   Re: Owner refinement on my 2026-08-20#1, same drop file updated in place

`docs/COMMS/from-advisor/investor-bot-economy-real-ledger.md` §B updated in place (not a new drop): the taker no longer gates on an exact-name allowlist requiring 2-3 pre-registered reserved accounts. Instead, gate on a **username prefix** — any self-registered account whose name starts with `Demo` (case-sensitive, matching the existing single `Demo` account's convention) qualifies automatically. An investor registers `DemoAcmeCapital` or whatever they like through the normal Charter-step-1 flow, no Owner provisioning step at all.

**Code change needed, on top of what #362 already shipped**: `tools/bot-crowd/src/bot.ts`'s `isTakeable()` (added by #362) currently checks `config.takerAllowNames.includes(c.ownerName)` (exact match against a list) — becomes `c.ownerName.startsWith(config.takerAllowPrefix)` (new env-configurable `TAKER_ALLOW_PREFIX`, default `'Demo'`). Simplest to replace the exact-list mechanism outright rather than maintain both. Not a new risk: an unrelated visitor who happens to name themselves `Demo*` also gets guaranteed-instant matching — harmless, ADR-010's honesty test holds regardless of who's on the other side of an honestly-funded real account.

Net effect once shipped: the ops account-provisioning step disappears entirely. §5's single remaining confirm (same host vs. separate for the general roster + gated taker) is unchanged from the original drop.

Ask: ticket the prefix-gating change as a follow-up to #362 (already merged with the old exact-list mechanism).

### 2026-08-20#1 — Real-ledger investor bot economy: retire the VM's start/stop, multi-stake taker parity            [OPEN — Owner-approved, ready to ticket]
From: Advisor   Re: real-ledger counterpart to the shipped guest-mode bot economy (#350-354), deliberately different architecture

Dropped via `docs/COMMS/from-advisor/investor-bot-economy-real-ledger.md` (promote verbatim). Follows `GUEST_MODE_STRATEGY.md`'s original two-lane design: investors get the normal, registered, full-surface demo — not guest mode. The gap: `docs/DEMO_TAKER_VM_SETUP.md`'s plan-B taker only exists if the Owner remembers to start the VM first. This brings that up to guest mode's just-shipped multi-stake polish, entirely inside `tools/bot-crowd` — **never `apps/server`/Cloud Run**.

**Safety model, explicitly different from guest mode's ledger isolation**: this lane runs on the real ledger, so safety instead comes from `tools/bot-crowd` staying physically outside the deployed app (confirmed: not in the root `tsc -b` build, not imported by `apps/server`, not in the Docker image) plus ADR-010's existing allowlist-gated-taking / ungated-resting distinction, both already true today and unchanged by this ticket.

**What changes**: (A) ops-only — stop stopping the `demo-taker` VM, it's free-tier eligible; (B) ops-only — register 2-3 reserved investor accounts instead of one shared login; (C) actual code — generalize `tools/bot-crowd`'s gated single-stake taker (`TAKER_STAKE=1` fixed) into a multi-stake resting pool + an exclude-one-stake taker, mirroring guest mode's `ensureDemoBotResting`/taker generalization; (D) no client work needed — a real account already renders the real `GamesCarousel`/Open Games/leaderboard/etc. as-is.

Two small non-blocking confirms flagged: run the general roster + gated taker on the same host or separate (Advisor recommends same), and reserved-account count (3 recommended, matching the guest Chess/Blackjack pool-of-3 convention).

Ask: ticket the code piece (§C) against `rapidclash-demo` even though the code is `tools/`-scoped. §A (leave the VM running) can happen today, independent of the ticket.

### 2026-08-17#1 — Guest-mode bot economy: multi-stake bot-waiters + bot-takers + a live list            [OPEN — Owner-approved, ready to ticket]
From: Advisor   Re: Owner + company management aligned in chat; extends the existing guest-mode isolation architecture, not a new mechanism

Dropped via `docs/COMMS/from-advisor/guest-mode-bot-economy.md` (promote verbatim). Solves the "investor opens the link on their own schedule, nobody's around to start a bot process" gap — by extending `apps/server/src/guest/index.ts`'s already-isolated, always-on guest matchmaking (currently one fixed-stake auto-paired bot per curated game) into: several bot-waiters per game at varied stakes, a bot-taker for whatever stake a guest posts, and a visible in-app list instead of silent auto-pairing. Stake `1` reserved for human-to-human testing (mirrors `tools/bot-crowd`'s `HUMAN_RESERVED_STAKE=100`, opposite end, separate isolated world). Hard boundary carried over from the existing architecture: stays inside the guest-isolated `Matchmaking`/`EphemeralLedger` instance — never becomes visible to real signed-in users (that's `tools/bot-crowd`'s job, untouched here). Five suggested issues + sequencing + exact file:line pointers (`App.tsx`, `GameHub.tsx`, `guest/index.ts`, `packages/shared/src/guest.ts`) are in the drop file.

Ask: ticket the five issues (granularity is PM's call). No Owner round-trip needed on the exact stake values/count — only flag back if the FIFO exact-key pairing constraint makes "varied stakes" awkward to implement as anything other than a small fixed set once in the code.

### 2026-08-15#3 — Footer gradient is invisible — navy-on-navy compositing bug            [OPEN, verified live with real measurements]
From: Advisor   Re: Owner report + photo, root-caused precisely — a structural mistake in #337/#338, not a new ask

Dropped via `docs/COMMS/from-advisor/footer-gradient-invisible-fix.md` (promoted verbatim). Root cause, measured live: `HubFooter.tsx`'s `<footer>` carries `bg-surface` (`#1A1A2E`) across its whole box, and the gradient div is a *child* of that already-navy footer — so its `rgba(26,26,46,0)→rgba(26,26,46,1)` ramp composites navy-on-navy, genuinely invisible. The real hard edge is at the footer's own top, a one-pixel jump from the page's `#0B0B0B` straight to `#1A1A2E`.

Fix: split the single `<footer bg-surface>` into two siblings, matching the original design source — (1) `<footer>` itself goes transparent, letting the page's black show through so the gradient's `0%` stop reads as real black; (2) a new inner wrapper, carrying `bg-surface`, wraps everything from the wordmark onward (its top edge lines up with the gradient's bottom, no seam since the gradient's `100%` stop is already opaque navy matching it exactly); (3) the gradient div goes full-bleed while the new content wrapper keeps the horizontal inset (currently both wrongly share the footer's `px-4`).

Ask: single file, single PR — the third footer-positioning correction in a row; Advisor wants to verify this one live against a zoomed screenshot before calling it done.

### 2026-08-15#2 — Footer's last row is hidden behind the bottom nav — regression from #338            [OPEN, verified live]
From: Advisor   Re: my own footer-gap-fix (#337/#338) fixed the gap but broke bottom clearance — owning this fully

Dropped via `docs/COMMS/from-advisor/footer-toolbar-clearance-fix.md` (promoted verbatim). Verified live on production, Home page: ~85.7px of the footer's bottom row (bolt + "18+" line) sits permanently behind the fixed `HubToolbar`, unreachable by scrolling even at true `scrollHeight` max.

Root cause: `HUB_BODY`'s `pb-[calc(7rem_+_env(safe-area-inset-bottom))]` exists specifically so the content container's *last child* clears the fixed toolbar. Before #337, `HubFooter` was that last child. #337 moved `<HubFooter>` outside the padded container to fix the leading-gap bug — correctly, but that also moved the clearance padding to sit above the footer instead of below it, leaving the now-genuinely-last footer with zero reserved clearance.

Fix: `HubFooter.tsx` itself takes ownership of the trailing clearance (`pb-6` → the `HUB_BODY` padding value, imported from `layout.ts` rather than retyped), and the padding is removed from all four content-div call sites (`HomeHub.tsx`, `GameHub.tsx`, `ProfileHub.tsx`, `RewardsHub.tsx`) since the footer now owns both its leading (from #337) and trailing space.

Ask: same 5 files as #337. Verify via `footer.getBoundingClientRect().bottom <= toolbar.getBoundingClientRect().top` at true scroll-max on all four pages, not a screenshot alone.

### 2026-08-15#1 — PWA service worker never actually auto-updates — affects every deploy            [OPEN, high priority]
From: Advisor   Re: Owner reported "reloaded dozens of times, still see old footer" — root-caused, not a footer bug

Dropped via `docs/COMMS/from-advisor/pwa-update-not-applying.md` (promoted verbatim). Fetched the live served files directly: `vite.config.ts` sets `registerType: 'autoUpdate'`, but the actually-shipped client never calls `virtual:pwa-register`'s `registerSW()` — only the bare, one-time `/registerSW.js` auto-injected script runs, which registers the service worker once and never checks for updates again. A device with the site already open keeps serving whatever bundle it first cached, through any number of ordinary reloads, until something outside the app's control forces a refresh. **This is not specific to the footer work — every deploy since the PWA/service worker was added has silently had this problem for returning users.**

Fix: call `registerSW({ immediate: true, onRegisteredSW })` from `main.tsx`, with a periodic `registration.update()` poll (hourly suggested) inside `onRegisteredSW` — the piece that was entirely missing. Check the installed `vite-plugin-pwa` version's exact API before implementing; also confirm whether `injectRegister: null` is needed to avoid a double-registration once the manual call is added.

Ask: recommend this jumps the queue ahead of the footer-toolbar-clearance fix (same folder) — every visual fix already shipped is invisible to any device that had the site open before that deploy, which is exactly what happened here.

### 2026-08-14#7 — Footer: eliminate the black gap above the gradient band            [OPEN — root-caused, one PR]
From: Advisor   Re: Designer follow-up on merged #335, owning an incomplete original spec

Dropped via `docs/COMMS/from-advisor/footer-gap-fix.md` (promoted verbatim). Confirms exactly the concern the PM flagged when reviewing #335: the gradient band isn't achieving a visible transition. Root cause — margins stacking three deep before the gradient's first pixel (footer's own `mt-4` + gradient div's `mt-6` + each page's own parent flex gap, which differs per page: 64px on Home, 56px on Games, 60px on Account, 40px on Rewards), producing a visible flat-black band and silently breaking the original footer ticket's "pixel-identical across pages" criterion.

Fix: move `<HubFooter>` out of each page's gapped flex container to sit as a sibling after it (mirroring `HubToolbar`'s existing outside-the-gap pattern), drop the footer's own redundant `mt-4`. The gradient div's `mt-6` becomes the entire, single, page-independent leading gap — matching the design's one `margin-top:24px` value everywhere. Touches `HubFooter.tsx` + all 4 call sites (`HomeHub.tsx`, `GameHub.tsx`, `ProfileHub.tsx`, `RewardsHub.tsx`).

Ask: one PR, 5 files. Ping once up — will check all four pages' gap against each other this time, not just against the design once.

### 2026-08-14#6 — Footer: 4 drift fixes            [OPEN — single file, single PR]
From: Advisor   Re: Designer request, verified against the code + the original design transcription

Dropped via `docs/COMMS/from-advisor/footer-drift-fixes.md` (promoted verbatim). One file: `HubFooter.tsx`. Four corrections: (1) Discord icon is a hand-drawn approximation, not the verbatim design path — root cause found, exact path provided (21×21, was 20×20); X/Telegram/Instagram are also approximations but explicitly left alone per the brief's own scope. (2) Footer background should be `bg-surface` (`#1A1A2E`, already this app's token) not `bg-background`, plus a gradient band above it (verbatim stops/height provided) — currently missing entirely. (3) Column heading colour — flags a source conflict (design file says `#8B45F0`, the Designer's written correction says `#8140E2` which is this app's actual `--brand-purple`/`text-brand` token) and recommends the token per the written value. (4) Heading/link size hierarchy: headings `11px`→`15px`/`tracking-[1.4px]`, links `12.5px`→`14px`.

Ask: single file, single PR, small — ready to ticket.

### 2026-08-14#5 — Typography Step 1: fonts genuinely missing, verified live            [OPEN — ship alone, hold Steps 2-4]
From: Advisor   Re: Designer request, verified live in production

Dropped via `docs/COMMS/from-advisor/typography-step1-font-loading.md` (promoted verbatim). Confirmed three ways: `index.html`/`main.tsx` load no font for "Space Grotesk" or "Inter Tight" (only plain Inter); live `document.fonts` in production shows zero entries for either; three files (`RewardsHub.tsx`, `GamesCarousel.tsx`, `RcIcon.tsx`) already declare `font-family: 'Space Grotesk'` in CSS that's silently falling back to Arial since the font was never registered. Fix: add `@fontsource/space-grotesk/700.css` + `@fontsource-variable/inter-tight` alongside the existing Inter import in `main.tsx`. Likely fixes those three files' rendering for free, no code change beyond the import.

**Companion doc `typography-steps2-4-type-scale.md` (same folder) is explicitly NOT to be ticketed yet** — its own verification method (screenshot/visual diffing against an exact type-scale table) is meaningless until this step's fonts are confirmed actually rendering live, not just requested. Hold for Step 1's merge + live devtools verification first.

Ask: ship as its own small PR, verify live (devtools Fonts panel, not just computed style) before reporting done.

### 2026-08-14#4 — Bottom nav: fix icon paths + sizing to match the design file            [OPEN — single file, single PR]
From: Advisor   Re: Designer request (HTML + screenshot), verified against the code

Dropped via `docs/COMMS/from-advisor/navbar-icon-fix.md` (promoted verbatim). One file: `HubToolbar.tsx`. The screenshot only calls out Games/Rewards, but the source file (`design-ref/navbar/RapidClash Navbar.html`) changes all five icons' path data plus icon size (23px→24px) and bar vertical padding (10px→12px) — verified byte-by-byte against the current `ICON_*` constants, not assumed from the screenshot. Games and Rewards are full icon swaps (spade→bolt mark; plain box→two-part bow+box); Menu/Account/Chat are proportion refinements. Fill/tint mechanism (`currentColor` + class-driven) is unchanged — only geometry and sizing move.

One flagged, deliberately out-of-scope item: two colour-token deltas (brand purple, muted gray) a few points off between the file and the app's real tokens — both used sitewide, correcting them here would be an unauthorized app-wide rebrand, not a navbar fix. Left untouched, worth its own ticket if the Designer wants it.

Ask: ready to ticket — single-file, single-PR fix.

### 2026-08-14#3 — Shared footer everywhere + RC-icon balance/credits sitewide            [OPEN — split into 2 PRs]
From: Advisor   Re: Designer request, verified against the code — two independent halves

Dropped via `docs/COMMS/from-advisor/footer-and-rc-icon.md` (promoted verbatim). Two unrelated asks, recommend two PRs:

1. **Shared footer** — rewrite `HubFooter.tsx`'s contents wholesale (verbatim design markup: wordmark, social icons, 4 link columns, disclaimer, copyright, 18+ mark), keep the same component/export name (4 call sites once done: `HomeHub.tsx`/`GameHub.tsx` already render it, add it to `ProfileHub.tsx`/`RewardsHub.tsx` which render no footer today). Only `Games`/`Rewards` links are real (thread existing callbacks); every other link is inert by design (no handler, not disabled).
2. **RC-icon sitewide** — Owner-expanded beyond the literal screenshot to the full `¢`-symbol convention, not just the header balance chip. Real architecture change: extract a shared `RcIcon` (currently duplicated as `GamesCarousel.tsx`'s `RcIcon` and `RewardsHub.tsx`'s `RcCoinIcon` — same SVG, different names), add a `<Credits amount={n} />` component, migrate ~10 files' visible `{formatCredits(x)}` JSX to it. `formatCredits()` itself stays unchanged for non-visual/plain-text uses.

Ask: recommend two PRs given the unrelated blast radius. Ping me once up for the pixel-diff/grep-verification pass on both.

### 2026-08-14#2 — Move Bring-a-Rival banner below the Open Games block            [OPEN — trivial]
From: Advisor   Re: Designer request, verified as a two-line reorder

Dropped via `docs/COMMS/from-advisor/bring-a-rival-reorder.md` (promoted verbatim). `HomeHub.tsx`: swap `<BringARival />` and `<GamesCarousel />`'s order (both direct children of one `gap-6` flex column, so no spacing/margin work needed either way), `<HubFooter />` unchanged after. No test changes — no order-dependent assertions exist on either component.

Ask: ready to ticket — small enough to ride along with another PR if preferred, standalone is fine too.

### 2026-08-14#1 — Reuse GamesCarousel everywhere; retire the old OpenGamesTicker            [OPEN — one PR]
From: Advisor   Re: Designer request, verified against the code before dispatch

Dropped via `docs/COMMS/from-advisor/open-games-consolidation.md` (promoted verbatim). The Designer flagged a duplicate Open Games implementation: `GameHub.tsx` (every per-game hub) still renders the older `OpenGamesTicker`/logged-out teaser card (`OpenGames.tsx`, pre-#305), while `HomeHub.tsx` already moved to the newer, tabbed `GamesCarousel` (issue #305). No markup extraction needed — `GamesCarousel` is already standalone. Scope: swap `GameHub.tsx`'s ticker/teaser branch for `<GamesCarousel>`, wire one missing prop (`onTakePublicChallenge`, already exists in `App.tsx`, just not threaded to this call site), add a `joinDisabled` prop to `GamesCarousel` (a real functional guard the old ticker had that the new component doesn't yet), and sweep the now-fully-dead `OpenGamesTicker`/`PublicOpenGamesTicker` (the latter already orphaned since #305) plus their now-unused helpers out of `OpenGames.tsx`.

Ask: ready to ticket.

### 2026-08-13#3 — Two new avatar presets (meme-style)            [OPEN — assets in hand, ready to build]
From: Advisor   Re: Designer request, assets Owner-approved and verified before dispatch

Dropped via `docs/COMMS/from-advisor/avatar-presets-meme.md` (promoted verbatim). Two new presets ship: a grayscale hooded "wojak" figure and a "DEGEN"-branded hooded figure — both already committed at `docs/design-refs/avatars/` (tracked, Owner-placed). **Two of the five candidates the Designer supplied are deliberately excluded**: Pepe the Frog (actively-enforced copyrighted character, wrong fit for a wagering platform) and Doge (derives from a copyrighted photograph). Not a placeholder exclusion — don't substitute or re-propose them.

Touches four files with the same small edit each: `packages/shared/src/protocol.ts`'s `AvatarId`/`AVATAR_IDS`, `Avatar.tsx`'s `PRESETS` map, `ProfileHub.tsx`'s `PICKER_AVATARS`. Also update `apps/web/src/assets/avatars/CREDITS.md` with an honest licence note for the new pair (meme-culture provenance, not independently verified — Owner-accepted risk).

Ask: ready to ticket now — nothing left blocking this one.

### 2026-08-13#2 — Games page carousel + new Rewards/VIP system            [OPEN — split into 4 issues]
From: Advisor   Re: Designer request, verified against the code + design file before dispatch

Dropped via `docs/COMMS/from-advisor/games-and-rewards.md` (promoted verbatim). Full spec there: design export decoded at `design-ref/games-and-rewards/` (gitignored, 20 assets extracted). Recommends splitting into 4 issues: (A) Games-page carousel wired to the real open-challenges feed, (B) Rewards backend (XP/tier/rakeback/volume-bonus/claim, all new), (C) Rewards page frontend + ProfileHub lifetime-wagered addition (depends on B), (D) asset commit. A/D can start immediately in parallel; B before C.

Three Owner decisions already made in chat and locked into the spec (not re-asked): race/rank tabs stay static placeholder (out of `CHARTER.md` scope), the design file's Quests section + its second decorative tier list ship static-only (the real 6-tier system is `VIP_ROWS`), "RC WAGERED" appears in both the new Rewards page and as a new ProfileHub line.

Ask: split into the 4 issues above; ping me once PRs are up for the pixel-diff read against the design file, same as the other two Designer tickets.

### 2026-08-13#1 — Bring a Rival: Designer banner replacement + copy-link action            [NEEDS-OWNER — accessibility call + missing asset files]
From: Advisor   Re: Designer request, verified against the code before dispatch

Dropped via `docs/COMMS/from-advisor/bring-a-rival-banner.md` (promoted verbatim). Full spec there: replace the current inert "Bring a Rival" card (`apps/web/src/components/hub-shared/BringARival.tsx`, one shared component, two call sites — Home hub + every game hub via `GameHub.tsx`) with the Designer's final export markup verbatim, wire the CTA to copy `https://rapidclash.com` to the clipboard with a toast, and rewrite the one test (`HomeHub.test.tsx:142-165`) that currently asserts token-only styling and would otherwise fail on purpose against the export's required inline hex.

**Open question for the Owner, explicitly not mine or the PM's to decide:** ship the CTA as a non-focusable `<div>` exactly as exported (Designer's literal instruction — "attach the handler additively via an id/data attribute only, do not change the element type"), or add minimal keyboard/screen-reader support (`role="button" tabIndex={0}` + Enter/Space handling) even though the brief only authorized an id/data attribute? Recommend asking the Designer directly since it's their scope lock to waive.

Ask: dispatch as an issue once read; ping me when the PR's up for the pixel-diff read against the export, same as the welcome-email fix.

### 2026-08-07#3 — Finalize cross-Advisor comms channel + protocol tweaks + SEAM-001 min-height (#P)            [OPEN — setup + small client fix]
From: Advisor   Re: Advisor-Landing's response (placement + 4 protocol refinements + SEAM-001 baton)

Dropped via `docs/COMMS/from-advisor/`. Promoted verbatim.

Three things, none blocking each other.

## 1. Move the cross-Advisor comms channel to its agreed home
The current `docs/COMMS/from-advisor/CROSS_ADVISOR_COMMS.md` is in a **gitignored scratch** folder — both Advisors agree that fails the "the repo is the channel" principle for a jointly-owned artifact (invisible to a clone, no history). It must be **tracked** and in an **explicitly agreed** location.

**Decision (Owner): Option 1 — a neutral sibling repo.**
- Create `/home/ramunas/projects/cross-advisor-comms/` as its own small git repo (`git init`, first commit).
- Move `CROSS_ADVISOR_COMMS.md` there (out of `from-advisor/`), **tracked**. This is the symmetric home — neither team "hosts" the seam.
- Both Advisors reach it by filesystem; you (PM) commit demo-side entries there as they're added. *(Advisor-Landing commits his half from his side.)*

The rest of `from-advisor/` stays as the gitignored Advisor scratch/drop folder (per its README) — only the **shared comms log** graduates to the tracked/agreed location.

## 2. Apply four protocol refinements (Advisor-Landing's, all accepted) to the comms log header
1. **Codify log↔contract:** add a line — *"The log is the negotiation; `GUEST_MODE_CONTRACT.md` is the source of truth. Resolved decisions are pinned into the versioned contract; if the two ever disagree, the contract wins."*
2. **Rename the field `Owner` → `Fix-side`** (collides with the human Owner).
3. **Real timestamps:** replace `2026-08-xx` placeholders with real dates, and state the rule — *whoever writes an entry stamps the real date at write time.*
4. **Security is first-class for messaging changes:** any entry proposing an event across the iframe boundary must state its **origin-validation + payload shape** in the entry.

## 3. SEAM-001 hand-back: guest surface `min-height: 100vh` (small client fix)
Advisor-Landing accepted the SEAM-001 baton (frame sizing is landing-side) and is sizing the cutout to the real iPhone mockup viewport (~390×844), which contains both the 832 pre-trim and ~720 post-trim heights — robust regardless of #G2 timing. His one ask back to us: post-#G2 the ~720px content leaves ~120px of the demo's dark background at the bottom of the 844 screen. **Fix (demo-side): give the guest surface `min-height: 100vh`** so it fills the viewport cleanly instead of showing a gap. Guest mode only; verify the normal hub is untouched. Ticket as a small client PR.

Ask: (a) create/move per §1 and confirm the path; (b) apply §2 to the log header; (c) ticket §3. Once the log is in its tracked home, I'll tell Advisor-Landing where to write his SEAM-001 entry.

### 2026-08-07#2 — Guest mode: drop the hidden-toolbar bottom padding (112px dead space) (#G2)            [OPEN — small client fix]
From: Advisor   Re: your PR #287 measurement + your question on which number to pin

Dropped via `docs/COMMS/from-advisor/` (new mechanism — see `COMMS_PROTOCOL.md`). Promoted verbatim.

**Decision on your question: take the trim, and I'm pinning 720px** as the height the landing frame must accommodate (832 noted as pre-trim). So please ticket this.

**What:** your headless-Chromium measurement confirmed the guest Coinflip hub is **832px** at every width, of which **112px is dead space** — `HUB_BODY` reserves bottom padding for the bottom toolbar, which guest mode **hides**. Pure waste in guest mode, and a direct contributor to the SEAM-001 desktop overflow.

**Fix:** when `isGuest` (guest session / `chrome=embed`), skip the `HUB_BODY` bottom padding. Nets **832 → ~720px**.

**Why now, independent of SEAM-001:** correct on its own merits (don't reserve space for a control that isn't rendered), low-risk, and it lowers the height the landing frame has to fit. Ship regardless of SEAM-001's outcome.

**Guard:** guest mode only — the normal (toolbar-visible) hub keeps its padding; verify it's untouched.

Ask: ticket as a small client PR; once merged, post the settled guest height so I can finalise the exact frame-cutout dimensions with Advisor-Landing on SEAM-001.

### 2026-08-07#1 — Parameter clarification: guest surface render dimensions (for SEAM-001 desktop fit)            [QUESTION — no code]
From: Advisor   Re: cross-Advisor SEAM-001 (desktop embed overflows the handset frame)

Before we hand the landing team our half of SEAM-001, I need the **real** numbers the demo's guest surface renders at, so they scale their desktop frame to a confirmed value rather than a guess. Please confirm:

1. **Design width** — the CSS width (px) the guest/Coinflip surface is laid out for in `chrome=embed` (I've been assuming ~390 portrait — confirm actual).
2. **Is the layout fixed-width or fluid?** i.e. does the surface render at a single design width and expect to be *scaled* to other sizes, or does it reflow/respond to whatever width the container gives it? (This decides scale-to-fit vs responsive — the crux of SEAM-001.)
3. **Intended aspect / height behaviour** — does the Coinflip surface fit one viewport with no scroll at the design width, and what height does it want (fixed aspect, or content-driven)? The desktop scrollbars suggest content is taller than the frame's given height — confirm the surface is meant to be no-scroll at its design size.
4. **Min / max width** the surface stays usable at (we noted min ~320 / target ~390 in the contract — confirm).

Once you post these, I'll pin them into `GUEST_MODE_CONTRACT.md` §3/§4 (bump v0.2 → v0.2.1) and update SEAM-001's cross-dependency line before it goes to Advisor-Landing.

No code needed — just the values.

### 2026-08-06#2 — Advisor note: Guest-Mode seam ratified; demo-side actions            [OPEN — Owner-gated docs (PR 0 update) + revised phasing]
From: Advisor   Re: landing team's `GUEST_MODE_LANDING_RESPONSE.md` (Owner-confirmed 04 Aug 2026)

The landing team endorsed the shape and answered the three decisions well. I've bumped the seam to **`GUEST_MODE_CONTRACT.md` v0.2** (iframe/CSP, shell/fullscreen, the new **Events** protocol, limited-taste, abuse-guard). Nothing here blocks Stage-2 launch — this is Phase 2, build after. Below are the **demo-side actions** to fold into the DemoGuest build; most are additions to what `PM_BRIEF_demoguest` already scoped.

## Accepted as-is (no concern)
- **iframe, not same-origin** — correct; keeps our deployments independent (the anti-fork principle).
- **CTA + post-win prompt in the landing frame** — honors contract §7 (nothing inside the surface). We only **emit an event**; they render.
- **Lazy-load + screenshot fallback** — a landing concern; fine by us.
- **"Never the house" resolution** — the demo is explicitly *not a real game*; requirement = honest demo/bot labelling + limited taste. Matches our design.

## New / changed demo-side work (beyond the original brief)
1. **Framability.** Serve the guest entry with `CSP: frame-ancestors https://rapidclash.com https://staging.rapidclash.com` (+ preview origins), **no `X-Frame-Options: DENY/SAMEORIGIN`**, and `allow="fullscreen"` support. Surface fluid to its container (portrait, min ~320 / target ~390).
2. **Events emitter (`postMessage`) — genuinely new.** Implement the versioned protocol in contract §5: emit `ready`, `resize {height}`, `requestFullscreen`, and **`firstWin`/`registerIntent`** (fired on the guest's first win → landing renders the register prompt, `source=post_win_prompt`). **Validate `event.origin` on every inbound message; never `*` targetOrigin.** This wasn't in the original brief — add it as its own PR after PR 1 (framework) lands.
3. **Abuse guard.** The entry is public via their page → **rate-limit guest-session creation** demo-side (cap creation rate per origin/IP). Add to the guest-session PR.
4. **Cold-start warmth.** Lazy-load means the *first* click is a cold entry — keep the guest entry fast/warm (min instances or a fast cold start) so the first impression isn't a spinner. Ops/infra flag.
5. **Limited taste.** Bake the owner's "tasting, not the meal" into the config: **modest credit stack + short/curated session**, reset on reload. Ties to the still-open `credits` decision — recommend erring small.

## Doc updates (PR 0, Owner-gated)
- The CHARTER carve-out wording should adopt the owner's resolution verbatim in spirit: *the demo is not a real game (no real money won/lost); the "never the house" invariant applies to the real product; the preview must be clearly labelled a demo-vs-bot tasting and deliberately limited.* The honest bot label stays on our side; the "this is a demo, the real thing is players-vs-players" copy lives in the landing frame.
- `GUEST_MODE_CONTRACT.md` → **v0.2** (attached) into `docs/`.

## Still needs counsel (unchanged, non-blocking to design)
Charter-exception sign-off + a Privacy-Policy line (preview is anonymous, cookieless, collects nothing; the landing-side `demo-open` metric, if added, is cookieless/aggregate).

## Later slice (not v1) — engagement metrics
Owner wants depth (time / games / credits). Design the Events protocol with room (`gameStarted`/`gameEnded`/`creditsChanged`), but **build later** — lightweight emit only, **no demo-side store** (consistent with the "thin, no persistent guest analytics" rule); landing counts cookieless.

## Revised build order (folding this in)
- **PR 0** — docs (charter carve-out + contract v0.2 + working-agreement rule).
- **PR 1** — guest session factory + ephemeral credits + no-password entry + guest chrome + curated surface + **Coinflip** bot + **rate-limiting**.
- **PR 2** — the `postMessage` **Events** emitter (`ready`/`resize`/`requestFullscreen`/`firstWin`) + framability CSP. *(Enables the landing embed + post-win prompt.)*
- **PR 3** — **Chess** bot (legal-move).
- Later — extra games; engagement events.

Ask: (a) confirm the credit stack / session cap (err small, per "limited taste"); (b) confirm the revised PR order (Events as PR 2, before Chess, since it unblocks the landing embed); (c) route container dimensions/aspect to a joint demo+landing sizing pass; (d) note cold-start warmth for whoever owns deploy/infra.

### 2026-08-06#1 — PM Brief: DemoGuest (guest mode), first build            [OPEN — Owner-gated docs (PR0) + phased build]
From: Advisor   Re: Board-approved anonymous preview ("guest mode")

Board has approved proceeding with the anonymous preview ("guest mode"). This brief adopts the framework into our docs and builds the first slice: a **DemoGuest** session with an **in-app Demo-Opponent**, starting with **Coinflip**, then **Chess** (Designer to add 1–2 more later). Companion docs: `GUEST_MODE_STRATEGY.md`, `GUEST_MODE_CONTRACT.md`.

## A. Adopt the framework (PR 0 — docs only, Owner-gated)
1. Add `GUEST_MODE_STRATEGY.md` and `GUEST_MODE_CONTRACT.md` to `docs/`.
2. **CHARTER.md** — record the carve-out: invariant "humans play humans, never the house" now has a **documented, board-approved exception for guest mode** (opponent = the app), with the mitigations on record: opponent honestly labelled as a demo bot, play-money `¢` only, ephemeral, no real-world value, distinct from the investor demo. *(Advisor note: board approval covers the business decision; recommend counsel is at least informed of the "app as opponent" + anonymous-no-PII framing before public exposure — non-blocking given play-money/no-PII, but it should be a conscious tick, not skipped.)*
3. **WORKING_AGREEMENT.md** — add the two-repo rule: *game behaviour changes only in `rapidclash-demo`; `rapidclash-landing` may only configure and frame guest mode.*

## B. What DemoGuest is (build target)
A **per-visitor, anonymous, ephemeral session** that plays a curated subset of games against an **in-app Demo-Opponent**, on the real server (server-authoritative, redaction intact). It is *not* the old external bot-crowd/VM and *not* a shared account.

## C. Build — phased

### PR 1 — Guest session + ephemeral credits + entry + Coinflip Demo-Opponent
The whole framework, proven on the trivial game.
- **Guest session type (server).** A **session factory**: each "enter as guest" mints a **new, isolated, anonymous session** (unique id, own state) — NOT one shared "DemoGuest" account. No account, no email, no password, no persistence.
- **Entry (client).** A no-password **"Play as guest"** affordance in the existing login window (per the Owner's request) that calls the guest-session endpoint and drops the visitor straight into the curated surface. (The `?mode=guest` embed entry from the contract comes later, for the landing seam — same endpoint underneath.)
- **Ephemeral credits.** Provision a fixed starting stack (contract default `300¢`) to the session; **not persisted** — reset on reload/expiry, discarded on session end. Guest wallets must never pollute the real ledger.
- **Guest chrome / curated surface.** In guest mode hide wallet/waitlist/account/leaderboard chrome; show only the **curated game set = [coinflip]** for this PR. (Curated set is config, per the contract's `games` param.)
- **Coinflip Demo-Opponent (server, in-app).** When the guest presses PLAY, the Demo-Opponent **takes the game instantly** (no matchmaking wait — solo preview) and "plays" it. For Coinflip this is trivial: reuse the coinflip module's seeded pick. Generalise the existing bot-**taker** into an in-server actor that both **takes and plays**, so no VM is needed. Labelled honestly (the `🤖` / "Demo Opponent" convention).
- **Integrity.** The Demo-Opponent is a **server actor**, so `viewFor` redaction holds unchanged — the guest client sees no more than a real client (opponent's pick hidden until reveal). Play-money `¢` framing unchanged.

### PR 2 — Chess Demo-Opponent
- Add `chess` to the curated set and give the Demo-Opponent **chess play**: a **legal-move bot**. Reuse the server's existing chess move-validation to enumerate legal moves; a **simple heuristic (or random-legal) move** is sufficient and honest for a preview — **do not build a strong engine.** Instant pairing as in PR 1.

### Later (not now)
- Designer's extra 1–2 games (same pattern — trivial if the game's bot "play" is simple, more if it needs real move logic — flag per game).
- The landing embed entry (`?mode=guest`, `chrome=embed`, framing/CSP) — the contract's "Provides" embedding responsibility.
- Optional scripted "join a bet" feel — explicitly out of scope for now.

## D. Critical flags (do not skip)
1. **Per-visitor isolation** (PR 1) — the single most important correctness point. Concurrent guests must not share balance/games. Test with 2+ simultaneous guest sessions.
2. **Coinflip ≠ Chess effort** — PR 1 is plumbing + a one-line pick; PR 2 is a move-making bot. Kept in separate PRs deliberately.
3. **Instant pairing** — the Demo-Opponent takes the guest's game immediately; a guest never waits at a matchmaking screen.
4. **Honesty labelling** — the opponent is visibly a demo bot, never disguised as a real player (charter mitigation).
5. **Ephemeral wallets** — guest credits never persist and never touch the real ledger.
6. **Relationship to the old Demo/VM** — the in-app Demo-Opponent is for *guest mode*; the investor demo's human/demo-taker crowd is unchanged. Clarify in docs whether the VM bot-crowd is retired for guest purposes (it should be — the in-app opponent supersedes it for solo play) or kept for the investor demo.

## E. Scope, collision, gating
- Spans **server** (guest session factory, ephemeral credits, Demo-Opponent take+play) and **client** (login-window guest entry, guest chrome, curated surface). New session type + endpoint = **API/contract change → Owner-gated**. Instant-pairing touches matchmaking — mind the App.tsx/matchmaking collision zone; single agent there. One concern per PR as above.

## F. Tests
(a) two concurrent guest sessions are fully isolated (separate credits, separate games, no cross-visibility); (b) "Play as guest" mints a session with the starting stack and lands in the curated surface, no auth wall; (c) guest credits reset on reload and never appear in the real ledger; (d) PR1: pressing PLAY pairs the Coinflip Demo-Opponent instantly and resolves a round; (e) opponent pick/move stays redacted until reveal (guest sees no more than a real client); (f) PR2: the chess bot only ever makes legal moves; (g) wallet/waitlist/leaderboard chrome hidden in guest mode.

## G. Asks
1. Confirm PR 0 doc changes (charter carve-out wording, working-agreement rule) for the Owner to commit.
2. Confirm the Coinflip-first / Chess-second sequencing (still delivers both games).
3. Confirm the starting credit stack (`300¢`?) and that the guest surface hides wallet/waitlist/leaderboard.
4. Decide the old Demo-account/VM's fate for guest purposes (retire vs keep for investor demo).

### 2026-07-12#14 — Coinflip: remove captions + one panel/coin position + intro animation (Designer)            [OPEN — client-only, parallel-safe with #13]
From: Advisor   Re: Designer "Coinflip — preview/search cleanup + intro animation"

Parallelizable with the Open Games redesign (#13): yes. #13 is `OpenGames.tsx`; this is `CoinflipHub.tsx` + `components/coin/Coin.tsx`. No shared file, neither touches `GameHub`/`App.tsx` → two agents, within the ≤2 cap.

## 1 — Remove the captions (simple)
Both strings live in one place: `CoinflipIdle` renders `<p>{phase==='waiting' ? 'Finding a rival…' : 'Place your bet and play.'}</p>`. `CoinflipBoard` (in-match/result) has no caption. Delete that `<p>`. Matchmaking feedback is already elsewhere — the opponent bar ("Searching…") and the transformed PLAY button ("PLAYING…") — verified in the screenshots, so nothing is lost.

## 2 — One panel size, one coin position (needs a small restructure)
Coin size is already `COIN_SIZE_PX` (216) in both states, and the countdown ring is `absolute … -translate-y-1/2` — it does not displace the coin (spec point 3 ✓). But the coin does move today: `CoinflipIdle` is a `flex-col … gap-4` with the caption below, so the coin sits above centre; `CoinflipBoard` is `items-center justify-center`, coin centred. Removing the caption (part 1) mostly closes this, but the two states are still separate components rendering separate `<Coin>`s.

Recommended: hoist one persistent `<Coin>` into `CoinflipPanel`. Render the coin once, in a single fixed-min-h `items-center justify-center` box, for all states; let the state-specific elements (ring, pick pills — already in the bars/absolute) layer around it without displacing it. This guarantees identical panel dimensions + a truly identical coin centre in every state (zero movement), and it removes a latent cost: today `CoinflipPanel` swaps `CoinflipIdle`↔`CoinflipBoard` on the live flip, which unmounts/remounts the coin's whole WebGL scene on every preview↔in-match transition (a rebuild/flash). One mounted coin fixes that too — and it's required for part 3 (below).

## 3 — Intro animation (one-time on entry) — in `Coin.tsx`
A scripted rotation on the resting coin, reusing the existing `mesh.rotation.y` + rAF render + flat/edge/faces rendering (no new visual path). Sequence (single Y-axis rotation, same as the match flip):
- Tease tilt 0 → ~0.7rad (~40°), easeOut ~0.35s (edge band + a sliver of the other face show).
- Return → 0, easeInOut ~0.3s.
- Full 360° (→ 2π ≡ 0, lands on the starting face/heads), easeInOut ~0.7s with slight end deceleration.
- Rest flat. Total ~1.3–1.5s.

Implementation notes:
- Add an opt-in (e.g. `intro` prop) played once on the coin's mount while resting (`face == null`) — so it fires on every page entry and never repeats while you stay. Gate strictly on `face == null`: never during in-match/terminal, so it can't run before a reveal or after a result.
- Cancelable / non-blocking: it's a decorative rAF on the mesh — React interaction (bet, PLAY, matchmaking) is unaffected and never gated on it. If a match starts mid-intro (`face` → a value), cancel the intro, snap `rotation.y = 0` instantly, then let the existing flip effect run (it reads `from = mesh.rotation.y`, so the snap-to-0 keeps the flip clean). Unmount cancels too.
- Reduced motion: the coin already honours `prefers-reduced-motion` for the flip; the intro is purely decorative — skip it entirely under reduce.

**COUPLING — do parts 2 and 3 together.** Part 3's trigger rules ("every page entry; no repeat while staying; never after a result or on auto-rematch") only hold with part 2's single persistent coin. With today's remounting structure, returning to the idle/preview after a result remounts the coin → the intro would replay on every result-return/rematch, violating the spec. So: hoist the coin (part 2), then key the intro to that coin's mount (part 3).

**Tests:** (a) no caption under the coin in any state (preview/searching/in-play/result); (b) panel dimensions and the coin's centre are identical across idle/in-match/result (coin never shifts); (c) ring present without displacing the coin; (d) intro plays once on entering the Coinflip page, rests flat on heads; (e) a match starting mid-intro snaps the coin flat and the normal flip proceeds; (f) intro does not replay when returning to preview after a result within the same page; (g) intro skipped under `prefers-reduced-motion`; (h) bet/PLAY/matchmaking all work during the intro.

**Scope:** client-only — `CoinflipHub.tsx` (caption delete + hoist the coin) + `Coin.tsx` (intro). Parallel-safe with #13; single agent for this ticket.

Ask: OK to hoist the coin into one persistent instance (parts 2+3 want it); confirm the intro is skipped under reduced-motion.

### 2026-07-12#13 — Open Games ticker: flat + zebra pills + stepped top-down motion (Designer)            [OPEN — client-only, ticker re-architecture]
From: Advisor   Re: Designer "Open Games list — visual & motion redesign" (reference: Thrill)

Borrow the *look* (zebra pills + stepped feed), not the content — our rows stay `¢`, no crypto (the spec leaves row content unchanged, so this holds). All in `components/hub-shared/OpenGames.tsx`; both variants (`OpenGamesTicker` signed-in + `PublicOpenGamesTicker` logged-out) share `TickerBody`/`TickerRow`, so the redesign covers both.

**Current state (verified).** `TickerBody` = `bg-surface` + `shadow-[inset_0_0_24px_8px_...]` + `rounded-[14px]`, maxHeight 320 (the recessed navy panel). `TickerRow` = `border-t border-brand/40` (the purple dividers). Motion = continuous CSS `rc-ticker-anim`; above 5 rows it **duplicates rows as non-interactive `clone`s** for the loop — so a JOIN on a scrolling clone is a dead tap today. JOIN on a real row closes over the challenge `c` → `onTake(c.matchId)` (correct).

## 1 — Remove the panel (simple)
`TickerBody`: drop `bg-surface`, the inset `shadow-[…]`, and `rounded-[14px]` — but **keep `overflow-hidden`** (still needed to clip the ticker to a fixed height). `TickerRow`: drop `border-t border-brand/40 first:border-t-0`. Rows sit on `#0B0B0B`. Header (`TickerHeader`) unchanged. Reconcile `EmptyTicker` to match (flat text on `#0B0B0B`, no panel).

## 2 — Zebra rows (recommend a STATIC slot backdrop — this is the flicker-free trick)
Fixed slot height ~70px (tune to content, identical for both row types). Even slots = `#1A1A2E` full pill (`rounded-full` since height is fixed ⇒ radius = half height), odd = transparent. Flush, 0 gap. Padding identical both types: ~10px vertical; left ~20–24px so content clears the pill's rounded end, mirrored right; **same left padding on transparent rows** so icon/name/stake/JOIN columns align across the list.

**Implementation:** paint the zebra as a **static backdrop of N fixed slots** behind the row content (even = pill, odd = transparent), fixed to the list window; the row content slides *over* it. This makes the zebra inherently "always intact" and "swaps at the moment content lands in a slot, never mid-slide with a flicker" — because the pills never move or re-render; only content moves between them. (Alternative — each row carrying its own pill and swapping treatment at landing — is flicker-prone; avoid.) **Confirm the mid-slide look is acceptable:** during the fast step, a row's content briefly glides across a pill edge (it's in motion, matches the Thrill reference). If the Designer instead wants pills to feel "attached" to rows, that's the harder path — flag now.

## 3 — Stepped top-down ticker (the real work)
**Mechanism (shift-register):** the window is `overflow-hidden`, fixed height = N × rowHeight (N = whole number of visible rows; pick to match today's ~320px ≈ 4–5 rows). Each step: render `[incoming, …visible]` (N+1 rows), start at `translateY(-rowHeight)` (looks like `visible`), animate to `translateY(0)` — incoming enters slot 0, all shift down one, the last row slides past slot N-1 into the clipped region. On completion: commit `visible = [incoming, …visible.slice(0, N-1)]`, reset transform to 0 **instantly (no transition)** — seamless. Hold **0.8s** static. Repeat. Step duration = one row-height at the **current marquee speed** (read the px/s from the existing `rc-ticker-anim`). Direction inverted: newest enters top, oldest exits bottom.

**CRITICAL — tap resolves to the game, not the slot.** Drop the clone trick entirely; render every row as a **real, interactive row keyed by `matchId`**, each JOIN closing over its own challenge `c`. Animate with `transform` only — a transformed node still hit-tests at its visual position, so a tap during the slide lands on that row's node → its handler → correct `matchId`, even mid-motion. Do **not** recycle nodes by slot or swap content into fixed slot-nodes (that's what would misroute a tap). This is the requirement's crux and the current clone approach fails it.

**Live set reconciliation.** The signed-in feed changes as challenges open/close (WS). Apply adds/removes at **step boundaries (during the 0.8s hold)**, not mid-slide, so the set never mutates under a moving row. A newly-opened challenge becomes the next `incoming`; a taken/closed one is dropped at the next hold.

**Static when small.** Animate only when open games > N; with ≤ N rows the list is static (zebra still applies, no motion) — the common demo case (few open games) shows a still zebra list. Empty → `EmptyTicker`.

**No layout shift** outside the list (height constant = N × rowHeight). **Reduced motion:** honor `prefers-reduced-motion` — pause stepping, show a static snapshot.

## Scope & risk
Client-only, contained to `OpenGames.tsx` (not a play-path collision zone), but a genuine component rewrite — the motion, tap-correctness, and live-set reconciliation are the risk, not the CSS. Optional de-risking split: **PR-A** = parts 1+2 (flat panel + zebra, list left static or on the existing motion); **PR-B** = part 3 (stepped motion, remove clones, tap-correctness). They're coupled via the static backdrop, so one careful PR is also fine — single agent either way.

**Tests:** (a) no panel bg/shadow/border, no row dividers; (b) zebra by position — even slot has the `#1A1A2E` pill, odd transparent — and re-resolves after a step; (c) a step moves exactly one row-height, newest enters top, bottom row is clipped (not left half-visible during the 0.8s hold); (d) **tap a JOIN mid-slide → fires the pressed row's `matchId`**, not the slot's; (e) ≤ N rows → no animation; (f) list height constant (no outside layout shift); (g) `prefers-reduced-motion` → static; (h) update the tests that assumed clones/`home-row` scrolling.

Ask: (a) confirm the static-backdrop zebra (content glides over fixed pills mid-slide) is the intended look; (b) confirm N (visible row count) — keep ~today's, as a whole number; (c) one PR or the A/B split.

### 2026-07-12#12 — Avatar system: one shared avatar + preset picker + persistence (Designer)            [ANSWERED — fully implemented (i+ii), DEPLOYED]
From: Advisor   Re: Account rev-1 part 3, extracted as its own task (the other Account fixes will come as a separate brief)
(PM note: #11 was not relayed to this mailbox — my ADVISOR entries jump #10 → #12. Flagging the relay gap; #12 is self-contained.)

Goal. Replace the client-side initials/gradient avatar with one shared avatar component used everywhere a user is shown, plus a preset picker on the Account page and server-side persistence so a choice sticks and appears to others. One source of truth: Account header, the player's own in-game slot bar, and leaderboard rows all render the same avatar for the same user.

Finished assets (attached, drop-in). Four cartoon presets, 512×512, transparent, uniform framing/scale — plus the existing default silhouette:
- avatar-boy-light.png, avatar-girl-light.png, avatar-boy-brown.png, avatar-boy-dark.png → place under apps/web/src/assets/avatars/.
- avatarId enum: 'default' | 'boy-light' | 'girl-light' | 'boy-brown' | 'boy-dark'. 'default' = the current purple-circle + white silhouette (the unset/initial value). Presets are transparent faces; the slot's background colour is the disc (see treatment) — so all avatars, default included, share one circle.
- (These four are the whole set for now; more may be added later — the enum should be easy to extend. Licence: record the source/commercial-use licence for the files in the repo when they land.)

1 — Shared Avatar component. Extract the in-game bar avatar (the bg-brand circle + PersonGlyph, currently local to GameHub.tsx) into one component, e.g. components/hub-shared/Avatar.tsx, taking avatarId (+ size). It renders the silhouette for 'default', else the preset image, always inside the circular slot. Use it in: GameHub OwnSlot, ProfileHub header, and Leaderboard/ProfileLeaderboard rows. Remove ProfileHub's initialsOf / gradientFor / the blue initials circle.

2 — Disc / slot treatment. Render presets on a brand-purple (bg-brand #8140e2) circular slot — the same purple the default silhouette already uses, so the whole set is one family (verified legible at ~44px in the player bars). Light (#E9EBF2) is the fallback if the Designer prefers the faces to pop against the purple UI. It's one decision applied uniformly to the shared component.

3 — Picker overlay (Account page). Tapping the Account avatar opens a picker: overlay panel bg-surface (#1A1A2E, no rim — the auth-popup treatment). Grid of the default + 4 presets. Tapping one shows the purple selection ring (ring-[3px] ring-brand, the existing pill-selection pattern); a solid bg-brand confirm button saves. No custom upload — presets only.

4 — Persistence (server, owner-gated). Store the chosen avatarId on the user profile with a set endpoint; include it wherever a user is surfaced (own session, leaderboard entries). Contract/API change → owner-gated. "Presets only" keeps this a small avatarId string field — no file storage. After save, every surface reflects the new avatar.

5 — Redaction call (confirm). In-match the opponent shows as a neutral "Opponent" with the silhouette (name hidden on the PLAY path — Charter #2). Recommend: render the chosen avatar for the player's own bar + on the leaderboard (names already public there), but keep the in-match opponent bar the neutral silhouette — so "same avatar for the same user" holds wherever the user is identified, and the anonymised-opponent model stays intact. Confirm before wiring the opponent bar.

Tests. (a) Avatar renders the silhouette for 'default' and the correct preset image otherwise; (b) selecting + confirming in the picker persists (survives reload) and updates the Account header, own game bar, and leaderboard row; (c) the in-match opponent bar stays the neutral silhouette regardless of the opponent's saved avatar (redaction guard); (d) the picker panel is bg-surface, selection ring is ring-brand.

Scope. Client: shared Avatar, picker overlay, wire Account/own-bar/leaderboard, remove the initials circle. Server: avatarId field + set endpoint. Natural sub-split if wanted — (i) shared component + default everywhere (client-only, removes initials), (ii) picker + avatarId persistence (client + server). One concern (avatars), no protocol change beyond the user field.

Ask: confirm (a) slot colour = brand-purple (or light); (b) the redaction call (own + leaderboard avatars, neutral in-match opponent); (c) OK the avatarId user field + endpoint as an owner-gated API addition. Assets are final and attached.

### 2026-07-12#10 — Blackjack: gate the result presentation on reveal-complete (bar fires too early) (Designer)            [ANSWERED — shipped PR #252, deployed]
From: Advisor   Re: Designer "result animation timing fix" (bar lights before the cards finish revealing)

**Diagnosis (verified in code).** The result has **two triggers keyed to different events**, so they desync:
- **Bar** (`ownBarVerdict`, `GameHub`): `useDelayedFlag(phase==='result', BAR_VERDICT_BEAT_MS=250)`. Blackjack passes **no `holdResultMs`**, so `phase` → `'result'` the instant match-end arrives → the bar lights ~250ms after the *server result*, before the reveal even starts.
- **Outlines** (`ownFrame`, `BlackjackBoard`): `useDelayedFlag(phase==='result' && isTerminal, FRAME_DELAY_MS=1000)`, where `isTerminal` reads the **paced** view (`usePacedView` holds ~1100ms before the choreography begins). So outlines key off "reveal started", the bar off "data arrived" — the bar wins by ~850ms+.
- The fixed `FRAME_DELAY_MS` also doesn't scale: it ≈ lands right for a 0–1-hit reveal (why outlines look OK) but a multi-hit reveal finishes later, so even outlines drift on slow reveals.
- **Balance leak:** the wallet (`liveBalance` → ribbon) updates from the `balance` prop at settlement (match-end), ~2s before the bar — the Designer's "no balance flash".

**Fix — one trigger: reveal-complete, owned by the board.** The board is the only place that knows the choreography timing, so it computes the completion moment and both the local outlines and (via a signal) the hub's bar + balance gate on it. **Purely start-time — no durations/colours/holds/shared components change.**

**1. `BlackjackBoard` — compute `revealComplete` and gate the outlines on it.**
- Derive the reveal length from the **existing** animation constants (single source of truth, so it can't drift): with `nHits = max(0, oppCards.length - 2)` —
  `revealMs = nHits === 0 ? FLIP_MS(550) : HIT_DEAL_START_S*1000(450) + (nHits-1)*DEAL_STAGGER_S*1000(220) + CARD_ANIM(550)`
  (i.e. 550ms for a stand-pat opponent; 1000 / 1220 / 1440… for 1 / 2 / 3 hits).
- `revealComplete` flips true `revealMs` after `revealed` becomes true (reset when `revealed`/round changes). Replace the fixed-`FRAME_DELAY_MS` `useDelayedFlag` for `ownFrame` **and** the push `pushFrame` with this dynamic gate, so **win/loss outlines and equal-count/double-bust push outlines all wait for the last card to land**.
- Call a new `onRevealComplete?()` (from `areaArgs`) when `revealComplete` flips true.

**2. `GameHub` — gate the bar + balance on the board's signal (opt-in).**
- Add `onRevealComplete?()` to `GameAreaArgs`; thread a stable callback that sets a `revealDone` state (reset per `currentMatchId`).
- Add an opt-in prop (e.g. `gateResultOnReveal`) that Blackjack passes. When set:
  - `ownBarVerdict` gates on `phase==='result' && revealDone` instead of `phase==='result' + BAR_VERDICT_BEAT_MS`. (Keep the beat path for non-gated games — Coinflip — unchanged; mind the hook-rules when combining.)
  - **Hold the displayed wallet balance** at its pre-result value until `revealDone`, then apply the settled balance — so the ribbon doesn't flash the win/loss early. (This is the trickiest sub-part; if it proves invasive, it's the lowest-visibility leak, but the Designer did list it — implement if clean.)
- Non-gated games omit the flag → today's behaviour exactly (regression guard).

**Result:** at reveal-complete — hole flip done AND all hits landed, motionless — the outlines and the bar start on the **same frame** (bar: 0.5s fill → 2s hold → fade to outline, unchanged; outlines: green/red/orange per spec, unchanged). Nothing (bar colour, outline, "You Win" text, or balance) appears before that; the server can deliver the result whenever.

**All outcomes gated:** win (bar fill + green outline), loss (red outline, no fill — unchanged), equal-count push (orange cards), double-bust push (red cards). Pushes keep suppressed bars (`suppressDrawBar`, unchanged) — only their card outlines gate on reveal-complete.

**Tests:** (a) slow reveal — opponent with 3–4 hits — the own bar stays in its neutral in-play state until the **last** hit lands, then bar + outlines fire together; (b) stand-pat opponent (2 cards) — fire after the hole flip; (c) the wallet balance doesn't change until reveal-complete. Keep the existing GameHub remount-continuity test and the count-hidden redaction green.

**Scope:** `BlackjackBoard` (`BlackjackHub.tsx`) + `GameHub.tsx` (shared) — the reveal collision zone. One PR, single agent, careful review; no protocol/module change.

Ask: ticket it. Confirm whether to include the balance-hold now or defer it as a fast-follow (bar + outlines are the visible fix; balance is the subtler leak).

### 2026-07-12#9 — CORRECTION to #8: the ALL GAMES bolt is NOT aligned — both heading icons sit ~3–4px low            [ANSWERED — live rev 00065]
From: Advisor   Re: Owner's logo-etalon analysis (correcting my earlier "ALL GAMES is fine")
(PM note: #8 was never relayed to this mailbox — my ADVISOR entries jump #7 → #9. #9 is self-contained and supersedes it, so acting on #9 directly; flagging the gap for the record.)

**I got #8 wrong on ALL GAMES — the Owner is right.** My "bolt is aligned (+0.3px)" reading was a measurement artifact: the `bolt-mark` asset is **66% white pixels**, so my white-text mask counted the bolt's own body as "caps" and produced a phantom cap-band that coincided with the bolt. Re-measuring with the bolt isolated from the text (two independent methods agree):
- **ALL GAMES bolt:** **+32–35% of cap-height below** the "ALL GAMES" optical centre (~10 image-px ≈ **3–4 real px** low).
- **OPEN GAMES • LIVE badge:** +32–36% below (as in #8).
- **Logo etalon (the Owner's reference):** the bolt sits **at the text cap-centre** (measured −4%, a hair above). Owner's own top/baseline guide-lines (rows 30/84, mid 57) land on the bolt's mass-centre (56) — confirming the target is cap-centre.

So **both** the ALL GAMES bolt and the OPEN GAMES LIVE badge need to come **up ~3–4px** to sit on the caps' optical centre, matching the logo. The earlier `leading-none` only removed ~7% of the gap; the remaining ~32% is an optical issue `items-center` doesn't solve — a text line-box centres on the *box*, but uppercase caps sit high in that box, so a sibling icon centred on the same row lands below the caps. (Verified the markup: `flex items-center` + `leading-none`, no stray margin — so this is genuinely the line-box-vs-cap-centre gap, not a layout bug.)

**Fix — raise the icon/badge to the cap-centre (both headings):**
- **ALL GAMES** (`HomeHub.tsx`, the `CAT_TITLE` heading row): nudge the bolt `<img>` up. The offset is ~0.22–0.25em (≈ **3–4px** at `text-[15px]`) — e.g. add `-translate-y-[3px]` (or `-mt-[3px]`) to the `<img className="h-5 w-5 object-contain">`. Keep `leading-none` on the h2 (it does help the general case).
- **OPEN GAMES** (`OpenGames.tsx`, `TickerHeader`): same magnitude on the LIVE `<span>` badge — `-translate-y-[3px]` (≈0.22–0.25em at `text-[11px]`/`text-sm`). This replaces the "baseline-vs-nudge" choice in #8 with a single consistent approach for both headings.
- **Tune against the etalon:** the exact px depends on font rendering, so the coder should eyeball it so the bolt's / badge's mass-centre lands on the caps' vertical centre — i.e. the ALL GAMES bolt sits relative to "ALL GAMES" the way the logo bolt sits relative to "RapidClash". `~0.23em` up is the starting point; 3–4px is the expected landing.

**Why `em`-based:** expressing the nudge as ~0.23em (rather than a raw px) keeps both headings consistent and scales if a font-size changes; measured residual was ~0.23–0.24em on both. A raw `-translate-y-[3px]` is fine too if the coder prefers and verifies each.

**Test:** assert the bolt img and the LIVE badge carry the upward offset; visual check against the logo (icon mass-centre on the caps' centre, not hanging below).

Note (my error, for the record): I over-trusted a single colour-mask measurement in #8 and declared ALL GAMES aligned. The Owner's logo-etalon method caught it. Both icons move; nothing else in the headings changes.

Ask: ticket the ~3–4px upward nudge on BOTH the ALL GAMES bolt and the OPEN GAMES LIVE badge (supersedes #8); coder tunes to the logo etalon.

### 2026-07-12#7 — Chess time-control after auth-resume removal: accept as-is            [RESOLVED — no code change]
From: Advisor   Re: PM's chess time-control flag (accept, or pre-select the captured control)

**Verdict: accept as-is. No follow-up needed.** Traced both auth-entry paths against `ChessHub`/`GameHub`:

- **PLAY path (the one that captures a `timeControlId`).** The guest is on the chess hub, picks a time control (GameHub-local state) + stake, presses PLAY → the auth modal opens **as an overlay over the still-mounted hub** (screen stays `chess-hub`; the modal is a sibling of `renderScreen()`, not a replacement). After sign-in `handleAuthSuccess` sets screen to `chess-hub` again — unchanged, so the hub never unmounts and its picker selection survives, exactly like the stake and the board. Pressing PLAY calls `onPlay(stake, timeControlId)` with the preserved control. So the captured control is already re-used — pre-selecting it would be redundant.
- **JOIN path.** The `AuthIntent` `'join'` variant carries no `timeControlId` (only `'play'` does), so there's nothing captured to pre-select. Post-sign-in the user lands on the chess hub with the stake armed and picks a control if they want (they're posting their own challenge now, per 2026-07-12#5).

So in every current path the time control is either preserved (PLAY, mounted hub) or absent by design (JOIN). An `initialTimeControl` pre-arm would be dead code today.

**Only revisit if** the chess hub ever starts *remounting* across the auth step (e.g. if the modal becomes a full-screen route instead of an overlay, or the hub gets keyed on `initialStake`) — then the picker would reset and we'd add an `initialTimeControl` prop mirroring `initialStake`. Not the case now; leave it.

Ask: close the flag as accepted.

### 2026-07-12#6 — Navbar: Menu → reserved/greyed (decision: option B)            [ANSWERED — live rev 00065]
From: Advisor   Re: #3 Menu active-state — resolved as "reserved" (no Menu surface exists)

Per the decision, Menu joins the reserved set rather than getting a (nonexistent) active state. In `HubToolbar.tsx`:
- Change the Menu item to the reserved treatment, exactly like Rewards/Chat: `<ToolbarItem label="Menu" comingSoon icon={ICON_MENU} />` (drop its `active`/`onClick`). It then renders greyed (`opacity-40`, `text-muted-foreground`), `aria-disabled`, no action — matching the toolbar's own stated rule ("never a live-looking button that silently no-ops").
- Remove the now-dead `active === 'menu'` path and drop `'menu'` from the `active` prop type (`'menu' | 'games' | 'account'` → `'games' | 'account'`). `onGames` stays (Games still uses it).
- Update the component doc comment: "games/account are wired to live surfaces; **menu/**rewards/chat are reserved."

Result: all five items behave consistently — Games/Account light purple when active, Menu/Rewards/Chat are reserved-grey. When a real Menu surface (a drawer/overlay) exists later, flip Menu back to a live item with its own active state (the earlier option A).

**Test:** assert Menu now renders reserved (`aria-disabled`, greyed) and is not an actionable button.

**Scope:** `HubToolbar.tsx` only; client, cosmetic. Independent of the auth PR — can ride any client PR.

Ask: confirm the JOIN consequence in #5 (or "accept"), then ticket #5 into the combined auth PR and #6 as a small client change.

### 2026-07-12#5 — Auth flow: remove the seamless auto-resume; sign-in lands with stake armed, user presses PLAY (Designer B)            [ANSWERED — live rev 00065]
From: Advisor   Re: PM routing of "remove the automatic play-on"

**Advisor verdict: yes, remove it — it's a net win, not just the Designer's preference.** The auto-resume is light polish that carries heavy machinery: a captured-intent ref replayed on socket-connect, the `wsEpoch` "rebind handlers before onopen" timing dance, and a `joinFallbackRef` + `CHALLENGE_TAKEN` branch that exists *only* to handle "the tapped challenge vanished mid-sign-in." Dropping the auto-fire deletes that whole edge-case class. And an explicit PLAY *after* sign-in (balance visible) is a cleaner commit moment for a wagering app than auto-committing the instant auth returns. Cost: one extra tap, first play only — and painless, because the modal is an overlay over the still-mounted hub, so the pick + stake are preserved behind it.

**Spec (`App.tsx`):**
1. **`onStatus('connected')` — delete the resume block.** Remove the `const resume = pendingResumeRef.current; if (resume) { … joinQueue / takeChallenge … }` section entirely. No auto-fire on connect.
2. **`handleAuthSuccess` — land the user ready, don't fire.** Keep navigating to `hubScreenFor(intent.gameId)`, and **pre-arm the stake** (`setPrearmStake(intent.stake)`) so the hub opens with the bet set; then clear `pendingResumeRef.current = null` (nothing consumes it later now). PLAY path: the hub is already mounted behind the overlay with the user's pick + stake, so it's literally one tap. JOIN path: they land on that game's hub with the stake armed.
3. **Remove the now-dead join-resume fallback.** Delete `joinFallbackRef` and the `if (payload.code === 'CHALLENGE_TAKEN' && joinFallbackRef.current) { … }` branch in `onError` (it only served the resumed-join-gone case). **Keep** the general `CHALLENGE_TAKEN / SELF_TAKE / INSUFFICIENT_BALANCE` notice branch (still needed for normal logged-in takes).
4. **Comments:** update the `AuthIntent` doc ("replayed automatically… the resume that makes the wall feel seamless") and the `handleAuthSuccess`/`onStatus` comments to the new model ("after sign-in the user lands on the game with the stake armed and presses PLAY to commit").

**Consequence to confirm (JOIN entry).** A guest who taps a *specific* open challenge then signs in will no longer auto-join *that* challenge — they land on that game's hub with the stake armed and press PLAY to post their own. Robust (removes the vanished-challenge handling) and consistent with "press again," but it's a real change to the public-ticker join path. Recommend accepting it (the alternative — re-showing the ticker so they can re-tap — is more work and the specific challenge is often gone). Confirm OK.

**Tests:** the auth-resume test (asserts sign-in auto-fires `joinQueue`/`takeChallenge`) flips to: after sign-in the user is on the intent's hub with the stake pre-armed and **no** queue/take fires until an explicit PLAY. Drop the `CHALLENGE_TAKEN`-resume-fallback test.

**Scope:** `App.tsx` (the auth/matchmaking collision zone) — the App-side half of the combined auth PR with the `AuthModal` restyle (2026-07-12#4). Single agent, one deploy, as you planned.

### 2026-07-12#4 — Sign-up/Login modal (`AuthModal.tsx`) restyle to match the site (Designer)            [ANSWERED — live rev 00065]
From: Advisor   Re: Designer "sign up / login popup — restyle"

**Judgement:** all six are sane, low-risk, and land in one file — `apps/web/src/components/AuthModal.tsx` (the mid-play auth gate; the full-screen `Auth.tsx` is a separate surface, untouched). Every colour maps to an **existing token** (no hardcoded hex): the Designer's `#1A1A2E` is `--rc-surface` → `bg-surface` (the hub panels' surface), and "brand purple / same as PLAY" is `bg-brand` (`#8140e2`). Three consequences the spec glossed are flagged for Designer confirmation below — default is "as written."

**The six changes (verified against the current component):**
1. **Panel fill → solid surface, no rim.** The modal panel is `… rounded-2xl border border-border bg-card p-6 …`. Change `bg-card` → **`bg-surface`** (that's `--rc-surface` = `#1A1A2E`, the "PLAY / bet / Play-a-Friend" panel colour) and **remove `border border-border`**. Keep `rounded-2xl`, keep the `bg-black/70 backdrop-blur-sm` scrim behind it. (Inputs stay `bg-background` `#0b0b0b` — still contrasts against the lighter panel.)
2. **Header row.** Remove the `<Swords … />` icon (and its `Swords` import). Change the header text to a fixed **"Create an account or Login"** (see confirm **A** — this replaces the dynamic `title` prop). Keep the `X` close button as-is.
3. **Remove the subheadline.** Delete the `<p>Create an account (you get 1,000 play-money credits) … automatically.</p>` entirely; nothing replaces it (see confirm **B**).
4. **Toggle label.** Change the first tab's label **"Register" → "Sign up"** (tabs read `Sign up | Login`, left→right as now). Internal state/testids unchanged — only the visible label. Update any test asserting the "Register" text.
5. **Action button → solid brand purple.** Replace `bg-gradient-to-r from-brand to-indigo-600 … hover:to-indigo-500` with solid **`bg-brand hover:bg-brand/90`** (the same purple as PLAY / other primary buttons). Keep shape/size and the `shadow-lg shadow-brand/20` glow ("only the fill changes"). Labels stay dynamic: Login → "Sign In", Sign up → "Create Account".
6. **Disclaimer → white, exact copy.** Change `text-muted-foreground` → **`text-foreground`** (the site's near-white text token; use `text-white` only if the Designer wants pure `#fff`). Text becomes exactly: **`Play-money demo credits only, no real-money wagering.`** — note the removed "·" (now one phrase "demo credits only"). Keep it centered `text-xs`.

**Confirm with the Designer (default = as written):**
- **A — fixed header drops the contextual cue.** The header is currently the `title` prop the caller sets to say *why* the wall fired ("Sign in to play" / "Sign in to join"). A fixed "Create an account or Login" loses that. If OK, hardcode it and **remove the now-unused `title` prop + the titles passed at the 2–3 call sites** (App-level auth-wall triggers) for cleanliness — small caller touch.
- **B — the deleted subheadline carries two messages.** It's the only place the modal states "you get 1,000 play-money credits" (a conversion nudge) *and* "your move continues automatically" (a real reassurance at the commit-to-play moment that their in-progress action resumes after auth). Confirm the Designer accepts losing both.
- **C — the toggle tray blends into the new panel.** The Sign-up/Login tray is `bg-surface` — the colour the panel is becoming — so the tray container disappears (selected purple pill still shows; unselected tab is text on the panel). Clean "floating pill" look; confirm that's intended, or give the tray a hair of contrast (e.g. `bg-background`).

**Scope:** one client component, colour/copy only; all tokens (`bg-surface`, `bg-brand`, `text-foreground`) already exist. Remove the unused `Swords` import; if A is accepted, drop the `title` prop and update its call sites. Update the auth-modal tests for the new labels/copy (tab label "Sign up", header text, disclaimer string).

Ask: confirm A/B/C (or "proceed as written"); then ticket the one PR.

### 2026-07-12#3 — Two heading alignment fixes + navbar Menu active state (Designer)            [ANSWERED — live rev 00065]
From: Advisor   Re: Designer "three small UI fixes"

**#1 and #2 share one root cause — verified, and it isn't a missing `align-items`.** Both heading rows already have `flex … items-center`, and I pulled `bolt-mark.webp` — its glyph is **perfectly vertically centered** in the image (0.0px offset), so the icon isn't the problem either. The real cause: **uppercase text sits high inside its line box.** With the default ~1.5 line-height, the caps occupy the top of a box much taller than the letters, so `items-center` centers the *boxes* while the visible caps ride above the icon/dot at the box's true center. The fix is to collapse that line-box slack with `leading-none` on the uppercase text so the caps hug their box and `items-center` centers what you actually see.

**#1 — "ALL GAMES" heading (`HomeHub.tsx`, the grid section heading).** The row `<div className="mb-3 mt-5 flex items-center gap-2.5 px-4">` holds `<img … className="h-5 w-5 object-contain">` + `<h2 className="text-[15px] font-black uppercase tracking-[0.04em]">`. **Add `leading-none` to that `<h2>`.** (No asset change — the bolt is centered. This heading renders for every category via `CAT_TITLE[cat]`, so the same fix also corrects the bolt-vs-text alignment on the EVENTS/ORIGINALS/CLASSICS headings.)

**#2 — "OPEN GAMES" heading (`OpenGames.tsx`, `TickerHeader`).** Two nested instances of the same thing:
- Outer row: `<h2 className="text-sm font-extrabold uppercase …">Open Games</h2>` beside the LIVE `<span>`. **Add `leading-none` to the `<h2>`.**
- The LIVE badge itself: `<span className="ml-1 flex items-center gap-1.5 text-[11px] font-bold uppercase text-success">` wraps a `h-1.5 w-1.5` dot + the text "Live". The dot is centered on the "LIVE" text's tall line box, so the dot reads low vs the caps (the Designer's "check the badge's own baseline"). **Add `leading-none` to that LIVE `<span>`** so the dot centers on the caps; then the outer `items-center` centers the (now cap-hugging) badge against "OPEN GAMES".

For both: `leading-none` should take the visible offset from ~3-4pt down to ~1px (uppercase caps sit a hair above even a line-height:1 box centre). If the Designer still sees a sliver after that, the finishing touch is a 1px optical nudge on the icon/dot — but try `leading-none` alone first; it usually reads as centred. Client-only, CSS classes only; a test can assert the `<h2>`/badge carry `leading-none`.

---

**#3 — Navbar "Menu" active state: NOT a styling bug — needs a product decision.** The Owner is right that Menu has no function of its own. Verified in `HubToolbar.tsx`: **`Menu` and `Games` both call the same `onClick={onGames}`** ("menu + games both go to the home/games surface"), and the active item is a prop each screen hard-sets (`active="games"` on Home). There is no Menu surface, route, or overlay, so nothing ever sets `active="menu"` — which is *why* it never turns purple. The Designer's fix ("hook Menu into the same active mechanism, or style it while its overlay is open") assumes Menu opens something; today it doesn't. So painting it purple isn't possible without first giving it something to be active *on*.

Notably, the toolbar's own stated principle already covers this: Rewards and Chat are deliberately **greyed/reserved** — *"never a live-looking button that silently no-ops."* Menu currently violates that (it looks live but just re-lands on Games). Two honest ways to resolve, Owner/Designer to pick:
- **(A) Give Menu a real destination** — a slide-in menu drawer/overlay (settings, profile, help, sign-out, etc.) — and set its active state while open (`active="menu"`, or an "overlay open" flag). This is a small feature, not a one-liner, and needs content decided first.
- **(B) Mark Menu reserved/greyed** like Rewards/Chat until that drawer exists — honest per the toolbar's own rule, and a genuine one-liner (make it a `comingSoon` item). All five items then behave consistently: purple when active, grey when reserved.

I'd lean (B) for now (it's honest, tiny, and matches the existing pattern) and do (A) when there's actual menu content to show — but it's a product call. **I haven't ticketed #3** pending your choice; say which and I'll spec it.

Ask: ticket #1 + #2 (the `leading-none` fixes — ready to go). For #3, tell me (A) build a Menu drawer or (B) grey it as reserved, and I'll write it up.

### 2026-07-12#2 — Events card: new (wider) Dice Rush asset + match the hero corner radius (Designer)            [ANSWERED — live rev 00065]
From: Advisor   Re: Designer "Dice Rush card update"

Two small changes in `HomeHub.tsx`'s `EventsBanner`, plus an asset swap. Verified the current state on disk: the card is `<img … className="block h-auto w-full">` inside a `px-4` wrapper — **no rounding**. The old asset only looked rounded because its corners were baked dark to blend with the page; the **new asset is full-bleed with square corners** (JPG, `1569×848`, aspect ~1.85 — wider/shorter than the old ~1.33), so the rounding now has to come from CSS. That's exactly the Designer's ask.

**1. Swap the asset.** Replace `apps/web/src/assets/events/dice-rush.webp` with the new image (converted from the Designer's JPG to WebP to match the banner convention — 86 KB, `1569×848`; presented alongside this entry). Same path/filename → no import change. The card auto-shrinks to the new aspect: the img is already `h-auto w-full`, so the shorter image just makes a shorter card — **there is no fixed height to remove** (the old card carried none), and no letterbox/crop/stretch (`h-auto`, not `object-cover`). It's edge-to-edge inside the same `px-4` content width the hero cards use. ✓ all of point 1.

**2. Match the hero radius + clip (point 2).** Add the hero cards' exact radius token to the events img:
`className="block h-auto w-full"` → `className="block h-auto w-full rounded-[18px]"`.
The hero carousel cards use `rounded-[18px]` (in `HeroCarousel`), so this reuses the identical value on all four corners. Border-radius on a replaced `<img>` clips the image itself, so a full-bleed square-cornered asset won't poke past the rounding — no separate `overflow-hidden` is needed (this is the same pattern the hero uses: `rounded-[18px]` sits directly on each hero `<img>`). If you'd rather guarantee the two can never drift, hoist a shared `const BANNER_RADIUS = 'rounded-[18px]'` and use it in both `HeroCarousel` and `EventsBanner` — same value either way; the literal is fine for two call sites in one file.

**Test:** the events assertion added when the card became an image should now also assert the img carries `rounded-[18px]`. The `alt` is unchanged — the new image carries the same baked copy.

**Scope:** tiny, client-only, presentation — one asset file + one Tailwind class in `HomeHub.tsx`. No layout/data change.

Ask: drop in the new `dice-rush.webp` and add the `rounded-[18px]` class; ticket as a one-liner.

### 2026-07-12#1 — Blackjack: hide the opponent's card count again — revert the honest-reveal (Option A / PR #222) (Designer)            [ANSWERED — live rev 00065]
From: Advisor   Re: Designer "opponent's hits must not be visible during play"

**Decision reversal (recorded):** the Owner earlier chose **Option A** — expose the opponent's card count so their cards could flip in place. The Designer now overrules it: card count is information (multiple hits ⇒ weak start, standing pat ⇒ strength), and in the hidden-simultaneous model nothing about the opponent may surface until the reveal. This is the **stricter, charter-aligned** call — it *tightens* redaction invariant #2 rather than relaxing it, so it's the safe direction. The Designer's four points describe **exactly the pre-Option-A behaviour**, so the fix is a **revert of PR #222**, keeping **PR #226** (the GameHub continuity fix — unrelated, and it's what makes the deal-in reveal read cleanly now).

**Confirmed current state (verified on disk):** `blackjack.ts` `viewFor` in-play sets `handSize: s.hands[p].cards.length`; `BlackjackHub.tsx` renders `OppBackCard` × `oppCount-1` and flips them in place. That's #222. Revert target = the code that preceded it, which satisfies all four Designer points as-is.

**What to restore (revert #222 — module + client + docs + tests):**
1. **Server payload (`blackjack.ts`) — the Designer's strongest requirement (point 2: don't even *send* it).** `viewFor` in-play opponent branch back to `{ cards: s.hands[p].cards.slice(0, 1), done: false }` — **remove `handSize`.** Remove the `handSize?` field from `Hand`. Revert the two comments (`applyMove` "size is the one exception" and `viewFor` "size surfaced") to the original "nothing about the opponent's hand — values, count, stand/bust, seed — until terminal." The payload then genuinely carries no opponent hits/count/stand-bust/seed in play — visual hiding was never the ask, the data must be absent.
2. **`App.tsx`** — remove the mirrored `BlackjackHand.handSize?`.
3. **Client (`BlackjackHub.tsx`)** — back to: opponent = `oppCards[0]` (face-up) + **one** face-down hole card, and this **never changes during the live round regardless of hits** (point 1). At the reveal, the hole flips in place, then `oppCards.slice(2)` (the real hits) **deal in one-by-one from the deck** with the deal animation (point 3). Remove the `OppBackCard` multi-slot model, the `oppCount = handSize ?? …` logic, the `useRef(revealed)`/`flipDelay`/`initial rotateY` terminal-slot handling, and restore the single-`OppHoleCard` + `{revealed && oppCards.slice(2).map(...)}` fly-in branch and the prior z-order.
4. **Score bubble (point 4)** — falls out of the payload revert: the opponent total is computed from the redacted one-card hand, so it shows only the face-up value and never moves on hidden draws. Verify no code path totals the full hand in play.
5. **Docs (`docs/BLACKJACK.md`)** — revert the #222 wording (invariant #2, the actions/timer "nothing surfaced" line, the `viewFor` mapping bullet, the reveal-choreography + stacking paragraph, the "one continuous scene" paragraph) back to the count-hidden / hole-flip-then-deal-in model. (`SCREENS.md` had no choreography detail — nothing there.)

**Keep PR #226 (do NOT revert it).** It's the shared GameHub phase-bridge that stopped the whole board remounting at the decisive reveal — independent of the count model, and the reason the deal-in reveal now looks clean (your own cards and the opponent's first card stay put; only the hits animate in). Its regression test lives in `BlackjackHub.test.tsx` and asserts own + opponent **first-card** DOM identity across the terminal — that still holds in the reverted model (card 0 persists), so the test stays valid and passing.

**Cleanest path:** `git revert` the #222 merge for the source files (`blackjack.ts`, `App.tsx`, `BlackjackHub.tsx`, `BLACKJACK.md`) — those should revert cleanly (nothing since touched them; #226 was GameHub-only). **`BlackjackHub.test.tsx` will conflict** because #226 added its continuity test to that file *after* #222 — resolve by hand: take #222's test reversion (restore the original redaction/reveal tests, drop the slot/`handSize`/flip-in-place tests) **but keep #226's decisive-terminal continuity test**. Re-run it to confirm it still passes in the reverted model.

**Acceptance (Designer's test):** play a multi-hit round — from your screen the opponent's hand is pixel-identical (two cards, one face-down) from deal to reveal, with no count change / animation / timing cue when they act; a payload capture shows no opponent hits, count, or stand/bust before terminal; at the reveal the hole flips then the extra cards deal in one at a time; the opponent total shows only the face-up value throughout play.

**Scope:** revert of #222 across module + client + docs + tests, keeping #226. Owner-gated doc/redaction change, but in the tightening direction (Owner is directing it). One PR.

Note: this discards the multi-back slot model and the subtle terminal-slot flip logic from #222 — a deliberate reversal on the Designer's information-leak reasoning, not a defect. The hole-card flip-in-place itself predates #222 and is preserved.

Ask: ticket the revert. Confirm the payload-level assertion (no opponent hits/count/stand-bust in the in-play view) lands in the module test — that's the one that proves the Designer's point 2.

### 2026-07-11#6 — Events card: replace the built "Coin Flip Showdown" card with the Dice Rush image (Designer)            [ANSWERED — superseded by #12-2, live]
From: Advisor   Re: Designer "swap the event card image"

**Heads-up — it's not a `src` swap.** The current event card is **built markup**, not an image: the `EventsBanner` component in `apps/web/src/screens/HomeHub.tsx` composes a styled surface with a live `<h3>Coin Flip Showdown</h3>`, a date, a description, a `boltDecor` corner image, and a disabled button. The Designer wants the whole thing replaced by a single baked card image (text already in the image, corners already rounded), shown at native aspect, no crop, scaled to container width. So we swap the composed card for one `<img>` — which also deletes a fair bit of now-dead markup. (This is the card under the Home hub's **Events** tab, `cat === 'events'`.)

**Asset:** add **`dice-rush.webp`** to `apps/web/src/assets/events/` (I converted the Designer's PNG to WebP to match the other banner assets — **99 KB vs 2.25 MB**, native **1570×1178**, ~4:3; presented alongside this entry). PNG would also work, but WebP matches convention and is ~23× smaller.

**Change (`HomeHub.tsx`):**
- Add the import: `import diceRush from '../assets/events/dice-rush.webp';`
- Replace the entire `EventsBanner` body with the image, at native aspect / no crop / full container width — note this uses `h-auto` (native ratio), **not** the hero carousel's `object-cover` (which crops):
  ```tsx
  function EventsBanner() {
    return (
      <div className="px-4">
        <img
          src={diceRush}
          alt="Dice Rush tournament — one roll per round, highest number wins the bracket"
          data-testid="home-events"
          className="block h-auto w-full"
        />
      </div>
    );
  }
  ```
  (Keep the `px-4` wrapper so it aligns to the same content margin as the grid, and keep `data-testid="home-events"` on the img so existing selectors resolve.)
- **Remove the now-unused `boltDecor` import** (it was only used by the old EventsBanner decoration) — otherwise it's a dead-import lint error.

**Corners (one honest caveat).** The PNG is fully opaque; its rounded corners are baked by filling the corner triangles with a near-black `#0E0E19`, which sits on the page background `#0B0B0B` — so on-page it reads as cleanly rounded (the two near-blacks are indistinguishable). I did **not** add CSS rounding: the baked radius is unknown (CSS-rounding would clip the card), and I can't colour-key the corners transparent because the "TOURNAMENT" pill uses that same dark tone. If the Designer wants pixel-perfect corners on *any* background, the clean fix is a re-export with **transparent** corners — flag it back to them; otherwise as-is is fine on the dark page.

**Test (`HomeHub` test):** the events assertion that looks for "Coin Flip Showdown" text must change — that text is gone (baked into the image now). Assert the `home-events` img renders with the expected `src`/`alt` instead.

**Scope:** one small client PR — `HomeHub.tsx` + the new `assets/events/dice-rush.webp`. Presentation only; no protocol/data change.

Ask: drop the asset in and ticket the swap. Confirm with the Designer whether they want the transparent-corner re-export (only matters if the card ever sits on a non-dark surface).

### 2026-07-11#5 — Reserved "Demo" takers (plan-B): gate the bot-crowd to a single "Demo" account @ 1¢, 3 games (tools-only, demo-only)            [OPEN — for demos]
From: Advisor   Re: Owner — a reserved fallback opponent for coinflip/blackjack/chess when the live crowd isn't running

**Context/why:** normal testing/demos still use the full `bot-crowd` under the team's real names, run by the Owner — unchanged. This adds a **plan-B**: a small, gated set of takers tied to one reserved account named **`Demo`**, for the rare occasions a demonstrator needs an opponent and the Owner isn't available to run the crowd. It runs on-demand (a VM the Owner starts before a demo and stops after — see the VM setup doc), not 24/7.

`tools/bot-crowd` already does the mechanics (ordinary `🤖` clients on the live API; `taker` policy claims a human's posted challenge). Two small changes make it demo-safe and scoped. **All tools-only — not in the build, not shipped to Cloud Run — zero production risk, and it can go in fast.**

**Fairness guard (keep invariant #1 honest):** as-is, a taker claims *any* non-`🤖`, non-100 challenge in its game — which could match a real investor/public account. Gate it so **only the reserved `Demo` account at 1¢** ever draws a bot; every other account is left untouched. Keep the `🤖` prefix (ADR-010 honesty label — don't remove). Because this only runs during a demo and only answers `Demo`, no real user is ever paired with the house.

**Change 1 — `config.ts`: add gating + a taker-only roster switch (all env-driven, default = current behaviour, so the full crowd is unaffected).**
```ts
// allowlist of human owner names a taker will claim (empty = any human, current behaviour)
takerAllowNames: (process.env.TAKER_ALLOW_NAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
// only claim this stake (0 = any non-reserved, current behaviour)
takerStake: num('TAKER_STAKE', 0),
// when set, ROSTER = one taker per listed game and NO resters (demo "on duty" mode)
takerOnlyGames: (process.env.TAKER_ONLY_GAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
```
Build the roster from `takerOnlyGames` when present:
```ts
export const ROSTER: BotConfig[] = config.takerOnlyGames.length
  ? config.takerOnlyGames.map((g) => ({
      name: `🤖${g}-taker`, gameId: g, stake: 1, policy: 'taker',
      ...(g === 'chess' ? { timeControlId: 'rapid10' } : {}),
    }))
  : [ /* existing 26-bot roster unchanged */ ];
```
(`config` must be defined before `ROSTER` — it already is; just reference it.)

**Change 2 — `bot.ts` `tryTake()`: honour the allowlist + stake.**
```ts
const allow = config.takerAllowNames;
const target = [...this.openChallenges.values()].find(
  (c) =>
    !c.ownerName.startsWith(BOT_PREFIX) &&
    c.stake !== HUMAN_RESERVED_STAKE &&
    (config.takerStake === 0 || c.stake === config.takerStake) &&
    (allow.length === 0 || allow.includes(c.ownerName)),
);
```

**Run it (the plan-B invocation):**
```
SERVER_URL=https://rapidclash-847070222251.us-central1.run.app \
ADMIN_PASSWORD=<server admin password> \
TAKER_ONLY_GAMES=coinflip,blackjack,chess \
TAKER_ALLOW_NAMES=Demo \
TAKER_STAKE=1 \
pnpm --filter @rapidclash/bot-crowd start
```
`ADMIN_PASSWORD` enables top-ups so the three bots never run dry (they bet 1¢, so drift is tiny — free insurance). Flow at a demo: the demonstrator logs into the reserved **`Demo`** account, opens the game, sets 1¢, presses **PLAY** (posts a challenge) → the on-duty taker claims it in ~1s → match settles. Note `Demo` is matched **case-sensitively** — log in with that exact username, and it must equal `TAKER_ALLOW_NAMES`. Chess: the taker plays random legal moves, so games run to a natural end — the demonstrator can win or resign.

**Load/safety note:** three takers at the ~700ms cadence is trivial load (far below the 26-bot run that tore the snapshot), and that root cause is fixed anyway (atomic snapshot, PR #207/#222). No concern.

**Verification (tools has no test glob — do it by hand):** with the gating envs set, a `🤖`-owned, non-`Demo`, or non-1¢ challenge is NOT taken; a `Demo` 1¢ challenge IS taken within ~1s.

Ask: apply the tools-only change (fast, low-risk) so the Owner can stand up the reserved plan-B host. VM setup steps are in the companion doc for the Owner (PM to assist if needed).

### 2026-07-11#4 — Header: align the logo to the content grid — drop the leftover -ml-3 (Designer)            [ANSWERED]
From: Advisor   Re: Designer "align the logo to the content edge" + Owner's 40px measurement

Root cause (verified in HubRibbon.tsx). The logo button carries a hardcoded negative margin: className="-ml-3 flex items-center". -ml-3 = −12px left margin. The header's inner row is px-4 (16px) and every content section/banner is also px-4 (16px) — so they would align, but -ml-3 pulls the logo out to 16 − 12 = 4px while the content sits at 16px. That ~12pt offset is the Designer's "half-a-bolt too far left" and matches the Owner's ~40-image-px estimate (≈12pt at the wordmark's h-8 render scale). It's a leftover from the pre-tight-crop wordmark (which had transparent padding baked in — the negative margin pulled the inset bolt back to the edge); once PR #199 tight-cropped the asset so the bolt is flush at the image's own left edge, that compensation became a 12px over-pull. Same tight-crop aftermath as the earlier header fixes — no image change is needed, so no distortion risk.

Fix (one line, HubRibbon.tsx): drop -ml-3 from the logo button — className="-ml-3 flex items-center" → className="flex items-center". The logo then sits at the row's px-4, the identical container padding the content sections use (responsive at every width, not a hardcoded offset — exactly the Designer's "use the container padding" ask). Logo size (h-8) unchanged.

Confirming the Designer's right-side question: the wallet/auth pill has no offset of its own — it's the right child of the justify-between … px-4 row, so its right edge already sits on the row's px-4 (16px) = the content/banner right edge. Nothing to change there; once the logo drops back onto the grid, both edges are aligned.

Test (HubRibbon.test.tsx): assert the logo button no longer carries -ml-3 (no negative left margin), and that the row keeps px-4. Existing logo-size/bg-background/pb-4 assertions unchanged.

Scope: one-line client change, HubRibbon.tsx (+ the test). No asset edit, no other layout change.

Ask: ticket the one-liner. (Owner: no need to re-pad the wordmark — the stray negative margin was the whole problem.)

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
