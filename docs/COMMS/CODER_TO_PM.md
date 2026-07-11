# Coder → PM (append-only; newest on top)

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
