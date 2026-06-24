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

/** Two-line time-control labelling (data-driven from the meta option). The big line is the
 *  duration derived from `baseMs`; the small line is the mode name parsed from `"Name · X min"`. */
const tcDuration = (baseMs: number): string => {
  const mins = baseMs / 60_000;
  if (mins >= 1 && Number.isInteger(mins)) return `${mins} min`;
  const secs = Math.round(baseMs / 1_000);
  return `${secs} sec`;
};
const tcName = (label: string): string => label.split('·')[0]!.trim();

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
  /** Base budget (ms) of the currently selected time control, for games that declare one (chess).
   *  Lets a hub render the picked clock in the slot pills pre-match (before any server clock).
   *  Generic (derived from the meta) — undefined for games without a time control. */
  timeControlBaseMs?: number;
}

/** The generic, per-game-agnostic props the App feeds every Game hub (Coinflip, RPS, …). */
export interface GameHubScreenProps {
  token: string;
  playerId: string | null;
  username: string | null;
  opponentId: string | null;
  /** The real opponent's display name, known only when we JOINed their open challenge (the owner
   *  name from the feed). Null on the PLAY/post path (the joiner's name never reaches the client)
   *  → the slot falls back to a neutral "Opponent". Never a fabricated/cycled name (Charter #2). */
  opponentName?: string | null;
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
  /** Optional per-game content rendered right-aligned inside a slot pill, for the given side.
   *  Called for BOTH pills in EVERY phase — the game decides what (if anything) to show and when
   *  (Blackjack: Hit/Stand in the own pill in-match; Chess: each side's clock, pre-match + live).
   *  A non-null opponent-side result replaces the default in-match "Playing…" tag. */
  renderSlotAside?(args: GameAreaArgs, side: 'opponent' | 'own'): ReactNode;
  /** Optional game-specific reveal at the top of the result overlay (e.g. the Coinflip coin). */
  renderResultReveal?(args: { outcome: Outcome; gameState: GameView | null; playerId: string | null }): ReactNode;
  /** Presentation-only reveal pacing (opt-in). When > 0, the hub keeps the board mounted in the
   *  In-match phase for this long after the server ends the match, so the game area can animate
   *  its final state transitions (e.g. Blackjack's opponent reveal) before the result overlay
   *  takes over. Settlement already happened server-side — this only spaces out the on-screen
   *  reveal a human beat; it never delays settlement or changes any state. Omitted → the overlay
   *  shows immediately (unchanged for every other game). */
  holdResultMs?: number;
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
    gameId, gameName, renderGameArea, renderSlotAside, renderResultReveal, holdResultMs,
    token, playerId, username, opponentId, opponentName, balance, currentMatchId, gameState, legalMoves,
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

  // Reveal-hold (opt-in via holdResultMs): keep the board in-match for a beat after the server
  // ends the match so the game area animates its terminal reveal, THEN show the result overlay.
  const [resultPending, setResultPending] = useState(false);
  const pendingResult = useRef<{ outcome: Outcome; settlement: SettlementSummary; revealState: GameView | null } | null>(null);
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resultTimer.current) clearTimeout(resultTimer.current); }, []);
  function clearPendingResult() {
    if (resultTimer.current) { clearTimeout(resultTimer.current); resultTimer.current = null; }
    pendingResult.current = null;
    setResultPending(false);
  }

  // "Searching…" dwell floor (DEMO_PRESENTATION): when we PLAY, hold the search beat for a
  // minimum even if a match is already resting, so pairing never snaps in with zero delay. A
  // presentation floor only — it never blocks/delays real pairing (the match is already live
  // server-side; we just defer the in-match *visual* a beat). Untouched on the JOIN path.
  const SEARCH_FLOOR_MS = 2400;
  const searchStartRef = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holdSearch, setHoldSearch] = useState(false);
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  useEffect(() => {
    const prev = prevMatch.current;
    prevMatch.current = currentMatchId;
    if (currentMatchId && !prev) {
      setOverlay(null);
      clearPendingResult();
      setWaiting(false);
      // Apply the search dwell floor only when this match formed from our own PLAY beat.
      const started = searchStartRef.current;
      searchStartRef.current = null;
      const elapsed = started != null ? Date.now() - started : Infinity;
      if (elapsed < SEARCH_FLOOR_MS) {
        setHoldSearch(true);
        if (holdTimer.current) clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(() => setHoldSearch(false), SEARCH_FLOOR_MS - elapsed);
      }
    } else if (!currentMatchId && prev) {
      if (lastOutcome && lastSettlement) {
        const result = { outcome: lastOutcome, settlement: lastSettlement, revealState: gameState };
        if (holdResultMs && holdResultMs > 0) {
          // Defer the overlay a presentation beat so the board can play out its terminal reveal.
          pendingResult.current = result;
          setResultPending(true);
          if (resultTimer.current) clearTimeout(resultTimer.current);
          resultTimer.current = setTimeout(() => {
            resultTimer.current = null;
            if (pendingResult.current) setOverlay(pendingResult.current);
            pendingResult.current = null;
            setResultPending(false);
          }, holdResultMs);
        } else {
          setOverlay(result);
        }
      }
      setWaiting(false);
      setHoldSearch(false);
    }
  }, [currentMatchId, lastOutcome, lastSettlement, gameState, holdResultMs]);

  useEffect(() => {
    if (waitingExpiresAt != null) setWaiting(true);
  }, [waitingExpiresAt]);

  // While the dwell floor holds, a live match still reads as "waiting" (the opponent slot keeps
  // scanning) so the in-match board reveals a beat later instead of snapping in.
  // `resultPending` keeps the phase in-match (board mounted, "Playing…") through the reveal hold,
  // even though the server has already cleared currentMatchId.
  const phase: Phase = overlay ? 'result' : resultPending ? 'in-match' : (currentMatchId && !holdSearch) ? 'in-match' : (currentMatchId || waiting) ? 'waiting' : 'idle';

  function dismissResult() {
    clearPendingResult();
    setOverlay(null);
    setWaiting(false);
    onResultDismiss();
  }

  // Decorative name-scan source for the "Searching…" beat: real online players from the live
  // cross-game Open Games feed (any game). Never fabricated — an empty feed shows just "Searching…".
  const scanNames = useMemo(() => {
    const names = new Set<string>();
    for (const list of Object.values(challengesByGame)) for (const c of list) if (c.ownerName) names.add(c.ownerName);
    return [...names];
  }, [challengesByGame]);

  // ── Bet + time-control selection ────────────────────────────────────────────
  const [armedStake, setArmedStake] = useState<number | null>(initialStake ?? null);

  function handlePlay() {
    if (armedStake == null) return;
    searchStartRef.current = Date.now(); // start the Searching dwell floor
    if (timeControl) onPlay(armedStake, selectedControl);
    else onPlay(armedStake);
  }
  function handleCancel() {
    searchStartRef.current = null;
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

  // Built once and fed to the game area and the per-game slot asides (Hit/Stand, chess clocks).
  const timeControlBaseMs = timeControl?.options.find((o) => o.id === selectedControl)?.baseMs;
  const areaArgs: GameAreaArgs = { phase, gameState, legalMoves, onMove: onMakeMove, onForfeit, playerId, opponentId, username, timeControlBaseMs };

  return (
    <div className={HUB_SHELL}>
      <HubRibbon balance={loggedIn ? liveBalance : null} onLogo={onOpenGameList} onWallet={onOpenWallet} loggedIn={loggedIn} />

      <main data-testid="hub-body">
        {/* No blanket px-4 — sections that need insetting add their own; the shared Open Games /
            Bring-a-Rival / footer render full-bleed to the max-w-md edge (they pad internally). */}
        <div className={cn('mx-auto flex w-full max-w-md flex-col gap-4', HUB_BODY)}>
          {/* 1 — Arena: opponent slot pill, the per-game board, the player's own slot pill.
              No grey card frame here — each panel owns its surface (Blackjack's greyish table
              fills the section; the other arenas wrap themselves in a card). */}
          <section data-testid="hub-section-game" aria-label={gameName} className="flex flex-col gap-3 px-4">
            <OpponentSlot phase={phase} opponentName={opponentName} scanNames={scanNames} aside={renderSlotAside?.(areaArgs, 'opponent')} />
            {renderGameArea(areaArgs)}
            <OwnSlot
              label={loggedIn ? (username || 'You') : 'Sign in'}
              isOwn={loggedIn}
              aside={renderSlotAside?.(areaArgs, 'own')}
            />
          </section>

          {/* 3 — Unified play panel. Idle → live PLAY; Waiting → countdown+cancel (or, while the
              search dwell holds a found match, a brief "Opponent found"); In-match/Result → the
              SAME panel, disabled with "Playing…" (item 7 — bet + Play-a-Friend stay visible). */}
          {phase === 'waiting' ? (
            <div className="px-4">
              <div className="rounded-2xl border border-border bg-card p-4">
                {currentMatchId ? (
                  <FoundBlock />
                ) : (
                  <WaitingBlock expiresAt={waitingExpiresAt} expired={lobbyExpired} onCancel={handleCancel} onRepost={onRepost} />
                )}
              </div>
            </div>
          ) : (
            <div className="px-4">
              <PlayPanel
                playing={phase === 'in-match' || phase === 'result'}
                armedStake={armedStake}
                onArm={setArmedStake}
                onPlay={handlePlay}
                timeControl={timeControl}
                selectedControl={selectedControl}
                onSelectControl={setSelectedControl}
              />
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

/** A fast, decorative name scan over real online players (~3–4/sec). Returns null when there are
 *  no online names — the slot then shows just "Searching…", never a fabricated alias. */
function useNameScan(active: boolean, names: string[]): string | null {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active || names.length === 0) return;
    const id = setInterval(() => setI((n) => n + 1), 280); // ~3.5 names/sec
    return () => clearInterval(id);
  }, [active, names.length]);
  if (!active || names.length === 0) return null;
  return names[i % names.length];
}

/** Item 1/2 — the opponent slot above the board. Idle → neutral "Opponent"; Waiting → the
 *  "Searching…" beat with a decorative online-name scan; In-match/Result → the REAL opponent's
 *  name in bright white (or a neutral "Opponent" when the joiner's name never reached the client).
 *  Never an opponentId, never a fabricated/cycled name (Charter #2 + DEMO_PRESENTATION honesty). */
function OpponentSlot({ phase, opponentName, scanNames, aside }: { phase: Phase; opponentName?: string | null; scanNames: string[]; aside?: ReactNode }) {
  const searching = phase === 'waiting';
  const inMatch = phase === 'in-match' || phase === 'result';
  const scan = useNameScan(searching, scanNames);
  return (
    <div data-testid="hub-slot-opponent" className="flex items-center gap-2.5 rounded-full bg-surface px-3.5 py-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#2a2a4a] text-muted-foreground">
        <PersonGlyph className="h-[18px] w-[18px]" />
      </span>
      {searching ? (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold">
          <span className="animate-pulse text-muted-foreground">Searching…</span>
          {scan && <span data-testid="hub-search-scan" className="min-w-0 truncate text-muted-foreground/50">{scan}</span>}
        </span>
      ) : (
        <span className={cn('min-w-0 flex-1 truncate text-sm font-bold', inMatch ? 'text-foreground' : 'text-muted-foreground')}>
          {inMatch ? (opponentName || 'Opponent') : 'Opponent'}
        </span>
      )}
      {/* A per-game aside (e.g. chess clock) takes the right slot; otherwise the in-match tag. */}
      {aside ? (
        <span className="flex shrink-0 items-center gap-2">{aside}</span>
      ) : (
        inMatch && <span className="shrink-0 text-xs font-black uppercase tracking-wide text-foreground/70">Playing…</span>
      )}
    </div>
  );
}

/** Item 1/6 — the player's own slot below the board: their name, with an optional per-game aside
 *  (Blackjack's Hit/Stand in-match, Chess's clock) rendered beside it. */
function OwnSlot({ label, isOwn, aside }: { label: string; isOwn: boolean; aside?: ReactNode }) {
  return (
    <div data-testid="hub-slot-own" className="flex items-center gap-2.5 rounded-full bg-surface px-3.5 py-2.5">
      <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', isOwn ? 'bg-brand text-white' : 'bg-[#2a2a4a] text-muted-foreground')}>
        <PersonGlyph className="h-[18px] w-[18px]" />
      </span>
      <span className={cn('min-w-0 flex-1 truncate text-sm font-bold', isOwn ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
      {aside && <span className="flex shrink-0 items-center gap-2">{aside}</span>}
    </div>
  );
}

/** Brief "opponent found" beat shown while the search-dwell floor holds an already-formed match
 *  (no cancel — the match is live server-side; this is presentation only). */
function FoundBlock() {
  return (
    <div className="flex flex-col items-center gap-2 py-2" data-testid="hub-found">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-success">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Opponent found
      </span>
      <p className="text-sm font-semibold text-foreground/80">Starting the match…</p>
    </div>
  );
}

/** The unified play panel (PLAY + bet grid + optional time control + Play-a-Friend). `playing`
 *  freezes it during a match (item 7): PLAY reads "Playing…" and every control greys but stays. */
function PlayPanel({
  playing, armedStake, onArm, onPlay, timeControl, selectedControl, onSelectControl,
}: {
  playing: boolean;
  armedStake: number | null;
  onArm(v: number): void;
  onPlay(): void;
  timeControl?: GameMeta['timeControl'];
  selectedControl?: string;
  onSelectControl(id: string): void;
}) {
  return (
    <div data-testid="hub-section-play" className="flex flex-col gap-3.5 rounded-[18px] bg-surface p-4">
      {/* PLAY — always full purple; the bet gates the ACTION. In-match → "Playing…" + disabled. */}
      <button
        type="button"
        disabled={playing || armedStake == null}
        onClick={onPlay}
        data-testid="hub-play"
        className={cn(
          'w-full rounded-xl bg-brand py-4 text-base font-black uppercase tracking-wider text-white transition-colors',
          playing ? 'opacity-70' : 'hover:brightness-110',
        )}
      >
        {playing ? 'Playing…' : 'Play'}
      </button>

      {/* Bet amount — stays visible during a match, greyed + inert. */}
      <div data-testid="hub-section-bet" className={cn(playing && 'pointer-events-none opacity-50')}>
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
              disabled={playing}
              data-testid={`hub-bet-${v}`}
              onClick={() => onArm(v)}
              className={cn(
                'rounded-lg py-2.5 text-center text-[13px] font-bold tabular-nums transition-colors',
                armedStake === v ? 'bg-brand text-white' : 'bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              {formatCredits(v)}
            </button>
          ))}
        </div>

        {/* Time-control picker — shown only for games that declare one (chess). Each option is a
            two-line button: the large duration over the small mode name (e.g. "10 min" / "Rapid"). */}
        {timeControl && (
          <div data-testid="hub-section-timecontrol" className="mt-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Time control</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {timeControl.options.map((o) => {
                const selected = selectedControl === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={playing}
                    data-testid={`hub-tc-${o.id}`}
                    aria-pressed={selected}
                    aria-label={o.label}
                    onClick={() => onSelectControl(o.id)}
                    className={cn(
                      'flex flex-col items-center justify-center rounded-lg px-2 py-2.5 text-center leading-tight transition-colors',
                      selected ? 'bg-brand text-white' : 'bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span className="text-sm font-extrabold">{tcDuration(o.baseMs)}</span>
                    <span className={cn('mt-0.5 text-[10px] font-bold uppercase tracking-wide', selected ? 'text-white/75' : 'text-muted-foreground')}>
                      {tcName(o.label)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Play a Friend — purple, inert/visual-only (owner D1); greys with the panel during a match. */}
      <button
        type="button"
        aria-disabled="true"
        data-testid="hub-play-friend"
        className={cn('w-full cursor-default rounded-xl bg-brand py-3.5 text-[15px] font-bold text-white', playing && 'opacity-50')}
      >
        Play a Friend
      </button>
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
