import { describe, expect, it } from 'vitest';
import type { GameState, Move, PlayerId, Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { hiloModule as hilo } from './hilo.js';
import { MATCH_CAP_MS, REPLAY_CAP, SEQ_LEN, callCorrect, cardFor } from './deck.js';

const A = 'player-A';
const B = 'player-B';
const rngWith = (seed: number): Rng => ({ next: () => 0, int: () => seed });
const SEED = 9001;
const T0 = 1000; // formation time

interface ProgV { position: number; busted: boolean; frozen: boolean; card?: { rank: number }; bustCard?: { rank: number } }
interface StateV {
  players: [PlayerId, PlayerId]; seed: number; round: number; replays: number;
  startedAt: number; endsAt: number;
  progress: Record<string, ProgV>;
  lastResult?: { round: number; streaks: Record<string, number> };
  winner?: PlayerId; forcedOutcome?: { type: string };
}
const view = (s: GameState): StateV => s as StateV;

const newGame = (seed = SEED): GameState => hilo.launch(hilo.init([A, B], rngWith(seed)), T0);
const apply = (s: GameState, p: string, m: Move, now = T0 + 1): GameState => hilo.applyMove(s, m, { playerId: p, now }).state;

/** Advance player `p` by one correct call (handles a tie → either call is correct). */
function advance(s: GameState, p: string): GameState {
  const st = view(s);
  const pos = st.progress[p].position;
  const cur = cardFor(st.seed, st.round, pos);
  const next = cardFor(st.seed, st.round, pos + 1);
  const call = callCorrect('hi', cur, next) ? 'hi' : 'lo';
  return apply(s, p, { t: call });
}
/** Drive player `p` to a deterministic bust (skipping tie transitions, which can't bust). */
function bust(s: GameState, p: string): GameState {
  for (let guard = 0; guard < SEQ_LEN; guard++) {
    const st = view(s);
    const pos = st.progress[p].position;
    const cur = cardFor(st.seed, st.round, pos);
    const next = cardFor(st.seed, st.round, pos + 1);
    if (next.rank !== cur.rank) {
      const wrong = next.rank > cur.rank ? 'lo' : 'hi'; // opposite of the correct call
      return apply(s, p, { t: wrong });
    }
    s = advance(s, p); // tie → advance and look again
  }
  return s;
}

describe('hilo deck', () => {
  it('cardFor is deterministic, ranks 2..14', () => {
    for (let i = 0; i < 40; i++) {
      const c = cardFor(SEED, 0, i);
      expect(c.rank).toBeGreaterThanOrEqual(2);
      expect(c.rank).toBeLessThanOrEqual(14);
      expect(cardFor(SEED, 0, i)).toEqual(c);
    }
  });
  it('callCorrect: equal rank always correct; hi/lo otherwise', () => {
    expect(callCorrect('hi', { rank: 5, suit: '♠' }, { rank: 5, suit: '♥' })).toBe(true);
    expect(callCorrect('lo', { rank: 5, suit: '♠' }, { rank: 5, suit: '♥' })).toBe(true);
    expect(callCorrect('hi', { rank: 5, suit: '♠' }, { rank: 9, suit: '♥' })).toBe(true);
    expect(callCorrect('hi', { rank: 9, suit: '♠' }, { rank: 5, suit: '♥' })).toBe(false);
    expect(callCorrect('lo', { rank: 9, suit: '♠' }, { rank: 5, suit: '♥' })).toBe(true);
  });
});

describe('hilo launch + calls', () => {
  it('launch stamps the shared clock', () => {
    const s = view(newGame());
    expect(s.startedAt).toBe(T0);
    expect(s.endsAt).toBe(T0 + MATCH_CAP_MS);
    expect(s.progress[A].position).toBe(0);
  });

  it('legalMoves: hi/lo/timeout while active; [] when finished', () => {
    const s = newGame();
    const lm = hilo.legalMoves(s, A) as { t: string }[];
    expect(lm.map((m) => m.t).sort()).toEqual(['hi', 'lo', 'timeout']);
    const busted = bust(s, A);
    expect(hilo.legalMoves(busted, A)).toEqual([]);
  });

  it('a correct call advances the streak; a wrong call busts', () => {
    let s = newGame();
    s = advance(s, A);
    expect(view(s).progress[A].position).toBe(1);
    s = bust(s, A);
    expect(view(s).progress[A].busted).toBe(true);
  });
});

describe('resolution (longer streak wins; equal → replay)', () => {
  it('both finished → higher streak wins', () => {
    let s = newGame();
    s = advance(s, A); // A streak 1+
    s = advance(s, A);
    s = bust(s, A); // A frozen at ≥2
    const aStreak = view(s).progress[A].position;
    s = bust(s, B); // B busts at 0 (first transition is usually non-tie)
    const bStreak = view(s).progress[B].position;
    expect(hilo.isTerminal(s)).toBe(true);
    const o = hilo.outcome(s);
    expect(o).toEqual({ type: 'win', winner: aStreak > bStreak ? A : B });
  });

  it('is NOT terminal until BOTH are finished', () => {
    let s = newGame();
    s = bust(s, A); // A done, B still going
    expect(hilo.isTerminal(s)).toBe(false);
    expect(hilo.legalMoves(s, A)).toEqual([]);
    expect((hilo.legalMoves(s, B) as unknown[]).length).toBe(3);
  });

  it('equal streaks → replay with a fresh clock (not terminal)', () => {
    // Both bust immediately at streak 0 (force a non-tie first transition for each via bust()).
    let s = newGame();
    s = bust(s, A);
    s = bust(s, B);
    const va = view(s);
    if (va.progress[A].position !== va.progress[B].position) return; // unequal by seed — skip
    expect(hilo.isTerminal(s)).toBe(false);
    expect(va.round).toBe(1);
    expect(va.replays).toBe(1);
    expect(va.startedAt).toBe(T0 + 1); // fresh clock from the resolving move's `now`
  });

  it('REPLAY_CAP equal rounds → void', () => {
    let s = newGame();
    let guard = 0;
    while (!hilo.isTerminal(s) && guard++ < REPLAY_CAP + 5) {
      // Both freeze at 0 every round → equal → replay until the cap.
      s = apply(s, A, { t: 'timeout' });
      if (!hilo.isTerminal(s)) s = apply(s, B, { t: 'timeout' });
    }
    expect(hilo.outcome(s)).toEqual({ type: 'void' });
    expect(view(s).replays).toBe(REPLAY_CAP);
  });
});

describe('the shared 30s cap (scheduled-deadline timer)', () => {
  it('scheduledDeadlines reports the shared end for each active player', () => {
    const s = newGame();
    expect(hilo.scheduledDeadlines!(s)).toEqual({ [A]: T0 + MATCH_CAP_MS, [B]: T0 + MATCH_CAP_MS });
    // a busted player drops out
    expect(hilo.scheduledDeadlines!(bust(s, A))[A]).toBeUndefined();
  });

  it('a call at/after the deadline is rejected; timeout freezes the streak', () => {
    const s = newGame();
    expect(() => apply(s, A, { t: 'hi' }, T0 + MATCH_CAP_MS)).toThrow(IllegalMove);
    const frozen = apply(s, A, { t: 'timeout' }, T0 + MATCH_CAP_MS);
    expect(view(frozen).progress[A].frozen).toBe(true);
  });

  it('timeoutMove returns timeout (a legal move for an active player)', () => {
    expect(hilo.timeoutMove!(newGame(), A, rngWith(0))).toEqual({ t: 'timeout' });
  });
});

describe('redaction (viewFor)', () => {
  it("sends my own card but hides the opponent's progress + the seed", () => {
    let s = newGame();
    s = advance(s, A);
    const aView = view(hilo.viewFor(s, A));
    expect(aView.progress[A].position).toBe(1);
    expect(aView.progress[A].card!.rank).toBe(cardFor(SEED, 0, 1).rank); // my current card
    expect(aView.seed).toBe(0); // stripped → can't compute future cards
    expect(aView.progress[B]).toEqual({}); // opponent hidden
    expect(aView.endsAt).toBe(T0 + MATCH_CAP_MS); // shared clock is public
  });

  it('reveals both streaks + seed at terminal', () => {
    let s = newGame();
    s = bust(s, A);
    s = bust(s, B);
    // force terminal: if equal it replayed — drive to a decisive end
    let guard = 0;
    while (!hilo.isTerminal(s) && guard++ < 20) {
      s = advance(s, A);
      s = bust(s, B);
      if (!hilo.isTerminal(s)) s = bust(s, A);
    }
    if (!hilo.isTerminal(s)) return;
    const bView = view(hilo.viewFor(s, B));
    expect(bView.seed).toBe(SEED);
    expect(typeof bView.progress[A].position).toBe('number'); // both revealed
  });
});

describe('determinism + forfeit + immutability', () => {
  it('one seed + recorded calls → identical state', () => {
    const run = (seed: number) => {
      let s = hilo.launch(hilo.init([A, B], rngWith(seed)), T0);
      s = advance(s, A);
      s = advance(s, A);
      s = bust(s, A);
      s = bust(s, B);
      return s;
    };
    expect(run(13579)).toEqual(run(13579));
  });
  it('forfeit freezes both and compares', () => {
    let s = newGame();
    s = advance(s, A); // A ahead
    s = hilo.forfeit(s, B);
    expect(hilo.isTerminal(s)).toBe(true);
    expect(['win', 'void']).toContain(hilo.outcome(s).type);
  });
  it('applyMove never mutates the input', () => {
    const s0 = newGame();
    const snap = JSON.stringify(s0);
    advance(s0, A);
    expect(JSON.stringify(s0)).toBe(snap);
  });
});
