import { describe, expect, it } from 'vitest';
import type { Rng } from '@rapidclash/shared';
import { IllegalMove } from '@rapidclash/shared';
import { rpsModule } from './rps.js';

const P1 = 'player-1';
const P2 = 'player-2';

// RPS uses no randomness; this stub satisfies the Rng interface.
const rng: Rng = { next: () => 0, int: () => 0 };

const ctx = (playerId: string) => ({ playerId, now: 0 });

// Typed helper so tests don't sprinkle casts everywhere.
type RpsView = { players: [string, string]; choices: Record<string, unknown> };
function view(state: unknown): RpsView {
  return state as RpsView;
}

describe('rpsModule.meta', () => {
  it('has the exact meta specified in the contract', () => {
    expect(rpsModule.meta).toEqual({
      id: 'rps',
      displayName: 'Rock Paper Scissors',
      minPlayers: 2,
      maxPlayers: 2,
      ranking: { kind: 'win_rate' },
      bet: { minStake: 1, maxStake: 100, symmetricStake: true },
      averageDurationSec: 10,
      rakeRate: 0.025,
    });
  });

  it('declares a 2.5% rake rate', () => {
    expect(rpsModule.meta.rakeRate).toBe(0.025);
  });
});

describe('rpsModule.init', () => {
  it('starts with empty choices', () => {
    const state = rpsModule.init([P1, P2], rng);
    expect(view(state).choices).toEqual({});
  });
});

describe('rpsModule.legalMoves', () => {
  it('returns all three choices for a player who has not yet chosen', () => {
    const state = rpsModule.init([P1, P2], rng);
    expect(rpsModule.legalMoves(state, P1)).toEqual(['rock', 'paper', 'scissors']);
    expect(rpsModule.legalMoves(state, P2)).toEqual(['rock', 'paper', 'scissors']);
  });

  it('returns [] after the player has chosen', () => {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, 'rock', ctx(P1)).state;
    expect(rpsModule.legalMoves(state, P1)).toEqual([]);
    expect(rpsModule.legalMoves(state, P2)).toEqual(['rock', 'paper', 'scissors']);
  });
});

describe('rpsModule.isTerminal', () => {
  it('is false before any player has chosen', () => {
    expect(rpsModule.isTerminal(rpsModule.init([P1, P2], rng))).toBe(false);
  });

  it('is false when only one player has chosen', () => {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, 'rock', ctx(P1)).state;
    expect(rpsModule.isTerminal(state)).toBe(false);
  });

  it('is true when both players have chosen', () => {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, 'rock', ctx(P1)).state;
    state = rpsModule.applyMove(state, 'scissors', ctx(P2)).state;
    expect(rpsModule.isTerminal(state)).toBe(true);
  });
});

describe('rpsModule.applyMove', () => {
  it('emits move_made with playerId but NOT the choice', () => {
    const state = rpsModule.init([P1, P2], rng);
    const { events } = rpsModule.applyMove(state, 'rock', ctx(P1));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('move_made');
    // Payload must identify the player but must not reveal the choice.
    expect(events[0].payload).toEqual({ playerId: P1 });
  });

  it('throws IllegalMove when the player tries to choose twice', () => {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, 'rock', ctx(P1)).state;
    expect(() => rpsModule.applyMove(state, 'paper', ctx(P1))).toThrow(IllegalMove);
  });

  it('throws IllegalMove for an unrecognised choice', () => {
    const state = rpsModule.init([P1, P2], rng);
    expect(() => rpsModule.applyMove(state, 'dynamite', ctx(P1))).toThrow(IllegalMove);
  });
});

describe('rpsModule.outcome — win resolution', () => {
  function play(c1: string, c2: string) {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, c1, ctx(P1)).state;
    state = rpsModule.applyMove(state, c2, ctx(P2)).state;
    return rpsModule.outcome(state);
  }

  it('rock beats scissors', () => {
    expect(play('rock', 'scissors')).toEqual({ type: 'win', winner: P1 });
  });

  it('scissors beats paper', () => {
    expect(play('scissors', 'paper')).toEqual({ type: 'win', winner: P1 });
  });

  it('paper beats rock', () => {
    expect(play('paper', 'rock')).toEqual({ type: 'win', winner: P1 });
  });

  it('scissors loses to rock', () => {
    expect(play('scissors', 'rock')).toEqual({ type: 'win', winner: P2 });
  });

  it('paper loses to scissors', () => {
    expect(play('paper', 'scissors')).toEqual({ type: 'win', winner: P2 });
  });

  it('rock loses to paper', () => {
    expect(play('rock', 'paper')).toEqual({ type: 'win', winner: P2 });
  });
});

describe('rpsModule.outcome — draw resolution', () => {
  function playDraw(choice: string) {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, choice, ctx(P1)).state;
    state = rpsModule.applyMove(state, choice, ctx(P2)).state;
    return rpsModule.outcome(state);
  }

  it('rock vs rock is a draw', () => expect(playDraw('rock')).toEqual({ type: 'draw' }));
  it('paper vs paper is a draw', () => expect(playDraw('paper')).toEqual({ type: 'draw' }));
  it('scissors vs scissors is a draw', () =>
    expect(playDraw('scissors')).toEqual({ type: 'draw' }));
});

describe('rpsModule.viewFor — hidden information', () => {
  it("does not expose P1's choice to P2 before terminal", () => {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, 'rock', ctx(P1)).state;
    const p2View = view(rpsModule.viewFor(state, P2));
    expect(P1 in p2View.choices).toBe(false);
  });

  it("shows P1's own choice in P1's view before terminal", () => {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, 'rock', ctx(P1)).state;
    const p1View = view(rpsModule.viewFor(state, P1));
    expect(p1View.choices[P1]).toBe('rock');
    expect(P2 in p1View.choices).toBe(false);
  });

  it('reveals both choices to both players at terminal', () => {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, 'rock', ctx(P1)).state;
    state = rpsModule.applyMove(state, 'scissors', ctx(P2)).state;
    const p2View = view(rpsModule.viewFor(state, P2));
    expect(p2View.choices[P1]).toBe('rock');
    expect(p2View.choices[P2]).toBe('scissors');
  });
});

describe('rpsModule.forfeit', () => {
  it('opponent wins when they had already chosen', () => {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, 'rock', ctx(P1)).state;
    const terminal = rpsModule.forfeit(state, P2); // P1 already chose; P2 forfeits
    expect(rpsModule.isTerminal(terminal)).toBe(true);
    expect(rpsModule.outcome(terminal)).toEqual({ type: 'win', winner: P1 });
  });

  it('returns void when neither player has chosen', () => {
    const state = rpsModule.init([P1, P2], rng);
    const terminal = rpsModule.forfeit(state, P1);
    expect(rpsModule.isTerminal(terminal)).toBe(true);
    expect(rpsModule.outcome(terminal)).toEqual({ type: 'void' });
  });

  it('returns void when only the quitter has chosen', () => {
    let state = rpsModule.init([P1, P2], rng);
    state = rpsModule.applyMove(state, 'rock', ctx(P1)).state;
    const terminal = rpsModule.forfeit(state, P1); // quitter is the one who moved
    expect(rpsModule.outcome(terminal)).toEqual({ type: 'void' });
  });
});

// S9 — Determinism test
describe('determinism (S9)', () => {
  function runMatch(moves: [string, string]) {
    const testRng: Rng = { next: () => 0, int: () => 0 };
    let state = rpsModule.init([P1, P2], testRng);
    state = rpsModule.applyMove(state, moves[0], ctx(P1)).state;
    state = rpsModule.applyMove(state, moves[1], ctx(P2)).state;
    return { state, outcome: rpsModule.outcome(state) };
  }

  it('two replays with the same seed and moves produce byte-identical state and outcome', () => {
    const moves: [string, string] = ['paper', 'rock'];
    const r1 = runMatch(moves);
    const r2 = runMatch(moves);
    expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
    expect(r1.outcome).toEqual(r2.outcome);
  });

  it('all six win/loss combinations are stable across replays', () => {
    const pairs: Array<[string, string]> = [
      ['rock', 'scissors'],
      ['scissors', 'paper'],
      ['paper', 'rock'],
      ['scissors', 'rock'],
      ['paper', 'scissors'],
      ['rock', 'paper'],
    ];
    for (const moves of pairs) {
      const r1 = runMatch(moves);
      const r2 = runMatch(moves);
      expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
      expect(r1.outcome).toEqual(r2.outcome);
    }
  });
});
