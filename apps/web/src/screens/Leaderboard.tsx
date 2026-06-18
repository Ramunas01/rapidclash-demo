import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Award,
  ChevronLeft,
  Coins,
  Medal,
  Percent,
  Scissors,
  TrendingDown,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import type { LeaderboardEntry, RankingKind } from '@rapidclash/shared';
import { api } from '../api.js';
import { formatCredits } from '../format.js';
import { cn } from '@/lib/utils';

interface Props {
  token: string;
  /** The active/just-played game whose board to show (#46) — not hardcoded to rps. */
  gameId: string;
  onBack(): void;
}

/** Render a row's stat according to its ranking kind (ADR-007): win_rate shows a
 *  percentage; net_winnings shows signed credits (the sign is part of the value);
 *  elo shows the rounded rating. */
export function formatStat(entry: LeaderboardEntry): string {
  if (entry.kind === 'net_winnings') {
    const v = entry.netWinnings;
    return `${v > 0 ? '+' : ''}${formatCredits(v)}`;
  }
  if (entry.kind === 'elo') {
    return `${Math.round(entry.rating)} ELO`;
  }
  return `${Math.round(entry.score * 100)}% win rate`;
}

/** Presentation only — the name/board come from `/leaderboard/:gameId`, not from here. */
const GAME_ART: Record<string, { name: string; icon: LucideIcon; gradient: string }> = {
  rps: { name: 'RPS', icon: Scissors, gradient: 'from-violet-500 via-purple-600 to-indigo-900' },
  coinflip: { name: 'Coinflip', icon: Coins, gradient: 'from-purple-600 via-purple-700 to-indigo-900' },
};

const FALLBACK_ART = { icon: Trophy, gradient: 'from-purple-600 via-purple-700 to-indigo-900' };

function gameName(gameId: string): string {
  return GAME_ART[gameId]?.name ?? gameId.toUpperCase();
}

/** Each ranking shape carries a different headline stat (ADR-007). */
function kindLabel(kind: RankingKind | undefined): string {
  if (kind === 'net_winnings') return 'Net winnings';
  if (kind === 'elo') return 'ELO rating';
  return 'Win rate';
}

const entrance = (index: number) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: index * 0.04, duration: 0.35 },
});

/** Trophy/medal/award for the podium; plain number after that. */
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-400" aria-label="1st" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-gray-300" aria-label="2nd" />;
  if (rank === 3) return <Award className="h-5 w-5 text-amber-600" aria-label="3rd" />;
  return <span className="w-5 text-center text-sm font-bold text-white/40">{rank}</span>;
}

const AVATAR_GRADIENTS = [
  'from-yellow-500 to-amber-600',
  'from-gray-300 to-gray-500',
  'from-amber-600 to-orange-700',
];

function Avatar({ name, index }: { name: string; index: number }) {
  const gradient = AVATAR_GRADIENTS[index] ?? 'from-purple-700 to-indigo-900';
  return (
    <div
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white',
        gradient,
      )}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function StatCell({ entry }: { entry: LeaderboardEntry }) {
  if (entry.kind === 'net_winnings') {
    const v = entry.netWinnings;
    const Icon = v < 0 ? TrendingDown : TrendingUp;
    return (
      <div className="flex flex-col items-end text-right">
        <span
          className={cn(
            'flex items-center gap-1 text-sm font-bold tabular-nums',
            v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-white/70',
          )}
        >
          {v !== 0 && <Icon className="h-3.5 w-3.5" />}
          {formatStat(entry)}
        </span>
        {/* ADR-007: net_winnings sums to −rake across players, so a row can be negative. */}
        <span className="text-[10px] font-medium text-white/40">net of platform fee</span>
      </div>
    );
  }

  if (entry.kind === 'elo') {
    return (
      <div className="flex flex-col items-end text-right">
        <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-white">
          <Trophy className="h-3.5 w-3.5 text-brand" />
          {formatStat(entry)}
        </span>
        <span className="text-[10px] font-medium text-white/40">rating</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end text-right">
      <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-white">
        <Percent className="h-3.5 w-3.5 text-brand" />
        {formatStat(entry)}
      </span>
      <span className="text-[10px] font-medium text-white/40 tabular-nums">
        {entry.wins}W · {entry.gamesPlayed} {entry.gamesPlayed === 1 ? 'game' : 'games'}
      </span>
    </div>
  );
}

function Row({ entry, index }: { entry: LeaderboardEntry; index: number }) {
  const podium = entry.rank <= 3;
  return (
    <motion.div
      data-testid={`lb-row-${entry.playerId}`}
      {...entrance(index)}
      className={cn(
        'grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 transition-colors',
        podium
          ? 'border border-white/10 bg-white/[0.04]'
          : 'border border-transparent bg-white/[0.02] hover:border-white/10',
      )}
    >
      <div className="flex items-center justify-center">
        <RankBadge rank={entry.rank} />
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={entry.displayName} index={index} />
        <span className="truncate text-sm font-medium text-white">{entry.displayName}</span>
      </div>
      <StatCell entry={entry} />
    </motion.div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[60px] animate-pulse rounded-xl border border-white/5 bg-white/5" />
      ))}
    </div>
  );
}

export function LeaderboardScreen({ token, gameId, onBack }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Data layer unchanged: the board comes straight from GET /leaderboard/:gameId.
  useEffect(() => {
    setLoading(true);
    api
      .leaderboard(gameId, token)
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : 'Error'))
      .finally(() => setLoading(false));
  }, [token, gameId]);

  const kind = entries[0]?.kind;
  const art = GAME_ART[gameId] ?? FALLBACK_ART;
  const HeroIcon = art.icon;
  const empty = useMemo(() => !loading && !error && entries.length === 0, [loading, error, entries]);

  return (
    <div className="min-h-screen bg-[#0b0e18] text-white">
      <div className="mx-auto max-w-[760px] px-4 py-4">
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
        <div className="relative mb-6 overflow-hidden rounded-2xl border border-brand/30 p-5 md:p-6">
          <div className={cn('absolute inset-0 bg-gradient-to-br opacity-90', art.gradient)} />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(139,61,255,0.35) 0%, transparent 65%)' }}
          />
          <div className="relative z-10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/10 backdrop-blur-sm">
                <HeroIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold leading-tight md:text-2xl">{gameName(gameId)} Leaderboard</h1>
                <p className="text-xs text-white/70 md:text-sm">
                  Ranked by {kindLabel(kind).toLowerCase()} · players vs players, never the house
                </p>
              </div>
            </div>
            <Trophy className="h-10 w-10 text-white/20" aria-hidden="true" />
          </div>
        </div>

        {/* Column hint */}
        <div className="mb-2 flex items-center justify-between px-3 text-[11px] font-medium uppercase tracking-wider text-white/40">
          <span>Rank · Player</span>
          <span>{kindLabel(kind)}</span>
        </div>

        {loading && <ListSkeleton />}

        {error && (
          <p
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-300"
            role="alert"
          >
            Couldn&apos;t load the leaderboard: {error}
          </p>
        )}

        {empty && (
          <div className="rounded-2xl border border-white/5 bg-white/[0.02] py-12 text-center text-white/50">
            <Trophy className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
            <p className="mb-1 text-base">No matches yet</p>
            <p className="text-sm">Play a match to claim the top spot.</p>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((e, i) => (
              <Row key={e.playerId} entry={e} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
