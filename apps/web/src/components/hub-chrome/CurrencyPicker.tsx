import { useId, useState } from 'react';
import type { Currency } from '@rapidclash/shared';
import { useTheme } from '../../lib/theme.js';
import { useCurSel } from '../../lib/currency.js';
import { fiatDisplay, nativeDisplay, CUR_NAME, OPEN_CURS } from './currencyData.js';

interface Props {
  /** Every currency's own live balance in integer credits, or null while it's still loading.
   *  Ticket 2026-09-27#7 (D69), PR 4: every row now reads its own real entry here — the panel is
   *  no longer mock data (CHARTER #4's prior "cosmetic-only currency skin" reversed, Owner-
   *  confirmed 2026-09-28). Read-only: this component only ever formats it for display; nothing
   *  here writes to it or otherwise touches the real credits ledger. */
  balances: Record<Currency, number> | null;
}

/**
 * Currency picker (issue #530, `docs/COMMS/ADVISOR_TO_PM.md` 2026-09-11#5, made real by ticket
 * 2026-09-27#7 D69 PR 4) — the trigger (currency icon + balance, prototype `Full Spec.html:2233-
 * 2236`) plus its dropdown panel (`:2242-2321`). Self-contained: owns `open`/`query`/`curSel`/
 * `fiatOn`/`hideZero` locally, no shared hook (only one screen-position ever renders this).
 * Rendered from inside `HubRibbon.tsx`, as the left half of the wallet pill — the right half
 * (purple WALLET sub-pill) is a sibling `HubRibbon` renders itself and is untouched by anything
 * here.
 *
 * **Default currency is SOL** (`lib/currency.ts`'s `DEFAULT_CURRENCY`), matching the prototype's
 * own literal default (`:3579`). An earlier PM decision (`2026-09-11#5`) had overridden this to
 * `'USD'` — reasoning that held only while every non-USD balance was mock data, since showing a
 * mock SOL figure by default would have been misleading. Ticket `2026-09-27#7` (D69) explicitly
 * reverses that decision, Owner-confirmed (`2026-09-28#1`): now that every currency shows its own
 * real balance (below), there's no longer a real-vs-mock reason to prefer USD, so the app reverts
 * to the prototype's own SOL default.
 *
 * **Every currency is now real** (D69 PR 4, reversing the PR-3-era "USD only" carve-out): the
 * trigger and every panel row read straight from the `balances` prop via `fiatDisplay`/
 * `nativeDisplay` (`currencyData.ts`) — no more hardcoded `CUR_BAL`/`CUR_CRYPTO` mock strings, no
 * more USD-vs-everything-else special case. USD's own row still always shows the fiat format
 * regardless of the toggle (a dollar has no separate native unit) — that ONE asymmetry survives
 * from the old design, now applied to real data instead of a mock string.
 */
export function CurrencyPicker({ balances }: Props) {
  const { resolved } = useTheme();
  const light = resolved === 'light';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Promoted to app-wide shared state (ticket 2026-09-13#6 item 2) — `lib/currency.ts`, the same
  // module-level-singleton shape as `lib/theme.ts` — so `GamesCarousel.tsx`'s logged-in stake
  // rows reflect this exact selection too, kept in sync without either component knowing about
  // the other.
  const { curSel, setCurSel } = useCurSel();
  const [fiatOn, setFiatOn] = useState(true);
  const [hideZero, setHideZero] = useState(false);

  const q = query.trim().toLowerCase();

  function balanceOf(sym: string): number {
    return balances === null ? 0 : balances[sym as Currency];
  }

  // Row-visibility logic, exact (prototype `:3586-3592`): a row shows if it matches the search
  // query (by symbol OR full name, case-insensitive substring) AND (it's the currently-selected
  // currency OR hide-zero is off OR its balance isn't exactly zero). The selected currency is
  // NEVER hidden by hide-zero, even if it's also zero. While balances is still loading (null),
  // nothing reads as zero — never hide a row for lack of data.
  function visible(sym: string): boolean {
    const zero = balances !== null && balanceOf(sym) === 0;
    const hit = !q || sym.toLowerCase().includes(q) || CUR_NAME[sym].toLowerCase().includes(q);
    return hit && (sym === curSel || !hideZero || !zero);
  }

  // USD's row always shows the fiat format regardless of the fiat/crypto toggle (prototype
  // `:3596`, "a dollar has no separate crypto unit") — every other currency respects the toggle.
  function rowValue(sym: string): string {
    const amount = balanceOf(sym);
    return sym === 'USD' || fiatOn ? fiatDisplay(amount) : nativeDisplay(sym as Currency, amount);
  }
  function rowMuted(sym: string): boolean {
    return balances !== null && balanceOf(sym) === 0;
  }

  const usdVisible = visible('USD');
  const cryptoVisible = OPEN_CURS.filter(visible);

  function pick(sym: string) {
    setCurSel(sym);
    setOpen(false);
  }

  // Trigger value: every currency now reads its own real balance the same way (rowValue already
  // special-cases USD to always-fiat, so no separate branch is needed here anymore).
  const triggerValue = balances === null ? '—' : rowValue(curSel);

  const searchBg = light ? '#E7E7EE' : '#12121F';
  const panelShadow = light ? '0 18px 40px rgba(20,20,40,0.18)' : '0 22px 44px rgba(0,0,0,0.45)';
  const divider = light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';
  const activeRowBg = light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose currency"
        aria-expanded={open}
        data-testid="hub-currency-chip"
        className="flex items-center gap-[7px] pr-3"
      >
        <CurrencyIcon sym={curSel} size={19} />
        <span
          className="whitespace-nowrap tabular-nums text-[var(--rc-text)]"
          style={{
            fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif",
            fontSize: '16px',
            fontWeight: 700,
            letterSpacing: '-0.2px',
          }}
          data-testid="hub-balance"
        >
          {triggerValue}
        </span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            data-testid="currency-picker-backdrop"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-[18px] bg-surface"
            style={{ boxShadow: panelShadow }}
            data-testid="currency-picker-panel"
          >
            <div className="p-3">
              <div
                className="flex items-center gap-2 rounded-[11px] px-[11px] py-[9px]"
                style={{ backgroundColor: searchBg }}
              >
                <SearchGlyph />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
                  data-testid="currency-picker-search"
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-[var(--rc-text)] outline-none"
                  style={{ fontFamily: "'Inter Tight', Arial, Helvetica, sans-serif" }}
                />
              </div>
            </div>

            {usdVisible && (
              <>
                <SectionHeader>Cash</SectionHeader>
                <CurrencyRow
                  sym="USD"
                  active={curSel === 'USD'}
                  value={rowValue('USD')}
                  muted={rowMuted('USD')}
                  onClick={() => pick('USD')}
                  activeBg={activeRowBg}
                  showDivider={false}
                  dividerColor={divider}
                />
              </>
            )}

            {cryptoVisible.length > 0 && <SectionHeader>Cryptocurrency</SectionHeader>}
            {cryptoVisible.map((sym, i) => (
              <CurrencyRow
                key={sym}
                sym={sym}
                active={curSel === sym}
                value={rowValue(sym)}
                muted={rowMuted(sym)}
                onClick={() => pick(sym)}
                activeBg={activeRowBg}
                showDivider={i > 0}
                dividerColor={divider}
              />
            ))}

            <div
              className="flex items-center justify-between gap-2.5 px-[13px] py-3"
              style={{ borderTop: `1px solid ${divider}` }}
            >
              <span className="text-[13px] text-[var(--rc-text)]" style={{ fontFamily: "'Inter Tight', Arial, Helvetica, sans-serif" }}>
                Display in Fiat
              </span>
              <ToggleSwitch on={fiatOn} onToggle={() => setFiatOn((v) => !v)} light={light} testId="currency-picker-fiat-toggle" />
            </div>
            <div className="flex items-center justify-between gap-2.5 px-[13px] pb-[14px]">
              <span className="text-[13px] text-[var(--rc-text)]" style={{ fontFamily: "'Inter Tight', Arial, Helvetica, sans-serif" }}>
                Hide zero balances
              </span>
              <ToggleSwitch on={hideZero} onToggle={() => setHideZero((v) => !v)} light={light} testId="currency-picker-zero-toggle" />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <div
      className="px-[13px] pb-1.5 pt-2.5 text-[11px] font-bold tracking-[0.5px] text-[var(--rc-text)]"
      style={{ fontFamily: "'Inter Tight', Arial, Helvetica, sans-serif" }}
    >
      {children}
    </div>
  );
}

function CurrencyRow({
  sym,
  active,
  value,
  muted,
  onClick,
  activeBg,
  showDivider,
  dividerColor,
}: {
  sym: string;
  active: boolean;
  value: string;
  muted: boolean;
  onClick(): void;
  activeBg: string;
  showDivider: boolean;
  dividerColor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`currency-picker-row-${sym}`}
      className="flex w-full items-center gap-[9px] px-[13px] py-[9px] text-left"
      style={{
        backgroundColor: active ? activeBg : 'transparent',
        borderTop: showDivider ? `1px solid ${dividerColor}` : undefined,
      }}
    >
      <CurrencyIcon sym={sym} size={20} />
      <span
        className="flex-1 text-[13px] text-[var(--rc-text)]"
        style={{ fontFamily: "'Inter Tight', Arial, Helvetica, sans-serif", fontWeight: active ? 700 : 500 }}
      >
        {sym}
      </span>
      <span
        className="text-[13px]"
        style={{
          fontFamily: "'Space Grotesk', Arial, Helvetica, sans-serif",
          fontWeight: active ? 700 : 500,
          color: muted ? 'var(--rc-muted)' : 'var(--rc-text)',
        }}
      >
        {value}
      </span>
    </button>
  );
}

/** Hand-rolled 40×22px pill switch (prototype `:2311-2313`/`:2317-2319`) — one shared component
 *  for both footer toggles, pixel-identical apart from state. On = brand purple track, off =
 *  light `#C9C9D6` / dark `#12121F`; a white 16px knob translating `0 → 18px`. */
function ToggleSwitch({
  on,
  onToggle,
  light,
  testId,
}: {
  on: boolean;
  onToggle(): void;
  light: boolean;
  testId: string;
}) {
  const trackBg = on ? 'var(--brand-purple)' : light ? '#C9C9D6' : '#12121F';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      data-testid={testId}
      className="box-border h-[22px] w-10 shrink-0 rounded-full p-[3px]"
      style={{ backgroundColor: trackBg, transition: 'background-color 220ms ease' }}
    >
      <div
        className="h-4 w-4 rounded-full bg-white"
        style={{ transform: on ? 'translateX(18px)' : 'translateX(0)', transition: 'transform 240ms cubic-bezier(0.3,0.9,0.32,1)' }}
      />
    </button>
  );
}

function SearchGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--rc-muted)" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}

/* ── Currency icons — ported from the prototype's `<symbol id="cur-*">` defs (`Full Spec.html`,
 * line ~104), one hand-written inline SVG per coin, same convention as `HubRibbon.tsx`'s own
 * `UsdBadge()`. Shared by both the trigger and the panel's rows (the prototype itself references
 * the very same `<symbol>` set from both places via `<use href="#cur-...">`). ── */

/** Exported for `GameHub.tsx`'s PlayPanel bet-panel currency row (ticket 2026-09-11#8, item A1) —
 *  the prototype's `{{ curSym }}` row (`Full Spec.html:705,709`) references the exact same
 *  `#cur-{{ curSym }}` sprite this component already ports 1:1 below; reusing it here rather than
 *  duplicating a second copy of `IconUSD`. */
export function CurrencyIcon({ sym, size = 20 }: { sym: string; size?: number }) {
  switch (sym) {
    case 'USD':
      return <IconUSD size={size} />;
    case 'BTC':
      return <IconBTC size={size} />;
    case 'ETH':
      return <IconETH size={size} />;
    case 'USDT':
      return <IconUSDT size={size} />;
    case 'USDC':
      return <IconUSDC size={size} />;
    case 'SOL':
      return <IconSOL size={size} />;
    case 'LTC':
      return <IconLTC size={size} />;
    case 'XRP':
      return <IconXRP size={size} />;
    default:
      return null;
  }
}

function IconUSD({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: `0 0 ${size}px` }}>
      <circle cx="16" cy="16" r="16" fill="#16A34A" />
      <text x="16" y="16.8" textAnchor="middle" dominantBaseline="central" fontFamily="Arial, Helvetica, sans-serif" fontSize="24" fontWeight="bold" fill="#FFFFFF">
        $
      </text>
    </svg>
  );
}

function IconBTC({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: `0 0 ${size}px` }}>
      <circle cx="16" cy="16" r="16" fill="#F7931A" />
      <g transform="rotate(14 16 16)">
        <path
          d="M11.4 8.2h5.1c2.9 0 4.6 1.2 4.6 3.4 0 1.5-.8 2.5-2.2 2.9 1.8.3 2.9 1.5 2.9 3.3 0 2.5-1.9 3.9-5.1 3.9h-5.3zm4.7 5.6c1.4 0 2.2-.6 2.2-1.7s-.8-1.6-2.2-1.6h-2.1v3.3zm.3 5.7c1.5 0 2.4-.6 2.4-1.8s-.9-1.8-2.4-1.8h-2.4v3.6z"
          fill="#FFFFFF"
        />
        <rect x="14" y="6.2" width="1.7" height="3.6" fill="#FFFFFF" />
        <rect x="17.2" y="6.2" width="1.7" height="3.6" fill="#FFFFFF" />
        <rect x="14" y="22.2" width="1.7" height="3.6" fill="#FFFFFF" />
        <rect x="17.2" y="22.2" width="1.7" height="3.6" fill="#FFFFFF" />
      </g>
    </svg>
  );
}

function IconETH({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: `0 0 ${size}px` }}>
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <path d="M16 4.5v8.9l7.5 3.4z" fill="#FFFFFF" fillOpacity={0.62} />
      <path d="M16 4.5 8.5 16.8 16 13.4z" fill="#FFFFFF" />
      <path d="M16 22.6v5.3l7.5-10.4z" fill="#FFFFFF" fillOpacity={0.62} />
      <path d="M16 27.9v-5.3L8.5 17.5z" fill="#FFFFFF" />
      <path d="m16 21.2 7.5-4.4L16 13.4z" fill="#FFFFFF" fillOpacity={0.2} />
      <path d="M8.5 16.8l7.5 4.4v-7.8z" fill="#FFFFFF" fillOpacity={0.62} />
    </svg>
  );
}

function IconUSDT({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: `0 0 ${size}px` }}>
      <circle cx="16" cy="16" r="16" fill="#26A17B" />
      <path d="M8 7.25h16v4.5h-5.87v14.7h-4.26V11.75H8z" fill="#FFFFFF" />
      <ellipse cx="16" cy="15.6" rx="8.3" ry="2.35" fill="none" stroke="#FFFFFF" strokeWidth={0.85} />
    </svg>
  );
}

function IconUSDC({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: `0 0 ${size}px` }}>
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <path d="M11.3 9.3a8.2 8.2 0 0 0 0 13.4" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
      <path d="M20.7 9.3a8.2 8.2 0 0 1 0 13.4" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
      <rect x="15.2" y="9.1" width="1.6" height="2.6" rx="0.8" fill="#FFFFFF" />
      <rect x="15.2" y="20.3" width="1.6" height="2.6" rx="0.8" fill="#FFFFFF" />
      <text x="16" y="16.5" textAnchor="middle" dominantBaseline="central" fontFamily="Arial, Helvetica, sans-serif" fontSize="12.5" fontWeight="bold" fill="#FFFFFF">
        S
      </text>
    </svg>
  );
}

function IconSOL({ size }: { size: number }) {
  const gradId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: `0 0 ${size}px` }}>
      <defs>
        <linearGradient id={gradId} x1="5" y1="27" x2="27" y2="5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#9945FF" />
          <stop offset="1" stopColor="#14F195" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${gradId})`} />
      <path d="M7.8 8.7H28.2l-4 3.6H4.5z" fill="#0B0B18" />
      <path d="M4.5 14.2h19.7l4 3.6H7.8z" fill="#0B0B18" />
      <path d="M7.8 19.7H28.2l-4 3.6H4.5z" fill="#0B0B18" />
    </svg>
  );
}

function IconLTC({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: `0 0 ${size}px` }}>
      <circle cx="16" cy="16" r="16" fill="#A6A9AA" />
      <path
        d="M13.6 7.4h4.2l-2.1 8.4 2.6-.8-.6 2.3-2.6.8-.9 3.5h8l-.7 2.8H10.4l1.6-6.2-2.4.8.6-2.4 2.4-.8z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

function IconXRP({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ display: 'block', flex: `0 0 ${size}px` }}>
      <circle cx="16" cy="16" r="16" fill="#23292F" />
      <path d="M9 9.6c2.1 2.6 4.4 5.2 7 5.2s4.9-2.6 7-5.2" fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M9 22.4c2.1-2.6 4.4-5.2 7-5.2s4.9 2.6 7 5.2" fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}
