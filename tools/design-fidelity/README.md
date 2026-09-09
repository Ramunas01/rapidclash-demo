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

## How it works — the non-obvious parts

- **The prototype doesn't render standalone.** Its `support.js` (dc-runtime) fetches React 18.3.1
  UMD from unpkg at boot. The harness intercepts those requests in Playwright and fulfils them
  from the workspace's own `react`/`react-dom` — hermetic, version-locked, no CDN.
- **Light mode** is injected as `theme: 'light'` into the component's initial state via an HTML
  route. The prototype's "System" option is cosmetic (nothing reads `prefers-color-scheme`) and
  the value isn't persisted, so driving the in-app picker per capture was unreliable.
- **The committed `design/prototype/screenshots/*` are 924×540 canvas thumbnails** — unusable as
  pixel references. The harness self-captures the real set from the running prototype, per the
  Designer's instruction ("don't wait on design, don't relay phone photos").
- **Prototype captures are clipped** to the phone-screen element minus the fake iOS status bar
  (top 44px) and the fake in-app-browser URL bar (bottom 64px) — `CAPTURE_INSET` in
  `src/prototype.ts`. The real app renders neither.
- **Size mismatch** (reference is chrome-clipped at 778×1464, app capture is the full 780×1688
  viewport): `diff` compares the shared top-left region — effectively the above-the-fold area —
  and flags it. Refine once Designer Q2/Q3 (canonical viewport, above-fold-vs-full-page) land.

## Adding a screen to the app side

`src/screens.ts` has all 8 states with a `driveProto` (prototype nav) and, so far, `driveApp`
for `games-originals` only. As each screen is rebuilt, add its `driveApp` (testid-based, mirrors
`driveProto`). Screens without one are skipped by `capture-app` with a clear message.

## Status

Foundation done: 16 prototype references committed, `capture-app` + `diff` proven end-to-end
(`games-originals` scores ~80% dark / ~40% light against the current pre-redesign HomeHub — the
number the Games-hero rebuild will drive up). Open: per-screen `driveApp` funcs (added as screens
are rebuilt); the size-mismatch handling above; a fidelity **bar** (Designer Q1).
