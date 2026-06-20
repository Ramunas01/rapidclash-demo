// packages/shared/src/protocol.ts
// All message types for the WebSocket channel and REST payloads.
// Imported by both client (apps/web) and server (apps/server) — define once, never duplicate.

import type {
  GameEvent,
  GameMeta,
  GameState,
  Move,
  Outcome,
  PlayerId,
  RankingType,
} from './game-contract.js';

// ─── WebSocket envelope ──────────────────────────────────────────────────────

export interface Envelope<T = unknown> {
  type: string;
  matchId?: string;
  payload: T;
}

// ─── Client → Server ─────────────────────────────────────────────────────────

/** The time-control sentinel for games without a clock (RPS/Coinflip/Blackjack/Mines), so the
 *  matchmaking key `${gameId}:${stake}:${timeControlId}` is uniform and needs no game-id branch. */
export const UNTIMED_TIME_CONTROL = 'none';

/** Enter matchmaking for a game at a stake; escrow is debited here. */
export interface QueueJoinPayload {
  gameId: string;
  stake: number; // integer minor units; must not exceed the player's balance
  /** Which declared time-control to pair on (chess). Omitted or 'none' → the game's default
   *  (or 'none' for untimed games). The server resolves + validates it; pairing is on
   *  (game, stake, time-control). */
  timeControlId?: string;
}

/** Leave the lobby before being matched; escrow is refunded. */
export interface QueueLeavePayload {
  gameId: string;
}

/** Submit a move in the current match. */
export interface MoveMakePayload {
  move: Move;
}

/** After reconnect, ask the server for the current redacted state. */
export interface MatchResumePayload {
  matchId: string;
}

/** Concede or leave an in-progress match (triggers forfeit on the server). */
export type MatchForfeitPayload = Record<string, never>;

// ─── Server → Client ─────────────────────────────────────────────────────────

/** You are in the lobby; no opponent has joined yet. */
export interface QueueWaitingPayload {
  gameId: string;
  /** The owner's own resting-bet id (lets the client identify it for re-post/cancel). */
  matchId: string;
  since: number; // server ms timestamp when you entered the queue
  expiresAt: number; // server ms when this resting bet auto-expires + refunds (OC7)
}

// ─── Open-challenges lobby (ADR-008) ─────────────────────────────────────────

/** Client → Server: start/stop receiving the resting-bet feed for a game. */
export interface ChallengeSubscribePayload {
  gameId: string;
}
export type ChallengeUnsubscribePayload = ChallengeSubscribePayload;

/** Client → Server: claim a specific resting bet (atomic; escrow on success only). */
export interface ChallengeTakePayload {
  matchId: string;
}

/** One resting bet as shown in the feed. */
export interface OpenChallenge {
  matchId: string;
  ownerName: string;
  stake: number;
  openedAt: number; // server ms when the bet was placed
  expiresAt: number; // server ms when it auto-expires
  /** The control this resting bet pairs on — always present ('none' for untimed games) so the
   *  feed row can show e.g. "Chess · Blitz 5 min · 10¢". Taking it inherits this control. */
  timeControlId: string;
}

/** One resting bet in the PUBLIC cross-game snapshot (GET /open-challenges) — an OpenChallenge
 *  plus the gameId it belongs to, so the logged-out Home ticker can render and JOIN it without a
 *  per-game subscription. Read-only; exposes nothing beyond what authed users see in the WS feed. */
export interface PublicOpenChallenge extends OpenChallenge {
  gameId: string;
}

/** Server → Client: full snapshot, sent on subscribe. `more` = count beyond the cap. */
export interface ChallengesListPayload {
  gameId: string;
  entries: OpenChallenge[];
  more: number;
}

export type ChallengeRemovedReason = 'taken' | 'expired' | 'cancelled';

/** Server → Client: incremental feed update (event-driven, no polling — OC8). */
export interface ChallengesUpdatePayload {
  gameId: string;
  added?: OpenChallenge;
  removed?: { matchId: string; reason: ChallengeRemovedReason };
}

/** Server → Client: your own resting bet expired; escrow already refunded (OC6). */
export interface ChallengeExpiredPayload {
  matchId: string;
}

/** You have been matched; here is your redacted starting view. */
export interface MatchStartPayload {
  matchId: string;
  opponent: PlayerId;
  gameId: string; // authoritative game to route to (Charter invariant #2: server-authoritative)
  state: GameState; // viewFor result — opponent's hidden info already stripped
}

/** Updated redacted view after a move, plus events to animate on the client. */
export interface MatchStatePayload {
  state: GameState;
  events: GameEvent[];
}

/** It is your turn; here are the moves you may legally submit. */
export interface MatchYourTurnPayload {
  legalMoves: Move[];
}

/** Net wallet change delivered to each player at settlement. */
export interface SettlementSummary {
  /** Signed delta: positive = credit, negative = debit. Zero for void. */
  delta: number;
  /** Derived wallet balance after the settlement entries are applied. */
  newBalance: number;
}

/** The match is over; result and wallet impact. */
export interface MatchEndPayload {
  outcome: Outcome;
  settlement: SettlementSummary;
}

/** Server-side error: illegal move, insufficient balance, etc. */
export interface ErrorPayload {
  code: string;
  message: string;
}

// ─── REST payloads ───────────────────────────────────────────────────────────

export interface AuthRegisterBody {
  username: string;
  password: string;
}

export interface AuthLoginBody {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  playerId: PlayerId;
  balance: number;
  /** The player's own alias, so the client can show "who you are" (#34). */
  username: string;
}

export type LedgerEntryType =
  | 'GRANT'
  | 'ADMIN_CREDIT'
  | 'BET_ESCROW'
  | 'SETTLE_WIN'
  | 'SETTLE_REFUND'
  | 'RAKE';

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  /** Signed minor units: positive = credit, negative = debit. */
  amount: number;
  matchId?: string;
  idempotencyKey: string;
  createdAt: string; // ISO-8601
}

export interface WalletResponse {
  balance: number;
  entries: LedgerEntry[];
}

/** The ranking strategy a leaderboard row was produced by (= RankingType['kind']).
 *  The core ranks generically by each game's declared RankingType (ADR-007); the
 *  client renders `score` per `kind` (a win-rate fraction vs a signed money amount). */
export type RankingKind = RankingType['kind'];

interface LeaderboardEntryBase {
  rank: number;
  playerId: PlayerId;
  displayName: string;
  /** Sort key. Interpretation depends on `kind`. */
  score: number;
  kind: RankingKind;
}

/** win_rate row (skill games, e.g. RPS): score = winRate. */
export interface WinRateLeaderboardEntry extends LeaderboardEntryBase {
  kind: 'win_rate';
  gamesPlayed: number;
  wins: number;
  /** = score */
  winRate: number;
}

/** net_winnings row (chance games, e.g. Coinflip): score = signed net P&L from
 *  the ledger. May be negative; the field across all players sums to −rake. */
export interface NetWinningsLeaderboardEntry extends LeaderboardEntryBase {
  kind: 'net_winnings';
  /** = score */
  netWinnings: number;
}

/** elo row (skill games, e.g. Chess): score = ELO rating. Both players start at
 *  1500; ratings are derived by replaying the game's results with a fixed K=32
 *  (ADR-007 — additive variant). */
export interface EloLeaderboardEntry extends LeaderboardEntryBase {
  kind: 'elo';
  /** = score */
  rating: number;
}

export type LeaderboardEntry =
  | WinRateLeaderboardEntry
  | NetWinningsLeaderboardEntry
  | EloLeaderboardEntry;

export interface MatchRecord {
  matchId: string;
  gameId: string;
  players: PlayerId[];
  outcome: Outcome;
  createdAt: string;
  settledAt: string;
}

// Admin REST payloads

export interface AdminCreditBody {
  amount: number; // positive integer minor units
  idempotencyKey: string;
}

export interface AdminPlayerSummary {
  playerId: PlayerId;
  displayName: string;
  balance: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  moneyWon: number;
  moneyLost: number;
}

export interface AdminMatchLogEntry {
  matchId: string;
  gameId: string;
  opponent: PlayerId;
  result: 'win' | 'loss' | 'draw' | 'void';
  /** Signed net change to this player's wallet. */
  amount: number;
  runningBalance: number;
  createdAt: string;
}

// Re-export GameMeta so consumers can import it from '@rapidclash/shared' directly.
export type { GameMeta };
