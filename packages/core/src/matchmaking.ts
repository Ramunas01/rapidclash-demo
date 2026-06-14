import { randomUUID, randomBytes } from 'node:crypto';
import type { GameModule, GameState, LedgerEntry, PlayerId, Rng } from '@rapidclash/shared';
import type { Ledger } from './ledger.js';

// ─── RNG ─────────────────────────────────────────────────────────────────────

// Mulberry32 — seeded, deterministic, reproducible. Never call Math.random.
function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next(): number {
      s += 0x6d2b79f5;
      let z = s;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
    },
    int(min, max): number {
      return min + Math.floor(this.next() * (max - min + 1));
    },
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueueEntry {
  playerId: PlayerId;
  /** Pre-generated at join time; becomes the canonical matchId for the match. */
  matchId: string;
  stake: number;
  since: number;
}

export interface JoinWaiting {
  status: 'waiting';
  matchId: string;
  since: number;
}

export interface JoinMatched {
  status: 'matched';
  matchId: string;
  opponentId: PlayerId;
  /** Raw state from module.init(); apply viewFor before sending to clients. */
  initialState: GameState;
}

export type JoinQueueResult = JoinWaiting | JoinMatched;

export interface MatchRecord {
  matchId: string;
  gameId: string;
  players: [PlayerId, PlayerId];
  state: GameState;
  stake: number;
  seed: number;
}

export interface Matchmaking {
  joinQueue(playerId: PlayerId, gameId: string, stake: number): JoinQueueResult;
  leaveQueue(playerId: PlayerId, gameId: string, stake: number): LedgerEntry;
  getActiveMatch(matchId: string): MatchRecord | undefined;
  /** Returns registered GameMeta for all registered game modules. */
  listGames(): Array<GameModule['meta']>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMatchmaking(
  ledger: Ledger,
  gameModules: GameModule[],
): Matchmaking {
  const moduleByGame = new Map<string, GameModule>(gameModules.map((m) => [m.meta.id, m]));

  // FIFO queues keyed by `${gameId}:${stake}` → [earliest, ...]
  const queues = new Map<string, QueueEntry[]>();

  // Reverse-lookup: which queue entry does this player currently hold?
  // Key: `${playerId}:${gameId}`
  const playerEntry = new Map<string, QueueEntry>();

  // Active matches
  const matches = new Map<string, MatchRecord>();

  function queueKey(gameId: string, stake: number): string {
    return `${gameId}:${stake}`;
  }

  function joinQueue(playerId: PlayerId, gameId: string, stake: number): JoinQueueResult {
    const mod = moduleByGame.get(gameId);
    if (!mod) throw new Error(`Unknown gameId: ${gameId}`);

    const { minStake, maxStake } = mod.meta.bet;
    if (stake < minStake || stake > maxStake) {
      throw new RangeError(
        `Stake ${stake} out of range [${minStake}, ${maxStake}] for game "${gameId}"`,
      );
    }

    const balance = ledger.getBalance(playerId);
    if (balance < stake) {
      throw new Error(`Insufficient balance: have ${balance}, need ${stake}`);
    }

    const key = queueKey(gameId, stake);
    const queue = queues.get(key) ?? [];

    // Is there already a waiting player?
    if (queue.length > 0) {
      const waiter = queue.shift()!;
      if (queue.length === 0) queues.delete(key);
      playerEntry.delete(`${waiter.playerId}:${gameId}`);

      // Use the waiter's pre-generated matchId as the canonical matchId.
      const matchId = waiter.matchId;

      // Escrow the joining player under the same canonical matchId.
      ledger.escrow(playerId, matchId, stake);

      // Initialise the game state.
      const seed = randomBytes(4).readUInt32LE(0);
      const rng = createRng(seed);
      const initialState = mod.init([waiter.playerId, playerId], rng);

      const record: MatchRecord = {
        matchId,
        gameId,
        players: [waiter.playerId, playerId],
        state: initialState,
        stake,
        seed,
      };
      matches.set(matchId, record);

      return { status: 'matched', matchId, opponentId: waiter.playerId, initialState };
    }

    // No waiter — add this player to the queue.
    const matchId = randomUUID();
    ledger.escrow(playerId, matchId, stake);

    const since = Date.now();
    const entry: QueueEntry = { playerId, matchId, stake, since };
    queues.set(key, [...(queues.get(key) ?? []), entry]);
    playerEntry.set(`${playerId}:${gameId}`, entry);

    return { status: 'waiting', matchId, since };
  }

  function leaveQueue(playerId: PlayerId, gameId: string, stake: number): LedgerEntry {
    const entryKey = `${playerId}:${gameId}`;
    const entry = playerEntry.get(entryKey);
    if (!entry) throw new Error(`Player ${playerId} is not in the queue for game "${gameId}"`);
    if (entry.stake !== stake) {
      throw new Error(`Stake mismatch: expected ${entry.stake}, got ${stake}`);
    }

    // Remove from queue
    const key = queueKey(gameId, stake);
    const q = queues.get(key) ?? [];
    const idx = q.indexOf(entry);
    if (idx !== -1) q.splice(idx, 1);
    if (q.length === 0) queues.delete(key);
    playerEntry.delete(entryKey);

    return ledger.refundEscrow(playerId, entry.matchId);
  }

  function getActiveMatch(matchId: string): MatchRecord | undefined {
    return matches.get(matchId);
  }

  function listGames(): Array<GameModule['meta']> {
    return gameModules.map((m) => m.meta);
  }

  return { joinQueue, leaveQueue, getActiveMatch, listGames };
}
