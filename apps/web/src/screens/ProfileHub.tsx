import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Gift,
  LogOut,
  Receipt,
  RotateCcw,
  Sparkles,
  Trophy,
  Wallet as WalletIcon,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { AvatarId, GameMeta, LedgerEntry, LedgerEntryType, LeaderboardEntry } from '@rapidclash/shared';
import { api } from '../api.js';
import { Credits } from '../components/hub-shared/RcIcon.js';
import { formatStat } from './Leaderboard.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { HubFooter } from '../components/hub-shared/HubFooter.js';
import { MuteToggle } from '../components/hub-chrome/MuteToggle.js';
import { Avatar } from '../components/hub-shared/Avatar.js';
import { HUB_SHELL, HUB_BODY } from '../components/hub-chrome/layout.js';

interface Props {
  token: string;
  /** The signed-in player's own alias (#34); null only on a legacy session. */
  username: string | null;
  /** The player's OWN stored avatar. Drives the header disc; the picker sets a new one. */
  avatarId?: AvatarId;
  /** Save-picker callback — App mirrors the choice into its own state + localStorage so the own
   *  game bar + a reload reflect it. The endpoint already persisted it server-side. */
  onAvatarChange?(avatarId: AvatarId): void;
  balance: number;
  onLogout(): void;
  /** Logo / Games nav → Home. */
  onHome(): void;
  /** Wallet chip / Account → stays on Profile (self). */
  onOpenProfile(): void;
  /** Rewards tab → the VIP/Rewards hub (issue #307). */
  onOpenRewards(): void;
}

/** The selectable avatars in the picker: default + the six presets (presets-only, no upload). */
const PICKER_AVATARS: AvatarId[] = ['default', 'boy-light', 'girl-light', 'boy-brown', 'boy-dark', 'hooded-mono', 'hooded-degen'];

// ── Ledger presentation (lifted from Wallet.tsx, restyled to v2 tokens) ──────
const ENTRY_ART: Record<LedgerEntryType, { icon: LucideIcon; credit: boolean }> = {
  GRANT: { icon: Gift, credit: true },
  ADMIN_CREDIT: { icon: Sparkles, credit: true },
  BET_ESCROW: { icon: ArrowUpRight, credit: false },
  SETTLE_WIN: { icon: Trophy, credit: true },
  SETTLE_REFUND: { icon: RotateCcw, credit: true },
  RAKE: { icon: Receipt, credit: false },
  // Rewards backend (issue #306) — a claimed rakeback/volume-bonus credit. Mechanical addition:
  // this map is exhaustive over LedgerEntryType, so adding the new type to the shared union
  // forces this entry; the Rewards frontend itself (issue #307) is a separate, later ticket.
  REWARD_CLAIM: { icon: Trophy, credit: true },
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

/**
 * Profile hub — the Account toolbar / wallet-chip target. Composes the account surface on
 * one screen under the shared chrome (no route nav between sections): profile header
 * (client-side avatar + alias + log out), wallet (balance + recent ledger), and a small
 * leaderboard with a live-games picker. Read-only / play-money — no hidden info. Stays
 * simplified per HUB_TRANSITION_ANALYSIS §8 (wallet + ledger + leaderboard, no stats endpoint).
 */
export function ProfileHubScreen({ token, username, avatarId = 'default', onAvatarChange, balance, onLogout, onHome, onOpenProfile, onOpenRewards }: Props) {
  const [liveBalance, setLiveBalance] = useState(balance);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Lifetime-wagered (issue #307, written spec §3.5 + Owner decision #3): the design's own
  // "RC WAGERED" stat tile lives on THIS page (the `isAccount` view's `accountStats` 3-tile
  // row) — this is that same figure, now wired to the real rewards snapshot instead of the
  // design's placeholder '18.4K'. Defaults to 0 (not undefined) so a still-loading or
  // unexpectedly-shaped response never renders a broken "undefined" credits figure.
  const [wageredLifetime, setWageredLifetime] = useState(0);
  useEffect(() => { setLiveBalance(balance); }, [balance]);
  useEffect(() => {
    let alive = true;
    api.wallet(token)
      .then((w) => { if (alive) { setLiveBalance(w.balance); setEntries(w.entries.slice(-6).reverse()); } })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingLedger(false); });
    api.rewards(token)
      .then((r) => { if (alive && typeof r.wageredLifetime === 'number') setWageredLifetime(r.wageredLifetime); })
      .catch(() => {});
    return () => { alive = false; };
  }, [token]);

  return (
    <div className={HUB_SHELL}>
      <HubRibbon balance={liveBalance} onLogo={onHome} onWallet={onOpenProfile} />

      <main data-testid="profile-hub">
        <div className={cn('mx-auto flex max-w-md flex-col gap-5 px-4', HUB_BODY)}>
          {/* 1 — Profile header: avatar (tap → picker) + alias + log out. */}
          <section data-testid="profile-header" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              data-testid="profile-avatar-button"
              aria-label="Change avatar"
              className="shrink-0 rounded-full outline-none ring-offset-2 ring-offset-card transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Avatar username={username} avatarId={avatarId} size={56} className="shadow-lg" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-bold leading-tight" data-testid="profile-username">
                {username ?? 'Player'}
              </p>
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Play-money account
              </span>
            </div>
            {/* Sound mute toggle — relocated from the header; global + persisted, self-contained. */}
            <MuteToggle />
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
              <div className="mt-1.5 flex items-center justify-center text-4xl font-bold tabular-nums" data-testid="profile-balance" aria-label="balance">
                <Credits amount={liveBalance} size={28} />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Play-money credits — no real-world value.</p>
            </div>

            {/* Lifetime-wagered (issue #307, written spec §3.5 + Owner decision #3) — the design's
                own "RC WAGERED" account stat, wired to the real rewards snapshot. */}
            <div className="mt-3 flex items-center justify-between rounded-xl bg-surface px-4 py-3">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">RC wagered (lifetime)</span>
              <span className="text-sm font-bold tabular-nums text-foreground" data-testid="profile-wagered-lifetime">
                <Credits amount={wageredLifetime} />
              </span>
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
        </div>

        <HubFooter onGames={onHome} onRewards={onOpenRewards} />
      </main>

      <HubToolbar onGames={onHome} onAccount={onOpenProfile} onRewards={onOpenRewards} active="account" />

      {pickerOpen && (
        <AvatarPicker
          token={token}
          username={username}
          current={avatarId}
          onSaved={(id) => { onAvatarChange?.(id); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * §3 avatar picker — an overlay panel (the auth-popup `bg-surface` treatment, no rim) with the
 * default + 4 presets rendered via the shared Avatar (so the disc matches the user's). Tapping a
 * preset shows the purple selection ring; the solid Save button calls `api.setAvatar`, and on
 * success bubbles the id up (App mirrors it into state + localStorage). Presets-only — no upload.
 */
function AvatarPicker({
  token,
  username,
  current,
  onSaved,
  onClose,
}: {
  token: string;
  username: string | null;
  current: AvatarId;
  onSaved(id: AvatarId): void;
  onClose(): void;
}) {
  const [selected, setSelected] = useState<AvatarId>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Lock body scroll while the overlay is open (same pattern as AuthModal).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const res = await api.setAvatar(selected, token);
      onSaved(res.avatarId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save avatar');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your avatar"
      data-testid="avatar-picker"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-base font-bold">Choose your avatar</span>
          <button type="button" onClick={onClose} aria-label="Dismiss" className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3" role="group" aria-label="Avatar presets">
          {PICKER_AVATARS.map((id) => {
            const isSel = selected === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelected(id)}
                aria-pressed={isSel}
                data-testid={`avatar-option-${id}`}
                className={cn(
                  'flex items-center justify-center rounded-2xl bg-background p-3 transition-colors',
                  isSel ? 'ring-[3px] ring-brand' : 'ring-1 ring-border hover:ring-white/20',
                )}
              >
                <Avatar avatarId={id} username={username} size={56} />
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="avatar-picker-error">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          data-testid="avatar-picker-save"
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-bold text-white shadow-lg shadow-brand/20 transition-all hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
        </button>
      </motion.div>
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
        <Credits amount={entry.amount} showSign />
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
                {/* Public leaderboard alias + its stored avatar, mirroring Leaderboard.tsx rows. */}
                <Avatar username={e.displayName} avatarId={e.avatarId} size={36} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{e.displayName}</span>
                <span className={cn('text-sm font-bold tabular-nums', neg ? 'text-destructive' : 'text-foreground/80')}>
                  {e.kind === 'net_winnings' ? <Credits amount={e.netWinnings} showSign /> : formatStat(e)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
