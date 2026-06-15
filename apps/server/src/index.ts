import Database from 'better-sqlite3';
import { rpsModule } from '@rapidclash/game-rps';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { buildApp, createServices } from './server.js';

const gameModules = [rpsModule, coinflipModule];
const db = new Database(process.env.DB_PATH ?? 'rapidclash.db');
const services = createServices(db, gameModules);

const app = buildApp(services, gameModules);

const port = parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';

await app.listen({ port, host });
console.log(`[server] listening on http://${host}:${port}`);
