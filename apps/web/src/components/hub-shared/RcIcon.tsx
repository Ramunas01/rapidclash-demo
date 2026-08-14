/**
 * The small green "RC" coin glyph used everywhere a credit amount is shown (issue #324). Extracted
 * from two byte-identical copies that predated this ticket — `GamesCarousel.tsx`'s `RcIcon` and
 * `RewardsHub.tsx`'s `RcCoinIcon` (verified: same `viewBox="0 0 38 44"`, same ellipses/fill colors
 * `#0B4D24`/`#0F7A37`/`#0A5A28`, same "RC" text) — into one shared component so a third/fourth copy
 * never gets a chance to drift from the other two. Decorative only (`aria-hidden`); play-money
 * framing, never `$`/crypto.
 */
export function RcIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={Math.round((size * 44) / 38)}
      viewBox="0 0 38 44"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flex: `0 0 ${size}px` }}
    >
      <g>
        <ellipse cx="22" cy="22" rx="13" ry="20" fill="#0B4D24" />
        <ellipse cx="15" cy="22" rx="13" ry="20" fill="#0F7A37" />
        <ellipse cx="15" cy="22" rx="13" ry="20" fill="none" stroke="#0A5A28" strokeWidth="1.2" />
        <text
          x="15" y="22" textAnchor="middle" dominantBaseline="central"
          fontFamily="'Space Grotesk', Arial, Helvetica, sans-serif" fontSize="16" fontWeight="700"
          fill="#22C55E" transform="scale(0.82 1)" style={{ transformOrigin: '15px 22px' }}
        >
          RC
        </text>
      </g>
    </svg>
  );
}

/**
 * Sitewide credits display (issue #324) — `<RcIcon /> 1,642`, no inline text currency symbol.
 * `formatCredits` in `format.ts` returns a *string* with that symbol appended, and an icon can't
 * live inside a string: every visible call site that used to interpolate `formatCredits(n)`
 * directly into JSX renders this instead, one React element instead of one string.
 *
 * `showSign` covers the handful of places that used to hand-build a leading `+`/`-`
 * (`{positive ? '+' : ''}{formatCredits(entry.amount)}`) — `toLocaleString` already right-aligns
 * the `-` for negatives, so this only ever needs to add the `+`.
 *
 * `size` forwards to `RcIcon`; the default (15) matches the original header-chip glyph. Bigger
 * headline balances (e.g. `Wallet.tsx`'s big "Balance" figure) pass a larger size so the coin
 * roughly tracks the numeral's cap-height — a presentation judgment call, not a measured design
 * spec (the source design only pixel-specs the small chip/pill glyph).
 */
export function Credits({ amount, showSign = false, size }: { amount: number; showSign?: boolean; size?: number }) {
  const sign = showSign && amount > 0 ? '+' : '';
  return (
    <span className="inline-flex items-center gap-1">
      <RcIcon size={size} />
      {sign}{amount.toLocaleString('en-US')}
    </span>
  );
}
