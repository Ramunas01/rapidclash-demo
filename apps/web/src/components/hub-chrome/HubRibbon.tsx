import { Credits } from '../hub-shared/RcIcon.js';
import logoUrl from '../../assets/brand/rapidclash-wordmark.webp';

interface Props {
  /** Live balance in integer credits, or null while it's still loading. */
  balance: number | null;
  /** Tap the logo → home / game list. Ignored when `isGuest` (see below) — never called. */
  onLogo(): void;
  /** Tap the auth control → account / wallet (or the sign-in modal when logged out). */
  onWallet(): void;
  /** When false, the control is a Login/Sign-up pill — never a fake balance (default true). */
  loggedIn?: boolean;
  /** Anonymous guest session (issue #267) — the balance control becomes a plain, non-tappable
   *  "Demo" badge (no real Wallet screen to open: nothing is persisted), and the logo becomes a
   *  plain, non-tappable image (issue #283: it used to route to the full home hub's unrestricted
   *  game grid — the one ungated escape hatch out of the guest's curated surface, landing a guest
   *  on some other game's hub with no stake pre-armed and a permanently locked bet control).
   *  Default false. */
  isGuest?: boolean;
}

/**
 * Top ribbon — solid #0B0B0B fill (the canonical `bg-background` token) except the wordmark
 * (left) and a pill control (right): the Login/Sign-up auth-gate when logged out, the live
 * wallet chip (RC-icon balance + Wallet) when signed in. Shared across hubs. `sticky top-0` (in-flow)
 * on the body-scroll layout (#142): it reserves the wordmark band at the top, then sticks as the
 * page scrolls so content slides *underneath* it and disappears behind the solid fill (mirrors
 * HubToolbar's full-viewport-width solid base — never a fresh literal, or we recreate the drift
 * the unification removed; also stabilizes Safari's chrome-color sampling). `pt-[safe-area-inset-top]`
 * keeps the wordmark below the status bar under viewport-fit=cover; the safe-area strip above it
 * is now painted solid too, not the transparent-over-shell look this used to have.
 *
 * Structural note: the outer `<header>` is full-width (not `max-w-md`) so the solid fill spans
 * the whole viewport on wide screens — only the inner row is `max-w-md`-constrained. The inner
 * row also carries `pb-4`, restoring a resting-state gap below the header (Advisor #7).
 */
export function HubRibbon({ balance, onLogo, onWallet, loggedIn = true, isGuest = false }: Props) {
  return (
    <header className="sticky top-0 z-20 w-full bg-background pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 pb-4">
        {isGuest ? (
          // #283: guest mode has no game list / home hub to return to — every OTHER piece of
          // chrome that would leave the curated surface (related-games rail, footer, bottom nav,
          // the wallet chip) is already inert or hidden for a guest; this logo tap was the one
          // gap, and tapping it dropped a guest onto the full home hub's unrestricted game grid,
          // landing on some other game's hub with no stake pre-armed and a locked bet control —
          // a dead end. Non-interactive, mirroring the plain "Demo" badge already used below.
          <div className="flex items-center" data-testid="hub-logo-inert">
            <img src={logoUrl} alt="RapidClash" className="h-8 w-auto object-contain" />
          </div>
        ) : (
          <button type="button" onClick={onLogo} aria-label="RapidClash — home" className="flex items-center">
            <img src={logoUrl} alt="RapidClash" className="h-8 w-auto object-contain" />
          </button>
        )}

        <div className="flex items-center gap-2">
          {isGuest ? (
            <div
              data-testid="hub-guest-badge"
              className="flex items-center gap-2 rounded-full bg-surface py-1.5 pl-3.5 pr-4"
            >
              <span className="text-sm font-bold tabular-nums text-foreground" data-testid="hub-balance">
                {balance === null ? '—' : <Credits amount={balance} />}
              </span>
              <span className="text-xs font-extrabold uppercase tracking-wide text-muted-foreground">Demo</span>
            </div>
          ) : loggedIn ? (
            <button
              type="button"
              onClick={onWallet}
              aria-label="Open wallet"
              data-testid="hub-wallet-chip"
              className="flex items-center gap-2 rounded-full bg-surface py-1.5 pl-3.5 pr-1.5 transition-colors hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="text-sm font-bold tabular-nums text-foreground" data-testid="hub-balance">
                {balance === null ? '—' : <Credits amount={balance} />}
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
        </div>
      </div>
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
