import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import FastifyWs from '@fastify/websocket';
import FastifyStatic from '@fastify/static';
import FastifyRateLimit from '@fastify/rate-limit';
import type Database from 'better-sqlite3';
import {
  createLedger,
  createIdentity,
  createMatchmaking,
  createMatchHistory,
  createRewards,
  type Ledger,
  type Identity,
  type Matchmaking,
  type MatchHistory,
  type Rewards,
} from '@rapidclash/core';
import { EMBED_ALLOWED_ORIGINS, type GameModule } from '@rapidclash/shared';
import { makeAuthMiddleware } from './middleware/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerGamesRoutes } from './routes/games.js';
import { registerOpenChallengesRoutes } from './routes/open-challenges.js';
import { registerGuestOpenChallengesRoutes } from './routes/guest-open-challenges.js';
import { registerLeaderboardRoutes } from './routes/leaderboard.js';
import { registerWalletRoutes } from './routes/wallet.js';
import { registerMatchesRoutes } from './routes/matches.js';
import { registerGuestAuthRoutes } from './routes/guest-auth.js';
import { registerRewardsRoutes } from './routes/rewards.js';
import { registerWsGateway } from './ws/gateway.js';
import { createGuestServices, type GuestServices } from './guest/index.js';

export interface AppOptions {
  /** Set to false to skip seeding the admin account (useful in tests that manage their own data). */
  seedAdmin?: boolean;
  adminUsername?: string;
  adminPassword?: string;
  /** Serve the built PWA (apps/web/dist) + SPA fallback. Default: auto (on when the dist exists).
   *  Production (the Docker image) ships the dist; dev/tests have none and use the Vite proxy. */
  serveStatic?: boolean;
  /** Called after any successful non-settlement DB write that should also durably persist
   *  (registration, admin-credit, reward-claim — issue #378). Settlement already has its own
   *  hook (ServicesOptions.onSettled, wired into createMatchmaking); this one lives at the
   *  route layer because these three writes happen in route handlers with direct service
   *  access, not inside matchmaking internals. The server wires this to the same GCS
   *  snapshotter's debounced trigger() as onSettled; omitted in tests/local dev → no-op. */
  onWrite?: () => void;
}

// Anything under these prefixes is the API (or the WS upgrade) — an unknown path here must
// 404 as JSON, never fall back to the SPA shell. Everything else GET → index.html.
const API_PREFIXES = [
  '/auth',
  '/wallet',
  '/games',
  '/open-challenges',
  '/guest',
  '/leaderboard',
  '/matches',
  '/admin',
  '/rewards',
  '/ws',
];

// Guest-mode framability (GUEST_MODE_CONTRACT.md §3, issue #271): allow the landing origins to
// iframe-embed the app; never send X-Frame-Options (it would fight/override frame-ancestors in
// older browsers). Applied app-wide via onSend, not a scoped route: this is a single-entry-point
// SPA with no server-rendered "guest" page and no same-origin sensitive data a malicious embed
// could exploit differently than normal browsing — real users still go through the normal login
// wall regardless of framing, so there's no concrete reason to scope this to a guest-only route.
const FRAME_ANCESTORS_CSP = `frame-ancestors ${EMBED_ALLOWED_ORIGINS.join(' ')}`;

/** Where the built PWA lives. WEB_DIST overrides; otherwise resolve relative to this
 *  compiled file (apps/server/dist → apps/web/dist) so it works from the repo layout. */
function resolveWebDist(): string {
  if (process.env.WEB_DIST) return process.env.WEB_DIST;
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../web/dist');
}

/** In production the one container also serves the PWA on the same origin (ADR-009): no
 *  CORS, no second service. Static assets are served by path; unknown browser GETs fall
 *  back to index.html (SPA routing) while the API/`/ws` keep precedence and JSON 404s. */
function maybeServeStatic(app: FastifyInstance, opts: AppOptions): void {
  const webDist = resolveWebDist();
  const enabled = opts.serveStatic ?? existsSync(webDist);
  if (!enabled) return;

  // wildcard:true → real files (assets, sw.js, manifest, icons) are served by path; a
  // missing file calls the not-found handler below. Specific API routes and `/ws` are
  // more specific than the static `/*`, so they always win.
  app.register(FastifyStatic, { root: webDist });

  app.setNotFoundHandler((request, reply) => {
    const url = request.url;
    const isApi = API_PREFIXES.some(
      (p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`),
    );
    if (request.method === 'GET' && !isApi) {
      // A client-side route (or the bare origin) — hand back the app shell.
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not Found' });
  });

  console.log(`[server] serving PWA from ${webDist}`);
}

export interface AppServices {
  db: Database.Database;
  ledger: Ledger;
  identity: Identity;
  matchmaking: Matchmaking;
  matchHistory: MatchHistory;
  /** Guest mode's isolated world (issue #267): an in-memory ledger + a second Matchmaking
   *  instance, independent of `db` — gone on process restart, by design. */
  guest: GuestServices;
  /** XP/tier/rakeback/volume-bonus/claim (issue #306). Wired to the REAL `matchmaking`
   *  instance's `onPlayerSettled` hook only — deliberately NOT wired into `guest`'s ephemeral
   *  matchmaking instance below, so guest sessions never accrue real rewards state (same
   *  isolation boundary as guest's ledger/accounts). */
  rewards: Rewards;
}

export function buildApp(
  services: AppServices,
  gameModules: GameModule[],
  opts: AppOptions = {},
): FastifyInstance {
  const { identity, ledger, matchmaking, matchHistory, guest, rewards } = services;
  const app = Fastify({ logger: false });

  // App-wide, every response (see FRAME_ANCESTORS_CSP above for why global vs scoped).
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Content-Security-Policy', FRAME_ANCESTORS_CSP);
  });

  app.register(FastifyWs);
  // `global: false` — this plugin only limits routes that opt in via a `config.rateLimit`
  // block (currently just POST /auth/guest, issue #270). No other route is affected.
  app.register(FastifyRateLimit, { global: false });

  const auth = makeAuthMiddleware(identity);
  registerAuthRoutes(app, auth, identity, opts.onWrite);
  // Same reason as the `/ws` comment below: a direct `app.post()` call here would run
  // synchronously, before avvio has booted the FastifyRateLimit plugin registered above —
  // its `onRoute` hook wouldn't exist yet, so the route's `config.rateLimit` would silently
  // never apply. The nested plugin defers this route's registration into avvio's boot queue,
  // after FastifyRateLimit has loaded and attached its hook.
  app.register(async (instance) => {
    registerGuestAuthRoutes(instance, identity, guest);
  });
  registerAdminRoutes(app, auth, ledger, identity, opts.onWrite);
  registerGamesRoutes(app, matchmaking);
  registerOpenChallengesRoutes(app, matchmaking);
  // Guest-scoped equivalent (issue #354) — reads the ISOLATED `guest.matchmaking` instance only,
  // never the real one above. Additive, own route file: kept out of `open-challenges.ts` and out
  // of `guest/index.ts` (issue #352, the guest bot-taker, is concurrently touching that file) to
  // minimize collision surface — this only reads `guest`'s already-public `Matchmaking` API.
  registerGuestOpenChallengesRoutes(app, guest.matchmaking);
  registerLeaderboardRoutes(app, matchHistory);
  registerWalletRoutes(app, auth, ledger);
  registerMatchesRoutes(app, auth, matchmaking, gameModules, matchHistory);
  // POST /rewards/claim opts into config.rateLimit too — same boot-order reason as
  // /auth/guest above: nest it so it registers after FastifyRateLimit's onRoute hook exists.
  app.register(async (instance) => {
    registerRewardsRoutes(instance, auth, rewards, opts.onWrite);
  });

  // The `/ws` route must be added *after* @fastify/websocket has loaded, otherwise the
  // plugin's onRoute hook never wraps it and real upgrade requests fall through to the
  // normal HTTP handler (→ 500). buildApp is synchronous, so we register the gateway in a
  // nested plugin that avvio loads after FastifyWs rather than awaiting the registration.
  app.register(async (instance) => {
    registerWsGateway(instance, identity, matchmaking, gameModules, guest);
  });

  // Serve the built PWA on the same origin (prod only — see maybeServeStatic).
  maybeServeStatic(app, opts);

  if (opts.seedAdmin !== false) {
    const username = opts.adminUsername ?? 'admin';
    const password = opts.adminPassword ?? process.env.ADMIN_PASSWORD ?? 'admin-dev';
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('[server] ADMIN_PASSWORD is not set — using insecure dev default');
    }
    app.addHook('onReady', async () => {
      await identity.ensureAdmin(username, password);
    });
  }

  return app;
}

export interface ServicesOptions {
  /** Called after every real settlement (ledger + standings write). The server wires this to
   *  the GCS snapshotter's debounced upload (ADR-011); omitted in tests/local dev → no-op. */
  onSettled?: () => void;
}

export function createServices(
  db: Database.Database,
  gameModules: GameModule[],
  opts: ServicesOptions = {},
): AppServices {
  const ledger = createLedger(db);
  const identity = createIdentity(db, ledger);
  // One shared username lookup (#40 / ADR-008): owner names in the open-challenge
  // feed AND the leaderboard's displayName resolve through the same function.
  const lookupUsername = identity.getUsername;
  // Sibling per-entry avatar lookup for the PUBLIC leaderboard (same seam as lookupUsername).
  const lookupAvatar = identity.getAvatarId;
  // Seed the leaderboard with each game's declared RankingType so it can dispatch
  // generically by kind (ADR-007) — no game-specific code in the core.
  const rankingByGame = new Map(gameModules.map((m) => [m.meta.id, m.meta.ranking]));
  const matchHistory = createMatchHistory(db, rankingByGame, lookupUsername, lookupAvatar);
  // Rewards (issue #306) — own table in the same `db`, wired to the REAL matchmaking
  // instance's per-player settlement hook only (never guest's, below).
  const rewards = createRewards(db, ledger);
  const matchmaking = createMatchmaking(ledger, gameModules, matchHistory, {
    lookupUsername,
    onSettled: opts.onSettled,
    onPlayerSettled: ({ playerId, stake, feeRate, outcome }) => {
      rewards.recordMatchSettlement(playerId, stake, feeRate, outcome);
    },
  });
  const guest = createGuestServices();
  return { db, ledger, identity, matchmaking, matchHistory, guest, rewards };
}
