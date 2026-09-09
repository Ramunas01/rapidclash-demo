/**
 * Games-hero category taxonomy (issue #465) — presentation-only, client-side. A game belongs to
 * a SET of categories (many-to-many), not one field — CHARTER.md invariant #5 (no `if (gameId
 * === …)` branching in core) is unaffected because this map never touches `packages/core` or
 * `apps/server`; it's purely how the Games/Home hub groups tiles it already has.
 *
 * Source: `CAT_GAMES` / `CATS` in `design/prototype/RapidClash Full Spec.html:2843-2850`
 * (confirmed at that exact line — searched for the literal string `CAT_GAMES`):
 *
 *   const GRID = ['cf','bj','ch','mn','rp','cr','di','ro','hi','ke','ba','li'];
 *   const CAT_GAMES = [
 *     GRID,                                       // 0 — RAPIDCLASH ORIGINALS (all 12)
 *     ['bj','hi','ba'],                            // 1 — CARD GAMES
 *     ['cf','di','ro','ke','li','mn','cr','ba'],   // 2 — CHANCE GAMES
 *     ['ch','bj','hi','rp'],                       // 3 — SKILL GAMES
 *     [],                                          // 4 — EVENTS (empty by design, `catEmpty`)
 *   ];
 *   const CATS = ['RAPIDCLASH ORIGINALS','CARD GAMES','CHANCE GAMES','SKILL GAMES','EVENTS'];
 *
 * Two-letter codes expanded to this app's real gameIds: cf=coinflip, bj=blackjack, ch=chess,
 * mn=mines, rp=rps, cr=crash, di=dice, ro=roulette, hi=hilo, ke=keno, ba=baccarat, li=limbo.
 * Cross-checked against the category table in `docs/NEW_DESIGN_MIGRATION.md` — matches exactly
 * (Blackjack in 3 categories, Baccarat in Card+Chance, Hilo in Card+Skill).
 */

export type CategoryId = 'originals' | 'card' | 'chance' | 'skill' | 'events';

/** Rail order, left to right — matches the prototype's `CATS` array order exactly. */
export const CATEGORY_IDS: CategoryId[] = ['originals', 'card', 'chance', 'skill', 'events'];

/** Category-rail tab label (short, wraps to 2 lines for CARD/SKILL in the prototype's 76px tab). */
export const CATEGORY_TAB_LABEL: Record<CategoryId, string> = {
  originals: 'ORIGINALS',
  card: 'CARD GAMES',
  chance: 'CHANCE GAMES',
  skill: 'SKILL GAMES',
  events: 'EVENTS',
};

/** Section-title text (the bolt-icon row above the grid) — verbatim `CATS` strings. */
export const CATEGORY_TITLE: Record<CategoryId, string> = {
  originals: 'RAPIDCLASH ORIGINALS',
  card: 'CARD GAMES',
  chance: 'CHANCE GAMES',
  skill: 'SKILL GAMES',
  events: 'EVENTS',
};

/** Many-to-many membership: gameId → categories set, expressed as category → gameId[]. */
export const CATEGORY_GAMES: Record<CategoryId, string[]> = {
  originals: ['coinflip', 'blackjack', 'chess', 'mines', 'rps', 'crash', 'dice', 'roulette', 'hilo', 'keno', 'baccarat', 'limbo'],
  card: ['blackjack', 'hilo', 'baccarat'],
  chance: ['coinflip', 'dice', 'roulette', 'keno', 'limbo', 'mines', 'crash', 'baccarat'],
  skill: ['chess', 'blackjack', 'hilo', 'rps'],
  events: [], // Intentionally empty (Designer-confirmed) — the prototype's own `catEmpty` state.
};

/** Whether a game belongs to a given category (membership test, not exclusive assignment). */
export function isInCategory(gameId: string, cat: CategoryId): boolean {
  return CATEGORY_GAMES[cat].includes(gameId);
}
