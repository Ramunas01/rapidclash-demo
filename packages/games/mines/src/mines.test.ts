import { describe, expect, it } from 'vitest';
import type { GameState, Move, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { minesModule as mines } from './mines.js';
import { BOARD_SIZE, SAFE_COUNT, minesFor } from './board.js';

const A = 'player-A';
const B = 'player-B';
const ctx = (playerId: string) => ({ playerId, now: 0 });

// Seeded rng stub. init calls rng.int(0, 0x7fffffff) once to fix the base seed.
const rngWith = (seed: number): Rng => ({ next: () => 0, int: () => seed });
/** An rng whose `int` always returns `n` (clamped into range by the caller's bounds). */
const intRng = (n: number): Rng => ({ next: () => 0, int: (min, max) => Math.min(max, Math.max(min, n)) });

const SEED = 12345;

// The (seed,round)-derived layout is the test's source of truth for which squares are safe.
const mineSet = (round = 0) => minesFor(SEED, round);
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
  return { players: [A, B], seed: SEED, round: 0, draws: 0, boards, ...extra } as GameState;
}

/** Apply a sequence of [player, square] moves, threading state. */
function play(s: GameState, moves: [PlayerId, number][]): GameState {
  return moves.reduce((acc, [p, sq]) => mines.applyMove(acc, sq, ctx(p)).state, s);
}

// ── meta ──────────────────────────────────────────────────────────────────────

describe('minesModule.meta', () => {
  it('declares the spec meta incl. rakeRate 0.025, net_winnings ranking, and a 5s move clock', () => {
    expect(mines.meta).toMatchObject({
      id: 'mines',
      displayName: 'Mines',
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'net_winnings' },
      bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      rakeRate: 0.025,
      moveTimeoutMs: 5000, // opts into the core per-player timer (#91)
    });
  });
});

// ── board determinism + identical-for-both ───────────────────────────────────

describe('minesModule — board determinism & identical layout for both players', () => {
  it('derives a fixed 16-mine layout from (seed, round), re-derivable byte-for-byte', () => {
    const m1 = [...minesFor(SEED, 0)].sort((a, b) => a - b);
    const m2 = [...minesFor(SEED, 0)].sort((a, b) => a - b);
    expect(m1).toHaveLength(16);
    expect(m1).toEqual(m2);
    expect(safeSquares(0)).toHaveLength(SAFE_COUNT); // 48 safe
    // A different round → a different layout (so a replay isn't the same board).
    expect([...minesFor(SEED, 1)].sort((a, b) => a - b)).not.toEqual(m1);
  });

  it('init gives BOTH players the identical board — the same square busts either of them', () => {
    const s = as(mines.init([A, B], rngWith(SEED)));
    expect(s.boards[A]).toEqual({ uncovered: [], locked: false });
    expect(s.boards[B]).toEqual({ uncovered: [], locked: false });
    expect(s.round).toBe(0);
    expect(s.draws).toBe(0);

    const mine = aMine(0);
    expect(as(mines.applyMove(s as GameState, mine, ctx(A)).state).boards[A].locked).toBe(true);
    expect(as(mines.applyMove(s as GameState, mine, ctx(B)).state).boards[B].locked).toBe(true);
  });

  it('init is JSON-serializable', () => {
    const s = mines.init([A, B], rngWith(1));
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
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

// ── applyMove: reveal / bust / clear ─────────────────────────────────────────

describe('minesModule.applyMove — reveal, bust, clear', () => {
  it('a safe uncover raises the score, stays unlocked, and emits NOTHING (no opponent leak)', () => {
    const safe = safeSquares(0);
    const res = mines.applyMove(mines.init([A, B], rngWith(SEED)), safe[0], ctx(A));
    expect(as(res.state).boards[A]).toEqual({ uncovered: [safe[0]], locked: false });
    expect(res.events).toEqual([]); // a mid-play safe reveal is silent
  });

  it('uncovering a mine busts: locks the board, records bustedOn, score unchanged', () => {
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

  it('clearing all 48 safe squares locks at max score WITHOUT a bust', () => {
    const safe = safeSquares(0);
    // A clears all 48; B does nothing → A locked at 48 but match not yet decided (B unlocked).
    const s = play(mines.init([A, B], rngWith(SEED)), safe.map((sq) => [A, sq] as [PlayerId, number]));
    const me = as(s).boards[A];
    expect(me.locked).toBe(true);
    expect(me.uncovered).toHaveLength(SAFE_COUNT);
    expect(me.bustedOn).toBeUndefined();
    expect(mines.isTerminal(s)).toBe(false); // B hasn't locked and can't be overtaken-from yet
  });

  it('rejects a non-square, an out-of-range index, a repeat, and acting when locked/terminal', () => {
    const s = mines.init([A, B], rngWith(SEED));
    expect(() => mines.applyMove(s, 'a1', ctx(A))).toThrow(IllegalMove);
    expect(() => mines.applyMove(s, 64, ctx(A))).toThrow(IllegalMove);
    expect(() => mines.applyMove(s, 2.5, ctx(A))).toThrow(IllegalMove);
    const after = mines.applyMove(s, safeSquares(0)[0], ctx(A)).state;
    expect(() => mines.applyMove(after, safeSquares(0)[0], ctx(A))).toThrow(IllegalMove); // repeat
    const term = state({ [A]: board([], true), [B]: board([], true) }, { winner: A });
    expect(() => mines.applyMove(term, 0, ctx(A))).toThrow(IllegalMove);
  });
});

// ── early-decision isTerminal / outcome ──────────────────────────────────────

describe('minesModule — early decision (settles before boards are exhausted)', () => {
  it('nothing is decided while neither player has locked', () => {
    const safe = safeSquares(0);
    const s = play(mines.init([A, B], rngWith(SEED)), [
      [A, safe[0]], [A, safe[1]], [B, safe[0]],
    ]);
    expect(mines.isTerminal(s)).toBe(false);
  });

  it('a player locked at S is NOT yet beaten while the opponent only matches S', () => {
    // A busts at 3; B reaches exactly 3 → still undecided (B must reach 4 or lock ≤3).
    const safe = safeSquares(0);
    const s = play(mines.init([A, B], rngWith(SEED)), [
      [A, safe[0]], [A, safe[1]], [A, safe[2]], [A, aMine(0)], // A locked at 3
      [B, safe[0]], [B, safe[1]], [B, safe[2]],               // B at 3 (== S)
    ]);
    expect(as(s).boards[A].locked).toBe(true);
    expect(mines.isTerminal(s)).toBe(false);
  });

  it('opponent reaching S+1 wins immediately (need not exhaust the board)', () => {
    const safe = safeSquares(0);
    const s = play(mines.init([A, B], rngWith(SEED)), [
      [A, safe[0]], [A, safe[1]], [A, safe[2]], [A, aMine(0)], // A locked at 3
      [B, safe[0]], [B, safe[1]], [B, safe[2]], [B, safe[3]],  // B reaches 4 = S+1
    ]);
    expect(mines.isTerminal(s)).toBe(true);
    expect(mines.outcome(s)).toEqual({ type: 'win', winner: B });
  });

  it('a locked player wins the instant the opponent locks at a LOWER score', () => {
    const safe = safeSquares(0);
    const s = play(mines.init([A, B], rngWith(SEED)), [
      [A, safe[0]], [A, safe[1]], [A, safe[2]], [A, safe[3]], [A, safe[4]], [A, aMine(0)], // A locked at 5
      [B, safe[0]], [B, safe[1]], [B, aMine(0)], // B locks (busts) at 2 ≤ 5
    ]);
    expect(mines.isTerminal(s)).toBe(true);
    expect(mines.outcome(s)).toEqual({ type: 'win', winner: A });
  });
});

// ── draws → replay (internal draws are NOT contract-draws) ───────────────────

describe('minesModule — a tie re-deals a fresh board (not a refund)', () => {
  it('both lock at equal scores → replay in the same match (fresh board, not terminal)', () => {
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
});

// ── 10-draw cap → void ───────────────────────────────────────────────────────

describe('minesModule — draw cap', () => {
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

// ── viewFor redaction (incl. count-reveal-on-lock) ───────────────────────────

describe('minesModule.viewFor — redaction & the count-reveal-on-lock chase', () => {
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

  it('reveals the opponent count once THE OPPONENT locks (the fixed target you race)', () => {
    const safe = safeSquares(0);
    // A busted at 3, B still active → B (active) is shown A's final count as the target.
    const s = state({ [A]: board([safe[0], safe[1], safe[2]], true, { bustedOn: aMine(0) }), [B]: board([safe[0]]) });
    const v = as(mines.viewFor(s, B));
    expect(v.boards[A].score).toBe(3); // opponent's final count revealed
    expect(v.boards[A].uncovered).toBeUndefined(); // but the board itself stays hidden
    expect(v.boards[B].mines).toBeUndefined(); // B is active → still no mines
  });

  it('reveals the opponent count to a LOCKED viewer (the chase) and reveals that viewer their own mines', () => {
    const safe = safeSquares(0);
    // A is locked (busted) at 2; B still climbing at 5 → A watches B's live count climb.
    const s = state({ [A]: board([safe[0], safe[1]], true, { bustedOn: aMine(0) }), [B]: board([safe[0], safe[1], safe[2], safe[3], safe[4]]) });
    const v = as(mines.viewFor(s, A));
    expect(v.boards[B].score).toBe(5); // opponent's LIVE count visible to the locked viewer
    expect(v.boards[B].uncovered).toBeUndefined(); // opponent board still hidden
    expect(v.boards[A].mines).toHaveLength(16); // a locked player sees the mine layout
    expect(v.boards[A].bustedOn).toBe(aMine(0));
  });

  it('reveals everything at terminal (both boards + mines + seed, for verifiability)', () => {
    const s = state({ [A]: board([0, 1, 2], true), [B]: board([0], true) }, { winner: A });
    const v = as(mines.viewFor(s, B));
    expect(v.boards[A].uncovered).toEqual([0, 1, 2]); // opponent fully revealed
    expect(v.seed).toBe(SEED);
    expect(v.mines).toHaveLength(16);
  });
});

// ── forfeit / disconnect (no instant void) ───────────────────────────────────

describe('minesModule.forfeit — disconnect resolves by comparing current scores', () => {
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

// ── timeoutMove (forward-compatible per-player timer hook) ────────────────────

describe('minesModule.timeoutMove — auto-reveal a random covered square', () => {
  it('returns one of the player’s still-covered squares', () => {
    const safe = safeSquares(0);
    const s = mines.applyMove(mines.init([A, B], rngWith(SEED)), safe[0], ctx(A)).state;
    const covered = mines.legalMoves(s, A) as number[];
    const picked = mines.timeoutMove!(s, A, intRng(5)) as number;
    expect(covered).toContain(picked);
    expect(picked).not.toBe(safe[0]); // never an already-uncovered square
  });

  it('the picked square is always legal to apply (it can itself be a mine)', () => {
    const s = mines.init([A, B], rngWith(SEED));
    const picked = mines.timeoutMove!(s, B, intRng(16)) as Move;
    expect(() => mines.applyMove(s, picked, ctx(B))).not.toThrow();
  });

  it('throws when the player has no covered square (locked)', () => {
    const s = state({ [A]: board([], true), [B]: board([0]) });
    expect(() => mines.timeoutMove!(s, A, intRng(0))).toThrow(IllegalMove);
  });
});

// ── determinism ──────────────────────────────────────────────────────────────

describe('minesModule — determinism', () => {
  it('same seed + same ordered moves → byte-identical state and outcome', () => {
    const safe = safeSquares(0);
    const seq: [PlayerId, number][] = [
      [A, safe[0]], [A, safe[1]], [B, safe[0]], [A, aMine(0)], [B, safe[1]], [B, safe[2]],
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
});
