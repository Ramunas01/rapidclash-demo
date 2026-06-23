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

/** v2 tile art keyed by gameId. No `limbo` — the frame's Limbo tile bakes in "900x/800x/700x"
 *  house-multiplier framing (rejected, as in #99); it falls back to a clean gradient tile. */
export const TILE_ART: Record<string, string> = {
  rps: rpsArt, coinflip: coinflipArt, chess: chessArt, blackjack: blackjackArt, mines: minesArt,
  baccarat: baccaratArt, crash: crashArt, dice: diceArt, hilo: hiloArt, keno: kenoArt, roulette: rouletteArt,
};

/** Breadth: games not (yet) returned by /games render as dimmed, non-playable "coming soon"
 *  tiles. The whole house canon is a PvP-redefinition target (CHARTER / GAME_REDEFINITION) —
 *  never shown in house form, never a playable house route (invariant #1). */
export const COMING_SOON = ['baccarat', 'limbo', 'crash', 'keno', 'hilo', 'dice', 'roulette'];

export function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
