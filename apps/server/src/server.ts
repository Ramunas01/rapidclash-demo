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
  registerWsGateway(app, identity, matchmaking, gameModules);

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
  const matchHistory = createMatchHistory(db);
  const matchmaking = createMatchmaking(ledger, gameModules, matchHistory);
  return { db, ledger, identity, matchmaking, matchHistory };
}
