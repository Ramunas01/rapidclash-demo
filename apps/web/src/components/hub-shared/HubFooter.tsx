import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { HUB_BODY } from '../hub-chrome/layout.js';
import wordmark from '../../assets/brand/rapidclash-wordmark.webp';
import boltMark from '../../assets/brand/bolt-mark.webp';

interface Props {
  /** Games link (PLATFORM col) → the home/games surface. Matches `HubToolbar`'s naming for the
   *  same concept — every call site already has this callback in scope for its own toolbar. */
  onGames?(): void;
  /** Rewards/VIP link (PLATFORM col) → the VIP/Rewards surface. */
  onRewards?(): void;
}

/** The 4 social buttons — inline SVG glyphs (issue #323 adds Instagram; the old footer never
 *  had one). The design file's own path data lives in a gitignored, JS-obfuscated export we
 *  can't mechanically decode (design-ref/games-and-rewards/ — WORKING_AGREEMENT.md's
 *  gitignored-artifact rule covers transcribing facts by hand, not this); X, Telegram, and
 *  Instagram remain clean, recognizable glyph approximations, same spirit as the old footer's
 *  own hand-authored icons (see its "Deliberate logo/label mismatch" precedent). Discord's path
 *  was later decoded verbatim from the design source (issue #333) and is exact, not an
 *  approximation. All four are inert: no href, no onClick. */
const SOCIALS: { label: string; icon: ReactNode }[] = [
  {
    label: 'Discord',
    icon: (
      <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20 5.3A17 17 0 0 0 15.9 4l-.4.8a12.6 12.6 0 0 0-7 0L8.1 4A17 17 0 0 0 4 5.3C1.4 9.2.7 13 1 16.8A16.9 16.9 0 0 0 6.2 19l.9-1.5c-.6-.2-1.2-.5-1.7-.9l.4-.3a12.1 12.1 0 0 0 10.4 0l.4.3c-.5.4-1.1.7-1.7.9l.9 1.5a16.8 16.8 0 0 0 5.2-2.2c.4-4.4-.7-8.2-3-11.5ZM8.4 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.2 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
      </svg>
    ),
  },
  {
    label: 'X',
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.2 2H21l-6.4 7.3L22 22h-6.2l-4.8-6.3L5.5 22H2.7l6.8-7.8L2 2h6.3l4.4 5.8L18.2 2Zm-1 18h1.6L7.4 3.7H5.7L17.2 20Z" />
      </svg>
    ),
  },
  {
    label: 'Telegram',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M21.9 4.3 18.6 20c-.2 1-.9 1.3-1.8.8l-4.8-3.6-2.3 2.2c-.3.3-.5.5-1 .5l.4-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6 13.6 1.3 12c-1-.3-1 1 .2-1.5L20.5 3c.9-.3 1.6.2 1.4 1.3Z" />
      </svg>
    ),
  },
  {
    label: 'Instagram',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4.2" />
        <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

/** PLATFORM/FAIRNESS/SUPPORT/LEGAL — exact link text from the spec. `real` marks the two spans
 *  (Games, Rewards/VIP) that carry a click handler in the design source; every other span gets
 *  no `onClick` at all (not `disabled`, not a no-op) — a link with nowhere to go yet. */
const LINK_COLUMNS: { heading: string; links: { label: string; real?: 'games' | 'rewards' }[] }[] = [
  {
    heading: 'PLATFORM',
    links: [
      { label: 'Games', real: 'games' },
      { label: 'Tournaments' },
      { label: 'Rewards/VIP', real: 'rewards' },
      { label: 'Leaderboards' },
    ],
  },
  {
    heading: 'FAIRNESS',
    links: [
      { label: 'How it works' },
      { label: 'Provably fair' },
      { label: 'Fees & rake' },
      { label: 'Game rules' },
    ],
  },
  {
    heading: 'SUPPORT',
    links: [
      { label: 'Help center' },
      { label: 'Contact us' },
      { label: 'Responsible gaming' },
      { label: 'Complaint form' },
    ],
  },
  {
    heading: 'LEGAL',
    links: [
      { label: 'Terms of Service' },
      { label: 'Privacy Policy' },
      { label: 'AML Policy' },
      { label: 'Responsible Gaming Policy' },
    ],
  },
];

/**
 * Shared footer (issue #323) — wordmark, "JOIN THE COMMUNITY" social row, a 4-column link grid,
 * a disclaimer, the copyright block, and the 18+ row. Rendered on all 4 hubs (Home/Games,
 * Account/Profile, Rewards/VIP). Markup transcribed verbatim from the design file (decoded
 * template lines 1056-1119, gitignored — facts transcribed by hand per WORKING_AGREEMENT.md;
 * see `docs/COMMS/from-advisor/footer-and-rc-icon.md` §1).
 *
 * Only `Games` and `Rewards/VIP` are real — every other link/icon here is visually identical but
 * has no `onClick` attached at all, matching the design source exactly.
 */
export function HubFooter({ onGames, onRewards }: Props) {
  return (
    <footer data-testid="home-footer" className={cn('bg-surface px-4 pt-6', HUB_BODY)}>
      <div
        data-testid="home-footer-gradient"
        aria-hidden="true"
        className="mt-6 h-16"
        style={{
          background:
            'linear-gradient(to bottom, rgba(26,26,46,0) 0%, rgba(26,26,46,0.45) 55%, rgba(26,26,46,0.85) 82%, rgba(26,26,46,1) 100%)',
        }}
      />
      <img src={wordmark} alt="RapidClash" className="mb-[22px] h-auto w-[140px]" />

      <div className="flex flex-col gap-[22px]">
        <div>
          <h2 className="mb-[18px] text-[20px] font-bold text-white">JOIN THE COMMUNITY</h2>
          <div data-testid="home-footer-social" className="flex gap-[14px]">
            {SOCIALS.map((s) => (
              <span
                key={s.label}
                data-testid={`home-social-${s.label.toLowerCase()}`}
                className="flex h-[46px] w-[46px] cursor-pointer items-center justify-center rounded-full text-white"
                style={{
                  background: '#8B45F0',
                  boxShadow: '0 0 14px 2px rgba(139,69,240,0.28), 0 0 4px rgba(139,69,240,0.22)',
                }}
              >
                {s.icon}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-[26px] gap-y-[12px]">
          {LINK_COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="mb-3 text-[15px] font-bold tracking-[1.4px] text-brand">{col.heading}</h3>
              <div className="flex flex-col gap-2.5">
                {col.links.map((l) => (
                  <span
                    key={l.label}
                    data-testid={`home-footer-link-${l.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    className="cursor-pointer text-[14px] text-foreground"
                    onClick={l.real === 'games' ? onGames : l.real === 'rewards' ? onRewards : undefined}
                  >
                    {l.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[12.5px] leading-relaxed" style={{ color: '#83838F' }}>
          RapidClash is a play-money demo platform for players aged 18 and over. Credits have no
          real-world value and cannot be redeemed for cash or prizes. Play responsibly, set
          limits, and take breaks.
        </p>

        <p className="text-[12.5px] leading-relaxed" style={{ color: '#83838F' }}>
          © 2026 RapidClash. All rights reserved.
          <br />
          Players vs Players, Never the House.
        </p>

        <div className="flex items-center gap-2">
          <img src={boltMark} alt="" aria-hidden="true" className="h-[28px] w-[28px] object-contain" />
          <span className="text-[26px] font-bold" style={{ color: '#83838F' }}>18+</span>
        </div>
      </div>
    </footer>
  );
}
