import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createLedger, createMatchmaking } from '@rapidclash/core';
import { diceModule } from '@rapidclash/game-dice';
import { baccaratModule } from '@rapidclash/game-baccarat';
import type { GameModule, PlayerId } from '@rapidclash/shared';

// Live-smoke (real core + the two independent-roll modules) of the over-the-wire path the WS
// gateway drives: pairing → the reveal commit → server-authoritative redaction (viewFor never
// leaks the opponent's roll/hand or either seed before the simultaneous reveal) → settlement
// (net_winnings to the winner, both stakes minus rake conserved). One spec per module so the
// shared skeleton is exercised identically for Dice and Baccarat.

function playToTerminal(mod: GameModule) {
  const ledger = createLedger(new Database(':memory:'));
  const mm = createMatchmaking(ledger, [mod]);
  for (const p of ['alice', 'bob']) ledger.grant(p);
  const start = ledger.getBalance('alice');

  expect(mm.joinQueue('alice', mod.meta.id, 10).status).toBe('waiting'); // registered ⇒ joinable
  const m = mm.joinQueue('bob', mod.meta.id, 10);
  expect(m.status).toBe('matched');
  if (m.status !== 'matched') throw new Error('unreachable');
  const { matchId } = m;

  // Pre-reveal redaction: each player's own view withholds BOTH seeds and any result.
  const raw = mm.getActiveMatch(matchId)!.state;
  for (const p of ['alice', 'bob'] as PlayerId[]) {
    const view = mod.viewFor(raw, p) as { seeds: Record<string, number>; result?: unknown };
    expect(Object.keys(view.seeds)).toHaveLength(0); // no seed leaks
    expect(view.result).toBeUndefined(); // no roll/hand leaks
  }
  // Bogus moves are rejected at the gateway membership check; only `reveal` is legal.
  expect(() => mm.applyMove(matchId, 'alice', 'nope', Date.now())).toThrow();

  // Both auto-commit the reveal (no decisions); the second turns the match terminal.
  mm.applyMove(matchId, 'alice', 'reveal', Date.now());
  const last = mm.applyMove(matchId, 'bob', 'reveal', Date.now());
  expect(mod.isTerminal(last.state)).toBe(true);

  // The gateway settles a terminal match through the ledger (rake from module meta).
  mm.settleMatch(matchId);

  return { ledger, mod, terminal: last.state, start };
}

describe('Dice — independent-roll smoke (real core + module)', () => {
  it('pairs, reveals, redacts until terminal, and settles net winnings to the higher roll', () => {
    const { ledger, mod, terminal, start } = playToTerminal(diceModule);
    expect(mod.isTerminal(terminal)).toBe(true);
    const out = mod.outcome(terminal)!;
    expect(out.type).toBe('win'); // never a contract draw — ties replay internally

    const t = terminal as { result: { rolls: Record<string, number> }; winner: string };
    expect(t.result.rolls['alice']).not.toBe(t.result.rolls['bob']); // distinct rolls
    const higher = t.result.rolls['alice'] > t.result.rolls['bob'] ? 'alice' : 'bob';
    expect(t.winner).toBe(higher); // higher roll wins

    // Settlement: winner up, loser down by the stake, house keeps the 2.5% rake.
    const winner = out.type === 'win' ? out.winner : null;
    expect(winner).toBe(higher);
    expect(ledger.getBalance(winner!)).toBeGreaterThan(start);
    expect(ledger.getBalance(winner === 'alice' ? 'bob' : 'alice')).toBe(start - 10);
  });
});

describe('Baccarat — independent-hand smoke (real core + module)', () => {
  it('pairs, reveals, redacts until terminal, and settles to the hand closer to 9', () => {
    const { ledger, mod, terminal, start } = playToTerminal(baccaratModule);
    expect(mod.isTerminal(terminal)).toBe(true);
    const out = mod.outcome(terminal)!;
    expect(out.type).toBe('win');

    const t = terminal as { result: { hands: Record<string, { total: number }> }; winner: string };
    expect(t.result.hands['alice'].total).not.toBe(t.result.hands['bob'].total);
    const closer = t.result.hands['alice'].total > t.result.hands['bob'].total ? 'alice' : 'bob';
    expect(t.winner).toBe(closer); // higher last-digit total (closest to 9) wins

    const winner = out.type === 'win' ? out.winner : null;
    expect(ledger.getBalance(winner!)).toBeGreaterThan(start);
    expect(ledger.getBalance(winner === 'alice' ? 'bob' : 'alice')).toBe(start - 10);
  });
});
