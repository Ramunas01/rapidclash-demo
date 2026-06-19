import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import type { GameModule, PlayerId, GameState } from '@rapidclash/shared';
import { createLedger, createMatchmaking, GRANT_AMOUNT } from './index.js';

// Minimal never-terminal module — matchmaking mechanics only, no game logic needed.
const mockModule: GameModule = {
  meta: {
    id: 'mock',
    displayName: 'Mock',
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
  isTerminal: () => false,
  outcome: () => ({ type: 'draw' }),
  viewFor: (state: GameState) => state,
  forfeit: (state: GameState) => state,
};

const TTL = 90_000;

/** Matchmaking with an injectable clock + tiny rest/margin so listing is deterministic. */
function setup(opts: { now?: () => number; ttlMs?: number } = {}) {
  const db = new Database(':memory:');
  const ledger = createLedger(db);
  const matchmaking = createMatchmaking(ledger, [mockModule], undefined, {
    ttlMs: opts.ttlMs ?? TTL,
    minRestMs: 5_000,
    safeMarginMs: 3_000,
    listCap: 5,
    lookupUsername: (id) => `name-${id}`,
    now: opts.now,
  });
  return { db, ledger, matchmaking };
}

function bet(ledger: ReturnType<typeof createLedger>, id: string) {
  ledger.grant(id);
}

function escrowRows(ledger: ReturnType<typeof createLedger>, id: string) {
  return ledger.getEntries(id).filter((e) => e.type === 'BET_ESCROW');
}

// ─── OC1 — typed-amount path unchanged ────────────────────────────────────────

describe('OC1 — typed-amount path is unchanged', () => {
  it('FIFO-matches the oldest resting bet at the same stake; leave refunds in full', () => {
    const { ledger, matchmaking } = setup();
    bet(ledger, 'alice');
    bet(ledger, 'bob');

    const r1 = matchmaking.joinQueue('alice', 'mock', 100);
    expect(r1.status).toBe('waiting');
    const r2 = matchmaking.joinQueue('bob', 'mock', 100);
    expect(r2.status).toBe('matched');
    if (r2.status === 'matched') {
      expect(r2.opponentId).toBe('alice'); // oldest waiter
      expect(r2.matchId).toBe(r1.matchId);
    }

    // A separate waiter can leave and be made whole.
    bet(ledger, 'carol');
    const before = ledger.getBalance('carol');
    matchmaking.joinQueue('carol', 'mock', 50);
    expect(ledger.getBalance('carol')).toBe(before - 50);
    matchmaking.leaveQueue('carol', 'mock', 50);
    expect(ledger.getBalance('carol')).toBe(before);
  });

  it('joinQueue now also reports expiresAt = since + TTL (OC7 data)', () => {
    const t = 1_000;
    const { ledger, matchmaking } = setup({ now: () => t });
    bet(ledger, 'alice');
    const r = matchmaking.joinQueue('alice', 'mock', 100);
    expect(r.status).toBe('waiting');
    if (r.status === 'waiting') {
      expect(r.since).toBe(1_000);
      expect(r.expiresAt).toBe(1_000 + TTL);
    }
  });
});

// ─── OC3 — atomic claim (HEADLINE) ────────────────────────────────────────────

describe('OC3 — atomic claim (headline)', () => {
  it('two concurrent takers of the same challenge → exactly ONE match; the loser is uncharged', async () => {
    const { ledger, matchmaking } = setup();
    bet(ledger, 'owner');
    bet(ledger, 'bob');
    bet(ledger, 'carol');

    const open = matchmaking.joinQueue('owner', 'mock', 100);
    const matchId = open.matchId;

    // Fire both claims "concurrently". JS runs each synchronous call to completion,
    // so the first claim removes the entry before the second's lookup runs.
    const settled = await Promise.allSettled([
      Promise.resolve().then(() => matchmaking.takeChallenge('bob', matchId)),
      Promise.resolve().then(() => matchmaking.takeChallenge('carol', matchId)),
    ]);

    const winners = settled.filter((s) => s.status === 'fulfilled');
    const losers = settled.filter((s) => s.status === 'rejected');
    expect(winners).toHaveLength(1); // exactly one match
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason.code).toBe('CHALLENGE_TAKEN');

    // Exactly one match exists for this id, with owner as players[0].
    const match = matchmaking.getActiveMatch(matchId)!;
    expect(match.players[0]).toBe('owner');

    // The winner escrowed once; the loser has NO escrow row (asserted via the ledger).
    const bobEsc = escrowRows(ledger, 'bob').length;
    const carolEsc = escrowRows(ledger, 'carol').length;
    expect(bobEsc + carolEsc).toBe(1); // only the winner paid
    // The loser's balance is untouched (full grant).
    const loserId = bobEsc === 0 ? 'bob' : 'carol';
    expect(ledger.getBalance(loserId)).toBe(GRANT_AMOUNT);
  });
});

// ─── OC4 — no self-take ───────────────────────────────────────────────────────

describe('OC4 — no self-take', () => {
  it('the owner cannot claim their own challenge; no escrow is written', () => {
    const { ledger, matchmaking } = setup();
    bet(ledger, 'owner');
    const open = matchmaking.joinQueue('owner', 'mock', 100);

    expect(() => matchmaking.takeChallenge('owner', open.matchId)).toThrow(
      expect.objectContaining({ code: 'SELF_TAKE' }),
    );
    // Only the original resting escrow exists — no second one from the self-take.
    expect(escrowRows(ledger, 'owner')).toHaveLength(1);
  });
});

// ─── OC5 — balance check before escrow ───────────────────────────────────────

describe('OC5 — insufficient balance refused before escrow', () => {
  it('a taker who cannot cover the stake is refused with no escrow row', () => {
    const { ledger, matchmaking } = setup();
    bet(ledger, 'owner');
    const open = matchmaking.joinQueue('owner', 'mock', 100);

    // 'pauper' was never granted → balance 0 < 100.
    expect(() => matchmaking.takeChallenge('pauper', open.matchId)).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }),
    );
    expect(escrowRows(ledger, 'pauper')).toHaveLength(0);
    // The challenge is still claimable by someone solvent (it was not consumed).
    bet(ledger, 'bob');
    expect(matchmaking.takeChallenge('bob', open.matchId).status).toBe('matched');
  });
});

// ─── OC6 — expiry sweep + idempotent refund ──────────────────────────────────

describe('OC6 — expiry sweep refunds once (idempotent)', () => {
  it('removes the bet past TTL, refunds the owner exactly once, returns the expired list', () => {
    const t = 1_000;
    const { ledger, matchmaking } = setup({ now: () => t });
    bet(ledger, 'owner');
    const before = ledger.getBalance('owner');
    const open = matchmaking.joinQueue('owner', 'mock', 100);
    expect(ledger.getBalance('owner')).toBe(before - 100); // escrowed

    // Not yet expired.
    expect(matchmaking.sweepExpired(1_000 + TTL - 1)).toEqual([]);
    expect(ledger.getBalance('owner')).toBe(before - 100);

    // At/after expiry: swept, refunded, reported.
    const expired = matchmaking.sweepExpired(1_000 + TTL);
    expect(expired).toEqual([{ matchId: open.matchId, ownerId: 'owner', gameId: 'mock' }]);
    expect(ledger.getBalance('owner')).toBe(before); // refunded in full

    // Idempotent: a second sweep finds nothing and does not double-refund.
    expect(matchmaking.sweepExpired(1_000 + TTL + 10)).toEqual([]);
    expect(ledger.getBalance('owner')).toBe(before);

    // And it is gone from the feed.
    expect(matchmaking.listOpenChallenges('mock', 'viewer', 1_000 + TTL + 10).entries).toEqual([]);
  });
});

// ─── OC2 / OC9 — listing eligibility, order, priority equivalence ─────────────

describe('OC2 — feed eligibility & shaping', () => {
  it('excludes too-fresh bets, the viewer\'s own, and resolves owner names', () => {
    let t = 0;
    const { ledger, matchmaking } = setup({ now: () => t });
    bet(ledger, 'owner');
    bet(ledger, 'viewer');
    t = 1_000;
    const open = matchmaking.joinQueue('owner', 'mock', 100);
    t = 2_000;
    const ownBet = matchmaking.joinQueue('viewer', 'mock', 70); // viewer's own — must be excluded

    // At t=3_000 the owner bet has rested only 2s (<5s) → not yet listable.
    expect(matchmaking.listOpenChallenges('mock', 'viewer', 3_000).entries).toEqual([]);

    // At t=7_000 it has rested 6s and is well clear of expiry.
    const list = matchmaking.listOpenChallenges('mock', 'viewer', 7_000);
    expect(list.entries.map((e) => e.matchId)).toEqual([open.matchId]);
    expect(list.entries[0].ownerName).toBe('name-owner'); // username-joined
    // The viewer's own resting bet never appears in their own feed.
    expect(list.entries.map((e) => e.matchId)).not.toContain(ownBet.matchId);
  });

  it('caps the list and reports the "+N more" overflow count', () => {
    let t = 0;
    const { ledger, matchmaking } = setup({ now: () => t });
    for (let i = 0; i < 7; i++) {
      bet(ledger, `p${i}`);
      t = 100 + i; // distinct, monotonically increasing `since`
      // Distinct stakes so each rests as its own open challenge (same stake would FIFO-pair).
      matchmaking.joinQueue(`p${i}`, 'mock', 100 + i);
    }
    const list = matchmaking.listOpenChallenges('mock', 'viewer', 10_000);
    expect(list.entries).toHaveLength(5); // capped
    expect(list.more).toBe(2); // 7 eligible − 5 shown
  });
});

describe('OC9 — priority equivalence (uniform TTL)', () => {
  it('the entry listed first is the longest-waiting AND the soonest to expire', () => {
    let t = 0;
    const { ledger, matchmaking } = setup({ now: () => t });
    bet(ledger, 'a');
    bet(ledger, 'b');
    bet(ledger, 'c');
    // Distinct stakes so all three rest (same stake would FIFO-pair, not rest).
    t = 1_000;
    const a = matchmaking.joinQueue('a', 'mock', 100); // expiresAt 91_000
    t = 2_000;
    matchmaking.joinQueue('b', 'mock', 110); // expiresAt 92_000
    t = 3_000;
    matchmaking.joinQueue('c', 'mock', 120); // expiresAt 93_000

    const list = matchmaking.listOpenChallenges('mock', 'viewer', 10_000);
    // Longest-waiting first.
    expect(list.entries[0].matchId).toBe(a.matchId);
    // …which is also the minimum expiresAt — the two orderings coincide.
    const minExpiry = Math.min(...list.entries.map((e) => e.expiresAt));
    expect(list.entries[0].expiresAt).toBe(minExpiry);
    // Strictly ascending openedAt ≡ ascending expiresAt under the uniform TTL.
    const opened = list.entries.map((e) => e.openedAt);
    expect(opened).toEqual([...opened].sort((x, y) => x - y));
  });
});
