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
 * a normal, in-range stake (well below chess's real `bet.maxStake` ceiling, raised to 10000 by the
 * ticket 2026-09-12 Chess high-stake escalation feature) so the pooled bots (which must rest at
 * the SAME `(gameId, stake, timeControlId)` queue key to pair instantly) can only ever rest at one
 * stake. Chosen as 100 to match the existing Coinflip/Blackjack guest stakes for one uniform guest
 * starting-stack story — not because it needs to sit at chess's maximum. Guest mode is a
 * deliberately separate, fixed-stake curated flow, functionally unaffected by the real
 * matchmaking ceiling.
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
 * Stake permanently set aside for human-to-human testing in the guest world (issue #350 — the
 * guest bot economy, `docs/COMMS/from-advisor/guest-mode-bot-economy.md`). No guest bot — waiter
 * or taker, present or future — may ever rest at or claim this stake, so two humans who both open
 * a guest session can deliberately meet each other at this one value instead of getting
 * auto-paired with a bot.
 *
 * This deliberately echoes `tools/bot-crowd/src/config.ts`'s `HUMAN_RESERVED_STAKE = 100` —
 * same "carve out one stake no bot will touch" pattern — but do NOT conflate the two:
 * - `tools/bot-crowd`'s `HUMAN_RESERVED_STAKE` protects the TOP of the REAL matchmaking's stake
 *   range (1–100), so a real signed-in human's 100-credit bet waits for another real human,
 *   funded by `tools/bot-crowd`'s own real, ADR-010-earned balance.
 * - This `GUEST_HUMAN_RESERVED_STAKE` protects the BOTTOM of the isolated GUEST world's own
 *   1–100 range (`createGuestServices()`'s isolated `Matchmaking` + `EphemeralLedger`,
 *   apps/server/src/guest/index.ts), whose bots are funded by nothing real at all
 *   (`DEMO_BOT_NOTIONAL_BALANCE`) rather than `tools/bot-crowd`'s earned, real balance.
 * Same shape of guardrail, opposite end of the range, two completely separate isolated worlds —
 * a guest session can never see or touch a real 100-stake challenge, and a real player can never
 * see or touch this 1-stake guest lane.
 */
export const GUEST_HUMAN_RESERVED_STAKE = 1;

/**
 * The curated games issue #350's stake-lane config (`GUEST_BOT_STAKE_LANES` below) covers —
 * spelled out as its own literal union rather than reusing `GUEST_CURATED_GAMES`'s declared
 * `readonly string[]` type (existing callers, e.g. `App.tsx`'s `GUEST_CURATED_GAMES.includes
 * (gameId)`, rely on that staying a plain string array — narrowing it would ripple into them for
 * no benefit here). This lets `GUEST_BOT_STAKE_LANES` be a fully-keyed `Record` with compile-time
 * exhaustiveness instead. `guest.test.ts` in this package asserts the two lists stay in sync at
 * runtime, so a future curated-game addition can't update one and silently forget the other.
 */
export type GuestCuratedGameId = 'coinflip' | 'chess' | 'blackjack';

/**
 * Per-curated-game stake lanes for the guest bot economy (issue #350, part 1/5 of
 * `docs/COMMS/from-advisor/guest-mode-bot-economy.md` §B). Today `ensureDemoBotResting()`
 * (apps/server/src/guest/index.ts) keeps exactly ONE resting bot identity per curated game, at
 * exactly the one fixed stake above (`GUEST_COINFLIP_STAKE`/`GUEST_CHESS_STAKE`/
 * `GUEST_BLACKJACK_STAKE`) — because the core's FIFO matchmaking pairs on the exact key
 * `(gameId, stake, timeControlId)`, one identity can only ever rest at one stake. Issue #351
 * (bot-waiter pools) generalizes that into several bot-waiter identities per game, one per
 * distinct stake "lane" listed here — the same index-pairing pattern `DEMO_BOT_CHESS_IDS`/
 * `DEMO_BOT_BLACKJACK_IDS` already use for their own pools (one array entry ⇔ one bot identity),
 * just keyed on stake instead of on nothing.
 *
 * Shape: a plain array of stakes per game, no wrapper object. A stake key IS the entire config a
 * lane needs to rest (the matchmaking queue key's other two parts — `gameId` and, for chess,
 * `timeControlId` — are already fixed per game, see `GUEST_CHESS_TIME_CONTROL` above). #351 zips
 * this array 1:1 against a same-length array of bot identities it mints, e.g.
 * `demo-bot:coinflip:0` ↔ `GUEST_BOT_STAKE_LANES.coinflip[0]`.
 *
 * Values: 4 distinct stakes per game, all under 100 and excluding `GUEST_HUMAN_RESERVED_STAKE`
 * (1) — a subset of the app's own bet presets (`BET_PRESETS` in
 * `apps/web/src/screens/GameHub.tsx`, the same list `tools/bot-crowd`'s `STAKE_SET` uses).
 * Cosmetic/tunable, not Owner-specified — see the spec's §B / "Ask".
 *
 * Guest-scoped only, by construction and by naming: keyed by curated game id, consumed only by
 * `apps/server/src/guest/index.ts`'s isolated `Matchmaking` instance. Never import this into
 * `tools/bot-crowd/src/config.ts` or any real (non-guest) matchmaking config — that would be
 * exactly the invariant violation `guest-mode-bot-economy.md` §2 warns against.
 */
export const GUEST_BOT_STAKE_LANES: Readonly<Record<GuestCuratedGameId, readonly number[]>> = {
  coinflip: [5, 10, 25, 50],
  chess: [5, 10, 25, 50],
  blackjack: [5, 10, 25, 50],
};

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
