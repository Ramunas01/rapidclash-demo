import { describe, expect, it } from 'vitest';
import type { GameState, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import Database from 'better-sqlite3';
import { createLedger, createMatchmaking, GRANT_AMOUNT, PLATFORM_ACCOUNT } from '@rapidclash/core';
import { minesModule as mines } from './mines.js';
import { BOARD_SIZE, MINE_COUNT, SAFE_COUNT, ROUND_TIMEOUT_MS, minesFor } from './board.js';

const A = 'player-A';
const B = 'player-B';
const ctx = (playerId: string, now = 0) => ({ playerId, now });

// Seeded rng stub. init calls rng.int(0, 0x7fffffff) once to fix the base seed.
const rngWith = (seed: number): Rng => ({ next: () => 0, int: () => seed });

const SEED = 12345;

// The (seed,round)-derived layout is the test's source of truth for which squares are safe.
const mineSet = (round = 0) => minesFor(SEED, round, BOARD_SIZE, MINE_COUNT);
const safeSquares = (round = 0): number[] => {
  const m = mineSet(round);
  return Array.from({ length: BOARD_SIZE }, (_, i) => i).filter((i) => !m.has(i));
};
const aMine = (round = 0): number => [...mineSet(round)][0];

// ── Test view of the (opaque) state + a builder ──────────────────────────────
interface Board {
  uncovered: number[];
  locked: boolean;
  bustedOn?: number;
  mines?: number[];
  score?: number;
}
interface Mn {
  players: [string, string];
  seed?: number;
  round: number;
  draws: number;
  boards: Record<string, Board>;
  roundStartedAt?: number;
  winner?: string;
  forcedOutcome?: { type: string };
  mines?: number[];
}
const as = (s: GameState): Mn => s as Mn;

const board = (uncovered: number[], locked = false, extra: Partial<Board> = {}): Board => ({
  uncovered,
  locked,
  ...extra,
});

/** Build an in-play state directly (bypassing init) for exact scenarios. */
function state(boards: Record<string, Board>, extra: Partial<Mn> = {}): GameState {
  return { players: [A, B], seed: SEED, round: 0, draws: 0, roundStartedAt: 0, boards, ...extra } as GameState;
}

/** Apply a sequence of [player, square] moves, threading state. */
function play(s: GameState, moves: [PlayerId, number][]): GameState {
  return moves.reduce((acc, [p, sq]) => mines.applyMove(acc, sq, ctx(p)).state, s);
}

// ── meta ──────────────────────────────────────────────────────────────────────

describe('minesModule.meta', () => {
  it('declares the spec meta incl. rakeRate 0.025, net_winnings ranking — and NO per-move timer', () => {
    expect(mines.meta).toMatchObject({
      id: 'mines',
      displayName: 'Mines',
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'net_winnings' },
      bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      rakeRate: 0.025,
    });
    // Rule 10: the old per-move 5s timer/auto-reveal is gone entirely, replaced by the single
    // 30s round clock via scheduledDeadlines + lockOnTimeout (ADR-012).
    expect(mines.meta.moveTimeoutMs).toBeUndefined();
    expect(mines.timeoutMove).toBeUndefined();
    expect(typeof mines.scheduledDeadlines).toBe('function');
    expect(typeof mines.lockOnTimeout).toBe('function');
    expect(typeof mines.launch).toBe('function');
  });
});

// ── board determinism + identical-for-both ───────────────────────────────────

describe('minesModule — board determinism & identical layout for both players', () => {
  it('board shape is the Designer-approved 5×5/3-mine ruleset (2026-09-11)', () => {
    expect(BOARD_SIZE).toBe(25);
    expect(MINE_COUNT).toBe(3);
    expect(SAFE_COUNT).toBe(22);
  });

  it('derives a fixed MINE_COUNT-mine layout from (seed, round), re-derivable byte-for-byte', () => {
    const m1 = [...minesFor(SEED, 0, BOARD_SIZE, MINE_COUNT)].sort((a, b) => a - b);
    const m2 = [...minesFor(SEED, 0, BOARD_SIZE, MINE_COUNT)].sort((a, b) => a - b);
    expect(m1).toHaveLength(MINE_COUNT);
    expect(m1).toEqual(m2);
    expect(safeSquares(0)).toHaveLength(SAFE_COUNT); // all safe squares
    // A different round → a different layout (so a replay isn't the same board).
    expect([...minesFor(SEED, 1, BOARD_SIZE, MINE_COUNT)].sort((a, b) => a - b)).not.toEqual(m1);
  });

  it('minesFor is parameterised — a different (boardSize, mineCount) shape shuffles independently', () => {
    const small = minesFor(SEED, 0, 9, 1);
    expect(small.size).toBe(1);
    for (const m of small) expect(m).toBeGreaterThanOrEqual(0);
    for (const m of small) expect(m).toBeLessThan(9);
  });

  it('init gives BOTH players the identical board — the same square busts either of them', () => {
    const s = as(mines.init([A, B], rngWith(SEED)));
    expect(s.boards[A]).toEqual({ uncovered: [], locked: false });
    expect(s.boards[B]).toEqual({ uncovered: [], locked: false });
    expect(s.round).toBe(0);
    expect(s.draws).toBe(0);
    expect(s.roundStartedAt).toBe(0); // unset until `launch` runs

    const mine = aMine(0);
    expect(as(mines.applyMove(s as GameState, mine, ctx(A)).state).boards[A].locked).toBe(true);
    expect(as(mines.applyMove(s as GameState, mine, ctx(B)).state).boards[B].locked).toBe(true);
  });

  it('init is JSON-serializable', () => {
    const s = mines.init([A, B], rngWith(1));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

// ── launch (round-0 clock stamp, ADR-012) ────────────────────────────────────

describe('minesModule.launch — stamps the round-0 clock start', () => {
  it('stamps roundStartedAt from the match-formation time, leaving everything else untouched', () => {
    const s = as(mines.init([A, B], rngWith(SEED)));
    const launched = as(mines.launch!(s, 5_000));
    expect(launched.roundStartedAt).toBe(5_000);
    expect(launched.boards).toEqual(s.boards);
    expect(launched.seed).toEqual(s.seed);
    expect(launched.round).toBe(s.round);
  });
});

// ── legalMoves (concurrent, per-player) ──────────────────────────────────────

describe('minesModule.legalMoves', () => {
  it('offers every covered square to both players at the start (concurrent, not turn-based)', () => {
    const s = mines.init([A, B], rngWith(SEED));
    const all = Array.from({ length: BOARD_SIZE }, (_, i) => i);
    expect(mines.legalMoves(s, A)).toEqual(all);
    expect(mines.legalMoves(s, B)).toEqual(all);
  });

  it('drops a square once uncovered (per-player, independent)', () => {
    const safe = safeSquares(0);
    const s = mines.applyMove(mines.init([A, B], rngWith(SEED)), safe[0], ctx(A)).state;
    expect(mines.legalMoves(s, A)).not.toContain(safe[0]);
    expect(mines.legalMoves(s, A)).toHaveLength(BOARD_SIZE - 1);
    expect(mines.legalMoves(s, B)).toHaveLength(BOARD_SIZE); // B untouched
  });

  it('returns [] for a locked player and once terminal', () => {
    const locked = state({ [A]: board([], true, { bustedOn: aMine(0) }), [B]: board([safeSquares(0)[0]]) });
    expect(mines.legalMoves(locked, A)).toEqual([]);
    expect(mines.legalMoves(locked, B)).not.toEqual([]);

    const done = state({ [A]: board([], true), [B]: board([], true) }, { winner: A });
    expect(mines.legalMoves(done, A)).toEqual([]);
    expect(mines.legalMoves(done, B)).toEqual([]);
  });
});

// ── applyMove: reveal / bust / clear at 22 ───────────────────────────────────

describe('minesModule.applyMove — reveal, bust, auto-lock at 22', () => {
  it('a safe uncover raises the score, stays unlocked, and emits NOTHING (no opponent leak)', () => {
    const safe = safeSquares(0);
    const res = mines.applyMove(mines.init([A, B], rngWith(SEED)), safe[0], ctx(A));
    expect(as(res.state).boards[A]).toEqual({ uncovered: [safe[0]], locked: false });
    expect(res.events).toEqual([]); // a mid-play safe reveal is silent
  });

  it('uncovering a mine busts: locks the board, records bustedOn, score unchanged (rule 5: keeps your gems)', () => {
    const safe = safeSquares(0);
    const mine = aMine(0);
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.applyMove(s, safe[0], ctx(A)).state; // score 1
    const res = mines.applyMove(s, mine, ctx(A));
    const me = as(res.state).boards[A];
    expect(me.locked).toBe(true);
    expect(me.bustedOn).toBe(mine);
    expect(me.uncovered).toEqual([safe[0]]); // bust does NOT add to the safe count
    expect(res.events.some((e) => e.type === 'player_locked' && (e.payload as { reason: string }).reason === 'bust')).toBe(true);
    expect(() => mines.applyMove(res.state, safe[1], ctx(A))).toThrow(IllegalMove); // locked → no moves
  });

  it('a bust event carries NO score while the opponent is still active (broadcast redaction — GAME_MODULE_INTERFACE.md)', () => {
    // B is untouched (active) when A busts. The event is broadcast UNREDACTED to both players,
    // so it must not leak what viewFor still hides (revealOppCount = opp.locked && me.locked).
    const s = mines.init([A, B], rngWith(SEED));
    const res = mines.applyMove(s, aMine(0), ctx(A));
    expect(res.events).toEqual([{ type: 'player_locked', payload: { playerId: A, reason: 'bust' } }]);
    expect((res.events[0].payload as { score?: number }).score).toBeUndefined();
  });

  it('a bust event DOES carry score once it is the lock that makes the opponent already-locked too', () => {
    const safe = safeSquares(0);
    // B busts first (locked). A then busts too — at that instant B (the opponent) is already
    // locked, so viewFor would reveal A's score to B regardless; the event may carry it too.
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.applyMove(s, aMine(0), ctx(B)).state; // B locked (bust) at 0
    s = mines.applyMove(s, safe[0], ctx(A)).state; // A: 1 gem
    const res = mines.applyMove(s, aMine(0), ctx(A)); // A busts at 1, opponent (B) already locked
    expect(res.events[0]).toEqual({ type: 'player_locked', payload: { playerId: A, reason: 'bust', score: 1 } });
  });

  it('clearing all 22 safe squares AUTO-LOCKS at max score (rule: auto-lock at 22, same mechanism as a bust-lock)', () => {
    const safe = safeSquares(0);
    // A clears the first 21, then the 22nd triggers the auto-lock — assert the event fires
    // exactly on that final reveal. B is untouched (still active), so the event must NOT
    // carry `score` — viewFor still hides it (revealOppCount = opp.locked && me.locked).
    const almost = play(mines.init([A, B], rngWith(SEED)), safe.slice(0, -1).map((sq) => [A, sq] as [PlayerId, number]));
    const res = mines.applyMove(almost, safe[safe.length - 1], ctx(A));
    const me = as(res.state).boards[A];
    expect(me.locked).toBe(true);
    expect(me.uncovered).toHaveLength(SAFE_COUNT);
    expect(me.bustedOn).toBeUndefined();
    expect(res.events).toEqual([{ type: 'player_locked', payload: { playerId: A, reason: 'cleared' } }]);
    // B hasn't locked, and — no early resolution — A being mathematically unbeatable at the
    // max score doesn't end it either.
    expect(mines.isTerminal(res.state)).toBe(false);
  });

  it('a clear event DOES carry score once the opponent is already locked (this lock resolves the match)', () => {
    const safe = safeSquares(0);
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.applyMove(s, aMine(0), ctx(B)).state; // B locked (bust) at 0 first
    const almost = play(s, safe.slice(0, -1).map((sq) => [A, sq] as [PlayerId, number]));
    const res = mines.applyMove(almost, safe[safe.length - 1], ctx(A)); // A clears 22, B already locked
    expect(res.events.find((e) => e.type === 'player_locked')).toEqual({
      type: 'player_locked',
      payload: { playerId: A, reason: 'cleared', score: SAFE_COUNT },
    });
    expect(mines.isTerminal(res.state)).toBe(true); // both locked now
  });

  it('rejects a non-square, an out-of-range index, a repeat, and acting when locked/terminal', () => {
    const s = mines.init([A, B], rngWith(SEED));
    expect(() => mines.applyMove(s, 'a1', ctx(A))).toThrow(IllegalMove);
    expect(() => mines.applyMove(s, BOARD_SIZE, ctx(A))).toThrow(IllegalMove);
    expect(() => mines.applyMove(s, 2.5, ctx(A))).toThrow(IllegalMove);
    const after = mines.applyMove(s, safeSquares(0)[0], ctx(A)).state;
    expect(() => mines.applyMove(after, safeSquares(0)[0], ctx(A))).toThrow(IllegalMove); // repeat
    const term = state({ [A]: board([], true), [B]: board([], true) }, { winner: A });
    expect(() => mines.applyMove(term, 0, ctx(A))).toThrow(IllegalMove);
  });
});

// ── NO EARLY RESOLUTION (Designer ruleset, 2026-09-11 — the core rewrite) ────

describe('minesModule — NO early resolution: both players must lock before the match resolves', () => {
  it('nothing is decided while neither player has locked', () => {
    const safe = safeSquares(0);
    const s = play(mines.init([A, B], rngWith(SEED)), [
      [A, safe[0]], [A, safe[1]], [B, safe[0]],
    ]);
    expect(mines.isTerminal(s)).toBe(false);
  });

  it('a locked player is NOT decided even once the active opponent SURPASSES their score (the reversal)', () => {
    // A busts at 3; B keeps tapping past 3 → OLD engine would end the match the instant B hit 4.
    // NEW engine: undecided until B also locks (mine, clock, or 22), no matter how far B climbs.
    const safe = safeSquares(0);
    const s = play(mines.init([A, B], rngWith(SEED)), [
      [A, safe[0]], [A, safe[1]], [A, safe[2]], [A, aMine(0)], // A locked at 3
      [B, safe[0]], [B, safe[1]], [B, safe[2]], [B, safe[3]], [B, safe[4]], [B, safe[5]], // B at 6, way past 3
    ]);
    expect(as(s).boards[A].locked).toBe(true);
    expect(as(s).boards[B].locked).toBe(false);
    expect(mines.isTerminal(s)).toBe(false); // still undecided — B hasn't locked yet
  });

  it('resolves the instant BOTH have locked — higher score wins regardless of lock order', () => {
    const safe = safeSquares(0);
    const s = play(mines.init([A, B], rngWith(SEED)), [
      [A, safe[0]], [A, safe[1]], [A, safe[2]], [A, aMine(0)], // A locked (bust) at 3
      [B, safe[0]], [B, safe[1]], [B, safe[2]], [B, safe[3]], [B, safe[4]], [B, safe[5]], [B, aMine(0)], // B locked (bust) at 6
    ]);
    expect(mines.isTerminal(s)).toBe(true);
    expect(mines.outcome(s)).toEqual({ type: 'win', winner: B });
  });

  it('a locked player at a HIGHER score still is not a winner until the opponent also locks', () => {
    const safe = safeSquares(0);
    const s = play(mines.init([A, B], rngWith(SEED)), [
      [A, safe[0]], [A, safe[1]], [A, safe[2]], [A, safe[3]], [A, safe[4]], [A, aMine(0)], // A locked at 5
      [B, safe[0]], [B, safe[1]], // B active at 2, hasn't locked
    ]);
    expect(mines.isTerminal(s)).toBe(false); // A being ahead and locked does NOT end it
  });
});

// ── viewFor redaction — hidden-count-until-BOTH-done (Designer ruleset) ──────

describe('minesModule.viewFor — redaction: opponent count hidden for the WHOLE round, not just until either locks', () => {
  it('in-play with both active: own board full, opponent board hidden, NO opp count, no seed/mines', () => {
    const safe = safeSquares(0);
    const s = state({ [A]: board([safe[0], safe[1]]), [B]: board([safe[0], safe[1], safe[2]]) });
    const v = as(mines.viewFor(s, A));
    expect(v.boards[A].uncovered).toEqual([safe[0], safe[1]]); // own board visible
    expect(v.boards[B].uncovered).toBeUndefined(); // opponent board hidden
    expect(v.boards[B].score).toBeUndefined(); // opponent count hidden while both active
    expect(v.boards[B].locked).toBe(false);
    expect(v.seed).toBeUndefined(); // seed stripped (would reveal the mines)
    expect(v.boards[A].mines).toBeUndefined(); // active player sees no mines
  });

  // T8: `roundStartedAt` is exposed in the non-terminal view so the client can render the 30s
  // round clock. It's pure per-round timing metadata — reveals no mine position or score.
  it('T8: exposes roundStartedAt in the non-terminal view (drives the client-side round clock)', () => {
    const safe = safeSquares(0);
    const s = state({ [A]: board([safe[0]]), [B]: board([safe[0], safe[1]]) }, { roundStartedAt: 4_200 });
    const v = as(mines.viewFor(s, A));
    expect(v.roundStartedAt).toBe(4_200);
  });

  it('STAYS hidden once the OPPONENT locks but the viewer is still active (old engine revealed this — new engine does not)', () => {
    const safe = safeSquares(0);
    // A busted at 3, B still active → under the OLD rule B would see A's final count as a
    // target. Under the NEW rule, B's own round isn't over yet, so it stays hidden.
    const s = state({ [A]: board([safe[0], safe[1], safe[2]], true, { bustedOn: aMine(0) }), [B]: board([safe[0]]) });
    const v = as(mines.viewFor(s, B));
    expect(v.boards[A].score).toBeUndefined(); // NOT revealed — B hasn't locked yet
    expect(v.boards[A].uncovered).toBeUndefined();
    expect(v.boards[B].mines).toBeUndefined(); // B is active → still no mines
  });

  it('STAYS hidden to a LOCKED viewer while the opponent is still active (old engine\'s "chase" is gone)', () => {
    const safe = safeSquares(0);
    // A is locked (busted) at 2; B still climbing at 5 → under the OLD rule A would watch B's
    // live count climb (the chase). Under the NEW rule, A sees nothing until B also locks.
    const s = state({ [A]: board([safe[0], safe[1]], true, { bustedOn: aMine(0) }), [B]: board([safe[0], safe[1], safe[2], safe[3], safe[4]]) });
    const v = as(mines.viewFor(s, A));
    expect(v.boards[B].score).toBeUndefined(); // NOT revealed — B hasn't locked yet
    expect(v.boards[B].uncovered).toBeUndefined();
    expect(v.boards[A].mines).toHaveLength(MINE_COUNT); // a locked player still sees their own mine layout
    expect(v.boards[A].bustedOn).toBe(aMine(0));
  });

  it('reveals the opponent count ONLY once BOTH players are locked', () => {
    const safe = safeSquares(0);
    const s = state({
      [A]: board([safe[0], safe[1]], true, { bustedOn: aMine(0) }),
      [B]: board([safe[0], safe[1], safe[2], safe[3], safe[4]], true, { bustedOn: aMine(0) }),
    });
    const vFromA = as(mines.viewFor(s, A));
    expect(vFromA.boards[B].score).toBe(5); // both locked → revealed
    expect(vFromA.boards[B].uncovered).toBeUndefined(); // board itself still never shown pre-terminal
    const vFromB = as(mines.viewFor(s, B));
    expect(vFromB.boards[A].score).toBe(2);
  });

  it('reveals everything at terminal (both boards + mines + seed, for verifiability)', () => {
    const s = state({ [A]: board([0, 1, 2], true), [B]: board([0], true) }, { winner: A });
    const v = as(mines.viewFor(s, B));
    expect(v.boards[A].uncovered).toEqual([0, 1, 2]); // opponent fully revealed
    expect(v.seed).toBe(SEED);
    expect(v.mines).toHaveLength(MINE_COUNT);
  });
});

// ── draws → replay (internal draws are NOT contract-draws) — UNCHANGED ───────

describe('minesModule — a tie re-deals a fresh board (not a refund) — unchanged behaviour', () => {
  it('both lock at equal scores → replay in the same match (fresh board, not terminal), clock restamped', () => {
    const safe = safeSquares(0);
    const s = play(mines.init([A, B], rngWith(SEED)), [
      [A, safe[0]], [A, safe[1]], [A, aMine(0)], // A locked at 2
      [B, safe[0]], [B, safe[1]], [B, aMine(0)], // B locked at 2 → tie
    ]);
    expect(mines.isTerminal(s)).toBe(false);
    expect(as(s).round).toBe(1);
    expect(as(s).draws).toBe(1);
    expect(as(s).boards[A]).toEqual({ uncovered: [], locked: false }); // re-dealt
    expect(as(s).boards[B]).toEqual({ uncovered: [], locked: false });
  });

  it('the replay round restamps roundStartedAt from the moment resolution happened (fresh 30s cap)', () => {
    const safe = safeSquares(0);
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.launch!(s, 1_000);
    s = mines.applyMove(s, safe[0], ctx(A, 1_500)).state;
    s = mines.applyMove(s, safe[1], ctx(A, 1_600)).state;
    s = mines.applyMove(s, aMine(0), ctx(A, 1_700)).state; // A locked at 2
    s = mines.applyMove(s, safe[0], ctx(B, 1_800)).state;
    s = mines.applyMove(s, safe[1], ctx(B, 1_900)).state;
    s = mines.applyMove(s, aMine(0), ctx(B, 2_000)).state; // B locked at 2 → tie, redeal @2000
    expect(as(s).roundStartedAt).toBe(2_000); // NOT the original 1_000 launch time
  });
});

// ── 10-draw cap → void — UNCHANGED ───────────────────────────────────────────

describe('minesModule — draw cap (unchanged: exactly 10 consecutive draws)', () => {
  it('the 10th consecutive draw voids the match (refund both)', () => {
    // 9 draws already; A locked at 0, B about to lock at 0 too → 10th draw → void.
    const s = state(
      { [A]: board([], true), [B]: board([]) },
      { draws: 9, round: 9 },
    );
    const r = mines.applyMove(s, aMine(9), ctx(B)); // B busts at 0 → tie → cap
    expect(mines.isTerminal(r.state)).toBe(true);
    expect(mines.outcome(r.state)).toEqual({ type: 'void' });
    expect(as(r.state).draws).toBe(10);
    expect(r.events.some((e) => e.type === 'match_voided')).toBe(true);
  });

  it('a draw just below the cap still replays', () => {
    const s = state({ [A]: board([], true), [B]: board([]) }, { draws: 8, round: 8 });
    const r = mines.applyMove(s, aMine(8), ctx(B)); // tie at 0 → 9th draw
    expect(mines.isTerminal(r.state)).toBe(false);
    expect(as(r.state).draws).toBe(9);
    expect(as(r.state).round).toBe(9);
  });
});

// ── isTerminal / outcome shape ───────────────────────────────────────────────

describe('minesModule.isTerminal / outcome', () => {
  it('only ever yields a contract-level win (decisive) or void — never a contract draw', () => {
    const win = state({ [A]: board([0, 1, 2], true), [B]: board([0], true) }, { winner: A });
    expect(mines.outcome(win)).toEqual({ type: 'win', winner: A });
    const voided = state({ [A]: board([], true), [B]: board([], true) }, { forcedOutcome: { type: 'void' } });
    expect(mines.outcome(voided)).toEqual({ type: 'void' });
  });
});

// ── forfeit / disconnect (no instant void) — UNCHANGED ───────────────────────

describe('minesModule.forfeit — disconnect resolves by comparing current scores (unchanged)', () => {
  it('the present player wins when ahead (NOT an instant forfeit-void)', () => {
    const safe = safeSquares(0);
    const s = state({ [A]: board([safe[0]]), [B]: board([safe[0], safe[1], safe[2]]) });
    const r = mines.forfeit(s, A); // A drops at 1, B at 3
    expect(mines.isTerminal(r)).toBe(true);
    expect(mines.outcome(r)).toEqual({ type: 'win', winner: B });
  });

  it('the dropped player still wins if they were ahead', () => {
    const safe = safeSquares(0);
    const s = state({ [A]: board([safe[0], safe[1], safe[2]]), [B]: board([safe[0]]) });
    expect(mines.outcome(mines.forfeit(s, A))).toEqual({ type: 'win', winner: A });
  });

  it('equal scores (incl. a 0–0 pre-move abandon / both-disconnect tie) → void', () => {
    expect(mines.outcome(mines.forfeit(state({ [A]: board([]), [B]: board([]) }), A))).toEqual({ type: 'void' });
    const safe = safeSquares(0);
    const tie = state({ [A]: board([safe[0], safe[1]]), [B]: board([safe[0], safe[1]]) });
    expect(mines.outcome(mines.forfeit(tie, B))).toEqual({ type: 'void' });
  });
});

// ── scheduledDeadlines + lockOnTimeout (ADR-012) — unit level ────────────────

describe('minesModule.scheduledDeadlines / lockOnTimeout (ADR-012 — the new 30s round clock)', () => {
  it('scheduledDeadlines is empty before launch (roundStartedAt unset)', () => {
    const s = mines.init([A, B], rngWith(SEED));
    expect(mines.scheduledDeadlines!(s)).toEqual({});
  });

  it('schedules BOTH active players at roundStartedAt + 30s — a single absolute cap, not per-move', () => {
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.launch!(s, 10_000);
    expect(mines.scheduledDeadlines!(s)).toEqual({ [A]: 10_000 + ROUND_TIMEOUT_MS, [B]: 10_000 + ROUND_TIMEOUT_MS });
    expect(ROUND_TIMEOUT_MS).toBe(30_000);
  });

  it('tapping does NOT move the deadline (no per-move reset — rule 3)', () => {
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.launch!(s, 10_000);
    s = mines.applyMove(s, safeSquares(0)[0], ctx(A, 15_000)).state; // A taps well inside the window
    expect(mines.scheduledDeadlines!(s)).toEqual({ [A]: 10_000 + ROUND_TIMEOUT_MS, [B]: 10_000 + ROUND_TIMEOUT_MS });
  });

  it('a locked player has nothing scheduled', () => {
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.launch!(s, 10_000);
    s = mines.applyMove(s, aMine(0), ctx(A, 15_000)).state; // A busts
    expect(mines.scheduledDeadlines!(s)).toEqual({ [B]: 10_000 + ROUND_TIMEOUT_MS });
  });

  it('scheduledDeadlines is empty once terminal', () => {
    const s = state({ [A]: board([], true), [B]: board([], true) }, { winner: A, roundStartedAt: 1_000 });
    expect(mines.scheduledDeadlines!(s)).toEqual({});
  });

  it('lockOnTimeout locks the player at their CURRENT score, no move injected, reason "timeout" — NO score in the event while the opponent is still active', () => {
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.launch!(s, 0);
    s = mines.applyMove(s, safeSquares(0)[0], ctx(A, 100)).state; // A: 1 gem
    const res = mines.lockOnTimeout!(s, A, ROUND_TIMEOUT_MS);
    const me = as(res.state).boards[A];
    expect(me.locked).toBe(true);
    expect(me.uncovered).toEqual([safeSquares(0)[0]]); // unchanged — no synthesized tap
    // B is still active (untouched) at this point — the event must NOT carry A's score, or the
    // still-active B would learn the exact target the instant it's set (viewFor still hides it).
    expect(res.events[0]).toEqual({ type: 'player_locked', payload: { playerId: A, reason: 'timeout' } });
    expect(mines.legalMoves(res.state, A)).toEqual([]); // no re-fire on the sweep
  });

  it('lockOnTimeout at ZERO gems is valid (a disconnect before any tap locks at 0 — Designer-confirmed), still no score leak', () => {
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.launch!(s, 0);
    const res = mines.lockOnTimeout!(s, A, ROUND_TIMEOUT_MS);
    expect(as(res.state).boards[A]).toMatchObject({ locked: true, uncovered: [] });
    expect(res.events[0]).toEqual({ type: 'player_locked', payload: { playerId: A, reason: 'timeout' } });
  });

  it('lockOnTimeout DOES carry score once the opponent is already locked (this lock resolves the match)', () => {
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.launch!(s, 0);
    s = mines.applyMove(s, aMine(0), ctx(B, 50)).state; // B locked (bust) at 0 first
    s = mines.applyMove(s, safeSquares(0)[0], ctx(A, 100)).state; // A: 1 gem
    const res = mines.lockOnTimeout!(s, A, ROUND_TIMEOUT_MS); // A times out, opponent (B) already locked
    expect(res.events[0]).toEqual({ type: 'player_locked', payload: { playerId: A, reason: 'timeout', score: 1 } });
    expect(mines.isTerminal(res.state)).toBe(true);
  });

  it('lockOnTimeout re-evaluates resolution exactly like a normal move (both timing out → draw/replay)', () => {
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.launch!(s, 0);
    let r = mines.lockOnTimeout!(s, A, ROUND_TIMEOUT_MS);
    expect(mines.isTerminal(r.state)).toBe(false); // only one side locked so far
    r = mines.lockOnTimeout!(r.state, B, ROUND_TIMEOUT_MS);
    // Both locked at 0 → tie → internal draw → replay (not terminal, round bumps).
    expect(mines.isTerminal(r.state)).toBe(false);
    expect(as(r.state).round).toBe(1);
    expect(as(r.state).draws).toBe(1);
    expect(r.events.some((e) => e.type === 'new_round')).toBe(true);
  });

  it('lockOnTimeout can decide the match outright (one ahead, both time out)', () => {
    let s = mines.init([A, B], rngWith(SEED));
    s = mines.launch!(s, 0);
    s = mines.applyMove(s, safeSquares(0)[0], ctx(A, 100)).state; // A: 1 gem, B: 0
    let r = mines.lockOnTimeout!(s, A, ROUND_TIMEOUT_MS);
    r = mines.lockOnTimeout!(r.state, B, ROUND_TIMEOUT_MS);
    expect(mines.isTerminal(r.state)).toBe(true);
    expect(mines.outcome(r.state)).toEqual({ type: 'win', winner: A });
  });
});

// ── ADR-012 integration — the REAL createMatchmaking + the REAL Mines module ─

describe('minesModule via the real core matchmaking sweep (ADR-012 end-to-end, no fake)', () => {
  function setup(stake = 50) {
    let clock = 1_000_000;
    const db = new Database(':memory:');
    const ledger = createLedger(db);
    const mm = createMatchmaking(ledger, [mines], undefined, { now: () => clock });
    ledger.grant('alice');
    ledger.grant('bob');
    mm.joinQueue('alice', 'mines', stake);
    const r = mm.joinQueue('bob', 'mines', stake);
    if (r.status !== 'matched') throw new Error('expected matched');
    return {
      ledger, mm, matchId: r.matchId, start: clock,
      advance: (ms: number) => { clock += ms; },
      now: () => clock,
    };
  }

  it('launch (via matchmaking formation) schedules both players at start + 30s', () => {
    const { mm, matchId, start } = setup();
    expect(mm.getActiveMatch(matchId)!.playerDeadlines).toEqual({
      alice: start + ROUND_TIMEOUT_MS,
      bob: start + ROUND_TIMEOUT_MS,
    });
  });

  it('neither player taps → both lock at 0 via the sweep, calling lockOnTimeout (never a synthesized move)', () => {
    const { mm, matchId, advance, now } = setup();
    advance(ROUND_TIMEOUT_MS + 100);
    const res = mm.sweepTimedOutMoves(now());
    expect(res.map((r) => r.playerId)).toEqual(['alice', 'bob']);
    // alice locks FIRST — bob is still active at that instant, so the broadcast event must NOT
    // carry alice's score (GAME_MODULE_INTERFACE.md's redaction rule: nothing an event carries
    // may be something viewFor still conceals — and viewFor hides it until bob locks too).
    expect(res[0].events).toEqual([{ type: 'player_locked', payload: { playerId: 'alice', reason: 'timeout' } }]);
    // bob locks SECOND — alice is already locked, so this is the lock that resolves the match;
    // viewFor would reveal bob's score to alice regardless, so the event may carry it too.
    expect(res[1].events).toEqual([
      { type: 'player_locked', payload: { playerId: 'bob', reason: 'timeout', score: 0 } },
      { type: 'new_round', payload: { round: 1, draws: 1 } },
    ]);
    // Both at 0 → an internal draw → replay, NOT a settled match (still active).
    expect(res[1].terminal).toBe(false);
    expect(mm.getActiveMatch(matchId)).toBeDefined();
  });

  it('one player taps ahead before the clock, both then time out → decisive settlement with per-game rake', () => {
    const { mm, matchId, advance, now, ledger } = setup(100);
    // Read the real seeded layout out of the live match state to pick a genuinely safe square.
    const liveState = mm.getActiveMatch(matchId)!.state as { seed: number; round: number };
    const safe = Array.from({ length: BOARD_SIZE }, (_, i) => i).filter(
      (i) => !minesFor(liveState.seed, liveState.round, BOARD_SIZE, MINE_COUNT).has(i),
    );
    mm.applyMove(matchId, 'alice', safe[0], now()); // alice: 1 gem, well before the deadline
    // No early resolution: alice being ahead of bob's 0 does not end anything yet.
    expect(mm.getActiveMatch(matchId)).toBeDefined();

    advance(ROUND_TIMEOUT_MS + 100); // neither taps again — both round clocks expire
    const res = mm.sweepTimedOutMoves(now());
    expect(res).toHaveLength(2); // alice locked (timeout, score 1), then bob (timeout, score 0)
    expect(res[1]).toMatchObject({ playerId: 'bob', terminal: true });
    expect(res[1].outcome).toEqual({ type: 'win', winner: 'alice' });
    expect(res[1].settlement!['alice'].delta).toBe(95); // 100 stake each − round(200*0.025)=5 rake
    expect(ledger.getBalance(PLATFORM_ACCOUNT)).toBe(5);
    expect(mm.getActiveMatch(matchId)).toBeUndefined(); // settled + removed
  });

  it('a manual forfeit mid-round still resolves by current score (unaffected by the ADR-012 wiring)', () => {
    const { mm, matchId, ledger } = setup(50);
    const liveState = mm.getActiveMatch(matchId)!.state as { seed: number; round: number };
    const safe = Array.from({ length: BOARD_SIZE }, (_, i) => i).filter(
      (i) => !minesFor(liveState.seed, liveState.round, BOARD_SIZE, MINE_COUNT).has(i),
    );
    mm.applyMove(matchId, 'alice', safe[0], Date.now());
    const settled = mm.forfeitMatch(matchId, 'bob'); // bob quits at 0, alice ahead at 1
    expect(settled.outcome).toEqual({ type: 'win', winner: 'alice' });
    expect(ledger.getBalance('alice')).toBeGreaterThan(GRANT_AMOUNT); // won the pot
  });
});

// ── determinism ──────────────────────────────────────────────────────────────

describe('minesModule — determinism', () => {
  it('same seed + same ordered moves → byte-identical state and outcome', () => {
    const safe = safeSquares(0);
    const seq: [PlayerId, number][] = [
      [A, safe[0]], [A, safe[1]], [B, safe[0]], [A, aMine(0)], [B, safe[1]], [B, safe[2]], [B, aMine(0)],
    ];
    const run = () => {
      // Init with SEED so the squares picked from its layout really are safe/mine as intended.
      const s = play(mines.init([A, B], rngWith(SEED)), seq);
      return { state: s, outcome: mines.isTerminal(s) ? mines.outcome(s) : null };
    };
    const r1 = run();
    const r2 = run();
    expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
    expect(r1.outcome).toEqual(r2.outcome);
  });

  it('same seed + a lockOnTimeout replay → byte-identical state (the clock path is deterministic too)', () => {
    const run = () => {
      let s = mines.init([A, B], rngWith(SEED));
      s = mines.launch!(s, 0);
      s = mines.applyMove(s, safeSquares(0)[0], ctx(A, 100)).state;
      let r = mines.lockOnTimeout!(s, A, ROUND_TIMEOUT_MS);
      r = mines.lockOnTimeout!(r.state, B, ROUND_TIMEOUT_MS);
      return r.state;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
