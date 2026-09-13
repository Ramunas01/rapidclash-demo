import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameMeta, Move, Outcome, SettlementSummary, OpenChallenge, PlayerClocks, AvatarId, GameEvent } from '@rapidclash/shared';
import { GUEST_COINFLIP_STAKE, GUEST_CHESS_STAKE, GUEST_CHESS_TIME_CONTROL, GUEST_BLACKJACK_STAKE, GUEST_CURATED_GAMES } from '@rapidclash/shared';
import { WsClient, hasStoredMatch, readStoredGameId, writeStoredGameId, type WsStatus } from './ws.js';
import { initGuestEvents, emitReady, emitResize, emitRequestFullscreenOnMobileEntry, emitFirstWin } from './guest/events.js';
import { applyChallengesUpdate } from './screens/OpenChallengesList.js';
import { AuthScreen } from './screens/Auth.js';
import { WalletScreen } from './screens/Wallet.js';
import { GameListScreen } from './screens/GameList.js';
import { StakeEntryScreen } from './screens/StakeEntry.js';
import { LobbyScreen } from './screens/Lobby.js';
import { PlayScreen } from './screens/Play.js';
import { ChessPlayScreen } from './screens/ChessPlay.js';
import { BlackjackPlayScreen } from './screens/BlackjackPlay.js';
import { MinesPlayScreen } from './screens/MinesPlay.js';
import { ResultScreen } from './screens/Result.js';
import { LeaderboardScreen } from './screens/Leaderboard.js';
import { CoinflipHubScreen } from './screens/CoinflipHub.js';
import { RpsHubScreen } from './screens/RpsHub.js';
import { BlackjackHubScreen } from './screens/BlackjackHub.js';
import { MinesHubScreen } from './screens/MinesHub.js';
import { RouletteHubScreen } from './screens/RouletteHub.js';
import { DiceHubScreen } from './screens/DiceHub.js';
import { BaccaratHubScreen } from './screens/BaccaratHub.js';
import { KenoHubScreen } from './screens/KenoHub.js';
import { LimboHubScreen } from './screens/LimboHub.js';
import { HiloHubScreen } from './screens/HiloHub.js';
import { ChessHubScreen } from './screens/ChessHub.js';
import { CrashHubScreen } from './screens/CrashHub.js';
import { HomeHubScreen } from './screens/HomeHub.js';
import { ProfileHubScreen } from './screens/ProfileHub.js';
import { RewardsHubScreen } from './screens/RewardsHub.js';
import { PreferencesHubScreen } from './screens/PreferencesHub.js';
import { AffiliateHubScreen } from './screens/AffiliateHub.js';
import { AuthModal } from './components/AuthModal.js';
import { api } from './api.js';
import { GuestGamePicker } from './screens/GuestGamePicker.js';

type Screen = 'auth' | 'home' | 'profile' | 'preferences' | 'affiliate' | 'rewards' | 'wallet' | 'game-list' | 'guest-loading' | 'guest-picker' | 'stake-entry' | 'lobby' | 'play' | 'result' | 'leaderboard' | 'coinflip-hub' | 'rps-hub' | 'blackjack-hub' | 'mines-hub' | 'chess-hub' | 'crash-hub' | 'roulette-hub' | 'dice-hub' | 'baccarat-hub' | 'keno-hub' | 'limbo-hub' | 'hilo-hub';

/** A commit-to-play action captured when a logged-out visitor hits the auth wall. After sign-in
 *  the user lands on the intent's hub with the stake armed and presses PLAY to commit — nothing
 *  auto-fires. */
type AuthIntent =
  | { action: 'play'; gameId: string; stake: number; timeControlId?: string }
  | { action: 'join'; matchId: string; gameId: string; stake: number };

const RECONNECT_NOTICE = 'Connection lost — reconnecting. Try again in a moment.';

/** Games that play through the shared one-screen Game hub (vs the multi-screen flow).
 *  Each maps to a `<gameId>-hub` screen. Adding a game here wires it to the hub. */
const HUB_GAMES = new Set(['coinflip', 'rps', 'blackjack', 'mines', 'chess', 'crash', 'roulette', 'dice', 'baccarat', 'keno', 'limbo', 'hilo']);
const hubScreenFor = (gameId: string | null | undefined): Screen | null =>
  gameId && HUB_GAMES.has(gameId) ? (`${gameId}-hub` as Screen) : null;
const isGameHubScreen = (s: Screen): boolean =>
  s === 'coinflip-hub' || s === 'rps-hub' || s === 'blackjack-hub' || s === 'mines-hub' || s === 'chess-hub' || s === 'crash-hub' || s === 'roulette-hub' || s === 'dice-hub' || s === 'baccarat-hub' || s === 'keno-hub' || s === 'limbo-hub' || s === 'hilo-hub';

export interface RpsView {
  players: [string, string];
  choices: Partial<Record<string, string>>;
  /** Round scaffolding (public) — bumps on each tie replay. */
  round?: number;
  /** Absolute ms when the fixed pick window closes and both throws lock (server-authoritative). */
  windowEndsAt?: number;
  forcedOutcome?: { type: string; winner?: string };
}

export interface CoinflipView {
  players: [string, string];
  /** Both players choose a side independently (mirrors RpsView). The opponent's choice is
   *  stripped by viewFor until terminal. */
  choices: Partial<Record<string, string>>;
  /** Present ONLY at terminal — the server strips it pre-terminal via viewFor. */
  result?: string;
  /** Round scaffolding (public) — bumps on each tie replay. */
  round?: number;
  /** Consecutive tie-replays (public) — a rise drives the shared draw beat. */
  replays?: number;
  /** Absolute ms when the fixed pick window closes and both picks lock (server-authoritative).
   *  Drives the cosmetic countdown; re-stamped each replay so the ring restarts. */
  windowEndsAt?: number;
  /** The previous, fully-resolved round (public — a finished round, revealed). On a same-side draw
   *  it carries the flip + both picks so the client animates reveal → flip during the draw beat. */
  lastResult?: { round: number; result: string; choices: Partial<Record<string, string>>; winner: string | null };
  forcedOutcome?: { type: string; winner?: string };
}

/** A chess move in the module's JSON shape (see packages/games/chess). `applyMove`
 *  expects exactly this; `legalMoves` arrives as an array of these. */
export interface ChessMove {
  from: string;
  to: string;
  promotion?: string;
}

export interface ChessView {
  /** players[0] = white, players[1] = black. */
  players: [string, string];
  /** Whole position as a FEN string (chess is perfect-info — nothing redacted). */
  fen: string;
  /** Cumulative per-player clocks (perfect-info → both exposed). Display-only; server-authoritative. */
  clock?: PlayerClocks;
  forcedOutcome?: { type: string; winner?: string };
  /** Player-initiated draw offers (CHESS_DRAW_OFFER.md): a player id present here holds an active
   *  offer (value = the offerer's remaining backstop moves). Public — both clients render it. */
  drawOffers?: Record<string, number>;
}

export interface BlackjackCard {
  rank: string;
  suit: string;
}
export interface BlackjackHand {
  cards: BlackjackCard[];
  done: boolean;
}
export interface BlackjackView {
  players: [string, string];
  round: number;
  draws: number;
  /** Public mirror of `draws` — a rise drives the shared draw beat (#161), same as every other
   *  tie-replay game's `replays`. */
  replays?: number;
  /** Redacted by viewFor: own hand is full; the opponent shows exactly ONE card in play.
   *  At terminal both hands are revealed (but the app navigates to the result screen then). */
  hands: Record<string, BlackjackHand>;
  /** The just-resolved round (both hands fully revealed), carried across an internal replay so the
   *  client can HOLD the pushed hands on the board during the draw beat (red = bust, orange = tie). */
  lastResult?: {
    round: number;
    result: 'win' | 'draw';
    winner?: string;
    hands: Record<string, { cards: BlackjackCard[]; total: number }>;
  };
  /** Present only at terminal (revealed for verifiability). */
  seed?: number;
  winner?: string;
  forcedOutcome?: { type: string; winner?: string };
}

/** One player's board within a redacted Mines view (see packages/games/mines). The own
 *  board carries `uncovered` (+ `mines` once locked); the opponent's carries only `locked`
 *  and, once either player locks, `score` — never their square layout. */
export interface MinesBoardView {
  uncovered?: number[];
  locked: boolean;
  bustedOn?: number;
  mines?: number[];
  score?: number;
}

export interface MinesView {
  players: [string, string];
  round: number;
  draws: number;
  boards: Record<string, MinesBoardView>;
  /** When the CURRENT round's 30s clock started (ms) — T8: drives the client-side round-clock
   *  countdown (`roundStartedAt + 30_000`, mirroring the server's own `scheduledDeadlines` math
   *  in packages/games/mines/src/mines.ts). Public per-round timing metadata; reveals no mine
   *  position or opponent score. */
  roundStartedAt?: number;
  winner?: string;
  forcedOutcome?: { type: string; winner?: string };
  /** Full mine layout — present only at terminal (full reveal). */
  mines?: number[];
}

/** Redacted Crash view (see packages/games/crash). `startedAt` (public) drives the client's
 *  display-only climb; `crashAltitude` (C) and the opponent's result are present ONLY at terminal.
 *  `results[me]` appears the moment this player ejects/crashes (they see their own eject at once). */
export interface CrashResultView {
  altitude: number;
  crashed: boolean;
}
export interface CrashView {
  players: [string, string];
  /** Public phase boundaries (ms): SETUP ends, then the climb origin a brief ignition later. */
  setupEndsAt: number;
  startedAt: number;
  crashAltitude?: number;
  /** Each player's pre-set auto-eject (own visible; opponent's only at terminal). */
  autoEject?: Record<string, number | undefined>;
  results: Record<string, CrashResultView | undefined>;
  terminal?: boolean;
}
/** Roulette redacted view. During betting my own `allocation` is full; the opponent's is `{}` and
 *  only their `locked` flag shows (hidden until both lock). `lastResult` (a resolved round) is
 *  public; the spin seed/pocket and both allocations reveal at terminal. Chips are scoring units,
 *  never credits. */
export interface RouletteBetView {
  allocation?: Record<string, number>;
  locked: boolean;
  autoSpread?: boolean;
  stack?: number;
}
export interface RouletteRoundResult {
  round: number;
  pocket: number;
  bets: Record<string, Record<string, number>>;
  stacks: Record<string, number>;
}
export interface RouletteView {
  players: [string, string];
  round: number;
  replays: number;
  bets: Record<string, RouletteBetView>;
  lastResult?: RouletteRoundResult;
  winner?: string;
  forcedOutcome?: { type: string; winner?: string };
  seed?: number;
}

/** Keno redacted view: my own `picks` are full while choosing; the opponent's is `[]` and only
 *  their `locked` flag shows (hidden until both lock). `lastResult` (a resolved round) + the draw
 *  are public; the seed is stripped pre-terminal. */
export interface KenoPlayerView {
  picks?: number[];
  locked: boolean;
  autoFilled?: boolean;
}
export interface KenoRoundResult {
  round: number;
  draw: number[];
  picks: Record<string, number[]>;
  matched: Record<string, number>;
}
export interface KenoView {
  players: [string, string];
  round: number;
  replays: number;
  picks: Record<string, KenoPlayerView>;
  lastResult?: KenoRoundResult;
  winner?: string;
  forcedOutcome?: { type: string; winner?: string };
  seed?: number;
}

/** Limbo redacted view: my own `target` shows while choosing; the opponent's is null and only
 *  their `locked` flag shows (hidden until both lock). `lastResult` (roll + both targets) is
 *  public; the seed is stripped pre-terminal. */
export interface LimboPlayerView {
  target?: number | null;
  locked: boolean;
  auto?: boolean;
}
export interface LimboRoundResult {
  round: number;
  roll: number;
  targets: Record<string, number>;
  winner: string | null;
}
export interface LimboView {
  players: [string, string];
  round: number;
  replays: number;
  picks: Record<string, LimboPlayerView>;
  lastResult?: LimboRoundResult;
  winner?: string;
  forcedOutcome?: { type: string; winner?: string };
  seed?: number;
}

/** Hilo redacted view: my own progress carries my current `card` + position/streak; the opponent's
 *  is `{}` (hidden until terminal). `startedAt`/`endsAt` (the shared 30s clock) are public; the seed
 *  is stripped pre-terminal (it would reveal future cards). */
export interface HiloCard {
  rank: number;
  suit: string;
}
export interface HiloProgressView {
  position?: number;
  busted?: boolean;
  frozen?: boolean;
  card?: HiloCard;
  bustCard?: HiloCard;
}
export interface HiloView {
  players: [string, string];
  round: number;
  replays: number;
  startedAt: number;
  endsAt: number;
  progress: Record<string, HiloProgressView>;
  lastResult?: { round: number; streaks: Record<string, number> };
  winner?: string;
  forcedOutcome?: { type: string; winner?: string };
  seed?: number;
}

/** Redacted Dice view (independent-roll). Pre-terminal carries only the public scaffolding; the
 *  rolls + seeds appear only in `result`/`seeds` at the simultaneous reveal (terminal). */
export interface DiceView {
  players: [string, string];
  seeds: Record<string, number>;
  round: number;
  replays: number;
  revealed: Record<string, boolean>;
  result?: { rolls: Record<string, number>; round: number };
  winner?: string;
  forcedOutcome?: { type: string };
}

/** Redacted Baccarat view. Pre-terminal carries the viewer's OWN hand (`hands[me]`); the opponent's
 *  hand + both seeds appear only at terminal (`result`/`seeds`). */
export interface BaccaratCard { rank: string; suit: string; }
export interface BaccaratHand { cards: BaccaratCard[]; total: number; natural: boolean; }
export interface BaccaratView {
  players: [string, string];
  seeds: Record<string, number>;
  round: number;
  replays: number;
  revealed: Record<string, boolean>;
  hands?: Record<string, BaccaratHand>;
  result?: { hands: Record<string, BaccaratHand>; round: number };
  winner?: string;
  forcedOutcome?: { type: string };
}

/** A per-game redacted view as it arrives from the server. The active game (and so
 *  which screen renders it) is tracked separately in `activeGameId`. */
export type GameView = RpsView | CoinflipView | ChessView | BlackjackView | MinesView | CrashView | RouletteView | DiceView | BaccaratView | KenoView | LimboView | HiloView;

/** Coerce a persisted avatar id back to a valid AvatarId (defensive — an old/edited store could
 *  carry anything). Defaults to `'default'`. Kept local so App has no runtime dep on the enum list. */
function loadAvatarId(): AvatarId {
  const v = localStorage.getItem('rc_avatarId');
  const VALID: AvatarId[] = ['default', 'boy-light', 'girl-light', 'boy-brown', 'boy-dark', 'hooded-mono', 'hooded-degen'];
  return (VALID as string[]).includes(v ?? '') ? (v as AvatarId) : 'default';
}

function loadAuth() {
  return {
    token: localStorage.getItem('rc_token'),
    playerId: localStorage.getItem('rc_playerId'),
    username: localStorage.getItem('rc_username'),
    avatarId: loadAvatarId(),
  };
}

/** `?mode=guest` on the entry URL (issue #284, GUEST_MODE_CONTRACT.md §1 "a stable guest entry
 *  (route/flag)") — the iframe-embed trigger: an embed loads straight into the curated guest
 *  surface, no login/home screen, no tap. Query-string only (no dedicated route) — this app has
 *  no client-side router, just the `Screen` union + `setScreen`, so a router-less URL check fits
 *  the existing shape. */
function isGuestModeUrl(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('mode') === 'guest';
  } catch {
    return false;
  }
}

export function App() {
  const { token: savedToken, playerId: savedPlayerId, username: savedUsername, avatarId: savedAvatarId } = loadAuth();
  // A match persisted across a reload restores straight to the play view; match.state
  // (active) keeps us there, match.end (terminal) redirects to the result screen. A stored
  // coinflip match resumes onto the hub (in-place flow), not the standalone play screen.
  // Everyone lands on the Home hub — a logged-out visitor browses there and only hits the
  // auth wall at the commit-to-play action. (The full 'auth' screen stays for back-compat.)
  // `?mode=guest` (issue #284) with no already-persisted real session takes priority over both:
  // land on the blank guest-loading screen instead of a Home-hub flash while the guest-auth
  // network call (fired from an effect below) is in flight.
  const [screen, setScreen] = useState<Screen>(
    savedToken && hasStoredMatch() ? (hubScreenFor(readStoredGameId()) ?? 'play')
      : !savedToken && isGuestModeUrl() ? 'guest-loading'
      : 'home',
  );
  const [token, setToken] = useState<string | null>(savedToken);
  const [playerId, setPlayerId] = useState<string | null>(savedPlayerId);
  // The player's own alias — shown so they always know "who you are" (#34). Persisted
  // in lockstep with playerId so a reload still knows the alias before any WS traffic.
  const [username, setUsername] = useState<string | null>(savedUsername);
  // The player's OWN avatar (preset id or 'default'), persisted in lockstep with username so a
  // reload shows it before any traffic. Own-session only — the opponent's avatar is never on the
  // wire (redaction, Charter #2). Set from AuthResponse on auth and by handleSetAvatar on picker save.
  const [avatarId, setAvatarId] = useState<AvatarId>(savedAvatarId);
  // Anonymous guest session (CHARTER.md's guest-mode exception, issue #267). React state ONLY —
  // deliberately never persisted to localStorage (unlike the real-auth fields above), so a page
  // reload naturally drops it: GUEST_MODE_CONTRACT.md's "resets on reload" is satisfied by
  // construction, not by an explicit clear-on-unload hook.
  const [isGuest, setIsGuest] = useState(false);
  // Guest mode's pre-armed time control (issue #279) — set when a picker tile is chosen, fixed at
  // GUEST_CHESS_TIME_CONTROL for chess, undefined for every other curated game (Coinflip has none).
  const [guestTimeControl, setGuestTimeControl] = useState<string | undefined>(undefined);
  const [balance, setBalance] = useState(0);
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  // The opponent's real display name, known ONLY when we JOINed their open challenge (its owner
  // name). Null on the PLAY/post path — the joiner's name never reaches the client. Never derived
  // from an id and never fabricated (the hub falls back to a neutral "Opponent").
  const [opponentName, setOpponentName] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameView | null>(null);
  // The last match.state broadcast's raw GameEvent[] (2026-09-11#9 item 2). Most broadcasts carry
  // none (provisional picks emit no events — see rps.ts's applyMove doc comment); a module may
  // include event-only PUBLIC data here — e.g. RPS's `new_round` reveals a tied round's throws via
  // `revealedChoices`, per GAME_MODULE_INTERFACE.md's "nothing secret in an event" rule this is
  // always redaction-safe to hand straight to every hub screen. App.tsx only threads this array
  // through (via GameHubScreenProps → GameAreaArgs); interpreting a given event type is each game
  // area component's own job (only RpsHub.tsx's RpsBoard reads it today).
  const [lastMatchEvents, setLastMatchEvents] = useState<GameEvent[]>([]);
  // Client→server clock offset (ms): `serverNow − clientNow` from the match payload. The hub adds
  // it to Date.now() so display-only timers (Crash's live altitude) align to the server's clock.
  const [serverClockOffset, setServerClockOffset] = useState(0);
  // The game whose match is currently active — drives which play screen renders.
  // Persisted alongside currentMatchId (#10) so a mid-match reload resumes the right one.
  const [activeGameId, setActiveGameId] = useState<string | null>(readStoredGameId());
  // Heterogeneous across games: RPS/Coinflip send string moves, chess sends {from,to,…}
  // objects. Typed as the contract's opaque Move; each play screen narrows it.
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  const [lastOutcome, setLastOutcome] = useState<Outcome | null>(null);
  const [lastSettlement, setLastSettlement] = useState<SettlementSummary | null>(null);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [pendingStake, setPendingStake] = useState(0);
  // The time control picked for the current join (chess); reused on a re-post. undefined → 'none'.
  const [pendingTimeControl, setPendingTimeControl] = useState<string | undefined>(undefined);
  const [pendingGameMeta, setPendingGameMeta] = useState<GameMeta | null>(null);
  // Open-challenges feed (stake screen) + owner lobby countdown/expiry state.
  const [challenges, setChallenges] = useState<OpenChallenge[]>([]);
  const [challengesMore, setChallengesMore] = useState(0);
  // Home hub's CROSS-GAME ticker: each game's feed kept separately, keyed by gameId, and
  // merged client-side. homeGamesRef holds the currently-tracked games so a reconnect can
  // re-subscribe them all.
  const [homeChallenges, setHomeChallenges] = useState<Record<string, OpenChallenge[]>>({});
  const homeGamesRef = useRef<string[]>([]);
  const [challengeNotice, setChallengeNotice] = useState<string | null>(null);
  const [waitingExpiresAt, setWaitingExpiresAt] = useState<number | null>(null);
  const [lobbyExpired, setLobbyExpired] = useState(false);
  // Connection status (#30): drives the "Reconnecting…" banner. `actionNotice` surfaces a
  // dropped action (join/move/take attempted while the socket was down) instead of a silent no-op.
  const [wsStatus, setWsStatus] = useState<WsStatus>('connected');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  // Bumped when the WS client is (re)created so the handler-wiring effect below re-runs
  // and binds handlers on the new socket before its async onopen fires.
  const [, setWsEpoch] = useState(0);
  const wsRef = useRef<WsClient | null>(null);

  // ── Auth wall (logged-out → commit-to-play) ─────────────────────────────────
  const loggedIn = token !== null;
  const [authOpen, setAuthOpen] = useState(false);
  // The captured commit-to-play intent: after sign-in the user lands on this intent's hub with the
  // stake pre-armed (nothing auto-fires — they press PLAY to commit); cleared on cancel.
  const pendingResumeRef = useRef<AuthIntent | null>(null);
  const [prearmStake, setPrearmStake] = useState<number | undefined>(undefined);
  // #152: true only between an explicit user PLAY this session and the match forming / cancel.
  // Gates onQueueWaiting so a stray/leaked queue.waiting can never auto-enter "Searching…", and
  // marks a search as in-flight so navigating away abandons it. searchGameRef records which game
  // to leave (a ref, so nav callbacks read it without stale closures).
  const searchingRef = useRef(false);
  const searchGameRef = useRef<string | null>(null);

  const handleLogin = useCallback((tok: string, pid: string, bal: number, name: string, avatar: AvatarId) => {
    localStorage.setItem('rc_token', tok);
    localStorage.setItem('rc_playerId', pid);
    localStorage.setItem('rc_username', name);
    localStorage.setItem('rc_avatarId', avatar);
    setToken(tok);
    setPlayerId(pid);
    setUsername(name);
    setAvatarId(avatar);
    setBalance(bal);

    const ws = new WsClient(tok, {});
    wsRef.current = ws;
    ws.connect();
    setScreen('home');
  }, []);

  /** Open the auth modal. `intent` (if any) sets where the user lands (stake armed) after sign-in. */
  const openAuth = useCallback((intent: AuthIntent | null) => {
    pendingResumeRef.current = intent;
    setAuthOpen(true);
  }, []);
  const closeAuth = useCallback(() => {
    setAuthOpen(false);
    pendingResumeRef.current = null; // cancelled → drop the captured intent
  }, []);

  // #152: abandon any in-flight, user-initiated search and clear all "searching" carry-over so it
  // can never leak into the next hub. Called on plain navigation away from a hub. If a search is
  // live it leaves the server queue (which refunds the escrow — never stranded), then clears the
  // local waiting state plus the captured resume/pre-arm intents. Idempotent; a no-op if not
  // searching. The explicit Cancel (handleLeaveQueue) keeps its own path unchanged.
  const clearHubSearch = useCallback(() => {
    if (searchingRef.current && searchGameRef.current) {
      wsRef.current?.leaveQueue(searchGameRef.current); // server refunds the escrowed stake
    }
    searchingRef.current = false;
    searchGameRef.current = null;
    setWaitingExpiresAt(null);
    setLobbyExpired(false);
    pendingResumeRef.current = null;
    setPrearmStake(undefined);
  }, []);

  // The round-scoped VIEW state — the finished board (opponent + both pick pills / choices + the
  // verdict all read off `gameState`) — wiped as ONE unit. Fired only on the DESTROY events: PLAY /
  // new search (handleJoinQueue), and leaving/entering a hub (the nav effect below + handleSelectGame)
  // — so a new game or a fresh visit always starts clean ("name goes, pills survive" bug). Deliberately
  // NOT fired on the result overlay's auto-dismiss: the idle post-round result view must persist while
  // the player sits on the finished round, until they PLAY or navigate.
  const resetRoundState = useCallback(() => {
    setLastOutcome(null);
    setLastSettlement(null);
    setGameState(null);
    setOpponentId(null);
    setOpponentName(null);
  }, []);

  // #152: leaving a game hub (to Home / Profile / Wallet / another hub) abandons an in-flight
  // user search so it can't resurface as "Searching…" on the next hub — and so no surprise match
  // forms on the still-open socket after you walked away. Fires only when a search was actually in
  // flight (searchingRef); a match that just formed clears searchingRef first, so this never
  // leaves a live match's queue.
  const prevScreenRef = useRef(screen);
  useEffect(() => {
    const prev = prevScreenRef.current;
    prevScreenRef.current = screen;
    if (prev !== screen && isGameHubScreen(prev)) {
      // Leaving a hub → wipe the finished-round view (so re-entering is a clean idle page) and abandon
      // any in-flight search (clearHubSearch guards its own leaveQueue, so it's a no-op if not searching).
      resetRoundState();
      clearHubSearch();
    }
  }, [screen, clearHubSearch, resetRoundState]);

  // #152 follow-up: the lobby countdown is a display timer off the owner's server `expiresAt`. If
  // it passes with no match forming — and no server `challenge.expired` arrives to flip lobbyExpired
  // — the hub must NOT dead-end stuck at "0:00" (only Cancel would clear it). Arm a client timer at
  // the deadline that auto-resolves: leave the queue (best-effort refund), drop the in-flight
  // markers, and land on the "No opponent found — try again" state (bet re-enabled). Idempotent
  // with the server event; a formed match (currentMatchId) or a cleared expiry disarms it.
  useEffect(() => {
    if (waitingExpiresAt == null || currentMatchId) return;
    const resolveExpiry = () => {
      if (searchingRef.current && searchGameRef.current) {
        wsRef.current?.leaveQueue(searchGameRef.current); // server refunds the escrowed stake
      }
      searchingRef.current = false;
      searchGameRef.current = null;
      setLobbyExpired(true);
      setWaitingExpiresAt(null);
    };
    const ms = waitingExpiresAt - Date.now();
    if (ms <= 0) {
      // An already-past deadline: fire the failure ONLY if a search is genuinely in flight — the
      // server can hand a live search an already-expired `expiresAt` and it must still resolve to
      // "No opponent found" rather than dead-end at 0:00 (#152). If NO search is live (searchingRef
      // false), this is a STALE remnant that outlived its search — drop it silently, never flash the
      // failure while idle ("search state is search-scoped; nothing may fire after the search ends" —
      // Bug 2's stale-value-survives-the-match symptom, belt-and-suspenders behind the match-start clear).
      if (searchingRef.current) resolveExpiry();
      else setWaitingExpiresAt(null);
      return;
    }
    const t = setTimeout(resolveExpiry, ms);
    return () => clearTimeout(t);
  }, [waitingExpiresAt, currentMatchId]);

  // Register/login from the modal: store the token + connect the WS (as handleLogin), then land the
  // user on the intent's hub with the stake ARMED — nothing auto-fires. They press PLAY to commit
  // (a PLAY intent) or post their own challenge (a JOIN intent). No resume runs on connect.
  const handleAuthSuccess = useCallback((tok: string, pid: string, bal: number, name: string, avatar: AvatarId) => {
    localStorage.setItem('rc_token', tok);
    localStorage.setItem('rc_playerId', pid);
    localStorage.setItem('rc_username', name);
    localStorage.setItem('rc_avatarId', avatar);
    setToken(tok);
    setPlayerId(pid);
    setUsername(name);
    setAvatarId(avatar);
    setBalance(bal);
    const ws = new WsClient(tok, {});
    wsRef.current = ws;
    setWsEpoch((n) => n + 1); // rebind handlers on the new socket before its onopen fires
    ws.connect();
    setAuthOpen(false);

    const intent = pendingResumeRef.current;
    if (intent) {
      // Land on the intent's hub so the user resumes in place — but with the stake pre-armed (PLAY
      // ready), NOT auto-searching. For a 'play' intent, initialStake feeds the hub's bet row so it
      // opens armed; chess also pre-arms the picked time control. A 'join' intent likewise lands the
      // hub armed at that stake (post-your-own, no auto-join).
      setPendingGameId(intent.gameId);
      setScreen(hubScreenFor(intent.gameId) ?? 'home');
      setPrearmStake(intent.stake);
      if (intent.action === 'play') {
        setPendingTimeControl(intent.timeControlId);
      }
    } else if (screen === 'auth') {
      setScreen('home'); // legacy full-screen path
    }
    pendingResumeRef.current = null; // nothing consumes it on connect anymore
  }, [screen]);

  // "Play as guest" from the modal (CHARTER.md's guest-mode exception, issue #267): connect the WS
  // exactly like a real sign-in, but store NOTHING in localStorage (a reload must drop the session
  // — GUEST_MODE_CONTRACT.md). Lands on the guest picker (issue #279) rather than jumping straight
  // into a game — the curated set is data (GUEST_CURATED_GAMES), so which game(s) exist here is not
  // this handler's decision. No auth intent to resume: guest mode never originates from a captured
  // PLAY/JOIN intent.
  const handleGuestSuccess = useCallback((tok: string, pid: string, bal: number) => {
    setToken(tok);
    setPlayerId(pid);
    setUsername('Guest');
    setAvatarId('default');
    setBalance(bal);
    setIsGuest(true);
    const ws = new WsClient(tok, {});
    wsRef.current = ws;
    setWsEpoch((n) => n + 1);
    ws.connect();
    setAuthOpen(false);
    pendingResumeRef.current = null;

    setScreen('guest-picker');
  }, []);

  // A tile pick on the guest picker (issue #279) routes straight into that game's hub with the
  // guest's stake PRE-ARMED at the game's own guest-stake constant from `packages/shared` — per-game
  // (GUEST_COINFLIP_STAKE / GUEST_CHESS_STAKE / GUEST_BLACKJACK_STAKE, all 100 today, #278 §6 /
  // #297) rather than reusing one constant across games, so a future guest game with a different
  // ceiling can't silently drift from the pooled Demo-Opponent(s), which rest at that exact stake.
  // This is only a DEFAULT, not a lock (issue #353): PlayPanel's bet grid in GameHub.tsx is
  // genuinely interactive for a guest, who may re-arm any other offered preset before pressing
  // PLAY — the grid just withholds GUEST_HUMAN_RESERVED_STAKE (1) so a guest can never land there.
  // Chess additionally needs its fixed time control pre-armed (GUEST_CHESS_TIME_CONTROL, 'blitz5'
  // — the same shared constant #278's real bot pool rests at, imported here rather than
  // duplicated, now that #278 has actually landed) since guest mode has no time-control picker
  // either; every other curated game (Coinflip, Blackjack — #297 has no time-control concept
  // either) leaves it undefined.
  const handleGuestSelectGame = useCallback((gameId: string) => {
    setPendingGameId(gameId);
    setPrearmStake(
      gameId === 'chess' ? GUEST_CHESS_STAKE : gameId === 'blackjack' ? GUEST_BLACKJACK_STAKE : GUEST_COINFLIP_STAKE,
    );
    setGuestTimeControl(gameId === 'chess' ? GUEST_CHESS_TIME_CONTROL : undefined);
    setScreen(hubScreenFor(gameId) ?? 'guest-picker');
  }, []);

  // URL-based guest entry (issue #284, GUEST_MODE_CONTRACT.md §1): `?mode=guest` on initial load
  // mints a guest session and lands on the guest surface with no tap required — an iframe embed
  // has no visible login/home screen to tap through. Reuses handleGuestSuccess verbatim (the same
  // path "Play as guest" drives) rather than duplicating any of its session-setup logic.
  //
  // Judgment call (issue #284): the contract's §2 config params (games/credits/chrome) are NOT
  // also read from the URL here — they stay solely on the postMessage `config` channel (#271).
  // Reasons: (1) that channel already validates the sender's origin against the CSP allowlist;
  // a URL query string has no equivalent trust boundary, so any direct visitor (not just the
  // landing embed) could set them; (2) nothing client- or server-side actually varies its
  // behavior off these params today (the curated set/stake/credits are all fixed constants) — URL
  // parsing for them would be unused plumbing. Revisit if a real per-request config need appears.
  //
  // Guarded by a ref (not just the effect's empty deps) so React 18 StrictMode's dev double-invoke
  // (main.tsx wraps <App/> in <StrictMode>) can't mint two guest sessions — cheap per-session, but
  // rate-limited (issue #270) and wasteful to double-fire on every dev mount. Skipped entirely if
  // a real session is already persisted (savedToken) — a `?mode=guest` link never hijacks an
  // already-signed-in visitor.
  const guestUrlEntryFired = useRef(false);
  useEffect(() => {
    if (guestUrlEntryFired.current) return;
    if (savedToken || !isGuestModeUrl()) return;
    guestUrlEntryFired.current = true;
    api.guestAuth()
      .then((res) => handleGuestSuccess(res.token, res.playerId, res.balance))
      .catch((err) => {
        console.error('[guest] ?mode=guest entry failed', err);
        setScreen('home'); // fall back to the normal flow rather than a stuck loading screen
      });
  // eslint-disable-next-line -- savedToken is intentionally read once on mount (mirrors the WS-on-mount effect below)
  }, []);

  // Guest-mode postMessage protocol (GUEST_MODE_CONTRACT.md §5, issue #271): listen from mount,
  // not gated on isGuest — an embedding landing page can send `config` right after the iframe
  // loads, before any visitor has picked "Play as guest", and that's the only chance to capture
  // its validated origin from that early message. Harmless outside an embedded context: nothing
  // ever arrives, and outbound emit* calls below only ever fire from guest-mode code paths.
  useEffect(() => initGuestEvents(), []);

  // `ready` + the mobile `requestFullscreen` trigger fire once the guest surface is actually up.
  // Issue #279 changed guest entry from a direct jump into the Coinflip hub to landing on the
  // picker first — `ready` no longer waits for one specific hub screen (it used to gate on
  // `screen === 'coinflip-hub'`, which would never have fired for a guest who only ever visits the
  // picker + chess-hub); the picker itself is already "the guest surface mounted and interactive".
  // Gating on isGuest alone is correct here regardless of which screen a guest is currently on.
  // Both emit* calls are self-guarded to fire at most once per session, so re-running this effect
  // on every render (e.g. every picker→hub transition) is harmless.
  useEffect(() => {
    if (!isGuest) return;
    emitReady();
    // Judgment call (issue #271): fire automatically on mobile guest entry rather than requiring
    // a manual "enlarge" tap — no such affordance exists in the UI yet, and the contract's intent
    // ("mobile: step into the app") reads as an automatic transition. Coarse pointer is the
    // signal, not viewport width: the guest surface is narrow/portrait on desktop too (§3's
    // phone-mockup shell), so width alone can't tell mobile and desktop apart from inside the frame.
    const isMobile = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    emitRequestFullscreenOnMobileEntry(isMobile);
  }, [isGuest]);

  // `resize` — a ResizeObserver on the app root reports genuine content-height changes (not
  // spurious per-render noise) so the landing shell can size to content. Guest-only: the
  // registered platform is never embedded, so there's nothing for a real session to report.
  useEffect(() => {
    if (!isGuest || typeof ResizeObserver === 'undefined') return;
    const target = document.getElementById('root');
    if (!target) return;
    const ro = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height != null) emitResize(Math.round(height));
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, [isGuest]);

  // Defense-in-depth (issue #283): whatever the trigger — a stray nav element this ticket missed,
  // browser back/forward, a future regression — a guest session must never sit on a hub screen
  // for a game outside GUEST_CURATED_GAMES. That combination is always a dead end: `isGuest`
  // never resets mid-session, and reaching an uncurated hub happens outside the guest's own
  // curated entry (`handleGuestSelectGame` below is the only path that arms a stake and picks a
  // time control for a guest) — there's no picker to back out to, and no reason to trust an
  // uncurated hub's own queue-join wiring for an isolated guest session. Snap back to the guest's
  // fixed curated entry point instead of leaving them on it, whether or not they'd have been able
  // to arm a stake there.
  useEffect(() => {
    if (!isGuest || !isGameHubScreen(screen)) return;
    const gameId = screen.replace('-hub', '');
    if (GUEST_CURATED_GAMES.includes(gameId)) return;
    setPendingGameId('coinflip');
    setPrearmStake(GUEST_COINFLIP_STAKE);
    setScreen('coinflip-hub');
  }, [isGuest, screen]);

  /** Find a challenge (its gameId + stake) by matchId across the home + single-game feeds. */
  const lookupChallenge = useCallback((matchId: string): { gameId: string; stake: number } | null => {
    for (const [gid, list] of Object.entries(homeChallenges)) {
      const c = list.find((x) => x.matchId === matchId);
      if (c) return { gameId: gid, stake: c.stake };
    }
    const c2 = challenges.find((x) => x.matchId === matchId);
    if (c2 && pendingGameId) return { gameId: pendingGameId, stake: c2.stake };
    return null;
  }, [homeChallenges, challenges, pendingGameId]);

  // Wire WS handlers whenever screen/state changes
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    // While a Game hub is active it drives the whole flow IN PLACE: suppress the screen
    // navigations below and let the hub derive its sub-state from the same App state.
    const onHub = isGameHubScreen(screen);
    ws.setHandlers({
      onMatchStart(payload, matchId) {
        // The search resolved into a match — it's no longer "in flight", so leaving the hub
        // now must NOT try to leave a queue we're no longer in (#152).
        searchingRef.current = false;
        searchGameRef.current = null;
        setCurrentMatchId(matchId);
        // The search is over the moment a match forms — drop its deadline so the expiry effect can
        // never re-arm and flash "No opponent found" after the game ends (search state is
        // search-scoped; nothing of it may fire once the search resolves into a match). #Bug2.
        setWaitingExpiresAt(null);
        setLobbyExpired(false);
        setOpponentId(payload.opponent);
        // Server-authoritative opponent alias — the real name on BOTH the PLAY and JOIN paths
        // (a public alias, not hidden state). Supersedes the JOIN-only ownerName capture below.
        setOpponentName(payload.opponentName ?? null);
        if (payload.serverNow != null) setServerClockOffset(payload.serverNow - Date.now());
        setGameState(payload.state as GameView);
        // A fresh match starts with no events yet — clear a prior match's stale ones so a leftover
        // reveal can never bleed into the new match's board.
        setLastMatchEvents([]);
        // Route from the server-authoritative gameId (Charter invariant #2), not the
        // local pendingGameId — the take-challenge path never set pendingGameId, which
        // silently rendered the default (RPS) board for the wrong game. Persist it so a
        // reload resumes the correct play screen.
        setActiveGameId(payload.gameId);
        writeStoredGameId(payload.gameId);
        setLegalMoves([]);
        // Hub games (Coinflip, RPS) land on their one-screen hub; others use the play screen.
        setScreen(hubScreenFor(payload.gameId) ?? 'play');
      },
      onMatchState(payload, matchId) {
        const state = payload.state as GameView;
        setGameState(state);
        setLastMatchEvents(payload.events ?? []);
        // On a reload-driven resume, restore match identity + opponent + screen so the
        // user lands back in the live match (these are already set during normal play).
        if (matchId) { setCurrentMatchId(matchId); setWaitingExpiresAt(null); setLobbyExpired(false); }
        if (playerId) {
          const opp = state.players.find((p) => p !== playerId);
          if (opp) setOpponentId(opp);
        }
        // On reconnect/reload, restore the opponent's real alias from the resume payload (the
        // in-memory name is lost on reload; per-move broadcasts omit it and must not clear it).
        if (payload.opponentName) setOpponentName(payload.opponentName);
        if (payload.serverNow != null) setServerClockOffset(payload.serverNow - Date.now());
        // Hub games resume onto their hub (in-place); other games use the play screen.
        setScreen((s) => (isGameHubScreen(s) ? s : (hubScreenFor(activeGameId) ?? 'play')));
      },
      onMatchYourTurn(payload, _matchId) {
        setLegalMoves(payload.legalMoves);
      },
      onMatchEnd(payload, _matchId) {
        setLastOutcome(payload.outcome);
        setLastSettlement(payload.settlement);
        setBalance(payload.settlement.newBalance);
        setCurrentMatchId(null);
        // Guest-mode `firstWin` (GUEST_MODE_CONTRACT.md §5, issue #271): the module itself
        // guards "exactly once per session" — safe to call on every guest win.
        if (isGuest && payload.outcome.type === 'win' && payload.outcome.winner === playerId) {
          emitFirstWin();
        }
        // Match over — clear the persisted active game in lockstep with the matchId.
        writeStoredGameId(null);
        setLegalMoves([]);
        // On the hub the result shows as an in-place overlay (no navigation); the hub sees
        // currentMatchId clear + lastOutcome set and presents it. Others go to the result screen.
        if (!onHub) setScreen('result');
      },
      onQueueWaiting(payload) {
        // #152: enter "Searching…" ONLY off an explicit user PLAY this session. A queue.waiting
        // that arrives without a live user-initiated search (leaked/stray/duplicated) is ignored
        // — the invariant's exact complement of "PLAY requires an armed stake" (#146).
        if (!searchingRef.current) return;
        // #152 follow-up: game-scope it too — a leftover queue.waiting for game A must never drive
        // game B's countdown. Mirror onChallengesList's pendingGameId scoping.
        if (payload.gameId !== pendingGameId) return;
        // OC7: surface the owner's server-authoritative expiry for the lobby countdown.
        setWaitingExpiresAt(payload.expiresAt);
        setLobbyExpired(false);
      },
      onChallengesList(payload) {
        // Home hub's cross-game ticker keeps every game's feed, keyed by gameId.
        setHomeChallenges((prev) => ({ ...prev, [payload.gameId]: payload.entries }));
        // The single-game feed (stake screen / coinflip hub) only tracks the active game.
        if (payload.gameId === pendingGameId) {
          setChallenges(payload.entries);
          setChallengesMore(payload.more);
        }
      },
      onChallengesUpdate(payload) {
        // Event-driven incremental add/remove — no polling (OC8).
        setHomeChallenges((prev) => ({
          ...prev,
          [payload.gameId]: applyChallengesUpdate(prev[payload.gameId] ?? [], payload),
        }));
        if (payload.gameId === pendingGameId) {
          setChallenges((prev) => applyChallengesUpdate(prev, payload));
        }
      },
      onChallengeExpired() {
        // Owner's resting bet expired (escrow already refunded server-side) — offer re-post.
        setLobbyExpired(true);
      },
      onStatus(status) {
        setWsStatus(status);
        if (status === 'connected') {
          // Back online — drop any "reconnecting" notice and re-establish a feed the
          // current screen depends on (the stake screen's challenge subscription is
          // server-side per-socket, so a new socket needs re-subscribing). Mid-match
          // resume is handled by the socket's own onopen → match.resume.
          setActionNotice(null);
          // The legacy stake-entry screen subscribes only its one game.
          if (screen === 'stake-entry' && pendingGameId) {
            wsRef.current?.subscribeChallenges(pendingGameId);
          }
          // Home AND every Game hub now run the cross-game ticker (per-socket subscriptions are
          // lost on a new socket) — re-arm the whole tracked set.
          if (screen === 'home' || isGameHubScreen(screen)) {
            for (const id of homeGamesRef.current) wsRef.current?.subscribeChallenges(id);
          }
          // No auto-resume: after sign-in the user has already landed on the intent's hub with the
          // stake armed (see handleAuthSuccess). They press PLAY to commit — nothing fires here.
        }
      },
      onError(payload) {
        // A failed take (CHALLENGE_TAKEN / SELF_TAKE / INSUFFICIENT_BALANCE) → brief notice;
        // the list's `removed` update drops the stale row on its own.
        if (['CHALLENGE_TAKEN', 'SELF_TAKE', 'INSUFFICIENT_BALANCE'].includes(payload.code)) {
          setChallengeNotice(
            payload.code === 'CHALLENGE_TAKEN' ? 'That challenge was just taken.' : payload.message,
          );
        }
        console.error('[ws error]', payload.code, payload.message);
      },
    });
  });

  // Start WS on mount if already logged in
  useEffect(() => {
    if (savedToken && !wsRef.current) {
      const ws = new WsClient(savedToken, {});
      wsRef.current = ws;
      // Re-render so the handler-wiring effect binds handlers before connect()'s onopen
      // fires the auto-resume (the WsClient constructor seeds currentMatchId from storage).
      setWsEpoch((n) => n + 1);
      ws.connect();
    }
    return () => {
      wsRef.current?.disconnect();
    };
  // eslint-disable-next-line -- savedToken is intentionally read once on mount
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('rc_token');
    localStorage.removeItem('rc_playerId');
    localStorage.removeItem('rc_username');
    localStorage.removeItem('rc_avatarId');
    wsRef.current?.disconnect();
    wsRef.current = null;
    setToken(null);
    setPlayerId(null);
    setUsername(null);
    setAvatarId('default');
    setIsGuest(false);
    setScreen('home'); // logged-out Home (the single entry for everyone), not the full auth screen
  }, []);

  // Picker save (ProfileHub): the endpoint already persisted it server-side; mirror it into App
  // state + localStorage so the Account header, own game bar, and a reload all reflect the choice.
  const handleSetAvatar = useCallback((avatar: AvatarId) => {
    localStorage.setItem('rc_avatarId', avatar);
    setAvatarId(avatar);
  }, []);

  const goToHome = useCallback(() => setScreen('home'), []);
  const goToProfile = useCallback(() => setScreen('profile'), []);
  const goToRewards = useCallback(() => setScreen('rewards'), []);
  const goToGameList = useCallback(() => setScreen('game-list'), []);
  // Issue #401: Preferences is reachable from Account (Profile). ProfileHub.tsx's own
  // "Preferences" row isn't built yet (separate ticket) — for now this is wired through a
  // temporary nav entry point in ProfileHub (see onOpenPreferences below); the plumbing here
  // (Screen union member, case, back-nav) is the permanent, correct wiring the follow-up ticket
  // will reuse as-is.
  const goToPreferences = useCallback(() => setScreen('preferences'), []);
  // Issue #423: Affiliate program — reachable from Account's own row and from the Menu overlay's
  // EARN group row (both previously showed the shared placeholder toast for this row specifically).
  const goToAffiliate = useCallback(() => setScreen('affiliate'), []);

  // ── Home hub cross-game ticker subscriptions (raw, NOT via the single-game handlers,
  //    so they never reset the active game's feed). ─────────────────────────────────────
  const handleTrackChallenges = useCallback((gameIds: string[]) => {
    homeGamesRef.current = gameIds;
    setHomeChallenges({});
    for (const id of gameIds) wsRef.current?.subscribeChallenges(id);
  }, []);
  const handleUntrackChallenges = useCallback(() => {
    for (const id of homeGamesRef.current) wsRef.current?.unsubscribeChallenges(id);
    homeGamesRef.current = [];
  }, []);

  const goToWallet = useCallback((newBalance?: number) => {
    if (newBalance !== undefined) setBalance(newBalance);
    setScreen('wallet');
  }, []);
  const goToLeaderboard = useCallback(() => setScreen('leaderboard'), []);
  const goToGameListFromResult = useCallback(() => setScreen('game-list'), []);

  const handleSelectGame = useCallback((meta: GameMeta) => {
    // #152 follow-up: switching games must abandon any leftover/in-flight search first, so the
    // new hub never opens on a stale "Searching…" (leftover waitingExpiresAt/searchingRef from the
    // previous game). The prevScreen nav-away effect covers hub→Home→hub, but a direct hub→hub
    // switch (or any residual waiting state) needs this explicit clear.
    clearHubSearch();
    resetRoundState(); // entering a hub via selection is always a clean slate — no prior round remnants
    setPendingGameId(meta.id);
    setPendingGameMeta(meta);
    setPendingStake(meta.bet.minStake);
    setPrearmStake(undefined); // normal selection: no pre-armed bet (only the join-fallback sets it)
    // Coinflip + RPS get the one-screen Game hub; other games keep the multi-screen flow.
    setScreen(hubScreenFor(meta.id) ?? 'stake-entry');
  }, [clearHubSearch, resetRoundState]);

  // A Game hub resumes/enters its context even without going through handleSelectGame (e.g. a
  // mid-match reload or a take-challenge), so the shared join/subscribe handlers (which key off
  // pendingGameId) target the hub's game.
  useEffect(() => {
    if (!isGameHubScreen(screen)) return;
    const g = screen.replace('-hub', '');
    if (pendingGameId !== g) setPendingGameId(g);
  }, [screen, pendingGameId]);

  const handleJoinQueue = useCallback((stake: number, timeControlId?: string) => {
    if (!pendingGameId) return;
    // Auth wall: a logged-out PLAY captures the intent and opens the sign-in modal; on success
    // the user lands back on this hub with the stake armed and presses PLAY to post (no auto-fire).
    if (!token) {
      openAuth({ action: 'play', gameId: pendingGameId, stake, timeControlId });
      return;
    }
    if (!wsRef.current) return;
    setPendingStake(stake);
    // Posting our own challenge: the eventual joiner's name never reaches the client → no name.
    setOpponentName(null);
    // Remember the picked time control so a re-post after expiry reuses the same one.
    setPendingTimeControl(timeControlId);
    // No silent drop (#30): if the socket is down, stay put and tell the user — don't
    // strand them on the lobby "waiting" screen never actually queued.
    if (!wsRef.current.joinQueue(pendingGameId, stake, timeControlId)) {
      setActionNotice(RECONNECT_NOTICE);
      return;
    }
    // #152: an explicit user PLAY this session — mark the search in flight so the ensuing
    // queue.waiting is honoured (and so leaving the hub abandons it). Records the game to leave.
    searchingRef.current = true;
    searchGameRef.current = pendingGameId;
    // New search → wipe the previous finished round's view (opponent + both pick pills + verdict) as
    // one unit, so the board returns to searching with no stale pill/highlight ("pills survive" bug).
    resetRoundState();
    // Reset lobby countdown state; queue.waiting will deliver the fresh expiresAt.
    setWaitingExpiresAt(null);
    setLobbyExpired(false);
    setActionNotice(null);
    // On a Game hub the "Waiting" state renders in place; the standalone flow uses the lobby screen.
    if (!isGameHubScreen(screen)) setScreen('lobby');
  }, [pendingGameId, screen, token, openAuth, resetRoundState]);

  const handleLeaveQueue = useCallback(() => {
    if (!pendingGameId || !wsRef.current) return;
    wsRef.current.leaveQueue(pendingGameId); // best-effort; leaving the UI is a local nav
    // #152: the search is over — clear the in-flight markers so a later nav can't double-leave.
    searchingRef.current = false;
    searchGameRef.current = null;
    setWaitingExpiresAt(null);
    setOpponentName(null);
    // On a Game hub, cancelling returns to Idle in place; the standalone lobby exits to the wallet.
    if (!isGameHubScreen(screen)) setScreen('wallet');
  }, [pendingGameId, screen]);

  // ── Open challenges (stake screen) ──────────────────────────────────────────
  const handleSubscribeChallenges = useCallback(() => {
    if (!pendingGameId || !wsRef.current) return;
    setChallenges([]);
    setChallengesMore(0);
    setChallengeNotice(null);
    wsRef.current.subscribeChallenges(pendingGameId);
  }, [pendingGameId]);

  const handleUnsubscribeChallenges = useCallback(() => {
    if (!pendingGameId || !wsRef.current) return;
    wsRef.current.unsubscribeChallenges(pendingGameId);
  }, [pendingGameId]);

  const handleTakeChallenge = useCallback((matchId: string) => {
    // Auth wall: a logged-out JOIN captures the intent (with the challenge's game + stake) and opens
    // the sign-in modal; on success the user lands on that hub with the stake armed to post their own.
    if (!token) {
      const found = lookupChallenge(matchId);
      openAuth(found ? { action: 'join', matchId, gameId: found.gameId, stake: found.stake } : null);
      return;
    }
    if (!wsRef.current) return;
    setChallengeNotice(null);
    // The opponent's real name now arrives authoritatively on match.start (both paths), so no
    // client-side ownerName capture is needed here.
    // On success the server pushes match.start → we land in the match; on failure → onError.
    if (!wsRef.current.takeChallenge(matchId)) setActionNotice(RECONNECT_NOTICE);
  }, [token, openAuth, lookupChallenge]);

  // A JOIN from the logged-out public ticker: the row already carries game + stake, so capture a
  // full 'join' intent directly (no WS feed to look it up in). On sign-in the user lands on that
  // hub with the stake armed to post their own — nothing auto-joins.
  const handleTakePublicChallenge = useCallback(
    (c: { matchId: string; gameId: string; stake: number }) => {
      openAuth({ action: 'join', matchId: c.matchId, gameId: c.gameId, stake: c.stake });
    },
    [openAuth],
  );

  // ── Owner lobby re-post (OC7) ───────────────────────────────────────────────
  const handleRepost = useCallback(() => {
    if (!pendingGameId || !wsRef.current) return;
    if (!wsRef.current.joinQueue(pendingGameId, pendingStake, pendingTimeControl)) {
      setActionNotice(RECONNECT_NOTICE);
      return;
    }
    setLobbyExpired(false);
    setActionNotice(null);
  }, [pendingGameId, pendingStake, pendingTimeControl]);

  const handleMakeMove = useCallback((move: Move) => {
    if (!currentMatchId || !wsRef.current) return;
    // Send first; only disable the buttons if it actually went out, so a dropped move
    // can be retried (and resume re-delivers your_turn on reconnect anyway).
    if (!wsRef.current.makeMove(move, currentMatchId)) {
      setActionNotice(RECONNECT_NOTICE);
      return;
    }
    setActionNotice(null);
    setLegalMoves([]); // disable buttons after a successful submit
  }, [currentMatchId]);

  const handleForfeit = useCallback(() => {
    if (!currentMatchId || !wsRef.current) return;
    if (!wsRef.current.forfeit(currentMatchId)) setActionNotice(RECONNECT_NOTICE);
  }, [currentMatchId]);

  // Chess draw offers (CHESS_DRAW_OFFER.md): send the intent; the server records/completes/clears
  // it and broadcasts the public offer state. Generic props (only chess wires them today).
  const handleDrawOffer = useCallback(() => {
    if (!currentMatchId || !wsRef.current) return;
    if (!wsRef.current.drawOffer(currentMatchId)) setActionNotice(RECONNECT_NOTICE);
  }, [currentMatchId]);

  const handleDrawRevoke = useCallback(() => {
    if (!currentMatchId || !wsRef.current) return;
    if (!wsRef.current.drawRevoke(currentMatchId)) setActionNotice(RECONNECT_NOTICE);
  }, [currentMatchId]);

  // Accept the opponent's pending draw offer (CHESS_DRAW_OFFER.md rev 3) — the only way a draw
  // offer completes the match; the server resolves it and broadcasts the terminal state.
  const handleDrawAccept = useCallback(() => {
    if (!currentMatchId || !wsRef.current) return;
    if (!wsRef.current.drawAccept(currentMatchId)) setActionNotice(RECONNECT_NOTICE);
  }, [currentMatchId]);

  // Hub result overlay dismissed (auto after ~4s, or the manual X) → drop the payload that drove the
  // overlay, but PRESERVE the finished-round board view (gameState/opponent) so the idle post-round
  // result persists until the player PLAYs or leaves (the wipe now fires only there — resetRoundState).
  const handleHubResultDismiss = useCallback(() => {
    setLastOutcome(null);
    setLastSettlement(null);
  }, []);

  // Wallet chip / Account tab: the profile when signed in, the sign-in modal when logged out.
  const onAccountTap = useCallback(() => {
    if (loggedIn) goToProfile();
    else openAuth(null);
  }, [loggedIn, goToProfile, openAuth]);

  function renderScreen() {
    switch (screen) {
      case 'auth':
        return <AuthScreen onLogin={handleLogin} />;
      case 'home':
        return <HomeHubScreen
          token={token ?? ''}
          balance={balance}
          challengesByGame={homeChallenges}
          onTrackChallenges={handleTrackChallenges}
          onUntrackChallenges={handleUntrackChallenges}
          onTakeChallenge={handleTakeChallenge}
          onTakePublicChallenge={handleTakePublicChallenge}
          onSelectGame={handleSelectGame}
          onOpenWallet={onAccountTap}
          onOpenRewards={goToRewards}
          onOpenAffiliate={goToAffiliate}
          onHome={goToHome}
          loggedIn={loggedIn}
        />;
      case 'profile':
        return <ProfileHubScreen
          token={token!}
          username={username}
          avatarId={avatarId}
          onAvatarChange={handleSetAvatar}
          balance={balance}
          onLogout={handleLogout}
          onHome={goToHome}
          onOpenProfile={goToProfile}
          onOpenRewards={goToRewards}
          onOpenPreferences={goToPreferences}
          onOpenAffiliate={goToAffiliate}
        />;
      case 'preferences':
        return <PreferencesHubScreen onBack={goToProfile} />;
      case 'affiliate':
        return <AffiliateHubScreen
          username={username}
          balance={balance}
          onBack={goToProfile}
          onHome={goToHome}
          onOpenProfile={goToProfile}
          onOpenRewards={goToRewards}
          onOpenAffiliate={goToAffiliate}
        />;
      case 'rewards':
        return <RewardsHubScreen
          token={token}
          loggedIn={loggedIn}
          username={username}
          balance={balance}
          onHome={goToHome}
          onOpenProfile={goToProfile}
          onOpenRewards={goToRewards}
          onOpenAffiliate={goToAffiliate}
        />;
      case 'wallet':
        return <WalletScreen token={token!} username={username} balance={balance} onPlay={goToHome} onLogout={handleLogout} />;
      case 'game-list':
        return <GameListScreen token={token!} onSelect={handleSelectGame} onBack={goToWallet} />;
      case 'guest-loading':
        // Deliberately blank (issue #284) — up while the `?mode=guest` guest-auth call is in
        // flight, so an embed never flashes the normal Home hub first. Token-driven background,
        // no visible text (the call is typically near-instant).
        return <div data-testid="guest-loading" className="min-h-screen bg-background" aria-busy="true" aria-live="polite" />;
      case 'guest-picker':
        return <GuestGamePicker onSelect={handleGuestSelectGame} />;
      case 'coinflip-hub':
      case 'rps-hub':
      case 'blackjack-hub':
      case 'mines-hub':
      case 'chess-hub':
      case 'crash-hub':
      case 'roulette-hub':
      case 'dice-hub':
      case 'baccarat-hub':
      case 'keno-hub':
      case 'limbo-hub':
      case 'hilo-hub': {
        const HubScreen =
          screen === 'rps-hub'
            ? RpsHubScreen
            : screen === 'blackjack-hub'
              ? BlackjackHubScreen
              : screen === 'mines-hub'
                ? MinesHubScreen
                : screen === 'chess-hub'
                  ? ChessHubScreen
                  : screen === 'crash-hub'
                    ? CrashHubScreen
                    : screen === 'roulette-hub'
                      ? RouletteHubScreen
                      : screen === 'dice-hub'
                        ? DiceHubScreen
                        : screen === 'baccarat-hub'
                          ? BaccaratHubScreen
                          : screen === 'keno-hub'
                            ? KenoHubScreen
                            : screen === 'limbo-hub'
                              ? LimboHubScreen
                              : screen === 'hilo-hub'
                                ? HiloHubScreen
                                : CoinflipHubScreen;
        return <HubScreen
          token={token ?? ''}
          playerId={playerId}
          username={username}
          avatarId={avatarId}
          opponentId={opponentId}
          opponentName={opponentName}
          serverClockOffset={serverClockOffset}
          balance={balance}
          currentMatchId={currentMatchId}
          gameState={gameState}
          events={lastMatchEvents}
          legalMoves={legalMoves as string[]}
          waitingExpiresAt={waitingExpiresAt}
          lobbyExpired={lobbyExpired}
          lastOutcome={lastOutcome}
          lastSettlement={lastSettlement}
          challengesByGame={homeChallenges}
          onPlay={handleJoinQueue}
          onCancel={handleLeaveQueue}
          onRepost={handleRepost}
          onTakeChallenge={handleTakeChallenge}
          onTakePublicChallenge={handleTakePublicChallenge}
          onMakeMove={handleMakeMove}
          onForfeit={handleForfeit}
          onDrawOffer={handleDrawOffer}
          onDrawRevoke={handleDrawRevoke}
          onDrawAccept={handleDrawAccept}
          onTrackChallenges={handleTrackChallenges}
          onUntrackChallenges={handleUntrackChallenges}
          onSelectGame={handleSelectGame}
          onOpenWallet={onAccountTap}
          onOpenRewards={goToRewards}
          onOpenAffiliate={goToAffiliate}
          onOpenGameList={goToHome}
          onResultDismiss={handleHubResultDismiss}
          loggedIn={loggedIn}
          initialStake={prearmStake}
          initialTimeControl={isGuest ? guestTimeControl : undefined}
          isGuest={isGuest}
        />;
      }
      case 'stake-entry':
        return <StakeEntryScreen
          meta={pendingGameMeta!}
          onJoin={handleJoinQueue}
          onBack={() => setScreen('game-list')}
          challenges={challenges}
          challengesMore={challengesMore}
          challengeNotice={challengeNotice}
          onSubscribe={handleSubscribeChallenges}
          onUnsubscribe={handleUnsubscribeChallenges}
          onTakeChallenge={handleTakeChallenge}
        />;
      case 'lobby':
        return <LobbyScreen username={username} stake={pendingStake} expiresAt={waitingExpiresAt} expired={lobbyExpired} onRepost={handleRepost} onLeave={handleLeaveQueue} />;
      case 'play':
        if (activeGameId === 'chess')
          return <ChessPlayScreen playerId={playerId!} username={username} opponentId={opponentId!} gameState={gameState as ChessView | null} legalMoves={legalMoves as ChessMove[]} onMove={handleMakeMove} onForfeit={handleForfeit} />;
        if (activeGameId === 'blackjack')
          return <BlackjackPlayScreen playerId={playerId!} username={username} opponentId={opponentId!} gameState={gameState as BlackjackView | null} legalMoves={legalMoves as string[]} onMove={handleMakeMove} onForfeit={handleForfeit} />;
        if (activeGameId === 'mines')
          return <MinesPlayScreen playerId={playerId!} username={username} opponentId={opponentId!} gameState={gameState as MinesView | null} legalMoves={legalMoves as number[]} onMove={handleMakeMove} onForfeit={handleForfeit} />;
        // Coinflip is a hub game (coinflip ∈ HUB_GAMES → routes to 'coinflip-hub', never 'play'),
        // so the old CoinflipPlayScreen was dead — removed. The 'play' route now only serves the RPS
        // fallback play screen (also only reachable for a non-HUB_GAMES game).
        return <PlayScreen playerId={playerId!} username={username} opponentId={opponentId!} gameState={gameState as RpsView | null} legalMoves={legalMoves as string[]} onMove={handleMakeMove} onForfeit={handleForfeit} />;
      case 'result':
        return <ResultScreen outcome={lastOutcome!} settlement={lastSettlement!} playerId={playerId ?? undefined} onPlayAgain={goToGameListFromResult} onLeaderboard={goToLeaderboard} />;
      case 'leaderboard':
        return <LeaderboardScreen token={token!} gameId={activeGameId ?? 'rps'} onBack={goToGameList} />;
    }
  }

  // Unobtrusive connection banner: only while logged in (the auth screen has no socket).
  const showReconnecting = token !== null && wsStatus !== 'connected';

  return (
    <>
      {showReconnecting && (
        <div className="ws-banner" role="status" data-testid="ws-banner">Reconnecting…</div>
      )}
      {actionNotice && (
        <div className="ws-banner ws-banner-error" role="alert" data-testid="action-notice">{actionNotice}</div>
      )}
      {renderScreen()}
      {/* Ticket 2026-09-13#4, item 3: always mounted (not `{authOpen && (...)}`) so `BottomSheet`'s
          own transform/scrim-opacity transitions have something to animate FROM the very first
          time a session opens the auth wall — the same "nothing to animate from on first open" gap
          2026-09-13#2 already fixed for the Menu overlay. `AuthModal` no longer takes
          `onGuestSuccess` — see its own top-of-file comment for why guest auth doesn't route
          through it any more. */}
      <AuthModal open={authOpen} onSuccess={handleAuthSuccess} onClose={closeAuth} />
    </>
  );
}
