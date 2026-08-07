# Guest-Mode Contract  `v0.2.1 · sizing pinned (measured) 07 Aug 2026`

The versioned seam between **`rapidclash-demo`** (Provides) and **`rapidclash-landing`** (Consumes). v0.2.1 pins the embed sizing to the PM's headless-Chromium measurements (PR #287). Phase 2 (roadmap 2.1/2.2) — does not block Stage-2 launch.

## 1. Entry point (Provides)
A stable guest entry (route/flag). Opening it mints a **new, isolated, anonymous, ephemeral session** (no account/email/password/persistence), auto-provisions credits, and lands the visitor in the curated surface — no auth wall, no waitlist inside the surface.

## 2. Config params (Provides)
`games` (curated whitelist; v1 = `[coinflip]`), `credits` (starting `¢` stack — modest, §8), `chrome` (`embed` compact vs `full`), `autostart`. Advisory hints; the server bounds them.

## 3. Embedding — iframe (Decision 1, ratified)
Same app, separate deployments, joined by an `<iframe>` (no same-origin co-hosting).
- **Provides (demo):** serve the guest entry with `CSP: frame-ancestors https://rapidclash.com https://staging.rapidclash.com` (+ preview origins); **no** `X-Frame-Options: DENY/SAMEORIGIN`; support `allow="fullscreen"`.
- **Consumes (landing):** minimal `sandbox` (`allow-scripts allow-same-origin`; `allow-forms`/`allow-popups`/`allow-fullscreen` only as needed; **never `allow-top-navigation`**); add the demo origin to `frame-src`. Isolation rests on `frame-ancestors` + origin-validated messaging + no top-navigation, not the sandbox alone.
- **Lazy-load (landing, non-negotiable):** the iframe loads **only on visitor click**; the static screenshot is the default and the **fallback**. *(Demo implication: first click is a cold entry — keep the guest entry warm/fast.)*

## 4. Shell, fullscreen & sizing (Decision 2 · sizing pinned v0.2.1)
Desktop: the phone-mockup shell is the iframe container; the click-safe lightbox enlarges it. Mobile: "step into the app" = **fullscreen (100vw/100vh)**.

**Sizing (measured, headless Chromium @ 320/390/448/600px — PR #287):**
- **Fluid, not fixed-then-scaled.** Reflows responsively to a hard **`max-w-md` = 448px** ceiling; **min ~320 (tested clean)**, **target ~390**, portrait. Give the iframe a width in that range — it lays out correctly, **no `transform: scale`**. Zero horizontal overflow at any width. (The one hard-fixed element is the Coinflip coin canvas, 216px.)
- **Normal scrolling mobile page by design** (sticky ribbon top, fixed toolbar bottom, body scrolls) — **not** a fixed single-screen/no-scroll layout.
- **Height: 832px measured, identical at every width.** Useful content **720px** + **112px dead space** (`HUB_BODY` toolbar-reserve padding, applied even though guest hides the toolbar). The demo-side trim (#G2) removes the 112px → **~720px**.
- **Landing frame's screen cutout must allow ~720px viewport height** (post-trim; 832 pre-trim). A cutout shorter than that is what overflows. Fit is a **height** concern, not width. Exact cutout dims finalised jointly once #G2 lands.

## 5. Events — versioned `postMessage` protocol
Envelope `{ v: 1, type, payload? }`. **Both sides validate `event.origin`** against the exact counterpart; **never** `*` targetOrigin for anything sensitive.
- **demo → landing:** `ready`; `resize { height }`; `requestFullscreen` (mobile); `firstWin` / `registerIntent` (guest's first win → landing renders the register prompt, `source=post_win_prompt`, **no PII**); *(later)* `gameStarted`/`gameEnded`/`creditsChanged` (aggregate, no PII, no demo store).
- **landing → demo:** `config { games?, credits?, chrome? }` (optional; params may also ride the entry URL).

## 6. Guarantees — what guest mode DOES (Provides)
No registration; instant ephemeral credits (session-scoped, never touch the real ledger); **honestly-labelled in-app demo bot** opponent (instant pairing); **server-authoritative**, same redaction/`viewFor` integrity; curated subset; inherits demo improvements automatically.

## 7. Non-goals (Provides)
No wallet persistence/history; no live human matchmaking; no leaderboard/profile/account/avatar; **no registration/waitlist inside the surface** (CTA + post-win prompt live in the landing frame — the demo only emits `firstWin`); no real-money anything; **no PII collection.**

## 8. Limited taste (owner decision)
A *tasting*, not the meal: capped credits + short/curated session so a too-generous demo doesn't substitute for the real platform. v1 = one game (Coinflip), modest credits, reset on reload/expiry. The "demo vs a bot — the real thing is players-vs-players" framing lives in the landing frame + CTA copy.

## 9. Abuse guard (Provides)
The entry is public via the landing page → **guest-session creation is rate-limited demo-side** (#270, done).

## 10. Ownership & change rule
Demo: entry point, session factory, bot opponent, ephemeral credits, curated surface, chrome, framability/CSP, `postMessage` emitter, rate-limiting. Landing: shell, responsive/fullscreen, CTA + post-win prompt, lazy-load, pointing at the entry. **Rule:** game behaviour changes only in `rapidclash-demo`; landing configures and frames — never modifies game logic/styling.

## 11. Sign-offs / open
- **Counsel:** charter-exception (labelled-bot / play-money / not-real) + a Privacy-Policy line (preview anonymous, cookieless, collects nothing; landing `demo-open` metric, if added, cookieless/aggregate).
- **Open (demo-side):** final `credits` + session lifetime/reset; rate-limit thresholds; exact container dims (joint, post-#G2); later engagement-events slice.

*Changelog: v0.2.1 — §4 sizing pinned to measured numbers (832/720/112, fluid ≤448) per PR #287. v0.2 — added iframe/CSP, shell, Events, limited-taste, abuse-guard. v0.1 — initial seam draft.*
