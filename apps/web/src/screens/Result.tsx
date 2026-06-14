import type { Outcome, SettlementSummary } from '@rapidclash/shared';

interface Props {
  outcome: Outcome;
  settlement: SettlementSummary;
  playerId?: string;
  onPlayAgain(): void;
  onLeaderboard(): void;
}

function outcomeText(outcome: Outcome, playerId?: string): { cls: string; text: string } {
  if (outcome.type === 'draw') return { cls: 'outcome-draw', text: 'Draw! 🤝' };
  if (outcome.type === 'void') return { cls: 'outcome-draw', text: 'Match voided' };
  // win: check if the current player is the winner
  const didWin = playerId === undefined || outcome.winner === playerId;
  if (didWin) return { cls: 'outcome-win', text: 'You Won! 🏆' };
  return { cls: 'outcome-lose', text: 'You Lost 😔' };
}

export function ResultScreen({ outcome, settlement, playerId, onPlayAgain, onLeaderboard }: Props) {
  const { cls, text } = outcomeText(outcome, playerId);
  const delta = settlement.delta;

  return (
    <div className="screen" style={{ alignItems: 'center' }}>
      <div className={cls} data-testid="outcome-text">{text}</div>
      <div className="card" style={{ width: '100%', textAlign: 'center', marginBottom: 24 }}>
        <p style={{ color: 'var(--muted)', marginBottom: 4 }}>Wallet change</p>
        <div style={{ fontSize: '2rem', fontWeight: 'bold' }} className={delta > 0 ? 'amount-pos' : delta < 0 ? 'amount-neg' : ''} data-testid="delta">
          {delta > 0 ? '+' : ''}{delta} credits
        </div>
        <p style={{ color: 'var(--muted)', marginTop: 8 }}>
          New balance: <strong>{settlement.newBalance.toLocaleString()}</strong> credits
        </p>
      </div>
      <button className="btn" onClick={onPlayAgain}>Play Again</button>
      <button className="btn btn-secondary" onClick={onLeaderboard}>Leaderboard</button>
    </div>
  );
}
