# Advisor note — Guest-Mode seam ratified; demo-side actions            `follow-up to PM_BRIEF_demoguest`
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
