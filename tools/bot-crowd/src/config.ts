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
  // 'taker': subscribe to the open-challenges feed and claim a peer bot's challenge
  //   at its OWN (gameId, stake) lane, for light background motion. Scoped to its
  //   exact stake so it never eats the human-facing challenges in other lanes.
  | 'taker';

export interface BotConfig {
  /** Display name — MUST be 🤖-prefixed (the honesty of ADR-010 depends on the label). */
  name: string;
  gameId: string;
  stake: number;
  policy: BotPolicy;
}

/**
 * Roster: 7 bots, all 🤖-prefixed.
 *
 * Lanes are kept at DISTINCT (gameId, stake) for the human-facing resters so the
 * FIFO matchmaker never pairs two of them with each other — each stays a stable,
 * joinable open challenge. The rps@3 pair is the deliberate "light motion" lane:
 * Sparks rests and Bolt (taker, also rps@3) repeatedly claims it.
 */
export const ROSTER: BotConfig[] = [
  { name: '🤖C-3PO', gameId: 'coinflip', stake: 5, policy: 'rester' },
  { name: '🤖R2-D2', gameId: 'coinflip', stake: 10, policy: 'rester' },
  { name: '🤖BB-8', gameId: 'rps', stake: 5, policy: 'rester' },
  { name: '🤖K-2SO', gameId: 'rps', stake: 10, policy: 'rester' },
  { name: '🤖Chewie', gameId: 'chess', stake: 5, policy: 'rester' },
  { name: '🤖Sparks', gameId: 'rps', stake: 3, policy: 'rester' }, // sparring lane
  { name: '🤖Bolt', gameId: 'rps', stake: 3, policy: 'taker' }, // claims Sparks for motion
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
