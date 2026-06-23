import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Trophy, X } from 'lucide-react';
import type { GameMeta, OpenChallenge, Outcome, SettlementSummary } from '@rapidclash/shared';
import type { GameView } from '../App.js';
import { api } from '../api.js';
import { formatCredits, formatClock } from '../format.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { HUB_SHELL, HUB_BODY } from '../components/hub-chrome/layout.js';
import { TILE_ART, COMING_SOON, titleCase } from '../components/hub-shared/tiles.js';
import { OpenGamesTicker } from '../components/hub-shared/OpenGames.js';
import { BringARival } from '../components/hub-shared/BringARival.js';
import { HubFooter } from '../components/hub-shared/HubFooter.js';

/** Bet presets within the shared 1–100 demo range (every demo game's BetRules). Rendered ¢. */
const BET_PRESETS = [1, 5, 10, 25, 50, 100];

export type Phase = 'idle' | 'waiting' | 'in-match' | 'result';

/** Args the per-game play-panel slot receives — everything it needs to render the in-match
 *  (and greyed-idle) game area while preserving server-authoritative redaction. */
export interface GameAreaArgs {
  phase: Phase;
  gameState: GameView | null;
  legalMoves: string[];
  onMove(move: string): void;
  onForfeit(): void;
  playerId: string | null;
  opponentId: string | null;
  username: string | null;
}

/** The generic, per-game-agnostic props the App feeds every Game hub (Coinflip, RPS, …). */
export interface GameHubScreenProps {
  token: string;
  playerId: string | null;
  username: string | null;
  opponentId: string | null;
  /** Live balance from the app (source of truth; updates on match.end settlement). */
  balance: number;
  currentMatchId: string | null;
  gameState: GameView | null;
  legalMoves: string[];
  waitingExpiresAt: number | null;
  lobbyExpired: boolean;
  lastOutcome: Outcome | null;
  lastSettlement: SettlementSummary | null;
  /** Cross-game open challenges, keyed by gameId (App aggregates every game's feed) — the hub's
   *  Open Games ticker shows them all, not just this game's (owner decision D2). */
  challengesByGame: Record<string, OpenChallenge[]>;
  /** Post a challenge at `stake`. `timeControlId` is supplied for games that declare a
   *  time control (chess); omitted for the rest (the App maps it to 'none'). */
  onPlay(stake: number, timeControlId?: string): void;
  onCancel(): void;
  onRepost(): void;
  onTakeChallenge(matchId: string): void;
  onMakeMove(move: string): void;
  onForfeit(): void;
  /** Subscribe/unsubscribe to EVERY game's feed (cross-game ticker). App wraps the WS calls. */
  onTrackChallenges(gameIds: string[]): void;
  onUntrackChallenges(): void;
  onSelectGame(meta: GameMeta): void;
  onOpenWallet(): void;
  onOpenGameList(): void;
  /** Reset App's result state when the hub's result overlay dismisses (back to Idle). */
  onResultDismiss(): void;
  /** Logged out → no wallet/feed (auth-required); browsing the board + picking a bet stay open.
   *  The auth wall fires in the App at PLAY/JOIN. Default true. */
  loggedIn?: boolean;
  /** Pre-arm the bet selector (the join-fallback drops the user here ready to post). */
  initialStake?: number;
}

interface GameHubProps extends GameHubScreenProps {
  /** The game this hub instance is for — drives the title, related-games filter, and board. */
  gameId: string;
  gameName: string;
  /** The in-match (and greyed-idle) game area, provided per game. */
  renderGameArea(args: GameAreaArgs): ReactNode;
  /** Optional game-specific reveal at the top of the result overlay (e.g. the Coinflip coin). */
  renderResultReveal?(args: { outcome: Outcome; gameState: GameView | null; playerId: string | null }): ReactNode;
}

/** A 1s ticking clock for countdowns (cosmetic; expiry is server-authoritative). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * GameHub — the COINFLIP_HUB pattern generalized (HUB_TRANSITION_ANALYSIS), revised to the
 * Start_Building_Frame: opponent/own slot pills wrap the per-game arena, a unified play panel
 * (PLAY + bet grid + time control + Play-a-Friend), the cross-game Open Games ticker, a
 * related-games rail (all games, coming-soon included), the Bring-a-Rival card and the shared
 * footer. Owns the generic chrome + the in-place state machine (Idle → Waiting → In-match →
 * Result over the App's WS events). The mechanic, WS flow, and server-authoritative redaction
 * are unchanged — presentation only.
 */
export function GameHub(props: GameHubProps) {
  const {
    gameId, gameName, renderGameArea, renderResultReveal,
    token, playerId, username, opponentId, balance, currentMatchId, gameState, legalMoves,
    waitingExpiresAt, lobbyExpired, lastOutcome, lastSettlement, challengesByGame,
    onPlay, onCancel, onRepost, onTakeChallenge, onMakeMove, onForfeit, onTrackChallenges,
    onUntrackChallenges, onSelectGame, onOpenWallet, onOpenGameList, onResultDismiss,
    loggedIn = true, initialStake,
  } = props;

  // ── Live wallet balance ─────────────────────────────────────────────────────
  const [liveBalance, setLiveBalance] = useState(balance);
  useEffect(() => { setLiveBalance(balance); }, [balance]);
  useEffect(() => {
    if (!loggedIn) return; // wallet is auth-only; logged out shows the "Sign in" chip
    let alive = true;
    api.wallet(token).then((w) => { if (alive) setLiveBalance(w.balance); }).catch(() => {});
    return () => { alive = false; };
  }, [token, loggedIn]);

  // ── Games roster (drives the time control, related rail, and feed labels) ─────
  const [games, setGames] = useState<GameMeta[]>([]);
  useEffect(() => {
    let alive = true;
    api.games(token).then((g) => { if (alive && Array.isArray(g)) setGames(g); }).catch(() => {});
    return () => { alive = false; };
  }, [token]);
  const nameByGame = useMemo(() => new Map(games.map((g) => [g.id, g.displayName])), [games]);
  const timeControl = games.find((g) => g.id === gameId)?.timeControl;
  const [selectedControl, setSelectedControl] = useState<string | undefined>(undefined);
  useEffect(() => { setSelectedControl(timeControl?.defaultId); }, [timeControl?.defaultId]);

  // Cross-game ticker: subscribe to every game's feed while the hub is mounted (authed only).
  const gameKey = games.map((g) => g.id).join(',');
  useEffect(() => {
    if (!loggedIn || games.length === 0) return;
    onTrackChallenges(games.map((g) => g.id));
    return () => onUntrackChallenges();
    // eslint-disable-next-line -- track once per game-set change (callbacks are stable)
  }, [gameKey, loggedIn]);

  // ── Sub-state machine ──────────────────────────────────────────────────────
  const [waiting, setWaiting] = useState(false);
  const [overlay, setOverlay] = useState<{ outcome: Outcome; settlement: SettlementSummary; revealState: GameView | null } | null>(null);
  const prevMatch = useRef(currentMatchId);

  useEffect(() => {
    const prev = prevMatch.current;
    prevMatch.current = currentMatchId;
    if (currentMatchId && !prev) {
      setOverlay(null);
      setWaiting(false);
    } else if (!currentMatchId && prev) {
      if (lastOutcome && lastSettlement) {
        setOverlay({ outcome: lastOutcome, settlement: lastSettlement, revealState: gameState });
      }
      setWaiting(false);
    }
  }, [currentMatchId, lastOutcome, lastSettlement, gameState]);

  useEffect(() => {
    if (waitingExpiresAt != null) setWaiting(true);
  }, [waitingExpiresAt]);

  const phase: Phase = overlay ? 'result' : currentMatchId ? 'in-match' : waiting ? 'waiting' : 'idle';

  function dismissResult() {
    setOverlay(null);
    setWaiting(false);
    onResultDismiss();
  }

  // ── Bet + time-control selection ────────────────────────────────────────────
  const [armedStake, setArmedStake] = useState<number | null>(initialStake ?? null);

  function handlePlay() {
    if (armedStake == null) return;
    if (timeControl) onPlay(armedStake, selectedControl);
    else onPlay(armedStake);
  }
  function handleCancel() {
    setWaiting(false);
    onCancel();
  }

  // The related rail spans the whole roster (live + coming-soon), minus this game (D2/item 5).
  const related = useMemo(() => {
    const live = new Set(games.map((g) => g.id));
    const playable = games.map((g) => ({ id: g.id, name: g.displayName, playable: true, meta: g as GameMeta }));
    const soon = COMING_SOON.filter((id) => !live.has(id)).map((id) => ({ id, name: titleCase(id), playable: false, meta: undefined }));
    return [...playable, ...soon].filter((t) => t.id !== gameId);
  }, [games, gameId]);

  const opponentInMatch = phase === 'in-match' || phase === 'result';

  return (
    <div className={HUB_SHELL}>
      <HubRibbon balance={loggedIn ? liveBalance : null} onLogo={onOpenGameList} onWallet={onOpenWallet} loggedIn={loggedIn} />

      <main data-testid="hub-body">
        {/* No blanket px-4 — sections that need insetting add their own; the shared Open Games /
            Bring-a-Rival / footer render full-bleed to the max-w-md edge (they pad internally). */}
        <div className={cn('mx-auto flex w-full max-w-md flex-col gap-4', HUB_BODY)}>
          {/* 1 — Arena: opponent slot pill, the per-game board, the player's own slot pill.
              No grey card frame here — each panel owns its surface (Blackjack's green table
              fills the section; the other arenas wrap themselves in a card). */}
          <section data-testid="hub-section-game" aria-label={gameName} className="flex flex-col gap-3 px-4">
            <SlotPill kind="opponent" label={opponentInMatch ? 'Opponent' : 'Waiting for opponent'} />
            {renderGameArea({ phase, gameState, legalMoves, onMove: onMakeMove, onForfeit, playerId, opponentId, username })}
            <SlotPill kind="own" label={loggedIn ? (username || 'You') : 'Sign in'} />
          </section>

          {/* 3 — Unified play panel: PLAY + bet grid (+ time control) + Play a Friend.
              Idle → the panel; Waiting → countdown + cancel/re-post. */}
          {(phase === 'idle' || phase === 'waiting') && (
            <div className="px-4">
            {phase === 'waiting' ? (
              <div className="rounded-2xl border border-border bg-card p-4">
                <WaitingBlock expiresAt={waitingExpiresAt} expired={lobbyExpired} onCancel={handleCancel} onRepost={onRepost} />
              </div>
            ) : (
              <div data-testid="hub-section-play" className="flex flex-col gap-3.5 rounded-[18px] bg-surface p-4">
                {/* PLAY — purple; posts your armed stake as an open challenge. */}
                {/* Always full purple; the bet still gates the ACTION (disabled won't post). */}
                <button
                  type="button"
                  disabled={armedStake == null}
                  onClick={handlePlay}
                  data-testid="hub-play"
                  className="w-full rounded-xl bg-brand py-4 text-base font-black uppercase tracking-wider text-white transition-colors hover:brightness-110"
                >
                  Play
                </button>

                {/* Bet amount. */}
                <div data-testid="hub-section-bet">
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Bet amount</span>
                    <span className="text-sm font-extrabold tabular-nums text-foreground">
                      {armedStake == null ? '—' : formatCredits(armedStake)}
                    </span>
                  </div>
                  <div className="grid grid-cols-6 gap-2">
                    {BET_PRESETS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        data-testid={`hub-bet-${v}`}
                        onClick={() => setArmedStake(v)}
                        className={cn(
                          'rounded-lg py-2.5 text-center text-[13px] font-bold tabular-nums transition-colors',
                          armedStake === v ? 'bg-brand text-white' : 'bg-background text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {formatCredits(v)}
                      </button>
                    ))}
                  </div>

                  {/* Time-control picker — shown only for games that declare one (chess). */}
                  {timeControl && (
                    <div data-testid="hub-section-timecontrol" className="mt-4">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Time control</span>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {timeControl.options.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            data-testid={`hub-tc-${o.id}`}
                            aria-pressed={selectedControl === o.id}
                            onClick={() => setSelectedControl(o.id)}
                            className={cn(
                              'rounded-lg px-2 py-2 text-center text-[11px] font-bold leading-tight transition-colors',
                              selectedControl === o.id ? 'bg-brand text-white' : 'bg-background text-muted-foreground hover:text-foreground',
                            )}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Play a Friend — purple, inert/visual-only for now (owner decision D1). */}
                <button
                  type="button"
                  aria-disabled="true"
                  data-testid="hub-play-friend"
                  className="w-full cursor-default rounded-xl bg-brand py-3.5 text-[15px] font-bold text-white"
                >
                  Play a Friend
                </button>
              </div>
            )}
            </div>
          )}

          {/* 4 — Open Games (cross-game, all hubs). Authed → the live aggregate; logged out → a
              sign-in teaser (the WS feed is auth-only). JOIN a non-matching game → routed by the
              server's match.start gameId. */}
          {loggedIn ? (
            <OpenGamesTicker
              challengesByGame={challengesByGame}
              nameByGame={nameByGame}
              balance={liveBalance}
              onTake={onTakeChallenge}
              joinDisabled={phase !== 'idle'}
              emptyText="No open games right now — press PLAY to post the first."
            />
          ) : (
            <section data-testid="hub-section-challenges-teaser" aria-label="Open challenges" className="px-4">
              <div className="rounded-2xl border border-border bg-card p-4 text-center">
                <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-foreground">Open games</h2>
                <p className="text-xs text-muted-foreground">Sign in to see live games and join a match.</p>
                <button type="button" onClick={onOpenWallet} data-testid="hub-challenges-signin" className="mt-3 rounded-full bg-brand px-5 py-2 text-xs font-bold text-white transition-colors hover:brightness-105">
                  Sign in
                </button>
              </div>
            </section>
          )}

          {/* 5 — Related games rail: ALL games (coming-soon included), this game excluded. */}
          <RelatedRail related={related} onSelectGame={onSelectGame} />

          {/* 6 — Bring a Rival (shared with Home). */}
          <BringARival />

          {/* 8 — Footer (shared with Home: inert social row, seeded-RNG provably-fair, 18+). */}
          <HubFooter />
        </div>
      </main>

      <HubToolbar onGames={onOpenGameList} onAccount={onOpenWallet} active="games" />

      {overlay && (
        <ResultOverlay
          outcome={overlay.outcome}
          settlement={overlay.settlement}
          reveal={renderResultReveal?.({ outcome: overlay.outcome, gameState: overlay.revealState, playerId })}
          playerId={playerId ?? undefined}
          onDismiss={dismissResult}
        />
      )}
    </div>
  );
}

/** A person glyph for the slot pills (no alias is ever fabricated for the opponent). */
function PersonGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

/** Item 1 — the opponent slot (neutral, never an alias) above the board, and the player's own
 *  slot below it. Frame's SURFACE pills. */
function SlotPill({ kind, label }: { kind: 'opponent' | 'own'; label: string }) {
  const own = kind === 'own';
  return (
    <div
      data-testid={`hub-slot-${kind}`}
      className="flex items-center gap-2.5 rounded-full bg-surface px-3.5 py-2.5"
    >
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', own ? 'bg-brand text-white' : 'bg-[#2a2a4a] text-muted-foreground')}>
        <PersonGlyph className="h-[18px] w-[18px]" />
      </span>
      <span className={cn('truncate text-sm font-bold', own ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}

/** Waiting on your own resting bet: countdown + cancel; re-post when it expires. */
function WaitingBlock({
  expiresAt, expired, onCancel, onRepost,
}: {
  expiresAt: number | null;
  expired: boolean;
  onCancel(): void;
  onRepost(): void;
}) {
  const now = useNow(true);
  const remaining = expiresAt != null ? expiresAt - now : 0;
  return (
    <div className="flex flex-col items-center gap-3 py-2" data-testid="hub-waiting">
      {expired ? (
        <>
          <p className="text-sm font-semibold text-foreground/80">Challenge expired</p>
          <p className="text-xs text-muted-foreground">Your stake was refunded automatically.</p>
          <div className="flex w-full gap-2">
            <button type="button" onClick={onRepost} data-testid="hub-repost" className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white">
              Re-post
            </button>
            <button type="button" onClick={onCancel} className="flex-1 rounded-xl bg-surface py-2.5 text-sm font-semibold text-foreground/80">
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Waiting for an opponent
          </span>
          <p className="text-2xl font-bold tabular-nums text-foreground" data-testid="hub-waiting-countdown">{formatClock(remaining)}</p>
          <button type="button" onClick={onCancel} data-testid="hub-cancel" className="w-full rounded-xl bg-surface py-2.5 text-sm font-semibold text-foreground/80 transition-colors hover:brightness-110">
            Cancel
          </button>
        </>
      )}
    </div>
  );
}

/** Item 5 — related-games rail. No grey card; cards a touch larger than the home grid so the
 *  third peeks (signalling horizontal scroll). All games, coming-soon dimmed + non-playable. */
function RelatedRail({
  related, onSelectGame,
}: {
  related: { id: string; name: string; playable: boolean; meta?: GameMeta }[];
  onSelectGame(meta: GameMeta): void;
}) {
  if (related.length === 0) return null;
  return (
    <section data-testid="hub-section-related" aria-label="Related games">
      <h2 className="mb-3 px-4 text-sm font-bold uppercase tracking-wide text-foreground">Related games</h2>
      <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
        {related.map((t) =>
          t.playable && t.meta ? (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelectGame(t.meta!)}
              data-testid={`hub-related-${t.id}`}
              aria-label={t.name}
              className="group relative aspect-[2/3] w-36 shrink-0 overflow-hidden rounded-xl border border-border transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <RelatedArt id={t.id} name={t.name} />
            </button>
          ) : (
            <div
              key={t.id}
              aria-disabled="true"
              aria-label={`${t.name} — coming soon`}
              data-testid={`hub-related-${t.id}`}
              className="relative aspect-[2/3] w-36 shrink-0 overflow-hidden rounded-xl border border-border opacity-50"
            >
              <RelatedArt id={t.id} name={t.name} />
              <span className="absolute right-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wide text-white/80">Soon</span>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

function RelatedArt({ id, name }: { id: string; name: string }) {
  const art = TILE_ART[id];
  if (art) {
    return <img src={art} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />;
  }
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-brand/30 to-indigo-900/50">
      <span className="px-1 text-center text-sm font-black uppercase tracking-wide text-white/85">{name}</span>
    </div>
  );
}

/**
 * Brief, self-dismissing result overlay (spec Q2). Generic win/lose/draw + the ¢ settlement
 * delta (confetti on a win), with an optional game-specific reveal slot at the top.
 */
function ResultOverlay({
  outcome, settlement, reveal, playerId, onDismiss,
}: {
  outcome: Outcome;
  settlement: SettlementSummary;
  reveal?: ReactNode;
  playerId?: string;
  onDismiss(): void;
}) {
  const kind: 'win' | 'lose' | 'neutral' =
    outcome.type === 'draw' || outcome.type === 'void'
      ? 'neutral'
      : (playerId === undefined || outcome.winner === playerId) ? 'win' : 'lose';
  const text = outcome.type === 'draw' ? 'Draw! 🤝'
    : outcome.type === 'void' ? 'Match voided'
    : kind === 'win' ? 'You Won! 🏆' : 'You Lost 😔';
  const style = {
    win: 'border-success/40 bg-success/10 text-success',
    lose: 'border-destructive/40 bg-destructive/10 text-destructive',
    neutral: 'border-border bg-surface text-muted-foreground',
  }[kind];
  const delta = settlement.delta;

  useEffect(() => {
    if (kind === 'win') confetti({ particleCount: 110, spread: 75, origin: { y: 0.55 }, disableForReducedMotion: true });
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [kind, onDismiss]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm"
      role="dialog"
      aria-label="Match result"
      data-testid="hub-result-overlay"
      onClick={onDismiss}
    >
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-xs rounded-2xl border border-border bg-card p-6 text-center"
      >
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
        {reveal}
        <div className={cn('mb-3 rounded-xl border px-4 py-3 text-xl font-black', style)} data-testid="hub-result-text">
          <Trophy className={cn('mx-auto mb-1 h-6 w-6', kind !== 'win' && 'opacity-40')} />
          {text}
        </div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Wallet change</p>
        <div className={cn('text-2xl font-bold tabular-nums', delta > 0 ? 'text-success' : delta < 0 ? 'text-destructive' : 'text-foreground/80')} data-testid="hub-result-delta">
          {delta > 0 ? '+' : ''}{formatCredits(delta)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">New balance: <strong className="text-foreground">{formatCredits(settlement.newBalance)}</strong></p>
      </motion.div>
    </div>
  );
}
