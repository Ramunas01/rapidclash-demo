import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Gift,
  LogOut,
  Play,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trophy,
  Wallet as WalletIcon,
  type LucideIcon,
} from 'lucide-react';
import type { LedgerEntry, LedgerEntryType } from '@rapidclash/shared';
import { api } from '../api.js';
import { formatCredits } from '../format.js';
import { cn } from '@/lib/utils';

interface Props {
  token: string;
  /** The signed-in player's own alias (#34); null only on a legacy session pre-dating the field. */
  username: string | null;
  balance: number;
  onPlay(): void;
  onLogout(): void;
}

/** Per-ledger-type presentation. The visible label keeps the raw type token (e.g. GRANT)
 *  so it reads the same as the wire value; icon/credit are presentation only. */
const ENTRY_ART: Record<LedgerEntryType, { icon: LucideIcon; credit: boolean }> = {
  GRANT: { icon: Gift, credit: true },
  ADMIN_CREDIT: { icon: Sparkles, credit: true },
  BET_ESCROW: { icon: ArrowUpRight, credit: false },
  SETTLE_WIN: { icon: Trophy, credit: true },
  SETTLE_REFUND: { icon: RotateCcw, credit: true },
  RAKE: { icon: Receipt, credit: false },
};

/** Render the ledger type as its raw token with underscores spaced — GRANT stays "GRANT". */
function formatType(type: LedgerEntryType): string {
  return type.replace(/_/g, ' ');
}

/** Initials avatar, generated client-side from the alias (the platform stores no avatars). */
function initialsOf(alias: string | null): string {
  if (!alias) return '?';
  const parts = alias.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : alias.slice(0, 2);
  return letters.toUpperCase();
}

/** Stable gradient per alias so the avatar colour is consistent across sessions. */
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function EntryRow({ entry, index }: { entry: LedgerEntry; index: number }) {
  const art = ENTRY_ART[entry.type];
  const Icon = art?.icon ?? Receipt;
  const positive = entry.amount > 0;
  const date = formatDate(entry.createdAt);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="flex items-center gap-3 rounded-xl border border-transparent bg-white/[0.02] px-3 py-3 transition-colors hover:border-white/10"
    >
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          positive ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-white/60',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-white/80">{formatType(entry.type)}</p>
        {date && <p className="text-[11px] text-white/40">{date}</p>}
      </div>
      <span
        className={cn(
          'flex items-center gap-0.5 text-sm font-bold tabular-nums',
          positive ? 'text-green-400' : 'text-white/70',
        )}
      >
        {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownLeft className="h-3.5 w-3.5" />}
        {positive ? '+' : ''}{formatCredits(entry.amount)}
      </span>
    </motion.div>
  );
}

export function WalletScreen({ token, username, balance: initialBalance, onPlay, onLogout }: Props) {
  const [balance, setBalance] = useState(initialBalance);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Data layer unchanged: balance + recent ledger come straight from GET /wallet.
  useEffect(() => {
    api.wallet(token).then(data => {
      setBalance(data.balance);
      setEntries(data.entries.slice(-5).reverse());
    }).catch(console.error).finally(() => setLoading(false));
  }, [token]);

  const initials = useMemo(() => initialsOf(username), [username]);
  const gradient = useMemo(() => gradientFor(username), [username]);

  return (
    <div className="min-h-screen bg-[#0b0e18] text-white">
      <div className="mx-auto max-w-[560px] px-4 py-6">
        {/* Profile header — alias + initials avatar (no backend avatar store). */}
        <div className="relative mb-5 overflow-hidden rounded-2xl border border-brand/30 p-5">
          <div className="absolute inset-0 bg-gradient-to-br from-[#2d0f6b] via-[#1e0a4a] to-[#0b0818]" />
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(139,61,255,0.35) 0%, transparent 65%)' }}
          />
          <div className="relative z-10 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={cn(
                  'flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-lg font-bold text-white shadow-lg',
                  gradient,
                )}
                aria-hidden="true"
              >
                {initials}
              </div>
              <div className="min-w-0">
                {username ? (
                  <p className="truncate text-lg font-bold leading-tight" data-testid="signed-in-as">Signed in as <strong>{username}</strong></p>
                ) : (
                  <p className="text-lg font-bold leading-tight">Your wallet</p>
                )}
                <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/70">
                  <ShieldCheck className="h-3 w-3" />
                  Play-money account
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>

        {/* Balance */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center"
        >
          <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wider text-white/50">
            <WalletIcon className="h-3.5 w-3.5" />
            Balance
          </p>
          <div className="mt-2 text-4xl font-bold tabular-nums" aria-label="balance">
            {formatCredits(balance)}
          </div>
          <p className="mt-2 text-[11px] text-white/40">Play-money credits — no real-world value.</p>
        </motion.div>

        {/* Recent ledger */}
        <div className="mb-5">
          <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-white/80">
            <Receipt className="h-4 w-4 text-brand" />
            Recent transactions
          </h2>
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-[60px] animate-pulse rounded-xl border border-white/5 bg-white/5" />
              ))}
            </div>
          ) : entries.length > 0 ? (
            <div className="space-y-2">
              {entries.map((e, i) => (
                <EntryRow key={e.id} entry={e} index={i} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] py-10 text-center text-white/50">
              <Receipt className="mx-auto mb-2 h-8 w-8 opacity-30" aria-hidden="true" />
              <p className="text-sm">No transactions yet — play a match to get started.</p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onPlay}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand/20 transition-all hover:-translate-y-0.5 hover:shadow-brand/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Play className="h-4 w-4" />
          Play
        </button>
      </div>
    </div>
  );
}
