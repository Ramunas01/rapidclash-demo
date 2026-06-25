import type { GameModule } from '@rapidclash/shared';
import { rpsModule } from '@rapidclash/game-rps';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { chessModule } from '@rapidclash/game-chess';
import { blackjackModule } from '@rapidclash/game-blackjack';
import { minesModule } from '@rapidclash/game-mines';
import { crashModule } from '@rapidclash/game-crash';
import { rouletteModule } from '@rapidclash/game-roulette';
import { shipsBattleModule } from '@rapidclash/game-ships-battle';

/**
 * The platform's registered games — the single source of truth for what is LIVE.
 * Adding a module here is the go-live switch: GET /games then returns it, and the
 * client's GameList auto-promotes it from "coming soon" to a playable tile.
 */
export const gameModules: GameModule[] = [
  rpsModule,
  coinflipModule,
  chessModule,
  blackjackModule,
  minesModule,
  crashModule,
  rouletteModule,
  shipsBattleModule,
];
