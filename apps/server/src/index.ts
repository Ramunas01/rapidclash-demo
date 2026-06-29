import Database from 'better-sqlite3';
import { buildApp, createServices } from './server.js';
import { gameModules } from './games.js';
import { createSnapshotter } from './persistence/snapshot.js';

const dbPath = process.env.DB_PATH ?? 'rapidclash.db';

// Durable persistence (ADR-011): when GCS_BUCKET is set, restore the last snapshot onto the
// DB file *before* opening it, and snapshot it back after each settlement. Unset → no-op, so
// local dev is unchanged.
const snapshotter = createSnapshotter({ bucket: process.env.GCS_BUCKET, dbPath });
if (snapshotter.enabled) {
  await snapshotter.restore();
}

const db = new Database(dbPath);
const services = createServices(db, gameModules, { onSettled: () => snapshotter.trigger() });

const app = buildApp(services, gameModules);

const port = parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '0.0.0.0';

// Cloud Run sends SIGTERM before recycling the instance — flush any pending snapshot so the
// final settlements survive the redeploy, then exit cleanly.
async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received — flushing snapshot and shutting down`);
  try {
    await snapshotter.flush();
    await app.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port, host });
console.log(`[server] listening on http://${host}:${port}`);
