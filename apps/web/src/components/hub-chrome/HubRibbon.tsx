import { formatCredits } from '../../format.js';
import logoUrl from '../../assets/brand/rapidclash-wordmark.webp';

interface Props {
  /** Live balance in integer credits, or null while it's still loading. */
  balance: number | null;
  /** Tap the logo → home / game list. */
  onLogo(): void;
  /** Tap the auth control → account / wallet (or the sign-in modal when logged out). */
  onWallet(): void;
  /** When false, the control is a Login/Sign-up pill — never a fake balance (default true). */
  loggedIn?: boolean;
}

/**
 * Top ribbon — transparent except the wordmark (left) and a pill control (right): the
 * Login/Sign-up auth-gate when logged out, the live wallet chip (balance ¢ + Wallet) when
 * signed in. Shared across hubs; in-flow (not fixed) so each hub's flex-column layout holds.
 */
export function HubRibbon({ balance, onLogo, onWallet, loggedIn = true }: Props) {
  return (
    <header className="fixed left-1/2 top-0 z-20 flex w-full max-w-md -translate-x-1/2 items-center justify-between bg-transparent px-4">
      <button type="button" onClick={onLogo} aria-label="RapidClash — home" className="-ml-3 flex items-center">
        <img src={logoUrl} alt="RapidClash" className="h-24 w-auto object-contain" />
      </button>

      {loggedIn ? (
        <button
          type="button"
          onClick={onWallet}
          aria-label="Open wallet"
          data-testid="hub-wallet-chip"
          className="flex items-center gap-2 rounded-full bg-surface py-1.5 pl-3.5 pr-1.5 transition-colors hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          <span className="text-sm font-bold tabular-nums text-foreground" data-testid="hub-balance">
            {balance === null ? '—' : formatCredits(balance)}
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-2 text-xs font-extrabold uppercase tracking-wide text-white">
            <WalletGlyph />
            Wallet
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-1 rounded-full bg-surface py-1.5 pl-4 pr-1.5">
          <button
            type="button"
            onClick={onWallet}
            aria-label="Log in"
            data-testid="hub-login-chip"
            className="whitespace-nowrap px-2 py-1.5 text-[13px] font-bold tracking-wide text-foreground focus:outline-none"
          >
            LOG IN
          </button>
          <button
            type="button"
            onClick={onWallet}
            aria-label="Sign up"
            data-testid="hub-signin-chip"
            className="whitespace-nowrap rounded-full bg-brand px-5 py-2.5 text-[13px] font-extrabold tracking-wide text-white transition-colors hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            SIGN UP
          </button>
        </div>
      )}
    </header>
  );
}

function WalletGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 3H8L2 7" />
    </svg>
  );
}
