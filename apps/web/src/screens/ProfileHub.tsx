import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  LogOut,
  Receipt,
  RotateCcw,
  Sparkles,
  Trophy,
  Wallet as WalletIcon,
  type LucideIcon,
} from 'lucide-react';
import type { GameMeta, LedgerEntry, LedgerEntryType, LeaderboardEntry } from '@rapidclash/shared';
import { api } from '../api.js';
import { formatCredits } from '../format.js';
import { formatStat } from './Leaderboard.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';

interface Props {
  token: string;
  /** The signed-in player's own alias (#34); null only on a legacy session. */
  username: string | null;
  balance: number;
  onLogout(): void;
  /** Logo / Games nav → Home. */
  onHome(): void;
  /** Wallet chip / Account → stays on Profile (self). */
  onOpenProfile(): void;
}

// ── Ledger presentation (lifted from Wallet.tsx, restyled to v2 tokens) ──────
const ENTRY_ART: Record<LedgerEntryType, { icon: LucideIcon; credit: boolean }> = {
  GRANT: { icon: Gift, credit: true },
  ADMIN_CREDIT: { icon: Sparkles, credit: true },
  BET_ESCROW: { icon: ArrowUpRight, credit: false },
  SETTLE_WIN: { icon: Trophy, credit: true },
  SETTLE_REFUND: { icon: RotateCcw, credit: true },
  RAKE: { icon: Receipt, credit: false },
};

/** The ledger type as its raw token with underscores spaced — GRANT stays "GRANT". */
function formatType(type: LedgerEntryType): string {
  return type.replace(/_/g, ' ');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Client-side initials avatar (the platform stores no avatars). */
function initialsOf(alias: string | null): string {
  if (!alias) return '?';
  const parts = alias.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : alias.slice(0, 2);
  return letters.toUpperCase();
}

/** Deterministic gradient per alias so the avatar colour is stable across sessions. */
const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-purple-500 to-fuchsia-600',
  'from-indigo-500 to-purple-600',
  'from-fuchsia-500 to-pink-600',
  'from-blue-500 to-indigo-600',
];
function gradientFor(alias: string | null): string {
  if (!alias) return AVATAR_GRADIENTS[0];
  let sum = 0;
  for (let i = 0; i < alias.length; i++) sum += alias.charCodeAt(i);
  return AVATAR_GRADIENTS[sum % AVATAR_GRADIENTS.length];
}

/**
 * Profile hub — the Account toolbar / wallet-chip target. Composes the account surface on
 * one screen under the shared chrome (no route nav between sections): profile header
 * (client-side avatar + alias + log out), wallet (balance + recent ledger), and a small
 * leaderboard with a live-games picker. Read-only / play-money — no hidden info. Stays
 * simplified per HUB_TRANSITION_ANALYSIS §8 (wallet + ledger + leaderboard, no stats endpoint).
 */
export function ProfileHubScreen({ token, username, balance, onLogout, onHome, onOpenProfile }: Props) {
  const [liveBalance, setLiveBalance] = useState(balance);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(true);
  useEffect(() => { setLiveBalance(balance); }, [balance]);
  useEffect(() => {
    let alive = true;
    api.wallet(token)
      .then((w) => { if (alive) { setLiveBalance(w.balance); setEntries(w.entries.slice(-6).reverse()); } })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingLedger(false); });
    return () => { alive = false; };
  }, [token]);

  const initials = useMemo(() => initialsOf(username), [username]);
  const gradient = useMemo(() => gradientFor(username), [username]);

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <HubRibbon balance={liveBalance} onLogo={onHome} onWallet={onOpenProfile} />

      <main className="flex-1 overflow-y-auto" data-testid="profile-hub">
        <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-4">
          {/* 1 — Profile header: avatar + alias + log out. */}
          <section data-testid="profile-header" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <div
              className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-lg font-bold text-white shadow-lg', gradient)}
              aria-hidden="true"
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold leading-tight" data-testid="profile-username">
                {username ?? 'Player'}
              </p>
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Play-money account
              </span>
            </div>
            <button
              type="button"
              onClick={onLogout}
              data-testid="profile-logout"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Log out
            </button>
          </section>

          {/* 2 — Wallet: balance + recent ledger. */}
          <section data-testid="profile-wallet" className="rounded-2xl border border-border bg-card p-4">
            <div className="rounded-xl bg-surface p-5 text-center">
              <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <WalletIcon className="h-3.5 w-3.5" /> Balance
              </p>
              <div className="mt-1.5 text-4xl font-bold tabular-nums" data-testid="profile-balance" aria-label="balance">
                {formatCredits(liveBalance)}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Play-money credits — no real-world value.</p>
            </div>

            <h2 className="mb-2 mt-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground">
              <Receipt className="h-4 w-4 text-brand" /> Recent transactions
            </h2>
            <div data-testid="profile-ledger">
              {loadingLedger ? (
                <div className="space-y-2" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-[52px] animate-pulse rounded-xl bg-surface" />
                  ))}
                </div>
              ) : entries.length > 0 ? (
                <div className="space-y-2">
                  {entries.map((e) => <LedgerRow key={e.id} entry={e} />)}
                </div>
              ) : (
                <p className="py-4 text-center text-xs text-muted-foreground">No transactions yet — play a match to get started.</p>
              )}
            </div>
          </section>

          {/* 3 — Leaderboard: live-games picker + the selected game's rankings. */}
          <ProfileLeaderboard token={token} />

          <footer className="border-t border-border pt-4 pb-2 text-center">
            <p className="text-[11px] text-muted-foreground">Players vs Players — never the house · play-money demo.</p>
          </footer>
        </div>
      </main>

      <HubToolbar onGames={onHome} onAccount={onOpenProfile} active="account" />
    </div>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const art = ENTRY_ART[entry.type];
  const Icon = art?.icon ?? Receipt;
  const positive = entry.amount > 0;
  const date = formatDate(entry.createdAt);
  return (
    <div data-testid={`profile-entry-${entry.id}`} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5">
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', positive ? 'bg-success/15 text-success' : 'bg-background text-muted-foreground')}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-foreground/80">{formatType(entry.type)}</p>
        {date && <p className="text-[11px] text-muted-foreground">{date}</p>}
      </div>
      <span className={cn('flex items-center gap-0.5 text-sm font-bold tabular-nums', positive ? 'text-success' : 'text-foreground/70')}>
        {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
        {positive ? '+' : ''}{formatCredits(entry.amount)}
      </span>
    </div>
  );
}

/** §3 — small leaderboard with a live-games picker. Reuses Leaderboard's kind-aware formatStat. */
function ProfileLeaderboard({ token }: { token: string }) {
  const [games, setGames] = useState<GameMeta[]>([]);
  const [gameId, setGameId] = useState<string>('coinflip');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    let alive = true;
    api.games(token).then((g) => {
      if (!alive || !Array.isArray(g) || g.length === 0) return;
      setGames(g);
      // Default to coinflip if present, else the first live game.
      if (!g.some((m) => m.id === 'coinflip')) setGameId(g[0].id);
    }).catch(() => {});
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    let alive = true;
    api.leaderboard(gameId, token).then((e) => { if (alive && Array.isArray(e)) setEntries(e); }).catch(() => {});
    return () => { alive = false; };
  }, [token, gameId]);

  return (
    <section data-testid="profile-leaderboard" className="rounded-2xl border border-border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-foreground">
        <Trophy className="h-4 w-4 text-brand" /> Leaderboard
      </h2>

      {/* Game picker — live games only (data-driven from /games). */}
      {games.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Pick a game">
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setGameId(g.id)}
              data-testid={`profile-lb-pick-${g.id}`}
              aria-pressed={gameId === g.id}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
                gameId === g.id ? 'bg-brand text-white' : 'bg-surface text-muted-foreground hover:text-foreground',
              )}
            >
              {g.displayName}
            </button>
          ))}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">No matches yet — play to claim the top spot.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.slice(0, 5).map((e) => {
            const neg = e.kind === 'net_winnings' && e.netWinnings < 0;
            return (
              <div key={e.playerId} data-testid={`profile-rank-${e.playerId}`} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2">
                <span className="w-5 text-center text-sm font-bold text-muted-foreground">{e.rank}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{e.displayName}</span>
                <span className={cn('text-sm font-bold tabular-nums', neg ? 'text-destructive' : 'text-foreground/80')}>{formatStat(e)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
