import navMenu from '../../assets/icons/nav/nav-menu.png';
import navGames from '../../assets/icons/nav/nav-games.png';
import navAccount from '../../assets/icons/nav/nav-account.png';
import navRewards from '../../assets/icons/nav/nav-rewards.png';
import navChat from '../../assets/icons/nav/nav-chat.png';
import { cn } from '@/lib/utils';

interface Props {
  /** menu + games both go to the game list. */
  onGames(): void;
  /** account → wallet screen. */
  onAccount(): void;
}

/**
 * Sticky bottom toolbar. menu/games/account point at screens that exist (wired live);
 * rewards/chat are reserved and render as visibly-inactive "coming soon" — dimmed + a tag,
 * never a live-looking button that silently no-ops (spec Q1). Hub-local, promotion-ready.
 */
export function HubToolbar({ onGames, onAccount }: Props) {
  return (
    <nav
      aria-label="Primary"
      className="z-20 flex shrink-0 items-stretch justify-around border-t border-white/5 bg-[#0b0e18]/95 px-2 py-1.5 backdrop-blur"
    >
      <ToolbarButton icon={navMenu} label="Menu" onClick={onGames} />
      <ToolbarButton icon={navGames} label="Games" onClick={onGames} />
      <ToolbarButton icon={navAccount} label="Account" onClick={onAccount} />
      <ToolbarButton icon={navRewards} label="Rewards" comingSoon />
      <ToolbarButton icon={navChat} label="Chat" comingSoon />
    </nav>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
  comingSoon = false,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  comingSoon?: boolean;
}) {
  if (comingSoon) {
    return (
      <div
        aria-disabled="true"
        data-testid={`hub-nav-${label.toLowerCase()}`}
        title={`${label} — coming soon`}
        className="relative flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1 opacity-40"
      >
        <img src={icon} alt="" aria-hidden="true" className="h-7 w-auto" />
        <span className="text-[8px] font-semibold uppercase tracking-wide text-white/60">Soon</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={`hub-nav-${label.toLowerCase()}`}
      className={cn(
        'flex flex-1 flex-col items-center justify-center rounded-lg py-1 transition-colors',
        'hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand',
      )}
    >
      <img src={icon} alt="" aria-hidden="true" className="h-7 w-auto" />
    </button>
  );
}
