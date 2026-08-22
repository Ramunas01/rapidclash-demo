import { useId } from 'react';
import type { VipTier } from '@rapidclash/shared';

/**
 * The 6-tier VIP ladder in nav (low→high) order, mirroring `VIP_TIERS`/`VIP_ROWS` from the
 * design file (design-ref/games-and-rewards/ — gitignored; transcribed here per
 * WORKING_AGREEMENT.md's gitignored-artifact rule, and independently cross-checked against
 * `packages/core/src/rewards.ts`'s own transcription of the same two rows — the two sources
 * agree exactly). `xpRequired` doubles as this tier's OWN threshold (needed, alongside a
 * snapshot's `nextTier.xpRequired`, to compute the "progress within the current band" percent
 * the design's placeholder numbers imply — see `progressPercent` below).
 *
 * Extracted from `RewardsHub.tsx` (issue #307) so `ProfileHub.tsx` (issue #404 — the Account
 * page's own "YOUR VIP PROGRESS" card, same design token table §1 point 3) can share the exact
 * same ladder/icons/math instead of a second, potentially-drifting copy.
 */
export const TIER_ORDER: { tier: Exclude<VipTier, 'Unranked'>; xpRequired: number }[] = [
  { tier: 'Wood', xpRequired: 500 },
  { tier: 'Bronze', xpRequired: 5_000 },
  { tier: 'Silver', xpRequired: 25_000 },
  { tier: 'Gold', xpRequired: 125_000 },
  { tier: 'Emerald', xpRequired: 475_000 },
  { tier: 'Diamond', xpRequired: 1_500_000 },
];

/** Band-relative progress toward the next tier, e.g. Bronze (5,000) → Silver (25,000) at 17,800
 *  XP is (17,800-5,000)/(25,000-5,000) = 64% — independently verified against the design's own
 *  placeholder numbers (Bobbylee: 17,800 XP, Bronze→Silver, shown at exactly 64%). At the top of
 *  the ladder (no `nextTier`) progress reads 100%. */
export function progressPercent(xpLifetime: number, tier: VipTier, nextTier?: { xpRequired: number }): number {
  if (!nextTier) return 100;
  const currentThreshold = tier === 'Unranked' ? 0 : (TIER_ORDER.find((t) => t.tier === tier)?.xpRequired ?? 0);
  const span = nextTier.xpRequired - currentThreshold;
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((xpLifetime - currentThreshold) / span) * 100)));
}

/** Per-tier badge icon — the same path data the design uses for the VIP progress row's
 *  current/next labels (15px, ProfileHub / RewardsHub), the VIP_ROWS table's 76px-wide header
 *  column icons (19px, RewardsHub), and the Monthly Volume Bonus accordion's inline
 *  Emerald/Diamond glyphs (16px, RewardsHub). `useId` keeps the Wood clip-path unique across
 *  however many times this renders on one page.
 *
 *  `'Unranked'` renders nothing — the design's 6-tier icon set starts at Wood, and there is no
 *  badge below it. This is the established, ratified precedent from RewardsHub.tsx (issue #307)
 *  for the exact same "the design doesn't cover this tier" gap ProfileHub's own VIP card hits —
 *  reused as-is rather than inventing a second answer to the same question. */
export function TierIcon({ tier, size }: { tier: VipTier; size: number }) {
  const clipId = useId();
  switch (tier) {
    case 'Unranked':
      return null;
    case 'Wood':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
          <defs>
            <clipPath id={clipId}>
              <path d="M18.6 11.6 11.6 18.6a4.6 4.6 0 0 1-6.5-6.5l7-7a4.6 4.6 0 0 1 6.5 6.5z" />
            </clipPath>
          </defs>
          <path d="M18.6 11.6 11.6 18.6a4.6 4.6 0 0 1-6.5-6.5l7-7a4.6 4.6 0 0 1 6.5 6.5z" fill="#8B5A2B" />
          <g clipPath={`url(#${clipId})`} stroke="#6F4520" strokeLinecap="round" fill="none">
            <path d="M7.4 16.6 16.6 7.4" strokeWidth="0.8" opacity="0.32" />
            <path d="M10 19 18 11" strokeWidth="0.7" opacity="0.22" />
            <path d="M5 14.8 12.4 7.4" strokeWidth="0.7" opacity="0.22" />
            <path d="M12.6 18.4 17.4 13.6" strokeWidth="0.6" opacity="0.16" />
            <path d="M8.8 14.4 12.6 10.6" strokeWidth="0.6" opacity="0.26" />
            <path d="M13.4 12.6 16.2 9.8" strokeWidth="0.5" opacity="0.2" />
            <path d="M6.2 13.4 9.4 10.2" strokeWidth="0.5" opacity="0.18" />
            <path d="M11.2 16.8 14 14" strokeWidth="0.5" opacity="0.2" />
            <path d="M14.6 10 17.2 7.4" strokeWidth="0.5" opacity="0.15" />
            <path d="M9.6 17.6 11.6 15.6" strokeWidth="0.45" opacity="0.14" />
          </g>
          <ellipse cx="8.4" cy="15.4" rx="4.6" ry="4.6" fill="#C08B4F" />
          <ellipse cx="8.4" cy="15.4" rx="2.9" ry="2.9" fill="none" stroke="#8B5A2B" strokeWidth="1" />
          <circle cx="8.4" cy="15.4" r="1.1" fill="#8B5A2B" />
        </svg>
      );
    case 'Bronze':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path d="M12 3.4 21.6 20.2a.8.8 0 0 1-.7 1.2H3.1a.8.8 0 0 1-.7-1.2z" fill="#C46B34" />
          <path d="M12 3.4 12 21.4H3.1a.8.8 0 0 1-.7-1.2z" fill="#E08A5A" />
          <path d="M12 3.4 7.6 21.4H5.2z" fill="#F2B08A" opacity="0.75" />
          <path d="M8.4 14.6h7.2l1.2 2.1H7.2z" fill="#8E4A22" opacity="0.35" />
        </svg>
      );
    case 'Silver':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path d="M12 2.4 22 9.7l-3.8 11.6H5.8L2 9.7z" fill="#9BA2AE" />
          <path d="M12 2.4 2 9.7l3.8 11.6H12z" fill="#C9CDD6" />
          <path d="M12 5.6 19 10.7l-2.7 8.1H7.7L5 10.7z" fill="none" stroke="#EDEFF4" strokeWidth="1" opacity="0.7" />
          <path d="M9.6 5.2 4.6 8.8" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
        </svg>
      );
    case 'Gold':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path d="M12 2.2 21 7.1v9.8L12 21.8 3 16.9V7.1z" fill="#D9A21F" />
          <path d="M12 2.2 3 7.1v9.8L12 21.8z" fill="#F2C744" />
          <path d="M12 5.4 18.4 8.9v6.2L12 18.6 5.6 15.1V8.9z" fill="none" stroke="#FFE07A" strokeWidth="1" opacity="0.7" />
          <path d="M9.6 5 5 7.6" stroke="#FFF0B8" strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
        </svg>
      );
    case 'Emerald':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path d="M7.6 3.4h8.8L20.6 7.6v8.8L16.4 20.6H7.6L3.4 16.4V7.6z" fill="#0F9D58" />
          <path d="M7.6 3.4 3.4 7.6v8.8l4.2 4.2z" fill="#34D399" />
          <path d="M9.4 7.4h5.2l2 2v5.2l-2 2H9.4l-2-2V9.4z" fill="none" stroke="#8FF0C2" strokeWidth="1" opacity="0.75" />
          <path d="M5.4 5.6 7.2 4.4" stroke="#DFFFEF" strokeWidth="1.2" strokeLinecap="round" opacity="0.95" />
        </svg>
      );
    case 'Diamond':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path d="M6.6 3.2h10.8L22 9.4 12 21.6 2 9.4z" fill="#2FB6DE" />
          <path d="M6.6 3.2 2 9.4l10 12.2z" fill="#5CD3F0" />
          <path d="M2 9.4h20" stroke="#0E88AD" strokeWidth="0.9" opacity="0.6" />
          <path d="M8.9 9.4 12 21.6 15.1 9.4z" fill="#BFF0FA" opacity="0.55" />
          <path d="M6.6 3.2 8.9 9.4M17.4 3.2 15.1 9.4" stroke="#0E88AD" strokeWidth="0.8" opacity="0.5" />
          <path d="M4.4 5.6 6.9 4.2" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" opacity="0.95" />
        </svg>
      );
  }
}
