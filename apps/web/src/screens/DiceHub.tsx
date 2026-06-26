import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';
import type { DiceView, GameView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Hundredths → "42.37". */
const fmtRoll = (roll: number): string => (roll / 100).toFixed(2);
/** Hold the board a beat after the server resolves so the rolls reveal before the overlay. */
const HOLD_MS = 2200;

function DiceIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div data-testid="hub-board" className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl bg-surface p-6 text-center">
      <span className="text-5xl" aria-hidden="true">🎲</span>
      <p className="text-sm font-semibold text-muted-foreground">
        {phase === 'waiting' ? 'Finding a rival…' : 'Place your bet and roll'}
      </p>
    </div>
  );
}

/** One player's roll slot — a cosmetic spin until the simultaneous reveal, then the real number. */
function RollSlot({ label, roll, spinning, win }: { label: string; roll?: number; spinning: boolean; win?: boolean }) {
  const [spin, setSpin] = useState(0);
  useEffect(() => {
    if (!spinning) return;
    const id = setInterval(() => setSpin((s) => s + 1), 80);
    return () => clearInterval(id);
  }, [spinning]);
  const shown = roll != null ? fmtRoll(roll) : spinning ? fmtRoll(((spin * 5779 + 1234) % 10000)) : '··.··';
  return (
    <div className={cn('flex flex-1 flex-col items-center gap-1 rounded-xl border p-4', win ? 'border-success/50 bg-success/10' : 'border-border bg-surface/60')}>
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn('text-3xl font-black tabular-nums', win ? 'text-success' : 'text-foreground')}>{shown}</span>
    </div>
  );
}

/** The live Dice area: both players auto-commit a `reveal` (no decisions), then the higher of two
 *  independent rolls wins. Neither roll is shown until the simultaneous reveal (server redaction). */
function DiceBoard({ gameState, legalMoves, onMove, playerId, opponentId }: GameAreaArgs) {
  const view = gameState as DiceView | null;
  const me = playerId, opp = opponentId;
  const result = view?.result;
  const myRoll = me ? result?.rolls?.[me] : undefined;
  const oppRoll = opp ? result?.rolls?.[opp] : undefined;
  const resolved = Boolean(result);

  // No decisions: auto-commit the reveal as soon as the server offers it. Gating on legalMoves
  // (cleared optimistically on send, re-armed by the next match's your_turn) sends it exactly once.
  const canReveal = legalMoves.includes('reveal');
  useEffect(() => { if (canReveal) onMove('reveal'); }, [canReveal, onMove]);

  const meWon = resolved && myRoll != null && oppRoll != null && myRoll > oppRoll;
  const oppWon = resolved && myRoll != null && oppRoll != null && oppRoll > myRoll;

  return (
    <div data-testid="hub-board" className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-2xl bg-surface p-6">
      <span className="text-3xl" aria-hidden="true">🎲</span>
      <div className="flex w-full items-stretch gap-3">
        <RollSlot label="You" roll={myRoll} spinning={!resolved} win={meWon} />
        <RollSlot label="Opponent" roll={oppRoll} spinning={!resolved} win={oppWon} />
      </div>
      <p data-testid="dice-status" className="text-xs font-medium text-muted-foreground">
        {resolved ? (meWon ? 'You rolled higher!' : oppWon ? 'Opponent rolled higher' : 'Tie') : 'Rolling…'}
      </p>
    </div>
  );
}

function DicePanel(args: GameAreaArgs) {
  return args.phase === 'in-match' ? <DiceBoard {...args} /> : <DiceIdle phase={args.phase} />;
}

/** Result reveal: the two independent rolls, side by side (the simultaneous reveal). */
function DiceReveal({ gameState, playerId }: { outcome: Outcome; gameState: GameView | null; playerId: string | null }) {
  const view = gameState as DiceView | null;
  if (!view?.result || !playerId) return null;
  const opp = view.players.find((p) => p !== playerId);
  const mine = view.result.rolls[playerId];
  const theirs = opp ? view.result.rolls[opp] : undefined;
  return (
    <div className="mb-3 flex items-center justify-center gap-4" data-testid="hub-result-dice">
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">You</p>
        <p className="text-2xl font-black tabular-nums text-foreground">{mine != null ? fmtRoll(mine) : '—'}</p>
      </div>
      <span className="text-xs font-black text-muted-foreground">VS</span>
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Opponent</p>
        <p className="text-2xl font-black tabular-nums text-foreground">{theirs != null ? fmtRoll(theirs) : '—'}</p>
      </div>
    </div>
  );
}

/**
 * Dice Hub = the shared GameHub + the independent-roll area: each player auto-rolls one number
 * 0.00–99.99 from their OWN seed, higher wins. No decisions, no timer. The rolls, the seeds and the
 * resolution are all server-authoritative and hidden until the simultaneous reveal. See docs/DICE.md.
 */
export function DiceHubScreen(props: GameHubScreenProps) {
  return <GameHub gameId="dice" gameName="Dice" renderGameArea={DicePanel} renderResultReveal={DiceReveal} holdResultMs={HOLD_MS} {...props} />;
}
