import { randomUUID } from 'node:crypto';
import {
  createEphemeralLedger,
  createMatchmaking,
  type EphemeralLedger,
  type Matchmaking,
} from '@rapidclash/core';
import { coinflipModule } from '@rapidclash/game-coinflip';
import {
  GUEST_ID_PREFIX,
  DEMO_BOT_COINFLIP_ID,
  GUEST_CURATED_GAMES,
  GUEST_COINFLIP_STAKE,
} from '@rapidclash/shared';

/** A notional balance for the Demo-Opponent — large enough that it can escrow into an
 *  unbounded number of concurrent guest matches without ever needing a top-up. Granted once at
 *  startup into the SAME ephemeral ledger every guest session uses (issue #267 architecture:
 *  `createMatchmaking(ephemeralLedger, …)` is a second, fully separate Matchmaking instance —
 *  the bot's balance here can never be confused with or leak into the real ledger). */
const DEMO_BOT_NOTIONAL_BALANCE = 1_000_000_000;

export function isGuestId(id: string): boolean {
  return id.startsWith(GUEST_ID_PREFIX);
}

export function mintGuestId(): string {
  return `${GUEST_ID_PREFIX}${randomUUID()}`;
}

export interface GuestServices {
  ledger: EphemeralLedger;
  matchmaking: Matchmaking;
  /** Resolve a display name for a guest/bot id; undefined for anything else (the caller falls
   *  back to the real identity.getUsername — this never answers for a non-guest, non-bot id, so
   *  the real identity layer is never asked about a guest id in the first place). */
  usernameFor(id: string): string | undefined;
  /** Call once right after a guest's `queue.join` matches them against the resting Demo-Opponent
   *  (`result.status === 'matched' && result.opponentId === DEMO_BOT_COINFLIP_ID`). Submits the
   *  bot's own pick through the exact same `GameModule` contract any player uses — `viewFor`
   *  redaction holds automatically, not via new code — then immediately re-posts the bot into the
   *  queue so the next guest is paired instantly. Coinflip-specific for this PR; PR 2 (chess)
   *  generalises this hook per game. */
  onDemoBotMatched(matchId: string, now: number): void;
  /** Idempotent: (re-)post the Demo-Opponent into its resting queue slot if it isn't there
   *  already. Called once at startup, after every match (via `onDemoBotMatched`), AND — this is
   *  the fix for a production lockout — once per gateway sweep tick, regardless of match
   *  activity. The bot's resting entry is an ordinary `joinQueue` bet, so it carries the SAME TTL
   *  (`CHALLENGE_TTL_MS`, default 90s) as any real resting bet; `sweepExpired` doesn't
   *  distinguish bot from human and expires it like anything else once idle that long. Before
   *  this method existed, the only re-posting hook was `onDemoBotMatched` — which can never fire
   *  once the bot is absent, since no guest can pair with a bot that isn't resting. That was a
   *  permanent lockout (no self-heal short of a server restart); calling this every sweep tick
   *  (`gateway.ts`, alongside `runSweeps(guest.matchmaking, true)`) re-asserts the bot's presence
   *  every ~1s, so an expiry-driven removal self-heals within one sweep interval instead. */
  ensureDemoBotResting(): void;
}

export function createGuestServices(opts: { now?: () => number; ttlMs?: number } = {}): GuestServices {
  const ledger = createEphemeralLedger();
  ledger.adminCredit(DEMO_BOT_COINFLIP_ID, DEMO_BOT_NOTIONAL_BALANCE, 'demo-bot:init');

  function usernameFor(id: string): string | undefined {
    if (id === DEMO_BOT_COINFLIP_ID) return 'Demo Opponent 🤖';
    if (isGuestId(id)) return 'Guest';
    return undefined;
  }

  // A SEPARATE Matchmaking instance (own queues/active-matches, own ledger) — isolated from the
  // real one by construction, per issue #267. Only the curated game set is registered, so a
  // guest can never join-queue for anything outside GUEST_CURATED_GAMES. No matchHistory →
  // guest matches never write to the real leaderboard/standings.
  const matchmaking = createMatchmaking(ledger, [coinflipModule], undefined, {
    lookupUsername: usernameFor,
    now: opts.now,
    ttlMs: opts.ttlMs,
  });

  function ensureDemoBotResting(): void {
    // joinQueue is idempotent for a player already resting at this exact key (it returns the
    // existing entry rather than duplicating) — safe to call unconditionally, as often as we like.
    matchmaking.joinQueue(DEMO_BOT_COINFLIP_ID, 'coinflip', GUEST_COINFLIP_STAKE);
  }

  function onDemoBotMatched(matchId: string, now: number): void {
    const match = matchmaking.getActiveMatch(matchId);
    if (match) {
      const legal = coinflipModule.legalMoves(match.state, DEMO_BOT_COINFLIP_ID) as Array<'heads' | 'tails'>;
      if (legal.length > 0) {
        const pick = legal[Math.floor(Math.random() * legal.length)];
        matchmaking.applyMove(matchId, DEMO_BOT_COINFLIP_ID, pick, now);
      }
    }
    ensureDemoBotResting(); // keep exactly one resting entry so the NEXT guest pairs instantly too
  }

  ensureDemoBotResting(); // once at startup

  return { ledger, matchmaking, usernameFor, onDemoBotMatched, ensureDemoBotResting };
}

export { GUEST_ID_PREFIX, DEMO_BOT_COINFLIP_ID, GUEST_CURATED_GAMES, GUEST_COINFLIP_STAKE };
