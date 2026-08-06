# Anonymous Preview (Guest Mode) — Strategy Note  `DRAFT · Owner-gated`

## 1. Purpose & context
The landing site (`rapidclash-landing`) wants its demo-app screenshot to become an **interactive, playable preview** for anonymous visitors — a taste of the games, with no registration. This sits beside the existing **investor demo**, which is the full registered experience.

Two temporary audiences, one product:
- **Investors** → the normal demo (registered, full surface).
- **Potential platform users** → a **truncated preview** of the *same* app, playable without an account.

Both are pre-commercial. When the commercial phase begins, the platform is expected to be rebuilt on a commercial-scale engine (operations + regulatory functions). So guest mode is **deliberately lightweight and temporary** — a configuration of today's demo, not new infrastructure to carry forward.

## 2. The decision
**Build the anonymous preview as a "guest mode" inside the real demo app (Option B), server-authoritative.** Confirmed by the Owner:
- **One codebase.** The preview is a *runtime mode* of `rapidclash-demo`, not a fork. Every game improvement made in the demo is inherited by the preview automatically — the "don't maintain it twice" requirement is satisfied by construction.
- **Server-authoritative stays.** User numbers are small, so server load is not a concern, and keeping the real server in the loop preserves the demo's integrity: redaction / `viewFor`, the "provably fair" story, and the "client never decides outcomes" model all remain true in the preview. A client-only preview engine was considered and rejected — it would quietly re-introduce a second codebase and weaken the fairness story.
- **B now, C later.** If the preview succeeds and duplication ever starts to hurt, the natural next step is extracting the game UIs into a shared package (Option C). Not now — that refactor is premature before the preview has proven its worth.

## 3. What "guest mode" is — four toggles
Guest mode is the real app with four things flipped. Each maps onto a seam that already exists:
1. **Opponent = the app.** A bot takes the guest's game — reuse/generalise the existing **bot-crowd "Demo taker"** path (the reserved `Demo` account, `TAKER_ONLY_GAMES`), pointed inward instead of at a human. Do **not** build a new opponent AI.
2. **Credits = ephemeral.** A fixed starting stack (e.g. a few hundred `¢`), provisioned to the guest session and **not persisted** — resets on reload / session end. No wallet ledger history. `¢`-only, "no real-world value" framing unchanged (arguably safer — nothing persists).
3. **Identity = throwaway session.** No sign-up, no email, no stored profile — an anonymous session token. This makes the privacy posture *simpler*, not harder: collecting nothing sidesteps the consent/18+/GDPR machinery the real waitlist needs. *(Landing-side confirm.)*
4. **Surface = curated taste.** A small hand-picked set of games that show off well solo (e.g. Coinflip, Dice, +1–2). **Not** the full 13, the leaderboard, or real Open Games with strangers.

## 4. Reuse, don't rebuild
Guest mode should be assembled from existing mechanisms: the **bot-taker** for the opponent, the **wallet** for credits (marked session-ephemeral), the **redaction/`viewFor`** model unchanged (the bot is a server actor, so redaction still holds). The net new work is a **guest session type** on the server (anonymous, ephemeral credits, auto-provisioned) plus a **client entry + chrome flags** (hide wallet/waitlist chrome, auto-spawn the bot opponent, curated tile set). It is not a reimplementation of any game.

## 5. Charter exception + sign-offs required
Charter invariant #1 says *humans play humans, never the house.* Guest mode is a **deliberate, clearly-labelled exception**: the opponent is the app. This needs explicit **Owner + counsel sign-off**, with these mitigations on record:
- The opponent is honestly presented as a **demo bot** (reuse the `🤖` honesty convention), never disguised as a real player.
- **Play-money only**, ephemeral, no real-world value — no real-money framing anywhere in the preview.
- It is a **solo preview**, distinct from the investor demo, and never presented as live multiplayer.

## 6. Two delivery lines, two teams
Both audiences run the *same* app; the difference is configuration:

| | Investor demo | Anonymous preview |
|---|---|---|
| Audience | Investors | Potential users (via landing) |
| Account | Registered | None (guest session) |
| Credits | Normal demo wallet | Ephemeral, instant |
| Opponent | Humans (+ demo takers) | The app (bot) |
| Surface | Full | Curated subset |
| Codebase | `rapidclash-demo` | **Same** app, guest mode |

**Team coexistence:**
- **Demo team owns `rapidclash-demo`** — *and owns guest mode as a first-class feature within it* (the session type, the bot path, the ephemeral credits, the chrome flags), tested in the demo repo.
- **Landing team owns `rapidclash-landing`** — *only the embedding and marketing frame* (desktop handset-shell, mobile go-fullscreen, the surrounding CTA), pointing at the demo's guest entry point.
- **The seam is the Guest-Mode Contract** (companion doc) — a thin, versioned interface. Improvements ship in the demo and the embed inherits them with zero landing-side work.
- **Working-agreement rule:** *game behaviour changes only in `rapidclash-demo`; the landing repo may only configure and frame it.* The moment the landing team reaches into game logic, the fork you're avoiding has begun. (This is the two-repo analogue of the demo's "PM works from the designer file, not memory" discipline.)

## 7. Don't over-build
Because the commercial platform will be a separate rebuild, guest mode should stay a **thin config layer**. Resist building durable guest infrastructure (persistent guest analytics stores, elaborate bot AI, a second Open Games system). Cheap, ephemeral, rate-limited-enough-for-abuse, disposable.

## 8. Open questions (deliberately unresolved)
- **Which games** are in the curated set, and in what order?
- **"Join another player's bet" imitation** — a *scripted, honestly-labelled* Open-Games feel (demo opponents), or omit for v1? (Recommend: later/optional layer, not v1.)
- **Embedding mechanism** — iframe (needs `frame-ancestors`/CSP + responsive-to-container) vs same-origin route; desktop handset-shell vs mobile fullscreen. *(Landing-context.)*
- **Session lifetime / reset** behaviour and light **rate-limiting** for abuse.
- **Analytics** — do we measure the anonymous funnel, and if so, privacy-preserving and disclosed?
- **CTA seam** — where "register for launch" lives (landing frame, not inside the game surface).

## 9. Next steps
1. Owner + counsel sign-off on the §5 exception.
2. Ratify the companion **Guest-Mode Contract** as the team seam.
3. Answer the §8 questions enough to scope a first curated slice (likely: guest session type + bot opponent + 2 games + ephemeral credits).
4. Landing context confirms the embedding mechanism.
