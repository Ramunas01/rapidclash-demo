// Configuration + roster for the demo bot crowd (ADR-010).
//
// Every value is overridable by env var so the same harness can point at a local
// server (default) or the live *.run.app deployment for a presentation.

/** A bot's behaviour. */
export type BotPolicy =
  // 'rester': post-and-wait. joinQueue(gameId, stake) to rest as an OPEN CHALLENGE
  //   a human can press JOIN on; on match.end / challenge.expired, re-post. This is
  //   the primary, honest cold-start aid.
  | 'rester'
  // 'taker': subscribe to its game's open-challenges feed and claim a challenge posted
  //   by a HUMAN (an owner whose name is NOT 🤖-prefixed) — so a human who POSTS instead
  //   of joining still gets a quick opponent. It NEVER takes another bot's challenge, so
  //   there is no bot-vs-bot noise: the lobby only changes from timeouts and real humans.
  | 'taker';

/** Bot display names start with this — used to tell a bot's challenge from a human's. */
export const BOT_PREFIX = '🤖';

export interface BotConfig {
  /** Display name — MUST be BOT_PREFIX-prefixed (the honesty of ADR-010 depends on the label). */
  name: string;
  gameId: string;
  /** For a rester: the stake it posts. For a taker: unused (it matches the human's stake). */
  stake: number;
  policy: BotPolicy;
  /** Pairing time-control for a clocked game (chess). Omitted → the game default; a chess rester
   *  posts the Default (10-min) control so at least one live chess control is never empty
   *  (CHESS_TIME_CONTROL.md fragmentation mitigation). Ignored for untimed games. */
  timeControlId?: string;
}

/** These stake tiers are RESERVED for human-vs-human. Testers use them to line up
 *  people-against-people matches without a bot swooping in: takers never claim a challenge at any
 *  of these stakes (a human's bet waits for another human — see `isTakeable` in bot.ts), and
 *  resters never post at one (so every challenge at a reserved stake in the lobby is
 *  human-owned). `100` was the original, long-standing reserved tier (a real `BET_PRESETS` entry),
 *  but issue #384 released it back to bots now that `2` (issue #381) covers the "reserved for
 *  human-only testing" role on its own — `2` is the sole remaining entry. `2` reaches
 *  `apps/web`'s `GameHub.tsx` only via an undocumented tap-again gesture on the `1¢` preset — it is
 *  deliberately never its own `BET_PRESETS` entry, so a general-roster rester never draws it from
 *  `STAKE_SET` anyway (kept in this set purely to close the taker-claiming gap in `isTakeable`).
 *  Extend this array to reserve more tiers. */
export const HUMAN_RESERVED_STAKES: readonly number[] = [2];

/** Stakes a rester picks from (the UI bet presets, minus the human-reserved tiers). Each rester is
 *  assigned ONE random stake at startup — varied bets across games, without needing two bots per game. */
export const STAKE_SET = [1, 5, 10, 25, 50, 100] as const;
const RESTER_STAKES = STAKE_SET.filter((s) => !HUMAN_RESERVED_STAKES.includes(s));
const randStake = (): number => RESTER_STAKES[Math.floor(Math.random() * RESTER_STAKES.length)];

/** When set (e.g. TAKER_ONLY_GAMES=coinflip:3,blackjack,chess:2), ROSTER becomes a gated, on-duty
 *  crowd for just the listed games: one allowlist-gated TAKER per game (unchanged — weight has no
 *  effect on it), plus N resting bot-waiters per game where N is that game's weight (issue #393,
 *  replacing the old fixed-3-lane `GATED_RESTER_STAKES` system with a variable, per-game count).
 *  Empty = the full 26-bot general roster (default).
 *
 *  Format per entry: `gameId[:N]`. `N` is optional and defaults to `1` (today's old fixed
 *  minimum) when omitted, malformed, non-numeric, or non-positive — the same tolerant-fallback
 *  style as `num()` further down this file: never throw on a bad env var, just fall back. */
const takerOnlyGames: { gameId: string; weight: number }[] = (process.env.TAKER_ONLY_GAMES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((entry) => {
    const [gameId, weightRaw] = entry.split(':');
    const n = weightRaw === undefined ? NaN : Number(weightRaw);
    const weight = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
    return { gameId: gameId.trim(), weight };
  });

/**
 * Pool 2 — gated VM roster handles (issue #375), reserved so the gated roster (below, the
 * `takerOnlyGames.length` branch) can never mint a username that collides with Pool 1 (the
 * general roster's own literal names, in `ROSTER`'s other branch): the two rosters can run as
 * separate live processes against the same server at once, so they must never fight over one
 * account/session.
 *
 * The gated branch is built dynamically from `TAKER_ONLY_GAMES` (below), so names are assigned by
 * POSITION, not by game id — each game's identities start right after the previous game's own
 * block ended (a running cumulative offset, issue #393; games can now have different weights, so
 * a flat `gi * identitiesPerGame` no longer works), so the same env config produces the same names
 * on every restart without a static per-game table (robust to `TAKER_ONLY_GAMES` changing).
 *
 * This pool is a hard 34-name BUDGET, not just headroom (issue #393): each game's block costs
 * `1 + weight` names, allocated atomically in `TAKER_ONLY_GAMES` list order — the moment a game's
 * block doesn't fit what's left, that game and every game after it in the list are dropped
 * entirely (see the overflow handling in `ROSTER`'s gated branch below). So earlier entries in
 * `TAKER_ONLY_GAMES` are guaranteed their full block; later entries are only as safe as the
 * remaining budget — a real operational property of this pool's fixed size, not an edge case.
 * `% length` in `ROSTER` below is still a safety net against off-by-one arithmetic, not an
 * expected path once the budget accounting above is correct.
 */
const GATED_ROSTER_NAMES = [
  'knightfall', 'tileflip', 'rockdrop', 'moonshot', 'wheelman', 'snakeeyes', 'ninepoint',
  'hexpick', 'lowmulti', 'facecard', 'dxbn', 'highroller', 'crazypov', 'hitme', 'nightowl',
  'pipfarm', 'zenmode', 'bluffcity', 'fastlane', 'coinflipper', 'minerboy', 'redstack',
  'skyhook', 'tapout', 'bigshortie', 'lastcall', 'runitup', 'ghostpip', 'jokerz', 'saltyrun',
  'deepstack', 'mrsteady', 'clutchking', 'sidebet',
] as const;

/**
 * Roster: 26 bots, all 🤖-prefixed — per live game (coinflip, rps, chess, blackjack, mines, crash, roulette, ships-battle, dice, baccarat, keno, limbo, hilo):
 *   • 1 RESTER at a random stake (STAKE_SET, chosen at startup) — a stable, joinable open
 *     challenge for a human; a single bot per game can never self-pair (no bot-vs-bot); and
 *   • 1 TAKER that claims only HUMAN-posted challenges (never a bot's), giving a human who
 *     posts their own bet a quick opponent.
 *
 * There is deliberately NO bot-vs-bot play, so the lobby changes only from re-post timeouts
 * and real human activity. The bot policy is game-agnostic (replies with a random move from
 * the server's `legalMoves`), so Blackjack (hit/stand) and Mines (reveal a square) need no
 * special handling — their per-player timers would auto-act a slow bot, but the ~700ms move
 * delay keeps the bots well inside the 5–10s windows. Two exceptions: Crash (continuous, turn-less)
 * pre-sets a RANDOM auto-eject during SETUP (never taps the pad); and Roulette, where a random move
 * would fiddle chips forever, so its bot uses a full-stack policy (all-in on a random even-money
 * colour, then lock) — see `rouletteMove` in bot.ts. And Ships Battle, whose bot auto-places its
 * fleet (the `auto` move) then fires random un-probed squares — see `shipsBattleMove` in bot.ts.
 *
 * NOTE: the crash/roulette/ships-battle bots only resolve via real human JOINs (no bot-vs-bot), same as the rest.
 *
 * Gated mode (TAKER_ONLY_GAMES set, issue #361; weighted resters, issue #393) is built the same
 * "one BotConfig entry per identity" way — each game gets 1 taker + `weight` resters, each rester
 * minting its own `Bot` instance at its own `randStake()` draw so they rest independently
 * (Matchmaking pairs on the exact `(gameId, stake, timeControlId)` key, same reason
 * `GUEST_BOT_STAKE_LANES` needs one identity per lane rather than one bot cycling stakes; two
 * resters landing on the same stake is fine — just two independent open challenges). The taker's
 * `stake` field stays 1 — it's unused for a taker (BotConfig's own doc comment: a taker matches
 * whatever the human posted), kept only for a readable startup log line.
 *
 * Overflow (issue #393): games are allocated against `GATED_ROSTER_NAMES`'s 34-name budget
 * atomically, in `TAKER_ONLY_GAMES` list order — see the loop below and `GATED_ROSTER_NAMES`'s own
 * doc comment for the exact rule (drop-the-rest-on-first-overflow, logged once, never a partial
 * block).
 *
 * Names (issue #375): every literal below is a human-sounding handle from Pool 1 (see the issue),
 * one per entry, `${BOT_PREFIX}@<handle>` shaped. The gated branch instead pulls from
 * `GATED_ROSTER_NAMES` (Pool 2, above) by position — the two pools are disjoint by construction so
 * the two rosters never collide on a username even run as separate live processes at once.
 */
export const ROSTER: BotConfig[] = takerOnlyGames.length
  ? (() => {
      // Atomic, budget-aware allocation in list order (issue #393): the instant a game's block
      // (1 taker + its weight resters) would overflow the remaining GATED_ROSTER_NAMES budget,
      // that game AND every game after it in TAKER_ONLY_GAMES are dropped entirely — never a
      // partial block (no taker-less rester, no rester-less taker). Kept games are computed with
      // a running cumulative `base` offset BEFORE any drop decision, so a later game overflowing
      // never changes an earlier (kept) game's identities/names.
      const kept: { gameId: string; weight: number; base: number }[] = [];
      const dropped: string[] = [];
      let used = 0;
      let overflowed = false;
      for (const { gameId, weight } of takerOnlyGames) {
        if (!overflowed) {
          const blockSize = 1 + weight;
          if (used + blockSize <= GATED_ROSTER_NAMES.length) {
            kept.push({ gameId, weight, base: used });
            used += blockSize;
            continue;
          }
          overflowed = true;
        }
        dropped.push(gameId);
      }
      if (dropped.length > 0) {
        console.log(
          `[bot-crowd] gated roster: dropped ${dropped.join(', ')} — TAKER_ONLY_GAMES exceeded the ` +
            `${GATED_ROSTER_NAMES.length}-name gated roster budget (a budget limit, not a bug; see ` +
            `GATED_ROSTER_NAMES's doc comment in config.ts).`,
        );
      }
      return kept.flatMap(({ gameId: g, weight, base }) => {
        const chessControl = g === 'chess' ? { timeControlId: 'rapid10' as const } : {};
        const gatedName = (offset: number) =>
          `${BOT_PREFIX}@${GATED_ROSTER_NAMES[(base + offset) % GATED_ROSTER_NAMES.length]}`;
        return [
          {
            name: gatedName(0),
            gameId: g,
            stake: 1,
            policy: 'taker' as const,
            ...chessControl,
          },
          ...Array.from({ length: weight }, (_, ri) => ({
            name: gatedName(1 + ri),
            gameId: g,
            stake: randStake(),
            policy: 'rester' as const,
            ...chessControl,
          })),
        ];
      });
    })()
  : [
  // 1 rester per game at a random stake (STAKE_SET, chosen at startup) —
  { name: `${BOT_PREFIX}@flipmaster`, gameId: 'coinflip', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@threehands`, gameId: 'rps', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@chessking`, gameId: 'chess', stake: randStake(), policy: 'rester', timeControlId: 'rapid10' },
  { name: `${BOT_PREFIX}@twentyup`, gameId: 'blackjack', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@sweeper`, gameId: 'mines', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@rocketman`, gameId: 'crash', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@redblack`, gameId: 'roulette', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@goldrush`, gameId: 'ships-battle', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@sixsided`, gameId: 'dice', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@punto`, gameId: 'baccarat', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@luckyseven`, gameId: 'keno', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@liftoff`, gameId: 'limbo', stake: randStake(), policy: 'rester' },
  { name: `${BOT_PREFIX}@highcard`, gameId: 'hilo', stake: randStake(), policy: 'rester' },
  // 1 taker per game — claims only HUMAN-posted challenges (never a bot's) —
  { name: `${BOT_PREFIX}@tailsonly`, gameId: 'coinflip', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@scissorking`, gameId: 'rps', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@gambit`, gameId: 'chess', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@splitaces`, gameId: 'blackjack', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@lowball`, gameId: 'mines', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@zerospin`, gameId: 'crash', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@dealerdan`, gameId: 'roulette', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@overshoot`, gameId: 'ships-battle', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@rollone`, gameId: 'dice', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@banco`, gameId: 'baccarat', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@ninehundred`, gameId: 'keno', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@headsup`, gameId: 'limbo', stake: 5, policy: 'taker' },
  { name: `${BOT_PREFIX}@superble`, gameId: 'hilo', stake: 5, policy: 'taker' },
];

function num(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** http(s)://… → ws(s)://… (preserves host/port/path prefix). */
function toWsBase(httpUrl: string): string {
  return httpUrl.replace(/^http/, 'ws');
}

const serverUrl = (process.env.SERVER_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export const config = {
  /** REST + WS origin. Default local; override for the live deployment. */
  serverUrl,
  /** Full WS endpoint (token is appended per-bot at connect time). */
  wsEndpoint: `${toWsBase(serverUrl)}/ws`,

  /** Admin account used for optional top-ups (same defaults as the server). */
  admin: {
    username: process.env.ADMIN_USERNAME ?? 'admin',
    password: process.env.ADMIN_PASSWORD ?? 'admin-dev',
  },
  /** Shared password for the bot accounts (usernames are distinct, so this is fine). */
  botPassword: process.env.BOT_PASSWORD ?? 'bot-crowd-demo',

  /** Cadence — deliberately modest so a single max-instances=1 server is never flooded. */
  startStaggerMs: num('BOT_START_STAGGER_MS', 700), // gap between bringing each bot online
  repostDelayMs: num('BOT_REPOST_DELAY_MS', 4000), // pause before a rester re-posts
  moveDelayMs: num('BOT_MOVE_DELAY_MS', 700), // "thinking" pause before replying a move
  reconnectDelayMs: num('BOT_RECONNECT_DELAY_MS', 2000),

  /** Top-ups: when balance < stake × factor, admin-credit `topUpAmount` (if admin login works). */
  lowBalanceFactor: num('BOT_LOW_BALANCE_FACTOR', 5),
  topUpAmount: num('BOT_TOPUP_AMOUNT', 500),

  /**
   * Username-prefix gate a taker's target owner must match (issue #368, replacing the earlier
   * exact-name `TAKER_ALLOW_NAMES` allowlist from #362 outright — not layered alongside it). Any
   * self-registered account whose name starts with this prefix qualifies automatically, no Owner
   * provisioning step needed — matching the existing single `Demo` account's own naming
   * convention already used elsewhere in this project.
   *
   * Defaults to `''` (any human, current ungated-roster behaviour) — same "0/empty = disabled"
   * sentinel every other `TAKER_*` value here uses. `isTakeable` is shared by every taker, gated
   * VM and the general 26-bot roster alike, so a non-empty default here would silently narrow the
   * general roster's takers too (PM caught this pre-merge: the advisor spec's own §4 says "no
   * change to the general roster's behaviour", which a default of `'Demo'` would violate). The
   * always-on gated-taker VM sets this explicitly — `TAKER_ALLOW_PREFIX=Demo` — the same way it
   * already sets `TAKER_ONLY_GAMES` and `TAKER_EXCLUDE_STAKE`.
   */
  takerAllowPrefix: process.env.TAKER_ALLOW_PREFIX ?? '',
  /** Only claim challenges at this stake (0 = any non-reserved stake — current behaviour). */
  takerStake: num('TAKER_STAKE', 0),
  /**
   * One stake a taker will NEVER claim (issue #362) — mirrors `GUEST_HUMAN_RESERVED_STAKE`'s
   * naming/intent (`packages/shared/src/guest.ts`) but deliberately NOT imported/reused: that
   * constant protects the BOTTOM of the isolated guest world's own stake range, funded by
   * nothing real; this protects one deliberately-chosen stake on the REAL ledger, funded by
   * `tools/bot-crowd`'s own real, ADR-010-earned balance — same "carve out a stake no bot
   * touches" shape, opposite mechanism, see that constant's own doc comment for why the two
   * must stay separate.
   *
   * Purpose: two `Demo*`-prefixed reserved investor accounts (`TAKER_ALLOW_PREFIX`) can
   * deliberately post/JOIN each other at this one stake — e.g. to demo a human-vs-human match end
   * to end — without the gated taker sniping it first.
   *
   * `0` (the default) means "no stake excluded" — a no-op, matching `takerStake`'s own
   * "0 = disabled" sentinel, so this has zero effect regardless of `TAKER_ALLOW_PREFIX`. The
   * always-on gated-taker VM sets this explicitly, e.g. `TAKER_EXCLUDE_STAKE=10`. Pick a value
   * that is (a) one of the app's own bet presets (`BET_PRESETS`, apps/web/src/screens/GameHub.tsx) —
   * a real account can only ever POST a stake the UI actually offers — and (b) ideally not one a
   * gated rester is likely to land on: a resting bot-waiter sitting at the same stake would
   * auto-pair with whichever reserved account posts first, defeating the whole point.
   *
   * NOTE (issue #375, updated #384, #393): a gated rester's stake is no longer a small static
   * literal set you can read off this file and avoid at all — issue #393 replaced the old
   * fixed-3-lane `GATED_RESTER_STAKES` with a per-game, per-rester `randStake()` draw (the SAME
   * pool the general roster's own resters draw from: `STAKE_SET` minus `HUMAN_RESERVED_STAKES`),
   * so the possible values span every non-reserved `BET_PRESETS` entry regardless of how many
   * resters a game has. So no single fixed `TAKER_EXCLUDE_STAKE` can be *guaranteed* distinct from
   * every gated rester's actual startup draw — this is now a best-effort operator choice (e.g.
   * `10`, still a reasonable pick), not a hard invariant enforceable at config-authoring time. If a
   * collision does land, the exclude-stake carve-out simply degrades to "the reserved pair might
   * get auto-taken by the resting bot instead of each other" for that one process lifetime — it
   * does not violate ADR-010 (the rester still risks its own real funded balance).
   */
  takerExcludeStake: num('TAKER_EXCLUDE_STAKE', 0),
  /** Re-exposes the hoisted module const so callers can read it off `config` too. */
  takerOnlyGames,
};
