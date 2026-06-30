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

/** Breadth: games not (yet) returned by /games render as dimmed, non-playable "coming soon"
 *  tiles. The whole house canon is a PvP-redefinition target (CHARTER / GAME_REDEFINITION) —
 *  never shown in house form, never a playable house route (invariant #1). */
export const COMING_SOON = ['baccarat', 'keno', 'hilo', 'dice', 'roulette'];

/** Live games kept off the demo home grid until they have tile art — they'd otherwise fall
 *  back to the black gradient placeholder and look broken (#148). They stay registered and
 *  route-reachable; this is presentation-only (same "needs art before it's shown" rule as #99).
 *  NOT coming-soon — these are live. */
export const HIDDEN_ON_HOME = new Set(['ships-battle']);

export function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}
