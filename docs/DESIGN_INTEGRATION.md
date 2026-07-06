# Design Integration

How to bring the design team's Base44 export into `apps/web` for the investor demo. The principle is a **re-skin**: lift the visual layer (Tailwind tokens, shadcn primitives, screen markup, framer-motion animations) and rewire every data call from Base44's SDK to the platform's real REST + WebSocket client. Keep the logic; adopt the look.

## Ground rules

- **Visual source:** the Base44 export, placed at `design-ref/` (gitignored). Claude Code lifts real components from it, not screenshots.
- **Data source stays ours:** all data comes from `apps/web/src/api.ts` (REST) and `apps/web/src/ws.ts` (WebSocket), typed by `@rapidclash/shared`. **No `@base44/sdk` call survives the port.**
- **Play-money only:** remove every Stripe / deposit / buy-chips affordance. Wallet and stakes must read as play-money. An investor demo must not look like real-money gambling.
- **Server stays authoritative:** game state arrives already redacted (`viewFor`). UI must reveal an opponent's hidden move/result only at `match.end` — never assume it holds that data earlier.
- **Convert JSX → TSX:** type props against `@rapidclash/shared`; no `any` for wire data.

## Mobile chrome (background, safe-area, browser bars)

One continuous dark surface, edge to edge, with the browser bars blending in. These landed as separate fixes — keep them together so seams don't return:

- **One canonical background — `#0B0B0B`.** The single page background is the `--background` token (`0 0% 4.3%` = `#0B0B0B`), applied via `bg-background` to `html`/`body`, page containers, and every lobby/game section. **Never hardcode a near-black page-background hex** — one token, so it can't drift. Floating panels/cards use `--rc-surface` (`#1a1a2e`) and their own styles; only the page-level background behind everything is `#0B0B0B`.
- **No seams.** The page scrolls as one uninterrupted `#0B0B0B` surface top → footer — no divider lines or shade steps between sections (e.g. no `border-top` on the footer).
- **`theme-color: #0B0B0B`** in the viewport meta, matching `--background`, so the browser chrome tints to our background.
- **`viewport-fit=cover`** in the viewport meta so the background fills the notch/home-indicator zones; pad fixed chrome with `env(safe-area-inset-*)` so content isn't hidden under them.
- **Body scrolls (no fixed-height shell).** `html`/`body`/root aren't locked to the viewport; full-height sections use `min-height: 100dvh` (not `100vh`) and the header is `position: sticky` — so mobile browsers collapse/restore their toolbars on scroll.
- **Bottom-nav solid fill.** The fixed bottom nav (`HubToolbar`) is a transparent bar around a floating `bg-surface` pill; behind/below it sits a **full-viewport-width `bg-background` fill**, `pointer-events-none`, z-ordered **content < fill < pill**, its top at the pill's **midline** (so the rounded corners have solid behind them) and its bottom reaching the safe-area inset. Stops content peeking through the gap/corners and gives Safari's bottom bar a constant colour to sample.
- **Safari expectation.** `theme-color` + a constant `#0B0B0B` bottom edge make Safari *blend to* our colour (its translucency stays on top) — steady and matching, **not** pixel-identical. That's as close as a browser tab allows; don't log it as a bug.

## Foundation (do first, one PR)

Before any screen is touched, stand up the design system in `apps/web` (which currently has no Tailwind/shadcn):

- Add deps: `tailwindcss` + `tailwindcss-animate`, shadcn/ui (Radix primitives), `framer-motion`, `lucide-react`, `recharts`, `canvas-confetti`, `clsx` + `tailwind-merge`.
- Port the export's `tailwind.config.js` (the color/typography/spacing tokens — this *is* the brand) and `index.css`.
- Port `src/components/ui` (the shadcn primitives) into `apps/web/src/components/ui`.
- Build must stay green with the design system present but screens unchanged. Ship this PR alone so the foundation is reviewable on its own.

## Screen-by-screen wiring

Each target screen already exists and is already wired to real data — the task is to replace its markup with the design's, keeping its data hooks. Endpoints below are from `PROTOCOL.md`; the client wrappers live in `api.ts` / `ws.ts`.

| Design source (Base44) | Target screen (`apps/web/src`) | Data source (real) | `@rapidclash/shared` type(s) | Notes / data gaps |
|---|---|---|---|---|
| `Home.jsx` (hero + sign-in) | `screens/Auth.tsx` | `api.register` / `api.login` (`POST /auth/register`, `/auth/login`) | `AuthRegisterBody`, `AuthLoginBody`, `AuthResponse` | Base44 likely blends hero + game grid on Home; split: auth goes here, the grid goes to GameList. |
| `Home.jsx` / `Lobby.jsx` (game grid) | `screens/GameList.tsx` | `api.games(token)` (`GET /games`) | `GameMeta[]` | Render **only** games returned by `/games` (rps, coinflip) as playable; everything else → coming-soon tiles (below). |
| `Lobby.jsx` + `components/lobby`, `components/pvp` | `screens/OpenChallengesList.tsx` | `ws.subscribeChallenges` → `challenges.list` / `challenges.update` events | `OpenChallenge`, `ChallengesListPayload`, `ChallengesUpdatePayload`, `ChallengeRemovedReason` | Their challenge/PvP cards are the visual for the open-challenges feed. Map `ownerName`, `stake`, `openedAt`, `expiresAt`; drive the countdown from `expiresAt` (server-authoritative — animation only). Tap → `ws.takeChallenge(matchId)`. |
| `GameLobby.jsx` (stake + waiting) | `screens/StakeEntry.tsx` + `screens/Lobby.tsx` | `ws.joinQueue(gameId, stake)` / `ws.leaveQueue`; `queue.waiting` event | `QueueJoinPayload`, `QueueWaitingPayload` | StakeEntry = amount input (typed-amount path unchanged). Lobby = waiting room; show the owner's own countdown from `queue.waiting.expiresAt` with the "auto-refunds, no need to cancel" copy. |
| `GameRPS.jsx` + `components/game` | `screens/Play.tsx` | `ws.makeMove(move, matchId)`; `match.start` / `match.state` / `match.your_turn` / `match.end` events | `MatchStartPayload`, `MatchStatePayload`, `MatchYourTurnPayload`, `MoveMakePayload`, `MatchEndPayload` | Render choices from `your_turn.legalMoves`. **Do not** show the opponent's throw until `match.end` — the `state` is redacted before then. |
| `GameCoinflip.jsx` + `components/coinflip` | `screens/CoinflipPlay.tsx` | same WS methods/events as Play | same as Play | The call (heads/tails) is the move. Flip result arrives only at `match.end` (`viewFor` hides it). Use `canvas-confetti` on a win. |
| match-end overlay (inside their game pages) | `screens/Result.tsx` | `match.end` event | `MatchEndPayload`, `SettlementSummary` | Win / lose / draw overlay + the wallet delta from `settlement`. Confetti on win; keep it tasteful for investors. |
| `Leaderboard.jsx` + `components/ranking` | `screens/Leaderboard.tsx` | `GET /leaderboard/:gameId` via `api` | `LeaderboardEntry` = `WinRateLeaderboardEntry \| NetWinningsLeaderboardEntry` | **Two ranking shapes** — render per `kind`: `win_rate` shows win rate; `net_winnings` shows an amount that **can be negative** (rake). Label it "net of platform fee". Use `recharts` if they chart it. |
| `MyProfile.jsx` / `PlayerProfile.jsx` | `screens/Wallet.tsx` (extend toward a Profile) | `api.wallet(token)` (`GET /wallet`) | `WalletResponse`, `LedgerEntry[]`, `LedgerEntryType` | Balance + recent ledger map cleanly. See the profile-stats gap below before building the W/L/avatar parts. **Strip Stripe/deposit UI.** |
| `GameChess/Baccarat/Blackjack/Dice/Mines/Poker/Roulette.jsx` | — (no screen) | none | `GameMeta` (if ever registered) | Not wired. Render as **coming-soon tiles** using their art. Shows breadth to investors without building them. |
| `PrivacyPolicy.jsx` / `TermsConditions.jsx` | optional static routes | none | — | Optional; nice-to-have polish, no data. |

## Data gaps to resolve (decisions, not guesses)

- **Profile stats (games played / won / lost / win-rate, opponent history).** Not in `WalletResponse`. Sources: per-game `LeaderboardEntry`, or `MatchRecord` history (`GET /matches/:id` is participant-scoped). Decision for the demo: either add a small player-stats endpoint, assemble the profile from `/leaderboard` + `/wallet`, or simplify the profile to wallet + ledger. Recommended for the demo: simplify, and revisit if investors ask.
- **Avatars.** Design uses avatars; the platform stores only aliases. Generate client-side (initials or identicon) — no backend change.
- **Negative net-winnings.** The `net_winnings` leaderboard sums negative across players (rake). The component must handle the sign and label it; this is correct, not a bug (ADR-007).
- **Game count mismatch.** Their UI assumes nine games; `/games` returns the registered ones only. The grid is data-driven from `/games`; extras are static tiles.

## Strip on the way in

`@base44/sdk`, `src/api/*` (Base44 client), the `base44/` folder, `@stripe/*`, and unused libs (`react-leaflet`, `react-quill`, `react-markdown`, `jspdf`, and `moment` if standardising on `date-fns`). Keep `framer-motion`, `lucide-react`, `recharts`, `canvas-confetti`, the Radix/shadcn set, `clsx`, `tailwind-merge`.

## Sequencing

Foundation PR first (design system, build green, no screen changes). Then one PR per screen in this order: GameList → OpenChallengesList → StakeEntry/Lobby → Play (RPS) → CoinflipPlay → Result → Leaderboard → Wallet/Profile → coming-soon tiles. Report after the foundation PR plus the first re-skinned screen so the owner can judge the look early, before the rest proceeds.
