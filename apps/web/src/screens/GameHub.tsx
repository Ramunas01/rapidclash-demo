import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { Trophy, X } from 'lucide-react';
import { GUEST_HUMAN_RESERVED_STAKE, type AvatarId, type GameMeta, type OpenChallenge, type Outcome, type SettlementSummary } from '@rapidclash/shared';
import type { GameView } from '../App.js';
import { api } from '../api.js';
import { formatClock } from '../format.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';
import { hubShellClass } from '../components/hub-chrome/layout.js';
import { TILE_ART, COMING_SOON, titleCase } from '../components/hub-shared/tiles.js';
import { GamesCarousel } from '../components/hub-shared/GamesCarousel.js';
import { GuestBotWaiters } from '../guest/GuestBotWaiters.js';
import { BringARival } from '../components/hub-shared/BringARival.js';
import { HubFooter } from '../components/hub-shared/HubFooter.js';
import { Avatar } from '../components/hub-shared/Avatar.js';
import { Credits } from '../components/hub-shared/RcIcon.js';
import { outlineClasses, outlineForOutcome, replaysOf, useDelayedFlag, useWinReveal, WIN_FILL_IN_MS, type Verdict } from './hub-shared/slotReveal.js';

/** How long after the result phase starts before the own-bar verdict lights (ms). */
const BAR_VERDICT_BEAT_MS = 250;

/** Draw→rematch beat (#161): how long the orange "push — replaying" outline holds on BOTH bars
 *  after a tie before the fresh round shows and the pick timer restarts. Tunable; shared by every
 *  tie-replay game (the universal tie rule is game-agnostic). */
const DRAW_REMATCH_HOLD_MS = 2000;

/** Bet presets within the shared 1–100 demo range (every demo game's BetRules). Rendered with the
 *  RC-icon credits display, not a text currency symbol (issue #324). */
const BET_PRESETS = [1, 5, 10, 25, 50, 100];

/** T5: the "VS" match-found label's font stack — the prototype's explicit override
 *  (`Full Spec.html:433`), not the app's default sans, matching the same idiom other migrated
 *  screens use for prototype-exact text (AffiliateHub.tsx / ProfileHub.tsx's own `ARIAL` consts). */
const ARIAL = 'Arial, Helvetica, sans-serif';

/** Presets withheld from a guest's bet grid (issue #353): `GUEST_HUMAN_RESERVED_STAKE` (1) is
 *  reserved for human-to-human testing inside the isolated guest world
 *  (`packages/shared/src/guest.ts`) — no guest bot ever rests at or claims it, so a guest must
 *  never be able to select or post it through this control either. Withheld by construction (the
 *  preset is never rendered as an option for a guest session), not merely disabled-with-a-label. */
const GUEST_EXCLUDED_STAKES: readonly number[] = [GUEST_HUMAN_RESERVED_STAKE];

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
  /** OPT-IN draw offers (games declaring the capability, e.g. chess — CHESS_DRAW_OFFER.md rev 3).
   *  Send/withdraw your own offer, or accept the opponent's; the server records/resolves/clears it.
   *  Undefined for games without it. */
  onDrawOffer?(): void;
  onDrawRevoke?(): void;
  /** Accept the opponent's active offer — the only way a draw offer completes the match. */
  onDrawAccept?(): void;
  playerId: string | null;
  opponentId: string | null;
  username: string | null;
  /** The real opponent's display name when known (JOIN path), else null → a neutral "Opponent".
   *  Lets a game area name the opponent in its own reveal (Chess's "[name] Won" result line).
   *  Same public alias the slot pill shows — never a hidden identity. */
  opponentName?: string | null;
  /** Client→server clock offset (ms): add to `Date.now()` to align a display-only animation with
   *  server-authoritative timers — Crash's live altitude must match the altitude the server banks.
   *  Defaults to 0 (no skew) when the payload didn't carry the server clock. */
  serverClockOffset?: number;
  /** Base budget (ms) of the currently selected time control, for games that declare one (chess).
   *  Lets a hub render the picked clock in the slot pills pre-match (before any server clock).
   *  Generic (derived from the meta) — undefined for games without a time control. */
  timeControlBaseMs?: number;
  /** The server's match.end outcome — set only in the result phase (null otherwise). Lets a game
   *  area paint a terminal result on the board itself (e.g. Blackjack's win/lose card frames) when
   *  it opts out of the shared result overlay. Driven strictly by the server, never inferred. */
  outcome?: Outcome | null;
  /** True during the shared draw→rematch beat (#161) — the ~2 s window after a tie round pushes and
   *  the server re-deals a fresh round in the same escrow. Lets a game area hold its own resolution
   *  reveal (e.g. Limbo/Keno's `lastResult`, Coinflip's flip) while the bars show the orange outline,
   *  before the fresh round takes over. Generic (driven by the `replays` signal); games ignore it. */
  drawBeat?: boolean;
  /** OPT-IN reveal-complete signal (games that also set `gateResultOnReveal`). The game area alone
   *  knows its reveal choreography timing (e.g. Blackjack's hole-card flip + hit deal-in), so it
   *  calls this ONCE when the last card of the terminal reveal has landed. The hub then lights the
   *  result bar (and, when the balance-hold is enabled, applies the settled balance) in lockstep
   *  with the on-board reveal instead of on a fixed beat. Undefined for games that don't gate. */
  onRevealComplete?(): void;
}

/** The generic, per-game-agnostic props the App feeds every Game hub (Coinflip, RPS, …). */
export interface GameHubScreenProps {
  token: string;
  playerId: string | null;
  username: string | null;
  /** The player's OWN avatar (preset id or 'default'), threaded into the own slot bar. Own-session
   *  only — the opponent slot NEVER receives an avatarId (it stays the neutral silhouette, per
   *  Charter #2 redaction). Defaults to 'default'. */
  avatarId?: AvatarId;
  opponentId: string | null;
  /** The real opponent's display name, known only when we JOINed their open challenge (the owner
   *  name from the feed). Null on the PLAY/post path (the joiner's name never reaches the client)
   *  → the slot falls back to a neutral "Opponent". Never a fabricated/cycled name (Charter #2). */
  opponentName?: string | null;
  /** Client→server clock offset (ms) for aligning display-only timers (see GameAreaArgs). */
  serverClockOffset?: number;
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
  /** Logged-out JOIN: the carousel passes the row's game + stake so the auth wall can capture a
   *  full {action:'join'} intent (matchId may be gone by auth → fall back to that hub, stake armed).
   *  Mirrors `HomeHubScreen`'s identical prop (same handler, `App.tsx`'s `handleTakePublicChallenge`). */
  onTakePublicChallenge?(c: { matchId: string; gameId: string; stake: number }): void;
  onMakeMove(move: string): void;
  onForfeit(): void;
  /** OPT-IN draw offers (chess — CHESS_DRAW_OFFER.md rev 3). App wraps the WS calls; other hubs
   *  ignore them. */
  onDrawOffer?(): void;
  onDrawRevoke?(): void;
  onDrawAccept?(): void;
  /** Subscribe/unsubscribe to EVERY game's feed (cross-game ticker). App wraps the WS calls. */
  onTrackChallenges(gameIds: string[]): void;
  onUntrackChallenges(): void;
  onSelectGame(meta: GameMeta): void;
  onOpenWallet(): void;
  onOpenGameList(): void;
  /** Rewards tab → the VIP/Rewards hub (issue #307). */
  onOpenRewards(): void;
  /** Menu overlay's own EARN → "Affiliate program" row (issue #423). Unused in guest mode — the
   *  Menu overlay itself is never rendered there (`!isGuest` below). */
  onOpenAffiliate(): void;
  /** Reset App's result state when the hub's result overlay dismisses (back to Idle). */
  onResultDismiss(): void;
  /** Logged out → no wallet/feed (auth-required); browsing the board + picking a bet stay open.
   *  The auth wall fires in the App at PLAY/JOIN. Default true. */
  loggedIn?: boolean;
  /** Pre-arm the bet selector (the join-fallback drops the user here ready to post). */
  initialStake?: number;
  /** Pre-arm the time-control selection for games that declare one (chess) — guest mode's fixed
   *  control (issue #279), mirroring `initialStake`. Guest sessions skip the `/games` roster fetch
   *  below (curated surface, no picker needed), so `timeControl` (the fetched descriptor that
   *  normally drives the picker's default) never populates — without this, a guest's `selectedControl`
   *  would stay `undefined` forever and PLAY would silently omit the time control. Ignored for games
   *  without a time control (Coinflip) and for non-guest sessions (the fetched roster's own default
   *  still wins there, unchanged). */
  initialTimeControl?: string;
  /** Anonymous guest session (CHARTER.md's guest-mode exception, issue #267). Curated/simplified
   *  chrome: hides the wallet chip (own-session balance still shows, just non-interactive), Open
   *  Games, the related-games rail, Bring-a-Rival, the footer, and the bottom nav (account/games
   *  all lead to real-platform surfaces a guest session doesn't have). The bet control is
   *  genuinely interactive (issue #353) — pre-armed at `initialStake` as a sensible default for a
   *  guest who never touches it, but a guest can also pick any other offered preset; the grid
   *  withholds `GUEST_HUMAN_RESERVED_STAKE` (1) so a guest can never select or post it. Default
   *  false. */
  isGuest?: boolean;
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
  /** Optional in-match override for the ONE primary action button (PLAY's slot). When this returns
   *  non-null the hub renders it INSTEAD of PLAY — so a game transforms the single button in place
   *  (Crash: PLAY → EJECT → disabled-waiting → back to PLAY) rather than spawning a second control.
   *  Return null to keep the default PLAY button (idle / result → play again). Template-shaped. */
  renderPrimaryAction?(args: GameAreaArgs): ReactNode;
  /** Optional in-match override for the SECONDARY action button (the Play-a-Friend slot) — mirror of
   *  `renderPrimaryAction`. When it returns non-null the hub renders it INSTEAD of Play a Friend, so a
   *  game transforms that button in place (Chess: Play a Friend → Draw request ⇄ Revoke DRAW). Return
   *  null to keep the default Play a Friend. Never shown while searching (that slot is the Cancel). */
  renderSecondaryAction?(args: GameAreaArgs): ReactNode;
  /** Opt out of the shared result pop-up (mirrors holdResultMs being opt-in). When true the hub
   *  never renders the ResultOverlay; it instead holds the result phase open with the board mounted
   *  (gameState = the terminal frame, areaArgs.outcome set) so the game presents the result on the
   *  board itself, persisting until a new game starts or the player leaves. Other games omit it →
   *  the overlay shows as before (the regression guard). */
  suppressResultOverlay?: boolean;
  /** Opt OUT of the shared orange draw-bar (Blackjack's reversal). The draw→rematch beat still fires
   *  and `areaArgs.drawBeat` still reaches the game area (Blackjack paints the push on the CARDS + an
   *  orange "Push" label) — this only stops the orange outline from being painted on the two slot
   *  bars, because "the bar speaks only on decided rounds" (BLACKJACK.md / SCREENS.md reconciliation).
   *  Other games omit it → the bars still go orange on a draw (the universal treatment). */
  suppressDrawBar?: boolean;
  /** Opt in to bar-level result coloring on the own slot (Coinflip-style): all three verdicts settle
   *  to the shared ring outline (win → ring-success, loss → ring-destructive, draw → ring-amber-400);
   *  on a win the bar first plays a transient green fill + "You Win" alongside the username (which is
   *  never swapped out) that eases out into that green outline. Fires BAR_VERDICT_BEAT_MS after the
   *  result phase starts so the board can animate first. Other games omit this → no change. */
  ownBarResult?: boolean;
  /** Presentation-only reveal pacing (opt-in). When > 0, the hub keeps the board mounted in the
   *  In-match phase for this long after the server ends the match, so the game area can animate
   *  its final state transitions (e.g. Blackjack's opponent reveal) before the result overlay
   *  takes over. Settlement already happened server-side — this only spaces out the on-screen
   *  reveal a human beat; it never delays settlement or changes any state. Omitted → the overlay
   *  shows immediately (unchanged for every other game). */
  holdResultMs?: number;
  /** Opt in (Blackjack) to gating the RESULT PRESENTATION on the board's reveal-complete signal
   *  instead of a fixed beat. When set, the own result bar (and the ribbon balance) only settle once
   *  the game area calls `areaArgs.onRevealComplete()` — i.e. when the last card of the terminal
   *  reveal has landed — so the bar/balance never jump ahead of the on-board reveal. Requires the
   *  game area to fire `onRevealComplete`. Omitted → the bar lights on the fixed BAR_VERDICT_BEAT_MS
   *  beat and the balance syncs immediately (byte-identical to today for every other game). */
  gateResultOnReveal?: boolean;
  /** Override for the "Searching…" dwell floor below (issue #387). Coinflip and RPS pass 0: their
   *  entire round IS the server's fixed 10s pick window (PICK_WINDOW_MS, resolves ONLY at expiry —
   *  never early), so burning ~2.4s of it on a purely cosmetic hold risks the window elapsing before
   *  the pick buttons ever render, resolving the match via the timeout auto-pick with no player
   *  input. Every other hub game omits this (undefined → the existing 2400ms default), so their dwell
   *  is byte-identical to before this prop existed. */
  searchFloorMs?: number;
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
    gameId, gameName, renderGameArea, renderSlotAside, renderResultReveal, renderPrimaryAction, renderSecondaryAction, suppressResultOverlay, holdResultMs, gateResultOnReveal, ownBarResult, suppressDrawBar, searchFloorMs = 2400,
    token, playerId, username, avatarId = 'default', opponentId, opponentName, serverClockOffset = 0, balance, currentMatchId, gameState, legalMoves,
    waitingExpiresAt, lobbyExpired, lastOutcome, lastSettlement, challengesByGame,
    onPlay, onCancel, onTakeChallenge, onTakePublicChallenge, onMakeMove, onForfeit, onDrawOffer, onDrawRevoke, onDrawAccept, onTrackChallenges,
    onUntrackChallenges, onSelectGame, onOpenWallet, onOpenGameList, onOpenRewards, onOpenAffiliate, onResultDismiss,
    loggedIn = true, initialStake, initialTimeControl, isGuest = false,
  } = props;

  // ── Live wallet balance ─────────────────────────────────────────────────────
  // The `balance`→`liveBalance` sync effect lives after `phase` is derived (it can HOLD on the
  // reveal-complete signal when gateResultOnReveal is set); the mount fetch stays here.
  const [liveBalance, setLiveBalance] = useState(balance);
  // Issue #414: the Menu overlay's own open/close/reveal-origin state — never opened for a guest
  // (its HubToolbar, the only way to reach it, is already hidden below via `!isGuest &&`).
  const menu = useMenuOverlay();
  useEffect(() => {
    // Wallet is auth-only (logged out shows the "Sign in" chip); a guest's balance lives in the
    // server's ephemeral ledger, never the real `/wallet` — the `balance` prop (updated from the
    // WS match.end settlement, generic to any session) is already authoritative for it.
    if (!loggedIn || isGuest) return;
    let alive = true;
    api.wallet(token).then((w) => { if (alive) setLiveBalance(w.balance); }).catch(() => {});
    return () => { alive = false; };
  }, [token, loggedIn, isGuest]);

  // ── Reveal-complete gate (opt-in via gateResultOnReveal) ─────────────────────
  // The game area (which alone knows its reveal choreography timing) calls onRevealComplete when the
  // last card of the terminal reveal has landed; we flip `revealDone` and gate the result bar (and,
  // when enabled, the ribbon balance) on it. Reset to "not yet revealed" for each new match.
  const [revealDone, setRevealDone] = useState(false);
  useEffect(() => { setRevealDone(false); }, [currentMatchId]);
  const handleRevealComplete = useCallback(() => setRevealDone(true), []);

  // ── Games roster (drives the time control, related rail, and feed labels) ─────
  // A guest's curated surface is exactly one game (isGuest games are hidden anyway) — skip the
  // roster fetch and the cross-game ticker subscription entirely; coinflip has no time control.
  const [games, setGames] = useState<GameMeta[]>([]);
  useEffect(() => {
    if (isGuest) return;
    let alive = true;
    api.games(token).then((g) => { if (alive && Array.isArray(g)) setGames(g); }).catch(() => {});
    return () => { alive = false; };
  }, [token, isGuest]);
  const nameByGame = useMemo(() => new Map(games.map((g) => [g.id, g.displayName])), [games]);
  const timeControl = games.find((g) => g.id === gameId)?.timeControl;
  const [selectedControl, setSelectedControl] = useState<string | undefined>(initialTimeControl);
  // Guest sessions never fetch the roster (above), so `timeControl?.defaultId` never resolves for
  // them — guard this sync to non-guest sessions so it can't clobber the guest's pre-armed control
  // (initialTimeControl) with `undefined` on mount.
  useEffect(() => { if (!isGuest) setSelectedControl(timeControl?.defaultId); }, [timeControl?.defaultId, isGuest]);

  // Cross-game ticker: subscribe to every game's feed while the hub is mounted (authed only).
  const gameKey = games.map((g) => g.id).join(',');
  useEffect(() => {
    if (!loggedIn || isGuest || games.length === 0) return;
    onTrackChallenges(games.map((g) => g.id));
    return () => onUntrackChallenges();
    // eslint-disable-next-line -- track once per game-set change (callbacks are stable)
  }, [gameKey, loggedIn, isGuest]);

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
  // Duration comes from `searchFloorMs` (defaults to 2400 above) — Coinflip/RPS pass 0 (#387) so
  // `elapsed < SEARCH_FLOOR_MS` below is never true (elapsed is never negative) and the hold never
  // arms, naturally collapsing this whole mechanism to a no-op for them without a special-cased path.
  const SEARCH_FLOOR_MS = searchFloorMs;
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

  // #154: the search timed out with no opponent (lobbyExpired). Revert to idle IN PLACE — drop
  // out of the waiting phase so the opponent pill + arena show their idle cues again and the play
  // panel returns to idle PLAY. The armed stake is kept (armedStake state persists), so pressing
  // PLAY simply re-posts (App resets lobbyExpired on the new join → the "No opponent" note clears).
  useEffect(() => {
    if (lobbyExpired) { setWaiting(false); searchStartRef.current = null; }
  }, [lobbyExpired]);

  // While the dwell floor holds, a live match still reads as "waiting" (the opponent slot keeps
  // scanning) so the in-match board reveals a beat later instead of snapping in.
  // `resultPending` keeps the phase in-match (board mounted, "Playing…") through the reveal hold,
  // even though the server has already cleared currentMatchId.
  //
  // One-render bridge (Advisor #2, 2026-07-11): `overlay`/`resultPending` are only set by the effect
  // above, which fires one render AFTER `currentMatchId` first goes null (effects run post-commit).
  // On that exact first render, both are still their stale (falsy) pre-match values, so without this
  // bridge the formula falls all the way through to 'idle' for one frame — unmounting any board that
  // only mounts on 'in-match'/'result' (e.g. Blackjack's), so every card replays its mount animation
  // instead of transitioning in place. `lastOutcome`/`lastSettlement` are ordinary props (not
  // effect-derived) and App's onMatchEnd sets them in the SAME batch it nulls currentMatchId, so they
  // are already fresh on this exact render — bridge off them instead. This branch only ever fires in
  // the narrow window where overlay/resultPending/currentMatchId/waiting are all already falsy AND a
  // fresh result exists — i.e. only this one-render gap; the moment the effect catches up it sets
  // overlay directly (holdResultMs falsy) or resultPending then overlay (holdResultMs > 0), both of
  // which are already handled by the EARLIER branches above, so this stops competing immediately.
  const hasFreshResult = lastOutcome != null && lastSettlement != null;
  const phase: Phase = overlay ? 'result'
    : resultPending ? 'in-match'
    : (currentMatchId && !holdSearch) ? 'in-match'
    : (currentMatchId || waiting) ? 'waiting'
    : hasFreshResult ? (holdResultMs && holdResultMs > 0 ? 'in-match' : 'result')
    : 'idle';

  // Balance-hold (opt-in, paired with gateResultOnReveal): while a gated result is still revealing on
  // the board, HOLD the displayed balance at its pre-settlement value; apply the settled `balance`
  // only once the board signals reveal-complete (revealDone). `holdBalance` is constant-false for
  // non-gated games, so the effect's dependency set collapses to `[balance]` and its behaviour is
  // byte-identical to the previous `setLiveBalance(balance)` sync (the regression guard).
  const holdBalance = gateResultOnReveal === true && phase === 'result' && !revealDone;
  useEffect(() => {
    if (holdBalance) return;
    setLiveBalance(balance);
  }, [balance, holdBalance]);

  function dismissResult() {
    clearPendingResult();
    setOverlay(null);
    setWaiting(false);
    onResultDismiss();
  }

  // Decorative name-scan source for the "Searching…" beat: real online players from the live
  // cross-game Open Games feed (any game). Never fabricated — an empty feed shows just "Searching…".
  // Excludes the current player's own resting challenges (name-based: OpenChallenge carries only
  // ownerName, no owner id — #149) so the scan can't flash the player against themselves.
  const scanNames = useMemo(() => {
    const names = new Set<string>();
    for (const list of Object.values(challengesByGame)) for (const c of list) if (c.ownerName && c.ownerName !== username) names.add(c.ownerName);
    return [...names];
  }, [challengesByGame, username]);

  // ── Bet + time-control selection ────────────────────────────────────────────
  const [armedStake, setArmedStake] = useState<number | null>(initialStake ?? null);

  function handlePlay() {
    if (armedStake == null) return;
    // Starting a new game clears any persisted result (the opt-out games keep the last board up
    // until now) so the panel/board leave the result phase cleanly.
    setOverlay(null);
    clearPendingResult();
    searchStartRef.current = Date.now(); // start the Searching dwell floor
    // Based on the actual armed value, not on whether the full picker descriptor loaded — a guest
    // session has a selectedControl (pre-armed, issue #279) with no `timeControl` descriptor at
    // all, and must still send it. Unchanged for every other game/session: `selectedControl` only
    // ever becomes truthy via the synced effect above when `timeControl` itself is truthy.
    if (selectedControl) onPlay(armedStake, selectedControl);
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

  // A match is forming (the search dwell holds an already-paired match) or live — both freeze the
  // play panel (bet + Play-a-Friend greyed); the result phase does NOT (PLAY returns to start anew).
  const matchForming = phase === 'waiting' && currentMatchId != null;
  const playFrozen = phase === 'in-match' || matchForming;

  // #154: pure search — a posted bet with no match yet (and not expired). Drives the in-place
  // transform of the ALWAYS-mounted play panel: PLAY → a non-tappable "Waiting for an opponent ·
  // m:ss", Play-a-Friend → an active Cancel, bet row frozen — no separate WaitingBlock, no
  // mount/unmount (the in-match model, applied to waiting). The countdown ticks off `waitingExpiresAt`.
  const searching = phase === 'waiting' && !currentMatchId && !lobbyExpired;
  const searchNow = useNow(searching);
  const waitingRemaining = waitingExpiresAt != null ? waitingExpiresAt - searchNow : 0;

  // ── Draw→rematch beat (#161) — shared across every tie-replay game ───────────
  // The universal tie rule already re-deals a fresh round in the SAME escrow server-side (the module
  // bumps `replays`/`round` and returns a NON-terminal state; it settles once when decisive, and at
  // the 10-replay cap it sends match.end with outcome:void). The ONLY generic tell that a push just
  // happened is a rise in that public `replays` counter (replaysOf, no gameId branch). On a rise
  // while the match is live we run the shared beat: an orange outline on BOTH bars for
  // DRAW_REMATCH_HOLD_MS, then clear so the fresh round (already delivered) shows and the pick timer
  // restarts. The client never touches escrow per round; the cap-void arrives as a normal terminal
  // (match.end → result overlay), so there is no client-side loop.
  const replays = replaysOf(gameState);
  const [drawBeat, setDrawBeat] = useState(false);
  const prevReplays = useRef<number | null>(null);
  const drawBeatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (drawBeatTimer.current) clearTimeout(drawBeatTimer.current); }, []);
  // A new match starts its own replay count — reset the baseline so a prior match can't leak a beat.
  useEffect(() => { prevReplays.current = null; setDrawBeat(false); }, [currentMatchId]);
  useEffect(() => {
    const prev = prevReplays.current;
    prevReplays.current = replays;
    // Only a genuine increase during a LIVE match is a draw — not the first frame, a reconnect
    // resume (baseline reset above), or the terminal void at the cap (that clears currentMatchId).
    if (prev != null && replays != null && replays > prev && currentMatchId != null) {
      setDrawBeat(true);
      if (drawBeatTimer.current) clearTimeout(drawBeatTimer.current);
      drawBeatTimer.current = setTimeout(() => setDrawBeat(false), DRAW_REMATCH_HOLD_MS);
    }
  }, [replays, currentMatchId]);

  // Built once and fed to the game area, the per-game slot asides (chess clocks) and the play action.
  const timeControlBaseMs = timeControl?.options.find((o) => o.id === selectedControl)?.baseMs;
  const areaArgs: GameAreaArgs = { phase, gameState, legalMoves, onMove: onMakeMove, onForfeit, onDrawOffer, onDrawRevoke, onDrawAccept, playerId, opponentId, username, opponentName, serverClockOffset, timeControlBaseMs, outcome: overlay?.outcome ?? null, drawBeat, onRevealComplete: handleRevealComplete };
  // The bar-level draw outline: on for every game EXCEPT the ones that carry the draw on their own
  // surface (Blackjack → cards + "Push" label). The board still gets the full `drawBeat` via areaArgs.
  const barDrawBeat = suppressDrawBar ? false : drawBeat;

  // Bar-level result (opt-in, Coinflip-style). Fires BAR_VERDICT_BEAT_MS after the result phase
  // starts so the board's flip/reveal animation plays first. Generic derivation from server outcome.
  const ownBarFrameKind = outlineForOutcome(areaArgs.outcome, playerId);
  // The hook is ALWAYS called (hook-rule safe); the fixed-beat flag drives the non-gated path.
  const ownBarVerdictBeat = useDelayedFlag(
    ownBarResult === true && phase === 'result' && ownBarFrameKind != null,
    BAR_VERDICT_BEAT_MS,
  );
  // Gated games light the bar on the board's reveal-complete signal instead of the fixed beat, so it
  // never fires ahead of the last card landing (Advisor #10). Non-gated games keep the beat exactly.
  const ownBarVerdictLit = gateResultOnReveal
    ? (phase === 'result' && revealDone)
    : ownBarVerdictBeat;
  const ownBarVerdict: Verdict | null = (ownBarResult && ownBarVerdictLit) ? ownBarFrameKind : null;

  return (
    <div className={hubShellClass(isGuest)}>
      <HubRibbon balance={loggedIn ? liveBalance : null} onLogo={onOpenGameList} onWallet={onOpenWallet} loggedIn={loggedIn} isGuest={isGuest} />

      <main data-testid="hub-body">
        {/* No blanket px-4 — sections that need insetting add their own; the shared Open Games /
            Bring-a-Rival / footer render full-bleed to the max-w-md edge (they pad internally). */}
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
          {/* 1 — Arena: opponent slot pill, the per-game board, the player's own slot pill.
              No grey card frame here — each panel owns its surface (Blackjack's greyish table
              fills the section; the other arenas wrap themselves in a card). */}
          <section data-testid="hub-section-game" aria-label={gameName} className="relative flex flex-col gap-3 px-4">
            {/* T5: the shared "VS" match-found beat (Full Spec.html:430-433's `matchVsLabel` /
                `rpsMatchVsOp` / `rpsMatchVsScale` / `matchVsColor`) — the reveal between "Searching…"
                and the frozen pre-match state, the instant a match is assigned but play hasn't
                started (`matchForming`, line ~497 above). Every hub built on GameHub shares this
                render path (OpponentSlot → board → OwnSlot below), so this one insertion covers all
                of them, not just Mines/RPS/Dice.
                Always mounted (never conditionally rendered) so the opacity/scale transition can
                run BOTH ways — fading in on matchForming, then fading back out as `in-match` takes
                over — exactly like the prototype's own always-bound style props. Centered on the
                section's own vertical midpoint (top-1/2 + -translate-y-1/2) rather than the
                prototype's fixed `matchVsTop` pixel offset: the prototype is a fixed-width mock with
                a hand-tuned px value per game state, while this section's height is fluid (per-game
                board sizes) — centering on the section itself is the faithful equivalent of "floating
                between the two player bars" in a responsive layout. Every other value (opacity/scale
                start-end, color, font, transition timing) is copied 1:1 from the cited lines. */}
            <div
              aria-hidden="true"
              data-testid="hub-match-vs"
              className="pointer-events-none absolute inset-x-0 top-1/2 z-[2] flex items-center justify-center"
              style={{
                opacity: matchForming ? 1 : 0,
                transform: `translateY(-50%) scale(${matchForming ? 1 : 0.7})`,
                transition: 'opacity 320ms ease, transform 420ms cubic-bezier(0.34,1.5,0.5,1)',
              }}
            >
              <span
                className="text-[18px] font-bold tracking-[1.5px] text-[var(--rc-muted)]"
                style={{ fontFamily: ARIAL }}
              >
                VS
              </span>
            </div>
            <OpponentSlot phase={phase} opponentName={opponentName} scanNames={scanNames} aside={renderSlotAside?.(areaArgs, 'opponent')} drawBeat={barDrawBeat} />
            {renderGameArea(areaArgs)}
            <OwnSlot
              label={loggedIn ? (username || 'You') : 'Sign in'}
              username={loggedIn ? username : null}
              avatarId={loggedIn ? avatarId : 'default'}
              isOwn={loggedIn}
              aside={renderSlotAside?.(areaArgs, 'own')}
              barVerdict={ownBarVerdict}
              drawBeat={barDrawBeat}
            />
          </section>

          {/* 3 — Unified play panel — ALWAYS mounted; the controls transform in place (#154), so
              idle→waiting→in-match never mounts/unmounts a panel or shifts layout. Idle/Result →
              live PLAY + Play-a-Friend. Searching → PLAY becomes a non-tappable "Waiting for an
              opponent · m:ss" (the actionSlot seam, same slot Crash uses for EJECT) and Play-a-
              Friend becomes the one active Cancel; the bet row freezes. Forming/In-match → frozen,
              "Playing…". Expiry reverts to idle + a polite "No opponent found" note. The opponent
              pill's "Searching…" and each hub's arena "Finding a rival…" remain the state cues. */}
          <div className="px-4">
            <PlayPanel
              playing={playFrozen}
              searching={searching}
              noOpponent={lobbyExpired && !currentMatchId}
              armedStake={armedStake}
              onArm={setArmedStake}
              onPlay={handlePlay}
              onCancel={handleCancel}
              actionSlot={
                searching ? (
                  <button
                    type="button"
                    disabled
                    data-testid="hub-play"
                    className="w-full cursor-default rounded-xl bg-brand py-4 text-base font-black uppercase tracking-wider text-white opacity-80"
                  >
                    Waiting for an opponent · <span className="tabular-nums" data-testid="hub-waiting-countdown">{formatClock(waitingRemaining)}</span>
                  </button>
                ) : (renderPrimaryAction?.(areaArgs) ?? null)
              }
              secondaryActionSlot={searching ? null : (renderSecondaryAction?.(areaArgs) ?? null)}
              timeControl={timeControl}
              selectedControl={selectedControl}
              onSelectControl={setSelectedControl}
              excludedStakes={isGuest ? GUEST_EXCLUDED_STAKES : undefined}
            />
          </div>

          {/* 4 — Open Games (cross-game, all hubs) — the same GamesCarousel the Home hub renders
              (issue #305/#316: one implementation, not two). Internally handles both the signed-in
              WS aggregate and the logged-out public-poll snapshot via its own `loggedIn` prop.
              JOIN is blocked ONLY while genuinely occupied — a live match or an in-flight search. The
              settled post-game result view (phase 'result') is idle-with-a-board: the match is already
              deleted server-side, so JOIN must stay open there (as in plain idle) — otherwise Open
              Games wrongly reads "one match at a time" until the player leaves.
              Guest mode swaps this for `GuestBotWaiters` (issue #354) instead of omitting the section
              entirely — a small guest-scoped equivalent backed ONLY by the isolated guest instance's
              currently-resting Demo-Opponent bot-waiters (issue #351), never `challengesByGame`/the
              real WS aggregate (GUEST_MODE_CONTRACT.md §4's "no live human matchmaking with strangers"
              still holds — this never shows a real player, by construction of its own data source). */}
          {isGuest ? (
            <GuestBotWaiters
              gameId={gameId}
              balance={liveBalance}
              onTake={onTakeChallenge}
              joinDisabled={phase === 'in-match' || phase === 'waiting'}
            />
          ) : (
            <GamesCarousel
              challengesByGame={challengesByGame}
              nameByGame={nameByGame}
              balance={liveBalance}
              onTake={onTakeChallenge}
              onTakePublicChallenge={onTakePublicChallenge}
              loggedIn={loggedIn}
              joinDisabled={phase === 'in-match' || phase === 'waiting'}
            />
          )}

          {/* 5–8 — Related-games rail, Bring a Rival, footer: all point at the full registered
              platform (game grid / leaderboard / waitlist), none of which a curated guest session
              has. Omitted for guest mode. */}
          {!isGuest && (
            <>
              <RelatedRail related={related} onSelectGame={onSelectGame} />
              <BringARival />
            </>
          )}
        </div>

        {!isGuest && <HubFooter onGames={onOpenGameList} onRewards={onOpenRewards} />}
      </main>

      {/* Bottom nav (Games/Account) leads to the full game grid / profile — real-platform
          surfaces a guest session doesn't have. Omitted for guest mode. */}
      {!isGuest && (
        <HubToolbar
          onGames={menu.wrap(onOpenGameList)}
          onAccount={menu.wrap(onOpenWallet)}
          onRewards={menu.wrap(onOpenRewards)}
          onMenu={menu.onMenu}
          active={menu.open ? 'menu' : 'games'}
        />
      )}
      {!isGuest && (
        <MenuOverlay
          open={menu.open}
          anchorRect={menu.anchorRect}
          onClose={menu.close}
          onOpenGames={onOpenGameList}
          onOpenRewards={onOpenRewards}
          onOpenAffiliate={onOpenAffiliate}
        />
      )}

      {/* Opt-out games (Blackjack) suppress the pop-up and present the result on the board instead;
          the overlay stays the default for every other hub (the regression guard). */}
      {overlay && !suppressResultOverlay && (
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
function OpponentSlot({ phase, opponentName, scanNames, aside, drawBeat }: { phase: Phase; opponentName?: string | null; scanNames: string[]; aside?: ReactNode; drawBeat?: boolean }) {
  const searching = phase === 'waiting';
  const inMatch = phase === 'in-match' || phase === 'result';
  const scan = useNameScan(searching, scanNames);
  return (
    <div
      data-testid="hub-slot-opponent"
      className={cn(
        'flex items-center gap-2.5 rounded-full bg-surface px-3.5 py-2.5 transition-all duration-300',
        // Shared draw→rematch beat (#161): both bars flash the orange push outline for ~2 s.
        drawBeat && outlineClasses('draw'),
      )}
    >
      {/* NEUTRAL avatar — the in-match opponent stays redacted: never their name/avatar (Charter #2). */}
      <Avatar avatarId="default" />
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
      {/* A per-game aside (e.g. chess clock) takes the right slot; otherwise the live "Playing…"
          tag — only while actually in-match (a persisted post-match board is not "playing"). */}
      {aside ? (
        <span className="flex shrink-0 items-center gap-2">{aside}</span>
      ) : (
        phase === 'in-match' && <span className="shrink-0 text-xs font-black uppercase tracking-wide text-foreground/70">Playing…</span>
      )}
    </div>
  );
}

/** Item 1/6 — the player's own slot below the board: their name, with an optional per-game aside
 *  (Blackjack's Hit/Stand in-match, Chess's clock) rendered beside it.
 *  When `barVerdict` is set (Coinflip + Blackjack opt-in): all three verdicts settle to the shared
 *  ring outline (win → ring-success, loss → ring-destructive, draw → ring-amber-400). A win first
 *  plays the SHARED win animation (`useWinReveal`): a green fill + "You Win" kept ALONGSIDE the
 *  username (never swapped out), the green a background layer — 0.5 s fill-in → 2 s hold → 0.5 s
 *  fade-out → the persistent green outline. Loss/draw are outline-only (no fill/text). */
function OwnSlot({ label, username, avatarId = 'default', isOwn, aside, barVerdict, drawBeat }: { label: string; username?: string | null; avatarId?: AvatarId; isOwn: boolean; aside?: ReactNode; barVerdict?: Verdict | null; drawBeat?: boolean }) {
  const win = barVerdict === 'win';
  const { contentVisible, fillShown, settled } = useWinReveal(win);

  return (
    <div
      data-testid="hub-slot-own"
      className={cn(
        'relative flex items-center gap-2.5 rounded-full bg-surface px-3.5 py-2.5 transition-all duration-300',
        // All three settle to the shared ring; the win ring only lands once the fill has run.
        barVerdict === 'lose' && 'ring-[3px] ring-destructive',
        barVerdict === 'draw' && 'ring-[3px] ring-amber-400',
        win && settled && outlineClasses('win'),
        // In-match draw→rematch beat (#161): the same orange push outline as the opponent bar.
        drawBeat && outlineClasses('draw'),
      )}
    >
      {/* Green celebration fill — a background LAYER behind the content (never replaces the username).
          Fades in over 0.5 s, holds 2 s, fades out over 0.5 s (same duration both ways), then unmounts. */}
      {contentVisible && (
        <motion.span
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: fillShown ? 1 : 0 }}
          transition={{ duration: WIN_FILL_IN_MS / 1000, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 rounded-full bg-success"
        />
      )}
      {/* Own avatar — per-user LIGHT disc + darkened glyph, derived from the username (no username →
          NEUTRAL, e.g. logged out / legacy session). Sits above the win-fill layer (z-10). */}
      <Avatar username={username} avatarId={avatarId} className="relative z-10" />
      {/* Username stays put in every state; white over the green fill, back to normal once it fades. */}
      <span
        className={cn('relative z-10 min-w-0 flex-1 truncate text-sm font-bold transition-colors duration-300', contentVisible ? 'text-white' : isOwn ? 'text-foreground' : 'text-muted-foreground')}
      >
        {label}
      </span>
      {/* "You Win" alongside the username during the win fill; fades in/out with the green, then unmounts. */}
      {contentVisible && (
        <motion.span
          data-testid="hub-slot-own-verdict"
          initial={{ opacity: 0 }}
          animate={{ opacity: fillShown ? 1 : 0 }}
          transition={{ duration: WIN_FILL_IN_MS / 1000, ease: 'easeOut' }}
          className="relative z-10 shrink-0 text-sm font-extrabold uppercase tracking-wide text-white"
        >
          You Win
        </motion.span>
      )}
      {aside && <span className="relative z-10 flex shrink-0 items-center gap-2">{aside}</span>}
    </div>
  );
}

/** The unified play panel (PLAY + bet grid + optional time control + Play-a-Friend). It is ALWAYS
 *  mounted and transforms in place across states (#154), never swapped for a separate block:
 *  `playing` freezes it during a match (PLAY reads "Playing…", controls grey but stay); `searching`
 *  is the pure-search state (the hub supplies the "Waiting for an opponent · m:ss" actionSlot and
 *  Play-a-Friend becomes the active Cancel, while the bet row freezes with the SAME visuals — but
 *  NO "Playing…" label); `noOpponent` shows the polite "No opponent found" note after expiry. */
function PlayPanel({
  playing, searching, noOpponent, armedStake, onArm, onPlay, onCancel, actionSlot, secondaryActionSlot, timeControl, selectedControl, onSelectControl, excludedStakes,
}: {
  playing: boolean;
  /** Pure search: freeze the bet row (no "Playing…") and turn Play-a-Friend into the active Cancel. */
  searching: boolean;
  /** Search expired with no opponent → show the polite "No opponent found — try again" note. */
  noOpponent: boolean;
  armedStake: number | null;
  onArm(v: number): void;
  onPlay(): void;
  /** Cancel the in-flight search (the hardened leaveQueue path, #153). */
  onCancel(): void;
  /** Presets to withhold from the offered bet grid entirely (issue #353) — e.g. guest mode
   *  withholds `GUEST_HUMAN_RESERVED_STAKE` so a guest can never select or post it. Enforced by
   *  never rendering the preset as an option, not by disabling it in place. Independent of
   *  playing/searching (those freeze the WHOLE grid via `frozen`; this narrows WHICH values are
   *  ever offered). Default: none (every other hub is unaffected, offers the full BET_PRESETS
   *  range). */
  excludedStakes?: readonly number[];
  /** When provided, replaces the PLAY button in place — the game's transforming primary action
   *  (e.g. Crash's EJECT during flight, or the hub's waiting label during search). Null → the
   *  default PLAY button (the #1-bug fix: ONE button that transforms, never a second control). */
  actionSlot?: ReactNode;
  /** When provided (and not searching), replaces the Play-a-Friend button in place — the game's
   *  transforming SECONDARY action (Chess's Draw request ⇄ Revoke DRAW). Null → the default. */
  secondaryActionSlot?: ReactNode;
  timeControl?: GameMeta['timeControl'];
  selectedControl?: string;
  onSelectControl(id: string): void;
}) {
  // Both a live match and a pure search freeze the bet controls with the identical greyed/inert
  // treatment — the ONLY difference is the primary label (search shows the waiting slot, not
  // "Playing…") and that Play-a-Friend becomes Cancel during search.
  const frozen = playing || searching;
  // The offered presets, minus anything withheld (issue #353) — computed once per render rather
  // than filtered inline in the JSX below so the grid-column count (right below) can agree with it.
  const presets = excludedStakes?.length ? BET_PRESETS.filter((v) => !excludedStakes.includes(v)) : BET_PRESETS;
  // "PLAY needs a bet" guided affordance (#143). PLAY stays enabled with no stake armed; pressing
  // it then GUIDES the user to the bet panel (smooth-scroll + red frame + a11y hint) instead of
  // dead-ending — it never starts a match. The cue clears the instant a bet is armed (no auto-play).
  const betRef = useRef<HTMLDivElement>(null);
  const [needsBet, setNeedsBet] = useState(false);

  // Clear the cue the moment a stake is armed (any path: preset, initialStake, external) and
  // whenever the panel freezes for a live match. Arming only clears the guide — it never presses
  // PLAY; the user does that themselves on their next tap.
  useEffect(() => { if (armedStake != null) setNeedsBet(false); }, [armedStake]);
  useEffect(() => { if (frozen) setNeedsBet(false); }, [frozen]);

  // The shared guard. Scroll the BET panel into view (centered → clears the fixed top ribbon and
  // bottom nav; the scroll-margins below add explicit nav + safe-area clearance, robust to the
  // body-scroll change in #142) and raise the red needs-bet frame + hint. Starts no match.
  function guideToBet() {
    setNeedsBet(true);
    betRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function handlePlayPress() {
    if (armedStake == null) { guideToBet(); return; } // no bet → guide; do NOT start a match
    onPlay();
  }
  // Play a Friend is inert/visual-only (owner D1). The guard is pre-wired so that WHEN that path
  // activates and requires a stake, an unarmed press guides to the bet panel exactly like PLAY.
  // The friend flow itself is not built, so an armed press still does nothing (no behaviour change).
  function handlePlayFriend() {
    if (armedStake == null) { guideToBet(); return; }
    /* TODO(D1): launch the friend-invite flow with the armed stake. */
  }

  return (
    <div data-testid="hub-section-play" className="flex flex-col gap-3.5 rounded-[18px] bg-surface p-4">
      {/* The ONE primary action. Default = PLAY (always full purple, always pressable; an unarmed
          press guides to the bet panel — #143; in-match → "Playing…" disabled). A game may
          transform it in place via actionSlot. */}
      {actionSlot ?? (
        <button
          type="button"
          disabled={playing}
          onClick={handlePlayPress}
          data-testid="hub-play"
          className={cn(
            'w-full rounded-xl bg-brand py-4 text-base font-black uppercase tracking-wider text-white transition-colors',
            playing ? 'opacity-70' : 'hover:brightness-110',
          )}
        >
          {playing ? 'Playing…' : 'Play'}
        </button>
      )}

      {/* Expiry note (#154): the search timed out with no opponent. Polite live region (same
          pattern as the #143 needs-bet hint) — sr-only until it fires, cleared on the next PLAY
          (App resets lobbyExpired on re-post). Does NOT claim a refund (already auto-refunded). */}
      <p
        role="status"
        aria-live="polite"
        data-testid="hub-no-opponent"
        className={cn('-mt-1 text-center text-xs font-semibold text-muted-foreground', !noOpponent && 'sr-only')}
      >
        {noOpponent ? 'No opponent found — try again' : ''}
      </p>

      {/* Bet amount — stays visible during a match OR a search, greyed + inert (same treatment).
          The needs-bet frame (#143) rings it red when PLAY was pressed with no stake. scroll-mt
          clears the fixed top ribbon (~6rem); scroll-mb clears the fixed bottom nav (~7rem) +
          safe-area so a scrolled-in panel lands ABOVE the nav (robust to the #142 body-scroll). */}
      <div
        ref={betRef}
        data-testid="hub-section-bet"
        data-needs-bet={needsBet || undefined}
        className={cn(
          'scroll-mt-24 scroll-mb-[calc(7rem_+_env(safe-area-inset-bottom))] rounded-xl transition-shadow',
          needsBet && 'ring-2 ring-destructive',
          frozen && 'pointer-events-none opacity-50',
        )}
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Bet amount</span>
          <span className="text-sm font-extrabold tabular-nums text-foreground">
            {armedStake == null ? '—' : <Credits amount={armedStake} />}
          </span>
        </div>
        {/* grid-cols matches the OFFERED preset count, not BET_PRESETS.length — a withheld preset
            (issue #353) reflows the remaining ones evenly rather than leaving a gap. Only two
            counts exist in practice (6 full, 5 with one withheld), so a plain ternary is simpler
            than a dynamic Tailwind class. */}
        <div className={cn('grid gap-2', presets.length === BET_PRESETS.length ? 'grid-cols-6' : 'grid-cols-5')}>
          {presets.map((v) => (
            <button
              key={v}
              type="button"
              disabled={frozen}
              data-testid={`hub-bet-${v}`}
              // #381: the 1¢ preset is special-cased to reach the undocumented, bot-excluded
              // stake of 2 (tools/bot-crowd's HUMAN_RESERVED_STAKES) via a tap-again gesture —
              // tapping again while 1 is armed arms 2; tapping again while 2 is armed toggles
              // back to 1. Every other preset keeps its plain onArm(v). 2 is never its own
              // BET_PRESETS entry / grid button — only reachable through this one button's state.
              onClick={v === 1 ? () => onArm(armedStake === 1 ? 2 : 1) : () => onArm(v)}
              className={cn(
                'rounded-lg py-2.5 text-center text-[13px] font-bold tabular-nums transition-colors',
                armedStake === v || (v === 1 && armedStake === 2)
                  ? 'bg-brand text-white'
                  : 'bg-background text-muted-foreground hover:text-foreground',
              )}
            >
              <Credits amount={v === 1 && armedStake === 2 ? 2 : v} />
            </button>
          ))}
        </div>

        {/* Not colour-alone (#143): a short text hint paired with a polite live region for
            colourblind / screen-reader users. Always mounted as the live region (so the change is
            announced); shows the red hint only in the needs-bet state, clearing with the frame. */}
        <p
          role="status"
          aria-live="polite"
          data-testid="hub-bet-hint"
          className={cn('mt-2.5 text-xs font-semibold text-destructive', !needsBet && 'sr-only')}
        >
          {needsBet ? 'Select a bet amount to play' : ''}
        </p>

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
                    disabled={frozen}
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

      {/* Play a Friend transforms IN PLACE into the one active Cancel during a search (#154) — same
          button node, so no remount. Searching → "Cancel", active, wired to the hardened leaveQueue
          (#153). A game may transform it in place via secondaryActionSlot (Chess: Draw request ⇄
          Revoke DRAW in-match). Otherwise → purple, inert/visual-only (owner D1); greys with the
          panel in-match. The #143 needs-bet guard stays pre-wired for the idle Play-a-Friend path. */}
      {!searching && secondaryActionSlot ? (
        secondaryActionSlot
      ) : (
        <button
          type="button"
          {...(searching ? {} : { 'aria-disabled': 'true' as const })}
          data-testid={searching ? 'hub-cancel' : 'hub-play-friend'}
          onClick={searching ? onCancel : handlePlayFriend}
          className={cn(
            'w-full rounded-xl py-3.5 text-[15px] font-bold transition-colors',
            searching ? 'bg-surface text-foreground hover:brightness-110' : 'cursor-default bg-brand text-white',
            playing && 'opacity-50',
          )}
        >
          {searching ? 'Cancel' : 'Play a Friend'}
        </button>
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
 * Brief, self-dismissing result overlay (spec Q2). Generic win/lose/draw + the credits settlement
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
          <Credits amount={delta} showSign size={20} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">New balance: <strong className="text-foreground"><Credits amount={settlement.newBalance} /></strong></p>
      </motion.div>
    </div>
  );
}
