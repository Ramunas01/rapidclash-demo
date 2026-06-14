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

1. **Humans play humans, never the house.** The platform never takes a side in a match. There is no dealer account, no bot opponent baked into the engine.
2. **The server is authoritative.** All game logic, all randomness, and all outcome calculation happen on the server. Clients send *intent*, receive *state*. A client cannot be trusted, even with play money.
3. **The wallet is an append-only ledger.** Balance is derived from a transaction log, never mutated in place. Settlement is atomic and idempotent — a reconnect or retry can never double-pay or double-charge. See `WALLET_LEDGER.md`.
4. **No real currency.** Wallet credit is granted to new accounts for demonstration only. No payment rails, no crypto, no cash-out.
5. **Games are plug-ins behind a fixed contract.** The core knows nothing about a specific game's rules. Adding a game is implementing the contract in `GAME_MODULE_INTERFACE.md` — no core changes.

### A note on the "demo opponent"

Empty lobbies are the obvious risk at low player counts. We solve it **outside the core**: a demo is run with two browsers / two devices, or a clearly-labelled automated client connects through *exactly the same WebSocket API as any human*. The core must never gain a special "play the house" branch. The production rule (humans vs humans) and the demo convenience stay separate.

## Game roster

| Game | Natively 2-player? | Notes |
|------|--------------------|-------|
| Rock-Paper-Scissors | Yes | First slice. Simultaneous single move, instant outcome, trivial hidden state. |
| Coinflip | Yes | Pure chance. One player calls, server flips with seeded RNG. Ranks by net winnings, not skill. |
| Chess | Yes | Skill game, ELO/Glicko ranking. Use an existing move-validation library; do not hand-roll legality. |
| Baccarat | **No (house-banked by default)** | Needs a redefined head-to-head ruleset — see below. |
| Blackjack | **No (house-banked by default)** | Needs a redefined head-to-head ruleset — see below. |

### Open spec: re-defining the house-banked games

Blackjack and Baccarat are player-versus-dealer by definition. Under "no house" they have no native two-player form. We pick a head-to-head reinterpretation **before** implementing either. Provisional proposals, to be confirmed:

- **Blackjack duel** — both players draw against the same shoe; closest to 21 without busting wins the pot. No dealer.
- **Baccarat duel** — players alternate taking the Banker role each round, or each backs a hand and the standard draw rules decide; the loser's stake transfers. Banker advantage must be neutralised by role rotation.

These two are deferred until after the slice. Recording the conflict now prevents the programmer discovering it mid-build.

## In scope for the demo

Registration & sessions; play-money wallet with ledger; stake placement & escrow; matchmaking and lobby; two-player session orchestration; RPS fully, then the other natively-2P games; settlement with platform fee; per-game leaderboard & ranking; mobile-web (PWA) client; an operator/admin interface for visibility and demo testing (player stats, game logs, add-money, account removal — see `ADMIN.md`).

## Out of scope (for now)

Real payments; KYC/identity verification; anti-fraud/collusion detection; spectating; chat; tournaments; native mobile apps; the redefined Blackjack/Baccarat rulesets (deferred, not abandoned).

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
