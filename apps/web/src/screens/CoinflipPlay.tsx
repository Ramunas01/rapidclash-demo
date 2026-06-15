import type { CoinflipView } from '../App.js';

const SIDES = [
  { id: 'heads', emoji: '🪙', label: 'Heads' },
  { id: 'tails', emoji: '🪙', label: 'Tails' },
] as const;

interface Props {
  playerId: string;
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  opponentId: string;
  gameState: CoinflipView | null;
  legalMoves: string[];
  onMove(move: string): void;
  onForfeit(): void;
}

function sideLabel(side: string | undefined): string {
  return SIDES.find(s => s.id === side)?.label ?? '?';
}

export function CoinflipPlayScreen({
  playerId,
  username,
  opponentId: _opponentId,
  gameState,
  legalMoves,
  onMove,
  onForfeit,
}: Props) {
  const canMove = legalMoves.length > 0;
  const isCaller = gameState != null && playerId === gameState.caller;
  const call = gameState?.call;
  const result = gameState?.result;

  // Terminal = the server has revealed the flip, or the match was forced (forfeit/void).
  // The flip `result` is PRESENT ONLY at terminal — pre-terminal viewFor strips it, so
  // its mere presence is the reveal signal. NEVER infer or render it before then.
  const isTerminal =
    gameState != null && (result !== undefined || gameState.forcedOutcome !== undefined);

  return (
    <div className="screen">
      <h1>Coinflip</h1>
      {username && (
        <p style={{ textAlign: 'center', color: 'var(--muted)', marginBottom: 8 }} data-testid="play-you">
          You (<strong>{username}</strong>)
        </p>
      )}

      {/* The coin. Suspense (spinning ?) until the server includes `result` at terminal. */}
      <div className="card" style={{ textAlign: 'center', padding: '24px 0' }}>
        {isTerminal && result ? (
          <>
            <div style={{ fontSize: '3rem' }} aria-hidden>🪙</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }} data-testid="flip-result">
              {sideLabel(result)}
            </div>
          </>
        ) : (
          <>
            <div className="coin-spin" style={{ fontSize: '3rem' }} aria-hidden>🪙</div>
            <div style={{ fontSize: '1.5rem', color: 'var(--muted)' }} data-testid="flip-result">
              ?
            </div>
          </>
        )}
      </div>

      {/* The call is PUBLIC once made — show it to both players. */}
      {call && (
        <p style={{ textAlign: 'center', margin: '12px 0' }} data-testid="call-status">
          {isCaller ? 'You called ' : 'Opponent called '}
          <strong>{sideLabel(call)}</strong>
        </p>
      )}

      {isCaller ? (
        <div className="rps-grid" role="group" aria-label="Coin call">
          {SIDES.map(({ id, emoji, label }) => (
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
      ) : (
        !isTerminal && (
          <p
            style={{ textAlign: 'center', color: 'var(--muted)', margin: '16px 0' }}
            data-testid="waiting"
          >
            Waiting for opponent to call…
          </p>
        )
      )}

      {/* Caller has called but the flip hasn't landed yet (resume edge). */}
      {isCaller && call && !isTerminal && (
        <p style={{ textAlign: 'center', color: 'var(--muted)', margin: '8px 0' }}>
          Flipping…
        </p>
      )}

      {!isTerminal && (
        <button className="btn btn-ghost" onClick={onForfeit} style={{ marginTop: 'auto' }}>
          Forfeit
        </button>
      )}
    </div>
  );
}
