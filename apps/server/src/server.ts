import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import FastifyWs from '@fastify/websocket';
import FastifyStatic from '@fastify/static';
import type Database from 'better-sqlite3';
import {
  createLedger,
  createIdentity,
  createMatchmaking,
  createMatchHistory,
  type Ledger,
  type Identity,
  type Matchmaking,
  type MatchHistory,
} from '@rapidclash/core';
import type { GameModule } from '@rapidclash/shared';
import { makeAuthMiddleware } from './middleware/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerGamesRoutes } from './routes/games.js';
import { registerOpenChallengesRoutes } from './routes/open-challenges.js';
import { registerLeaderboardRoutes } from './routes/leaderboard.js';
import { registerWalletRoutes } from './routes/wallet.js';
import { registerMatchesRoutes } from './routes/matches.js';
import { registerWsGateway } from './ws/gateway.js';

export interface AppOptions {
  /** Set to false to skip seeding the admin account (useful in tests that manage their own data). */
  seedAdmin?: boolean;
  adminUsername?: string;
  adminPassword?: string;
  /** Serve the built PWA (apps/web/dist) + SPA fallback. Default: auto (on when the dist exists).
   *  Production (the Docker image) ships the dist; dev/tests have none and use the Vite proxy. */
  serveStatic?: boolean;
}

// Anything under these prefixes is the API (or the WS upgrade) — an unknown path here must
// 404 as JSON, never fall back to the SPA shell. Everything else GET → index.html.
const API_PREFIXES = ['/auth', '/wallet', '/games', '/open-challenges', '/leaderboard', '/matches', '/admin', '/ws'];

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
}

export function buildApp(
  services: AppServices,
  gameModules: GameModule[],
  opts: AppOptions = {},
): FastifyInstance {
  const { identity, ledger, matchmaking, matchHistory } = services;
  const app = Fastify({ logger: false });

  app.register(FastifyWs);

  const auth = makeAuthMiddleware(identity);
  registerAuthRoutes(app, identity);
  registerAdminRoutes(app, auth, ledger);
  registerGamesRoutes(app, matchmaking);
  registerOpenChallengesRoutes(app, matchmaking);
  registerLeaderboardRoutes(app, matchHistory);
  registerWalletRoutes(app, auth, ledger);
  registerMatchesRoutes(app, auth, matchmaking, gameModules);

  // The `/ws` route must be added *after* @fastify/websocket has loaded, otherwise the
  // plugin's onRoute hook never wraps it and real upgrade requests fall through to the
  // normal HTTP handler (→ 500). buildApp is synchronous, so we register the gateway in a
  // nested plugin that avvio loads after FastifyWs rather than awaiting the registration.
  app.register(async (instance) => {
    registerWsGateway(instance, identity, matchmaking, gameModules);
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

export function createServices(db: Database.Database, gameModules: GameModule[]): AppServices {
  const ledger = createLedger(db);
  const identity = createIdentity(db, ledger);
  // One shared username lookup (#40 / ADR-008): owner names in the open-challenge
  // feed AND the leaderboard's displayName resolve through the same function.
  const lookupUsername = identity.getUsername;
  // Seed the leaderboard with each game's declared RankingType so it can dispatch
  // generically by kind (ADR-007) — no game-specific code in the core.
  const rankingByGame = new Map(gameModules.map((m) => [m.meta.id, m.meta.ranking]));
  const matchHistory = createMatchHistory(db, rankingByGame, lookupUsername);
  const matchmaking = createMatchmaking(ledger, gameModules, matchHistory, { lookupUsername });
  return { db, ledger, identity, matchmaking, matchHistory };
}
