/**
 * Games-hero SORT + RANDOM support data (issue #465). Client-side only.
 */

export type SortMode = 'popularity' | 'newest' | 'alphabetical';

export const SORT_MODES: SortMode[] = ['popularity', 'newest', 'alphabetical'];

export const SORT_LABEL: Record<SortMode, string> = {
  popularity: 'Popularity',
  newest: 'Newest',
  alphabetical: 'Alphabetical',
};

/**
 * "Newest" sort (issue #465) — a FIXED per-game introduction-order ordinal, not a live/dynamic
 * date field. Lower = added to the platform earlier; the Newest sort orders DESCENDING by this
 * value (highest ordinal first). Established ONCE from each game package's first-landed commit
 * (`git log --diff-filter=A --follow --format='%aI %H' -- packages/games/<id>`, oldest entry) —
 * never recomputed at runtime. A newly added game package appends the next integer by hand.
 *
 * First-commit timestamps found (all times +03:00):
 *   rps        2026-06-14T13:22:05  bf-independent, earliest package in the repo
 *   coinflip   2026-06-15T14:07:27
 *   chess      2026-06-16T23:59:59
 *   blackjack  2026-06-19T21:38:53
 *   mines      2026-06-19T22:30:36
 *   crash      2026-06-25T19:33:47
 *   roulette   2026-06-25T19:47:46
 *   dice       2026-06-26T16:11:11  ─┬ same commit c5099918 ("feat(dice+baccarat): … (#126)")
 *   baccarat   2026-06-26T16:11:11  ─┘ tie broken by the commit subject's own game order (dice first)
 *   keno       2026-06-26T16:35:35  ─┬ same commit b00cd0a4 ("feat(keno+limbo+hilo): … (#127)")
 *   limbo      2026-06-26T16:35:35   │ tie broken by the commit subject's own game order
 *   hilo       2026-06-26T16:35:35  ─┘ (keno, limbo, hilo)
 */
export const INTRO_ORDER: Record<string, number> = {
  rps: 0,
  coinflip: 1,
  chess: 2,
  blackjack: 3,
  mines: 4,
  crash: 5,
  roulette: 6,
  dice: 7,
  baccarat: 8,
  keno: 9,
  limbo: 10,
  hilo: 11,
};

/**
 * Popularity-sort tie-break (issue #476). When two tiles' popularity counts are equal — the
 * normal state on a fresh/quiet database, where every count is 0 — the design's intended default
 * is its own fixed `GRID` sequence (`design/prototype/RapidClash Full Spec.html:2842`:
 * `['cf', 'bj', 'ch', 'mn', 'rp', 'cr', 'di', 'ro', 'hi', 'ke', 'ba', 'li']`), Coinflip first —
 * NOT alphabetical (which would put Baccarat first). A game id absent from this map (shouldn't
 * happen for the 12-game roster) sorts after every listed id, stable-ordered by prior array order.
 */
export const GRID_ORDER: Record<string, number> = {
  coinflip: 0,
  blackjack: 1,
  chess: 2,
  mines: 3,
  rps: 4,
  crash: 5,
  dice: 6,
  roulette: 7,
  hilo: 8,
  keno: 9,
  baccarat: 10,
  limbo: 11,
};

/**
 * RANDOM button (issue #465, prototype's `spinRandom` — `design/prototype/RapidClash Full
 * Spec.html:3991`) — the real behaviour, not the prototype's: uniform-random among exactly the
 * six PLAYABLE games (the ones with a real hub to navigate to today). The prototype itself only
 * ever picks among mines/rps/dice because those are the only hub views it has built — never
 * crash/roulette/hilo/keno/baccarat/limbo, since navigating there would be a dead/broken nav.
 */
export const RANDOM_PLAYABLE_GAME_IDS = ['rps', 'dice', 'mines', 'coinflip', 'blackjack', 'chess'] as const;

/** Prototype's exact RANDOM timing (`spinRandom`, line ~3991): the die-spin keyframe is 1500ms;
 *  navigation to the chosen game's hub fires 60ms after it settles (1560ms total from tap). */
export const RANDOM_SPIN_KEYFRAME_MS = 1500;
export const RANDOM_NAV_DELAY_MS = 60;
export const RANDOM_TOTAL_MS = RANDOM_SPIN_KEYFRAME_MS + RANDOM_NAV_DELAY_MS; // 1560ms

/** Related Games section selection (ticket 2026-09-15#12, Designer's D18 spec, `RelatedRail` in
 *  `GameHub.tsx`). Pure ordering logic only — no `GameMeta`/display-name knowledge — so it's
 *  directly unit-testable against Designer's own worked examples without constructing fake game
 *  objects; the caller attaches name/meta per id. */
export interface RelatedGameSlot {
  id: string;
  playable: boolean;
}

/** Fixed head order, before the current-game substitution rule below. */
const RELATED_FIXED_HEAD = ['crash', 'blackjack', 'dice'];

/**
 * A fixed 3-slot head (Crash, Blackjack, Dice) — except the current game, if it's one of those
 * three, is substituted IN PLACE by Mines (not appended after) — then every other game from the
 * Originals roster in `GRID_ORDER`, excluding the current game and whatever's already in the head.
 * `liveIds` drives `playable` per id — the real live roster (`GameHub.tsx`'s own `games` prop),
 * not a hardcoded list, so a newly-shipped game becomes playable here the same way it does
 * everywhere else in the app.
 */
export function relatedGamesFor(currentGameId: string, liveIds: ReadonlySet<string>): RelatedGameSlot[] {
  const head = RELATED_FIXED_HEAD.map((id) => (id === currentGameId ? 'mines' : id));
  const shown = new Set([...head, currentGameId]);
  const tail = Object.keys(GRID_ORDER)
    .filter((id) => !shown.has(id))
    .sort((a, b) => GRID_ORDER[a] - GRID_ORDER[b]);
  return [...head, ...tail].map((id) => ({ id, playable: liveIds.has(id) }));
}
