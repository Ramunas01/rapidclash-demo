import { cn } from '@/lib/utils';
import type { Outcome } from '@rapidclash/shared';
import type { RpsView, GameView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

const RPS_CHOICES = [
  { id: 'rock', emoji: '✊', label: 'Rock' },
  { id: 'paper', emoji: '✋', label: 'Paper' },
  { id: 'scissors', emoji: '✌️', label: 'Scissors' },
] as const;

function emojiFor(choice: string | undefined): string {
  return RPS_CHOICES.find((c) => c.id === choice)?.emoji ?? '?';
}

/** Greyed preview shown in Idle/Waiting — the three choices, dimmed. */
function RpsIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-3">
      <div className="grid w-full grid-cols-3 gap-3 opacity-50">
        {RPS_CHOICES.map((c) => (
          <div key={c.id} className="flex flex-col items-center gap-1 rounded-xl bg-surface py-4">
            <span className="text-3xl">{c.emoji}</span>
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{c.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/**
 * The live in-match board (lifts Play.tsx's choice UI). Pre-terminal only — your pick shows,
 * the opponent stays hidden (🤫); the terminal reveal happens in the result overlay at
 * match.end, so this never leaks the opponent's choice.
 */
function RpsBoard({ playerId, gameState, legalMoves, onMove, onForfeit, username }: GameAreaArgs) {
  const view = gameState as RpsView | null;
  const canMove = legalMoves.length > 0;
  const myChoice = playerId ? view?.choices?.[playerId] : undefined;
  return (
    <div className="flex flex-col items-center gap-4" data-testid="hub-board">
      {/* You — VS — Opponent (opponent hidden until the result overlay). */}
      <div className="flex w-full items-center justify-center gap-4">
        <div className="text-center">
          <div className={cn('flex h-20 w-20 items-center justify-center rounded-2xl border-2 text-4xl', myChoice ? 'border-brand/40 bg-brand/10' : 'border-border bg-surface')}>
            {myChoice ? emojiFor(myChoice) : '—'}
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground" data-testid="hub-my-pick">
            {username ? <>You (<strong className="text-foreground">{username}</strong>)</> : 'You'}
          </p>
        </div>
        <span className="text-sm font-black text-muted-foreground">VS</span>
        <div className="text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-border bg-surface text-4xl">
            {/* Redaction: never reveal the opponent's choice before match.end. */}
            <span data-testid="hub-opponent-pick">🤫</span>
          </div>
          <p className="mt-1.5 text-[11px] font-medium text-muted-foreground">Opponent</p>
        </div>
      </div>

      {/* Choice buttons — gated by server-issued legalMoves. */}
      <div className="grid w-full grid-cols-3 gap-3" role="group" aria-label="RPS choices">
        {RPS_CHOICES.map(({ id, emoji, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onMove(id)}
            disabled={!canMove}
            aria-label={label}
            data-testid={`hub-move-${id}`}
            className="flex flex-col items-center gap-1 rounded-xl bg-surface py-4 transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="text-3xl">{emoji}</span>
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
          </button>
        ))}
      </div>

      {myChoice && (
        <p className="text-center text-sm text-muted-foreground" data-testid="hub-locked">Locked in — waiting for opponent…</p>
      )}
      <button type="button" onClick={onForfeit} className="pt-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
        Forfeit
      </button>
    </div>
  );
}

/** The RPS game-area slot: greyed idle preview, or the live board in-match. */
function RpsPanel(args: GameAreaArgs) {
  // The arena owns its surface now (GameHub no longer wraps it in a grey card).
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      {args.phase === 'in-match' ? <RpsBoard {...args} /> : <RpsIdle phase={args.phase} />}
    </div>
  );
}

/** Result reveal: both choices, side by side (revealed by the server at terminal). */
function RpsReveal({ gameState, playerId }: { outcome: Outcome; gameState: GameView | null; playerId: string | null }) {
  const view = gameState as RpsView | null;
  if (!view || !playerId) return null;
  const opp = view.players.find((p) => p !== playerId);
  const mine = view.choices?.[playerId];
  const theirs = opp ? view.choices?.[opp] : undefined;
  if (!mine && !theirs) return null;
  return (
    <div className="mb-3 flex items-center justify-center gap-3" data-testid="hub-result-rps">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-3xl">{emojiFor(mine)}</span>
      <span className="text-xs font-black text-muted-foreground">VS</span>
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface text-3xl">{emojiFor(theirs)}</span>
    </div>
  );
}

/**
 * RPS Hub = the shared GameHub + an RPS play-panel (rock/paper/scissors + redaction) and a
 * both-choices reveal in the result overlay. RPS keeps its mechanic / WS flow / redaction.
 */
export function RpsHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="rps"
      gameName="Rock Paper Scissors"
      renderGameArea={RpsPanel}
      renderResultReveal={RpsReveal}
      {...props}
    />
  );
}
