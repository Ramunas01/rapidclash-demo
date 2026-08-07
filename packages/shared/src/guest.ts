// packages/shared/src/guest.ts
// Constants shared between the guest-mode server component (apps/server/src/guest) and the
// client's guest entry point (AuthModal/App.tsx), so neither side hardcodes a value the other
// must match. See docs/GUEST_MODE_STRATEGY.md / docs/GUEST_MODE_CONTRACT.md for the product
// framing, and issue #267 for the architecture this backs.

/** Prefix for every guest session's playerId (`guest:${randomUUID()}`). Lets any code — server
 *  or client — recognise a guest id by shape alone, with no lookup. */
export const GUEST_ID_PREFIX = 'guest:';

/** The permanently-resting in-app Demo-Opponent's playerId for the curated Coinflip preview
 *  (GUEST_MODE_STRATEGY.md §3.1 / CHARTER.md's "Guest mode" exception). One id serves every
 *  concurrent guest — match state is keyed by matchId, not by an exclusive per-session bot. */
export const DEMO_BOT_COINFLIP_ID = 'demo-bot:coinflip';

/** Shared prefix for every Demo-Opponent identity, real (`demo-bot:coinflip`) or pooled
 *  (`demo-bot:chess:0`, …). Lets the gateway recognise ANY bot player generically — no per-game
 *  id list to keep in sync there (issue #278's dispatch generalization). */
export const DEMO_BOT_ID_PREFIX = 'demo-bot:';

/** True for any Demo-Opponent identity, in any curated game. */
export function isDemoBotId(id: string): boolean {
  return id.startsWith(DEMO_BOT_ID_PREFIX);
}

/** Curated guest surface — issue #267 (Coinflip) + #278 (Chess) + #297 (Blackjack). */
export const GUEST_CURATED_GAMES: readonly string[] = ['coinflip', 'chess', 'blackjack'];

/**
 * Fixed per-round stake for guest Coinflip. Guest mode is a curated, single-fixed-stake preview
 * (no stake picker) — this is a deliberate simplification, not a rediscovery of the game's real
 * bet range: `coinflip`'s own `bet.maxStake` is 100, so the Demo-Opponent (which must rest at the
 * SAME `(gameId, stake, timeControlId)` queue key to pair instantly) can only ever rest at one
 * stake for one curated game. 100 is chosen to match that ceiling and the contract's 300¢
 * starting stack (3 rounds before a guest needs a fresh session).
 */
export const GUEST_COINFLIP_STAKE = 100;

/**
 * Fixed per-match stake for guest Chess (issue #278), same reasoning as `GUEST_COINFLIP_STAKE`:
 * matches `chess`'s own `bet.maxStake` ceiling so the pooled bots (which must rest at the SAME
 * `(gameId, stake, timeControlId)` queue key to pair instantly) can only ever rest at one stake.
 */
export const GUEST_CHESS_STAKE = 100;

/** Fixed guest chess time control (issue #278 §6, Owner-confirmed) — Blitz · 5 min. Guest mode
 *  has no time-control picker; every pooled bot rests at this id, and the real client (PR 3b)
 *  sends the same fixed value so it always pairs on the same queue key. */
export const GUEST_CHESS_TIME_CONTROL = 'blitz5';

/**
 * Fixed per-match stake for guest Blackjack (issue #297), same reasoning as
 * `GUEST_COINFLIP_STAKE`/`GUEST_CHESS_STAKE`: matches `blackjack`'s own `bet.maxStake` ceiling so
 * the pooled bots (which must rest at the SAME `(gameId, stake, timeControlId)` queue key to pair
 * instantly) can only ever rest at one stake. No time-control concept for Blackjack (unlike
 * Chess) — this is the only pre-arm constant it needs.
 */
export const GUEST_BLACKJACK_STAKE = 100;

/**
 * The landing origins allowed to iframe-embed the guest surface (GUEST_MODE_CONTRACT.md §3/§5,
 * issue #271). ONE list, imported by both sides so neither can drift from the other:
 * - server (`server.ts`) echoes it verbatim into the CSP `frame-ancestors` directive.
 * - client (`guest/events.ts`) validates every inbound `postMessage`'s `event.origin` against it,
 *   and only ever sends outbound messages to an origin captured from a validated inbound one —
 *   never a `'*'` targetOrigin.
 * Extend this list (not either call site) when the Owner confirms a new preview/staging origin.
 */
export const EMBED_ALLOWED_ORIGINS: readonly string[] = [
  'https://rapidclash.com',
  'https://staging.rapidclash.com',
];
