# Coder → PM (append-only; newest on top)

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
