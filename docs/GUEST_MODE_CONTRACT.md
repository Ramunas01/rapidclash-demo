# Guest-Mode Contract  `v0.2 · ratified with landing team 04 Aug 2026`

The versioned seam between **`rapidclash-demo`** (Provides) and **`rapidclash-landing`** (Consumes). v0.2 folds in the landing team's ratified answers (`GUEST_MODE_LANDING_RESPONSE.md`): iframe embedding, CSP/`postMessage` security, lazy-load, CTA-via-event, and a new **Events** protocol. Phase 2 (roadmap 2.1/2.2) — does not block Stage-2 launch; ratify now, build after.

## 1. Entry point (Provides)
A stable guest entry (route/flag). Opening it mints a **new, isolated, anonymous, ephemeral session** (no account/email/password/persistence), auto-provisions credits, and lands the visitor in the curated surface — no auth wall, no waitlist inside the surface.

## 2. Config params (Provides)
`games` (curated whitelist; v1 = `[coinflip]`), `credits` (starting `¢` stack — modest, see §Limited taste), `chrome` (`embed` compact vs `full`), `autostart`. Advisory hints; the server bounds them.

## 3. Embedding — iframe (Decision 1, ratified)
Same app, separate deployments, joined by an `<iframe>` (no same-origin co-hosting).
- **Provides (demo):** serve the guest entry with `Content-Security-Policy: frame-ancestors https://rapidclash.com https://staging.rapidclash.com` (+ preview origins); **do not** send `X-Frame-Options: DENY/SAMEORIGIN`; support `allow="fullscreen"`; the surface is **fluid to its container**, portrait, min-width ~320 (target ~390).
- **Consumes (landing):** embed with a minimal `sandbox` (`allow-scripts allow-same-origin` for the demo's own session; `allow-forms`/`allow-popups`/`allow-fullscreen` only as needed; **never `allow-top-navigation`**); add the demo origin to `frame-src`. *(Note: `allow-scripts`+`allow-same-origin` is expected — the demo needs its own origin for its session — so isolation rests on `frame-ancestors` + origin-validated messaging + no top-navigation, not on the sandbox alone.)*
- **Lazy-load (landing, non-negotiable):** the iframe loads **only on visitor click**; the static screenshot is the default and the **fallback** (demo down / JS off / load fail). *(Demo-side implication: first click is a cold entry — keep the guest entry warm/fast so first impression isn't a spinner.)*

## 4. Shell & fullscreen (Decision 2, ratified)
Desktop: the existing phone-mockup shell is the iframe container; the built click-safe lightbox enlarges it. Mobile: "step into the app" = the embed goes **fullscreen (100vw/100vh)**. Exact dimensions/aspect finalized jointly.

## 5. Events — versioned `postMessage` protocol (NEW in v0.2)
Runtime messaging across the frame. Envelope: `{ v: 1, type, payload? }`. **Both sides validate `event.origin`** against the exact counterpart origin; **never** a `*` targetOrigin for anything sensitive. This is the load-bearing security rule.
- **demo → landing:**
  - `ready` — guest surface mounted and interactive.
  - `resize { height }` — content height so the shell can size to content (optional if the shell is fixed-aspect).
  - `requestFullscreen` — mobile: user tapped to enlarge; landing performs the viewport fullscreen (CSS 100vw/100vh, or Fullscreen API with `allow="fullscreen"`).
  - `firstWin` / `registerIntent` — the guest won their first game (roadmap 2.2); **landing** renders the register-for-launch prompt in its frame, tagged `source=post_win_prompt`. **Carries no PII.**
  - *(later slice, not v1)* engagement events — `gameStarted` / `gameEnded` / `creditsChanged` — lightweight, aggregate, **no PII, no demo-side store**; landing counts cookieless.
- **landing → demo:** `config { games?, credits?, chrome? }` — optional runtime config/ack (params may also ride the entry URL).
- Versioned via `v`; protocol changes announced at the seam.

## 6. Guarantees — what guest mode DOES (Provides)
No registration; instant ephemeral credits (session-scoped, not persisted, never touch the real ledger); **opponent is an honestly-labelled in-app demo bot** (instant pairing, no wait); **server-authoritative**, same redaction/`viewFor` integrity as the full demo; curated subset; inherits demo improvements automatically.

## 7. Non-goals — what guest mode does NOT do (Provides)
No wallet persistence/history; no live human matchmaking; no leaderboard/profile/account/avatar; **no registration or waitlist inside the surface** — the CTA and the post-win prompt live in the **landing frame** (the demo only emits `firstWin`); no real-money anything; **no PII collection.**

## 8. Limited taste (owner decision, 04 Aug 2026)
The preview is a *tasting*, not the meal: **capped credits + short/curated session** so a too-generous demo doesn't substitute for the real platform. v1 = one game (Coinflip), modest credit stack, reset on reload/expiry. The "this is a demo vs a bot — the real thing is players-vs-players" framing lives in the landing frame + CTA copy.

## 9. Abuse guard (Provides)
The entry is **public** via the landing page → **guest-session creation is rate-limited demo-side** (cheap sessions, but capped creation rate per origin/IP) so it can't be hammered into spinning up endless sessions/bots.

## 10. Ownership & change rule
Demo team: entry point, session factory, bot opponent, ephemeral credits, curated surface, chrome flags, framability/CSP, the `postMessage` emitter, rate-limiting. Landing team: shell, responsive/fullscreen, CTA + post-win prompt rendering, lazy-load, pointing at the entry. **Rule:** game behaviour changes only in `rapidclash-demo`; landing configures and frames — never modifies game logic/styling.

## 11. Sign-offs / open
- **Counsel:** charter-exception (labelled-bot / play-money / not-real) + a Privacy-Policy line (preview is anonymous, cookieless, collects nothing; if the landing `demo-open` metric is added, cookieless/aggregate).
- **Open (demo-side):** final `credits` + session lifetime/reset; rate-limit thresholds; exact container dimensions/aspect (joint); the later engagement-events slice.

*Changelog: v0.2 — added §3 iframe/CSP, §4 shell, §5 Events, §8 limited taste, §9 abuse guard; per landing response 04 Aug 2026. v0.1 — initial seam draft.*
