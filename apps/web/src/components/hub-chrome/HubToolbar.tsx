import { useRef, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';
import type { MenuAnchorRect } from './useMenuOverlay.js';

interface Props {
  /** games → the home/games surface. */
  onGames(): void;
  /** account → profile / wallet. */
  onAccount(): void;
  /** rewards → the VIP/Rewards surface (issue #307). */
  onRewards(): void;
  /** menu → toggles the full-screen Menu overlay (issue #414). Called with the Menu button's
   *  own live `getBoundingClientRect()` (as plain numbers) so the caller's overlay can grow its
   *  clip-path reveal from the real button position — HubToolbar owns the button/ref, the caller
   *  owns the overlay, so the rect has to cross that boundary somehow. */
  onMenu(anchorRect: MenuAnchorRect): void;
  /** Which item reads as active (default 'games' — the home/games surface). 'menu' is set by the
   *  caller while its Menu overlay is open — mutually exclusive with the other three, same as
   *  they already are with each other. */
  active?: 'games' | 'account' | 'rewards' | 'menu';
}

/**
 * Bottom navigation — the frame's transparent bar holding one rounded pill with 5 items
 * (Menu · Games · Account · Rewards · Chat). games/account/rewards/menu are all wired to live
 * surfaces (issue #414 flips Menu from reserved to live, opening the full-screen Menu overlay —
 * see `useMenuOverlay.ts`/`MenuOverlay.tsx`); chat remains reserved and renders visibly inactive
 * (greyed, no action) — never a live-looking button that silently no-ops. Shared across hubs;
 * `position: fixed` at the bottom (#142 keeps the footer fixed while the page body scrolls). The
 * bottom pad clears the home-indicator safe-area under viewport-fit=cover.
 */
export function HubToolbar({ onGames, onAccount, onRewards, onMenu, active = 'games' }: Props) {
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  function handleMenuClick() {
    const el = menuBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onMenu({ left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return (
    <>
      {/* Scroll fade (#407): a 62px gradient dissolve sitting just above the solid mask below, so
          content scrolling under the bar fades into the background instead of cutting off hard.
          `--rc-bg` from the design handoff is this app's own `bg-background` token (#0B0B0B in both
          — confirmed via apps/web/src/index.css), so we build the gradient from it rather than a
          parallel custom property. Purely visual (`pointer-events-none`) and BELOW the nav
          (z-[15] < the nav's z-20) so the pill still floats over it and its buttons still tap
          through. Full width, not max-w-md, so nothing peeks past its sides on wider screens. */}
      <div
        aria-hidden="true"
        data-testid="hub-nav-fade"
        className="pointer-events-none fixed bottom-[calc(2.75rem_+_env(safe-area-inset-bottom))] left-0 right-0 z-[15] h-[62px] bg-[linear-gradient(to_top,hsl(var(--background))_0%,transparent_100%)]"
      />
      {/* Solid base behind & below the nav: a FULL-viewport-width #0B0B0B block (the canonical
          `bg-background` token — never a fresh literal, or we recreate the drift the unification
          removed) so scrolled content can't peek through the pill's rounded-corner notches or the
          strip below it, and Safari's bottom bar samples a constant colour instead of moving content.
          Purely visual (`pointer-events-none`) and BELOW the nav (z-[15] < the nav's z-20) so the pill
          still floats over it and its buttons still tap through. It rises to ~half the pill's height
          (so the pill's lower rounded corners have solid behind them — tuned blind, adjust vs the
          running UI) and reaches bottom:0 including the home-indicator safe-area (matching the nav's
          own pb). Full width, not max-w-md, so nothing peeks past its sides on wider screens. This is
          the design handoff's "solid mask" layer (#407) — the fade layer above sits on top of it. */}
      <div
        aria-hidden="true"
        data-testid="hub-nav-fill"
        className="pointer-events-none fixed bottom-0 left-0 right-0 z-[15] h-[calc(2.75rem_+_env(safe-area-inset-bottom))] bg-background"
      />
      <nav aria-label="Primary" className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 bg-transparent px-3 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] pt-1">
      <div className="flex items-center justify-between rounded-[26px] bg-surface px-1.5 py-3">
        <ToolbarItem label="Menu" active={active === 'menu'} onClick={handleMenuClick} icon={ICON_MENU} btnRef={menuBtnRef} />
        <ToolbarItem label="Games" active={active === 'games'} onClick={onGames} icon={ICON_GAMES} />
        <ToolbarItem label="Account" active={active === 'account'} onClick={onAccount} icon={ICON_ACCOUNT} />
        <ToolbarItem label="Rewards" active={active === 'rewards'} onClick={onRewards} icon={ICON_REWARDS} />
        <ToolbarItem label="Chat" comingSoon icon={ICON_CHAT} />
      </div>
    </nav>
    </>
  );
}

function ToolbarItem({
  label, icon, onClick, active = false, comingSoon = false, btnRef,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
  comingSoon?: boolean;
  /** Set on the rendered `<button>` DOM node (not on ToolbarItem itself, so no forwardRef
   *  needed) — only the Menu item uses this, to read its own position at tap time. */
  btnRef?: Ref<HTMLButtonElement>;
}) {
  const testid = `hub-nav-${label.toLowerCase()}`;
  const labelText = (
    <span className="text-[12px] font-bold tracking-[0.02em]">{label}</span>
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
      ref={btnRef}
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

/* Frame nav glyphs (inline SVG, 24px) — Menu · Games · Account · Rewards · Chat. */
const SVG = 'h-6 w-6';
const ICON_MENU = (
  <svg viewBox="0 0 24 24" fill="currentColor" className={SVG} aria-hidden="true">
    <rect x="3.5" y="5.6" width="17" height="3.1" rx="1.55" />
    <rect x="3.5" y="10.5" width="17" height="3.1" rx="1.55" />
    <rect x="3.5" y="15.4" width="17" height="3.1" rx="1.55" />
  </svg>
);
const ICON_GAMES = (
  <svg viewBox="0 0 351 374" fill="currentColor" className={SVG} aria-hidden="true">
    <path d="M189.84 23.99C187.66 24.20 185.18 24.67 182.99 25.40C180.80 26.13 178.56 27.05 176.69 28.37C174.81 29.69 173.35 31.62 171.73 33.30C170.12 34.98 168.61 36.77 167.01 38.47C165.41 40.17 163.74 41.80 162.15 43.50C160.56 45.21 159.03 46.98 157.46 48.69C155.88 50.41 154.28 52.11 152.67 53.80C151.07 55.50 149.41 57.14 147.82 58.85C146.23 60.56 144.72 62.34 143.13 64.05C141.55 65.76 139.91 67.43 138.31 69.12C136.71 70.82 135.10 72.51 133.52 74.22C131.94 75.94 130.42 77.71 128.82 79.41C127.22 81.11 125.54 82.74 123.94 84.43C122.34 86.13 120.78 87.87 119.20 89.58C117.61 91.29 116.02 93.00 114.43 94.70C112.84 96.41 111.23 98.10 109.64 99.81C108.05 101.51 106.49 103.25 104.89 104.94C103.28 106.64 101.61 108.27 100.02 109.97C98.42 111.67 96.90 113.44 95.31 115.15C93.73 116.86 92.09 118.53 90.50 120.23C88.90 121.93 87.30 123.63 85.72 125.35C84.14 127.06 82.59 128.81 80.99 130.51C79.39 132.21 77.72 133.84 76.13 135.54C74.54 137.25 73.01 139.02 71.43 140.73C69.85 142.45 68.25 144.15 66.65 145.84C65.04 147.54 63.39 149.18 61.80 150.89C60.21 152.60 58.70 154.38 57.11 156.09C55.53 157.80 53.89 159.46 52.28 161.16C50.68 162.85 49.08 164.55 47.50 166.26C45.92 167.98 44.40 169.75 42.80 171.45C41.20 173.15 39.52 174.78 37.92 176.47C36.32 178.17 34.76 179.90 33.18 181.62C31.60 183.34 29.80 184.91 28.46 186.79C27.13 188.67 25.86 190.72 25.17 192.89C24.49 195.06 24.43 197.50 24.34 199.82C24.26 202.14 24.30 204.51 24.65 206.81C24.99 209.10 25.53 211.43 26.39 213.57C27.24 215.72 28.41 217.82 29.77 219.68C31.13 221.54 32.75 223.31 34.55 224.75C36.35 226.18 38.43 227.44 40.57 228.28C42.70 229.12 45.08 229.50 47.38 229.77C49.68 230.05 52.04 229.92 54.38 229.95C56.71 229.98 59.04 229.93 61.38 229.95C63.71 229.97 66.04 229.99 68.37 230.05C70.71 230.12 73.04 230.27 75.37 230.36C77.70 230.46 80.03 230.56 82.36 230.60C84.69 230.65 87.03 230.64 89.36 230.66C91.69 230.68 94.03 230.70 96.36 230.71C98.69 230.72 101.03 230.72 103.36 230.72C105.69 230.72 108.03 230.73 110.36 230.73C112.69 230.73 115.03 230.72 117.36 230.73C119.69 230.74 122.03 230.72 124.36 230.77C126.69 230.82 129.03 230.91 131.36 231.02C133.69 231.13 136.01 231.37 138.34 231.45C140.67 231.53 143.01 231.49 145.34 231.52C147.68 231.54 150.46 230.98 152.34 231.59C154.22 232.20 156.30 233.47 156.64 235.17C156.98 236.88 155.16 239.60 154.40 241.81C153.65 244.01 152.91 246.23 152.12 248.42C151.33 250.62 150.44 252.78 149.67 254.98C148.89 257.18 148.23 259.42 147.46 261.62C146.69 263.82 145.84 266.00 145.04 268.19C144.24 270.38 143.43 272.57 142.66 274.77C141.90 276.98 141.22 279.21 140.44 281.41C139.65 283.61 138.76 285.76 137.97 287.96C137.18 290.15 136.47 292.38 135.71 294.58C134.94 296.79 134.19 298.99 133.39 301.19C132.60 303.38 131.74 305.55 130.96 307.75C130.19 309.95 129.43 312.16 128.75 314.39C128.06 316.62 127.21 318.84 126.84 321.12C126.48 323.41 126.35 325.81 126.58 328.10C126.81 330.40 127.31 332.77 128.22 334.87C129.12 336.97 130.47 339.00 132.00 340.70C133.54 342.41 135.43 343.94 137.41 345.11C139.39 346.28 141.66 347.09 143.88 347.74C146.11 348.39 148.46 348.86 150.76 348.99C153.07 349.13 155.45 348.98 157.71 348.54C159.98 348.11 162.35 347.49 164.34 346.39C166.34 345.29 167.99 343.51 169.70 341.93C171.41 340.36 172.98 338.61 174.59 336.93C176.20 335.24 177.77 333.51 179.37 331.81C180.96 330.10 182.53 328.38 184.14 326.69C185.74 325.00 187.40 323.35 189.01 321.66C190.62 319.97 192.20 318.26 193.79 316.55C195.38 314.84 196.94 313.11 198.55 311.42C200.16 309.73 201.83 308.10 203.44 306.41C205.06 304.73 206.63 303.01 208.23 301.31C209.83 299.61 211.42 297.90 213.03 296.21C214.64 294.52 216.27 292.86 217.88 291.16C219.48 289.47 221.06 287.75 222.65 286.05C224.25 284.34 225.81 282.61 227.43 280.93C229.04 279.24 230.72 277.62 232.33 275.93C233.95 274.25 235.51 272.52 237.10 270.80C238.68 269.09 240.25 267.36 241.85 265.67C243.46 263.97 245.11 262.33 246.73 260.64C248.34 258.96 249.95 257.27 251.54 255.56C253.13 253.86 254.66 252.09 256.26 250.39C257.85 248.69 259.51 247.04 261.13 245.36C262.75 243.68 264.38 242.02 265.98 240.31C267.57 238.61 269.09 236.84 270.68 235.13C272.27 233.43 273.91 231.76 275.53 230.08C277.15 228.40 278.79 226.75 280.39 225.05C281.99 223.35 283.53 221.59 285.12 219.88C286.71 218.18 288.32 216.49 289.93 214.81C291.55 213.12 293.20 211.47 294.81 209.78C296.42 208.09 297.99 206.37 299.58 204.66C301.17 202.96 302.75 201.24 304.36 199.55C305.97 197.86 307.61 196.20 309.22 194.51C310.82 192.82 312.42 191.11 314.00 189.40C315.58 187.68 317.28 186.05 318.71 184.22C320.14 182.38 321.48 180.43 322.57 178.39C323.66 176.34 324.69 174.18 325.26 171.95C325.82 169.72 326.01 167.31 325.96 165.00C325.92 162.70 325.73 160.26 324.99 158.10C324.25 155.95 322.96 153.87 321.53 152.07C320.11 150.27 318.32 148.62 316.43 147.30C314.54 145.98 312.38 144.93 310.22 144.13C308.05 143.32 305.72 142.86 303.43 142.44C301.14 142.03 298.81 141.77 296.49 141.62C294.16 141.48 291.82 141.58 289.49 141.57C287.15 141.56 284.82 141.57 282.49 141.57C280.15 141.57 277.82 141.57 275.49 141.57C273.15 141.57 270.82 141.57 268.49 141.57C266.15 141.57 263.82 141.57 261.49 141.57C259.15 141.57 256.82 141.56 254.49 141.55C252.15 141.54 249.82 141.52 247.49 141.51C245.15 141.50 242.82 141.51 240.49 141.51C238.15 141.51 235.82 141.51 233.49 141.51C231.15 141.51 228.82 141.51 226.49 141.51C224.15 141.50 221.82 141.50 219.49 141.50C217.15 141.49 214.82 141.50 212.49 141.49C210.15 141.49 207.82 141.49 205.49 141.47C203.15 141.44 200.80 141.52 198.49 141.33C196.18 141.14 193.04 141.55 191.63 140.34C190.21 139.13 189.98 136.25 190.01 134.08C190.04 131.90 191.14 129.55 191.80 127.31C192.45 125.07 193.22 122.87 193.94 120.65C194.67 118.43 195.43 116.22 196.15 114.00C196.86 111.78 197.50 109.54 198.23 107.32C198.96 105.11 199.77 102.92 200.53 100.71C201.29 98.50 202.06 96.30 202.79 94.09C203.53 91.87 204.19 89.63 204.95 87.43C205.71 85.22 206.58 83.05 207.35 80.85C208.12 78.65 208.82 76.42 209.56 74.21C210.31 72.00 211.06 69.79 211.84 67.59C212.61 65.39 213.50 63.22 214.20 61.00C214.91 58.78 215.58 56.54 216.06 54.26C216.54 51.98 217.01 49.65 217.07 47.34C217.13 45.02 216.97 42.62 216.44 40.39C215.92 38.15 215.13 35.83 213.90 33.91C212.68 31.99 210.93 30.24 209.09 28.88C207.25 27.52 205.03 26.53 202.86 25.73C200.69 24.93 198.24 24.38 196.07 24.09C193.90 23.80 192.02 23.77 189.84 23.99Z" />
  </svg>
);
const ICON_ACCOUNT = (
  <svg viewBox="0 0 24 24" fill="currentColor" className={SVG} aria-hidden="true">
    <circle cx="12" cy="7.5" r="4" />
    <path d="M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7z" />
  </svg>
);
const ICON_REWARDS = (
  <svg viewBox="0 0 24 24" fill="currentColor" className={SVG} aria-hidden="true">
    <g transform="rotate(-9 12 8)">
      <path d="M9.2 1.6c1.3 0 2.3 1.1 2.8 2.3.5-1.2 1.5-2.3 2.8-2.3 1.3 0 2.3 1 2.3 2.3 0 .5-.2 1-.5 1.4h1.9c.8 0 1.5.7 1.5 1.5v1.9c0 .3-.2.5-.5.5H4.5c-.3 0-.5-.2-.5-.5V6.8c0-.8.7-1.5 1.5-1.5h1.9c-.3-.4-.5-.9-.5-1.4 0-1.3 1-2.3 2.3-2.3zm0 1.6a.8.8 0 0 0 0 1.6c.5 0 1-.3 1.4-.8-.4-.5-.9-.8-1.4-.8zm5.6 0c-.5 0-1 .3-1.4.8.4.5.9.8 1.4.8a.8.8 0 0 0 0-1.6z" />
    </g>
    <path d="M5 11.9h5.9c.3 0 .5.2.5.5v8.2c0 .3-.2.5-.5.5H6.5c-.8 0-1.5-.7-1.5-1.5v-7.2c0-.3.2-.5.5-.5zm8.1 0H19c.3 0 .5.2.5.5v7.2c0 .8-.7 1.5-1.5 1.5h-4.4c-.3 0-.5-.2-.5-.5v-8.2c0-.3.2-.5.5-.5z" />
  </svg>
);
const ICON_CHAT = (
  <svg viewBox="0 0 24 24" fill="currentColor" className={SVG} aria-hidden="true">
    <path d="M5.4 4h13.2A2.4 2.4 0 0 1 21 6.4v7.8a2.4 2.4 0 0 1-2.4 2.4H9.8L5.2 20.4A.7.7 0 0 1 4 19.8V6.4A2.4 2.4 0 0 1 5.4 4z" />
  </svg>
);
