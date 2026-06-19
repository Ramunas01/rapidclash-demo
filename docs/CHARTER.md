# Charter

## Vision

RapidClash is a demo of a player-versus-player gaming platform. It exists to show the **full core experience** convincingly on a mobile handset, not to be a finished product. Everything we build serves that demonstration.

## The experience the demo must show

A player can, from a phone browser:

1. Register / sign in.
2. See a play-money wallet balance.
3. Browse available games and pick one.
4. Place a stake.
5. Enter a lobby and **wait for another human** to join.
6. Play a match against that other human.
7. Win, lose, or draw — and see the stake settled into the wallet, minus a platform fee.
8. See the leaderboard / ranking move accordingly.

If any one of these is faked or skipped, the demo has failed at its job.

## Non-negotiable invariants

These hold for every game and every code path. A pull request that violates one is rejected regardless of how well it works.

1. **Humans play humans, never the house.** The platform never takes a side in a match. There is no dealer account, no bot opponent baked into the engine. **Corollary — the roster is PvP-only:** the platform only lists or offers games that *have* a human opponent. Pure house-banked or house-edge games, where a player plays against the system rather than a person (e.g. Limbo, Crash, Keno, Hilo), are never offered. House-style games may appear only in a two-player, **PvP-redefined** form — Baccarat and Blackjack as duels, and **Mines as a two-player race on identical boards** (confirmed, see `MINES.md`); a redefined house game is legitimate PvP, not a house game on the roster. See the game roster.
2. **The server is authoritative.** All game logic, all randomness, and all outcome calculation happen on the server. Clients send *intent*, receive *state*. A client cannot be trusted, even with play money.
3. **The wallet is an append-only ledger.** Balance is derived from a transaction log, never mutated in place. Settlement is atomic and idempotent — a reconnect or retry can never double-pay or double-charge. See `WALLET_LEDGER.md`.
4. **No real currency.** Wallet credit is granted to new accounts for demonstration only. No payment rails, no crypto, no cash-out.
5. **Games are plug-ins behind a fixed contract.** The core contains no *game-specific* branches — it never tests which game it is running (`if (gameId === …)` is forbidden). It may and must act **generically** on the metadata a module declares through the contract (player count, bet rules, ranking type). Adding a game is implementing the contract in `GAME_MODULE_INTERFACE.md`; it requires no game-specific core code, though it may require the core to gain generic capability the contract already promised — e.g. dispatching on a declared `RankingType`. See ADR-007.

### A note on the "demo opponent"

Empty lobbies are the obvious risk at low player counts. We solve it **outside the core**: a demo is run with two browsers / two devices, or a clearly-labelled automated client connects through *exactly the same WebSocket API as any human*. The core must never gain a special "play the house" branch. The production rule (humans vs humans) and the demo convenience stay separate.

## Game roster

| Game | Natively 2-player? | Notes |
|------|--------------------|-------|
| Rock-Paper-Scissors | Yes | First slice. Simultaneous single move, instant outcome, trivial hidden state. |
| Coinflip | Yes | Pure chance. Both players secretly pick a side; on a mismatch the server flips a seeded coin (same side = draw). Ranks by net winnings, not skill. |
| Chess | Yes | Skill game, ELO/Glicko ranking. Use an existing move-validation library; do not hand-roll legality. |
| Baccarat | **No (house-banked by default)** | Needs a redefined head-to-head ruleset — see below. |
| Blackjack | **No house-banked; redefined as a PvP duel** | Confirmed head-to-head ruleset — see `BLACKJACK.md`. |
| Mines | **No (house game by default)** | Redefined as a two-player chance race on identical boards — confirmed, see `MINES.md`. Ranks by net winnings. |

### Confirmed spec: Coinflip (Slice 2)

Reworked to a **both-players-choose** mechanic (this supersedes the original one-caller design). Coinflip is natively two-player and house-free:

- **Stake:** both players stake equally into the pot (`symmetricStake`) — unchanged.
- **Choice:** both players **simultaneously and independently** choose a coin side — `heads` or `tails` — with equal ability. **No caller role.** Each choice is hidden from the opponent until both have chosen (exactly like RPS).
- **Resolution:** if both chose the **same** side → **draw** (stakes refunded, no rake). If they chose **different** sides → the server flips the coin (deterministic from the **match seed**, independent of both choices) and the player whose choice matches the flip result wins `pot − rake`; the other loses. Exactly one winner.
- **Hidden info:** `viewFor` hides **each player's choice and the flip result** until the match is terminal.
- **Abandonment** before both have chosen → `void` (refund both), **not** a draw.
- **Determinism:** flip = f(seed); replays identically. **Ranking:** `net_winnings` (see ADR-007) — unchanged.

### Open spec: re-defining the house-banked games

Baccarat is player-versus-dealer by definition. Under "no house" it has no native two-player form, so it needs a head-to-head reinterpretation **before** implementing. (Blackjack's redefinition is now **confirmed** — see `BLACKJACK.md`.) Provisional proposal, to be confirmed:

- **Baccarat duel** — players alternate taking the Banker role each round, or each backs a hand and the standard draw rules decide; the loser's stake transfers. Banker advantage must be neutralised by role rotation.

Baccarat is deferred until after the slice. Recording the conflict now prevents the programmer discovering it mid-build.

## In scope for the demo

Registration & sessions; play-money wallet with ledger; stake placement & escrow; matchmaking and lobby; two-player session orchestration; RPS fully, then the other natively-2P games; settlement with platform fee; per-game leaderboard & ranking; mobile-web (PWA) client; an operator/admin interface for visibility and demo testing (player stats, game logs, add-money, account removal — see `ADMIN.md`).

## Out of scope (for now)

Real payments; KYC/identity verification; anti-fraud/collusion detection; spectating; chat; tournaments; native mobile apps; the redefined Baccarat ruleset (deferred, not abandoned; Blackjack is now confirmed — see `BLACKJACK.md`).

## Glossary

- **Match** — one instance of a game between two players, with stakes escrowed.
- **Lobby** — the waiting state after a player commits a stake, before a second human is matched.
- **Stake** — the play-money amount a player commits to a match.
- **Escrow / pot** — both players' stakes held by the core for the duration of the match.
- **Rake / fee** — the platform's cut, taken from the pot at settlement.
- **Settlement** — the atomic ledger operation that releases the pot to the winner (minus rake) when a match ends.
- **Game module** — a self-contained implementation of one game satisfying the plug-in contract.
- **Ranking type** — how a game's results feed the leaderboard (ELO for skill, net winnings for chance, etc.).
- **Administrator / operator** — a privileged role (not a player) who can view player stats and game logs, add play-money to a wallet, and remove an account to free its alias. Cannot influence match outcomes. See `ADMIN.md`.
