import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** menu + games both go to the home/games surface. */
  onGames(): void;
  /** account → profile / wallet. */
  onAccount(): void;
  /** Which item reads as active (default 'games' — the home/games surface). */
  active?: 'menu' | 'games' | 'account';
}

/**
 * Bottom navigation — the frame's transparent bar holding one rounded pill with 5 items
 * (Menu · Games · Account · Rewards · Chat). menu/games/account are wired to live surfaces;
 * rewards/chat are reserved and render visibly inactive (greyed, no action) — never a
 * live-looking button that silently no-ops. Shared across hubs; in-flow (not fixed) so each
 * hub's flex-column layout is unchanged.
 */
export function HubToolbar({ onGames, onAccount, active = 'games' }: Props) {
  return (
    <nav aria-label="Primary" className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 bg-transparent px-3 pb-2 pt-1">
      <div className="flex items-center justify-between rounded-[26px] bg-surface px-1.5 py-2.5">
        <ToolbarItem label="Menu" active={active === 'menu'} onClick={onGames} icon={ICON_MENU} />
        <ToolbarItem label="Games" active={active === 'games'} onClick={onGames} icon={ICON_GAMES} />
        <ToolbarItem label="Account" active={active === 'account'} onClick={onAccount} icon={ICON_ACCOUNT} />
        <ToolbarItem label="Rewards" comingSoon icon={ICON_REWARDS} />
        <ToolbarItem label="Chat" comingSoon icon={ICON_CHAT} />
      </div>
    </nav>
  );
}

function ToolbarItem({
  label, icon, onClick, active = false, comingSoon = false,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
  comingSoon?: boolean;
}) {
  const testid = `hub-nav-${label.toLowerCase()}`;
  const labelText = (
    <span className="text-[10.5px] font-bold tracking-[0.02em]">{label}</span>
  );

  if (comingSoon) {
    // Reserved — visibly inactive (greyed), no action, no explanatory text.
    return (
      <div
        aria-disabled="true"
        data-testid={testid}
        title={`${label} — coming soon`}
        className="flex flex-1 flex-col items-center gap-1.5 py-0.5 text-muted-foreground opacity-40"
      >
        {icon}
        {labelText}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-testid={testid}
      className={cn(
        'flex flex-1 flex-col items-center gap-1.5 py-0.5 transition-colors focus:outline-none',
        active ? 'text-brand drop-shadow-[0_0_5px_#8140e288]' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {labelText}
    </button>
  );
}

/* Frame nav glyphs (inline SVG, 23px) — Menu · Games · Account · Rewards · Chat. */
const SVG = 'h-[23px] w-[23px]';
const ICON_MENU = (
  <svg viewBox="0 0 24 24" fill="currentColor" className={SVG} aria-hidden="true">
    <rect x="3" y="5" width="18" height="2.6" rx="1.3" />
    <rect x="3" y="10.7" width="18" height="2.6" rx="1.3" />
    <rect x="3" y="16.4" width="18" height="2.6" rx="1.3" />
  </svg>
);
const ICON_GAMES = (
  <svg viewBox="0 0 24 24" fill="currentColor" className={SVG} aria-hidden="true">
    <path d="M12 2.6c-1.7 2-7 6.4-7 10.4a3.6 3.6 0 0 0 5.6 3c-.1 1.5-.7 2.6-1.8 3.4h6.4c-1.1-.8-1.7-1.9-1.8-3.4a3.6 3.6 0 0 0 5.6-3c0-4-5.3-8.4-7-10.4Z" />
  </svg>
);
const ICON_ACCOUNT = (
  <svg viewBox="0 0 24 24" fill="currentColor" className={SVG} aria-hidden="true">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
);
const ICON_REWARDS = (
  <svg viewBox="0 0 24 24" fill="currentColor" className={SVG} aria-hidden="true">
    <path d="M3.5 11h8v10H5a1.5 1.5 0 0 1-1.5-1.5V11Zm9 0H21v8.5A1.5 1.5 0 0 1 19.5 21h-7V11ZM21 6.5V9H3V6.5A1.5 1.5 0 0 1 4.5 5h3.1A2.7 2.7 0 0 1 12 3.3 2.7 2.7 0 0 1 16.4 5h3.1A1.5 1.5 0 0 1 21 6.5ZM9.5 5a1.1 1.1 0 1 0 0-2.2A1.1 1.1 0 0 0 9.5 5Zm5 0a1.1 1.1 0 1 0 0-2.2A1.1 1.1 0 0 0 14.5 5Z" />
  </svg>
);
const ICON_CHAT = (
  <svg viewBox="0 0 24 24" fill="currentColor" className={SVG} aria-hidden="true">
    <path d="M4 4h16a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 16H10l-4.2 3.3A.7.7 0 0 1 4.6 18.8V16H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 4Z" />
  </svg>
);
