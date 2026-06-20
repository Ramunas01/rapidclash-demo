import { Wallet as WalletIcon } from 'lucide-react';
import { formatCredits } from '../../format.js';
import logoUrl from '../../assets/brand/RapidClash_main_logo.02b204a9.png';

interface Props {
  /** Live balance in integer credits, or null while it's still loading. */
  balance: number | null;
  /** Tap the logo → game list. */
  onLogo(): void;
  /** Tap the wallet chip → account / wallet screen (or the sign-in modal when logged out). */
  onWallet(): void;
  /** When false, the chip is a "Sign in" affordance — never a fake balance (default true). */
  loggedIn?: boolean;
}

/**
 * Sticky top ribbon: logo (left) + live wallet chip (right). Hub-local for now — kept as a
 * standalone component under `components/hub-chrome/` so it can be promoted to a global app
 * shell later without rewriting it (it takes only data + callbacks, no screen knowledge).
 */
export function HubRibbon({ balance, onLogo, onWallet, loggedIn = true }: Props) {
  return (
    <header className="z-20 flex shrink-0 items-center justify-between mx-auto w-full max-w-md border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
      <button type="button" onClick={onLogo} aria-label="RapidClash — game list" className="flex items-center">
        <img src={logoUrl} alt="RapidClash" className="h-12 w-auto" />
      </button>

      {loggedIn ? (
        <button
          type="button"
          onClick={onWallet}
          aria-label="Open wallet"
          data-testid="hub-wallet-chip"
          className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-3 pr-1 transition-colors hover:border-brand/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          <span className="text-sm font-bold tabular-nums text-foreground" data-testid="hub-balance">
            {balance === null ? '—' : formatCredits(balance)}
          </span>
          <span className="flex items-center gap-1 rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white">
            <WalletIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Wallet
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onWallet}
          aria-label="Sign in"
          data-testid="hub-signin-chip"
          className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-xs font-bold text-white transition-colors hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <WalletIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Sign in
        </button>
      )}
    </header>
  );
}
