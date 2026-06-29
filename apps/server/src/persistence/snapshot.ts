// ADR-011 — durable demo persistence via explicit SQLite→GCS snapshot/restore.
//
// The Cloud Run SQLite file is ephemeral (resets on instance recycle/redeploy — ADR-009).
// This module gives it durability *without* changing the schema, the queries, or the
// file-backed engine, and without GCSFuse (mounting a live DB over a network filesystem is
// a corruption path — explicitly ruled out). The contract is narrow and explicit:
//
//   • restore() — once, before the server accepts requests: download the single snapshot
//     object onto DB_PATH if it exists, so the process opens an already-restored file.
//   • trigger() — after every settlement / standings write: debounce an upload of the DB
//     file back to the same object, coalescing rapid match bursts into one upload.
//
// `--max-instances=1` (ADR-009) means a single writer, so there is no locking concern and a
// plain file copy of the (rollback-journal, no-WAL) DB is consistent between transactions.
//
// GCS_BUCKET unset → every method is a silent no-op, so local dev / tests are unchanged.
// Application Default Credentials authenticate inside Cloud Run with no key file.

import type { Storage } from '@google-cloud/storage';

export interface SnapshotterOptions {
  /** Target bucket name. Undefined/empty (local dev) → the snapshotter is a no-op. */
  bucket?: string;
  /** Path to the SQLite file to snapshot/restore (the same DB_PATH the server opens). */
  dbPath: string;
  /** Object name within the bucket. Default: 'rapidclash.db'. Single object, overwritten. */
  objectName?: string;
  /** Debounce window for uploads in ms. Default: 5000 (absorbs rapid match bursts). */
  debounceMs?: number;
  /** Injectable Storage factory (tests pass a mock; prod lazily constructs the real one). */
  storageFactory?: () => Storage;
  /** Log sink (tests silence it; prod uses console). */
  log?: (msg: string) => void;
}

export interface Snapshotter {
  /** True when a bucket is configured and snapshotting is active. */
  readonly enabled: boolean;
  /** Download the snapshot onto dbPath if present. Resolves true if a file was restored,
   *  false if none existed (first deploy → start fresh) or snapshotting is disabled. */
  restore(): Promise<boolean>;
  /** Schedule a debounced upload of the current DB file. Coalesces rapid calls. No-op when disabled. */
  trigger(): void;
  /** Cancel the debounce timer and flush any pending upload immediately (graceful shutdown). */
  flush(): Promise<void>;
}

export function createSnapshotter(opts: SnapshotterOptions): Snapshotter {
  const bucket = opts.bucket?.trim() || undefined;
  const objectName = opts.objectName ?? 'rapidclash.db';
  const debounceMs = opts.debounceMs ?? 5_000;
  const log = opts.log ?? ((msg: string) => console.log(msg));

  // Disabled path: no bucket → inert object, zero behaviour change for local dev / tests.
  if (!bucket) {
    return {
      enabled: false,
      async restore() {
        return false;
      },
      trigger() {},
      async flush() {},
    };
  }

  // Lazily build the Storage client once, the first time we actually touch GCS, so merely
  // constructing a disabled snapshotter never reaches for credentials. The dynamic import
  // keeps @google-cloud/storage off the startup path until a bucket is actually configured.
  let storage: Storage | undefined;
  async function client(): Promise<Storage> {
    if (!storage) {
      if (opts.storageFactory) {
        storage = opts.storageFactory();
      } else {
        const { Storage } = await import('@google-cloud/storage');
        storage = new Storage();
      }
    }
    return storage;
  }

  async function restore(): Promise<boolean> {
    try {
      const gcs = await client();
      await gcs.bucket(bucket!).file(objectName).download({ destination: opts.dbPath });
      log(`[snapshot] restored ${bucket}/${objectName} → ${opts.dbPath}`);
      return true;
    } catch (err: unknown) {
      // Object-not-found (first deploy) is the expected "start fresh" path, not an error.
      if (isNotFound(err)) {
        log(`[snapshot] no snapshot at ${bucket}/${objectName}; starting fresh`);
        return false;
      }
      // Any other failure (auth, network, permissions) is loud and fatal: starting fresh
      // here would let the next settlement overwrite a good snapshot with an empty DB. Fail
      // fast so a misconfiguration is caught before it destroys durable state.
      log(`[snapshot] restore FAILED for ${bucket}/${objectName}: ${describe(err)}`);
      throw err;
    }
  }

  // ── Debounced upload ─────────────────────────────────────────────────────────
  // `dirty` records that a write happened and an upload is owed. A single timer or in-flight
  // upload owns the next cycle; a write arriving during an upload re-arms it afterwards so we
  // never drop the last state.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let dirty = false;

  function schedule(): void {
    if (timer || inFlight) return; // a timer or upload already owns the next cycle
    timer = setTimeout(() => {
      timer = null;
      void runUpload();
    }, debounceMs);
    // Don't let a pending snapshot timer keep the process alive on its own.
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function runUpload(): Promise<void> {
    if (!dirty) return;
    dirty = false;
    inFlight = doUpload();
    try {
      await inFlight;
    } finally {
      inFlight = null;
      if (dirty) schedule(); // a write landed mid-upload — capture it next
    }
  }

  async function doUpload(): Promise<void> {
    try {
      const gcs = await client();
      await gcs.bucket(bucket!).upload(opts.dbPath, { destination: objectName });
      log(`[snapshot] uploaded ${opts.dbPath} → ${bucket}/${objectName}`);
    } catch (err: unknown) {
      // A failed upload must not crash the live server; the next settlement re-triggers and
      // the file is re-uploaded whole, so a transient failure self-heals.
      log(`[snapshot] upload failed for ${bucket}/${objectName}: ${describe(err)}`);
    }
  }

  function trigger(): void {
    dirty = true;
    schedule();
  }

  async function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (inFlight) await inFlight;
    if (dirty) await runUpload();
  }

  return { enabled: true, restore, trigger, flush };
}

/** GCS surfaces a missing object as an error carrying HTTP 404. */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 404;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
