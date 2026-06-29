import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Storage } from '@google-cloud/storage';
import Database from 'better-sqlite3';
import type { GameModule, GameState, PlayerId, Outcome } from '@rapidclash/shared';
import { createSnapshotter } from './snapshot.js';
import { createServices } from '../server.js';

// ─── Mock GCS client ──────────────────────────────────────────────────────────
// Shaped to the slice of the Storage API the snapshotter uses:
//   storage.bucket(b).file(o).download({ destination })  — restore
//   storage.bucket(b).upload(path, { destination })       — snapshot
function mockStorage(opts: { downloadError?: unknown } = {}) {
  const download = opts.downloadError
    ? vi.fn().mockRejectedValue(opts.downloadError)
    : vi.fn().mockResolvedValue(undefined);
  const upload = vi.fn().mockResolvedValue(undefined);
  const file = vi.fn(() => ({ download }));
  const bucket = vi.fn(() => ({ file, upload }));
  const storage = { bucket } as unknown as Storage;
  return { storage, download, upload, file, bucket };
}

const silent = () => {};

describe('snapshotter — restore on startup (ADR-011)', () => {
  it('(a) attempts a download from the configured bucket when GCS_BUCKET is set', async () => {
    const m = mockStorage();
    const snap = createSnapshotter({
      bucket: 'my-bucket',
      dbPath: '/tmp/rapidclash.db',
      storageFactory: () => m.storage,
      log: silent,
    });

    expect(snap.enabled).toBe(true);
    const restored = await snap.restore();

    expect(restored).toBe(true);
    expect(m.bucket).toHaveBeenCalledWith('my-bucket');
    expect(m.file).toHaveBeenCalledWith('rapidclash.db');
    expect(m.download).toHaveBeenCalledWith({ destination: '/tmp/rapidclash.db' });
  });

  it('(b) makes no restore attempt and stays disabled when GCS_BUCKET is unset', async () => {
    const factory = vi.fn(() => mockStorage().storage);
    const snap = createSnapshotter({
      bucket: undefined,
      dbPath: '/tmp/rapidclash.db',
      storageFactory: factory,
      log: silent,
    });

    expect(snap.enabled).toBe(false);
    const restored = await snap.restore();

    expect(restored).toBe(false);
    // The storage client is never even constructed on the disabled path.
    expect(factory).not.toHaveBeenCalled();
  });

  it('treats a missing object (404) as "start fresh" — returns false, does not throw', async () => {
    const m = mockStorage({ downloadError: Object.assign(new Error('Not Found'), { code: 404 }) });
    const snap = createSnapshotter({
      bucket: 'my-bucket',
      dbPath: '/tmp/rapidclash.db',
      storageFactory: () => m.storage,
      log: silent,
    });

    await expect(snap.restore()).resolves.toBe(false);
  });

  it('rethrows a non-404 restore failure (fail fast rather than overwrite a good snapshot)', async () => {
    const m = mockStorage({ downloadError: Object.assign(new Error('permission denied'), { code: 403 }) });
    const snap = createSnapshotter({
      bucket: 'my-bucket',
      dbPath: '/tmp/rapidclash.db',
      storageFactory: () => m.storage,
      log: silent,
    });

    await expect(snap.restore()).rejects.toThrow(/permission denied/);
  });

  it('an empty-string bucket is treated as unset (disabled)', async () => {
    const snap = createSnapshotter({ bucket: '   ', dbPath: '/tmp/x.db', log: silent });
    expect(snap.enabled).toBe(false);
  });
});

describe('snapshotter — debounced upload on trigger (ADR-011)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('uploads once after the debounce window', async () => {
    const m = mockStorage();
    const snap = createSnapshotter({
      bucket: 'my-bucket',
      dbPath: '/tmp/rapidclash.db',
      debounceMs: 5_000,
      storageFactory: () => m.storage,
      log: silent,
    });

    snap.trigger();
    expect(m.upload).not.toHaveBeenCalled(); // still within the debounce window

    await vi.advanceTimersByTimeAsync(5_000);

    expect(m.upload).toHaveBeenCalledTimes(1);
    expect(m.upload).toHaveBeenCalledWith('/tmp/rapidclash.db', { destination: 'rapidclash.db' });
  });

  it('coalesces a burst of triggers into a single upload', async () => {
    const m = mockStorage();
    const snap = createSnapshotter({
      bucket: 'my-bucket',
      dbPath: '/tmp/rapidclash.db',
      debounceMs: 5_000,
      storageFactory: () => m.storage,
      log: silent,
    });

    snap.trigger();
    await vi.advanceTimersByTimeAsync(1_000);
    snap.trigger();
    await vi.advanceTimersByTimeAsync(1_000);
    snap.trigger();
    expect(m.upload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.upload).toHaveBeenCalledTimes(1);
  });

  it('re-arms for a write that lands during an in-flight upload', async () => {
    let release!: () => void;
    const m = mockStorage();
    m.upload
      .mockImplementationOnce(() => new Promise<void>((res) => (release = res)))
      .mockResolvedValue(undefined);

    const snap = createSnapshotter({
      bucket: 'my-bucket',
      dbPath: '/tmp/rapidclash.db',
      debounceMs: 5_000,
      storageFactory: () => m.storage,
      log: silent,
    });

    snap.trigger();
    await vi.advanceTimersByTimeAsync(5_000); // first upload starts, hangs (unresolved)
    expect(m.upload).toHaveBeenCalledTimes(1);

    snap.trigger(); // a settlement lands mid-upload
    release(); // first upload completes → second cycle is armed
    await vi.advanceTimersByTimeAsync(5_000);

    expect(m.upload).toHaveBeenCalledTimes(2);
  });

  it('trigger() is a silent no-op when disabled (no upload, no client)', async () => {
    const factory = vi.fn(() => mockStorage().storage);
    const snap = createSnapshotter({ bucket: undefined, dbPath: '/tmp/x.db', storageFactory: factory, log: silent });

    snap.trigger();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(factory).not.toHaveBeenCalled();
  });

  it('flush() uploads a pending snapshot immediately (graceful shutdown)', async () => {
    const m = mockStorage();
    const snap = createSnapshotter({
      bucket: 'my-bucket',
      dbPath: '/tmp/rapidclash.db',
      debounceMs: 5_000,
      storageFactory: () => m.storage,
      log: silent,
    });

    snap.trigger();
    await snap.flush(); // does not wait out the 5s debounce

    expect(m.upload).toHaveBeenCalledTimes(1);
  });
});

// ─── Settlement → snapshot wiring (the seam the server installs) ───────────────
// A real settlement through createServices must fire onSettled, which the server binds to
// snapshotter.trigger(). Uses a minimal terminal game module so settleMatch produces a real
// settlement without driving a full game.

const settlingModule: GameModule = {
  meta: {
    id: 'settle-mock',
    displayName: 'Settle Mock',
    minPlayers: 2,
    maxPlayers: 2,
    ranking: { kind: 'win_rate' },
    bet: { minStake: 10, maxStake: 500, symmetricStake: true },
    averageDurationSec: 5,
    rakeRate: 0.025,
  },
  init: (players: PlayerId[]) => ({ players }),
  legalMoves: () => [],
  applyMove: (state: GameState) => ({ state, events: [] }),
  isTerminal: () => true,
  outcome: (state: GameState): Outcome => ({ type: 'win', winner: (state as { players: PlayerId[] }).players[0] }),
  viewFor: (state: GameState) => state,
  forfeit: (state: GameState) => state,
};

describe('settlement triggers the debounced snapshot upload (ADR-011)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('(c) a real settlement fires onSettled → upload after the debounce; re-settle does not', async () => {
    const m = mockStorage();
    const snap = createSnapshotter({
      bucket: 'my-bucket',
      dbPath: '/tmp/rapidclash.db',
      debounceMs: 5_000,
      storageFactory: () => m.storage,
      log: silent,
    });

    const db = new Database(':memory:');
    const services = createServices(db, [settlingModule], { onSettled: () => snap.trigger() });
    const { ledger, matchmaking } = services;

    ledger.grant('alice');
    ledger.grant('bob');
    matchmaking.joinQueue('alice', 'settle-mock', 50);
    const r = matchmaking.joinQueue('bob', 'settle-mock', 50);
    if (r.status !== 'matched') throw new Error('expected matched');

    matchmaking.settleMatch(r.matchId);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.upload).toHaveBeenCalledTimes(1);

    // Idempotent re-settle returns the stored result without re-firing the snapshot.
    matchmaking.settleMatch(r.matchId);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(m.upload).toHaveBeenCalledTimes(1);
  });

  it('with no bucket configured, the same settlement path performs no GCS work', async () => {
    const factory = vi.fn(() => mockStorage().storage);
    const snap = createSnapshotter({ bucket: undefined, dbPath: '/tmp/x.db', storageFactory: factory, log: silent });

    const db = new Database(':memory:');
    const services = createServices(db, [settlingModule], { onSettled: () => snap.trigger() });
    const { ledger, matchmaking } = services;

    ledger.grant('alice');
    ledger.grant('bob');
    matchmaking.joinQueue('alice', 'settle-mock', 50);
    const r = matchmaking.joinQueue('bob', 'settle-mock', 50);
    if (r.status !== 'matched') throw new Error('expected matched');

    matchmaking.settleMatch(r.matchId);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(factory).not.toHaveBeenCalled();
  });
});
