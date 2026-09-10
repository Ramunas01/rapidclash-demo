# @rapidclash/design-fidelity

Demo/dev-only (ADR-010, same carve-out as `tools/bot-crowd`). **Not shipped.** Excluded from the
root `tsc -b` build, the lint globs, the test globs, and the production image.

Phase 2 of the old→new design migration (`docs/NEW_DESIGN_MIGRATION.md`). A screenshot-diff
harness that turns "is this screen 1:1 with the design?" into a number, in **both themes**, so
every screen after the first verifies itself instead of being eyeballed.

## Pipeline

```
design/prototype/RapidClash Full Spec.html   ──capture-prototype──▶  references/{dark,light}/<screen>.png   (committed)
        (committed source of truth)                                            │
                                                                               ▼
the built app (served locally)  ────────────────capture-app──────────▶  captures/{dark,light}/<screen>.png
                                                                               │
                                                                     pixelmatch ▼
                                                            diffs/<theme>-<screen>.png  +  a fidelity %  +  report.json
```

## Commands

```
pnpm --filter @rapidclash/design-fidelity capture-prototype [screenId]              # regenerate references/
pnpm --filter @rapidclash/design-fidelity capture-app --url <http://…> [screenId]   # capture the running app
pnpm --filter @rapidclash/design-fidelity diff [screenId]                           # score captures/ vs references/
pnpm --filter @rapidclash/design-fidelity typecheck
```

**Serving the app for `capture-app`** (the server also serves the built PWA, so one process):

```
pnpm --filter @rapidclash/web build
pnpm --filter @rapidclash/server build
DB_PATH=/tmp/fidelity.db node apps/server/dist/index.js        # :3000
pnpm --filter @rapidclash/design-fidelity capture-app --url http://localhost:3000
```

or set `DESIGN_FIDELITY_APP_URL` to a deployed preview.

**Chromium** comes from the Playwright browser cache (`~/.cache/ms-playwright`, or
`PLAYWRIGHT_BROWSERS_PATH`); or set `DESIGN_FIDELITY_CHROME`. CI would need
`pnpm exec playwright install chromium` — nothing runs the harness in CI today.

## The Designer's fidelity spec (2026-09-09, `TO-designer-harness-and-hero.md`)

- **Gate: ≥ 99.5% fidelity** (≤ 0.5% differing pixels), pixelmatch at 0.1 AA tolerance — **plus a
  human looks at any diff image with drift** (200 wrong pixels in the wrong place passes a % gate
  and still looks broken). `diff` prints PASS/FAIL per screen/theme.
- **Engine noise isn't a concern** — prototype and app render in the *same* Chromium/fonts/
  rasteriser, so every diff is real. What *is* noise — animation, randomness, clocks — is killed
  by the freeze layer (`src/freeze.ts`): pins `Math.random`/`Date.now`, strips all transitions
  and animations, both sides, before capture.
- **Masked regions** (`src/screens.ts` `MaskRect`) are areas the Designer said to carry over from
  production unchanged — the games-hero **banner carousel** is the first. Filled flat-grey in
  both images and excluded from the score, so a rebuild doesn't fail on a difference chosen on
  purpose.
- **Canonical viewport 390×840** — the prototype's inner `#__df_screen` box, not the 437×893
  wrapper (a picture of a phone).

## How it works — the non-obvious parts

- **The prototype doesn't render standalone.** Its `support.js` (dc-runtime) fetches React 18.3.1
  UMD from unpkg at boot. The harness intercepts those requests in Playwright and fulfils them
  from the workspace's own `react`/`react-dom` — hermetic, version-locked, no CDN.
- **Light mode** is injected as `theme: 'light'` into the component's initial state via an HTML
  route. The prototype's "System" option is cosmetic and the value isn't persisted.
- **The committed `design/prototype/screenshots/*` are 924×540 canvas thumbnails** — unusable as
  pixel references. The harness self-captures the real set from the running prototype.
- **Both captures are anchored on a shared landmark, then clipped to that band** (`src/region.ts`):
  - default `anchor: 'header'` — RapidClash wordmark / LOGIN row → top of the bottom-nav. Drops
    the prototype's fake iOS status bar and fake URL bar (the real app has neither).
  - `anchor: 'catrail'` (the games screens) — the category rail's ORIGINALS tab → top of the
    bottom-nav. The carried-over banner between the header and the rail renders taller in the
    real app than in the prototype, so anchoring above it would push everything below out of
    line; anchoring on the rail sidesteps that.
- **The bottom-nav** sits at different heights (prototype's squeezed mockup vs the app's full
  viewport), so it's compared *separately*: a screen with `capturesNav: true` also grabs a
  `<screen>.nav.png` strip (`navRegion` in `src/region.ts`), aligned on the nav's own top and
  diffed as its own `<screen>.nav` row. The nav is shared chrome — one screen carrying it
  (`account-login-sheet`) is enough coverage.
- **Size mismatch** — the header/nav-anchored regions still differ in height between the two
  sides; `diff` compares the shared top-left window and flags it.
- **Below-the-fold coverage** (Designer Q3: "full page, captured in viewport-sized slices") is
  separate from all of the above — a screen with `scrollFrames: true` skips anchor-cropping
  entirely and instead scrolls its real content (`src/scroll.ts`), taking one raw, full-viewport
  screenshot per scroll position: `<screen>.frame0.png`, `.frame1.png`, … The two sides scroll
  differently under the hood (the prototype's phone-screen content scrolls inside
  `[data-rc-scroll]`; the built app scrolls the real page `window`, since `HubRibbon`/`HubToolbar`
  are sticky/fixed specifically so the body scrolls under them) — `scroll.ts` hides that behind
  one call. Frame count isn't fixed; `diff` walks forward while either side has that index, so a
  screen whose content grows doesn't need a hardcoded count anywhere. `rewards` carries
  `scrollFrames: true` today with no `driveApp` yet — the reference frames are ready and diffed as
  "no app capture" until RewardsHub is rebuilt and reachable to add one.

### Known limitations

- **Residual vertical drift on the games screens** — measured (`NEW_DESIGN_MIGRATION.md`) to be
  real fidelity gaps (tile aspect ratio, spacing), not a harness artifact. Per-section anchoring
  would *hide* those, so it's deliberately not done. Read the diff image for vertical rhythm.
- The number isn't a trustworthy pass/fail gate yet — the shared chrome + light theme still need
  to land across every screen.

## Adding a screen to the app side

`src/screens.ts` has all 8 states with a `driveProto`. `driveApp` is wired for the four games
screens (`catrail`-anchored) and `account-login-sheet` (`header`-anchored — the harness's
HubRibbon + bottom-nav coverage). As each other screen is rebuilt, add its `driveApp`
(testid-based, mirrors `driveProto`) and pick an `anchor`.
