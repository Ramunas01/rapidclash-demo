import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import type { AvatarId, RecentMatchEntry, RewardsSnapshot, VipTier } from '@rapidclash/shared';
import { api } from '../api.js';
import { Credits } from '../components/hub-shared/RcIcon.js';
import { TierIcon, progressPercent } from '../components/hub-shared/vipTier.js';
import { TILE_ART, titleCase } from '../components/hub-shared/tiles.js';
import { cn } from '@/lib/utils';
import { HubToolbar } from '../components/hub-chrome/HubToolbar.js';
import { MenuOverlay } from '../components/hub-chrome/MenuOverlay.js';
import { useMenuOverlay } from '../components/hub-chrome/useMenuOverlay.js';
import { ChatSheet } from '../components/hub-chrome/ChatSheet.js';
import { useChat } from '../components/hub-chrome/useChat.js';
import { HubRibbon } from '../components/hub-chrome/HubRibbon.js';
import { HubFooter } from '../components/hub-shared/HubFooter.js';
import { Avatar } from '../components/hub-shared/Avatar.js';
import { HUB_SHELL } from '../components/hub-chrome/layout.js';

interface Props {
  token: string;
  /** The signed-in player's own alias (#34); null only on a legacy session. */
  username: string | null;
  /** The player's OWN stored avatar. Drives the profile-card disc; the picker sets a new one. */
  avatarId?: AvatarId;
  /** Save-picker callback — App mirrors the choice into its own state + localStorage so the own
   *  game bar + a reload reflect it. The endpoint already persisted it server-side. */
  onAvatarChange?(avatarId: AvatarId): void;
  balance: number;
  onLogout(): void;
  /** Logo / Games nav → Home. */
  onHome(): void;
  /** Wallet chip / Account → stays on Profile (self). */
  onOpenProfile(): void;
  /** Rewards tab → the VIP/Rewards hub (issue #307). */
  onOpenRewards(): void;
  /** Issue #404: the real "Preferences" CONTROLS row's destination — routes to the Preferences
   *  screen (issue #401, merged). This is the PERMANENT home for this callback; it replaces
   *  issue #401's temporary header icon-button entry point (`onOpenPreferences` used to render a
   *  small `Settings` icon beside `MuteToggle`) now that the real settings row exists. Optional
   *  so existing callers/tests without it still compile — the row still renders, it's just inert. */
  onOpenPreferences?(): void;
  /** Issue #423: the real "Affiliate program" row destination — routes to the new Affiliate
   *  screen, replacing the shared placeholder toast this row used to show. Same optional-prop
   *  pattern as `onOpenPreferences` above. */
  onOpenAffiliate?(): void;
}

/** The selectable avatars in the picker: default + the six presets (presets-only, no upload). */
const PICKER_AVATARS: AvatarId[] = ['default', 'boy-light', 'girl-light', 'boy-brown', 'boy-dark', 'hooded-mono', 'hooded-degen'];

/** Design token references (docs/design-refs/design_handoff_account_page/README.md's Dark
 *  column values) — issue #491 (T3b, light group): this object used to hold its own hardcoded
 *  hex literals (a frozen snapshot of the dark column only, so this screen stayed dark-only even
 *  once the rest of the app went light — the same class of bug T2 fixed in HubRibbon.tsx/
 *  HubToolbar.tsx). Now a thin set of aliases onto the shared `--rc-*` custom properties defined
 *  in `index.css` (T1, issue #472), which DO carry a real `[data-theme='light']` override — every
 *  inline `style={{ color: RC.text }}`-style use site below re-themes automatically, no call-site
 *  changes needed. `purple` aliases the fixed `--brand-purple` (index.css) instead — this screen's
 *  accent stays the same fixed brand purple in both themes, matching the prototype's own
 *  `navXColor` literal precedent used elsewhere (HubToolbar.tsx). Kept as a small object (rather
 *  than inlining `var(--rc-*)` at every call site, PreferencesHub.tsx's own approach) because this
 *  file consumes these values via plain inline `style={{}}` props and raw SVG `fill=`/`stroke=`
 *  attributes throughout — both accept a CSS custom-property reference exactly as readily as a hex
 *  literal, so the object stays the natural shape for this file's own call-site pattern. */
const RC = {
  surface: 'var(--rc-surface)',
  sunken: 'var(--rc-sunken)',
  text: 'var(--rc-text)',
  muted: 'var(--rc-muted)',
  green: 'var(--rc-green)',
  danger: 'var(--rc-danger)',
  purple: 'var(--brand-purple)',
};
const SPACE_GROTESK = "'Space Grotesk', Arial, Helvetica, sans-serif";
const ARIAL = 'Arial, Helvetica, sans-serif';

/** A handful of rows shown collapsed, and the page size once expanded — the design's own
 *  "handful of rows" + numbered page pills derived from `total`/`limit` (README §1 point 4). */
const RECENT_PAGE_SIZE = 5;

/** How long a CONTROLS/Affiliate "coming soon" placeholder toast stays up before auto-dismissing
 *  (mirrors BringARival's own toast hold, `apps/web/src/components/hub-shared/BringARival.tsx`). */
const PLACEHOLDER_TOAST_MS = 2200;

/** CONTROLS row icons + the row chevron — restores the design file's own solid-fill-with-knockout
 *  SVGs (docs/design-refs/Problem1/`Controls section icons.zip`), replacing the lucide-react
 *  outline glyphs that shipped here originally (a "reasonable semantic substitution" that read as
 *  a visible mismatch against the design — Designer report, confirmed 2026-08-24). Colors wired
 *  to the existing `RC` object (`RC.muted`/`RC.surface`), not new CSS custom properties — matches
 *  how `ControlsIcon` (the CONTROLS header gear, already correct, never substituted) already does
 *  it, and avoids the "third palette" this file's own comment above `RC` warns against. Dark-only,
 *  same as the rest of this screen — no light-mode variant needed (no app-wide theme exists yet). */
const ICON_ACCOUNT_DETAILS = (
  <svg width="19" height="19" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 19px' }} aria-hidden="true">
    <rect x="2" y="5" width="20" height="14" rx="4" fill={RC.muted} />
    <circle cx="8.6" cy="12" r="2.6" fill={RC.surface} />
    <rect x="13.4" y="9.6" width="6" height="1.9" rx="0.95" fill={RC.surface} />
    <rect x="13.4" y="13" width="4.2" height="1.9" rx="0.95" fill={RC.surface} />
  </svg>
);
const ICON_VERIFICATION = (
  <svg width="19" height="19" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 19px' }} aria-hidden="true">
    <circle cx="9.6" cy="7.8" r="3.9" fill={RC.muted} />
    <path d="M2.4 20.4c.6-4 3.6-6.3 7.2-6.3 1.1 0 2.1.2 3 .6a6.4 6.4 0 0 0 3.2 5.7z" fill={RC.muted} />
    <circle cx="17.6" cy="15.8" r="4.8" fill={RC.muted} />
    <path d="M15.4 15.9l1.7 1.7 3-3.2" fill="none" stroke={RC.surface} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICON_SECURITY = (
  <svg width="19" height="19" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 19px' }} aria-hidden="true">
    <path d="M12 2.2 20.4 5v6.6c0 5-3.5 8.6-8.4 10.2C7.1 20.2 3.6 16.6 3.6 11.6V5z" fill={RC.muted} />
    <g fill={RC.surface}>
      <rect x="10.6" y="6.6" width="2.8" height="10.8" rx="0.6" />
      <rect x="10.6" y="6.6" width="2.8" height="10.8" rx="0.6" transform="rotate(60 12 12)" />
      <rect x="10.6" y="6.6" width="2.8" height="10.8" rx="0.6" transform="rotate(120 12 12)" />
      <circle cx="12" cy="12" r="4" />
    </g>
    <circle cx="12" cy="12" r="1.6" fill={RC.muted} />
  </svg>
);
const ICON_PREFERENCES = (
  <svg width="19" height="19" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 19px' }} aria-hidden="true">
    <rect x="1.6" y="6.4" width="20.8" height="11.2" rx="5.6" fill={RC.muted} />
    <circle cx="16.6" cy="12" r="3.7" fill={RC.surface} />
  </svg>
);
const ICON_AFFILIATE_PROGRAM = (
  <svg width="19" height="19" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 19px' }} aria-hidden="true">
    <circle cx="9" cy="8.4" r="4.2" fill={RC.muted} />
    <path d="M1.4 20.6c.5-4.2 3.7-6.6 7.6-6.6s7.1 2.4 7.6 6.6z" fill={RC.muted} />
    <circle cx="18" cy="7.4" r="3.2" fill={RC.muted} />
    <path d="M15.6 13.2c.8-.3 1.6-.4 2.4-.4 3 0 5.2 1.8 5.6 5h-4.2c-.3-1.9-1.4-3.5-3.1-4.5z" fill={RC.muted} />
  </svg>
);
const ICON_RESPONSIBLE_GAMING = (
  <svg width="19" height="19" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 19px' }} aria-hidden="true">
    <path d="M12 2.2 20.4 5v6.6c0 5-3.5 8.6-8.4 10.2C7.1 20.2 3.6 16.6 3.6 11.6V5z" fill={RC.muted} />
    <g transform="translate(6.51 5.65) scale(0.0313)">
      <path
        fill={RC.surface}
        d="M189.84 23.99C187.66 24.20 185.18 24.67 182.99 25.40C180.80 26.13 178.56 27.05 176.69 28.37C174.81 29.69 173.35 31.62 171.73 33.30C170.12 34.98 168.61 36.77 167.01 38.47C165.41 40.17 163.74 41.80 162.15 43.50C160.56 45.21 159.03 46.98 157.46 48.69C155.88 50.41 154.28 52.11 152.67 53.80C151.07 55.50 149.41 57.14 147.82 58.85C146.23 60.56 144.72 62.34 143.13 64.05C141.55 65.76 139.91 67.43 138.31 69.12C136.71 70.82 135.10 72.51 133.52 74.22C131.94 75.94 130.42 77.71 128.82 79.41C127.22 81.11 125.54 82.74 123.94 84.43C122.34 86.13 120.78 87.87 119.20 89.58C117.61 91.29 116.02 93.00 114.43 94.70C112.84 96.41 111.23 98.10 109.64 99.81C108.05 101.51 106.49 103.25 104.89 104.94C103.28 106.64 101.61 108.27 100.02 109.97C98.42 111.67 96.90 113.44 95.31 115.15C93.73 116.86 92.09 118.53 90.50 120.23C88.90 121.93 87.30 123.63 85.72 125.35C84.14 127.06 82.59 128.81 80.99 130.51C79.39 132.21 77.72 133.84 76.13 135.54C74.54 137.25 73.01 139.02 71.43 140.73C69.85 142.45 68.25 144.15 66.65 145.84C65.04 147.54 63.39 149.18 61.80 150.89C60.21 152.60 58.70 154.38 57.11 156.09C55.53 157.80 53.89 159.46 52.28 161.16C50.68 162.85 49.08 164.55 47.50 166.26C45.92 167.98 44.40 169.75 42.80 171.45C41.20 173.15 39.52 174.78 37.92 176.47C36.32 178.17 34.76 179.90 33.18 181.62C31.60 183.34 29.80 184.91 28.46 186.79C27.13 188.67 25.86 190.72 25.17 192.89C24.49 195.06 24.43 197.50 24.34 199.82C24.26 202.14 24.30 204.51 24.65 206.81C24.99 209.10 25.53 211.43 26.39 213.57C27.24 215.72 28.41 217.82 29.77 219.68C31.13 221.54 32.75 223.31 34.55 224.75C36.35 226.18 38.43 227.44 40.57 228.28C42.70 229.12 45.08 229.50 47.38 229.77C49.68 230.05 52.04 229.92 54.38 229.95C56.71 229.98 59.04 229.93 61.38 229.95C63.71 229.97 66.04 229.99 68.37 230.05C70.71 230.12 73.04 230.27 75.37 230.36C77.70 230.46 80.03 230.56 82.36 230.60C84.69 230.65 87.03 230.64 89.36 230.66C91.69 230.68 94.03 230.70 96.36 230.71C98.69 230.72 101.03 230.72 103.36 230.72C105.69 230.72 108.03 230.73 110.36 230.73C112.69 230.73 115.03 230.72 117.36 230.73C119.69 230.74 122.03 230.72 124.36 230.77C126.69 230.82 129.03 230.91 131.36 231.02C133.69 231.13 136.01 231.37 138.34 231.45C140.67 231.53 143.01 231.49 145.34 231.52C147.68 231.54 150.46 230.98 152.34 231.59C154.22 232.20 156.30 233.47 156.64 235.17C156.98 236.88 155.16 239.60 154.40 241.81C153.65 244.01 152.91 246.23 152.12 248.42C151.33 250.62 150.44 252.78 149.67 254.98C148.89 257.18 148.23 259.42 147.46 261.62C146.69 263.82 145.84 266.00 145.04 268.19C144.24 270.38 143.43 272.57 142.66 274.77C141.90 276.98 141.22 279.21 140.44 281.41C139.65 283.61 138.76 285.76 137.97 287.96C137.18 290.15 136.47 292.38 135.71 294.58C134.94 296.79 134.19 298.99 133.39 301.19C132.60 303.38 131.74 305.55 130.96 307.75C130.19 309.95 129.43 312.16 128.75 314.39C128.06 316.62 127.21 318.84 126.84 321.12C126.48 323.41 126.35 325.81 126.58 328.10C126.81 330.40 127.31 332.77 128.22 334.87C129.12 336.97 130.47 339.00 132.00 340.70C133.54 342.41 135.43 343.94 137.41 345.11C139.39 346.28 141.66 347.09 143.88 347.74C146.11 348.39 148.46 348.86 150.76 348.99C153.07 349.13 155.45 348.98 157.71 348.54C159.98 348.11 162.35 347.49 164.34 346.39C166.34 345.29 167.99 343.51 169.70 341.93C171.41 340.36 172.98 338.61 174.59 336.93C176.20 335.24 177.77 333.51 179.37 331.81C180.96 330.10 182.53 328.38 184.14 326.69C185.74 325.00 187.40 323.35 189.01 321.66C190.62 319.97 192.20 318.26 193.79 316.55C195.38 314.84 196.94 313.11 198.55 311.42C200.16 309.73 201.83 308.10 203.44 306.41C205.06 304.73 206.63 303.01 208.23 301.31C209.83 299.61 211.42 297.90 213.03 296.21C214.64 294.52 216.27 292.86 217.88 291.16C219.48 289.47 221.06 287.75 222.65 286.05C224.25 284.34 225.81 282.61 227.43 280.93C229.04 279.24 230.72 277.62 232.33 275.93C233.95 274.25 235.51 272.52 237.10 270.80C238.68 269.09 240.25 267.36 241.85 265.67C243.46 263.97 245.11 262.33 246.73 260.64C248.34 258.96 249.95 257.27 251.54 255.56C253.13 253.86 254.66 252.09 256.26 250.39C257.85 248.69 259.51 247.04 261.13 245.36C262.75 243.68 264.38 242.02 265.98 240.31C267.57 238.61 269.09 236.84 270.68 235.13C272.27 233.43 273.91 231.76 275.53 230.08C277.15 228.40 278.79 226.75 280.39 225.05C281.99 223.35 283.53 221.59 285.12 219.88C286.71 218.18 288.32 216.49 289.93 214.81C291.55 213.12 293.20 211.47 294.81 209.78C296.42 208.09 297.99 206.37 299.58 204.66C301.17 202.96 302.75 201.24 304.36 199.55C305.97 197.86 307.61 196.20 309.22 194.51C310.82 192.82 312.42 191.11 314.00 189.40C315.58 187.68 317.28 186.05 318.71 184.22C320.14 182.38 321.48 180.43 322.57 178.39C323.66 176.34 324.69 174.18 325.26 171.95C325.82 169.72 326.01 167.31 325.96 165.00C325.92 162.70 325.73 160.26 324.99 158.10C324.25 155.95 322.96 153.87 321.53 152.07C320.11 150.27 318.32 148.62 316.43 147.30C314.54 145.98 312.38 144.93 310.22 144.13C308.05 143.32 305.72 142.86 303.43 142.44C301.14 142.03 298.81 141.77 296.49 141.62C294.16 141.48 291.82 141.58 289.49 141.57C287.15 141.56 284.82 141.57 282.49 141.57C280.15 141.57 277.82 141.57 275.49 141.57C273.15 141.57 270.82 141.57 268.49 141.57C266.15 141.57 263.82 141.57 261.49 141.57C259.15 141.57 256.82 141.56 254.49 141.55C252.15 141.54 249.82 141.52 247.49 141.51C245.15 141.50 242.82 141.51 240.49 141.51C238.15 141.51 235.82 141.51 233.49 141.51C231.15 141.51 228.82 141.51 226.49 141.51C224.15 141.50 221.82 141.50 219.49 141.50C217.15 141.49 214.82 141.50 212.49 141.49C210.15 141.49 207.82 141.49 205.49 141.47C203.15 141.44 200.80 141.52 198.49 141.33C196.18 141.14 193.04 141.55 191.63 140.34C190.21 139.13 189.98 136.25 190.01 134.08C190.04 131.90 191.14 129.55 191.80 127.31C192.45 125.07 193.22 122.87 193.94 120.65C194.67 118.43 195.43 116.22 196.15 114.00C196.86 111.78 197.50 109.54 198.23 107.32C198.96 105.11 199.77 102.92 200.53 100.71C201.29 98.50 202.06 96.30 202.79 94.09C203.53 91.87 204.19 89.63 204.95 87.43C205.71 85.22 206.58 83.05 207.35 80.85C208.12 78.65 208.82 76.42 209.56 74.21C210.31 72.00 211.06 69.79 211.84 67.59C212.61 65.39 213.50 63.22 214.20 61.00C214.91 58.78 215.58 56.54 216.06 54.26C216.54 51.98 217.01 49.65 217.07 47.34C217.13 45.02 216.97 42.62 216.44 40.39C215.92 38.15 215.13 35.83 213.90 33.91C212.68 31.99 210.93 30.24 209.09 28.88C207.25 27.52 205.03 26.53 202.86 25.73C200.69 24.93 198.24 24.38 196.07 24.09C193.90 23.80 192.02 23.77 189.84 23.99Z"
      />
    </g>
  </svg>
);
const ICON_BLOCKED_PLAYERS = (
  <svg width="19" height="19" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 19px' }} aria-hidden="true">
    <path
      d="M12 2.2a9.8 9.8 0 1 0 0 19.6 9.8 9.8 0 0 0 0-19.6zm0 3a6.8 6.8 0 0 1 4 1.3L6.5 16a6.8 6.8 0 0 1 5.5-10.8zm0 13.6a6.8 6.8 0 0 1-4-1.3L17.5 8a6.8 6.8 0 0 1-5.5 10.8z"
      fill={RC.muted}
    />
  </svg>
);
const ICON_HELP_SUPPORT = (
  <svg width="19" height="19" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 19px' }} aria-hidden="true">
    <circle cx="12" cy="12" r="9.6" fill={RC.muted} />
    <rect x="10.7" y="10.2" width="2.6" height="7.4" rx="1.3" fill={RC.surface} />
    <circle cx="12" cy="7.2" r="1.5" fill={RC.surface} />
  </svg>
);
/** Row chevron — replaces lucide's `ChevronRight` for every CONTROLS/Affiliate row (both
 *  `renderControlRow` and the standalone Affiliate row below use this same element). */
const CONTROLS_CHEVRON = (
  <svg width="8" height="12" viewBox="0 0 8 12" style={{ display: 'block', flex: '0 0 8px' }} aria-hidden="true">
    <path d="M1.4 1.6 6.6 6 1.4 10.4z" fill={RC.muted} stroke={RC.muted} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

/** CONTROLS group rows, minus Preferences (handled separately — it's the one real destination
 *  per the design handoff's own scope note: "Implement only Account and Preferences unless told
 *  otherwise"). */
const FIRST_GROUP: { key: string; label: string; icon: ReactNode }[] = [
  { key: 'account-details', label: 'Account details', icon: ICON_ACCOUNT_DETAILS },
  { key: 'verification', label: 'Verification', icon: ICON_VERIFICATION },
  { key: 'security', label: 'Security', icon: ICON_SECURITY },
];
const SECOND_GROUP: { key: string; label: string; icon: ReactNode }[] = [
  { key: 'responsible-gaming', label: 'Responsible gaming', icon: ICON_RESPONSIBLE_GAMING },
  { key: 'blocked-players', label: 'Blocked players', icon: ICON_BLOCKED_PLAYERS },
  { key: 'help-support', label: 'Help & support', icon: ICON_HELP_SUPPORT },
];

function formatMatchTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** Issue #441: strip a leading 🤖 bot glyph (and any leading '@') from an opponent's display
 *  name, then always prepend exactly one '@'. Owner-confirmed 2026-09-07: fine to drop the 🤖
 *  prefix on this personal, retrospective match-history list — ADR-010's informed-consent
 *  labeling targets the lobby/open-challenges feed, not here. Applied uniformly to every row, so
 *  this also fixes names that are missing their '@' today (no per-account special-casing). */
function normalizeOpponentName(name: string): string {
  return `@${name.replace(/^🤖\s*/, '').replace(/^@/, '')}`;
}

/** Issue #441: the opponent's VIP tier, for the tier-icon glyph next to their name. #440 (a
 *  parallel backend ticket) adds a real `opponentTier` field to `RecentMatchEntry` — guarded
 *  here via an optional-field read (rather than a hard type dependency) since #440 may not have
 *  merged to `main` yet when this ships. A missing field reads as 'Unranked', same as any other
 *  gap in the tier ladder (see `TierIcon`'s own established precedent) — no fabricated tier. */
function opponentTierOf(m: RecentMatchEntry): VipTier {
  return (m as RecentMatchEntry & { opponentTier?: VipTier }).opponentTier ?? 'Unranked';
}

/**
 * Profile hub — the Account toolbar / wallet-chip target (issue #404 redesign). Composes: the
 * "Bring a rival" banner, a profile card (avatar/username/XP + VIP progress, fed by the same
 * `api.rewards` snapshot RewardsHub.tsx uses), a paginated recent-games match history (replacing
 * the old ledger-transaction list and on-page leaderboard — issue #400's `api.recentMatches`),
 * grouped CONTROLS settings rows (only Preferences routes to a real screen — issue #401 — the
 * rest are inert placeholders per the design handoff's own stated scope), a standalone Affiliate
 * row (same placeholder), and LOG OUT. Read-only / play-money — no hidden info.
 */
export function ProfileHubScreen({ token, username, avatarId = 'default', onAvatarChange, balance, onLogout, onHome, onOpenProfile, onOpenRewards, onOpenPreferences, onOpenAffiliate }: Props) {
  const [liveBalance, setLiveBalance] = useState(balance);
  const [pickerOpen, setPickerOpen] = useState(false);

  // VIP progress — same RewardsSnapshot shape/derivation RewardsHub.tsx already uses (issue
  // #306/#307): tier, rakebackRate, nextTier are all already on the response, just unread here
  // before this ticket.
  const [snapshot, setSnapshot] = useState<RewardsSnapshot | null>(null);

  // Recent games — issue #400's paginated match history, replacing the ledger/leaderboard.
  const [matches, setMatches] = useState<RecentMatchEntry[]>([]);
  const [matchesTotal, setMatchesTotal] = useState(0);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [matchesPage, setMatchesPage] = useState(0);
  const [matchesExpanded, setMatchesExpanded] = useState(false);

  const [placeholderLabel, setPlaceholderLabel] = useState<string | null>(null);
  const placeholderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Issue #414: the Menu overlay's own open/close/reveal-origin state.
  const menu = useMenuOverlay();
  // Ticket 2026-09-11#7b: the chat sheet's own subscribe/open/close/message-list state.
  const chat = useChat();
  function navTo(fn: () => void) {
    return () => { chat.close(); menu.wrap(fn)(); };
  }
  function openChat() {
    menu.close();
    chat.openChat();
  }

  useEffect(() => { setLiveBalance(balance); }, [balance]);

  // Issue found live 2026-08-22: the App-level `balance` prop is only ever set from a fresh
  // login/register response or a match.end settlement — App.tsx has no independent /wallet
  // refetch anywhere. On a resumed session (reload with an already-stored token, no fresh
  // login/register round-trip) `balance` can sit at its initial 0 until a match settles. The OLD
  // ProfileHub.tsx masked this by always fetching `api.wallet(token)` on mount (originally to
  // populate the ledger-entries list, dropped with #404's redesign) — that fetch's SIDE EFFECT of
  // keeping this page's balance fresh was lost along with it. Re-fetch just the balance here
  // (not the ledger entries, which stay gone on purpose) so visiting Account is never the one
  // screen that can show a stale/zero balance regardless of what the App-level state happens to
  // be at that moment.
  useEffect(() => {
    let alive = true;
    api.wallet(token).then((w) => { if (alive) setLiveBalance(w.balance); }).catch(() => {});
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    let alive = true;
    api.rewards(token).then((r) => { if (alive) setSnapshot(r); }).catch(() => {});
    return () => { alive = false; };
  }, [token]);

  useEffect(() => {
    let alive = true;
    setMatchesLoading(true);
    api.recentMatches(token, RECENT_PAGE_SIZE, matchesPage * RECENT_PAGE_SIZE)
      .then((r) => { if (alive) { setMatches(r.matches ?? []); setMatchesTotal(r.total ?? 0); } })
      .catch(() => {})
      .finally(() => { if (alive) setMatchesLoading(false); });
    return () => { alive = false; };
  }, [token, matchesPage]);

  useEffect(() => () => { if (placeholderTimer.current) clearTimeout(placeholderTimer.current); }, []);

  function showPlaceholder(label: string) {
    if (placeholderTimer.current) clearTimeout(placeholderTimer.current);
    setPlaceholderLabel(label);
    placeholderTimer.current = setTimeout(() => {
      setPlaceholderLabel(null);
      placeholderTimer.current = null;
    }, PLACEHOLDER_TOAST_MS);
  }

  function collapseGames() {
    setMatchesExpanded(false);
    setMatchesPage(0);
  }

  const tier = snapshot?.tier ?? 'Unranked';
  const xpLifetime = snapshot?.xpLifetime ?? 0;
  const nextTier = snapshot?.nextTier;
  const pct = progressPercent(xpLifetime, tier, nextTier);
  const pageCount = Math.max(1, Math.ceil(matchesTotal / RECENT_PAGE_SIZE));
  const hasMorePages = matchesTotal > RECENT_PAGE_SIZE;

  function renderControlRow({ key, label, icon }: { key: string; label: string; icon: ReactNode }) {
    const isPreferences = key === 'preferences';
    return (
      <button
        key={key}
        type="button"
        data-testid={`profile-control-${key}`}
        onClick={() => (isPreferences ? onOpenPreferences?.() : showPlaceholder(label))}
        style={{ height: 42, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        {icon}
        <span style={{ flex: '1 1 auto', fontSize: 14, fontWeight: 600, color: RC.text }}>{label}</span>
        {CONTROLS_CHEVRON}
      </button>
    );
  }

  const controlRows = [...FIRST_GROUP, { key: 'preferences', label: 'Preferences', icon: ICON_PREFERENCES }];

  return (
    <div className={HUB_SHELL}>
      <HubRibbon balance={liveBalance} onLogo={onHome} onWallet={onOpenProfile} />

      <main data-testid="profile-hub">
        <div className="mx-auto flex max-w-md flex-col gap-5">
          <div style={{ margin: '0 16px', padding: '0 0 14px 0' }}>
            {/* ACCOUNT headline, alone (issue #418: the sound-mute control that used to sit here
                on the right was never part of the design spec — it's moved to Preferences' own
                "Game sounds" toggle, which now drives the same real lib/sound.ts module). */}
            <span style={{ fontFamily: ARIAL, fontSize: 19, fontWeight: 'bold', letterSpacing: '0.6px', color: RC.text }}>ACCOUNT</span>

            {/* 2 — Profile card: avatar (tap → existing picker) + username + XP + VIP progress. */}
            <section data-testid="profile-card" style={{ marginTop: 14, background: RC.surface, borderRadius: 22, padding: '18px 16px 20px 16px' }}>
              <div data-testid="profile-header" style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  data-testid="profile-avatar-button"
                  aria-label="Change avatar"
                  style={{ flex: '0 0 44px', borderRadius: 999, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer' }}
                >
                  <Avatar username={username} avatarId={avatarId} size={44} />
                </button>
                <span data-testid="profile-username" style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: ARIAL, fontSize: 20, fontWeight: 'bold', letterSpacing: '0.4px', color: RC.text }}>
                  {username ?? 'Player'}
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flex: '0 0 auto' }}>
                  <span style={{ fontFamily: ARIAL, fontSize: 22, fontWeight: 'bold', letterSpacing: '1.2px', color: RC.text }}>XP:</span>
                  <span data-testid="profile-xp" style={{ fontFamily: SPACE_GROTESK, fontSize: 22, fontWeight: 700, color: RC.green }}>
                    {xpLifetime.toLocaleString('en-US')}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontFamily: ARIAL, fontSize: 12, fontWeight: 'bold', letterSpacing: '0.6px', color: RC.text }}>YOUR VIP PROGRESS</span>
                <span data-testid="profile-vip-pct" style={{ fontFamily: SPACE_GROTESK, fontSize: 15, fontWeight: 700, color: RC.green }}>{pct}%</span>
              </div>
              <div style={{ marginTop: 7, height: 8, borderRadius: 999, background: RC.sunken }}>
                <div data-testid="profile-vip-bar" style={{ width: `${pct}%`, height: 8, borderRadius: 999, background: RC.purple, boxShadow: '0 0 12px 2px rgba(139,69,240,0.55)' }} />
              </div>
              <div style={{ marginTop: 9, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span data-testid="profile-vip-tier-current" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontFamily: ARIAL, fontSize: 12, fontWeight: 'bold', letterSpacing: '1.2px', color: RC.text }}>{tier.toUpperCase()}</span>
                  <TierIcon tier={tier} size={15} />
                </span>
                <span data-testid="profile-vip-tier-next" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontFamily: ARIAL, fontSize: 12, fontWeight: 'bold', letterSpacing: '1.2px', color: RC.text }}>
                    {nextTier ? nextTier.tier.toUpperCase() : 'MAX'}
                  </span>
                  {nextTier && <TierIcon tier={nextTier.tier} size={15} />}
                </span>
              </div>
            </section>

            {/* 3 — Recent games: paginated match history (issue #400). */}
            <section data-testid="profile-recent-games" style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <RecentGamesIcon />
                <span style={{ fontFamily: ARIAL, fontSize: 19, fontWeight: 'bold', letterSpacing: '0.6px', color: RC.text }}>RECENT GAMES</span>
              </div>

              {matchesLoading && matches.length === 0 ? (
                <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="animate-pulse" style={{ height: 74, borderRadius: 12, background: RC.surface }} />
                  ))}
                </div>
              ) : matches.length === 0 ? (
                <p style={{ padding: '16px 0', textAlign: 'center', fontFamily: ARIAL, fontSize: 12, color: RC.muted }}>
                  No matches yet — play a game to get started.
                </p>
              ) : (
                <>
                  <div style={{ position: 'relative', overflow: matchesExpanded ? 'visible' : 'hidden', maxHeight: matchesExpanded ? 'none' : RECENT_PAGE_SIZE * 74, transition: 'max-height 320ms cubic-bezier(0.22, 0.61, 0.36, 1)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {matches.map((m, i) => <MatchRow key={m.matchId} m={m} index={i} />)}
                    </div>
                    {!matchesExpanded && hasMorePages && (
                      <>
                        <div
                          style={{
                            position: 'absolute', left: 0, right: 0, bottom: 0, height: 76, pointerEvents: 'none', borderRadius: '0 0 26px 26px',
                            // Issue #491: this used to append a hex alpha suffix directly onto RC.sunken's
                            // own hex literal (`${RC.sunken}B8` etc.) — that trick only works on a raw hex
                            // string, not the `var(--rc-sunken)` reference RC.sunken is now. color-mix()
                            // reproduces the same alpha fade (0xB8/0xF0/0xFC ≈ 72%/94%/99% opacity) against
                            // whatever --rc-sunken resolves to in the active theme.
                            background: `linear-gradient(to bottom, transparent 0%, color-mix(in srgb, ${RC.sunken} 72%, transparent) 34%, color-mix(in srgb, ${RC.sunken} 94%, transparent) 66%, color-mix(in srgb, ${RC.sunken} 99%, transparent) 100%)`,
                          }}
                        />
                        <button
                          type="button"
                          data-testid="profile-matches-view-more"
                          onClick={() => setMatchesExpanded(true)}
                          style={{ position: 'absolute', right: 4, bottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: RC.surface, borderRadius: 999, padding: '8px 14px', border: 'none', cursor: 'pointer' }}
                        >
                          <span style={{ fontFamily: ARIAL, fontSize: 10, fontWeight: 'bold', letterSpacing: '0.8px', color: RC.text }}>VIEW MORE</span>
                        </button>
                      </>
                    )}
                  </div>

                  {matchesExpanded && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4, padding: '0 4px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        {Array.from({ length: pageCount }).map((_, i) => (
                          <button
                            key={i}
                            type="button"
                            data-testid={`profile-matches-page-${i + 1}`}
                            aria-pressed={i === matchesPage}
                            onClick={() => setMatchesPage(i)}
                            style={{ minWidth: 34, height: 34, padding: '0 10px', borderRadius: 999, background: i === matchesPage ? RC.purple : RC.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}
                          >
                            <span style={{ fontFamily: SPACE_GROTESK, fontSize: 14, fontWeight: 700, color: RC.text }}>{i + 1}</span>
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        data-testid="profile-matches-view-less"
                        onClick={collapseGames}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: RC.surface, borderRadius: 999, padding: '8px 14px', border: 'none', cursor: 'pointer' }}
                      >
                        <span style={{ fontFamily: ARIAL, fontSize: 10, fontWeight: 'bold', letterSpacing: '0.8px', color: RC.text }}>VIEW LESS</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>

            {/* 4 — CONTROLS: only Preferences routes to a real screen; the rest are inert
                placeholders, per the design handoff's own stated scope. */}
            <section data-testid="profile-controls" style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ControlsIcon />
                <span style={{ fontFamily: ARIAL, fontSize: 19, fontWeight: 'bold', letterSpacing: '0.6px', color: RC.text }}>CONTROLS</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', background: RC.surface, borderRadius: 20, overflow: 'hidden' }}>
                {controlRows.map(renderControlRow)}
              </div>

              {/* 5 — Affiliate program: standalone row, now the real destination (issue #423) —
                  no longer the shared placeholder. */}
              <button
                type="button"
                data-testid="profile-affiliate"
                onClick={() => onOpenAffiliate?.()}
                style={{ height: 48, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, background: RC.surface, borderRadius: 20, padding: '0 18px', border: 'none', cursor: 'pointer', textAlign: 'left' }}
              >
                {ICON_AFFILIATE_PROGRAM}
                <span style={{ flex: '1 1 auto', fontSize: 14, fontWeight: 600, color: RC.text }}>Affiliate program</span>
                {CONTROLS_CHEVRON}
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', background: RC.surface, borderRadius: 20, overflow: 'hidden' }}>
                {SECOND_GROUP.map(renderControlRow)}
              </div>
            </section>

            {/* 6 — LOG OUT: bottom-right danger pill. */}
            <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={onLogout}
                data-testid="profile-logout"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: RC.surface, borderRadius: 999, padding: '10px 20px', border: 'none', cursor: 'pointer' }}
              >
                <span style={{ fontFamily: ARIAL, fontSize: 12, lineHeight: '12px', fontWeight: 'bold', letterSpacing: '0.8px', color: RC.danger }}>LOG OUT</span>
              </button>
            </div>
          </div>
        </div>

        <HubFooter onGames={onHome} onRewards={onOpenRewards} />
      </main>

      <HubToolbar
        onGames={navTo(onHome)}
        onAccount={navTo(onOpenProfile)}
        onRewards={navTo(onOpenRewards)}
        onMenu={(rect) => { chat.close(); menu.onMenu(rect); }}
        reportAnchorRect={menu.reportAnchorRect}
        onChat={openChat}
        active={chat.open ? 'chat' : menu.open ? 'menu' : 'account'}
      />
      <MenuOverlay
        open={menu.open}
        anchorRect={menu.anchorRect}
        onClose={menu.close}
        onOpenGames={onHome}
        onOpenRewards={onOpenRewards}
        onOpenAffiliate={() => onOpenAffiliate?.()}
      />
      <ChatSheet
        open={chat.open}
        expanded={chat.expanded}
        messages={chat.messages}
        onClose={chat.close}
        onToggleExpanded={chat.toggleExpanded}
        onSend={chat.send}
      />

      {placeholderLabel && (
        <div
          role="status"
          aria-live="polite"
          data-testid="profile-placeholder-toast"
          className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4 bottom-[calc(2.75rem_+_0.75rem_+_env(safe-area-inset-bottom))]"
        >
          <div style={{ background: RC.purple, color: RC.text }} className="whitespace-nowrap rounded-full px-5 py-2.5 text-[13px] font-semibold">
            {placeholderLabel} — coming soon
          </div>
        </div>
      )}

      {pickerOpen && (
        <AvatarPicker
          token={token}
          username={username}
          current={avatarId}
          onSaved={(id) => { onAvatarChange?.(id); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/** One recent-games row — game art thumbnail, game name, opponent (normalized name + tier icon),
 *  signed delta (green on a win, muted otherwise per README §1 point 4), and a formatted
 *  settlement timestamp. Issue #441: rows now use the exact zebra pattern `GamesCarousel.tsx`'s
 *  Open Games rows already use (`height: 74px`, alternating fill on even index, 26px radius on
 *  filled rows / 0px on transparent ones), replacing the old striped-table
 *  position-based-rounding convention (26px first/last, 6px interior, every row filled). */
function MatchRow({ m, index }: { m: RecentMatchEntry; index: number }) {
  const art = TILE_ART[m.gameId];
  const win = m.outcome === 'win';
  const zebra = index % 2 === 0;
  const opponentTier = opponentTierOf(m);
  const vsColor = m.outcome === 'win' ? RC.green : m.outcome === 'loss' ? RC.text : RC.muted;
  return (
    <div
      data-testid={`profile-match-${m.matchId}`}
      style={{
        height: '74px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '11px', padding: '0 16px',
        background: zebra ? RC.surface : 'transparent', borderRadius: zebra ? '26px' : '0px',
      }}
    >
      <div
        style={{
          width: 38, height: 52, borderRadius: 8, flex: '0 0 38px', backgroundColor: '#1B1B2E',
          backgroundImage: art ? `url(${art})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center',
        }}
      />
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ fontFamily: ARIAL, fontSize: 14, fontWeight: 'bold', letterSpacing: '0.4px', color: RC.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {titleCase(m.gameId)}
        </div>
        <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <span style={{ fontFamily: ARIAL, fontSize: 11, fontWeight: 'bold', letterSpacing: '1px', color: vsColor, flex: '0 0 auto' }}>VS</span>
          <Avatar avatarId={m.opponentAvatarId} username={m.opponentDisplayName} size={16} />
          {opponentTier !== 'Unranked' && <TierIcon tier={opponentTier} size={14} />}
          <span style={{ fontFamily: ARIAL, fontSize: 12, fontWeight: 'bold', color: RC.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {normalizeOpponentName(m.opponentDisplayName)}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flex: '0 0 auto' }}>
        <span data-testid={`profile-match-${m.matchId}-amount`} style={{ fontFamily: SPACE_GROTESK, fontSize: 17, fontWeight: 700, color: win ? RC.green : RC.muted }}>
          <Credits amount={m.delta} showSign />
        </span>
        <span style={{ fontFamily: SPACE_GROTESK, fontSize: 11, fontWeight: 500, color: RC.muted, whiteSpace: 'nowrap' }}>{formatMatchTime(m.settledAt)}</span>
      </div>
    </div>
  );
}

/** RECENT GAMES headline glyph — the design's own bolt icon (byte-identical path data to
 *  RewardsHub.tsx's `XpEngineIcon`, which the prototype also reuses for its "THE XP ENGINE"
 *  accordion — the same shape, two different headings). */
function RecentGamesIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 351 374" fill="none" width="26" height="26" style={{ display: 'block', flex: '0 0 26px', color: RC.purple }}>
      <path fill="currentColor" d="M189.84 23.99C187.66 24.20 185.18 24.67 182.99 25.40C180.80 26.13 178.56 27.05 176.69 28.37C174.81 29.69 173.35 31.62 171.73 33.30C170.12 34.98 168.61 36.77 167.01 38.47C165.41 40.17 163.74 41.80 162.15 43.50C160.56 45.21 159.03 46.98 157.46 48.69C155.88 50.41 154.28 52.11 152.67 53.80C151.07 55.50 149.41 57.14 147.82 58.85C146.23 60.56 144.72 62.34 143.13 64.05C141.55 65.76 139.91 67.43 138.31 69.12C136.71 70.82 135.10 72.51 133.52 74.22C131.94 75.94 130.42 77.71 128.82 79.41C127.22 81.11 125.54 82.74 123.94 84.43C122.34 86.13 120.78 87.87 119.20 89.58C117.61 91.29 116.02 93.00 114.43 94.70C112.84 96.41 111.23 98.10 109.64 99.81C108.05 101.51 106.49 103.25 104.89 104.94C103.28 106.64 101.61 108.27 100.02 109.97C98.42 111.67 96.90 113.44 95.31 115.15C93.73 116.86 92.09 118.53 90.50 120.23C88.90 121.93 87.30 123.63 85.72 125.35C84.14 127.06 82.59 128.81 80.99 130.51C79.39 132.21 77.72 133.84 76.13 135.54C74.54 137.25 73.01 139.02 71.43 140.73C69.85 142.45 68.25 144.15 66.65 145.84C65.04 147.54 63.39 149.18 61.80 150.89C60.21 152.60 58.70 154.38 57.11 156.09C55.53 157.80 53.89 159.46 52.28 161.16C50.68 162.85 49.08 164.55 47.50 166.26C45.92 167.98 44.40 169.75 42.80 171.45C41.20 173.15 39.52 174.78 37.92 176.47C36.32 178.17 34.76 179.90 33.18 181.62C31.60 183.34 29.80 184.91 28.46 186.79C27.13 188.67 25.86 190.72 25.17 192.89C24.49 195.06 24.43 197.50 24.34 199.82C24.26 202.14 24.30 204.51 24.65 206.81C24.99 209.10 25.53 211.43 26.39 213.57C27.24 215.72 28.41 217.82 29.77 219.68C31.13 221.54 32.75 223.31 34.55 224.75C36.35 226.18 38.43 227.44 40.57 228.28C42.70 229.12 45.08 229.50 47.38 229.77C49.68 230.05 52.04 229.92 54.38 229.95C56.71 229.98 59.04 229.93 61.38 229.95C63.71 229.97 66.04 229.99 68.37 230.05C70.71 230.12 73.04 230.27 75.37 230.36C77.70 230.46 80.03 230.56 82.36 230.60C84.69 230.65 87.03 230.64 89.36 230.66C91.69 230.68 94.03 230.70 96.36 230.71C98.69 230.72 101.03 230.72 103.36 230.72C105.69 230.72 108.03 230.73 110.36 230.73C112.69 230.73 115.03 230.72 117.36 230.73C119.69 230.74 122.03 230.72 124.36 230.77C126.69 230.82 129.03 230.91 131.36 231.02C133.69 231.13 136.01 231.37 138.34 231.45C140.67 231.53 143.01 231.49 145.34 231.52C147.68 231.54 150.46 230.98 152.34 231.59C154.22 232.20 156.30 233.47 156.64 235.17C156.98 236.88 155.16 239.60 154.40 241.81C153.65 244.01 152.91 246.23 152.12 248.42C151.33 250.62 150.44 252.78 149.67 254.98C148.89 257.18 148.23 259.42 147.46 261.62C146.69 263.82 145.84 266.00 145.04 268.19C144.24 270.38 143.43 272.57 142.66 274.77C141.90 276.98 141.22 279.21 140.44 281.41C139.65 283.61 138.76 285.76 137.97 287.96C137.18 290.15 136.47 292.38 135.71 294.58C134.94 296.79 134.19 298.99 133.39 301.19C132.60 303.38 131.74 305.55 130.96 307.75C130.19 309.95 129.43 312.16 128.75 314.39C128.06 316.62 127.21 318.84 126.84 321.12C126.48 323.41 126.35 325.81 126.58 328.10C126.81 330.40 127.31 332.77 128.22 334.87C129.12 336.97 130.47 339.00 132.00 340.70C133.54 342.41 135.43 343.94 137.41 345.11C139.39 346.28 141.66 347.09 143.88 347.74C146.11 348.39 148.46 348.86 150.76 348.99C153.07 349.13 155.45 348.98 157.71 348.54C159.98 348.11 162.35 347.49 164.34 346.39C166.34 345.29 167.99 343.51 169.70 341.93C171.41 340.36 172.98 338.61 174.59 336.93C176.20 335.24 177.77 333.51 179.37 331.81C180.96 330.10 182.53 328.38 184.14 326.69C185.74 325.00 187.40 323.35 189.01 321.66C190.62 319.97 192.20 318.26 193.79 316.55C195.38 314.84 196.94 313.11 198.55 311.42C200.16 309.73 201.83 308.10 203.44 306.41C205.06 304.73 206.63 303.01 208.23 301.31C209.83 299.61 211.42 297.90 213.03 296.21C214.64 294.52 216.27 292.86 217.88 291.16C219.48 289.47 221.06 287.75 222.65 286.05C224.25 284.34 225.81 282.61 227.43 280.93C229.04 279.24 230.72 277.62 232.33 275.93C233.95 274.25 235.51 272.52 237.10 270.80C238.68 269.09 240.25 267.36 241.85 265.67C243.46 263.97 245.11 262.33 246.73 260.64C248.34 258.96 249.95 257.27 251.54 255.56C253.13 253.86 254.66 252.09 256.26 250.39C257.85 248.69 259.51 247.04 261.13 245.36C262.75 243.68 264.38 242.02 265.98 240.31C267.57 238.61 269.09 236.84 270.68 235.13C272.27 233.43 273.91 231.76 275.53 230.08C277.15 228.40 278.79 226.75 280.39 225.05C281.99 223.35 283.53 221.59 285.12 219.88C286.71 218.18 288.32 216.49 289.93 214.81C291.55 213.12 293.20 211.47 294.81 209.78C296.42 208.09 297.99 206.37 299.58 204.66C301.17 202.96 302.75 201.24 304.36 199.55C305.97 197.86 307.61 196.20 309.22 194.51C310.82 192.82 312.42 191.11 314.00 189.40C315.58 187.68 317.28 186.05 318.71 184.22C320.14 182.38 321.48 180.43 322.57 178.39C323.66 176.34 324.69 174.18 325.26 171.95C325.82 169.72 326.01 167.31 325.96 165.00C325.92 162.70 325.73 160.26 324.99 158.10C324.25 155.95 322.96 153.87 321.53 152.07C320.11 150.27 318.32 148.62 316.43 147.30C314.54 145.98 312.38 144.93 310.22 144.13C308.05 143.32 305.72 142.86 303.43 142.44C301.14 142.03 298.81 141.77 296.49 141.62C294.16 141.48 291.82 141.58 289.49 141.57C287.15 141.56 284.82 141.57 282.49 141.57C280.15 141.57 277.82 141.57 275.49 141.57C273.15 141.57 270.82 141.57 268.49 141.57C266.15 141.57 263.82 141.57 261.49 141.57C259.15 141.57 256.82 141.56 254.49 141.55C252.15 141.54 249.82 141.52 247.49 141.51C245.15 141.50 242.82 141.51 240.49 141.51C238.15 141.51 235.82 141.51 233.49 141.51C231.15 141.51 228.82 141.51 226.49 141.51C224.15 141.50 221.82 141.50 219.49 141.50C217.15 141.49 214.82 141.50 212.49 141.49C210.15 141.49 207.82 141.49 205.49 141.47C203.15 141.44 200.80 141.52 198.49 141.33C196.18 141.14 193.04 141.55 191.63 140.34C190.21 139.13 189.98 136.25 190.01 134.08C190.04 131.90 191.14 129.55 191.80 127.31C192.45 125.07 193.22 122.87 193.94 120.65C194.67 118.43 195.43 116.22 196.15 114.00C196.86 111.78 197.50 109.54 198.23 107.32C198.96 105.11 199.77 102.92 200.53 100.71C201.29 98.50 202.06 96.30 202.79 94.09C203.53 91.87 204.19 89.63 204.95 87.43C205.71 85.22 206.58 83.05 207.35 80.85C208.12 78.65 208.82 76.42 209.56 74.21C210.31 72.00 211.06 69.79 211.84 67.59C212.61 65.39 213.50 63.22 214.20 61.00C214.91 58.78 215.58 56.54 216.06 54.26C216.54 51.98 217.01 49.65 217.07 47.34C217.13 45.02 216.97 42.62 216.44 40.39C215.92 38.15 215.13 35.83 213.90 33.91C212.68 31.99 210.93 30.24 209.09 28.88C207.25 27.52 205.03 26.53 202.86 25.73C200.69 24.93 198.24 24.38 196.07 24.09C193.90 23.80 192.02 23.77 189.84 23.99Z" />
    </svg>
  );
}

/** CONTROLS headline glyph — the design's own three-spoke gear icon, verbatim. */
function ControlsIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" style={{ display: 'block', flex: '0 0 26px' }}>
      <g fill={RC.purple}>
        <rect x="9" y="0.6" width="6" height="22.8" rx="0.8" />
        <rect x="9" y="0.6" width="6" height="22.8" rx="0.8" transform="rotate(60 12 12)" />
        <rect x="9" y="0.6" width="6" height="22.8" rx="0.8" transform="rotate(120 12 12)" />
        <circle cx="12" cy="12" r="8.4" />
      </g>
      <circle cx="12" cy="12" r="3.4" fill={RC.sunken} />
    </svg>
  );
}

/**
 * §3 avatar picker — an overlay panel (the auth-popup `bg-surface` treatment, no rim) with the
 * default + 4 presets rendered via the shared Avatar (so the disc matches the user's). Tapping a
 * preset shows the purple selection ring; the solid Save button calls `api.setAvatar`, and on
 * success bubbles the id up (App mirrors it into state + localStorage). Presets-only — no upload.
 */
function AvatarPicker({
  token,
  username,
  current,
  onSaved,
  onClose,
}: {
  token: string;
  username: string | null;
  current: AvatarId;
  onSaved(id: AvatarId): void;
  onClose(): void;
}) {
  const [selected, setSelected] = useState<AvatarId>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Lock body scroll while the overlay is open (same pattern as AuthModal).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const res = await api.setAvatar(selected, token);
      onSaved(res.avatarId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save avatar');
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your avatar"
      data-testid="avatar-picker"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        onClick={(ev) => ev.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-base font-bold">Choose your avatar</span>
          <button type="button" onClick={onClose} aria-label="Dismiss" className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--rc-muted)] hover:text-[var(--rc-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3" role="group" aria-label="Avatar presets">
          {PICKER_AVATARS.map((id) => {
            const isSel = selected === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSelected(id)}
                aria-pressed={isSel}
                data-testid={`avatar-option-${id}`}
                className={cn(
                  'flex items-center justify-center rounded-2xl bg-[var(--rc-bg)] p-3 transition-colors',
                  isSel ? 'ring-[3px] ring-brand' : 'ring-1 ring-border hover:ring-white/20',
                )}
              >
                <Avatar avatarId={id} username={username} size={56} />
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="avatar-picker-error">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          data-testid="avatar-picker-save"
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-3 text-sm font-bold text-white shadow-lg shadow-brand/20 transition-all hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
        </button>
      </motion.div>
    </div>
  );
}
