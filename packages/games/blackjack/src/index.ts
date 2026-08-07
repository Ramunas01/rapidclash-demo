export { blackjackModule } from './blackjack.js';
// Issue #297 (DemoGuest Blackjack bot): the hit/stand heuristic is keyed to the hand's BEST value
// (soft ?? hard) — the exact value this module's own resolution/display logic already computes.
// Exposed here (mirrors `@rapidclash/game-chess`'s `ChessMove` export) so apps/server's guest bot
// reuses it rather than re-deriving ace-downgrade logic a second time.
export { handValue } from './deck.js';
export type { Card } from './deck.js';
