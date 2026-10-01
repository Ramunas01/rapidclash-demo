import rpsArt from '../../assets/games/rps.webp';
import coinflipArt from '../../assets/games/coinflip.webp';
import chessArt from '../../assets/games/chess.webp';
import blackjackArt from '../../assets/games/blackjack.webp';
import minesArt from '../../assets/games/mines.webp';
import baccaratArt from '../../assets/games/baccarat.webp';
import crashArt from '../../assets/games/crash.webp';
import diceArt from '../../assets/games/dice.webp';
import hiloArt from '../../assets/games/hilo.webp';
import kenoArt from '../../assets/games/keno.webp';
import rouletteArt from '../../assets/games/roulette.webp';
import limboArt from '../../assets/games/limbo.webp';

/** v2 tile art keyed by gameId. Limbo's "900x/800x/700x" art is owner-approved (#147/#148):
 *  in the PvP redefinition the multiplier is the player-chosen target, not a house payout. */
export const TILE_ART: Record<string, string> = {
  rps: rpsArt, coinflip: coinflipArt, chess: chessArt, blackjack: blackjackArt, mines: minesArt,
  baccarat: baccaratArt, crash: crashArt, dice: diceArt, hilo: hiloArt, keno: kenoArt, roulette: rouletteArt,
  limbo: limboArt,
};

/** Games grid breadth list — membership here is now AUTHORITATIVE over live `/games` status
 *  (ticket 2026-10-01#6, D73), not just a placeholder for not-yet-shipped games. All 6 currently
 *  listed (Crash, Roulette, Hilo, Keno, Baccarat, Limbo) are genuinely live/playable today —
 *  Owner-confirmed deliberate reversal of their earlier "registered + playable" ship (see
 *  `HomeHub.tsx`'s own `tiles` useMemo doc comment for the full mechanism). To actually launch a
 *  game from this grid again, remove it from this list — HomeHub's `tiles` derivation reacts
 *  immediately, no other change needed. */
export const COMING_SOON = ['crash', 'roulette', 'hilo', 'keno', 'baccarat', 'limbo'];

export function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
