import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Coins, Trophy, X } from 'lucide-react';
import type { GameMeta, OpenChallenge, Outcome, SettlementSummary, LeaderboardEntry } from '@rapidclash/shared';
import type { CoinflipView } from '../App.js';
import { api } from '../api.js';
import { formatCredits, formatClock } from '../format.js';
import { formatStat } from './Leaderboard.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import rivalBanner from '../assets/banners/banner-Bring-the-rival.png';

/** Coinflip's six presets, within the 1–100 stake range (rendered in ¢, never $). */
const BET_PRESETS = [1, 5, 10, 25, 50, 100];

const SIDES = [
  { id: 'heads', label: 'Heads', dot: 'bg-amber-400', face: 'from-amber-300 via-amber-500 to-amber-700' },
  { id: 'tails', label: 'Tails', dot: 'bg-indigo-400', face: 'from-indigo-400 via-indigo-500 to-indigo-700' },
] as const;

function sideLabel(side: string | undefined): string {
  return SIDES.find((s) => s.id === side)?.label ?? '?';
}

interface Props {
  token: string;
  playerId: string | null;
  username: string | null;
  opponentId: string | null;
  /** Live balance from the app (source of truth; updates on match.end settlement). */
  balance: number;
  // ── live match state owned by App, derived into the hub's sub-state here ──
  currentMatchId: string | null;
  gameState: CoinflipView | null;
  legalMoves: string[];
  waitingExpiresAt: number | null;
  lobbyExpired: boolean;
  lastOutcome: Outcome | null;
  lastSettlement: SettlementSummary | null;
  challenges: OpenChallenge[];
  challengeNotice: string | null;
  // ── callbacks (reuse App's existing WS-backed handlers) ──
  onPlay(stake: number): void;
  onCancel(): void;
  onRepost(): void;
  onTakeChallenge(matchId: string): void;
  onMakeMove(side: string): void;
  onForfeit(): void;
  onSubscribe(): void;
  onUnsubscribe(): void;
  onSelectGame(meta: GameMeta): void;
  onOpenWallet(): void;
  onOpenGameList(): void;
  /** Reset App's result state when the hub's result overlay dismisses (back to Idle). */
  onResultDismiss(): void;
}

type Phase = 'idle' | 'waiting' | 'in-match' | 'result';

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
 * Coinflip Hub — Part 2: the live one-screen flow.
 *
 * A small state machine over App's existing WS state (no route navigation): Idle → Waiting →
 * In-match → Result → Idle. App suppresses its setScreen() navigation while this screen is
 * active and feeds the same currentMatchId / gameState / legalMoves / waiting / outcome it
 * already holds. Redaction is preserved: the opponent's choice and the coin flip appear only
 * at match.end (the result overlay) — the in-match game area never reveals them. See
 * docs/COINFLIP_HUB.md.
 */
export function CoinflipHubScreen(props: Props) {
  const {
    token, playerId, opponentId, balance, currentMatchId, gameState, legalMoves,
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
  const [overlay, setOverlay] = useState<{ outcome: Outcome; settlement: SettlementSummary; result?: string } | null>(null);
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
        setOverlay({ outcome: lastOutcome, settlement: lastSettlement, result: gameState?.result });
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
    <div className="flex h-[100dvh] flex-col bg-[#0b0e18] text-white">
      <HubRibbon balance={liveBalance} onLogo={onOpenGameList} onWallet={onOpenWallet} />

      <main className="flex-1 overflow-y-auto" data-testid="hub-body">
        <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
          {/* 1 — Coinflip game area. Greyed in Idle/Waiting; live board In-match. */}
          <section data-testid="hub-section-game" aria-label="Coinflip" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            {phase === 'in-match' ? (
              <HubBoard
                playerId={playerId}
                opponentId={opponentId}
                gameState={gameState}
                legalMoves={legalMoves}
                onMove={onMakeMove}
                onForfeit={onForfeit}
              />
            ) : (
              <IdleGameArea phase={phase} />
            )}
          </section>

          {/* "stake & play" block: Idle → bet + PLAY; Waiting → countdown + cancel/re-post. */}
          {(phase === 'idle' || phase === 'waiting') && (
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              {phase === 'waiting' ? (
                <WaitingBlock expiresAt={waitingExpiresAt} expired={lobbyExpired} onCancel={handleCancel} onRepost={onRepost} />
              ) : (
                <>
                  {/* 2 — BET AMOUNT selector. */}
                  <div data-testid="hub-section-bet">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Bet amount</span>
                      <span className="text-[11px] text-white/40">max {formatCredits(100)}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {BET_PRESETS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          data-testid={`hub-bet-${v}`}
                          onClick={() => setArmedStake(v)}
                          className={cn(
                            'rounded-lg border py-2 text-center text-sm font-medium transition-colors',
                            armedStake === v
                              ? 'border-brand bg-brand/20 text-white'
                              : 'border-white/10 bg-white/5 text-white/70 hover:border-brand/40',
                          )}
                        >
                          {formatCredits(v)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3 — PLAY button (green); posts your armed stake as an open challenge. */}
                  <button
                    type="button"
                    disabled={armedStake == null}
                    onClick={handlePlay}
                    data-testid="hub-play"
                    className={cn(
                      'w-full rounded-xl py-3.5 text-base font-bold transition-colors',
                      armedStake == null
                        ? 'cursor-not-allowed bg-green-500/30 text-white/50'
                        : 'bg-green-500 text-[#08220f] hover:bg-green-400',
                    )}
                  >
                    PLAY
                  </button>
                  <p className="text-center text-[11px] text-white/30">
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
          <HubRelatedGames token={token} onSelectGame={onSelectGame} />

          {/* 6 — "Bring the rival" banner (static). */}
          <section data-testid="hub-section-rival" aria-label="Bring a rival">
            <img src={rivalBanner} alt="Bring a rival — challenge a friend" className="w-full rounded-2xl" />
          </section>

          {/* 7 — RECENT CLASHES (Coinflip leaderboard). Refreshes when a match ends. */}
          <HubRecentClashes token={token} refreshKey={currentMatchId ?? 'idle'} />

          {/* 8 — Footer (sanitized text; the supplied bottom banner art is contaminated). */}
          <footer data-testid="hub-section-footer" className="border-t border-white/5 pt-4 pb-2 text-center">
            <p className="text-xs font-medium text-white/50">Players vs Players — never the house.</p>
            <p className="mt-1 text-[11px] text-white/30">Play-money demo · credits only, no real-world value.</p>
          </footer>
        </div>
      </main>

      <HubToolbar onGames={onOpenGameList} onAccount={onOpenWallet} />

      {overlay && (
        <ResultOverlay
          outcome={overlay.outcome}
          settlement={overlay.settlement}
          coinResult={overlay.result}
          playerId={playerId ?? undefined}
          onDismiss={dismissResult}
        />
      )}
    </div>
  );
}

/** Greyed hero shown in Idle/Waiting — the visual anchor before a match activates it. */
function IdleGameArea({ phase }: { phase: Phase }) {
  return (
    <div className="flex flex-col items-center gap-4 py-4 opacity-50">
      <div className="flex h-28 w-28 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-yellow-300/30 to-yellow-600/20">
        <Coins className="h-12 w-12 text-yellow-300/70" aria-hidden="true" />
      </div>
      <div className="grid w-full grid-cols-2 gap-3">
        {SIDES.map((s) => (
          <div key={s.id} className="rounded-xl border border-white/10 bg-white/5 py-4 text-center text-sm font-bold tracking-wide">
            {s.label.toUpperCase()}
          </div>
        ))}
      </div>
      <p className="text-xs text-white/40">
        {phase === 'waiting' ? 'Waiting for an opponent…' : 'Choose a bet and press PLAY, or JOIN an open challenge'}
      </p>
    </div>
  );
}

/**
 * The live in-match board (reuses CoinflipPlay's logic/redaction). Pre-terminal only — the
 * coin spins, your pick shows, the opponent stays hidden (🤫). The terminal reveal happens
 * in the result overlay at match.end, so this never leaks the opponent's choice or the flip.
 */
function HubBoard({
  playerId, opponentId, gameState, legalMoves, onMove, onForfeit,
}: {
  playerId: string | null;
  opponentId: string | null;
  gameState: CoinflipView | null;
  legalMoves: string[];
  onMove(side: string): void;
  onForfeit(): void;
}) {
  const canMove = legalMoves.length > 0;
  const myChoice = playerId ? gameState?.choices?.[playerId] : undefined;
  return (
    <div className="flex flex-col items-center gap-3" data-testid="hub-board">
      <div className="relative h-28 w-28" style={{ perspective: '800px' }}>
        <motion.div
          animate={{ rotateY: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          aria-hidden
          className="flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 via-purple-600 to-indigo-800 text-5xl font-black text-white/40 shadow-[0_8px_28px_rgba(0,0,0,0.4)]"
        >
          ?
        </motion.div>
      </div>

      <div className="grid w-full grid-cols-2 gap-3" role="group" aria-label="Coin side">
        {SIDES.map(({ id, label, dot }) => {
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
                'flex items-center justify-center gap-2 rounded-xl border-2 bg-white/[0.03] py-4 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40',
                picked ? 'border-brand/60' : 'border-white/[0.08]',
              )}
            >
              {label}
              <span className={cn('h-2 w-2 rounded-full', dot)} />
            </button>
          );
        })}
      </div>

      <div className="flex w-full items-stretch justify-center gap-3 text-center">
        <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] py-2">
          <p className="text-[10px] uppercase tracking-wide text-white/40">Your pick</p>
          <p className="text-sm font-semibold text-white" data-testid="hub-my-pick">{myChoice ? sideLabel(myChoice) : '—'}</p>
        </div>
        <div className="flex-1 rounded-xl border border-white/10 bg-white/[0.03] py-2">
          <p className="text-[10px] uppercase tracking-wide text-white/40">Opponent</p>
          {/* Redaction: never reveal the opponent's choice before match.end. */}
          <p className="text-sm font-semibold text-white" data-testid="hub-opponent-pick">🤫</p>
        </div>
      </div>

      {myChoice && (
        <p className="text-center text-sm text-white/50" data-testid="hub-locked">Locked in — waiting for opponent…</p>
      )}
      <button type="button" onClick={onForfeit} className="pt-1 text-sm font-medium text-white/40 transition-colors hover:text-white/70">
        Forfeit
      </button>
      {/* opponentId referenced so a future reveal can use it; kept off-screen pre-terminal. */}
      <span hidden aria-hidden data-opponent={opponentId ?? ''} />
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
          <p className="text-sm font-semibold text-white/80">Challenge expired</p>
          <p className="text-xs text-white/50">Your stake was refunded automatically.</p>
          <div className="flex w-full gap-2">
            <button type="button" onClick={onRepost} data-testid="hub-repost" className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white">
              Re-post
            </button>
            <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-white/80">
              Back
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white/50">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" /> Waiting for an opponent
          </span>
          <p className="text-2xl font-bold tabular-nums text-white" data-testid="hub-waiting-countdown">{formatClock(remaining)}</p>
          <button type="button" onClick={onCancel} data-testid="hub-cancel" className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10">
            Cancel
          </button>
        </>
      )}
    </div>
  );
}

/** §4 — resting Coinflip challenges with per-row JOIN (takes the OWNER's stake). */
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
    <section data-testid="hub-section-challenges" aria-label="Open challenges" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-3 text-sm font-semibold text-white/80">Open challenges</h2>
      {(notice || localNotice) && (
        <div role="alert" data-testid="hub-challenge-notice" className="mb-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-red-300">
          {localNotice ?? notice}
        </div>
      )}
      {entries.length === 0 ? (
        <p className="py-2 text-center text-xs text-white/40">No one waiting yet — press PLAY to post the first challenge.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const remaining = e.expiresAt - now;
            return (
              <div
                key={e.matchId}
                data-testid={`hub-challenge-${e.matchId}`}
                className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{e.ownerName}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-brand">
                    <Coins className="h-3.5 w-3.5" />
                    <span className="text-sm font-bold" data-testid={`hub-stake-${e.matchId}`}>{formatCredits(e.stake)}</span>
                    <span className="text-[11px] text-white/40 tabular-nums">· {formatClock(remaining)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleJoin(e)}
                  disabled={joinDisabled}
                  data-testid={`hub-join-${e.matchId}`}
                  aria-label={`Join ${e.ownerName}'s ${e.stake} credit challenge`}
                  className={cn(
                    'rounded-lg px-4 py-2 text-sm font-bold transition-colors',
                    joinDisabled ? 'cursor-not-allowed bg-white/5 text-white/30' : 'bg-green-500 text-[#08220f] hover:bg-green-400',
                  )}
                >
                  JOIN
                </button>
              </div>
            );
          })}
        </div>
      )}
      {joinDisabled && entries.length > 0 && (
        <p className="mt-2 text-center text-[11px] text-white/30">One match at a time — finish or cancel your current bet to join another.</p>
      )}
    </section>
  );
}

/** §5 — related games, data-driven from /games (only registered PvP games come back). */
function HubRelatedGames({ token, onSelectGame }: { token: string; onSelectGame(meta: GameMeta): void }) {
  const [games, setGames] = useState<GameMeta[]>([]);
  useEffect(() => {
    let alive = true;
    api.games(token).then((g) => { if (alive && Array.isArray(g)) setGames(g); }).catch(() => {});
    return () => { alive = false; };
  }, [token]);

  const others = games.filter((g) => g.id !== 'coinflip');
  return (
    <section data-testid="hub-section-related" aria-label="Related games" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-3 text-sm font-semibold text-white/80">Related games</h2>
      {others.length === 0 ? (
        <p className="py-1 text-xs text-white/40">More PvP games coming soon.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {others.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelectGame(g)}
              data-testid={`hub-related-${g.id}`}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-gradient-to-br from-purple-600/30 to-indigo-900/30 p-3 text-left transition-colors hover:border-brand/40"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-base font-bold">
                {g.displayName.charAt(0)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{g.displayName}</p>
                <p className="text-[11px] text-white/40">{formatCredits(g.bet.minStake)}–{formatCredits(g.bet.maxStake)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** §7 — Coinflip leaderboard, embedded. Reuses formatStat (net_winnings in ¢, can be negative). */
function HubRecentClashes({ token, refreshKey }: { token: string; refreshKey: string }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  useEffect(() => {
    let alive = true;
    api.leaderboard('coinflip', token).then((e) => { if (alive && Array.isArray(e)) setEntries(e); }).catch(() => {});
    return () => { alive = false; };
    // refreshKey changes when a match starts/ends so the board reflects fresh settlements.
  }, [token, refreshKey]);

  return (
    <section data-testid="hub-section-clashes" aria-label="Recent clashes" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-3 text-sm font-semibold text-white/80">Recent clashes</h2>
      {entries.length === 0 ? (
        <p className="py-1 text-xs text-white/40">No matches yet — play to claim the top spot.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.slice(0, 5).map((e) => (
            <div key={e.playerId} data-testid={`hub-clash-${e.playerId}`} className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-3 py-2">
              <span className="w-5 text-center text-sm font-bold text-white/40">{e.rank}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{e.displayName}</span>
              <span className="text-sm font-bold tabular-nums text-white/80">{formatStat(e)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Brief, self-dismissing result overlay (spec Q2). Reveals coin + win/lose/draw + the ¢
 * settlement delta wherever the player has scrolled, confetti on a win, then dismisses to Idle.
 */
function ResultOverlay({
  outcome, settlement, coinResult, playerId, onDismiss,
}: {
  outcome: Outcome;
  settlement: SettlementSummary;
  coinResult?: string;
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
    win: 'border-green-500/40 bg-green-500/10 text-green-400',
    lose: 'border-red-500/40 bg-red-500/10 text-red-400',
    neutral: 'border-white/15 bg-white/[0.04] text-white/70',
  }[kind];
  const delta = settlement.delta;
  const face = SIDES.find((s) => s.id === coinResult);

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
        className="w-full max-w-xs rounded-2xl border border-white/10 bg-[#0b0e18] p-6 text-center"
      >
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-white/40 hover:text-white">
          <X className="h-4 w-4" />
        </button>
        {face && (
          <div className={cn('mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br text-3xl font-black text-white/80', face.face)} data-testid="hub-result-coin">
            {face.id === 'heads' ? 'H' : 'T'}
          </div>
        )}
        <div className={cn('mb-3 rounded-xl border px-4 py-3 text-xl font-black', style)} data-testid="hub-result-text">
          <Trophy className={cn('mx-auto mb-1 h-6 w-6', kind !== 'win' && 'opacity-40')} />
          {text}
        </div>
        <p className="text-xs font-medium uppercase tracking-wide text-white/40">Wallet change</p>
        <div className={cn('text-2xl font-bold tabular-nums', delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-white/80')} data-testid="hub-result-delta">
          {delta > 0 ? '+' : ''}{formatCredits(delta)}
        </div>
        <p className="mt-2 text-xs text-white/50">New balance: <strong className="text-white">{formatCredits(settlement.newBalance)}</strong></p>
      </motion.div>
    </div>
  );
}
