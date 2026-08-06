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

/** Curated guest surface for PR 1 (issue #267) — Coinflip only. PR 2 adds chess. */
export const GUEST_CURATED_GAMES: readonly string[] = ['coinflip'];

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
