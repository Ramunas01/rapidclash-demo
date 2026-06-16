import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Bomb,
  ChevronLeft,
  Club,
  Coins,
  Crown,
  Diamond,
  Dice5,
  Disc,
  Gamepad2,
  Scissors,
  Spade,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { GameMeta } from '@rapidclash/shared';
import { api } from '../api.js';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
// Designed tile art (Vite-hashed/bundled WebP). Only games with a tile image here use it;
// the rest fall back to the gradient below. RPS was flattened onto the card backdrop at
// export time, so there are no see-through edges.
import coinflipArt from '../assets/games/coinflip.webp';
import rpsArt from '../assets/games/rps.webp';
import chessArt from '../assets/games/chess.webp';
import blackjackArt from '../assets/games/blackjack.webp';
import diceArt from '../assets/games/dice.webp';

interface Props {
  token: string;
  onSelect(meta: GameMeta): void;
  onBack(): void;
}

/** Per-game art lifted from the Base44 lobby export (icon + gradient + accent + tagline).
 *  Presentation only — the playable name/stakes/ranking come from `/games` (GameMeta). */
interface GameArt {
  name: string;
  icon: LucideIcon;
  gradient: string;
  accent: string;
  tagline: string;
  /** Designed tile background. When set, it replaces the gradient (which stays as fallback). */
  image?: string;
}

const GAME_ART: Record<string, GameArt> = {
  rps: { name: 'RPS', icon: Scissors, gradient: 'from-violet-500 via-purple-600 to-indigo-900', accent: 'text-violet-200', tagline: 'Best of Three', image: rpsArt },
  coinflip: { name: 'Coinflip', icon: Coins, gradient: 'from-purple-600 via-purple-700 to-indigo-900', accent: 'text-purple-300', tagline: '50/50 Chance', image: coinflipArt },
  chess: { name: 'Chess', icon: Crown, gradient: 'from-violet-600 via-violet-700 to-purple-900', accent: 'text-violet-300', tagline: 'Strategy PvP', image: chessArt },
  blackjack: { name: 'Blackjack', icon: Spade, gradient: 'from-purple-700 via-purple-800 to-purple-900', accent: 'text-purple-300', tagline: 'Classic 21', image: blackjackArt },
  baccarat: { name: 'Baccarat', icon: Diamond, gradient: 'from-purple-500 via-fuchsia-600 to-purple-900', accent: 'text-fuchsia-300', tagline: 'Card Showdown' },
  dice: { name: 'Dice', icon: Dice5, gradient: 'from-purple-600 via-purple-700 to-purple-900', accent: 'text-purple-300', tagline: 'Roll & Win', image: diceArt },
  mines: { name: 'Mines', icon: Bomb, gradient: 'from-purple-700 via-purple-900 to-black', accent: 'text-purple-200', tagline: 'Risk vs Reward' },
  poker: { name: 'Poker', icon: Club, gradient: 'from-purple-700 via-violet-800 to-indigo-950', accent: 'text-purple-200', tagline: 'Bluff & Win' },
  roulette: { name: 'Roulette', icon: Disc, gradient: 'from-purple-600 via-purple-700 to-violet-900', accent: 'text-purple-200', tagline: 'Spin the Wheel' },
};

const FALLBACK_ART: GameArt = {
  name: 'Game',
  icon: Gamepad2,
  gradient: 'from-purple-600 via-purple-700 to-indigo-900',
  accent: 'text-purple-300',
  tagline: 'Player vs Player',
};

/** Breadth shown to investors: games the platform isn't running yet (anything in this
 *  list NOT returned by `/games`) renders as a disabled "Coming soon" tile. If the
 *  server later registers one, it drops out of here and becomes playable automatically. */
const COMING_SOON_ORDER = ['chess', 'blackjack', 'baccarat', 'dice', 'mines', 'poker', 'roulette'];

function rankingLabel(kind: GameMeta['ranking']['kind']): string {
  switch (kind) {
    case 'win_rate':
      return 'Win rate';
    case 'net_winnings':
      return 'Net winnings';
    case 'elo':
      return 'Elo';
    case 'glicko':
      return 'Glicko';
  }
}

const entrance = (index: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: index * 0.05, duration: 0.4 },
});

/** The tile backdrop: designed art when available, else the original gradient (graceful
 *  fallback for any gameId without a tile). Always tops it with a scrim so the badges/name
 *  stay legible over whatever pixels are behind them. */
function TileBackground({ art }: { art: GameArt }) {
  if (art.image) {
    return (
      <>
        <img
          src={art.image}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        {/* Readability scrim: dark at top (P2P/LIVE) and bottom (name/stats), clear in the middle. */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/85" />
      </>
    );
  }
  return <div className={cn('absolute inset-0 bg-gradient-to-b opacity-80', art.gradient)} />;
}

/** A playable game — data-driven from `/games`. Tap → onSelect(meta) (the typed-amount path). */
function PlayableTile({ meta, index, onSelect }: { meta: GameMeta; index: number; onSelect: (m: GameMeta) => void }) {
  const art = GAME_ART[meta.id] ?? FALLBACK_ART;
  const Icon = art.icon;
  return (
    <motion.button
      type="button"
      onClick={() => onSelect(meta)}
      aria-label={`Play ${meta.displayName}`}
      data-testid={`game-tile-${meta.id}`}
      {...entrance(index)}
      className="group relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-white/5 transition-all duration-300 hover:-translate-y-1 hover:scale-[1.03] hover:border-purple-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <TileBackground art={art} />
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 blur-3xl transition-all duration-500 group-hover:bg-white/10" />
      <div className="relative flex h-full flex-col justify-between p-3 text-white">
        <div className="flex items-start justify-between">
          <span className="text-[7px] font-bold uppercase tracking-widest text-white/40">P2P</span>
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            <span className="text-[7px] font-medium text-green-400">LIVE</span>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center py-1">
          {/* The designed art is the focal point when present; the glass icon is the fallback face. */}
          {!art.image && (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/10 backdrop-blur-sm transition-all duration-300 group-hover:scale-110 group-hover:bg-white/15">
              <Icon className="h-7 w-7 text-white" />
            </div>
          )}
        </div>
        <div className="text-center">
          <h3 className="mb-0.5 text-sm font-bold leading-tight tracking-wide">{meta.displayName}</h3>
          <p className={cn('text-[10px] font-medium', art.accent)}>{art.tagline}</p>
          <div className="mt-1.5 flex flex-col items-center gap-1 text-[9px] text-white/60">
            <span>
              {meta.bet.minStake}–{meta.bet.maxStake} cr · ~{meta.averageDurationSec}s
            </span>
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-white/70">
              {rankingLabel(meta.ranking.kind)}
            </span>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

/** Non-interactive breadth tile. Rendered as a div (no handler) — clearly disabled. */
function ComingSoonTile({ id, index }: { id: string; index: number }) {
  const art = GAME_ART[id] ?? FALLBACK_ART;
  const Icon = art.icon;
  return (
    <motion.div
      aria-disabled="true"
      data-testid={`coming-soon-${id}`}
      {...entrance(index)}
      className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/5 opacity-60"
    >
      <TileBackground art={art} />
      <div className="relative flex h-full flex-col justify-between p-3 text-white">
        <div className="flex items-start justify-between">
          <span className="text-[7px] font-bold uppercase tracking-widest text-white/40">P2P</span>
          <Badge className="border-purple-500/30 bg-purple-600/20 px-1.5 py-0 text-[7px] font-medium text-purple-300">
            Coming soon
          </Badge>
        </div>
        <div className="flex flex-1 items-center justify-center py-1">
          {!art.image && (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
              <Icon className="h-7 w-7 text-white/70" />
            </div>
          )}
        </div>
        <div className="text-center">
          <h3 className="mb-0.5 text-sm font-bold leading-tight tracking-wide text-white/80">{art.name}</h3>
          <p className={cn('text-[10px] font-medium opacity-70', art.accent)}>{art.tagline}</p>
        </div>
      </div>
    </motion.div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4" aria-busy="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl border border-white/5 bg-white/5" />
      ))}
    </div>
  );
}

export function GameListScreen({ token, onSelect, onBack }: Props) {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Data layer unchanged: the playable set comes straight from GET /games.
  useEffect(() => {
    api
      .games(token)
      .then(setGames)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false));
  }, [token]);

  const comingSoon = useMemo(() => {
    const playable = new Set(games.map((g) => g.id));
    return COMING_SOON_ORDER.filter((id) => !playable.has(id));
  }, [games]);

  const totalTiles = games.length + comingSoon.length;

  return (
    <div className="min-h-screen bg-[#0b0e18] text-white">
      <div className="mx-auto max-w-[1100px] px-4 py-4">
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-sm font-medium text-white/70">Lobby</span>
        </div>

        {/* Hero — play-money framing (no crypto / deposit / buy-chips). */}
        <div className="relative mb-6 overflow-hidden rounded-2xl border border-brand/30 p-5 md:p-8">
          <div className="absolute inset-0 bg-gradient-to-br from-[#2d0f6b] via-[#1e0a4a] to-[#0b0818]" />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(139,61,255,0.35) 0%, transparent 65%)' }}
          />
          <div className="relative z-10">
            <h1 className="mb-1 text-2xl font-bold md:text-3xl">
              <span className="block">Players vs Players</span>
              <span className="block text-brand">Never the House</span>
            </h1>
            <p className="max-w-lg text-sm text-white/80 md:text-base">
              Play-money duels against real opponents. No house edge — instant matches, instant settlement.
            </p>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80">
            <Zap className="h-4 w-4 text-brand" />
            Rapid Originals
          </h2>
          {!loading && !error && <span className="text-xs text-white/50">{totalTiles} games</span>}
        </div>

        {loading && <GridSkeleton />}
        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-300" role="alert">
            Couldn&apos;t load games: {error}
          </p>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 md:gap-4">
            {games.map((g, i) => (
              <PlayableTile key={g.id} meta={g} index={i} onSelect={onSelect} />
            ))}
            {comingSoon.map((id, i) => (
              <ComingSoonTile key={id} id={id} index={games.length + i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
