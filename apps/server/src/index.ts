import Database from 'better-sqlite3';
import { buildApp, createServices } from './server.js';

const db = new Database(process.env.DB_PATH ?? 'rapidclash.db');
const services = createServices(db);

const app = buildApp(services);

const port = parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';

await app.listen({ port, host });
console.log(`[server] listening on http://${host}:${port}`);
