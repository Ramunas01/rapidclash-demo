import type { GameModule } from '@rapidclash/shared';
import { rpsModule } from '@rapidclash/game-rps';
import { coinflipModule } from '@rapidclash/game-coinflip';
import { chessModule } from '@rapidclash/game-chess';

/**
 * The platform's registered games — the single source of truth for what is LIVE.
 * Adding a module here is the go-live switch: GET /games then returns it, and the
 * client's GameList auto-promotes it from "coming soon" to a playable tile.
 */
export const gameModules: GameModule[] = [rpsModule, coinflipModule, chessModule];
