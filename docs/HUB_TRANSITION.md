# Hub Transition — multi-screen → compact hubs

How we move the UI from one-screen-per-function to a few compact **functionality hubs**, using the Figma Make export (`design-ref/demo-dizainas/`) as the target design — while preserving the current multi-screen layout as a recoverable v1 draft.

**This is a presentation re-composition, not an engine change.** The functional core (protocol, `api.ts`/`ws.ts` hooks, ledger, matchmaking, redaction) is untouched. Hubs regroup the *same* working screens into fewer surfaces with in-place state transitions — the pattern `COINFLIP_HUB.md` already proved for Coinflip, generalized.

## What the export is

A Figma Make code export: Vite + React + TS + Tailwind + shadcn (our stack), with the full asset set (logo, bolt, and tiles for every game) in `src/imports/`. Liftable code **and** extractable assets — but generated-style: one large `App.tsx`, inline styles, hardcoded hex colors. So lifting means **refactor on the way in**: decompose into our component/hub structure, replace hardcoded colors with theme tokens, and rewire every data point to the real hooks.

## Preserve v1 (do first)

The "original design" is the current multi-screen *view layer*; the core is shared, so git already preserves it. Make it explicitly recoverable:
- Tag and branch the current UI: `git tag ui-v1-multiscreen` + `git branch ui/v1-multiscreen-archive`.
- One line in `SCREENS.md`: v1 (multi-screen) is the recoverable fallback draft; v2 (hubs) is the target.
- The hub work proceeds on its own branch. v1 is never deleted, just superseded.

## Where the files go

Drop the unzipped export into **`design-ref/demo-dizainas/`** (gitignored) on the WSL repo — the analysis source for the PM and Claude Code. Assets that ship get optimized later into `apps/web/src/assets/` (the existing pipeline). The export is reference, never deployed wholesale.

## The hub model

Each hub holds several functions on one screen, transitioning **in place over WS events — no route navigation** (the `COINFLIP_HUB.md` state model). First-pass mapping of the named `SCREENS.md` screens to target hubs (the analysis confirms/refines this):

| Target hub | Collapses these v1 screens | State / notes |
|---|---|---|
| **Auth** (gate, unchanged) | `auth` | Entry only; not a hub. |
| **Home hub** | `wallet` (balance ribbon) + `game-list` + `open-challenges` + leaderboard-lite + promo hero | Section/tab switching, no route nav. The `App.tsx` home composition. |
| **Game hub** (one template per game) | `stake-entry` + `lobby` + `play` + `coinflip-play` + `result` + that game's `open-challenges` | Idle → Waiting → In-match → Result, in place. This **is** `COINFLIP_HUB.md` generalized — parameterize per game (Coinflip, RPS, then Mines/Blackjack/Chess as built). |
| **Profile / Leaderboard hub** | full `leaderboard` + `wallet` ledger + player stats | Reachable from bottom nav (Account). |

Bottom nav: Games → Home hub, Account → Profile hub, wallet chip → wallet view; Rewards/Chat → visibly inactive "coming soon" (no screens exist).

## Analysis the PM/team must do

1. **Hub inventory** — list the hubs in the export and exactly what each contains (sections, rails, feeds).
2. **Screen → hub mapping** — confirm/refine the table above; for each hub element, name its data source (existing `api.ts`/`ws.ts` call + `@rapidclash/shared` type) and the v1 screen it reuses. Reuse logic, don't rebuild.
3. **State model per hub** — the in-place transitions over WS events; preserve server-authority and redaction (opponent/hidden info only at terminal).
4. **Design-system reconciliation (decision).** The export defines its own theme/inline colors; `apps/web` currently carries the Base44-derived tokens. Pick **one** canonical design system for v2 — recommended: adopt the export's, since it's the chosen target — and replace the hardcoded hex with proper theme tokens during the lift. Don't run two.
5. **Reconcile with `COINFLIP_HUB.md` (#81).** The export's Coinflip hub and the already-merged hub spec must agree; align the spec to the design (or vice-versa) so they don't fork.
6. **Honesty / product checks (the standing rules):**
   - Drop or "coming-soon" the **house-only games** in the asset set — Limbo, Crash, Keno, Hilo, Roulette — per invariant #1's PvP-only corollary. They cannot be playable.
   - Play-money `¢` throughout; remove any `$`/crypto/on-chain/real-money framing the export carries.
   - Server-side redaction preserved in every hub.
7. **Asset pipeline** — optimize the `src/imports/` PNGs into `apps/web/src/assets/`, keyed by game/screen, web-sized (the existing tile pipeline).

## Orchestration (sequence)

1. **Preserve v1** (tag/branch + `SCREENS.md` note). Drop the export into `design-ref/demo-dizainas/`.
2. **Analysis doc** — PM + Advisor produce the confirmed hub mapping, the design-system decision, and the honesty checklist (this doc is the skeleton). Owner reviews.
3. **Foundation PR** — adopt the chosen design system (tokens), optimize assets in, build green, no hubs yet.
4. **Build hub by hub, one PR each**, starting with the **Game hub for Coinflip** (already specced in #81 — the proven pattern), then the **Home hub**, then the Profile hub, then the remaining game hubs as their games land. Each PR reviewed against the Figma frame.
5. **Early checkpoint** — after the foundation PR **plus the first hub**, the owner eyeballs it on real data before the rest proceeds (visual appeal is the whole point).
6. Functional core stays untouched throughout; if a hub needs data the core doesn't expose, that's a flagged decision, not an improvised data layer.
