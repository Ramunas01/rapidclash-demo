import Fastify, { type FastifyInstance } from 'fastify';
import FastifyWs from '@fastify/websocket';
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
import { registerLeaderboardRoutes } from './routes/leaderboard.js';
import { registerWalletRoutes } from './routes/wallet.js';
import { registerMatchesRoutes } from './routes/matches.js';
import { registerWsGateway } from './ws/gateway.js';

export interface AppOptions {
  /** Set to false to skip seeding the admin account (useful in tests that manage their own data). */
  seedAdmin?: boolean;
  adminUsername?: string;
  adminPassword?: string;
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
