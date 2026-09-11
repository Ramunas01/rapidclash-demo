import { Credits } from '../hub-shared/RcIcon.js';
import { useTheme } from '../../lib/theme.js';
import logoLightBgUrl from '../../assets/brand/rapidclash-wordmark.webp';
import logoDarkBgUrl from '../../assets/brand/rapidclash-wordmark-dark.png';

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
 * Top ribbon (issue #484, T2 shared-chrome rebuild) — rebuilt against `design/prototype/RapidClash
 * Full Spec.html`'s persistent header block (`~line 2217`: `display:flex; align-items:center;
 * justify-content:space-between; ...position:absolute; top:0; left:0; right:0; z-index:7;
 * background:var(--rc-bg);`). Wordmark (left) + a pill control (right): the LOGIN/SIGNUP auth-gate
 * pair when signed out (`~2219-2228`), the currency-badge + balance + WALLET pill when signed in
 * (`~2229-2240`). Shared across hubs. `sticky top-0` (in-flow) on the body-scroll layout (#142): it
 * reserves the wordmark band at the top, then sticks as the page scrolls so content slides
 * *underneath* it and disappears behind the solid fill (mirrors HubToolbar's full-viewport-width
 * solid base — never a fresh literal, or we recreate the drift the unification removed; also
 * stabilizes Safari's chrome-color sampling). `pt-[safe-area-inset-top]` keeps the wordmark below
 * the status bar under viewport-fit=cover.
 *
 * Structural note: the outer `<header>` is full-width (not `max-w-md`) so the solid fill spans
 * the whole viewport on wide screens — only the inner row is `max-w-md`-constrained. The inner
 * row also carries a bottom padding, restoring a resting-state gap below the header (Advisor #7).
 * Reconciliation sweep (2026-09-11): re-measured live via Playwright against the prototype's
 * real header spacing (`padding:64px 16px 14px 16px`) and found the app's `pb-4` (16px) was 2px
 * over — changed to `pb-3.5` (14px) to match exactly. `layout.ts`'s `HUB_FIXED_TOP` was
 * re-measured and updated in the same change — see its own comment for the full before/after.
 *
 * Light-mode threading (#484's actual point — every color below used to read a shadcn token with
 * no light override, so the header stayed black-on-dark even once the rest of the app switched to
 * light): `bg-background`/`text-foreground`/`text-muted-foreground` → the T1 `--rc-*` set
 * (`--rc-bg`/`--rc-text`/`--rc-muted`), which DOES carry a `[data-theme='light']` override.
 * `bg-surface` was already theme-aware (tailwind.config.js maps it straight to `var(--rc-surface)`,
 * no `hsl()` wrap) so it's untouched. `bg-brand` (the SIGNUP/WALLET accent pill) intentionally
 * stays a fixed brand-purple in both themes — matches the prototype, whose own `navXColor`/pill
 * literals (`#8B45F0`) never vary with `light`.
 *
 * Wordmark: the prototype swaps TWO logo images by theme (`logoWhiteDisplay`/`logoDarkDisplay`,
 * `assets/rapidclash-logo-white-crop.png` vs `-dark-crop.png` — white "Rapid" for dark backgrounds,
 * black "Rapid" for light ones; "Clash" stays brand-purple in both). This app's pre-existing single
 * wordmark asset (`assets/brand/rapidclash-wordmark.webp`) IS the white-on-dark variant only — a
 * real light-mode bug (white "Rapid" text would vanish on the light `--rc-bg`). Fixed here by
 * copying the prototype's dark-crop PNG in alongside it and swapping on `useTheme().resolved`.
 *
 * Wallet chip: the `$`/multi-currency skin is Owner-approved (`CHARTER.md` #4 amendment,
 * `docs/NEW_DESIGN_MIGRATION.md` → "Currency presentation") for the registered app — this renders
 * a fixed USD badge (prototype's `<symbol id="cur-USD">`, line ~104: green circle + white "$") next
 * to the balance instead of the play-money `¢` `RcIcon`. Guest mode is unchanged — CHARTER.md's
 * guest surface stays `¢`/play-money-framed, so the `isGuest` branch below still renders `<Credits>`.
 * The full multi-currency picker (`curOpen`, the dropdown this chip could expand into) is its own
 * not-yet-started ticket (`NEW_DESIGN_MIGRATION.md`'s "Currency picker" row) — out of scope here.
 */
export function HubRibbon({ balance, onLogo, onWallet, loggedIn = true, isGuest = false }: Props) {
  const { resolved } = useTheme();
  const logoUrl = resolved === 'light' ? logoDarkBgUrl : logoLightBgUrl;
  return (
    <header className="sticky top-0 z-20 w-full bg-[var(--rc-bg)] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 pb-3.5">
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
              <span className="text-sm font-bold tabular-nums text-[var(--rc-text)]" data-testid="hub-balance">
                {balance === null ? '—' : <Credits amount={balance} />}
              </span>
              <span className="text-xs font-extrabold uppercase tracking-wide text-[var(--rc-muted)]">Demo</span>
            </div>
          ) : loggedIn ? (
            // Prototype `~2231-2241`: outer pill `padding:4px 4px 4px 14px; gap:0`, the
            // currency+balance group carries its own `padding-right:12px` for the visual gap
            // before the WALLET sub-pill (rather than a `gap` on the outer flex row).
            <button
              type="button"
              onClick={onWallet}
              aria-label="Open wallet"
              data-testid="hub-wallet-chip"
              className="flex items-center gap-0 rounded-full bg-surface py-1 pl-[14px] pr-1 transition-colors hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className="flex items-center gap-[7px] pr-3">
                <UsdBadge />
                <span
                  className="tabular-nums text-[var(--rc-text)]"
                  style={{ fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif", fontSize: '16px', fontWeight: 700, letterSpacing: '-0.2px' }}
                  data-testid="hub-balance"
                >
                  {balance === null ? '—' : `$${balance.toLocaleString('en-US')}`}
                </span>
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-brand px-[11px] py-[9px] text-xs font-extrabold uppercase tracking-wide text-white">
                <WalletGlyph />
                Wallet
              </span>
            </button>
          ) : (
            // Prototype `~2220-2227`: outer pill `gap:4px; padding:4px`; each inner pill
            // `padding:9px 17px`, 14px bold text, `letter-spacing:0.6px`, literal "LOGIN"/"SIGNUP"
            // (one word each — not "LOG IN"/"SIGN UP").
            <div className="flex items-center gap-1 rounded-full bg-surface p-1">
              <button
                type="button"
                onClick={onWallet}
                aria-label="Log in"
                data-testid="hub-login-chip"
                className="whitespace-nowrap rounded-full px-[17px] py-[9px] text-[14px] font-bold tracking-[0.6px] text-[var(--rc-text)] focus:outline-none"
              >
                LOGIN
              </button>
              <button
                type="button"
                onClick={onWallet}
                aria-label="Sign up"
                data-testid="hub-signin-chip"
                className="whitespace-nowrap rounded-full bg-brand px-[17px] py-[9px] text-[14px] font-bold tracking-[0.6px] text-white transition-colors hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                SIGNUP
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/** USD currency badge — prototype's `<symbol id="cur-USD">` (line ~104 of the spec HTML): a flat
 *  green circle + white "$". Fixed brand-money colors, not `--rc-*` tokens — same treatment as
 *  `RcIcon`'s own literal fills (`#0B4D24`/`#0F7A37`/…): a currency glyph's identity color, not
 *  chrome, so it doesn't vary with theme (the prototype's own `cur-USD` symbol is unconditional
 *  too — never swapped by `light`). */
function UsdBadge() {
  return (
    <svg width="19" height="19" viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: '0 0 19px' }}>
      <circle cx="16" cy="16" r="16" fill="#16A34A" />
      <text
        x="16" y="16.8" textAnchor="middle" dominantBaseline="central"
        fontFamily="Arial, Helvetica, sans-serif" fontSize="24" fontWeight="bold" fill="#FFFFFF"
      >
        $
      </text>
    </svg>
  );
}

/** Wallet glyph — prototype `~2238`: `width="17" height="17" viewBox="0 0 24 24" stroke-width="2"`,
 *  a simple card-slot wallet (rounded rect + one horizontal divider line), not the flap/envelope
 *  shape this replaces. Always white — it only ever sits on the fixed brand-purple sub-pill. */
function WalletGlyph() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="6" width="20" height="13" rx="3" />
      <path d="M2 10h20" />
    </svg>
  );
}
