# @rapidclash/design-fidelity

Demo/dev-only (ADR-010, same carve-out as `tools/bot-crowd`). **Not shipped.** Excluded from the
root `tsc -b` build, the lint globs, the test globs, and the production image.

Phase 2 of the old→new design migration (`docs/NEW_DESIGN_MIGRATION.md`). A screenshot-diff
harness that turns "is this screen 1:1 with the design?" into a number, in **both themes**, so
every screen after the first verifies itself instead of being eyeballed.

## How it works

```
design/prototype/RapidClash Full Spec.html   ──capture──▶  references/{dark,light}/<screen>.png
        (the committed source of truth)                             │
                                                                    ▼
our built app  ─────────────────────────────capture──────▶  captures/{dark,light}/<screen>.png
                                                                    │
                                                          pixelmatch ▼
                                                          diffs/<theme>-<screen>.png  + a fidelity %
```

- **The prototype does not render standalone.** Its `support.js` (dc-runtime) fetches React 18.3.1
  UMD from unpkg at boot. The harness intercepts those requests in Playwright and fulfils them
  from the workspace's own `react`/`react-dom` (`src/paths.ts`) — hermetic, version-locked, no CDN.
- **The committed `design/prototype/screenshots/*` are 924×540 canvas thumbnails** — unusable as
  pixel references. The harness self-captures the real reference set from the running prototype at
  390×844, per the Designer's instruction ("don't wait on design, don't relay phone photos").
- **Light mode** is captured by driving the prototype's own Preferences theme buttons
  (`pickLight`/`pickDark`), then re-capturing every screen.

## Commands

```
pnpm --filter @rapidclash/design-fidelity capture:prototype [screenId]   # regenerate references/
pnpm --filter @rapidclash/design-fidelity diff [screenId]                 # captures/ vs references/ → report
pnpm --filter @rapidclash/design-fidelity typecheck
```

Chromium: uses the Playwright browser cache (`~/.cache/ms-playwright`, or
`PLAYWRIGHT_BROWSERS_PATH`). CI/fresh machines: `pnpm exec playwright install chromium`, or point
`DESIGN_FIDELITY_CHROME` at a binary.

## Status — foundation working (see `docs/NEW_DESIGN_MIGRATION.md`)

**Done:**
- Package scaffold, `typecheck` green.
- Hermetic prototype render — React 18.3.1 served from the workspace, no CDN.
- Light theme via HTML-injection of `theme: 'light'` into the component's initial state (the
  prototype's "System" option is cosmetic and the value isn't persisted, so driving the in-app
  picker per capture was unreliable).
- `capture-prototype` drives all **8 screens × 2 themes = 16 reference captures**, clipped to the
  phone-screen element (bezel dropped).
- `diff` / `report` — pixelmatch, per-screen fidelity %, diff images, `report.json`.

**Remaining before this is load-bearing:**
- **Clip height.** Captures are 390×840 but the prototype's per-screen content is shorter and
  top-aligned, leaving dead space below. Trim to content height (or a fixed above-the-fold
  window), and drop the mock iOS status bar + mock URL bar so the diff is screen-content only.
- **Toast bleed.** The sign-in `LOGGED IN` toast is still visible in `account-signed-in`; wait it
  out (or suppress `showToast`) before capturing.
- **App side.** A `capture-app` command that builds/serves `apps/web` and drives it to each state,
  writing `captures/{dark,light}/<screen>.png`.
- **One screen wired end-to-end** as the worked example, then commit the reference set (currently
  gitignored — regenerate with `pnpm capture:prototype`).
- **CI**: `pnpm exec playwright install chromium` step if the harness is ever run in CI.
