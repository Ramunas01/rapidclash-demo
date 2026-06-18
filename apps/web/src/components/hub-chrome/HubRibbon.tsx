import { Wallet as WalletIcon } from 'lucide-react';
import { formatCredits } from '../../format.js';
import logoUrl from '../../assets/brand/RapidClash_main_logo.02b204a9.png';

interface Props {
  /** Live balance in integer credits, or null while it's still loading. */
  balance: number | null;
  /** Tap the logo → game list. */
  onLogo(): void;
  /** Tap the wallet chip → account / wallet screen. */
  onWallet(): void;
}

/**
 * Sticky top ribbon: logo (left) + live wallet chip (right). Hub-local for now — kept as a
 * standalone component under `components/hub-chrome/` so it can be promoted to a global app
 * shell later without rewriting it (it takes only data + callbacks, no screen knowledge).
 */
export function HubRibbon({ balance, onLogo, onWallet }: Props) {
  return (
    <header className="z-20 flex shrink-0 items-center justify-between border-b border-white/5 bg-[#0b0e18]/95 px-4 py-3 backdrop-blur">
      <button type="button" onClick={onLogo} aria-label="RapidClash — game list" className="flex items-center">
        <img src={logoUrl} alt="RapidClash" className="h-7 w-auto" />
      </button>

      <button
        type="button"
        onClick={onWallet}
        aria-label="Open wallet"
        data-testid="hub-wallet-chip"
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-3 pr-1 transition-colors hover:border-purple-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden="true" />
        <span className="text-sm font-bold tabular-nums text-white" data-testid="hub-balance">
          {balance === null ? '—' : formatCredits(balance)}
        </span>
        <span className="flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white">
          <WalletIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Wallet
        </span>
      </button>
    </header>
  );
}
