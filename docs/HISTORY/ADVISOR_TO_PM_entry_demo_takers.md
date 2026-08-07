### 2026-07-11#5 — Reserved "Demo" takers (plan-B): gate the bot-crowd to a single "Demo" account @ 1¢, 3 games (tools-only, demo-only)            [OPEN — for demos]
From: Advisor   Re: Owner — a reserved fallback opponent for coinflip/blackjack/chess when the live crowd isn't running

**Context/why:** normal testing/demos still use the full `bot-crowd` under the team's real names, run by the Owner — unchanged. This adds a **plan-B**: a small, gated set of takers tied to one reserved account named **`Demo`**, for the rare occasions a demonstrator needs an opponent and the Owner isn't available to run the crowd. It runs on-demand (a VM the Owner starts before a demo and stops after — see the VM setup doc), not 24/7.

`tools/bot-crowd` already does the mechanics (ordinary `🤖` clients on the live API; `taker` policy claims a human's posted challenge). Two small changes make it demo-safe and scoped. **All tools-only — not in the build, not shipped to Cloud Run — zero production risk, and it can go in fast.**

**Fairness guard (keep invariant #1 honest):** as-is, a taker claims *any* non-`🤖`, non-100 challenge in its game — which could match a real investor/public account. Gate it so **only the reserved `Demo` account at 1¢** ever draws a bot; every other account is left untouched. Keep the `🤖` prefix (ADR-010 honesty label — don't remove). Because this only runs during a demo and only answers `Demo`, no real user is ever paired with the house.

**Change 1 — `config.ts`: add gating + a taker-only roster switch (all env-driven, default = current behaviour, so the full crowd is unaffected).**
```ts
// allowlist of human owner names a taker will claim (empty = any human, current behaviour)
takerAllowNames: (process.env.TAKER_ALLOW_NAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
// only claim this stake (0 = any non-reserved, current behaviour)
takerStake: num('TAKER_STAKE', 0),
// when set, ROSTER = one taker per listed game and NO resters (demo "on duty" mode)
takerOnlyGames: (process.env.TAKER_ONLY_GAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
```
Build the roster from `takerOnlyGames` when present:
```ts
export const ROSTER: BotConfig[] = config.takerOnlyGames.length
  ? config.takerOnlyGames.map((g) => ({
      name: `🤖${g}-taker`, gameId: g, stake: 1, policy: 'taker',
      ...(g === 'chess' ? { timeControlId: 'rapid10' } : {}),
    }))
  : [ /* existing 26-bot roster unchanged */ ];
```
(`config` must be defined before `ROSTER` — it already is; just reference it.)

**Change 2 — `bot.ts` `tryTake()`: honour the allowlist + stake.**
```ts
const allow = config.takerAllowNames;
const target = [...this.openChallenges.values()].find(
  (c) =>
    !c.ownerName.startsWith(BOT_PREFIX) &&
    c.stake !== HUMAN_RESERVED_STAKE &&
    (config.takerStake === 0 || c.stake === config.takerStake) &&
    (allow.length === 0 || allow.includes(c.ownerName)),
);
```

**Run it (the plan-B invocation):**
```
SERVER_URL=https://rapidclash-847070222251.us-central1.run.app \
ADMIN_PASSWORD=<server admin password> \
TAKER_ONLY_GAMES=coinflip,blackjack,chess \
TAKER_ALLOW_NAMES=Demo \
TAKER_STAKE=1 \
pnpm --filter @rapidclash/bot-crowd start
```
`ADMIN_PASSWORD` enables top-ups so the three bots never run dry (they bet 1¢, so drift is tiny — free insurance). Flow at a demo: the demonstrator logs into the reserved **`Demo`** account, opens the game, sets 1¢, presses **PLAY** (posts a challenge) → the on-duty taker claims it in ~1s → match settles. Note `Demo` is matched **case-sensitively** — log in with that exact username, and it must equal `TAKER_ALLOW_NAMES`. Chess: the taker plays random legal moves, so games run to a natural end — the demonstrator can win or resign.

**Load/safety note:** three takers at the ~700ms cadence is trivial load (far below the 26-bot run that tore the snapshot), and that root cause is fixed anyway (atomic snapshot, PR #207/#222). No concern.

**Verification (tools has no test glob — do it by hand):** with the gating envs set, a `🤖`-owned, non-`Demo`, or non-1¢ challenge is NOT taken; a `Demo` 1¢ challenge IS taken within ~1s.

Ask: apply the tools-only change (fast, low-risk) so the Owner can stand up the reserved plan-B host. VM setup steps are in the companion doc for the Owner (PM to assist if needed).
