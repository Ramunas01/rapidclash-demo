import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { CoinflipView } from '../App.js';
import { GameHub, type GameHubScreenProps, type GameAreaArgs } from './GameHub.js';

/** Coin-face material gradients lifted from the export — these are the gold(heads)/
 *  silver(tails) coin surfaces, not palette tokens; the hidden coin uses the brand purple. */
const COIN_GOLD = 'linear-gradient(135deg, #c89b3c 0%, #f0c85a 50%, #a07020 100%)';
const COIN_SILVER = 'linear-gradient(135deg, #9aa0ad 0%, #c8ced8 50%, #7a8090 100%)';

const SIDES = [
  { id: 'heads', label: 'Heads', face: COIN_GOLD },
  { id: 'tails', label: 'Tails', face: COIN_SILVER },
] as const;

function sideLabel(side: string | undefined): string {
  return SIDES.find((s) => s.id === side)?.label ?? '?';
}

/**
 * The coin — the export's large gradient coin (gold heads / silver tails + glow), used across
 * the hub's state slots: dimmed in Idle, spinning + neutral (redacted `?`) In-match, and
 * revealed to the real face only at Result. It never shows the flip pre-terminal.
 */
function Coin({ face, spinning, dim }: { face?: string | null; spinning?: boolean; dim?: boolean }) {
  const isHeads = face === 'heads';
  const isTails = face === 'tails';
  const surface = isHeads ? COIN_GOLD : isTails ? COIN_SILVER : undefined;
  const glow = isHeads
    ? '0 0 55px rgba(200,155,60,0.45)'
    : isTails
      ? '0 0 55px rgba(154,160,173,0.4)'
      : '0 0 50px hsl(var(--primary) / 0.4)';
  return (
    <div className={cn('relative h-32 w-32', dim && 'opacity-50')} style={{ perspective: '800px' }}>
      <motion.div
        animate={spinning ? { rotateY: 360 } : { rotateY: 0 }}
        transition={spinning ? { repeat: Infinity, duration: 1, ease: 'linear' } : { duration: 0.4 }}
        aria-hidden
        className={cn(
          'flex h-32 w-32 items-center justify-center rounded-full',
          !surface && 'bg-gradient-to-br from-brand via-purple-600 to-indigo-800',
        )}
        style={{ ...(surface ? { background: surface } : {}), boxShadow: glow }}
      >
        <div className="flex h-[78%] w-[78%] items-center justify-center rounded-full border-[3px] border-white/20">
          {surface ? (
            <span className="text-sm font-extrabold uppercase tracking-wider text-white/85">{face}</span>
          ) : (
            <span className="text-5xl font-black text-white/40">?</span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** Greyed hero shown in Idle/Waiting — the visual anchor before a match activates it. */
function CoinflipIdle({ phase }: { phase: GameAreaArgs['phase'] }) {
  return (
    <div className="flex flex-col items-center gap-4 py-3">
      <Coin dim />
      <div className="grid w-full grid-cols-2 gap-3 opacity-50">
        {SIDES.map((s) => (
          <div key={s.id} className="flex items-center justify-center gap-2 rounded-xl bg-surface py-4 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            <span className="h-6 w-6 rounded-full" style={{ background: s.face }} aria-hidden="true" />
            {s.label}
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
 * The live in-match board. Pre-terminal only — the coin spins, your pick shows, the opponent
 * stays hidden (🤫). The terminal reveal happens in the result overlay at match.end, so this
 * never leaks the opponent's choice or the flip.
 */
function CoinflipBoard({ playerId, gameState, legalMoves, onMove, onForfeit }: GameAreaArgs) {
  const view = gameState as CoinflipView | null;
  const canMove = legalMoves.length > 0;
  const myChoice = playerId ? view?.choices?.[playerId] : undefined;
  return (
    <div className="flex flex-col items-center gap-4" data-testid="hub-board">
      {/* Coin spins, face hidden (redaction) until the result overlay. */}
      <Coin spinning />

      {/* Heads / Tails — the export's side selector, kept as our in-match both-choose pick. */}
      <div className="grid w-full grid-cols-2 gap-3" role="group" aria-label="Coin side">
        {SIDES.map(({ id, label, face }) => {
          const picked = myChoice === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onMove(id)}
              disabled={!canMove}
              aria-label={label}
              data-testid={`hub-move-${id}`}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-xl bg-surface py-4 text-[13px] font-extrabold uppercase tracking-wide outline-2 transition-all disabled:cursor-not-allowed disabled:opacity-40',
                picked ? 'text-success outline outline-success' : 'text-muted-foreground outline-transparent',
              )}
            >
              <span className="h-6 w-6 rounded-full" style={{ background: face }} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex w-full items-stretch justify-center gap-3 text-center">
        <div className="flex-1 rounded-xl bg-surface py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Your pick</p>
          <p className="text-sm font-semibold text-foreground" data-testid="hub-my-pick">{myChoice ? sideLabel(myChoice) : '—'}</p>
        </div>
        <div className="flex-1 rounded-xl bg-surface py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Opponent</p>
          {/* Redaction: never reveal the opponent's choice before match.end. */}
          <p className="text-sm font-semibold text-foreground" data-testid="hub-opponent-pick">🤫</p>
        </div>
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

/** The Coinflip game-area slot: greyed idle hero, or the live board in-match. */
function CoinflipPanel(args: GameAreaArgs) {
  return args.phase === 'in-match' ? <CoinflipBoard {...args} /> : <CoinflipIdle phase={args.phase} />;
}

/**
 * Coinflip Hub = the shared GameHub + a Coinflip play-panel (coin + heads/tails + redaction)
 * and a coin-reveal in the result overlay. The mechanic, WS flow, state machine and redaction
 * are unchanged. See docs/COINFLIP_HUB.md.
 */
export function CoinflipHubScreen(props: GameHubScreenProps) {
  return (
    <GameHub
      gameId="coinflip"
      gameName="Coinflip"
      renderGameArea={CoinflipPanel}
      renderResultReveal={({ gameState }) => {
        const result = (gameState as CoinflipView | null)?.result;
        return result ? (
          <div className="mb-3 flex justify-center" data-testid="hub-result-coin">
            <Coin face={result} />
          </div>
        ) : null;
      }}
      {...props}
    />
  );
}
