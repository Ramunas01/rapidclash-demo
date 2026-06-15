import type { RpsView } from '../App.js';

const RPS_CHOICES = [
  { id: 'rock', emoji: '✊', label: 'Rock' },
  { id: 'paper', emoji: '✋', label: 'Paper' },
  { id: 'scissors', emoji: '✌️', label: 'Scissors' },
] as const;

interface Props {
  playerId: string;
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  opponentId: string;
  gameState: RpsView | null;
  legalMoves: string[];
  onMove(move: string): void;
  onForfeit(): void;
}

function getChoiceLabel(choice: string | undefined): string {
  return RPS_CHOICES.find(c => c.id === choice)?.emoji ?? '?';
}

export function PlayScreen({ playerId, username, opponentId, gameState, legalMoves, onMove, onForfeit }: Props) {
  const canMove = legalMoves.length > 0;
  const myChoice = gameState?.choices?.[playerId];

  // Terminal: both choices known or forcedOutcome set
  const isTerminal = gameState != null && (
    gameState.forcedOutcome !== undefined ||
    gameState.players.every(p => p in (gameState.choices ?? {}))
  );

  // Only show opponent's choice if terminal (server sends full state at terminal)
  const opponentChoice = isTerminal ? gameState?.choices?.[opponentId] : undefined;

  return (
    <div className="screen">
      <h1>Rock Paper Scissors</h1>

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', marginBottom: 4 }} data-testid="play-you">
            {username ? <>You (<strong>{username}</strong>)</> : 'You'}
          </p>
          <div style={{ fontSize: '2rem' }}>{myChoice ? getChoiceLabel(myChoice) : '—'}</div>
        </div>
        <div style={{ color: 'var(--muted)', fontWeight: 'bold' }}>VS</div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--muted)', marginBottom: 4 }}>Opponent</p>
          {/* NEVER show opponent choice until terminal */}
          <div style={{ fontSize: '2rem' }} data-testid="opponent-choice">
            {isTerminal && opponentChoice ? getChoiceLabel(opponentChoice) : '🤫'}
          </div>
        </div>
      </div>

      {myChoice && !isTerminal && (
        <p style={{ textAlign: 'center', color: 'var(--muted)', margin: '16px 0' }}>
          Waiting for opponent's move…
        </p>
      )}

      <div className="rps-grid" role="group" aria-label="RPS choices">
        {RPS_CHOICES.map(({ id, emoji, label }) => (
          <button
            key={id}
            className="rps-btn"
            onClick={() => onMove(id)}
            disabled={!canMove}
            aria-label={label}
            data-testid={`move-${id}`}
          >
            <span className="rps-emoji">{emoji}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {!isTerminal && (
        <button className="btn btn-ghost" onClick={onForfeit} style={{ marginTop: 'auto' }}>
          Forfeit
        </button>
      )}
    </div>
  );
}
