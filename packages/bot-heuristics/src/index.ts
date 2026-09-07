// Shared move-selection heuristics for this project's scripted opponents (issue #432).
//
// These functions were originally defined inline in `apps/server/src/guest/index.ts` (issues #278
// and #297) and are moved here VERBATIM so `tools/bot-crowd` — an external Node process that
// speaks the same wire protocol as any other client (ADR-010) — can import the identical logic
// instead of forking a second implementation that would silently drift.
//
// WHY A NEW PACKAGE AND NOT `packages/shared`: `@rapidclash/game-chess` and
// `@rapidclash/game-blackjack` (whose `chessModule`/`blackjackModule`/`handValue` these heuristics
// call) already depend on `@rapidclash/shared`. Putting the heuristics in `shared` would make it
// depend back on the game packages — a cycle. This package instead sits ABOVE the game packages,
// so the arrows all still point one way: shared ← games ← bot-heuristics ← {apps/server,
// tools/bot-crowd}.
//
// Everything here is PURE: no timers, no I/O, no ambient `Date.now()`, and randomness only via the
// injectable `random` parameter (defaulting to `Math.random`). Callers own scheduling and
// submission — `apps/server`'s gateway owns the guest-mode "thinking" timer, `tools/bot-crowd`'s
// `Bot` owns its own.

import { chessModule, type ChessMove } from '@rapidclash/game-chess';
import { blackjackModule, handValue, type Card } from '@rapidclash/game-blackjack';
import type { GameState } from '@rapidclash/shared';

/** Standard capture values (pawn/knight/bishop/rook/queen); a king is never captured. */
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Sum of one side's piece values on a FEN's piece-placement field (the part before the first
 *  space) — used to diff a candidate move's effect on the OPPONENT's material (issue #278 §3's
 *  "recommended implementation": no chess.js dependency needed in apps/server, just parse the
 *  FEN chess.js itself already hands back via `ChessMove` state's `fen` field). */
function materialOn(fen: string, side: 'w' | 'b'): number {
  const placement = fen.split(' ')[0];
  let total = 0;
  for (const ch of placement) {
    if (ch === '/' || (ch >= '0' && ch <= '9')) continue;
    const isWhite = ch === ch.toUpperCase();
    if (isWhite === (side === 'w')) total += PIECE_VALUE[ch.toLowerCase()] ?? 0;
  }
  return total;
}

/**
 * Chess move-selection heuristic (issue #278 §3, Owner's explicit spec), pure and
 * fully deterministic given `random`:
 *   1-2. Enumerate every legal move; score each by the value of what it captures — evaluated by
 *        speculatively calling `chessModule.applyMove` for EVERY candidate (a pure function; it
 *        never touches the real match) and diffing the opponent's total material before/after.
 *        This full evaluation always runs, every move, regardless of what the gate below does.
 *   3. The highest-scoring move wins; ties (including "nothing captures, everything scores 0")
 *      broken by a uniform random pick among the tied top-scorers.
 *   4. 50/50 gate: half the time play the step-3 move: half the time play a uniformly random
 *      OTHER legal move instead — unless step-3's move is the bot's only legal move, in which
 *      case it's played regardless.
 * `random` defaults to `Math.random`; tests inject a seeded source for deterministic, repeatable
 * trials (real randomness can't be asserted on directly — see the acceptance criteria).
 *
 * The 50/50 gate is the whole point: this is deliberately an HONEST, imperfect opponent, not a
 * strong engine. It is skill calibration only — nothing here reads, or could read, WHICH account
 * it is playing against (issue #432's binding fairness stance: no outcome-rigging, ever).
 */
export function selectChessMove(
  state: GameState,
  botId: string,
  now: number,
  random: () => number = Math.random,
): ChessMove {
  const s = state as { players: [string, string]; fen: string };
  const legal = chessModule.legalMoves(state, botId) as ChessMove[];
  if (legal.length === 0) {
    throw new Error(`selectChessMove called for ${botId}, who has no legal move`);
  }

  const botSide: 'w' | 'b' = s.players[0] === botId ? 'w' : 'b';
  const oppSide: 'w' | 'b' = botSide === 'w' ? 'b' : 'w';
  const oppMaterialBefore = materialOn(s.fen, oppSide);

  // Steps 1-2: full evaluation, unconditionally, before the gate below ever runs.
  let bestScore = -Infinity;
  let best: ChessMove[] = [];
  for (const move of legal) {
    const speculative = chessModule.applyMove(state, move, { playerId: botId, now });
    const newFen = (speculative.state as { fen: string }).fen;
    const captured = oppMaterialBefore - materialOn(newFen, oppSide);
    if (captured > bestScore) {
      bestScore = captured;
      best = [move];
    } else if (captured === bestScore) {
      best.push(move);
    }
  }

  // Step 3: tie-break uniformly among the top scorers.
  const step3Move = best.length === 1 ? best[0] : best[Math.floor(random() * best.length)];

  // Step 4: the 50/50 gate — skipped only when step3Move is the bot's sole legal move.
  if (legal.length === 1) return step3Move;
  const playStep3 = random() < 0.5;
  if (playStep3) return step3Move;

  const step3Key = JSON.stringify(step3Move);
  const others = legal.filter((m) => JSON.stringify(m) !== step3Key);
  return others.length === 1 ? others[0] : others[Math.floor(random() * others.length)];
}

/**
 * P(hit) keyed to the hand's BEST value (issue #297, Owner-specified table — deliberately NOT a
 * flat "stand on 17" rule). "Best" is exactly `handValue`'s soft-if-it-exists-else-hard total, the
 * same value `BLACKJACK.md`'s own display logic computes — reused here, not re-derived.
 *
 * Exported (it was file-private in its original `apps/server/src/guest/index.ts` home) per issue
 * #432, so the curve itself is directly assertable and reusable rather than only observable
 * through 500-trial statistical sampling of `selectBlackjackMove`.
 */
export function hitProbability(best: number): number {
  if (best <= 14) return 1;
  if (best === 15) return 0.9;
  if (best === 16) return 0.8;
  if (best === 17) return 0.5;
  if (best === 18) return 0.2;
  return 0; // >= 19
}

/**
 * Blackjack hit/stand heuristic (issue #297, Owner's explicit spec): sample once per decision
 * point against `hitProbability` of the bot's own hand's best value. Pure and deterministic given
 * `random` (defaults to `Math.random`; tests inject a seeded source — same pluggable-random
 * pattern as `selectChessMove` above, for repeatable statistical trials).
 *
 * Note it reads ONLY the bot's own hand (`hands[botId]`) — never the opponent's. That holds even
 * when handed an unredacted server-side state, and it is also what makes the function usable
 * verbatim by `tools/bot-crowd`, which only ever receives a `viewFor`-redacted state off the wire.
 */
export function selectBlackjackMove(
  state: GameState,
  botId: string,
  random: () => number = Math.random,
): 'hit' | 'stand' {
  const legal = blackjackModule.legalMoves(state, botId);
  if (legal.length === 0) {
    throw new Error(`selectBlackjackMove called for ${botId}, who has no legal move`);
  }
  const s = state as { hands: Record<string, { cards: Card[]; done: boolean }> };
  const best = handValue(s.hands[botId].cards);
  return random() < hitProbability(best) ? 'hit' : 'stand';
}
