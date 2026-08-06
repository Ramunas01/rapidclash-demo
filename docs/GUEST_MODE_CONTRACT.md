# Guest-Mode Contract  `DRAFT v0.1 · Owner-gated`

The versioned seam between **`rapidclash-demo`** (provides guest mode) and **`rapidclash-landing`** (embeds it). The demo team builds against the "Provides" side; the landing team builds against the "Consumes" side. Neither reaches across it.

> Status: draft for discussion. Names/params below are placeholders to make the shape concrete — not final API.

## 1. Entry point (Provides)
A single, stable way to enter the app already in guest mode — e.g. a route `…/guest` or a flag `…/?mode=guest`. Opening it:
- creates an **anonymous ephemeral session** (no account, no email, no stored profile),
- **auto-provisions** the starting credit stack,
- lands the visitor directly in the curated game surface (no auth wall, no waitlist prompt inside the surface).

The demo team owns everything behind this entry point. The landing team only points at it.

## 2. Config params (Provides)
Draft, all optional with sane defaults:
| Param | Meaning | Default |
|---|---|---|
| `games` | Whitelist of curated game ids | server-defined curated set |
| `credits` | Starting ephemeral stack (`¢`) | e.g. `300` |
| `chrome` | `embed` (compact, no top wallet/waitlist chrome) vs `full` | `embed` |
| `autostart` | Open a specific game immediately vs the tile list | tile list |

Params are advisory hints to the *frame*; the server still bounds them (a landing embed can't grant itself 1,000,000¢).

## 3. Guarantees — what guest mode DOES (Provides)
- **No registration** — playable immediately, anonymously.
- **Instant ephemeral credits** — fixed stack, session-scoped, resets on reload/expiry. Not persisted.
- **Opponent is the app** — a demo bot (honestly labelled) takes the guest's game; reuses the bot-taker path.
- **Server-authoritative** — same real server, same redaction/`viewFor`, same "provably fair" integrity as the full demo. The preview is *not* a weaker client-side engine.
- **Curated subset** — a small set of solo-friendly games.
- **Inherits demo improvements** — because it's the same app, a game change in `rapidclash-demo` shows up in the preview with no landing-side work.

## 4. Non-goals — what guest mode does NOT do (Provides)
- **No wallet persistence / history** — no ledger a guest can inspect across sessions.
- **No real Open Games with strangers** — no live human matchmaking. (A *scripted, honestly-labelled* "demo opponents" feel is a possible later layer — out of scope for v0.)
- **No leaderboard, no profile, no account settings, no avatar picker.**
- **No registration/waitlist inside the game surface** — the "register for launch" CTA lives in the **landing frame**, around the embed, not in it.
- **No real-money anything; no PII collection.**

## 5. Embedding boundary (Consumes — landing team)
- **Desktop:** render the guest entry inside a **handset-shaped shell** occupying part of the page (the interactive replacement for today's screenshot).
- **Mobile:** **enlarge to fullscreen** so the preview takes the whole handset — effectively "step into the app."
- The demo provides an **embeddable, `chrome=embed` surface** that is responsive to its container. The landing team owns the shell, the responsive/fullscreen behaviour, and the surrounding marketing + CTA.
- **Mechanism TBD** (§ open questions): iframe (requires the demo to permit framing — `frame-ancestors`/CSP — and to size to its container) vs a same-origin embed. The demo team must decide and document this, as it's a "Provides" responsibility.

## 6. Integrity preserved
Guest mode weakens nothing about the fairness model. The bot opponent is a **server actor** (like a demo taker), so `viewFor` redaction still holds — the guest's client never sees more than a real client would. Play-money `¢` framing and "no real-world value" are unchanged.

## 7. Ownership & change rule
- **Demo team:** the entry point, session type, bot opponent, ephemeral credits, curated surface, chrome flags, embeddability. All game behaviour.
- **Landing team:** the shell, responsive/fullscreen, CTA, and pointing at the entry point with params.
- **Rule:** *game behaviour changes only in `rapidclash-demo`.* The landing repo configures and frames; it never modifies game logic or styling. Breaking this rule forks the codebase.

## 8. Versioning
This contract is versioned (`v0.1…`). Changes to the entry point, params, guarantees, or non-goals are announced at the seam so the landing embed can adapt deliberately — the two tracks coordinate here, not in shared source.

## 9. Open questions
- Embedding mechanism (iframe vs same-origin) + the exact framing/CSP posture.
- Final curated `games` set + default `credits`.
- Session lifetime, reset semantics, and light rate-limiting for abuse.
- Whether/how the scripted "join a bet" layer (§4) is added later.
- Where and how the register-for-launch CTA hands off from the preview to the real waitlist.
- Analytics on the anonymous funnel — measured? privacy-preserving? disclosed? *(ties to the strategy note §8)*
