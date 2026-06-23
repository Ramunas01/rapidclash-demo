import type { ReactNode } from 'react';
import boltMark from '../../assets/brand/bolt-mark.webp';

const FOOTER_LINKS = ['How it works', 'Provably fair', 'Fees & rake', 'Tournaments', 'Help center', 'Responsible gaming', 'Terms'];

/** Inert social links (frame 1:1). No counts; no Affiliate (owner decision). */
const SOCIALS: { label: string; icon: ReactNode }[] = [
  { label: 'Discord', icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.3 5.3A16 16 0 0 0 15.6 4l-.3.5a12 12 0 0 1 3.3 1.5 11 11 0 0 0-9.4 0A12 12 0 0 1 12.6 4.5L12.3 4A16 16 0 0 0 8.7 5.3 16.6 16.6 0 0 0 6 16.6a16 16 0 0 0 4.9 2.5l.6-1a10 10 0 0 1-1.7-.8l.4-.3a11.4 11.4 0 0 0 9.6 0l.4.3a10 10 0 0 1-1.7.8l.6 1a16 16 0 0 0 4.9-2.5 16.6 16.6 0 0 0-2.7-11.3ZM9.8 14.3c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Zm4.4 0c-.9 0-1.7-.9-1.7-2s.8-2 1.7-2 1.7.9 1.7 2-.7 2-1.7 2Z" /></svg>) },
  { label: 'X', icon: (<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.2 2H21l-6.4 7.3L22 22h-6.2l-4.8-6.3L5.5 22H2.7l6.8-7.8L2 2h6.3l4.4 5.8L18.2 2Zm-1 18h1.6L7.4 3.7H5.7L17.2 20Z" /></svg>) },
  { label: 'Telegram', icon: (<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.9 4.3 18.6 20c-.2 1-.9 1.3-1.8.8l-4.8-3.6-2.3 2.2c-.3.3-.5.5-1 .5l.4-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6 13.6 1.3 12c-1-.3-1 1 .2-1.5L20.5 3c.9-.3 1.6.2 1.4 1.3Z" /></svg>) },
];

/**
 * Shared footer (frame 1:1): an INERT social row (no counts/URLs), the seeded-RNG
 * "Provably fair" banner (no on-chain claim), an inert link grid (no Affiliate — owner
 * decision), the 18+ responsibility section, and the copyright. Used by every hub.
 */
export function HubFooter() {
  return (
    <footer data-testid="home-footer" className="mt-4 border-t border-border bg-[#0b0b0b] px-4 pb-6 pt-6">
      {/* Social row — 1:1 with the frame but INERT: no follower/member counts, no fabricated
          numbers; visibly non-interactive (the demo has no public channels to link). */}
      <div data-testid="home-footer-social" className="mb-5 flex gap-2.5">
        {SOCIALS.map((s) => (
          <span
            key={s.label}
            role="link"
            aria-disabled="true"
            data-testid={`home-social-${s.label.toLowerCase()}`}
            className="flex flex-1 cursor-default items-center justify-center gap-2 rounded-[10px] bg-surface px-2 py-2.5 text-xs font-semibold text-foreground"
          >
            <span className="text-muted-foreground">{s.icon}</span>
            {s.label}
          </span>
        ))}
      </div>

      {/* Provably-fair — seeded-RNG determinism, NO on-chain/blockchain claim. */}
      <div className="mb-5 flex gap-3 rounded-[14px] bg-surface p-3.5">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-brand"><path d="M12 3 4 6v6c0 5 3.4 7.5 8 9 4.6-1.5 8-4 8-9V6l-8-3Z" /><path d="m8.5 12 2.3 2.3 4.7-4.6" /></svg>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          <b className="text-foreground">Provably fair, by design.</b> Every match runs on a seeded RNG you can verify — the platform never plays against you, just a flat fee per game.{' '}
          <span className="font-semibold text-brand">See how it works</span>
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-x-3.5 gap-y-2.5">
        {FOOTER_LINKS.map((l) => (
          <span key={l} className="cursor-default text-[12.5px] text-muted-foreground">{l}</span>
        ))}
      </div>

      <div className="mb-3.5 flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-[1.5px] border-muted-foreground text-xs font-extrabold text-muted-foreground">18+</span>
        <p className="text-[10.5px] leading-relaxed text-[#5b5b63]">
          RapidClash is a play-money demo for players aged 18 and over. Credits have no real-world value. Play responsibly, set limits, and take breaks.
        </p>
      </div>

      <div className="flex items-center gap-2 text-[10.5px] text-[#5b5b63]">
        <img src={boltMark} alt="" aria-hidden="true" className="h-4 w-4 object-contain" />
        © 2026 RapidClash · Players vs Players, Never the House.
      </div>
    </footer>
  );
}
