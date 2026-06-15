import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameMeta, Outcome, SettlementSummary, OpenChallenge } from '@rapidclash/shared';
import { WsClient, hasStoredMatch, readStoredGameId, writeStoredGameId, type WsStatus } from './ws.js';
import { applyChallengesUpdate } from './screens/OpenChallengesList.js';
import { AuthScreen } from './screens/Auth.js';
import { WalletScreen } from './screens/Wallet.js';
import { GameListScreen } from './screens/GameList.js';
import { StakeEntryScreen } from './screens/StakeEntry.js';
import { LobbyScreen } from './screens/Lobby.js';
import { PlayScreen } from './screens/Play.js';
import { CoinflipPlayScreen } from './screens/CoinflipPlay.js';
import { ResultScreen } from './screens/Result.js';
import { LeaderboardScreen } from './screens/Leaderboard.js';

type Screen = 'auth' | 'wallet' | 'game-list' | 'stake-entry' | 'lobby' | 'play' | 'result' | 'leaderboard';

const RECONNECT_NOTICE = 'Connection lost — reconnecting. Try again in a moment.';

export interface RpsView {
  players: [string, string];
  choices: Partial<Record<string, string>>;
  forcedOutcome?: { type: string; winner?: string };
}

export interface CoinflipView {
  players: [string, string];
  caller: string;
  /** Public once made. */
  call?: string;
  /** Present ONLY at terminal — the server strips it pre-terminal via viewFor. */
  result?: string;
  forcedOutcome?: { type: string; winner?: string };
}

/** A per-game redacted view as it arrives from the server. The active game (and so
 *  which screen renders it) is tracked separately in `activeGameId`. */
export type GameView = RpsView | CoinflipView;

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
  // (active) keeps us there, match.end (terminal) redirects to the result screen.
  const [screen, setScreen] = useState<Screen>(
    savedToken ? (hasStoredMatch() ? 'play' : 'wallet') : 'auth',
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
  const [legalMoves, setLegalMoves] = useState<string[]>([]);
  const [lastOutcome, setLastOutcome] = useState<Outcome | null>(null);
  const [lastSettlement, setLastSettlement] = useState<SettlementSummary | null>(null);
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [pendingStake, setPendingStake] = useState(0);
  const [pendingGameMeta, setPendingGameMeta] = useState<GameMeta | null>(null);
  // Open-challenges feed (stake screen) + owner lobby countdown/expiry state.
  const [challenges, setChallenges] = useState<OpenChallenge[]>([]);
  const [challengesMore, setChallengesMore] = useState(0);
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
    setScreen('wallet');
  }, []);

  // Wire WS handlers whenever screen/state changes
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.setHandlers({
      onMatchStart(payload, matchId) {
        setCurrentMatchId(matchId);
        setOpponentId(payload.opponent);
        setGameState(payload.state as GameView);
        // Persist the game we queued for so a reload resumes the correct play screen.
        if (pendingGameId) {
          setActiveGameId(pendingGameId);
          writeStoredGameId(pendingGameId);
        }
        setLegalMoves([]);
        setScreen('play');
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
        setScreen((s) => (s === 'play' ? s : 'play'));
      },
      onMatchYourTurn(payload, _matchId) {
        setLegalMoves(payload.legalMoves as string[]);
      },
      onMatchEnd(payload, _matchId) {
        setLastOutcome(payload.outcome);
        setLastSettlement(payload.settlement);
        setBalance(payload.settlement.newBalance);
        setCurrentMatchId(null);
        // Match over — clear the persisted active game in lockstep with the matchId.
        writeStoredGameId(null);
        setLegalMoves([]);
        setScreen('result');
      },
      onQueueWaiting(payload) {
        // OC7: surface the owner's server-authoritative expiry for the lobby countdown.
        setWaitingExpiresAt(payload.expiresAt);
        setLobbyExpired(false);
      },
      onChallengesList(payload) {
        setChallenges(payload.entries);
        setChallengesMore(payload.more);
      },
      onChallengesUpdate(payload) {
        // Event-driven incremental add/remove — no polling (OC8).
        setChallenges((prev) => applyChallengesUpdate(prev, payload));
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
          if (screen === 'stake-entry' && pendingGameId) {
            wsRef.current?.subscribeChallenges(pendingGameId);
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

  const goToGameList = useCallback(() => setScreen('game-list'), []);
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
    setScreen('stake-entry');
  }, []);

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
    setScreen('lobby');
  }, [pendingGameId]);

  const handleLeaveQueue = useCallback(() => {
    if (!pendingGameId || !wsRef.current) return;
    wsRef.current.leaveQueue(pendingGameId); // best-effort; leaving the UI is a local nav
    setScreen('wallet');
  }, [pendingGameId]);

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

  const handleMakeMove = useCallback((move: string) => {
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

  function renderScreen() {
    switch (screen) {
      case 'auth':
        return <AuthScreen onLogin={handleLogin} />;
      case 'wallet':
        return <WalletScreen token={token!} username={username} balance={balance} onPlay={goToGameList} onLogout={handleLogout} />;
      case 'game-list':
        return <GameListScreen token={token!} onSelect={handleSelectGame} onBack={goToWallet} />;
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
        return activeGameId === 'coinflip'
          ? <CoinflipPlayScreen playerId={playerId!} username={username} opponentId={opponentId!} gameState={gameState as CoinflipView | null} legalMoves={legalMoves} onMove={handleMakeMove} onForfeit={handleForfeit} />
          : <PlayScreen playerId={playerId!} username={username} opponentId={opponentId!} gameState={gameState as RpsView | null} legalMoves={legalMoves} onMove={handleMakeMove} onForfeit={handleForfeit} />;
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
