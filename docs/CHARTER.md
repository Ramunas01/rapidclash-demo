# Charter

## Vision

RapidClash is a demo of a player-versus-player gaming platform. It exists to show the **full core experience** convincingly on a mobile handset, not to be a finished product. Everything we build serves that demonstration.

## The thesis (why this platform exists)

House games are built so the house always wins — the odds are written by the operator to extract money from players into its own pocket. RapidClash's bet is that this **entire category can be reshaped into player-versus-player games**: the same familiar games — Limbo, Crash, Keno, Roulette, Dice, Hilo, Blackjack, Baccarat — refactored so players win and lose to *each other*, never to a house that set the rules in its own favour. The ambition is to convert the **whole house-game canon**, including the games that sound impossible to make two-player; doing so is the product, and the challenge a serious team is meant to take on. This is why every game on the roster is either natively PvP or a **confirmed PvP redefinition** — never a house game in disguise. The conversion backlog and method live in `GAME_REDEFINITION.md`.

## Non-negotiable invariants

These hold for every game and every code path. A pull request that violates one is rejected regardless of how well it works.

1. **Humans play humans, never the house.** The platform never takes a side in a match. There is no dealer account, no bot opponent baked into the engine. **Corollary — the roster is PvP-only, and the house canon is the conversion target:** the platform only ever *offers play* in games that have a human opponent. A house-style game (Limbo, Crash, Keno, Hilo, Dice, Roulette, Baccarat, Blackjack) is **never offered in its house form** — but every one of them is a **redefinition target**: it appears as a "coming soon" tile and becomes playable only once it has a confirmed two-player ruleset (as Mines and Blackjack already do — see `MINES.md`, `BLACKJACK.md`). A redefined house game is legitimate PvP; a house game in house form is forbidden, full stop. The backlog is `GAME_REDEFINITION.md`.
2. **The server is authoritative.** All game logic, all randomness, and all outcome calculation happen on the server. Clients send *intent*, receive *state*. A client cannot be trusted, even with play money.
3. **The wallet is an append-only ledger.** Balance is derived from a transaction log, never mutated in place. Settlement is atomic and idempotent — a reconnect or retry can never double-pay or double-charge. See `WALLET_LEDGER.md`.
4. **No real currency.** Wallet credit is granted to new accounts for demonstration only. No payment rails, no crypto, no cash-out.
5. **Games are plug-ins behind a fixed contract.** The core contains no *game-specific* branches — it never tests which game it is running (`if (gameId === …)` is forbidden). It may and must act **generically** on the metadata a module declares through the contract (player count, bet rules, ranking type). Adding a game is implementing the contract in `GAME_MODULE_INTERFACE.md`; it requires no game-specific core code, though it may require the core to gain generic capability the contract already promised — e.g. dispatching on a declared `RankingType`. See ADR-007.

### A note on the "demo opponent"

Empty lobbies are the obvious risk at low player counts. We solve it **outside the core**: a demo is run with two browsers / two devices, or a clearly-labelled automated client connects through *exactly the same WebSocket API as any human*. The core must never gain a special "play the house" branch. The production rule (humans vs humans) and the demo convenience stay separate.

## Game roster

Games are grouped in the UI as **Originals** (PvP-native and PvP-redefined signature games), **Classics** (traditional games — Chess today, more later), and surfaced alongside **Events** (tournaments). See `SCREENS.md` for the display taxonomy.

| Game | Natively 2-player? | Status |
|------|--------------------|--------|
| Rock-Paper-Scissors | Yes | **Live.** First slice. Simultaneous single move, instant outcome. |
| Coinflip | Yes | **Live.** Pure chance; both players secretly pick a side; mismatch → seeded flip. Ranks by net winnings. |
| Chess | Yes | **Live (building).** Skill game, ELO ranking; external move-validation lib. Cumulative time control — see `CHESS_TIME_CONTROL.md`. The first **Classic**. |
| Blackjack | No (house by default) | **Confirmed PvP redefinition** — head-to-head duel, see `BLACKJACK.md`. |
| Mines | No (house by default) | **Confirmed PvP redefinition** — two-player race on identical boards, see `MINES.md`. Ranks by net winnings. |
| Baccarat | No (house by default) | **Coming soon — PvP redefinition pending.** See `GAME_REDEFINITION.md`. |
| Limbo | No (house by default) | **Coming soon — PvP redefinition pending.** See `GAME_REDEFINITION.md`. |
| Crash | No (house by default) | **Confirmed PvP redefinition** — shared-rocket nerve duel, see `CRASH.md`. Ranks by net winnings. |
| Keno | No (house by default) | **Coming soon — PvP redefinition pending.** See `GAME_REDEFINITION.md`. |
| Hilo | No (house by default) | **Coming soon — PvP redefinition pending.** See `GAME_REDEFINITION.md`. |
| Dice | No (house by default) | **Coming soon — PvP redefinition pending.** See `GAME_REDEFINITION.md`. |
| Roulette | No (house by default) | **Coming soon — PvP redefinition pending.** See `GAME_REDEFINITION.md`. |

A "coming soon" game is shown as a non-playable tile (subtly dimmed). It is **never** playable in its house form; it becomes playable only when its two-player ruleset is confirmed as a spec and registered. The set of *playable* games is always exactly what `/games` returns.

### Confirmed spec: Coinflip (Slice 2)

Reworked to a **both-players-choose** mechanic (this supersedes the original one-caller design). Coinflip is natively two-player and house-free:

- **Stake:** both players stake equally into the pot (`symmetricStake`) — unchanged.
- **Choice:** both players **simultaneously and independently** choose a coin side — `heads` or `tails` — with equal ability. **No caller role.** Each choice is hidden from the opponent until both have chosen (exactly like RPS).
- **Resolution:** if both chose the **same** side → **draw** (stakes refunded, no rake). If they chose **different** sides → the server flips the coin (deterministic from the **match seed**, independent of both choices) and the player whose choice matches the flip result wins `pot − rake`; the other loses. Exactly one winner.
- **Hidden info:** `viewFor` hides **each player's choice and the flip result** until the match is terminal.
- **Abandonment** before both have chosen → `void` (refund both), **not** a draw.
- **Determinism:** flip = f(seed); replays identically. **Ranking:** `net_winnings` (see ADR-007) — unchanged.

### Redefining the house-game canon

This is the heart of the thesis, not a footnote. Each house game must be given a head-to-head, no-house reinterpretation **before** it becomes playable; recording the conflict up front prevents a programmer discovering it mid-build. Two are confirmed (`BLACKJACK.md`, `MINES.md`); the rest are a backlog of provisional directions in `GAME_REDEFINITION.md`, each to be confirmed as its own spec. The shared method — symmetric stakes, the same seeded randomness applied to both players (or rotated roles), simultaneous secret choices, server-authoritative redaction, decisive-result rake — is what makes "convert any house game" a credible engineering claim rather than a slogan.

## In scope for the demo

Registration & sessions; play-money wallet with ledger; stake placement & escrow; matchmaking and lobby; two-player session orchestration; RPS fully, then the other natively-2P and confirmed-redefined games; settlement with platform fee; per-game leaderboard & ranking; mobile-web (PWA) client; an operator/admin interface for visibility and demo testing (player stats, game logs, add-money, account removal — see `ADMIN.md`).

## Out of scope (for now)

Real payments; KYC/identity verification; anti-fraud/collusion detection; spectating; chat; tournaments (beyond an announcement banner); native mobile apps; the *unconfirmed* redefined rulesets for the house-game canon (deferred to `GAME_REDEFINITION.md`; Blackjack and Mines are confirmed).

## Glossary

- **Match** — one instance of a game between two players, with stakes escrowed.
- **Lobby** — the waiting state after a player commits a stake, before a second human is matched.
- **Stake** — the play-money amount a player commits to a match.
- **Escrow / pot** — both players' stakes held by the core for the duration of the match.
- **Rake / fee** — the platform's cut, taken from the pot at settlement.
- **Settlement** — the atomic ledger operation that releases the pot to the winner (minus rake) when a match ends.
- **Game module** — a self-contained implementation of one game satisfying the plug-in contract.
- **Ranking type** — how a game's results feed the leaderboard (ELO for skill, net winnings for chance, etc.).
- **PvP redefinition** — a head-to-head, no-house reinterpretation of a house game; the platform's core design activity (see `GAME_REDEFINITION.md`).
- **Administrator / operator** — a privileged role (not a player) who can view player stats and game logs, add play-money to a wallet, and remove an account to free its alias. Cannot influence match outcomes. See `ADMIN.md`.
