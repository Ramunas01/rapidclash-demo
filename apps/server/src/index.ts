import Database from 'better-sqlite3';
import { buildApp, createServices } from './server.js';
import { gameModules } from './games.js';
import { createSnapshotter } from './persistence/snapshot.js';

const dbPath = process.env.DB_PATH ?? 'rapidclash.db';

// Durable persistence (ADR-011): when GCS_BUCKET is set, restore the last snapshot onto the
// DB file *before* opening it, and snapshot it back after each settlement. Unset → no-op, so
// local dev is unchanged.
//
// `db` doesn't exist yet at this point — restore() has to land the file on disk before we can
// open it — so `snapshot` is wired as a closure over the `db` binding below rather than a
// value. That's safe because `snapshot` is only ever invoked from doUpload(), which only runs
// after a debounced trigger() following a settlement — i.e. well after `db` is assigned a few
// lines down. (better-sqlite3's `db.backup()` resolves BackupMetadata; the closure discards it
// to match the `Promise<void>` shape doUpload() expects.)
// eslint-disable-next-line prefer-const -- declared here so the snapshot() closure above can capture the binding; assigned once, below, after restore()
let db: Database.Database;
const snapshotter = createSnapshotter({
  bucket: process.env.GCS_BUCKET,
  dbPath,
  snapshot: async (dest) => {
    await db.backup(dest);
  },
});
if (snapshotter.enabled) {
  await snapshotter.restore();
}

db = new Database(dbPath);
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
