import { useState, useEffect, useRef, useCallback } from 'react';
import type { GameMeta, Outcome, SettlementSummary } from '@rapidclash/shared';
import { WsClient, hasStoredMatch, readStoredGameId, writeStoredGameId } from './ws.js';
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
  };
}

export function App() {
  const { token: savedToken, playerId: savedPlayerId } = loadAuth();
  // A match persisted across a reload restores straight to the play view; match.state
  // (active) keeps us there, match.end (terminal) redirects to the result screen.
  const [screen, setScreen] = useState<Screen>(
    savedToken ? (hasStoredMatch() ? 'play' : 'wallet') : 'auth',
  );
  const [token, setToken] = useState<string | null>(savedToken);
  const [playerId, setPlayerId] = useState<string | null>(savedPlayerId);
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
  // Bumped when the WS client is (re)created so the handler-wiring effect below re-runs
  // and binds handlers before the socket's async onopen fires the auto-resume.
  const [, setWsEpoch] = useState(0);
  const wsRef = useRef<WsClient | null>(null);

  const handleLogin = useCallback((tok: string, pid: string, bal: number) => {
    localStorage.setItem('rc_token', tok);
    localStorage.setItem('rc_playerId', pid);
    setToken(tok);
    setPlayerId(pid);
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
      onQueueWaiting() {
        // already on lobby screen
      },
      onError(payload) {
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
    wsRef.current?.disconnect();
    wsRef.current = null;
    setToken(null);
    setPlayerId(null);
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
    wsRef.current.joinQueue(pendingGameId, stake);
    setScreen('lobby');
  }, [pendingGameId]);

  const handleLeaveQueue = useCallback(() => {
    if (!pendingGameId || !wsRef.current) return;
    wsRef.current.leaveQueue(pendingGameId);
    setScreen('wallet');
  }, [pendingGameId]);

  const handleMakeMove = useCallback((move: string) => {
    if (!currentMatchId || !wsRef.current) return;
    setLegalMoves([]); // disable buttons immediately
    wsRef.current.makeMove(move, currentMatchId);
  }, [currentMatchId]);

  const handleForfeit = useCallback(() => {
    if (!currentMatchId || !wsRef.current) return;
    wsRef.current.forfeit(currentMatchId);
  }, [currentMatchId]);

  switch (screen) {
    case 'auth':
      return <AuthScreen onLogin={handleLogin} />;
    case 'wallet':
      return <WalletScreen token={token!} balance={balance} onPlay={goToGameList} onLogout={handleLogout} />;
    case 'game-list':
      return <GameListScreen token={token!} onSelect={handleSelectGame} onBack={goToWallet} />;
    case 'stake-entry':
      return <StakeEntryScreen meta={pendingGameMeta!} onJoin={handleJoinQueue} onBack={() => setScreen('game-list')} />;
    case 'lobby':
      return <LobbyScreen stake={pendingStake} onLeave={handleLeaveQueue} />;
    case 'play':
      return activeGameId === 'coinflip'
        ? <CoinflipPlayScreen playerId={playerId!} opponentId={opponentId!} gameState={gameState as CoinflipView | null} legalMoves={legalMoves} onMove={handleMakeMove} onForfeit={handleForfeit} />
        : <PlayScreen playerId={playerId!} opponentId={opponentId!} gameState={gameState as RpsView | null} legalMoves={legalMoves} onMove={handleMakeMove} onForfeit={handleForfeit} />;
    case 'result':
      return <ResultScreen outcome={lastOutcome!} settlement={lastSettlement!} playerId={playerId ?? undefined} onPlayAgain={goToGameListFromResult} onLeaderboard={goToLeaderboard} />;
    case 'leaderboard':
      return <LeaderboardScreen token={token!} onBack={goToGameList} />;
  }
}
