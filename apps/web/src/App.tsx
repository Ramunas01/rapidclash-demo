import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameMeta, Move, Outcome, SettlementSummary, OpenChallenge } from '@rapidclash/shared';
import { WsClient, hasStoredMatch, readStoredGameId, writeStoredGameId, type WsStatus } from './ws.js';
import { applyChallengesUpdate } from './screens/OpenChallengesList.js';
import { AuthScreen } from './screens/Auth.js';
import { WalletScreen } from './screens/Wallet.js';
import { GameListScreen } from './screens/GameList.js';
import { StakeEntryScreen } from './screens/StakeEntry.js';
import { LobbyScreen } from './screens/Lobby.js';
import { PlayScreen } from './screens/Play.js';
import { CoinflipPlayScreen } from './screens/CoinflipPlay.js';
import { ChessPlayScreen } from './screens/ChessPlay.js';
import { BlackjackPlayScreen } from './screens/BlackjackPlay.js';
import { MinesPlayScreen } from './screens/MinesPlay.js';
import { ResultScreen } from './screens/Result.js';
import { LeaderboardScreen } from './screens/Leaderboard.js';
import { CoinflipHubScreen } from './screens/CoinflipHub.js';
import { RpsHubScreen } from './screens/RpsHub.js';
import { BlackjackHubScreen } from './screens/BlackjackHub.js';
import { HomeHubScreen } from './screens/HomeHub.js';
import { ProfileHubScreen } from './screens/ProfileHub.js';

type Screen = 'auth' | 'home' | 'profile' | 'wallet' | 'game-list' | 'stake-entry' | 'lobby' | 'play' | 'result' | 'leaderboard' | 'coinflip-hub' | 'rps-hub' | 'blackjack-hub';

const RECONNECT_NOTICE = 'Connection lost — reconnecting. Try again in a moment.';

/** Games that play through the shared one-screen Game hub (vs the multi-screen flow).
 *  Each maps to a `<gameId>-hub` screen. Adding a game here wires it to the hub. */
const HUB_GAMES = new Set(['coinflip', 'rps', 'blackjack']);
const hubScreenFor = (gameId: string | null | undefined): Screen | null =>
  gameId && HUB_GAMES.has(gameId) ? (`${gameId}-hub` as Screen) : null;
const isGameHubScreen = (s: Screen): boolean => s === 'coinflip-hub' || s === 'rps-hub' || s === 'blackjack-hub';

export interface RpsView {
  players: [string, string];
  choices: Partial<Record<string, string>>;
  forcedOutcome?: { type: string; winner?: string };
}

export interface CoinflipView {
  players: [string, string];
  /** Both players choose a side independently (mirrors RpsView). The opponent's choice is
   *  stripped by viewFor until terminal. */
  choices: Partial<Record<string, string>>;
  /** Present ONLY at terminal — the server strips it pre-terminal via viewFor. */
  result?: string;
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
  forcedOutcome?: { type: string; winner?: string };
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
  /** Redacted by viewFor: own hand is full; the opponent shows exactly ONE card in play.
   *  At terminal both hands are revealed (but the app navigates to the result screen then). */
  hands: Record<string, BlackjackHand>;
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
  winner?: string;
  forcedOutcome?: { type: string; winner?: string };
  /** Full mine layout — present only at terminal (full reveal). */
  mines?: number[];
}

/** A per-game redacted view as it arrives from the server. The active game (and so
 *  which screen renders it) is tracked separately in `activeGameId`. */
export type GameView = RpsView | CoinflipView | ChessView | BlackjackView | MinesView;

function loadAuth() {
  return {
    token: localStorage.getItem('rc_token'),
    playerId: localStorage.getItem('rc_playerId'),
    username: localStorage.getItem('rc_username'),
  };
}

export function App() {
  const { token: savedToken, playerId: savedPlayerId, username: savedUsername } = loadAuth();
  // A match persisted across a reload restores straight to the play view; match.state
  // (active) keeps us there, match.end (terminal) redirects to the result screen. A stored
  // coinflip match resumes onto the hub (in-place flow), not the standalone play screen.
  const [screen, setScreen] = useState<Screen>(
    savedToken
      ? hasStoredMatch()
        ? (hubScreenFor(readStoredGameId()) ?? 'play')
        : 'home'
      : 'auth',
  );
  const [token, setToken] = useState<string | null>(savedToken);
  const [playerId, setPlayerId] = useState<string | null>(savedPlayerId);
  // The player's own alias — shown so they always know "who you are" (#34). Persisted
  // in lockstep with playerId so a reload still knows the alias before any WS traffic.
  const [username, setUsername] = useState<string | null>(savedUsername);
  const [balance, setBalance] = useState(0);
  const [currentMatchId, setCurrentMatchId] = useState<string | null>(null);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameView | null>(null);
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
  // and binds handlers before the socket's async onopen fires the auto-resume.
  const [, setWsEpoch] = useState(0);
  const wsRef = useRef<WsClient | null>(null);

  const handleLogin = useCallback((tok: string, pid: string, bal: number, name: string) => {
    localStorage.setItem('rc_token', tok);
    localStorage.setItem('rc_playerId', pid);
    localStorage.setItem('rc_username', name);
    setToken(tok);
    setPlayerId(pid);
    setUsername(name);
    setBalance(bal);

    const ws = new WsClient(tok, {});
    wsRef.current = ws;
    ws.connect();
    setScreen('home');
  }, []);

  // Wire WS handlers whenever screen/state changes
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    // While a Game hub is active it drives the whole flow IN PLACE: suppress the screen
    // navigations below and let the hub derive its sub-state from the same App state.
    const onHub = isGameHubScreen(screen);
    ws.setHandlers({
      onMatchStart(payload, matchId) {
        setCurrentMatchId(matchId);
        setOpponentId(payload.opponent);
        setGameState(payload.state as GameView);
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
        // On a reload-driven resume, restore match identity + opponent + screen so the
        // user lands back in the live match (these are already set during normal play).
        if (matchId) setCurrentMatchId(matchId);
        if (playerId) {
          const opp = state.players.find((p) => p !== playerId);
          if (opp) setOpponentId(opp);
        }
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
        // Match over — clear the persisted active game in lockstep with the matchId.
        writeStoredGameId(null);
        setLegalMoves([]);
        // On the hub the result shows as an in-place overlay (no navigation); the hub sees
        // currentMatchId clear + lastOutcome set and presents it. Others go to the result screen.
        if (!onHub) setScreen('result');
      },
      onQueueWaiting(payload) {
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
          if ((screen === 'stake-entry' || isGameHubScreen(screen)) && pendingGameId) {
            wsRef.current?.subscribeChallenges(pendingGameId);
          }
          // Home hub's per-socket cross-game subscriptions are lost on a new socket — re-arm them.
          if (screen === 'home') {
            for (const id of homeGamesRef.current) wsRef.current?.subscribeChallenges(id);
          }
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
    wsRef.current?.disconnect();
    wsRef.current = null;
    setToken(null);
    setPlayerId(null);
    setUsername(null);
    setScreen('auth');
  }, []);

  const goToHome = useCallback(() => setScreen('home'), []);
  const goToProfile = useCallback(() => setScreen('profile'), []);
  const goToGameList = useCallback(() => setScreen('game-list'), []);

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
    setPendingGameId(meta.id);
    setPendingGameMeta(meta);
    setPendingStake(meta.bet.minStake);
    // Coinflip + RPS get the one-screen Game hub; other games keep the multi-screen flow.
    setScreen(hubScreenFor(meta.id) ?? 'stake-entry');
  }, []);

  // A Game hub resumes/enters its context even without going through handleSelectGame (e.g. a
  // mid-match reload or a take-challenge), so the shared join/subscribe handlers (which key off
  // pendingGameId) target the hub's game.
  useEffect(() => {
    if (!isGameHubScreen(screen)) return;
    const g = screen.replace('-hub', '');
    if (pendingGameId !== g) setPendingGameId(g);
  }, [screen, pendingGameId]);

  const handleJoinQueue = useCallback((stake: number) => {
    if (!pendingGameId || !wsRef.current) return;
    setPendingStake(stake);
    // No silent drop (#30): if the socket is down, stay put and tell the user — don't
    // strand them on the lobby "waiting" screen never actually queued.
    if (!wsRef.current.joinQueue(pendingGameId, stake)) {
      setActionNotice(RECONNECT_NOTICE);
      return;
    }
    // Reset lobby countdown state; queue.waiting will deliver the fresh expiresAt.
    setWaitingExpiresAt(null);
    setLobbyExpired(false);
    setActionNotice(null);
    // On a Game hub the "Waiting" state renders in place; the standalone flow uses the lobby screen.
    if (!isGameHubScreen(screen)) setScreen('lobby');
  }, [pendingGameId, screen]);

  const handleLeaveQueue = useCallback(() => {
    if (!pendingGameId || !wsRef.current) return;
    wsRef.current.leaveQueue(pendingGameId); // best-effort; leaving the UI is a local nav
    setWaitingExpiresAt(null);
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
    if (!wsRef.current) return;
    setChallengeNotice(null);
    // On success the server pushes match.start → we land in the match; on failure → onError.
    if (!wsRef.current.takeChallenge(matchId)) setActionNotice(RECONNECT_NOTICE);
  }, []);

  // ── Owner lobby re-post (OC7) ───────────────────────────────────────────────
  const handleRepost = useCallback(() => {
    if (!pendingGameId || !wsRef.current) return;
    if (!wsRef.current.joinQueue(pendingGameId, pendingStake)) {
      setActionNotice(RECONNECT_NOTICE);
      return;
    }
    setLobbyExpired(false);
    setActionNotice(null);
  }, [pendingGameId, pendingStake]);

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

  // Hub result overlay dismissed → wipe the match remnants so it returns to a clean Idle.
  const handleHubResultDismiss = useCallback(() => {
    setLastOutcome(null);
    setLastSettlement(null);
    setGameState(null);
    setOpponentId(null);
  }, []);

  function renderScreen() {
    switch (screen) {
      case 'auth':
        return <AuthScreen onLogin={handleLogin} />;
      case 'home':
        return <HomeHubScreen
          token={token!}
          balance={balance}
          challengesByGame={homeChallenges}
          onTrackChallenges={handleTrackChallenges}
          onUntrackChallenges={handleUntrackChallenges}
          onTakeChallenge={handleTakeChallenge}
          onSelectGame={handleSelectGame}
          onOpenWallet={goToProfile}
          onHome={goToHome}
        />;
      case 'profile':
        return <ProfileHubScreen
          token={token!}
          username={username}
          balance={balance}
          onLogout={handleLogout}
          onHome={goToHome}
          onOpenProfile={goToProfile}
        />;
      case 'wallet':
        return <WalletScreen token={token!} username={username} balance={balance} onPlay={goToHome} onLogout={handleLogout} />;
      case 'game-list':
        return <GameListScreen token={token!} onSelect={handleSelectGame} onBack={goToWallet} />;
      case 'coinflip-hub':
      case 'rps-hub':
      case 'blackjack-hub': {
        const HubScreen =
          screen === 'rps-hub' ? RpsHubScreen : screen === 'blackjack-hub' ? BlackjackHubScreen : CoinflipHubScreen;
        return <HubScreen
          token={token!}
          playerId={playerId}
          username={username}
          opponentId={opponentId}
          balance={balance}
          currentMatchId={currentMatchId}
          gameState={gameState}
          legalMoves={legalMoves as string[]}
          waitingExpiresAt={waitingExpiresAt}
          lobbyExpired={lobbyExpired}
          lastOutcome={lastOutcome}
          lastSettlement={lastSettlement}
          challenges={challenges}
          challengeNotice={challengeNotice}
          onPlay={handleJoinQueue}
          onCancel={handleLeaveQueue}
          onRepost={handleRepost}
          onTakeChallenge={handleTakeChallenge}
          onMakeMove={handleMakeMove}
          onForfeit={handleForfeit}
          onSubscribe={handleSubscribeChallenges}
          onUnsubscribe={handleUnsubscribeChallenges}
          onSelectGame={handleSelectGame}
          onOpenWallet={goToProfile}
          onOpenGameList={goToHome}
          onResultDismiss={handleHubResultDismiss}
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
        return activeGameId === 'coinflip'
          ? <CoinflipPlayScreen playerId={playerId!} username={username} opponentId={opponentId!} gameState={gameState as CoinflipView | null} legalMoves={legalMoves as string[]} onMove={handleMakeMove} onForfeit={handleForfeit} />
          : <PlayScreen playerId={playerId!} username={username} opponentId={opponentId!} gameState={gameState as RpsView | null} legalMoves={legalMoves as string[]} onMove={handleMakeMove} onForfeit={handleForfeit} />;
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
    </>
  );
}
