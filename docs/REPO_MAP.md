# Repo Map

A bird's-eye, low-churn tour of where things live — for fast orientation, not for the *why* (that's `ARCHITECTURE.md`'s ADR log) or the *rules* (that's `CHARTER.md`/`GAME_MODULE_INTERFACE.md`). Update this file only when something actually **moves** — new package, renamed directory, new top-level concept. Day-to-day feature work inside an existing file shouldn't touch it.

## Top level

```
apps/            deployable programs (server, web client)
packages/        libraries — the core, the shared contract, one package per game
tools/           demo-only tooling, not shipped (ADR-010)
docs/            specs, ADRs, PM prompts, comms mailbox — see ADVISOR_HANDOVER.md §11 for the full doc map
private/         gitignored — real secrets/runbooks, not source of truth
design-ref/      gitignored — designer exports, ephemeral (WORKING_AGREEMENT.md "Guest mode" hygiene note)
```

`pnpm-workspace.yaml` wires `packages/*`, `packages/games/*`, `apps/*`, and `tools/*` as workspace members. Root `pnpm -r build` / `pnpm -r test` fan out to all of them; `tools/*` is excluded from the root `tsc -b` build and the production Docker image.

## `apps/server` — Node/Fastify, REST + WebSocket

```
src/
  index.ts              process entry point: opens SQLite, wires the GCS snapshot/restore
                         (ADR-011), builds the app, listens, handles SIGTERM
  server.ts              buildApp()/createServices() — assembles Fastify + all services
  games.ts                gameModules[] — THE GO-LIVE SWITCH. A module listed here is what
                         GET /games returns and what the client promotes from "coming soon"
                         to playable. Nothing else registers a game.
  middleware/auth.ts      bearer-token auth guard
  routes/                 one file per REST resource: auth, wallet, matches, games,
                         leaderboard, admin, open-challenges, guest-auth
  ws/gateway.ts            the WebSocket message router — match lifecycle, move routing,
                         move timers, disconnect/forfeit, open-challenges push (877 lines,
                         the single biggest file in the repo — start here for anything
                         "how does a live match actually work")
  guest/index.ts           guest-mode session type + Demo-Opponent bot logic (the Charter's
                         documented invariant-#1 exception — see CHARTER.md "Guest mode")
  persistence/snapshot.ts  the SQLite→GCS snapshot/restore implementation behind ADR-011
```

Every `routes/*.ts` and `ws/*.ts` file has a co-located `*.test.ts` / `*.gateway.test.ts`; there's no separate top-level test directory for the server.

## `apps/web` — React PWA client

```
src/
  main.tsx / App.tsx     entry + the top-level state machine (auth → lobby → match → result;
                         1288 lines — round-scoped state and resetRoundState() live here,
                         see SCREENS.md "Round-scoped state")
  api.ts / ws.ts          REST client + WS client wrappers
  screens/                one file per game hub + shared screens (GameList, Lobby, Wallet,
                         Leaderboard, ProfileHub, Auth, StakeEntry, Result, ...). Naming
                         pattern: `<Game>Hub.tsx` (the persistent per-game screen) and, for
                         games with a distinct play phase, `<Game>Play.tsx`.
  screens/hub-shared/      cross-game hub pieces (DuelReveal, slotReveal — the win/loss
                         reveal animation used by every fast/chance game, see SCREENS.md)
  components/hub-chrome/  the shell every hub renders inside: HubRibbon (top bar),
                         HubToolbar (bottom nav), MuteToggle, layout.ts (shared spacing/
                         padding tokens — hubBodyPadding() etc.)
  components/hub-shared/  cross-game widgets: Avatar, OpenGames (the open-challenges feed),
                         BringARival, HubFooter, tiles.ts
  components/cards/        shared CardBack/DeckPile (CARD_BACK.md)
  components/coin/         the Coinflip coin render
  components/ui/           shadcn/Radix primitives (generated, not hand-maintained)
  lib/sound.ts             shared sound.ts (play/unlock/toggleMute — SOUND.md)
  guest/events.ts          guest-mode-specific client event handling
  test/                    co-located component/integration tests (Vitest + Testing Library)
```

## `packages/core` — the platform, game-agnostic

```
src/
  identity.ts       register/login, sessions, bearer tokens
  ledger.ts          the append-only wallet ledger + derived balance (WALLET_LEDGER.md)
  ephemeral-ledger.ts  the guest-mode ledger variant (non-persistent, see GUEST_MODE_CONTRACT.md)
  matchmaking.ts      queueing, escrow on join, the open-challenges order book (887 lines —
                     ADR-008)
  match-history.ts    match records + leaderboard queries
  index.ts             re-exports everything above — this is the `@rapidclash/core` package
```

Never contains a game-specific branch (`if (gameId === …)`) — Charter invariant #5. Acts generically on the metadata a game module declares (see `packages/shared`).

## `packages/shared` — the contract both sides depend on

```
src/
  game-contract.ts   THE KEYSTONE FILE. GameModule interface, GameMeta, RankingType, Rng,
                     MoveContext, viewFor redaction shape. Changing this needs an ADR +
                     owner approval (see the file's own header comment). Full walkthrough:
                     GAME_MODULE_INTERFACE.md.
  protocol.ts         the WS/REST wire envelope types (PROTOCOL.md)
  guest.ts             guest-mode-specific shared types
  index.ts             re-exports — this is the `@rapidclash/shared` package
```

## `packages/games/<name>` — one package per game, same shape every time

```
packages/games/<name>/src/
  index.ts        exports `<name>Module` (a GameModule) — this is what games.ts imports
  <name>.ts        the rules: applyMove, viewFor, settlement outcome
  <extra files>    only when the game needs them, e.g.:
                   deck.ts (blackjack, hilo) · curve.ts (crash) · wheel.ts (roulette)
                   board.ts (mines) · draw.ts (keno)
                   roll.ts (limbo)
```

Twelve game packages exist today: `rps`, `coinflip`, `chess`, `blackjack`, `mines`, `crash`, `roulette`, `dice`, `baccarat`, `keno`, `limbo`, `hilo` — see `CHARTER.md`'s game roster table for which are native-PvP vs. redefined-house-game, and each game's own `docs/<GAME>.md` for its ruleset.

## `tools/bot-crowd` — demo-only, not shipped (ADR-010)

```
src/
  index.ts       entry point
  bot.ts          a bot client's behavior
  ws-client.ts     WS client (same public API as any human client — no special "house" path)
  http.ts          REST calls (registration, credit top-up)
  config.ts        which games/stakes the crowd populates
```

Workspace member for dependency resolution only — excluded from the root `tsc -b` build, the test globs, and the production Docker image.

## Finding things fast — rules of thumb

- **"How does game X work?"** → `packages/games/X/src/X.ts`, then its `docs/X.md` spec.
- **"How does a match actually move through the system?"** → `apps/server/src/ws/gateway.ts`.
- **"What can a game module declare / what must it implement?"** → `packages/shared/src/game-contract.ts` + `GAME_MODULE_INTERFACE.md`.
- **"Is game X live?"** → `apps/server/src/games.ts`'s `gameModules[]` array — nothing else decides this.
- **"Where does money move?"** → `packages/core/src/ledger.ts` (real accounts) or `ephemeral-ledger.ts` (guest mode) — never anywhere else; see Charter invariant #3.
- **"Client-side, where does state for the current match live?"** → `apps/web/src/App.tsx`, the round-scoped state described in `SCREENS.md`.
- **"Why was X decided this way?"** → not here — `ARCHITECTURE.md`'s ADR log, or the game's own spec doc.
