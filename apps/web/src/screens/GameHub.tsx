import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Coins, Trophy, X } from 'lucide-react';
import type { GameMeta, OpenChallenge, Outcome, SettlementSummary, LeaderboardEntry } from '@rapidclash/shared';
import type { GameView } from '../App.js';
import { api } from '../api.js';
import { formatCredits, formatClock } from '../format.js';
import { formatStat } from './Leaderboard.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import rivalBanner from '../assets/banners/banner-Bring-the-rival.png';
import coinflipArt from '../assets/games/coinflip.webp';
import rpsArt from '../assets/games/rps.webp';
import chessArt from '../assets/games/chess.webp';
import blackjackArt from '../assets/games/blackjack.webp';
import minesArt from '../assets/games/mines.webp';

/** Bet presets within the shared 1–100 demo range (every demo game's BetRules). Rendered ¢. */
const BET_PRESETS = [1, 5, 10, 25, 50, 100];
const MAX_STAKE = 100;

/** Per-game tile art for the related-games rail (only registered PvP games appear). */
const TILE_ART: Record<string, string> = {
  coinflip: coinflipArt, rps: rpsArt, chess: chessArt, blackjack: blackjackArt, mines: minesArt,
};

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
  challenges: OpenChallenge[];
  challengeNotice: string | null;
  onPlay(stake: number): void;
  onCancel(): void;
  onRepost(): void;
  onTakeChallenge(matchId: string): void;
  onMakeMove(move: string): void;
  onForfeit(): void;
  onSubscribe(): void;
  onUnsubscribe(): void;
  onSelectGame(meta: GameMeta): void;
  onOpenWallet(): void;
  onOpenGameList(): void;
  /** Reset App's result state when the hub's result overlay dismisses (back to Idle). */
  onResultDismiss(): void;
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
 * GameHub — the COINFLIP_HUB pattern generalized (HUB_TRANSITION_ANALYSIS): a reusable
 * one-screen Game hub parameterized by game. It owns the generic parts — the sticky chrome,
 * the in-place state machine (Idle → Waiting → In-match → Result over the WS events the App
 * already feeds it), and the generic sections (bet selector, PLAY, open-challenges, related
 * games, recent clashes, result overlay, footer). The game-specific in-match UI is supplied
 * as the `renderGameArea` slot; an optional `renderResultReveal` adds a game-specific reveal
 * to the result overlay. The mechanic, WS flow, state-machine semantics and server-authoritative
 * redaction are unchanged — this is a presentation refactor.
 */
export function GameHub(props: GameHubProps) {
  const {
    gameId, gameName, renderGameArea, renderResultReveal,
    token, playerId, username, opponentId, balance, currentMatchId, gameState, legalMoves,
    waitingExpiresAt, lobbyExpired, lastOutcome, lastSettlement, challenges, challengeNotice,
    onPlay, onCancel, onRepost, onTakeChallenge, onMakeMove, onForfeit, onSubscribe,
    onUnsubscribe, onSelectGame, onOpenWallet, onOpenGameList, onResultDismiss,
  } = props;

  // ── Live wallet balance ─────────────────────────────────────────────────────
  // App owns the balance (updates it on match.end), but on a mid-match reload App's value
  // starts cold, so refetch once on mount and otherwise mirror the prop (settlements).
  const [liveBalance, setLiveBalance] = useState(balance);
  useEffect(() => { setLiveBalance(balance); }, [balance]);
  useEffect(() => {
    let alive = true;
    api.wallet(token).then((w) => { if (alive) setLiveBalance(w.balance); }).catch(() => {});
    return () => { alive = false; };
  }, [token]);

  // ── Sub-state machine ──────────────────────────────────────────────────────
  const [waiting, setWaiting] = useState(false);
  const [overlay, setOverlay] = useState<{ outcome: Outcome; settlement: SettlementSummary; revealState: GameView | null } | null>(null);
  const prevMatch = useRef(currentMatchId);

  // Match start/end edges: derive in-match / result from currentMatchId transitions.
  useEffect(() => {
    const prev = prevMatch.current;
    prevMatch.current = currentMatchId;
    if (currentMatchId && !prev) {
      // a match just started — supersede any waiting/overlay
      setOverlay(null);
      setWaiting(false);
    } else if (!currentMatchId && prev) {
      // a match we were in just ended — show the result overlay (payoff lands wherever scrolled)
      if (lastOutcome && lastSettlement) {
        setOverlay({ outcome: lastOutcome, settlement: lastSettlement, revealState: gameState });
      }
      setWaiting(false);
    }
  }, [currentMatchId, lastOutcome, lastSettlement, gameState]);

  // The server confirmed our resting bet (queue.waiting) → enter Waiting.
  useEffect(() => {
    if (waitingExpiresAt != null) setWaiting(true);
  }, [waitingExpiresAt]);

  const phase: Phase = overlay ? 'result' : currentMatchId ? 'in-match' : waiting ? 'waiting' : 'idle';

  function dismissResult() {
    setOverlay(null);
    setWaiting(false);
    onResultDismiss();
  }

  // ── Bet selection ──────────────────────────────────────────────────────────
  const [armedStake, setArmedStake] = useState<number | null>(null);

  function handlePlay() {
    if (armedStake == null) return;
    onPlay(armedStake);
  }
  function handleCancel() {
    setWaiting(false);
    onCancel();
  }

  // ── Open-challenge feed (subscribe while the hub is mounted) ─────────────────
  useEffect(() => {
    onSubscribe();
    return () => onUnsubscribe();
    // eslint-disable-next-line -- subscribe/unsubscribe exactly once per hub visit
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <HubRibbon balance={liveBalance} onLogo={onOpenGameList} onWallet={onOpenWallet} />

      <main className="flex-1 overflow-y-auto" data-testid="hub-body">
        <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
          {/* 1 — Game area (per-game slot). Greyed in Idle/Waiting; live board In-match. */}
          <section data-testid="hub-section-game" aria-label={gameName} className="rounded-2xl border border-border bg-card p-4">
            {renderGameArea({ phase, gameState, legalMoves, onMove: onMakeMove, onForfeit, playerId, opponentId, username })}
          </section>

          {/* "stake & play" block: Idle → bet + PLAY; Waiting → countdown + cancel/re-post. */}
          {(phase === 'idle' || phase === 'waiting') && (
            <div className="flex flex-col gap-3">
              {phase === 'waiting' ? (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <WaitingBlock expiresAt={waitingExpiresAt} expired={lobbyExpired} onCancel={handleCancel} onRepost={onRepost} />
                </div>
              ) : (
                <>
                  {/* 2 — BET AMOUNT selector. */}
                  <div data-testid="hub-section-bet" className="rounded-2xl bg-surface p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Bet amount</span>
                      <span className="text-sm font-extrabold tabular-nums text-foreground">
                        {armedStake == null ? `max ${formatCredits(MAX_STAKE)}` : formatCredits(armedStake)}
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
                            armedStake === v
                              ? 'bg-brand text-white'
                              : 'bg-background text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {formatCredits(v)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3 — PLAY button (export green); posts your armed stake as an open challenge. */}
                  <button
                    type="button"
                    disabled={armedStake == null}
                    onClick={handlePlay}
                    data-testid="hub-play"
                    className={cn(
                      'w-full rounded-2xl py-4 text-base font-black uppercase tracking-wider transition-colors',
                      armedStake == null
                        ? 'cursor-not-allowed bg-play/30 text-white/50'
                        : 'bg-play text-background hover:brightness-105',
                    )}
                  >
                    Play
                  </button>
                  <p className="text-center text-[11px] text-muted-foreground">
                    {armedStake == null ? 'Select a bet to enable' : `Posts a ${formatCredits(armedStake)} challenge for another player to join`}
                  </p>
                </>
              )}
            </div>
          )}

          {/* 4 — Open challenges. */}
          <HubOpenChallenges
            entries={challenges}
            notice={challengeNotice}
            balance={liveBalance}
            joinDisabled={phase !== 'idle'}
            onTake={onTakeChallenge}
          />

          {/* 5 — Related games (PvP-only, data-driven from /games). */}
          <HubRelatedGames token={token} currentGameId={gameId} onSelectGame={onSelectGame} />

          {/* 6 — "Bring the rival" banner (static). */}
          <section data-testid="hub-section-rival" aria-label="Bring a rival">
            <img src={rivalBanner} alt="Bring a rival — challenge a friend" className="w-full rounded-2xl" />
          </section>

          {/* 7 — RECENT CLASHES (this game's leaderboard). Refreshes when a match ends. */}
          <HubRecentClashes token={token} gameId={gameId} refreshKey={currentMatchId ?? 'idle'} />

          {/* 8 — Footer (sanitized text; the supplied bottom banner art is contaminated). */}
          <footer data-testid="hub-section-footer" className="border-t border-border pt-4 pb-2 text-center">
            <p className="text-xs font-semibold text-foreground/70">Players vs Players — never the house.</p>
            <p className="mt-1 text-[11px] text-muted-foreground">Play-money demo · credits only, no real-world value.</p>
          </footer>
        </div>
      </main>

      <HubToolbar onGames={onOpenGameList} onAccount={onOpenWallet} />

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

/** §4 — resting challenges with per-row JOIN (takes the OWNER's stake). */
function HubOpenChallenges({
  entries, notice, balance, joinDisabled, onTake,
}: {
  entries: OpenChallenge[];
  notice: string | null;
  balance: number;
  joinDisabled: boolean;
  onTake(matchId: string): void;
}) {
  const now = useNow(true);
  const [localNotice, setLocalNotice] = useState<string | null>(null);

  function handleJoin(e: OpenChallenge) {
    // Balance-check before claiming — refuse clearly rather than fail silently.
    if (balance < e.stake) {
      setLocalNotice(`Not enough credits to join — needs ${formatCredits(e.stake)}, you have ${formatCredits(balance)}.`);
      return;
    }
    setLocalNotice(null);
    onTake(e.matchId);
  }

  return (
    <section data-testid="hub-section-challenges" aria-label="Open challenges" className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Open games</h2>
        <span className="ml-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-success">
          <span className="h-1.5 w-1.5 rounded-full bg-success" /> Live
        </span>
      </div>
      {(notice || localNotice) && (
        <div role="alert" data-testid="hub-challenge-notice" className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {localNotice ?? notice}
        </div>
      )}
      {entries.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">No one waiting yet — press PLAY to post the first challenge.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const remaining = e.expiresAt - now;
            return (
              <div
                key={e.matchId}
                data-testid={`hub-challenge-${e.matchId}`}
                className="flex items-center gap-3 rounded-xl bg-surface p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{e.ownerName}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-brand">
                    <Coins className="h-3.5 w-3.5" />
                    <span className="text-sm font-bold" data-testid={`hub-stake-${e.matchId}`}>{formatCredits(e.stake)}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">· {formatClock(remaining)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleJoin(e)}
                  disabled={joinDisabled}
                  data-testid={`hub-join-${e.matchId}`}
                  aria-label={`Join ${e.ownerName}'s ${e.stake} credit challenge`}
                  className={cn(
                    'rounded-full px-5 py-2 text-sm font-extrabold uppercase tracking-wide transition-colors',
                    joinDisabled ? 'cursor-not-allowed bg-white/5 text-white/30' : 'bg-play text-background hover:brightness-105',
                  )}
                >
                  Join
                </button>
              </div>
            );
          })}
        </div>
      )}
      {joinDisabled && entries.length > 0 && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">One match at a time — finish or cancel your current bet to join another.</p>
      )}
    </section>
  );
}

/** §5 — related games, data-driven from /games (only registered PvP games come back). */
function HubRelatedGames({ token, currentGameId, onSelectGame }: { token: string; currentGameId: string; onSelectGame(meta: GameMeta): void }) {
  const [games, setGames] = useState<GameMeta[]>([]);
  useEffect(() => {
    let alive = true;
    api.games(token).then((g) => { if (alive && Array.isArray(g)) setGames(g); }).catch(() => {});
    return () => { alive = false; };
  }, [token]);

  const others = games.filter((g) => g.id !== currentGameId);
  return (
    <section data-testid="hub-section-related" aria-label="Related games" className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">Related games</h2>
      {others.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">More PvP games coming soon.</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
          {others.map((g) => {
            const art = TILE_ART[g.id];
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onSelectGame(g)}
                data-testid={`hub-related-${g.id}`}
                aria-label={g.displayName}
                className="group relative aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-xl bg-surface ring-1 ring-border transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {art ? (
                  <img src={art} alt={g.displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-brand/30 to-indigo-900/40">
                    <span className="text-2xl font-black text-foreground/80">{g.displayName.charAt(0)}</span>
                    <span className="px-1 text-center text-[10px] font-bold uppercase tracking-wide text-foreground">{g.displayName}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** §7 — this game's leaderboard, embedded. Reuses formatStat (kind-aware: win_rate / net_winnings / elo). */
function HubRecentClashes({ token, gameId, refreshKey }: { token: string; gameId: string; refreshKey: string }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  useEffect(() => {
    let alive = true;
    api.leaderboard(gameId, token).then((e) => { if (alive && Array.isArray(e)) setEntries(e); }).catch(() => {});
    return () => { alive = false; };
    // refreshKey changes when a match starts/ends so the board reflects fresh settlements.
  }, [token, gameId, refreshKey]);

  return (
    <section data-testid="hub-section-clashes" aria-label="Recent clashes" className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">Recent clashes</h2>
      {entries.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">No matches yet — play to claim the top spot.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.slice(0, 5).map((e) => (
            <div key={e.playerId} data-testid={`hub-clash-${e.playerId}`} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2">
              <span className="w-5 text-center text-sm font-bold text-muted-foreground">{e.rank}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{e.displayName}</span>
              <span className="text-sm font-bold tabular-nums text-foreground/80">{formatStat(e)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
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
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 px-6 backdrop-blur-sm"
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
