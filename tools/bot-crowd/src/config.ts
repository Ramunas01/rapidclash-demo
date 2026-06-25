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

/**
 * Roster: 18 bots, all 🤖-prefixed — per live game (coinflip, rps, chess, blackjack, mines, crash):
 *   • 2 RESTERS at DISTINCT stakes (5 and 10) so the FIFO matchmaker never pairs them with
 *     each other — each stays a stable, joinable open challenge for a human; and
 *   • 1 TAKER that claims only HUMAN-posted challenges (never a bot's), giving a human who
 *     posts their own bet a quick opponent.
 *
 * There is deliberately NO bot-vs-bot play, so the lobby changes only from re-post timeouts
 * and real human activity. The bot policy is game-agnostic (replies with a random move from
 * the server's `legalMoves`), so Blackjack (hit/stand) and Mines (reveal a square) need no
 * special handling — their per-player timers would auto-act a slow bot, but the ~700ms move
 * delay keeps the bots well inside the 5–10s windows. Crash is the exception (a continuous,
 * turn-less game): its bot pre-sets a RANDOM auto-eject during SETUP (never taps the pad) — see the bot.
 *
 * NOTE: the 'crash' bots only resolve via real human JOINs (no bot-vs-bot), same as the rest.
 */
export const ROSTER: BotConfig[] = [
  // 2 resters per game (distinct stakes) —
  { name: '🤖C-3PO', gameId: 'coinflip', stake: 5, policy: 'rester' },
  { name: '🤖R2-D2', gameId: 'coinflip', stake: 10, policy: 'rester' },
  { name: '🤖BB-8', gameId: 'rps', stake: 5, policy: 'rester' },
  { name: '🤖K-2SO', gameId: 'rps', stake: 10, policy: 'rester' },
  { name: '🤖Chewie', gameId: 'chess', stake: 5, policy: 'rester', timeControlId: 'rapid10' },
  { name: '🤖R5-D4', gameId: 'chess', stake: 10, policy: 'rester', timeControlId: 'rapid10' },
  { name: '🤖IG-88', gameId: 'blackjack', stake: 5, policy: 'rester' },
  { name: '🤖4-LOM', gameId: 'blackjack', stake: 10, policy: 'rester' },
  { name: '🤖L3-37', gameId: 'mines', stake: 5, policy: 'rester' },
  { name: '🤖EV-9D9', gameId: 'mines', stake: 10, policy: 'rester' },
  { name: '🤖0-0-0', gameId: 'crash', stake: 5, policy: 'rester' },
  { name: '🤖BT-1', gameId: 'crash', stake: 10, policy: 'rester' },
  // 1 taker per game — claims only HUMAN-posted challenges (never a bot's) —
  { name: '🤖HK-47', gameId: 'coinflip', stake: 5, policy: 'taker' },
  { name: '🤖2-1B', gameId: 'rps', stake: 5, policy: 'taker' },
  { name: '🤖FX-7', gameId: 'chess', stake: 5, policy: 'taker' },
  { name: '🤖AP-5', gameId: 'blackjack', stake: 5, policy: 'taker' },
  { name: '🤖BD-1', gameId: 'mines', stake: 5, policy: 'taker' },
  { name: '🤖C1-10P', gameId: 'crash', stake: 5, policy: 'taker' },
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
};
