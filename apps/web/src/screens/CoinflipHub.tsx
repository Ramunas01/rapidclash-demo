import { useEffect, useState, type ReactNode } from 'react';
import { Coins } from 'lucide-react';
import { api } from '../api.js';
import { formatCredits } from '../format.js';
import { cn } from '@/lib/utils';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import rivalBanner from '../assets/banners/banner-Bring-the-rival.png';

interface Props {
  token: string;
  /** Last-known balance from the app (shown instantly); the hub refetches a live value on mount. */
  initialBalance: number;
  /** Open the wallet/account screen (top chip + account toolbar icon share this). */
  onOpenWallet(): void;
  /** Back to the game list (logo + menu/games toolbar icons share this). */
  onOpenGameList(): void;
}

/** Coinflip's six presets, within the 1–100 stake range (rendered in ¢, never $). */
const BET_PRESETS = [1, 5, 10, 25, 50, 100];

/**
 * Coinflip Hub — Part 1: chrome + shell only.
 *
 * One scrollable screen that becomes the Coinflip destination (App routes here instead of the
 * old stake-entry/lobby/play/result flow). This part ships the sticky top ribbon, the sticky
 * bottom toolbar, and a scrollable body of labelled stub sections in the spec's order so the
 * layout is reviewable. The WS state machine, real section data, and the result overlay are
 * Part 2. See docs/COINFLIP_HUB.md.
 */
export function CoinflipHubScreen({ token, initialBalance, onOpenWallet, onOpenGameList }: Props) {
  const [balance, setBalance] = useState<number | null>(initialBalance);

  // The wallet chip must be real, not decorative: pull a live balance on mount.
  useEffect(() => {
    let alive = true;
    api
      .wallet(token)
      .then((w) => {
        if (alive) setBalance(w.balance);
      })
      .catch(() => {
        /* keep the last-known balance on a transient failure */
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="flex h-[100dvh] flex-col bg-[#0b0e18] text-white">
      <HubRibbon balance={balance} onLogo={onOpenGameList} onWallet={onOpenWallet} />

      <main className="flex-1 overflow-y-auto" data-testid="hub-body">
        <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
          {/* 1 — Coinflip game area (hero); greyed/inactive in Idle (Part 2 activates it). */}
          <HubSection n={1} title="Coinflip" testId="hub-section-game">
            <div className="flex flex-col items-center gap-4 py-4 opacity-50">
              <div className="flex h-28 w-28 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-yellow-300/30 to-yellow-600/20">
                <Coins className="h-12 w-12 text-yellow-300/70" aria-hidden="true" />
              </div>
              <div className="grid w-full grid-cols-2 gap-3">
                <div className="rounded-xl border border-white/10 bg-white/5 py-4 text-center text-sm font-bold tracking-wide">
                  HEADS
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 py-4 text-center text-sm font-bold tracking-wide">
                  TAILS
                </div>
              </div>
              <p className="text-xs text-white/40">Idle — activates when a match starts (Part 2)</p>
            </div>
          </HubSection>

          {/* "stake & play" block: bet (2) directly above PLAY (3), per the revised scroll order. */}
          <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            {/* 2 — BET AMOUNT selector (six ¢ presets; static stub in Part 1). */}
            <div data-testid="hub-section-bet">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-white/50">Bet amount</span>
                <span className="text-[11px] text-white/40">max {formatCredits(100)}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {BET_PRESETS.map((v) => (
                  <div
                    key={v}
                    className="rounded-lg border border-white/10 bg-white/5 py-2 text-center text-sm font-medium text-white/70"
                  >
                    {formatCredits(v)}
                  </div>
                ))}
              </div>
            </div>

            {/* 3 — PLAY button (green); inactive until a bet is selected (wired in Part 2). */}
            <button
              type="button"
              disabled
              data-testid="hub-play"
              className="w-full cursor-not-allowed rounded-xl bg-green-500/40 py-3.5 text-base font-bold text-white/70"
            >
              PLAY
            </button>
            <p className="text-center text-[11px] text-white/30">Select a bet to enable — posts your challenge (Part 2)</p>
          </div>

          {/* 4 — Open challenges ("players waiting"). */}
          <HubSection n={4} title="Open challenges" testId="hub-section-challenges">
            <SkeletonRows rows={3} />
            <p className="mt-2 text-xs text-white/40">Resting Coinflip challenges — each row will JOIN at its own stake (Part 2)</p>
          </HubSection>

          {/* 5 — Related games (PvP only — never house-edge games; see CHARTER PvP-only corollary). */}
          <HubSection n={5} title="Related games" testId="hub-section-related">
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="aspect-[3/4] animate-pulse rounded-xl border border-white/5 bg-white/5" />
              ))}
            </div>
            <p className="mt-2 text-xs text-white/40">PvP games only, from /games (Part 2)</p>
          </HubSection>

          {/* 6 — "Bring the rival" banner (static image for now). */}
          <section data-testid="hub-section-rival" aria-label="Bring a rival">
            <img src={rivalBanner} alt="Bring a rival — challenge a friend" className="w-full rounded-2xl" />
          </section>

          {/* 7 — RECENT CLASHES (Coinflip leaderboard). */}
          <HubSection n={7} title="Recent clashes" testId="hub-section-clashes">
            <SkeletonRows rows={4} />
            <p className="mt-2 text-xs text-white/40">Coinflip leaderboard — net winnings in ¢ (Part 2)</p>
          </HubSection>

          {/* 8 — Footer (sanitized text stub; the supplied footer art carries forbidden socials /
              "provably fair" copy, so it is not used). */}
          <footer data-testid="hub-section-footer" className="border-t border-white/5 pt-4 pb-2 text-center">
            <p className="text-xs font-medium text-white/50">Players vs Players — never the house.</p>
            <p className="mt-1 text-[11px] text-white/30">Play-money demo · credits only, no real-world value.</p>
          </footer>
        </div>
      </main>

      <HubToolbar onGames={onOpenGameList} onAccount={onOpenWallet} />
    </div>
  );
}

/** A labelled stub card so each body section is reviewable as a frame in Part 1. */
function HubSection({ n, title, testId, children }: { n: number; title: string; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId} aria-label={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className={cn('space-y-2')}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl border border-white/5 bg-white/5" />
      ))}
    </div>
  );
}
